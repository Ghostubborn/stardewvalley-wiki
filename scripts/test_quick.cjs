// 我的速查：卡片取数、季节筛选、速查表、分享链接编解码与防剧透（不需要浏览器）。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '../prototype');
function boot(saved) {
  const ctx = { window: {}, structuredClone, setTimeout: () => 0, clearTimeout() {}, localStorage: { getItem: () => saved || null },
    location: { origin: 'http://localhost', pathname: '/', search: '' }, history: { replaceState() {} } };
  vm.createContext(ctx);
  for (const file of ['data.js', 'js/i18n.js', 'js/core.js', 'js/tree.js', 'js/spoilers.js', 'js/map-content.js', 'js/browse.js', 'js/relations.js', 'js/quick.js'])
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  ctx.window.App.toast = () => {};
  return ctx.window.App;
}
const A = boot(), Q = A.quick.model;
const fact = (card, label) => card.facts.find(f => f.label === label);

// 居民：生日、住处、最爱；这个人特有的最爱排在人人都爱的通用礼物前面，后期物品不出现。
const penny = Q.card({ type: 'villager', id: '潘妮' });
assert.equal(penny.kind, 'villager');
assert.equal(fact(penny, '生日').text, '秋季 2 日');
assert.equal(fact(penny, '住处').text, '拖车');
const loves = penny.items.list.map(x => x.id);
assert(loves.length === 6 && loves.every(id => A.spoilers.canView({ type: 'item', id })), 'Villager loves must be visible items');
const favourites = A.villagerByName.get('潘妮').fav.filter(id => A.spoilers.canView({ type: 'item', id }));
assert.deepEqual(loves.slice(0, 3), favourites.slice(0, 3), 'The infobox favourites should come first');
const abby = Q.card({ type: 'villager', id: '阿比盖尔' }).items.list.map(x => x.id), fans = id => A.giftsByItem.get(id).love.length;
const extra = abby.filter(id => !A.villagerByName.get('阿比盖尔').fav.includes(id));
assert(extra.every((id, i) => i === 0 || fans(extra[i - 1]) <= fans(id)), 'Other loves go from personal to universal');

// 鱼：季节只按看得到的水域算（鲶鱼在收起的秘密森林全年可钓，不能因此显示成四季）。
const catfish = Q.card({ type: 'fish', id: '鲶鱼' });
assert.deepEqual([...fact(catfish, '季节').seasons], ['spring', 'fall', 'winter']);
assert.equal(fact(catfish, '天气').text, '雨天');
assert(!/秘密森林|巫婆沼泽/.test(fact(catfish, '水域').text), 'Protected waters leaked into a fish card');
assert(!/鹈鹕镇、/.test(fact(Q.card({ type: 'fish', id: '太阳鱼' }), '水域').text + '、'), 'A general place name duplicates its river');
assert.match(fact(Q.card({ type: 'fish', id: '午夜鱿鱼' }), '水域').text, /夜市钓鱼潜艇/);
assert.match(fact(catfish, '特殊条件').text, /冬季需特殊方式制造降雨/);
assert.equal(Q.card({ type: 'item', id: A.itemInfo('鲶鱼').id }).kind, 'fish', 'Legacy item pins of fish must use fish facts');

// 作物：种子和收获物都显示成作物卡。
const strawberrySeed = Q.card({ type: 'item', id: A.itemInfo('草莓种子').id });
assert.equal(strawberrySeed.kind, 'crop');
assert.equal(fact(strawberrySeed, '生长').text, '8 天成熟，之后每 4 天再收获');
assert.equal(fact(strawberrySeed, '最晚播种').text, '春 20 日');
assert.equal(fact(strawberrySeed, '收获').text, '草莓');
const parsnip = Q.card({ type: 'item', id: '(O)24' });
assert.equal(parsnip.kind, 'crop');
assert.equal(fact(parsnip, '种子').text, '防风草种子');

