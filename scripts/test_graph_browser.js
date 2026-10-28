// Run in the local app (Chinese page) with agent-browser eval --stdin < scripts/test_graph_browser.js, at
// desktop and phone sizes. The relation graph: the list/graph switch, groups and connecting lines (side by
// side when wide, stacked when narrow), recentring on a node with a path back, the browser history and
// deep links, long groups and flavour families that open in place, the full crafting chain, villager,
// place and monster graphs, and spoiler protection (protected entries are locked placeholders).
(async () => {
  const A = App, S = A.spoilers, assert = (value, message) => { if (!value) throw new Error(message); };
  const saved = structuredClone(A.state);
  const body = document.getElementById("detail-body"), detail = document.getElementById("detail");
  const pause = (ms = 350) => new Promise(resolve => setTimeout(resolve, ms));
  const settle = async () => { await pause(); await new Promise(requestAnimationFrame); await pause(150); };
  const id = zh => Object.entries(A.D.items).find(([, it]) => it.z === zh)[0];
  const graph = () => body.querySelector(".graph");
  const title = () => document.getElementById("detail-title").textContent;
  const wide = () => graph().querySelector(".g-stage").clientWidth >= 560;
  try {
    S.setEnabled(false);
    A.state.graph = false;
    A.select({ type: "item", id: id("蒲公英") }); await settle();
    const sw = body.querySelector(".view-switch");
    assert(sw && !graph(), "list view first, with the list/graph switch");
    sw.querySelectorAll("button")[1].click(); await settle();
    assert(graph(), "the switch opens the graph");
    assert(location.hash.includes("&g=1"), "the graph has a shareable link");
    const rel = A.relations({ type: "item", id: id("蒲公英") });
    const groups = [...graph().querySelectorAll(".g-group")];
    assert(groups.length === rel.left.groups.length + rel.right.groups.length, "one box per group");
    assert(detail.scrollWidth <= detail.clientWidth + 1, "no sideways scrolling");
    const stage = graph().querySelector(".g-stage").getBoundingClientRect();
    for (const g of groups) {
      const r = g.getBoundingClientRect();
      assert(r.left >= stage.left - 1 && r.right <= stage.right + 1, "groups stay inside the graph");
    }
    for (const side of [".g-left", ".g-right"]) {
      const rects = [...graph().querySelectorAll(`${side} .g-group`)].map(g => g.getBoundingClientRect());
      rects.slice(1).forEach((r, i) => assert(r.top >= rects[i].bottom - 0.5, "boxes in a column don't overlap"));
    }
    const lines = graph().querySelectorAll(".g-edge").length, layout = wide() ? "side by side" : "stacked";
    if (layout === "side by side") assert(lines === groups.length, "one connecting line per group when side by side");
    else {
      assert(lines === 0, "no connecting lines when stacked");
      const [left, mid, right] = [".g-left", ".g-mid", ".g-right"].map(s => graph().querySelector(s).getBoundingClientRect());
      assert(left.bottom <= mid.top + 1 && mid.bottom <= right.top + 1, "stacked top to bottom: how to get it, the item, what it's for");
    }
    assert([...graph().querySelectorAll("button.g-node")].every(b => b.textContent.trim()), "every node is a button with a name");

    // Recentre on a node; the path leads back; the browser history and deep links keep the graph.
    [...graph().querySelectorAll("button.g-node")].find(b => b.textContent.includes("沙拉")).click(); await settle();
    assert(title() === "沙拉" && graph(), "a node redraws the graph around it");
    assert(graph().querySelector(".g-trail")?.textContent === "蒲公英›沙拉", "the path shows where you came from");
    graph().querySelector(".g-crumb").click(); await settle();
    assert(title() === "蒲公英" && !graph().querySelector(".g-trail"), "the path leads back");
    history.back(); await settle(); await pause(300);
    assert(title() === "沙拉" && graph(), "browser back returns to the previous graph");
    location.hash = "#view=browse&sel=villager:" + encodeURIComponent("潘妮"); await settle(); await pause(300);
    assert(title() === "潘妮" && !graph() && body.querySelector(".view-switch"), "a link without g=1 opens the list");
    location.hash = "#view=browse&sel=villager:" + encodeURIComponent("潘妮") + "&g=1"; await settle(); await pause(300);
    assert(graph(), "a link with g=1 opens the graph");

    // Long groups and flavour families open in place.
    const likes = [...graph().querySelectorAll(".g-group")].find(g => g.querySelector(".g-kind").textContent === "喜欢的礼物");
    const before = likes.querySelectorAll(".g-node").length;
    likes.querySelector(".g-more").click(); await settle();
    assert(before === 8 && likes.querySelectorAll(".g-node").length === A.villagerByName.get("潘妮").like.length, "“more” lists the whole group");
    A.select({ type: "item", id: id("煤炭") }); await settle();
    const family = [...graph().querySelectorAll(".g-family")].find(b => b.textContent.includes("熏鱼"));
    assert(family?.textContent.includes("71 种"), "71 smoked fish collapse into one entry");
    const smoker = family.closest(".g-group");
    family.click(); await settle();
    assert(smoker.querySelectorAll(".g-node").length === 72, "the entry opens into the generic product and every flavour");

    // The full crafting chain, down to ore, with totals and the other way to make gold bars.
    A.select({ type: "item", id: id("铱制洒水器") }); await settle();
    graph().querySelector(".g-chain-toggle").click(); await settle();
    const chain = graph().querySelector(".g-chain");
    assert(chain && chain.querySelectorAll(".g-branch").length >= 8, "the chain shows every step");
    assert(/黄金矿石×5/.test(chain.querySelector(".g-total").textContent.replace(/\s/g, "")), "raw totals");
    assert(chain.textContent.includes("也可以：打造（铁锭×2）"), "other ways to make an intermediate");
    graph().querySelector(".g-chain-toggle").click(); await settle();
    assert(graph().querySelector(".g-chain-panel").hidden, "the chain closes again");

    // Places, monsters, fish and animals get graphs too.
    for (const ref of [{ type: "location", id: "皮埃尔的杂货店" }, { type: "page", id: "鹈鹕镇" }, { type: "page", id: "史莱姆（怪物）" }, { type: "fish", id: "鲶鱼" }, { type: "page", id: "绵羊" }]) {
      A.select(ref); await settle();
      assert(graph()?.querySelectorAll(".g-group").length, `${ref.id}: graph`);
    }
    // Buildings: route steps and building pages both show the building graph; tiers link to each other.
    A.select({ type: "node", id: "bld:鸡舍:1" }); await settle();
    assert(graph() && [...graph().querySelectorAll(".g-kind")].some(k => k.textContent === "升级前"), "building tiers have a graph");
    [...graph().querySelectorAll("button.g-node")].find(b => b.textContent.includes("高级鸡舍")).click(); await settle();
    assert(title() === "高级鸡舍" && graph(), "tiers link to each other");
    A.select({ type: "page", id: "磨坊" }); await settle();
    assert(graph()?.textContent.includes("大麦粉"), "a building that processes shows its products");
    A.select({ type: "page", id: "土之图腾柱" }); await settle();
    assert(graph()?.textContent.includes("法师塔") && graph().textContent.includes("取回魔法墨水后开放"), "magic buildings name the Wizard's Tower");
    A.select({ type: "fish", id: "黄貂鱼" }); await settle();
    assert([...graph().querySelectorAll(".g-group")].some(g => g.querySelector(".g-kind").textContent === "鱼塘产出" && g.textContent.includes("电池组")), "fish graphs list pond produce");
    A.select({ type: "page", id: "新手指南" }); await settle();
    assert(!graph() && !body.querySelector(".view-switch"), "entries without relations keep the plain page");

    // Spoiler protection: protected entries are locked placeholders without names, icons or notes; a protected
    // entry itself keeps the usual gate instead of a graph.
    S.setEnabled(true);
    A.applyPreset("unknown");
    for (const ref of [{ type: "villager", id: "潘妮" }, { type: "item", id: id("煤炭") }, { type: "fish", id: "鲶鱼" }]) {
      A.select(ref); await settle();
      assert(graph(), `${ref.id}: graph with protection on`);
      for (const b of graph().querySelectorAll(".g-more")) b.click();
      const text = graph().textContent + [...graph().querySelectorAll("img")].map(i => i.src).join(" ");
      for (const name of ["姜岛", "科罗布斯", "齐先生", "骷髅洞穴", "火山地牢", "Krobus", "Ginger"]) assert(!text.includes(name), `${ref.id}: no protected name in the graph: ${name}`);
    }
    A.select({ type: "item", id: id("煤炭") }); await settle();
    const locked = graph().querySelector(".g-locked");
    assert(locked && /\d+ 项后续内容/.test(locked.textContent), "each group gathers its protected entries in one locked box with a count");
    const count = +locked.textContent.match(/\d+/)[0], box = locked.closest(".g-group");
    locked.click(); await settle();
    assert(box.querySelectorAll(".g-node.is-protected").length === count, "the locked box opens into one placeholder per entry");
    box.querySelector("button.g-node.is-protected").click(); await settle();
    assert(!graph() && body.textContent.includes("仅查看此条"), "a placeholder opens the usual on-demand view");
    A.select({ type: "page", id: "史莱姆（怪物）" }); await settle();
    assert(!graph() && body.textContent.includes("仅查看此条"), "a protected entry keeps its gate");

    // Back to the list.
    S.setEnabled(false);
    A.select({ type: "item", id: id("蒲公英") }); await settle();
    body.querySelector(".view-switch button").click(); await settle();
    assert(!graph() && !location.hash.includes("g=1") && body.querySelector(".acquisition-paths, .d-section"), "the switch returns to the list");
    A.select({ type: "item", id: id("木材") }); await settle();
    assert(body.textContent.includes("用于建造") && [...body.querySelectorAll(".chip")].some(c => c.textContent.includes("鸡舍")), "the list also names the buildings an item is used for");
    A.select({ type: "fish", id: "黄貂鱼" }); await settle();
    assert([...body.querySelectorAll(".d-section > h3")].some(h => h.textContent === "鱼塘产出") && body.textContent.includes("9 条起"), "fish lists show pond produce");
    A.select({ type: "item", id: id("电池组") }); await settle();
    assert(body.textContent.includes("鱼塘产出") && [...body.querySelectorAll(".chip")].some(c => c.textContent.includes("黄貂鱼")), "item lists show which pond fish produce it");
    return JSON.stringify({ result: "switch, groups and lines, stacked when narrow, recentring with a path, history and links, long groups, flavour families, crafting chain, places/monsters/fish/animals/buildings, spoiler placeholders", layout, viewport: [innerWidth, innerHeight] });
  } finally {
    A.select(null);
    Object.assign(A.state, saved);
    S.setEnabled(saved.spoilers?.enabled !== false);
  }
})();
