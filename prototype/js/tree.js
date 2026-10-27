/* 成长路线：按条件分组的泳道，节点状态来自玩家进度。仿文明科技树：选中目标后点亮全部前置。 */
(function () {
  "use strict";
  const App = window.App;
  const { D, el, img, money, matsText, t, N, nameOf } = App;
  const EN = App.EN;
  // 节点 title 是中文 ID（防剧透规则按它判断），name 是显示名。
  const chainEffect = (chain, i) => (EN ? EN.chains?.[chain.family]?.tiers?.[i]?.effect : chain.tiers[i].effect) || null;
  const familyName = (chain) => (EN ? EN.chains?.[chain.family]?.name : null) || chain.family.replace("（工具）", "");
  const buildingName = (zh) => (EN ? EN.buildings?.[zh]?.name || N(zh) : zh);
  const roomReward = (room) => (EN ? EN.bundles?.[room.room]?.reward : room.reward) || "";
  const levelName = (skill, level) => t("{skill} {level} 级", { skill: App.skillName(skill), level });

  // ———————————————————— 模型 ————————————————————
  const nodes = new Map();
  const lanes = [];
  const COL_W = 132;
  const LEFT = 184;
  const NODE_W = 124;
  const NODE_H = 62;

  function lane(id, name, group, rowH) {
    const l = { id, name, group, rowH, rows: [] };
    lanes.push(l);
    return l;
  }
  function row(laneObj, id, name, icon) {
    const r = { id, name, icon, lane: laneObj.id, nodes: [] };
    laneObj.rows.push(r);
    return r;
  }
  function add(r, n) {
    n.lane = r.lane;
    n.row = r.id;
    n.paths ||= [{ label: null, reqs: n.reqs || [] }];
    n.unlocks ||= [];
    nodes.set(n.id, n);
    r.nodes.push(n.id);
    return n;
  }
  const ref = (id, rel, text) => ({ type: "node", id, rel, text });
  const item = (idOrZh) => App.itemInfo(idOrZh) || { z: idOrZh };
  const unlockOf = (idOrZh) => {
    const it = item(idOrZh);
    return { id: it.id, z: it.z, i: it.i };
  };

  // —— 技能 ——
  const skills = lane("skills", t("技能"), t("成长条件"), 74);
  for (const sk of App.SKILLS) {
    const r = row(skills, "skill:" + sk.id, sk.name, sk.icon);
    for (let lv = 1; lv <= 10; lv++) {
      const ul = (D.skillUnlocks[sk.id] || {})[lv] || [];
      add(r, {
        id: `skill:${sk.id}:${lv}`, kind: "skill", col: lv, title: `${sk.zh} ${lv} 级`, name: levelName(sk.id, lv), short: t("{n} 级", { n: lv }), icon: null,
        state: { type: "skill", skill: sk.id, level: lv, text: levelName(sk.id, lv) },
        reqs: lv > 1 ? [ref(`skill:${sk.id}:${lv - 1}`, "level")] : [],
        unlocks: ul.map((u) => unlockOf(u.id || u.z)),
        info: { what: ul.length ? t("解锁配方：{list}", { list: App.list(ul.map((u) => nameOf(u.id || u.z))) }) : t("这一级没有新配方；职业选择见技能条目。"), source: "技能" },
      });
    }
  }

  // —— 装备进阶：鱼竿（可直接购买）与洒水器（独立配方） ——
  const gear = lane("gear", t("装备进阶"), t("成长条件"), 80);
  {
    const r = row(gear, "rod", t("鱼竿"), App.ROD_CHAIN.tiers[2].image);
    const cols = [0, 1, 2, 6, 10];
    App.ROD_CHAIN.tiers.forEach((tier, i) => {
      const reqs = [];
      for (const u of tier.unlock || []) {
        if (u.group === "skill") reqs.push(ref(`skill:${u.skill}:${u.level}`, "skill", levelName(u.skill, u.level)));
        if (u.group === "mastery") reqs.push(ref("skill:fishing:10", "skill", levelName("fishing", 10)), { type: "info", text: t("钓鱼精通"), hint: t("精通进度暂未记录") });
      }
      const name = nameOf(tier.id || tier.zh), shop = N(tier.sold_by || "鱼店");
      add(r, {
        id: `rod:${i}`, kind: "item", col: cols[i], title: tier.zh, name, icon: tier.image, itemId: tier.id,
        sub: `${shop} ${money(tier.cost)}`, place: "鱼店",
        state: { type: "rod", tier: i, text: t("拥有{item}", { item: name }) }, reqs,
        series: i > 0 ? `rod:${i - 1}` : null,
        info: { what: chainEffect(App.ROD_CHAIN, i), action: t("在{shop}花 {cost} 购买", { shop, cost: money(tier.cost) }), note: t("各级都能直接购买，不需要先拥有上一级。"), source: "钓竿" },
      });
    });
  }
  {
    const r = row(gear, "sprinkler", t("洒水器"), "Sprinkler.png");
    const tiers = [["洒水器", 2], ["优质洒水器", 6], ["铱制洒水器", 9]];
    tiers.forEach(([zh, lv], i) => {
      const it = item(zh);
      const recipe = (App.recipesByOut.get(it.id) || [])[0];
      const buy = (App.shopsByItem.get(it.id) || [])[0];
      const paths = [{ label: t("打造"), reqs: [ref(`skill:farming:${lv}`, "skill", levelName("farming", lv))] }];
      if (buy) {
        paths.push({ label: t("{shop}购买", { shop: N(buy.shop) }), reqs: [{ type: "area", area: "sewers", text: t("可进入{place}", { place: App.areaTitle("sewers") }) }, { type: "weekday", wd: 5 }] });
      }
      const name = App.itemName(it);
      add(r, {
        id: `sprinkler:${i}`, kind: "item", col: lv, title: zh, name, icon: it.i, itemId: it.id,
        sub: recipe ? matsText(recipe.in.map((x) => ({ id: x.id, zh: x.z, qty: x.q }))) : "",
        state: { type: "owned", id: it.id, text: t("已有{item}", { item: name }) }, paths, series: i > 0 ? `sprinkler:${i - 1}` : null,
        info: { what: App.itemDesc(it), note: t("三档洒水器是独立配方，不需要先做低一档。"), source: zh },
      });
    });
  }

  // —— 工具：铁匠铺逐级升级 ——
  const tools = lane("tools", t("工具"), t("成长条件"), 80);
  const toolUnlocks = D.progression.tool_unlocks;
  for (const ch of D.chains.filter((c) => c.kind === "blacksmith_upgrade")) {
    const r = row(tools, "tool:" + ch.family, familyName(ch), ch.tiers[1].image);
    ch.tiers.forEach((tier, i) => {
      const extra = toolUnlocks.filter((u) => u.family === ch.family && u.tier === i);
      const name = nameOf(tier.id || tier.zh), prev = i ? nameOf(ch.tiers[i - 1].id || ch.tiers[i - 1].zh) : null;
      add(r, {
        id: `tool:${ch.family}:${i}`, kind: "tool", col: i * 2.5, title: tier.zh, name, icon: tier.image, itemId: tier.id,
        sub: i ? `${matsText(tier.materials)} · ${money(tier.cost)}` : t("初始工具"), place: i ? "铁匠铺" : null,
        state: i ? { type: "tool", family: ch.family, tier: i, text: t("拥有{item}", { item: name }) } : "always",
        reqs: i ? [ref(`tool:${ch.family}:${i - 1}`, "upgrade")] : [],
        cost: tier.cost, materials: tier.materials,
        unlocks: extra.map((u) => ({ z: u.text, i: null, text: true })),
        info: {
          what: chainEffect(ch, i), action: i ? t("把{prev}交给克林特，付 {cost} 和 {materials}，等待 2 天", { prev, cost: money(tier.cost), materials: matsText(tier.materials) }) : null,
          note: i ? t("必须按顺序升级，不能跳级。") : null, source: ch.family,
        },
      });
    });
  }

  // —— 地区准入 ——
  const areas = lane("areas", t("地区准入"), t("世界进度"), 80);
  const A = D.progression.areas.reduce((m, a) => ((m[a.id] = a), m), {});
  const areaNode = (r, id, col, reqs, extra = {}) =>
    add(r, {
      id: "area:" + id, kind: "area", col, title: A[id].title, name: App.areaTitle(id), icon: extra.icon || null, place: extra.place || A[id].title,
      state: "derived", reqs, area: id, sub: extra.sub || A[id].requires.map((q) => q.text).join(" + "),
      info: { quote: A[id].quote, source: A[id].source, ...extra.info },
    });
  {
    const r = row(areas, "mines", App.areaTitle("mines"), "Mining_Skill_Icon.png");
    add(r, { id: "date:mines", kind: "milestone", col: 0, title: "春季 5 日", name: t("春季 5 日"), sub: t("第一年开放矿井"), state: A.mines.requires[0], icon: "Spring.png",
      info: { quote: A.mines.quote, source: A.mines.source } });
    areaNode(r, "mines", 1, [ref("date:mines", "gate")], { sub: t("坍方清除后"), icon: null });
    [[40, "铁矿石", 4], [80, "黄金矿石", 6], [120, "头骨钥匙", 8]].forEach(([depth, zh, col], i, arr) => {
      const it = item(zh);
      add(r, {
        id: `mine:${depth}`, kind: "milestone", col, title: `矿井 ${depth} 层`, name: t("矿井 {n} 层", { n: depth }), icon: it.i,
        sub: depth === 120 ? t("获得头骨钥匙") : t("{item}开始常见", { item: App.itemName(it) }),
        state: { type: "mine_depth", depth, text: t("到达矿井 {n} 层", { n: depth }) },
        reqs: [i ? ref(`mine:${arr[i - 1][0]}`, "level") : ref("area:mines", "gate")],
        unlocks: [unlockOf(zh)],
        info: {
          quote: depth === 120 ? A.skull_cavern.quote : D.progression.ore_hints.find((h) => h.zh === zh)?.quote,
          source: depth === 120 ? "头骨钥匙" : zh,
        },
      });
    });
  }
  {
    const r = row(areas, "secret_woods", App.areaTitle("secret_woods"), "Hardwood.png");
    areaNode(r, "secret_woods", 5, [ref("tool:斧头:2", "gate", nameOf("钢斧头"))], { sub: t("钢斧头劈开大圆木"), icon: "Hardwood.png" });
  }
  {
    const r = row(areas, "museum", N("博物馆"), "Rusty_Key.png");
    add(r, { id: "museum:60", kind: "milestone", col: 4, title: "捐赠 60 件", name: t("捐赠 60 件"), icon: "Rusty_Key.png", sub: t("冈瑟送出生锈的钥匙"),
      state: { type: "museum", count: 60, text: t("博物馆捐赠 60 件") }, place: "博物馆",
      info: { quote: A.sewers.quote, source: A.sewers.source } });
    areaNode(r, "sewers", 6, [ref("museum:60", "gate")], { sub: t("用生锈的钥匙进入"), icon: "Sewer.png" });
    add(r, { id: "shop:krobus", kind: "milestone", col: 8, title: "科罗布斯的商店", name: t("科罗布斯的商店"), icon: "Krobus_Icon.png", sub: t("周五出售铱制洒水器"),
      state: "derived", reqs: [ref("area:sewers", "gate")], place: "下水道",
      unlocks: ["铱制洒水器", "虚空精华", "星之果实"].map(unlockOf),
      info: { what: t("下水道里的商店，部分商品按星期轮换。"), source: "科罗布斯" } });
  }
  {
    const r = row(areas, "witch_swamp", App.areaTitle("witch_swamp"), null);
    areaNode(r, "witch_swamp", 9, [ref("cc:complete", "gate", t("社区中心修复"))], { sub: t("法师任务之后") });
  }

  // —— 社区中心 ——
  const cc = lane("cc", t("社区中心"), t("世界进度"), 80);
  const ROOM_TO = {
    工艺室: { area: "quarry", col: 5 }, 金库: { area: "desert", col: 5 },
    茶水间: { feature: "greenhouse" }, 锅炉房: { feature: "minecarts" },
  };
  const BUNDLE_ICON = ["Bundle_Green.png", "Bundle_Yellow.png", "Bundle_Orange.png", "Bundle_Teal.png", "Bundle_Red.png", "Bundle_Purple.png"];
  for (const room of D.bundles.filter((r) => r.room !== "废弃Joja超市")) {
    const r = row(cc, "room:" + room.room, N(room.room), null);
    add(r, {
      id: "room:" + room.room, kind: "room", col: 0, title: room.room, name: N(room.room), icon: BUNDLE_ICON[App.ROOMS.indexOf(room.room) % 6],
      sub: t("{n} 个收集包", { n: room.bundles.length }), place: "社区中心", room: room.room,
      state: { type: "room", room: room.room, text: t("完成{room}", { room: N(room.room) }) },
      unlocks: room.bundles.slice(0, 3).map((b) => unlockOf(b.items[0]?.id || b.items[0]?.zh)),
      info: { what: App.list(room.bundles.map((b) => N(b.name))), source: "收集包" },
    });
    const feature = ROOM_TO[room.room]?.feature && D.progression.features.find((f) => f.id === ROOM_TO[room.room].feature);
    add(r, {
      id: "reward:" + room.room, kind: "reward", col: 2.5, title: room.reward, name: roomReward(room), icon: null, sub: t("房间奖励"),
      state: "derived", reqs: [ref("room:" + room.room, "gate")], place: "社区中心",
      info: feature ? { quote: feature.quote, source: feature.source, note: t("Joja 路线：{route}", { route: feature.joja }) } : { source: "收集包" },
    });
    const to = ROOM_TO[room.room];
    if (to && to.area) {
      areaNode(r, to.area, to.col, [ref("reward:" + room.room, "gate")], { sub: roomReward(room) });
      if (to.area === "desert") {
        add(r, { id: "area:skull_cavern", kind: "area", col: 7.5, title: "骷髅洞穴", name: App.areaTitle("skull_cavern"), icon: "Skull_Key.png", place: "沙漠", area: "skull_cavern",
          state: "derived", reqs: [ref("area:desert", "gate"), ref("mine:120", "gate", nameOf("头骨钥匙"))], sub: t("沙漠 + 头骨钥匙"),
          info: { quote: A.skull_cavern.quote, source: A.skull_cavern.source } });
      }
    }
  }
  {
    const r = row(cc, "cc:after", t("修复之后"), null);
    add(r, { id: "cc:complete", kind: "milestone", col: 6, title: "社区中心修复", name: t("社区中心修复"), icon: "Golden_Walnut.png", sub: t("完成全部 6 个房间"),
      state: "derived", reqs: App.ROOMS.map((room) => ref("room:" + room, "converge")), place: "社区中心",
      info: { what: t("也可以走 Joja 路线：在 Joja 社区发展申请书里买下全部项目。"), source: "社区中心" } });
    const boat = D.progression.boat;
    add(r, { id: "boat", kind: "milestone", col: 8, title: "威利的船", name: EN?.progression?.boat?.title || t("威利的船"), icon: "Battery_Pack.png", place: "鱼店",
      sub: matsText(boat.materials), state: { type: "flag", flag: "boat_repaired", text: t("船已修好") },
      reqs: [ref("cc:complete", "gate")], materials: boat.materials,
      info: { quote: A.ginger_island.quote, source: A.ginger_island.source, action: t("在鱼店里屋交付 {materials}", { materials: matsText(boat.materials) }) } });
    areaNode(r, "ginger_island", 10, [ref("boat", "gate")], { sub: t("船票 {price}", { price: money(boat.ticket) }), icon: "Golden_Walnut.png", place: "鱼店" });
  }

  // —— 农场建筑 ——
  const farm = lane("farm", t("农场建筑"), t("世界进度"), 80);
  const chainCols = { 农舍: [0, 3, 6, 9], 鸡舍: [1, 4, 7], 畜棚: [1, 4, 7], 小屋: [1, 4] };
  for (const ch of App.BUILDING_CHAINS) {
    const r = row(farm, "bld:" + ch.chain, buildingName(ch.chain), ch.tiers[0].image);
    ch.tiers.forEach((b, i) => {
      const unlocks = [];
      for (const m of (b.description || "").matchAll(/解锁([^。，\n]+)/g)) {
        for (const animal of m[1].split(/和|、/)) {
          const page = D.pages[animal.trim()];
          unlocks.push({ z: animal.trim(), i: page && page.i, pg: page ? animal.trim() : null });
        }
      }
      const label = b.name.replace(/^农舍（(.+)）$/, "$1");
      const title = label === b.name ? b.name : label;
      const costText = EN ? EN.buildings?.[b.name]?.cost_text : b.cost_text;
      add(r, {
        id: `bld:${ch.chain}:${i}`, kind: "building", col: (chainCols[ch.chain] || [0, 3, 6, 9])[i], title, name: EN ? buildingName(b.name) : title,
        icon: b.image, place: i || ch.chain !== "农舍" ? "木匠的商店" : "农舍",
        sub: b.cost ? `${money(b.cost)}${b.materials.length ? " · " + matsText(b.materials) : ""}` : (costText || ""),
        state: ch.chain === "农舍" && i === 0 ? "always" : { type: "building", chain: ch.chain, tier: i, text: t("建好{building}", { building: buildingName(b.name) }) },
        reqs: i ? [ref(`bld:${ch.chain}:${i - 1}`, "upgrade")] : [], materials: b.materials, cost: b.cost,
        unlocks,
        info: { what: EN ? EN.buildings?.[b.name]?.desc || null : (b.description || "").replace(/^由.+?升级\s*/, ""),
          action: b.cost ? t("向罗宾支付 {cost}", { cost: money(b.cost) }) + (b.materials.length ? t("，材料 {list}", { list: matsText(b.materials) }) : "") + (b.build_days ? t("，建造 {n} 天", { n: b.build_days }) : "") : null, source: b.page },
      });
    });
  }

  // ———————————————————— 求值 ————————————————————
  function status(id) {
    const memo = (App.cache.node ||= {});
    if (memo[id]) return memo[id];
    memo[id] = { status: "unknown", paths: [] };
    const n = nodes.get(id);
    const paths = n.paths.map((p) => {
      const checks = p.reqs.map(App.evalReq);
      return { label: p.label, checks, ok: App.combine(checks) };
    });
    const best = paths.some((p) => p.ok === true) ? true : paths.every((p) => p.ok === false) ? false : null;
    let st;
    if (n.state === "always") st = "done";
    else if (n.state === "derived") st = best === true ? "done" : best === false ? "locked" : "unknown";
    else {
      const d = App.evalReq(n.state).ok;
      if (d === true) st = "done";
      else if (d === null) st = "unknown";
      else st = best === true ? "ready" : best === false ? "locked" : "unknown";
    }
    return (memo[id] = { status: st, paths });
  }

  // 依赖关系
  const parents = new Map();
  const children = new Map();
  for (const n of nodes.values()) {
    const ps = new Set();
    for (const p of n.paths) for (const q of p.reqs) if (q.type === "node") ps.add(q.id);
    parents.set(n.id, ps);
    for (const pid of ps) (children.get(pid) || children.set(pid, new Set()).get(pid)).add(n.id);
  }
  function walk(id, map, out = new Set()) {
    for (const x of map.get(id) || []) if (!out.has(x)) { out.add(x); walk(x, map, out); }
    return out;
  }
  // 达成目标的步骤：未完成的前置按依赖顺序排列
  function stepsTo(id) {
    const order = [];
    const seen = new Set();
    (function visit(x) {
      if (seen.has(x)) return;
      seen.add(x);
      const n = nodes.get(x);
      const pick = n.paths.length > 1 ? status(x).paths.findIndex((p) => p.ok !== false) : 0;
      const path = n.paths[Math.max(0, pick)];
      for (const q of path.reqs) if (q.type === "node") visit(q.id);
      if (status(x).status !== "done") order.push(x);
    })(id);
    return order;
  }
  const frontier = () => [...nodes.values()].filter((n) => status(n.id).status === "ready");

  App.progression = { nodes, lanes, status, parents, children, ancestors: (id) => walk(id, parents), descendants: (id) => walk(id, children), stepsTo, frontier };

  // ———————————————————— 渲染 ————————————————————
  const view = { x: 0, y: 0, z: 1 };
  let stage, svg, section, built = false;
  const nodeEls = new Map();
  const rowEls = new Map();
  let selected = null;
  let laneFilter = null;
  let mode = "all";

  function layout() {
    let y = 72;
    for (const l of lanes) {
      l.top = y;
      y += 52;
      for (const r of l.rows) {
        r.y = y;
        for (const id of r.nodes) {
          const n = nodes.get(id);
          n.x = LEFT + n.col * COL_W;
          n.y = y + (l.rowH - NODE_H) / 2;
        }
        y += l.rowH;
      }
      l.bottom = y;
      y += 18;
    }
    return { w: LEFT + 10 * COL_W + NODE_W + 40, h: y + 120 };
  }

  function build() {
    section = document.getElementById("tree");
    stage = document.getElementById("tree-stage");
    const size = layout();
    stage.style.width = size.w + "px";
    stage.style.height = size.h + "px";
    App.treeSize = size;
    for (const l of lanes) {
      stage.append(el("div", { class: "lane-band", style: `top:${l.top}px;width:${size.w}px;height:${l.bottom - l.top}px` }));
      stage.append(el("div", { class: "lane-title", style: `top:${l.top + 10}px` }, l.name, el("small", null, l.group)));
      for (const r of l.rows) {
        const label = el("div", { class: "row-label", style: `top:${r.y}px;height:${l.rowH}px` });
        stage.append(label);
        rowEls.set(r, label);
      }
    }
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "tree-edges");
    svg.setAttribute("width", size.w);
    svg.setAttribute("height", size.h);
    stage.prepend(svg);
    for (const n of nodes.values()) {
      const node = el("button", { class: `node ${n.kind}`, style: `left:${n.x}px;top:${n.y}px;width:${NODE_W}px;height:${NODE_H}px`, dataset: { id: n.id } });
      node.addEventListener("click", (e) => { e.stopPropagation(); App.select({ type: "node", id: n.id }, { from: "tree-click" }); });
      stage.append(node);
      nodeEls.set(n.id, node);
    }
    drawEdges();
    bindPan();
    built = true;
    fit();
  }

  function edgePath(a, b) {
    const sameRow = a.row === b.row;
    if (b.x > a.x + NODE_W / 2 || sameRow) {
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
      if (Math.abs(y1 - y2) < 1) return `M${x1},${y1}H${x2}`;
      const mx = Math.max(x1 + 6, x2 - 14);
      const r = Math.min(8, Math.abs(y2 - y1) / 2);
      const dir = y2 > y1 ? 1 : -1;
      return `M${x1},${y1}H${mx - r}Q${mx},${y1} ${mx},${y1 + r * dir}V${y2 - r * dir}Q${mx},${y2} ${mx + r},${y2}H${x2}`;
    }
    // 目标在下方同一列附近：从底部连到顶部
    const x1 = a.x + NODE_W / 2, x2 = b.x + NODE_W / 2;
    const down = b.y > a.y;
    const y1 = down ? a.y + NODE_H : a.y, y2 = down ? b.y : b.y + NODE_H;
    if (Math.abs(x1 - x2) < 1) return `M${x1},${y1}V${y2}`;
    const my = (y1 + y2) / 2;
    return `M${x1},${y1}V${my}H${x2}V${y2}`;
  }

  const edges = [];
  function drawEdges() {
    svg.innerHTML = "";
    edges.length = 0;
    const mk = (from, to, cls) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", edgePath(nodes.get(from), nodes.get(to)));
      p.setAttribute("class", cls);
      svg.append(p);
      edges.push({ from, to, el: p, base: cls });
    };
    for (const n of nodes.values()) {
      if (n.series) mk(n.series, n.id, "series");
      for (const pid of parents.get(n.id)) {
        const a = nodes.get(pid);
        mk(pid, n.id, a.lane !== n.lane ? "cross" : "");
      }
    }
  }

  const BADGE = { done: "✓", ready: t("下一步"), locked: t("未满足"), unknown: "?" };
  function refresh() {
    if (!built) return;
    const S = App.spoilers;
    const lit = selected ? App.progression.ancestors(selected) : null;
    const after = selected ? App.progression.descendants(selected) : null;
    const placeholders = new Set();
    for (const [r, label] of rowEls) {
      const shown = r.nodes.some(S.node);
      label.replaceChildren(shown && S.textAllowed(r.name) ? r.name : t("未探索路线"));
      const hidden = r.nodes.find(id => !S.node(id));
      if (hidden) placeholders.add(hidden);
    }
    for (const [id, node] of nodeEls) {
      const st = status(id).status;
      const n = nodes.get(id);
      const allowed = S.node(id);
      node.replaceChildren();
      node.hidden = !allowed && !placeholders.has(id);
      if (!allowed) {
        node.className = "node protected-node";
        node.append(el("span", { class: "n-title" }, t("后续内容")), el("span", { class: "n-sub" }, t("点击选择查看")));
        node.setAttribute("aria-label", t("后续内容，点击选择是否查看"));
        continue;
      }
      if (n.kind === "skill") {
        const unlocks = n.unlocks.filter(u => S.canView({ type: u.id ? "item" : "page", id: u.id || u.z }));
        node.append(el("span", { class: "n-title" }, n.short), el("span", { class: "n-unlocks" }, unlocks.slice(0, 4).map(u => img(u.i, null, nameOf(u.id || u.z)))));
      } else {
        // 特殊里程碑的图标也可能提前透露奖励。
        const iconSafe = !S.active() || !["milestone", "area", "reward"].includes(n.kind);
        node.append(iconSafe && n.icon ? img(n.icon, "icon") : el("span", { class: "icon" }),
          el("span", { class: "n-title" }, n.name), el("span", { class: "n-sub" }, S.textAllowed(n.sub) ? n.sub || "" : t("详细条件按需查看")));
      }
      node.append(el("span", { class: "badge", "aria-hidden": "true" }));
      node.className = `node ${n.kind} ${App.conditionsActive() ? "s-" + st : "s-reference"}`;
      node.querySelector(".badge").textContent = App.conditionsActive() ? BADGE[st] : "";
      node.setAttribute("aria-label", App.conditionsActive() ? t("{name}：{status}", { name: n.name, status: { done: t("已完成"), ready: t("前置条件满足"), locked: t("条件未满足"), unknown: t("未确认") }[st] }) : t("{name}，查看材料与前置关系", { name: n.name }));
      let dim = false;
      if (laneFilter && n.lane !== laneFilter) dim = true;
      if (App.conditionsActive() && mode === "next" && st !== "ready") dim = true;
      if (App.conditionsActive() && mode === "done" && st !== "done") dim = true;
      if (selected && id !== selected && !lit.has(id) && !after.has(id)) dim = true;
      node.classList.toggle("dim", dim);
      node.classList.toggle("is-selected", id === selected);
    }
    for (const e of edges) {
      e.el.style.display = S.node(e.from) && S.node(e.to) ? "" : "none";
      let cls = e.base;
      const fromDone = status(e.from).status === "done";
      if (App.conditionsActive() && fromDone && status(e.to).status === "done") cls += " done";
      if (selected) {
        if ((lit.has(e.from) || e.from === selected) && (lit.has(e.to) || e.to === selected) && e.base !== "series") cls += " lit";
        else if ((after.has(e.to)) && (after.has(e.from) || e.from === selected)) cls += " lit-after";
        else cls += " dim";
      } else if (laneFilter) {
        const a = nodes.get(e.from), b = nodes.get(e.to);
        if (a.lane !== laneFilter && b.lane !== laneFilter) cls += " dim";
      }
      e.el.setAttribute("class", cls);
    }
  }

  // —— 平移缩放 ——
  function apply() {
    stage.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  }
  // 初始视图：避开左侧面板，缩放不低于 0.8，保证节点文字可读
  function fit() {
    const w = section.clientWidth;
    const left = (App.treeInsetLeft || 0) + 8;
    const z = Math.min(1, Math.max(0.8, (w - left - 24) / App.treeSize.w));
    view.z = z;
    view.x = left;
    view.y = 8;
    apply();
  }
  // 缩到整行宽度：一眼看到每条路线的全部阶段，当前看的那一段保持在中间。
  function fitWidth() {
    const w = section.clientWidth, h = section.clientHeight;
    const left = (App.treeInsetLeft || 0) + 8;
    const z = Math.min(1, Math.max(0.35, (w - left - 24) / App.treeSize.w));
    const centerY = (h / 2 - view.y) / view.z;
    animateTo(left, h / 2 - centerY * z, z);
  }
  function focusNode(id, opts = {}) {
    const n = nodes.get(id);
    if (!n || !section) return;
    const w = section.clientWidth, h = section.clientHeight;
    const z = opts.zoom || Math.max(view.z, 0.8);
    const tx = w / 2 - (n.x + NODE_W / 2) * z - (opts.offsetX || 0);
    const ty = h / 2 - (n.y + NODE_H / 2) * z;
    animateTo(tx, ty, z);
  }
  function focusLane(id) {
    const l = lanes.find((x) => x.id === id);
    if (!l) return;
    const w = section.clientWidth;
    const left = (App.treeInsetLeft || 0) + 8;
    const z = Math.min(1, Math.max(0.8, (w - left - 24) / App.treeSize.w));
    animateTo(left, 96 - l.top * z, z);
  }
  let anim = 0;
  function animateTo(x, y, z) {
    cancelAnimationFrame(anim);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { Object.assign(view, { x, y, z }); apply(); return; }
    const from = { ...view };
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 420);
      const e = 1 - Math.pow(1 - k, 3);
      view.x = from.x + (x - from.x) * e;
      view.y = from.y + (y - from.y) * e;
      view.z = from.z + (z - from.z) * e;
      apply();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function bindPan() {
    let drag = null;
    section.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".node")) return;
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      section.setPointerCapture(e.pointerId);
      section.classList.add("dragging");
    });
    section.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      view.x = drag.vx + dx;
      view.y = drag.vy + dy;
      apply();
    });
    const end = (e) => {
      if (drag && !drag.moved && !e.target.closest(".node")) App.select(null);
      drag = null;
      section.classList.remove("dragging");
    };
    section.addEventListener("pointerup", end);
    section.addEventListener("pointercancel", () => { drag = null; section.classList.remove("dragging"); });
    // 用 Tab 逐个切换节点时，舞台靠 transform 平移，浏览器不会把焦点节点滚进视野；这里把视野移过去。
    section.addEventListener("focusin", (e) => {
      const node = e.target.closest?.(".node");
      if (!node) return;
      section.scrollLeft = 0; section.scrollTop = 0;
      const box = section.getBoundingClientRect(), r = node.getBoundingClientRect(), margin = 24;
      const left = Math.max(box.left, (App.treeInsetLeft || 0) + 8) + margin, right = box.right - margin;
      const top = box.top + margin, bottom = box.bottom - margin;
      const dx = r.left < left ? left - r.left : r.right > right ? right - r.right : 0;
      const dy = r.top < top ? top - r.top : r.bottom > bottom ? bottom - r.bottom : 0;
      if (dx || dy) animateTo(view.x + dx, view.y + dy, view.z);
    });
    section.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = section.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const nz = Math.min(1.6, Math.max(0.35, view.z * Math.exp(-e.deltaY * 0.01)));
        view.x = px - ((px - view.x) / view.z) * nz;
        view.y = py - ((py - view.y) / view.z) * nz;
        view.z = nz;
      } else {
        view.x -= e.deltaX;
        view.y -= e.deltaY;
      }
      apply();
    }, { passive: false });
  }

  App.tree = {
    build, refresh, fit, fitWidth, focusNode, focusLane,
    get built() { return built; },
    select(id) { selected = id; refresh(); },
    setLane(id) { laneFilter = id; refresh(); if (id) focusLane(id); },
    get lane() { return laneFilter; },
    setMode(m) { mode = m; refresh(); },
    get mode() { return mode; },
    zoom(f) {
      const w = section.clientWidth / 2, h = section.clientHeight / 2;
      const nz = Math.min(1.6, Math.max(0.35, view.z * f));
      animateTo(w - ((w - view.x) / view.z) * nz, h - ((h - view.y) / view.z) * nz, nz);
    },
  };
})();
