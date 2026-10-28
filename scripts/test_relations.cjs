// Run with node scripts/test_relations.cjs. Checks the relation graph data (prototype/js/relations.js)
// against the indexes the list view uses: every recipe that uses an item, every bundle and gift, every
// way to make it shows up in its graph; long groups of flavoured products collapse into one entry;
// crafting chains reach raw materials with the right totals; villagers, places, monsters and animals
// get their groups; and every node points at an entry that exists.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'prototype');
const ctx = { window: {}, structuredClone, setTimeout: () => 0, clearTimeout() {}, localStorage: { getItem: () => null } };
vm.createContext(ctx);
for (const file of ['data.js', 'js/i18n.js', 'js/core.js', 'js/tree.js', 'js/spoilers.js', 'js/map-content.js', 'js/browse.js', 'js/relations.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const A = ctx.window.App, D = A.D;
const id = zh => Object.entries(D.items).find(([, it]) => it.z === zh)[0];
const group = (rel, side, label) => rel[side].groups.find(g => g.label === label);
// Values from the VM context have their own Array/Object prototypes; copy them before deep comparisons.
const plain = x => JSON.parse(JSON.stringify(x));
const labels = g => plain(g.nodes.map(n => n.label));
// Flavour families collapse several products into one node; count their members.
const members = nodes => nodes.flatMap(n => n.family || [n]);

// Dandelion: wiki sources on the left; recipes by kind and machine, bundle and gifts on the right.
const dandelion = A.relations({ type: 'item', id: id('蒲公英') });
assert.deepEqual(labels(group(dandelion, 'left', 'Wiki 列出的来源')), ['采集', '春季种子', '花舞节']);
assert.deepEqual(plain(group(dandelion, 'left', 'Wiki 列出的来源').nodes.map(n => n.ref?.type)), ['page', 'item', 'page'], 'sources that name an entry can be opened');
assert.deepEqual(plain(dandelion.right.groups.map(g => [g.label, g.via || '', labels(g).join('、')])), [
  ['打造', '', '春季种子'], ['烹饪', '', '沙拉'], ['裁缝', '缝纫机', '薄荷女式衬衫'], ['加工', '罐头瓶', '腌制蒲公英'],
  ['收集包', '', '春季采集收集包'], ['喜欢这件礼物', '', '潘妮、莉亚、哈维、皮埃尔、莱纳斯'],
]);

// Every item: the graph lists exactly what the list view lists (uses, bundles, gifts, ways to make it).
let graphs = 0;
for (const itemId of Object.keys(D.items)) {
  const rel = A.relations({ type: 'item', id: itemId });
  const uses = A.usedIn.get(itemId) || [], bundles = A.bundleUse.get(itemId) || [], gifts = A.giftsByItem.get(itemId);
  const paths = A.acquisitions(itemId, D.items[itemId].z);
  if (!rel) {
    assert(!uses.length && !bundles.length && !gifts && !paths.length, `${itemId} has relations but no graph`);
    continue;
  }
  graphs++;
  const used = rel.right.groups.filter(g => ['crafting', 'cooking', 'processing', 'tailoring'].includes(g.kind));
  const outputs = new Set(uses.map(r => r.out.id || 'zh:' + r.out.z));
  assert.equal(used.reduce((n, g) => n + members(g.nodes).length, 0), outputs.size, `${itemId}: every product it is used in`);
  assert.equal(group(rel, 'right', '收集包')?.nodes.length || 0, bundles.length, `${itemId}: every bundle`);
  assert.equal(group(rel, 'right', '最爱这件礼物')?.nodes.length || 0, gifts?.love.length || 0, `${itemId}: villagers who love it`);
  assert.equal(group(rel, 'right', '喜欢这件礼物')?.nodes.length || 0, gifts?.like.length || 0, `${itemId}: villagers who like it`);
  for (const p of paths.filter(p => ['crafting', 'cooking', 'processing'].includes(p.kind))) {
    assert(rel.left.groups.some(g => g.kind === p.kind && g.nodes.length === p.inputs.length), `${itemId}: recipe inputs for ${p.kind}`);
  }
  const shops = paths.filter(p => p.kind === 'buy').length;
  assert.equal(group(rel, 'left', '购买')?.nodes.length || 0, shops, `${itemId}: every shop`);
  for (const g of [...rel.left.groups, ...rel.right.groups]) assert(g.nodes.length, `${itemId}: empty group ${g.label}`);
}
assert(graphs > 2700, `most items have a graph (${graphs})`);

// Coal: 71 smoked fish collapse into one entry named after the machine's generic product.
const coal = A.relations({ type: 'item', id: id('煤炭') });
const smoker = coal.right.groups.find(g => g.via === '熏鱼机');
assert.equal(smoker.nodes.length, 1);
assert.equal(smoker.nodes[0].label, '熏鱼');
assert.equal(smoker.nodes[0].note, '71 种');
assert.equal(smoker.nodes[0].family.length, 72, 'opening the entry lists the generic product and the 71 flavours');
assert.deepEqual(plain(coal.right.groups.map(g => g.via || g.label)), ['打造', '熔炉', '熏鱼机', '缝纫机']);

// Iridium sprinkler: the chain goes down to ore with totals, and names the other way to make gold bars.
const sprinkler = A.relations({ type: 'item', id: id('铱制洒水器') });
const craft = sprinkler.left.groups.find(g => g.kind === 'crafting');
assert.equal(craft.note, '耕种 9 级');
const chain = A.relationChain(craft.chain);
assert(chain.deep);
assert.deepEqual(plain(Object.fromEntries(chain.totals.map(x => [x.z, x.qty]))), { 黄金矿石: 5, 煤炭: 2, 铱矿石: 5, 电池组: 1 });
assert.deepEqual(plain(chain.tree.find(n => n.z === '金锭').alt), ['打造（铁锭×2）']);
assert.equal(chain.tree.find(n => n.z === '金锭').via, '熔炉');
// Copper axe: the blacksmith upgrade names the previous tool.
assert.deepEqual(labels(A.relations({ type: 'item', id: id('铜斧头') }).left.groups[0]), ['斧头', '铜锭']);

// Fish: fishing waters with seasons on the left.
const catfish = A.relations({ type: 'fish', id: '鲶鱼' });
assert.deepEqual(plain(catfish.left.groups[0].nodes.map(n => [n.label, n.note])), [
  ['鹈鹕镇河流', '春季、秋季、冬季'], ['煤矿森林河流', '春季、秋季、冬季'], ['秘密森林', '春季、夏季、秋季、冬季'], ['巫婆沼泽', '春季、夏季、秋季、冬季'],
]);
assert.deepEqual(plain(catfish.left.groups[0].nodes.map(n => n.ref?.id)), ['鹈鹕镇', '煤矿森林', '秘密森林', '巫婆沼泽'], 'river waters open their place');

// Villager: home, family and schedule places (no people) on the left; every loved and liked gift on the right.
const penny = A.relations({ type: 'villager', id: '潘妮' }), pv = A.villagerByName.get('潘妮');
assert.deepEqual(labels(group(penny, 'left', '住处')), ['拖车']);
assert.deepEqual(labels(group(penny, 'left', '家人')), ['潘姆']);
assert(group(penny, 'left', '日程里会去').nodes.every(n => !A.villagerByName.has(n.ref.id)), 'schedule places are places, not people');
assert.equal(group(penny, 'right', '最爱的礼物').nodes.length, pv.love.length);
assert.equal(group(penny, 'right', '喜欢的礼物').nodes.length, pv.like.length);
// Villagers who run a shop list its stock.
assert(group(A.relations({ type: 'villager', id: '科罗布斯' }), 'right', '出售'));

// Places: residents, stock, fish (including the river named after the place) and monsters.
const pierre = A.relations({ type: 'location', id: '皮埃尔的杂货店' });
assert.deepEqual(labels(group(pierre, 'left', '住在这里')), ['皮埃尔', '卡洛琳', '阿比盖尔']);
assert.equal(group(pierre, 'right', '出售').nodes.length, D.shops.find(s => s.p === '皮埃尔的杂货店').stock.length);
const town = A.relations({ type: 'page', id: '鹈鹕镇' });
assert.equal(group(town, 'right', '能钓到的鱼').nodes.length, D.fish.filter(f => f.L.some(l => l === '鹈鹕镇' || l === '鹈鹕镇河流')).length);
assert(group(A.relations({ type: 'location', id: '矿井' }), 'right', '出没的怪物').nodes.length > 10);

// Monsters and animals.
const slime = A.relations({ type: 'page', id: '史莱姆（怪物）' });
assert.deepEqual(labels(group(slime, 'left', '出没地点')), ['矿井', '骷髅洞穴', '采石场矿井', '秘密森林', '火山地牢', '姜岛']);
assert.deepEqual(labels(group(slime, 'right', '到达过矿井底部后')), ['钻石', '五彩碎片']);
const sheep = A.relations({ type: 'page', id: '绵羊' });
assert.deepEqual(plain(sheep.left.groups.map(g => g.label)), ['居住建筑', '购买']);
assert.deepEqual(labels(sheep.right.groups[0]), ['动物毛']);

// Buildings: builder with cost and days, materials (an expandable chain), tiers both ways, animals by tier,
// machines; items list the buildings they are used for, and animals open the building tier they live in.
const coop = A.relations({ type: 'page', id: '鸡舍' });
assert.deepEqual(plain(coop.left.groups.map(g => g.label)), ['建造', '建造材料']);
assert.deepEqual(plain([coop.left.groups[0].nodes[0].label, coop.left.groups[0].nodes[0].note]), ['木匠的商店', '4,000 金；建造 3 天']);
assert.deepEqual(plain(group(coop, 'right', '升级为').nodes.map(n => [n.label, n.ref])), [['大鸡舍', { type: 'node', id: 'bld:鸡舍:1' }]]);
const bigCoop = A.relations({ type: 'node', id: 'bld:鸡舍:1' });
assert.deepEqual(labels(group(bigCoop, 'left', '升级前')), ['鸡舍']);
assert.deepEqual(labels(group(bigCoop, 'right', '可以养')), ['鸡', '虚空鸡', '鸭', '恐龙', '金色的鸡']);
assert.deepEqual(labels(group(A.relations({ type: 'page', id: '磨坊' }), 'right', '加工')), ['大麦粉', '糖', '大米']);
assert(A.relationChain(group(A.relations({ type: 'page', id: '史莱姆屋' }), 'left', '建造材料').chain).deep, 'building materials expand into a chain');
assert.deepEqual(labels(group(A.relations({ type: 'page', id: '温室' }), 'left', '建造')), ['完成茶水间收集包', '在Joja社区发展申请书中花35,000金购入']);
assert.deepEqual(labels(group(A.relations({ type: 'node', id: 'bld:农舍:0' }), 'left', '开局就有')), ['游戏开始时就有的农舍。']);
for (const b of D.buildings) assert(A.relations(A.buildingRef(b.name)), `${b.name}: graph`);
const woodBuilds = group(A.relations({ type: 'item', id: id('木材') }), 'right', '用于建造');
assert.equal(woodBuilds.nodes.length, D.buildings.filter(b => b.materials.some(m => m.id === id('木材'))).length);
assert(woodBuilds.nodes.some(n => n.label === '鸡舍' && n.note === '用 300 个'));
assert.deepEqual(plain(group(A.relations({ type: 'page', id: '鸭' }), 'left', '居住建筑').nodes[0].ref), { type: 'node', id: 'bld:鸡舍:1' });

// The Wizard's Tower builds the magic buildings instantly once the Magic Ink is back; walnut buildings are built on the island.
const earth = group(A.relations({ type: 'page', id: '土之图腾柱' }), 'left', '建造');
assert.deepEqual(plain([earth.note, earth.nodes[0].label, earth.nodes[0].note]), ['取回魔法墨水后开放', '法师塔', '500,000 金；立即建成']);
assert.deepEqual(plain(D.buildings.filter(b => b.sold_by === '法师塔').map(b => b.name).sort()), ['黄金时钟', '祝尼魔屋', '土之图腾柱', '水之图腾柱', '沙漠图腾柱', '姜岛图腾柱'].sort());
assert.equal(group(A.relations({ type: 'page', id: '农场图腾柱' }), 'left', '建造').nodes[0].label, '姜岛');

// Fish ponds (the produce table on the Fish Pond page): every row resolves to an item; each fish lists its produce with
// population and chance (roe becomes the fish's own roe); products list the fish; the pond lists fish and products.
const pondRows = D.fish.flatMap(f => f.pond || []);
assert(pondRows.length > 200 && pondRows.every(x => x.id && D.items[x.id]), 'every pond product is a known item');
const stingray = group(A.relations({ type: 'fish', id: '黄貂鱼' }), 'right', '鱼塘产出');
assert.deepEqual(plain(stingray.nodes.map(n => [n.label, n.note])), [
  ['黄貂鱼籽', '1 条起 · 80-100%'], ['熔岩菇', '4 条起 · 5%'], ['火山晶石', '×2-5 · 7 条起 · 8-10%'], ['龙牙', '9 条起 · 5%'], ['电池组', '9 条起 · 10%'],
]);
const battery = A.relations({ type: 'item', id: id('电池组') });
assert.deepEqual(plain(group(battery, 'left', '鱼塘产出').nodes.map(n => [n.label, n.ref.type, n.note])), [['黄貂鱼', 'fish', '9 条起 · 10%']]);
assert(!JSON.stringify(plain(battery.left.groups.filter(g => g.kind === 'source'))).includes('鱼塘'), 'wiki source lines about ponds are not repeated');
assert(!JSON.stringify(plain(A.relations({ type: 'item', id: id('鱿鱼墨汁') }).left.groups.filter(g => g.kind === 'source'))).includes('鱼塘'));
const pondBuilding = A.relations({ type: 'page', id: '鱼塘' });
assert.equal(group(pondBuilding, 'right', '可以养的鱼').nodes.length, D.fish.filter(f => f.pond?.length).length);
assert(group(pondBuilding, 'right', '产出').nodes.some(n => n.label === '鱼籽' && /种鱼$/.test(n.note)), 'all roe collapses into one product');

// Entries without relations get no graph; occupants' portraits are marked so the view can hide protected ones.
assert.equal(A.relations({ type: 'page', id: '新手指南' }), null);
assert.deepEqual(plain(A.relations({ type: 'location', id: '拖车' }).center.iconRef), { type: 'villager', id: '潘姆' });

// Every node opens an entry that exists.
const exists = ref => ref.type === 'item' ? !!D.items[ref.id] : ref.type === 'fish' ? A.fishByName.has(ref.id)
  : ref.type === 'villager' ? A.villagerByName.has(ref.id) : ref.type === 'location' ? A.locationByName.has(ref.id)
  : ref.type === 'bundle' ? !!A.browse.bundle(ref.id) : ref.type === 'node' ? A.progression.nodes.has(ref.id) : !!D.pages[ref.id];
const refs = [
  ...[...A.progression.nodes.keys()].map(x => ({ type: 'node', id: x })),
  ...Object.keys(D.items).map(x => ({ type: 'item', id: x })), ...D.fish.map(f => ({ type: 'fish', id: f.p })),
  ...D.villagers.map(v => ({ type: 'villager', id: v.p })), ...D.locations.map(l => ({ type: 'location', id: l.p })),
  ...Object.keys(D.pages).map(title => ({ type: 'page', id: title })),
];
let nodes = 0, withGraph = { villager: 0, location: 0, page: 0, node: 0 };
for (const ref of refs) {
  const rel = A.relations(ref);
  if (!rel) continue;
  if (ref.type in withGraph) withGraph[ref.type]++;
  for (const n of [...rel.left.groups, ...rel.right.groups].flatMap(g => members(g.nodes))) {
    nodes++;
    if (n.ref) assert(exists(n.ref), `${ref.type}:${ref.id} links to a missing entry ${JSON.stringify(n.ref)}`);
  }
}
// Every villager with gifts, family, a home or a shop on record has a graph (Grandpa and a few others have none).
for (const v of D.villagers) {
  const any = v.love.length || v.like.length || v.fam?.length || D.locations.some(l => (l.occ || []).includes(v.p)) || D.shops.some(x => x.p === v.p);
  if (any) assert(A.relations({ type: 'villager', id: v.p }), `${v.p} has relations but no graph`);
}
console.log(`Relation graph checks passed: ${graphs} item graphs, ${withGraph.villager} villagers, ${withGraph.location} locations, ${withGraph.node} building steps, ${withGraph.page} other entries, ${nodes} nodes; uses, bundles, gifts, recipes, shops and buildings match the list view; flavour families, crafting chains and node targets.`);
