// Run in the local app with agent-browser eval --stdin < scripts/test_feedback_browser.js, at desktop and phone
// sizes (works on /en/ too, where it also checks the dialog shows no Chinese). The visitor feedback dialog: opened
// from the detail toolbar it attaches the entry with the title the page shows (a protected entry's name never
// appears in the dialog); opened from the header it attaches nothing when no entry is open; an empty message is
// blocked; the sent JSON (fetch stubbed); sending, success, error with retry and copy; drafts survive closing;
// Esc and outside clicks close it and focus returns to the opener; nothing overflows the screen.
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
  const id = zh => Object.entries(A.D.items).find(([, it]) => it.z === zh)[0];
  const saved = structuredClone(A.state), realFetch = window.fetch;
  const calls = [], clip = { text: null, fail: false };
  const reply = (status, body) => { window.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }; };
  const sent = () => JSON.parse(calls.at(-1).init.body);
  const text = el => [el.textContent, ...[...el.querySelectorAll("*")].flatMap(e => [...e.attributes].map(a => a.value)),
    ...[...el.querySelectorAll("input, textarea")].map(e => e.value)].join(" ");
  const english = () => {
    if (A.lang !== "en") return;
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
    const end = [...dialog.querySelectorAll(".d-actions")].find(e => e.getClientRects().length).getBoundingClientRect();
    assert(end.bottom <= dialog.getBoundingClientRect().bottom + 0.5, where + ": the buttons at the end can be scrolled into view");
    dialog.scrollTop = top;
    english();
  };
  const escape = () => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  try {
    await document.fonts.ready;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { if (clip.fail) throw new Error("denied"); clip.text = value; } } });
    A.select(null); A.setConditionsEnabled(false); A.openBrowse(null);
    S.setEnabled(true); A.applyPreset("unknown");
    await pause(200);

    // The header entry is on screen and not covered (on phones the collapsed sheet still shows it).
    const header = $("feedback-open"), hr = header.getBoundingClientRect();
    assert(hr.width && hr.left >= 0 && hr.top >= 0 && hr.right <= innerWidth && hr.bottom <= innerHeight, "the header feedback button is on screen");
    assert(header.contains(document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2)), "the header feedback button is not covered");

    // From the header with no entry open: nothing is attached; accessible modal; focus moves in; Cancel returns focus.
    header.focus(); header.click(); await pause();
    assert(dialog.open && dialog.getAttribute("role") === "dialog" && dialog.getAttribute("aria-modal") === "true", "opens as a modal dialog");
    assert($(dialog.getAttribute("aria-labelledby"))?.textContent.trim() === t("反馈问题或建议"), "the dialog is labelled by its heading");
    assert(dialog.contains(document.activeElement) && document.activeElement !== dialog, "focus moves into the dialog");
    assert($("feedback-about").hidden, "no entry is attached when none is open");
    assert(dialog.querySelectorAll('input[name="kind"]').length === 6, "six problem types");
    fits("from the header");

    // An empty message is blocked before anything is sent.
    reply(200, { ok: true, id: 1 });
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

    // Successful submit: the request and its JSON; sending state; no double submit; success, then focus returns.
    message.value = "  测试：木材的来源少了一条。  ";
    dialog.querySelector('input[name="kind"][value="missing"]').click();
    $("feedback-contact").value = " qq 12345 ";
    let release;
    window.fetch = (url, init) => { calls.push({ url: String(url), init }); return new Promise(resolve => { release = () => resolve(new Response('{"ok":true,"id":7}', { status: 200, headers: { "Content-Type": "application/json" } })); }); };
    send.click(); await pause();
    assert(send.disabled && send.textContent === t("正在发送…") && status.textContent === t("正在发送…"), "shows that it is sending");
    send.click(); form.requestSubmit(); await pause();
    assert(calls.length === 1, "a second click while sending does not send again");
    const call = calls[0], body = JSON.parse(call.init.body);
    assert(call.url === "api/feedback" && new URL(call.url, document.baseURI).pathname === "/api/feedback", "posts to the relative api/feedback");
    assert(call.init.method === "POST" && call.init.headers["Content-Type"] === "application/json", "a JSON POST");
    const version = new URL(document.querySelector('script[src*="js/ui.js"]').src).searchParams.get("v");
    const expected = { kind: "missing", message: "测试：木材的来源少了一条。", contact: "qq 12345", website: "", entry: "item:" + id("木材"), entry_title: shown,
      url: location.href, lang: A.lang, viewport: `${innerWidth}x${innerHeight}`, user_agent: navigator.userAgent, app_version: version };
    for (const [key, value] of Object.entries(expected)) assert(body[key] === value, `sent ${key}: ${JSON.stringify(body[key])} ≠ ${JSON.stringify(value)}`);
    assert(Object.keys(body).length === Object.keys(expected).length && version, "nothing else is sent; the version is the ui.js fingerprint");
    release(); await until(() => !$("feedback-done").hidden, "success");
    assert(form.hidden && document.activeElement === $("feedback-done-close"), "success replaces the form and focuses Close");
    fits("success");
    $("feedback-done-close").click(); await pause();
    assert(!dialog.open && document.activeElement === toolbarButton && !detail.hidden, "Close returns to the toolbar button, the entry stays open");
    toolbarButton.click(); await pause();
    assert(!form.hidden && !message.value && !form.elements.kind.value && $("feedback-attach").checked, "after sending, the form starts empty");

    // Not attaching the entry drops it from the report and from the address.
    message.value = "不附上条目的反馈"; $("feedback-attach").click();
    reply(200, { ok: true, id: 8 }); send.click(); await until(() => !$("feedback-done").hidden, "second success");
    assert(sent().entry === "" && sent().entry_title === "" && sent().url === location.href.split("#")[0] && sent().kind === "other", "unchecked: no entry, no #entry in the address, type “other”");
    $("feedback-done-close").click(); await pause();

    // Errors: offline, then rate limited; retry and copy; the failed state and draft survive closing; retry succeeds.
    toolbarButton.click(); await pause();
    message.value = "发不出去的反馈";
    window.fetch = async (url, init) => { calls.push({ url: String(url), init }); throw new TypeError("Failed to fetch"); };
    send.click(); await until(() => status.classList.contains("is-error"), "network error");
    assert(status.textContent === t("没能发送：暂时连不上反馈服务。可以点“重试”，或者复制内容稍后再发。") && send.textContent === t("重试") && !copy.hidden && !send.disabled, "offline: error with retry and copy");
    fits("error");
    copy.click(); await until(() => clip.text, "copy");
    assert(clip.text === "发不出去的反馈\n\n" + t("关于：{title}", { title: shown }) && status.textContent === t("已复制到剪贴板。"), "copies the message with the shown title");
    clip.fail = true; copy.click(); await until(() => status.textContent === t("已选中文字，请手动复制。"), "copy fallback");
    assert(document.activeElement === message && message.selectionStart === 0 && message.selectionEnd === message.value.length, "without the clipboard the text is selected");
    reply(429, { ok: false, error: "rate_limited" }); send.click();
    await until(() => status.textContent === t("没能发送：短时间内发送太多次了，请过几分钟再点“重试”；也可以先复制内容。"), "rate limited");
    $("feedback-close").click(); await pause(); toolbarButton.click(); await pause();
    assert(message.value === "发不出去的反馈" && send.textContent === t("重试") && !copy.hidden && status.classList.contains("is-error"), "reopening keeps the draft and the retry");
    reply(200, { ok: true, id: 9 }); send.click(); await until(() => !$("feedback-done").hidden, "retry");
    assert(sent().message === "发不出去的反馈" && calls.length === 5, "retry sends the same text");
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
      message.value = "受保护条目的反馈"; reply(500, { ok: false, error: "server_error" }); send.click();
      await until(() => status.classList.contains("is-error"), "server error"); copy.click(); await pause();
      for (const name of ["姜岛", "Ginger"]) assert(!text(dialog).includes(name), `the dialog never shows the protected name ${name}`);
      assert(sent().entry === "page:姜岛" && sent().entry_title === t("尚未确认探索的内容"), "only the report carries the entry reference");
      $("feedback-cancel").click(); await pause();
    }
    return JSON.stringify({ result: "header and toolbar entries, attached shown title, protected names hidden, empty message blocked, sent JSON, sending/success/error/retry/copy, drafts, Esc and outside click, focus return, fits the screen", calls: calls.length, viewport: [innerWidth, innerHeight], lang: A.lang });
  } finally {
    // Leave no draft or failed state behind: one more (stubbed) successful send resets the dialog.
    if (message.value || send.textContent !== t("发送")) {
      window.fetch = async () => new Response('{"ok":true}', { status: 200 });
      if (!dialog.open) A.feedback.open();
      message.value = "reset"; send.click();
      await until(() => !$("feedback-done").hidden, "reset").catch(() => {});
    }
    window.fetch = realFetch;
    delete navigator.clipboard;
    A.feedback.close();
    A.select(null);
    Object.assign(A.state, saved);
    S.setEnabled(saved.spoilers?.enabled !== false);
  }
})();
