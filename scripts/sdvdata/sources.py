"""逐个物品的来源：墙纸、地板、服装和任务物品没有独立条目，来源写在合集页的表格里。

两种语言各自读取本语言的合集页，按图标文件名或物品名对应到物品；返回的文字都来自该语言的 Wiki。
"""

import re

from . import parse as P
from . import wikitext as wt

PAGES = {
    "zh": {"wallpaper": "墙纸", "flooring": "地板", "tailoring": "裁缝", "quests": "任务"},
    "en": {"wallpaper": "Wallpaper", "flooring": "Flooring", "tailoring": "Tailoring", "quests": "Quests"},
}
# 墙纸页按章节分三类：目录可得、单独来源、无法获得。
WALL_SECTIONS = {
    "catalogue": re.compile(r"^(目录墙纸|Catalogue Wallpapers)$"),
    "single": re.compile(r"^(非目录来源墙纸|Non-Catalogue Wallpapers)$"),
    "none": re.compile(r"^(无法获得的墙纸|Unobtainable Wallpapers)$"),
}
# 章节导言说的是“以下墙纸”；放进单件物品的来源时改成指这一件。
WALL_INTRO = [
    (re.compile(r"^以下墙纸"), "此墙纸"),
    (re.compile(r"^The following wallpapers? can"), "This wallpaper can"),
    (re.compile(r"^The following wallpapers are unobtainable"), "This wallpaper is unobtainable"),
]
# 服装表“备注”列也写特性（无袖、五彩……），只保留说明获得方式的条目。
CLOTHING_PROPERTY = re.compile(r"^(无袖|五彩|上衣|颜色取决于|男女款|Sleeveless|Prismatic)", re.I)
OBTAIN_SECTION = re.compile(r"^(获取途径|获得方式|获取方式|获得途径|来源|Obtaining|Acquisition|Sources?|How to Obtain|Finding .+|.+ Sources)$", re.I)
ICON = re.compile(r"(Wallpaper|Flooring)[ _](\d+)[ _]Icon", re.I)


def image_key(name):
    return (name or "").strip().replace(" ", "_").casefold()


def icon_number(name):
    m = ICON.search(name or "")
    return int(m.group(2)) if m else None


def _blocks(body):
    """章节正文 → 按顺序的 ('text', 段落) / ('table', 表格源码)。"""
    out, pos = [], 0
    for m in re.finditer(r"\{\|.*?\n\|\}", body, re.S):
        out.append(("text", body[pos:m.start()]))
        out.append(("table", m.group(0)))
        pos = m.end()
    out.append(("text", body[pos:]))
    return out


def _paragraphs(text, render):
    return [p for p in (re.sub(r"\s+", " ", render(x)).strip() for x in re.split(r"\n\s*\n", text)) if p]


def _intro(paras):
    """表格前的说明：从最后一段“以下墙纸……”起到表格为止（中文版常把目录的购买方式另起一段）。"""
    start = max((i for i, p in enumerate(paras) if re.match(r"以下墙纸|The following", p)), default=len(paras) - 1)
    text = ("" if re.search(r"[㐀-鿿]", paras[-1]) else " ").join(paras[start:])
    for pattern, repl in WALL_INTRO:
        text = pattern.sub(repl, text)
    return text


def wallpaper(text, render):
    """{图标编号: [来源条目]}。"""
    out = {}
    for sec in wt.sections(text or ""):
        title = (sec["title"] or "").strip("= ").strip()
        kind = next((k for k, pattern in WALL_SECTIONS.items() if pattern.match(title)), None)
        if not kind:
            continue
        intro = None
        for block, raw in _blocks(sec["body"]):
            if block == "text":
                paras = _paragraphs(raw, render)
                if paras:
                    intro = _intro(paras)
                continue
            for row in wt.wikitables(raw)[0]["rows"]:
                cells = [c["text"] for c in row]
                for i, cell in enumerate(cells):
                    number = icon_number(cell)
                    if number is None or "Icon" not in cell:
                        continue
                    if kind == "single":
                        source = next((c for c in cells[i + 1:] if "[[File:" not in c and c.strip()), "")
                        entries = P.list_entries(source, render)
                    else:
                        entries = [intro] if intro else []
                    if entries:
                        out.setdefault(number, [])
                        out[number] += [e for e in entries if e not in out[number]]
    return out


