/* Map content is grouped by world coordinates first, then by screen collisions.
   A zoom change never splits entries that share the same location. */
(function () {
  "use strict";
  const A = window.App, D = A.D, { t, N } = A;
  const entrances = new Set(["mines", "secret_woods", "quarry", "sewers", "desert"]);
  const areaTitles = new Set(D.progression.areas.map(a => a.title));
  const pointId = (map, x, y) => `${map}:${x}:${y}`;
  function canonicalRef(ref) {
    if (ref.type !== "page") return ref;
    if (A.fishByName.has(ref.id)) return { type: "fish", id: ref.id };
    if (A.villagerByName.has(ref.id)) return { type: "villager", id: ref.id };
    if (A.locationByName.has(ref.id)) return { type: "location", id: ref.id };
    const id = D.pages[ref.id]?.id;
    return id && D.items[id] ? { type: "item", id } : ref;
  }
  const refKey = ref => { ref = canonicalRef(ref); return `${ref.type}:${ref.id}`; };
  const safe = (text, fallback = t("详细条件见条目")) => A.spoilers.textAllowed(text) ? text : fallback;

  function homePins(v) {
    if (v.pins.length) return v.pins.slice(0, 1);
    // Many resident pages have no Map template. Resolve the explicitly recorded
    // address/occupants instead; do not infer a live schedule or an ambiguous home.
    const homes = D.locations.filter(l => l.x != null && (l.p === v.addr || l.occ?.includes(v.p))
      && A.spoilers.canView({ type: "location", id: l.p }));
    return homes.length === 1 ? [[homes[0].x, homes[0].y, homes[0].map]] : [];
  }

  function fishStatus(f, point) {
    return A.fishCheck(f, { point });
  }

  function points(map) {
    if (!D.maps[map] || (map === "island" && !A.spoilers.area("ginger_island"))) return [];
    const cache = (A.cache.mapContents ||= {});
    if (cache[map]) return cache[map];
    const byPoint = new Map();
    function add(ref, x, y, key, extra = {}) {
      ref = canonicalRef(ref);
      if (key !== map || x == null || y == null) return;
      if (!extra.concealed && !A.spoilers.mapPoint(ref, [x, y, key])) return;
      const id = pointId(map, x, y);
      if (!byPoint.has(id)) byPoint.set(id, { id, map, x, y, entries: [] });
      const p = byPoint.get(id);
      if (p.entries.some(e => e.key === refKey(ref))) return;
      p.entries.push({ key: refKey(ref), ref, ...extra });
    }
    for (const l of D.locations) {
      if (areaTitles.has(l.p)) continue;
      const business = A.BUSINESSES.has(l.p) || D.shops.some(s => s.p === l.p);
      const status = business ? A.shopCheck(l) : null;
      const hours = A.locText(l).hours;
      add({ type: "location", id: l.p }, l.x, l.y, l.map, {
        kind: "location", label: N(l.p), icon: l.i,
        subtitle: status ? safe(status.text) : hours ? safe(t("开放时间：{hours}", { hours })) : t("地点资料"), status: status?.ok,
      });
    }
    for (const f of D.fish) {
      for (const pin of f.pins) {
        const c = fishStatus(f, pin);
        const text = A.fishText(f);
        add({ type: "fish", id: f.p }, ...pin, {
          kind: "fish", label: N(f.p), icon: f.i, status: c.ok,
          // 夜市鱼标在沙滩上，副标题先说明要上潜艇，避免误以为在普通海边就能钓。
          subtitle: safe([A.isSubmarineFish(f) ? t("夜市钓鱼潜艇 · 冬季 15–17 日") : text.st, A.fishTimeText(f), text.wt && A.fishWeatherText(f)].filter(Boolean).join(" · ").replace(/\n/g, " ")),
        });
      }
    }
    for (const v of D.villagers) {
      for (const pin of homePins(v)) add({ type: "villager", id: v.p }, ...pin, {
        kind: "villager", label: N(v.p), icon: v.i, subtitle: t("住处位置 · 送礼与生日"), status: null,
      });
    }
    for (const p of D.pins) {
      if (["fish", "location", "villager"].includes(p.k) || areaTitles.has(p.t)
        || A.fishByName.has(p.t) || A.villagerByName.has(p.t) || A.locationByName.has(p.t)) continue;
      add({ type: "page", id: p.t }, p.x, p.y, p.map, { kind: "other", label: N(p.t), icon: p.i, subtitle: D.pages[p.t]?.kz ? t(D.pages[p.t].kz) : t("相关资料") });
    }
    for (const a of D.progression.areas) {
      const readable = A.spoilers.area(a.id);
      if (!readable && !entrances.has(a.id)) continue;
      add({ type: "area", id: a.id }, a.x, a.y, a.map, {
        kind: "location", label: readable ? A.areaTitle(a.id) : t("入口信息"), icon: null, concealed: !readable,
        subtitle: readable ? t("进入条件与地点资料") : t("名称与条件已收起，按需查看"),
      });
    }
    const result = [...byPoint.values()].map(p => {
      const locations = p.entries.filter(e => e.kind === "location" && !e.concealed);
      const meta = D.mapPoints[p.id] || {};
      p.precision = meta.precision || "region";
      p.title = locations.map(e => e.label).join(" / ") || (meta.title && safe(N(meta.title), ""))
        || (p.entries.every(e => e.kind === "fish") ? t("钓鱼点") : p.entries.every(e => e.concealed) ? t("入口信息") : t("地图地点"));
      p.entries.sort((a, b) => a.label.localeCompare(b.label, A.locale));
      return p;
    });
    return (cache[map] = result);
  }
  function find(id) {
    id = D.mapPointAliases[id] || id;
    return points(id.split(":")[0]).find(p => p.id === id) || null;
  }

  function positionNote(point) {
    return { building: t("建筑位置"), entrance: t("入口位置，内部地点见条目"), water: t("水域示意，具体钓法见条目"), region: t("区域示意") }[point.precision] || t("区域示意");
  }

  function cluster(points, project, distance = 48) {
    const groups = points.map(p => {
      const [x, y] = project(p.x, p.y);
      return { x, y, points: [p] };
    });
    // Merge until marker hit areas no longer overlap, including mixed fish,
    // residents and places. Membership is preserved for the detail list.
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (Math.abs(a.x - b.x) >= distance || Math.abs(a.y - b.y) >= distance) continue;
        const n = a.points.length, m = b.points.length;
        a.x = (a.x * n + b.x * m) / (n + m); a.y = (a.y * n + b.y * m) / (n + m);
        a.points.push(...b.points); groups.splice(j, 1); changed = true; break outer;
      }
    }
    return groups.map(g => ({ ...g, aggregate: g.points.length > 1, id: g.points.map(p => p.id).sort().join(";"),
      entries: g.points.flatMap(p => p.entries.map(e => ({ ...e, pointId: p.id }))),
      title: g.points.length === 1 ? g.points[0].title : t("附近 {n} 个地点", { n: g.points.length }),
    }));
  }
  A.mapContents = { points, find, cluster, refKey, fishStatus, homePins, positionNote };
})();
