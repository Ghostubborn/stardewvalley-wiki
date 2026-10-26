/* Short, sourced answers for the thirteen basics entries. No player profile is required. */
(function () {
  "use strict";
  const A = window.App, { el } = A;
  const data = A.D.guides || { entries: {}, sources: {}, meta: {} };
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
    const list = (guide.sources || []).map(key => data.sources[key]).filter(Boolean);
    return el("footer", { class: "guide-source-footer" },
      el("p", null, `依据 ${meta.archiveDate || ""} Wiki 归档整理 · 核验 ${guide.verifiedAt || meta.verifiedAt || ""}`),
      el("details", { class: "guide-sources" }, el("summary", null, "查阅来源与版本"),
        el("p", null, meta.scope || ""),
        el("ul", null, list.map(source => el("li", null,
          el("a", { href: source.revisionUrl || source.url, target: "_blank", rel: "noopener noreferrer" }, source.title),
          ` · 原文修订 ${source.revisionAt?.slice(0, 10) || "未记录"}`))),
        el("p", null, meta.attribution || "", " ", meta.license || ""),
        list[0]?.archiveUrl ? el("a", { href: list[0].archiveUrl, target: "_blank", rel: "noopener noreferrer" }, "查看 Wiki 归档") : null));
  }

  function render(title) {
    if (!Object.prototype.hasOwnProperty.call(data.entries || {}, title)) return null;
    const guide = data.entries[title];
    const article = el("article", { class: "basic-guide", "aria-label": title + " · 简明指南" },
      el("p", { class: "guide-intro" }, guide.summary));
    if (guide.platforms?.length) {
      const holder = el("div", { class: "guide-platform-content" });
      const buttons = [];
      const platformGroup = el("div", { class: "guide-platforms", role: "group", "aria-label": "你玩游戏的操作方式" });
      function choose(id) {
        preferredPlatform = id;
        for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.platform === id));
        const selected = guide.platforms.find(platform => platform.id === id);
        holder.replaceChildren(...selected.sections.map(block));
        holder.setAttribute("aria-label", selected.label + "操作说明");
      }
      for (const platform of guide.platforms) {
        const button = el("button", { type: "button", class: "guide-platform", dataset: { platform: platform.id },
          "aria-pressed": "false", onclick: () => choose(platform.id) }, platform.label);
        buttons.push(button);
        platformGroup.append(button);
      }
      article.append(el("p", { class: "guide-platform-label" }, "你玩游戏的操作方式"), platformGroup, holder);
      choose(guide.platforms.some(platform => platform.id === preferredPlatform) ? preferredPlatform : guide.platforms[0].id);
    }
    article.append(...guide.sections.map(block));
    const related = (guide.related || []).filter(has);
    if (related.length) article.append(el("nav", { class: "guide-related", "aria-label": "相关基础指南" },
      el("span", null, "接着查"), related.map(name => el("button", { type: "button", class: "guide-related-link",
        onclick: () => A.select({ type: "page", id: name }) }, name))));
    article.append(sources(guide));
    return article;
  }

  function has(title) {
    return Object.prototype.hasOwnProperty.call(data.entries || {}, title);
  }
  A.guides = { has, render };
})();
