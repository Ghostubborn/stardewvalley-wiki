/* 核心：数据索引、游戏条件、玩家进度与条件求值。地图、路线和面板共用这里的结果。 */
(function () {
  "use strict";
  const D = window.SDV;
  const L10N = window.L10N;
  const { t, lang } = L10N;
  // 英文版只替换显示内容；条目名、地点名等内部 ID 保持中文。
  const EN = lang === "en" ? window.SDV_EN || {} : null;
  const App = (window.App = { D, EN, t, lang, list: L10N.list, clauses: L10N.clauses, locale: L10N.locale });

  // ———————————————————— 常量 ————————————————————
  const SEASONS = ["spring", "summer", "fall", "winter"];
  // 显示名随语言变化；需要匹配中文原文的地方使用 SEASON_SOURCE。
  const SEASON_SOURCE = { spring: "春季", summer: "夏季", fall: "秋季", winter: "冬季" };
  const SEASON_ZH = { spring: t("春季"), summer: t("夏季"), fall: t("秋季"), winter: t("冬季"), all: t("任意季节") };
  const SEASON_SHORT = { spring: t("春"), summer: t("夏"), fall: t("秋"), winter: t("冬") };
  const SEASON_ICON = { spring: "Spring.png", summer: "Summer.png", fall: "Fall.png", winter: "Winter.png" };
  const WEATHER = {
    sun: { zh: t("晴天"), short: t("晴"), icon: "Sunny.png" },
    rain: { zh: t("雨天"), short: t("雨"), icon: "Rain.png" },
    wind: { zh: t("刮风"), short: t("风"), icon: "Pollen_spring.png" },
    storm: { zh: t("暴风雨"), short: t("雷雨"), icon: "Thunderstorm.png" },
    snow: { zh: t("下雪"), short: t("雪"), icon: "Snow.png" },
  };
  const SEASON_WEATHER = {
    spring: ["sun", "rain", "wind", "storm"], summer: ["sun", "rain", "storm"],
    fall: ["sun", "rain", "wind", "storm"], winter: ["sun", "snow"],
  };
  const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map(d => t(d));
  // zh 是中文条目名（防剧透规则按它判断），name 是显示名。
  const SKILLS = [
    { id: "farming", zh: "耕种", name: t("耕种"), icon: "Farming_Skill_Icon.png" },
    { id: "mining", zh: "采矿", name: t("采矿"), icon: "Mining_Skill_Icon.png" },
    { id: "foraging", zh: "采集", name: t("采集"), icon: "Foraging_Skill_Icon.png" },
    { id: "fishing", zh: "钓鱼", name: t("钓鱼"), icon: "Fishing_Skill_Icon.png" },
    { id: "combat", zh: "战斗", name: t("战斗"), icon: "Combat_Skill_Icon.png" },
  ];
  const skillName = id => SKILLS.find(s => s.id === id)?.name || id;
  const ROOMS = D.bundles.map((r) => r.room).filter((r) => r !== "废弃Joja超市");
  const TOOL_FAMILIES = D.chains.filter((c) => c.kind === "blacksmith_upgrade").map((c) => c.family);
  const ROD_CHAIN = D.chains.find((c) => c.kind === "purchase_tiers");
  const BUILDING_CHAINS = buildingChains();
  localizeCurated();
  const AREAS = Object.fromEntries(D.progression.areas.map((a) => [a.id, a]));
  // 鱼的地点 → 受进度限制的地区
  const LOCATION_AREA = {
    矿井: "mines", 沙漠: "desert", 姜岛: "ginger_island", 火山地牢: "ginger_island", 秘密森林: "secret_woods",
    巫婆沼泽: "witch_swamp", 下水道: "sewers", 突变虫穴: "sewers", 骷髅洞穴: "skull_cavern", 采石场: "quarry",
  };
  // 商店所在地区
  const SHOP_AREA = {
    科罗布斯: "sewers", 沙漠商人: "desert", 绿洲: "desert", 赌场: "desert", 姜岛商人: "ginger_island",
    齐先生的核桃房: "ginger_island", 矮人: "mines",
  };
  const SHOP_LOCATION = { 科罗布斯: "下水道", 矮人: "矿井", 沙漠商人: "沙漠商人" };
  const BUSINESSES = new Set(["铁匠铺", "哈维的诊所", "皮埃尔的杂货店", "星之果实酒吧", "旅行货车", "博物馆", "Joja超市",
    "鱼店", "赌场", "绿洲", "玛妮的牧场", "法师塔", "探险家公会", "木匠的商店", "冰淇淋摊", "电影院"]);

  // ———————————————————— 工具函数 ————————————————————
  const IMG = "assets/img/";
  const availableImages = new Set(D.imgs);
  const iconSrc = (name) => (name ? IMG + encodeURIComponent(name) : "");
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  function img(name, cls, alt) {
    const fallback = () => el("span", { class: (cls || "") + " noimg", role: "img", "aria-label": t("暂无图片"), title: t("暂无图片") }, "▧");
    if (!name || !availableImages.has(name)) return fallback();
    const node = el("img", { class: "pix " + (cls || ""), src: iconSrc(name), alt: alt || "", loading: "lazy", decoding: "async" });
    node.addEventListener("error", () => node.replaceWith(fallback()), { once: true });
    return node;
  }
  // 货币：中文用归档原名；英文按游戏写法，金币为 “1,000g”。
  const CURRENCY_EN = { 金色核桃: ["Golden Walnut", "Golden Walnuts"], 齐钻: ["Qi Gem", "Qi Gems"], 齐币: ["Qi Coin", "Qi Coins"],
    奖券: ["Prize Ticket", "Prize Tickets"], 卡利科蛋: ["Calico Egg", "Calico Eggs"], "JOPK 币": ["JOPK Coin", "JOPK Coins"] };
  const money = (n, cur) => {
    if (n == null) return "";
    if (!EN) return `${Number(n).toLocaleString("zh-CN")}${cur && cur !== "金" ? " " + cur : " 金"}`;
    const amount = Number(n).toLocaleString("en-US");
    if (!cur || cur === "金") return amount + "g";
    const names = CURRENCY_EN[cur];
    return names ? `${amount} ${Number(n) === 1 ? names[0] : names[1]}` : `${amount} ${N(cur)}`;
  };
  const fmtTime = (t24) => {
    const h = Math.floor(t24 / 100) % 24;
    const m = t24 % 100;
    if (!EN) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const minutesToTime = (min) => 600 + Math.floor(min / 60) * 100 + (min % 60);
  const timeToMinutes = (t24) => (Math.floor(t24 / 100) - 6) * 60 + (t24 % 100);
  const weekday = (day) => day % 7; // 每季 1 日是周一
  const qtyText = (q) => (q && q > 1 ? `${EN ? " " : ""}×${q}` : "");

  // ———————————————————— 数据索引 ————————————————————
  const itemByZh = new Map();
  for (const [id, it] of Object.entries(D.items)) if (!itemByZh.has(it.z)) itemByZh.set(it.z, id);
  const normalizedItemIds = new Map(Object.keys(D.items).map(id => [id.toLowerCase().replace(/ /g, "_"), id]));
  const canonicalItemId = id => typeof id === "string" ? normalizedItemIds.get(id.toLowerCase().replace(/ /g, "_")) || id : id;

  // —— 显示名：英文版取英文 Wiki 的名称，没有对应时如实保留原名并记录，便于补齐。 ——
  const missingNames = (L10N.missingNames = new Set());
  function N(zh) {
    if (!EN || zh == null || zh === "") return zh;
    const en = EN.names?.[zh] ?? D.pages[zh]?.e ?? (itemByZh.has(zh) ? D.items[itemByZh.get(zh)].e : null);
    if (en) return en;
    if (/[㐀-鿿]/.test(zh)) missingNames.add(zh);
    return zh;
  }
  const itemName = (it) => (!it ? "" : EN ? it.e || N(it.z) : it.z);
  // 商品备注里的星期（“周四”“周二随机供应”），英文版换成对应星期；其余备注只在中文版显示。
  const weekdayNote = (note) => {
    if (!EN || !note) return note;
    const m = note.match(/^周([一二三四五六日天])/);
    return m ? WEEKDAY_ZH["日一二三四五六".indexOf(m[1] === "天" ? "日" : m[1])] : null;
  };
  const nameOf = (idOrZh) => itemName(itemInfo(idOrZh) || { z: idOrZh });
  const matsText = (list) => L10N.list((list || []).map((m) => `${EN ? nameOf(m.id || m.zh || m.z) : m.zh || m.z || nameOf(m.id)}${qtyText(m.qty ?? m.q)}`));
  // 条目、鱼、地点的说明文字：英文版只用英文 Wiki 的原文；缺失时宁可不显示。
  function pageInfo(title) {
    const p = D.pages[title];
    if (!p) return null;
    if (!EN) return { s: p.s, f: p.f, sec: p.sec, u: p.u, kz: p.kz, src: p.src || [], dr: p.dr || [], ob: p.ob || [] };
    const e = EN.pages?.[title] || {};
    return { s: e.s || "", f: e.f || {}, sec: e.sec || [], u: e.u || null, kz: t(p.kz), src: e.src || [], dr: e.dr || [], ob: e.ob || [] };
  }
  function fishText(f) {
    // 时段、天气按条拼接，避免列表项渲染后首尾相连（“…晚上7:00鳟鱼大赛 全天”）。
    const join = list => (list?.length ? L10N.clauses(list) : null);
    if (!EN) return { lt: f.lt, st: f.st, tt: join(f.tl) || f.tt, wt: join(f.wl) || f.wt };
    const e = EN.fish?.[f.p] || {};
    return { lt: e.lt || "", st: e.st || "", tt: join(e.tl) || e.tt || "", wt: join(e.wl) || e.wt || "" };
  }
  function locText(l) {
    if (!l) return {};
    if (!EN) return { hours: l.hours, closed: l.closed, addr: l.addr };
    const e = EN.locations?.[l.p] || {};
    // 英文 Wiki 用换行分开“商店/建筑”等时段，单行显示时改用分号。
    return { hours: e.hours ? e.hours.replace(/\n+/g, "; ") : null, closed: e.closed ? e.closed.replace(/\n+/g, "; ") : null, addr: e.addr || null };
  }
  // 英文版没有游戏内说明时，用英文 Wiki 条目的导言代替。
  const itemDesc = (it) => (!it ? null : !EN ? it.d : (it.id && EN.items?.[it.id]) || (it.pg && EN.pages?.[it.pg]?.s) || null);

  const pageByItem = new Map();
  for (const [title, page] of Object.entries(D.pages)) if (page.id && !pageByItem.has(page.id)) pageByItem.set(page.id, { title, page });
  const recipesByOut = new Map();
  for (const r of D.recipes) {
    const key = r.out.id || "zh:" + r.out.z;
    if (!recipesByOut.has(key)) recipesByOut.set(key, []);
    recipesByOut.get(key).push(r);
  }
  const usedIn = new Map();
  for (const r of D.recipes) for (const x of r.in) {
    if (!x.id) continue;
    if (!usedIn.has(x.id)) usedIn.set(x.id, []);
    usedIn.get(x.id).push(r);
  }
  const shopsByItem = new Map();
  for (const s of D.shops) for (const e of s.stock) {
    const key = e.id || "zh:" + e.z;
    if (!shopsByItem.has(key)) shopsByItem.set(key, []);
    shopsByItem.get(key).push({ shop: s.p, e });
  }
  const chainByItem = new Map();
  for (const ch of D.chains) ch.tiers.forEach((t, i) => t.id && chainByItem.set(t.id, { chain: ch, tier: i }));
  const bundleUse = new Map();
  const bundleReward = new Map();
  for (const room of D.bundles) for (const b of room.bundles) {
    for (const x of b.items) if (x.id) (bundleUse.get(x.id) || bundleUse.set(x.id, []).get(x.id)).push({ room: room.room, bundle: b });
    for (const x of b.reward || []) if (x.id) (bundleReward.get(x.id) || bundleReward.set(x.id, []).get(x.id)).push({ room: room.room, bundle: b, qty: x.qty });
  }
  const villagerByName = new Map(D.villagers.map((v) => [v.p, v]));
  const giftsByItem = new Map();
  for (const v of D.villagers) for (const t of ["love", "like"]) for (const id of v[t]) {
    if (!giftsByItem.has(id)) giftsByItem.set(id, { love: [], like: [] });
    giftsByItem.get(id)[t].push(v.p);
  }
  const locationByName = new Map(D.locations.map((l) => [l.p, l]));
  const fishByName = new Map(D.fish.map((f) => [f.p, f]));
  const oreHint = new Map(D.progression.ore_hints.map((h) => [h.zh, h]));

  function itemInfo(idOrZh) {
    if (!idOrZh) return null;
    const canonical = canonicalItemId(idOrZh);
    const id = D.items[canonical] ? canonical : itemByZh.get(idOrZh);
    if (id) return { id, ...D.items[id] };
    const entry = pageByItem.get(idOrZh);
    const page = D.pages[idOrZh] || entry?.page;
    const title = D.pages[idOrZh] ? idOrZh : entry?.title;
    return page ? { id: null, z: title, e: page.e, i: page.i, c: page.kz, d: page.s, pg: title } : { id: null, z: idOrZh };
  }

  function buildingChains() {
    const byName = new Map(D.buildings.map((b) => [b.name, b]));
    const heads = D.buildings.filter((b) => !b.upgrade_from && D.buildings.some((x) => x.upgrade_from === b.name));
    return heads.map((head) => {
      const tiers = [head];
      let cur = head;
      for (;;) {
        const next = D.buildings.find((x) => x.upgrade_from === cur.name);
        if (!next || tiers.includes(next)) break;
        tiers.push(next);
        cur = next;
      }
      return { chain: head.name, tiers, byName };
    });
  }

  // 世界进度表的条件说明、原文引用只用于显示；英文版换成英文 Wiki 原句，ID 与门槛不变。
  function localizeCurated() {
    const P = EN?.progression;
    if (!P) return;
    for (const a of D.progression.areas) {
      const e = P.areas?.[a.id];
      if (!e) continue;
      a.requires.forEach((q, i) => Object.assign(q, e.requires?.[i] || {}));
      if (e.quote) a.quote = e.quote;
      if (e.source) a.source = e.source;
    }
    for (const f of D.progression.features) {
      const e = P.features?.[f.id];
      if (e) Object.assign(f, { quote: e.quote, joja: e.joja, source: e.source });
    }
    for (const h of D.progression.ore_hints) Object.assign(h, P.ore_hints?.[h.zh] || {});
    D.progression.tool_unlocks.forEach((u, i) => Object.assign(u, P.tool_unlocks?.[i] || {}));
  }
  const areaTitle = (id) => (EN?.progression?.areas?.[id]?.title) || N(AREAS[id]?.title);

  // ———————————————————— 状态 ————————————————————
  const STORE = "sdv-proto-v1";
  const PRESETS = {
    sample: {
      label: t("示例：第一年秋"),
      note: t("示例进度：铜斧头、钢十字镐，社区中心完成了工艺室和锅炉房。"),
      progress: {
        skills: { farming: 6, mining: 5, foraging: 4, fishing: 4, combat: 3 },
        tools: { 斧头: 1, 十字镐: 2, 锄头: 0, 喷壶: 1, "垃圾桶（工具）": 0 },
        rod: 2, buildings: { 农舍: 1, 鸡舍: 0, 畜棚: -1, 小屋: -1 },
        rooms: ["工艺室", "锅炉房"], museum: 34, mineDepth: 72, flags: { boat_repaired: false }, owned: {},
      },
    },
    fresh: {
      label: t("新存档"),
      note: t("刚开始游戏：初始工具，没有额外建筑。"),
      progress: {
        skills: { farming: 0, mining: 0, foraging: 0, fishing: 0, combat: 0 },
        tools: { 斧头: 0, 十字镐: 0, 锄头: 0, 喷壶: 0, "垃圾桶（工具）": 0 },
        rod: -1, buildings: { 农舍: 0, 鸡舍: -1, 畜棚: -1, 小屋: -1 },
        rooms: [], museum: 0, mineDepth: 0, flags: { boat_repaired: false }, owned: {},
      },
    },
    year2: {
      label: t("示例：第二年春"),
      note: t("示例进度：社区中心只差金库，铱制工具尚未开始。"),
      progress: {
        skills: { farming: 9, mining: 8, foraging: 7, fishing: 7, combat: 6 },
        tools: { 斧头: 3, 十字镐: 3, 锄头: 2, 喷壶: 3, "垃圾桶（工具）": 1 },
        rod: 3, buildings: { 农舍: 2, 鸡舍: 1, 畜棚: 1, 小屋: 0 },
        rooms: ["工艺室", "茶水间", "鱼缸", "锅炉房", "布告栏"], museum: 64, mineDepth: 120, flags: { boat_repaired: false }, owned: {},
      },
    },
    unknown: {
      label: t("全部未确认"),
      note: t("不预设任何进度：所有依赖进度的条件都显示为“未确认”。"),
      progress: {
        skills: { farming: null, mining: null, foraging: null, fishing: null, combat: null },
        tools: { 斧头: null, 十字镐: null, 锄头: null, 喷壶: null, "垃圾桶（工具）": null },
        rod: null, buildings: { 农舍: null, 鸡舍: null, 畜棚: null, 小屋: null },
        rooms: null, museum: null, mineDepth: null, flags: { boat_repaired: null }, owned: {},
      },
    },
  };
  const DEFAULT = { cond: { season: "spring", day: 1, weather: "sun", time: 600, year: 1 }, preset: "unknown", plan: [] };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "null");
      if (saved && saved.cond && saved.progress) {
        // A saved scenario isn't a live game connection. Each visit starts as
        // a reference wiki; keep values and progress, but require explicit comparison.
        saved.conditionsEnabled = false;
        saved.plan = (saved.plan || []).map(ref => ref.type === "item" ? { ...ref, id: canonicalItemId(ref.id) } : ref);
        if (saved.progress.owned) saved.progress.owned = Object.fromEntries(Object.entries(saved.progress.owned).map(([id, value]) => [canonicalItemId(id), value]));
        return saved;
      }
    } catch (e) { /* 忽略损坏的存储 */ }
    return { cond: { ...DEFAULT.cond }, conditionsEnabled: false, progress: structuredClone(PRESETS.unknown.progress), preset: "unknown", plan: [], fx: false };
  }
  const state = loadState();
  const listeners = new Set();
  let saveTimer = 0;
  function emit(reason) {
    App.cache = {};
    for (const fn of listeners) fn(reason);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* 隐私模式 */ }
    }, 150);
  }
  function setCond(patch) {
    state.conditionsEnabled = true;
    Object.assign(state.cond, patch);
    const allowed = SEASON_WEATHER[state.cond.season];
    if (!allowed.includes(state.cond.weather)) state.cond.weather = allowed[0];
    emit("cond");
  }
  const conditionsActive = () => state.conditionsEnabled === true;
  function setConditionsEnabled(enabled) { state.conditionsEnabled = !!enabled; emit("cond"); }
  function setProgress(mutator, label) {
    mutator(state.progress);
    state.preset = "custom";
    emit("progress:" + (label || ""));
  }
  function applyPreset(key) {
    state.progress = structuredClone(PRESETS[key].progress);
    state.preset = key;
    if (state.spoilers) state.spoilers.known = [];
    emit("progress:preset");
  }

  // ———————————————————— 条件求值 ————————————————————
  // 结果：{ ok: true | false | null(未确认), text, hint, note }。hint 只说明对照状态，note 是不依赖对照的补充说明。
  const R = (ok, text, hint, note) => ({ ok, text, hint, note });
  const ccComplete = () => (state.progress.rooms == null ? null : ROOMS.every((r) => state.progress.rooms.includes(r)));

  function evalReq(req) {
    const P = state.progress;
    const C = state.cond;
    switch (req.type) {
      case "date": {
        if (!conditionsActive()) return R(null, req.text);
        if (C.year > 1) return R(true, req.text, t("第一年之后不受影响"));
        const ok = SEASONS.indexOf(C.season) > 0 || C.day >= req.day;
        return R(ok, req.text, ok ? null : t("现在是第一年春季 {day} 日", { day: C.day }));
      }
      case "tool": {
        const v = P.tools?.[req.family];
        if (v == null) return R(null, req.text, t("未确认工具等级"));
        const chain = D.chains.find((c) => c.family === req.family);
        return R(v >= req.tier, req.text, v >= req.tier ? null : t("目前是{tool}", { tool: nameOf(chain.tiers[v].id || chain.tiers[v].zh) }));
      }
      case "room": {
        if (P.rooms == null) return R(null, req.text, t("未确认社区中心进度"), req.joja ? t("Joja 路线：{route}", { route: req.joja }) : null);
        return R(P.rooms.includes(req.room), req.text, null, req.joja ? t("Joja 路线：{route}", { route: req.joja }) : null);
      }
      case "museum":
        if (P.museum == null) return R(null, req.text, t("未确认博物馆捐赠数"));
        return R(P.museum >= req.count, req.text, t("目前捐赠 {n} 件", { n: P.museum }));
      case "mine_depth":
        if (P.mineDepth == null) return R(null, req.text, t("未确认矿井层数"));
        return R(P.mineDepth >= req.depth, req.text, t("目前到达 {n} 层", { n: P.mineDepth }));
      case "area": {
        const a = areaState(req.area);
        return R(a.state === "open" ? true : a.state === "locked" ? false : null, req.text || t("可进入{place}", { place: areaTitle(req.area) }));
      }
      case "cc_complete": {
        const ok = ccComplete();
        const done = P.rooms ? ROOMS.filter((r) => P.rooms.includes(r)).length : null;
        return R(ok, req.text || t("社区中心修复"), done == null ? t("未确认社区中心进度") : t("已完成 {done}/{total} 个房间", { done, total: ROOMS.length }));
      }
      case "flag": {
        const v = P.flags?.[req.flag];
        return R(v == null ? null : !!v, req.text, v == null ? t("未确认") : null);
      }
      case "skill": {
        const v = P.skills?.[req.skill];
        if (v == null) return R(null, req.text, t("未确认技能等级"));
        return R(v >= req.level, req.text, v >= req.level ? null : t("目前 {n} 级", { n: v }));
      }
      case "building": {
        const v = P.buildings?.[req.chain];
        if (v == null) return R(null, req.text, t("未确认建筑"));
        return R(v >= req.tier, req.text);
      }
      case "rod": {
        if (P.rod == null) return R(null, req.text, t("未确认鱼竿"));
        return R(P.rod >= req.tier, req.text);
      }
      case "owned":
        return R(P.owned?.[req.id] ? true : false, req.text);
      case "weekday": {
        const sold = t("{day}出售", { day: WEEKDAY_ZH[req.wd] });
        if (!conditionsActive()) return R(null, sold);
        const wd = weekday(C.day);
        return R(wd === req.wd, sold, wd === req.wd ? t("今天就是") : t("今天是{day}", { day: WEEKDAY_ZH[wd] }));
      }
      case "node": {
        const s = App.progression.status(req.id).status;
        const n = App.progression.nodes.get(req.id);
        return R(s === "done" ? true : s === "unknown" ? null : false, req.text || n.name || n.title);
      }
      case "info":
        return R(undefined, req.text, req.hint);
      case "unknown":
        return R(null, req.text, req.hint || t("此条件尚未确认"));
      case "recipe": {
        const known = P.recipes?.[req.id];
        return R(known == null ? null : !!known, req.text || t("已学会配方"), known == null ? t("没有记录已学配方；解锁门槛不等于已经学会") : null);
      }
      case "equipment": {
        const values = (req.ids || []).map(id => P.owned?.[id]);
        const ok = values.some(v => v === true) ? true : values.length && values.every(v => v === false) ? false : null;
        return R(ok, req.text, ok === null ? t("未记录可用设备") : null);
      }
      case "cooking_access": {
        const house = P.buildings?.农舍;
        const portable = P.owned?.[itemByZh.get("野炊工具")];
        return R(house >= 1 || portable === true ? true : null, t("使用厨房或野炊工具"), t("厨房可由农舍升级确认；野炊工具是否可用未完整记录"));
      }
      default:
        return R(null, req.text || req.type);
    }
  }

  function combine(results) {
    const real = results.filter((r) => r.ok !== undefined);
    if (real.some((r) => r.ok === false)) return false;
    if (real.some((r) => r.ok === null)) return null;
    return true;
  }

  function areaState(id) {
    const memo = (App.cache.area ||= {});
    if (memo[id]) return memo[id];
    const area = AREAS[id];
    const checks = area.requires.map(evalReq);
    const ok = combine(checks);
    return (memo[id] = { state: ok === true ? "open" : ok === false ? "locked" : "unknown", checks, area });
  }

  function locationGate(name) {
    const id = LOCATION_AREA[name];
    if (!id) return null;
    return areaState(id);
  }

  // —— 鱼：详情、地点和分类共用逐水域规则，不能把多地点的季节取并集后判断。 ——
  // 校正规则依据 data/build/page-text.jsonl 同名条目的导言（2025-12-18 归档）。
  // 保留原始 Wiki 字段供核对；未建模的例外只给未确认，不猜测为满足。
  const FORAGE_COLLECTION = new Set(["珊瑚", "海胆", "彩虹贝壳", "鹦鹉螺"]);
  const ISLAND_ALL_SEASONS = new Set(["金枪鱼", "河豚", "大海参", "比目鱼", "罗非鱼", "午夜鲤鱼"]);
  const LEGEND_LEVELS = { 传说之鱼: 10, 鮟鱇鱼: 3, 绯红鱼: 5, 冰川鱼: 6 };
  const fishingLevelRequired = f => LEGEND_LEVELS[f.p] || (f.p === "蝎鲤鱼" ? 4 : null);
  // 归档《夜市》“钓鱼潜艇”：17:00–23:00 可登船，船票 1,000 金，可一直钓到凌晨 2:00；
  // 午夜鱿鱼、幽灵鱼、水滴鱼只在潜艇里出现，魔法鱼饵是例外（沙滩西南角，站位见各鱼条目）。
  const SUBMARINE = { open: 1700, close: 2300, end: 2600, fare: 1000 };
  const isSubmarineFish = f => (f.L || []).includes("夜市");
  const habitatName = loc => (loc === "夜市" ? t("夜市钓鱼潜艇") : N(loc));
  function submarineFacts() {
    return [
      { text: t("日期：冬季 15–17 日（夜市）") },
      { text: t("登船：{open}–{close}，船票 {fare}", { open: fmtTime(SUBMARINE.open), close: fmtTime(SUBMARINE.close), fare: money(SUBMARINE.fare) }) },
      { text: t("可一直钓到 {end}", { end: fmtTime(SUBMARINE.end) }) },
    ];
  }
  // 时段、天气、特殊要求按 Wiki 信息框逐条保存；英文版取英文 Wiki 的同一字段。
  function fishRules(f) {
    const e = EN ? EN.fish?.[f.p] || {} : f;
    return { tl: e.tl || [], wl: e.wl || [], req: e.req || [] };
  }
  // 常规时段、天气之外的条目（鳟鱼大赛全天、瀑布任意时间……）要单独显示，不能并进常规条件。
  const isPlainTime = s => !s.replace(/上午|下午|晚上|凌晨|中午|早上|午夜|至|到|全天|任意时间|任何时间|任何|任意|随时|anytime|any time|all day|[ap]\.?m\.?|\d|[:：–\-~\s.()（）]/gi, "").trim();
  const isPlainWeather = s => !s.replace(/晴天|雨天|暴风雨|下雪|刮风|任意天气|任意|任何|晴|雨|雪|风|sunny|sun|rainy|rain|storms?|snow|windy|wind|any|both|\bor\b|\band\b|[•,，、\s]/gi, "").trim();
  const fishTimeExtras = f => fishRules(f).tl.filter(s => !isPlainTime(s));
  const fishWeatherExtras = f => fishRules(f).wl.filter(s => !isPlainWeather(s));
  function fishTimeText(f) {
    const { tl } = fishRules(f), extra = fishTimeExtras(f);
    // 只有一条文字说明（如“夜市的任何时间”）时直接用原文，不再重复换算后的时段。
    if (tl.length && extra.length === tl.length) return L10N.clauses(extra);
    return L10N.clauses([f.T?.length ? timeSpans(f.T) : null, ...extra]) || fishText(f).tt || null;
  }
  function fishWeatherText(f) {
    const base = f.W?.includes("any") ? t("任意天气") : L10N.list((f.W || []).map(w => WEATHER[w]?.zh || w));
    return L10N.clauses([base, ...fishWeatherExtras(f)]) || fishText(f).wt || null;
  }
  // 蟹笼：归档《蟹笼》导言与“海洋”“淡水”两节。
  function crabFacts(f) {
    return [{ text: t("放置蟹笼并放入任意鱼饵，第二天收取；选择“诱饵大师”职业后不需要鱼饵") },
      f.cw === "ocean" ? { text: t("水体：海洋（在任意海水中放置）") } : f.cw === "fresh" ? { text: t("水体：淡水（河流、湖泊、池塘等）") } : null].filter(Boolean);
  }
  function fishRequirements(f) {
    const facts = [];
    if (isSubmarineFish(f)) facts.push({ text: t("只在夜市的钓鱼潜艇里出现，在普通海边钓不到") },
      { text: t("使用魔法鱼饵时例外：也能在沙滩西南角钓到（站位见原文）") });
    // 传说鱼：Wiki 导言逐条列出的特殊要求（钓鱼等级、站位、浮标所在水域）。
    const req = fishRules(f).req;
    if (req.length) facts.push(...req.map(text => ({ text })));
    else if (fishingLevelRequired(f)) facts.push({ text: t("钓鱼等级至少 {n} 级", { n: fishingLevelRequired(f) }) });
    if (f.qi) facts.push({ text: t("只在齐先生的“大家族”特别任务期间出现，任务期间可钓起多条") });
    else if (f.legend) facts.push({ text: t("每个存档只能钓起一次（多人游戏中每位玩家各一次）") });
    return facts;
  }
  const WATER_LOCATIONS = {
    "valley:285:210": "沙滩", "valley:280:53": "深山", "valley:96:152": "煤矿森林池塘",
    "valley:210:160": "鹈鹕镇河流", "valley:138:165": "煤矿森林河流",
  };
  function fishMethod(f) { return FORAGE_COLLECTION.has(f.p) ? "forage" : f.crab ? "crab" : "rod"; }
  function fishHabitats(f) {
    let list;
    if (f.p === "鲶鱼") list = [
      { location: "鹈鹕镇河流", seasons: ["spring", "fall", "winter"] },
      { location: "煤矿森林河流", seasons: ["spring", "fall", "winter"] },
      { location: "秘密森林", seasons: ["spring", "summer", "fall", "winter"] },
      { location: "巫婆沼泽", seasons: ["spring", "summer", "fall", "winter"] },
    ];
    else if (f.p === "鲤鱼") list = [
      { location: "深山", seasons: ["spring", "summer", "fall"] },
      ...["秘密森林", "下水道", "突变虫穴"].map(location => ({ location, seasons: ["all"] })),
    ];
    else {
      const locations = new Set(f.L || []);
      for (const [x, y, map] of f.pins || []) {
        const loc = WATER_LOCATIONS[`${map}:${x}:${y}`];
        if (loc) locations.add(loc);
        if (map === "island") locations.add("姜岛");
      }
      if (ISLAND_ALL_SEASONS.has(f.p)) locations.add("姜岛");
      // 海参、大海参、章鱼也会在夜市潜艇里上钩（归档《夜市》“钓鱼潜艇”表）。
      if (f.sub) locations.add("夜市");
      list = [...locations].map(location => ({ location }));
      // “农场地图”没有指定农场类型，不能作为一个无条件开放的替代水域。
      list = list.filter(h => h.location !== "农场地图");
      if (f.p === "金枪鱼") for (const h of list) h.seasons = h.location === "姜岛" ? ["all"] : ["summer", "winter"];
    }
    for (const h of list) {
      h.area = LOCATION_AREA[h.location] || null;
      if (h.location === "夜市") h.seasons = ["winter"];
      h.seasons ||= (["珊瑚", "海胆"].includes(f.p) || (h.location === "姜岛" && ISLAND_ALL_SEASONS.has(f.p))) ? ["all"] : f.S;
      if (h.location === "姜岛" && f.p === "章鱼") h.unknown = t("姜岛水域的独立季节条件尚未核验");
      if (f.p === "鲶鱼" || f.p === "大眼鱼" || f.p === "红鲷鱼") h.winterTotem = true;
      if (h.location === "矿井") h.depth = ({ 鬼鱼: 20, 石鱼: 20, 冰柱鱼: 60, 岩浆鳗鱼: 100, 白藻: 20 })[f.p];
      if (h.location === "火山地牢" || (f.p === "岩浆鳗鱼" && h.location === "姜岛")) {
        h.area = "ginger_island"; h.level = 7; h.unknown = t("火山口的实际可达状态尚未记录");
      }
      if (h.location === "突变虫穴") h.unknown = t("突变虫穴任务准入尚未记录；能进下水道不代表可进虫穴");
      if (f.p === "黄貂鱼") h.unknown = t("海岛度假村与海盗湾准入尚未记录");
      if (f.p === "虾虎鱼") h.unknown = t("需在煤矿森林南部瀑布底部的特定水域抛竿");
      if (f.var && !["金枪鱼", "鲶鱼"].includes(f.p)) h.unknown = t("不同水域的特殊规则尚未核验");
    }
    return list;
  }
  const fishLocations = f => fishHabitats(f).map(h => h.location);
  const timeSpans = ranges => L10N.list(ranges.map(([a, b]) => a === 600 && b === 2600 ? t("全天") : `${fmtTime(a)}–${fmtTime(b)}`));
  function fishCheck(f, options = {}) {
    const C = state.cond, F = { ...(state.progress.fishing || {}), ...options };
    const method = fishMethod(f);
    const assumptions = [t("按普通钓鱼条件判断；未计入魔法鱼饵"), t("地点为水域示意，出现条件满足不保证本次咬钩")];
    if (!conditionsActive()) return { ok: null, method, crab: method === "crab", where: [], locked: [], habitats: [], assumptions,
      checks: [R(null, t("未启用条件对照；可直接查看各水域的获取规则"))] };
    if (method !== "rod") return { ok: null, method, crab: method === "crab", where: [], locked: [], habitats: [], assumptions,
      checks: method === "crab" ? crabFacts(f).map(x => R(undefined, x.text)) : [R(null, t("沙滩采集物，不是钓竿捕获结果"))] };
    let habitats = fishHabitats(f);
    if (F.location) habitats = habitats.filter(h => h.location === F.location);
    if (F.point) {
      const [x, y, map] = F.point, key = `${map}:${x}:${y}`, canonical = D.mapPointAliases[key] || key;
      const area = map === "island" ? "ginger_island" : D.mapPoints[canonical]?.area;
      const location = WATER_LOCATIONS[canonical];
      habitats = habitats.filter(h => area ? h.area === area : location ? h.location === location : !h.area);
    }
    const raining = C.weather === "rain" || C.weather === "storm" || F.rainTotem === true;
    const common = [];
    if (f.qi) common.push(R(F.familyQuest == null ? null : !!F.familyQuest, t("需在“大家族”特别任务期间"), t("任务状态未确认时不能判断为可钓")));
    if (f.qi) common.push(R(null, t("特别任务鱼的独立技能与抛竿要求尚未完整核验"), t("不把普通传说鱼的全部条件直接套用为已核验规则")));
    const level = F.effectiveLevel ?? state.progress.skills.fishing;
    const minLevel = fishingLevelRequired(f);
    if (minLevel) common.push(R(level == null ? null : level >= minLevel, t("钓鱼等级至少 {n} 级", { n: minLevel }), t("使用已填技能等级；食物等临时等级可改变结论")));
    if (f.legend) {
      if (!["变种鲤鱼", "放射性鲤鱼"].includes(f.p)) common.push(R(F.positionConfirmed?.[f.id] === true ? true : null, t("站位与浮标位置符合上方的特殊要求"), t("普通地图标记不能确认浮标位置")));
      if (!f.qi) common.push(R(F.caught?.[f.id] == null ? null : !F.caught[f.id], t("此角色尚未钓起过这条传说鱼"), t("捕获记录尚未确认")));
    }
    if (F.rod === "training" && (f.d >= 50 || f.p === "虾虎鱼")) common.push(R(false, t("训练用鱼竿不能捕获此目标")));
    const results = habitats.map(h => {
      const checks = [...common];
      if (h.area) checks.push(evalReq({ type: "area", area: h.area, text: t("可进入{place}", { place: N(h.location) }) }));
      checks.push(R(true, t("地点：{place}", { place: N(h.location) })));
      if (h.depth) checks.push(evalReq({ type: "mine_depth", depth: h.depth, text: t("到达矿井 {n} 层水域", { n: h.depth }) }));
      if (h.level) checks.push(R(level == null ? null : level >= h.level, t("此水域需钓鱼 {n} 级", { n: h.level })));
      if (h.location === "夜市") {
        checks.push(R(C.season === "winter" && C.day >= 15 && C.day <= 17, t("冬季 15–17 日夜市")));
        checks.push(R(C.time < SUBMARINE.close ? true : null, t("23:00 前进入钓鱼潜艇"), C.time >= SUBMARINE.close ? t("当前已过入场时间；是否已在艇内未确认") : null));
        checks.push(R(undefined, t("船票 {price}", { price: money(SUBMARINE.fare) })));
      } else if (h.seasons?.length) {
        checks.push(R(h.seasons.includes("all") || h.seasons.includes(C.season), h.seasons.includes("all") ? t("任意季节") : L10N.list(h.seasons.map(s => SEASON_ZH[s]))));
      } else checks.push(R(null, t("季节条件资料尚未完整核验")));
      if (h.winterTotem && C.season === "winter") checks.push(R(F.rainTotem == null ? null : !!F.rainTotem, t("冬季需雨水图腾改变天气")));
      // 潜艇是室内钓鱼：登船时段代替鱼的常规时段，天气不影响。
      if (h.location === "夜市") {
        if (h.unknown) checks.push(R(null, h.unknown));
        return { ...h, checks, ok: combine(checks) };
      }
      if (f.W?.length) {
        const localRain = h.area === "ginger_island" && F.islandWeather ? ["rain", "storm"].includes(F.islandWeather) : raining;
        const ok = f.W.includes("any") ? true : h.area === "ginger_island" && !F.islandWeather ? null
          : (f.W.includes("rain") && localRain) || ((f.W.includes("sun") || f.W.includes("wind")) && !localRain);
        checks.push(R(ok, f.W.includes("any") ? t("任意天气") : f.W.includes("rain") ? t("雨天（含暴风雨）") : t("非雨天"),
          ok === null ? t("姜岛天气不能由山谷天气推定") : null));
      } else checks.push(R(null, t("天气条件尚未完整核验")));
      if (f.T?.length) checks.push(R(f.T.some(([a, b]) => C.time >= a && C.time < b), timeSpans(f.T)));
      else checks.push(R(null, t("时段条件尚未完整核验")));
      for (const extra of [...fishTimeExtras(f), ...fishWeatherExtras(f)]) checks.push(R(undefined, t("另外：{rule}", { rule: extra })));
      if (h.unknown) checks.push(R(null, h.unknown));
      return { ...h, checks, ok: combine(checks) };
    });
    const best = results.find(h => h.ok === true) || results.find(h => h.ok === null) || results[0];
    const ok = results.some(h => h.ok === true) ? true : results.length && results.every(h => h.ok === false) ? false : null;
    return { ok, method, checks: best?.checks || [R(null, t("此水域的资料尚未完整核验"))],
      where: results.filter(h => h.ok !== false).map(h => h.location),
      locked: results.filter(h => h.area && areaState(h.area).state === "locked").map(h => ({ loc: h.location, area: AREAS[h.area] })),
      habitats: results, assumptions };
  }

  // —— 商店此刻是否营业 ——
  function shopCheck(loc) {
    const C = state.cond;
    const hours = locText(loc).hours;
    if (!conditionsActive()) {
      if (!loc.hours && !loc.R?.length) return null;
      // 未启用对照时也写出休息日：查购买途径时，休息日和营业时段同样重要。
      // 中文归档只写“星期三”；英文 Wiki 与下方对照规则都注明社区中心修复后不再休息。
      const closed = !EN && loc.p === "皮埃尔的杂货店" ? "星期三（社区中心修复前）" : locText(loc).closed;
      const oneLine = text => text.replace(/\n+/g, EN ? "; " : "；");
      return { ok: null, range: loc.R?.[0], text: L10N.clauses([hours ? t("开放时间：{hours}", { hours: oneLine(hours) }) : t("开放时间见条目"),
        closed && !["无", "Never", "None"].includes(closed) ? t("休息：{days}", { days: oneLine(closed) }) : null]) };
    }
    if (!loc.R || !loc.R.length) return null;
    // 玛妮页面把建筑开放时间列在营业时间之前，买卖不能使用建筑时间。
    const range = [...(loc.p === "玛妮的牧场" ? loc.R[loc.R.length - 1] : loc.R[0])];
    const wd = weekday(C.day);
    const raining = C.weather === "rain" || C.weather === "storm";
    const text = loc.closed || "";
    let closedToday = false;
    let why = null;
    let unknownClosure = false;
    if (loc.p === "皮埃尔的杂货店" && wd === 3) {
      const cc = ccComplete();
      if (cc === false) { closedToday = true; why = t("周三休息（社区中心修复前）"); }
      else if (cc === null) unknownClosure = true;
    } else if (/社区中心/.test(text) && !loc.cd.length) {
      const cc = ccComplete();
      if (cc) { closedToday = true; why = locText(loc).closed || t("社区中心修复后休息"); }
      else if (cc === null) unknownClosure = true;
    } else if (loc.cd.includes(wd)) {
      if (/不下雨/.test(text)) closedToday = !raining;
      else if (/社区中心/.test(text)) { const cc = ccComplete(); closedToday = cc === true; unknownClosure = cc === null; }
      else closedToday = true;
      if (closedToday) why = t("{day}休息", { day: WEEKDAY_ZH[wd] });
    }
    // 归档《旅行货车》：普通山谷摊位只在周五和周日；夜市/沙漠节另有地点。
    if (loc.p === "旅行货车" && ![0, 5].includes(wd)) { closedToday = true; why = t("普通山谷摊位只在周五和周日营业；节日摊位另计"); }
    if (loc.p === "木匠的商店" && wd === 5) range[1] = 1600;
    if (loc.p === "木匠的商店" && C.season === "summer" && C.day === 18) { closedToday = true; why = t("夏季 18 日罗宾看诊，商店休息"); }
    if (loc.p === "玛妮的牧场" && ["fall", "winter"].includes(C.season) && C.day === 18) { closedToday = true; why = t("秋季、冬季 18 日玛妮不在柜台；动物目录效果未记录"); }
    if (loc.p === "绿洲" && ((C.season === "spring" && C.day >= 15 && C.day <= 17) || (C.season === "fall" && C.day === 15 && C.time >= 1300))) { closedToday = true; why = t("归档记载的特殊休息日期"); }
    if (/雨天/.test(text) && raining) { closedToday = true; why = t("雨天休息"); }
    if (closedToday) return { ok: false, text: why || t("今天休息"), range };
    const open = C.time >= range[0] && C.time < range[1];
    if (open) {
      // 节日与店主事件优先级尚未完整结构化。该日不把常规时刻表当营业保证。
      const festivalDays = { spring: [13, 24], summer: [11, 28], fall: [16, 27], winter: [8, 25] };
      if (BUSINESSES.has(loc.p) && festivalDays[C.season].includes(C.day)) return { ok: null, text: t("节日当天的营业例外尚未完整核验"), range };
      if (unknownClosure) return { ok: null, text: t("常规营业时段内，社区中心相关休息状态未确认"), range };
      const left = timeToMinutes(range[1]) - timeToMinutes(C.time);
      return { ok: true, text: left <= 60 ? t("{time} 打烊，还剩 {n} 分钟（常规时刻表）", { time: fmtTime(range[1]), n: left }) : t("常规营业到 {time}", { time: fmtTime(range[1]) }), range, soon: left <= 60, assumptions: [t("按已收录的常规营业和特殊休息日期判断；未同步店主事件与当天施工")] };
    }
    return { ok: false, text: C.time < range[0] ? t("{time} 开门", { time: fmtTime(range[0]) }) : t("已打烊（{from}–{to}）", { from: fmtTime(range[0]), to: fmtTime(range[1]) }), range };
  }

  // —— 作物：今天种下，本季还来得及吗 ——
  const dayLabel = (season, day) => t("{season} {day} 日", { season: SEASON_SHORT[season], day });
  function seedCheck(s) {
    const C = state.cond;
    if (!s.g || !s.S.length) return null;
    if (!conditionsActive()) return null;
    const assumptions = [t("室外种植，按基础生长天数"), t("每天浇水；未计肥料、职业与其他加速"), t("未计算产量、品质、加工收益和预算")];
    const si = SEASONS.indexOf(C.season);
    if (!(s.S.includes(C.season) || s.S.includes("all"))) return { ok: false, text: t("需{seasons}", { seasons: L10N.list(s.S.map((x) => SEASON_ZH[x])) }), assumptions };
    let span = 1;
    for (let k = 1; k < 4; k++) if (s.S.includes(SEASONS[(si + k) % 4])) span++; else break;
    const lastDay = 28 * span;
    const harvest = C.day + s.g;
    const dateOf = day => {
      const offset = Math.floor((day - 1) / 28), season = SEASONS[(si + offset) % 4], date = (day - 1) % 28 + 1;
      return { year: C.year + Math.floor((si + offset) / 4), season, day: date, label: dayLabel(season, date) };
    };
    const harvestDate = dateOf(harvest);
    if (harvest > lastDay) return { ok: false, harvest, harvestDate, harvestDates: [], text: t("要 {n} 天，适生季结束前长不成", { n: s.g }), assumptions, latestPlantingDay: lastDay - s.g };
    const extra = s.rg ? Math.floor((lastDay - harvest) / s.rg) : 0;
    const label = harvest > 28 ? dayLabel(SEASONS[(si + Math.floor((harvest - 1) / 28)) % 4], ((harvest - 1) % 28) + 1) : t("{day} 日", { day: harvest });
    return { ok: true, harvest, harvestDate, harvestDates: Array.from({ length: extra + 1 }, (_, i) => dateOf(harvest + i * (s.rg || 0))),
      text: extra ? t("{date}收获，之后还能收 {n} 次", { date: label, n: extra }) : t("{date}收获", { date: label }), extra, assumptions, latestPlantingDay: lastDay - s.g, seasonEnd: dateOf(lastDay) };
  }

  // 最晚播种日：按适生季节的连续区间与基础生长天数推算，作物在区间最后一季的 28 日前成熟。
  function latestPlanting(s) {
    if (!s.g || !s.S?.length || s.S.includes("all")) return [];
    const inSeason = SEASONS.map(x => s.S.includes(x)), out = [];
    for (let i = 0; i < 4; i++) {
      if (!inSeason[i] || inSeason[(i + 1) % 4]) continue;
      let span = 1;
      while (span < 4 && inSeason[(i - span + 4) % 4]) span++;
      const latest = 28 * span - s.g;
      if (latest < 1) continue;
      out.push(dayLabel(SEASONS[(i - span + 1 + Math.floor((latest - 1) / 28) + 4) % 4], (latest - 1) % 28 + 1));
    }
    return out;
  }

  function birthdayToday() {
    if (!conditionsActive()) return [];
    const C = state.cond;
    return D.villagers.filter((v) => v.bd && v.bd.season === C.season && v.bd.day === C.day);
  }

  // ———————————————————— 获取途径 ————————————————————
  const KIND_LABEL = { crafting: t("打造"), cooking: t("烹饪"), processing: t("加工"), tailoring: t("裁缝") };
  // 只有打造和烹饪配方需要先学会；加工、裁缝放进设备就能做。
  const LEARNED_KINDS = new Set(["crafting", "cooking"]);

  // 配方条件的显示文本：中文用归档原文；英文按结构生成，或取英文 Wiki 的配方来源原文。
  function conditionText(c, recipeId, index) {
    if (!EN) return c.text;
    const english = recipeId && EN.recipes?.[recipeId];
    if (c.group === "skill") return t("{skill} {level} 级", { skill: skillName(c.skill), level: c.level });
    if (c.group === "mastery") return c.skill ? t("{skill}精通", { skill: skillName(c.skill) }) : t("精通");
    return english?.c?.[index] || english?.u || null;
  }
  function conditionReqs(uc, recipeId) {
    return (uc || []).map((c, i) => {
      const text = conditionText(c, recipeId, i);
      if (c.group === "skill") return { type: "skill", skill: c.skill, level: c.level, text };
      if (c.group === "initial") return { type: "info", text: t("初始拥有配方") };
      if (c.group === "purchase") return { type: "unknown", text: EN ? text || t("购买配方") : t("购买配方：{source}", { source: c.text }), hint: t("尚未确认已购买并学会") };
      if (c.group === "friendship") return { type: "unknown", text: text || t("好感度条件"), hint: t("好感度、来信或事件尚未确认") };
      if (c.group === "tv") return { type: "unknown", text: text || t("烹饪频道"), hint: t("尚未确认看过该期电视并学会") };
      if (c.group === "mastery") return { type: "unknown", text, hint: t("精通暂未记录") };
      return { type: "unknown", text: text || t("配方解锁方式尚未完整核验"), hint: t("任务或世界进度未完整记录") };
    });
  }

  // 同名归档导言中的常见来源独立列出，避免购买路径遮住普通采集方式。
  const COMMON_SOURCES = {
    木材: { label: t("砍树和树枝"), note: t("用斧头砍伐普通树木和树枝；掉落量会受运气、技能等影响。"), tool: "斧头" },
    石头: { label: t("开采岩石"), note: t("用十字镐开采岩石；不同岩石的掉落数量不同。"), tool: "十字镐" },
    煤炭: { label: t("开采岩石的可能产物"), note: t("岩石可能掉落煤炭，并非每块都会掉落。"), tool: "十字镐", random: true },
    紫水晶: { label: t("开采紫水晶矿或宝石矿"), note: t("在矿井开采对应矿点；是否遇到该矿点仍有随机性。"), area: "mines", random: true },
  };
  // 商品备注：中文用归档原文；英文取英文 Wiki 同一商店里同一物品的备注。
  function stockNotes(shop, entry) {
    const notes = (entry.n || []);
    if (!EN) return notes.filter(n => !/^周/.test(n));
    const english = (EN.shops?.[shop] || []).find(x => x.id && x.id === entry.id);
    // 英文商店表的“描述”列就是物品说明，详情顶部已经显示，不再重复成购买备注。
    const description = entry.id && EN.items?.[entry.id];
    return (english?.n || []).filter(n => n.length <= 80 && n !== description && !/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(n) && !/^\d+$/.test(n));
  }
  function purchaseChecks(shop, entry = {}) {
    const checks = [], notes = entry.n || [], location = SHOP_LOCATION[shop] || shop;
    if (SHOP_AREA[shop]) checks.push(evalReq({ type: "area", area: SHOP_AREA[shop], text: t("可进入{place}", { place: areaTitle(SHOP_AREA[shop]) }) }));
    // 归档《科罗布斯》“商店”节明确说明全天营业，节日也不例外。
    const loc = locationByName.get(location), hours = shop === "科罗布斯" ? { ok: true, text: t("全天营业（节日也开放）") } : loc && shopCheck(loc);
    checks.push(hours ? R(hours.ok, conditionsActive() || shop === "科罗布斯" ? t("店铺营业：{hours}", { hours: hours.text }) : hours.text) : R(null, t("店铺营业条件尚未完整核验")));
    const season = Object.entries(SEASON_SOURCE).find(([, zh]) => (entry.sec || "").includes(zh))?.[0];
    if (season) checks.push(R(conditionsActive() && state.cond.season === season ? true : null, t("{season}常规库存", { season: SEASON_ZH[season] }), !conditionsActive() || state.cond.season === season ? null : t("非本季可能受特殊解锁影响，尚未核验")));
    const days = notes.map(n => n.match(/^周([一二三四五六日天])$/)).filter(Boolean).map(m => "日一二三四五六".indexOf(m[1] === "天" ? "日" : m[1]));
    if (days.length) checks.push(R(conditionsActive() ? days.includes(weekday(state.cond.day)) : null, t("{day}出售", { day: L10N.list(days.map(d => WEEKDAY_ZH[d])) })));
    if (/随机|不固定/.test(entry.sec || "") || (/(滚动|轮换)/.test(entry.sec || "") && !days.length) || notes.some(n => /随机|概率|偶尔/.test(n))) checks.push(R(null, t("轮换或随机库存需当日核对")));
    const limits = notes.filter(n => /仅|只可|任务|解锁|事件|收到|升级|修复/.test(n));
    if (limits.length) checks.push(R(null, t("商品还有购买限制"), EN ? L10N.clauses(stockNotes(shop, entry)) || t("限制条件见原 Wiki") : L10N.clauses(limits)));
    if (shop === "鱼店") {
      const skill = notes.find(n => /^\d+$/.test(n));
      if (skill) checks.push(evalReq({ type: "skill", skill: "fishing", level: +skill, text: t("钓鱼 {n} 级商店解锁", { n: skill }) }));
    }
    if (notes.some(n => /蓝图|配方/.test(n))) checks.push(R(null, t("此商品可能是配方，不能直接视为取得成品"), t("请核对原文商品说明")));
    return checks;
  }

  const seedsByCrop = new Map();
  for (const s of D.seeds) if (s.crop?.id) (seedsByCrop.get(s.crop.id) || seedsByCrop.set(s.crop.id, []).get(s.crop.id)).push(s);
  // 种子页的价格表：商店长表里没收录的商店（如绿洲的大黄种子）以它为准。旅行货车价格浮动，不在此列。
  const SEED_SHOPS = ["皮埃尔的杂货店", "Joja超市", "绿洲", "姜岛商人"];

  function acquisitions(id, zh) {
    const key = id || "zh:" + zh;
    const paths = [];
    const item = id && D.items[id];
    const basic = COMMON_SOURCES[zh];
    if (basic) {
      const reqs = basic.area ? [{ type: "area", area: basic.area, text: t("可进入{place}", { place: areaTitle(basic.area) }) }] : [];
      paths.push({ kind: "gather", label: basic.label, note: basic.note, random: !!basic.random, source: zh,
        reqs, checks: [...reqs.map(evalReq), ...(basic.tool ? [R(undefined, t("使用{tool}", { tool: nameOf(basic.tool) }))] : [])] });
    }
    const recipes = recipesByOut.get(key) || [];
    for (const r of recipes.filter(r => r.k !== "tailoring")) {
      const reqs = conditionReqs(r.uc, r.id);
      const explicitLearned = state.progress.recipes?.[r.id];
      // 已确认学会时，无需再猜当初是通过哪封信/哪一期电视获得。
      if (explicitLearned === true) reqs.splice(0, reqs.length, { type: "recipe", id: r.id });
      else if (LEARNED_KINDS.has(r.k) && !(r.uc || []).some(c => c.group === "initial")) reqs.push({ type: "recipe", id: r.id });
      if (r.st?.length) reqs.push({ type: "equipment", ids: r.st.map(s => s.id).filter(Boolean), text: t("可用设备：{list}", { list: L10N.list(r.st.map(s => nameOf(s.id || s.z)), t("或")) }) });
      if (r.k === "cooking") reqs.push({ type: "cooking_access" });
      paths.push({
        kind: r.k, label: KIND_LABEL[r.k] || t("制作"), recipe: r, inputs: r.in, stations: r.st, time: r.t,
        reqs, checks: reqs.map(evalReq),
      });
    }
    // 裁缝不用学配方：在缝纫机上用 1 块布料加任一可用物品。同一件服装的多种做法合成一条途径。
    const tailoring = recipes.filter(r => r.k === "tailoring");
    if (tailoring.length) {
      const sewing = itemByZh.get("缝纫机");
      const reqs = [{ type: "info", text: t("在缝纫机上用 1 块布料加下列任一物品") }];
      paths.push({ kind: "tailoring", label: KIND_LABEL.tailoring, recipe: tailoring[0], options: [...new Set(tailoring.flatMap(r => r.in.map(x => x.id || x.z)))],
        stations: sewing ? [{ id: sewing, z: "缝纫机" }] : [], reqs, checks: reqs.map(evalReq) });
    }
    // 作物：种下对应的种子（种子详情有购买途径与生长规则）。
    for (const seed of id ? seedsByCrop.get(id) || [] : []) {
      paths.push({ kind: "grow", label: t("种植"), inputs: [{ id: seed.id, z: seed.p, q: 1 }], reqs: [],
        checks: [R(undefined, t("适生季节：{value}", { value: L10N.list(seed.S.map(x => SEASON_ZH[x])) || t("见原文") })),
          seed.g ? R(undefined, t("基础生长时间：{n} 天", { n: seed.g })) : null].filter(Boolean) });
    }
    // 蜂蜜随附近的花而不同，鱼籽随鱼塘里的鱼而不同：原料不会被消耗，单独说明产出方式。
    if (item?.mb === "(O)340" && item.fo) {
      const beeHouse = itemByZh.get("蜂房");
      paths.push({ kind: "produce", label: t("蜂房产出"), refs: [item.fo], stations: beeHouse ? [{ id: beeHouse, z: "蜂房" }] : [], reqs: [],
        checks: [R(undefined, t("蜂房周围 5 格内有成熟的{flower}时产出这种蜂蜜；花不会被消耗", { flower: nameOf(item.fo) }))] });
    }
    if (item?.mb === "(O)812" && item.fo) {
      paths.push({ kind: "produce", label: t("鱼塘产出"), refs: [item.fo], reqs: [],
        checks: [R(undefined, t("饲养{fish}的鱼塘会产出这种鱼籽", { fish: nameOf(item.fo) }))] });
    }
    const ct = id && chainByItem.get(id);
    // 斧头、十字镐、锄头、喷壶的基础款是开局自带的工具。
    if (ct && ct.tier === 0 && ct.chain.kind === "blacksmith_upgrade") {
      paths.push({ kind: "initial", label: t("初始拥有"), reqs: [], checks: [R(undefined, t("开始游戏时就有，之后可在铁匠铺升级"))] });
    }
    if (ct && ct.tier > 0) {
      const tier = ct.chain.tiers[ct.tier];
      if (ct.chain.kind === "blacksmith_upgrade") {
        const prev = ct.chain.tiers[ct.tier - 1];
        const reqs = [{ type: "tool", family: ct.chain.family, tier: ct.tier - 1, text: t("先拥有{tool}", { tool: nameOf(prev.id || prev.zh) }) }];
        paths.push({ kind: "upgrade", label: t("铁匠铺升级"), where: "铁匠铺", cost: tier.cost, inputs: tier.materials.map((m) => ({ id: m.id, z: m.zh, q: m.qty })),
          note: t("交给克林特后等待 2 天"), reqs, checks: [...reqs.map(evalReq), ...purchaseChecks("铁匠铺")] });
      } else {
        const reqs = conditionReqs(tier.unlock);
        paths.push({ kind: "buy", label: t("{shop}购买", { shop: tier.sold_by ? N(tier.sold_by) : t("商店") }), where: tier.sold_by, cost: tier.cost, currency: tier.currency, reqs, checks: [...reqs.map(evalReq), ...purchaseChecks(tier.sold_by || "商店")],
          note: t("可直接购买，不需要先拥有上一级") });
      }
    }
    const seedBuy = D.seeds.find(s => s.id === id)?.buy || {};
    for (const { shop, e } of shopsByItem.get(key) || []) {
      const reqs = [];
      // 种子页有独立价格表；它比商店长表中误落入价格列的数字更可靠。
      paths.push({ kind: "buy", shop, label: t("{shop}购买", { shop: N(shop) }), where: SHOP_LOCATION[shop] || shop, cost: seedBuy[shop] ?? e.pr, currency: e.cur,
        barter: e.bt, note: L10N.clauses(stockNotes(shop, e)) || null, reqs, checks: purchaseChecks(shop, e) });
    }
    for (const shop of SEED_SHOPS) {
      if (seedBuy[shop] == null || paths.some(p => p.kind === "buy" && p.shop === shop)) continue;
      paths.push({ kind: "buy", shop, label: t("{shop}购买", { shop: N(shop) }), where: SHOP_LOCATION[shop] || shop, cost: seedBuy[shop], reqs: [], checks: purchaseChecks(shop) });
    }
    for (const r of id ? bundleReward.get(id) || [] : []) {
      const reqs = [{ type: "unknown", text: `${N(r.room)} · ${N(r.bundle.name)}`, hint: t("逐个收集包的完成、领奖状态尚未记录") }];
      paths.push({ kind: "reward", label: t("收集包奖励"), note: t("完成{bundle}获得{qty}", { bundle: N(r.bundle.name), qty: qtyText(r.qty) }), reqs, checks: reqs.map(evalReq) });
    }
    for (const p of paths) {
      p.ok = combine(p.checks);
      p.scope = t("已收录的条件");
      p.verifiedOnly = true;
      // 开局自带、种植和自然产出没有库存、营业或材料需要核对。
      p.assumptions = ["initial", "grow", "produce"].includes(p.kind) ? [] : [t("未核对背包材料、金币、剩余库存或实际设备摆放"), t("可达和常规营业不保证已满足全部事件条件")];
    }
    return paths;
  }

  // 展开材料树：每种中间材料取第一个制作途径，到原料为止
  function materialTree(inputs, mult = 1, depth = 0, seen = new Set()) {
    return (inputs || []).map((x) => {
      const info = itemInfo(x.id || x.z) || { z: x.z };
      const qty = (x.q || x.qty || 1) * mult;
      const node = { id: x.id, z: x.z || x.zh || info.z, i: info.i, qty, generic: x.g };
      // 中间材料优先按加工（熔炉等）展开，其次才是打造配方（例如用铜锭嬗变铁锭）
      const list = x.id && !seen.has(x.id) && depth < 3 ? recipesByOut.get(x.id) || [] : [];
      const rec = list.find((r) => r.k === "processing") || list.find((r) => r.k === "crafting") || null;
      if (rec) {
        const next = new Set(seen).add(x.id);
        node.via = rec.st.length ? L10N.list(rec.st.map((s) => nameOf(s.id || s.z))) : KIND_LABEL[rec.k];
        // 加工耗时是 Wiki 原文；英文版取英文条目的同一字段。
        node.time = EN ? pageInfo(rec.out.pg)?.f?.crafttime || null : rec.t;
        node.children = materialTree(rec.in, Math.ceil(qty / (rec.out.q || 1)), depth + 1, next);
      } else {
        const hint = oreHint.get(node.z);
        const shops = (shopsByItem.get(x.id || "zh:" + node.z) || []).slice(0, 2).map(({ shop, e }) => `${N(shop)} ${money(e.pr, e.cur)}`);
        const src = pageInfo(info.pg || node.z)?.f?.source;
        node.source = L10N.clauses([COMMON_SOURCES[node.z]?.note, hint && hint.text, shops.length && t("可购买：{list}", { list: L10N.list(shops) }), !hint && src]) || null;
      }
      return node;
    });
  }
  function rawTotals(tree, out = new Map()) {
    for (const n of tree) {
      if (n.children) rawTotals(n.children, out);
      else out.set(n.z, { ...n, qty: (out.get(n.z)?.qty || 0) + n.qty });
    }
    return out;
  }

  Object.assign(App, {
    SEASONS, SEASON_ZH, SEASON_SHORT, SEASON_ICON, WEATHER, SEASON_WEATHER, WEEKDAY_ZH, SKILLS, ROOMS,
    TOOL_FAMILIES, ROD_CHAIN, BUILDING_CHAINS, AREAS, LOCATION_AREA, BUSINESSES, PRESETS,
    el, img, iconSrc, money, fmtTime, minutesToTime, timeToMinutes, weekday, qtyText, matsText,
    N, itemName, nameOf, weekdayNote, pageInfo, fishText, locText, itemDesc, areaTitle, skillName, timeSpans, conditionReqs,
    state, setCond, conditionsActive, setConditionsEnabled, setProgress, applyPreset, on: (fn) => listeners.add(fn), emit,
    evalReq, combine, areaState, fishCheck, fishRequirements, fishHabitats, fishLocations, fishMethod, shopCheck, seedCheck, latestPlanting, birthdayToday, ccComplete,
    isSubmarineFish, habitatName, submarineFacts, fishRules, fishTimeText, fishWeatherText, crabFacts, LEARNED_KINDS,
    acquisitions, materialTree, rawTotals, itemInfo, canonicalItemId, usedIn, bundleUse, giftsByItem, villagerByName,
    locationByName, fishByName, recipesByOut, shopsByItem, chainByItem, cache: {},
  });
})();
