/* The category landing page is a usable index, with permission-filtered samples. */
(function () {
  "use strict";
  const A = window.App, D = A.D, { el, img, t } = A;
  const examples = {
    fish: ["沙丁鱼", "大嘴鲈鱼", "海参"],
    villagers: ["阿比盖尔", "罗宾", "威利"],
    farming: ["防风草种子", "蓝莓种子", "南瓜种子"],
    items: ["木材", "石头", "煤炭"],
    upgrades: ["铜斧头", "铜十字镐", "畜棚"],
    bundles: ["春季采集收集包", "春季作物收集包", "河鱼收集包"],
    places: ["皮埃尔的杂货店", "木匠的商店", "鱼店"],
    basics: ["控制", "游戏内时间", "能量"],
  };
  const guideIcons = { 控制: "Controls_Icon.png", 游戏内时间: "Time_Icon.png", 能量: "Spring.png" };
  const bundleIcons = { 工艺室: "Bundle_Green.png", 茶水间: "Bundle_Orange.png", 鱼缸: "Bundle_Teal.png" };
  const safe = text => A.spoilers.textAllowed(text) ? text : t("条件见详情");
  const shortcut = (category, label, filters = {}) => el("button", {
    type: "button", class: "home-shortcut", dataset: { category, filters: JSON.stringify(filters) },
    onclick: () => A.openBrowse(category, filters),
  }, label, el("span", { "aria-hidden": "true" }, " ›"));

  function sample(row, category) {
    let icon = row.icon, label = row.label;
    if (category === "villagers") icon = A.villagerByName.get(row.key).portrait || icon;
    if (category === "farming") {
      const seed = D.seeds.find(s => s.id === row.ref.id);
      // The seed can be familiar while its harvested item is still protected.
      icon = seed.i;
    }
    if (category === "bundles") icon = bundleIcons[row.type] || icon;
    if (category === "basics") icon = guideIcons[row.key] || icon;
    return el("button", { type: "button", class: "home-sample", dataset: { ref: row.ref.type + ":" + row.ref.id },
      onclick: () => A.select(row.ref, { from: "browse" }) },
      el("span", { class: "home-sample-art" }, img(icon)), el("span", null, label));
  }

  function render(categories, records) {
    const rows = Object.fromEntries(categories.map(c => [c.id, records(c.id)]));
    const N = A.N;
    const shortcuts = {
      fish: [[t("钓竿鱼类"), { type: "rod" }], [t("蟹笼收获"), { type: "crab" }]],
      villagers: [[t("生日与礼物"), {}], [t("可结婚居民"), { type: "marriage" }]],
      farming: [[t("全部作物"), {}], [t("多次收获"), { type: "regrow" }]],
      items: [[t("制作配方"), { type: "crafting" }], [t("料理"), { type: "cooking" }], [t("家具服饰"), { type: "decor" }]],
      upgrades: [[t("工具升级"), { type: "tools" }], [t("农场建筑"), { type: "farm" }]],
      bundles: [[N("工艺室"), { type: "工艺室" }], [N("鱼缸"), { type: "鱼缸" }], [t("古物图鉴"), { type: "artifact" }]],
      places: [[t("商店目录"), { type: "shop" }], [t("其他地点"), { type: "location" }]],
      basics: [[N("新手指南"), { query: N("新手指南") }], [t("全部基础规则"), {}]],
    };
    const grid = el("div", { class: "home-categories" }, categories.map(c => {
      const byName = new Map(rows[c.id].map(r => [r.key, r]));
      const previews = examples[c.id].map(name => byName.get(name)).filter(Boolean);
      return el("section", { class: "home-category", dataset: { category: c.id } },
        el("button", { type: "button", class: "home-category-head", onclick: () => A.openBrowse(c.id), "aria-label": c.title },
          img(c.icon), el("span", null, el("strong", null, c.title), el("small", null, t("{n} 条可查看资料", { n: rows[c.id].length }))),
          el("span", { class: "home-category-arrow", "aria-hidden": "true" }, "→")),
        el("p", { class: "home-question" }, c.question),
        el("div", { class: "home-samples" }, previews.map(r => sample(r, c.id))),
        el("div", { class: "home-shortcuts", "aria-label": t("{category}快捷查询", { category: c.title }) }, shortcuts[c.id].map(([label, filters]) => shortcut(c.id, label, filters))));
    }));

    function brief(row, sub, icon = row.icon) {
      return el("button", { type: "button", class: "home-brief", dataset: { ref: row.ref.type + ":" + row.ref.id },
        onclick: () => A.select(row.ref, { from: "browse" }) }, img(icon),
        el("span", null, el("strong", null, row.label), el("small", null, safe(sub))));
    }
    function panel(title, contents, empty, action) {
      return el("section", { class: "home-lookup" }, el("h3", null, title),
        el("div", { class: "home-briefs" }, contents.length ? contents : el("p", { class: "empty-note" }, empty)), action);
    }
    const pick = (id, names) => names.map(name => rows[id].find(r => r.key === name)).filter(Boolean);
    const reading = el("section", { class: "home-seasonal home-reading" }, el("header", { class: "home-seasonal-head" },
      el("div", null, el("h2", null, t("从一个问题开始")), el("p", null, t("查获取条件，顺着材料与用途继续了解。")))),
      el("div", { class: "home-lookups" },
        panel(t("材料从哪来，还能做什么？"), pick("items", ["木材", "石头", "煤炭"]).map(r => brief(r, t("来源 · 制作材料 · 收集用途"))),
          t("从物品目录查看来源与用途。"), shortcut("items", t("查看制作与加工"), { type: "crafting" })),
        panel(t("升级前要准备什么？"), pick("upgrades", ["铜斧头", "铜十字镐", "畜棚"]).map(r => brief(r, r.sub)),
          t("选择一条路线查看前置条件。"), el("button", { type: "button", class: "home-shortcut", onclick: () => { A.select(null); A.setView("tree"); } }, t("打开成长路线 ›"))),
        el("section", { class: "home-lookup" }, el("h3", null, t("按季节查作物和鱼")),
          el("div", { class: "home-season-links" }, A.SEASONS.map(season => el("div", null,
            img(A.SEASON_ICON[season]), el("strong", null, A.SEASON_ZH[season]),
            shortcut("farming", t("作物"), { season }), shortcut("fish", t("鱼类"), { season, type: "rod" })))),
          shortcut("villagers", t("查看居民生日与礼物")))));
    const zh = A.lang !== "en";
    const feedback = el("section", { class: "home-feedback", "aria-labelledby": "feedback-title" },
      el("h2", { id: "feedback-title" }, t("一起把手册做得更好")),
      el("p", null, t("发现资料错误、缺少的内容、被剧透，或有不顺手的地方？点“反馈”直接告诉我们，不用注册；在条目里点“反馈”会自动附上这个条目。我们的回复会显示在“我的反馈”里，可以接着追问。也可以在 GitHub 提出。")),
      el("div", { class: "wiki-credit-links" },
        el("button", { type: "button", class: "btn primary", "aria-haspopup": "dialog", onclick: e => A.feedback.open(e.currentTarget) }, t("反馈问题或建议")),
        el("a", { href: "https://github.com/Ghostubborn/stardewvalley-wiki/issues/new", target: "_blank", rel: "noopener noreferrer" }, t("提交反馈（GitHub Issues）↗")),
        el("a", { href: "https://github.com/Ghostubborn/stardewvalley-wiki", target: "_blank", rel: "noopener noreferrer" }, t("查看 GitHub 仓库 ↗"))));
    // 英文版的资料取自英文 Wiki，致谢先列英文站。
    const wikiLinks = [
      el("a", { href: "https://wiki.biligame.com/stardewvalley/", target: "_blank", rel: "noopener noreferrer", title: t("在新标签页打开") }, t("星露谷物语中文百科（BWIKI）↗")),
      el("a", { href: "https://stardewvalleywiki.com/", target: "_blank", rel: "noopener noreferrer", title: t("在新标签页打开") }, t("Stardew Valley Wiki（英文）↗")),
    ];
    const credits = el("footer", { class: "home-credits", "aria-labelledby": "wiki-thanks-title" },
      el("h2", { id: "wiki-thanks-title" }, t("资料来源与致谢")),
      el("p", null, t("本手册的中文资料整理自星露谷物语中文百科（BWIKI），英文资料整理自 Stardew Valley Wiki 的归档。感谢两站的编辑者、翻译者和所有贡献者，持续整理、核对与分享这些资料，让更多玩家能够了解星露谷。")),
      el("div", { class: "wiki-credit-links" }, zh ? wikiLinks : wikiLinks.reverse()),
      el("p", { class: "home-credit-note" }, t("各条目保留原文来源，便于继续查阅与核对。原 Wiki 未作本站的防剧透处理。")));
    // 地图和路线平时只在底部标签里，首页点明这两种查法；{map}、{tree} 换成打开对应视图的链接。
    // 用链接而不是按钮，中文换行时“「”不会和名称分开；地址写全路径，英文页的 <base> 不会把它解析到中文页。
    const viewLink = (view, label) => el("a", { class: "home-view-link", href: `${location.pathname}#view=${view}`,
      onclick: e => { e.preventDefault(); A.select(null); A.setView(view); } }, label);
    const views = t("也可以换种查法：「{map}」按地点看鱼、商店和住处；「{tree}」看升级和解锁的先后。").split(/\{(map|tree)\}/)
      .map((part, i) => (i % 2 ? viewLink(part, part === "map" ? t("山谷地图") : t("成长路线")) : part));
    return [el("header", { class: "home-heading" }, el("p", { class: "eyebrow" }, t("星露谷交互手册")),
      el("h2", null, t("想查什么，直接开始")),
      el("p", null, t("物品怎么获得、东西在哪里、升级前要准备什么，都能直接查到。默认不剧透：还没到的内容先收起，想看再点开。不用填存档，也不用连接游戏。")),
      el("p", { class: "home-views" }, views)), grid, reading, feedback, credits];
  }
  A.browseHome = { render };
})();
