// Run with node scripts/test_feedback_function.cjs (no dependencies; Node 22.13+ for node:sqlite).
// Calls the visitor feedback Pages Functions (functions/api/feedback/) with Request objects and an in-memory
// stand-in for D1 (prepare/bind/first/run/all on node:sqlite, with every file in migrations/ applied).
// Submitting (index.js): a valid insert, validation errors, the honeypot, a foreign Origin, the rate limit
// (5 per hashed IP in 10 minutes, no raw IP stored), other request methods, and the visitor token (only its hash
// is stored). “My feedback” (mine.js): only the token's own threads, without contact or browser details.
// Follow-ups (reply.js): only on one's own thread, reopening it, rate limited. The maintainer commands in
// scripts/feedback.mjs run their SQL on the same database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'));
  }
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
  return {
    prepare: sql => statement(sql), db,
    rows: () => db.prepare('SELECT * FROM feedback ORDER BY id').all().map(r => ({ ...r })),
    messages: () => db.prepare('SELECT * FROM feedback_messages ORDER BY id').all().map(r => ({ ...r })),
  };
}

const SITE = 'https://stardewvalley-wiki.pages.dev';
const valid = {
  kind: 'error', message: '  鲶鱼的季节写错了，秋天雨天也能钓到。  ', contact: ' qq 12345 ', website: '',
  entry: 'fish:鲶鱼', entry_title: '鲶鱼', url: SITE + '/#view=browse&sel=fish:%E9%B2%B6%E9%B1%BC', lang: 'zh',
  viewport: '390x844', user_agent: 'Mozilla/5.0 (iPhone)', app_version: '3f2948f05341',
};
function request(body, { method = 'POST', ip = '203.0.113.7', headers = {}, raw, token, path: route = '/api/feedback' } = {}) {
  const init = { method, headers: { 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': ip, 'User-Agent': 'HeaderAgent/1.0', ...headers } };
  if (token) init.headers['X-Feedback-Token'] = token;
  for (const [k, v] of Object.entries(init.headers)) if (v === null) delete init.headers[k];
  if (method !== 'GET' && method !== 'HEAD') init.body = raw ?? JSON.stringify(body);
  return new Request(SITE + route, init);
}
async function call(fn, req, env) {
  const res = await fn({ request: req, env, params: {}, data: {}, next: () => { throw new Error('next() should not be called'); }, waitUntil() {} });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

(async () => {
  const load = name => import(pathToFileURL(path.join(root, 'functions', 'api', 'feedback', name)).href);
  const { onRequestPost, onRequest } = await load('index.js');
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
  assert.equal(row.updated_at, row.created_at, 'a new report starts with updated_at = created_at');
  assert.equal(row.token_hash, null, 'without a visitor token there is nothing to look it up by');

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

  await threads(D1, load);

  console.log(`Feedback function checks passed: ${D1.rows().length} rows and ${D1.messages().length} messages stored; validation, honeypot, origin, rate limit (5 per 10 minutes, hashed IP), 405 for other methods, missing or failing D1; visitor tokens, “my feedback”, follow-ups (own threads only, reopen, 10 per 10 minutes) and the maintainer commands.`);
})().catch(error => { console.error(error); process.exit(1); });

// Visitor tokens, “my feedback” and follow-ups, on the database the checks above left behind.
async function threads(D1, load) {
  const { onRequestPost: create } = await load('index.js');
  const mine = await load('mine.js'), follow = await load('reply.js');
  const { statements } = await import(pathToFileURL(path.join(root, 'scripts', 'feedback.mjs')).href);
  const env = { FEEDBACK_DB: D1 };
  const A = 'tokenA_' + 'a'.repeat(25), B = 'tokenB-' + 'b'.repeat(25);
  const list = (token, opts = {}) => call(mine.onRequestGet, request(null, { method: 'GET', path: '/api/feedback/mine', token, ...opts }), env);
  const answer = (body, opts = {}) => call(follow.onRequestPost, request(body, { path: '/api/feedback/reply', ip: '198.51.100.70', ...opts }), env);
  // The maintainer commands run their SQL as one batch, like wrangler d1 execute --command.
  const maintainer = sql => [].concat(sql).map(one => D1.db.prepare(one).all().map(r => ({ ...r })));

  // A report sent with a token stores only the token's hash; a malformed token is ignored, not rejected.
  let r = await call(create, request({ ...valid, message: '第一条：鲶鱼的季节写错了。' }, { ip: '198.51.100.60', token: A }), env);
  assert.equal(r.status, 200);
  const first = r.body.id;
  let row = D1.rows().at(-1);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  assert(!JSON.stringify(D1.rows()).includes(A), 'the raw token is never stored');
  r = await call(create, request({ ...valid, kind: 'idea', message: '第二条：希望能按季节筛选。', entry: '', entry_title: '' }, { ip: '198.51.100.60', token: A }), env);
  const second = r.body.id;
  assert.equal(D1.rows().at(-1).token_hash, row.token_hash, 'the same token gives the same hash');
  r = await call(create, request({ ...valid, message: '别人的反馈，联系方式保密。' }, { ip: '198.51.100.61', token: B }), env);
  const other = r.body.id;
  assert.notEqual(D1.rows().at(-1).token_hash, row.token_hash);
  r = await call(create, request(valid, { ip: '198.51.100.62', headers: { 'X-Feedback-Token': 'short' } }), env);
  assert.equal(r.status, 200);
  assert.equal(D1.rows().at(-1).token_hash, null);

  // “My feedback”: needs a well-formed token; lists only that token's threads, newest first, without contact,
  // address, browser details or hashes.
  for (const token of [undefined, 'short', 'has space ' + 'x'.repeat(30), 'x'.repeat(65)]) {
    r = await list(undefined, { headers: token ? { 'X-Feedback-Token': token } : {} });
    assert.deepEqual([r.status, r.body], [400, { ok: false, error: 'bad_token' }], String(token));
  }
  r = await list(A);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(r.body.threads.map(t => t.id), [second, first]);
  const [, firstThread] = r.body.threads;
  assert.deepEqual(Object.keys(firstThread).sort(), ['created_at', 'entry', 'entry_title', 'id', 'kind', 'message', 'messages', 'status', 'updated_at']);
  assert.deepEqual([firstThread.message, firstThread.entry, firstThread.entry_title, firstThread.status, firstThread.messages], ['第一条：鲶鱼的季节写错了。', valid.entry, valid.entry_title, 'new', []]);
  assert(!JSON.stringify(r.body).includes('保密') && !JSON.stringify(r.body).includes('qq 12345'), 'no contact details and no other visitor’s threads');
  assert.deepEqual((await list(B)).body.threads.map(t => t.id), [other]);
  assert.deepEqual((await list('n'.repeat(32))).body, { ok: true, threads: [] }, 'an unknown token has no threads');
  r = await call(mine.onRequest, request(null, { path: '/api/feedback/mine', token: A }), env);
  assert.deepEqual([r.status, r.body.error, r.headers.get('Allow')], [405, 'method_not_allowed', 'GET']);
  r = await call(mine.onRequest, request(null, { method: 'GET', path: '/api/feedback/mine', token: A }), env);
  assert.equal(r.status, 200, 'onRequest hands GET to onRequestGet');
  r = await call(mine.onRequestGet, request(null, { method: 'GET', path: '/api/feedback/mine', token: A }), {});
  assert.deepEqual([r.status, r.body], [503, { ok: false, error: 'unavailable' }]);

  // The maintainer replies (scripts/feedback.mjs reply): the thread shows the reply and the new status.
  const before = (await list(A)).body.threads.find(t => t.id === first).updated_at;
  await new Promise(resolve => setTimeout(resolve, 5));
  let [, , [state]] = maintainer(statements.reply(first, '谢谢！已经改好了，秋天的雨天也能钓到。', 'replied'));
  assert.deepEqual([state.id, state.status, state.visible], [first, 'replied', 1]);
  let thread = (await list(A)).body.threads.find(t => t.id === first);
  assert.equal(thread.status, 'replied');
  assert(thread.updated_at > before, 'a reply moves updated_at forward');
  assert.deepEqual(thread.messages.map(m => [m.author, m.message]), [['team', '谢谢！已经改好了，秋天的雨天也能钓到。']]);
  assert.deepEqual(Object.keys(thread.messages[0]).sort(), ['author', 'created_at', 'id', 'message']);
  assert.match(thread.messages[0].created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'the same timestamp format as the Functions');
  // Quotes in the reply are kept as written; a missing thread gets no message.
  maintainer(statements.reply(second, "It's done: 'quoted'; DROP TABLE feedback; --", 'done'));
  assert.equal((await list(A)).body.threads.find(t => t.id === second).messages[0].message, "It's done: 'quoted'; DROP TABLE feedback; --");
  const count = D1.messages().length;
  [, , [state]] = maintainer(statements.reply(99999, '不存在的反馈'));
  assert.equal(state, undefined);
  assert.equal(D1.messages().length, count, 'no reply is stored for a missing thread');
  assert.throws(() => statements.reply(first, '好', 'replied'), /太短/);
  assert.throws(() => statements.reply(first, '回复', 'closed'), /状态/);
  assert.throws(() => statements.reply('1; DROP TABLE feedback', '回复'), /编号/);

  // Follow-ups: on one's own thread only (404 otherwise, whether or not the thread exists).
  for (const [body, opts, status, error] of [
    [{ id: first, message: '追问' }, {}, 400, 'bad_token'],
    [{ id: first, message: '追问' }, { headers: { 'X-Feedback-Token': 'short' } }, 400, 'bad_token'],
    [{ id: 'abc', message: '追问' }, { token: A }, 400, 'bad_id'],
    [{ id: 0, message: '追问' }, { token: A }, 400, 'bad_id'],
    [{ id: first, message: ' 好 ' }, { token: A }, 400, 'message_too_short'],
    [{ id: first, message: '长'.repeat(2001) }, { token: A }, 400, 'message_too_long'],
    [{ id: other, message: '想看别人的反馈' }, { token: A }, 404, 'not_found'],
    [{ id: 99999, message: '不存在的反馈' }, { token: A }, 404, 'not_found'],
    [{ id: first, message: '别的网站' }, { token: A, headers: { Origin: 'https://evil.example' } }, 403, 'bad_origin'],
    [{ id: first, message: '纯文本' }, { token: A, headers: { 'Content-Type': 'text/plain' } }, 415, 'bad_content_type'],
  ]) {
    r = await answer(body, opts);
    assert.deepEqual([r.status, r.body], [status, { ok: false, error }], `${error} ${JSON.stringify(body).slice(0, 40)}`);
  }
  assert.equal(D1.messages().length, count, 'rejected follow-ups are not stored');
  r = await answer({ id: first, message: '  还有：冬天的雨天呢？  ' }, { token: A });
  assert.equal(r.status, 200);
  assert.match(r.body.created_at, /^\d{4}-\d\d-\d\dT/);
  const stored = D1.messages().at(-1);
  assert.deepEqual([stored.id, stored.feedback_id, stored.author, stored.message, stored.created_at], [r.body.id, first, 'visitor', '还有：冬天的雨天呢？', r.body.created_at]);
  assert.match(stored.ip_hash, /^[0-9a-f]{64}$/);
  thread = (await list(A)).body.threads.find(t => t.id === first);
  assert.deepEqual([thread.status, thread.updated_at], ['new', r.body.created_at], 'a follow-up reopens the thread');
  assert.deepEqual(thread.messages.map(m => m.author), ['team', 'visitor']);
  assert.deepEqual(maintainer(statements.list(false))[0].map(t => t.id).filter(id => id === first), [first], 'the maintainer list shows it again');
  r = await call(follow.onRequest, request(null, { method: 'GET', path: '/api/feedback/reply', token: A }), env);
  assert.deepEqual([r.status, r.headers.get('Allow')], [405, 'POST']);

  // Follow-ups are limited to 10 per hashed IP in 10 minutes; maintainer replies do not count.
  for (let i = 0; i < 4; i++) maintainer(statements.reply(first, `维护者回复 ${i + 1}`));
  for (let i = 2; i <= 10; i++) assert.equal((await answer({ id: first, message: `补充 ${i}` }, { token: A })).status, 200, `follow-up ${i}`);
  r = await answer({ id: first, message: '补充 11' }, { token: A });
  assert.deepEqual([r.status, r.body.error, r.headers.get('Retry-After')], [429, 'rate_limited', '600']);
  assert.equal((await answer({ id: first, message: '换个网络' }, { token: A, ip: '198.51.100.71' })).status, 200);

  // Status changes (scripts/feedback.mjs status) move updated_at too, and keep the note for maintainers only.
  [, [state]] = maintainer(statements.status(second, 'wontfix', '和游戏一致，不改'));
  assert.deepEqual([state.status, state.note], ['wontfix', '和游戏一致，不改']);
  thread = (await list(A)).body.threads.find(t => t.id === second);
  assert.equal(thread.status, 'wontfix');
  assert(!JSON.stringify(thread).includes('不改'), 'the note is not shown to the visitor');
  assert.throws(() => statements.status(second, 'closed'), /状态/);
  const shown = maintainer(statements.show(first));
  assert.equal(shown[0][0].id, first);
  assert(shown[1].length >= 15 && shown[1].every(m => ['team', 'visitor'].includes(m.author)));
  assert(maintainer(statements.list(true))[0].length > maintainer(statements.list(false))[0].length, '--all lists every status');

  // A failing database: an error code for the visitor, and the console gets only the D1 message.
  const logged = [], error = console.error, broken = { FEEDBACK_DB: { prepare() { throw new Error('D1_ERROR: no such table: feedback_messages'); } } };
  console.error = (...args) => logged.push(args.join(' '));
  try {
    r = await call(mine.onRequestGet, request(null, { method: 'GET', path: '/api/feedback/mine', token: A }), broken);
    assert.deepEqual([r.status, r.body], [500, { ok: false, error: 'server_error' }]);
    r = await call(follow.onRequestPost, request({ id: first, message: '数据库坏了时的追问' }, { path: '/api/feedback/reply', token: A }), broken);
    assert.deepEqual([r.status, r.body], [500, { ok: false, error: 'server_error' }]);
  } finally { console.error = error; }
  assert(logged.length === 2 && !logged.some(line => line.includes('追问')), 'the log does not repeat the message');
}
