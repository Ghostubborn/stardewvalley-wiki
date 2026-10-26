"""English display overlay: prototype/data.en.js (window.SDV_EN).

The app keeps Chinese wiki titles and qualified item IDs as internal keys:
deep links, saved progress and spoiler rules all depend on them. This script
only supplies the English text shown on /en/. It is taken from the English
Stardew Valley Wiki archive (WikiTeam, 2025-12-18) and from curated English
files in data/curated/. Nothing here is machine translated; a record without an
English source is left out so the page shows less, never the Chinese text.

Usage: python3 -I scripts/build_en.py   (build_prototype.py also calls build())
"""

import json
import os
import re
import sys
from collections import Counter
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from sdvdata import parse as P  # noqa: E402
from sdvdata import wikitext as wt  # noqa: E402
from sdvdata.catalog import Catalog  # noqa: E402

WIKI = os.path.join(ROOT, "data", "wiki")
BUILD = os.path.join(ROOT, "data", "build")
CURATED = os.path.join(ROOT, "data", "curated")
EN_BASE = "https://stardewvalleywiki.com/"

SEASON_EN = {"spring": "Spring", "summer": "Summer", "fall": "Fall", "winter": "Winter", "all": "Any season"}
WEATHER_EN = {"any": "Any", "sun": "Sunny", "rain": "Rain", "storm": "Storm", "snow": "Snow", "wind": "Windy"}
SKILL_EN = {"farming": "Farming", "mining": "Mining", "foraging": "Foraging", "fishing": "Fishing", "combat": "Combat"}
CURRENCY_EN = {"qi": ("Qi Coin", "Qi Coins"), "gem": ("Qi Gem", "Qi Gems"), "walnut": ("Golden Walnut", "Golden Walnuts"),
               "token": ("Prize Ticket", "Prize Tickets"), "calico": ("Calico Egg", "Calico Eggs"), "jopk": ("JOPK Coin", "JOPK Coins")}
# Names that exist only in this site's Chinese UI (water labels, house tiers) or need a
# singular display form. Each English value is the English wiki's own wording.
EXTRA_NAMES = {
    "鹈鹕镇河流": "Pelican Town river", "煤矿森林河流": "Cindersap Forest river", "煤矿森林池塘": "Cindersap Forest pond",
    "沙滩": "The Beach", "深山": "The Mountain", "森林池塘": "Forest pond", "森林河流": "Forest river",
    "小镇河流": "Town river", "山间湖泊": "Mountain lake", "海边钓鱼点": "Ocean fishing spot",
    "农舍（第一次升级）": "House Upgrade 1", "农舍（第二次升级）": "House Upgrade 2", "农舍（第三次升级）": "House Upgrade 3",
    "大鸡舍": "Big Coop", "高级鸡舍": "Deluxe Coop", "大畜棚": "Big Barn", "高级畜棚": "Deluxe Barn", "大屋子": "Big Shed",
    "农场地图": "Farm Maps",
    # Archive entries the Chinese parser couldn't resolve to an item ID (traditional characters,
    # quantities inside the name). English names are the ones the English wiki uses on the same pages.
    "薯餅": "Hashbrowns", "煎蛋捲": "Omelet", "薄煎餅": "Pancakes", "麵包": "Bread", "碎木機": "Wood Chipper",
    "紅磚地板": "Brick Floor", "魚塘": "Fish Pond", "小鎮鑰匙": "Key To The Town", "棕色大鸡蛋": "Large Brown Egg",
    "高级鱼饵（30）": "Deluxe Bait ×30", "传送图腾：海滩（5）": "Warp Totem: Beach ×5",
    "任意鱼": "Any Fish", "任意水果": "Any Fruit", "任意蔬菜": "Any Vegetable", "蘑菇": "Any Mushroom",
    "装修房屋": "House Renovations", "粉刷建筑物": "Painting", "Joja可乐罐": "Joja Cola Cans", "可食用性": "Edibility",
}
# Tool families are page titles on both wikis ("Axes"); rows read better with the tool name.
FAMILY_EN = {"斧头": "Axe", "十字镐": "Pickaxe", "锄头": "Hoe", "喷壶": "Watering Can", "垃圾桶（工具）": "Trash Can"}
TOOL_PAGES = {"斧头": "Axes", "十字镐": "Pickaxes", "锄头": "Hoes", "喷壶": "Watering Cans", "垃圾桶（工具）": "Trash Cans"}
FIELD_KEYS = ("source", "season", "location", "time", "weather", "recipe", "ingredients", "sellprice", "openhours", "closed",
              "address", "occupants", "birthday", "marriage", "growth", "produces", "craftingstation", "crafttime", "buff", "edibility")
