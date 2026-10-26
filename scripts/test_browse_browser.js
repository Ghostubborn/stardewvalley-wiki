// Run on the local app with agent-browser eval --stdin < scripts/test_browse_browser.js
// Uses the actual DOM, assets and event handlers; run at desktop and phone sizes.
(async () => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await document.fonts.ready;
  const A = App, root = document.getElementById('browse');
  A.select(null); A.spoilers.setEnabled(true);
  const open = id => { A.openBrowse(id); root.querySelector('.browse-toolbar > .btn').click(); };
  const query = text => { const field = root.querySelector('input[type="search"]'); field.value = text; field.dispatchEvent(new Event('input', { bubbles: true })); };
  const subtype = value => {
    const field = root.querySelector('select[aria-label="类型"]'); field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const layouts = { fish: '.fish-collection', villagers: '.social-register', farming: '.crop-almanac',
    items: '.inventory-grid', upgrades: '.upgrade-track', bundles: '.bundle-room', places: '.town-directory', basics: '.handbook-pages' };
  const report = [];
  for (const [id, selector] of Object.entries(layouts)) {
    open(id);
    assert(root.querySelector(selector), id + ': missing category presentation');
    assert(root.querySelectorAll('[data-record]').length === Math.min(36, A.browse.records(id).length), id + ': missing or duplicated records');
    assert(root.scrollWidth <= root.clientWidth + 1, id + ': horizontal overflow');
    assert(!root.querySelector('button button'), id + ': nested interactive targets');
    const exposed = root.textContent + [...root.querySelectorAll('[aria-label], [title], img')].map(e => [e.getAttribute('aria-label'), e.title, e.alt].join(' ')).join(' ');
    for (const name of ['科罗布斯', '肯特', '齐先生', '姜岛', '银河之魂', '无限之刃']) {
      if (!A.spoilers.canView({ type: 'page', id: name })) assert(!exposed.includes(name), id + ': spoiler exposed: ' + name);
    }
    report.push({ category: id, entries: root.querySelectorAll('[data-record]').length });
  }
  open('items');
  const before = root.querySelectorAll('[data-record]').length;
  root.querySelector('.browse-more').click();
  assert(root.querySelectorAll('[data-record]').length > before, 'Inventory pagination does not add records');
  query('不存在的测试条目');
  assert(!root.querySelector('[data-record]') && root.querySelector('.empty-note'), 'Empty filters require an explanatory state');

  open('farming'); query('防风草种子');
  assert(root.querySelectorAll('.crop-entry').length === 1, 'Crop name filter failed');
  assert(root.querySelector('.growth-span').textContent.includes('4 天'), 'Parsnip must retain its four-day growth period');
  assert(root.querySelector('.crop-facts').textContent.includes('35 金'), 'Parsnip base sale price changed');
  root.querySelector('[data-record]').click();
  assert(document.getElementById('detail-title').textContent.includes('防风草种子'), 'Crop does not open its detail');
  A.select(null);
  assert(root.querySelector('input[type="search"]').value === '防风草种子', 'Detail navigation lost the filter');

  open('villagers'); query('潘妮');
  const gift = root.querySelector('.social-gifts .catalog-slot');
  assert(gift && root.querySelector('.birthday-stamp').textContent.includes('2'), 'Social entry lost birthday or gift access');
  const giftName = gift.querySelector('.slot-label').textContent; gift.click();
  assert(document.getElementById('detail-title').textContent === giftName, 'Gift icon does not open the matching item');
  A.select(null);

  open('bundles'); subtype('茶水间'); query('高品质作物');
  const sheet = root.querySelector('.bundle-sheet');
  assert(sheet && sheet.querySelectorAll('.catalog-slot').length === 4, 'Quality bundle needs four choices');
  assert(sheet.querySelector('.bundle-cover').textContent.includes('任选 3 项'), 'Quality bundle is choose three, not deliver all four');
  assert(sheet.querySelectorAll('.slot-quality.gold').length === 4, 'Gold quality missing');
  assert([...sheet.querySelectorAll('.slot-qty')].every(e => e.textContent === '5'), 'Quality bundle requires five of each selected crop');
  query(''); subtype('金库');
  assert(root.querySelectorAll('.bundle-gold').length === 4 && !root.querySelector('.bundle-slots'), 'Money bundles must show gold rather than material slots');
  subtype('mineral');
  assert(root.querySelector('.museum-shelf'), 'Minerals require a specimen shelf');

  open('bundles');
  const hidden = root.querySelector('.concealed-slot');
  assert(hidden, 'Expected a protected bundle ingredient in the default view');
  hidden.closest('button').click();
  assert(document.getElementById('detail-title').textContent === '尚未确认探索的内容', 'Hidden ingredient bypasses the reveal gate');
  A.select(null);

  open('upgrades');
  assert(root.querySelector('.upgrade-step[data-linked="true"]'), 'Real tool upgrade dependencies need an arrow');
  A.spoilers.setEnabled(false);
  subtype('gear');
  assert(root.querySelectorAll('.upgrade-offer').length >= 5, 'Explicit reveal should expose equipment for comparison');
  assert(!root.querySelector('.upgrade-step[data-linked="true"]'), 'Independent rods and sprinklers must not imply prerequisite upgrades');
  A.spoilers.setEnabled(true);

  open('places'); query('鱼店');
  root.querySelector('.shop-locate').click();
  assert(A.state.view === 'map' && document.getElementById('detail-title').textContent === '鱼店', 'Shop location action failed');
  A.select(null); A.openBrowse('places');
  assert(root.querySelector('input[type="search"]').value === '鱼店', 'Returning from the map lost the category filter');
  A.spoilers.setEnabled(false); A.openBrowse('villagers'); query('肯特');
  assert(root.querySelector('.social-person'), 'Explicit full reveal must refresh the social register');
  A.spoilers.setEnabled(true);
  assert(!root.querySelector('.social-person'), 'Restoring spoiler protection must remove previously visible residents');
  A.openBrowse(null);
  assert(document.getElementById('background-music').paused, 'Browsing must not start the music');
  return { viewport: [innerWidth, innerHeight], categories: report, checks: 'navigation, filters, pagination, nested privacy, quantities, quality, upgrade semantics, map link, music default' };
})();
