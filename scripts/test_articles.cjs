// Run with node scripts/test_articles.cjs. Checks the per-article files in prototype/articles/
// against the packed data: every referenced file exists, has the expected structure, shows no
// leftover wiki markup, and English articles don't show Chinese text (apart from the few English
// wiki pages that quote Chinese strings on purpose).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'prototype');
const ctx = { window: {} };
vm.createContext(ctx);
for (const file of ['data.js', 'data.en.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
const D = ctx.window.SDV, E = ctx.window.SDV_EN;
const load = (lang, key) => JSON.parse(fs.readFileSync(path.join(root, 'articles', lang, key + '.json'), 'utf8'));
const article = (lang, title) => load(lang, (lang === 'en' ? E.pages[title] : D.pages[title]).ar);

// Version histories and the panda hat article quote Chinese strings in the English wiki itself.
const QUOTES_CHINESE = new Set(['版本历史', '主机版历史', '熊猫帽子']);
const BLOCKS = new Set(['p', 'n', 'h', 'l', 'q', 't', 'd', 'g']);
const CJK = /[㐀-鿿]/;
const MARKUP = /\{\{|\}\}|\{\||\|\}|\[\[[^\]]*\]\]|\u000e|\u000f|\u0003/;

function texts(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) {
    // Runs: ["i", item ID, label] / ["l", page key, label]; keys are internal Chinese IDs, labels are shown.
    // Page keys may name a section ("版本历史#1.6"); the page part has to exist.
    if (node.length === 3 && node[0] === 'l' && typeof node[1] === 'string' && typeof node[2] === 'string') linkKeys.add(node[1]);
    if (node.length === 3 && (node[0] === 'i' || node[0] === 'l') && typeof node[1] === 'string' && typeof node[2] === 'string') out.push(node[2]);
    else if (node.length === 3 && node[0] === 'f' && typeof node[1] === 'string') images.add(node[1]);
    else node.forEach(child => texts(child, out));
  } else if (node && typeof node === 'object') Object.values(node).forEach(child => texts(child, out));
  return out;
}
function checkBlocks(blocks, where) {
  for (const block of blocks) {
    assert(BLOCKS.has(block[0]), `${where}: unknown block ${block[0]}`);
    // Figures: [image, width, caption] or, for large maps, [thumbnail, width, caption, full-size WebP];
    // [null, 0, caption, wiki file] only links to the wiki when no WebP could be made.
    if (block[0] === 'g') for (const [file, , , large] of block[1]) {
      if (file) { images.add(file); if (large) images.add(large); } else { assert(large, `${where}: figure without an image or a link`); linkOnly++; }
    }
    if (block[0] === 'd') checkBlocks(block[2], where);
    if (block[0] === 't') for (const row of block[1]) for (const cell of row) if (!Array.isArray(cell) && cell.b) checkBlocks(cell.b, where);
  }
}

let checked = 0, linkOnly = 0, bytes = { zh: 0, en: 0 };
const images = new Set(), linkKeys = new Set();
for (const [lang, pages] of [['zh', D.pages], ['en', E.pages]]) {
  const keys = Object.entries(pages).filter(([, p]) => p.ar);
  assert(keys.length > 1900, `${lang}: articles for most pages (${keys.length})`);
  const files = new Set(fs.readdirSync(path.join(root, 'articles', lang)).filter(name => name !== 'search.json'));
  assert.equal(files.size, new Set(keys.map(([, p]) => p.ar)).size, `${lang}: no stray or missing article files`);
  for (const [title, page] of keys) {
    assert(files.has(page.ar + '.json'), `${lang}: missing file for ${title}`);
    const raw = fs.readFileSync(path.join(root, 'articles', lang, page.ar + '.json'), 'utf8');
    bytes[lang] += raw.length;
    // The largest (crop growth calendar, version history) are repetitive and compress to a few dozen KB.
    assert(raw.length < 600000, `${lang}: ${title} stays below 600 KB`);
    const a = JSON.parse(raw);
    assert(Array.isArray(a.s), `${lang}: ${title} has sections`);
    for (const [heading, level, blocks] of a.s) {
      assert(heading === null || typeof heading === 'string');
      assert(Number.isInteger(level));
      checkBlocks(blocks, `${lang}:${title}`);
    }
    const shown = texts([a.f || [], a.s.map(([h, , b]) => [h || '', b])]).join('\n');
    assert(!MARKUP.test(shown.replace(/针对模组作者的更改\]\]/, '')), `${lang}: ${title} shows wiki markup: ${(shown.match(MARKUP) || [''])[0]}`);
    if (lang === 'en' && !QUOTES_CHINESE.has(title)) assert(!CJK.test(shown), `en: ${title} shows Chinese text: ${shown.match(/.{0,20}[㐀-鿿].{0,20}/)?.[0]}`);
    checked++;
  }
}

