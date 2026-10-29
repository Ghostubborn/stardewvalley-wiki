// Run in the local app with agent-browser eval --stdin < scripts/test_feedback_browser.js, at desktop and phone
// sizes (works on /en/ too, where it also checks the dialog shows no Chinese). The visitor feedback dialog, against
// a fake backend (fetch stubbed): opened from the detail toolbar it attaches the entry with the title the page shows
// (a protected entry's name never appears in the dialog); opened from the header it attaches nothing when no entry
// is open; an empty message is blocked; the sent JSON and the visitor token; sending, success, error with retry and
// copy; drafts survive closing; Esc and outside clicks close it and focus returns to the opener; nothing overflows.
// “My feedback”: tabs and their keys; the empty state; threads from every token, newest first, with status,
// replies and a dot for unseen replies (also on the header button, which then opens this tab); a thread and its
// follow-ups, with errors; loading errors and retry; copying the view link. The visitor's tokens are put back after.
(async () => {
  const A = App, S = A.spoilers, t = A.t;
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, message, ms = 3000) => {
    for (const end = Date.now() + ms; Date.now() < end; await pause(20)) if (fn()) return;
    throw new Error("Timed out: " + message);
  };
  const $ = id => document.getElementById(id);
  const dialog = $("feedback-dialog"), form = $("feedback-form"), message = $("feedback-message"), send = $("feedback-send");
  const status = $("feedback-status"), copy = $("feedback-copy"), detail = $("detail");
  const tabNew = $("feedback-tab-new"), tabMine = $("feedback-tab-mine"), list = $("feedback-threads"), mineStatus = $("feedback-mine-status");
  const replyBox = $("feedback-reply"), replySend = $("feedback-reply-send"), replyStatus = $("feedback-reply-status");
  const id = zh => Object.entries(A.D.items).find(([, it]) => it.z === zh)[0];
  const en = A.lang === "en", say = (zh, english) => en ? english : zh;
  const saved = structuredClone(A.state), realFetch = window.fetch;
  const KEYS = ["sdv-feedback-tokens", "sdv-feedback-seen"], stored = KEYS.map(key => [key, localStorage.getItem(key)]);
  const tokens = () => JSON.parse(localStorage.getItem("sdv-feedback-tokens") || "[]");
  const clip = { text: null, fail: false };

  // Fake backend: api/feedback stores threads under the sent token (or answers with `respond`), mine lists a token's
  // threads, reply adds a follow-up. server.mine / server.reply override those answers.
  const calls = [], posts = () => calls.filter(c => c.url === "api/feedback"), sent = () => JSON.parse(posts().at(-1).init.body);
  const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } });
  const server = { threads: [], next: 1, mine: null, reply: null };
  const created = (url, init) => {
    const body = JSON.parse(init.body), at = new Date().toISOString(), thread = server.next++;
    server.threads.push({ id: thread, token: init.headers["X-Feedback-Token"], created_at: at, updated_at: at, kind: body.kind, message: body.message,
      entry: body.entry || null, entry_title: body.entry_title || null, status: "new", messages: [] });
    return json(200, { ok: true, id: thread });
  };
  let respond = created;
  window.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const token = init.headers?.["X-Feedback-Token"];
    if (url === "api/feedback/mine") {
      if (server.mine) return server.mine();
      return json(200, { ok: true, threads: server.threads.filter(th => th.token === token).sort((a, b) => b.id - a.id).map(({ token: _, ...th }) => structuredClone(th)) });
    }
    if (url === "api/feedback/reply") {
      if (server.reply) return server.reply();
      const body = JSON.parse(init.body), thread = server.threads.find(th => th.id === body.id && th.token === token);
      if (!thread) return json(404, { ok: false, error: "not_found" });
      const at = new Date().toISOString(), message = server.next++;
      thread.messages.push({ id: message, created_at: at, author: "visitor", message: body.message });
      Object.assign(thread, { status: "new", updated_at: at });
      return json(200, { ok: true, id: message, created_at: at });
    }
    return respond(url, init);
  };

  const text = el => [el.textContent, ...[...el.querySelectorAll("*")].flatMap(e => [...e.attributes].map(a => a.value)),
    ...[...el.querySelectorAll("input, textarea")].map(e => e.value)].join(" ");
  const english = () => {
    if (!en) return;
    const shown = [...dialog.querySelectorAll("*")].filter(e => e.getClientRects().length)
      .map(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join("") + " " + ["placeholder", "aria-label", "title"].map(a => e.getAttribute(a) || "").join(" "));
    assert(!/[㐀-鿿]/.test(shown.join(" ")), "the English dialog shows no Chinese: " + shown.join(" ").match(/.{0,20}[㐀-鿿].{0,20}/)?.[0]);
  };
  const fits = where => {
    const r = dialog.getBoundingClientRect();
    assert(r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, where + ": the dialog stays inside the viewport");
    assert(dialog.scrollWidth <= dialog.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1, where + ": nothing scrolls sideways");
    const top = dialog.scrollTop;
    dialog.scrollTop = dialog.scrollHeight;
    const end = [...dialog.querySelectorAll(".d-actions")].filter(e => e.getClientRects().length).at(-1)?.getBoundingClientRect();
    assert(!end || end.bottom <= dialog.getBoundingClientRect().bottom + 0.5, where + ": the buttons at the end can be scrolled into view");
    dialog.scrollTop = top;
    english();
  };
  const escape = () => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  const key = (el, name) => el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  const selected = () => [tabNew, tabMine].filter(tab => tab.getAttribute("aria-selected") === "true");
  const headerDot = () => $("feedback-open").querySelector(".feedback-dot");
  const card = thread => list.querySelector(`.feedback-thread[data-id="${thread}"]`);
  try {
    await document.fonts.ready;
    for (const name of KEYS) localStorage.removeItem(name);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { if (clip.fail) throw new Error("denied"); clip.text = value; } } });
    A.select(null); A.setConditionsEnabled(false); A.openBrowse(null);
    S.setEnabled(true); A.applyPreset("unknown");
    await A.feedback.refresh();
    await pause(200);

    // The header entry is on screen and not covered (on phones the collapsed sheet still shows it); no dot yet.
    const header = $("feedback-open"), hr = header.getBoundingClientRect();
    assert(hr.width && hr.left >= 0 && hr.top >= 0 && hr.right <= innerWidth && hr.bottom <= innerHeight, "the header feedback button is on screen");
    assert(header.contains(document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2)), "the header feedback button is not covered");
    assert(headerDot().hidden, "no dot without replies");

    // From the header with no entry open: nothing is attached; accessible modal with two tabs; focus moves in; Cancel returns focus.
    header.focus(); header.click(); await pause();
    assert(dialog.open && dialog.getAttribute("role") === "dialog" && dialog.getAttribute("aria-modal") === "true", "opens as a modal dialog");
    assert($(dialog.getAttribute("aria-labelledby"))?.textContent.trim() === t("反馈问题或建议"), "the dialog is labelled by its heading");
    assert(dialog.contains(document.activeElement) && document.activeElement !== dialog, "focus moves into the dialog");
    assert(dialog.querySelector('[role="tablist"]') && selected().length === 1 && selected()[0] === tabNew && !$("feedback-new").hidden && $("feedback-mine").hidden, "opens on “New feedback”");
    assert(tabNew.tabIndex === 0 && tabMine.tabIndex === -1 && $(tabNew.getAttribute("aria-controls")) === $("feedback-new"), "tabs use roving focus and name their panels");
    assert($("feedback-about").hidden, "no entry is attached when none is open");
    assert(dialog.querySelectorAll('input[name="kind"]').length === 6, "six problem types");
    fits("from the header");

    // Tabs: arrow keys, Home and End switch and focus. Without a token “My feedback” explains itself and asks nothing.
    tabNew.focus(); key(tabNew, "ArrowRight"); await pause();
    assert(selected()[0] === tabMine && document.activeElement === tabMine && $("feedback-new").hidden && !$("feedback-mine").hidden, "ArrowRight selects “My feedback”");
    assert(mineStatus.textContent === t("还没有反馈。发送之后，处理进度和我们的回复会显示在这里，也可以接着补充。") && !list.children.length && $("feedback-link").hidden, "the empty state");
    assert(!calls.length, "nothing is fetched without a token");
    fits("empty list");
    key(tabMine, "Home"); await pause();
    assert(selected()[0] === tabNew && document.activeElement === tabNew, "Home goes back to “New feedback”");
    key(tabNew, "End"); await pause(); key(tabMine, "ArrowLeft"); await pause();
    assert(selected()[0] === tabNew, "End and ArrowLeft");

    // An empty message is blocked before anything is sent.
    message.value = "  "; send.click(); await pause();
    assert(!calls.length && message.getAttribute("aria-invalid") === "true" && status.textContent === t("请先写下要反馈的内容（至少 2 个字）。"), "an empty message is not sent");
    assert(document.activeElement === message, "focus goes to the message");
    message.value = "草稿"; message.dispatchEvent(new Event("input", { bubbles: true }));
    assert(!message.hasAttribute("aria-invalid") && !status.textContent, "typing clears the error");
    $("feedback-cancel").click(); await pause();
    assert(!dialog.open && document.activeElement === header, "Cancel closes and returns focus to the header button");

    // From the detail toolbar: the shown title is attached, and drafts survive closing.
    A.select({ type: "item", id: id("木材") }, { from: "browse" }); await pause(200);
    const bar = detail.querySelector(".detail-toolbar"), toolbarButton = $("detail-feedback");
    assert(bar.scrollWidth <= bar.clientWidth + 1 && toolbarButton.getClientRects().length, "the toolbar has room for “Feedback”");
    toolbarButton.focus(); toolbarButton.click(); await pause();
    const shown = $("detail-title").textContent.trim();
    assert(!$("feedback-about").hidden && $("feedback-attach").checked, "the entry is attached by default");
    assert($("feedback-about-text").textContent === t("关于：{title}", { title: shown }), "the attached title matches the title on the page");
    assert(message.value === "草稿", "the draft is kept");
    fits("from the toolbar");

    // Successful submit: the request, its JSON and a new visitor token; sending state; no double submit; success.
    message.value = "  测试：木材的来源少了一条。  ";
    dialog.querySelector('input[name="kind"][value="missing"]').click();
    $("feedback-contact").value = " qq 12345 ";
    let release;
    respond = (url, init) => new Promise(resolve => { release = () => resolve(created(url, init)); });
    send.click(); await pause();
    assert(send.disabled && send.textContent === t("正在发送…") && status.textContent === t("正在发送…"), "shows that it is sending");
    send.click(); form.requestSubmit(); await pause();
    assert(posts().length === 1, "a second click while sending does not send again");
    const call = posts()[0], body = JSON.parse(call.init.body);
    assert(new URL(call.url, document.baseURI).pathname === "/api/feedback", "posts to the relative api/feedback");
    assert(call.init.method === "POST" && call.init.headers["Content-Type"] === "application/json", "a JSON POST");
    const own = call.init.headers["X-Feedback-Token"];
    assert(/^[A-Za-z0-9_-]{32}$/.test(own) && tokens().length === 1 && tokens()[0] === own, "the first report creates and keeps a random visitor token");
    const version = new URL(document.querySelector('script[src*="js/ui.js"]').src).searchParams.get("v");
    const expected = { kind: "missing", message: "测试：木材的来源少了一条。", contact: "qq 12345", website: "", entry: "item:" + id("木材"), entry_title: shown,
      url: location.href, lang: A.lang, viewport: `${innerWidth}x${innerHeight}`, user_agent: navigator.userAgent, app_version: version };
    for (const [name, value] of Object.entries(expected)) assert(body[name] === value, `sent ${name}: ${JSON.stringify(body[name])} ≠ ${JSON.stringify(value)}`);
    assert(Object.keys(body).length === Object.keys(expected).length && version, "nothing else is sent; the version is the ui.js fingerprint");
    release(); await until(() => !$("feedback-done").hidden, "success");
    assert(form.hidden && document.activeElement === $("feedback-done-mine"), "success replaces the form and focuses “View my feedback”");
    fits("success");
    $("feedback-done-close").click(); await pause();
    assert(!dialog.open && document.activeElement === toolbarButton && !detail.hidden, "Close returns to the toolbar button, the entry stays open");
    toolbarButton.click(); await pause();
    assert(!form.hidden && !message.value && !form.elements.kind.value && $("feedback-attach").checked, "after sending, the form starts empty");

    // Not attaching the entry drops it from the report and from the address; the same token is used again.
    message.value = "不附上条目的反馈"; $("feedback-attach").click();
    respond = created; send.click(); await until(() => !$("feedback-done").hidden, "second success");
    assert(sent().entry === "" && sent().entry_title === "" && sent().url === location.href.split("#")[0] && sent().kind === "other", "unchecked: no entry, no #entry in the address, type “other”");
    assert(posts().at(-1).init.headers["X-Feedback-Token"] === own && tokens().length === 1, "later reports reuse the token");

    // “View my feedback” shows what was just sent, newest first.
    $("feedback-done-mine").click(); await until(() => list.children.length === 2, "the new threads");
    assert(selected()[0] === tabMine && document.activeElement === tabMine && !mineStatus.textContent, "“View my feedback” switches tabs");
    assert(card(2).textContent.includes("不附上条目的反馈") && list.firstElementChild.contains(card(2)), "the latest report is first");
    assert(card(1).querySelector(".feedback-chip").textContent === t("待处理") && card(1).textContent.includes(t("关于：{title}", { title: shown })), "status and attached title");
    assert(!$("feedback-link").hidden && headerDot().hidden, "the view link is offered; no dot for one's own reports");
    tabNew.click(); await pause();
    assert(!form.hidden && $("feedback-done").hidden, "back on “New feedback” the form is ready again");
    $("feedback-cancel").click(); await pause();

    // Errors: offline, then rate limited; retry and copy; the failed state and draft survive closing; retry succeeds.
    toolbarButton.click(); await pause();
    message.value = "发不出去的反馈";
    respond = async () => { throw new TypeError("Failed to fetch"); };
    send.click(); await until(() => status.classList.contains("is-error"), "network error");
    assert(status.textContent === t("没能发送：暂时连不上反馈服务。可以点“重试”，或者复制内容稍后再发。") && send.textContent === t("重试") && !copy.hidden && !send.disabled, "offline: error with retry and copy");
    fits("error");
    copy.click(); await until(() => clip.text, "copy");
    assert(clip.text === "发不出去的反馈\n\n" + t("关于：{title}", { title: shown }) && status.textContent === t("已复制到剪贴板。"), "copies the message with the shown title");
    clip.fail = true; copy.click(); await until(() => status.textContent === t("已选中文字，请手动复制。"), "copy fallback");
    assert(document.activeElement === message && message.selectionStart === 0 && message.selectionEnd === message.value.length, "without the clipboard the text is selected");
    clip.fail = false;
    respond = () => json(429, { ok: false, error: "rate_limited" }); send.click();
    await until(() => status.textContent === t("没能发送：短时间内发送太多次了，请过几分钟再点“重试”；也可以先复制内容。"), "rate limited");
    $("feedback-close").click(); await pause(); toolbarButton.click(); await pause();
    assert(message.value === "发不出去的反馈" && send.textContent === t("重试") && !copy.hidden && status.classList.contains("is-error"), "reopening keeps the draft and the retry");
    respond = created; send.click(); await until(() => !$("feedback-done").hidden, "retry");
    assert(sent().message === "发不出去的反馈" && posts().length === 5, "retry sends the same text");
    $("feedback-done-close").click(); await pause();

    // Esc closes only the dialog; outside clicks close it, clicks inside the frame and drags out of it do not.
    toolbarButton.click(); await pause(); escape(); await pause();
    assert(!dialog.open && !detail.hidden && document.activeElement === toolbarButton, "Esc closes the dialog, keeps the entry and returns focus");
    toolbarButton.click(); await pause();
    const r = dialog.getBoundingClientRect(), at = (x, y) => ({ clientX: x, clientY: y, bubbles: true });
    dialog.dispatchEvent(new PointerEvent("pointerdown", at(r.left + 3, r.top + 3))); dialog.dispatchEvent(new MouseEvent("click", at(r.left + 3, r.top + 3)));
    assert(dialog.open, "a click on the frame keeps it open");
    message.dispatchEvent(new PointerEvent("pointerdown", at(r.left + 40, r.top + r.height / 2))); dialog.dispatchEvent(new MouseEvent("click", at(r.left - 6, r.top - 6)));
    assert(dialog.open, "selecting text and releasing outside keeps it open");
    dialog.dispatchEvent(new PointerEvent("pointerdown", at(r.left - 6, r.top - 6))); dialog.dispatchEvent(new MouseEvent("click", at(r.left - 6, r.top - 6)));
    assert(!dialog.open && document.activeElement === toolbarButton, "a click outside closes it and returns focus");

    // Spoiler protection: a protected entry is attached only by the neutral title the page shows.
    A.select({ type: "page", id: "姜岛" }, { from: "search" }); await pause(200);
    assert($("detail-title").textContent === t("尚未确认探索的内容"), "the entry is protected");
    for (const opener of [toolbarButton, header]) {
      opener.click(); await pause();
      assert($("feedback-about-text").textContent === t("关于：{title}", { title: t("尚未确认探索的内容") }), "the neutral title is attached");
      message.value = "受保护条目的反馈"; respond = () => json(500, { ok: false, error: "server_error" }); send.click();
      await until(() => status.classList.contains("is-error"), "server error"); copy.click(); await pause();
      for (const name of ["姜岛", "Ginger"]) assert(!text(dialog).includes(name), `the dialog never shows the protected name ${name}`);
      assert(sent().entry === "page:姜岛" && sent().entry_title === t("尚未确认探索的内容"), "only the report carries the entry reference");
      $("feedback-cancel").click(); await pause();
    }
    respond = created; A.feedback.open(); message.value = "reset"; send.click();
    await until(() => !$("feedback-done").hidden, "reset"); A.feedback.close(); A.select(null); await pause(100);

    // Replies: threads under this browser's token and under a token added from a view link. Unseen replies put a dot
    // on the header button, which then opens “My feedback”.
    const other = "linkToken_" + "x".repeat(22), ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
    localStorage.setItem("sdv-feedback-tokens", JSON.stringify([own, other]));
    server.threads = [
      { id: 101, token: own, created_at: ago(4000), updated_at: ago(60), kind: "error", message: say("鲶鱼的季节写错了。\n秋天的雨天也能钓到。", "The catfish seasons are wrong.\nIt bites on rainy fall days too."),
        entry: "fish:鲶鱼", entry_title: say("鲶鱼", "Catfish"), status: "replied", messages: [{ id: 501, created_at: ago(60), author: "team", message: say("谢谢，已经改好了。", "Thanks, it's fixed now.") }] },
      { id: 102, token: own, created_at: ago(3000), updated_at: ago(3000), kind: "idea", message: say("希望能按季节筛选。", "Please add a season filter."), entry: null, entry_title: null, status: "new", messages: [] },
      { id: 103, token: other, created_at: ago(9000), updated_at: ago(7000), kind: "display", message: say("手机上按钮太小。", "The buttons are too small on phones."), entry: null, entry_title: null, status: "done",
        messages: [{ id: 502, created_at: ago(7000), author: "team", message: say("已经放大了。", "They're bigger now.") }] },
    ];
    await A.feedback.refresh();
    assert(!headerDot().hidden && headerDot().textContent === t("有新回复"), "the header shows a dot, named for screen readers");
    assert(calls.filter(c => c.url === "api/feedback/mine").slice(-2).map(c => c.init.headers["X-Feedback-Token"]).sort().join() === [own, other].sort().join(), "one request per token");
    header.click(); await until(() => list.children.length === 3, "threads");
    assert(selected()[0] === tabMine && document.activeElement === tabMine && !tabMine.querySelector(".feedback-dot").hidden, "the header opens “My feedback” when there are replies");
    assert([...list.querySelectorAll(".feedback-thread")].map(b => b.dataset.id).join() === "101,102,103", "newest activity first, across tokens");
    assert(card(101).querySelector(".feedback-dot") && card(103).querySelector(".feedback-dot") && !card(102).querySelector(".feedback-dot"), "dots on the threads with unseen replies");
    assert(card(101).querySelector(".feedback-chip").textContent === t("已回复") && card(103).querySelector(".feedback-chip").textContent === t("已处理"), "statuses");
    assert(card(101).textContent.includes(t("{n} 条回复", { n: 1 })) && card(101).textContent.includes(t("关于：{title}", { title: say("鲶鱼", "Catfish") })), "reply count and entry");
    assert(card(101).querySelector("time").getAttribute("datetime") === server.threads[0].updated_at, "a machine-readable time");
    fits("list");

    // A thread: the report and the replies in order; opening it marks it seen (the other unseen one keeps the dot).
    card(101).click(); await pause();
    assert($("feedback-list-view").hidden && !$("feedback-thread-view").hidden && document.activeElement === $("feedback-thread-title"), "the thread opens with focus on its title");
    assert($("feedback-thread-title").textContent === dialog.querySelector('input[value="error"]').parentElement.textContent.trim(), "titled by its type");
    const said = () => [...dialog.querySelectorAll(".feedback-messages li")].map(li => [li.className, li.querySelector(".feedback-meta b").textContent, li.querySelector(".feedback-text").textContent]);
    assert(JSON.stringify(said()) === JSON.stringify([["from-visitor", t("我"), server.threads[0].message], ["from-team", t("维护者"), say("谢谢，已经改好了。", "Thanks, it's fixed now.")]]), "the report, then the reply");
    assert(getComputedStyle(dialog.querySelector(".feedback-text")).whiteSpace === "pre-wrap", "line breaks are kept");
    const stray = () => [$("feedback-thread"), list, ...list.querySelectorAll(".feedback-thread")].some(box => [...box.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()));
    assert(!stray(), "no stray text (false, null) in the thread or the list");
    assert(!headerDot().hidden && JSON.parse(localStorage.getItem("sdv-feedback-seen"))["101"] === server.threads[0].updated_at, "seen is remembered; another thread is still unseen");
    fits("thread");
    $("feedback-back").click(); await pause();
    assert(!$("feedback-list-view").hidden && document.activeElement === card(101) && !card(101).querySelector(".feedback-dot"), "Back returns to the card, now without a dot");
    card(103).click(); await pause(); $("feedback-back").click(); await pause();
    assert(headerDot().hidden && tabMine.querySelector(".feedback-dot").hidden, "no dots once every reply is seen");

    // Follow-ups: blocked when empty; sent with the thread's own token; the thread is open again and waits for us.
    card(103).click(); await pause();
    replyBox.value = " "; replySend.click(); await pause();
    assert(replyBox.getAttribute("aria-invalid") === "true" && replyStatus.textContent === t("请先写下要补充的内容（至少 2 个字）。") && document.activeElement === replyBox, "an empty follow-up is not sent");
    replyBox.value = say("  平板上也一样。  ", "  Same on tablets.  "); replyBox.dispatchEvent(new Event("input", { bubbles: true }));
    assert(!replyBox.hasAttribute("aria-invalid") && !replyStatus.textContent, "typing clears the error");
    replySend.click(); await until(() => replyStatus.textContent === t("已发送。"), "follow-up");
    const followUp = calls.filter(c => c.url === "api/feedback/reply").at(-1);
    assert(followUp.init.method === "POST" && followUp.init.headers["X-Feedback-Token"] === other && JSON.stringify(JSON.parse(followUp.init.body)) === JSON.stringify({ id: 103, message: say("平板上也一样。", "Same on tablets.") }), "posts {id, message} with the thread's token");
    assert(said().at(-1)[0] === "from-visitor" && said().at(-1)[2] === say("平板上也一样。", "Same on tablets.") && !replyBox.value, "the follow-up appears and the box empties");
    assert($("feedback-thread").querySelector(".feedback-chip").textContent === t("待处理") && $("feedback-thread").querySelector(".feedback-waiting").textContent === t("已收到，维护者回复后会显示在这里。"), "open again, waiting for a reply");
    assert(!stray(), "no stray text in a thread without an entry");
    assert(headerDot().hidden, "one's own follow-up is not news");
    fits("follow-up");
    for (const [answer, shownText] of [
      [() => json(429, { ok: false, error: "rate_limited" }), t("没能发送：短时间内发送太多次了，请过几分钟再试。")],
      [() => json(404, { ok: false, error: "not_found" }), t("没能发送：找不到这条反馈。")],
      [() => json(400, { ok: false, error: "message_too_long" }), t("没能发送：内容太长或格式不对，请删减后再试。")],
      [async () => { throw new TypeError("Failed to fetch"); }, t("没能发送：暂时连不上反馈服务，请稍后再试。")],
    ]) {
      server.reply = answer; replyBox.value = "第二次补充"; replySend.click();
      await until(() => replyStatus.textContent === shownText, shownText);
      assert(replyStatus.classList.contains("is-error") && replyBox.value === "第二次补充" && !replySend.disabled, "the error keeps the text: " + shownText);
    }
    server.reply = null;
    $("feedback-back").click(); await pause();
    assert([...list.querySelectorAll(".feedback-thread")][0].dataset.id === "103", "the thread with the follow-up moves to the top");
    card(101).click(); await pause();
    assert(!replyBox.value && !replyStatus.textContent, "another thread starts with an empty box");
    $("feedback-back").click(); await pause();

    // A reply that arrives later: the next refresh shows the dot again.
    Object.assign(server.threads[2], { status: "replied", updated_at: new Date(Date.now() + 1000).toISOString() });
    server.threads[2].messages.push({ id: 503, created_at: server.threads[2].updated_at, author: "team", message: say("平板也改好了。", "Tablets too.") });
    await A.feedback.refresh();
    assert(!headerDot().hidden, "a new reply brings the dot back");

    // Loading errors keep what was loaded before; without anything loaded they offer a retry.
    server.mine = () => json(500, { ok: false, error: "server_error" });
    tabNew.click(); tabMine.click(); await until(() => mineStatus.classList.contains("is-error"), "refresh error");
    assert(mineStatus.textContent === t("没能刷新，下面是之前读到的内容。") && list.children.length === 3 && !$("feedback-retry-row").hidden, "an old list stays with a note");
    server.mine = null; $("feedback-retry").click(); await until(() => !mineStatus.textContent, "retry");
    assert($("feedback-retry-row").hidden && list.children.length === 3, "retry reloads");

    // The view link carries this browser's own token; without the clipboard it is shown, selected.
    $("feedback-copy-link").click(); await until(() => clip.text?.includes("?fbk="), "copy link");
    assert(clip.text === location.origin + location.pathname + "?fbk=" + own && $("feedback-link-status").textContent === t("已复制查看链接。"), "copies the view link for this page");
    clip.fail = true; $("feedback-copy-link").click(); await until(() => !$("feedback-link-field").hidden, "link fallback");
    const field = $("feedback-link-field");
    assert(field.value === clip.text && document.activeElement === field && field.selectionEnd === field.value.length && $("feedback-link-status").textContent === t("已选中链接，请手动复制。"), "the link is shown and selected");
    clip.fail = false;
    fits("view link");
    $("feedback-close").click(); await pause();
    assert(!dialog.open && document.activeElement === header, "closing returns to the header button");
    return JSON.stringify({ result: "header and toolbar entries, attached shown title, protected names hidden, empty message blocked, sent JSON and token, sending/success/error/retry/copy, drafts, Esc and outside click, focus return, tabs, my feedback list/thread/follow-ups/dots/errors/view link, fits the screen", requests: calls.length, viewport: [innerWidth, innerHeight], lang: A.lang });
  } finally {
    // Leave no draft, failed state, token or open dialog behind.
    if (message.value || send.textContent !== t("发送")) {
      respond = () => json(200, { ok: true });
      if (!dialog.open) A.feedback.open();
      message.value = "reset"; send.click();
      await until(() => !$("feedback-done").hidden, "reset").catch(() => {});
    }
    window.fetch = realFetch;
    delete navigator.clipboard;
    A.feedback.close();
    $("feedback-link-field").hidden = true;
    $("feedback-link-status").textContent = "";
    for (const [name, value] of stored) value == null ? localStorage.removeItem(name) : localStorage.setItem(name, value);
    await A.feedback.refresh().catch(() => {});
    A.select(null);
    Object.assign(A.state, saved);
    S.setEnabled(saved.spoilers?.enabled !== false);
  }
})();
