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
const A = ctx.window.App, M = A.mapContents;
const points = M.points('valley');
const ocean = M.find('valley:285:210');
assert(M.find('valley:235:110').entries.filter(e => e.kind === 'villager').length >= 2, 'Shared homes should expose their known residents');
assert.equal(M.homePins(A.villagerByName.get('阿比盖尔'))[0][0], 237);
assert(ocean.entries.filter(e => e.kind === 'fish').length >= 8, 'The fish list must retain every known fish, not only the first icon');
assert.equal(ocean.entries.filter(e => e.label === '红鲷鱼').length, 1, 'Page and fish records must not duplicate one entity');
for (const zoom of [.5, 1, 3, 6, 12]) {
  const same = M.cluster([ocean], (x, y) => [x * zoom, y * zoom]);
  assert.equal(same.length, 1, 'Identical coordinates must stay grouped at every zoom');
  assert.equal(same[0].entries.length, ocean.entries.length);
  const groups = M.cluster(points, (x, y) => [x * zoom, y * zoom]);
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    assert(Math.abs(groups[i].x - groups[j].x) >= 48 || Math.abs(groups[i].y - groups[j].y) >= 48, 'Projected markers still overlap');
  }
  assert.equal(groups.flatMap(g => g.entries).length, points.flatMap(p => p.entries).length, 'Clustering must not discard entries');
}
for (const p of points) assert.equal(new Set(p.entries.map(e => e.key)).size, p.entries.length, 'Duplicate reference at a place');
const mixed = M.cluster([
  { id: 'a', x: 1, y: 1, entries: [{ ref: { type: 'fish', id: 'a' }, kind: 'fish' }] },
  { id: 'b', x: 2, y: 2, entries: [{ ref: { type: 'villager', id: 'b' }, kind: 'villager' }] },
], (x, y) => [x, y]);
assert.equal(mixed.length, 1); assert.equal(mixed[0].entries.length, 2, 'Different marker layers must be selectable together');
assert.equal(mixed[0].aggregate, true, 'A marker between different places must be labelled as an aggregate');
assert.equal(M.cluster([ocean], (x, y) => [x, y])[0].aggregate, false, 'Several fish in one water location are not multiple places');
// Reviewed against building silhouettes on the actual 400×244 base image.
for (const [name, x, y] of [['木匠的商店', 230, 52], ['鱼店', 269, 208], ['铁匠铺', 285, 143], ['农舍', 148, 94]]) {
  const l = A.locationByName.get(name);
  assert.equal(l.x, x, name + ' horizontal anchor'); assert.equal(l.y, y, name + ' vertical anchor');
  assert(M.find(`valley:${x}:${y}`).entries.some(e => e.ref.id === name));
}
assert.equal(M.find('valley:247:59').id, 'valley:230:52', 'Old point links resolve to the calibrated location');
for (const name of ['河豚', '金枪鱼', '大海参', '比目鱼', '章鱼', '罗非鱼']) {
  assert(ocean.entries.some(e => e.label === name), `${name}: mainland pin must survive a template with both maps`);
}
for (const p of points) assert(!p.entries.some(e => e.label === '史莱姆鱼'), 'A newly calibrated sewer entrance must remain protected');
assert.equal(A.D.locations.find(l => l.p === '姜岛').map, 'island', 'An island inset must never be projected onto the plain valley map');
assert.equal(A.D.progression.areas.find(a => a.id === 'ginger_island').map, 'island');
for (const f of A.D.fish) for (const [x, y, map] of f.pins) {
  assert(A.D.maps[map] && x >= 0 && x <= 400 && y >= 0 && y <= 244, 'Pins require a valid base map and in-bounds coordinates');
}
const visibleLabels = points.flatMap(p => p.entries.map(e => e.label));
for (const name of ['姜岛', '科罗布斯', '电影院', 'Joja仓库', '肯特']) assert(!visibleLabels.includes(name), `Protected label exposed: ${name}`);
assert.equal(M.points('island').length, 0);
for (const category of A.browse.categories) assert(A.browse.records(category.id).length > 0, `Empty entry category: ${category.id}`);
assert.equal(A.browse.records('villagers').find(r => r.label === '潘姆').type, 'other');
assert.equal(A.browse.records('villagers').find(r => r.label === '阿比盖尔').type, 'marriage');
assert(A.browse.records('items').length > 36, 'Large categories need pagination');
const bundles = A.browse.records('bundles').filter(row => row.ref.type === 'bundle');
assert(A.browse.records('bundles').some(row => row.type === 'mineral'));
assert(bundles.every(b => { const value = A.browse.bundle(b.ref.id)?.bundle; return value && (value.items.length || value.cost > 0); }));
const quality = A.browse.bundle('茶水间:高品质作物收集包').bundle;
assert.equal(quality.items.length, 4); assert.equal(quality.slots, 3); assert.equal(quality.choose, true);
assert(quality.items.every(item => item.qty === 5 && item.quality === 'gold'));
assert(!bundles.some(b => b.type === '废弃Joja超市'));
A.spoilers.setEnabled(false);
assert(M.points('island').length > 0, 'Explicit reveal must refresh the cached map content');
A.spoilers.setEnabled(true);
assert.equal(M.points('island').length, 0, 'Re-enabling privacy must drop protected points and counts');
console.log('Navigation checks passed: stable point groups, collision-free markers, no lost/duplicate entries, private counts, and populated categories.');
