/* 访客反馈：页头和详情工具栏的“反馈”打开同一个对话框（后端在 functions/api/feedback/，存进 D1）。
   “写反馈”提交到 api/feedback；“我的反馈”列出这个浏览器提交过的反馈、处理状态和维护者的回复，可以接着补充
   （api/feedback/mine、api/feedback/reply）。不用登录：第一次发送时在浏览器里随机生成一个令牌，服务端只存它的摘要；
   “复制查看链接”（?fbk=令牌）把它带到别的设备。
   附上的条目只显示页面上已经显示的标题，受保护条目的名称不会出现在对话框里；条目引用只随反馈发送。 */
(function () {
  "use strict";
  const App = window.App;
  const { t, el } = App;
  const $ = id => document.getElementById(id);
  const dialog = $("feedback-dialog"), form = $("feedback-form"), message = $("feedback-message");
  const status = $("feedback-status"), send = $("feedback-send"), copy = $("feedback-copy");
  const aboutRow = $("feedback-about"), attach = $("feedback-attach");
  const tabs = { new: $("feedback-tab-new"), mine: $("feedback-tab-mine") }, panels = { new: $("feedback-new"), mine: $("feedback-mine") };
  const threadList = $("feedback-threads"), mineStatus = $("feedback-mine-status"), threadBox = $("feedback-thread");
  const replyBox = $("feedback-reply"), replyStatus = $("feedback-reply-status"), replySend = $("feedback-reply-send");
  const linkField = $("feedback-link-field"), linkStatus = $("feedback-link-status");
  // 版本：ui.js 地址上的内容指纹（?v=），每次构建都会变。
  const version = (() => {
    try { return new URL(document.querySelector('script[src*="js/ui.js"]').src).searchParams.get("v") || ""; } catch (e) { return ""; }
  })();
  // state：idle 可以发送；sending 正在发送；failed 上次没发出去（重新打开时仍显示“重试”和“复制内容”）。
  let opener = null, about = null, state = "idle";
  // threads：最近一次读到的“我的反馈”（还没读过时是 null）；shown：正在看的那条的 id。
  let tab = "new", threads = null, loading = null, shown = null, replying = false;

  // 令牌和已读记录存在 localStorage；存不进去时（部分隐私模式）只在这次打开的页面里有效。
  const TOKENS = "sdv-feedback-tokens", SEEN = "sdv-feedback-seen", TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;
  const memory = {};
  function load(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (value != null) return value;
    } catch (e) { /* 隐私模式 */ }
    return memory[key];
  }
  function save(key, value) {
    memory[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式 */ }
  }
  // 第一个令牌用来发送新反馈；从查看链接加进来的排在后面。
  function tokens() {
    const list = load(TOKENS);
    return Array.isArray(list) ? list.filter(token => typeof token === "string" && TOKEN_RE.test(token)) : [];
  }
  function ownToken() {
    const list = tokens();
    if (list.length) return list[0];
    // 24 个随机字节，写成 base64url（32 个字符）。
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_");
    save(TOKENS, [token]);
    return token;
  }
  function addToken(token) {
    const list = tokens();
    if (!list.includes(token)) save(TOKENS, [...list, token]);
  }
  function seen() {
    const marks = load(SEEN);
    return marks && typeof marks === "object" && !Array.isArray(marks) ? marks : {};
  }

  // 请求反馈接口，20 秒超时。离线、超时或本地静态预览（没有后端）时 error 是 "network"。
  async function api(path, token, body) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
    const headers = body ? { "Content-Type": "application/json" } : {};
    if (token) headers["X-Feedback-Token"] = token;
    try {
      const res = await fetch(path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, signal: abort.signal });
      const data = await res.json().catch(() => null);
      return res.ok && data?.ok ? data : { ok: false, error: data?.error || "unavailable" };
    } catch (e) {
      return { ok: false, error: "network" };
    } finally {
      clearTimeout(timer);
    }
  }

  // ———————————————————— 写反馈 ————————————————————
  function shownEntry() {
    const ref = App.currentRef?.(), title = $("detail-title")?.textContent.trim();
    return ref && !$("detail").hidden && title ? { entry: `${ref.type}:${ref.id}`, title } : null;
  }
  function setStatus(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }
  // 打开：从详情或页头打开都附上正在看的条目（可取消）；没发出去的草稿保留到下次打开。
  // 默认是“写反馈”；有新回复时，从页头打开直接看“我的反馈”。
  function open(trigger, options = {}) {
    if (!dialog.open) opener = trigger || document.activeElement;
    about = shownEntry();
    aboutRow.hidden = !about;
    attach.checked = true;
    $("feedback-about-text").textContent = about ? t("关于：{title}", { title: about.title }) : "";
    if (state === "idle") { setStatus(""); copy.hidden = true; send.textContent = t("发送"); }
    const which = options.tab || (trigger === $("feedback-open") && threads?.some(thread => fresh(thread)) ? "mine" : "new");
    selectTab(which);
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    // 触屏上先不弹出键盘，免得挡住类型和说明。
    if (which === "mine") tabs.mine.focus();
    else (matchMedia("(pointer: fine)").matches ? message : $("feedback-dialog-title")).focus();
  }
  function close() {
    if (dialog.open) dialog.close();
  }
  function payload(text) {
    const withEntry = !!about && attach.checked;
    return {
      kind: form.elements.kind.value || "other",
      message: text,
      contact: $("feedback-contact").value.trim(),
      website: $("feedback-website").value,
      entry: withEntry ? about.entry : "",
      entry_title: withEntry ? about.title : "",
      // 不附上条目时，地址也去掉 # 后面的条目。
      url: (withEntry ? location.href : location.href.split("#")[0]).slice(0, 1000),
      lang: App.lang,
      viewport: `${innerWidth}x${innerHeight}`,
      user_agent: navigator.userAgent.slice(0, 400),
      app_version: version,
    };
  }
  async function submit() {
    if (state === "sending") return;
    const text = message.value.trim();
    if (text.length < 2) {
      message.setAttribute("aria-invalid", "true");
      setStatus(t("请先写下要反馈的内容（至少 2 个字）。"), true);
      message.focus();
      return;
    }
    message.removeAttribute("aria-invalid");
    state = "sending";
    send.disabled = true;
    send.textContent = t("正在发送…");
    setStatus(t("正在发送…"));
    copy.hidden = true;
    const result = await api("api/feedback", ownToken(), payload(text));
    send.disabled = false;
    if (!result.ok) return failed(result.error);
    done();
    // 先在后台读一次，访客点“查看我的反馈”时就能看到刚发的这条。
    refresh();
  }
  function done() {
    state = "idle";
    form.reset();
    setStatus("");
    send.textContent = t("发送");
    form.hidden = true;
    $("feedback-done").hidden = false;
    if (dialog.open) $("feedback-done-mine").focus();
    else App.toast(t("反馈已发送，谢谢！"));
  }
  function failed(error) {
    state = "failed";
    const text = error === "rate_limited" ? t("没能发送：短时间内发送太多次了，请过几分钟再点“重试”；也可以先复制内容。")
      : /^(bad_kind|bad_json|message_|contact_|too_large)/.test(error) ? t("没能发送：内容太长或格式不对，请删减后点“重试”。")
      // 服务端还没接上数据库（503 unavailable）：反馈功能在开通中。
      : error === "unavailable" ? t("没能发送：反馈功能还在开通中。可以先复制内容，或通过首页的 GitHub 链接提交。")
      : t("没能发送：暂时连不上反馈服务。可以点“重试”，或者复制内容稍后再发。");
    setStatus(text, true);
    send.textContent = t("重试");
    copy.hidden = false;
  }
  // 发不出去时：复制写好的内容（附上条目标题），剪贴板不可用就选中文字让访客自己复制。
  async function copyText() {
    const text = [message.value.trim(), about && attach.checked ? t("关于：{title}", { title: about.title }) : ""].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setStatus(t("已复制到剪贴板。"));
    } catch (e) {
      message.focus();
      message.select();
      setStatus(t("已选中文字，请手动复制。"));
    }
  }

  // ———————————————————— 我的反馈 ————————————————————
  const STATUS = { new: t("待处理"), replied: t("已回复"), done: t("已处理"), wontfix: t("暂不处理"), duplicate: t("重复反馈") };
  const DATE = new Intl.DateTimeFormat(App.locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const when = iso => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
  };
  const stamp = thread => thread.updated_at || thread.created_at || "";
  // 类型名沿用“写反馈”里的选项文字（英文页已经翻译好）。
  const kindName = kind => form.querySelector(`input[name="kind"][value="${CSS.escape(kind || "other")}"]`)?.parentElement.textContent.trim() || "";
  const chip = value => el("span", { class: "feedback-chip s-" + (STATUS[value] ? value : "new") }, STATUS[value] || STATUS.new);
  const newDot = (hidden = false) => el("span", { class: "feedback-dot", hidden }, el("span", { class: "feedback-sr" }, t("有新回复")));
  // 页头“反馈”按钮和“我的反馈”标签上的红点。
  const dots = [$("feedback-open"), tabs.mine].map(button => button.appendChild(newDot(true)));

  // 有新消息：维护者回复或改了状态之后，访客还没打开看过。访客自己补充后、等待处理的不算。
  function fresh(thread, marks = seen()) {
    const last = thread.messages.at(-1);
    if (thread.status === "new" && (!last || last.author === "visitor")) return false;
    return stamp(thread) > (marks[thread.id] || "");
  }
  function markSeen(thread) {
    const marks = seen();
    if (marks[thread.id] === stamp(thread)) return;
    marks[thread.id] = stamp(thread);
    save(SEEN, marks);
    paintDots();
  }
  function paintDots() {
    const marks = seen(), any = !!threads?.some(thread => fresh(thread, marks));
    for (const dot of dots) dot.hidden = !any;
  }

  // 读取“我的反馈”：每个令牌一次请求；同一时间只读一次。
  function refresh() {
    const list = tokens();
    if (!list.length) {
      threads = [];
      paintDots();
      return Promise.resolve({ ok: true });
    }
    loading ??= Promise.all(list.map(token => api("api/feedback/mine", token).then(data => {
      if (!data.ok) throw new Error(data.error);
      return (Array.isArray(data.threads) ? data.threads : []).map(thread => ({ ...thread, messages: thread.messages || [], token }));
    }))).then(parts => {
      threads = parts.flat();
      paintDots();
      return { ok: true };
    }, error => ({ ok: false, error: error.message })).finally(() => { loading = null; });
    return loading;
  }

  function selectTab(name) {
    tab = name;
    for (const key of Object.keys(tabs)) {
      tabs[key].setAttribute("aria-selected", String(key === name));
      tabs[key].tabIndex = key === name ? 0 : -1;
      panels[key].hidden = key !== name;
    }
    // 回到“写反馈”时总是显示表单（刚发送成功的感谢页不再保留）。
    if (name === "new") {
      form.hidden = false;
      $("feedback-done").hidden = true;
    } else showList();
  }
  function showList() {
    shown = null;
    $("feedback-list-view").hidden = false;
    $("feedback-thread-view").hidden = true;
    renderList();
    refresh().then(result => { if (tab === "mine" && shown === null) renderList(result); });
  }
  function renderList(result) {
    const focused = document.activeElement?.closest?.(".feedback-thread")?.dataset.id, marks = seen();
    const sorted = (threads || []).slice().sort((a, b) => stamp(b).localeCompare(stamp(a)));
    threadList.replaceChildren(...sorted.map(thread => {
      const replies = thread.messages.filter(item => item.author !== "visitor").length;
      const foot = [thread.entry_title && t("关于：{title}", { title: thread.entry_title }), replies && t("{n} 条回复", { n: replies })].filter(Boolean).join(" · ");
      return el("li", null, el("button", { type: "button", class: "feedback-thread", dataset: { id: thread.id }, onclick: () => showThread(thread.id) },
        el("span", { class: "feedback-thread-head" }, chip(thread.status), el("span", null, kindName(thread.kind)),
          el("time", { datetime: stamp(thread) }, when(stamp(thread))), fresh(thread, marks) && newDot()),
        el("span", { class: "feedback-excerpt" }, thread.message),
        foot ? el("span", { class: "feedback-thread-foot" }, foot) : null));
    }));
    const failedLoad = !!result && !result.ok, has = tokens().length > 0;
    mineStatus.textContent = !has ? t("还没有反馈。发送之后，处理进度和我们的回复会显示在这里，也可以接着补充。")
      : failedLoad ? (threads ? t("没能刷新，下面是之前读到的内容。") : t("暂时连不上反馈服务，请稍后再试。"))
      : !threads ? t("正在读取…")
      : !threads.length ? t("还没有反馈。发送之后，处理进度和我们的回复会显示在这里，也可以接着补充。")
      : "";
    mineStatus.classList.toggle("is-error", failedLoad);
    $("feedback-retry-row").hidden = !failedLoad;
    $("feedback-link").hidden = !has;
    if (focused) threadList.querySelector(`[data-id="${focused}"]`)?.focus();
  }

  function showThread(id) {
    const thread = threads?.find(item => item.id === id);
    if (!thread) return;
    // 换到另一条时清掉没发的补充。
    if (shown !== id) {
      replyBox.value = "";
      replyBox.removeAttribute("aria-invalid");
      setReplyStatus("");
    }
    shown = id;
    $("feedback-list-view").hidden = true;
    $("feedback-thread-view").hidden = false;
    renderThread(thread);
    markSeen(thread);
    $("feedback-thread-title").focus();
  }
  function renderThread(thread) {
    const items = [{ author: "visitor", created_at: thread.created_at, message: thread.message }, ...thread.messages];
    const waiting = thread.status === "new" && items.at(-1).author === "visitor";
    // replaceChildren 会把 false、null 写成文字，先去掉。
    threadBox.replaceChildren(...[
      el("div", { class: "feedback-thread-title" }, el("h3", { id: "feedback-thread-title", tabindex: "-1" }, kindName(thread.kind) || t("反馈")), chip(thread.status)),
      thread.entry_title && el("p", { class: "feedback-thread-about" }, t("关于：{title}", { title: thread.entry_title })),
      el("ol", { class: "feedback-messages" }, items.map(item => el("li", { class: item.author === "visitor" ? "from-visitor" : "from-team" },
        el("p", { class: "feedback-meta" }, el("b", null, item.author === "visitor" ? t("我") : t("维护者")), " · ", el("time", { datetime: item.created_at }, when(item.created_at))),
        el("p", { class: "feedback-text" }, item.message)))),
      waiting && el("p", { class: "feedback-waiting" }, t("已收到，维护者回复后会显示在这里。")),
    ].filter(Boolean));
  }
  function setReplyStatus(text, error = false) {
    replyStatus.textContent = text;
    replyStatus.classList.toggle("is-error", error);
  }
  // 补充或追问：发出后这条回到“待处理”。
  async function sendReply() {
    const thread = threads?.find(item => item.id === shown);
    if (replying || !thread) return;
    const text = replyBox.value.trim();
    if (text.length < 2) {
      replyBox.setAttribute("aria-invalid", "true");
      setReplyStatus(t("请先写下要补充的内容（至少 2 个字）。"), true);
      replyBox.focus();
      return;
    }
    replyBox.removeAttribute("aria-invalid");
    replying = true;
    replySend.disabled = true;
    setReplyStatus(t("正在发送…"));
    const result = await api("api/feedback/reply", thread.token, { id: thread.id, message: text });
    replying = false;
    replySend.disabled = false;
    const here = shown === thread.id;
    if (!result.ok) {
      if (here) setReplyStatus(result.error === "rate_limited" ? t("没能发送：短时间内发送太多次了，请过几分钟再试。")
        : result.error === "not_found" ? t("没能发送：找不到这条反馈。")
        : /^(bad_|message_|too_large)/.test(result.error) ? t("没能发送：内容太长或格式不对，请删减后再试。")
        : t("没能发送：暂时连不上反馈服务，请稍后再试。"), true);
      return;
    }
    const at = result.created_at || new Date().toISOString();
    thread.messages.push({ id: result.id, created_at: at, author: "visitor", message: text });
    Object.assign(thread, { status: "new", updated_at: at });
    markSeen(thread);
    if (!here) return;
    replyBox.value = "";
    renderThread(thread);
    setReplyStatus(t("已发送。"));
  }

  // 查看链接：带着第一个令牌；剪贴板不可用时显示链接并选中，让访客自己复制。
  async function copyLink() {
    const link = location.origin + location.pathname + "?fbk=" + tokens()[0];
    try {
      await navigator.clipboard.writeText(link);
      linkStatus.textContent = t("已复制查看链接。");
    } catch (e) {
      linkField.hidden = false;
      linkField.value = link;
      linkField.focus();
      linkField.select();
      linkStatus.textContent = t("已选中链接，请手动复制。");
    }
  }

  // ———————————————————— 事件 ————————————————————
  form.addEventListener("submit", e => { e.preventDefault(); submit(); });
  copy.addEventListener("click", copyText);
  for (const id of ["feedback-close", "feedback-cancel", "feedback-done-close"]) $(id).addEventListener("click", close);
  for (const id of ["feedback-open", "detail-feedback"]) $(id).addEventListener("click", e => open(e.currentTarget));
  message.addEventListener("input", () => {
    if (message.getAttribute("aria-invalid") && message.value.trim().length >= 2) { message.removeAttribute("aria-invalid"); setStatus(""); }
  });
  // 标签：点击或用方向键、Home、End 切换。
  for (const [key, button] of Object.entries(tabs)) {
    button.addEventListener("click", () => { if (tab !== key) selectTab(key); else if (key === "mine") showList(); });
    button.addEventListener("keydown", e => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === "Home" ? "new" : e.key === "End" ? "mine" : key === "new" ? "mine" : "new";
      selectTab(next);
      tabs[next].focus();
    });
  }
  $("feedback-done-mine").addEventListener("click", () => { selectTab("mine"); tabs.mine.focus(); });
  $("feedback-retry").addEventListener("click", showList);
  $("feedback-copy-link").addEventListener("click", copyLink);
  $("feedback-back").addEventListener("click", () => {
    const id = shown;
    showList();
    threadList.querySelector(`[data-id="${id}"]`)?.focus();
  });
  $("feedback-reply-form").addEventListener("submit", e => { e.preventDefault(); sendReply(); });
  replyBox.addEventListener("input", () => {
    if (replyBox.getAttribute("aria-invalid") && replyBox.value.trim().length >= 2) { replyBox.removeAttribute("aria-invalid"); setReplyStatus(""); }
  });
  // 对话框里的按键不触发页面快捷键；Esc 关闭（输入法选字时的 Esc 除外）。
  dialog.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape" && !e.isComposing) { e.preventDefault(); close(); }
  });
  // 点对话框外面（遮罩）关闭；在框里按下、拖到外面松开的不算。
  let downOutside = false;
  const outside = e => {
    const r = dialog.getBoundingClientRect();
    return e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  dialog.addEventListener("pointerdown", e => { downOutside = outside(e); });
  dialog.addEventListener("click", e => {
    if (downOutside && outside(e)) close();
    downOutside = false;
  });
  // 关闭后回到打开它的按钮。
  dialog.addEventListener("close", () => {
    const back = opener && opener !== document.body && opener.isConnected && opener.getClientRects().length ? opener : $("feedback-open");
    opener = null;
    back.focus({ preventScroll: true });
  });

  // 打开查看链接（?fbk=令牌）：把令牌加到这个浏览器，从地址里去掉，再打开“我的反馈”。
  const params = new URLSearchParams(location.search), linked = params.get("fbk");
  if (linked !== null) {
    params.delete("fbk");
    const query = params.toString();
    history.replaceState(history.state, "", location.pathname + (query ? "?" + query : "") + location.hash);
    if (TOKEN_RE.test(linked)) {
      addToken(linked);
      requestAnimationFrame(() => open(null, { tab: "mine" }));
    }
  } else if (tokens().length) {
    // 提交过反馈的访客：页面加载完后读一次，有新回复就在“反馈”上显示红点。
    addEventListener("load", () => setTimeout(refresh, 1500), { once: true });
  }

  App.feedback = { open, close, refresh };
})();
