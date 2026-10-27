// Validate actual generated references and representative previously broken items.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'prototype/data.js'), 'utf8'), context);
const D = context.window.SDV;
const images = new Set();
function collect(value) {
  if (typeof value === 'string' && /\.(png|gif|jpe?g|webp|svg)$/i.test(value) && !value.startsWith('http')) images.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
}
collect(D);
for (const name of fs.readdirSync(path.join(root, 'prototype/js')).filter(name => name.endsWith('.js'))) {
  const code = fs.readFileSync(path.join(root, 'prototype/js', name), 'utf8');
  for (const match of code.matchAll(/["']([A-Za-z0-9][^"'\n]*\.(?:png|gif|webp|jpg|svg))["']/g)) images.add(match[1]);
}
for (const name of images) {
  const file = path.join(root, 'prototype/assets/img', name);
  assert(fs.existsSync(file), `Missing file: ${name}`);
  assert(D.imgs.includes(name), `Image omitted from manifest: ${name}`);
  const data = fs.readFileSync(file);
  if (name.toLowerCase().endsWith('.png')) assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Invalid PNG: ${name}`);
}
for (const [title, page] of Object.entries(D.pages)) {
  if (page.id) assert(D.items[page.id], `Orphan item reference: ${title} (${page.id})`);
}
for (const [id, filename] of [
  ['(O)223', 'Cookie.png'], ['(O)438', 'Large_Goat_Milk.png'],
  ['(S)1000', 'Shirt000.png'], ['(WP)0', 'Wallpaper_001_Icon.png'],
  ['(FL)0', 'Flooring_01_Icon.png'], ['(T)CopperTrashCan', 'Trash_Can_Copper.png'],
  ['(FL)56', 'Flooring_66_Icon.png'], ['(FL)MoreFloors:0', 'Flooring_57_Icon.png'],
  ['(WP)MoreWalls:0', 'Wallpaper_113_Icon.png'],
  ['(O)348/88', 'Wine.png'], ['(O)398/88', 'Dried_Fruit.png'],
  ['(F)1557', "'Sun_44'.png"], ['(O)180', 'Brown_Egg.png'], ['(O)182', 'Large_Brown_Egg.png'],
  ['(O)71', 'Springobjects071.png'], ['(S)1259', 'Shirt259a.png'],
]) assert.equal(D.items[id]?.i, filename, `Incorrect artwork for ${id}`);
assert(D.items['(O)348/88'].inote, 'Generic variant artwork must be identified');
assert(D.items['(O)Book_AnimalCatalogue'], 'Underscore/case normalization lost a book');
const chair = D.pages['水晶椅'];
assert(D.items[chair.id]?.i, 'Furniture detail lost its image');
assert.equal(D.pages['骷髅'].id, null, 'A monster must not resolve to same-name furniture');
// Both language entry pages must reference files that exist; /en/ resolves them from the root via <base href="../">.
const pages = ['prototype/index.html', 'prototype/en/index.html'];
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  if (page.includes('/en/')) {
    assert(html.includes('<html lang="en">') && html.includes('<base href="../">'), 'English page must declare its language and asset base');
    assert(!/[㐀-鿿]/.test(html.replace(/<script\b[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '').replace('title="切换到中文">中文<', '')), 'English page shows Chinese text');
  }
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)) {
    if (ref.endsWith('/')) continue;
    assert(fs.existsSync(path.join(root, 'prototype', ref)), `${page} references a missing file: ${ref}`);
  }
}
const english = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'prototype/data.en.js'), 'utf8'), english);
vm.runInNewContext(fs.readFileSync(path.join(root, 'prototype/js/strings.en.js'), 'utf8'), english);
assert(Object.keys(english.window.SDV_EN.names).length > 1000 && english.window.SDV_EN.guides && english.window.SDV_EN.progression, 'English data is incomplete');
assert(Object.keys(english.window.SDV_UI_EN).length > 800, 'English interface strings are incomplete');
// Wiki article bodies are fetched per entry from prototype/articles/{zh,en}/.
let articles = 0;
for (const [lang, entries] of [['zh', D.pages], ['en', english.window.SDV_EN.pages]]) {
  for (const [title, page] of Object.entries(entries)) {
    if (!page.ar) continue;
    assert(fs.existsSync(path.join(root, 'prototype/articles', lang, page.ar + '.json')), `Missing article file: ${lang}/${title}`);
    articles++;
  }
}
assert(articles > 3800, 'Article bodies are incomplete');
console.log(JSON.stringify({ checkedImages: images.size, orphanPageItems: 0, totalItems: Object.keys(D.items).length,
  itemsWithImages: Object.values(D.items).filter(item => item.i).length, languagePages: pages.length, articles, status: 'passed' }));
