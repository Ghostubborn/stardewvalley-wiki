// Run in the local app at desktop and phone sizes with agent-browser eval --stdin.
(async () => {
  const A = App, saved = structuredClone(A.state);
  const assert = (value, message) => { if (!value) throw Error(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const settle = async () => { await frame(); await frame(); };
  const root = document.getElementById('browse'), detail = document.getElementById('detail'), body = document.getElementById('detail-body');
  const bounds = e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
  const title = () => document.getElementById('detail-title');
  const centered = () => {
    const r = detail.getBoundingClientRect();
    assert(!detail.hidden && detail.dataset.mode === 'reading', 'Opening an entry must default to the reading surface');
    assert(Math.abs(r.x + r.width / 2 - innerWidth / 2) < 1 && Math.abs(r.y + r.height / 2 - innerHeight / 2) < 1, 'Reading panel is not centred');
    assert(r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight, 'Reading panel escapes the viewport');
    assert(r.width >= Math.min(680, innerWidth - 48), 'Reading panel is still a narrow sidebar');
    if (innerWidth <= 760) assert(r.height >= innerHeight * .85, 'Phone reading is still confined to a bottom sheet');
    assert(detail.scrollWidth <= detail.clientWidth + 1, 'Reading content has horizontal overflow');
  };
  const markers = () => JSON.stringify(A.map.getMarkers().map(m => [m.id, m.x, m.y]));
  try {
    await document.fonts.ready;
    A.select(null); A.setConditionsEnabled(false); A.spoilers.setEnabled(true); A.openBrowse(null);
    const opener = root.querySelector('.home-category[data-category="items"] .home-sample');
    root.scrollTop = 80; const scroll = root.scrollTop, initialBounds = bounds(root);
    opener.focus({ preventScroll: true }); opener.click(); await settle();
    centered();
    assert(title().textContent === '木材' && document.activeElement === title(), 'Opening must bring focus to the requested title');
    assert(JSON.stringify(bounds(root)) === JSON.stringify(initialBounds) && root.scrollTop === scroll, 'Reading resizes or scrolls the category behind it');
    detail.scrollTop = detail.scrollHeight; await settle();
    const close = document.getElementById('detail-close').getBoundingClientRect(), panel = detail.getBoundingClientRect();
    assert(close.top >= panel.top && close.bottom < panel.top + 90, 'Close control scrolls out of reach');
    document.getElementById('detail-close').click();
    assert(detail.hidden && document.activeElement === opener && root.scrollTop === scroll, 'Close must return to the original entry without losing the list');

    A.select({ type: 'page', id: '新手指南' }, { from: 'search' }); await settle(); centered();
    assert(body.querySelector('.basic-guide'), 'Search result must retain the complete guide');
    detail.scrollTop = detail.scrollHeight;
    A.select({ type: 'fish', id: '沙丁鱼' }, { from: 'browse' }); await settle(); centered();
    assert(detail.scrollTop === 0 && title().getBoundingClientRect().top < innerHeight / 2, 'A new entry opens at the previous article’s scroll offset');
    const condition = document.getElementById('detail-conditions'); condition.focus(); condition.click(); await settle();
    const readingBounds = bounds(detail);
    assert(!document.getElementById('clock-controls').hidden, 'Reading toolbar lost access to optional conditions');
    document.getElementById('conditions-enabled').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!detail.hidden && document.activeElement === condition && JSON.stringify(bounds(detail)) === JSON.stringify(readingBounds), 'Condition popover disturbs the reading surface');

    A.select({ type: 'page', id: '姜岛' }, { from: 'search' }); await settle(); centered();
    assert(title().textContent === '尚未确认探索的内容' && document.getElementById('detail-caption').textContent === title().textContent, 'Reader chrome exposes a protected title');
    A.select(null); A.setView('map'); A.map.fit(); await settle();
    A.openMapPlaces(['valley:285:210']); await settle(); centered();
    const input = body.querySelector('.point-search'); input.value = '鳗鱼'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const beforeMap = markers(); body.querySelector('[data-entry]').click(); await settle(); centered();
    assert(title().textContent === '鳗鱼', 'Map list opens the wrong entry');
    [...body.querySelectorAll('button')].find(b => b.textContent.includes('返回地点列表')).click(); await settle();
    assert(body.querySelector('.point-search').value === '鳗鱼' && markers() === beforeMap, 'Returning from reading loses map filtering or camera');
    body.querySelector('.point-heading button').click();
    await new Promise(resolve => setTimeout(resolve, 750));
    assert(detail.dataset.mode === 'context' && document.getElementById('detail-shade').hidden, 'Explicit location should leave the map visible');
    const ocean = A.map.getMarkers().find(m => m.points.some(p => p.id === 'valley:285:210'));
    const contextBounds = detail.getBoundingClientRect();
    assert(ocean && (innerWidth <= 760 ? ocean.y + 36 < contextBounds.top : ocean.x + 34 < contextBounds.left), 'Located point is covered by its context panel');
    document.getElementById('detail-mode').click(); await settle(); centered();
    A.select(null); A.setView('tree'); await settle();
    const node = [...document.querySelectorAll('.node:not(.protected-node)')].find(e => { const r = e.getBoundingClientRect(); return r.left > 340 && r.right < innerWidth && r.top > 80 && r.bottom < innerHeight; });
    if (node) { node.click(); await settle(); centered(); }
    A.select({ type: 'node', id: 'tool:斧头:1' }, { switchView: true }); await settle();
    assert(detail.dataset.mode === 'context', 'Explicit route navigation should allow diagram comparison');
    document.getElementById('detail-mode').click(); await settle(); centered();
    return { viewport: [innerWidth, innerHeight], result: 'centred readable entries, sticky controls, restored list/focus, search, map lists and camera, optional contextual view, routes, privacy' };
  } finally {
    const view = A.state.view;
    Object.assign(A.state, saved); A.state.view = view; A.state.conditionsEnabled = false; A.emit('reader-test:restore');
    A.select(null); A.openBrowse(null);
  }
})();
