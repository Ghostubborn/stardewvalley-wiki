/* 我的速查：把常查的资料摊在一页上。玩家钉选的条目显示成卡片，另有三张可开关的速查表（居民生日日历、商店营业时间、钓鱼速查）。
   只显示资料，不记录完成情况；季节筛选只是挑出相关内容，不假定游戏里的日期。
   钉选沿用原来的收藏（state.plan），速查表存在 state.sheets；分享链接把两者编进地址，不经过服务器。 */
(function () {
  "use strict";
  const A = window.App, D = A.D, { el, img, t, N, state } = A;
  const S = A.spoilers;
  const LIMIT = 30;
  const SHEETS = ["birthdays", "shops", "fish"];
  const SHEET_TITLE = { birthdays: t("居民生日日历"), shops: t("商店营业时间"), fish: t("钓鱼速查") };
  const SHEET_NOTE = { birthdays: t("按游戏日历排，生日那天显示头像"), shops: t("开放时间和休息日"), fish: t("用钓竿钓的鱼：季节、时段、天气、水域") };
  // 分享链接里的类型代号。
  const CODES = { villager: "v", fish: "f", item: "i", location: "l", node: "n", page: "p", bundle: "b", area: "a" };
  const TYPES = Object.fromEntries(Object.entries(CODES).map(([type, code]) => [code, type]));
  const allowed = text => !text || S.textAllowed(text);
  const safe = (text, fallback = t("详细条件按需查看")) => allowed(text) ? text : fallback;
  const same = (a, b) => a.type === b.type && a.id === b.id;
  let shared = null; // 打开别人分享的链接时：{ pins, sheets }，只看不存
  function fishOf(ref) {
    return ref.type === "fish" ? A.fishByName.get(ref.id) : ref.type === "item" ? A.fishByName.get(A.itemInfo(ref.id)?.pg || A.itemInfo(ref.id)?.z) : null;
  }
  function buildingOf(ref) {
    if (ref.type === "node") {
      const match = /^bld:(.+):(\d+)$/.exec(ref.id);
      return match ? A.BUILDING_CHAINS.find(c => c.chain === match[1])?.tiers[+match[2]] : null;
    }
    return ref.type === "page" ? D.buildings.find(b => (b.page || b.name) === ref.id && !b.upgrade_from) : null;
  }

  // ———————————————————— 资料（不碰页面，可在 node 里测试） ————————————————————
  function exists(ref) {
    if (!ref || typeof ref.id !== "string") return false;
    if (A.EN && ref.type === "page" && !A.EN.pages?.[ref.id] && !A.EN.names?.[ref.id]) return false;
    return ref.type === "item" ? !!D.items[ref.id] : ref.type === "fish" ? A.fishByName.has(ref.id)
      : ref.type === "villager" ? A.villagerByName.has(ref.id) : ref.type === "location" ? A.locationByName.has(ref.id)
      : ref.type === "node" ? A.progression.nodes.has(ref.id) : ref.type === "area" ? !!A.AREAS[ref.id]
      : ref.type === "bundle" ? !!A.browse?.bundle(ref.id) : ref.type === "page" && !!D.pages[ref.id];
  }
  function encode(pins, sheets, selectedSeason = "all") {
    const out = {};
    const codes = pins.filter(r => CODES[r.type]).map(r => CODES[r.type] + "." + encodeURIComponent(r.id));
    if (codes.length) out.pins = codes.join(",");
    const list = sheets.filter(s => SHEETS.includes(s));
    if (list.length) out.sheets = list.join(".");
    if (A.SEASONS.includes(selectedSeason)) out.qs = selectedSeason;
    return out;
  }
  function decode(pinsText, sheetsText, selectedSeason) {
    const pins = [];
    for (const part of (pinsText || "").split(",")) {
      const dot = part.indexOf(".");
      if (dot < 1) continue;
      let id;
      try { id = decodeURIComponent(part.slice(dot + 1)); } catch (e) { continue; }
      const ref = { type: TYPES[part.slice(0, dot)], id };
      if (ref.type === "item") ref.id = A.canonicalItemId(ref.id);
      if (ref.type && exists(ref) && !pins.some(p => same(p, ref))) pins.push(ref);
    }
    const sheets = [...new Set((sheetsText || "").split("."))].filter(s => SHEETS.includes(s));
    const out = { pins: pins.slice(0, LIMIT), sheets };
    if (A.SEASONS.includes(selectedSeason)) out.season = selectedSeason;
    return out;
  }
  function seedOf(ref) {
    if (ref.type !== "item") return null;
    return D.seeds.find(s => s.id === ref.id) || D.seeds.find(s => s.crop?.id === ref.id) || null;
  }
  // 防剧透收起的水域（如秘密森林）不算：鲶鱼不能因为那里全年可钓，就在速查里显示成四季都有。
  const waterVisible = h => (!h.area || S.area(h.area)) && (!A.LOCATION_AREA[h.location] || S.area(A.LOCATION_AREA[h.location]))
    && allowed(h.location) && allowed(N(h.location));
  const waters = f => A.fishHabitats(f).filter(waterVisible);
  // 归档同时写了“鹈鹕镇”和“鹈鹕镇河流”时只留更具体的那个。
  const waterNames = list => {
    const names = [...new Set(list.map(h => h.location))];
    return names.filter(x => !names.some(y => y !== x && y.startsWith(x))).map(A.habitatName);
  };
  function fishSeasons(f) {
    const list = waters(f).length ? waters(f) : A.fishHabitats(f);
    const found = list.flatMap(h => h.seasons || f.S || []);
    return found.includes("all") || !found.length && f.S?.includes("all") ? ["all"] : A.SEASONS.filter(x => found.includes(x) || !found.length && f.S?.includes(x));
  }
  const seasonOk = (list, season) => !season || season === "all" || !list?.length || list.includes(season) || list.includes("all");
  // 季节相关的条目：居民按生日，鱼按出现季节，作物按适种季节；其他条目没有季节，筛选时一直显示。
  function seasonsOf(ref) {
    if (ref.type === "villager") { const v = A.villagerByName.get(ref.id); return v?.bd ? [v.bd.season] : null; }
    const f = fishOf(ref);
    if (f) return fishSeasons(f);
    const seed = seedOf(ref);
    return seed?.S?.length ? seed.S : null;
  }
  function inSeason(ref, season) {
    if (!season || season === "all") return true;
    const list = seasonsOf(ref);
    return !list || list.includes("all") || list.includes(season);
  }
  function kindOf(ref) {
    if (ref.type === "villager") return "villager";
    if (fishOf(ref)) return "fish";
    if (buildingOf(ref)) return "upgrade";
    if (seedOf(ref)) return "crop";
    if (ref.type === "location") return "place";
    if (ref.type === "item") return "item";
    if (ref.type === "node") return "upgrade";
    if (ref.type === "bundle") return "bundle";
    return "other";
  }
  const KINDS = ["villager", "fish", "crop", "place", "item", "upgrade", "bundle", "other"];
  const KIND_TITLE = { villager: t("居民"), fish: t("鱼"), crop: t("作物"), place: t("商店与地点"), item: t("物品与材料"), upgrade: t("工具、装备与建筑"), bundle: t("收集包"), other: t("其他条目") };
  function nameOf(ref) {
    if (ref.type === "item") return A.itemName(A.itemInfo(ref.id));
    if (ref.type === "node") { const n = A.progression.nodes.get(ref.id); return n?.name || n?.title || ref.id; }
    if (ref.type === "bundle") return N(ref.id.split(":").slice(1).join(":"));
    if (ref.type === "area") return A.areaTitle(ref.id);
    return N(ref.id);
  }
  function iconOf(ref) {
    if (ref.type === "villager") return A.villagerByName.get(ref.id)?.i;
    if (ref.type === "fish") return A.fishByName.get(ref.id)?.i;
    if (ref.type === "item") return A.itemInfo(ref.id)?.i;
    if (ref.type === "location") return A.locationByName.get(ref.id)?.i || D.pages[ref.id]?.i;
    if (ref.type === "node") { const n = A.progression.nodes.get(ref.id); return n?.icon || A.itemInfo(n?.itemId)?.i; }
    if (ref.type === "bundle") return "Bundle_Green.png";
    return D.pages[ref.id]?.i || A.monsterByName.get(ref.id)?.i || A.animalByName.get(ref.id)?.i;
  }
  const visibleItem = id => S.canView({ type: "item", id });
  const visibleText = list => list.filter(x => x && allowed(x));
  // 营业时段：Wiki 每行一个时段（“商店：09:00到17:00”“建筑：09:00到21:00”），和 R 里的时段一一对应时逐行配对；
  // 对不上时只画时段，不配标签。涉及后续内容的那一行不画。
  function hourRows(l) {
    const lines = String(A.locText(l).hours || "").split(/\n+|;\s*/).map(x => x.trim()).filter(Boolean);
    const ranges = l.R || [];
    if (lines.length !== ranges.length) return ranges.map(range => ({ range }));
    return lines.map((line, i) => {
      if (!allowed(line)) return { hidden: true };
      const m = line.match(/^([^:：\d]{1,12})[:：]\s*(.+)$/);
      return { label: m ? m[1] : null, text: m ? m[2] : line, range: ranges[i] };
    });
  }
  function shopText(l) {
    const text = A.locText(l);
    // 与普通详情的参考模式一致：中文信息框只写了“星期三”，仍需保留修复社区中心前这一限定。
    if (l.p !== "皮埃尔的杂货店") return text;
    const rule = A.EN ? text.closed : t("周三休息（社区中心修复前）");
    const closed = allowed(rule) ? rule : t("周三休息；推进游戏后可能调整，详见条目");
    return { ...text, closed };
  }
  // 有前提的休息日（修复社区中心前、重建后、看天气）在一周七格里画虚线框。
  const conditionalClosure = l => l.p === "皮埃尔的杂货店" || !!l.cdc || /不下雨|晴天/.test(l.closed || "") || /only if|unless|after|before|when|non-rainy/i.test(A.locText(l).closed || "");
  function fishNotes(f) {
    const notes = A.fishRequirements(f).map(r => allowed(r.text) ? r.text : r.text.replace(/\s*[（(].*[）)]/g, "")).filter(text => text && allowed(text));
    if (waters(f).some(h => h.winterTotem)) {
      const rain = t("冬季需雨水图腾改变天气");
      notes.push(allowed(rain) ? rain : t("冬季需特殊方式制造降雨，详见条目"));
    }
    for (const h of waters(f)) if (h.unknown && allowed(h.unknown)) notes.push(h.unknown);
    return [...new Set(notes)];
  }
  // 卡片上的几项关键信息：{ label, text }，可附带画图用的数据（seasons、ranges、weather、birthday、growth、hours、week）；
  // text 始终保留，给读屏和测试用。items 是要显示成格子的物品。
  function card(ref) {
    if (!S.canView(ref)) return { ref, locked: true, kind: kindOf(ref) };
    const kind = kindOf(ref), facts = [];
    const add = (label, text, extra) => { if (text) facts.push({ label, text: safe(text), ...(allowed(text) ? extra : null) }); };
    let items = null;
    if (kind === "villager") {
      const v = A.villagerByName.get(ref.id);
      add(t("生日"), v.bd ? t("{season} {day} 日", { season: A.SEASON_ZH[v.bd.season], day: v.bd.day }) : t("生日未记录"), v.bd ? { birthday: v.bd } : null);
      add(t("住处"), A.EN ? A.EN.villagers?.[v.p]?.addr : v.addr);
      // 先放明确列出的最爱，再按“爱它的人少”排：这个人特有的最爱在前，人人都爱的通用礼物在后；后期物品不显示。
      const fans = id => A.giftsByItem.get(id)?.love.length || 0;
      const loves = [...new Set([...(v.fav || []), ...[...v.love].sort((a, b) => fans(a) - fans(b))])].filter(visibleItem);
      items = { label: loves.length > 6 ? t("最爱（共 {n} 件，这里列 6 件）", { n: loves.length }) : t("最爱"), list: loves.slice(0, 6).map(id => ({ id })) };
    } else if (kind === "fish") {
      const f = fishOf(ref);
      facts.push({ label: t("季节"), seasons: fishSeasons(f) });
      if (A.fishMethod(f) === "crab") add(t("方式"), t("蟹笼"));
      else if (A.fishMethod(f) === "forage") add(t("方式"), t("海滩采集，不用钓竿"));
      else { add(t("时间"), A.fishTimeText(f), { ranges: f.T }); add(t("天气"), A.fishWeatherText(f), { weather: f.W }); }
      add(t("水域"), A.isSubmarineFish(f) ? t("夜市钓鱼潜艇 · 冬季 15–17 日")
        : A.list(waterNames(waters(f))) || t("水域见详情"));
      add(t("特殊条件"), fishNotes(f).join("\n"));
    } else if (kind === "crop") {
      const s = seedOf(ref);
      facts.push({ label: t("季节"), seasons: s.S });
      const crop = s.crop?.id && visibleItem(s.crop.id) ? A.itemInfo(s.crop.id) : null;
      add(t("生长"), s.g ? (s.rg ? t("{n} 天成熟，之后每 {m} 天再收获", { n: s.g, m: s.rg }) : t("{n} 天成熟，单次收获", { n: s.g })) : t("特殊种植规则，见条目"),
        s.g ? { growth: { seed: s.i, crop: crop?.i, days: s.g, regrow: s.rg } } : null);
      add(t("最晚播种"), A.list(A.latestPlanting(s)));
      const other = ref.id === s.id ? s.crop && { id: s.crop.id, z: s.crop.z } : { id: s.id };
      if (other?.id && visibleItem(other.id)) add(ref.id === s.id ? t("收获") : t("种子"), A.itemName(A.itemInfo(other.id)));
      if (s.sell != null) add(t("作物售价"), A.money(s.sell));
      add(t("计算条件"), t("每天浇水；未计肥料、职业与其他加速"));
    } else if (kind === "place") {
      const l = A.locationByName.get(ref.id), text = shopText(l);
      add(t("开放时间"), text.hours, l.R?.length ? { hours: hourRows(l) } : null);
      add(t("休息"), text.closed || (l.R?.length ? t("无固定休息日") : null), l.R?.length ? { week: l.cd || [], conditional: conditionalClosure(l) } : null);
      add(t("地址"), text.addr);
      if (!facts.length) add(t("说明"), A.pageInfo(ref.id)?.s?.slice(0, 80));
    } else if (kind === "item") {
      const it = A.itemInfo(ref.id);
      add(t("来源"), A.list([...new Set(A.acquisitions(ref.id, it.z).map(p => p.label))].filter(allowed).slice(0, 3)));
      // 同一个包里出现几格（建筑收集包要两格 99 个木材）合计数量。
      const need = new Map();
      for (const u of A.bundleUse.get(ref.id) || []) {
        if (!S.canView({ type: "bundle", id: `${u.room}:${u.bundle.name}` }) || need.has(u.bundle)) continue;
        need.set(u.bundle, u.bundle.items.filter(x => x.id === ref.id).reduce((sum, x) => sum + (x.qty || 1), 0));
      }
      add(t("收集包"), A.list(visibleText([...need].map(([b, qty]) => N(b.name) + A.qtyText(qty)))));
      const fans = (A.giftsByItem.get(ref.id)?.love || []).filter(name => S.canView({ type: "villager", id: name }));
      if (fans.length) add(t("最爱它的人"), fans.length > 4 ? t("{list} 等 {n} 人", { list: A.list(fans.slice(0, 4).map(N)), n: fans.length }) : A.list(fans.map(N)));
      const recipes = (A.usedIn.get(ref.id) || []).filter(r => visibleItem(r.out?.id));
      if (recipes.length) add(t("用途"), t("可用于 {n} 个配方", { n: recipes.length }));
      if (it.p != null) add(t("售价"), A.money(it.p));
    } else if (kind === "upgrade") {
      const building = buildingOf(ref);
      if (building) {
        const mats = building.materials.filter(m => !m.id || visibleItem(m.id));
        if (mats.length) items = { label: t("建造材料"), list: mats };
        if (building.cost) add(t("花费"), A.money(building.cost, building.currency));
        if (building.build_days != null) add(t("工期"), building.build_days === 0 ? t("立即建成") : t("建造 {n} 天", { n: building.build_days }));
        if (building.sold_by && allowed(building.sold_by)) add(t("建造地点"), N(building.sold_by));
        if (building.upgrade_from && S.canView(A.buildingRef(building.upgrade_from))) add(t("升级前"), A.buildingName(building.upgrade_from));
        const costText = A.EN ? A.EN.buildings?.[building.name]?.cost_text : building.cost_text;
        if (!building.cost && costText) add(t("获取方式"), costText);
      } else {
        const n = A.progression.nodes.get(ref.id);
        const mats = (n.materials || []).filter(m => !m.id || visibleItem(m.id));
        if (mats.length) add(t("材料"), A.matsText(mats));
        if (n.cost) add(t("花费"), A.money(n.cost));
        if (n.place && S.canView({ type: "location", id: n.place })) add(t("地点"), N(n.place));
        if (!facts.length) add(t("说明"), n.sub);
      }
    } else if (kind === "bundle") {
      const { room, bundle: b } = A.browse.bundle(ref.id);
      add(t("房间"), N(room.room));
      if (b.cost) add(t("金币"), A.money(b.cost));
      else {
        if (b.choose || (b.slots && b.slots < b.items.length)) add(t("要求"), t("从 {total} 项中选 {n} 项", { total: b.items.length, n: b.slots }));
        items = { label: t("材料"), list: b.items };
      }
    } else {
      const info = A.pageInfo(ref.id);
      const text = info?.s ? info.s.replace(/\s+/g, " ") : null;
      add(t("说明"), text && text.length > 90 ? text.slice(0, 88) + "…" : text);
    }
    return { ref, kind, name: nameOf(ref), icon: iconOf(ref), facts, items };
  }
  // 速查表数据。只列防剧透允许显示的条目，另返回被收起的数量。
  function birthdays(season) {
    const seasons = season && season !== "all" ? [season] : A.SEASONS;
    let hidden = 0;
    const out = seasons.map(s => ({ season: s, days: new Map() }));
    for (const v of D.villagers) {
      if (!v.bd || !seasons.includes(v.bd.season)) continue;
      if (!S.canView({ type: "villager", id: v.p })) { hidden++; continue; }
      const days = out.find(x => x.season === v.bd.season).days;
      if (!days.has(v.bd.day)) days.set(v.bd.day, []);
      days.get(v.bd.day).push(v);
    }
    return { calendars: out, hidden };
  }
  function shops() {
    const rows = D.locations.filter(l => (A.BUSINESSES.has(l.p) || D.shops.some(s => s.p === l.p)) && A.locText(l).hours);
    const shown = rows.filter(l => S.canView({ type: "location", id: l.p }));
    return { rows: shown.map(l => ({ ref: { type: "location", id: l.p }, l, ...shopText(l), lines: hourRows(l), week: l.cd || [], conditional: conditionalClosure(l) })), hidden: rows.length - shown.length };
  }
  function fish(season) {
    const rows = D.fish.filter(f => A.fishMethod(f) === "rod");
    const shown = rows.filter(f => S.canView({ type: "fish", id: f.p }));
    // 只列看得到钓点的鱼：只在收起的地区出现的鱼（如矿井里的鱼）算在收起的数量里。
    const reachable = shown.filter(f => A.isSubmarineFish(f) || waters(f).length);
    const list = reachable.filter(f => inSeason({ type: "fish", id: f.p }, season)).map(f => {
      const here = waters(f).filter(h => seasonOk(h.seasons || f.S, season));
      return { ref: { type: "fish", id: f.p }, f, seasons: fishSeasons(f), time: safe(A.fishTimeText(f) || ""), weather: safe(A.fishWeatherText(f) || ""),
        waters: A.isSubmarineFish(f) ? t("夜市钓鱼潜艇 · 冬季 15–17 日") : A.list(waterNames(here)) || t("水域见详情"), notes: fishNotes(f) };
    });
    return { rows: list, hidden: rows.length - reachable.length };
  }

  // ———————————————————— 钉选与速查表 ————————————————————
  const pinned = ref => state.plan.some(p => same(p, ref));
  // 钉选时如果条目只是临时查看的后续内容，记住它：玩家明确要把它放进速查。
  function toggle(ref) {
    const i = state.plan.findIndex(p => same(p, ref));
    if (i >= 0) { state.plan.splice(i, 1); A.toast(t("已从速查移除：{name}", { name: S.canView(ref) ? nameOf(ref) : t("受保护的条目") })); A.emit("plan"); return false; }
    if (state.plan.length >= LIMIT) { A.toast(t("速查最多钉 {n} 个条目，先移除一个", { n: LIMIT })); return false; }
    if (S.temporary?.(ref)) S.reveal(ref, true);
    state.plan.push({ type: ref.type, id: ref.id });
    A.toast(t("已钉到速查（{n}/{max}）：{name}", { n: state.plan.length, max: LIMIT, name: S.canView(ref) ? nameOf(ref) : t("受保护的条目") }));
    A.emit("plan");
    return true;
  }
  const sheets = () => (Array.isArray(state.sheets) ? state.sheets : []).filter(s => SHEETS.includes(s));
  function toggleSheet(id) {
    const list = sheets();
    state.sheets = list.includes(id) ? list.filter(s => s !== id) : SHEETS.filter(s => s === id || list.includes(s));
    A.emit("plan");
  }
  const season = () => shared ? shared.season || "all" : (A.SEASONS.includes(state.quickSeason) ? state.quickSeason : "all");
  function setSeason(value) { if (shared) shared.season = value; else state.quickSeason = value; A.emit("plan"); }
  function setShared(value) { shared = value && (value.pins.length || value.sheets.length) ? value : null; }
  // 离开分享页：地址栏去掉分享参数，刷新后看到的是自己的速查。
  function leaveShared() {
    shared = null;
    history.replaceState(null, "", location.pathname + location.search + "#view=quick");
    A.emit("plan");
  }
  function adoptShared() {
    if (!shared) return;
    let added = 0, skipped = 0;
    for (const ref of shared.pins) {
      if (state.plan.some(p => same(p, ref))) continue;
      if (state.plan.length >= LIMIT) { skipped++; continue; }
      state.plan.push(ref); added++;
    }
    state.sheets = SHEETS.filter(s => sheets().includes(s) || shared.sheets.includes(s));
    state.quickSeason = season();
    A.toast(skipped ? t("已加入 {n} 个条目；速查已满，另有 {m} 个没有加入", { n: added, m: skipped }) : t("已加入我的速查：{n} 个条目", { n: added }));
    leaveShared();
  }
  function shareUrl() {
    const params = encode(state.plan, sheets(), season());
    if (!params.pins && !params.sheets) return null;
    const parts = ["view=quick", ...Object.entries(params).map(([k, v]) => `${k}=${v}`)];
    return location.origin + location.pathname + "#" + parts.join("&");
  }

  // ———————————————————— 页面 ————————————————————
  const open = ref => A.select(ref, { from: "browse" });
  const SEASON_ICON = A.SEASON_ICON;
  const EN = A.lang === "en";
  // 游戏日历：每季 28 天，1 日是周一。
  const WEEK = [t("一"), t("二"), t("三"), t("四"), t("五"), t("六"), t("日")];
  const EN_SEASON = { spring: "Spr", summer: "Sum", fall: "Fall", winter: "Win" };
  // 季节固定四格：有的亮、没有的暗，上下几行同一季节对齐；正在筛选的季节加框。
  function seasonStrip(list, current, legend) {
    const all = list?.includes("all"), on = x => all || list?.includes(x), shown = A.SEASONS.filter(on);
    return el("span", { class: "season-strip" + (legend ? " season-legend" : ""), role: legend ? null : "img", "aria-hidden": legend ? "true" : null,
      "aria-label": legend ? null : shown.length ? t("季节：{value}", { value: A.list(shown.map(x => A.SEASON_ZH[x])) }) : t("季节见详情") },
      A.SEASONS.map(x => el("span", { class: "season-slot" + (on(x) ? " on" : "") + (current === x ? " current" : ""), dataset: { season: x } },
        img(SEASON_ICON[x]), EN ? EN_SEASON[x] : A.SEASON_SHORT[x])));
  }
  // 时间条：横轴是游戏里的一天，早上 6:00 到凌晨 2:00；竖线是正午、傍晚 6 点和午夜。
  // 刻度只标到午夜：凌晨 2:00 离午夜太近，两个字会挤在一起；确切时段写在每条下面。
  const pos = t24 => Math.max(0, Math.min(100, A.timeToMinutes(t24) / (20 * 60) * 100));
  function timeBar(ranges, text) {
    return el("span", { class: "time-bar", role: "img", "aria-label": text || "" },
      (ranges || []).map(([a, b]) => el("span", { class: "time-span", style: `left:${pos(a)}%;width:${Math.max(1.5, pos(b) - pos(a))}%` })));
  }
  const AXIS = [[600, EN ? "6am" : "6:00"], [1200, EN ? "noon" : "12:00"], [1800, EN ? "6pm" : "18:00"], [2400, EN ? "12am" : "0:00"]];
  const timeAxis = () => el("span", { class: "time-axis", "aria-hidden": "true" }, AXIS.map(([t24, label]) => el("span", { style: `left:${pos(t24)}%` }, label)));
  function weatherIcons(list, text) {
    const keys = list?.includes("any") ? ["sun", "rain"] : (list || []).filter(k => A.WEATHER[k]);
    return el("span", { class: "weather-icons" }, keys.map(k => img(A.WEATHER[k].icon, "weather-icon")), el("span", null, text));
  }
  // 一周七格（周一在前），休息的那天划掉；有前提的休息（社区中心重建后的周五）用虚线框。
  function weekStrip(days, conditional) {
    return el("span", { class: "week-strip", role: "img", "aria-label": days.length ? t("休息：{days}", { days: A.list(days.map(d => A.WEEKDAY_ZH[d])) }) : t("无固定休息日") },
      [1, 2, 3, 4, 5, 6, 0].map((d, i) => el("span", { class: "week-day" + (days.includes(d) ? " closed" + (conditional ? " maybe" : "") : ""), "aria-hidden": "true" }, WEEK[i])));
  }
  function growthView(g, text) {
    return el("span", { class: "growth", role: "img", "aria-label": text },
      img(g.seed), el("span", { class: "growth-days" }, el("strong", null, t("{n} 天", { n: g.days })), el("span", null, "→")),
      g.crop ? img(g.crop) : null, g.regrow ? el("span", { class: "growth-regrow" }, "↻ " + t("每 {n} 天", { n: g.regrow })) : null);
  }
  // 营业时段：每行“标签 时段文字”，下面一条时间条；涉及后续内容的那一行只写“按需查看”。
  function hoursView(rows) {
    return el("span", { class: "hours" }, rows.map(r => r.hidden ? el("span", { class: "hours-row" }, el("span", { class: "hours-text" }, t("详细条件按需查看")))
      : el("span", { class: "hours-row" }, r.label ? el("span", { class: "hours-label" }, r.label) : null,
        r.text ? el("span", { class: "hours-text" }, r.text) : null, timeBar([r.range], [r.label, r.text].filter(Boolean).join(" ")))));
  }
  function factValue(f) {
    if (f.seasons) return seasonStrip(f.seasons, season());
    if (f.ranges?.length) return el("span", { class: "time-fact" }, el("span", { class: "time-text" }, f.text), timeBar(f.ranges, f.text));
    if (f.weather) return weatherIcons(f.weather, f.text);
    if (f.birthday) return el("span", { class: "birthday-chip" }, img(SEASON_ICON[f.birthday.season]), f.text);
    if (f.growth) return growthView(f.growth, f.text);
    if (f.hours) return hoursView(f.hours);
    if (f.week) return el("span", { class: "week-fact" }, weekStrip(f.week, f.conditional), lines(f.text));
    return lines(f.text);
  }
  function itemSlot(value) {
    const it = A.itemInfo(value.id || value.z || value.zh) || { z: value.z || value.zh };
    const ref = it.id ? { type: "item", id: it.id } : { type: "page", id: it.z };
    const ok = S.canView(ref), qty = value.qty ?? value.q ?? 1;
    const quality = { gold: t("金星品质"), silver: t("银星品质"), iridium: t("铱星品质") }[value.quality];
    const label = ok ? A.itemName(it) : t("后续物品 · 按需查看");
    return el("button", { type: "button", class: "quick-slot", title: label, onclick: () => open(ref),
      "aria-label": label + (qty > 1 ? t("，{n} 个", { n: qty }) : "") + (quality ? t("，{quality}", { quality }) : "") },
      ok ? img(it.i) : el("span", { class: "concealed-slot", "aria-hidden": "true" }, "?"),
      qty > 1 ? el("span", { class: "slot-qty" }, String(qty)) : null,
      quality ? el("span", { class: "slot-quality " + value.quality, "aria-hidden": "true" }, "★") : null);
  }
  function removeButton(ref, name) {
    return el("button", { type: "button", class: "quick-remove", "aria-label": t("从速查移除：{name}", { name }), title: t("从速查移除"),
      onclick: () => toggle(ref) }, "×");
  }
  function cardView(c, readOnly) {
    if (c.locked) {
      const name = t("受保护的条目");
      return el("article", { class: "quick-card locked", dataset: { kind: c.kind } },
        el("button", { type: "button", class: "quick-card-head", onclick: () => open(c.ref) },
          el("span", { class: "quick-card-art concealed-slot", "aria-hidden": "true" }, "?"),
          el("span", null, el("strong", null, name), el("small", null, t("涉及后续内容 · 点开按需查看")))),
        readOnly ? null : removeButton(c.ref, name));
    }
    return el("article", { class: "quick-card", dataset: { kind: c.kind, record: c.ref.type + ":" + c.ref.id } },
      el("button", { type: "button", class: "quick-card-head", onclick: () => open(c.ref) },
        el("span", { class: "quick-card-art" }, img(c.icon)), el("strong", null, c.name)),
      readOnly ? null : removeButton(c.ref, c.name),
      c.facts.length ? el("dl", { class: "quick-facts" }, c.facts.flatMap(f => [el("dt", null, f.label), el("dd", null, factValue(f))])) : null,
      c.items?.list.length ? el("div", { class: "quick-items" }, el("span", { class: "quick-items-label" }, c.items.label),
        el("div", { class: "quick-slots" }, c.items.list.map(itemSlot))) : null);
  }
  function calendarSheet(current) {
    const data = birthdays(current);
    const body = el("div", { class: "quick-calendars", dataset: { count: String(data.calendars.length) } }, data.calendars.map(({ season: s, days }) =>
      el("article", { class: "quick-calendar", dataset: { season: s } },
        el("h4", null, img(SEASON_ICON[s]), A.SEASON_ZH[s]),
        el("div", { class: "calendar-grid", role: "list", "aria-label": t("{season}的生日", { season: A.SEASON_ZH[s] }) },
          WEEK.map(d => el("span", { class: "calendar-weekday", "aria-hidden": "true" }, d)),
          Array.from({ length: 28 }, (_, i) => {
            const day = i + 1, people = days.get(day) || [];
            return el("div", { class: "calendar-day" + (people.length ? " has-birthday" : ""), role: people.length ? "listitem" : null, "aria-hidden": people.length ? null : "true" },
              el("span", { class: "calendar-date" }, String(day)),
              people.map(v => el("button", { type: "button", class: "calendar-person", title: N(v.p),
                "aria-label": t("{date}：{name}的生日", { date: t("{season} {day} 日", { season: A.SEASON_ZH[s], day }), name: N(v.p) }),
                onclick: () => open({ type: "villager", id: v.p }) }, img(v.i), el("span", null, N(v.p)))));
          })))));
    return sheetSection("birthdays", body, data.hidden ? t("防剧透开启：还有 {n} 位后续登场的居民没有列出。", { n: data.hidden }) : null);
  }
  function lines(text) {
    return String(text || "").split(/\n+/).filter(Boolean).map(line => el("span", { class: "quick-line" }, safe(line)));
  }
  // 两张表都排成对齐的格子：竖着看同一列（同一季节、同一时段、同一天）就能比较。
  function shopSheet() {
    const data = shops();
    const body = el("div", { class: "quick-table quick-shops", role: "table", "aria-label": SHEET_TITLE.shops },
      el("div", { class: "quick-tr quick-th", role: "row" }, el("span", { role: "columnheader" }, t("地点")),
        el("span", { role: "columnheader" }, el("span", { class: "sr-only" }, t("开放时间")), timeAxis()),
        el("span", { role: "columnheader" }, el("span", { class: "sr-only" }, t("每周")), el("span", { "aria-hidden": "true" }, weekStrip([], false))),
        el("span", { role: "columnheader" }, t("说明"))),
      data.rows.map(r => el("div", { class: "quick-tr", role: "row" },
        el("span", { role: "rowheader" }, el("button", { type: "button", class: "quick-link", onclick: () => open(r.ref) }, img(r.l.i), N(r.l.p))),
        el("span", { role: "cell", "data-label": t("开放时间"), dataset: { col: "hours" } }, r.lines.length ? hoursView(r.lines) : lines(r.hours)),
        el("span", { role: "cell", "data-label": t("每周"), dataset: { col: "week" } }, weekStrip(r.week, r.conditional)),
        el("span", { role: "cell", "data-label": t("说明"), dataset: { col: "note" }, class: "quick-cell-note" }, r.closed ? lines(r.closed) : t("无固定休息日")))));
    return sheetSection("shops", body, [t("表中是常规营业时间；节日和店主外出等例外见条目。"), data.hidden ? t("防剧透开启：还有 {n} 个后续地点没有列出。", { n: data.hidden }) : null].filter(Boolean).join(" "));
  }
  function fishSheet(current) {
    const data = fish(current);
    const body = data.rows.length ? el("div", { class: "quick-table quick-fish", role: "table", "aria-label": SHEET_TITLE.fish },
      el("div", { class: "quick-tr quick-th", role: "row" }, el("span", { role: "columnheader" }, t("鱼")),
        el("span", { role: "columnheader" }, el("span", { class: "sr-only" }, t("季节")), seasonStrip(["all"], current, true)),
        el("span", { role: "columnheader" }, el("span", { class: "sr-only" }, t("时间")), timeAxis()),
        el("span", { role: "columnheader" }, t("天气")), el("span", { role: "columnheader" }, t("水域"))),
      data.rows.map(r => el("div", { class: "quick-tr", role: "row" },
        el("span", { role: "rowheader" }, el("button", { type: "button", class: "quick-link", onclick: () => open(r.ref) }, img(r.f.i), N(r.f.p))),
        el("span", { role: "cell", "data-label": t("季节"), dataset: { col: "season" } }, seasonStrip(r.seasons, current)),
        el("span", { role: "cell", "data-label": t("时间"), dataset: { col: "time" } }, el("span", { class: "time-fact" }, timeBar(r.f.T, r.time), el("span", { class: "time-text" }, r.time))),
        el("span", { role: "cell", "data-label": t("天气"), dataset: { col: "weather" } }, weatherIcons(r.f.W, r.weather)),
        el("span", { role: "cell", "data-label": t("水域"), dataset: { col: "water" }, class: "quick-cell-note" }, el("span", null, r.waters),
          r.notes.length ? el("span", { class: "quick-fish-rules" }, lines(r.notes.join("\n"))) : null)))) : el("p", { class: "empty-note" }, t("这个季节没有可以列出的鱼。"));
    return sheetSection("fish", body, [current !== "all" ? t("水域只列{season}能钓到的地方。", { season: A.SEASON_ZH[current] }) : null,
      t("蟹笼收获和海滩采集见鱼类图鉴。"), data.hidden ? t("防剧透开启：还有 {n} 种后续的鱼没有列出。", { n: data.hidden }) : null].filter(Boolean).join(" "));
  }
  function sheetSection(id, body, note) {
    return el("section", { class: "quick-sheet", dataset: { sheet: id }, "aria-labelledby": "quick-sheet-" + id },
      el("header", { class: "quick-sheet-head" }, el("h3", { id: "quick-sheet-" + id }, SHEET_TITLE[id]), el("p", null, SHEET_NOTE[id])),
      body, note ? el("p", { class: "quick-note" }, note) : null);
  }
  function seasonFilter(current) {
    return el("div", { class: "seg quick-seasons", role: "radiogroup", "aria-label": t("按季节筛选") },
      [["all", t("全部")], ...A.SEASONS.map(s => [s, A.SEASON_SHORT[s]])].map(([value, label]) =>
        el("button", { type: "button", role: "radio", "aria-checked": String(current === value), dataset: { v: value, quickControl: "season:" + value },
          onclick: () => setSeason(value) }, value === "all" ? null : img(SEASON_ICON[value]), label)));
  }
  async function copyShare() {
    const url = shareUrl();
    if (!url) { A.toast(t("先钉选条目或打开速查表，再分享")); return; }
    try { await navigator.clipboard.writeText(url); A.toast(t("已复制分享链接：对方打开就能看到这页速查")); }
    catch (e) {
      const field = document.getElementById("quick-share-field");
      if (field) { field.value = url; field.hidden = false; field.select(); }
      A.toast(t("无法自动复制，请手动复制下面的链接"));
    }
  }
  function render() {
    const root = document.getElementById("quick");
    if (!root) return;
    const scroll = root.scrollTop;
    const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset.quickControl : null;
    const current = season();
    const viewing = shared || { pins: state.plan, sheets: sheets() };
    const readOnly = !!shared;
    const pins = viewing.pins.filter(ref => exists(ref));
    const shown = pins.filter(ref => inSeason(ref, current));
    const cards = shown.map(card);
    const head = el("header", { class: "quick-head" },
      el("p", { class: "eyebrow" }, t("随手翻的速查本")),
      el("h2", null, readOnly ? t("分享来的速查") : t("我的速查")),
      el("p", null, t("把常查的资料放在一页：钉选的条目直接显示关键信息，不用一个个点开。只显示资料，不记录完成情况。")));
    const banner = readOnly ? el("div", { class: "quick-shared", role: "note" },
      el("p", null, t("这是别人分享给你的速查页，共 {n} 个条目。保存到这台设备后，你可以随时打开、增删。", { n: pins.length })),
      el("div", { class: "d-actions" }, el("button", { type: "button", class: "btn primary", onclick: adoptShared }, t("加入我的速查")),
        el("button", { type: "button", class: "btn", onclick: leaveShared }, t("看我的速查")))) : null;
    const toolbar = el("div", { class: "quick-toolbar" }, seasonFilter(current),
      el("div", { class: "quick-actions" },
        el("button", { type: "button", class: "btn", onclick: () => window.print() }, t("打印")),
        readOnly ? null : el("button", { type: "button", class: "btn", onclick: copyShare }, t("复制分享链接"))),
      el("input", { type: "text", id: "quick-share-field", class: "quick-share-field", readonly: true, hidden: true, "aria-label": t("分享链接") }));
    const picker = readOnly ? null : el("div", { class: "quick-picker" }, el("span", { class: "quick-picker-label" }, t("速查表")),
      SHEETS.map(id => el("button", { type: "button", class: "quick-toggle", dataset: { quickControl: "sheet:" + id }, "aria-pressed": String(viewing.sheets.includes(id)), onclick: () => toggleSheet(id) },
        el("span", { class: "quick-check", "aria-hidden": "true" }, viewing.sheets.includes(id) ? "✓" : "+"), SHEET_TITLE[id])));
    const blocks = [];
    for (const id of viewing.sheets) blocks.push(id === "birthdays" ? calendarSheet(current) : id === "shops" ? shopSheet() : fishSheet(current));
    const pinsBlock = el("section", { class: "quick-pins", "aria-labelledby": "quick-pins-title" },
      el("header", { class: "quick-sheet-head" }, el("h3", { id: "quick-pins-title" }, readOnly ? t("分享的条目") : t("钉选的条目")),
        el("p", null, readOnly ? t("{n} 个条目", { n: pins.length }) : t("{n} / {max} 个 · 在任一条目详情里点「钉到速查」添加", { n: pins.length, max: LIMIT }))),
      // 分栏排：各组依次往下接，不让只有一两张卡的组独占一整行。
      el("div", { class: "quick-groups" }, KINDS.filter(k => cards.some(c => c.kind === k)).map(k => el("div", { class: "quick-group" }, el("h4", null, KIND_TITLE[k]),
        el("div", { class: "quick-cards" }, cards.filter(c => c.kind === k).map(c => cardView(c, readOnly)))))),
      pins.length && !shown.length ? el("p", { class: "empty-note" }, t("钉选的条目都不在{season}。", { season: A.SEASON_ZH[current] })) : null,
      shown.length < pins.length && shown.length ? el("p", { class: "quick-note" }, t("另有 {n} 个钉选条目不在{season}，选「全部」可以看到。", { n: pins.length - shown.length, season: A.SEASON_ZH[current] })) : null);
    const empty = !pins.length && !viewing.sheets.length ? el("section", { class: "quick-empty" },
      el("h3", null, t("从一张速查表开始")),
      el("p", null, t("选一张现成的表，或者在任一条目详情里点「钉到速查」，把常查的居民、鱼、作物、商店放到这里。")),
      el("div", { class: "quick-starters" }, SHEETS.map(id => el("button", { type: "button", class: "quick-starter", dataset: { quickControl: "sheet:" + id }, onclick: () => toggleSheet(id) },
        el("strong", null, SHEET_TITLE[id]), el("small", null, SHEET_NOTE[id]))))) : null;
    const footer = el("footer", { class: "quick-footer" },
      readOnly ? null : el("p", { class: "quick-note" }, t("保存在当前浏览器；换设备前复制分享链接，清理网站数据会移除速查。")),
      el("p", { class: "quick-print-credit" }, t("星露谷交互手册 · 资料来源：星露谷 BWIKI / Stardew Valley Wiki")));
    // 还没有内容时只留开头和三张现成的表，季节、打印、分享这些用不上的先收起。
    // replaceChildren 会把 null 写成文字，先去掉空项。
    // 自己钉的条目在最前面，现成的速查表在后面。
    root.replaceChildren(...[head, banner, empty ? null : toolbar, empty ? null : picker, empty,
      pins.length ? pinsBlock : (!empty && !readOnly ? el("p", { class: "quick-note quick-pin-hint" }, t("在任一条目详情里点「钉到速查」，常查的条目会显示在这里。")) : null), ...blocks, footer].filter(Boolean));
    root.scrollTop = scroll;
    if (focusKey) [...root.querySelectorAll("[data-quick-control]")].find(b => b.dataset.quickControl === focusKey)?.focus({ preventScroll: true });
  }

  A.quick = {
    LIMIT, SHEETS, render, toggle, pinned, toggleSheet, setSeason, setShared, adoptShared, shareUrl,
    get shared() { return shared; },
    model: { encode, decode, exists, card, seasonsOf, inSeason, kindOf, birthdays, shops, fish, sheets, season },
    hashParams: () => (shared ? encode(shared.pins, shared.sheets, season()) : {}),
  };
})();
