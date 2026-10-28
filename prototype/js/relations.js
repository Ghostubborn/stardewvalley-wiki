// 关系图的数据：以一个条目为中心，两侧列出分好组的关系——物品的来源与用途、居民的住处与礼物、
// 地点里能找到的东西、怪物的出没与掉落、动物的住处与产物。只用已有的索引（配方、用途、商店、掉落、收集包、
// 送礼、获取途径），不另外下载数据；防剧透在绘制时逐个节点处理。
// 节点：{ ref, label, icon, qty, note }，ref 为空的是不能点开的文字（“任意鱼”、Wiki 原文里的来源）。
// 分组：{ kind, edge, label, via, note, nodes, chain }。edge 决定连线的样式：make 制作与加工、buy 购买、
// find 采集掉落与出没、gift 送礼、bundle 收集包、link 其他关联。chain 是可以展开成整条合成链的原料。
(function () {
  const App = window.App, D = App.D, EN = App.EN, t = App.t, N = App.N;
  const KIND = { crafting: t("打造"), cooking: t("烹饪"), processing: t("加工"), tailoring: t("裁缝") };

  // 条目名 → 详情引用：鱼、居民、地点、物品各有详情页，其余是普通条目。
  function titleRef(title) {
    if (App.fishByName.has(title)) return { type: "fish", id: title };
    if (App.villagerByName.has(title)) return { type: "villager", id: title };
    if (App.locationByName.has(title)) return { type: "location", id: title };
    const id = D.pages[title]?.id;
    return id && D.items[id] ? { type: "item", id } : { type: "page", id: title };
  }
  const villagerIcon = name => App.villagerByName.get(name)?.i || null;
  // 地点多数没有自己的图标，借用第一位住户的头像；iconRef 记下借的是谁，住户受保护时绘制时不显示头像。
  function placeIcon(title) {
    const loc = App.locationByName.get(title), occ = loc?.occ?.[0];
    if (occ && villagerIcon(occ)) return { icon: villagerIcon(occ), iconRef: titleRef(occ) };
    return { icon: loc?.i || D.pages[title]?.i || villagerIcon(title) };
  }
  function pageNode(title, extra) {
    const own = App.monsterByName.get(title)?.i || App.animalByName.get(title)?.i || App.fishByName.get(title)?.i;
    return { ref: titleRef(title), label: N(title), ...(own ? { icon: own } : placeIcon(title)), ...extra };
  }
  function itemNode(idOrZh, extra = {}) {
    const it = App.itemInfo(idOrZh) || { z: idOrZh };
    if (extra.generic) return { ref: null, label: N(it.z), generic: true, ...extra };
    const ref = it.id ? { type: "item", id: it.id } : D.pages[it.z] ? titleRef(it.z) : null;
    return { ref, label: App.itemName(it), icon: it.i, ...extra };
  }
  const villagerNode = (name, extra) => ({ ref: { type: "villager", id: name }, label: N(name), icon: villagerIcon(name), ...extra });
  const bundleNode = (room, bundle, extra) => ({ ref: { type: "bundle", id: `${room}:${bundle.name}` }, label: N(bundle.name), icon: "Bundle_Green.png", ...extra });
  const textNode = (label, extra) => ({ ref: null, label, ...extra });
  const stations = list => (list || []).length ? App.list(list.map(s => App.nameOf(s.id || s.z)), t("或")) : null;
  const price = (cost, currency) => (cost != null ? App.money(cost, currency) : null);

  // Wiki 列出的来源：墙纸、服装等按件取合集页表格；条目写的就是这件物品时取信息框的来源。
  // 与购买途径重复的商店、已经列出的怪物、动物和树不再列出（详情列表和关系图共用）。
  const CREATURE_TAIL = EN ? /^(?:e?s)?(?: drops?)?(?:\s*\(.*\))?$/i : /^(?:掉落物?)?\s*(?:[（(].*[）)])?$/;
  function creatureIn(entry) {
    let best = null, size = 0;
    for (const title of [...App.monsterByName.keys(), ...App.animalByName.keys()]) {
      const name = N(title);
      if (name.length > size && entry.startsWith(name) && CREATURE_TAIL.test(entry.slice(name.length))) { best = title; size = name.length; }
    }
    return best;
  }
  function itemSources(it, paths) {
    const page = App.pageInfo(it.pg) || {};
    const itemSrc = (EN ? EN.isrc?.[it.id] : it.src) || [];
    const pageAbout = !!it.id && D.pages[it.pg]?.id === it.id;
    const shops = paths.filter(p => p.kind === "buy").map(p => N(p.shop || p.where)).filter(Boolean);
    const creatures = new Set(paths.flatMap(p => [...(p.monsters || []), ...(p.animals || [])]).map(x => x.title));
    const trees = new Set(paths.flatMap(p => p.trees || []).map(N));
    return (itemSrc.length ? [["source", itemSrc]] : pageAbout || !paths.length ? page.src || [] : [])
      .map(([key, entries]) => [key, entries.filter(x => !shops.some(name => x.startsWith(name)) && !creatures.has(creatureIn(x)) && !trees.has(x))])
      .filter(([, entries]) => entries.length);
  }
  // 原文来源能对上条目名（或“怪物名（几率）”）时可以点开，其余照原文显示。
  function sourceNode(text) {
    const entry = text.trim();
    const title = D.pages[entry] ? entry : App.locationByName.has(entry) ? entry : creatureIn(entry);
    const item = !title && App.itemInfo(entry);
    if (title) return { ...pageNode(title), label: entry };
    if (item?.id) return itemNode(item.id);
    return textNode(entry);
  }

  // —— 物品：左边怎么来，右边做什么 ——
  function itemRelations(it) {
    const left = [], right = [], buys = [];
    const paths = App.acquisitions(it.id, it.z);
    for (const p of paths) {
      const reqs = (p.reqs || []).filter(r => r.text && !["recipe", "equipment", "cooking_access", "info"].includes(r.type)).map(r => r.text);
      const time = EN ? p.recipe && App.pageInfo(p.recipe.out.pg)?.f?.crafttime : p.time;
      if (["crafting", "cooking", "processing"].includes(p.kind)) {
        left.push({ kind: p.kind, edge: "make", label: p.label, via: stations(p.stations), note: App.clauses([...reqs, time && t("耗时 {time}", { time })]) || null,
          nodes: p.inputs.map(x => itemNode(x.id || x.z, { qty: x.q, generic: x.g })), chain: p.inputs });
      } else if (p.kind === "tailoring") {
        left.push({ kind: p.kind, edge: "make", label: p.label, via: stations(p.stations), note: t("1 块布料加下列任一物品"), nodes: p.options.map(id => itemNode(id)) });
      } else if (p.kind === "upgrade") {
        const ct = App.chainByItem.get(it.id), prev = ct && ct.chain.tiers[ct.tier - 1];
        left.push({ kind: p.kind, edge: "make", label: p.label, via: N(p.where), note: App.clauses([price(p.cost, p.currency), p.note]) || null,
          nodes: [prev && itemNode(prev.id || prev.zh, { note: t("上一级") }), ...p.inputs.map(x => itemNode(x.id || x.z, { qty: x.q }))].filter(Boolean), chain: p.inputs });
      } else if (p.kind === "grow") {
        left.push({ kind: p.kind, edge: "make", label: p.label, note: App.clauses(p.checks.map(c => c.text)) || null, nodes: p.inputs.map(x => itemNode(x.id || x.z)) });
      } else if (p.kind === "produce") {
        left.push({ kind: p.kind, edge: "make", label: p.label, via: stations(p.stations), nodes: (p.refs || []).map(id => itemNode(id)) });
      } else if (p.kind === "drop") {
        left.push({ kind: p.kind, edge: "find", label: p.label, nodes: p.monsters.map(m => pageNode(m.title, { note: m.note })) });
      } else if (p.kind === "animal") {
        left.push({ kind: p.kind, edge: "find", label: p.label, nodes: p.animals.map(a => pageNode(a.title)) });
      } else if (p.kind === "tapper") {
        left.push({ kind: p.kind, edge: "find", label: p.label, via: App.nameOf("(BC)105"), nodes: p.trees.map(title => pageNode(title)) });
      } else if (p.kind === "buy") {
        buys.push(p);
      } else if (p.kind === "reward") {
        const rewards = D.bundles.flatMap(room => room.bundles.filter(b => (b.reward || []).some(x => x.id === it.id)).map(b => ({ room: room.room, bundle: b })));
        if (!left.some(g => g.kind === "reward")) left.push({ kind: "reward", edge: "bundle", label: p.label, nodes: rewards.map(r => bundleNode(r.room, r.bundle, { note: N(r.room) })) });
      } else {
        // 采集、开局自带：没有可以点开的对象，只写说明。
        left.push({ kind: p.kind, edge: "find", label: p.label, nodes: [textNode(p.note || p.checks?.[0]?.text || p.label)] });
      }
    }
    if (buys.length) left.push({ kind: "buy", edge: "buy", label: t("购买"), nodes: buys.map(p => {
      const title = [p.shop, p.where].find(x => x && (D.pages[x] || App.locationByName.has(x) || App.villagerByName.has(x)));
      const note = p.barter?.length ? App.matsText(p.barter.map(b => ({ id: b.id, zh: b.z, qty: b.q }))) : price(p.cost, p.currency);
      return title ? { ...pageNode(title), label: N(p.shop || title), note } : textNode(N(p.shop || p.where || t("商店")), { note });
    }) });
    const LABEL = { as: t("远古斑点"), md: t("由怪物掉落"), os: t("其他来源"), source: t("Wiki 列出的来源") };
    // 原文来源只写了“打造”“烹饪”这类做法名、上面已有同名分组时不再重复。
    for (const [key, entries] of itemSources(it, paths)) {
      const rest = entries.filter(x => !left.some(g => g.label === x.trim()));
      if (rest.length) left.push({ kind: "source", edge: "find", label: LABEL[key] || key, nodes: rest.map(sourceNode) });
    }
    const page = App.pageInfo(it.pg) || {};
    if (!left.length && page.ob?.length) left.push({ kind: "source", edge: "find", label: LABEL.source, nodes: page.ob.map(sourceNode) });

    // 用途：按配方类型分组，加工再按设备分；同一设备做出的同类带口味产物（熏鱼、针对性鱼饵）合成一项。
    const groups = new Map();
    for (const r of it.id ? App.usedIn.get(it.id) || [] : []) {
      const station = r.k === "processing" ? r.st?.[0] : null;
      const key = r.k + ":" + (station?.id || station?.z || "");
      if (!groups.has(key)) groups.set(key, { kind: r.k, edge: "make", label: KIND[r.k] || t("制作"), via: station ? App.nameOf(station.id || station.z) : r.k === "tailoring" ? App.nameOf("缝纫机") : null, recipes: [] });
      groups.get(key).recipes.push(r);
    }
    for (const g of groups.values()) {
      g.nodes = outputs(g.recipes, it.id);
      delete g.recipes;
      right.push(g);
    }
    const seed = D.seeds.find(s => s.id === it.id);
    if (seed?.crop) right.push({ kind: "grow", edge: "make", label: t("种出"), nodes: [itemNode(seed.crop.id || seed.crop.z)] });
    const bundles = it.id ? App.bundleUse.get(it.id) || [] : [];
    if (bundles.length) right.push({ kind: "bundle", edge: "bundle", label: t("收集包"), nodes: bundles.map(b => {
      const qty = b.bundle.items.find(x => x.id === it.id)?.qty;
      return bundleNode(b.room, b.bundle, { note: App.clauses([N(b.room), qty > 1 && t("需要 {n} 个", { n: qty })]) });
    }) });
    const gifts = it.id && App.giftsByItem.get(it.id);
    if (gifts?.love.length) right.push({ kind: "love", edge: "gift", label: t("最爱这件礼物"), nodes: gifts.love.map(name => villagerNode(name)) });
    if (gifts?.like.length) right.push({ kind: "like", edge: "gift", label: t("喜欢这件礼物"), nodes: gifts.like.map(name => villagerNode(name)) });
    const head = [it.c && t(it.c), it.p ? t("售价 {price}", { price: App.money(it.p) }) : null].filter(Boolean).join(" · ");
    return {
      center: { label: App.itemName(it), icon: it.i, sub: head },
      left: { title: t("怎么来"), groups: left }, right: { title: t("做什么"), groups: right },
    };
  }
  // 用这件物品做出的东西：几个配方做出同一件时合成一项；同一设备的带口味产物超过两种时收成一项，点开再列出。
  function outputs(recipes, inputId) {
    const nodes = [], seen = new Map(), families = new Map();
    for (const r of recipes) {
      const need = r.in.find(x => x.id === inputId)?.q || 1;
      const key = r.out.id || "zh:" + r.out.z;
      if (seen.has(key)) continue;
      const node = itemNode(r.out.id || r.out.z, { note: need > 1 ? t("用 {n} 个", { n: need }) : null });
      seen.set(key, node);
      const base = r.out.id?.includes("/") ? r.out.id.split("/")[0] : null;
      if (base) (families.get(base) || families.set(base, []).get(base)).push(node);
      else nodes.push(node);
    }
    for (const members of families.values()) {
      if (members.length < 3) { nodes.push(...members); continue; }
      // 同一设备里不带口味的那一项（“熏鱼”“针对性鱼饵”）就是这一类的名称；收成一项，点开再列出各种口味。
      const generic = recipes.find(r => !r.out.id && r.out.z);
      const head = generic && seen.get("zh:" + generic.out.z);
      const family = { ref: head?.ref || null, label: head ? head.label : t("{name}等", { name: members[0].label }), icon: head?.icon || members[0].icon,
        note: t("{n} 种", { n: members.length }), family: head ? [head, ...members] : members };
      const at = head ? nodes.indexOf(head) : -1;
      if (at >= 0) nodes.splice(at, 1, family); else nodes.push(family);
    }
    return nodes;
  }

  function fishRelations(f) {
    const it = App.itemInfo(f.id) || { z: f.p };
    const rel = itemRelations({ ...it, z: it.z || f.p });
    const places = App.fishHabitats(f).map(h => {
      const base = [h.location, h.location.replace(/河流$/, "")].find(x => D.pages[x] || App.locationByName.has(x));
      const node = base ? pageNode(base) : textNode(App.habitatName(h.location));
      return { ...node, label: App.habitatName(h.location), note: App.list((h.seasons || []).map(s => App.SEASON_ZH[s]).filter(Boolean)) || null };
    });
    if (places.length) rel.left.groups.unshift({ kind: "fishing", edge: "find", label: App.fishMethod(f) === "crab" ? t("蟹笼") : t("钓鱼"), nodes: places });
    rel.center = { label: N(f.p), icon: f.i, sub: t("鱼 · 售价 {price}", { price: App.money(f.pr) }) };
    return rel;
  }

  // —— 居民：左边住处、家人和日程里会去的地方，右边送礼 ——
  function scheduleLinks(name) {
    const out = new Set();
    // 日程原文里也会链到其他居民（“和玛鲁聊天”），这里只要地点和活动。
    for (const g of D.schedules?.[name]?.groups || []) for (const row of g.rows) for (const link of row.links || []) {
      if (link !== name && D.pages[link] && !App.villagerByName.has(link) && !D.pages[link].id) out.add(link);
    }
    return [...out];
  }
  function villagerRelations(name) {
    const v = App.villagerByName.get(name);
    if (!v) return null;
    const left = [], right = [];
    const homes = D.locations.filter(l => (l.occ || []).includes(name)).map(l => pageNode(l.p));
    if (homes.length) left.push({ kind: "home", edge: "link", label: t("住处"), nodes: homes });
    if (v.fam?.length) left.push({ kind: "family", edge: "link", label: t("家人"), nodes: v.fam.map(n => villagerNode(n)) });
    const places = scheduleLinks(name).filter(title => !homes.some(h => h.ref.id === title));
    if (places.length) left.push({ kind: "schedule", edge: "link", label: t("日程里会去"), nodes: places.map(title => pageNode(title)) });
    if (v.love.length) right.push({ kind: "love", edge: "gift", label: t("最爱的礼物"), nodes: v.love.map(id => itemNode(id)) });
    if (v.like.length) right.push({ kind: "like", edge: "gift", label: t("喜欢的礼物"), nodes: v.like.map(id => itemNode(id)) });
    const shop = D.shops.find(s => s.p === name);
    if (shop?.stock.length) right.push(sellGroup(shop));
    const bd = v.bd ? t("{season} {day} 日", { season: App.SEASON_ZH[v.bd.season], day: v.bd.day }) : null;
    return {
      center: { label: N(name), icon: v.i, sub: bd ? t("生日：{date}", { date: bd }) : "" },
      left: { title: t("住处与家人"), groups: left }, right: { title: t("礼物"), groups: right },
    };
  }
  function sellGroup(shop) {
    return { kind: "sell", edge: "buy", label: t("出售"), nodes: shop.stock.map(e => itemNode(e.id || e.z, {
      note: e.bt?.length ? App.matsText(e.bt.map(x => ({ id: x.id, zh: x.z, qty: x.q }))) : price(e.pr, e.cur) })) };
  }

  // —— 地点：左边住在这里的人和相关解锁，右边出售的东西、能钓的鱼、出没的怪物 ——
  function placeRelations(name) {
    const left = [], right = [];
    const loc = App.locationByName.get(name);
    // 住户里也有不是居民的（老师傅香炸奶酪卷、达斯迪、沙漠商人），按条目链接；没有条目的只写名字。
    const resident = n => App.villagerByName.has(n) ? villagerNode(n) : D.pages[n] ? pageNode(n) : textNode(N(n));
    if (loc?.occ?.length) left.push({ kind: "people", edge: "link", label: t("住在这里"), nodes: loc.occ.filter(n => n !== name).map(resident) });
    const unlocks = App.progression ? [...App.progression.nodes.values()].filter(n => n.place === name) : [];
    if (unlocks.length) left.push({ kind: "unlock", edge: "link", label: t("相关升级与解锁"), nodes: unlocks.map(n => ({ ref: { type: "node", id: n.id }, label: n.name || n.title, icon: n.icon || App.itemInfo(n.itemId)?.i })) });
    const shop = D.shops.find(s => s.p === name || (name === "下水道" && s.p === "科罗布斯"));
    if (shop?.stock.length) right.push(sellGroup(shop));
    const fish = D.fish.filter(f => (f.L || []).some(l => l === name || l === name + "河流"));
    if (fish.length) right.push({ kind: "fish", edge: "find", label: t("能钓到的鱼"), nodes: fish.map(f => ({ ref: { type: "fish", id: f.p }, label: N(f.p), icon: f.i })) });
    const monsters = (D.monsters || []).filter(m => (m.L || []).includes(name));
    if (monsters.length) right.push({ kind: "monster", edge: "find", label: t("出没的怪物"), nodes: monsters.map(m => pageNode(m.p)) });
    const page = App.pageInfo(name) || {};
    return {
      center: { label: N(name), ...placeIcon(name), sub: page.kz || "" },
      left: { title: t("人与解锁"), groups: left }, right: { title: t("在这里能找到"), groups: right },
    };
  }

  // —— 怪物：左边出没地点和变种，右边掉落物（说明文字开新的一组，只管它后面的物品）——
  const TABLE_REF = /表格|见变种|\btables?\b/i;
  function monsterRelations(title) {
    const m = App.monsterByName.get(title), info = App.monsterInfo(m);
    const left = [], right = [];
    const places = (m.L || []).filter(name => D.pages[name] || App.locationByName.has(name));
    if (places.length) left.push({ kind: "where", edge: "find", label: t("出没地点"), nodes: places.map(name => pageNode(name)) });
    if (m.vr?.length && m.vr.every(v => App.monsterByName.has(v))) left.push({ kind: "variant", edge: "link", label: t("变种"), nodes: m.vr.map(v => pageNode(v)) });
    let group = null;
    for (const d of info.dr) {
      if (d.t) { group = TABLE_REF.test(d.t) ? null : { kind: "drop", edge: "find", label: d.t.replace(/[:：]\s*$/, ""), nodes: [] }; if (group) right.push(group); continue; }
      if (!group) right.push(group = { kind: "drop", edge: "find", label: t("掉落物"), nodes: [] });
      group.nodes.push(d.id ? itemNode(d.id, { note: d.n || null }) : textNode(EN ? d.e : d.z, { note: d.n || null }));
    }
    // 信息框模板给每种有掉落物的怪物都附上这两项（钻石、五彩碎片）。
    if (info.dr.length) right.push({ kind: "drop", edge: "find", label: t("到达过矿井底部后"), nodes: ["(O)72", "(O)74"].map(id => itemNode(id, { note: "0.05%" })) });
    const page = App.pageInfo(title) || {};
    return {
      center: { label: N(title), icon: m.i || D.pages[title]?.i, sub: page.kz || "" },
      left: { title: t("在哪里遇到"), groups: left }, right: { title: t("掉落物"), groups: right },
    };
  }

  // —— 动物：左边居住建筑和购买途径，右边产物 ——
  function animalRelations(title) {
    const a = App.animalByName.get(title);
    const left = [], right = [];
    const homes = (a.h || []).map(h => ({ ...pageNode(h.pg || h.z), label: N(h.z) }));
    if (homes.length) left.push({ kind: "home", edge: "link", label: t("居住建筑"), nodes: homes });
    const buys = App.acquisitions(null, title).filter(p => p.kind === "buy");
    if (buys.length) left.push({ kind: "buy", edge: "buy", label: t("购买"), nodes: buys.map(p => ({ ...pageNode(p.shop || p.where), label: N(p.shop || p.where), note: price(p.cost, p.currency) })) });
    const produce = (a.pr || []).map(x => typeof x === "string" ? itemNode(x) : x.pg && D.pages[x.pg] ? { ...pageNode(x.pg), label: EN ? x.e : x.z, icon: x.i } : textNode(EN ? x.e : x.z, { icon: x.i }));
    if (produce.length) right.push({ kind: "produce", edge: "make", label: t("产物"), nodes: produce });
    const page = App.pageInfo(title) || {};
    return {
      center: { label: N(title), icon: a.i || D.pages[title]?.i, sub: page.kz || "" },
      left: { title: t("饲养"), groups: left }, right: { title: t("产物"), groups: right },
    };
  }

  // 合成链：每种中间材料按第一种做法展开到原料（和材料树相同），并注明别的做法。
  function relationChain(inputs) {
    const tree = App.materialTree(inputs);
    (function mark(nodes) {
      for (const n of nodes) {
        if (!n.children) continue;
        const list = App.recipesByOut.get(n.id) || [];
        const used = list.find(r => r.k === "processing") || list.find(r => r.k === "crafting");
        n.alt = list.filter(r => r !== used && r.k !== "tailoring").map(r => `${KIND[r.k]}（${App.matsText(r.in.map(x => ({ id: x.id, zh: x.z, qty: x.q })))}）`);
        mark(n.children);
      }
    })(tree);
    return { tree, totals: [...App.rawTotals(tree).values()], deep: tree.some(n => n.children) };
  }

  // 同一次渲染里会问好几次（切换按钮、关系图、地址栏），结果记在 App.cache；数据或设置一变就清空。
  function relations(ref) {
    if (!ref) return null;
    const memo = App.cache.relations || (App.cache.relations = new Map()), key = ref.type + ":" + ref.id;
    if (!memo.has(key)) memo.set(key, compute(ref));
    return memo.get(key);
  }
  function compute(ref) {
    let rel = null;
    if (ref.type === "item") { const it = App.itemInfo(ref.id); rel = it && itemRelations(it); }
    else if (ref.type === "fish") { const f = App.fishByName.get(ref.id); rel = f && fishRelations(f); }
    else if (ref.type === "villager") rel = villagerRelations(ref.id);
    else if (ref.type === "location") rel = placeRelations(ref.id);
    else if (ref.type === "page" && D.pages[ref.id]) {
      rel = App.monsterByName.has(ref.id) ? monsterRelations(ref.id) : App.animalByName.has(ref.id) ? animalRelations(ref.id)
        : D.pages[ref.id].id ? null : placeRelations(ref.id);
    }
    if (!rel) return null;
    for (const side of [rel.left, rel.right]) side.groups = side.groups.filter(g => g.nodes.length);
    return rel.left.groups.length + rel.right.groups.length ? rel : null;
  }

  Object.assign(App, { titleRef, relations, relationChain, itemSources });
})();