OPEN, CLOSE = "\u0001", "\u0002"


def load_jsonl(path, keep=None):
    with open(path, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            if keep is None or keep(row):
                yield row


def norm_title(title):
    title = title.replace("_", " ").strip()
    return (title[0].upper() + title[1:]) if title and title[0].isascii() else title


def en_url(title):
    return EN_BASE + quote(title.replace(" ", "_"), safe="/:'(),!")


def tcart_price(value):
    """Module:Tcartprice: the Traveling Cart sells at 3–5× base, at least 100–1,000g."""
    if value.strip().lower() == "furniture":
        return "250–2,500g"
    try:
        base = int(float(value.replace(",", "")))
    except ValueError:
        return value
    return f"{max(base * 3, 100) if base * 3 > 100 else 100:,}–{base * 5 if base * 5 > 1000 else 1000:,}g"


def money(amount, unit=""):
    unit = (unit or "").strip().lower()
    if unit in CURRENCY_EN:
        one, many = CURRENCY_EN[unit]
        return f"{amount:,} {one if amount == 1 else many}"
    return f"{amount:,}g"


def sentence_cut(text, limit=320):
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[:end + 1] if end > 80 else cut.rsplit(" ", 1)[0] + "…"


def first_paragraph(text):
    for para in text.split("\n"):
        para = para.strip()
        if len(para) > 20 and not para.startswith(("{|", "|", "!", "*", "#")):
            return para
    return ""


def switch_entries(template_text):
    """Template #switch → {lower-case key: value}; keys sharing a value are separated by |."""
    out = {}
    pending = []
    for line in template_text.split("\n"):
        line = line.strip()
        if not line.startswith("|") or line.startswith("|#default"):
            continue
        key, eq, value = line[1:].partition("=")
        pending.extend(k.strip().lower() for k in key.split("|") if k.strip())
        if eq:
            for k in pending:
                out.setdefault(k, value.strip())
            pending = []
    return out


class English:
    def __init__(self):
        zh_meta = list(load_jsonl(os.path.join(WIKI, "zh-pages.jsonl"), lambda r: r["ns"] in (10, 828)))
        modules = {r["title"]: r["text"] for r in zh_meta if r["ns"] == 828}
        self.catalog = Catalog(modules)
        pairs = re.findall(r'\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\}', modules["模块:NPC"])
        self.npc_en = {zh: en for zh, en in pairs}
        self.npc_zh = {en: zh for zh, en in pairs}
        zh_templates = {norm_title(r["title"]): r["text"] for r in zh_meta if r["ns"] == 10}
        en_rows = list(load_jsonl(os.path.join(WIKI, "en-pages.jsonl"), lambda r: r["ns"] in (0, 10)))
        self.en = {norm_title(r["title"]): r for r in en_rows}
        self.redirects = {norm_title(r["title"]): norm_title(r["redirect"]) for r in en_rows if r["redirect"]}
        self.descriptions = switch_entries(self.en["Template:Description"]["text"])
        # Template:Bundle uses the same switch keys on both wikis; the visible label is the bundle name.
        zh_bundle = self._bundle_labels(zh_templates["Template:Bundle"], r"\[\[收集包#[^|\]]*\|([^\]]+)\]\]")
        self.bundle_en = self._bundle_labels(self.en["Template:Bundle"]["text"], r"\[\[Bundles#[^|\]]*\|([^\]]+)\]\]")
        self.bundle_names = {zh_bundle[k]: v for k, v in self.bundle_en.items() if k in zh_bundle}
        with open(os.path.join(BUILD, "names.json"), encoding="utf-8") as f:
            self.title_en = json.load(f)["title_zh_to_en"]
        self.title_zh = {}
        for zh, en in self.title_en.items():
            self.title_zh.setdefault(en, zh)
        self.renderer = self._renderer()
        self.missing = Counter()

    @staticmethod
    def _bundle_labels(text, label_re):
        names, pending = {}, []
        for line in text.split("\n"):
            line = line.strip()
            if not line.startswith("|") or line.startswith("|#default"):
                continue
            key, eq, value = line[1:].partition("=")
            pending.extend(k.strip().lower() for k in key.split("|") if k.strip())
            if eq:
                labels = re.findall(label_re, value)
                for k in pending:
                    if labels:
                        names[k] = labels[-1].strip()
                pending = []
        return names

    # —— wikitext → English plain text ——
    def _renderer(self):
        catalog = self.catalog

        def name(a):
            raw = a.get("1", "").strip()
            if not raw:
                return ""
            label = None
            if a.get("link"):
                label = a["link"].replace("{{!}}", "|").split("|")[-1].split("#")[0]
            hit = catalog.resolve(raw) or {}
            label = (a.get("alt") or label or hit.get("en") or raw).strip()
            extra = a.get("2", "").strip()
            if re.fullmatch(r"[\d\-~–]+", extra):
                label = f"{label} ×{extra}"
            elif extra:
                label = f"{label} ({extra})"
            return OPEN + label + CLOSE

        def price(a):
            value = a.get("1", "").replace(",", "").strip()
            try:
                return money(int(float(value)), a.get("2", ""))
            except ValueError:
                return value

        def season(a):
            raw = a.get("1", "").strip()
            if raw.lower() in ("marriage",):
                return "Marriage"
            text = SEASON_EN.get(P.SEASONS.get(raw.lower()), raw[:1].upper() + raw[1:])
            return f"{text} {a['2'].strip()}" if a.get("2", "").strip() else text

        def npc(a):
            n = a.get("1", "").strip()
            return OPEN + (f"{n} ({a['2'].strip()})" if a.get("2", "").strip() else n) + CLOSE

        handlers = {
            "name": name, "price": price, "tprice": lambda a: tcart_price(a.get("1", "")),
            "qualityprice": lambda a: price({"1": a.get("2", a.get("1", ""))}),
            "season": season, "weather inline": lambda a: WEATHER_EN.get(P.WEATHER.get(a.get("1", "").strip().lower()), a.get("1", "")),
            "npc": npc, "bundle": lambda a: self.bundle_en.get(a.get("1", "").strip().lower(), a.get("1", "").strip() + " Bundle"),
            "description": lambda a: self.description(a.get("1", "")) or "",
            "!": lambda a: "|", "quote": lambda a: a.get("1", ""), "squote": lambda a: a.get("1", ""),
            "key": lambda a: a.get("1", ""), "nowrap": lambda a: a.get("1", ""), "no wrap": lambda a: a.get("1", ""),
            "tooltip": lambda a: a.get("1", ""), "color": lambda a: a.get("2", ""),
            "cookingchannel": lambda a: f"The Queen of Sauce ({a.get('1', '').strip()})\n",
        }
        base = wt.Renderer(handlers).render

        def render(text):
            text = re.sub(r"\[\[(?:File|Image):HeartIcon[^\]]*\]\]", "❤", text or "")
            text = re.sub(r"</?p\b[^>]*>", "\n", text)
            out = base(text)
            # Adjacent {{Name}}/{{NPC}} templates are a list in the rendered wiki.
            out = re.sub(CLOSE + r"[ \t]*" + OPEN, ", ", out)
            out = out.replace(OPEN, "").replace(CLOSE, "")
            # {{Price|1|calico}} shows only an icon on the wiki, often followed by the currency link.
            out = re.sub(r"(\d[\d,]* (Calico Egg|Qi Gem|Golden Walnut|Qi Coin|Prize Ticket|JOPK Coin)s?) \2s?\b", r"\1", out)
            return out.strip()

        return render

    def plain(self, text):
        return self.renderer(text or "")

    def description(self, name):
        key = (name or "").strip().lower()
        text = self.descriptions.get(key)
        if text is None and key.startswith("("):
            text = self.descriptions.get(key.split(")", 1)[1])
        return self.usable_description(text)

    def usable_description(self, text):
        # Placeholders such as {{{2|}}} or [fish name] are filled in by the game, not by the wiki.
        if not text or "{{{" in text or re.search(r"\[[a-z ]+\]", text):
            return None
        text = self.plain(text)
        return text if len(text) > 4 else None

    def page(self, title):
        title = norm_title(title or "")
        for _ in range(4):
            if title in self.redirects:
                title = self.redirects[title]
        row = self.en.get(title)
        if not row or row["redirect"]:
            return None, title
        text = row["text"]
        if "{{{" in text:
            prev = None
            while prev != text:
                prev = text
                text = re.sub(r"\{\{\{[^{}|]*\|([^{}]*)\}\}\}", r"\1", text)
        return text, title

    def infobox(self, text):
        info = wt.first_template(text or "", "Infobox")
        return (info[1], info[4]) if info else ({}, 0)

    # —— overlays ——
    def pages(self, zh_pages):
        out = {}
        for p in zh_pages:
            if not p.get("en"):
                continue
            text, title = self.page(p["en"])
            if text is None:
                self.missing["page"] += 1
                continue
            fields, end = self.infobox(text)
            sections = wt.sections(text[end:])
            # Villager pages open with a developer quote; the summary should be the article's own lead.
            lead = self.plain(re.sub(r"^\s*\{\{\s*[Qq]uote\b(?:[^{}]|\{\{[^{}]*\}\})*\}\}", "", sections[0]["body"])) if sections else ""
            record = {
                "s": sentence_cut(first_paragraph(lead)),
                "f": {k: v if k == "source" else sentence_cut(v, 160)
                      for k in FIELD_KEYS if fields.get(k) and (v := self.plain(fields[k]))},
                "sec": [s["title"].strip("= ").strip() for s in sections if s["title"]][:14],
                "u": en_url(title),
            }
            out[p["title"]] = {k: v for k, v in record.items() if v}
        return out

    def items(self, items):
        out = {}
        for it in items:
            prefix = it["id"][1:it["id"].index(")")]
            raw = it["id"].split(")", 1)[1]
            text = self.descriptions.get((it["en"] or "").lower())
            if text is None and prefix == "O" and raw.isdigit():
                text = self.descriptions.get(raw)
            text = self.usable_description(text)
            if text:
                out[it["id"]] = text
        return out

    def fish(self, fish):
        out = {}
        for f in fish:
            text, _ = self.page(f["en"])
            fields, _ = self.infobox(text)
            if not fields:
                self.missing["fish"] += 1
                continue
            rec = {k: self.plain(fields.get(src, "")) for k, src in
                   (("lt", "location"), ("st", "season"), ("tt", "time"), ("wt", "weather"))}
            out[f["page"]] = {k: v for k, v in rec.items() if v}
        return out

    def locations(self, locations):
        out = {}
        for loc in locations:
            text, _ = self.page(loc["en"]) if loc["en"] else (None, None)
            fields, _ = self.infobox(text)
            rec = {"hours": self.plain(fields.get("openhours", "")), "closed": self.plain(fields.get("closed", "")),
                   "addr": self.plain(fields.get("address", ""))}
            if any(rec.values()):
                out[loc["page"]] = {k: v for k, v in rec.items() if v}
        return out

    def villagers(self, villagers):
        out = {}
        for v in villagers:
            text, _ = self.page(v["en"]) if v["en"] else (None, None)
            fields, _ = self.infobox(text)
            rec = {"addr": self.plain(fields.get("address", "")), "region": self.plain(fields.get("location", "")),
                   "mar": self.plain(fields.get("marriage", ""))}
            if any(rec.values()):
                out[v["page"]] = {k: v for k, v in rec.items() if v}
        return out

    def chains(self, chains):
        out = {}
        for chain in chains:
            if chain["kind"] == "blacksmith_upgrade":
                text, _ = self.page(TOOL_PAGES[chain["family"]])
                effects = []
                for table in wt.wikitables(text or ""):
                    rows = table["rows"]
                    header = [self.plain(c["text"]) for c in rows[0]] if rows else []
                    if "Name" in header and "Improvements" in header:
                        col = header.index("Improvements")
                        effects = [self.plain(r[col]["text"]) if col < len(r) else None for r in rows[1:]]
                        break
                if len(effects) != len(chain["tiers"]):
                    self.missing["tool_effects:" + chain["family"]] += 1
                    effects = [None] * len(chain["tiers"])
                out[chain["family"]] = {"name": FAMILY_EN[chain["family"]], "tiers": [{"effect": e} for e in effects]}
            else:
                tiers = []
                for tier in chain["tiers"]:
                    text, _ = self.page(tier["en"])
                    fields, _ = self.infobox(text)
                    tiers.append({"effect": self.plain(fields.get("improvements", "")) or None,
                                  "sold_by": self.plain(fields.get("soldby", "")) or None})
                out[chain["family"]] = {"name": self.catalog.resolve(chain["tiers"][0]["en"]).get("en"), "tiers": tiers}
        return out

    def buildings(self, buildings):
        out = {}
        house = {}
        text, _ = self.page("Carpenter's Shop")
        for table in wt.wikitables(text or ""):
            rows = table["rows"]
            header = [self.plain(c["text"]) for c in rows[0]] if rows else []
            if header == ["Image", "Name", "Description", "Cost"]:
                for row in rows[1:]:
                    house[self.plain(row[1]["text"])] = self.plain(row[2]["text"])
        for b in buildings:
            name = EXTRA_NAMES.get(b["name"]) or (b["en"] if b["page"] == b["name"] else None) or self.title_en.get(b["name"])
            if not name:
                self.missing["building:" + b["name"]] += 1
                continue
            desc = house.get(name) or self.description(name)
            cost = None
            if not b.get("cost"):
                page, _ = self.page(b["en"] or name)
                fields, _ = self.infobox(page)
                cost = self.plain(fields.get("cost", "")) or None
            out[b["name"]] = {k: v for k, v in {"name": name, "desc": desc, "cost_text": cost}.items() if v}
        return out

    def bundles(self, rooms):
        text, _ = self.page("Bundles")
        english = []
        for sec in wt.sections(text or ""):
            if sec["level"] != 3 or not sec["title"]:
                continue
            bundles, reward = [], None
            for table in wt.wikitables(sec["body"]):
                rows = table["rows"]
                if not rows:
                    continue
                head = " ".join(c["text"] for c in rows[0])
                if "Bundle Complete Balloon" in head:
                    reward = self.plain(rows[0][-1]["text"])
                    continue
                if not rows[0][0]["header"]:
                    continue
                name = self.plain(rows[0][0]["text"]).strip()
                if not name.endswith("Bundle"):
                    continue
                name = re.sub(r"^([\d,]+) Bundle$", r"\1g Bundle", name)
                items = []
                for row in rows[1:]:
                    for idx, cell in enumerate(row):
                        refs = P.item_refs(cell["text"], self.catalog)
                        if not refs:
                            refs = [self.catalog.resolve(a.get("1", "")) or {} for _, a, _ in wt.templates(cell["text"], {"Quality"})]
                            refs = [r for r in refs if r.get("id")]
                        if refs and "Bundle Slot" not in cell["text"] and "Reward" not in " ".join(c["text"] for c in row):
                            note = self.plain(row[idx + 1]["text"]) if idx + 1 < len(row) else None
                            items.extend({"id": r.get("id"), "source_text": note} for r in refs)
                            break
                bundles.append({"name": name, "items": items})
            english.append({"room": sec["title"].strip(), "reward": reward, "bundles": bundles})
        out = {}
        for zh_room, en_room in zip(rooms, english):
            rec = {"room": en_room["room"], "reward": en_room["reward"], "bundles": {}}
            for zh_b, en_b in zip(zh_room["bundles"], en_room["bundles"]):
                zh_ids = [x.get("id") for x in zh_b["items"]]
                en_ids = [x.get("id") for x in en_b["items"]]
                same = zh_ids == en_ids
                if not same:
                    self.missing["bundle_items:" + en_b["name"]] += 1
                rec["bundles"][zh_b["name"]] = {"name": en_b["name"],
                                                "sources": [x["source_text"] for x in en_b["items"]] if same else []}
            if len(zh_room["bundles"]) != len(en_room["bundles"]):
                self.missing["bundle_count:" + en_room["room"]] += 1
            out[zh_room["room"]] = rec
        return out

    def shops(self, shops):
        out = {}
        for shop in shops:
            text, _ = self.page(shop["en"]) if shop["en"] else (None, None)
            if not text:
                continue
            stock = []
            for sec in wt.sections(text):
                for table in wt.wikitables(sec["body"]):
                    rows = table["rows"]
                    if len(rows) < 2:
                        continue
                    header = [self.plain(c["text"]) for c in rows[0] if c["header"]]
                    if not header or not any(re.search(r"Price|Cost|Trade", h) for h in header):
                        continue
                    for row in rows[1:]:
                        cells = [c["text"] for c in row]
                        name_idx = next((i for i, c in enumerate(cells[1:], 1) if wt.page_links(c)), None)
                        if name_idx is None:
                            continue
                        price_idx = next((i for i in range(len(cells) - 1, name_idx, -1)
                                          if re.search(r"\{\{\s*[Pp]rice|\{\{\s*tprice|\{\{\s*[Nn]ame", cells[i])), None)
                        if price_idx is None:
                            continue
                        refs = P.item_refs(cells[name_idx], self.catalog)
                        hit = refs[0] if refs else self.catalog.resolve(wt.page_links(cells[name_idx])[0]) or {}
                        notes = [n for n in (self.plain(c) for i, c in enumerate(cells) if i not in (name_idx, price_idx, 0))
                                 if n and n.upper() != "N/A"]
                        stock.append({"id": hit.get("id"), "n": [n[:80] for n in notes[-2:]],
                                      "sec": sec["title"].strip("= ").strip() if sec["title"] else None})
            if stock:
                out[shop["page"]] = stock
        return out

    def recipes(self, recipes, zh_pages):
        crafting = {}
        text, _ = self.page("Crafting")
        for table in wt.wikitables(text or ""):
            rows = table["rows"]
            header = [self.plain(c["text"]) for c in rows[0]] if rows else []
            if "Name" not in header or "Recipe Source" not in header:
                continue
            name_col, src_col = header.index("Name"), header.index("Recipe Source")
            for row in rows[1:]:
                if len(row) > max(name_col, src_col):
                    links = wt.page_links(row[name_col]["text"])
                    if links:
                        crafting.setdefault(links[0], self.plain(row[src_col]["text"]))
        page_en = {p["title"]: p.get("en") for p in zh_pages}
        out = {}
        for r in recipes:
            title_en = page_en.get(r["output"]["page"]) or self.title_en.get(r["output"]["zh"])
            unlock = None
            if r["source"].endswith("%E6%89%93%E9%80%A0") or r["source"].endswith("/打造"):
                unlock = crafting.get(title_en)
            if not unlock and title_en:
                page, _ = self.page(title_en)
                fields, _ = self.infobox(page)
                unlock = self.plain(fields.get("recipe", "")) or None
            if not unlock and r["unlock"]:
                self.missing["recipe_unlock"] += 1
            conds = [self.condition(c, unlock) for c in r["unlock"]]
            rec = {"u": unlock, "c": conds}
            if unlock or any(conds):
                out[r["id"]] = rec
        return out

    # A recipe's source field can list several sources on separate lines
    # (e.g. a TV episode and a shop). Each structured condition shows only its own line.
    SEGMENT = {
        "tv": re.compile(r"Queen of Sauce"),
        "purchase": re.compile(r"\bfor\b.*\d|\d[\d,]*\s*g\b|Qi Gem|Golden Walnut|Prize Ticket|Calico Egg", re.I),
        "quest": re.compile(r"Quest|Special Order|Request", re.I),
        "friendship": re.compile(r"❤|heart|Mail", re.I),
    }

    def segment(self, group, unlock):
        lines = [x.strip() for x in (unlock or "").split("\n") if x.strip()]
        pattern = self.SEGMENT.get(group)
        if pattern:
            for line in lines:
                if pattern.search(line):
                    return line
        if group in ("world", "other") and len(lines) > 1:
            others = [x for x in lines if not any(p.search(x) for p in self.SEGMENT.values())]
            if others:
                return "; ".join(others)
        return unlock

    def condition(self, c, unlock):
        group = c["group"]
        if group == "skill":
            return f"{SKILL_EN[c['skill']]} Level {c['level']}"
        if group == "mastery":
            return f"{SKILL_EN.get(c.get('skill'), 'Skill')} Mastery" if c.get("skill") else "Mastery"
        if group == "initial":
            return "Starter recipe"
        if group == "friendship":
            npc = self.npc_en.get(c.get("npc_zh"))
            if not npc:
                return self.segment(group, unlock)
            if c.get("event"):
                return f"{npc} {c['hearts']}-heart event"
            if c.get("mail"):
                return f"{npc} (Mail – {c['hearts']}+ ❤)"
            return f"{npc} ({c['hearts']}+ ❤)"
        if group == "tv":
            channel = re.search(r"The Queen of Sauce\s*\(?([^)\n]*)\)?", unlock or "")
            if channel:
                return f"The Queen of Sauce ({channel.group(1).strip()})"
            m = re.search(r"(奇数年|偶数年)?\s*(春|夏|秋|冬)季?\s*(\d+)\s*日", c.get("text", ""))
            if m:
                season = SEASON_EN[{"春": "spring", "夏": "summer", "秋": "fall", "冬": "winter"}[m.group(2)]]
                years = {"奇数年": " (odd years)", "偶数年": " (even years)"}.get(m.group(1), "")
                return f"The Queen of Sauce, {season} {m.group(3)}{years}"
            return self.segment(group, unlock)
        return self.segment(group, unlock)

    def schedules(self, villagers):
        out = {}
        for v in villagers:
            if not v["en"]:
                continue
            text, title = self.page(v["en"])
            if not text:
                continue
            sections = wt.sections(text)
            relevant = [s for s in sections if s["title"] and s["title"].strip() == "Schedule"]
            if not relevant:
                continue
            first = sections.index(relevant[0])
            pieces = []
            for s in sections[first:]:
                if pieces and s["level"] <= relevant[0]["level"]:
                    break
                pieces.append(s["body"])
            body = "\n".join(pieces)
            groups = self._schedule_groups(body)
            prefix = re.split(r"\{\||\{\{\s*ScheduleHeader", relevant[0]["body"], maxsplit=1, flags=re.I)[0]
            notes = [n for n in (self.plain(p) for p in re.split(r"\n\s*\n", prefix)) if n]
            if groups or notes:
                out[v["page"]] = {"groups": groups, "notes": notes, "source": en_url(title) + "#Schedule"}
        return out

    def _schedule_groups(self, body):
        headers = list(re.finditer(r"\{\{\s*ScheduleHeader\s*\|\s*([^}|]+)[^}]*\}\}", body, re.I))
        groups, last_end = [], 0
        for match in re.finditer(r"\{\|(?:(?!\{\|).)*?\|\}", body, re.S):
            tables = wt.wikitables(match.group())
            if not tables:
                continue
            before_headers = [h for h in headers if h.start() < match.start()]
            header = before_headers[-1] if before_headers else None
            season = header.group(1).strip().lower() if header else "all"
            season = season if season in ("spring", "summer", "fall", "winter", "marriage") else "all"
            before = body[max(last_end, header.end() if header else 0):match.start()]
            bold = re.findall(r"'''(.*?)'''", before, re.S)
            title = self.plain(bold[-1]) if bold else ""
            rows = []
            for row in tables[0]["rows"]:
                if row and all(c["header"] for c in row):
                    label = " ".join(self.plain(c["text"]) for c in row)
                    if len(row) == 1 and label and label.lower() not in {"time", "location", "time location"}:
                        title = label
                    continue
                if len(row) < 2:
                    continue
                time = self.plain(row[0]["text"]).strip()
                place_raw = " ".join(c["text"] for c in row[1:])
                place = self.plain(place_raw).strip()
                clock = re.fullmatch(r"(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?", time)
                if clock:
                    h, m, half = int(clock.group(1)), int(clock.group(2)), clock.group(3).lower()
                    if h > 12 or m > 59:
                        continue
                    h = h % 12 + (12 if half == "p" else 0)
                    at = h * 100 + m + (2400 if h < 6 else 0)
                elif time.lower() in {"all day", "any time", "anytime"}:
                    at = 600
                else:
                    continue
                if not place or "{|" in place:
                    continue
                links = [self.title_zh.get(norm_title(self.redirects.get(t, t)), t) for t in wt.page_links(place_raw)]
                rows.append({"time": time, "at": at, "text": place, "links": links})
            last_end = match.end()
            if rows:
                groups.append({"season": season, "label": title or "Regular schedule", "rows": rows, "order": len(groups)})
        return groups

    def names(self, data):
        out = {zh: en for zh, en in self.title_en.items()}
        for zh, en in self.npc_en.items():
            out[zh] = en
        out.update(self.bundle_names)
        for zh_room, rec in data["bundles"].items():
            out[zh_room] = rec["room"]
            for zh_name, b in rec["bundles"].items():
                out[zh_name] = b["name"]
        for zh, rec in data["buildings"].items():
            out[zh] = rec["name"]
        out.update(EXTRA_NAMES)
        out.update(FAMILY_EN)
        return out


def curated(name):
    path = os.path.join(CURATED, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build():
    def load(name):
        with open(os.path.join(BUILD, name), encoding="utf-8") as f:
            return json.load(f)

    e = English()
    pages = load("pages.json")
    data = {
        "pages": e.pages(pages),
        "items": e.items(load("items.json")),
        "fish": e.fish(load("fish.json")),
        "locations": e.locations(load("locations.json")),
        "villagers": e.villagers(load("villagers.json")),
        "chains": e.chains(load("tool-chains.json")),
        "buildings": e.buildings(load("buildings.json")),
        "bundles": e.bundles(load("bundles.json")),
        "shops": e.shops(load("shops.json")),
        "recipes": e.recipes(load("recipes.json"), pages),
        "schedules": e.schedules(load("villagers.json")),
    }
    data["names"] = e.names(data)
    data["progression"] = curated("progression.en.json")
    data["guides"] = curated("guides.en.json")
    report = {"counts": {k: len(v) for k, v in data.items() if isinstance(v, dict)}, "missing": dict(e.missing)}
    return data, report


def main():
    data, report = build()
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
