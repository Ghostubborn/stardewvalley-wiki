// Run in the local app (Chinese page) with agent-browser eval --stdin < scripts/test_find_browser.js
// Full-text search: the search box offers an article-text search, results list entries with the
// matching section and a highlighted excerpt, opening a result scrolls to that section, and with
// spoiler protection on nothing protected shows up in the results.
(async () => {
  const A = App, S = A.spoilers, assert = (value, message) => { if (!value) throw new Error(message); };
  const saved = structuredClone(A.state);
  const input = document.getElementById("search"), list = document.getElementById("search-results");
  const body = document.getElementById("detail-body"), detail = document.getElementById("detail");
  const settle = async () => { await A.corpusRequest; await A.articleRequest; await new Promise(resolve => setTimeout(resolve, 250)); };
  try {
    S.setEnabled(false);
    input.focus(); input.value = "洒水器 温室"; input.dispatchEvent(new Event("input", { bubbles: true }));
    const entry = list.querySelector("li.find-entry");
    assert(entry && entry.textContent.includes("洒水器 温室"), "the search box offers an article-text search");
    entry.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    assert(location.hash.includes("sel=find:"), "the search has a shareable link");
    const results = [...body.querySelectorAll(".find-list > li")];
    assert(results.length >= 3, "several articles mention both words");
    assert(results[0].querySelector(".find-title").textContent.startsWith("温室"), "the article about the greenhouse ranks first");
    assert(results.every(li => li.querySelector("mark")), "excerpts highlight the words");
    results[0].querySelector(".find-title").click();
    await settle();
    assert(document.getElementById("detail-title").textContent === "温室", "a result opens its entry");
    const heading = [...body.querySelectorAll(".art-section > :first-child")].find(h => h.textContent === "洒水器");
    const top = heading.getBoundingClientRect().top - detail.getBoundingClientRect().top;
    assert(top >= 0 && top < detail.clientHeight / 2, "the matching section is scrolled into view");

    // Structured entries keep the article in a fold; a result there opens the fold.
    A.select({ type: "find", id: "百乐汤" });
    await settle();
    const luau = [...body.querySelectorAll(".find-list > li")].find(li => li.querySelector(".find-title").textContent.startsWith("夏威夷宴会"));
    assert(luau, "festival articles are searchable");

    S.setEnabled(true);
    A.applyPreset("unknown");
    A.select({ type: "find", id: "姜岛" });
    await settle();
    const shown = body.querySelectorAll(".find-list > li").length;
    const note = body.textContent.includes("开启防剧透时不列出");
    assert(shown === 0 && note, "protected places don't show up in article search results");
    A.select({ type: "find", id: "防风草" });
    await settle();
    const text = [...body.querySelectorAll(".find-list")].map(x => x.textContent).join(" ");
    for (const name of ["姜岛", "科罗布斯", "齐先生", "骷髅洞穴", "火山地牢"]) assert(!text.includes(name), `no protected name in excerpts: ${name}`);
    return JSON.stringify({ result: "article-text search entry, ranked results with excerpts, section jump, fold entries, spoiler-safe results", viewport: [innerWidth, innerHeight] });
  } finally {
    A.select(null);
    Object.assign(A.state, saved);
    S.setEnabled(saved.spoilers?.enabled !== false);
    input.value = ""; input.blur();
  }
})();
