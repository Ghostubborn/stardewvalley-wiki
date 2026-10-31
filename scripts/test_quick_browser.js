// Run in either language with agent-browser eval --stdin < scripts/test_quick_browser.js, at desktop and
// phone sizes (escape non-ASCII first, see prototype/README.md). Walks the cheat sheet: empty state, ready-made tables,
// pinning from an entry, the season filter, opening and removing cards, shared links, spoiler-safe locked cards and layout.
(async () => {
  const A = App, assert = (value, message) => { if (!value) throw new Error(message); };
  const pause = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));
  const q = document.getElementById("quick"), body = document.getElementById("detail-body"), count = document.getElementById("quick-count");
  const button = (root, text) => [...root.querySelectorAll("button")].find(b => b.textContent.trim() === (text.startsWith("+") ? "+" + A.t(text.slice(1)) : A.t(text)));
  const stray = () => /\bnull\b|\bundefined\b|\bfalse\b|\[object /.test(q.textContent);
  const saved = structuredClone(A.state), savedHash = location.hash;
  try {
    A.select(null); A.spoilers.setEnabled(true);
    A.quick.setShared(null);
    history.replaceState(null, "", location.pathname + "#view=quick");
    A.state.plan = []; A.state.sheets = []; A.state.quickSeason = "all";
    A.emit("plan");
    document.getElementById("tab-quick").click(); await pause();
    assert(A.state.view === "quick" && !q.hidden && document.getElementById("browse").hidden, "Cheat sheet tab does not open its view");
    assert(location.hash.startsWith("#view=quick"), "Cheat sheet view is not in the address");
    assert(count.hidden, "An empty cheat sheet shows a count");
    assert(q.querySelector(".quick-empty") && !q.querySelector(".quick-toolbar") && !q.querySelector(".quick-picker"), "Empty state should only offer the ready-made tables");
    assert(!stray(), "Empty cheat sheet renders stray null/false text");

    // Ready-made table: the in-game style birthday calendar.
    q.querySelector(".quick-starter").click(); await pause();
    assert(A.state.sheets.includes("birthdays") && q.querySelectorAll(".quick-calendar").length === 4, "Birthday calendar did not open with four seasons");
    assert(q.querySelectorAll(".calendar-day").length === 112, "Each season should have 28 days");
    const people = [...q.querySelectorAll(".calendar-person")];
    assert(people.length >= 20 && !people.some(b => b.title === A.N("科罗布斯")), "Calendar lists protected villagers or too few birthdays");
    assert([...q.querySelectorAll('.quick-calendar[data-season="fall"] .calendar-person')].some(b => b.title === A.N("潘妮")), "Penny's birthday is missing from fall");
    assert(q.querySelector(".quick-toolbar") && q.querySelector(".quick-picker"), "Toolbar should appear once the sheet has content");
    button(q, "+商店营业时间").click(); await pause();
    button(q, "+钓鱼速查").click(); await pause();
    assert(["birthdays", "shops", "fish"].every(id => q.querySelector(`.quick-sheet[data-sheet="${id}"]`)), "Tables did not all open");
    assert([...q.querySelectorAll(".quick-sheet")].map(s => s.dataset.sheet).join() === "birthdays,shops,fish", "Tables should keep a fixed order");

    // Pin from an entry's detail.
    A.select({ type: "fish", id: "沙丁鱼" }, { from: "browse" }); await pause();
    const pin = body.querySelector(".pin-toggle");
    assert(pin && pin.textContent === A.t("钉到速查") && pin.getAttribute("aria-pressed") === "false", "Entry lacks the pin button");
    pin.click(); await pause();
    assert(body.querySelector(".pin-toggle").textContent === A.t("从速查移除"), "Pin button does not flip to unpin");
    assert(A.state.view === "quick" && document.getElementById("detail").dataset.mode === "reading", "Entries opened from the cheat sheet should be centred");
    A.select({ type: "villager", id: "潘妮" }); await pause(); body.querySelector(".pin-toggle").click(); await pause();
    A.select({ type: "location", id: "皮埃尔的杂货店" }); await pause(); body.querySelector(".pin-toggle").click(); await pause();
    A.select(null); await pause();
    assert(count.textContent === "3" && !count.hidden, "Tab count does not follow pins");
    const sardine = q.querySelector('.quick-card[data-record="fish:沙丁鱼"]');
    assert(sardine && sardine.querySelector(".quick-facts").textContent.includes(A.habitatName("沙滩")), "Fish card lacks its water");
    const rawClosed = A.EN ? A.locText(A.locationByName.get("皮埃尔的杂货店")).closed : A.t("周三休息（社区中心修复前）");
    const closedText = A.spoilers.textAllowed(rawClosed) ? rawClosed : A.t("周三休息；推进游戏后可能调整，详见条目");
    assert(q.querySelector('.quick-card[data-record="location:皮埃尔的杂货店"] .quick-facts').textContent.includes(closedText), "Shop card lacks its conditional day off");
    assert(q.querySelectorAll('.quick-card[data-record="villager:潘妮"] .quick-slot').length === 6, "Villager card should show six loved gifts");
    assert(!stray(), "Cards render stray null/[object] text");

    // Pictures instead of prose: four fixed season slots, a 6:00–2:00 day bar, weather icons and a seven-day week.
    const slots = [...sardine.querySelectorAll(".season-strip .season-slot")];
    assert(slots.length === 4 && slots.map(x => x.classList.contains("on")).join() === "true,false,true,true", "Sardine season slots should light spring, fall and winter");
    const span = sardine.querySelector(".time-bar .time-span");
    assert(span && Math.abs(parseFloat(span.style.left)) < 0.1 && Math.abs(parseFloat(span.style.width) - 65) < 0.1, "Sardine time bar should run 06:00–19:00");
    assert(sardine.querySelectorAll(".weather-icons img").length === 2, "Any-weather fish should show both weather icons");
    const pierreWeek = [...q.querySelectorAll('.quick-card[data-record="location:皮埃尔的杂货店"] .week-day')];
    assert(pierreWeek.length === 7 && pierreWeek.map((d, i) => d.classList.contains("closed") ? i : -1).filter(i => i >= 0).join() === "2"
      && pierreWeek[2].classList.contains("maybe"), "Pierre's week should strike out Wednesday as a conditional day off");
    const cart = [...q.querySelectorAll(".quick-shops .quick-tr:not(.quick-th)")].find(r => r.querySelector("[role=rowheader]").textContent.includes(A.N("旅行货车")));
    if (cart) assert([...cart.querySelectorAll(".week-day")].map(d => d.classList.contains("closed") ? "x" : "o").join("") === "xxxxoxo", "The travelling cart is open only on Friday and Sunday");
    const fishRows = [...q.querySelectorAll(".quick-fish .quick-tr:not(.quick-th)")];
    assert(fishRows.length > 10 && fishRows.every(r => r.querySelectorAll(".season-slot").length === 4 && r.querySelector(".time-bar")), "Fishing table rows lack season slots or time bars");
    const head = q.querySelector(".quick-fish .quick-th");
    if (getComputedStyle(head).display !== "none") {
      // Table layout: every row shares the same columns, and the legend slots line up with the rows'.
      const lefts = r => [...r.children].map(c => Math.round(c.getBoundingClientRect().left)).join();
      assert(fishRows.every(r => lefts(r) === lefts(fishRows[0])), "Fishing table columns do not line up across rows");
      assert(getComputedStyle(head.querySelector(".season-slot")).display === "grid", "Season legend in the table header is squashed");
      const legend = [...head.querySelectorAll(".season-slot")].map(x => Math.round(x.getBoundingClientRect().left)).join();
      assert(legend === [...fishRows[0].querySelectorAll(".season-slot")].map(x => Math.round(x.getBoundingClientRect().left)).join(), "Season legend is not above the season slots");
    } else {
      // Phone: name, then the season slots with the weather beside them, then the time bar.
      const row = fishRows[0], season = row.querySelector('[data-col="season"]').getBoundingClientRect(), weather = row.querySelector('[data-col="weather"]').getBoundingClientRect();
      assert(Math.abs(season.top + season.height / 2 - (weather.top + weather.height / 2)) < 8 && weather.left > season.right, "On phones the weather should sit beside the season slots");
      assert(row.querySelector('[data-col="time"]').getBoundingClientRect().top >= season.bottom - 1, "On phones the time bar should come after the season slots");
    }

    // Season filter: only birthdays, fish and crops are seasonal.
    q.querySelector('.quick-seasons [data-v="summer"]').click(); await pause();
    assert(q.querySelectorAll(".quick-calendar").length === 1 && q.querySelector('.quick-calendar[data-season="summer"]'), "Season filter should show one calendar");
    assert(!q.querySelector('.quick-card[data-record="fish:沙丁鱼"]') && !q.querySelector('.quick-card[data-record="villager:潘妮"]'), "Off-season pins stay visible");
    assert(q.querySelector('.quick-card[data-record="location:皮埃尔的杂货店"]'), "Shops should not be filtered by season");
    assert(q.textContent.includes(A.t("另有 {n} 个钉选条目不在{season}，选「全部」可以看到。", { n: 2, season: A.SEASON_ZH.summer })), "Hidden pins are not counted");
    q.querySelector('.quick-seasons [data-v="all"]').click(); await pause();

    // Open a card, close the detail, remove a card.
    q.querySelector('.quick-card[data-record="villager:潘妮"] .quick-card-head').click(); await pause();
    assert(document.getElementById("detail-title")?.textContent === A.N("潘妮") && A.state.view === "quick", "Card does not open its entry");
    document.getElementById("detail-close").click(); await pause();
    assert(document.getElementById("detail").hidden && A.state.view === "quick", "Closing the entry leaves the cheat sheet");
    q.querySelector('.quick-card[data-record="villager:潘妮"] .quick-remove').click(); await pause();
    assert(!q.querySelector('.quick-card[data-record="villager:潘妮"]') && count.textContent === "2", "Remove button does not unpin");

    // Spoiler protection: a protected pin shows only a locked card.
    A.state.plan.push({ type: "villager", id: "科罗布斯" }); A.emit("plan"); await pause();
    const locked = q.querySelector(".quick-card.locked");
    assert(locked && !q.textContent.includes(A.N("科罗布斯")), "A protected pin leaks its name");
    assert(!document.getElementById("toast").textContent.includes(A.N("科罗布斯")), "Toast leaks a protected name");
    A.state.plan.pop(); A.emit("plan"); await pause();

    // Shared link: read-only view, then back to one's own sheet with a clean address.
    const url = A.quick.shareUrl();
    assert(url && url.includes("#view=quick&pins=") && url.includes("&sheets=birthdays.shops.fish"), "Share link misses pins or tables");
    A.state.plan = []; A.emit("plan");
    location.hash = url.slice(url.indexOf("#")); await pause(300);
    assert(A.quick.shared && q.querySelector(".quick-shared") && q.querySelector("h2").textContent === A.t("分享来的速查"), "Shared link does not open the shared view");
    assert(!q.querySelector(".quick-remove") && !q.querySelector(".quick-picker"), "Shared view should be read-only");
    assert(q.querySelectorAll(".quick-card").length === 2 && A.state.plan.length === 0, "Shared entries should be shown without saving");
    button(q, "加入我的速查").click(); await pause();
    assert(!A.quick.shared && A.state.plan.length === 2 && location.hash === "#view=quick", "Adopting does not save or clean the address");
    // A filtered share preserves its season without changing the receiver's own setting.
    A.quick.setSeason("winter");
    const winterUrl = A.quick.shareUrl();
    A.quick.setSeason("summer");
    location.hash = winterUrl.slice(winterUrl.indexOf("#")); await pause(300);
    assert(A.quick.model.season() === "winter" && A.state.quickSeason === "summer", "Share loses its season or overwrites local settings");
    button(q, "看我的速查").click(); await pause();
    assert(A.quick.model.season() === "summer" && !A.quick.shared, "Returning from a share loses one's own season");
    A.quick.setSeason("all");

    // Layout: nothing scrolls sideways, the hotbar fits, and cards stay inside the sheet.
    const hotbar = document.querySelector(".hotbar");
    assert(q.scrollWidth <= q.clientWidth + 1, `Cheat sheet scrolls sideways (${q.scrollWidth} > ${q.clientWidth})`);
    assert(hotbar.scrollWidth <= hotbar.clientWidth + 1 && hotbar.getBoundingClientRect().right <= innerWidth + 0.5, "Hotbar overflows with four tabs");
    const qr = q.getBoundingClientRect();
    for (const card of q.querySelectorAll(".quick-card, .quick-calendar, .quick-table")) {
      const r = card.getBoundingClientRect();
      assert(r.left >= qr.left - 0.5 && r.right <= qr.right + 0.5, "A card or table runs outside the sheet");
    }
    return JSON.stringify({ result: "cheat sheet: tables, pins, season filter, cards, sharing, spoilers and layout", viewport: [innerWidth, innerHeight] });
  } finally {
    A.select(null);
    const view = A.state.view;
    Object.assign(A.state, saved);
    if (!("sheets" in saved)) delete A.state.sheets;
    if (!("quickSeason" in saved)) delete A.state.quickSeason;
    A.quick.setShared(null);
    A.state.view = view;
    history.replaceState(null, "", location.pathname + location.search + (savedHash || "#view=browse"));
    A.spoilers.setEnabled(saved.spoilers?.enabled !== false);
    A.setView(saved.view || "browse");
    A.emit("plan");
  }
})();