def flooring(text, render):
    """{图标编号: [来源条目]}：“来源”节的总则按编号范围适用，表格补充个别地板的其他来源。"""
    out = {}
    for sec in wt.sections(text or ""):
        title = (sec["title"] or "").strip("= ").strip()
        if title not in ("来源", "Sources"):
            continue
        rules = []
        for line in sec["body"].split("\n"):
            if not line.lstrip().startswith("*"):
                continue
            entry = re.sub(r"\s+", " ", render(line.lstrip("* "))).strip()
            if re.search(r"下表|table below", entry):
                continue
            m = re.search(r"前\s*(\d+)\s*种|first (\d+) flooring", entry)
            rules.append((int(m.group(1) or m.group(2)) if m else None, entry))
        for table in wt.wikitables(sec["body"]):
            for row in table["rows"][1:]:
                cells = [c["text"] for c in row]
                number = next((icon_number(c) for c in cells if icon_number(c) is not None), None)
                if number is not None and len(cells) >= 3:
                    out.setdefault(number, []).extend(P.list_entries(cells[-1], render))
        numbers = set(out) | set(range(1, 100))
        for number in numbers:
            general = [entry for limit, entry in rules if limit is None or number <= limit]
            out[number] = general + [e for e in out.get(number, []) if e not in general]
    return out


def tailoring(text, render):
    """{图片键: {'name', 'notes': [获得方式], 'recipe': 配方原文}}，覆盖上衣、下装两张表。"""
    out = {}
    for table in wt.wikitables(text or "")[:2]:
        rows = table["rows"]
        if not rows:
            continue
        header = [re.sub(r"\s+", " ", render(c["text"])).strip() for c in rows[0]]
        note_col = next((i for i, h in enumerate(header) if h.startswith(("备注", "Special Property"))), None)
        recipe_col = next((i for i, h in enumerate(header) if h.startswith(("配方", "Recipe"))), None)
        for row in rows[1:]:
            files = wt.files(row[0]["text"]) if row else []
            if not files:
                continue
            key = image_key(files[0].split("|")[0])
            notes = []
            if note_col is not None and note_col < len(row):
                notes = [n for n in P.list_entries(row[note_col]["text"], render) if not CLOTHING_PROPERTY.match(n)]
            recipe = row[recipe_col]["text"] if recipe_col is not None and recipe_col < len(row) else ""
            name = re.sub(r"\s+", " ", render(row[1]["text"])).strip() if len(row) > 1 else ""
            out.setdefault(key, {"name": name, "notes": notes, "recipe": recipe})
    return out


def match_clothing(rows, items, name):
    """{物品 ID: 表格行}。五彩裤子等与原款共用图片，同图时按名称认领。"""
    by_key, by_number = {}, {}
    for item in items:
        if item["type"] in ("S", "P") and item.get("image"):
            by_key.setdefault(image_key(item["image"]), []).append(item)
        if item["type"] == "S" and item["id"][3:].isdigit():
            by_number.setdefault(int(item["id"][3:]) - 1000, []).append(item)
    out = {}
    for key, row in rows.items():
        # 上衣图片名带变体后缀（Shirt259a.png）时，按编号对应物品 ID（(S)1259）。
        number = re.match(r"shirt(\d+)[a-z]?\.png$", key)
        candidates = by_key.get(key) or (by_number.get(int(number.group(1)), []) if number else [])
        # 表格名有时带说明（“五彩T恤(短袖，胸前有五彩方块图案)”）：其次按名称前缀认领。
        prefixed = sorted((i for i in candidates if name(i) and row["name"].startswith(name(i))), key=lambda i: -len(name(i)))
        target = next((i for i in candidates if name(i) == row["name"]), None) or (prefixed[0] if prefixed else None) \
            or (candidates[0] if len(candidates) == 1 else None)
        if target:
            out[target["id"]] = row
    return out


def quest_items(text, render):
    """{物品名: [“相关任务：任务名”]}，取自任务页的任务物品表。"""
    out = {}
    for table in wt.wikitables(text or ""):
        rows = table["rows"]
        header = [re.sub(r"\s+", " ", render(c["text"])).strip() for c in rows[0]] if rows else []
        if len(header) < 4 or header[-1] not in ("相关任务", "Quest"):
            continue
        sep = "：" if header[-1] == "相关任务" else ": "
        for row in rows[1:]:
            if len(row) < len(header):
                continue
            name = re.sub(r"\s+", " ", render(row[1]["text"])).strip()
            quest = re.sub(r"\s+", " ", render(row[-1]["text"])).strip()
            if name and quest:
                out[name] = [header[-1] + sep + quest]
    return out


def obtain_section(sections, render):
    """条目里“获取途径”一类章节：表格逐行写成“行为：概率”，没有表格时取前两段。"""
    for sec in sections:
        title = (sec["title"] or "").strip("= ").strip()
        if not OBTAIN_SECTION.match(title):
            continue
        entries = []
        for table in wt.wikitables(sec["body"]):
            for row in table["rows"]:
                if any(c["header"] for c in row) or len(row) < 2:
                    continue
                cells = [re.sub(r"\s+", " ", render(c["text"])).strip() for c in row[:2]]
                if all(cells):
                    entries.append(("：" if re.search(r"[㐀-鿿]", cells[0]) else ": ").join(cells))
        if not entries:
            text = re.sub(r"\{\|.*?\n\|\}", "", sec["body"], flags=re.S)
            entries = [p for p in _paragraphs(text, render) if not re.search(r"下表|table below", p)][:2]
        if entries:
            return entries[:12]
    return []
