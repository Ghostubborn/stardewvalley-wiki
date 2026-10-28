/* 界面：时钟、手账、搜索、详情、计划栏与进度。所有面板共享同一份条件与进度。 */
(function () {
  "use strict";
  const App = window.App;
  const { D, el, img, money, fmtTime, state, t, N, nameOf } = App;
  const EN = App.EN;
  const $ = (id) => document.getElementById(id);
  const P = () => App.progression;
  const S = App.spoilers;
  const visible = (type, id) => S.canView({ type, id });
  const safeText = (text, fallback = t("后续说明已收起")) => S.textAllowed(text) ? text : fallback;
  const nodeName = (n) => n?.name || n?.title || "";
  state.view = "browse";
  let current = null; // 当前选中 { type, id }
  let pointReturn = null;
  const pointStates = new Map();
  let readingHash = false, hashReady = false;
  let conditionsReturnFocus = null;
  let detailMode = "reading", detailReturnFocus = null;

  // ———————————————————— 提示与通知 ————————————————————
  const tip = $("tooltip");
  App.showTip = (info, x, y) => {
    if (!info) return App.hideTip();
    tip.replaceChildren(...[el("b", null, safeText(info.title, t("未探索内容"))), info.why ? el("span", { class: "t-why" }, safeText(info.why)) : null].filter(Boolean));
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 16) + "px";
    tip.style.top = Math.min(window.innerHeight - r.height - 8, y + 16) + "px";
  };
  App.hideTip = () => { tip.hidden = true; };
  let toastTimer = 0;
  App.toast = (text) => {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  };

  // ———————————————————— 时钟 ————————————————————
  function buildClock() {
    $("conditions-enabled").addEventListener("change", e => App.setConditionsEnabled(e.target.checked));
    const seasonSeg = $("season-seg");
    for (const s of App.SEASONS) {
      seasonSeg.append(el("button", { role: "radio", dataset: { v: s }, onclick: () => App.setCond({ season: s }) },
        img(App.SEASON_ICON[s]), App.SEASON_SHORT[s]));
    }
    const wSeg = $("weather-seg");
    for (const [k, w] of Object.entries(App.WEATHER)) {
      wSeg.append(el("button", { role: "radio", dataset: { v: k }, title: w.zh, "aria-label": w.zh, onclick: () => App.setCond({ weather: k }) },
        img(w.icon), EN ? "" : w.short.slice(0, 1)));
    }
    const ySeg = $("year-seg");
    [1, 2, 3].forEach((y) => ySeg.append(el("button", { role: "radio", dataset: { v: y }, onclick: () => App.setCond({ year: y }) }, y === 3 ? "3+" : String(y))));
    const day = $("day-range");
    day.addEventListener("input", () => App.setCond({ day: +day.value }));
    const time = $("time-range");
    time.min = 0; time.max = 1200; time.step = 10;
    time.addEventListener("input", () => App.setCond({ time: App.minutesToTime(+time.value) }));
    $("clock-toggle").addEventListener("click", () => setConditionsOpen($("clock-controls").hidden));
    $("conditions-close").addEventListener("click", () => setConditionsOpen(false));
    const dismissConditions = e => {
      if ($("clock-controls").hidden || $("progress-dialog").open || $("spoiler-dialog").open) return;
      if (!$("clock-controls").contains(e.target) && !document.querySelector(".clock").contains(e.target)) setConditionsOpen(false, false);
    };
    document.addEventListener("pointerdown", dismissConditions);
    document.addEventListener("focusin", dismissConditions);
  }
  function renderClock() {
    const C = state.cond;
    const active = App.conditionsActive();
    document.querySelector(".clock").classList.toggle("conditions-inactive", !active);
    $("conditions-enabled").checked = active;
    $("condition-fields").disabled = !active;
    const wd = App.WEEKDAY_ZH[App.weekday(C.day)];
    $("clock-date").replaceChildren(t("{season} {day} 日", { season: App.SEASON_SHORT[C.season], day: C.day }),
      el("small", { class: "clock-sub" }, t("对照 · {weekday} · 第 {year} 年", { weekday: wd, year: C.year === 3 ? "3+" : C.year })));
    $("clock-time").textContent = fmtTime(C.time);
    const wi = App.WEATHER[C.weather];
    $("clock-weather").src = App.iconSrc(C.weather === "wind" && C.season === "fall" ? "Pollen_fall.png" : wi.icon);
    $("clock-weather").alt = wi.zh;
    if (!active) $("clock-date").replaceChildren(t("条件对照"), el("small", { class: "clock-sub" }, t("可选 · 不影响直接查阅")));
    $("clock-time").hidden = !active;
    $("clock-weather").hidden = !active;
    $("fx").disabled = !active;
    for (const b of $("season-seg").children) b.setAttribute("aria-checked", String(b.dataset.v === C.season));
    const allowed = App.SEASON_WEATHER[C.season];
    for (const b of $("weather-seg").children) {
      b.setAttribute("aria-checked", String(b.dataset.v === C.weather));
      b.disabled = !allowed.includes(b.dataset.v);
    }
    for (const b of $("year-seg").children) b.setAttribute("aria-checked", String(+b.dataset.v === C.year));
    $("day-range").value = C.day;
    $("day-out").textContent = t("{day} 日", { day: C.day });
    $("time-range").value = App.timeToMinutes(C.time);
    $("time-out").textContent = fmtTime(C.time);
  }

  // ———————————————————— 手账（按条件分组） ————————————————————
  function condText() {
    if (!App.conditionsActive()) return t("未启用条件对照");
    const C = state.cond;
    return `${t("{season} {day} 日", { season: App.SEASON_ZH[C.season], day: C.day })} · ${App.WEATHER[C.weather].zh} · ${fmtTime(C.time)}`;
  }
  function positionConditions() {
    // Only the fixed-height trigger reserves space. The panel overlays content.
    const bottom = document.querySelector(".clock").getBoundingClientRect().bottom;
    $("clock-controls").style.setProperty("--conditions-top", `${bottom + 8}px`);
  }
  function setConditionsOpen(open, restoreFocus = true) {
    const panel = $("clock-controls"), wasOpen = !panel.hidden;
    if (open && !wasOpen) conditionsReturnFocus = document.activeElement;
    panel.hidden = !open;
    $("clock-toggle").setAttribute("aria-expanded", String(open));
    document.querySelector(".clock-hint").textContent = open ? t("收起") : t("设置");
    positionConditions();
    if (open) $("conditions-enabled").focus({ preventScroll: true });
    else if (wasOpen && restoreFocus) {
      const target = conditionsReturnFocus?.isConnected && conditionsReturnFocus !== document.body ? conditionsReturnFocus : $("clock-toggle");
      target.focus({ preventScroll: true });
    }
  }
  function openConditions() { setConditionsOpen(true); }
  App.openConditions = openConditions;
  function group(name, count, why, rows, opts = {}) {
    const d = el("details", { class: "group", open: opts.open !== false });
    d.append(el("summary", null, el("span", { class: "group-name" }, name), el("span", { class: "group-count" }, String(count)),
      why ? el("span", { class: "group-why" }, why) : null));
    const ul = el("ul");
    const limit = opts.limit || 6;
    rows.slice(0, limit).forEach((r) => ul.append(el("li", null, r)));
    d.append(ul);
    if (rows.length > limit) {
      const more = el("button", { class: "more", type: "button" }, t("再显示 {n} 项", { n: rows.length - limit }));
      more.addEventListener("click", () => { rows.slice(limit).forEach((r) => ul.append(el("li", null, r))); more.remove(); });
      d.append(more);
    }
    if (!rows.length && opts.empty) d.append(el("p", { class: "empty-note" }, opts.empty));
    return d;
  }
  function row({ icon, name, sub, tail, tailClass, ref, title }) {
    const b = el("button", { class: "row", type: "button", title: title || null },
      img(icon), el("span", { class: "main" }, el("span", { class: "name" }, name), sub ? el("span", { class: "sub" }, sub) : null),
      tail ? el("span", { class: "tail " + (tailClass || "") }, tail) : el("span"));
    if (ref) {
      b.addEventListener("click", () => App.select(ref, { from: "journal" }));
      if (current && current.type === ref.type && current.id === ref.id) b.classList.add("is-selected");
    }
    return b;
  }
  function nodeRow(n) {
    const st = P().status(n.id);
    const miss = st.paths.find((p) => p.ok !== false) || st.paths[0];
    const need = n.materials?.length ? App.matsText(n.materials) + (n.cost ? ` · ${money(n.cost)}` : "") : (n.sub || "");
    return row({ icon: n.icon || App.itemInfo(n.itemId)?.i, name: nodeName(n), sub: safeText(need || (miss && App.list(miss.checks.map((c) => c.text)))),
      tail: n.place && visible("location", n.place) ? (EN ? N(n.place) : "去" + n.place.replace("的商店", "").slice(0, 5)) : "", ref: { type: "node", id: n.id } });
  }

  function renderJournal() {
    const body = $("journal-body");
    const scroll = body.scrollTop;
    body.replaceChildren();
    if (state.view === "browse") {
      $("journal-title").textContent = t("资料查询");
      $("journal").setAttribute("aria-label", t("资料分类与搜索"));
      body.append(el("p", { class: "d-sub" }, t("直接查资料，沿着材料、用途和前置条件继续了解。")));
      const list = el("div", { class: "browse-nav" });
      for (const c of App.browse.categories) list.append(el("button", { type: "button", "aria-current": App.browse.category === c.id ? "page" : null,
        onclick: () => App.openBrowse(c.id) }, img(c.icon), c.title));
      body.append(list); body.scrollTop = scroll; return;
    }
    if (state.view === "tree") {
      $("journal-title").textContent = t("成长路线");
      $("journal").setAttribute("aria-label", t("成长路线分组"));
      renderLaneList(body);
      body.scrollTop = scroll;
      return;
    }
    $("journal-title").textContent = t("地图查阅");
    $("journal").setAttribute("aria-label", t("地图地点与资料"));
    if (!App.conditionsActive()) {
      body.append(el("p", { class: "d-sub" }, t("按地点浏览商店、居民与水域。数字标记可展开同一片区域的资料。")));
      const places = ["皮埃尔的杂货店", "木匠的商店", "铁匠铺", "鱼店"].map(name => App.locationByName.get(name)).filter(l => l && visible("location", l.p));
      body.append(group(t("地点速查"), places.length, t("查看开放时段、商品和位置"), places.map(l => row({ icon: l.i, name: N(l.p), sub: safeText(App.locText(l).hours || t("地点资料")), ref: { type: "location", id: l.p } }))));
      const waters = App.mapContents.points(App.map.mapKey).filter(p => p.entries.some(e => e.kind === "fish"));
      body.append(group(t("已展示的钓鱼水域"), waters.length, t("按水域查鱼和出现条件"), waters.slice(0, 5).map(p => {
        const button = row({ icon: "Fishing_Skill_Icon.png", name: p.title, sub: t("{n} 条鱼类资料", { n: p.entries.filter(e => e.kind === "fish").length }) });
        button.addEventListener("click", () => { App.openMapPlaces([p.id]); App.map.locatePoint(p.id); }); return button;
      })));
      body.append(actions(btn(t("打开鱼类图鉴"), () => App.openBrowse("fish")), btn(t("按条件对照（可选）"), openConditions)));
      body.scrollTop = scroll; return;
    }
    const C = state.cond;

    const next = mixedFrontier();
    if (next.length) body.append(group(t("可继续了解的目标"), next.length, t("按已确认的前置条件列出，材料与资金仍需核对"), next.map(nodeRow), { limit: 4, open: false }));

    const fish = D.fish.filter(f => visible("fish", f.p) && (App.fishMethod ? App.fishMethod(f) === "rod" : !f.crab)).map((f) => ({ f, c: App.fishCheck(f) }));
    const rooms = state.progress.rooms;
    const needFor = (f) => (App.bundleUse.get(f.id) || []).filter(b => {
      if (!S.canView({ type: "bundle", id: `${b.room}:${b.bundle.name}` }) || rooms?.includes(b.room)) return false;
      const itemIndex = b.bundle.items.findIndex(item => item.id === f.id);
      return App.collections && !App.collections.summary(b.room, b.bundle).complete && !App.collections.isSubmitted(b.room, b.bundle, itemIndex);
    });
    const endOf = (f) => (f.T.find(([a, b]) => C.time >= a && C.time < b) || [0, 2600])[1];
    const can = fish.filter((x) => x.c.ok === true).sort((a, b) =>
      (needFor(b.f).length > 0) - (needFor(a.f).length > 0) || endOf(a.f) - endOf(b.f) || (b.f.pr || 0) - (a.f.pr || 0));
    const maybe = fish.filter((x) => x.c.ok === null);
    const fishRows = can.map(({ f, c }) => {
      const end = endOf(f);
      const need = needFor(f);
      const places = safeText(c.where.length ? App.list(c.where.filter(n => visible("location", n)).slice(0, 3).map(N)) : App.fishText(f).lt || "", t("地点条件见详情"));
      const sub = [need.length ? t("收集包尚无提交记录") : null, f.legend ? t("传说鱼") : null, places].filter(Boolean).join(" · ");
      return row({ icon: f.i, name: N(f.p), sub, tail: end < 2600 ? t("到 {time}", { time: fmtTime(end) }) : t("全天"), tailClass: end < 2600 && App.timeToMinutes(end) - App.timeToMinutes(C.time) <= 60 ? "bad" : "", ref: { type: "fish", id: f.p } });
    });
    maybe.forEach(({ f, c }) => fishRows.push(row({ icon: f.i, name: N(f.p), sub: safeText(App.clauses(c.checks.filter((x) => x.ok === null).map((x) => x.hint || x.text))), tail: t("待确认"), tailClass: "", ref: { type: "fish", id: f.p } })));
    body.append(group(t("按条件查鱼"), can.length, t("{conditions}；有未记录提交的收集包用途会附注", { conditions: condText() }), fishRows, { limit: 6, empty: t("当前没有能确认的结果，可调整条件或查看鱼类图鉴。") }));

    const biz = D.locations.filter((l) => visible("location", l.p) && App.BUSINESSES.has(l.p) && l.R?.length && !(App.AREAS.desert && ["赌场", "绿洲"].includes(l.p) && App.areaState("desert").state !== "open"));
    const shops = biz.map((l) => ({ l, s: App.shopCheck(l) })).filter((x) => x.s);
    const open = shops.filter((x) => x.s.ok === true);
    const shopRows = open.map(({ l, s }) => row({ icon: occupantIcon(l) || l.i, name: N(l.p), sub: s.text, tail: s.soon ? t("快打烊") : t("营业中"), tailClass: s.soon ? "bad" : "good", ref: { type: "location", id: l.p } }));
    shops.filter((x) => x.s.ok !== true).forEach(({ l, s }) => shopRows.push(row({ icon: occupantIcon(l) || l.i, name: N(l.p), sub: s.text,
      tail: s.ok === false ? t("关门") : t("待确认"), tailClass: s.ok === false ? "bad" : "", ref: { type: "location", id: l.p } })));
    body.append(group(t("按常规时段查店铺"), open.length, t("{weekday} {time}；节日、事件与店主施工需另行核对", { weekday: App.WEEKDAY_ZH[App.weekday(C.day)], time: fmtTime(C.time) }), shopRows, { limit: Math.max(4, open.length) }));

    const bd = App.birthdayToday().filter(v => visible("villager", v.p));
    if (bd.length) {
      body.append(group(t("今天生日"), bd.length, t("生日当天送礼，好感度变化是平时的 8 倍"), bd.map((v) => row({
        icon: v.i, name: N(v.p), sub: t("最爱：{list}", { list: App.list(v.love.filter(id => visible("item", id)).slice(0, 3).map((id) => D.items[id] && App.itemName(D.items[id]))) }), ref: { type: "villager", id: v.p },
      }))));
    }

    const seeds = D.seeds.filter(s => visible("item", s.id)).map((s) => ({ s, c: App.seedCheck(s) })).filter((x) => x.c && x.c.ok);
    seeds.sort((a, b) => a.c.harvest - b.c.harvest);
    body.append(group(t("现在种还来得及"), seeds.length, t("今天种下，在季节结束前能收获（{season}剩 {n} 天）", { season: App.SEASON_ZH[C.season], n: 28 - C.day }), seeds.map(({ s, c }) => {
      const price = Object.values(s.buy)[0];
      return row({ icon: s.crop?.i || s.i, name: s.crop ? nameOf(s.crop.id || s.crop.z) : N(s.p), sub: c.text, tail: price ? money(price) : "", ref: { type: "item", id: s.id } });
    }), { limit: 5, empty: t("本季剩下的天数不够任何作物成熟。") }));
    body.scrollTop = scroll;
  }
  // 每个分组轮流取一个，避免前几项全是同一类
  function mixedFrontier() {
    const order = ["tools", "areas", "gear", "cc", "farm", "skills"];
    // 同组内：能解锁新地区的排前面，其次解锁得多的，再按先后
    const score = (n) => { const d = [...P().descendants(n.id)].map((x) => P().nodes.get(x)); return d.length + 3 * d.filter((x) => x.kind === "area").length; };
    const buckets = order.map((lane) => P().frontier().filter((n) => n.lane === lane && S.node(n.id)).sort((a, b) => score(b) - score(a) || a.col - b.col));
    const out = [];
    for (let i = 0; buckets.some((b) => b[i]); i++) for (const b of buckets) if (b[i]) out.push(b[i]);
    return out;
  }
  function villagerIcon(name) {
    const v = name && App.villagerByName.get(name);
    return v ? v.i : null;
  }
  // 地点多数没有自己的图标，借用第一位住户的头像；住户受保护时不借，免得头像先露出来。
  function occupantIcon(location) {
    const occ = location?.occ?.[0];
    return occ && visible("villager", occ) ? villagerIcon(occ) : null;
  }

  function renderLaneList(body) {
    body.append(el("p", { class: "d-sub tree-reading-note" }, t("纵向按类别分组，每一行是一条路线；向右看后续等级或阶段。点击节点可查材料、前置与用途。")));
    const list = el("ul", { class: "lane-list" });
    for (const l of P().lanes) {
      const ids = l.rows.flatMap((r) => r.nodes).filter(S.node);
      const sts = ids.map((id) => P().status(id).status);
      const pressed = App.tree.lane === l.id;
      const b = el("button", { class: "lane-btn", type: "button", "aria-pressed": String(pressed) },
        el("span", { class: "ln" }, l.name), el("span", { class: "lg" }, l.group),
        el("span", { class: "stats" },
          App.conditionsActive() ? el("span", { class: "ok" }, t("已完成 {n}", { n: sts.filter((s) => s === "done").length })) : null,
          App.conditionsActive() ? el("span", { class: "rd" }, t("前置满足 {n}", { n: sts.filter((s) => s === "ready").length })) : null,
          el("span", null, t("当前展示 {n}", { n: ids.length }))));
      b.addEventListener("click", () => { App.tree.setLane(pressed ? null : l.id); renderJournal(); });
      list.append(el("li", null, b));
    }
    body.append(group(t("按条件分组"), P().lanes.length, t("点一组只看这组；再点一次恢复全部"), [list], { limit: 1 }));
    const next = P().frontier().filter(n => S.node(n.id)).sort((a, b) => a.col - b.col);
    if (App.conditionsActive()) body.append(group(t("按已填进度对照"), next.length, t("材料和实际持有状态仍需核对"), next.map(nodeRow), { limit: 5, open: false }));
    const legend = el("div", { class: "legend" },
      el("span", null, el("i"), t("实线：必须先完成")),
      el("span", null, el("i", { class: "series" }), t("虚线：同系列进阶，不是前置")),
      el("span", null, el("i", { class: "cross" }), t("点线：跨分组的条件")),
      el("span", null, el("i", { class: "lit" }), t("金色：选中目标还要走的路")));
    body.append(group(t("图例"), 4, null, [legend], { limit: 1 }));
  }

  // ———————————————————— 搜索 ————————————————————
  // 中文版：主名是中文、副名是英文；英文版反过来。两种名称都可以搜索。
  const searchIndex = [];
  const ROUTE = t("路线");
  function searchEntry(zh, en, extra) {
    return EN ? { t: en || zh, en: zh, ...extra } : { t: zh, en: en || "", ...extra };
  }
  function buildSearch() {
    const seen = new Set();
    for (const n of P().nodes.values()) {
      if (n.kind === "skill") continue;
      searchIndex.push(searchEntry(n.title, EN ? nodeName(n) : "", { k: ROUTE, ref: { type: "node", id: n.id }, i: n.icon || App.itemInfo(n.itemId)?.i }));
    }
    for (const [title, p] of Object.entries(D.pages)) {
      // 中文站特有的消歧义页没有英文对应条目，英文版不收入搜索。
      if (EN && p.k === "disambiguation" && !p.e) continue;
      let ref = { type: "page", id: title };
      if (App.fishByName.has(title)) ref = { type: "fish", id: title };
      else if (App.villagerByName.has(title)) ref = { type: "villager", id: title };
      else if (App.locationByName.has(title)) ref = { type: "location", id: title };
      else if (p.id) ref = { type: "item", id: p.id };
      const icon = p.i || D.items[p.id]?.i || App.monsterByName.get(title)?.i || App.animalByName.get(title)?.i;
      searchIndex.push(searchEntry(title, EN ? (p.id && D.items[p.id]?.e) || N(title) : p.e, { a: p.a || [], k: t(p.kz), ref, i: icon }));
      if (p.id) seen.add(p.id);
    }
    for (const [id, it] of Object.entries(D.items)) {
      if (seen.has(id) || it.x) continue;
      searchIndex.push(searchEntry(it.z, it.e, { k: t(it.c || "物品"), ref: { type: "item", id }, i: it.i }));
    }
    for (const e of searchIndex) { e.ft = fold(e.t); e.fe = fold(e.en); e.fa = (e.a || []).map(fold); }
  }
  // 搜索容错：英文不分大小写，全角字母数字按半角比较（逐字替换，长度不变，原文位置照用）。
  function fold(text) {
    const low = text.toLowerCase();
    return (low.length === text.length ? low : text).replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, " ");
  }
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (Math.min(...cur) > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  // 名称打错一两个字时找相近的条目名：和整个名称或同样长的开头比较，编辑距离不超过长度的四分之一（至少 1 个字）。
  function similarNames(q, limit = 5) {
    q = fold(q.trim());
    const max = Math.max(1, Math.floor(q.length / 4)), out = [];
    for (const e of searchIndex) {
      let d = max + 1;
      for (const name of [e.ft, e.fe]) if (name) d = Math.min(d, editDistance(q, name, max), editDistance(q, name.slice(0, q.length), max) + 0.5);
      if (d <= max && S.canView(e.ref)) out.push({ e, d: d + (e.k === ROUTE ? 0.2 : 0) });
    }
    out.sort((a, b) => a.d - b.d || a.e.t.length - b.e.t.length);
    const seen = new Set();
    return out.filter(({ e }) => !seen.has(e.t + e.k) && seen.add(e.t + e.k)).slice(0, limit).map(x => x.e);
  }
  function search(q) {
    q = fold(q.trim());
    if (!q) return [];
    const out = [];
    for (const e of searchIndex) {
      const name = e.ft, en = e.fe;
      if (!S.canView(e.ref)) {
        if (name === q || en === q || e.fa.some(a => a === q)) out.push({ e: { t: t("受保护的条目"), en: "", k: t("按需查看"), ref: e.ref, i: null, protected: true }, s: e.ref.type === "node" ? 20 : 0 });
        continue;
      }
      let s = -1;
      if (name === q || en === q) s = 0;
      else if (name.startsWith(q) || en.startsWith(q)) s = 1;
      else if (name.includes(q)) s = 2;
      else if (en.includes(q) || e.fa.some((a) => a.includes(q))) s = 3;
      if (s >= 0) out.push({ e, s: s * 100 + name.length + (e.k === ROUTE ? 20 : 0) });
    }
    out.sort((a, b) => a.s - b.s);
    const dedup = new Set();
    const found = out.filter(({ e }) => { const k = e.t + e.k; if (dedup.has(k)) return false; dedup.add(k); return true; }).slice(0, 14).map((x) => x.e);
    // 没有名称对得上（多半是打错了字）：列出相近的名称。
    if (!found.length) found.push(...similarNames(q).map(e => ({ ...e, near: true })));
    // 名称之外，还可以在条目正文里找（第一次使用时才下载正文文字）。
    const raw = q.trim();
    if (raw.length >= (EN ? 3 : 2)) found.push({ t: t("在条目正文中搜索“{q}”", { q: raw }), en: "", k: t("全文"), ref: { type: "find", id: raw }, i: null, find: true });
    return found;
  }
  function bindSearch() {
    const input = $("search");
    const list = $("search-results");
    let results = [], active = -1;
    const close = () => { list.hidden = true; active = -1; };
    const choose = (e) => { close(); input.value = ""; App.select(e.ref, { from: "search" }); };
    // 下拉列表不超出手账面板（手机上手账是底部面板，窗口矮时也一样）：按面板里剩下的高度限制，多出来的在列表里滚动。
    const fit = () => {
      if (list.hidden) return;
      const room = $("journal").getBoundingClientRect().bottom - 12 - list.getBoundingClientRect().top;
      list.style.maxHeight = Math.max(96, Math.min(360, Math.floor(room))) + "px";
    };
    addEventListener("resize", fit);
    const paint = () => {
      list.replaceChildren();
      if (!results.length) { list.append(el("li", { class: "empty" }, S.active() ? t("未找到可展示结果。可输入完整名称查阅；防剧透已开启。") : t("没有找到。试试中文全名或英文名。"))); list.hidden = false; fit(); return; }
      if (results[0].near) list.append(el("li", { class: "empty" }, t("没有完全相同的名称，下面是相近的：")));
      results.forEach((e, i) => {
        // 英文版不显示中文副名；中文仍可用于检索。
        const li = el("li", { role: "option", "aria-selected": String(i === active), class: e.find ? "find-entry" : null },
          e.protected ? protectedImage() : e.find ? findIcon() : img(e.i),
          el("span", null, e.t, e.en && !EN ? el("span", { class: "en" }, e.en) : null), el("span", { class: "kind" }, e.k));
        li.addEventListener("mousedown", (ev) => { ev.preventDefault(); choose(e); });
        list.append(li);
      });
      list.hidden = false;
      fit();
    };
    input.addEventListener("input", () => { results = search(input.value); active = results.length ? 0 : -1; input.value.trim() ? paint() : close(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
      else if (e.key === "Enter" && results[active]) choose(results[active]);
      else if (e.key === "Escape") { close(); input.blur(); }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
    App.on(() => { if (!list.hidden && input.value.trim()) { results = search(input.value); active = results.length ? 0 : -1; paint(); } });
  }

  // ———————————————————— 详情 ————————————————————
  const detail = $("detail");
  const dbody = $("detail-body");
  function updateDetailPresentation() {
    detail.dataset.mode = detailMode;
    $("detail-shade").hidden = detail.hidden || detailMode !== "reading";
    $("detail-mode").hidden = state.view === "browse";
    $("detail-mode").textContent = detailMode === "context" ? t("居中阅读") : state.view === "map" ? t("对照地图") : t("对照路线");
    $("detail-caption").textContent = $("detail-title")?.textContent || t("资料阅读");
    detail.setAttribute("role", detailMode === "reading" ? "dialog" : "region");
    if (detailMode === "reading") detail.setAttribute("aria-modal", "false");
    else detail.removeAttribute("aria-modal");
  }
  function setDetailMode(mode) {
    detailMode = mode === "context" && state.view !== "browse" ? "context" : "reading";
    updateDetailPresentation(); updateInsets();
  }
  function focusDetailTitle() {
    const title = $("detail-title");
    title?.setAttribute("tabindex", "-1"); title?.focus({ preventScroll: true });
  }
  App.setDetailMode = setDetailMode;
  const MARK = { true: ["ok", "✓"], false: ["no", "✗"], null: ["unk", "?"], undefined: ["info", "·"] };
  function checkList(checks) {
    return el("ul", { class: "checks", dataset: { spoilerScoped: "true" } }, checks.map((c) => {
      // 未启用对照时去掉状态和状态提示；note 是补充说明（如 Joja 路线），始终显示。
      if (!App.conditionsActive()) c = { ...c, ok: undefined, hint: null };
      const [cls, sym] = MARK[String(c.ok)];
      const extra = [c.hint, c.note].filter(Boolean);
      const body = () => el("span", null, c.text, extra.map(x => el("span", { class: "hint" }, x)));
      if (S.active() && !S.textAllowed([c.text, ...extra].join(" "), S.title(current))) {
        return el("li", null, foldContent(() => el("div", { class: "check-row" }, el("span", { class: "mark " + cls }, sym), body()),
          t("此项条件涉及后续内容。"), t("查看这项条件")));
      }
      return el("li", { class: "check-row" }, el("span", { class: "mark " + cls, "aria-label": { ok: t("满足"), no: t("未满足"), unk: t("未确认"), info: t("说明") }[cls] }, sym), body());
    }));
  }
  function stateChip(ok, labels = [t("可以"), t("条件未满足"), t("未确认")]) {
    if (!App.conditionsActive()) return null;
    const [cls, text] = ok === true ? ["ok", labels[0]] : ok === false ? ["no", labels[1]] : ["unk", labels[2]];
    return el("span", { class: "path-state " + cls }, text);
  }
  // replaceChildren 会把 null 变成文字“null”，先过滤掉空值
  function foldContent(content, label = t("这部分可能涉及后续内容"), action = t("查看这部分")) {
    const box = el("div", { class: "spoiler-fold", dataset: { spoilerScoped: "true" } });
    const collapse = () => {
      const open = btn(t("{action}（可能剧透）", { action }), () => {
        const close = btn(t("收起这部分"), () => { collapse(); box.querySelector("button").focus(); });
        box.replaceChildren(typeof content === "function" ? content() : content, close); close.focus();
      });
      box.replaceChildren(el("p", null, label), open);
    };
    collapse();
    return box;
  }
  function protectContent(content) {
    if (!content || content.dataset?.spoilerScoped === "true" || !S.active() || S.textAllowed(content.textContent, S.title(current))) return content;
    const title = content.classList?.contains("d-section") && content.querySelector("h3")?.textContent;
    if (title && S.textAllowed(title, S.title(current))) {
      for (const child of [...content.children].slice(1)) child.replaceWith(protectContent(child));
      content.dataset.spoilerScoped = "true";
      return content;
    }
    return foldContent(content, title ? t("{title}包含后续内容。", { title }) : t("此段说明涉及尚未查看的内容。"), title ? t("查看{title}", { title }) : t("查看这段说明"));
  }
  function fillDetail(...parts) { dbody.replaceChildren(...parts.flat().filter(Boolean).map(protectContent)); }
  function section(title, ...content) {
    return el("section", { class: "d-section" }, el("h3", null, title), ...content);
  }
  function protectedImage() {
    return el("span", { class: "noimg protected-icon", role: "img", "aria-label": t("图片已隐藏"), title: t("防剧透：图片已隐藏"),
      html: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="11" rx="1"/><path d="M12 14v3"/></svg>' });
  }
  function head(icon, title, sub, imageNote, concealed = false) {
    const illustration = concealed ? protectedImage() : img(icon);
    if (imageNote) illustration.title = imageNote;
    return el("div", { class: "d-head" }, illustration, el("div", null, el("h2", { class: "d-title", id: "detail-title" }, title), sub ? el("div", { class: "d-sub" }, sub) : null));
  }
  function itemChip(idOrZh, qty) {
    const it = App.itemInfo(idOrZh) || { z: idOrZh };
    const ref = it.id ? { type: "item", id: it.id } : { type: "page", id: it.z };
    if (!S.canView(ref)) return btn(t("后续物品 · 按需查看"), () => App.select(ref));
    const b = el("button", { class: "chip", type: "button" }, img(it.i), `${App.itemName(it)}${App.qtyText(qty)}`);
    b.addEventListener("click", () => App.select(it.id ? { type: "item", id: it.id } : { type: "page", id: it.z }));
    return b;
  }
  function itemGroup(ids, label = t("其他关联物品"), limit = 8) {
    const unique = [...new Set(ids.filter(Boolean))];
    const known = unique.filter(id => S.canView({ type: "item", id }));
    const hidden = unique.filter(id => !S.canView({ type: "item", id }));
    const box = el("div", { class: "item-group", dataset: { spoilerScoped: "true" } });
    const chips = el("div", { class: "chips" }, known.slice(0, limit).map(id => itemChip(id)));
    box.append(chips);
    if (known.length > limit) box.append(btn(t("查看其余 {n} 项", { n: known.length - limit }), e => {
      chips.append(...known.slice(limit).map(id => itemChip(id))); e.currentTarget.remove();
    }));
    if (hidden.length) box.append(foldContent(() => el("div", { class: "chips" }, hidden.map(id => {
      const it = App.itemInfo(id);
      return btn(it ? App.itemName(it) : t("物品资料"), () => App.select({ type: "item", id }));
    })), t("{label}涉及后续内容。", { label }), t("查看{title}", { title: label })));
    return box;
  }
  // 条目链接（怪物、动物、地点、路线节点）：未展示的条目收起，和物品一样按需查看。条目名到引用的对应见 relations.js。
  const titleRef = App.titleRef;
  // 只有一条途径时不写“满足任意一条即可”。
  const pathsTitle = paths => paths.length > 1 ? t("获取途径（满足任意一条即可）") : t("获取途径");
  function pageLink(title, note) {
    const loc = App.locationByName.get(title);
    const icon = App.monsterByName.get(title)?.i || App.animalByName.get(title)?.i || occupantIcon(loc) || loc?.i || D.pages[title]?.i;
    return { ref: titleRef(title), label: N(title), icon, note };
  }
  // 地点多数没有图标，没有图片时不放“暂无图片”的占位。
  function linkChip({ ref, label, icon, note }) {
    return el("button", { class: "chip", type: "button", onclick: () => App.select(ref) }, App.hasImage(icon) ? img(icon) : null, label,
      note && S.textAllowed(note, S.title(current)) ? el("span", { class: "hint" }, " " + note) : null);
  }
  function linkGroup(entries, label) {
    const known = entries.filter(e => S.canView(e.ref)), hidden = entries.filter(e => !S.canView(e.ref));
    const box = el("div", { class: "item-group", dataset: { spoilerScoped: "true" } });
    if (known.length) box.append(el("div", { class: "chips" }, known.map(linkChip)));
    if (hidden.length) box.append(foldContent(() => el("div", { class: "chips" }, hidden.map(linkChip)),
      t("{label}涉及后续内容。", { label }), t("查看{title}", { title: label })));
    return box;
  }
  // 物品属性：食物的能量与生命值和增益，武器与饰品的属性。数值与写法来自 Wiki 信息框。
  function propsSection(pr) {
    const eat = pr?.eat, weapon = pr?.weapon || {};
    if (!eat && !pr?.buff?.length && !pr?.stats?.length && !pr?.weapon) return null;
    const signed = v => typeof v !== "number" ? v : v > 0 ? "+" + v.toLocaleString(App.locale) : v < 0 ? "−" + Math.abs(v).toLocaleString(App.locale) : "0";
    const parts = [];
    // 能分品质的食物照 Wiki 列出四档品质；料理等只有一档。
    if (eat?.q?.length) parts.push(el("table", { class: "eat-grid" },
      el("thead", null, el("tr", null, el("th", null, t("品质")), el("th", null, t("能量")), el("th", null, t("生命值")))),
      el("tbody", null, [[t("普通"), eat.e, eat.h], [t("银星"), ...eat.q[0]], [t("金星"), ...eat.q[1]], [t("铱星"), ...eat.q[2]]]
        .map(([quality, energy, health]) => el("tr", null, el("td", null, quality), el("td", null, signed(energy)), el("td", null, signed(health)))))));
    const rows = [
      eat && !eat.q?.length ? { text: t("能量 {energy}，生命值 {health}", { energy: signed(eat.e), health: signed(eat.h) }) } : null,
      pr.buff?.length ? { text: t("增益：{list}", { list: App.list(pr.buff) }) } : null,
      pr.buff_time ? { text: t("持续时间：{time}", { time: pr.buff_time }) } : null,
      weapon.type ? { text: t("类型：{value}", { value: weapon.type }) } : null,
      weapon.level ? { text: t("等级：{value}", { value: weapon.level }) } : null,
      weapon.damage ? { text: t("伤害：{value}", { value: weapon.damage }) } : null,
      weapon.crit ? { text: t("暴击率：{value}", { value: weapon.crit }) } : null,
      pr.stats?.length ? { text: t("属性：{list}", { list: App.list(pr.stats) }) } : null,
    ].filter(Boolean);
    if (rows.length) parts.push(checkList(rows));
    const food = eat || pr.buff?.length;
    return section(pr.weapon ? t("武器属性") : food && pr.stats?.length ? t("属性") : food ? t("食用效果") : t("装备效果"), ...parts);
  }
  function mentionList(entries) {
    if (!entries.length) return null;
    const item = m => el("li", null, m.p && D.pages[m.p]
      ? el("a", { class: "art-link", href: refHref(titleRef(m.p)), onclick: e => { e.preventDefault(); App.select(titleRef(m.p)); } }, N(m.p))
      : (m.p ? N(m.p) : m.e), t("：") + m.t);
    const shown = entries.filter(m => S.textAllowed((m.p ? N(m.p) : m.e) + " " + m.t, S.title(current)));
    const hidden = entries.length - shown.length;
    return [el("p", { class: "source-group-label" }, t("Wiki 其他条目讲到这件物品")),
      shown.length ? el("ul", { class: "art-list" }, shown.map(item)) : null,
      hidden ? foldContent(() => el("ul", { class: "art-list" }, entries.map(item)), t("还有 {n} 项涉及后续内容。", { n: hidden }), t("查看完整列表")) : null];
  }
  function sourceFragments(text, { joined = false } = {}) {
    const box = el("div", { class: "source-fragments", dataset: { spoilerScoped: "true" } });
    // 中文按句号、分号切分；英文按句末标点切分，避免把完整句子拆碎。
    const chunks = EN ? (text || "").split(/\n|;|•|(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean) : (text || "").match(/[^。；;•·\n]+[。；;]?/g) || [];
    const visible = chunks.filter(t => S.textAllowed(t, S.title(current)));
    const protectedParts = chunks.filter(t => !S.textAllowed(t, S.title(current)));
    // 成段的导言保持一段；逐条来源、前提说明每句一行。
    if (joined && visible.length) box.append(el("p", { class: "d-sub" }, visible.map(t => t.trim()).join(EN ? " " : "")));
    else visible.forEach(t => box.append(el("p", { class: "d-sub" }, t.trim())));
    if (protectedParts.length) box.append(foldContent(() => el("div", null, protectedParts.map(t => el("p", { class: "d-sub" }, t.trim()))),
      t("其他来源涉及后续内容。"), t("查看其他来源")));
    return box;
  }
  // Wiki 信息框逐条列出的来源；涉及后续内容的条目按需展开，其余直接显示。
  function entryList(entries) {
    return el("ul", { class: "source-list" }, entries.map(x => el("li", null, x)));
  }
  function sourceGroups(groups) {
    const LABELS = { as: t("远古斑点"), md: t("由怪物掉落"), os: t("其他来源"), source: t("来源") };
    const labelled = groups.length > 1 || groups[0][0] !== "source";
    return el("div", { class: "source-groups", dataset: { spoilerScoped: "true" } }, groups.map(([key, entries]) => {
      const shown = entries.filter(x => S.textAllowed(x, S.title(current)));
      const hidden = entries.filter(x => !S.textAllowed(x, S.title(current)));
      return el("div", { class: "source-group" }, labelled ? el("p", { class: "source-group-label" }, LABELS[key] || key) : null,
        shown.length ? entryList(shown) : null,
        hidden.length ? foldContent(() => entryList(hidden), t("部分来源涉及后续内容。"), t("查看这些来源")) : null);
    }));
  }
  function wikiUrl(title) {
    const p = D.pages[title];
    if (EN) return App.pageInfo(title)?.u || (p?.e ? "https://stardewvalleywiki.com/" + encodeURIComponent(p.e.replace(/ /g, "_")) : null);
    return p ? p.u : "https://zh.stardewvalleywiki.com/" + encodeURIComponent(title);
  }
  function sourceLine(title) {
    const url = wikiUrl(title);
    if (EN) {
      if (!url) return el("p", { class: "d-source" }, t("资料来源：Stardew Valley Wiki 2025-12-18 归档快照。原站内容未作防剧透处理。"));
      return el("p", { class: "d-source" }, t("资料：Stardew Valley Wiki"), " “", el("a", { href: url, target: "_blank", rel: "noopener" }, N(title)), "”", t("，2025-12-18 归档快照。原站内容未作防剧透处理。"));
    }
    return el("p", { class: "d-source" }, "资料：中文 Wiki《", el("a", { href: url, target: "_blank", rel: "noopener" }, title), "》，2025-12-18 归档快照。原站内容未作防剧透处理。");
  }
  // ———————————————————— Wiki 条目正文 ————————————————————
  // 正文按条目单独存放（articles/zh、articles/en），打开时才载入；英文版只有英文 Wiki 有的条目才显示。
  const articleCache = new Map();
  const articleKey = title => (EN ? EN.pages?.[title]?.ar : D.pages[title]?.ar) || null;
  function loadArticle(title) {
    const key = articleKey(title);
    if (!key) return Promise.resolve(null);
    if (!articleCache.has(key)) {
      const request = fetch(`articles/${EN ? "en" : "zh"}/${key}.json`).then(r => (r.ok ? r.json() : null))
        .catch(() => null).then(article => { if (!article) articleCache.delete(key); return article; });
      articleCache.set(key, request);
    }
    return (App.articleRequest = articleCache.get(key));
  }
  const refHref = ref => `${location.pathname}#view=${state.view}&sel=${ref.type}:${encodeURIComponent(ref.id)}`;
  // 片段：文字，["i", 物品 ID, 文字]（带图标），["l", 条目, 文字]（站内链接，可以带小节：“版本历史#1.6”）。
  function articleRuns(parts) {
    const out = [];
    for (const part of parts || []) {
      if (typeof part === "string") {
        part.split("\n").forEach((line, i) => { if (i) out.push(el("br")); if (line) out.push(line); });
        continue;
      }
      const [kind, id, label] = part;
      if (kind === "f") { out.push(articleImage(id, label)); continue; }
      const item = kind === "i" ? D.items[id] : null;
      if (kind === "i" && !item) { out.push(label); continue; }
      const [page, anchor] = item ? [id] : id.split("#");
      const ref = item ? { type: "item", id } : titleRef(page);
      out.push(el("a", { class: item ? "art-item" : "art-link", href: refHref(ref), onclick: e => {
        e.preventDefault();
        // 链到小节时：打开条目后展开正文、滚到那一节。
        if (anchor && articleKey(page)) focusSection = { title: page, heading: anchor };
        App.select(ref);
      } }, item && App.hasImage(item.i) ? img(item.i, "art-icon") : null, label));
    }
    return out;
  }
  // 正文图片：归档里边长不超过 400 像素的图按原尺寸显示（窄屏缩小）；大地图、信息图显示缩略图，点开是原尺寸的 WebP。
  function articleImage(file, width, cls) {
    const node = el("img", { class: "art-img" + (cls ? " " + cls : ""), src: App.iconSrc(file), width: width || null, alt: "", loading: "lazy", decoding: "async" });
    // 像素画按整数倍缩小时保持像素感；缩小比例不是整数（截图、建筑图缩到表格里）时平滑显示，免得出现锯齿。
    node.addEventListener("load", () => {
      const ratio = node.naturalWidth / (width || node.naturalWidth);
      if (ratio > 1.01 && Math.abs(ratio - Math.round(ratio)) > 0.05) node.classList.add("art-thumb");
    }, { once: true });
    return node;
  }
  const wikiFile = file => "https://stardewvalleywiki.com/File:" + encodeURIComponent(file.replace(/ /g, "_"));
  function articleGallery(entries) {
    // 缩略图、图集最宽 320 像素；单独占一行的图（键位图、时间轴）照 Wiki 的尺寸，占满一行。
    return el("div", { class: "art-gallery" }, entries.map(([file, width, caption, large]) => file
      ? el("figure", { class: width > 320 ? "art-wide" : null }, el("a", { href: App.iconSrc(large || file), target: "_blank", rel: "noopener", "aria-label": t("查看原图") },
        articleImage(file, width, large ? "art-thumb" : "")), caption?.length ? el("figcaption", null, articleRuns(caption)) : null)
      : el("figure", { class: "art-large" }, el("a", { href: wikiFile(large), target: "_blank", rel: "noopener" },
        caption?.length ? runsText(caption) : t("查看原图"), " ↗"))));
  }
  const runsText = parts => (parts || []).map(p => (typeof p === "string" ? p : p[0] === "f" ? "" : p[2])).join("");
  function cellText(cell) {
    if (Array.isArray(cell)) return runsText(cell);
    return cell.v ? runsText(cell.v) : (cell.b || []).map(blockText).join(" ");
  }
  function blockText(block) {
    const [kind] = block;
    if (kind === "l") return block[2].map(([, parts]) => runsText(parts)).join(" ");
    if (kind === "t") return block[1].map(row => row.map(cellText).join(" ")).join(" ");
    if (kind === "d") return block[1] + " " + block[2].map(blockText).join(" ");
    if (kind === "q") return runsText(block[1]) + " " + runsText(block[2]);
    if (kind === "g") return block[1].map(([, , caption]) => runsText(caption)).join(" ");
    return runsText(block[1]);
  }
  // 图片文件名（多为英文名称）也按受保护的名称核对，防止图片先于文字透露后续内容。
  function blockFiles(block) {
    return JSON.stringify(block).match(/"[^"]+\.(?:png|gif|jpe?g|webp)"/gi)?.map(x => x.slice(1, -1)) || [];
  }
  // 防剧透：段落、列表项、表格行分别核对，涉及后续内容的收起，其余照常显示。
  const allowed = (text, title) => !S.active() || S.textAllowed(text, title);
  const blockAllowed = (block, title) => allowed(blockText(block), title) && (!S.active() || blockFiles(block).every(S.fileAllowed));
  function articleList(items, ordered) {
    const root = el(ordered ? "ol" : "ul", { class: "art-list" });
    const stack = [[1, root]];
    for (const [depth, parts] of items) {
      while (stack.length > 1 && stack[stack.length - 1][0] > depth) stack.pop();
      let [level, list] = stack[stack.length - 1];
      if (depth > level && list.lastElementChild) {
        const child = el(ordered ? "ol" : "ul", { class: "art-list" });
        list.lastElementChild.append(child);
        stack.push([depth, child]);
        list = child;
      }
      list.append(el("li", null, articleRuns(parts)));
    }
    return root;
  }
  function articleTable(rows, caption) {
    const table = el("table", { class: "art-table" }, caption ? el("caption", null, caption) : null,
      el("tbody", null, rows.map(row => el("tr", null, row.map(cell => {
        const c = Array.isArray(cell) ? { v: cell } : cell;
        return el(c.h ? "th" : "td", { colspan: c.c || null, rowspan: c.r || null },
          c.v ? articleRuns(c.v) : (c.b || []).map(b => articleBlock(b)));
      })))));
    return el("div", { class: "art-table-wrap" }, table);
  }
  function articleBlock(block, title) {
    const [kind] = block;
    if (kind === "p") return el("p", null, articleRuns(block[1]));
    if (kind === "n") return el("p", { class: "art-note" }, articleRuns(block[1]));
    if (kind === "h") return el("p", { class: "art-term" }, articleRuns(block[1]));
    if (kind === "q") return el("blockquote", { class: "art-quote" }, el("p", null, articleRuns(block[1])),
      block[2]?.length ? el("footer", null, "— ", articleRuns(block[2])) : null);
    if (kind === "l") return articleList(block[2], block[1]);
    if (kind === "t") return articleTable(block[1], block[2]);
    if (kind === "d") return el("details", { class: "art-details" }, el("summary", null, block[1]), guardBlocks(block[2], title));
    if (kind === "g") return articleGallery(block[1]);
    return null;
  }
  function guardBlocks(blocks, title) {
    const out = [];
    for (const block of blocks) {
      if (blockAllowed(block, title)) { out.push(articleBlock(block, title)); continue; }
      const [kind] = block;
      if (kind === "l" || kind === "t") {
        // 列表、表格只收起涉及后续内容的项或行；表头始终显示。
        const entries = kind === "l" ? block[2] : block[1];
        const head = kind === "t" ? entries.filter(row => row.every(c => !Array.isArray(c) && c.h)) : [];
        const visible = entries.filter(e => head.includes(e) || blockAllowed(kind === "l" ? ["p", e[1]] : ["t", [e]], title));
        const partial = visible.length > head.length ? (kind === "l" ? articleList(visible, block[1]) : articleTable(visible, block[2])) : null;
        out.push(partial, foldContent(() => articleBlock(block, title),
          t("还有 {n} 项涉及后续内容。", { n: entries.length - visible.length }), t(kind === "l" ? "查看完整列表" : "查看完整表格")));
        continue;
      }
      out.push(foldContent(() => articleBlock(block, title), t("这部分涉及后续内容。"), t("查看这部分")));
    }
    return out;
  }
  // 爱心事件、秘密一类章节写的是剧情，开启防剧透时整节收起。
  const STORY_SECTION = /心事件|Heart Events?|秘密|Secrets?$/i;
  function articleBody(article, title, { facts = true, base = 3 } = {}) {
    const out = [];
    if (facts && article.f?.length) {
      const rows = article.f.filter(([label, parts]) => allowed(label + " " + runsText(parts), title));
      if (rows.length) out.push(el("dl", { class: "kv art-facts" }, rows.flatMap(([label, parts]) => [el("dt", null, label), el("dd", null, articleRuns(parts))])));
    }
    for (const [heading, level, blocks] of article.s) {
      const tag = heading ? "h" + Math.min(6, base + Math.max(0, level - 2)) : null;
      const content = guardBlocks(blocks, title);
      if (!heading) { out.push(...content); continue; }
      const sectionEl = el("section", { class: "art-section", dataset: { spoilerScoped: "true" } }, el(tag, null, heading), content);
      out.push(S.active() && (STORY_SECTION.test(heading) || !allowed(heading, title))
        ? foldContent(sectionEl, STORY_SECTION.test(heading) && allowed(heading, title) ? t("{title}写的是剧情内容。", { title: heading }) : t("这一节涉及后续内容。"), t("查看这一节"))
        : sectionEl);
    }
    return out;
  }
  // 只有摘要的条目：正文直接显示在详情里。
  function articleInline(title, summary) {
    const box = el("div", { class: "article", dataset: { spoilerScoped: "true" } },
      summary && allowed(summary, title) ? el("p", { class: "d-summary" }, summary) : null, el("p", { class: "d-sub" }, t("正在载入条目内容…")));
    loadArticle(title).then(article => {
      if (!box.isConnected) return;
      box.replaceChildren(...(article ? articleBody(article, title) : [summary && allowed(summary, title) ? el("p", { class: "d-summary" }, summary) : null,
        el("p", { class: "d-sub" }, t("条目内容载入失败，可以查看原 Wiki。"))]));
      revealSection(box, title);
    });
    return box;
  }
  // 其他条目：页尾按需展开 Wiki 条目全文（信息框已在上方，不重复）。
  function articleFold(title) {
    if (!articleKey(title)) return null;
    const box = el("section", { class: "d-section art-fold", dataset: { spoilerScoped: "true" } });
    const heading = () => el("h3", null, t("Wiki 条目全文"));
    const collapse = () => box.replaceChildren(heading(), el("p", { class: "d-sub" }, t("原 Wiki 条目的完整内容，按需展开。")),
      btn(t("展开条目全文"), expand));
    const expand = () => {
      box.replaceChildren(heading(), el("p", { class: "d-sub" }, t("正在载入条目内容…")));
      loadArticle(title).then(article => {
        if (!box.isConnected) return;
        const close = btn(t("收起条目全文"), () => { collapse(); box.querySelector("button")?.focus(); });
        box.replaceChildren(heading(), ...(article ? articleBody(article, title, { facts: false, base: 4 })
          : [el("p", { class: "d-sub" }, t("条目内容载入失败，可以查看原 Wiki。"))]), close);
        revealSection(box, title);
      });
    };
    collapse();
    // 从正文搜索结果进来：直接展开全文并滚到命中的小节。
    if (focusSection?.title === title) queueMicrotask(expand);
    return box;
  }
  App.loadArticle = loadArticle;

  // ———————————————————— 正文全文搜索 ————————————————————
  // 各条目正文的纯文字按语言打包成一个文件，第一次搜索正文时才下载（压缩后约 1.4 MB）。
  // 每条为 [条目, 小节, Wiki 里重定向到这个条目的名称?]。载入后给每个小节加上折叠过大小写、全半角的文字
  // （[小节标题, 文字, 查找用的文字]），别名记到 corpus.aliases（折叠后的名称 → 条目）。
  let corpusRequest = null;
  function loadCorpus() {
    corpusRequest ||= fetch(`articles/${EN ? "en" : "zh"}/search.json`).then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(corpus => {
        if (!corpus) { corpusRequest = null; return corpus; }
        corpus.aliases = new Map();
        for (const [title, sections, aliases] of corpus) {
          for (const section of sections) section.push(fold(section[0] + "\n" + section[1]));
          for (const alias of aliases || []) corpus.aliases.set(fold(alias), title);
        }
        return corpus;
      });
    return (App.corpusRequest = corpusRequest);
  }
  const findIcon = () => el("span", { class: "noimg find-icon", role: "img", "aria-label": t("全文"),
    html: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/></svg>' });
  // 从搜索结果打开条目时，正文载入后滚到命中的那一节。
  let focusSection = null;
  function revealSection(box, title) {
    if (!focusSection || focusSection.title !== title) return;
    const heading = focusSection.heading;
    focusSection = null;
    const target = heading && [...box.querySelectorAll(".art-section > :first-child")].find(h => h.textContent === heading);
    target?.scrollIntoView({ block: "start" });
  }
  // 在折叠过的文字里找位置，再从原文截取，全角、半角写法不同也能标出来。
  function markTerms(text, terms) {
    const low = fold(text), out = [];
    let pos = 0;
    for (;;) {
      let at = -1, len = 0;
      for (const term of terms) {
        const i = low.indexOf(term, pos);
        if (i >= 0 && (at < 0 || i < at || (i === at && term.length > len))) { at = i; len = term.length; }
      }
      if (at < 0) break;
      if (at > pos) out.push(text.slice(pos, at));
      out.push(el("mark", null, text.slice(at, at + len)));
      pos = at + len;
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  }
  function snippet(text, terms) {
    const low = fold(text);
    const found = terms.map(x => low.indexOf(x)).filter(i => i >= 0);
    const at = found.length ? Math.min(...found) : 0;
    const start = Math.max(0, at - 36), end = Math.min(text.length, at + 90);
    return (start ? "…" : "") + text.slice(start, end).replace(/\s*\n\s*/g, " · ") + (end < text.length ? "…" : "");
  }
  // 一个关键词的几种写法：原词；另一种语言的条目名（中文版输入英文名、英文版输入中文名）；
  // 英文名的复数（“parsnips”）去掉词尾正好是条目名时，也按条目名找。
  function termForms(term) {
    const forms = new Set([term]);
    const singular = /^[a-z]{3,}s$/.test(term) ? [term.slice(0, -1), term.replace(/ies$/, "y"), term.replace(/es$/, "")] : [];
    for (const e of searchIndex) {
      const english = EN ? e.ft : e.fe;
      if ((e.fe === term || singular.includes(english)) && S.canView(e.ref)) forms.add(e.ft);
    }
    return [...forms];
  }
  function queryTerms(q) {
    const whole = fold(q.trim());
    // 整个查询是另一种语言的名称（“Ancient Fruit”）时不拆开。
    if (/\s/.test(whole) && searchIndex.some(e => e.fe === whole && S.canView(e.ref))) return [termForms(whole)];
    return whole.split(/\s+/).filter(Boolean).map(termForms);
  }
  function findInArticles(corpus, q) {
    const groups = queryTerms(q), terms = [...new Set(groups.flat())];
    const hits = [];
    let hidden = 0;
    for (const [title, sections] of corpus) {
      const ref = titleRef(title);
      let best = null, matched = 0;
      for (const [heading, text, low] of sections) {
        if (!groups.every(forms => forms.some(form => low.includes(form)))) continue;
        matched++;
        const cut = snippet(text, terms);
        // 防剧透：剧情章节、受保护的小节标题和摘录都不列出。
        if (S.active() && (STORY_SECTION.test(heading) || !S.textAllowed(heading + " " + cut, title))) continue;
        const head = fold(heading);
        const score = terms.reduce((n, term) => n + low.split(term).length - 1, 0) + (terms.some(term => head.includes(term)) ? 5 : 0);
        if (!best || score > best.score) best = { heading, cut, score };
      }
      if (!matched) continue;
      if (!best || !S.canView(ref)) { hidden++; continue; }
      const name = fold(N(title));
      const named = groups.every(forms => forms.some(form => name.includes(form)));
      hits.push({ title, ref, heading: best.heading, snippet: best.cut, sections: matched, score: best.score + (named ? 100 : 0) });
    }
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return { hits, hidden, terms };
  }
  // 没有结果时：正文里一次都没出现的词换成最相近的条目名，给出改过的查询。
  function correctQuery(corpus, q) {
    let changed = false;
    const words = q.trim().split(/\s+/).filter(Boolean).map(word => {
      const form = fold(word);
      if (corpus.some(([, sections]) => sections.some(section => section[2].includes(form)))) return word;
      const near = similarNames(word, 1)[0];
      if (!near) return word;
      changed = true;
      return near.t;
    });
    return changed ? words.join(" ") : null;
  }
  function renderFind(q) {
    const box = el("div", { class: "find-results", dataset: { spoilerScoped: "true" } }, el("p", { class: "d-sub" }, t("正在载入条目正文…")));
    const heading = el("div", { class: "d-head" }, findIcon(), el("div", null, el("h2", { class: "d-title", id: "detail-title" }, t("正文搜索")),
      el("div", { class: "d-sub" }, t("“{q}”", { q }))));
    fillDetail(heading, box);
    loadCorpus().then(corpus => {
      if (!box.isConnected) return;
      if (!corpus) { box.replaceChildren(el("p", { class: "d-sub" }, t("条目正文载入失败，请稍后再试。"))); return; }
      const { hits, hidden, terms } = findInArticles(corpus, q);
      const shown = hits.slice(0, 80);
      const typed = new Set([fold(q.trim()), ...fold(q).split(/\s+/)]);
      const also = terms.filter(term => !typed.has(term));
      const better = hits.length ? null : correctQuery(corpus, q);
      // Wiki 里的写法：“体力”是“能量”的重定向，提示改搜“能量”。先整句对（“Travelling Cart”），再逐个词对。
      const wikiTitle = title => (title && S.canView(titleRef(title)) ? N(title) : null);
      const words = q.trim().split(/\s+/);
      const renamed = words.map(word => wikiTitle(corpus.aliases.get(fold(word))) || word);
      const wikiName = wikiTitle(corpus.aliases.get(fold(q.trim()))) || (renamed.some((word, i) => word !== words[i]) ? renamed.join(" ") : null);
      const findLink = query => el("a", { href: refHref({ type: "find", id: query }), onclick: e => { e.preventDefault(); App.select({ type: "find", id: query }); } }, query);
      box.replaceChildren(...[
        el("p", { class: "d-sub" }, hits.length ? t("{n} 个条目的正文提到“{q}”。", { n: hits.length, q }) : t("没有条目的正文提到“{q}”。", { q })),
        also.length ? el("p", { class: "d-sub" }, t("同时查找了：{list}", { list: App.list(also) })) : null,
        wikiName ? el("p", { class: "d-sub find-wiki-name" }, t("Wiki 里多写作："), findLink(wikiName)) : null,
        better && better !== wikiName ? el("p", { class: "d-sub find-better" }, t("是不是要找："), findLink(better)) : null,
        shown.length ? el("ol", { class: "find-list" }, shown.map(hit => el("li", null,
          el("a", { class: "find-title", href: refHref(hit.ref), onclick: e => {
            e.preventDefault(); focusSection = { title: hit.title, heading: hit.heading }; App.select(hit.ref, { from: "find" });
          } }, App.hasImage(refIcon(hit.ref)) ? img(refIcon(hit.ref)) : null, N(hit.title),
            hit.heading ? el("span", { class: "find-sec" }, " · " + hit.heading) : null),
          el("p", { class: "find-snippet" }, markTerms(hit.snippet, terms))))) : null,
        hits.length > shown.length ? el("p", { class: "d-sub" }, t("只列出前 {n} 个结果，可以换更具体的词。", { n: shown.length })) : null,
        hidden ? el("p", { class: "d-sub" }, t("另有 {n} 个条目的相关内容涉及后续内容，开启防剧透时不列出。", { n: hidden })) : null,
        el("p", { class: "d-sub" }, t("正文来自中文 Wiki 2025-12-18 归档，按小节查找；同一小节里包含全部关键词才算命中。"))].filter(Boolean));
    });
  }
  function actions(...btns) { return el("div", { class: "d-actions" }, btns.filter(Boolean)); }
  function btn(label, fn, primary) { return el("button", { class: "btn" + (primary ? " primary" : ""), type: "button", onclick: fn }, label); }
  function planBtn(ref) {
    const inPlan = state.plan.some((p) => p.type === ref.type && p.id === ref.id);
    return btn(inPlan ? t("取消收藏") : t("收藏条目"), () => { togglePlan(ref); renderDetail(); });
  }

  function matTree(nodes) {
    const ul = el("ul", { class: "mats", dataset: { spoilerScoped: "true" } });
    for (const n of nodes) {
      if (n.generic) {
        ul.append(el("li", { class: "generic-material" }, el("span", { class: "generic-material-icon", "aria-hidden": "true" }, "◇"),
          el("span", null, N(n.z)), el("span", { class: "q" }, "×" + n.qty)));
        continue;
      }
      const ref = n.id ? { type: "item", id: n.id } : { type: "page", id: n.z };
      if (!S.canView(ref)) {
        ul.append(el("li", { class: "concealed-material" }, btn(t("其他材料 · 按需查看"), () => App.select(ref))));
        continue;
      }
      const li = el("li", null, img(n.i), el("span", null, itemChip(n.id || n.z),
        n.via && S.textAllowed(n.via) ? el("span", { class: "hint" }, ` ← ${n.via}${n.time ? " · " + n.time : ""}`) : null), el("span", { class: "q" }, "×" + n.qty));
      if (n.children) li.append(el("div", { class: "sub-mats" }, matTree(n.children)));
      else if (n.source) li.append(el("div", { class: "src" }, sourceFragments(n.source)));
      ul.append(li);
    }
    return ul;
  }

  function renderPaths(paths) {
    const box = el("div", { class: "acquisition-paths", dataset: { spoilerScoped: "true" } });
    paths.forEach((p, i) => {
      if (i) box.append(el("div", { class: "or" }, t("或")));
      const div = el("div", { class: "path" + (App.conditionsActive() && p.ok === true ? " is-ok" : "") });
      const where = p.where && N(p.where);
      div.append(el("div", { class: "path-head" }, el("span", { class: "path-name" }, p.label + (where && !p.label.includes(where) ? ` · ${where}` : "")), stateChip(p.ok, [t("已核验条件满足"), t("条件未满足"), t("仍需确认")])));
      const checks = [...p.checks];
      if (p.cost) checks.push({ ok: undefined, text: t("花费 {cost}", { cost: money(p.cost, p.currency) }) });
      if (p.barter?.length) checks.push({ ok: undefined, text: t("以物换物：{list}", { list: App.matsText(p.barter.map((b) => ({ id: b.id, zh: b.z, qty: b.q }))) }) });
      // 耗时是 Wiki 原文；英文版取英文条目的加工时间字段。
      const time = EN ? p.recipe && App.pageInfo(p.recipe.out.pg)?.f?.crafttime : p.time;
      if (time) checks.push({ ok: undefined, text: t("耗时 {time}", { time }) });
      if (p.note) checks.push({ ok: undefined, text: p.note });
      // “可用设备”已作为条件列出时，不再重复设备行。
      if (p.stations?.length && !p.reqs?.some(r => r.type === "equipment")) checks.push({ ok: undefined, text: t("设备：{list}", { list: App.list(p.stations.map((s) => nameOf(s.id || s.z))) }) });
      if (checks.length) div.append(checkList(checks));
      if (p.inputs?.length) div.append(matTree(App.materialTree(p.inputs)));
      if (p.options?.length) div.append(el("p", { class: "d-sub" }, t("可用物品（任选一种）")), itemGroup(p.options, t("可用物品")));
      if (p.refs?.length) div.append(itemGroup(p.refs, t("相关物品")));
      if (p.monsters?.length) div.append(linkGroup(p.monsters.map(m => pageLink(m.title, m.note)), t("掉落这件物品的怪物")));
      if (p.animals?.length) div.append(linkGroup(p.animals.map(a => pageLink(a.title)), t("产出这件物品的动物")));
      if (p.trees?.length) div.append(linkGroup(p.trees.map(title => pageLink(title)), t("产出这件物品的树")));
      if (p.pond?.length) div.append(linkGroup(p.pond.map(x => pageLink(x.fish, App.pondNote(x))), t("鱼塘里的鱼")));
      if (p.recipe && App.LEARNED_KINDS.has(p.recipe.k) && !(p.recipe.uc || []).some(c => c.group === "initial")) {
        const select = el("select", { "aria-label": t("此配方的学习状态"), class: "recipe-status" },
          [["unknown", t("未确认")], ["yes", t("我已学会")], ["no", t("尚未学会")]].map(([value, label]) => el("option", { value }, label)));
        const learned = state.progress.recipes?.[p.recipe.id];
        select.value = learned === true ? "yes" : learned === false ? "no" : "unknown";
        select.addEventListener("change", () => App.setProgress(progress => {
          progress.recipes ||= {};
          if (select.value === "unknown") delete progress.recipes[p.recipe.id];
          else progress.recipes[p.recipe.id] = select.value === "yes";
        }));
        div.append(el("details", { class: "optional-record" }, el("summary", null, t("记录已学配方（可选）")),
          el("label", { class: "recipe-confirm" }, t("配方状态"), select)));
      }
      if (p.where && App.map && (App.locationByName.has(p.where) || App.AREAS[p.where])) {
        div.append(actions(btn(t("在地图上找到{place}", { place: N(p.where) }), () => showOnMap(p.where))));
      }
      box.append(protectContent(div));
    });
    const assumptions = [...new Set(paths.flatMap(p => p.assumptions || []))];
    if (assumptions.length) box.append(sourceFragments(App.clauses(assumptions)));
    return box;
  }

  function usageSection(id) {
    const parts = [];
    const uses = App.usedIn.get(id) || [];
    if (uses.length) parts.push(el("p", { class: "d-sub" }, t("可以用来做")), itemGroup(uses.map(r => r.out.id || r.out.z), t("后续用途")));
    const builds = App.buildingsUsing(id).filter(({ b }) => App.buildingRef(b.name));
    if (builds.length) parts.push(el("p", { class: "d-sub" }, t("用于建造")), linkGroup(builds.map(({ b, qty }) => ({
      ref: App.buildingRef(b.name), label: App.buildingName(b.name), icon: b.image, note: qty > 1 ? t("用 {n} 个", { n: qty }) : null })), t("用于建造")));
    const bundles = App.bundleUse.get(id) || [];
    if (bundles.length) parts.push(el("p", { class: "d-sub" }, t("收集包")), el("div", { class: "chips" }, bundles.filter(b => S.canView({ type: "bundle", id: `${b.room}:${b.bundle.name}` })).map(b => {
      const index = b.bundle.items.findIndex(item => item.id === id);
      const submitted = App.collections?.isSubmitted(b.room, b.bundle, index);
      return btn(`${N(b.room)} · ${N(b.bundle.name)}${submitted ? t("（已提交）") : ""}`, () => App.select({ type: "bundle", id: `${b.room}:${b.bundle.name}` }));
    })));
    const gifts = App.giftsByItem.get(id);
    for (const [taste, label] of [["love", t("最爱这件礼物")], ["like", t("喜欢这件礼物")]]) {
      const names = (gifts?.[taste] || []).filter(name => visible("villager", name));
      if (!names.length) continue;
      const chips = el("div", { class: "chips" });
      const chip = name => el("button", { class: "chip", type: "button", onclick: () => App.select({ type: "villager", id: name }) }, img(App.villagerByName.get(name)?.i), N(name));
      chips.append(...names.slice(0, 8).map(chip));
      const group = el("div", { dataset: { spoilerScoped: "true" } }, chips);
      if (names.length > 8) group.append(btn(t("查看其余 {n} 位", { n: names.length - 8 }), e => { chips.append(...names.slice(8).map(chip)); e.currentTarget.remove(); }));
      parts.push(el("p", { class: "d-sub" }, label), group);
    }
    return parts.length ? section(t("用途"), ...parts) : null;
  }

  // —— 条目抬头与摘要：列表和关系图共用 ——
  function itemHead(it) {
    const desc = App.itemDesc(it);
    return [head(it.i, App.itemName(it), [it.c && t(it.c), it.p ? t("售价 {price}", { price: money(it.p) }) : null, EN ? null : it.e].filter(Boolean).join(" · "), it.inote && (EN ? null : it.inote)),
      desc ? el("p", { class: "d-summary" }, desc) : null];
  }
  function fishHead(f) {
    const desc = App.itemDesc({ id: f.id, ...(D.items[f.id] || {}) });
    return [head(f.i, N(f.p), t("鱼 · 售价 {price}", { price: money(f.pr) }) + (f.d ? t(" · 难度 {n}", { n: f.d }) : "")),
      desc ? el("p", { class: "d-summary" }, desc) : null];
  }
  function villagerHead(v) {
    const bd = v.bd ? t("{season} {day} 日", { season: App.SEASON_ZH[v.bd.season], day: v.bd.day }) : t("未知");
    const isBd = App.conditionsActive() && v.bd && v.bd.season === state.cond.season && v.bd.day === state.cond.day;
    const addr = EN ? EN.villagers?.[v.p]?.addr : v.addr;
    const summary = App.pageInfo(v.p)?.s;
    return [head(v.i, N(v.p), t("生日：{date}", { date: bd }) + (addr ? t(" · 住在{place}", { place: addr }) : "")),
      isBd ? el("p", { class: "d-summary" }, el("b", null, t("所设日期是生日。")), t("送最爱的礼物，好感度变化是平时的 8 倍。")) : (summary ? el("p", { class: "d-summary" }, summary) : null)];
  }
  function locationHead(name) {
    const l = App.locationByName.get(name), page = App.pageInfo(name) || {}, lt = App.locText(l);
    return [head(occupantIcon(l) || D.pages[name]?.i, N(name), [page.kz, lt.addr].filter(Boolean).join(" · ")),
      page.s ? el("p", { class: "d-summary" }, page.s) : null];
  }
  function monsterHead(title) {
    const m = App.monsterByName.get(title), page = App.pageInfo(title) || {};
    return [head(m.i || D.pages[title]?.i, N(title), page.kz), page.s ? el("p", { class: "d-summary" }, page.s) : null];
  }
  function animalHead(title) {
    const a = App.animalByName.get(title), page = App.pageInfo(title) || {};
    return [head(a.i || D.pages[title]?.i, N(title), [page.kz, a.bp ? t("购买价格 {price}", { price: money(a.bp) }) : null].filter(Boolean).join(" · ")),
      page.s ? el("p", { class: "d-summary" }, page.s) : null];
  }
  function pageHeading(title) {
    const p = { ...App.pageInfo(title), i: D.pages[title].i, e: D.pages[title].e };
    const guideIcon = { 新手指南: "Spring.png", 控制: "Controls_Icon.png", 钓鱼攻略: "Fishing_Skill_Icon.png", 物品栏: "Chest.png",
      游戏内时间: "Time_Icon.png", 季节: "Calendar.png", 天气: "Sunny.png", 能量: "Farming_Skill_Icon.png", 生命值: "Combat_Skill_Icon.png",
      技能: "Farming_Skill_Icon.png", 友谊: "HeartIconLarge.png", 合作: "Maplocation.png" }[title];
    const heading = head(p.i || guideIcon, N(title), [p.kz, EN ? null : p.e].filter(Boolean).join(" · "));
    if (title === "存档" && !p.i) heading.replaceChild(el("span", { role: "img", "aria-label": N("存档"), style: "display:grid;place-items:center;width:48px;height:48px;flex:none;color:var(--bark)",
      html: '<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3h13l4 4v14H3V3h1zm3 0v6h9V3M7 21v-8h10v8"/><path d="M13 3v4"/></svg>' }), heading.firstChild);
    return heading;
  }
  function nodeHead(id) {
    const n = P().nodes.get(id), st = P().status(id), laneName = P().lanes.find((l) => l.id === n.lane).name;
    const STATUS = { done: t("已完成"), ready: t("已知前置满足"), locked: t("条件还没满足"), unknown: t("进度未确认") };
    return [head(n.icon || App.itemInfo(n.itemId)?.i, nodeName(n), App.conditionsActive() ? `${laneName} · ${STATUS[st.status]}` : t("{lane} · 材料与前置关系", { lane: laneName })),
      n.info?.what ? el("p", { class: "d-summary" }, n.info.what) : null];
  }
  // 关系图里的条目：抬头、摘要和页尾（收藏、条目全文、资料来源）与列表相同。
  function entryHead(ref) {
    if (ref.type === "node") return nodeHead(ref.id);
    if (ref.type === "item") return itemHead(App.itemInfo(ref.id) || { z: ref.id });
    if (ref.type === "fish") return fishHead(App.fishByName.get(ref.id));
    if (ref.type === "villager") return villagerHead(App.villagerByName.get(ref.id));
    if (ref.type === "location") return locationHead(ref.id);
    if (App.monsterByName.has(ref.id)) return monsterHead(ref.id);
    if (App.animalByName.has(ref.id)) return animalHead(ref.id);
    const summary = App.pageInfo(ref.id)?.s;
    return [pageHeading(ref.id), summary ? el("p", { class: "d-summary" }, summary) : null];
  }
  const articleOf = ref => (ref.type === "item" ? App.itemInfo(ref.id)?.pg : ref.type === "node" ? P().nodes.get(ref.id)?.info?.source : ref.id);

  function renderFish(f) {
    const source = pointReturn?.pointId && App.mapContents.find(pointReturn.pointId);
    const c = source ? App.mapContents.fishStatus(f, [source.x, source.y, source.map]) : App.fishCheck(f);
    const it = { id: f.id, ...(D.items[f.id] || {}) };
    const method = App.fishMethod(f);
    const text = App.fishText(f), original = App.clauses([text.lt, text.st, text.tt, text.wt]);
    // 时段、天气按 Wiki 逐条显示：鳟鱼大赛、鱿鱼节、瀑布等例外不会被常规时段盖掉。
    const weatherText = App.fishWeatherText(f) || t("详见原文");
    const habitats = App.fishHabitats(f).filter(h => S.textAllowed(h.location) && S.textAllowed(N(h.location)));
    const rules = el("div", { class: "habitat-list", dataset: { spoilerScoped: "true" } }, habitats.map(h => {
      // 夜市潜艇写明日期、登船时段与船票，不只给季节和时段；潜艇在室内，天气不影响。
      const facts = h.location === "夜市" ? [...App.submarineFacts(), f.sub ? { text: t("潜艇中的出现率：{chance}", { chance: f.sub }) } : null].filter(Boolean) : [
        { text: t("季节：{value}", { value: App.list(h.seasons?.map(s => App.SEASON_ZH[s]) || []) || t("详见原文") }) },
        { text: t("时段：{value}", { value: App.fishTimeText(f) || t("详见原文") }) },
        { text: t("天气：{value}", { value: weatherText }) },
        h.depth ? { text: t("需要到达矿井 {n} 层水域", { n: h.depth }) } : null,
        h.level ? { text: t("钓鱼等级至少 {n} 级", { n: h.level }) } : null,
        h.winterTotem ? { text: t("冬季需要雨水图腾改变天气") } : null,
        h.unknown ? { text: h.unknown } : null,
      ].filter(Boolean);
      return el("details", { class: "habitat", open: habitats.length === 1 }, el("summary", null, App.habitatName(h.location)), checkList(facts));
    }));
    fillDetail(
      ...fishHead(f),
      section(t("获取条件"), el("p", { class: "d-sub" }, method === "rod" ? (App.isSubmarineFish(f) ? t("在夜市的钓鱼潜艇里用钓竿捕获。") : t("用钓竿捕获；不同水域的季节或额外要求可能不同。")) : method === "crab" ? t("使用蟹笼捕获。") : t("在海滩采集。")),
        method === "crab" ? checkList(App.crabFacts(f)) : null,
        App.fishRequirements(f).length ? checkList(App.fishRequirements(f)) : null,
        source ? el("p", { class: "d-sub" }, t("从地图查看：{place}", { place: source.title })) : null,
        method === "rod" ? (habitats.length ? rules : sourceFragments(original)) : method === "crab" ? null : sourceFragments(original)),
      original ? el("details", { class: "reference-original" }, el("summary", null, t("核对 Wiki 原文条件")), sourceFragments(original)) : null,
      propsSection(App.itemProps(it)),
      f.pond?.length ? section(t("鱼塘产出"), el("p", { class: "d-sub" }, t("在鱼塘里养这种鱼，养到所写的条数后有几率产出；百分比是产出时为这件物品的概率。")),
        el("div", { class: "chips", dataset: { spoilerScoped: "true" } }, f.pond.map(x => {
          const chip = x.id ? itemChip(x.id) : el("span", { class: "chip static" }, x.z);
          if (chip.classList.contains("chip")) chip.append(el("span", { class: "hint" }, " " + App.pondNote(x)));
          return chip;
        }))) : null,
      usageSection(f.id),
      method === "rod" ? section(t("条件对照（可选）"), App.conditionsActive() ? el("div", null,
        el("div", { class: "path-head" }, el("span", { class: "d-sub" }, condText()), stateChip(c.ok, [t("符合已核验条件"), t("条件不符"), t("待确认")])),
        checkList(c.checks), sourceFragments(App.clauses(c.assumptions || []))) : el("p", { class: "d-sub" }, t("需要核对特定日期或时段时，再设置条件。")),
        actions(btn(App.conditionsActive() ? t("调整对照条件") : t("设置条件再对照"), openConditions))) : null,
      actions(f.pins.length ? btn(t("在地图上查看"), () => showOnMap(null, { type: "fish", id: f.p })) : null, planBtn({ type: "fish", id: f.p })),
      articleFold(f.p), sourceLine(f.p));
  }

  function renderLocation(name) {
    const l = App.locationByName.get(name);
    const page = App.pageInfo(name) || {};
    const lt = App.locText(l);
    const s = l && App.shopCheck(l);
    const area = D.progression.areas.find((a) => a.title === name);
    const nodesHere = [...P().nodes.values()].filter((n) => n.place === name && S.node(n.id));
    const shop = D.shops.find((x) => x.p === name || (name === "下水道" && x.p === "科罗布斯"));
    fillDetail(
      ...locationHead(name),
      s ? section(t("营业规则"), App.conditionsActive() ? el("div", { class: "path-head" }, el("span", { class: "d-sub" }, condText()), stateChip(s.ok, [t("常规时段内"), t("没开门"), t("未确认")])) : null,
        checkList([App.conditionsActive() ? { ok: s.ok, text: s.text } : null, lt.hours ? { ok: undefined, text: t("营业时间：{hours}", { hours: lt.hours.replace(/\n/g, EN ? "; " : "；") }) } : null,
          lt.closed && !["无", "Never", "None"].includes(lt.closed) ? { ok: undefined, text: t("休息：{days}", { days: lt.closed }) } : null].filter(Boolean))) : null,
      area ? areaSection(area.id) : null,
      // 住户里也有不是居民的（达斯迪、沙漠商人）：按条目打开，没有条目的只写名字。
      l?.occ?.length ? section(t("住在这里"), el("div", { class: "chips" }, l.occ.filter(n => n !== name).map((n) => App.villagerByName.has(n) || D.pages[n]
        ? el("button", { class: "chip", type: "button", onclick: () => App.select(titleRef(n)) }, App.hasImage(villagerIcon(n)) ? img(villagerIcon(n)) : null, N(n))
        : el("span", { class: "chip static" }, N(n))))) : null,
      nodesHere.length ? section(t("相关升级与解锁"), el("ul", { class: "checks" }, nodesHere.slice(0, 10).map((n) => {
        const st = P().status(n.id).status;
        const [cls, sym] = App.conditionsActive() ? { done: ["ok", "✓"], ready: ["unk", "★"], locked: ["no", "✗"], unknown: ["unk", "?"] }[st] : ["info", "·"];
        return el("li", { class: "check-row" }, el("span", { class: "mark " + cls }, sym), el("button", { class: "row row-text", type: "button", style: "padding:0", onclick: () => App.select({ type: "node", id: n.id }, { switchView: true }) }, el("span", { class: "main" }, el("span", { class: "name" }, nodeName(n)), el("span", { class: "sub" }, st === "ready" ? t("下一步可以做") : n.sub || ""))));
      }))) : null,
      shop && shop.stock.length ? section(t("出售"), el("div", { class: "chips" }, shop.stock.slice(0, 18).map((e) => {
        const b = itemChip(e.id || e.z);
        const day = App.weekdayNote(e.n?.find((n) => /^周/.test(n)));
        b.append(el("span", { class: "hint" }, " " + (e.bt?.length ? App.matsText(e.bt.map((x) => ({ id: x.id, zh: x.z, qty: x.q }))) : money(e.pr, e.cur)) + (day ? " · " + day : "")));
        return b;
      }))) : null,
      actions(btn(t("在地图上查看"), () => showOnMap(name)), planBtn({ type: "location", id: name })),
      articleFold(name), sourceLine(name));
  }

  function areaSection(id) {
    const a = App.areaState(id);
    return section(t("进入条件"), App.conditionsActive() ? el("div", { class: "path-head" }, el("span", { class: "d-sub" }, t("按已有进度对照")), stateChip(a.state === "open" ? true : a.state === "locked" ? false : null, [t("已开放"), t("还没开放"), t("未确认")])) : null,
      checkList(a.checks), el("p", { class: "quote" }, a.area.quote));
  }

  function renderVillager(name) {
    const v = App.villagerByName.get(name);
    fillDetail(
      ...villagerHead(v),
      v.love.length ? section(t("最爱的礼物"), itemGroup(v.love, t("其他最爱礼物"))) : null,
      v.like.length ? section(t("喜欢的礼物"), itemGroup(v.like, t("其他喜欢礼物"))) : null,
      App.schedules?.render(name),
      v.fam?.length ? section(t("家人"), el("div", { class: "chips" }, v.fam.map((n) => el("button", { class: "chip", type: "button", onclick: () => App.select({ type: "villager", id: n }) }, img(villagerIcon(n)), N(n))))) : null,
      actions(App.mapContents.homePins(v).length ? btn(t("在地图上查看住处"), () => showOnMap(null, { type: "villager", id: name })) : null, planBtn({ type: "villager", id: name })),
      articleFold(name), sourceLine(name));
  }

  function renderItem(id) {
    const it = App.itemInfo(id) || { z: id };
    const paths = App.acquisitions(it.id, it.z);
    const node = [...P().nodes.values()].find((n) => n.itemId && n.itemId === it.id);
    const craft = paths.find((p) => p.inputs?.length && p.kind !== "upgrade" && S.textAllowed(JSON.stringify(p)));
    const totals = craft ? [...App.rawTotals(App.materialTree(craft.inputs)).values()] : [];
    const page = App.pageInfo(it.pg) || {};
    const seed = D.seeds.find(s => s.id === it.id);
    const growing = seed && App.seedCheck(seed);
    const desc = App.itemDesc(it);
    // Wiki 列出的来源（墙纸、服装按件取合集页表格，与购买途径重复的商店等不再列出），见 relations.js。
    const pageAbout = !!it.id && D.pages[it.pg]?.id === it.id;
    const groups = App.itemSources(it, paths);
    const wikiSources = groups.length ? sourceGroups(groups) : null;
    // 没有结构化途径时，依次用条目的“获取途径”章节、信息框来源原文和导言补充。
    const fallback = !paths.length && !wikiSources ? (page.ob?.length ? sourceGroups([["source", page.ob]]) : page.f?.source ? sourceFragments(page.f.source) : null) : null;
    const lead = !paths.length && page.s && page.s !== desc && (!pageAbout || !(wikiSources || fallback))
      ? [el("p", { class: "source-group-label" }, t("Wiki 条目导言")), sourceFragments(page.s, { joined: true })] : null;
    // 仍然什么都没有：列出 Wiki 其他条目讲到这件物品的句子（锻造 · 组合戒指），链接到原条目。
    const mentions = !paths.length && !wikiSources && !fallback && !lead ? mentionList((EN ? EN.mentions?.[it.id] : it.mn) || []) : null;
    const donation = page.dr?.length ? section(t("捐赠奖励"), entryList(page.dr)) : null;
    fillDetail(
      ...itemHead(it),
      propsSection(App.itemProps(it)),
      seed ? section(t("种植规则"), checkList([
        { text: t("适生季节：{value}", { value: App.list(seed.S.map(s => App.SEASON_ZH[s])) || t("见原文") }) },
        { text: seed.g ? t("基础生长时间：{n} 天", { n: seed.g }) : t("生长时间依具体种植规则而定") },
        seed.rg ? { text: t("首次成熟后，每 {n} 天再收获", { n: seed.rg }) } : null,
        ...App.latestPlanting(seed).map(date => ({ text: t("最晚播种：{date}（按基础生长天数，未计肥料和职业加速）", { date }) })),
      ].filter(Boolean)), seed.crop ? itemChip(seed.crop.id || seed.crop.z) : null) : null,
      paths.length ? section(pathsTitle(paths), renderPaths(paths), wikiSources ? [el("p", { class: "d-sub" }, t("Wiki 还列出这些来源")), wikiSources] : null)
        : section(t("获取途径"), wikiSources, fallback, lead, mentions, wikiSources || fallback || lead || mentions ? null
          : el("p", { class: "d-sub" }, it.pg ? t("暂缺可核对的获取资料，可继续查看原 Wiki。") : t("Wiki 没有这件物品的条目或获取说明。"))),
      donation && S.active() ? foldContent(donation, t("捐赠奖励按需查看"), t("查看捐赠奖励")) : donation,
      totals.length > 1 ? section(t("原料合计（按第一条制作途径）"), el("div", { class: "chips" }, totals.map((x) => itemChip(x.id || x.z, x.qty)))) : null,
      usageSection(it.id),
      seed ? section(t("收获日期估算（可选）"), growing ? el("div", null, el("p", { class: "d-summary" }, growing.text),
        el("p", { class: "d-sub" }, App.clauses(growing.assumptions || []))) : el("p", { class: "d-sub" }, t("需要估算收获日时，再选择播种日期。")),
        actions(btn(t("设置播种日期"), openConditions))) : null,
      actions(node ? btn(t("在成长路线中查看"), () => App.select({ type: "node", id: node.id }, { switchView: true })) : null, planBtn({ type: "item", id: it.id || it.z })),
      it.pg ? [articleFold(it.pg), sourceLine(it.pg)] : null);
  }

  // 怪物：属性、出没地点与掉落物，取自信息框原文；英文版取英文 Wiki 的同一信息框。
  function renderMonster(title) {
    const m = App.monsterByName.get(title), info = App.monsterInfo(m), page = App.pageInfo(title) || {}, s = info.s;
    const pins = D.pins.filter((x) => x.t === title);
    const stats = [
      // 信息框写的是基础数值（中文 Wiki“基础HP”，英文 Wiki“Base HP”）。
      s.hp && { text: t("基础生命值：{value}", { value: s.hp }) },
      s.dmg && { text: t("基础伤害：{value}", { value: s.dmg }) },
      s.def && { text: t("基础防御：{value}", { value: s.def }) },
      s.spd && { text: t("移速：{value}", { value: s.spd }) },
      s.exp && { text: t("经验值：{value}", { value: s.exp }) },
    ].filter(Boolean);
    // 掉落物按信息框顺序：说明文字（“战斗技能达到5级之后:”）只管它后面的物品。
    const drops = el("div", { class: "drop-list", dataset: { spoilerScoped: "true" } });
    const note = n => n && S.textAllowed(n, title) ? el("span", { class: "hint" }, " " + n) : "";
    // “见下文中的表格”“See tables”指条目里的变种表：有条目全文时展开页尾的全文，否则链接到原文。
    const TABLE_REF = /表格|见变种|\btables?\b/i, url = wikiUrl(title), full = articleKey(title);
    const openFull = () => {
      const fold = dbody.querySelector(".art-fold");
      if (fold && !fold.querySelector(".art-section, .article")) fold.querySelector("button")?.click();
      fold?.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    let chips = null;
    for (const d of info.dr) {
      if (d.t && TABLE_REF.test(d.t) && (full || url)) {
        chips = null;
        drops.append(full ? el("p", null, btn(t("查看各变种的特殊掉落"), openFull))
          : el("p", { class: "d-sub" }, el("a", { href: url, target: "_blank", rel: "noopener" }, t("各变种的特殊掉落见原 Wiki 的表格 ↗"))));
        continue;
      }
      if (d.t) { chips = null; drops.append(protectContent(el("p", { class: "d-sub" }, d.t))); continue; }
      if (!chips) drops.append(chips = el("div", { class: "chips" }));
      const chip = d.id ? itemChip(d.id) : el("span", { class: "chip static" }, EN ? d.e : d.z);
      chip.append(note(d.n));
      chips.append(chip);
    }
    // 信息框模板给每种有掉落物的怪物都附上这两项（钻石、五彩碎片）。
    if (info.dr.length) drops.append(el("p", { class: "d-sub" }, t("如果到达过矿井底部：")),
      el("div", { class: "chips" }, ["(O)72", "(O)74"].map(id => { const chip = itemChip(id); chip.append(note("0.05%")); return chip; })));
    const places = (m.L || []).filter(name => D.pages[name] || App.locationByName.has(name)).map(name => pageLink(name));
    const placeText = info.lt && !info.lt.split(EN ? /\s*(?:[;,&]|\band\b)\s*/ : /[、；]/).filter(Boolean)
      .every(part => places.some(p => p.label === part.trim())) ? info.lt : null;
    const variants = m.vr?.length && m.vr.every(v => App.monsterByName.has(v)) ? m.vr.map(v => pageLink(v)) : null;
    fillDetail(
      ...monsterHead(title),
      stats.length ? section(t("属性"), checkList(stats)) : null,
      info.lt || places.length ? section(t("出没地点"), placeText ? el("p", null, placeText) : null,
        places.length ? linkGroup(places, t("相关地点")) : null,
        info.lv ? el("p", { class: "d-sub" }, t("层数：{value}", { value: !TABLE_REF.test(info.lv) ? info.lv : full ? t("各变种不同，见页尾的条目全文") : t("各变种不同，见原 Wiki 的表格") })) : null) : null,
      info.dr.length ? section(t("掉落物"), drops) : null,
      variants ? section(t("变种"), linkGroup(variants, t("变种怪物"))) : info.vr.length ? section(t("变种"), el("p", null, App.list(info.vr))) : null,
      actions(pins.length ? btn(t("在地图上查看"), () => showOnMap(null, { type: "page", id: title })) : null, planBtn({ type: "page", id: title })),
      articleFold(title), sourceLine(title));
  }

  // 动物：居住建筑、产物，以及玛妮的牧场商品表里的购买途径（营业与休息日同物品）。
  function renderAnimal(title) {
    const a = App.animalByName.get(title), page = App.pageInfo(title) || {};
    const paths = App.acquisitions(null, title);
    const homes = (a.h || []).map(h => {
      const node = [...P().nodes.values()].find(n => n.title === h.z);
      return node ? { ref: { type: "node", id: node.id }, label: nodeName(node), icon: node.icon } : { ...pageLink(h.pg), label: N(h.z) };
    });
    const produce = (a.pr || []).map(x => {
      if (typeof x === "string") return itemChip(x);
      const label = EN ? x.e : x.z, ref = x.pg && D.pages[x.pg] ? titleRef(x.pg) : null;
      if (ref && !S.canView(ref)) return btn(t("后续物品 · 按需查看"), () => App.select(ref));
      return ref ? linkChip({ ref, label, icon: x.i }) : el("span", { class: "chip static" }, img(x.i), label);
    });
    fillDetail(
      ...animalHead(title),
      homes.length || produce.length ? section(t("饲养"),
        homes.length ? [el("p", { class: "d-sub" }, t("居住建筑")), linkGroup(homes, t("需要的建筑"))] : null,
        produce.length ? [el("p", { class: "d-sub" }, t("产物")), el("div", { class: "chips", dataset: { spoilerScoped: "true" } }, produce)] : null) : null,
      paths.length ? section(pathsTitle(paths), renderPaths(paths))
        : page.ob?.length ? section(t("获取途径"), sourceGroups([["source", page.ob]])) : null,
      actions(planBtn({ type: "page", id: title })),
      articleFold(title), sourceLine(title));
  }

  function renderPage(title) {
    const raw = D.pages[title];
    if (!raw) return renderItem(title);
    if (App.monsterByName.has(title)) return renderMonster(title);
    if (App.animalByName.has(title)) return renderAnimal(title);
    const p = { ...App.pageInfo(title), i: raw.i, e: raw.e };
    const pins = D.pins.filter((x) => x.t === title);
    const heading = pageHeading(title);
    const guide = App.guides?.has(title);
    // 有正文的条目直接显示正文（信息框写在最前）；简明指南另有整理好的内容，正文放在页尾按需展开。
    const inline = !guide && articleKey(title);
    fillDetail(
      heading,
      guide ? App.guides.render(title) : null,
      inline ? articleInline(title, p.s) : null,
      p.s && !guide && !inline ? el("p", { class: "d-summary" }, p.s) : null,
      !inline && Object.keys(p.f).length ? section(t("要点"), el("dl", { class: "kv" }, Object.entries(p.f).slice(0, 8).flatMap(([k, v]) => [el("dt", null, FIELD_ZH[k] || k), el("dd", null, v)]))) : null,
      !inline && p.sec.length && !guide ? (S.active() ? foldContent(section(t("条目章节"), el("p", { class: "d-sub" }, App.list(p.sec))), t("完整章节可能包含事件、秘密或后续奖励"), t("查看完整章节目录")) : section(t("条目章节"), el("p", { class: "d-sub" }, App.list(p.sec)))) : null,
      actions(pins.length ? btn(t("在地图上查看"), () => showOnMap(null, { type: "page", id: title })) : null, planBtn({ type: "page", id: title })),
      guide ? articleFold(title) : null,
      sourceLine(title));
  }
  const FIELD_ZH = Object.fromEntries(Object.entries({ source: "来源", season: "季节", location: "地点", time: "时间", weather: "天气", recipe: "配方", ingredients: "材料", sellprice: "售价",
    openhours: "营业时间", closed: "休息", address: "地址", occupants: "居民", birthday: "生日", marriage: "可结婚", growth: "生长", produces: "产出",
    craftingstation: "加工设备", crafttime: "耗时", buff: "增益", edibility: "能量" }).map(([k, v]) => [k, t(v)]));

  function renderNode(id) {
    const n = P().nodes.get(id);
    const st = P().status(id);
    const steps = (App.conditionsActive() ? P().stepsTo(id) : [...P().ancestors(id)]).filter((x) => x !== id);
    const kids = [...(P().children.get(id) || [])].map((x) => P().nodes.get(x));
    const acquisition = n.itemId ? App.acquisitions(n.itemId, App.itemInfo(n.itemId)?.z) : [];
    const craft = acquisition.find(p => p.inputs?.length);
    const mats = n.materials?.length ? App.materialTree(n.materials.map((m) => ({ id: m.id, z: m.zh, q: m.qty }))) : craft ? App.materialTree(craft.inputs) : null;
    const markable = n.state && typeof n.state === "object" && n.state.type !== "date";
    const pathsBox = el("div");
    st.paths.forEach((p, i) => {
      if (!p.checks.length) return;
      if (i) pathsBox.append(el("div", { class: "or" }, t("或")));
      pathsBox.append(el("div", { class: "path" + (App.conditionsActive() && p.ok === true ? " is-ok" : "") },
        el("div", { class: "path-head" }, el("span", { class: "path-name" }, p.label || t("前置条件")), stateChip(p.ok, [t("已满足"), t("未满足"), t("未确认")])),
        checkList(p.checks)));
    });
    fillDetail(
      ...nodeHead(id),
      n.info?.action || mats ? section(t("怎么做"), n.info?.action ? el("p", null, n.info.action) : null, mats ? matTree(mats) : null) : null,
      pathsBox.childNodes.length ? section(t("需要先满足"), pathsBox) : null,
      steps.length ? section(App.conditionsActive() ? t("待对照的 {n} 个前置", { n: steps.length }) : t("关联前置路线"), el("ol", { class: "steps" }, steps.map((sid) => {
        const s = P().nodes.get(sid);
        return el("li", null, el("button", { type: "button", onclick: () => App.select({ type: "node", id: sid }) }, nodeName(s), el("span", { class: "hint" }, s.sub || "")));
      }))) : null,
      n.unlocks.length || kids.length ? section(t("完成后解锁"), el("div", { class: "chips" },
        n.unlocks.map((u) => u.text ? el("span", { class: "chip static" }, u.z) : u.pg ? el("button", { class: "chip", type: "button", onclick: () => App.select({ type: "page", id: u.pg }) }, img(u.i), N(u.z)) : itemChip(u.id || u.z)),
        kids.filter((k) => k.kind !== "skill" || k.row !== n.row).map((k) => el("button", { class: "chip", type: "button", onclick: () => App.select({ type: "node", id: k.id }) }, img(k.icon), nodeName(k))))) : null,
      n.info?.note ? el("p", { class: "quote" }, n.info.note) : null,
      n.info?.quote ? el("p", { class: "quote" }, t("“{quote}”", { quote: n.info.quote })) : null,
      actions(
        n.itemId ? btn(t("查看完整获取方式与用途"), () => App.select({ type: "item", id: n.itemId })) : null,
        markable && App.conditionsActive() ? btn(st.status === "done" ? t("标记为未完成") : t("标记为已完成"), () => markNode(n, st.status !== "done")) : null,
        n.place ? btn(t("在地图上找到{place}", { place: N(n.place) }), () => showOnMap(n.place)) : null,
        planBtn({ type: "node", id })),
      n.info?.source ? [articleFold(n.info.source), sourceLine(n.info.source)] : null);
  }

  function renderBundle(id) {
    const { room, bundle } = App.browse.bundle(id);
    const requirements = App.collections ? App.collections.renderRequirements(room, bundle) : el("div", { class: "bundle-requirements" });
    for (const item of App.collections ? [] : bundle.items) {
      const target = item.id ? itemChip(item.id, item.qty) : el("span", { class: "chip static" }, safeText(N(item.zh)), App.qtyText(item.qty));
      requirements.append(el("div", { class: "bundle-requirement" }, target,
        item.note ? el("span", { class: "d-sub" }, safeText(item.note)) : null,
        item.source_text ? protectContent(el("p", { class: "d-sub" }, item.source_text)) : null));
    }
    const reward = section(t("完成奖励"), el("div", { class: "chips" }, (bundle.reward || []).map(item => itemChip(item.id || item.zh, item.qty))));
    fillDetail(head("Bundle_Green.png", N(bundle.name), N(room.room)),
      el("p", { class: "d-summary" }, bundle.cost ? t("交付 {cost}。", { cost: money(bundle.cost) }) : bundle.choose ? t("从 {total} 项中任选 {n} 项交付。", { total: bundle.items.length, n: bundle.slots }) : t("交付下列 {n} 项要求的物品。", { n: bundle.slots || bundle.items.length })),
      bundle.items.length || bundle.cost ? section(t("所需材料与数量"), requirements) : null,
      bundle.reward?.length ? (S.active() ? foldContent(reward, t("完成奖励按需查看"), t("查看完成奖励")) : reward) : null,
      actions(btn(t("查看房间路线"), () => App.select({ type: "node", id: "room:" + room.room }, { switchView: true }))), articleFold("收集包"), sourceLine("收集包"));
  }

  function markNode(n, done) {
    const s = n.state;
    const before = new Set([...P().nodes.keys()].filter((id) => P().status(id).status === "done"));
    App.setProgress((pr) => {
      switch (s.type) {
        case "skill": pr.skills[s.skill] = done ? s.level : s.level - 1; break;
        case "tool": pr.tools[s.family] = done ? s.tier : s.tier - 1; break;
        case "rod": pr.rod = done ? s.tier : s.tier - 1; break;
        case "building": pr.buildings[s.chain] = done ? s.tier : s.tier - 1; break;
        case "room": pr.rooms = (pr.rooms || []).filter((r) => r !== s.room).concat(done ? [s.room] : []); break;
        case "museum": pr.museum = done ? Math.max(pr.museum || 0, s.count) : s.count - 1; break;
        case "mine_depth": pr.mineDepth = done ? Math.max(pr.mineDepth || 0, s.depth) : s.depth - 1; break;
        case "flag": pr.flags[s.flag] = done; break;
        case "owned": pr.owned[s.id] = done; break;
      }
    }, n.id);
    const after = [...P().nodes.keys()].filter((id) => P().status(id).status === "done" && !before.has(id) && id !== n.id);
    const opened = after.map((id) => P().nodes.get(id)).filter((x) => x.kind === "area");
    if (done) App.toast(opened.length && !S.active() ? t("{name} 完成，{places} 已开放", { name: nodeName(n), places: App.list(opened.map(nodeName)) }) : t("{name} 已标记完成", { name: nodeName(n) }));
  }

  // 关系图：从关系图一路点过来的条目记成路径（graphTrail），点前面的可以退回去。
  let graphTrail = [];
  function renderGraph(ref) {
    const title = articleOf(ref);
    const graph = App.graph.render(ref, { title: S.title(ref), trail: graphTrail, refName, pick: r => App.select(r, { from: "graph" }) });
    fillDetail(...entryHead(ref), viewSwitch(), graph, actions(planBtn(ref)), title ? [articleFold(title), sourceLine(title)] : null);
  }
  // 列表与关系图：选择会记住，之后打开的条目沿用。
  function viewSwitch() {
    const pick = graph => () => {
      if (!!state.graph === graph) return;
      state.graph = graph;
      graphTrail = current ? [current] : [];
      App.emit("graph");
      writeHash();
      dbody.querySelector(`.view-switch button[aria-pressed="true"]`)?.focus();
    };
    return el("div", { class: "view-switch", role: "group", "aria-label": t("查看方式") },
      el("button", { type: "button", "aria-pressed": String(!state.graph), onclick: pick(false) }, t("列表")),
      el("button", { type: "button", "aria-pressed": String(!!state.graph), onclick: pick(true) }, t("关系图")));
  }

  function renderDetail() {
    const ref = current;
    if (!ref) { detail.hidden = true; updateDetailPresentation(); updateInsets(); return; }
    const scroll = detail.scrollTop;
    if (ref.type === "point") renderPointList(ref);
    else if (ref.type === "find") renderFind(ref.id);
    else if (!S.canView(ref)) {
      dbody.replaceChildren(head(null, t("尚未确认探索的内容"), t("防剧透已开启"), null, true),
        el("p", { class: "d-summary" }, t("此条目可能涉及你尚未到达的游戏内容。可以只查看这一条，关联的后续内容仍会收起。")),
        actions(btn(t("仅查看此条（可能剧透）"), () => S.reveal(ref), true), btn(t("我已了解此内容"), () => S.reveal(ref, true))),
        el("p", { class: "d-sub" }, t("“仅查看”在本次浏览有效；“已了解”会保存在这台设备，不修改游戏完成进度。")));
    }
    else if (state.graph && App.graph.supports(ref)) renderGraph(ref);
    else if (ref.type === "fish") renderFish(App.fishByName.get(ref.id));
    else if (ref.type === "location") renderLocation(ref.id);
    else if (ref.type === "villager") renderVillager(ref.id);
    else if (ref.type === "item") renderItem(ref.id);
    else if (ref.type === "node") renderNode(ref.id);
    else if (ref.type === "bundle") renderBundle(ref.id);
    else if (ref.type === "area") P().nodes.has("area:" + ref.id) ? renderNode("area:" + ref.id) : renderLocation(App.AREAS[ref.id].title);
    else renderPage(ref.id);
    // 能画关系图的条目，在抬头（和摘要）下面放“列表 / 关系图”切换。
    if (!state.graph && !["point", "find"].includes(ref.type) && S.canView(ref) && App.graph.supports(ref)) {
      (dbody.querySelector(":scope > .d-head + .d-summary") || dbody.querySelector(":scope > .d-head"))?.after(viewSwitch());
    }
    if (pointReturn && ref.type !== "point") {
      dbody.prepend(btn(t("← 返回地点列表"), returnToPoints));
    }
    detail.hidden = false;
    updateDetailPresentation();
    detail.scrollTop = scroll;
    updateInsets();
  }

  // ———————————————————— 选择与视图 ————————————————————
  // 鱼也是物品：从材料、礼物或收集包点进来时，打开鱼的详情（水域、时段与天气），而不是通用物品页。
  const fishByItem = new Map(D.fish.filter(f => f.id).map(f => [f.id, f.p]));
  const canonicalRef = ref => ref?.type === "item" && fishByItem.has(App.canonicalItemId(ref.id)) ? { type: "fish", id: fishByItem.get(App.canonicalItemId(ref.id)) } : ref;
  App.select = (ref, opts = {}) => {
    ref = canonicalRef(ref);
    const same = ref && current && ref.type === current.type && ref.id === current.id;
    // 关系图路径：从关系图点过来的接在后面，退回到路径里已有的条目时截断，从别处打开时重新开始。
    if (ref && !same) {
      const at = graphTrail.findIndex(r => r.type === ref.type && r.id === ref.id);
      graphTrail = at >= 0 && ["graph", "hash"].includes(opts.from) ? graphTrail.slice(0, at + 1) : opts.from === "graph" ? [...graphTrail, ref].slice(-8) : [ref];
    }
    if (ref && detail.hidden) detailReturnFocus = document.activeElement;
    if (ref) detailMode = "reading";
    current = ref;
    if (!same) detail.scrollTop = 0;
    if (!ref || ["map", "search", "journal", "browse", "hash", "find"].includes(opts.from)) pointReturn = null;
    if (ref?.type === "point") {
      setView("map", { preserveDetail: true }); App.map.select(null); App.map.setRelated([]); App.tree.select(null);
      renderDetail(); if (!same) focusDetailTitle(); writeHash(); return;
    }
    if (ref && !S.canView(ref)) {
      App.map.select(null); App.map.setRelated([]); App.tree.select(null);
      renderDetail(); if (!same) focusDetailTitle(); writeHash(); return;
    }
    if (ref && ref.type === "node" && opts.switchView) setView("tree");
    App.map.select(ref);
    App.tree.select(ref && ref.type === "node" ? ref.id : ref && ref.type === "area" && P().nodes.has("area:" + ref.id) ? "area:" + ref.id : null);
    // 地图联动：高亮相关地点
    let rel = [];
    if (ref?.type === "node") {
      const n = P().nodes.get(ref.id);
      rel = [n.place, ...[...P().ancestors(ref.id)].map((x) => P().nodes.get(x)).filter((x) => P().status(x.id).status !== "done").map((x) => x.place)].filter(Boolean);
    } else if (ref?.type === "item") {
      rel = App.acquisitions(ref.id, App.itemInfo(ref.id)?.z).map((p) => p.where).filter(Boolean);
    }
    App.map.setRelated([...new Set(rel)].filter(name => visible("location", name)));
    renderDetail();
    if (state.view === "map" && ref && !["map", "point-list"].includes(opts.from) && !same) {
      if (ref.type === "fish") focusFish(App.fishByName.get(ref.id));
      else if (ref.type === "location") App.map.focusPlace(ref.id);
      else if (ref.type === "villager") focusPins(ref, App.mapContents.homePins(App.villagerByName.get(ref.id)));
      else if (ref.type === "area") App.map.focusPlace(App.AREAS[ref.id].title);
      else if (ref.type === "page") focusPins(ref, D.pins.filter(p => p.t === ref.id).map(p => [p.x, p.y, p.map]));
    }
    if (state.view === "tree" && ref && (ref.type === "node" || ref.type === "area")) {
      const id = ref.type === "area" ? "area:" + ref.id : ref.id;
      if (P().nodes.has(id) && opts.from !== "tree-click") App.tree.focusNode(id, { offsetX: detailMode === "context" && !detail.hidden ? 190 : 0 });
    }
    renderJournal();
    writeHash();
    if (ref && !same) focusDetailTitle();
    else if (!ref && detailReturnFocus) {
      const target = detailReturnFocus.isConnected && detailReturnFocus.getClientRects().length ? detailReturnFocus : $("tab-" + state.view);
      target?.focus({ preventScroll: true }); detailReturnFocus = null;
    }
  };
  function returnToPoints() {
    const back = pointReturn;
    if (!back) return;
    pointReturn = null;
    App.select(back.ref, { from: "point-return" });
    detail.scrollTop = back.scroll;
    const button = [...dbody.querySelectorAll("[data-entry]")].find(b => b.dataset.entry === back.key);
    button?.focus({ preventScroll: true });
  }
  App.openMapPlaces = ids => {
    const ref = { type: "point", id: [...new Set(ids)].sort().join(";") };
    App.select(ref, { from: "map" });
    const heading = $("detail-title"); heading?.setAttribute("tabindex", "-1"); heading?.focus({ preventScroll: true });
  };
  function renderPointList(ref) {
    const points = [...new Map(ref.id.split(";").map(id => App.mapContents.find(id)).filter(Boolean).map(p => [p.id, p])).values()];
    const entries = points.flatMap(p => p.entries);
    const filter = pointStates.get(ref.id) || { kind: "all", query: "", now: false };
    pointStates.set(ref.id, filter);
    const title = points.length === 1 ? points[0].title : t("附近 {n} 个地点", { n: points.length });
    const tabs = el("div", { class: "point-tabs", role: "group", "aria-label": t("地点内容类型") });
    const input = el("input", { type: "search", class: "point-search", placeholder: t("在此地点查找"), "aria-label": t("筛选地点内容"), value: filter.query });
    const check = el("input", { type: "checkbox", checked: filter.now });
    const nowLabel = el("label", { class: "check point-now" }, check, t("只看符合当前条件的鱼"));
    const count = el("p", { class: "d-sub", role: "status" });
    const results = el("div", { class: "point-results" });
    const kinds = [["all", t("全部")], ["fish", t("鱼类")], ["location", t("地点")], ["villager", t("居民")], ["other", t("其他")]];
    const paint = () => {
      for (const b of tabs.children) b.setAttribute("aria-pressed", String(b.dataset.kind === filter.kind));
      nowLabel.hidden = !App.conditionsActive() || !entries.some(e => e.kind === "fish") || !["all", "fish"].includes(filter.kind);
      results.replaceChildren(); let total = 0;
      for (const point of points) {
        const found = point.entries.filter(e => (filter.kind === "all" || e.kind === filter.kind)
          && (!App.conditionsActive() || !filter.now || !["all", "fish"].includes(filter.kind) || (e.kind === "fish" && e.status === true))
          && e.label.toLowerCase().includes(filter.query.trim().toLowerCase()));
        total += found.length;
        if (!found.length) continue;
        const rows = el("div", { class: "point-rows" });
        for (const entry of found) {
          const tail = entry.kind === "fish" ? !App.conditionsActive() ? t("查看条件") : entry.status === true ? t("条件符合") : entry.status === false ? t("条件不符") : t("待确认") : entry.kind === "villager" ? t("住处") : t("查看");
          const b = row({ icon: entry.icon, name: entry.label, sub: entry.subtitle, tail, tailClass: entry.status === true ? "good" : "" });
          b.dataset.entry = point.id + "/" + entry.key;
          if (entry.concealed) b.replaceChild(protectedImage(), b.firstChild);
          b.addEventListener("click", () => {
            pointReturn = { ref, pointId: point.id, scroll: detail.scrollTop, key: b.dataset.entry };
            App.select(entry.ref, { from: "point-list" }); detail.scrollTop = 0;
          });
          rows.append(b);
        }
        const locate = btn(t("定位"), () => { setDetailMode("context"); App.map.locatePoint(point.id); });
        locate.setAttribute("aria-label", t("在地图上定位{place}", { place: point.title }));
        const heading = el("div", { class: "point-heading" }, el("h3", null, point.title), locate);
        results.append(el("section", { class: "d-section" }, heading,
          el("p", { class: "d-sub" }, App.mapContents.positionNote(point)), rows));
      }
      count.textContent = t("{n} 条可查看资料", { n: total });
      if (!total) results.append(el("p", { class: "empty-note" }, t("当前筛选没有结果。")), btn(t("显示全部已知内容"), () => { filter.query = ""; filter.now = false; filter.kind = "all"; input.value = ""; check.checked = false; paint(); }));
    };
    for (const [kind, label] of kinds) {
      if (kind !== "all" && !entries.some(e => e.kind === kind)) continue;
      tabs.append(el("button", { type: "button", class: "btn", dataset: { kind }, onclick: () => { filter.kind = kind; paint(); } }, label));
    }
    input.addEventListener("input", () => { filter.query = input.value; paint(); });
    check.addEventListener("change", () => { filter.now = check.checked; paint(); });
    dbody.replaceChildren(head(entries.some(e => e.kind === "fish") ? "Fishing_Skill_Icon.png" : "Maplocation.png", points.length ? title : t("此地点暂无可展示内容"), t("按地点查看资料，选择条目了解详情")),
      el("div", { class: "point-controls" }, tabs, input, nowLabel), count, results,
      el("p", { class: "d-sub" }, t("小点表示地点，数字“处”表示附近地点的合并入口。居民标记表示住处，不代表此刻位置。")));
    paint();
  }
  function focusPins(ref, pins) {
    const available = pins.filter(p => S.mapPoint(ref, p));
    const source = pointReturn?.pointId && App.mapContents.find(pointReturn.pointId);
    const origin = source && available.find(p => p[0] === source.x && p[1] === source.y && p[2] === source.map);
    const pin = origin || available.find(p => p[2] === App.map.mapKey) || available[0];
    return !!pin && App.map.focusPin(ref, pin);
  }
  function focusFish(f) {
    return !!f && focusPins({ type: "fish", id: f.p }, f.pins);
  }
  function showOnMap(place, ref) {
    setView("map");
    if (ref) {
      current = ref;
      App.map.select(ref);
      renderDetail();
      const located = ref.type === "fish" ? focusFish(App.fishByName.get(ref.id))
        : ref.type === "villager" ? focusPins(ref, App.mapContents.homePins(App.villagerByName.get(ref.id)))
        : ref.type === "page" ? focusPins(ref, D.pins.filter(p => p.t === ref.id).map(p => [p.x, p.y, p.map])) : false;
      if (!located) App.toast(t("当前展示范围内没有可定位的地点。"));
      return;
    }
    App.map.setRelated([place]);
    if (!App.map.focusPlace(place)) App.toast(t("当前展示范围内没有可定位的地点。"));
  }

  function setView(v, { preserveDetail = false } = {}) {
    if (current && !preserveDetail && !readingHash) detailMode = v === "browse" ? "reading" : "context";
    if (state.view === v) { updateDetailPresentation(); updateInsets(); return; }
    state.view = v;
    document.getElementById("app").dataset.view = v;
    $("tree").hidden = v !== "tree";
    $("browse").hidden = v !== "browse";
    $("map-keyboard").hidden = v !== "map";
    $("map-tools").hidden = v !== "map";
    $("tree-tools").hidden = v !== "tree";
    updateDetailPresentation();
    for (const b of document.querySelectorAll(".hotbar-views button")) b.setAttribute("aria-selected", String(b.dataset.view === v));
    if (v === "tree") {
      if (!App.tree.built) App.tree.build();
      App.tree.refresh();
      if (current?.type === "node") App.tree.focusNode(current.id, { offsetX: 190 });
    } else if (v === "browse") App.browse.render();
    else App.map.redraw();
    renderJournal();
    updateInsets();
    writeHash();
  }
  App.setView = setView;
  App.openBrowse = (id, filters) => {
    const restoring = readingHash;
    readingHash = true;
    try {
      App.select(null);
      setView("browse"); App.browse.open(id, filters); renderJournal(); updateInsets();
    } finally { readingHash = restoring; writeHash(); }
  };

  function updateInsets() {
    positionConditions();
    const docked = !detail.hidden && detailMode === "context";
    detail.style.removeProperty("top"); detail.style.removeProperty("max-height");
    if (window.innerWidth <= 760) {
      detail.style.removeProperty("top"); detail.style.removeProperty("max-height");
      $("browse").style.removeProperty("right"); $("browse").style.removeProperty("top");
      $("map-tools").style.removeProperty("left"); $("map-tools").style.removeProperty("max-width");
      const top = Math.max(document.querySelector(".clock").getBoundingClientRect().bottom,
        $("map-tools").hidden ? 0 : $("map-tools").getBoundingClientRect().bottom) + 12;
      const bottom = Math.max(top + 64, Math.min($("journal").getBoundingClientRect().top,
        docked ? detail.getBoundingClientRect().top : window.innerHeight - 72) - 12);
      // The badge extends above its anchor; centre both in the free map area.
      App.mapInsetX = 0; App.mapInsetY = (top + bottom) / 2 + 14 - window.innerHeight / 2;
      App.treeInsetLeft = 0; App.mapFreeW = window.innerWidth;
      App.mapPad = { left: 0, right: 0, top, bottom: window.innerHeight - bottom }; return;
    }
    const j = $("journal").getBoundingClientRect();
    App.treeInsetLeft = j.right;
    const clockBottom = document.querySelector(".clock").getBoundingClientRect().bottom;
    detail.style.setProperty("--detail-context-top", clockBottom + 10 + "px");
    $("browse").style.top = `${Math.max(100, clockBottom + 12)}px`;
    $("browse").style.right = "16px";
    const left = j.right + 8;
    const right = docked ? detail.getBoundingClientRect().left - 8 : window.innerWidth;
    App.mapInsetX = (left + right) / 2 - window.innerWidth / 2;
    App.mapInsetY = 0;
    App.mapFreeW = right - left;
    $("map-tools").style.left = `${left}px`;
    $("map-tools").style.maxWidth = `${Math.max(154, right - left)}px`;
    App.mapPad = { left, right: window.innerWidth - right, bottom: 96 };
  }

  // ———————————————————— 计划栏 ————————————————————
  function refIcon(ref) {
    if (!S.canView(ref)) return null;
    if (ref.type === "node") { const n = P().nodes.get(ref.id); return n?.icon || App.itemInfo(n?.itemId)?.i; }
    if (ref.type === "fish") return App.fishByName.get(ref.id)?.i;
    if (ref.type === "villager") return App.villagerByName.get(ref.id)?.i;
    if (ref.type === "item") return App.itemInfo(ref.id)?.i;
    if (ref.type === "location") return occupantIcon(App.locationByName.get(ref.id)) || D.pages[ref.id]?.i;
    return D.pages[ref.id]?.i || App.monsterByName.get(ref.id)?.i || App.animalByName.get(ref.id)?.i;
  }
  function refName(ref) {
    if (!S.canView(ref)) return t("受保护的条目");
    if (ref.type === "node") return nodeName(P().nodes.get(ref.id));
    if (ref.type === "item") return App.itemName(App.itemInfo(ref.id));
    if (ref.type === "bundle") return N(ref.id.split(":").slice(1).join(":"));
    if (ref.type === "area") return App.areaTitle(ref.id);
    return N(ref.id);
  }
  function refDone(ref) {
    if (!S.canView(ref)) return null;
    if (ref.type === "node") { const s = P().status(ref.id).status; return s === "done" ? "ok" : s === "ready" ? "next" : null; }
    if (ref.type === "fish") return App.fishCheck(App.fishByName.get(ref.id)).ok === true ? "now" : null;
    if (ref.type === "item") return state.progress.owned?.[ref.id] ? "ok" : null;
    return null;
  }
  function togglePlan(ref) {
    const i = state.plan.findIndex((p) => p.type === ref.type && p.id === ref.id);
    if (i >= 0) { state.plan.splice(i, 1); App.toast(t("已取消收藏")); }
    else if (state.plan.length >= 8) { App.toast(t("快捷收藏最多 8 个条目，先移出一个")); return; }
    else { state.plan.push({ type: ref.type, id: ref.id }); App.toast(t("已收藏：{name}", { name: refName(ref) })); }
    App.emit("plan");
  }
  function renderPlan() {
    const ol = $("plan-slots");
    ol.replaceChildren();
    ol.hidden = state.plan.length === 0;
    for (let i = 0; i < state.plan.length; i++) {
      const ref = state.plan[i];
      const mark = App.conditionsActive() ? refDone(ref) : null;
      const b = el("button", { class: "slot", type: "button", title: refName(ref), "aria-label": `${refName(ref)}${mark === "ok" ? t("（已完成）") : mark === "next" ? t("（下一步）") : mark === "now" ? t("（现在能钓）") : ""}` },
        img(refIcon(ref)), mark ? el("span", { class: "slot-state" + (mark === "ok" ? " ok" : "") }, { ok: "✓", next: "★", now: t("鱼") }[mark]) : null);
      b.addEventListener("click", () => App.select(ref, { from: "search", switchView: ref.type === "node" }));
      ol.append(el("li", null, b));
    }
  }

  // ———————————————————— 进度对话框 ————————————————————
  function levels(values, current, onPick, opts = {}) {
    const box = el("div", { class: "levels" });
    if (opts.unknown !== false) box.append(el("button", { type: "button", class: "unk", "aria-pressed": String(current == null), onclick: () => onPick(null) }, "?"));
    values.forEach(([v, label, icon]) => box.append(el("button", { type: "button", "aria-pressed": String(current === v), title: typeof label === "string" ? label : null, onclick: () => onPick(v) }, icon ? img(icon, null, label) : label)));
    return box;
  }
  function knownLevels(values, current, onPick, allowed, title) {
    const shown = values.filter(allowed);
    const box = el("div", { class: "known-levels" }, levels(shown, current, onPick));
    if (shown.length !== values.length) {
      const disclosure = el("details", { class: "known-level-disclosure" }, el("summary", null, t("直接填写已有档位")));
      disclosure.addEventListener("toggle", () => {
        if (disclosure.open && !disclosure.querySelector(".levels")) disclosure.append(
          el("p", { class: "d-sub" }, t("只展开{title}的档位供你填写，不会展开其他资料。", { title })), levels(values, current, onPick));
        else if (!disclosure.open) for (const child of [...disclosure.children].slice(1)) child.remove();
      });
      box.append(disclosure);
    }
    return box;
  }
  function renderProgress() {
    const pr = state.progress;
    const presetBox = $("presets");
    presetBox.replaceChildren(...Object.entries(App.PRESETS).filter(([k]) => !S.active() || ["fresh", "unknown"].includes(k)).map(([k, p]) => btn(p.label, () => { App.applyPreset(k); renderProgress(); }, state.preset === k)));
    $("progress-note").textContent = (S.active() ? t("只填写你已了解的进度，也可以全部留空。可进入某地不代表已经探索。") : (App.PRESETS[state.preset]?.note || t("自定义进度。"))) + " " + t("设置只保存在这台设备。");
    const body = $("progress-body");
    const set = (fn) => { App.setProgress(fn); renderProgress(); };
    const skills = el("div", { class: "p-grid" });
    for (const s of App.SKILLS) skills.append(el("span", null, img(s.icon), s.name), levels([...Array(11).keys()].map((v) => [v, String(v)]), pr.skills[s.id], (v) => set((p) => { p.skills[s.id] = v; })));
    const tools = el("div", { class: "p-grid" });
    for (const ch of D.chains.filter((c) => c.kind === "blacksmith_upgrade")) {
      const family = P().lanes.find(l => l.id === "tools").rows.find(r => r.id === "tool:" + ch.family)?.name || ch.family;
      tools.append(el("span", null, family), knownLevels(ch.tiers.map((tier, i) => [i, nameOf(tier.id || tier.zh), tier.image]), pr.tools[ch.family],
        v => set(p => { p.tools[ch.family] = v; }), ([i]) => S.node(`tool:${ch.family}:${i}`), family));
    }
    tools.append(el("span", null, t("鱼竿（最高）")), knownLevels([[-1, t("没有")], ...App.ROD_CHAIN.tiers.map((tier, i) => [i, nameOf(tier.id || tier.zh), tier.image])], pr.rod,
      v => set(p => { p.rod = v; }), ([i]) => i === -1 || S.node(`rod:${i}`), t("鱼竿")));
    const blds = el("div", { class: "p-grid" });
    for (const ch of App.BUILDING_CHAINS) {
      const opts = ch.tiers.map((b, i) => [i, nodeName(P().nodes.get(`bld:${ch.chain}:${i}`)), null]);
      const chainName = EN ? EN.buildings?.[ch.chain]?.name || N(ch.chain) : ch.chain;
      blds.append(el("span", null, chainName), knownLevels(ch.chain === "农舍" ? opts : [[-1, t("没有")], ...opts], pr.buildings[ch.chain],
        v => set(p => { p.buildings[ch.chain] = v; }), ([i]) => i === -1 || S.node(`bld:${ch.chain}:${i}`), chainName));
    }
    const rooms = el("div", { class: "rooms" });
    rooms.append(el("label", null, el("input", { type: "checkbox", checked: pr.rooms == null, onchange: (e) => set((p) => { p.rooms = e.target.checked ? null : []; }) }), t("未确认")));
    for (const r of App.ROOMS) {
      rooms.append(el("label", null, el("input", { type: "checkbox", disabled: pr.rooms == null, checked: !!pr.rooms?.includes(r), onchange: (e) => set((p) => { p.rooms = (p.rooms || []).filter((x) => x !== r).concat(e.target.checked ? [r] : []); }) }), N(r)));
    }
    const num = (label, key, max, unit) => {
      const out = el("output", null, pr[key] == null ? t("未确认") : t(unit, { n: pr[key] }));
      const input = el("input", { type: "range", min: 0, max, value: pr[key] ?? 0, "aria-label": label });
      input.addEventListener("input", () => { state.progress[key] = +input.value; out.textContent = t(unit, { n: input.value }); });
      input.addEventListener("change", () => set((p) => { p[key] = +input.value; }));
      return el("div", { class: "num-row" }, input, out, btn(t("未确认"), () => set((p) => { p[key] = null; })));
    };
    const world = el("div", { class: "p-grid" },
      el("span", null, t("博物馆捐赠")), num(t("博物馆捐赠"), "museum", 95, "{n} 件"),
      el("span", null, img("Mining_Skill_Icon.png"), t("矿井最深")), num(t("矿井最深"), "mineDepth", 120, "{n} 层"));
    if (S.node("boat")) world.append(el("span", null, nodeName(P().nodes.get("boat"))), levels([[false, t("没修")], [true, t("已修好")]], pr.flags.boat_repaired, (v) => set((p) => { p.flags.boat_repaired = v; })));
    body.replaceChildren(
      el("section", { class: "p-section" }, el("h3", null, t("技能等级")), skills),
      el("section", { class: "p-section" }, el("h3", null, t("工具")), tools),
      el("section", { class: "p-section" }, el("h3", null, t("农场建筑")), blds),
      el("section", { class: "p-section" }, el("h3", null, t("社区中心（已完成的房间）")), rooms),
      el("section", { class: "p-section" }, el("h3", null, t("其他进度")), world));
  }

  // ———————————————————— 深链接 ————————————————————
  function writeHash() {
    if (readingHash) return;
    const parts = [`view=${state.view}`];
    if (state.view === "browse" && App.browse.category) parts.push(`cat=${App.browse.category}`);
    if (current) parts.push(`sel=${current.type}:${encodeURIComponent(current.id)}`);
    if (current && state.graph && App.graph.supports(current)) parts.push("g=1");
    const hash = "#" + parts.join("&");
    // 英文页有 <base href="../">，只写 "#…" 会被解析到中文页路径。
    if (location.hash !== hash) history[hashReady ? "pushState" : "replaceState"](null, "", location.pathname + location.search + hash);
  }
  function readHash() {
    readingHash = true;
    try {
    const h = new URLSearchParams(location.hash.slice(1));
    const view = ["map", "tree", "browse"].includes(h.get("view")) ? h.get("view") : "browse";
    if (view === "browse") App.browse.open(h.get("cat"));
    setView(view);
    const sel = h.get("sel");
    if (sel) {
      const i = sel.indexOf(":");
      const ref = { type: sel.slice(0, i), id: sel.slice(i + 1) };
      if (ref.type === "item") ref.id = App.canonicalItemId(ref.id);
      const exists = ref.type === "find" ? !!ref.id.trim() : ref.type === "point" ? ref.id.split(";").some(id => App.mapContents.find(id))
        : ref.type === "node" ? P().nodes.has(ref.id) : ref.type === "area" ? !!App.AREAS[ref.id]
        : ref.type === "item" ? !!D.items[ref.id] : ref.type === "fish" ? App.fishByName.has(ref.id)
        : ref.type === "villager" ? App.villagerByName.has(ref.id) : ref.type === "location" ? App.locationByName.has(ref.id)
        : ref.type === "bundle" ? !!App.browse.bundle(ref.id) : ref.type === "page" && !!D.pages[ref.id];
      if (!exists) { App.select(null); return; }
      // g=1：关系图；能画关系图的条目按链接决定，其他条目不改变已记住的选择。
      if (App.graph.supports(ref)) state.graph = h.get("g") === "1";
      App.select(ref, { from: "hash" });
    } else App.select(null);
    } finally { readingHash = false; writeHash(); hashReady = true; }
  }

  // ———————————————————— 初始化 ————————————————————
  function bind() {
    // 切换语言：记住选择，并带上当前查看的条目。
    $("lang-switch")?.addEventListener("click", e => { e.preventDefault(); window.L10N.switchTo(e.currentTarget.dataset.lang); });
    for (const b of document.querySelectorAll(".hotbar-views button")) b.addEventListener("click", () => {
      if (b.dataset.view === "browse") App.select(null);
      setView(b.dataset.view); b.focus({ preventScroll: true });
    });
    $("detail-close").addEventListener("click", () => App.select(null));
    $("detail-mode").addEventListener("click", () => {
      setDetailMode(detailMode === "reading" ? "context" : "reading");
      if (detailMode === "reading") focusDetailTitle();
    });
    $("detail-conditions").addEventListener("click", openConditions);
    $("open-progress").addEventListener("click", () => { renderProgress(); $("progress-dialog").showModal(); });
    $("zoom-in").addEventListener("click", () => App.map.zoom(1.5));
    $("zoom-out").addEventListener("click", () => App.map.zoom(1 / 1.5));
    $("zoom-fit").addEventListener("click", () => App.map.fit());
    $("tree-zoom-in").addEventListener("click", () => App.tree.zoom(1.25));
    $("tree-zoom-out").addEventListener("click", () => App.tree.zoom(1 / 1.25));
    $("tree-zoom-fit").addEventListener("click", () => App.tree.fitWidth());
    const mapSeg = $("map-seg");
    for (const [k, label] of [["valley", t("山谷")], ["island", App.areaTitle("ginger_island")]]) {
      mapSeg.append(el("button", { role: "radio", dataset: { v: k }, onclick: () => {
        if (k === "island" && !S.area("ginger_island")) App.select({ type: "area", id: "ginger_island" });
        else App.map.setMap(k);
      } }, k === "island" && !S.area("ginger_island") ? t("其他地区") : label));
    }
    const modeSeg = $("tree-mode");
    for (const [k, label] of [["all", t("全部路线")], ["next", t("下一步")], ["done", t("已完成")]]) {
      modeSeg.append(el("button", { role: "radio", dataset: { v: k }, onclick: () => { App.tree.setMode(k); paintModes(); } }, label));
    }
    $("spoiler").checked = S.active();
    $("spoiler").addEventListener("change", (e) => {
      if (e.target.checked) S.setEnabled(true);
      else { e.target.checked = true; $("spoiler-dialog").showModal(); }
    });
    $("keep-spoilers").addEventListener("click", () => $("spoiler-dialog").close());
    $("show-spoilers").addEventListener("click", () => { $("spoiler-dialog").close(); S.setEnabled(false); });
    $("fx").checked = !!state.fx;
    $("fx").addEventListener("change", (e) => { state.fx = e.target.checked; App.emit("fx"); });
    $("journal-handle").addEventListener("click", () => {
      const collapsed = $("journal").classList.toggle("collapsed");
      $("journal-handle").textContent = collapsed ? t("展开") : t("收起");
      $("journal-handle").setAttribute("aria-expanded", String(!collapsed));
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && ($("progress-dialog").open || $("spoiler-dialog").open)) return;
      if (e.key === "Escape" && !$("clock-controls").hidden && !$("progress-dialog").open && !$("spoiler-dialog").open) {
        setConditionsOpen(false); e.preventDefault(); return;
      }
      if (e.key === "Escape" && current) { pointReturn ? returnToPoints() : App.select(null); e.preventDefault(); return; }
      if (e.target.matches("input, textarea, select, [contenteditable]")) return;
      if (e.key === "/") { $("search").focus(); e.preventDefault(); }
      else if (e.key === "m") setView("map");
      else if (e.key === "t") setView("tree");
    });
    window.addEventListener("resize", updateInsets);
    window.addEventListener("hashchange", readHash);
  }
  function paintModes() {
    $("spoiler").checked = S.active();
    for (const b of $("map-seg").children) {
      b.setAttribute("aria-checked", String(b.dataset.v === App.map.mapKey));
      if (b.dataset.v === "island") b.textContent = S.area("ginger_island") ? App.areaTitle("ginger_island") : t("其他地区");
    }
    for (const b of $("tree-mode").children) {
      b.hidden = b.dataset.v !== "all" && !App.conditionsActive();
      b.setAttribute("aria-checked", String(b.dataset.v === (App.conditionsActive() ? App.tree.mode : "all")));
    }
  }

  App.on((reason) => {
    const collectionFocus = reason === "collections" && document.activeElement?.closest(".collection-requirement")?.dataset.index;
    App.hideTip();
    if (reason === "spoilers" || reason === "progress:preset") {
      if (current && current.type !== "point" && !S.canView(current)) { App.map.select(null); App.map.setRelated([]); App.tree.select(null); }
      if ($("progress-dialog").open) renderProgress();
    }
    renderClock();
    renderJournal();
    renderPlan();
    paintModes();
    if (state.view === "browse") App.browse.render();
    if (current) renderDetail();
    if (collectionFocus != null) ($(`detail-body`).querySelector(`.collection-requirement[data-index="${collectionFocus}"] input`) || $("detail-body").querySelector(".collection-filter input"))?.focus();
    if (App.tree.built) App.tree.refresh();
  });

  async function init() {
    buildClock();
    bind();
    buildSearch();
    bindSearch();
    App.browse.render();
    renderClock();
    $("clock-controls").hidden = true; $("clock-toggle").setAttribute("aria-expanded", "false");
    if (window.innerWidth <= 760) $("journal").classList.add("collapsed");
    updateInsets();
    await App.map.init();
    renderJournal();
    renderPlan();
    paintModes();
    readHash();
  }
  init();
})();
