// Run against the built local app at desktop and 320px:
// agent-browser --session upgrade-qa eval --stdin < scripts/test_upgrade_browser.js
(async () => {
  const A = window.App, report = [], failures = [], original = structuredClone(A.state);
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const settle = async () => { await frame(); await frame(); };
  const waitFor = async (check, message) => {
    const deadline = performance.now() + 4000;
    while (!check()) { assert(performance.now() < deadline, message); await frame(); }
    await settle();
  };
  const detail = () => document.getElementById('detail');
  const body = () => document.getElementById('detail-body');
  const title = () => document.getElementById('detail-title')?.textContent;
  const click = async (element, label) => {
    assert(element && element.getClientRects().length && !element.disabled, label + ': target is unavailable');
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    element.click(); await settle();
  };
  const change = async (element, value, label) => {
    assert(element && element.getClientRects().length, label + ': control is unavailable');
    element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  };
  const noOverflow = (element, label) => {
    assert(element.scrollWidth <= element.clientWidth + 1, label + ': horizontal content overflow');
    const box = element.getBoundingClientRect();
    assert(box.left >= -1 && box.right <= innerWidth + 1, label + ': panel extends outside the viewport');
  };
  const exposed = element => element.textContent + [...element.querySelectorAll('[aria-label],[title],img')]
    .map(node => [node.getAttribute('aria-label'), node.title, node.alt, node.getAttribute('src')].join(' ')).join(' ');
  const run = async (name, task) => {
    try { await task(); } catch (error) { failures.push({ scenario: name, error: error.message }); }
  };
  try {
    await document.fonts.ready;
    A.select(null); A.applyPreset('unknown'); A.spoilers.setEnabled(true);
    A.state.collections = {}; A.emit('collections');
    await run('basic guides', async () => {
    A.openBrowse('basics'); await settle();
    const guideTitles = ['新手指南', '控制', '物品栏', '游戏内时间', '季节', '天气', '能量', '生命值', '技能', '钓鱼攻略', '友谊', '合作', '存档'];
    for (const name of guideTitles) {
      const chapter = [...document.querySelectorAll('#browse .handbook-chapter')].find(node => node.dataset.record === 'page:' + name);
      await click(chapter, 'Open basic guide ' + name);
      assert(title() === name, name + ': wrong guide was opened');
      const article = body().querySelector('.basic-guide');
      assert(article && article.querySelectorAll('.guide-section').length >= 2, name + ': missing actionable guide content');
      assert(article.querySelectorAll('.guide-source-footer a[href]').length, name + ': missing source/version access');
      assert(!article.textContent.includes('银河之魂') && !article.textContent.includes('齐先生'), name + ': unrelated late content is exposed');
      noOverflow(detail(), name);
      await click(document.getElementById('detail-close'), 'Close basic guide');
    }
    A.select({ type: 'page', id: '控制' }); await settle();
    const pcText = body().querySelector('.guide-platform-content').textContent;
    await click(body().querySelector('[data-platform="mobile"]'), 'Choose mobile controls');
    assert(body().querySelector('[data-platform="mobile"]').getAttribute('aria-pressed') === 'true', 'Mobile control selection is not announced');
    assert(body().querySelector('.guide-platform-content').textContent !== pcText, 'Mobile controls did not replace keyboard instructions');
    await click(body().querySelector('[data-platform="controller"]'), 'Choose controller controls');
    assert(body().querySelector('.guide-platform-content').getAttribute('aria-label').includes('手柄'), 'Controller content has the wrong platform label');
    const related = body().querySelector('.guide-related-link'), relatedName = related?.textContent;
    await click(related, 'Open related guide');
    assert(title() === relatedName && body().querySelector('.basic-guide'), 'Related guide link does not navigate to its content');
    report.push({ scenario: '13 basic guides', result: 'actionable content, sources, platform switch, related navigation and bounded layout' });
    });

    await run('resident schedule', async () => {
    A.setCond({ season: 'fall', day: 12, weather: 'rain', time: 1830, year: 1 });
    A.select({ type: 'villager', id: '阿比盖尔' }); await settle();
    let schedule = body().querySelector('.schedule-section');
    assert(schedule && schedule.querySelector('.schedule-explanation').textContent.includes('不代表实时位置'), 'Schedule must explain that it is a conditional reference');
    assert(schedule.querySelector('.schedule-context').textContent.includes('秋季 12 日'), 'Schedule ignored current query date');
    await change(schedule.querySelector('[aria-label="日程季节"]'), 'winter', 'Select winter schedule');
    schedule = body().querySelector('.schedule-section');
    assert(schedule.querySelector('.schedule-context').textContent.includes('冬季 12 日'), 'Schedule season control does not update context');
    const beforeBranches = schedule.querySelectorAll('.schedule-card').length;
    let allCases = [...schedule.querySelectorAll('label')].find(node => node.textContent.includes('列出全部日期情况'))?.querySelector('input');
    if (allCases.checked) await click(allCases, 'Restrict to configured date before testing expansion');
    allCases = [...schedule.querySelectorAll('label')].find(node => node.textContent.includes('列出全部日期情况'))?.querySelector('input');
    const beforeFilteredBranches = schedule.querySelectorAll('.schedule-card').length;
    await click(allCases, 'Show all seasonal schedule branches');
    schedule = body().querySelector('.schedule-section');
    assert(schedule.querySelectorAll('.schedule-card').length >= beforeFilteredBranches, 'Showing all seasonal cases dropped branches');
    const closed = [...schedule.querySelectorAll('.schedule-card')].find(node => !node.open);
    assert(closed, 'Expected at least one optional schedule branch for inspection');
    assert(!closed.querySelector('.schedule-rows'), 'Unopened schedule branch should not pre-render its details');
    await click(closed.querySelector('summary'), 'Open one schedule branch');
    assert(closed.open && closed.querySelectorAll('.schedule-row').length, 'Expanding the branch did not show its timetable');
    await click(closed.querySelector('summary'), 'Close one schedule branch');
    assert(!closed.querySelector('.schedule-rows'), 'Closing a branch must remove its undisclosed rows');
    for (const secret of ['姜岛', '科罗布斯', '齐先生']) {
      if (!A.spoilers.canView({ type: 'page', id: secret })) assert(!exposed(schedule).includes(secret), 'Schedule controls exposed protected content: ' + secret);
    }
    noOverflow(detail(), 'Resident schedule');
    report.push({ scenario: 'resident schedule', result: 'date/season context, retained conditional branches, explicit expansion, no real-time-location claim' });
    });

    await run('bundle records', async () => {
    const key = '茶水间:高品质作物收集包', entry = A.browse.bundle(key);
    A.openBrowse('bundles', { type: '茶水间', query: '高品质作物' }); await settle();
    await click(document.querySelector('#browse .bundle-cover'), 'Open quality crop bundle');
    assert(title() === '高品质作物收集包', 'Bundle card opens the wrong detail');
    assert(body().querySelectorAll('.collection-requirement').length === 4, 'Quality bundle must keep all four alternatives');
    assert([...body().querySelectorAll('.collection-quantity')].every(node => node.textContent.includes('数量 ×5') && node.textContent.includes('金星品质')), 'Bundle quantity/quality is missing');
    await click(body().querySelector('.collection-recording'), 'Opt in to recording submitted materials');
    for (const index of [0, 1, 2]) {
      const checkbox = body().querySelector(`.collection-requirement[data-index="${index}"] input`);
      checkbox.focus(); await click(checkbox, 'Record submitted crop ' + index);
      assert(A.collections.isSubmitted(entry.room, entry.bundle, index), 'Clicked crop submission was not recorded');
      assert(document.activeElement?.closest('.collection-requirement')?.dataset.index === String(index), 'Donation update lost keyboard focus');
    }
    assert(A.collections.summary(entry.room, entry.bundle).complete, 'Three of four crops must satisfy the choice bundle');
    assert(body().querySelector('.collection-progress').textContent.includes('已够要求'), 'Choice bundle incorrectly demands its fourth alternative');
    assert(body().querySelector('.collection-requirement[data-index="3"] input').disabled, 'Unneeded fourth alternative remains submit-enabled');
    await click(body().querySelector('.collection-filter input'), 'Filter unsubmitted requirements');
    assert(body().querySelectorAll('.collection-requirement').length === 1, 'Missing-only filter retained submitted crops');
    assert(body().querySelector('.collection-requirement').dataset.index === '3', 'Missing-only filter shows the wrong crop');
    await click(body().querySelector('.collection-reset'), 'Clear this bundle records');
    assert(A.collections.summary(entry.room, entry.bundle).submitted === 0, 'Clear did not reset the chosen bundle');
    await click(body().querySelector('.collection-undo button'), 'Undo clearing bundle');
    assert(A.collections.summary(entry.room, entry.bundle).submitted === 3, 'Undo did not restore all prior submissions');
    assert(body().querySelectorAll('.collection-requirement').length === 1, 'Bundle rerender lost its local filter');
    assert(!A.state.progress.rooms?.includes('茶水间'), 'Manual bundle records must not repair world rooms');
    noOverflow(detail(), 'Donation checklist');
    await click(document.getElementById('detail-close'), 'Return to collection list');
    assert(document.querySelector('#browse .bundle-progress')?.textContent.includes('3/3'), 'Browse card did not refresh donation progress');
    A.select({ type: 'bundle', id: '金库:2,500金收集包' }); await settle();
    await click(body().querySelector('.collection-recording'), 'Opt in to recording gold payment');
    await click(body().querySelector('.collection-payment input'), 'Record whole gold payment');
    assert(A.collections.summary('金库', '2,500金收集包').complete, 'Whole gold payment was not recorded');
    assert(body().querySelector('.collection-payment').textContent.includes('2,500 金'), 'Gold bundle omitted its full amount');
    noOverflow(detail(), 'Gold donation');
    report.push({ scenario: 'bundle records', result: 'three-of-four, quantity/quality, focus retention, missing filter, clear/undo, browse update and whole gold payment' });
    });

    await run('reverse gifts and browser history', async () => {
    const quartz = A.itemInfo('石英').id;
    A.select({ type: 'item', id: quartz }); await settle();
    const likesLabel = [...body().querySelectorAll('p')].find(node => node.textContent === '喜欢这件礼物');
    assert(likesLabel, 'Reverse gift lookup must include liked gifts, not just loved gifts');
    const likeGroup = likesLabel.nextElementSibling;
    assert(likeGroup?.querySelector('.chip'), 'Reverse liked-gift lookup has no clickable residents');
    const visibleLikes = A.giftsByItem.get(quartz).like.filter(name => A.spoilers.canView({ type: 'villager', id: name }));
    const expansion = [...likeGroup.querySelectorAll('button')].find(node => node.textContent.startsWith('查看其余'));
    if (visibleLikes.length > 8) {
      await click(expansion, 'Expand additional liked-gift residents');
      assert(likeGroup.querySelectorAll('.chip').length === visibleLikes.length, 'Expanded liked-gift group omitted known residents');
    }
    for (const secret of ['桑迪', '矮人', '科罗布斯', '雷欧']) {
      if (!A.spoilers.canView({ type: 'villager', id: secret })) assert(!exposed(likeGroup).includes(secret), 'Reverse gift lookup exposes protected resident: ' + secret);
    }
    const person = likeGroup.querySelector('.chip'), personName = person.textContent;
    const quartzHash = location.hash;
    await click(person, 'Open resident from reverse gift');
    assert(title() === personName, 'Reverse gift resident link opens the wrong person');
    const personHash = location.hash;
    assert(personHash !== quartzHash, 'Detail navigation did not create a distinct browser route');
    history.back();
    await waitFor(() => location.hash === quartzHash && title() === '石英', 'Browser Back did not restore the item detail');
    assert([...body().querySelectorAll('p')].some(node => node.textContent === '喜欢这件礼物'), 'Returned item detail lost reverse gift section');
    history.forward();
    await waitFor(() => location.hash === personHash && title() === personName, 'Browser Forward did not restore the resident detail');
    noOverflow(detail(), 'Reverse gift navigation');
    report.push({ scenario: 'reverse gifts and browser history', result: 'liked residents, expansion, protected names, resident link, Back and Forward' });
    });

    await run('direct known-tier input', async () => {
    A.select(null); A.openConditions(); await settle();
    await click(document.getElementById('open-progress'), 'Open progress dialog');
    const dialog = document.getElementById('progress-dialog');
    assert(dialog.open, 'Progress dialog did not open');
    const toolSection = [...dialog.querySelectorAll('.p-section')].find(node => node.querySelector('h3')?.textContent === '工具');
    const axeLabel = [...toolSection.querySelectorAll('.p-grid > span')].find(node => node.textContent === '斧头');
    const axe = axeLabel.nextElementSibling, disclosure = axe.querySelector('.known-level-disclosure');
    assert(disclosure, 'Protected progress needs a direct-known-tier disclosure');
    await click(disclosure.querySelector('summary'), 'Reveal only axe tiers for input');
    const tier = A.D.chains.find(chain => chain.family === '斧头').tiers.at(-1);
    const tierButton = [...disclosure.querySelectorAll('button')].find(node => node.title === tier.zh);
    await click(tierButton, 'Directly enter existing axe tier');
    assert(A.state.progress.tools.斧头 === 4, 'Direct tier entry required intermediate upgrades or wrote the wrong value');
    assert(A.spoilers.active() && !A.spoilers.canView({ type: 'page', id: '姜岛' }), 'Direct tool input must preserve global spoiler protection');
    noOverflow(dialog, 'Progress dialog');
    const progressScroller = dialog.querySelector('.progress-inner');
    progressScroller.scrollTop = progressScroller.scrollHeight; await settle();
    assert(progressScroller.scrollTop + progressScroller.clientHeight >= progressScroller.scrollHeight - 1, 'Progress form cannot be scrolled to its last fields');
    await click(dialog.querySelector('button[aria-label="关闭"]'), 'Close progress dialog');
    assert(!dialog.open, 'Progress dialog close button failed');
    report.push({ scenario: 'direct known-tier input', result: 'axe can jump directly to existing tier without disabling spoiler protection' });
    });
    A.openBrowse(null); await settle(); noOverflow(document.getElementById('browse'), 'Browse home');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Page overflows the viewport');
    assert(document.getElementById('background-music').paused, 'Task flows must not start background audio');
    if (failures.length) throw new Error(JSON.stringify({ viewport: [innerWidth, innerHeight], failures, passed: report }));
    return { viewport: [innerWidth, innerHeight], scenarios: report };
  } finally {
    if (document.getElementById('progress-dialog').open) document.getElementById('progress-dialog').close();
    for (const key of Object.keys(A.state)) delete A.state[key];
    Object.assign(A.state, original);
    A.select(null); A.emit('test:restore'); A.openBrowse(null);
  }
})();