// The full-text search corpus lists every article's sections as plain text.
for (const lang of ['zh', 'en']) {
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'articles', lang, 'search.json'), 'utf8'));
  assert(corpus.length > 1900, `${lang}: search corpus covers the articles`);
  assert(corpus.every(([title, sections]) => D.pages[title] && sections.every(([h, text]) => typeof h === 'string' && typeof text === 'string' && text)), `${lang}: corpus keys are page titles`);
  if (lang === 'en') assert(!corpus.some(([title, sections]) => !QUOTES_CHINESE.has(title) && sections.some(([h, text]) => CJK.test(h + text))), 'en: corpus is English');
}
assert(JSON.parse(fs.readFileSync(path.join(root, 'articles', 'zh', 'search.json'), 'utf8')).some(([title, sections]) => title === '夏威夷宴会' && sections.some(([h]) => h === '百乐汤')));

// Content that the converter has to keep: infobox facts, transcluded skill tables with item links,
// collapsible schedules, quotes, recipe rows and English labels.
const greenhouse = article('zh', '温室');
assert.deepEqual(greenhouse.f.map(([label]) => label).slice(0, 2), ['建造成本', '建筑材料']);
const farming = JSON.stringify(article('zh', '耕种'));
assert(farming.includes('["i","(BC)8","稻草人"]'), 'Farming/Skill is transcluded with item links');
assert(farming.includes('畜牧人') && farming.includes('农业学家'), 'professions are kept');
assert(farming.includes('能量 90'), 'recipe rows from {{:Hashbrowns|RecipeRow}}');
const penny = article('zh', '潘妮');
assert(penny.s.some(([h, , blocks]) => h === '日程表' && blocks.some(b => b[0] === 'd' && b[1] === '春季')), 'schedules become collapsible details');
assert(JSON.stringify(article('zh', '夏威夷宴会')).includes('["q",'), 'quotes are kept');
assert.equal(article('en', '温室').f[0][0], 'Build cost');
const calendar = JSON.stringify(article('zh', '作物生长日历'));
assert(calendar.includes('["f","Blue_Jazz_Stage_6.png"') || /\["f","[^"]*Stage[^"]*"/.test(calendar), 'the crop growth calendar keeps its stage images');
assert(JSON.stringify(article('zh', '樱桃树')).includes('["f","Cherry_Stage_1.png"'), 'growth stage tables keep their images');
assert(JSON.stringify(article('zh', '温室')).includes('Optimaliridiumgreenhouse.png'), 'layout figures are kept as images or links');
// Version history rows link to the version's section; portraits and galleries are figure groups.
const parsnip = article('zh', '防风草').s.find(([h]) => h === '历史');
assert(parsnip && JSON.stringify(parsnip).includes('["l","版本历史#1.4","1.4"]'), 'version history rows link to the version section');
assert(article('en', '防风草').s.some(([h]) => h === 'History'), 'English articles keep their History section');
const portraits = article('zh', '潘妮').s.find(([h]) => h === '肖像');
assert(portraits && portraits[2].flatMap(b => b[0] === 'g' ? b[1] : []).filter(([file, width]) => file && width === 64).length >= 20, 'villager portraits are shown at 64 px');
assert(JSON.stringify(article('zh', '温室')).includes('"Broken_Greenhouse.png",224,["初始状态"]'), 'gallery sections keep their captions');
// Large maps ship as a thumbnail plus the full-size WebP.
assert(JSON.stringify(article('zh', '鹈鹕镇')).includes('["TownDistances.thumb.webp",320,'), 'large maps show a thumbnail');
assert(JSON.stringify(article('zh', '鹈鹕镇')).includes('"TownDistances.webp"]'), 'the thumbnail opens the full-size image');
assert.equal(linkOnly, 0, 'every large figure ships as WebP');
// Images on a line of their own keep the wiki's size; images in tables keep their set width;
// heavy screenshots ship as WebP of the same size.
assert(JSON.stringify(article('zh', '控制')).includes('["XboxControllerMap_ZH.png",512,'), 'controller maps are shown at their wiki size');
assert(JSON.stringify(article('zh', '鹈鹕镇')).includes('["f","Blacksmith.png",200]'), 'building pictures in tables keep their width');
assert(JSON.stringify(article('zh', '金色核桃')).includes('"Walnutwestaroundthecliff.webp"'), 'heavy screenshots ship as WebP');
for (const key of linkKeys) assert(D.pages[key.split('#')[0]], `link to a missing page: ${key}`);
// Every image an article shows is shipped with the site.
for (const file of images) assert(fs.existsSync(path.join(root, 'assets', 'img', file)), `article image missing from assets: ${file}`);
console.log(`Article checks passed: ${checked} files, ${(bytes.zh / 1e6).toFixed(1)} MB zh + ${(bytes.en / 1e6).toFixed(1)} MB en, ${images.size} images, ${linkKeys.size} links, structure, markup, language and key content.`);
