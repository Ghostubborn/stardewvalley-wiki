// Run at desktop and phone sizes with agent-browser eval --stdin.
(async () => {
  const A = App, saved = structuredClone(A.state);
  const assert = (value, message) => { if (!value) throw Error(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const settle = async () => { await frame(); await frame(); };
  const root = document.getElementById('browse'), detail = document.getElementById('detail');
  const trigger = document.getElementById('clock-toggle'), panel = document.getElementById('clock-controls');
  const geometry = () => [root, detail, document.querySelector('.clock')].map(e => {
    const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, e.scrollTop];
  }).concat([[A.mapInsetX, A.mapInsetY, A.mapPad?.top, A.mapPad?.bottom]]);
  const same = (before, after, message) => assert(JSON.stringify(before) === JSON.stringify(after), message);
  const close = () => document.getElementById('conditions-close').click();
  try {
    await document.fonts.ready;
    if (!panel.hidden) close();
    A.setConditionsEnabled(false); A.openBrowse(null);
    A.select({ type: 'item', id: '(O)388' }, { from: 'browse' });
    assert(!root.hidden && root.getClientRects().length && !detail.hidden, 'Layout regression must measure visible browse and detail panels');
    root.scrollTop = 120; detail.scrollTop = 60; await settle();
    trigger.focus({ preventScroll: true });
    const before = geometry(); trigger.click(); await settle();
    assert(!panel.hidden && trigger.getAttribute('aria-expanded') === 'true', 'Trigger must open the panel');
    same(before, geometry(), 'Opening moves/resizes content or loses scroll position');
    const bounds = panel.getBoundingClientRect(), anchor = trigger.getBoundingClientRect();
    assert(bounds.top >= anchor.bottom && bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Popover is outside the viewport or covers its trigger');
    assert(panel.scrollWidth <= panel.clientWidth + 1, 'Popover has horizontal overflow');
    if (innerHeight <= 500) assert(panel.scrollHeight > panel.clientHeight, 'Short screens require internal panel scrolling');
    const closeButton = document.getElementById('conditions-close').getBoundingClientRect();
    assert(document.getElementById('conditions-close').contains(document.elementFromPoint(closeButton.x + closeButton.width / 2, closeButton.y + closeButton.height / 2)), 'Open panel is obscured by the detail sheet');
    document.getElementById('conditions-enabled').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(panel.hidden && !detail.hidden && document.activeElement === trigger, 'Escape must close only the popover and restore focus');
    same(before, geometry(), 'Closing moves content or changes its scroll position');

    trigger.click(); await settle();
    document.getElementById('search').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    assert(panel.hidden, 'Outside pointer interaction does not dismiss the panel');
    trigger.focus({ preventScroll: true }); trigger.click();
    const fixedHeader = document.querySelector('.clock').getBoundingClientRect().height;
    const enabled = document.getElementById('conditions-enabled');
    enabled.checked = true; enabled.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    assert(!panel.hidden && A.conditionsActive(), 'Editing a condition must not dismiss the panel');
    assert(document.querySelector('.clock').getBoundingClientRect().height === fixedHeader, 'Enabling conditions changes the trigger height');
    assert(root.getBoundingClientRect().top === before[0][1], 'Enabling conditions pushes the page');
    document.getElementById('open-progress').click(); await settle();
    assert(document.getElementById('progress-dialog').open && !panel.hidden, 'Nested progress dialog lost its entry point');
    document.getElementById('progress-dialog').close(); close();

    A.select(null); A.setView('map'); A.map.fit(); await settle();
    const markers = () => A.map.getMarkers().map(m => [m.id, m.x, m.y]);
    const mapBefore = markers(), insets = [A.mapInsetX, A.mapInsetY, A.mapPad?.top, A.mapPad?.bottom];
    trigger.focus(); trigger.click(); await settle();
    same(mapBefore, markers(), 'Opening the popover moves map markers');
    same(insets, [A.mapInsetX, A.mapInsetY, A.mapPad?.top, A.mapPad?.bottom], 'Popover changes the map focus area');
    close(); await settle(); same(mapBefore, markers(), 'Closing the popover moves map markers');
    return { viewport: [innerWidth, innerHeight], result: 'stable frames/scroll/camera; fixed trigger; bounded scrollable overlay; Escape, outside click and nested dialog' };
  } finally {
    document.getElementById('progress-dialog').close();
    if (!panel.hidden) close();
    const view = A.state.view;
    Object.assign(A.state, saved); A.state.view = view; A.state.conditionsEnabled = false; A.emit('popover-test:restore');
    A.select(null); A.openBrowse(null);
  }
})();