// 商店、物品、升级、收集包。
const pierre = Q.card({ type: 'location', id: '皮埃尔的杂货店' });
assert.equal(pierre.kind, 'place');
assert.match(fact(pierre, '开放时间').text, /09:00/);
assert.equal(fact(pierre, '休息').text, '周三休息；推进游戏后可能调整，详见条目');
assert.equal(fact(pierre, '休息').conditional, true);
// 一周七格的数据：范围写法展开成每一天；信息框漏填时按正文（木匠的商店周二休息，周五只是 16:00 后不营业）。
assert.deepEqual([...fact(Q.card({ type: 'location', id: '旅行货车' }), '休息').week], [1, 2, 3, 4, 6]);
const carpenter = fact(Q.card({ type: 'location', id: '木匠的商店' }), '休息');
assert.deepEqual([...carpenter.week], [2]);
assert.match(carpenter.text, /周二/);
assert.equal(fact(Q.card({ type: 'location', id: '鱼店' }), '休息').conditional, true, 'Closed only on non-rainy Saturdays is a conditional day off');
assert.equal(fact(Q.card({ type: 'location', id: '玛妮的牧场' }), '休息').conditional, false);
assert.equal(A.shopCheck(A.locationByName.get('木匠的商店')).ok, null, 'Reference mode must not claim a shop is open');
const wood = Q.card({ type: 'item', id: '(O)388' });
assert.equal(fact(wood, '收集包').text, '建筑收集包×198', 'Two Wood slots in one bundle should be added up');
assert.match(fact(wood, '用途').text, /可用于 \d+ 个配方/);
const axe = Q.card({ type: 'node', id: 'tool:斧头:1' });
assert.equal(axe.kind, 'upgrade');
assert.equal(fact(axe, '花费').text, '2,000 金');
const bundle = Q.card({ type: 'bundle', id: '茶水间:高品质作物收集包' });
assert.equal(fact(bundle, '要求').text, '从 4 项中选 3 项');
assert(bundle.items.list.every(x => x.quality === 'gold' && x.qty === 5));
const coop = Q.card({ type: 'page', id: '鸡舍' });
assert.equal(coop.kind, 'upgrade');
assert(coop.items.list.some(m => m.id === '(O)388' && m.qty === 300), 'Coop card must show construction materials');
assert.equal(fact(coop, '花费').text, '4,000 金');
assert.equal(fact(coop, '工期').text, '建造 3 天');

// 防剧透：受保护的条目只给锁住的卡片，不带名称和资料。
const krobus = Q.card({ type: 'villager', id: '科罗布斯' });
assert.equal(krobus.locked, true);
assert.equal(krobus.name, undefined);
assert.equal(krobus.facts, undefined);

// 季节筛选：只影响居民生日、鱼和作物；其他条目一直显示。
assert.equal(Q.inSeason({ type: 'villager', id: '潘妮' }, 'spring'), false);
assert.equal(Q.inSeason({ type: 'villager', id: '潘妮' }, 'fall'), true);
assert.equal(Q.inSeason({ type: 'item', id: '(O)24' }, 'summer'), false);
assert.equal(Q.inSeason({ type: 'item', id: '(O)388' }, 'summer'), true);
assert.equal(Q.inSeason({ type: 'location', id: '皮埃尔的杂货店' }, 'winter'), true);
assert.equal(Q.inSeason({ type: 'fish', id: '沙丁鱼' }, 'summer'), false);

// 速查表：生日日历按季节排，被收起的居民只计数；钓鱼表只列看得到钓点的鱼。
const allBirthdays = Q.birthdays('all');
assert.equal(allBirthdays.calendars.length, 4);
const listed = allBirthdays.calendars.flatMap(c => [...c.days.values()].flat());
assert(listed.every(v => A.spoilers.canView({ type: 'villager', id: v.p })));
assert(!listed.some(v => v.p === '科罗布斯') && allBirthdays.hidden > 0);
assert.equal(Q.birthdays('spring').calendars.length, 1);
assert(Q.birthdays('fall').calendars[0].days.get(2).some(v => v.p === '潘妮'));
const shops = Q.shops();
assert(shops.rows.some(r => r.ref.id === '皮埃尔的杂货店') && shops.rows.every(r => A.spoilers.canView(r.ref)));
const spring = Q.fish('spring');
assert(spring.rows.length > 10 && spring.rows.every(r => r.seasons.includes('spring') || r.seasons.includes('all')));
assert(spring.rows.every(r => r.waters && r.waters !== '水域见详情'), 'Fishing table lists a fish with no visible water');
assert(!spring.rows.some(r => r.ref.id === '冰柱鱼'), 'A fish only found in a protected area was listed');
assert(Q.fish('all').rows.length > spring.rows.length);

