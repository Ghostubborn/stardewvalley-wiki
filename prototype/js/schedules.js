/* 日程原文速查：保留条件分支，不把参考时间表当成实时位置。 */
(function () {
  "use strict";
  const A = window.App, { el } = A;
  const weekday = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
  const seasons = { 春季: "spring", 夏季: "summer", 秋季: "fall", 冬季: "winter" };
  const choices = new Map();

  function match(group, cond) {
    const label = group.label;
    const explicit = [...label.matchAll(/(春季|夏季|秋季|冬季)/g)].map(m => seasons[m[1]]);
    if (explicit.length && !explicit.includes(cond.season)) return false;
    const dates = label.replace(/(\d{1,2})(?=[、和，,]\s*\d{1,2}日)/g, "$1日");
    const days = [...dates.matchAll(/(?:第)?(\d{1,2})(?:日|天)/g)].map(m => +m[1]);
    // Dates in relationship requirements (e.g. 6 hearts) must not become days.
    if (days.length && !days.includes(cond.day)) return false;
    const weeks = [...label.matchAll(/(?:星期|周)([一二三四五六日天])/g)].map(m => weekday[m[1]]);
    const exclusion = /除外|之外|以外|不包括|非星期|非周/.test(label);
    if (!exclusion && weeks.length && !weeks.includes(A.weekday(cond.day))) return false;
    if (/雨天|下雨/.test(label) && !/不下雨|非雨天/.test(label) && !["rain", "storm"].includes(cond.weather)) return false;
    if (/晴天|不下雨|非雨天/.test(label) && ["rain", "storm"].includes(cond.weather)) return false;
    if (/绿雨/.test(label)) return null;
    if (exclusion || /心|友谊|修复|解锁|任务|作为|婚|之后|以后|完成|第一年|第二年/.test(label)) return null;
    return true;
  }

  function render(name) {
    const source = A.D.schedules?.[name];
    if (!source) return null;
    const preference = choices.get(name) || { season: "all", marriage: false, all: true };
    choices.set(name, preference);
    const root = el("section", { class: "d-section schedule-section", dataset: { spoilerScoped: "true" } });
    function hidden(factory, label) {
      const holder = el("div", { class: "schedule-protected" });
      holder.append(el("button", { type: "button", class: "btn", onclick: () => holder.replaceChildren(factory()) }, label + "（可能涉及后续内容）"));
      return holder;
    }
    function table(group) {
      const rows = el("ol", { class: "schedule-rows" });
      const currentTime = A.state.cond.time;
      group.rows.forEach((row, index) => {
        const shown = A.spoilers.textAllowed(row.text, name);
        const active = A.conditionsActive() && currentTime >= row.at && (index === group.rows.length - 1 || currentTime < group.rows[index + 1].at);
        const content = () => {
          const places = row.links.filter(place => A.locationByName.has(place) && A.spoilers.canView({ type: "location", id: place }));
          return el("div", null, el("p", null, row.text), places.length ? el("div", { class: "schedule-places" }, [...new Set(places)].map(place =>
            el("button", { type: "button", class: "btn", onclick: () => { A.select({ type: "location", id: place }); A.setView("map"); A.map.focusPlace(place); } }, "定位" + place))) : null);
        };
        rows.append(el("li", { class: "schedule-row" + (active ? " time-match" : "") }, el("time", null, row.time),
          shown ? content() : hidden(content, "查看此时段地点")));
      });
      return rows;
    }
    function paint() {
      const cond = { ...A.state.cond, season: preference.season === "all" ? A.state.cond.season : preference.season };
      const select = el("select", { "aria-label": "日程季节" }, el("option", { value: "all" }, "全部季节"), A.SEASONS.map(season => el("option", { value: season }, A.SEASON_ZH[season])));
      select.value = preference.season;
      select.addEventListener("change", () => { preference.season = select.value; paint(); });
      const married = el("input", { type: "checkbox", checked: preference.marriage });
      married.addEventListener("change", () => { preference.marriage = married.checked; paint(); });
      const all = el("input", { type: "checkbox", checked: preference.all });
      all.addEventListener("change", () => { preference.all = all.checked; paint(); });
      const controls = el("div", { class: "schedule-controls" }, el("label", null, "季节 ", select),
        source.groups.some(g => g.season === "marriage") ? el("label", { class: "check" }, married, "查看婚后日程") : null,
        A.conditionsActive() ? el("label", { class: "check" }, all, "列出全部日期情况") : null);
      const groups = source.groups.filter(g => (preference.marriage ? g.season === "marriage" : g.season !== "marriage" && (preference.season === "all" || g.season === preference.season || g.season === "all"))
        && (!A.conditionsActive() || preference.all || match(g, cond) !== false));
      const cards = el("div", { class: "schedule-cards" });
      let opened = 0;
      let protectedGroups = false;
      for (const group of groups) {
        if (!A.spoilers.textAllowed(group.label, name)) { protectedGroups = true; continue; }
        const known = A.conditionsActive() ? match(group, cond) : null;
        const d = el("details", { class: "schedule-card", open: (known === true || !A.conditionsActive()) && opened++ < 1 },
          el("summary", null, group.label, known === null ? el("span", { class: "schedule-qualifier" }, " · 需核对标题条件") : null));
        // Keep unopened rows out of the DOM; expansion is specific to this table.
        d.addEventListener("toggle", () => {
          if (d.open && !d.querySelector(".schedule-rows")) d.append(table(group));
          if (!d.open) d.querySelector(".schedule-rows")?.remove();
        });
        if (d.open) d.append(table(group));
        cards.append(d);
      }
      if (protectedGroups) cards.append(hidden(() => el("div", null, groups.filter(g => !A.spoilers.textAllowed(g.label, name)).map(g =>
        el("details", { class: "schedule-card" }, el("summary", null, g.label), table(g)))), "查看其他条件日程"));
      const notes = source.notes.filter(text => A.spoilers.textAllowed(text, name));
      root.replaceChildren(...[el("h3", null, "日程速查"),
        A.conditionsActive() ? el("p", { class: "d-sub schedule-context" }, `${A.SEASON_ZH[cond.season]} ${cond.day} 日 · ${A.WEEKDAY_ZH[A.weekday(cond.day)]} · ${A.WEATHER[cond.weather].zh} · ${A.fmtTime(cond.time)}`) : null,
        el("p", { class: "schedule-explanation" }, A.conditionsActive() ? "对照所设日期、星期和天气，仍需核对表标题中的其他条件。时间高亮仅方便对照，不代表实时位置。" : "按季节浏览参考日程；各表标题注明日期、天气等适用条件，展开即可查阅。"),
        source.groups.length ? controls : null,
        ...notes.map(text => el("p", { class: "d-sub" }, text)), cards,
        source.groups.length && !groups.length ? el("p", { class: "d-sub" }, "此范围没有可核对的日程，试试列出本季全部情况。") : null,
        el("p", { class: "d-source" }, "日程按原 Wiki 顺序排列。节日、临时活动与房间进入条件也可能影响找人。",
          el("a", { href: source.source, target: "_blank", rel: "noopener" }, "查看原日程"))].filter(Boolean));
    }
    paint();
    return root;
  }
  A.schedules = { render, matches: match };
})();
