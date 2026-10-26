/* 手动记录实际提交的收集包要求；与拥有物品、房间修复进度相互独立。 */
(function () {
  "use strict";
  const A = window.App, { el, img } = A;
  if (!A.state.collections || typeof A.state.collections !== "object" || Array.isArray(A.state.collections)) A.state.collections = {};
  const viewPreferences = new Map(), cleared = new Map();
  const qualityNames = { gold: "金星品质", silver: "银星品质", iridium: "铱星品质" };

  function resolve(room, bundle) {
    const name = typeof room === "string" ? room : room?.room;
    const entry = A.D.bundles.find(value => value.room === name);
    const title = typeof bundle === "string" ? bundle : bundle?.name;
    const value = entry?.bundles.find(value => value.name === title);
    if (!value) return null;
    return { room: entry, bundle: value, key: `${entry.room}:${value.name}` };
  }
  const required = value => value.bundle.cost ? 1 : Math.min(value.bundle.items.length, value.bundle.slots || value.bundle.items.length);
  function record(value) {
    const saved = A.state.collections[value.key];
    const items = Array.isArray(saved?.items) ? [...new Set(saved.items.filter(index => Number.isInteger(index)
      && index >= 0 && index < value.bundle.items.length))].slice(0, required(value)) : [];
    return { items, paid: !!value.bundle.cost && saved?.paid === true };
  }
  function summary(room, bundle) {
    const value = resolve(room, bundle);
    if (!value) return { submitted: 0, required: 0, complete: false, started: false };
    const saved = record(value), count = value.bundle.cost ? Number(saved.paid) : saved.items.length, target = required(value);
    return { submitted: count, required: target, complete: target > 0 && count >= target, started: count > 0 };
  }
  function isSubmitted(room, bundle, index) {
    const value = resolve(room, bundle);
    if (!value || !Number.isInteger(index)) return false;
    const saved = record(value);
    return value.bundle.cost ? index === 0 && saved.paid : saved.items.includes(index);
  }
  function write(value, next) {
    if (next.paid || next.items.length) A.state.collections[value.key] = next;
    else delete A.state.collections[value.key];
    A.emit("collections");
  }
  function toggle(room, bundle, index, checked) {
    const value = resolve(room, bundle);
    if (!value || !Number.isInteger(index) || index < 0 || index >= (value.bundle.cost ? 1 : value.bundle.items.length)) return false;
    const next = record(value), current = isSubmitted(room, bundle, index), selected = checked == null ? !current : !!checked;
    if (selected === current) return false;
    if (!value.bundle.cost && selected && next.items.length >= required(value)) return false;
    if (value.bundle.cost) next.paid = selected;
    else if (selected) next.items.push(index);
    else next.items = next.items.filter(item => item !== index);
    cleared.delete(value.key);
    write(value, next);
    return true;
  }
  function resetBundle(room, bundle) {
    const value = resolve(room, bundle);
    if (!value || !summary(room, bundle).started) return null;
    const snapshot = record(value), token = {};
    cleared.set(value.key, { snapshot, token });
    delete A.state.collections[value.key];
    A.emit("collections");
    // A later edit invalidates this undo, so it can never overwrite newer records.
    return () => undoReset(value, token);
  }
  function undoReset(value, token) {
    const previous = cleared.get(value.key);
    if (!previous || (token && token !== previous.token)) return false;
    cleared.delete(value.key);
    write(value, { items: [...previous.snapshot.items], paid: previous.snapshot.paid });
    return true;
  }
  function itemDetails(item) {
    const it = A.itemInfo(item.id || item.zh || item.z) || { z: item.zh || item.z || "物品" };
    const ref = it.id ? { type: "item", id: it.id } : { type: "page", id: it.z };
    const allowed = A.spoilers.canView(ref) && A.spoilers.textAllowed(it.z);
    return { it, ref, allowed };
  }
  function renderRequirements(room, bundle) {
    const value = resolve(room, bundle), root = el("div", { class: "collection-requirements" });
    if (!value) return el("p", { class: "d-sub" }, "这份收集包资料暂不可用。");
    if (!A.spoilers.canView({ type: "bundle", id: value.key })) return el("p", { class: "d-sub" }, "这份收集包属于尚未确认探索的内容，请先按需查看。");
    const preference = viewPreferences.get(value.key) || { missingOnly: false };
    viewPreferences.set(value.key, preference);

    function paint() {
      const status = summary(value.room, value.bundle), cash = !!value.bundle.cost;
      const recording = preference.recording === true;
      const toggleRecording = el("button", { type: "button", class: "btn collection-recording", "aria-pressed": String(recording),
        onclick: () => { preference.recording = !recording; paint(); } }, recording ? "返回材料清单" : "记录提交（可选）");
      const statusText = cash ? (status.complete ? "已记录整笔金币交付" : "尚未记录金币交付")
        : status.complete ? `已交 ${status.submitted}/${status.required} 项 · 已够要求`
          : `已交记录 ${status.submitted}/${status.required} 项 · 还需记录 ${status.required - status.submitted} 项`;
      const progress = el("p", { class: "collection-progress", role: "status", dataset: { complete: String(status.complete) } }, statusText);
      const controls = el("div", { class: "collection-controls" });
      if (!cash) {
        const filter = el("input", { type: "checkbox", checked: preference.missingOnly });
        filter.addEventListener("change", () => { preference.missingOnly = filter.checked; paint(); });
        controls.append(el("label", { class: "collection-check collection-filter" }, filter, "只看未提交"));
      }
      controls.append(el("button", { type: "button", class: "btn collection-reset", disabled: !status.started,
        onclick: () => { resetBundle(value.room, value.bundle); paint(); } }, "清除本包记录"));
      const undo = cleared.get(value.key);
      const undoNotice = undo ? el("p", { class: "collection-undo", role: "status" }, "已清除本包记录。",
        el("button", { type: "button", class: "btn", onclick: () => { undoReset(value, undo.token); paint(); } }, "撤销清除")) : null;
      let requirements;
      if (cash) {
        const checkbox = el("input", { type: "checkbox", checked: status.complete });
        checkbox.addEventListener("change", () => { toggle(value.room, value.bundle, 0, checkbox.checked); paint(); });
        requirements = el(recording ? "label" : "div", { class: "collection-check collection-payment" }, recording ? checkbox : null,
          img("Gold.png"), el("span", null, el("strong", null, A.money(value.bundle.cost)), el("span", null, recording ? "已在游戏中交付整笔金币" : "需交付的金币数量")));
      } else {
        const rows = [];
        value.bundle.items.forEach((item, index) => {
          const submitted = isSubmitted(value.room, value.bundle, index);
          if (recording && preference.missingOnly && submitted) return;
          const { it, ref, allowed } = itemDetails(item), qty = item.qty ?? item.q ?? 1;
          const quality = qualityNames[item.quality] || (item.note && A.spoilers.textAllowed(item.note) ? item.note : "");
          const checkbox = el("input", { type: "checkbox", checked: submitted,
            disabled: !allowed || (!submitted && status.complete),
            "aria-label": allowed ? `${it.z}，数量 ${qty}${quality ? `，${quality}` : ""}，已提交` : `第 ${index + 1} 项尚未探索` });
          checkbox.addEventListener("change", () => { toggle(value.room, value.bundle, index, checkbox.checked); paint(); });
          const target = el("button", { type: "button", class: "collection-item", onclick: () => A.select(ref) },
            allowed ? img(it.i) : el("span", { class: "collection-concealed", "aria-hidden": "true" }, "?"),
            el("span", null, el("strong", null, allowed ? it.z : "未探索物品 · 按需查看"),
              el("span", { class: "collection-quantity" }, `数量 ×${qty}`, quality ? ` · ${quality}` : "")));
          const source = allowed && item.source_text && A.spoilers.textAllowed(item.source_text) ? item.source_text : null;
          rows.push(el("li", { class: "collection-requirement" + (recording ? "" : " reference-requirement"), dataset: { index: String(index), submitted: String(recording && submitted) } },
            recording ? el("label", { class: "collection-check collection-submit" }, checkbox, el("span", null, "已提交")) : null,
            el("div", { class: "collection-item-detail" }, target,
              source ? el("p", { class: "collection-source" }, source) : null,
              !allowed ? el("p", { class: "collection-source" }, "此项物品资料按需查看。") : null)));
        });
        requirements = el("ul", { class: "collection-list" }, rows);
        if (!rows.length) requirements.append(el("li", { class: "collection-empty" }, "本包所需项目均已记录提交。"));
      }
      const rule = cash ? "记录整笔交付，不记录金币余额。" : value.bundle.choose
        ? `任选 ${status.required} 项即可；够数后，其余选项不再需要提交。更改选项时，先取消原记录。`
        : "每一项都需要达到标注数量和品质后，再勾选提交。";
      root.replaceChildren(...[recording ? progress : null, recording ? el("p", { class: "collection-rule" }, rule) : null, recording ? controls : null,
        recording ? undoNotice : null, requirements, toggleRecording,
        recording ? el("p", { class: "collection-note" }, "按游戏内实际提交勾选；未勾选表示尚无提交记录。记录保存在这台设备。") : null].filter(Boolean));
    }
    paint();
    return root;
  }
  A.collections = { renderRequirements, summary, isSubmitted, toggle, resetBundle };
})();
