/* Exercise the standalone guide contract without rebuilding generated data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/curated/guides.json'), 'utf8'));
class Element {
  constructor(tag, attrs = {}, ...children) {
    this.tag = tag; this.attrs = attrs || {}; this.dataset = this.attrs.dataset || {}; this.children = [];
    this.append(...children);
  }
  append(...children) { this.children.push(...children.flat().filter(value => value != null && value !== false)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = value; }
  get textContent() { return this.children.map(child => child instanceof Element ? child.textContent : String(child)).join(' '); }
}
const nodes = node => node instanceof Element ? [node, ...node.children.flatMap(nodes)] : [];
let selected = null;
const t = (text, vars) => vars ? text.replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m) : text;
const ctx = { window: { App: { D: { guides: data }, el: (...args) => new Element(...args), select: ref => { selected = ref; }, t, N: name => name } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'prototype/js/guides.js'), 'utf8'), ctx);
const G = ctx.window.App.guides;
assert.equal(G.has('不存在的基础条目'), false);
assert.equal(G.render('不存在的基础条目'), null);
assert.equal(G.has('toString'), false);
for (const title of Object.keys(data.entries)) {
  assert(G.has(title));
  const page = G.render(title);
  assert(page instanceof Element && page.textContent.includes(data.entries[title].summary));
  assert(page.textContent.includes('查阅来源与版本'));
}
const fishing = G.render('钓鱼攻略');
const platform = id => nodes(fishing).find(node => node.dataset.platform === id);
platform('mobile').attrs.onclick();
assert(fishing.textContent.includes('右侧两个按钮中的左按钮'));
assert(!fishing.textContent.includes('鼠标左键或 C'), 'Hidden PC steps must not remain among visible mobile instructions');
assert.equal(platform('mobile').attrs['aria-pressed'], 'true');
assert.equal(platform('pc').attrs['aria-pressed'], 'false');
platform('controller').attrs.onclick();
assert(fishing.textContent.includes('□ 方块键') && fishing.textContent.includes('Switch'));
assert(!fishing.textContent.includes('右侧两个按钮中的左按钮'));
const controls = G.render('控制');
assert(controls.textContent.includes('LB / RB'), 'Chosen input method should follow a player to another basics guide');
nodes(controls).find(node => node.tag === 'button' && node.textContent === '物品栏').attrs.onclick();
assert.equal(selected.type, 'page'); assert.equal(selected.id, '物品栏');
const time = G.render('游戏内时间').textContent;
assert(time.includes('本地分屏') && time.includes('/pause') && time.includes('等鱼咬钩时仍会走时'));
const season = G.render('季节').textContent;
assert(season.includes('首获日 = 播种日期 + 生长天数') && season.includes('播种当天及之后每天浇水'));
assert(season.includes('通常不会因此直接枯死'));
const saves = G.render('存档');
nodes(saves).find(node => node.dataset.platform === 'mobile').attrs.onclick();
assert(saves.textContent.includes('Save Backup') && saves.textContent.includes('立即强制关闭'));
console.log('Guide checks passed: complete reading paths, platform-specific controls, attribution, related navigation, pause and crop assumptions.');

// English edition: same entry IDs, English text only, sources point at the English wiki.
const english = JSON.parse(fs.readFileSync(path.join(root, 'data/curated/guides.en.json'), 'utf8'));
const ui = JSON.parse(fs.readFileSync(path.join(root, 'data/i18n/ui.en.json'), 'utf8'));
const tEn = (text, vars) => t(ui[text] ?? text, vars);
const enCtx = { window: { App: { D: { guides: data }, EN: { guides: english }, el: (...args) => new Element(...args), select: () => {}, t: tEn, N: name => name } } };
vm.createContext(enCtx);
vm.runInContext(fs.readFileSync(path.join(root, 'prototype/js/guides.js'), 'utf8'), enCtx);
const EG = enCtx.window.App.guides;
for (const title of Object.keys(data.entries)) {
  assert(EG.has(title), `English guide missing: ${title}`);
  const page = EG.render(title);
  for (const node of nodes(page).filter(node => node.dataset.platform)) {
    node.attrs.onclick();
    // Related links still use Chinese IDs and the identity N() in this harness; the app shows their English names.
    const visible = nodes(page).filter(n => !n.attrs.class?.includes('guide-related')).flatMap(n => n.children.filter(c => !(c instanceof Element))).join(' ');
    assert(!/[㐀-鿿]/.test(visible), `English guide shows Chinese: ${title}: ${visible.match(/.{0,20}[㐀-鿿]+.{0,20}/)?.[0]}`);
  }
  assert(nodes(page).some(node => node.tag === 'a' && /stardewvalleywiki\.com/.test(node.attrs.href) && !/zh\./.test(node.attrs.href)), `English guide must cite the English wiki: ${title}`);
}
console.log('English guide checks passed: every entry renders in English and cites the English wiki.');
