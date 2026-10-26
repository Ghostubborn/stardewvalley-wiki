// Run on /en/ with agent-browser eval --stdin < scripts/test_english_spoilers_browser.js
// With spoiler protection on and no progress, English names of protected entries must not appear
// in categories, the home page, map lists or fuzzy search.
(() => {
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
  return JSON.stringify({ checkedNames: protectedNames.map(x => x.en), leaks: leaks.slice(0, 20), leakCount: leaks.length, exactSearch: exact.slice(0, 120) });
})();
