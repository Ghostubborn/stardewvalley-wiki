/* Direct category browsing: no search term or player-progress setup required. */
(function () {
  "use strict";
  const A = window.App, D = A.D, { el, img } = A;
  const categories = [
    { id: "fish", title: "鱼类与钓鱼", question: "在哪钓，什么时候出现？", icon: "Fishing_Skill_Icon.png" },
    { id: "villagers", title: "居民与送礼", question: "喜欢什么，生日是哪天？", icon: "HeartIconLarge.png" },
    { id: "farming", title: "种植与收获", question: "什么季节种，几天能收获？", icon: "Farming_Skill_Icon.png" },
    { id: "items", title: "物品与制作", question: "材料从哪来，可以做什么？", icon: "Wood.png" },
    { id: "upgrades", title: "工具与建筑", question: "升级顺序、材料和花费？", icon: "Copper_Bar.png" },
    { id: "bundles", title: "献祭与收集", question: "需要交什么，数量多少？", icon: "Bundle_Green.png" },
    { id: "places", title: "地点与商店", question: "在哪里，几点营业？", icon: "Maplocation.png" },
    { id: "basics", title: "新手与基础", question: "操作、时间、体力怎么查？", icon: "Spring.png" },
  ];
  const stateByCategory = new Map();
  const defaultFilters = () => ({ query: "", type: "all", season: "all", weather: "all", location: "all", now: false, limit: 36 });
  const bundleMap = new Map();
  for (const room of D.bundles) for (const b of room.bundles) bundleMap.set(`${room.room}:${b.name}`, { room, bundle: b });
  let category = null;
  const safe = (text, fallback = "详细条件按需查看") => A.spoilers.textAllowed(text) ? text : fallback;
  const pageRef = title => {
    if (A.fishByName.has(title)) return { type: "fish", id: title };
    if (A.villagerByName.has(title)) return { type: "villager", id: title };
    if (A.locationByName.has(title)) return { type: "location", id: title };
    const p = D.pages[title];
    return p?.id && D.items[p.id] ? { type: "item", id: p.id } : { type: "page", id: title };
  };
  function records(id) {
    let rows = [];
    if (id === "fish") rows = D.fish.map(f => ({ ref: { type: "fish", id: f.p }, label: f.p, icon: f.i,
      sub: safe([f.lt, f.tt].filter(Boolean).join(" · ")), seasons: [...new Set(A.fishHabitats(f).flatMap(h => h.seasons || []))], weather: f.W, locations: A.fishLocations(f),
      matchNow: A.fishCheck(f).ok, type: A.fishMethod(f) }));
    if (id === "villagers") rows = D.villagers.map(v => ({ ref: { type: "villager", id: v.p }, label: v.p, icon: v.i,
      sub: v.bd ? `生日：${A.SEASON_ZH[v.bd.season]} ${v.bd.day} 日` : "送礼与人物资料", seasons: v.bd ? [v.bd.season] : [], type: v.mar === true || v.mar === "是" ? "marriage" : "other" }));
    if (id === "farming") rows = D.seeds.map(s => ({ ref: { type: "item", id: s.id }, label: s.p, icon: s.crop?.i || s.i,
      sub: safe([s.crop?.z, s.g ? `${s.g} 天成熟` : "生长条件见详情", s.rg ? `每 ${s.rg} 天再收获` : null].filter(Boolean).join(" · ")),
      seasons: s.S, type: !s.g || !s.crop ? "special" : s.rg ? "regrow" : "single", matchNow: A.seedCheck(s)?.ok }));
    if (id === "items") rows = Object.entries(D.items).map(([itemId, it]) => {
      const p = D.pages[it.pg], recipes = A.recipesByOut.get(itemId) || [];
      const type = p?.k === "cooking" || it.c === "料理" ? "cooking"
        : ["furniture", "clothing", "hat"].includes(p?.k) || ["家具", "上衣", "裤子", "帽子", "壁纸", "地板"].includes(it.c) ? "decor"
        : recipes.length ? "crafting" : "material";
      return { ref: { type: "item", id: itemId }, label: it.z, en: it.e, icon: it.i, type, sub: [it.c, it.p != null ? `售价 ${A.money(it.p)}` : null].filter(Boolean).join(" · ") };
    });
    if (id === "upgrades") rows = [...A.progression.nodes.values()].filter(n => ["tools", "gear", "farm"].includes(n.lane)).map(n => ({
      ref: { type: "node", id: n.id }, label: n.title, icon: n.icon, sub: safe(n.sub || "查看前置条件与升级路线"), type: n.lane,
    }));
    if (id === "bundles") rows = [...bundleMap].map(([key, { room, bundle: b }]) => ({
      ref: { type: "bundle", id: key }, label: b.name, icon: "Bundle_Green.png", type: room.room,
      sub: `${room.room} · ${b.cost ? A.money(b.cost) : b.choose ? `从 ${b.items.length} 项中选 ${b.slots} 项` : `${b.slots || b.items.length} 项要求`}`,
    })).concat(Object.entries(D.pages).filter(([, page]) => ["artifact", "mineral"].includes(page.k)).map(([title, page]) => ({
      ref: pageRef(title), label: title, icon: page.i, type: page.k, sub: `${page.kz}图鉴 · 来源与用途`,
    })));
    if (id === "places") rows = D.locations.map(l => ({ ref: { type: "location", id: l.p }, label: l.p, icon: l.i,
      sub: safe(l.hours || "位置与地点资料"), type: A.BUSINESSES.has(l.p) || D.shops.some(s => s.p === l.p) ? "shop" : "location" }));
    if (id === "basics") rows = ["新手指南", "控制", "游戏内时间", "能量", "生命值", "物品栏", "季节", "天气", "技能", "钓鱼攻略", "友谊", "合作", "存档"]
      .filter(title => D.pages[title]).map(title => ({ ref: pageRef(title), label: title, icon: D.pages[title].i, sub: "基础规则与说明", type: "guide" }));
    rows = rows.filter(row => A.spoilers.canView(row.ref));
    const seen = new Set();
    return rows.filter(row => { const key = row.ref.type + ":" + row.ref.id; if (seen.has(key)) return false; seen.add(key); return true; });
  }
  const subtypes = {
    fish: [["rod", "钓竿"], ["crab", "蟹笼"], ["forage", "海滩采集"]],
    villagers: [["marriage", "可结婚"], ["other", "其他居民"]],
    farming: [["single", "单次收获"], ["regrow", "多次收获"], ["special", "特殊种植"]],
    items: [["material", "材料与其他物品"], ["crafting", "制作与加工"], ["cooking", "料理"], ["decor", "家具服饰"]],
    upgrades: [["tools", "工具"], ["gear", "装备"], ["farm", "农场建筑"]],
    bundles: [...A.ROOMS.map(room => [room, room]), ["artifact", "古物图鉴"], ["mineral", "矿物图鉴"]],
    places: [["shop", "商店"], ["location", "其他地点"]],
  };
  // A location filter selects a rule branch, not just a name in a global result.
  // Keep the predicate shared with the UI so regression tests exercise its actual filtering.
  function matchesFilters(id, row, filters = {}) {
    const state = { ...defaultFilters(), ...filters };
    const query = state.query.trim().toLowerCase();
    const fish = id === "fish" ? A.fishByName.get(row.label) : null;
    return (!query || [row.label, row.en || ""].some(t => t.toLowerCase().includes(query)))
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
    const input = el("input", { type: "search", value: state.query, placeholder: "筛选名称（可留空）", "aria-label": "筛选分类内容" });
    const controls = el("div", { class: "browse-filters" });
    const grid = el("div", { class: "browse-results", dataset: { category } });
    const count = el("p", { class: "browse-count", role: "status" });
    const more = el("button", { class: "btn browse-more", type: "button" }, "继续显示");
    const paint = () => {
      const filtered = rows.filter(row => matchesFilters(category, row, state));
      count.textContent = `${filtered.length} 条可查看资料`;
      grid.replaceChildren(...A.browseViews.render(category, filtered.slice(0, state.limit)));
      if (!filtered.length) grid.append(el("p", { class: "empty-note" }, "当前筛选没有结果。可以清除条件后继续浏览。"));
      more.hidden = filtered.length <= state.limit;
      more.textContent = `继续显示（还有 ${Math.max(0, filtered.length - state.limit)} 条）`;
    };
    const resetLimit = () => { state.limit = 36; paint(); };
    function select(label, key, options) {
      const select = el("select", { "aria-label": label }, options.map(([value, name]) => el("option", { value }, name)));
      select.value = state[key];
      select.addEventListener("change", () => { state[key] = select.value; resetLimit(); });
      controls.append(el("label", null, el("span", null, label), select));
    }
    if (subtypes[category]) select("类型", "type", [["all", "全部类型"], ...subtypes[category]]);
    if (["fish", "villagers", "farming"].includes(category)) select(category === "villagers" ? "生日季节" : "季节", "season", [["all", "全部季节"], ...A.SEASONS.map(s => [s, A.SEASON_ZH[s]])]);
    if (category === "fish") {
      select("天气", "weather", [["all", "全部天气"], ["sun", "晴天"], ["rain", "雨天"]]);
      const locations = [...new Set(rows.flatMap(r => r.locations || []))].filter(name => A.spoilers.textAllowed(name));
      select("地点", "location", [["all", "全部地点"], ...locations.map(name => [name, name])]);
    }
    if (["fish", "farming"].includes(category) && A.conditionsActive()) {
      const checkbox = el("input", { type: "checkbox", checked: state.now });
      checkbox.addEventListener("change", () => { state.now = checkbox.checked; resetLimit(); });
      controls.append(el("label", { class: "check browse-now" }, checkbox, category === "fish" ? "只看符合对照条件的鱼" : "只看所设日期种来得及的作物"));
    }
    if (["fish", "farming"].includes(category) && !A.conditionsActive()) controls.append(el("button", { type: "button", class: "btn", onclick: () => A.openConditions() }, "日期与时段对照（可选）"));
    const clear = el("button", { type: "button", class: "btn", onclick: () => { stateByCategory.delete(category); render(); } }, "清除筛选");
    input.addEventListener("input", () => { state.query = input.value; resetLimit(); });
    more.addEventListener("click", () => { state.limit += 36; paint(); });
    const guides = { fish: ["钓鱼攻略", "鱼饵", "渔具"], villagers: ["友谊", "礼物列表"], farming: ["作物生长日历", "肥料"],
      items: ["打造", "烹饪", "工匠物品"], upgrades: ["铁匠铺", "木匠的商店"], bundles: ["收集包"], basics: ["新手指南", "控制"] };
    const links = (guides[category] || []).filter(title => D.pages[title] && A.spoilers.canView(pageRef(title)));
    const filterPanel = el("details", { class: "browse-filter-panel", open: state.filtersOpen ?? window.innerWidth > 760 },
      el("summary", null, "筛选条件"), controls);
    filterPanel.addEventListener("toggle", () => { state.filtersOpen = filterPanel.open; });
    const toolbar = el("div", { class: "browse-toolbar" }, input, clear, controls.children.length ? filterPanel : null);
    root.replaceChildren(el("header", { class: "browse-heading" }, el("button", { type: "button", class: "btn", onclick: () => A.openBrowse(null) }, "← 全部分类"),
      el("h2", null, definition.title), el("p", null, definition.question)), toolbar, count, grid, more);
    if (links.length) root.append(el("footer", { class: "browse-related" }, el("h3", null, "相关资料"),
      el("div", { class: "browse-links" }, links.map(title => el("button", { type: "button", class: "btn", onclick: () => A.select(pageRef(title), { from: "browse" }) }, title)))));
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
