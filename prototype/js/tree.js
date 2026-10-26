/* 成长路线：按条件分组的泳道，节点状态来自玩家进度。仿文明科技树：选中目标后点亮全部前置。 */
(function () {
  "use strict";
  const App = window.App;
  const { D, el, img, money, matsText } = App;

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
  const skills = lane("skills", "技能", "成长条件", 74);
  for (const sk of App.SKILLS) {
    const r = row(skills, "skill:" + sk.id, sk.zh, sk.icon);
    for (let lv = 1; lv <= 10; lv++) {
      const ul = (D.skillUnlocks[sk.id] || {})[lv] || [];
      add(r, {
        id: `skill:${sk.id}:${lv}`, kind: "skill", col: lv, title: `${sk.zh} ${lv} 级`, short: `${lv} 级`, icon: null,
        state: { type: "skill", skill: sk.id, level: lv, text: `${sk.zh} ${lv} 级` },
        reqs: lv > 1 ? [ref(`skill:${sk.id}:${lv - 1}`, "level")] : [],
        unlocks: ul.map((u) => unlockOf(u.id || u.z)),
        info: { what: ul.length ? `解锁配方：${ul.map((u) => u.z).join("、")}` : "这一级没有新配方；职业选择见技能条目。", source: "技能" },
      });
    }
  }

  // —— 装备进阶：鱼竿（可直接购买）与洒水器（独立配方） ——
  const gear = lane("gear", "装备进阶", "成长条件", 80);
  {
    const r = row(gear, "rod", "鱼竿", App.ROD_CHAIN.tiers[2].image);
    const cols = [0, 1, 2, 6, 10];
    App.ROD_CHAIN.tiers.forEach((t, i) => {
      const reqs = [];
      for (const u of t.unlock || []) {
        if (u.group === "skill") reqs.push(ref(`skill:${u.skill}:${u.level}`, "skill", u.text));
        if (u.group === "mastery") reqs.push(ref("skill:fishing:10", "skill", "钓鱼 10 级"), { type: "info", text: "钓鱼精通", hint: "精通进度暂未记录" });
      }
      add(r, {
        id: `rod:${i}`, kind: "item", col: cols[i], title: t.zh, icon: t.image, itemId: t.id,
        sub: `${t.sold_by || "鱼店"} ${money(t.cost)}`, place: "鱼店",
        state: { type: "rod", tier: i, text: `拥有${t.zh}` }, reqs,
        series: i > 0 ? `rod:${i - 1}` : null,
        info: { what: t.effect, action: `在${t.sold_by || "鱼店"}花 ${money(t.cost)} 购买`, note: "各级都能直接购买，不需要先拥有上一级。", source: "钓竿" },
      });
    });
  }
  {
    const r = row(gear, "sprinkler", "洒水器", "Sprinkler.png");
    const tiers = [["洒水器", 2], ["优质洒水器", 6], ["铱制洒水器", 9]];
    tiers.forEach(([zh, lv], i) => {
      const it = item(zh);
      const recipe = (App.recipesByOut.get(it.id) || [])[0];
      const buy = (App.shopsByItem.get(it.id) || [])[0];
      const paths = [{ label: "打造", reqs: [ref(`skill:farming:${lv}`, "skill", `耕种 ${lv} 级`)] }];
      if (buy) {
        paths.push({ label: `${buy.shop}购买`, reqs: [{ type: "area", area: "sewers", text: "可进入下水道" }, { type: "weekday", wd: 5 }] });
      }
      add(r, {
        id: `sprinkler:${i}`, kind: "item", col: lv, title: zh, icon: it.i, itemId: it.id,
        sub: recipe ? matsText(recipe.in.map((x) => ({ zh: x.z, qty: x.q }))) : "",
        state: { type: "owned", id: it.id, text: `已有${zh}` }, paths, series: i > 0 ? `sprinkler:${i - 1}` : null,
        info: { what: it.d, note: "三档洒水器是独立配方，不需要先做低一档。", source: zh },
      });
    });
  }

  // —— 工具：铁匠铺逐级升级 ——
  const tools = lane("tools", "工具", "成长条件", 80);
  const toolUnlocks = D.progression.tool_unlocks;
  for (const ch of D.chains.filter((c) => c.kind === "blacksmith_upgrade")) {
    const name = ch.family.replace("（工具）", "");
    const r = row(tools, "tool:" + ch.family, name, ch.tiers[1].image);
    ch.tiers.forEach((t, i) => {
      const extra = toolUnlocks.filter((u) => u.family === ch.family && u.tier === i);
      add(r, {
        id: `tool:${ch.family}:${i}`, kind: "tool", col: i * 2.5, title: t.zh, icon: t.image, itemId: t.id,
        sub: i ? `${matsText(t.materials)} · ${money(t.cost)}` : "初始工具", place: i ? "铁匠铺" : null,
        state: i ? { type: "tool", family: ch.family, tier: i, text: `拥有${t.zh}` } : "always",
        reqs: i ? [ref(`tool:${ch.family}:${i - 1}`, "upgrade")] : [],
        cost: t.cost, materials: t.materials,
        unlocks: extra.map((u) => ({ z: u.text, i: null, text: true })),
        info: {
          what: t.effect, action: i ? `把${ch.tiers[i - 1].zh}交给克林特，付 ${money(t.cost)} 和 ${matsText(t.materials)}，等待 2 天` : null,
          note: i ? "必须按顺序升级，不能跳级。" : null, source: ch.family,
        },
      });
    });
  }

  // —— 地区准入 ——
  const areas = lane("areas", "地区准入", "世界进度", 80);
  const A = D.progression.areas.reduce((m, a) => ((m[a.id] = a), m), {});
  const areaNode = (r, id, col, reqs, extra = {}) =>
    add(r, {
      id: "area:" + id, kind: "area", col, title: A[id].title, icon: extra.icon || null, place: extra.place || A[id].title,
      state: "derived", reqs, area: id, sub: extra.sub || A[id].requires.map((q) => q.text).join(" + "),
      info: { quote: A[id].quote, source: A[id].source, ...extra.info },
    });
  {
    const r = row(areas, "mines", "矿井", "Mining_Skill_Icon.png");
    add(r, { id: "date:mines", kind: "milestone", col: 0, title: "春季 5 日", sub: "第一年开放矿井", state: A.mines.requires[0], icon: "Spring.png",
      info: { quote: A.mines.quote, source: A.mines.source } });
    areaNode(r, "mines", 1, [ref("date:mines", "gate")], { sub: "坍方清除后", icon: null });
    [[40, "铁矿石", 4], [80, "黄金矿石", 6], [120, "头骨钥匙", 8]].forEach(([depth, zh, col], i, arr) => {
      const it = item(zh);
      add(r, {
        id: `mine:${depth}`, kind: "milestone", col, title: `矿井 ${depth} 层`, icon: it.i,
        sub: depth === 120 ? "获得头骨钥匙" : `${zh}开始常见`,
        state: { type: "mine_depth", depth, text: `到达矿井 ${depth} 层` },
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
    const r = row(areas, "secret_woods", "秘密森林", "Hardwood.png");
    areaNode(r, "secret_woods", 5, [ref("tool:斧头:2", "gate", "钢斧头")], { sub: "钢斧头劈开大圆木", icon: "Hardwood.png" });
  }
  {
    const r = row(areas, "museum", "博物馆", "Rusty_Key.png");
    add(r, { id: "museum:60", kind: "milestone", col: 4, title: "捐赠 60 件", icon: "Rusty_Key.png", sub: "冈瑟送出生锈的钥匙",
      state: { type: "museum", count: 60, text: "博物馆捐赠 60 件" }, place: "博物馆",
      info: { quote: A.sewers.quote, source: A.sewers.source } });
    areaNode(r, "sewers", 6, [ref("museum:60", "gate")], { sub: "用生锈的钥匙进入", icon: "Sewer.png" });
    add(r, { id: "shop:krobus", kind: "milestone", col: 8, title: "科罗布斯的商店", icon: "Krobus_Icon.png", sub: "周五出售铱制洒水器",
      state: "derived", reqs: [ref("area:sewers", "gate")], place: "下水道",
      unlocks: ["铱制洒水器", "虚空精华", "星之果实"].map(unlockOf),
      info: { what: "下水道里的商店，部分商品按星期轮换。", source: "科罗布斯" } });
  }
  {
    const r = row(areas, "witch_swamp", "巫婆沼泽", null);
    areaNode(r, "witch_swamp", 9, [ref("cc:complete", "gate", "社区中心修复")], { sub: "法师任务之后" });
  }

  // —— 社区中心 ——
  const cc = lane("cc", "社区中心", "世界进度", 80);
  const ROOM_TO = {
    工艺室: { area: "quarry", col: 5 }, 金库: { area: "desert", col: 5 },
    茶水间: { feature: "greenhouse" }, 锅炉房: { feature: "minecarts" },
  };
  const BUNDLE_ICON = ["Bundle_Green.png", "Bundle_Yellow.png", "Bundle_Orange.png", "Bundle_Teal.png", "Bundle_Red.png", "Bundle_Purple.png"];
  for (const room of D.bundles.filter((r) => r.room !== "废弃Joja超市")) {
    const r = row(cc, "room:" + room.room, room.room, null);
    add(r, {
      id: "room:" + room.room, kind: "room", col: 0, title: room.room, icon: BUNDLE_ICON[App.ROOMS.indexOf(room.room) % 6],
      sub: `${room.bundles.length} 个收集包`, place: "社区中心", room: room.room,
      state: { type: "room", room: room.room, text: `完成${room.room}` },
      unlocks: room.bundles.slice(0, 3).map((b) => unlockOf(b.items[0]?.id || b.items[0]?.zh)),
      info: { what: room.bundles.map((b) => b.name).join("、"), source: "收集包" },
    });
    const feature = ROOM_TO[room.room]?.feature && D.progression.features.find((f) => f.id === ROOM_TO[room.room].feature);
    add(r, {
      id: "reward:" + room.room, kind: "reward", col: 2.5, title: room.reward, icon: null, sub: "房间奖励",
      state: "derived", reqs: [ref("room:" + room.room, "gate")], place: "社区中心",
      info: feature ? { quote: feature.quote, source: feature.source, note: `Joja 路线：${feature.joja}` } : { source: "收集包" },
    });
    const to = ROOM_TO[room.room];
    if (to && to.area) {
      areaNode(r, to.area, to.col, [ref("reward:" + room.room, "gate")], { sub: room.reward });
      if (to.area === "desert") {
        add(r, { id: "area:skull_cavern", kind: "area", col: 7.5, title: "骷髅洞穴", icon: "Skull_Key.png", place: "沙漠", area: "skull_cavern",
          state: "derived", reqs: [ref("area:desert", "gate"), ref("mine:120", "gate", "头骨钥匙")], sub: "沙漠 + 头骨钥匙",
          info: { quote: A.skull_cavern.quote, source: A.skull_cavern.source } });
      }
    }
  }
  {
    const r = row(cc, "cc:after", "修复之后", null);
    add(r, { id: "cc:complete", kind: "milestone", col: 6, title: "社区中心修复", icon: "Golden_Walnut.png", sub: "完成全部 6 个房间",
      state: "derived", reqs: App.ROOMS.map((room) => ref("room:" + room, "converge")), place: "社区中心",
      info: { what: "也可以走 Joja 路线：在 Joja 社区发展申请书里买下全部项目。", source: "社区中心" } });
    const boat = D.progression.boat;
    add(r, { id: "boat", kind: "milestone", col: 8, title: "威利的船", icon: "Battery_Pack.png", place: "鱼店",
      sub: matsText(boat.materials), state: { type: "flag", flag: "boat_repaired", text: "船已修好" },
      reqs: [ref("cc:complete", "gate")], materials: boat.materials,
      info: { quote: A.ginger_island.quote, source: "姜岛", action: `在鱼店里屋交付 ${matsText(boat.materials)}` } });
    areaNode(r, "ginger_island", 10, [ref("boat", "gate")], { sub: `船票 ${money(boat.ticket)}`, icon: "Golden_Walnut.png", place: "鱼店" });
  }

  // —— 农场建筑 ——
  const farm = lane("farm", "农场建筑", "世界进度", 80);
  const chainCols = { 农舍: [0, 3, 6, 9], 鸡舍: [1, 4, 7], 畜棚: [1, 4, 7], 小屋: [1, 4] };
  for (const ch of App.BUILDING_CHAINS) {
    const r = row(farm, "bld:" + ch.chain, ch.chain, ch.tiers[0].image);
    ch.tiers.forEach((b, i) => {
      const unlocks = [];
      for (const m of (b.description || "").matchAll(/解锁([^。，\n]+)/g)) {
        for (const animal of m[1].split(/和|、/)) {
          const page = D.pages[animal.trim()];
          unlocks.push({ z: animal.trim(), i: page && page.i, pg: page ? animal.trim() : null });
        }
      }
      const label = b.name.replace(/^农舍（(.+)）$/, "$1");
      add(r, {
        id: `bld:${ch.chain}:${i}`, kind: "building", col: (chainCols[ch.chain] || [0, 3, 6, 9])[i], title: label === b.name ? b.name : label,
        icon: b.image, place: i || ch.chain !== "农舍" ? "木匠的商店" : "农舍",
        sub: b.cost ? `${money(b.cost)}${b.materials.length ? " · " + matsText(b.materials) : ""}` : (b.cost_text || ""),
        state: ch.chain === "农舍" && i === 0 ? "always" : { type: "building", chain: ch.chain, tier: i, text: `建好${b.name}` },
        reqs: i ? [ref(`bld:${ch.chain}:${i - 1}`, "upgrade")] : [], materials: b.materials, cost: b.cost,
        unlocks,
        info: { what: (b.description || "").replace(/^由.+?升级\s*/, ""), action: b.cost ? `向罗宾支付 ${money(b.cost)}${b.materials.length ? "，材料 " + matsText(b.materials) : ""}${b.build_days ? `，建造 ${b.build_days} 天` : ""}` : null, source: b.page },
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

  const BADGE = { done: "✓", ready: "下一步", locked: "未满足", unknown: "?" };
  function refresh() {
    if (!built) return;
    const S = App.spoilers;
    const lit = selected ? App.progression.ancestors(selected) : null;
    const after = selected ? App.progression.descendants(selected) : null;
    const placeholders = new Set();
    for (const [r, label] of rowEls) {
      const shown = r.nodes.some(S.node);
      label.replaceChildren(shown && S.textAllowed(r.name) ? r.name : "未探索路线");
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
        node.append(el("span", { class: "n-title" }, "后续内容"), el("span", { class: "n-sub" }, "点击选择查看"));
        node.setAttribute("aria-label", "后续内容，点击选择是否查看");
        continue;
      }
      if (n.kind === "skill") {
        const unlocks = n.unlocks.filter(u => S.canView({ type: u.id ? "item" : "page", id: u.id || u.z }));
        node.append(el("span", { class: "n-title" }, n.short), el("span", { class: "n-unlocks" }, unlocks.slice(0, 4).map(u => img(u.i, null, u.z))));
      } else {
        // 特殊里程碑的图标也可能提前透露奖励。
        const iconSafe = !S.active() || !["milestone", "area", "reward"].includes(n.kind);
        node.append(iconSafe && n.icon ? img(n.icon, "icon") : el("span", { class: "icon" }),
          el("span", { class: "n-title" }, n.title), el("span", { class: "n-sub" }, S.textAllowed(n.sub) ? n.sub || "" : "详细条件按需查看"));
      }
      node.append(el("span", { class: "badge", "aria-hidden": "true" }));
      node.className = `node ${n.kind} ${App.conditionsActive() ? "s-" + st : "s-reference"}`;
      node.querySelector(".badge").textContent = App.conditionsActive() ? BADGE[st] : "";
      node.setAttribute("aria-label", App.conditionsActive() ? `${n.title}：${{ done: "已完成", ready: "前置条件满足", locked: "条件未满足", unknown: "未确认" }[st]}` : `${n.title}，查看材料与前置关系`);
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
    build, refresh, fit, focusNode, focusLane,
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
