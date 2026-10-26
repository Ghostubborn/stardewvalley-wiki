/* Direct category browsing: no search term or player-progress setup required. */
(function () {
  "use strict";
  const A = window.App, D = A.D, { el, img, t, N } = A;
  const categories = [
    { id: "fish", title: t("鱼类与钓鱼"), question: t("在哪钓，什么时候出现？"), icon: "Fishing_Skill_Icon.png" },
    { id: "villagers", title: t("居民与送礼"), question: t("喜欢什么，生日是哪天？"), icon: "HeartIconLarge.png" },
    { id: "farming", title: t("种植与收获"), question: t("什么季节种，几天能收获？"), icon: "Farming_Skill_Icon.png" },
    { id: "items", title: t("物品与制作"), question: t("材料从哪来，可以做什么？"), icon: "Wood.png" },
    { id: "upgrades", title: t("工具与建筑"), question: t("升级顺序、材料和花费？"), icon: "Copper_Bar.png" },
    { id: "bundles", title: t("献祭与收集"), question: t("需要交什么，数量多少？"), icon: "Bundle_Green.png" },
    { id: "places", title: t("地点与商店"), question: t("在哪里，几点营业？"), icon: "Maplocation.png" },
    { id: "basics", title: t("新手与基础"), question: t("操作、时间、体力怎么查？"), icon: "Spring.png" },
  ];
  const stateByCategory = new Map();
  const defaultFilters = () => ({ query: "", type: "all", season: "all", weather: "all", location: "all", now: false, limit: 36 });
  const bundleMap = new Map();
  for (const room of D.bundles) for (const b of room.bundles) bundleMap.set(`${room.room}:${b.name}`, { room, bundle: b });
  let category = null;
  const safe = (text, fallback = t("详细条件按需查看")) => A.spoilers.textAllowed(text) ? text : fallback;
  const pageRef = title => {
    if (A.fishByName.has(title)) return { type: "fish", id: title };
    if (A.villagerByName.has(title)) return { type: "villager", id: title };
    if (A.locationByName.has(title)) return { type: "location", id: title };
    const p = D.pages[title];
    return p?.id && D.items[p.id] ? { type: "item", id: p.id } : { type: "page", id: title };
  };
  function records(id) {
    let rows = [];
    // label 是显示名，key 是中文 ID；筛选同时匹配显示名、中文和英文。
    if (id === "fish") rows = D.fish.map(f => ({ ref: { type: "fish", id: f.p }, key: f.p, label: N(f.p), en: D.pages[f.p]?.e, icon: f.i,
      sub: safe([A.fishText(f).lt, A.fishText(f).tt].filter(Boolean).join(" · ")), seasons: [...new Set(A.fishHabitats(f).flatMap(h => h.seasons || []))], weather: f.W, locations: A.fishLocations(f),
      matchNow: A.fishCheck(f).ok, type: A.fishMethod(f) }));
    if (id === "villagers") rows = D.villagers.map(v => ({ ref: { type: "villager", id: v.p }, key: v.p, label: N(v.p), en: v.en, icon: v.i,
      sub: v.bd ? t("生日：{date}", { date: t("{season} {day} 日", { season: A.SEASON_ZH[v.bd.season], day: v.bd.day }) }) : t("送礼与人物资料"), seasons: v.bd ? [v.bd.season] : [], type: v.mar === true || v.mar === "是" ? "marriage" : "other" }));
    if (id === "farming") rows = D.seeds.map(s => ({ ref: { type: "item", id: s.id }, key: s.p, label: A.itemName(A.itemInfo(s.id)) || N(s.p), en: D.items[s.id]?.e, icon: s.crop?.i || s.i,
      sub: safe([s.crop && A.nameOf(s.crop.id || s.crop.z), s.g ? t("{n} 天成熟", { n: s.g }) : t("生长条件见详情"), s.rg ? t("每 {n} 天再收获", { n: s.rg }) : null].filter(Boolean).join(" · ")),
      seasons: s.S, type: !s.g || !s.crop ? "special" : s.rg ? "regrow" : "single", matchNow: A.seedCheck(s)?.ok }));
    if (id === "items") rows = Object.entries(D.items).map(([itemId, it]) => {
      const p = D.pages[it.pg], recipes = A.recipesByOut.get(itemId) || [];
      const type = p?.k === "cooking" || it.c === "料理" ? "cooking"
        : ["furniture", "clothing", "hat"].includes(p?.k) || ["家具", "上衣", "裤子", "帽子", "壁纸", "地板"].includes(it.c) ? "decor"
        : recipes.length ? "crafting" : "material";
      return { ref: { type: "item", id: itemId }, key: it.z, label: A.itemName(it), en: A.EN ? it.z : it.e, icon: it.i, type, sub: [it.c && t(it.c), it.p != null ? t("售价 {price}", { price: A.money(it.p) }) : null].filter(Boolean).join(" · ") };
    });
    if (id === "upgrades") rows = [...A.progression.nodes.values()].filter(n => ["tools", "gear", "farm"].includes(n.lane)).map(n => ({
      ref: { type: "node", id: n.id }, key: n.title, label: n.name || n.title, icon: n.icon, sub: safe(n.sub || t("查看前置条件与升级路线")), type: n.lane,
    }));
    if (id === "bundles") rows = [...bundleMap].map(([key, { room, bundle: b }]) => ({
      ref: { type: "bundle", id: key }, key: b.name, label: N(b.name), icon: "Bundle_Green.png", type: room.room,
      sub: `${N(room.room)} · ${b.cost ? A.money(b.cost) : b.choose ? t("从 {total} 项中选 {n} 项", { total: b.items.length, n: b.slots }) : t("{n} 项要求", { n: b.slots || b.items.length })}`,
    })).concat(Object.entries(D.pages).filter(([, page]) => ["artifact", "mineral"].includes(page.k)).map(([title, page]) => ({
      ref: pageRef(title), key: title, label: N(title), en: page.e, icon: page.i, type: page.k, sub: t("{kind}图鉴 · 来源与用途", { kind: t(page.kz) }),
    })));
    if (id === "places") rows = D.locations.map(l => ({ ref: { type: "location", id: l.p }, key: l.p, label: N(l.p), en: l.en, icon: l.i,
      sub: safe(A.locText(l).hours || t("位置与地点资料")), type: A.BUSINESSES.has(l.p) || D.shops.some(s => s.p === l.p) ? "shop" : "location" }));
    if (id === "basics") rows = ["新手指南", "控制", "游戏内时间", "能量", "生命值", "物品栏", "季节", "天气", "技能", "钓鱼攻略", "友谊", "合作", "存档"]
      .filter(title => D.pages[title]).map(title => ({ ref: pageRef(title), key: title, label: N(title), en: D.pages[title].e, icon: D.pages[title].i, sub: t("基础规则与说明"), type: "guide" }));
    rows = rows.filter(row => A.spoilers.canView(row.ref));
    const seen = new Set();
    return rows.filter(row => { const key = row.ref.type + ":" + row.ref.id; if (seen.has(key)) return false; seen.add(key); return true; });
  }
  const subtypes = {
    fish: [["rod", t("钓竿")], ["crab", t("蟹笼")], ["forage", t("海滩采集")]],
    villagers: [["marriage", t("可结婚")], ["other", t("其他居民")]],
    farming: [["single", t("单次收获")], ["regrow", t("多次收获")], ["special", t("特殊种植")]],
    items: [["material", t("材料与其他物品")], ["crafting", t("制作与加工")], ["cooking", t("料理")], ["decor", t("家具服饰")]],
    upgrades: [["tools", t("工具")], ["gear", t("装备")], ["farm", t("农场建筑")]],
    bundles: [...A.ROOMS.map(room => [room, N(room)]), ["artifact", t("古物图鉴")], ["mineral", t("矿物图鉴")]],
    places: [["shop", t("商店")], ["location", t("其他地点")]],
  };
  // A location filter selects a rule branch, not just a name in a global result.
  // Keep the predicate shared with the UI so regression tests exercise its actual filtering.
  function matchesFilters(id, row, filters = {}) {
    const state = { ...defaultFilters(), ...filters };
    const query = state.query.trim().toLowerCase();
    const fish = id === "fish" ? A.fishByName.get(row.key ?? row.label) : null;
    return (!query || [row.label, row.key || "", row.en || ""].some(text => text.toLowerCase().includes(query)))
      && (state.type === "all" || row.type === state.type)
      && (state.season === "all" || (fish ? A.fishHabitats(fish)
        .filter(h => state.location === "all" || h.location === state.location)
        .some(h => h.seasons?.includes(state.season) || h.seasons?.includes("all"))
        : row.seasons?.includes(state.season) || row.seasons?.includes("all")))
      && (state.weather === "all" || row.weather?.includes(state.weather) || row.weather?.includes("any"))
      && (state.location === "all" || row.locations?.includes(state.location))
      && (!state.now || !A.conditionsActive() || (fish ? row.type === "rod"
        && A.fishCheck(fish, state.location === "all" ? {} : { location: state.location }).ok === true : row.matchNow === true));
  }
  function render() {
    const root = document.getElementById("browse");
    if (!root) return;
    const previousScroll = root.scrollTop;
    const definition = categories.find(c => c.id === category);
    root.classList.toggle("browse-home", !definition);
    if (!definition) {
      root.replaceChildren(...A.browseHome.render(categories, records));
      root.scrollTop = previousScroll; return;
    }
    const state = stateByCategory.get(category) || defaultFilters();
    stateByCategory.set(category, state);
    const rows = records(category);
    const input = el("input", { type: "search", value: state.query, placeholder: t("筛选名称（可留空）"), "aria-label": t("筛选分类内容") });
    const controls = el("div", { class: "browse-filters" });
    const grid = el("div", { class: "browse-results", dataset: { category } });
    const count = el("p", { class: "browse-count", role: "status" });
    const more = el("button", { class: "btn browse-more", type: "button" }, t("继续显示"));
    const paint = () => {
      const filtered = rows.filter(row => matchesFilters(category, row, state));
      count.textContent = t("{n} 条可查看资料", { n: filtered.length });
      grid.replaceChildren(...A.browseViews.render(category, filtered.slice(0, state.limit)));
      if (!filtered.length) grid.append(el("p", { class: "empty-note" }, t("当前筛选没有结果。可以清除条件后继续浏览。")));
      more.hidden = filtered.length <= state.limit;
      more.textContent = t("继续显示（还有 {n} 条）", { n: Math.max(0, filtered.length - state.limit) });
    };
    const resetLimit = () => { state.limit = 36; paint(); };
    function select(label, key, options) {
      const select = el("select", { "aria-label": label }, options.map(([value, name]) => el("option", { value }, name)));
      select.value = state[key];
      select.addEventListener("change", () => { state[key] = select.value; resetLimit(); });
      controls.append(el("label", null, el("span", null, label), select));
    }
    if (subtypes[category]) select(t("类型"), "type", [["all", t("全部类型")], ...subtypes[category]]);
    if (["fish", "villagers", "farming"].includes(category)) select(category === "villagers" ? t("生日季节") : t("季节"), "season", [["all", t("全部季节")], ...A.SEASONS.map(s => [s, A.SEASON_ZH[s]])]);
    if (category === "fish") {
      select(t("天气"), "weather", [["all", t("全部天气")], ["sun", t("晴天")], ["rain", t("雨天")]]);
      const locations = [...new Set(rows.flatMap(r => r.locations || []))].filter(name => A.spoilers.textAllowed(name) && A.spoilers.textAllowed(N(name)));
      select(t("地点"), "location", [["all", t("全部地点")], ...locations.map(name => [name, N(name)])]);
    }
    if (["fish", "farming"].includes(category) && A.conditionsActive()) {
      const checkbox = el("input", { type: "checkbox", checked: state.now });
      checkbox.addEventListener("change", () => { state.now = checkbox.checked; resetLimit(); });
      controls.append(el("label", { class: "check browse-now" }, checkbox, category === "fish" ? t("只看符合对照条件的鱼") : t("只看所设日期种来得及的作物")));
    }
    if (["fish", "farming"].includes(category) && !A.conditionsActive()) controls.append(el("button", { type: "button", class: "btn", onclick: () => A.openConditions() }, t("日期与时段对照（可选）")));
    const clear = el("button", { type: "button", class: "btn", onclick: () => { stateByCategory.delete(category); render(); } }, t("清除筛选"));
    input.addEventListener("input", () => { state.query = input.value; resetLimit(); });
    more.addEventListener("click", () => { state.limit += 36; paint(); });
    const guides = { fish: ["钓鱼攻略", "鱼饵", "渔具"], villagers: ["友谊", "礼物列表"], farming: ["作物生长日历", "肥料"],
      items: ["打造", "烹饪", "工匠物品"], upgrades: ["铁匠铺", "木匠的商店"], bundles: ["收集包"], basics: ["新手指南", "控制"] };
    const links = (guides[category] || []).filter(title => D.pages[title] && A.spoilers.canView(pageRef(title)));
    const filterPanel = el("details", { class: "browse-filter-panel", open: state.filtersOpen ?? window.innerWidth > 760 },
      el("summary", null, t("筛选条件")), controls);
    filterPanel.addEventListener("toggle", () => { state.filtersOpen = filterPanel.open; });
    const toolbar = el("div", { class: "browse-toolbar" }, input, clear, controls.children.length ? filterPanel : null);
    root.replaceChildren(el("header", { class: "browse-heading" }, el("button", { type: "button", class: "btn", onclick: () => A.openBrowse(null) }, t("← 全部分类")),
      el("h2", null, definition.title), el("p", null, definition.question)), toolbar, count, grid, more);
    if (links.length) root.append(el("footer", { class: "browse-related" }, el("h3", null, t("相关资料")),
      el("div", { class: "browse-links" }, links.map(title => el("button", { type: "button", class: "btn", onclick: () => A.select(pageRef(title), { from: "browse" }) }, N(title))))));
    paint(); root.scrollTop = previousScroll;
  }
  A.browse = {
    categories, records, render, matchesFilters, bundle: id => bundleMap.get(id),
    get category() { return category; },
    open(id, filters) {
      category = categories.some(c => c.id === id) ? id : null;
      if (category && filters) {
        // A home shortcut is an explicit query; previous unrelated filters must
        // not silently narrow it. Ordinary category navigation keeps its state.
        const next = defaultFilters();
        for (const key of ["query", "type", "season", "weather", "location", "now"]) if (Object.hasOwn(filters, key)) next[key] = filters[key];
        next.filtersOpen = true;
        stateByCategory.set(category, next);
      }
      render(); document.getElementById("browse").scrollTop = 0;
    },
  };
})();
