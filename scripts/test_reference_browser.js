// Run in a freshly opened local app with agent-browser eval --stdin.
(async () => {
  const A = App, assert = (value, message) => { if (!value) throw new Error(message); };
  const root = document.getElementById('browse'), body = document.getElementById('detail-body');
  const saved = structuredClone(A.state), frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  await document.fonts.ready;
  try {
    A.select(null); A.setConditionsEnabled(false); A.spoilers.setEnabled(true); A.openBrowse(null);
    assert(document.getElementById('clock-time').hidden && document.getElementById('clock-weather').hidden, 'Default header suggests a current game clock');
    assert(!root.querySelector('.home-condition') && root.querySelector('.home-reading'), 'Home should centre reading paths');
    assert(!root.textContent.includes('现在种来得及') && !root.textContent.includes('本季接下来的生日'), 'Home retained a simulated daily dashboard');
    if (!A.state.plan.length) assert(document.getElementById('quick-count').hidden, 'An empty cheat sheet should not show a count');

    A.openBrowse('fish');
    assert(!root.querySelector('.browse-now'), 'Fresh fish browsing requires a global time filter');
    A.select({ type: 'fish', id: '沙丁鱼' }, { from: 'browse' });
    assert(body.textContent.includes('获取条件') && body.textContent.includes('用途'), 'Fish detail lost its reference content');
    assert(!body.querySelector('.path-state'), 'Fish detail implies a current catch verdict without opting in');
    assert(!body.textContent.includes('现在符合条件吗'), 'Live decision still leads the detail');
    assert(body.scrollWidth <= body.clientWidth + 1, 'Fish reference overflows');

    A.select({ type: 'item', id: '(O)388' });
    assert(body.textContent.includes('获取途径') && body.textContent.includes('用途'), 'Material provenance and uses must be directly available');
    assert(!body.querySelector('.path-state'), 'Acquisition paths show personal verdicts by default');
    const bookmark = [...body.querySelectorAll('button')].find(b => b.textContent === '钉到速查');
    if (bookmark) bookmark.click();
    assert(A.state.plan.some(p => p.id === '(O)388'), 'Pinning must keep the existing saved-reference model');
    assert(document.getElementById('quick-count').textContent === String(A.state.plan.length), 'Cheat sheet tab should count pinned entries');

    A.select({ type: 'item', id: A.itemInfo('防风草种子').id });
    assert(body.textContent.includes('种植规则') && body.textContent.includes('基础生长时间：4 天'), 'Crop facts should not require a planting date');
    assert(!body.textContent.includes('今天播种'), 'Crop detail starts with the assumed current date');

    A.select({ type: 'villager', id: '阿比盖尔' }); await frame();
    assert(body.querySelector('[aria-label="日程季节"]').value === 'all', 'Fresh schedule should not inherit an arbitrary season');
    assert(!body.querySelector('.schedule-context') && !body.querySelector('.time-match'), 'Schedule suggests a live location in reference mode');

    A.select({ type: 'bundle', id: '茶水间:高品质作物收集包' });
    assert(body.querySelectorAll('.collection-quantity').length === 4, 'Reference requirements must include all alternatives');
    assert(!body.querySelector('.collection-submit'), 'Recording controls should be opt-in');
    body.querySelector('.collection-recording').click();
    assert(body.querySelector('.collection-submit'), 'Recording remains available when requested');
    body.querySelector('.collection-recording').click();

    A.select(null); A.setView('tree'); await frame();
    assert(document.querySelectorAll('.node.s-reference').length > 0 && !document.querySelector('.node.s-ready'), 'Default route view must describe relationships instead of readiness');
    assert(document.getElementById('journal-body').textContent.includes('每一行是一条路线'), 'Route axes require a visible explanation');
    A.setView('map'); await frame();
    assert(document.getElementById('journal-title').textContent === '地图查阅' && !document.getElementById('journal-body').textContent.includes('现在种还来得及'), 'Map should lead with places and waters');

    A.openConditions();
    const enabled = document.getElementById('conditions-enabled');
    enabled.checked = true; enabled.dispatchEvent(new Event('change', { bubbles: true }));
    assert(A.conditionsActive() && !document.getElementById('condition-fields').disabled, 'Explicit comparison does not enable its controls');
    A.setCond({ season: 'spring', day: 2, time: 1000, weather: 'sun', year: 1 });
    A.openBrowse('fish', { now: true });
    assert(root.querySelector('.browse-now input').checked, 'Explicit condition filter was lost');
    const matching = root.querySelectorAll('[data-record]').length;
    A.setConditionsEnabled(false);
    assert(!root.querySelector('.browse-now') && root.querySelectorAll('[data-record]').length >= matching, 'Turning off comparison leaves a hidden stale filter');
    assert(!A.spoilers.canView({ type: 'page', id: '姜岛' }), 'Comparison preferences must not unlock spoilers');
    assert(document.getElementById('background-music').paused, 'Reference browsing must not enable music');
    return { viewport: [innerWidth, innerHeight], result: 'reference-first home, details, routes and map; optional comparison/records; bookmarks; protected boundaries' };
  } finally {
    Object.assign(A.state, saved); A.state.conditionsEnabled = false; A.emit('reference-test:restore');
    A.select(null); A.openBrowse(null);
    document.getElementById('clock-controls').hidden = true;
    document.getElementById('clock-toggle').setAttribute('aria-expanded', 'false');
    window.dispatchEvent(new Event('resize'));
  }
})();
