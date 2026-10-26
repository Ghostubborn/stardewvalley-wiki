/* Category-specific reading surfaces, using the game's artwork and menu patterns.
   Collection progress reflects only the player's explicit submission records. */
(function () {
  "use strict";
  const A = window.App, D = A.D, { el, img } = A;
  const safe = (text, fallback = "详细条件按需查看") => A.spoilers.textAllowed(text) ? text : fallback;
  const note = text => el("span", { class: "catalog-note" }, text);
  const open = ref => A.select(ref, { from: "browse" });
  const refButton = (row, cls, ...content) => el("button", {
    type: "button", class: cls, dataset: { record: row.ref.type + ":" + row.ref.id }, onclick: () => open(row.ref),
  }, ...content);
  function itemData(value) {
    const it = A.itemInfo(value.id || value.z || value.zh) || { z: value.z || value.zh || "物品" };
    const ref = it.id ? { type: "item", id: it.id } : { type: "page", id: it.z };
    return { it, ref, allowed: A.spoilers.canView(ref) };
  }
  function itemSlot(value, cls = "") {
    const { it, ref, allowed } = itemData(value);
    const qty = value.qty ?? value.q ?? 1;
    const quality = { gold: "金星品质", silver: "银星品质", iridium: "铱星品质" }[value.quality];
    const label = allowed ? it.z : "后续物品 · 按需查看";
    return el("button", { type: "button", class: "catalog-slot " + cls, onclick: () => open(ref),
      "aria-label": label + (qty > 1 ? `，${qty} 个` : "") + (quality ? `，${quality}` : "") },
      el("span", { class: "slot-art" }, allowed ? img(it.i) : el("span", { class: "concealed-slot", "aria-hidden": "true" }, "?"),
        qty > 1 ? el("span", { class: "slot-qty" }, String(qty)) : null,
        quality ? el("span", { class: "slot-quality " + value.quality, title: quality, "aria-label": quality }, "★") : null),
      el("span", { class: "slot-label" }, label));
  }
  function seasons(values) {
    const shown = values?.includes("all") ? A.SEASONS : A.SEASONS.filter(s => values?.includes(s));
    const icons = { spring: "Spring.png", summer: "Summer.png", fall: "Fall.png", winter: "Winter.png" };
    return el("span", { class: "season-chips", "aria-label": shown.length ? "季节：" + shown.map(s => A.SEASON_ZH[s]).join("、") : "季节见详情" },
      shown.length ? shown.map(s => el("span", { class: "season-chip", title: A.SEASON_ZH[s] }, img(icons[s]), A.SEASON_ZH[s])) : "季节见详情");
  }
  function groups(rows, key) {
    const result = new Map();
    for (const r of rows) { const k = key(r); if (!result.has(k)) result.set(k, []); result.get(k).push(r); }
    return result;
  }
  function section(title, cls, children, description) {
    return el("section", { class: "catalog-section" }, el("h3", { class: "catalog-section-title" }, title),
      description ? el("p", { class: "catalog-intro" }, description) : null, el("div", { class: cls }, children));
  }

  function fish(rows) {
    return [...groups(rows, r => r.type)].map(([type, list]) => section(({ rod: "鱼类图鉴", crab: "蟹笼收获", forage: "海滩采集" })[type], "fish-collection", list.map(row => {
      const f = A.fishByName.get(row.label);
      return refButton(row, "fish-specimen", el("span", { class: "fish-art" }, img(row.icon)),
        el("strong", null, row.label), seasons(row.seasons),
        note(type === "forage" ? "海滩采集，不用钓竿" : safe(f.tt || (f.crab ? "放置蟹笼后收取" : "时间见详情"))),
        note(A.fishLocations(f).filter(name => A.spoilers.textAllowed(name)).join(" · ") || "水域见详情"));
    }), "选择一条鱼，查看水域、天气和钓鱼条件。"));
  }

  function villagers(rows) {
    return [el("div", { class: "social-register" }, rows.map(row => {
      const v = A.villagerByName.get(row.label);
      // Prefer explicitly listed favourites; never let a resident reveal a later item.
      const gifts = [...new Set([...(v.fav || []), ...v.love])].filter(id => A.spoilers.canView({ type: "item", id })).slice(0, 3);
      const birthday = v.bd ? el("span", { class: "birthday-stamp" }, el("span", null, A.SEASON_ZH[v.bd.season]),
        el("strong", null, String(v.bd.day)), el("span", null, "生日")) : note("生日未记录");
      return el("article", { class: "social-entry" },
        refButton(row, "social-person", img(v.portrait || row.icon, "social-portrait"),
          el("span", { class: "social-name" }, el("strong", null, row.label), note(row.type === "marriage" ? "可结婚" : "居民资料")), birthday),
        el("div", { class: "social-gifts" }, el("span", { class: "catalog-kicker" }, "最爱的礼物 · 节选"),
          gifts.length ? el("div", { class: "gift-slots" }, gifts.map(id => itemSlot({ id }))) : note("礼物偏好按需查看")));
    }))];
  }

  function farming(rows) {
    return [el("div", { class: "crop-almanac" }, rows.map(row => {
      const s = D.seeds.find(s => s.id === row.ref.id);
      const crop = s.crop && itemData(s.crop);
      return el("article", { class: "crop-entry" }, refButton(row, "crop-identity", img(s.i),
        el("span", null, el("strong", null, row.label), seasons(s.S))),
        el("div", { class: "crop-growth" }, el("span", { class: "crop-soil" }, img(s.i),
          el("span", { class: "growth-span" }, el("strong", null, s.g ? `${s.g} 天` : "条件见详情"), el("span", { "aria-hidden": "true" }, "→")),
          crop?.allowed ? img(crop.it.i) : el("span", { class: "concealed-slot", "aria-hidden": "true" }, "?")),
          note(crop?.allowed ? `收获 ${crop.it.z}` : "收获物见详情")),
        el("div", { class: "crop-facts" }, el("strong", null, row.type === "special" ? "特殊种植规则" : s.rg ? `每 ${s.rg} 天再收获` : "单次收获"),
          note(s.g ? "基础生长时间" : "生长规则见条目"), note(s.sell != null && crop?.allowed ? `基础售价 ${A.money(s.sell)}` : "")));
    })), el("p", { class: "catalog-intro" }, "天数按基础生长时间显示；肥料、职业和特殊种植规则见条目。")];
  }

  function inventory(rows) {
    const titles = { material: "物品背包", crafting: "制作与加工", cooking: "料理目录", decor: "家具与服饰" };
    return [...groups(rows, r => r.type)].map(([type, list]) => section(titles[type] || "物品目录", "inventory-grid", list.map(row => {
      const recipes = A.recipesByOut.get(row.ref.id) || [];
      return refButton(row, "inventory-slot", el("span", { class: "inventory-art" }, img(row.icon)),
        el("strong", null, row.label), note(recipes.length ? "查看材料与配方" : row.sub));
    })));
  }

  function upgrades(rows) {
    const nodes = A.progression.nodes;
    return [...groups(rows, r => nodes.get(r.ref.id).row)].map(([, list]) => {
      const first = nodes.get(list[0].ref.id), building = first.lane === "farm", gear = first.lane === "gear";
      const family = first.row.replace(/^(tool|bld):/, "");
      const title = ({ rod: "鱼竿", sprinkler: "洒水器" })[family] || family;
      const cards = list.map((row, index) => {
        const n = nodes.get(row.ref.id);
        const linked = index > 0 && n.paths.some(p => p.reqs.some(r => r.type === "node" && r.rel === "upgrade" && r.id === list[index - 1].ref.id));
        const materials = (n.materials || []).map(m => {
          const value = itemData(m); return value.allowed ? `${value.it.z} ×${m.qty || 1}` : "部分材料按需查看";
        });
        return el("li", { class: "upgrade-step", dataset: { linked: String(linked) } },
          refButton(row, "upgrade-offer" + (building ? " building-offer" : ""),
            el("span", { class: "upgrade-art" }, img(n.icon)), el("strong", null, n.title),
            n.cost ? el("span", { class: "offer-price" }, A.money(n.cost)) : note(safe(n.sub || "查看条件")),
            materials.length ? note(materials.join(" · ")) : null));
      });
      return el("section", { class: "upgrade-family" }, el("header", null, el("h3", null, title),
        note(gear ? "各档独立获取，选择查看条件" : building ? "建筑目录 · 选择查看材料与工期" : "铁匠铺升级 · 依次升级，每次 2 天")),
        el("ol", { class: "upgrade-track" }, cards));
    });
  }

  const roomIcons = { 工艺室: "Bundle_Green.png", 茶水间: "Bundle_Orange.png", 鱼缸: "Bundle_Teal.png",
    锅炉房: "Bundle_Red.png", 布告栏: "Bundle_Purple.png", 金库: "Bundle_Yellow.png" };
  function bundles(rows) {
    return [...groups(rows, r => r.type)].map(([room, list]) => {
      if (["mineral", "artifact"].includes(room)) return section(room === "mineral" ? "矿物陈列" : "古物陈列", "museum-shelf",
        list.map(row => refButton(row, "museum-specimen", img(row.icon), el("strong", null, row.label))));
      return section(room, "bundle-room", list.map(row => {
        const b = A.browse.bundle(row.ref.id).bundle;
        const progress = A.collections?.summary(room, b);
        const progressText = progress ? b.cost ? (progress.complete ? "已记录金币交付" : "金币交付尚未记录")
          : `已交记录 ${progress.submitted}/${progress.required} 项${progress.complete ? " · 已够要求" : ""}` : null;
        return el("article", { class: "bundle-sheet" }, refButton(row, "bundle-cover", img(roomIcons[room] || "Bundle_Green.png"),
          el("span", null, el("strong", null, b.name), note(b.cost ? "金币收集包" : b.choose ? `任选 ${b.slots} 项 · 共 ${b.items.length} 项可选` : `交付下列 ${b.slots || b.items.length} 项`),
            progress?.started ? el("span", { class: "bundle-progress", dataset: { complete: String(progress.complete) } }, progressText) : null)),
          b.cost ? el("div", { class: "bundle-gold" }, img("Gold.png"), el("strong", null, A.money(b.cost)))
            : el("div", { class: "bundle-slots" }, b.items.map(item => itemSlot(item))),
          el("p", { class: "bundle-footnote" }, "选择材料查来源 · 点击包名看详情"));
      }));
    });
  }

  function places(rows) {
    return [...groups(rows, r => r.type)].sort(([a], [b]) => (a === "shop" ? 0 : 1) - (b === "shop" ? 0 : 1))
      .map(([type, list]) => section(type === "shop" ? "镇上的商店" : "其他地点", "town-directory", list.map(row => {
      const l = A.locationByName.get(row.label), shop = D.shops.find(s => s.p === row.label);
      const residents = (l.occ || []).filter(name => A.spoilers.canView({ type: "villager", id: name }));
      const products = [...new Map((shop?.stock || []).filter(p => itemData(p).allowed).map(p => [p.id || p.z, p])).values()].slice(0, 3);
      return el("article", { class: "shop-sign" },
        refButton(row, "shop-heading", el("span", { class: "shop-art" }, img(l.i)),
          el("span", null, el("strong", null, row.label), note(row.type === "shop" ? "店铺资料" : "地点资料"))),
        el("dl", { class: "shop-hours" }, el("dt", null, "开放时间"), el("dd", null, safe(l.hours || "见地点说明")),
          residents.length ? [el("dt", null, "住在这里"), el("dd", null, residents.join("、"))] : []),
        products.length ? el("div", { class: "shop-stock" }, note("出售物品 · 节选"), el("div", { class: "gift-slots" }, products.map(p => itemSlot({ id: p.id, z: p.z })))) : null,
        l.x != null ? el("button", { type: "button", class: "btn shop-locate", onclick: () => { open(row.ref); A.setView("map"); A.map.focusPlace(l.p); } }, "在地图上找这里") : null);
    })));
  }

  const topics = {
    新手指南: ["起步", "第一天从哪里开始？"], 控制: ["起步", "移动、使用工具与菜单操作"], 物品栏: ["起步", "携带、整理和使用物品"],
    游戏内时间: ["日常", "一天怎样安排？"], 季节: ["日常", "换季前需要了解什么？"], 天气: ["日常", "天气会影响哪些活动？"],
    能量: ["日常", "体力如何消耗与恢复？"], 生命值: ["日常", "受伤和恢复的规则"],
    技能: ["探索", "经验、等级与职业选择"], 钓鱼攻略: ["探索", "抛竿和收鱼怎样操作？"], 友谊: ["探索", "聊天和送礼的基本规则"],
    合作: ["一起玩", "多人农场与合作方式"], 存档: ["一起玩", "进度怎样保存？"],
  };
  function basics(rows) {
    return [...groups(rows, r => topics[r.label]?.[0] || "查阅")].map(([title, list]) => section(title, "handbook-pages", list.map((row, index) =>
      refButton(row, "handbook-chapter", el("span", { class: "chapter-number", "aria-hidden": "true" }, String(index + 1).padStart(2, "0")),
        el("span", null, el("strong", null, row.label), note(topics[row.label]?.[1] || row.sub)),
        el("span", { class: "chapter-arrow", "aria-hidden": "true" }, "→")))));
  }
  const renderers = { fish, villagers, farming, items: inventory, upgrades, bundles, places, basics };
  A.browseViews = { render: (id, rows) => renderers[id](rows) };
})();
