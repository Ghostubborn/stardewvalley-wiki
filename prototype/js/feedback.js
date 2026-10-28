/* 访客反馈：页头和详情工具栏的“反馈”打开同一个对话框，提交到 api/feedback（functions/api/feedback.js，存进 D1）。
   附上的条目只显示页面上已经显示的标题，受保护条目的名称不会出现在对话框里；条目引用只随反馈发送。 */
(function () {
  "use strict";
  const App = window.App;
  const { t } = App;
  const $ = id => document.getElementById(id);
  const dialog = $("feedback-dialog"), form = $("feedback-form"), message = $("feedback-message");
  const status = $("feedback-status"), send = $("feedback-send"), copy = $("feedback-copy");
  const aboutRow = $("feedback-about"), attach = $("feedback-attach");
  // 版本：ui.js 地址上的内容指纹（?v=），每次构建都会变。
  const version = (() => {
    try { return new URL(document.querySelector('script[src*="js/ui.js"]').src).searchParams.get("v") || ""; } catch (e) { return ""; }
  })();
  // state：idle 可以发送；sending 正在发送；failed 上次没发出去（重新打开时仍显示“重试”和“复制内容”）。
  let opener = null, about = null, state = "idle";

  function shownEntry() {
    const ref = App.currentRef?.(), title = $("detail-title")?.textContent.trim();
    return ref && !$("detail").hidden && title ? { entry: `${ref.type}:${ref.id}`, title } : null;
  }
  function setStatus(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }
  // 打开：从详情或页头打开都附上正在看的条目（可取消）；没发出去的草稿保留到下次打开。
  function open(trigger) {
    if (!dialog.open) opener = trigger || document.activeElement;
    about = shownEntry();
    aboutRow.hidden = !about;
    attach.checked = true;
    $("feedback-about-text").textContent = about ? t("关于：{title}", { title: about.title }) : "";
    form.hidden = false;
    $("feedback-done").hidden = true;
    if (state === "idle") { setStatus(""); copy.hidden = true; send.textContent = t("发送"); }
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    // 触屏上先不弹出键盘，免得挡住类型和说明。
    (matchMedia("(pointer: fine)").matches ? message : $("feedback-dialog-title")).focus();
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
    let error = "network";
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
    try {
      const res = await fetch("api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(text)), signal: abort.signal,
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) return done();
      error = data?.error || "unavailable";
    } catch (e) {
      // 离线、超时，或本地静态预览（没有后端）。
    } finally {
      clearTimeout(timer);
      send.disabled = false;
    }
    failed(error);
  }
  function done() {
    state = "idle";
    form.reset();
    setStatus("");
    send.textContent = t("发送");
    form.hidden = true;
    $("feedback-done").hidden = false;
    if (dialog.open) $("feedback-done-close").focus();
    else App.toast(t("反馈已发送，谢谢！"));
  }
  function failed(error) {
    state = "failed";
    const text = error === "rate_limited" ? t("没能发送：短时间内发送太多次了，请过几分钟再点“重试”；也可以先复制内容。")
      : /^(bad_kind|bad_json|message_|contact_|too_large)/.test(error) ? t("没能发送：内容太长或格式不对，请删减后点“重试”。")
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

  form.addEventListener("submit", e => { e.preventDefault(); submit(); });
  copy.addEventListener("click", copyText);
  for (const id of ["feedback-close", "feedback-cancel", "feedback-done-close"]) $(id).addEventListener("click", close);
  for (const id of ["feedback-open", "detail-feedback"]) $(id).addEventListener("click", e => open(e.currentTarget));
  message.addEventListener("input", () => {
    if (message.getAttribute("aria-invalid") && message.value.trim().length >= 2) { message.removeAttribute("aria-invalid"); setStatus(""); }
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

  App.feedback = { open, close };
})();
