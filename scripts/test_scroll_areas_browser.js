// Run in the local app (Chinese page) with agent-browser eval --stdin < scripts/test_scroll_areas_browser.js,
// at desktop, short-window and phone sizes. Opens every scrolling panel (category pages, search, entry
// details in both modes, conditions, progress, feedback, map and route views) and checks that scrolled content and
// sticky bars stay inside the wooden frame instead of passing over its inner bands, that the end of each
// scroll area can be reached, and that the search list fits inside the journal panel.
(async () => {
  const A = App, issues = [], pause = (ms = 400) => new Promise(resolve => setTimeout(resolve, ms));
  const shown = el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let n = el; n && n !== document; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false;
      const p = n.parentElement;
      if (p && p.tagName === "DETAILS" && !p.open && n.tagName !== "SUMMARY") return false;
    }
    return true;
  };
  const name = el => (el.id ? "#" + el.id : el.className ? "." + String(el.className).trim().split(/\s+/)[0] : el.tagName);
  const scrolls = el => {
    const s = getComputedStyle(el);
    return (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) || (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1);
  };
  function check(where) {
    const all = [...document.querySelectorAll("#app *")].filter(shown), scrollers = all.filter(scrolls);
    // Frames whose inner bands are inset shadows (6px inside the border) must not contain anything that scrolls
    // or sticks over those bands; scrolling frames draw the bands in the border instead (.frame-scroll).
    for (const frame of all.filter(el => el.classList.contains("frame") && getComputedStyle(el).boxShadow.includes("inset"))) {
      const r = frame.getBoundingClientRect(), b = parseFloat(getComputedStyle(frame).borderTopWidth) + 6;
      const band = { top: r.top + b, bottom: r.bottom - b, left: r.left + b, right: r.right - b };
      for (const s of scrollers.filter(s => frame.contains(s))) {
        const sr = s === frame ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : s.getBoundingClientRect();
        const vertical = s.scrollHeight > s.clientHeight + 1;
        const over = vertical ? sr.top < band.top - 0.5 || sr.bottom > band.bottom + 0.5 : sr.left < band.left - 0.5 || sr.right > band.right + 0.5;
        if (over) issues.push(`${where}: ${name(s)} scrolls over the bands of ${name(frame)}`);
      }
      for (const el of frame.querySelectorAll("*")) {
        if (getComputedStyle(el).position !== "sticky" || !shown(el)) continue;
        const er = el.getBoundingClientRect();
        if (er.top < band.top - 0.5 || er.left < band.left - 0.5 || er.right > band.right + 0.5) issues.push(`${where}: sticky ${name(el)} covers the bands of ${name(frame)}`);
      }
    }
    for (const s of scrollers) {
      const before = s.scrollTop;
      s.scrollTop = s.scrollHeight;
      const r = s.getBoundingClientRect(), bottom = r.top + parseFloat(getComputedStyle(s).borderTopWidth) + s.clientHeight;
      const last = Math.max(...[...s.querySelectorAll("*")].filter(shown).map(d => d.getBoundingClientRect().bottom));
      if (last > bottom + 1) issues.push(`${where}: the end of ${name(s)} is ${Math.round(last - bottom)}px out of reach`);
      s.scrollTop = before;
    }
  }
  const reset = async () => {
    A.select(null);
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    if (!document.getElementById("clock-controls").hidden) document.getElementById("conditions-close")?.click();
    await pause(150);
  };
  const saved = structuredClone(A.state);
  try {
    A.spoilers.setEnabled(false);
    A.setView("browse"); A.browse.open(null); await pause(); check("home");
    for (const id of ["items", "villagers", "fish"]) {
      A.openBrowse(id); document.querySelector("#browse .browse-toolbar > .btn")?.click(); await pause(); check("category " + id);
    }
    A.browse.open(null); await pause();
    const journal = document.getElementById("journal"), handle = document.getElementById("journal-handle");
    if (getComputedStyle(handle).display !== "none" && journal.classList.contains("collapsed")) { handle.click(); await pause(500); }
    const input = document.getElementById("search"), list = document.getElementById("search-results");
    input.focus(); input.value = "鱼"; input.dispatchEvent(new Event("input", { bubbles: true })); await pause(200);
    check("search list");
    if (list.getBoundingClientRect().bottom > journal.getBoundingClientRect().bottom - 3) issues.push("search list: runs past the journal panel");
    input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); input.blur(); await pause(150);
    if (getComputedStyle(handle).display !== "none" && !journal.classList.contains("collapsed")) { handle.click(); await pause(400); }
    A.select({ type: "villager", id: "潘妮" }); await pause(600);
    [...document.querySelectorAll("#detail-body .art-fold button")].find(b => b.textContent.includes("展开"))?.click();
    await A.articleRequest; await pause(600);
    check("entry with its article");
    await reset();
    A.setView("map"); await pause(300);
    A.select({ type: "location", id: "皮埃尔的杂货店" }); await pause(400);
    document.getElementById("detail-mode")?.click(); await pause(300);
    check("map with the entry beside it (" + document.getElementById("detail").dataset.mode + ")");
    await reset();
    A.setView("map"); await pause(300); check("map");
    A.openConditions(); await pause(400); check("conditions");
    await reset();
    document.getElementById("open-progress")?.click(); await pause(500); check("progress");
    await reset();
    document.getElementById("feedback-open")?.click(); await pause(300); check("feedback");
    await reset();
    A.setView("tree"); await pause(500); check("route");
    if (issues.length) throw new Error(issues.join("\n"));
    return JSON.stringify({ result: "scrolled content and sticky bars stay inside the frames, every scroll area reaches its end, the search list fits the panel", viewport: [innerWidth, innerHeight] });
  } finally {
    await reset();
    // Keep the view that is on screen until setView switches back, or setView sees no change and the route stays up.
    const view = A.state.view;
    Object.assign(A.state, saved);
    A.state.view = view;
    A.spoilers.setEnabled(saved.spoilers?.enabled !== false);
    A.setView(saved.view || "browse");
  }
})();
