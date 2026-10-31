// Run on /en/ with agent-browser eval --stdin < scripts/test_english_spoilers_browser.js
// With spoiler protection on and no progress, English names of protected entries must not appear
// in categories, the home page, map lists, the cheat sheet, fuzzy search or wiki article bodies.
(async () => {
  const A = App, S = A.spoilers, D = A.D;
  if (A.lang !== "en") throw new Error("Open /en/ first");
  A.applyPreset("unknown"); S.setEnabled(true); A.select(null);
  const protectedNames = ["科罗布斯", "肯特", "齐先生", "姜岛", "银河之魂", "无限之刃", "火山地牢", "骷髅洞穴", "女巫小屋", "金色核桃", "电影院"]
    .filter(zh => !S.canView({ type: "page", id: zh }))
    .map(zh => ({ zh, en: D.pages[zh]?.e || A.EN.names[zh] }))
    .filter(x => x.en);
  const leaks = [];
  const check = (where, text) => { for (const { en } of protectedNames) if (new RegExp(`(?<![A-Za-z])${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).test(text)) leaks.push(`${where}: ${en}`); };
  const exposed = root => root.textContent + [...root.querySelectorAll("[aria-label], [title], img")].map(e => [e.getAttribute("aria-label"), e.title, e.alt].join(" ")).join(" ");
  const browse = document.getElementById("browse");
  A.openBrowse(null); check("home", exposed(browse));
  for (const c of A.browse.categories) {
    A.openBrowse(c.id);
    const more = browse.querySelector(".browse-more");
    for (let i = 0; i < 200 && more && !more.hidden; i++) more.click();
    check("category:" + c.id, exposed(browse));
  }
  A.setView("map");
  for (const p of A.mapContents.points("valley")) check("map", p.title + " " + p.entries.map(e => e.label + " " + (e.subtitle || "")).join(" "));
  A.setView("tree"); check("tree", exposed(document.getElementById("tree")));
  // Cheat sheet: all tables in every season, plus a pinned protected villager and a pinned public one.
  const plan = A.state.plan, sheets = A.state.sheets;
  A.state.plan = [{ type: "villager", id: "科罗布斯" }, { type: "villager", id: "潘妮" }, { type: "item", id: "(O)388" }];
  A.state.sheets = ["birthdays", "shops", "fish"];
  A.setView("quick");
  for (const season of ["all", ...A.SEASONS]) { A.quick.setSeason(season); check("quick:" + season, exposed(document.getElementById("quick"))); }
  A.quick.setSeason("all"); A.state.plan = plan; A.state.sheets = sheets; A.emit("plan");
  const input = document.getElementById("search");
  for (const q of ["is", "gin", "sk", "qi", "gal", "vol", "kro", "inf", "wit", "mov"]) {
    input.value = q; input.dispatchEvent(new Event("input", { bubbles: true }));
    check("search:" + q, exposed(document.getElementById("search-results")));
  }
  input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }));
  // Exact English names still find a neutral entry that asks before revealing.
  input.value = "Ginger Island"; input.dispatchEvent(new Event("input", { bubbles: true }));
  const exact = document.getElementById("search-results").textContent;
  input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }));
  A.setView("browse");
  // Article bodies load on demand; paragraphs, list items and table rows that name protected places stay folded.
  const body = document.getElementById("detail-body");
  const settle = async () => { await A.articleRequest; await new Promise(resolve => setTimeout(resolve, 30)); };
  let articleBlocks = 0;
  const refs = [...["天气", "季节", "耕种", "钓鱼", "采矿", "节日", "钓鱼攻略"].map(id => ({ type: "page", id })),
    { type: "item", id: "(O)72" }, { type: "villager", id: "潘妮" }, { type: "fish", id: "鲶鱼" }];
  for (const ref of refs) {
    A.select(ref, { from: "browse" });
    await settle();
    // Basics guides and regular entries keep the full article in a fold at the end.
    body.querySelector(".art-fold button")?.click();
    await settle();
    articleBlocks += body.querySelectorAll(".art-section, .article > p, .art-fold > p").length;
    check("article:" + ref.id, exposed(body));
  }
  A.select(null);
  return JSON.stringify({ checkedNames: protectedNames.map(x => x.en), leaks: leaks.slice(0, 20), leakCount: leaks.length, articleBlocks, exactSearch: exact.slice(0, 120) });
})();
