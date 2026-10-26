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
const ctx = { window: { App: { D: { guides: data }, el: (...args) => new Element(...args), select: ref => { selected = ref; } } } };
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
