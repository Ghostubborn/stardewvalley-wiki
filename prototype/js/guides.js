/* Short, sourced answers for the thirteen basics entries. No player profile is required. */
(function () {
  "use strict";
  const A = window.App, { el, t, N } = A;
  // 英文版使用对照英文 Wiki 改写的 guides.en.json；条目 ID 仍是中文。
  const data = (A.EN ? A.EN.guides : A.D.guides) || { entries: {}, sources: {}, meta: {} };
  let preferredPlatform = "pc";

  function block(section) {
    const content = el("section", { class: "guide-section" }, el("h3", null, section.heading));
    for (const text of section.paragraphs || []) content.append(el("p", null, text));
    for (const [field, tag] of [["steps", "ol"], ["bullets", "ul"]]) {
      if (section[field]?.length) content.append(el(tag, { class: "guide-" + field },
        section[field].map(text => el("li", null, text))));
    }
    if (section.facts?.length) content.append(el("dl", { class: "guide-facts" },
      section.facts.flatMap(([label, value]) => [el("dt", null, label), el("dd", null, value)])));
    if (section.note) content.append(el("p", { class: "guide-note" }, section.note));
    return content;
  }

  function sources(guide) {
    const meta = data.meta;
    // 两个来源键可能指向同一页面（如英文版的 Mobile Controls），只列一次。
    const list = [...new Map((guide.sources || []).map(key => data.sources[key]).filter(Boolean).map(source => [source.url, source])).values()];
    return el("footer", { class: "guide-source-footer" },
      el("p", null, t("依据 {archive} Wiki 归档整理 · 核验 {verified}", { archive: meta.archiveDate || "", verified: guide.verifiedAt || meta.verifiedAt || "" })),
      el("details", { class: "guide-sources" }, el("summary", null, t("查阅来源与版本")),
        el("p", null, meta.scope || ""),
        el("ul", null, list.map(source => el("li", null,
          el("a", { href: source.revisionUrl || source.url, target: "_blank", rel: "noopener noreferrer" }, source.title),
          t(" · 原文修订 {date}", { date: source.revisionAt?.slice(0, 10) || t("未记录") })))),
        el("p", null, meta.attribution || "", " ", meta.license || ""),
        list[0]?.archiveUrl ? el("a", { href: list[0].archiveUrl, target: "_blank", rel: "noopener noreferrer" }, t("查看 Wiki 归档")) : null));
  }

  function render(title) {
    if (!Object.prototype.hasOwnProperty.call(data.entries || {}, title)) return null;
    const guide = data.entries[title];
    const article = el("article", { class: "basic-guide", "aria-label": t("{title} · 简明指南", { title: N(title) }) },
      el("p", { class: "guide-intro" }, guide.summary));
    if (guide.platforms?.length) {
      const holder = el("div", { class: "guide-platform-content" });
      const buttons = [];
      const platformGroup = el("div", { class: "guide-platforms", role: "group", "aria-label": t("你玩游戏的操作方式") });
      function choose(id) {
        preferredPlatform = id;
        for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.platform === id));
        const selected = guide.platforms.find(platform => platform.id === id);
        holder.replaceChildren(...selected.sections.map(block));
        holder.setAttribute("aria-label", t("{platform}操作说明", { platform: selected.label }));
      }
      for (const platform of guide.platforms) {
        const button = el("button", { type: "button", class: "guide-platform", dataset: { platform: platform.id },
          "aria-pressed": "false", onclick: () => choose(platform.id) }, platform.label);
        buttons.push(button);
        platformGroup.append(button);
      }
      article.append(el("p", { class: "guide-platform-label" }, t("你玩游戏的操作方式")), platformGroup, holder);
      choose(guide.platforms.some(platform => platform.id === preferredPlatform) ? preferredPlatform : guide.platforms[0].id);
    }
    article.append(...guide.sections.map(block));
    const related = (guide.related || []).filter(has);
    if (related.length) article.append(el("nav", { class: "guide-related", "aria-label": t("相关基础指南") },
      el("span", null, t("接着查")), related.map(name => el("button", { type: "button", class: "guide-related-link",
        onclick: () => A.select({ type: "page", id: name }) }, N(name)))));
    article.append(sources(guide));
    return article;
  }

  function has(title) {
    return Object.prototype.hasOwnProperty.call(data.entries || {}, title);
  }
  A.guides = { has, render };
})();