// 分享链接：编码后能原样解出；不存在的条目、未知类型和速查表名被丢掉；最多 30 个。
const pins = [{ type: 'villager', id: '潘妮' }, { type: 'item', id: '(O)388' }, { type: 'bundle', id: '茶水间:高品质作物收集包' }, { type: 'node', id: 'tool:斧头:1' }];
const encoded = Q.encode(pins, ['birthdays', 'fish', 'nope']);
assert.equal(encoded.sheets, 'birthdays.fish');
assert.deepEqual(JSON.parse(JSON.stringify(Q.decode(encoded.pins, encoded.sheets))), { pins, sheets: ['birthdays', 'fish'] });
const filtered = Q.encode(pins, ['fish'], 'fall');
assert.equal(Q.decode(filtered.pins, filtered.sheets, filtered.qs).season, 'fall', 'Shares preserve the selected season');
assert.deepEqual(JSON.parse(JSON.stringify(Q.decode('v.%E4%B8%8D%E5%AD%98%E5%9C%A8,x.foo,i.(O)388,i.(O)388,bad', 'shops.zzz'))),
  { pins: [{ type: 'item', id: '(O)388' }], sheets: ['shops'] });
const many = A.D.villagers.map(v => ({ type: 'villager', id: v.p }));
assert.equal(Q.decode(Q.encode(many, []).pins, '').pins.length, A.quick.LIMIT);

// 钉选：沿用原来的收藏（state.plan），上限 30；刷新后保留速查表和季节选择。
A.quick.toggle({ type: 'fish', id: '鲶鱼' });
assert.equal(A.quick.pinned({ type: 'fish', id: '鲶鱼' }), true);
A.quick.toggle({ type: 'fish', id: '鲶鱼' });
assert.equal(A.quick.pinned({ type: 'fish', id: '鲶鱼' }), false);
A.state.plan = many.slice(0, A.quick.LIMIT);
assert.equal(A.quick.toggle({ type: 'item', id: '(O)388' }), false, 'Pinning beyond the limit must be refused');
assert.equal(A.state.plan.length, A.quick.LIMIT);
A.state.plan = [{ type: 'item', id: '(O)388' }];
A.quick.toggleSheet('shops'); A.quick.toggleSheet('birthdays'); A.quick.setSeason('summer');
assert.deepEqual([...Q.sheets()], ['birthdays', 'shops'], 'Tables keep a fixed order');
const restored = boot(JSON.stringify(A.state));
assert.deepEqual([...restored.quick.model.sheets()], ['birthdays', 'shops']);
assert.equal(restored.quick.model.season(), 'summer');
assert.equal(restored.state.plan[0].id, '(O)388');

// 分享的内容只看不存，加入时与自己的合并、去重。
A.quick.setShared(Q.decode(Q.encode([{ type: 'item', id: '(O)388' }, { type: 'fish', id: '沙丁鱼' }], ['fish']).pins, 'fish'));
assert(A.quick.shared && A.state.plan.length === 1);
assert.equal(Q.season(), 'all', 'An unfiltered share must not inherit the visitor’s own filter');
A.quick.setSeason('winter');
assert.equal(A.state.quickSeason, 'summer', 'Viewing a share must not overwrite the visitor’s own season');
A.quick.adoptShared();
assert.equal(A.quick.shared, null);
assert.deepEqual(A.state.plan.map(r => r.id), ['(O)388', '沙丁鱼']);
assert.deepEqual([...Q.sheets()], ['birthdays', 'shops', 'fish']);
assert.equal(A.state.quickSeason, 'winter', 'Saving a share also saves the chosen season');
console.log('Quick sheet checks passed: cards per kind, visible-only seasons and waters, season filter, tables, share links, pin limit and spoiler-safe locked cards.');
