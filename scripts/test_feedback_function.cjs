// Run with node scripts/test_feedback_function.cjs (no dependencies; Node 22.13+ for node:sqlite).
// Calls the visitor feedback Pages Function (functions/api/feedback.js) with Request objects and an
// in-memory stand-in for D1 (prepare/bind/first/run/all on node:sqlite, with migrations/0001_feedback.sql
// applied): a valid insert, validation errors, the honeypot, a foreign Origin, the rate limit (5 per hashed
// IP in 10 minutes, no raw IP stored) and other request methods.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0001_feedback.sql'), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async column => {
      const row = db.prepare(sql).get(...args);
      return row == null ? null : column ? row[column] : { ...row };
    },
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) }, results: [] };
    },
    all: async () => ({ success: true, meta: {}, results: db.prepare(sql).all(...args).map(r => ({ ...r })) }),
  });
  return { prepare: sql => statement(sql), rows: () => db.prepare('SELECT * FROM feedback ORDER BY id').all().map(r => ({ ...r })), db };
}

const SITE = 'https://stardewvalley-wiki.pages.dev';
const valid = {
  kind: 'error', message: '  鲶鱼的季节写错了，秋天雨天也能钓到。  ', contact: ' qq 12345 ', website: '',
  entry: 'fish:鲶鱼', entry_title: '鲶鱼', url: SITE + '/#view=browse&sel=fish:%E9%B2%B6%E9%B1%BC', lang: 'zh',
  viewport: '390x844', user_agent: 'Mozilla/5.0 (iPhone)', app_version: '3f2948f05341',
};
function request(body, { method = 'POST', ip = '203.0.113.7', headers = {}, raw } = {}) {
  const init = { method, headers: { 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': ip, 'User-Agent': 'HeaderAgent/1.0', ...headers } };
  for (const [k, v] of Object.entries(init.headers)) if (v === null) delete init.headers[k];
  if (method !== 'GET' && method !== 'HEAD') init.body = raw ?? JSON.stringify(body);
  return new Request(SITE + '/api/feedback', init);
}
async function call(fn, req, env) {
  const res = await fn({ request: req, env, params: {}, data: {}, next: () => { throw new Error('next() should not be called'); }, waitUntil() {} });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

(async () => {
  const { onRequestPost, onRequest } = await import(pathToFileURL(path.join(root, 'functions', 'api', 'feedback.js')).href);
  const D1 = fakeD1(), env = { FEEDBACK_DB: D1 };
  const post = (body, opts) => call(onRequestPost, request(body, opts), env);

  // A valid report is trimmed and stored with its context, status "new" and a hashed IP.
  let r = await post(valid);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, id: 1 });
  assert.match(r.headers.get('Content-Type'), /^application\/json/);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  let [row] = D1.rows();
  assert.equal(row.kind, 'error');
  assert.equal(row.message, '鲶鱼的季节写错了，秋天雨天也能钓到。');
  assert.equal(row.contact, 'qq 12345');
  for (const key of ['entry', 'entry_title', 'url', 'lang', 'viewport', 'user_agent', 'app_version']) assert.equal(row[key], valid[key], key);
  assert.equal(row.status, 'new');
  assert.equal(row.note, null);
  assert.match(row.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.match(row.ip_hash, /^[0-9a-f]{64}$/);
  assert(!JSON.stringify(row).includes('203.0.113.7'), 'the raw IP is never stored');

  // Optional fields may be left out: empty contact and context are NULL, the user agent falls back to the header,
  // over-long context is cut instead of rejected, and the same IP gets the same hash while another IP does not.
  r = await post({ kind: 'idea', message: '希望能按季节筛选。', url: SITE + '/' + 'x'.repeat(3000), lang: 'zh-CN-x-very-long-language-tag' });
  assert.equal(r.status, 200);
  row = D1.rows()[1];
  assert.equal(row.contact, null);
  assert.equal(row.entry, null);
  assert.equal(row.entry_title, null);
  assert.equal(row.user_agent, 'HeaderAgent/1.0');
  assert.equal(row.url.length, 1000);
  assert.equal(row.lang.length, 16);
  assert.equal(row.ip_hash, D1.rows()[0].ip_hash);
  r = await post(valid, { ip: '198.51.100.20' });
  assert.notEqual(D1.rows()[2].ip_hash, row.ip_hash);
  assert.equal((await post({ ...valid, message: '长'.repeat(2000) }, { ip: '198.51.100.21' })).status, 200, '2000 characters is allowed');

  // Validation errors, each with its own code and nothing stored.
  const before = D1.rows().length;
  const rejected = [
    [{ ...valid, kind: 'bug' }, 400, 'bad_kind'],
    [{ ...valid, kind: undefined }, 400, 'bad_kind'],
    [{ ...valid, message: '  好 ' }, 400, 'message_too_short'],
    [{ ...valid, message: 42 }, 400, 'message_too_short'],
    [{ ...valid, message: '长'.repeat(2001) }, 400, 'message_too_long'],
    [{ ...valid, contact: 'c'.repeat(101) }, 400, 'contact_too_long'],
  ];
  for (const [body, status, error] of rejected) {
    r = await post(body, { ip: '192.0.2.1' });
    assert.deepEqual([r.status, r.body], [status, { ok: false, error }], error);
  }
  for (const [raw, error] of [['{"kind":', 'bad_json'], ['[1,2]', 'bad_json'], ['null', 'bad_json'], [JSON.stringify({ ...valid, message: '长'.repeat(3000) }), 'too_large']]) {
    r = await post(null, { ip: '192.0.2.1', raw });
    assert.equal(r.body.error, error, raw.slice(0, 20));
    assert.equal(r.status, error === 'too_large' ? 413 : 400);
  }
  r = await post(valid, { ip: '192.0.2.1', headers: { 'Content-Type': 'text/plain' } });
  assert.deepEqual([r.status, r.body.error], [415, 'bad_content_type']);
  assert.equal(D1.rows().length, before, 'rejected reports are not stored');

  // Honeypot: a filled "website" field is answered like a success but not stored.
  r = await post({ ...valid, website: 'http://spam.example' }, { ip: '192.0.2.2' });
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  assert.equal(D1.rows().length, before);

  // A request from another site is refused; same-site and Origin-less requests are accepted.
  for (const origin of ['https://evil.example', 'null', 'http://stardewvalley-wiki.pages.dev:8080']) {
    r = await post(valid, { ip: '192.0.2.3', headers: { Origin: origin } });
    assert.deepEqual([r.status, r.body], [403, { ok: false, error: 'bad_origin' }], origin);
  }
  assert.equal(D1.rows().length, before);
  r = await post(valid, { ip: '192.0.2.3', headers: { Origin: null } });
  assert.equal(r.status, 200, 'no Origin header (curl, older clients) is fine');

  // Rate limit: at most 5 reports per hashed IP in 10 minutes; other IPs are unaffected; older rows stop counting.
  const ip = '192.0.2.50';
  for (let i = 0; i < 5; i++) assert.equal((await post(valid, { ip })).status, 200, `report ${i + 1}`);
  r = await post(valid, { ip });
  assert.deepEqual([r.status, r.body], [429, { ok: false, error: 'rate_limited' }]);
  assert.equal(r.headers.get('Retry-After'), '600');
  assert.equal((await post(valid, { ip: '192.0.2.51' })).status, 200, 'another IP still gets through');
  const hash = D1.rows().at(-2).ip_hash;
  D1.db.prepare('UPDATE feedback SET created_at = ? WHERE ip_hash = ?').run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), hash);
  assert.equal((await post(valid, { ip })).status, 200, 'reports older than 10 minutes no longer count');

  // Other methods get 405; onRequest hands POST to onRequestPost.
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    r = await call(onRequest, request(valid, { method }), env);
    assert.deepEqual([r.status, r.body], [405, { ok: false, error: 'method_not_allowed' }], method);
    assert.equal(r.headers.get('Allow'), 'POST');
  }
  r = await call(onRequest, request(valid, { ip: '192.0.2.60' }), env);
  assert.equal(r.status, 200);

  // Without the D1 binding, or when D1 fails, the visitor gets an error code (and the console only the D1 message).
  r = await call(onRequestPost, request(valid), {});
  assert.deepEqual([r.status, r.body], [503, { ok: false, error: 'unavailable' }]);
  const logged = [], error = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    r = await call(onRequestPost, request(valid), { FEEDBACK_DB: { prepare() { throw new Error('D1_ERROR: no such table: feedback'); } } });
  } finally { console.error = error; }
  assert.deepEqual([r.status, r.body], [500, { ok: false, error: 'server_error' }]);
  assert(logged.length === 1 && !logged[0].includes('鲶鱼'), 'the log does not repeat the report');

  console.log(`Feedback function checks passed: ${D1.rows().length} rows stored; validation, honeypot, origin, rate limit (5 per 10 minutes, hashed IP), 405 for other methods, missing or failing D1.`);
})().catch(error => { console.error(error); process.exit(1); });
