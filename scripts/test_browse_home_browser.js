// Run inside the local app: agent-browser eval --stdin < scripts/test_browse_home_browser.js
(async () => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const A = App, root = document.getElementById('browse'), original = { ...App.state.cond };
  A.select(null); A.spoilers.setEnabled(true); A.setConditionsEnabled(false); A.openBrowse(null);
  await document.fonts.ready;
  const inspectHome = () => {
    assert(root.querySelectorAll('.home-category').length === 8, 'All eight categories remain available');
    assert(root.querySelectorAll('.home-sample').length >= 20, 'Home should contain usable examples, not just category headings');
    assert(!root.querySelector('button button'), 'Interactive examples must not be nested in category buttons');
    assert(root.scrollWidth <= root.clientWidth + 1, 'Home has horizontal overflow');
    for (const card of root.querySelectorAll('.home-category')) {
      const count = A.browse.records(card.dataset.category).length;
      assert(card.querySelector('small').textContent === `${count} 条可查看资料`, 'Home count includes protected records');
    }
    for (const button of root.querySelectorAll('[data-ref]')) {
      const colon = button.dataset.ref.indexOf(':');
      const ref = { type: button.dataset.ref.slice(0, colon), id: button.dataset.ref.slice(colon + 1) };
      assert(A.spoilers.canView(ref), 'Protected example or seasonal lookup was rendered');
    }
    for (const name of ['肯特', '姜岛', '科罗布斯', '齐先生']) assert(!root.textContent.includes(name), 'Home reveals protected content: ' + name);
  };
  inspectHome();
  const first = root.querySelector('.home-category[data-category="items"] .home-sample');
  first.click();
  assert(!document.getElementById('detail').hidden && document.getElementById('detail-title').textContent === '木材', 'Example should open its own detail');
  assert(A.browse.category === null && A.state.view === 'browse', 'Example should preserve the home page');
  A.select(null);

  // A shortcut is a new explicit query, not an intersection with an old filter.
  A.openBrowse('fish', { query: '鲶鱼', season: 'winter', weather: 'rain', location: '不存在的地点', now: true });
  A.openBrowse(null);
  root.querySelector('.home-category[data-category="fish"] [data-filters=\'{"type":"crab"}\']').click();
  assert(A.browse.category === 'fish', 'Crab shortcut does not open fish');
  assert(root.querySelector('[aria-label="类型"]').value === 'crab', 'Crab shortcut did not set type');
  for (const label of ['季节', '天气', '地点']) assert(root.querySelector(`[aria-label="${label}"]`).value === 'all', 'Stale filter remains: ' + label);
  assert(root.querySelector('[aria-label="筛选分类内容"]').value === '' && !root.querySelector('.browse-now input'), 'Reference mode must not depend on a current-time filter');
  assert(root.querySelectorAll('[data-record]').length === A.browse.records('fish').filter(r => r.type === 'crab').length, 'Crab shortcut lost records');

  A.openBrowse(null);
  root.querySelector('.home-season-links [data-category="farming"]').click();
  assert(root.querySelector('[aria-label="季节"]').value === 'spring', 'Explicit seasonal shortcut should set its category filter');
  assert(!A.conditionsActive(), 'Browsing a season must not start a simulated clock');
  A.openBrowse(null);
  root.querySelector('.home-season-links [data-category="fish"]').click();
  assert(root.querySelector('[aria-label="季节"]').value === 'spring' && root.querySelector('[aria-label="类型"]').value === 'rod', 'Seasonal fish action lost its conditions');

  A.openBrowse(null);
  const reading = root.querySelector('.home-reading').textContent;
  A.setCond({ season: 'winter', day: 28, time: 2500 }); A.openBrowse(null);
  inspectHome();
  assert(root.querySelector('.home-reading').textContent === reading && !root.querySelector('.home-condition'), 'Home should explain rules independently of the comparison clock');
  A.openConditions();
  assert(document.getElementById('clock-toggle').getAttribute('aria-expanded') === 'true', 'Condition control does not open the editor');
  document.getElementById('clock-toggle').click();

  A.setCond(original); A.setConditionsEnabled(false); A.openBrowse(null);
  assert(document.getElementById('background-music').paused, 'Home must not autoplay music');
  return { viewport: [innerWidth, innerHeight], checks: 'eight categories, safe previews/counts, detail links, fresh shortcuts, clock-independent reading, explicit seasonal queries, no overflow and no autoplay' };
})();
