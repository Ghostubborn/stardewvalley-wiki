// 关系图：以当前条目为中心，左右两栏是分好组的关系，每组一条连线连到中间；关系图窄于 NARROW 时改成上下排列。
// 点任一节点就以它为中心重画；合成物品可以把整条合成链展开到原料。防剧透开启时，受保护的条目画成带锁的格子，
// 不显示名称、图标和说明，点开后和详情页一样按需查看。数据见 relations.js。
(function () {
  const App = window.App, t = App.t, el = App.el, N = App.N;
  const LIMIT = 8;     // 每组先显示的节点数，其余“还有 N 个”
  const NARROW = 560;  // 与 graph.css 的容器查询一致
  const SVG = "http://www.w3.org/2000/svg";
  const LOCK = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="11" rx="1"/></svg>';

  const allowed = (text, ctx) => !text || App.spoilers.textAllowed(text, ctx.title);
  const viewable = n => !n.ref || App.spoilers.canView(n.ref);
  // 借用住户头像的地点：住户受保护时不显示头像。
  const iconOf = n => (n.icon && App.hasImage(n.icon) && (!n.iconRef || App.spoilers.canView(n.iconRef)) ? n.icon : null);
  function protectedNode(n, ctx) {
    const attrs = { class: "g-node is-protected", title: t("涉及后续内容，点开后按需查看") };
    const body = [el("span", { class: "g-lock", html: LOCK }), el("span", { class: "g-label" }, t("后续内容"))];
    return n.ref ? el("button", { ...attrs, type: "button", onclick: () => ctx.pick(n.ref) }, body) : el("span", attrs, body);
  }
  function nodeEl(n, ctx) {
    if (!viewable(n) || !allowed(n.label, ctx)) return protectedNode(n, ctx);
    const parts = [
      iconOf(n) ? App.img(n.icon, "g-icon") : n.generic ? el("span", { class: "g-icon g-generic", "aria-hidden": "true" }, "◇") : null,
      el("span", { class: "g-label" }, n.label),
      n.qty > 1 ? el("span", { class: "g-qty" }, "×" + n.qty) : null,
      allowed(n.note, ctx) && n.note ? el("span", { class: "g-note" }, n.note) : null,
    ];
    // 收成一项的带口味产物：点开在原处列出各种口味。
    if (n.family) return el("button", { class: "g-node g-family", type: "button", "aria-expanded": "false", onclick: e => {
      e.currentTarget.replaceWith(...n.family.map(m => nodeEl(m, ctx)));
      ctx.redraw();
    } }, parts);
    if (!n.ref) return el("span", { class: "g-node is-text" }, parts);
    return el("button", { class: "g-node", type: "button", onclick: () => ctx.pick(n.ref) }, parts);
  }
  function groupEl(g, side, ctx) {
    // 能看的照常列出；受保护的收成一个带锁的格子写明几项，点开才逐个列出（每项仍按需查看）。
    const nodes = g.nodes.filter(n => viewable(n) && allowed(n.label, ctx)), locked = g.nodes.filter(n => !nodes.includes(n));
    const box = el("section", { class: "g-group", dataset: { edge: g.edge, side } },
      el("header", { class: "g-head" }, el("span", { class: "g-kind" }, allowed(g.label, ctx) ? g.label : t("后续内容")),
        g.via && allowed(g.via, ctx) ? el("span", { class: "g-via" }, g.via) : null, el("span", { class: "g-count" }, String(g.nodes.length))),
      g.note && allowed(g.note, ctx) ? el("p", { class: "g-gnote" }, g.note) : null);
    const list = el("div", { class: "g-nodes" }, nodes.slice(0, LIMIT).map(n => nodeEl(n, ctx)));
    if (locked.length) list.append(el("button", { class: "g-node is-protected g-locked", type: "button", "aria-expanded": "false", title: t("涉及后续内容，点开后按需查看"), onclick: e => {
      e.currentTarget.replaceWith(...locked.map(n => protectedNode(n, ctx)));
      ctx.redraw();
    } }, el("span", { class: "g-lock", html: LOCK }), el("span", { class: "g-label" }, t("{n} 项后续内容", { n: locked.length }))));
    box.append(list);
    if (nodes.length > LIMIT) box.append(el("button", { class: "g-more", type: "button", onclick: e => {
      const lock = list.querySelector(".g-locked");
      for (const n of nodes.slice(LIMIT)) list.insertBefore(nodeEl(n, ctx), lock);
      e.currentTarget.remove();
      ctx.redraw();
    } }, t("还有 {n} 个", { n: nodes.length - LIMIT })));
    if (g.chain) {
      const chain = App.relationChain(g.chain);
      if (chain.deep) box.append(el("button", { class: "g-chain-toggle", type: "button", "aria-expanded": "false", onclick: e => ctx.toggleChain(g, chain, e.currentTarget) }, t("展开整条链")));
    }
    return box;
  }
  function columnEl(side, part, ctx) {
    return el("div", { class: "g-col g-" + side }, el("h4", { class: "g-col-title" }, part.title),
      part.groups.length ? part.groups.map(g => groupEl(g, side, ctx)) : el("p", { class: "g-empty" }, t("没有收录")));
  }

  // 整条合成链：原料在左，成品在右，横向的树；窄屏改成自上而下缩进的树（同一份结构，样式切换）。
  function chainEl(g, chain, center, ctx) {
    const branch = n => {
      const ref = n.id ? { type: "item", id: n.id } : null;
      if (ref && !App.spoilers.canView(ref)) return el("li", { class: "g-branch" }, el("div", { class: "g-self" }, protectedNode({ ref }, ctx)));
      const node = { ref: n.generic ? null : ref, label: n.generic ? N(n.z) : App.nameOf(n.id || n.z), icon: n.i, qty: n.qty, generic: n.generic };
      const via = n.via ? n.via + (n.time ? " · " + n.time : "") : null;
      const alt = n.alt?.length ? t("也可以：{list}", { list: App.list(n.alt) }) : null;
      return el("li", { class: "g-branch" },
        el("div", { class: "g-self" }, nodeEl(node, ctx), allowed(via, ctx) && via ? el("span", { class: "g-via" }, via) : null,
          allowed(alt, ctx) && alt ? el("span", { class: "g-alt" }, alt) : null),
        n.children?.length ? el("ul", { class: "g-kids" }, n.children.map(branch)) : null);
    };
    const how = [g.label, g.via].filter(x => x && allowed(x, ctx)).join(" · ");
    const root = el("li", { class: "g-branch g-root" },
      el("div", { class: "g-self" }, el("span", { class: "g-node is-text g-product" }, iconOf(center) ? App.img(center.icon, "g-icon") : null,
        el("span", { class: "g-label" }, center.label)), how ? el("span", { class: "g-via" }, how) : null),
      el("ul", { class: "g-kids" }, chain.tree.map(branch)));
    const totals = chain.totals.map(x => nodeEl({ ref: x.id ? { type: "item", id: x.id } : null, label: x.generic ? N(x.z) : App.nameOf(x.id || x.z), icon: x.i, qty: x.qty, generic: x.generic }, ctx));
    return el("section", { class: "g-chain" }, el("h4", { class: "g-col-title" }, t("整条合成链")),
      el("div", { class: "g-tree-wrap" }, el("ul", { class: "g-tree" }, root)),
      el("div", { class: "g-total" }, el("span", { class: "g-kind" }, t("合计原料")), totals),
      el("p", { class: "d-sub" }, t("中间材料按第一种做法展开（优先用设备加工）；别的做法写在“也可以”里。")));
  }

  // 连线：每组从组标题连到中间的条目，箭头都朝右（左栏指向条目，条目指向右栏）。
  function drawEdges(stage) {
    const svg = stage.querySelector(".g-edges");
    svg.replaceChildren();
    if (stage.clientWidth < NARROW) return;
    const base = stage.getBoundingClientRect(), mid = stage.querySelector(".g-center").getBoundingClientRect();
    svg.setAttribute("width", stage.scrollWidth);
    svg.setAttribute("height", stage.scrollHeight);
    const cy = mid.top + mid.height / 2 - base.top;
    for (const box of stage.querySelectorAll(".g-group")) {
      const r = box.getBoundingClientRect(), head = box.querySelector(".g-head").getBoundingClientRect();
      const y = head.top + head.height / 2 - base.top;
      const [x1, y1, x2, y2] = box.dataset.side === "left"
        ? [r.right - base.left, y, mid.left - base.left, cy] : [mid.right - base.left, cy, r.left - base.left, y];
      const dx = Math.max(12, (x2 - x1) / 2);
      const line = document.createElementNS(SVG, "path");
      line.setAttribute("d", `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2 - 6} ${y2}`);
      line.setAttribute("class", "g-edge " + box.dataset.edge);
      const arrow = document.createElementNS(SVG, "path");
      arrow.setAttribute("d", `M${x2 - 7} ${y2 - 4} L${x2} ${y2} L${x2 - 7} ${y2 + 4} Z`);
      arrow.setAttribute("class", "g-arrow " + box.dataset.edge);
      svg.append(line, arrow);
    }
  }

  function render(ref, { title, pick, trail = [], refName }) {
    const rel = App.relations(ref);
    if (!rel) return null;
    const stage = el("div", { class: "g-stage" });
    const chainBox = el("div", { class: "g-chain-panel", hidden: true });
    let frame = 0;
    const ctx = {
      title, pick,
      redraw: () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => drawEdges(stage)); },
      toggleChain(g, chain, button) {
        const open = button.getAttribute("aria-expanded") === "true";
        for (const b of stage.querySelectorAll(".g-chain-toggle")) { b.setAttribute("aria-expanded", "false"); b.textContent = t("展开整条链"); }
        chainBox.replaceChildren();
        chainBox.hidden = open;
        if (open) return;
        chainBox.append(chainEl(g, chain, rel.center, ctx));
        button.setAttribute("aria-expanded", "true");
        button.textContent = t("收起整条链");
        chainBox.scrollIntoView({ block: "nearest" });
      },
    };
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "g-edges");
    svg.setAttribute("aria-hidden", "true");
    const center = el("div", { class: "g-center" }, iconOf(rel.center) ? App.img(rel.center.icon, "g-center-icon") : null,
      el("strong", null, rel.center.label), rel.center.sub ? el("span", { class: "g-sub" }, rel.center.sub) : null);
    stage.append(svg, columnEl("left", rel.left, ctx), el("div", { class: "g-mid" }, center), columnEl("right", rel.right, ctx));
    // 从关系图一路点过来的路径，点前面的可以退回去。
    const crumbs = trail.length > 1 ? el("nav", { class: "g-trail", "aria-label": t("关系图浏览路径") }, trail.flatMap((r, i) => [
      i ? el("span", { class: "g-sep", "aria-hidden": "true" }, "›") : null,
      i === trail.length - 1 ? el("span", { class: "g-here", "aria-current": "page" }, refName(r))
        : el("button", { class: "g-crumb", type: "button", onclick: () => pick(r) }, refName(r)),
    ])) : null;
    const root = el("div", { class: "graph", dataset: { spoilerScoped: "true" } }, crumbs, stage, chainBox,
      el("p", { class: "d-sub g-hint" }, t("点任一项，就以它为中心重画关系图。")));
    const observer = new ResizeObserver(() => { if (!stage.isConnected) { observer.disconnect(); return; } drawEdges(stage); });
    observer.observe(stage);
    return root;
  }

  App.graph = { supports: ref => !!App.relations(ref), render };
})();
