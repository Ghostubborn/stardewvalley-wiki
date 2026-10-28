// Run on /en/ with agent-browser eval --stdin < scripts/test_english_browser.js, then poll
// `window.__enScan` until it has a result (the walk yields to the page so the browser stays responsive).
// Walks every category, detail type, map, progression and dialog with spoiler protection on and off,
// then every entry again as a relation graph (groups, flavour families and crafting chains opened),
// and reports any Chinese text or attribute that would be visible on the English page.
window.__enScan = { done: false, step: "starting" };
(async () => {
  const A = App, S = A.spoilers, D = A.D;
  const CJK = /[㐀-鿿]/;
  const found = new Map();
  if (A.lang !== "en") throw new Error("Open /en/ before running this check");
  function scan(where) {
    const root = document.getElementById("app");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      if (node.parentElement?.closest("#lang-switch, script")) continue;
      const text = node.nodeValue;
      if (CJK.test(text)) found.set(text.trim().slice(0, 80), where);
    }
    for (const el of root.querySelectorAll("[aria-label], [title], [placeholder], img[alt]")) {
      if (el.closest("#lang-switch")) continue;
      for (const name of ["aria-label", "title", "placeholder", "alt"]) {
        const value = el.getAttribute(name);
        if (value && CJK.test(value)) found.set(`${name}=${value.slice(0, 60)}`, where);
      }
    }
  }
  const views = () => {
    for (const view of ["browse", "map", "tree"]) { A.setView(view); scan("view:" + view); }
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  async function pass(label, { items = true } = {}) {
    window.__enScan.step = label;
    A.select(null);
    views();
    A.openBrowse(null); scan(label + ":home");
    for (const c of A.browse.categories) {
      A.openBrowse(c.id);
      const more = document.querySelector(".browse-more");
      for (let i = 0; i < 200 && more && !more.hidden; i++) more.click();
      scan(label + ":category:" + c.id);
    }
    const refs = [
      ...D.fish.map(f => ({ type: "fish", id: f.p })),
      ...D.villagers.map(v => ({ type: "villager", id: v.p })),
      ...D.locations.map(l => ({ type: "location", id: l.p })),
      ...[...D.monsters, ...D.animals].map(m => ({ type: "page", id: m.p })),
      ...[...A.progression.nodes.keys()].map(id => ({ type: "node", id })),
      ...D.buildings.map(b => A.buildingRef(b.name)).filter(Boolean),
      ...A.browse.records("bundles").filter(r => r.ref.type === "bundle").map(r => r.ref),
      ...A.browse.records("basics").map(r => r.ref),
      ...(items ? Object.keys(D.items) : D.seeds.map(s => s.id)).map(id => ({ type: "item", id })),
      ...Object.keys(A.AREAS).map(id => ({ type: "area", id })),
    ];
    let count = 0;
    for (const ref of refs) {
      if (++count % 40 === 0) { window.__enScan.step = `${label} ${count}/${refs.length}`; await pause(); }
      A.select(ref, { from: "browse" });
      // Expand folded spoiler sections and schedules, so their contents are checked too.
      for (const b of document.querySelectorAll("#detail-body .spoiler-fold button, #detail-body .schedule-protected button")) b.click();
      for (const d of document.querySelectorAll("#detail-body details")) d.open = true;
      // Relation graphs: open long groups, flavour families and the first crafting chain.
      for (const b of document.querySelectorAll("#detail-body .g-more, #detail-body .g-family, #detail-body .g-locked")) b.click();
      document.querySelector("#detail-body .g-chain-toggle")?.click();
      scan(`${label}:${ref.type}:${ref.id}`);
    }
    A.select(null);
    for (const p of A.mapContents.points("valley").slice(0, 400)) { A.openMapPlaces([p.id]); scan(`${label}:point:${p.id}`); }
    A.select(null);
  }
  const started = performance.now();
  A.state.conditionsEnabled = false; A.emit("cond");
  S.setEnabled(true);
  await pass("protected", { items: false });
  A.setCond({ season: "summer", day: 12, weather: "rain", time: 1330 });
  A.openConditions(); scan("conditions");
  document.getElementById("open-progress").click(); scan("progress"); document.getElementById("progress-dialog").close();
  await pass("conditions", { items: false });
  A.setConditionsEnabled(false);
  S.setEnabled(false);
  await pass("unprotected");
  A.state.graph = true;
  await pass("graph");
  A.state.graph = false;
  S.setEnabled(true);
  document.getElementById("spoiler").click(); scan("spoiler-dialog"); document.getElementById("spoiler-dialog").close();
  window.__enScan = { done: true, result: {
    seconds: Math.round((performance.now() - started) / 100) / 10,
    chineseShown: found.size,
    samples: [...found].slice(0, 200),
    missingUiStrings: [...window.L10N.missing].slice(0, 60),
    missingNames: [...(window.L10N.missingNames || [])].slice(0, 80),
    counts: { missingUi: window.L10N.missing.size, missingNames: window.L10N.missingNames?.size },
  } };
})().catch(error => { window.__enScan = { done: true, error: String(error && error.stack || error) }; });
"started";
