/* First-visit language routing: browser language decides until the visitor picks a version. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'prototype');
const inline = file => fs.readFileSync(path.join(root, file), 'utf8').match(/<script>\n([\s\S]*?)<\/script>/)[1];
function visit(file, { languages, pref = null, pathname, hash = '#view=browse&sel=fish:%E6%B2%99%E4%B8%81%E9%B1%BC' }) {
  const replaced = [];
  const store = new Map(pref ? [['sdv-lang', pref]] : []);
  const ctx = {
    document: { documentElement: { lang: file.startsWith('en/') ? 'en' : 'zh-CN' } },
    navigator: { languages, language: languages[0] },
    localStorage: { getItem: key => store.get(key) ?? null },
    location: { pathname, search: '', hash, replace: url => replaced.push(url) },
  };
  vm.runInNewContext(inline(file), ctx);
  return replaced[0] || null;
}
const hash = '#view=browse&sel=fish:%E6%B2%99%E4%B8%81%E9%B1%BC';
// No choice yet: follow the browser's first Chinese/English preference, keeping the entry.
assert.equal(visit('index.html', { languages: ['en-US', 'zh-CN'], pathname: '/' }), '/en/' + hash);
assert.equal(visit('index.html', { languages: ['zh-CN', 'en'], pathname: '/' }), null);
assert.equal(visit('index.html', { languages: ['zh-TW'], pathname: '/index.html' }), null);
assert.equal(visit('index.html', { languages: ['ja-JP'], pathname: '/' }), '/en/' + hash, 'Other languages default to English');
assert.equal(visit('index.html', { languages: ['fr-FR', 'zh-CN'], pathname: '/' }), null, 'A listed Chinese preference wins over the English default');
assert.equal(visit('en/index.html', { languages: ['zh-CN'], pathname: '/en/' }), '/' + hash);
assert.equal(visit('en/index.html', { languages: ['en-GB'], pathname: '/en/' }), null);
// A manual choice is remembered and overrides the browser language on later visits.
assert.equal(visit('en/index.html', { languages: ['zh-CN'], pref: 'en', pathname: '/en/' }), null);
assert.equal(visit('index.html', { languages: ['zh-CN'], pref: 'en', pathname: '/' }), '/en/' + hash);
assert.equal(visit('index.html', { languages: ['en-US'], pref: 'zh', pathname: '/' }), null);
// Works under a sub-path deployment too.
assert.equal(visit('en/index.html', { languages: ['zh-CN'], pathname: '/wiki/en/' }), '/wiki/' + hash);
console.log('Language routing checks passed: first-visit browser detection, remembered choice, preserved entry links.');
