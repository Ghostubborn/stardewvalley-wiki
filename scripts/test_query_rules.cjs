// Run with node scripts/test_query_rules.cjs. Uses the actual packed Wiki snapshot.
// These cases check user-visible conclusions, including disagreeing entry points.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'prototype');
const ctx = { window: {}, structuredClone, setTimeout: () => 0, clearTimeout() {}, localStorage: { getItem: () => null } };
vm.createContext(ctx);
for (const file of ['data.js', 'js/i18n.js', 'js/core.js', 'js/tree.js', 'js/spoilers.js', 'js/map-content.js', 'js/browse.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const A = ctx.window.App, fish = name => A.fishByName.get(name);
const paths = name => { const item = A.itemInfo(name); return A.acquisitions(item.id, item.z); };
const reset = cond => { A.applyPreset('fresh'); A.setCond({ season: 'spring', day: 10, weather: 'rain', time: 1200, ...cond }); };

reset();
const catfish = fish('鲶鱼');
assert.equal(A.fishCheck(catfish).ok, true, 'ordinary river is a valid route before late regions unlock');
assert.equal(A.fishCheck(catfish, { location: '煤矿森林河流' }).ok, true);
assert.equal(A.mapContents.fishStatus(catfish, [138, 165, 'valley']).ok, true, 'map and detail agree for the same water');
assert.equal(A.browse.records('fish').find(r => r.label === '鲶鱼').matchNow, true);
A.setCond({ season: 'summer', weather: 'rain' });
assert.equal(A.fishCheck(catfish, { location: '煤矿森林河流' }).ok, false, 'summer must not leak from the forest pond into rivers');
A.setProgress(p => { p.tools.斧头 = 2; });
assert.equal(A.fishCheck(catfish, { location: '秘密森林' }).ok, true);
assert.equal(A.mapContents.fishStatus(catfish, [20, 110, 'valley']).ok, true);
const summerCatfishRow = A.browse.records('fish').find(r => r.label === '鲶鱼');
assert.equal(summerCatfishRow.matchNow, true);
assert.equal(A.browse.matchesFilters('fish', summerCatfishRow, { now: true, location: '煤矿森林河流' }), false, 'the UI must not reuse a forest-pond success when filtering a summer river');
assert.equal(A.browse.matchesFilters('fish', summerCatfishRow, { now: true, location: '秘密森林' }), true);
A.setCond({ season: 'winter', weather: 'snow' });
assert.equal(A.fishCheck(catfish, { location: '秘密森林', rainTotem: true }).ok, true);

reset({ season: 'spring', weather: 'sun' });
const tuna = fish('金枪鱼');
assert.equal(A.fishCheck(tuna, { location: '沙滩' }).ok, false, 'mainland tuna is summer/winter only');
assert.equal(A.mapContents.fishStatus(tuna, [285, 210, 'valley']).ok, false);
assert.equal(A.fishCheck(tuna).ok, false, 'an inaccessible island is not an available alternative');
A.setProgress(p => { p.flags.boat_repaired = true; p.rooms = [...A.ROOMS]; });
assert.equal(A.fishCheck(tuna, { location: '姜岛' }).ok, true, 'island tuna is independent of mainland season');
assert.equal(A.fishCheck(tuna).ok, true);
assert.equal(A.mapContents.fishStatus(tuna, [285, 210, 'valley']).ok, false, 'global availability does not change mainland water');
const springTunaRow = A.browse.records('fish').find(r => r.label === '金枪鱼');
assert.equal(springTunaRow.matchNow, true);
assert.equal(A.browse.matchesFilters('fish', springTunaRow, { now: true, location: '沙滩' }), false, 'island availability must not pass the UI mainland current-condition filter');
assert.equal(A.browse.matchesFilters('fish', springTunaRow, { now: true, location: '姜岛' }), true);
assert.equal(A.browse.matchesFilters('fish', springTunaRow, { season: 'spring', location: '沙滩' }), false, 'the UI season filter must use the selected water, including when current-condition filtering is off');
assert.equal(A.browse.matchesFilters('fish', springTunaRow, { season: 'spring', location: '姜岛' }), true);
assert.equal(A.browse.matchesFilters('fish', springTunaRow, { season: 'summer', location: '沙滩' }), true);
reset({ season: 'summer', weather: 'sun' });
assert.equal(A.fishCheck(tuna).ok, true);
assert.equal(A.browse.records('fish').find(r => r.label === '金枪鱼').matchNow, true);

reset({ season: 'winter', weather: 'sun' });
assert.equal(A.fishCheck(fish('鲤鱼'), { location: '深山' }).ok, false);
A.setProgress(p => { p.tools.斧头 = 2; });
assert.equal(A.fishCheck(fish('鲤鱼'), { location: '秘密森林' }).ok, true);
reset({ season: 'summer', weather: 'sun' });
const crimson = fish('绯红鱼');
assert.equal(A.fishCheck(crimson).ok, false, 'fishing level is a real legendary requirement');
A.setProgress(p => { p.skills.fishing = 5; });
assert.equal(A.fishCheck(crimson).ok, null, 'unknown cast position and catch history cannot become a positive conclusion');
assert.equal(A.fishCheck(crimson, { positionConfirmed: { [crimson.id]: true }, caught: { [crimson.id]: false } }).ok, true);
assert.equal(A.fishCheck(crimson, { positionConfirmed: { [crimson.id]: true }, caught: { [crimson.id]: true } }).ok, false);
reset({ weather: 'sun' });
A.setProgress(p => { p.rooms = ['金库']; });
assert.equal(A.fishCheck(fish('蝎鲤鱼')).ok, false, 'scorpion carp has a fishing-level requirement too');

for (const name of ['珊瑚', '海胆', '彩虹贝壳', '鹦鹉螺']) {
  assert.equal(A.fishMethod(fish(name)), 'forage');
  assert.notEqual(A.fishCheck(fish(name)).ok, true);
  const row = A.browse.records('fish').find(r => r.label === name);
  if (row) assert.equal(row.type, 'forage');
}
assert.equal(A.fishCheck(fish('螃蟹')).crab, true);
assert.equal(A.fishCheck(fish('螃蟹')).ok, null, 'crab-pot prerequisites remain separate from rod conditions');
reset();
assert.equal(A.fishCheck(fish('石鱼')).ok, false, 'reaching the mine entrance is not reaching floor 20');
A.setProgress(p => { p.mineDepth = 20; });
assert.equal(A.fishCheck(fish('石鱼')).ok, true);

reset({ weather: 'sun', day: 12, time: 1830 });
assert.equal(paths('木材').find(p => p.kind === 'buy').ok, false, 'wood purchase must agree with closed carpenter shop');
assert(paths('木材').some(p => p.kind === 'gather' && p.note.includes('斧头')), 'cutting trees is a first-class ordinary source');
assert(paths('石头').some(p => p.kind === 'gather'));
assert(A.materialTree([{ id: '(O)388', z: '木材', q: 10 }])[0].source.includes('砍伐'));

reset({ weather: 'sun', day: 5, time: 1000 });
const parsnip = paths('防风草种子').find(p => p.where === '皮埃尔的杂货店');
assert.equal(parsnip.cost, 20, 'use the seed page price instead of a shifted shop column');
assert.equal(parsnip.ok, true);
assert.equal(parsnip.verifiedOnly, true);
assert(parsnip.assumptions.some(text => text.includes('金币')));
A.setCond({ season: 'fall' });
assert.notEqual(paths('防风草种子').find(p => p.where === '皮埃尔的杂货店').ok, true, 'off-season stock must not be assumed');
A.setCond({ season: 'spring', day: 3 });
assert.equal(paths('防风草种子').find(p => p.where === '皮埃尔的杂货店').ok, false, 'Wednesday shop closure is checked');
A.setCond({ day: 13 });
assert.notEqual(A.shopCheck(A.locationByName.get('皮埃尔的杂货店')).ok, true, 'festival exceptions cannot be declared open');

reset();
const sashimi = paths('生鱼片').find(p => p.kind === 'cooking');
assert.equal(sashimi.ok, null, 'unconfirmed friendship, recipe and kitchen cannot be treated as information-only');
assert(sashimi.checks.some(c => c.ok === null && c.text.includes('3 心')));
A.setProgress(p => { p.recipes = { [sashimi.recipe.id]: true }; p.buildings.农舍 = 1; });
assert.equal(paths('生鱼片').find(p => p.kind === 'cooking').ok, true, 'confirmed recipe plus a kitchen can satisfy the checked gates');
const copper = paths('铜锭').find(p => p.kind === 'processing');
assert(copper && copper.stations.length);
assert.equal(copper.ok, null, 'an unrecorded furnace cannot count as an available device');
A.setProgress(p => { p.owned[copper.stations[0].id] = true; });
assert.equal(paths('铜锭').find(p => p.kind === 'processing').ok, true);
assert(paths('纤维种子').some(p => p.checks.some(c => c.ok === null && /特别任务/.test(c.text))), 'task recipe remains unknown');
const iridium = paths('铱制洒水器').find(p => p.kind === 'buy');
assert(iridium.checks.some(c => c.ok === false && c.text.includes('周五')), 'stock rotation is a real condition');
A.setProgress(p => { p.museum = 60; }); A.setCond({ day: 12, time: 2330 });
assert.equal(paths('铱制洒水器').find(p => p.kind === 'buy').ok, true, 'Friday stock and the always-open shop are verified independently of material/coin inventory');
const tvRecipe = A.D.recipes.find(r => r.uc.some(c => c.group === 'tv'));
assert.equal(A.acquisitions(tvRecipe.out.id, tvRecipe.out.z).find(p => p.recipe?.id === tvRecipe.id).ok, null, 'a TV recipe is not assumed learned');
A.setProgress(p => { p.recipes[tvRecipe.id] = false; });
assert.equal(A.acquisitions(tvRecipe.out.id, tvRecipe.out.z).find(p => p.recipe?.id === tvRecipe.id).ok, false, 'an explicitly unlearned recipe blocks this route');

reset({ season: 'spring', day: 24 });
const seed = A.D.seeds.find(s => s.p === '防风草种子');
let crop = A.seedCheck(seed);
assert.equal(crop.ok, true); assert.equal(crop.harvestDate.day, 28); assert.equal(crop.harvestDate.season, 'spring');
assert.equal(crop.harvestDates.length, 1); assert(crop.assumptions.some(text => text.includes('每天浇水')));
A.setCond({ day: 25 }); crop = A.seedCheck(seed);
assert.equal(crop.ok, false); assert.equal(crop.harvestDate.season, 'summer'); assert.equal(crop.harvestDates.length, 0);
A.setCond({ season: 'summer', day: 28 });
crop = A.seedCheck(A.D.seeds.find(s => s.p === '玉米种子'));
assert.equal(crop.ok, true); assert.equal(crop.harvestDate.season, 'fall'); assert(crop.harvestDates.length > 1);
// Forum feedback (2026-10-27): the Night Market rule must be visible without a date check,
// and every artifact needs its wiki-listed sources instead of "no verifiable source data".
A.setConditionsEnabled(false);
for (const name of ['午夜鱿鱼', '幽灵鱼', '水滴鱼']) {
  const rules = A.fishRequirements(fish(name)).map(r => r.text).join(' ');
  assert(A.isSubmarineFish(fish(name)) && rules.includes('钓鱼潜艇') && rules.includes('魔法鱼饵'), `${name}: submarine rule hidden by default`);
  assert.equal(A.habitatName(A.fishHabitats(fish(name))[0].location), '夜市钓鱼潜艇');
}
assert(A.submarineFacts().some(r => r.text.includes('17:00–23:00') && r.text.includes('1,000 金')));
assert(!A.isSubmarineFish(fish('沙丁鱼')));
for (const [title, page] of Object.entries(A.D.pages).filter(([, p]) => ['artifact', 'mineral'].includes(p.k))) {
  assert(A.pageInfo(title).src.length, `${title}: no wiki-listed sources`);
}
const seedSources = Object.fromEntries(A.pageInfo('古代种子').src);
assert.deepEqual([...seedSources.as], ['煤矿森林（0.7%）', '深山（0.7%）']); // arrays come from the VM context
assert(seedSources.md.includes('苍蝇（0.5%）') && seedSources.os.includes('古物宝藏'));
assert.deepEqual([...A.pageInfo('古代种子').dr], ['上古种子×1', '上古种子配方']);

// Follow-up (2026-10-27): the same classes of problem across the site.
// 1. Key conditions must be visible in default reading mode and must not be overwritten by exception clauses.
const trout = fish('虹鳟鱼');
assert.deepEqual([...trout.W], ['sun'], 'the Trout Derby "any weather" clause must not replace the regular sunny requirement');
assert(A.fishTimeText(trout).includes('鳟鱼大赛') && A.fishWeatherText(trout).includes('鳟鱼大赛'), 'Trout Derby exception shown');
assert(A.fishTimeText(fish('鲑鱼')).includes('瀑布') && A.fishTimeText(fish('鱿鱼')).includes('鱿鱼节'));
reset({ season: 'summer', day: 5, weather: 'rain', time: 1000 });
assert.equal(A.fishCheck(trout).ok, false, 'rain outside the Trout Derby: not catchable');
assert(A.fishCheck(trout).checks.some(c => c.ok === undefined && c.text.includes('鳟鱼大赛')), 'the exception is listed beside the regular rule');
A.setConditionsEnabled(false);
for (const name of ['海参', '大海参', '章鱼']) {
  assert(A.fishHabitats(fish(name)).some(h => h.location === '夜市'), `${name}: also caught in the Night Market submarine`);
  assert(!A.isSubmarineFish(fish(name)), `${name}: not a submarine-only fish`);
}
for (const name of ['传说之鱼', '鮟鱇鱼', '绯红鱼', '冰川鱼', '雌鮟鱇鱼', '绯红鱼之子', '传说之鱼二代', '小冰川鱼']) {
  const rules = A.fishRequirements(fish(name)).map(r => r.text);
  assert(rules.length >= 3 && !rules.some(r => r.includes('需核对')), `${name}: wiki requirements instead of a "check it yourself" dead end`);
}
assert(A.fishRequirements(fish('鮟鱇鱼')).some(r => r.text.includes('最北端')));
assert(A.fishRequirements(fish('冰川鱼')).some(r => r.text.includes('箭头')));
assert(A.fishRequirements(fish('传说之鱼')).some(r => r.text.includes('只能钓起一次')));
assert(A.fishRequirements(fish('传说之鱼二代')).some(r => r.text.includes('大家族')));
assert.equal(fish('龙虾').cw, 'ocean'); assert.equal(fish('小龙虾').cw, 'fresh');
assert(A.crabFacts(fish('龙虾')).some(r => r.text.includes('海洋')));
assert(A.fishHabitats(fish('鲷鱼')).length >= 2, 'river fish whose location is plain text still list their rivers');
assert(A.shopCheck(A.locationByName.get('皮埃尔的杂货店')).text.includes('休息'), 'closed days visible without a date check');
assert(A.areaState('desert').checks.some(c => c.note?.includes('Joja')), 'the Joja alternative is a note, not a hint hidden in reading mode');
assert.deepEqual([...A.latestPlanting(A.D.seeds.find(s => s.p === '防风草种子'))], ['春 24 日']);
assert.deepEqual([...A.latestPlanting(A.D.seeds.find(s => s.p === '玉米种子'))], ['秋 14 日']);
const ore = paths('铜矿石').find(p => p.kind === 'buy');
assert.equal(ore.cost, 75, 'year-1 Blacksmith price'); assert(ore.note.includes('第2年'), 'year-2 price kept as a labelled note');
assert.equal(paths('能量滋补水').find(p => p.kind === 'buy').cost, 1000, "Harvey's purchase price, not the sell price");

// 2. Every real item has some acquisition data; flavoured goods, crops, clothing and decor have structured routes.
const fishIds = new Set(A.D.fish.map(f => f.id));
const noData = Object.entries(A.D.items).filter(([id, it]) => {
  if (it.x || fishIds.has(id)) return false;
  const page = A.pageInfo(it.pg) || {};
  return !A.acquisitions(id, it.z).length && !it.src?.length && !page.src?.length && !page.ob?.length && !page.f?.source && !page.s;
}).map(([, it]) => it.z);
assert(noData.length <= 60, `items without any acquisition data: ${noData.length} (${noData.slice(0, 8).join(', ')})`);
const pickle = paths('腌制野山葵').find(p => p.kind === 'processing');
assert(pickle && pickle.inputs[0].z === '野山葵' && pickle.stations[0].z === '罐头瓶', 'flavoured goods name their ingredient and machine');
assert.equal(paths('腌制的河豚鱼籽').find(p => p.kind === 'processing').inputs[0].z, '河豚鱼籽', 'aged roe is made from that fish\'s roe');
assert.deepEqual([...paths('向日葵蜂蜜').map(p => p.kind)], ['produce'], 'honey: the flower is not consumed');
assert.deepEqual([...paths('河豚鱼籽').map(p => p.kind)], ['produce'], 'roe comes from a fish pond');
assert(paths('防风草').some(p => p.kind === 'grow' && p.inputs[0].z === '防风草种子'));
assert(paths('斧头').some(p => p.kind === 'initial'));
const overalls = paths('经典背带裤');
assert.equal(overalls.length, 1); assert.equal(overalls[0].kind, 'tailoring');
assert(!overalls[0].reqs.some(r => r.type === 'recipe'), 'tailoring needs no learned recipe');
assert(A.pageInfo('红木椅子').src.flat(2).includes('家具目录（免费）'));
assert(A.pageInfo('祝尼魔帽子').src.flat(2).some(x => x.includes('成就')));
assert.equal(A.D.items['(WP)12'].z, '壁纸 #13'); assert(A.D.items['(WP)12'].src.some(x => x.includes('法师目录')));
assert(A.pageInfo('秘密纸条').ob.some(x => x.startsWith('清除杂草')));
assert(!A.browse.records('items').some(r => /Stone$/.test(r.label) || r.label === '杂草'), 'mine stones and weeds are map objects, not catalogue items');

// 3. Item properties, monster drops and animal produce come from the wiki infoboxes.
const props = name => JSON.parse(JSON.stringify(A.itemProps(A.itemInfo(name)))); // plain objects: the vm realm has its own Array
assert.deepEqual(props('野山葵').eat, { e: 13, h: 5, q: [[18, 8], [23, 10], [33, 14]] }, 'Calcedibility: energy, health and each quality');
assert.deepEqual(props('咖啡').buff, ['速度（+1）']); assert.equal(props('咖啡').buff_time, '1分23秒');
assert.deepEqual(props('啤酒').buff, ['眩晕', '速度（-1）'], 'negative buffs keep their sign');
assert.deepEqual(props('星之果实').eat, { e: '100%', h: 0 });
assert.equal(props('生命药水').eat.h, '100%'); assert.equal(props('能量滋补水').eat.e, 500);
assert.deepEqual(props('生锈的剑').weapon, { type: '剑', level: '1', damage: '2-5', crit: '2%' });
assert.deepEqual(props('运动鞋').stats, ['防御（+1）']);
assert.equal(props('煤炭').eat, null, 'inedible items have no eating row');
const golem = A.monsterInfo(A.monsterByName.get('荒野石魔'));
assert.equal(golem.s.hp, '30');
assert.deepEqual([...golem.dr.slice(0, 2).map(d => d.id)], ['(O)382', '(O)72'], 'drops keep the infobox order');
assert(golem.dr.some(d => d.t === '战斗技能达到5级之后：'), 'conditions between drops are kept in place');
assert.deepEqual([...A.monsterByName.get('蓝鱿鱼').L], ['矿井'], 'links inside a condition are not places');
const coal = paths('煤炭').find(p => p.kind === 'drop');
assert(coal.monsters.some(m => m.title === '荒野石魔' && m.note === '10%'), 'drop chance comes from the monster infobox');
assert(coal.monsters.some(m => m.title === '暗影狙击手' && m.note === '1-3, 10%'), 'mixed comma spacing is normalised');
assert.deepEqual([...paths('蛋').find(p => p.kind === 'animal').animals.map(a => a.title)], ['鸡']);
assert.deepEqual([...paths('松露').map(p => p.kind)].sort(), ['animal', 'drop']);
const chicken = A.animalByName.get('鸡');
assert.equal(chicken.bp, 800); assert.equal(chicken.h[0].z, '鸡舍');
assert(chicken.pr.some(x => x.z === '棕色蛋' && x.pg === '蛋'), 'brown eggs share the egg article instead of a guessed item ID');
console.log('Query rule checks passed: per-water fishing, unknown exceptions, collection methods, acquisition gates, shop hours/stock, ordinary sources, harvest assumptions, Night Market submarine, artifact sources, exception clauses, legendary requirements, crab water, item sources, item properties, monster drops and animal produce.');
