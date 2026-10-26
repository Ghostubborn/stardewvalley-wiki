/* The category landing page is a usable index, with permission-filtered samples. */
(function () {
  "use strict";
  const A = window.App, D = A.D, { el, img } = A;
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
  const safe = text => A.spoilers.textAllowed(text) ? text : "条件见详情";
  const shortcut = (category, label, filters = {}) => el("button", {
    type: "button", class: "home-shortcut", dataset: { category, filters: JSON.stringify(filters) },
    onclick: () => A.openBrowse(category, filters),
  }, label, el("span", { "aria-hidden": "true" }, " ›"));

  function sample(row, category) {
    let icon = row.icon, label = row.label;
    if (category === "villagers") icon = A.villagerByName.get(row.label).portrait || icon;
    if (category === "farming") {
      const seed = D.seeds.find(s => s.id === row.ref.id);
      // The seed can be familiar while its harvested item is still protected.
      icon = seed.i;
    }
    if (category === "bundles") icon = bundleIcons[row.type] || icon;
    if (category === "basics") icon = guideIcons[row.label] || icon;
    return el("button", { type: "button", class: "home-sample", dataset: { ref: row.ref.type + ":" + row.ref.id },
      onclick: () => A.select(row.ref, { from: "browse" }) },
      el("span", { class: "home-sample-art" }, img(icon)), el("span", null, label));
  }

  function render(categories, records) {
    const rows = Object.fromEntries(categories.map(c => [c.id, records(c.id)]));
    const shortcuts = {
      fish: [["钓竿鱼类", { type: "rod" }], ["蟹笼收获", { type: "crab" }]],
      villagers: [["生日与礼物", {}], ["可结婚居民", { type: "marriage" }]],
      farming: [["全部作物", {}], ["多次收获", { type: "regrow" }]],
      items: [["制作配方", { type: "crafting" }], ["料理", { type: "cooking" }], ["家具服饰", { type: "decor" }]],
      upgrades: [["工具升级", { type: "tools" }], ["农场建筑", { type: "farm" }]],
      bundles: [["工艺室", { type: "工艺室" }], ["鱼缸", { type: "鱼缸" }], ["古物图鉴", { type: "artifact" }]],
      places: [["商店目录", { type: "shop" }], ["其他地点", { type: "location" }]],
      basics: [["新手指南", { query: "新手指南" }], ["全部基础规则", {}]],
    };
    const grid = el("div", { class: "home-categories" }, categories.map(c => {
      const byName = new Map(rows[c.id].map(r => [r.label, r]));
      const previews = examples[c.id].map(name => byName.get(name)).filter(Boolean);
      return el("section", { class: "home-category", dataset: { category: c.id } },
        el("button", { type: "button", class: "home-category-head", onclick: () => A.openBrowse(c.id), "aria-label": c.title },
          img(c.icon), el("span", null, el("strong", null, c.title), el("small", null, `${rows[c.id].length} 条可查看资料`)),
          el("span", { class: "home-category-arrow", "aria-hidden": "true" }, "→")),
        el("p", { class: "home-question" }, c.question),
        el("div", { class: "home-samples" }, previews.map(r => sample(r, c.id))),
        el("div", { class: "home-shortcuts", "aria-label": c.title + "快捷查询" }, shortcuts[c.id].map(([label, filters]) => shortcut(c.id, label, filters))));
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
    const pick = (id, names) => names.map(name => rows[id].find(r => r.label === name)).filter(Boolean);
    const reading = el("section", { class: "home-seasonal home-reading" }, el("header", { class: "home-seasonal-head" },
      el("div", null, el("h2", null, "从一个问题开始"), el("p", null, "查获取条件，顺着材料与用途继续了解。"))),
      el("div", { class: "home-lookups" },
        panel("材料从哪来，还能做什么？", pick("items", ["木材", "石头", "煤炭"]).map(r => brief(r, "来源 · 制作材料 · 收集用途")),
          "从物品目录查看来源与用途。", shortcut("items", "查看制作与加工", { type: "crafting" })),
        panel("升级前要准备什么？", pick("upgrades", ["铜斧头", "铜十字镐", "畜棚"]).map(r => brief(r, r.sub)),
          "选择一条路线查看前置条件。", el("button", { type: "button", class: "home-shortcut", onclick: () => { A.select(null); A.setView("tree"); } }, "打开成长路线 ›")),
        el("section", { class: "home-lookup" }, el("h3", null, "按季节查作物和鱼"),
          el("div", { class: "home-season-links" }, A.SEASONS.map(season => el("div", null,
            img(A.SEASON_ICON[season]), el("strong", null, A.SEASON_ZH[season]),
            shortcut("farming", "作物", { season }), shortcut("fish", "鱼类", { season, type: "rod" })))),
          shortcut("villagers", "查看居民生日与礼物"))));
    const credits = el("footer", { class: "home-credits", "aria-labelledby": "wiki-thanks-title" },
      el("h2", { id: "wiki-thanks-title" }, "资料来源与致谢"),
      el("p", null, "本手册的游戏资料主要整理自星露谷 Wiki 的中英文归档。感谢 Wiki 的编辑者、翻译者和所有贡献者，持续整理、核对与分享这些资料，让更多玩家能够了解星露谷。"),
      el("div", { class: "wiki-credit-links" },
        el("a", { href: "https://zh.stardewvalleywiki.com/", target: "_blank", rel: "noopener noreferrer", title: "在新标签页打开" }, "星露谷物语中文维基 ↗"),
        el("a", { href: "https://stardewvalleywiki.com/", target: "_blank", rel: "noopener noreferrer", title: "在新标签页打开" }, "Stardew Valley Wiki（英文）↗")),
      el("p", { class: "home-credit-note" }, "各条目保留原文来源，便于继续查阅与核对。原 Wiki 未作本站的防剧透处理。"));
    return [el("header", { class: "home-heading" }, el("p", { class: "eyebrow" }, "星露谷交互手册"),
      el("h2", null, "想查什么，直接开始"), el("p", null, "查条件、看用途、理清升级路线。无需填写存档，也不必连接游戏。")), grid, reading, credits];
  }
  A.browseHome = { render };
})();
