// No dependencies: use the actual snapshot and a small DOM to verify records and disclosure boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'prototype');
class Node {
  constructor(tag = '', text = '') { this.tag = tag; this.text = text; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.className = ''; }
  setAttribute(key, value) {
    this.attrs[key] = String(value);
    if (key === 'checked' || key === 'disabled') this[key] = true;
  }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(text) { this.text = String(text); this.children = []; }
  dispatch(type) { for (const fn of this.events[type] || []) fn({ target: this }); }
}
function boot(saved) {
  const ctx = { window: {}, Node, structuredClone, setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => saved || null },
    document: { createElement: tag => new Node(tag), createTextNode: text => new Node('', text) } };
  vm.createContext(ctx);
  for (const file of ['data.js', 'js/i18n.js', 'js/core.js', 'js/tree.js', 'js/spoilers.js', 'js/browse.js', 'js/collections.js', 'js/browse-views.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  ctx.window.App.select = () => {};
  return ctx.window.App;
}
const walk = node => [node, ...node.children.flatMap(walk)];
const hasClass = (node, name) => node.className.split(/\s+/).includes(name);
const nodes = (root, cls) => walk(root).filter(node => hasClass(node, cls));
const exposure = node => walk(node).map(n => [n.text, ...Object.values(n.attrs), ...Object.values(n.dataset)].join(' ')).join(' ');
const value = (A, key) => A.browse.bundle(key);
const A = boot(), C = A.collections;
const quality = value(A, '茶水间:高品质作物收集包');
const material = value(A, '工艺室:建筑收集包');
const gold = value(A, '金库:2,500金收集包');
const q = () => C.summary(quality.room, quality.bundle);
assert.equal(q().submitted, 0);
assert.equal(q().required, 3, 'The fourth gold crop is an alternative, not a requirement');
assert.equal(q().complete, false);
assert.equal(q().started, false);
assert.equal(Object.keys(A.state.collections).length, 0, 'New and legacy sessions begin without inferred records');
A.setProgress(p => { p.rooms = ['茶水间', '工艺室']; p.owned['(O)24'] = true; });
assert.equal(q().submitted, 0, 'A completed room or owned crop is not a donation record');
let events = 0;
A.on(reason => { if (reason === 'collections') events++; });
for (const index of [0, 1, 2]) assert.equal(C.toggle(quality.room, quality.bundle, index, true), true);
assert.equal(events, 3, 'Each successful edit uses the shared persistence event');
assert.equal(q().complete, true);
assert.equal(q().submitted, 3);
assert.equal(C.toggle(quality.room, quality.bundle, 3, true), false, 'An already sufficient choice bundle must not demand or accept a fourth donation');
assert.equal(events, 3, 'No-op edits do not trigger a save or rerender');
let rendered = C.renderRequirements(quality.room, quality.bundle);
assert(!rendered.textContent.includes('已够要求'), 'Reference reading must not lead with save maintenance');
assert.equal(nodes(rendered, 'collection-submit').length, 0, 'Submission controls are opt-in');
nodes(rendered, 'collection-recording')[0].dispatch('click');
assert(rendered.textContent.includes('已够要求'));
assert.equal(nodes(rendered, 'collection-requirement').length, 4);
for (const row of nodes(rendered, 'collection-requirement')) {
  assert(row.textContent.includes('数量 ×5') && row.textContent.includes('金星品质'), 'Quantity and quality are shown per requirement');
}
assert.equal(nodes(rendered, 'collection-requirement')[3].children[0].children[0].disabled, true);
const filter = nodes(rendered, 'collection-filter')[0].children[0];
filter.checked = true; filter.dispatch('change');
assert.equal(nodes(rendered, 'collection-requirement').length, 1, 'Local missing filter excludes only actually submitted rows');
assert(rendered.textContent.includes('已够要求'), 'Showing an unchosen alternative must not change the completed verdict');
assert.equal(C.toggle(quality.room, quality.bundle, 1, false), true);
assert.equal(C.toggle(quality.room, quality.bundle, 3, true), true, 'Choices remain correctable');
assert.equal(q().complete, true);
assert.deepEqual(Array.from(A.state.progress.rooms), ['茶水间', '工艺室'], 'Donations do not alter world completion state');

C.toggle(material.room, material.bundle, 0, true);
assert.equal(C.isSubmitted(material.room, material.bundle, 0), true);
assert.equal(C.isSubmitted(material.room, material.bundle, 1), false, 'The two wood stacks are distinct slots');
assert.equal(C.summary(material.room, material.bundle).submitted, 1);
assert(C.renderRequirements(material.room, material.bundle).textContent.includes('数量 ×99'));
const copied = boot(JSON.stringify(A.state));
assert.equal(copied.collections.summary('茶水间', '高品质作物收集包').complete, true, 'Records survive the core local-state round trip');
assert.equal(copied.collections.isSubmitted('工艺室', '建筑收集包', 1), false);
assert.equal(C.toggle(material.room, material.bundle, 999), false);
assert.equal(C.toggle(material.room, material.bundle, -1), false);
assert.equal(C.toggle(material.room, material.bundle, 1.5), false);

assert.equal(C.summary(gold.room, gold.bundle).required, 1, 'A gold bundle is one whole payment');
assert.equal(C.toggle(gold.room, gold.bundle, 0, true), true);
assert.equal(C.summary(gold.room, gold.bundle).complete, true);
rendered = C.renderRequirements(gold.room, gold.bundle);
assert(rendered.textContent.includes('2,500 金'));
assert.equal(nodes(rendered, 'collection-payment').length, 1);
assert.equal(nodes(rendered, 'collection-requirement').length, 0, 'Gold is not fabricated as a material');
assert.equal(C.toggle(gold.room, gold.bundle, 1, true), false);

const undo = C.resetBundle(quality.room, quality.bundle);
assert.equal(q().submitted, 0);
assert.equal(q().complete, false);
assert.equal(typeof undo, 'function');
assert(C.renderRequirements(quality.room, quality.bundle).textContent.includes('撤销清除'));
assert.equal(undo(), true);
assert.equal(q().submitted, 3);
assert.equal(undo(), false, 'Undo is valid only once');
const staleUndo = C.resetBundle(quality.room, quality.bundle);
C.toggle(quality.room, quality.bundle, 2, true);
assert.equal(staleUndo(), false, 'Undo must never overwrite records made after clearing');
assert.equal(q().submitted, 1);
assert.equal(C.summary(material.room, material.bundle).submitted, 1, 'Clearing one bundle does not clear another');

const privateBundle = value(A, '废弃Joja超市:失踪的收集包');
rendered = C.renderRequirements(privateBundle.room, privateBundle.bundle);
for (const secret of ['失踪', 'Joja', '虚空鲑鱼', '电影院', 'Void_Salmon']) assert(!exposure(rendered).includes(secret), `Protected bundle leaked ${secret}`);
const fishBundle = value(A, '鱼缸:特色鱼类收集包');
rendered = C.renderRequirements(fishBundle.room, fishBundle.bundle);
nodes(rendered, 'collection-recording')[0].dispatch('click');
assert(nodes(rendered, 'collection-concealed').length > 0, 'The renderer must preserve protected ingredients');
for (const item of fishBundle.bundle.items) {
  const it = A.itemInfo(item.id || item.zh), ref = it.id ? { type: 'item', id: it.id } : { type: 'page', id: it.z };
  if (!A.spoilers.canView(ref)) {
    assert(!exposure(rendered).includes(it.z), 'A protected material name must not reach text, accessibility labels, or attributes');
    if (it.i) assert(!exposure(rendered).includes(encodeURIComponent(it.i)), 'A protected material must not load its icon');
  }
}
assert(!rendered.textContent.includes('秘密森林') && !rendered.textContent.includes('沙漠'), 'Acquisition hints cannot reveal protected places');
for (const row of nodes(rendered, 'collection-requirement').filter(row => nodes(row, 'collection-concealed').length)) {
  assert.equal(row.children[0].children[0].disabled, true, 'A concealed item cannot accidentally be marked submitted');
}
assert(!rendered.textContent.includes('海之菜肴'), 'Requirement rendering never includes a completion reward');
A.spoilers.setEnabled(false);
assert.equal(nodes(C.renderRequirements(fishBundle.room, fishBundle.bundle), 'collection-concealed').length, 0);

const broken = JSON.parse(JSON.stringify(A.state));
broken.collections = { '工艺室:建筑收集包': { items: [0, 0, -1, '1', 999], paid: true } };
const fixed = boot(JSON.stringify(broken));
assert.equal(fixed.collections.summary('工艺室', '建筑收集包').submitted, 1, 'Invalid and duplicated saved indices are ignored');
const legacy = JSON.parse(JSON.stringify(A.state)); delete legacy.collections;
assert.equal(boot(JSON.stringify(legacy)).collections.summary('茶水间', '高品质作物收集包').started, false);
const browseRows = A.browse.records('bundles').filter(row => row.ref.type === 'bundle');
const browseNodes = A.browseViews.render('bundles', browseRows);
assert(browseNodes.some(node => nodes(node, 'bundle-progress').length > 0), 'Browse cards expose lightweight submitted/required progress');
console.log('Collection checks passed: independent manual records, choose limits, quantities/quality, duplicate slots, gold, local round trip, reversible clearing, and spoiler-safe rendering.');
