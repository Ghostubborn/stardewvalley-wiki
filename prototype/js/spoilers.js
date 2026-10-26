/* 展示边界独立于游戏条件：可进入不等于已探索；单条查看不授权关联内容。 */
(function () {
  "use strict";
  const A = window.App, D = A.D, P = A.progression;
  const saved = A.state.spoilers;
  A.state.spoilers = { enabled: saved?.enabled !== false, known: Array.isArray(saved?.known) ? saved.known.filter(x => typeof x === "string") : [] };
  const revealed = new Set(); // 临时查看不写入个人进度或跨会话保留
  let memo = new Map(), blockedNames = null;
  const nodesByTitle = new Map(), nodesByItem = new Map();
  for (const n of P.nodes.values()) {
    nodesByTitle.set(n.title, n);
    if (n.itemId) nodesByItem.set(n.itemId, n);
  }
  const areaTitles = new Map(Object.values(A.AREAS).map(a => [a.title, a.id]));
  const publicTopics = new Set([...A.SKILLS.map(s => s.zh), "技能", "打造", "烹饪", "工具", "钓竿", "农作物", "建筑", "家具", "收集包", "任务", "金币", "新手指南", "控制", "游戏内时间", "季节", "天气", "能量", "生命值", "物品栏", "钓鱼攻略", "友谊", "合作", "存档"]);
  const places = {
    科罗布斯: "sewers", 矮人: "mines", 桑迪: "desert", 绿洲: "desert", 沙漠商人: "desert",
    雷欧: "ginger_island", 姜岛商人: "ginger_island", 贝啼: "ginger_island", 蜗牛教授: "ginger_island",
    岛屿办事处: "ginger_island", 火山地牢: "ginger_island", 女巫小屋: "witch_swamp",
  };
  // 这些内容即使到了同一地区，也需要玩家单独确认，不能由地区开放推断。
  const discoveries = new Set([
    "齐先生", "齐先生的核桃房", "赌场", "突变虫穴", "精通山洞", "精通", "顶峰", "完美", "电影院",
    "废弃Joja超市", "废弃的屋子", "Joja仓库", "树屋", "大树桩（地点）", "威利的船", "生锈的钥匙", "头骨钥匙",
    "金色核桃", "齐钻", "齐豆", "齐瓜", "银河之魂", "无限之刃", "无限之锤", "无限匕首", "谜之盒", "金色谜之盒",
    "神秘树", "神秘糖浆", "肯特", "锻造", "附魔", "祝尼魔小屋", "传送塔", "姜岛图腾柱", "魔法墨水", "黑暗护身符",
  ]);
  const lateTitle = /姜岛|火山|核桃|齐先生|齐钻|精通|完美|无限|银河|附魔|女巫|巫婆|金色谜之盒|失落|秘密纸条|秘密森林|骷髅|头骨钥匙|生锈的钥匙|传送塔|传送图腾|沙漠|下水道|海盗湾|宝石鸟|饕餮|锻造/;
  const storyType = /quest|event|achievement|monster|special/i;
  const earlySources = /皮埃尔|铁匠铺|木匠|玛妮|旅行货车|鱼店|星之果实酒吧|农场|鹈鹕镇|煤矿森林|沙滩|河流|海洋|深山|高山湖泊|初始|商店购买/;
  const protectedSource = /姜岛|火山|核桃|齐先生|齐钻|精通|完美|骷髅|巫婆|女巫|沙漠|下水道|科罗布斯|桑迪|矮人|秘密森林|特别任务|爱心事件|剧情|附魔|锻造/;

  function title(ref) {
    if (!ref) return "";
    if (ref.type === "node") return P.nodes.get(ref.id)?.title || "";
    if (ref.type === "area") return A.AREAS[ref.id]?.title || "";
    if (ref.type === "item") return A.itemInfo(ref.id)?.z || ref.id;
    if (ref.type === "bundle") return A.browse?.bundle(ref.id)?.bundle.name || "收集包";
    return ref.id;
  }
  const acknowledged = name => revealed.has(name) || A.state.spoilers.known.includes(name);
  const active = () => A.state.spoilers.enabled;
  function nodeBase(n) {
    if (n.area) return n.area === "mines" && (A.state.progress.mineDepth || 0) > 0;
    if (n.id === "date:mines") return true;
    // The two starting rods have no skill gate. Unknown progress must not hide
    // a beginner's basic controls or the shop's starter equipment.
    if (n.state?.type === "rod" && n.state.tier <= 1) return true;
    if (n.kind === "skill") return n.state.level <= Math.max(1, (A.state.progress.skills[n.state.skill] || 0) + 1);
    if (n.kind === "tool") return !n.state?.tier || n.state.tier <= Math.max(1, (A.state.progress.tools[n.state.family] || 0) + 1);
    if (n.id.startsWith("mine:")) return +n.id.split(":")[1] <= (A.state.progress.mineDepth || 0);
    if (["boat", "museum:60", "cc:complete", "shop:krobus"].includes(n.id)) return false;
    if (n.kind === "reward") return false;
    if (n.kind === "room") return true;
    if (n.kind === "building") return n.state === "always" || n.state.tier <= Math.max(0, (A.state.progress.buildings[n.state.chain] ?? -1) + 1);
    return P.status(n.id).status === "done" || P.status(n.id).status === "ready";
  }
  function nameBase(name) {
    if (acknowledged(name)) return true;
    const n = nodesByTitle.get(name);
    if (n) return nodeBase(n);
    if (publicTopics.has(name)) return true;
    if (areaTitles.has(name)) return areaTitles.get(name) === "mines" && (A.state.progress.mineDepth || 0) > 0;
    if (discoveries.has(name)) return false;
    if (places[name]) return false;
    if (lateTitle.test(name)) return false;
    const page = D.pages[name];
    const it = A.itemInfo(name);
    if (it?.id && A.state.progress.owned?.[it.id]) return true;
    if (it?.id && nodesByItem.has(it.id)) return nodeBase(nodesByItem.get(it.id));
    const f = A.fishByName.get(name);
    if (f) {
      if (f.qi || f.legend) return false;
      if (protectedSource.test(f.lt || "") && !earlySources.test(f.lt || "")) return false;
      return true;
    }
    const l = A.locationByName.get(name);
    if (l?.map?.startsWith("island")) return false;
    if (page && storyType.test(page.k)) return false;
    if (page?.k === "villager") return !protectedSource.test([page.f?.location, page.f?.address].join(" "));
    const source = [page?.f?.source, page?.f?.recipe, page?.f?.location, page?.f?.address].filter(Boolean).join(" · ");
    if (protectedSource.test(source) && !earlySources.test(source)) return false;
    if (!source && protectedSource.test(page?.s || "") && !earlySources.test(page?.s || "")) return false;
    const recipes = it?.id ? A.recipesByOut.get(it.id) || [] : [];
    if (recipes.length && !earlySources.test(source)) {
      return recipes.some(r => (r.uc || []).every(c => c.group === "initial" || (c.group === "skill" && (A.state.progress.skills[c.skill] || 0) >= c.level)));
    }
    // 无来源、无可核对页面的物品不主动推荐；准确搜索后仍可单独查看。
    return !!page;
  }
  function canView(ref) {
    if (!active()) return true;
    if (ref?.type === "bundle") {
      const value = A.browse?.bundle(ref.id);
      return !!value && value.room.room !== "废弃Joja超市" && nodeBase(P.nodes.get("room:" + value.room.room));
    }
    const name = title(ref);
    if (!name) return false;
    if (memo.has(name)) return memo.get(name);
    const result = nameBase(name);
    memo.set(name, result);
    return result;
  }
  function textAllowed(text, context = "") {
    if (!active() || !text) return true;
    if (context) text = text.split(context).join("");
    if (!blockedNames) {
      const names = new Set([...Object.keys(D.pages), ...Object.values(D.items).map(i => i.z), ...nodesByTitle.keys(), ...discoveries]);
      // A numeric skill requirement is a rule, not a future reward or place.
      // It may be needed to explain a currently requested item or basic control.
      blockedNames = [...names].filter(name => name.length >= 2 && nodesByTitle.get(name)?.kind !== "skill" && !canView({ type: "page", id: name }));
    }
    return !blockedNames.some(name => text.includes(name));
  }
  // 归档中具体钓鱼标记所属的地点；坐标不是遮罩范围，也不用于推断相邻点位。
  function mapPointArea(ref, point) {
    const [x, y, map] = point;
    if (map === "island" || map === "island_small") return "ginger_island";
    const id = `${map}:${x}:${y}`, canonical = D.mapPointAliases[id] || id;
    if (ref.type === "fish" || A.fishByName.has(ref.id)) return D.mapPoints[canonical]?.area || null;
    return null;
  }
  function mapPoint(ref, point) {
    if (!canView(ref)) return false;
    const area = mapPointArea(ref, point);
    return !area || canView({ type: "area", id: area });
  }
  function reset() { memo = new Map(); blockedNames = null; }
  A.on(reason => { if (reason === "progress:preset") revealed.clear(); reset(); });
  A.spoilers = {
    active, canView, title, textAllowed, mapPoint, mapPointArea,
    node: id => canView({ type: "node", id }),
    area: id => canView({ type: "area", id }),
    reveal(ref, remember = false) {
      const name = title(ref);
      if (!name) return;
      if (remember) A.state.spoilers.known = [...new Set([...A.state.spoilers.known, name])];
      else revealed.add(name);
      reset(); A.emit("spoilers");
    },
    setEnabled(value) { A.state.spoilers.enabled = !!value; revealed.clear(); reset(); A.emit("spoilers"); },
    reset,
  };
})();
