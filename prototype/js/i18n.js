/* 显示语言：/ 是中文版，/en/ 是英文版。界面文案以中文原文为键查英文词典；
   条目名、地点名等内部 ID 始终是中文，只在显示时换成英文 Wiki 的名称。 */
(function () {
  "use strict";
  const pageLang = (typeof document !== "undefined" && document.documentElement?.lang) || window.SDV_LANG || "zh";
  const lang = String(pageLang).toLowerCase().startsWith("en") ? "en" : "zh";
  const dict = lang === "en" ? window.SDV_UI_EN || {} : {};
  const missing = new Set();
  // "{n} {n|entry|entries}"：按 n 是否为 1 选单复数。
  function format(text, vars) {
    return text.replace(/\{(\w+)(?:\|([^|{}]*)\|([^|{}]*))?\}/g, (match, key, one, many) => {
      if (!vars || !(key in vars)) return match;
      if (one !== undefined) return Number(vars[key]) === 1 ? one : many;
      return vars[key] == null ? "" : String(vars[key]);
    });
  }
  function t(source, vars) {
    let text = source;
    if (lang === "en") {
      text = dict[source];
      if (text == null) { missing.add(source); text = source; }
    }
    return vars ? format(text, vars) : text;
  }
  const PREF = "sdv-lang";
  function switchTo(target) {
    try { localStorage.setItem(PREF, target); } catch (e) { /* 隐私模式仍可跳转 */ }
    const root = lang === "en" ? new URL("../", location.href) : new URL("./", location.href);
    location.href = (target === "en" ? new URL("en/", root) : root).pathname + location.search + location.hash;
  }
  window.L10N = {
    lang, t, format, missing, switchTo,
    locale: lang === "en" ? "en-US" : "zh-CN",
    // 列表与分句的标点随语言变化。
    list: (items, sep) => items.filter(x => x != null && x !== "").join(sep ?? (lang === "en" ? ", " : "、")),
    clauses: items => items.filter(Boolean).join(lang === "en" ? "; " : "；"),
  };
})();
