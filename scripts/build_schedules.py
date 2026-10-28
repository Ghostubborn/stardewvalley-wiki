"""Extract source-labelled NPC timetables, preserving alternatives and source order.

These are reference tables, not a live-position predictor. Only leaf wiki tables
whose first column is a clock time are accepted; unrelated relationship/event
tables never enter the product. Called by build_prototype.py.
"""
import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import quote

SEASONS = {"spring": "spring", "summer": "summer", "fall": "fall", "winter": "winter", "marriage": "marriage"}
LEAF_TABLE = re.compile(r"\{\|(?:(?!\{\|).)*?\|\}", re.S)
SEASON_HEADER = re.compile(r"\{\{\s*ScheduleHeader\s*\|\s*([^}|]+)[^}]*\}\}", re.I)
CLOCK = re.compile(r"^(\d{1,2})[:：](\d{2})$")
SNAPSHOT = "2026-10-29"  # 星露谷物语 BWIKI 的抓取日期（scripts/fetch_bwiki.py）


def daily_tables(body, wt):
    """BWIKI 的 {{Daily|时间|地点|…}}（模块:Schedule 把成对的参数排成两列的时间表）换成同样的表格写法。"""
    out, last = [], 0
    for raw, start, end in wt.iter_templates(body):
        name, args = wt.parse_template(raw)
        if name.strip().lower() != "daily":
            continue
        count = max((int(k) for k in args if k.isdigit()), default=0)
        cells = [args.get(str(i), "").strip() for i in range(1, count + 1)] + [""]
        rows = [f"|{cells[i]}\n|{cells[i + 1]}" for i in range(0, count, 2) if cells[i]]
        out.append(body[last:start] + "\n{|\n" + "\n|-\n".join(rows) + "\n|}\n")
        last = end
    out.append(body[last:])
    return "".join(out)


def parse(text, wt):
    text = daily_tables(text, wt)
    sections = wt.sections(text)
    relevant = [s for s in sections if s["title"] and re.fullmatch(r"(?:日程|行程)(?:表)?", s["title"].strip())]
    if not relevant:
        return []
    # Include any subheadings belonging to the timetable, stopping at the next
    # peer section. Most pages put season tables inside the level-two body.
    first = sections.index(relevant[0])
    pieces = []
    for s in sections[first:]:
        if pieces and s["level"] <= relevant[0]["level"]:
            break
        pieces.append(s["body"])
    body = "\n".join(pieces)
    renderer = wt.Renderer()
    headers = list(SEASON_HEADER.finditer(body))
    groups = []
    last_end = 0
    for match in LEAF_TABLE.finditer(body):
        raw = match.group()
        tables = wt.wikitables(raw)
        if not tables:
            continue
        table = tables[0]
        season_headers = [h for h in headers if h.start() < match.start()]
        header = season_headers[-1] if season_headers else None
        season = SEASONS.get(header.group(1).strip().lower(), "all") if header else "all"
        before = body[max(last_end, header.end() if header else 0):match.start()]
        bold = re.findall(r"'''(.*?)'''", before, re.S)
        title = renderer.render(bold[-1]) if bold else ""
        entries = []
        for row in table["rows"]:
            if row and all(c["header"] for c in row):
                label = " ".join(renderer.render(c["text"]) for c in row)
                if len(row) == 1 and label and label not in {"时间", "地点", "时间 地点"}:
                    title = label
                continue
            if len(row) < 2:
                continue
            time = renderer.render(row[0]["text"]).strip()
            place_raw = " ".join(c["text"] for c in row[1:])
            place = renderer.render(place_raw).strip()
            clock = CLOCK.fullmatch(time)
            if clock:
                h, m = map(int, clock.groups())
                if h > 26 or m > 59:
                    continue
                at = h * 100 + m
                if h < 6:
                    at += 2400
            elif time in {"全天", "整天", "任何时间"}:
                at = 600
            else:
                continue
            if not place or "{|" in place or "|}" in place:
                continue
            entries.append({"time": time, "at": at, "text": place, "links": wt.page_links(place_raw)})
        last_end = match.end()
        if entries:
            groups.append({"season": season, "label": title or "日常时间表", "rows": entries, "order": len(groups)})
    return groups


def build(root):
    root = Path(root)
    spec = importlib.util.spec_from_file_location("schedule_wikitext", root / "scripts/sdvdata/wikitext.py")
    wt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wt)
    villagers = {v["page"] for v in json.loads((root / "data/build/villagers.json").read_text())}
    result = {}
    with (root / "data/wiki/zh-pages.jsonl").open() as source:
        for line in source:
            page = json.loads(line)
            if page["title"] not in villagers:
                continue
            groups = parse(page["text"], wt)
            section = next((s for s in wt.sections(page["text"]) if s["title"] and re.fullmatch(r"(?:日程|行程)(?:表)?", s["title"].strip())), None)
            notes = []
            if section:
                prefix = re.split(r"\{\||\{\{\s*ScheduleHeader", section["body"], maxsplit=1, flags=re.I)[0]
                notes = [wt.Renderer().render(p) for p in re.split(r"\n\s*\n", prefix) if wt.Renderer().render(p)]
            if groups or notes:
                result[page["title"]] = {
                    "groups": groups, "notes": notes,
                    "source": "https://wiki.biligame.com/stardewvalley/" + quote(page["title"]) + "#日程",
                    "revision": page["rev_id"], "updated": page["timestamp"], "snapshot": SNAPSHOT,
                }
    return result


if __name__ == "__main__":
    result = build(Path(__file__).resolve().parents[1])
    print(json.dumps({"villagers": len(result), "tables": sum(len(s["groups"]) for s in result.values()),
                      "rows": sum(len(g["rows"]) for s in result.values() for g in s["groups"])}, ensure_ascii=False))
