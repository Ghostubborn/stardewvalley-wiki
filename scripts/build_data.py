"""构建产品数据层：从中英文 Wiki 归档生成结构化 JSON。

用法：python3 -I scripts/build_data.py
输入：data/wiki/{zh,en}-pages.jsonl，data/raw/ 下的图片目录
输出：data/build/*.json(l)
"""

import datetime
import json
import os
import re
import struct
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from sdvdata import parse as P  # noqa: E402
from sdvdata import sources as SRC  # noqa: E402
from sdvdata import wikitext as wt  # noqa: E402
from sdvdata.catalog import Catalog  # noqa: E402
from sdvdata.images import ImageResolver  # noqa: E402

WIKI = os.path.join(ROOT, "data", "wiki")
OUT = os.path.join(ROOT, "data", "build")
IMAGE_DIRS = [
    os.path.join(ROOT, "data", "raw", "wikiteam-en-20251218-images", "images"),
    os.path.join(ROOT, "data", "raw", "wikiteam-en-20251218-images-mismatch", "images_mismatch"),
]
ZH_BASE = "https://zh.stardewvalleywiki.com/"
EN_BASE = "https://stardewvalleywiki.com/"
SOURCES = {
    "zh": {"archive": "https://archive.org/details/wiki-zh.stardewvalleywiki.com_mediawiki-20251218",
           "dumped": "2025-12-18", "license": "CC BY-NC-SA 3.0（站点信息声明）"},
    "en": {"archive": "https://archive.org/details/wiki-stardewvalleywiki.com_mediawiki-20251218",
           "dumped": "2025-12-18", "license": "CC BY-NC-SA 3.0（站点信息声明）"},
}

INFOBOX_KIND = {
    "infobox": "item", "infobox furniture": "furniture", "infobox mousehat": "hat", "infobox fish": "fish",
    "infobox seed": "seed", "infobox weapon": "weapon", "infobox clothing": "clothing",
    "infobox monster": "monster", "infobox mineral": "mineral", "infobox villager": "villager",
    "infobox location": "location", "infobox artifact": "artifact", "infobox building": "building",
    "infobox tool": "tool", "infobox animal": "animal", "infobox fruit tree": "fruit_tree",
    "infobox tree": "tree", "infobox cooking": "cooking",
}
CATEGORY_KIND = [
    ("NPC", "npc"), ("地点", "location"), ("商店", "shop"), ("任务", "quest"), ("节日", "festival"),
    ("成就", "achievement"), ("技能", "skill"), ("消歧义", "disambiguation"), ("游戏玩法", "guide"),
    ("工具", "tool"), ("斧头", "tool"),
]
KIND_ZH = {
    "item": "物品", "cooking": "料理", "furniture": "家具", "hat": "帽子", "fish": "鱼", "seed": "种子",
    "crop": "作物", "weapon": "武器", "clothing": "服饰", "monster": "怪物", "mineral": "矿物",
    "villager": "居民", "npc": "人物", "location": "地点", "artifact": "古物", "building": "建筑",
    "tool": "工具", "animal": "动物", "fruit_tree": "果树", "tree": "树木", "shop": "商店", "quest": "任务",
    "festival": "节日", "achievement": "成就", "skill": "技能", "disambiguation": "消歧义",
    "guide": "玩法", "article": "条目",
}
# 绑定物品的条目类型；地点、怪物和分类页不能绑定到碰巧同名的家具/物品。
ITEM_KINDS = {"item", "furniture", "hat", "cooking", "fish", "seed", "weapon", "clothing", "mineral", "crop", "artifact", "tool"}
# 武器类型：照 Template:Infobox weapon 的写法，英文值换成中文名。
WEAPON_TYPES = {"sword": "剑", "dagger": "匕首", "club": "锤", "slingshot": "弹弓"}
# 怪物出没地点：Template:Infobox monster 把这几种写法（含英文）链接到对应条目。
MONSTER_PLACES = {"the mines": "矿井", "mines": "矿井", "矿井": "矿井", "the skull cavern": "骷髅洞穴",
                  "skull cavern": "骷髅洞穴", "骷髅洞穴": "骷髅洞穴", "the farm": "农场", "farm": "农场", "农场": "农场"}
# 带口味的工匠物品（“(O)342/16” = 用野山葵做的腌菜）：组合 ID 的前半是产品系列，对应的中文条目写着设备、材料数量和耗时。
# 398 在组合 ID 里表示果干（单独的 (O)398 是葡萄），见 sdvdata/images.py。
FLAVOR_PAGES = {
    "(O)342": "果酱和腌菜", "(O)344": "果酱和腌菜", "(O)348": "果酒", "(O)350": "果汁", "(O)398": "果干",
    "(O)DriedMushrooms": "蘑菇干", "(O)447": "腌鱼籽", "(O)SmokedFish": "熏鱼", "(O)SpecificBait": "针对性鱼饵",
    "(O)340": "蜂蜜", "(O)812": "鱼籽", "(O)79": "秘密纸条", "(O)842": "日记残页",
}
# 果酱、腌菜合写在一个没有信息框的条目里，设备是罐头瓶，耗时在正文表格。
JAR_FAMILIES = {"(O)342": "腌菜", "(O)344": "果酱"}
# 放进设备加工、原料会被用掉的系列；蜂蜜（附近的花）、鱼籽（鱼塘）和纸条不是加工品。
PROCESSED_FAMILIES = {"(O)342", "(O)344", "(O)348", "(O)350", "(O)398", "(O)DriedMushrooms", "(O)447", "(O)SmokedFish", "(O)SpecificBait"}


def load_pages(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def norm_title(title):
    title = title.replace("_", " ").strip()
    return (title[0].upper() + title[1:]) if title and title[0].isascii() else title


def zh_url(title):
    return ZH_BASE + title.replace(" ", "_")


def en_url(title):
    return EN_BASE + title.replace(" ", "_")


# —— 图片索引 ——

def image_size(path):
    try:
        with open(path, "rb") as f:
            head = f.read(64 * 1024)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", head[16:24])
        if head[:6] in (b"GIF87a", b"GIF89a"):
            return struct.unpack("<HH", head[6:10])
        if head[:2] == b"\xff\xd8":
            i = 2
            while i < len(head) - 9:
                if head[i] != 0xFF:
                    i += 1
                    continue
                marker = head[i + 1]
                if marker in (0xC0, 0xC1, 0xC2):
                    h, w = struct.unpack(">HH", head[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack(">H", head[i + 2:i + 4])[0]
    except OSError:
        pass
    return None, None


def build_images():
    index = {}
    for directory in IMAGE_DIRS:
        if not os.path.isdir(directory):
            continue
        for name in sorted(os.listdir(directory)):
            key = image_key(name)
            if key in index:
                continue
            path = os.path.join(directory, name)
            w, h = image_size(path)
            index[key] = {"file": name, "path": os.path.relpath(path, ROOT), "w": w, "h": h,
                          "bytes": os.path.getsize(path)}
    return index


def image_key(name):
    name = name.replace(" ", "_").strip()
    return (name[0].upper() + name[1:]) if name else name


# —— 渲染器 ——

def bundle_names(template_text):
    """从 Template:Bundle 的 #switch 中取 {英文键: 中文收集包名}。"""
    names = {}
    pending = []
    for line in template_text.split("\n"):
        line = line.strip()
        if not line.startswith("|") or line.startswith("|#default"):
            continue
        key, eq, value = line[1:].partition("=")
        for k in key.split("|"):
            if k.strip():
                pending.append(k.strip().lower())
        if eq:
            labels = re.findall(r"\[\[收集包#[^|\]]*\|([^\]]+)\]\]", value) or re.findall(r"\[\[[^|\]]*\|([^\]]+)\]\]", value)
            if labels:
                for k in pending:
                    names[k] = labels[-1].strip()
            pending = []
    return names


def make_renderer(catalog, npc_zh, bundles):
    def name(a):
        raw = a.get("1", "")
        label = None
        if a.get("link"):
            label = a["link"].replace("{{!}}", "|").split("|")[-1].split("#")[0]
        label = a.get("alt") or label or catalog.zh_name(raw)
        extra = a.get("2", "").strip()
        # “+1”“-1”是属性增减（{{name|Defense|+1}}），不是数量。
        if re.fullmatch(r"[\d~–]+(?:-\d+)?", extra):
            return f"{label}×{extra}"
        return f"{label}（{extra}）" if extra else label

    def money(a):
        value = a.get("1", "").replace(",", "")
        unit = P.CURRENCIES.get(a.get("2", "").strip().lower(), "金")
        try:
            return f"{int(float(value)):,}{unit}"
        except ValueError:
            return value

    def season(a):
        code = P.SEASONS.get(a.get("1", "").strip().lower())
        text = P.SEASON_ZH.get(code, a.get("1", ""))
        if a.get("2"):
            text += f" {a['2']} 日"
        if a.get("1", "").lower() in ("marriage", "婚姻", "婚后"):
            text = "婚后"
        return text

    def weather(a):
        return P.WEATHER_ZH.get(P.WEATHER.get(a.get("1", "").strip().lower()), a.get("1", ""))

    def npc(a):
        n = npc_zh.get(a.get("1", ""), a.get("1", ""))
        return f"{n}（{a['2']}）" if a.get("2") else n

    def bundle(a):
        return bundles.get(a.get("1", "").strip().lower(), a.get("1", "") + "收集包")

    def description(a):
        hit = catalog.resolve(a.get("1", "")) or {}
        return (hit.get("id") and catalog.description(hit["id"])) or ""

    handlers = {
        "name": name, "price": money, "tprice": money, "qualityprice": lambda a: money({"1": a.get("2", a.get("1", ""))}),
        "season": season, "weather inline": weather, "npc": npc, "bundle": bundle, "description": description,
        "!": lambda a: "|", "quote": lambda a: a.get("1", ""), "squote": lambda a: a.get("1", ""),
        "key": lambda a: a.get("1", ""), "nowrap": lambda a: a.get("1", ""), "no wrap": lambda a: a.get("1", ""),
        "tooltip": lambda a: a.get("1", ""), "color": lambda a: a.get("2", ""),
        "cookingchannel": lambda a: f"烹饪频道（{a.get('1', '')}）", "duration": lambda a: a.get("1", ""),
    }
    renderer = wt.Renderer(handlers)
    base = renderer.render

    def render(text):
        text = re.sub(r"\[\[(?:File|文件):HeartIcon[^\]]*\]\]", "❤", text or "")
        return base(text)

    renderer.render = render
    return renderer


# —— 构建 ——

def expand_param_defaults(text):
    """把 {{{1|默认值}}} 替换成默认值：料理页用 {{{{{1|Infobox cooking}}} 作信息框名。"""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"\{\{\{[^{}|]*\|([^{}]*)\}\}\}", r"\1", text)
    return text


class Builder:
    def __init__(self):
        self.zh_all = load_pages(os.path.join(WIKI, "zh-pages.jsonl"))
        for r in self.zh_all:
            if r["ns"] == 0 and "{{{" in r["text"]:
                r["text"] = expand_param_defaults(r["text"])
        self.en_all = load_pages(os.path.join(WIKI, "en-pages.jsonl"))
        self.zh = {norm_title(r["title"]): r for r in self.zh_all}
        self.en = {norm_title(r["title"]): r for r in self.en_all}
        modules = {r["title"]: r["text"] for r in self.zh_all if r["ns"] == 828}
        self.catalog = Catalog(modules)
        self.npc_zh, self.npc_en = self._npc_names(modules["模块:NPC"])
        self.bundle_zh = bundle_names(self.zh["Template:Bundle"]["text"])
        self.render = make_renderer(self.catalog, self.npc_zh, self.bundle_zh).render
        self.redirects = {norm_title(r["title"]): norm_title(r["redirect"]) for r in self.zh_all
                          if r["ns"] == 0 and r["redirect"]}
        self.articles = [r for r in self.zh_all if r["ns"] == 0 and not r["redirect"]]
        self.images = build_images()
        self.image_resolver = ImageResolver(self.images, self.en.get("Tailoring", {}).get("text", ""))
        self.en_redirects = {norm_title(r["title"]): norm_title(r["redirect"]) for r in self.en_all
                             if r["ns"] == 0 and r["redirect"]}
        self.issues = Counter()

    @staticmethod
    def _npc_names(module_text):
        pairs = re.findall(r'\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\}', module_text)
        return {en: zh for zh, en in pairs}, {zh: en for zh, en in pairs}

    def resolve(self, title):
        title = norm_title(title)
        for _ in range(4):
            if title in self.redirects:
                title = self.redirects[title]
            else:
                break
        return title

    def image(self, *names):
        return self.image_resolver.find(*names)

    def plain(self, text):
        return self.render(text or "")

    # —— 条目 ——
    def build_pages(self):
        aliases = defaultdict(list)
        for src, dst in self.redirects.items():
            aliases[self.resolve(dst)].append(src)
        pages = []
        texts = []
        for r in self.articles:
            title = norm_title(r["title"])
            text = r["text"]
            info = wt.first_template(text, "Infobox")
            infobox_type = info[0].lower() if info else None
            fields = info[1] if info else {}
            cats = wt.categories(text)
            interlang = wt.interlanguage(text)
            en = interlang.get("en") or fields.get("eng") or None
            if en:
                en = self.en_redirects.get(norm_title(en), norm_title(en))
            kind = INFOBOX_KIND.get(infobox_type) if infobox_type else None
            if kind == "item":
                if {"烹饪", "食谱"} & set(cats):
                    kind = "cooking"
                elif fields.get("seed") and fields.get("growth"):
                    kind = "crop"
            if not kind:
                kind = next((k for c, k in CATEGORY_KIND if c in cats), "article")
            item = self._page_item(title, en, fields)
            if kind not in ITEM_KINDS:
                item = None
            body = text[info[4]:] if info else text
            sections = wt.sections(body)
            # 居民、墙纸等条目以引言（开发者语录或游戏内说明）开头；摘要取条目自己的导言。
            lead = self.plain(re.sub(r"^\s*\{\{\s*[Qq]uote\b(?:[^{}]|\{\{[^{}]*\}\})*\}\}", "", sections[0]["body"])) if sections else ""
            summary = _first_paragraph(lead)
            image = self.image(fields.get("image"), item and item.get("en"), en)
            record = {
                "title": title, "en": en, "kind": kind, "kind_zh": KIND_ZH.get(kind, kind),
                "infobox": info[0] if info else None, "categories": cats,
                "aliases": sorted(set(aliases.get(title, []))), "summary": summary,
                "sections": [_clean_heading(s["title"]) for s in sections if s["title"]],
                "links": [self.resolve(t) for t in wt.page_links(body)],
                "item_id": item and item.get("id"), "image": image,
                "fields": {k: self.plain(v) for k, v in fields.items()},
                # 逐条来源：家具、帽子按信息框模板的行，其余取来源/远古斑点/怪物掉落/其他来源；古物另有捐赠奖励。
                "src": P.infobox_sources(kind, fields, self.plain, "zh"),
                "dr": P.list_entries(fields.get("dr", ""), self.plain),
                "obtain": SRC.obtain_section(sections, self.plain),
                "props": self._props(info[0] if info else None, fields),
                "map_pins": self._map_pins(text),
                "url": zh_url(title), "en_url": en_url(en) if en else None,
                "rev_id": r["rev_id"], "updated": r["timestamp"], "bytes": len(text),
            }
            pages.append(record)
            texts.append({"title": title, "sections": [
                {"title": _clean_heading(s["title"]), "text": self.plain(s["body"])}
                for s in sections if s["body"].strip()]})
        self.pages = {p["title"]: p for p in pages}
        self.page_by_item = {}
        for p in pages:
            if p["item_id"] and p["item_id"] not in self.page_by_item:
                self.page_by_item[p["item_id"]] = p["title"]
        return pages, texts

    def _props(self, infobox, fields):
        """信息框里的物品属性：能量与生命值、增益与持续时间、武器与饰品属性。"""
        props = {}
        eat = P.edibility(fields, infobox)
        if eat:
            props["eat"] = eat
        buff = P.list_entries(fields.get("buff", ""), self.plain)
        if buff:
            props["buff"] = buff
            # 普通信息框写 buffduration，料理信息框写 duration（只在有增益时显示）。
            duration = self.plain(fields.get("buffduration") or fields.get("duration") or "")
            if duration:
                props["buff_time"] = _zh_duration(duration)
        stats = P.list_entries(fields.get("stats", ""), self.plain)
        if stats:
            props["stats"] = stats
        if (infobox or "").lower() == "infobox weapon":
            kind = self.plain(fields.get("type", "")).strip()
            level = self.plain(fields.get("level", "")).strip()
            weapon = {"type": WEAPON_TYPES.get(kind.lower(), kind) or None,
                      "level": level if level and level.upper() != "N/A" else None,
                      "damage": self.plain(fields.get("damage", "")).strip() or None,
                      "crit": P.percent(self.plain(fields.get("csc", "")))}
            props["weapon"] = {k: v for k, v in weapon.items() if v}
        return props

    def _page_item(self, title, en, fields):
        for name in (fields.get("eng"), en, title):
            if not name:
                continue
            hit = self.catalog.resolve(name)
            if hit and hit.get("id"):
                return hit
        return None

    def _map_pins(self, text):
        pins = []
        for name, args, _ in wt.templates(text, {"Map"}):
            # The template can render BOTH maps. Its third argument sets the
            # display width; x/y are CSS offsets in that display, not game tiles.
            try:
                width = float(args.get("3") or 400)
            except ValueError:
                continue
            if width <= 0:
                continue
            maps = []
            if args.get("main") != "false" or args.get("island") == "small":
                maps.append(("island_small" if args.get("island") == "small" else "valley", "loc", ("1", "2")))
            if args.get("island") == "true":
                maps.append(("island", "islandloc", ("islandloc1x", "islandloc1y")))
            for key, prefix, first in maps:
                for kx, ky in [first] + [(f"{prefix}{i}x", f"{prefix}{i}y") for i in range(2, 5)]:
                    try:
                        pins.append({"x": float(args[kx]), "y": float(args[ky]), "map": key, "width": width})
                    except (KeyError, ValueError):
                        pass
        return pins

    # —— 物品 ——
    def build_items(self):
        items = self.catalog.items()
        npc_tastes = defaultdict(lambda: defaultdict(list))
        for item in items:
            item["page"] = self.page_by_item.get(item["id"]) or (
                self.resolve(item["zh"]) if self.resolve(item["zh"]) in self.pages else None)
            for taste, npcs in (item.get("gift_tastes") or {}).items():
                for npc in npcs:
                    npc_tastes[npc][taste].append(item["id"])
        self.image_resolver.resolve_items(items, self.pages, self.en_redirects)
        self._fallback_pages(items)
        self._collection_items(items)
        for item in items:
            edibility = item.get("edibility")
            if isinstance(edibility, int) and edibility not in (-300, 0):
                item["eat"] = dict(zip(("e", "h"), P.calc_edibility(edibility)))
        for item in items:
            # 矿井里的石头、杂草等是地图物件，不是可放进背包的物品；没有条目且没译名的是游戏内部占位。
            item["internal"] = (item.get("obj_type") == "Litter" or item["zh"] == "???"
                                or (not item["page"] and (item["type"] == "BC" or item["zh"].isascii())))
        self.items = {i["id"]: i for i in items}
        self.npc_tastes = npc_tastes
        return items

    def _fallback_pages(self, items):
        """没有中文条目的物品：英文名重定向到的英文条目若有中文对应、且是物品类条目，就用它（如 Copper Pan → 淘盘）。"""
        zh_by_en = {p["en"]: p["title"] for p in self.pages.values() if p["en"]}
        for item in items:
            if item["page"]:
                continue
            family = FLAVOR_PAGES.get(item.get("made_by"))
            if family in self.pages:
                item["page"] = family
                continue
            target = item["en"] and self.en_redirects.get(norm_title(item["en"]))
            title = zh_by_en.get(target) if target else None
            if title and self.pages[title]["kind"] in ITEM_KINDS:
                item["page"] = title

    def _collection_items(self, items):
        """墙纸、地板、纸条和通用上衣同名不同款：按 Wiki 的图标编号区分，并从合集页取逐件来源。"""
        pages = {k: (self.zh.get(v) or {}).get("text", "") for k, v in SRC.PAGES["zh"].items()}
        walls = SRC.wallpaper(pages["wallpaper"], self.plain)
        floors = SRC.flooring(pages["flooring"], self.plain)
        self.clothing = SRC.match_clothing(SRC.tailoring(pages["tailoring"], self.plain), items, lambda i: i["zh"])
        quests = SRC.quest_items(pages["quests"], self.plain)
        for item in items:
            number = None
            if item["type"] in ("WP", "FL"):
                number = SRC.icon_number(item.get("image"))
                item["src"] = (walls if item["type"] == "WP" else floors).get(number) or []
            elif item.get("made_by") in ("(O)79", "(O)842"):
                number = item["id"].split("/", 1)[1]
            elif item["type"] in ("S", "P"):
                row = self.clothing.get(item["id"])
                item["src"] = row["notes"] if row else []
                if item["en"] == "Shirt" and (m := re.search(r"Shirt(\d+)", item.get("image") or "")):
                    number = int(m.group(1))
            if item["zh"] in quests:
                item["src"] = quests[item["zh"]]
            if number is not None:
                item["zh"], item["en"] = f"{item['zh']} #{number}", f"{item['en']} #{number}"

    # —— 关系：配方 ——
    def build_recipes(self):
        recipes = self._crafting_table_recipes()
        seen = {r["output"]["page"] for r in recipes}
        for page in self.pages.values():
            r = self.zh_raw(page["title"])
            info = wt.first_template(r["text"], "Infobox")
            if not info or "ingredients" not in info[1]:
                continue
            fields = info[1]
            # 打造总表已收录的配方不重复；但熔炉等加工途径（有 craftingstation）是另一条途径，保留
            if page["title"] in seen and not fields.get("craftingstation"):
                continue
            # “石英×1 煤炭×1 或 火水晶×1 煤炭×1”：每个替代做法各算一条配方
            alternatives = [a for a in re.split(r"或", fields["ingredients"]) if a.strip()]
            for alt_index, alt in enumerate(alternatives):
                ingredients = P.item_refs(alt, self.catalog) or self._generic_refs(alt)
                if not ingredients:
                    self.issues["recipe_without_parsed_ingredients"] += 1
                    continue
                self._add_infobox_recipe(recipes, page, info, fields, ingredients, alt_index)
        recipes += self._tailoring_table_recipes()
        recipes += self._flavor_recipes()
        return recipes

    def _tailoring_table_recipes(self):
        """《裁缝》上衣、下装表：布料加“配方”列里任一物品；没有独立条目的服装只有这里的配方。"""
        sewing = self.catalog.resolve("Sewing Machine") or {}
        out = []
        for item_id, row in self.clothing.items():
            item = self.items[item_id]
            for index, ref in enumerate(P.item_refs(row["recipe"], self.catalog)):
                # “{{name|Honey|任意}}”：任意一种蜂蜜都行，没有单一物品 ID，按类别名保留。
                if not ref.get("id") and ref.get("note") != "任意":
                    continue
                out.append({
                    "id": f"recipe:{item['id']}:tailoring" + (f"#{index + 1}" if index else ""), "kind": "tailoring",
                    "output": {"page": item["page"], "id": item["id"], "zh": item["zh"], "qty": 1},
                    "inputs": [{**ref, "qty": 1}],
                    "stations": [{"id": sewing.get("id"), "en": sewing.get("en"), "zh": sewing.get("zh") or "缝纫机", "qty": None, "note": None, "link": None}],
                    "time": None, "unlock_text": None, "unlock": [], "source": zh_url("裁缝"),
                })
        return out

    def _flavor_recipes(self):
        """带口味的工匠物品：按产品系列条目的设备、材料数量与耗时，换成具体原料。"""
        families = {}
        for family in PROCESSED_FAMILIES:
            title = FLAVOR_PAGES[family]
            raw = self.zh.get(title, {}).get("text", "")
            info = wt.first_template(raw, "Infobox")
            fields = info[1] if info else {}
            if family in JAR_FAMILIES:
                time = None
                for table in wt.wikitables(raw):
                    header = [self.plain(c["text"]) for c in table["rows"][0]] if table["rows"] else []
                    if "时间" in header:
                        col = header.index("时间")
                        time = next((self.plain(r[col]["text"]) for r in table["rows"][1:]
                                     if len(r) > col and self.plain(r[1]["text"]) == JAR_FAMILIES[family]), None)
                stations = P.item_refs("{{name|Preserves Jar}}", self.catalog)
                families[family] = {"stations": stations, "qty": 1, "extra": [], "time": time, "title": title}
            elif fields.get("craftingstation"):
                qty = re.search(r"[（(](\d+)[）)]", self.plain(fields.get("ingredients", "")))
                extra = [x for x in P.item_refs(fields.get("ingredients", ""), self.catalog) if x.get("id") != "(O)812"]
                families[family] = {"stations": P.item_refs(fields["craftingstation"], self.catalog),
                                    "qty": int(qty.group(1)) if qty and not extra else 1, "extra": extra,
                                    "time": _simplified(self.plain(fields.get("crafttime", ""))) or None, "title": title}
        out = []
        for item in self.items.values():
            family = families.get(item.get("made_by"))
            source = self.items.get(item.get("flavor_of"))
            if not family or not source:
                continue
            # 腌鱼籽的原料是同种鱼的鱼籽，不是鱼本身。
            base_id = f"(O)812/{source['id'].split(')', 1)[1]}" if item["made_by"] == "(O)447" else source["id"]
            base = self.items.get(base_id)
            if not base:
                continue
            inputs = [{"id": base["id"], "en": base["en"], "zh": base["zh"], "qty": family["qty"], "note": None, "link": None}]
            out.append({
                "id": f"recipe:{item['id']}:flavor", "kind": "processing",
                "output": {"page": family["title"], "id": item["id"], "zh": item["zh"], "qty": 1},
                "inputs": inputs + [{**x, "qty": x.get("qty") or 1} for x in family["extra"]],
                "stations": family["stations"], "time": family["time"], "unlock_text": None, "unlock": [],
                "source": zh_url(family["title"]),
            })
        return out

    def _add_infobox_recipe(self, recipes, page, info, fields, ingredients, alt_index):
        stations = P.item_refs(fields.get("craftingstation", ""), self.catalog)
        infobox_type = info[0].lower()
        if infobox_type in ("infobox mousehat", "infobox clothing"):
            kind = "tailoring"
        elif stations:
            kind = "processing"
        elif page["kind"] == "cooking" or infobox_type == "infobox cooking":
            kind = "cooking"
        elif infobox_type == "infobox weapon":
            kind = "forging"
        else:
            kind = "crafting"
        unlock_text = self.plain(fields.get("recipe", ""))
        produces = self.plain(fields.get("produces", ""))
        yield_qty = None
        m = re.search(r"(\d+)", produces)
        if m and kind in ("crafting", "cooking"):
            yield_qty = int(m.group(1))
        suffix = f"#{alt_index + 1}" if alt_index else ""
        recipes.append({
            "id": f"recipe:{page['title']}" + (":" + kind if kind == "processing" else "") + suffix,
            "kind": kind,
            "output": {"page": page["title"], "id": page["item_id"], "zh": page["title"], "qty": yield_qty or 1},
            "inputs": ingredients,
            "stations": stations,
            "time": _simplified(self.plain(fields.get("crafttime", ""))) or None,
            "unlock_text": unlock_text or None,
            "unlock": P.unlock_conditions(unlock_text) if unlock_text else [],
            "source": page["url"],
        })

    def _generic_refs(self, text):
        """“[[File:Fish.png]] 任意[[鱼]]（1）”这类按类别给出的材料。"""
        out = []
        for m in re.finditer(r"(任意|任何)?\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*[（(](\d+)[）)]", text):
            label = (m.group(3) or m.group(2)).strip()
            out.append({"id": None, "en": None, "zh": ("任意" if m.group(1) else "") + label, "qty": int(m.group(4)),
                        "note": None, "link": self.resolve(m.group(2)), "generic": bool(m.group(1))})
        return out

    def _crafting_table_recipes(self):
        """打造页的总表：每行一个配方，含材料与配方来源。"""
        r = self.zh.get("打造")
        out = []
        if not r:
            return out
        for table in wt.wikitables(r["text"]):
            if not table["rows"]:
                continue
            header = [self.plain(c["text"]) for c in table["rows"][0]]
            if not ({"名称", "材料"} <= set(header) and any(h.startswith("配方来源") for h in header)):
                continue
            col = {h: i for i, h in enumerate(header)}
            src_col = next(i for i, h in enumerate(header) if h.startswith("配方来源"))
            for row in table["rows"][1:]:
                if len(row) <= max(col["名称"], col["材料"], src_col):
                    continue
                links = wt.page_links(row[col["名称"]]["text"])
                if not links:
                    continue
                title = self.resolve(links[0])
                page = self.pages.get(title)
                ingredients = P.item_refs(row[col["材料"]]["text"], self.catalog) or self._generic_refs(row[col["材料"]]["text"])
                if not ingredients:
                    continue
                unlock_text = self.plain(row[src_col]["text"])
                hit = self.catalog.resolve(title) or {}
                out.append({
                    "id": f"recipe:{title}", "kind": "crafting",
                    "output": {"page": title if page else None, "id": (page and page["item_id"]) or hit.get("id"), "zh": title, "qty": 1},
                    "inputs": ingredients, "stations": [], "time": None,
                    "unlock_text": unlock_text or None,
                    "unlock": P.unlock_conditions(unlock_text) if unlock_text else [],
                    "source": zh_url("打造"),
                })
        return out

    def zh_raw(self, title):
        return self.zh[norm_title(title)]

    # —— 关系：工具升级 ——
    def build_tool_chains(self):
        chains = []
        for family in ("斧头", "十字镐", "锄头", "喷壶", "垃圾桶（工具）"):
            r = self.zh.get(family)
            if not r:
                self.issues["missing_tool_page"] += 1
                continue
            table = _find_table(wt.wikitables(r["text"]), ("名称", "名字"), ("花费", "费用", "所需金币"))
            if not table:
                self.issues["tool_table_not_found"] += 1
                continue
            header, rows = table
            col = _columns(header, {"name": ("名称", "名字"), "cost": ("花费", "费用", "所需金币"),
                                    "materials": ("材料", "所需材料"), "effect": ("提升", "工具特点", "提升功能"),
                                    "image": ("图片",)})
            tiers = []
            for level, row in enumerate(rows):
                cell = lambda key: row[col[key]]["text"] if key in col and col[key] < len(row) else ""
                name = self.plain(cell("name")).strip()
                hit = self.catalog.resolve(name) or {}
                amount, unit = P.price(cell("cost"))
                files = wt.files(cell("image"))
                tiers.append({
                    "level": level, "zh": name, "id": hit.get("id"), "en": hit.get("en"),
                    "cost": amount if level else None, "currency": unit if level else None,
                    "materials": P.item_refs(cell("materials"), self.catalog),
                    "effect": self.plain(cell("effect")) or None,
                    "image": self.image(files[0].split("|")[0] if files else None, hit.get("en")),
                })
            chains.append({"family": family, "en": self.pages.get(family, {}).get("en"), "kind": "blacksmith_upgrade",
                           "rule": "须在铁匠铺按顺序逐级升级，每次升级需等待 2 天（来源：铁匠铺条目）",
                           "station": "铁匠铺", "tiers": tiers, "source": zh_url(family)})
        # 信息框里带上一级/下一级的工具（鱼竿等）
        tool_pages = {p["title"]: p for p in self.pages.values() if p["infobox"] and p["infobox"].lower() == "infobox tool"}
        nexts = {}
        for title, p in tool_pages.items():
            info = wt.first_template(self.zh_raw(title)["text"], "Infobox")[1]
            prev_links = wt.page_links(info.get("previoustier", ""))
            next_links = wt.page_links(info.get("nexttier", ""))
            nexts[title] = {"prev": self.resolve(prev_links[0]) if prev_links else None,
                            "next": self.resolve(next_links[0]) if next_links else None,
                            "info": info}
        heads = [t for t, v in nexts.items() if (v["prev"] is None and v["next"]) ]
        for head in heads:
            tiers = []
            seen = set()
            cur = head
            while cur and cur in nexts and cur not in seen:
                seen.add(cur)
                info = nexts[cur]["info"]
                amount, unit = P.price(info.get("cost", ""))
                p = self.pages[cur]
                tiers.append({"level": len(tiers), "zh": cur, "id": p["item_id"], "en": p["en"],
                              "cost": amount, "currency": unit,
                              "sold_by": self.plain(info.get("soldby", "")) or None,
                              "unlock": P.unlock_conditions(self.plain(info.get("skillreq", ""))) if info.get("skillreq") else [],
                              "effect": self.plain(info.get("improvements", "")) or None,
                              "image": self.image(info.get("image"), p["en"])})
                cur = nexts[cur]["next"]
            chains.append({"family": head, "kind": "purchase_tiers",
                           "rule": "各级可直接购买，不需要先拥有上一级（来源：工具信息框）",
                           "tiers": tiers, "source": zh_url(head)})
        return chains

    # —— 鱼 ——
    def _linked_rows(self, title, section_titles):
        """某条目指定章节表格里的 {链接条目: 第三列文本}（夜市潜艇的出现率、蟹笼的水体）。"""
        out = {}
        for sec in wt.sections(self.zh.get(title, {}).get("text", "")):
            if (sec["title"] or "").strip("= ").strip() not in section_titles:
                continue
            for table in wt.wikitables(sec["body"]):
                for row in table["rows"][1:]:
                    links = wt.page_links(row[1]["text"]) if len(row) > 1 else []
                    if links:
                        out.setdefault(self.resolve(links[0]), self.plain(row[2]["text"]) if len(row) > 2 else None)
        return out

    def build_fish(self):
        fish = []
        # 归档《夜市》“钓鱼潜艇”表：除三种潜艇专属鱼，海参、大海参、章鱼也会在艇内上钩。
        submarine = self._linked_rows("夜市", ("钓鱼潜艇",))
        # 归档《蟹笼》“海洋”“淡水”两节分别列出各水体的蟹笼鱼类。
        ocean, fresh = self._linked_rows("蟹笼", ("海洋",)), self._linked_rows("蟹笼", ("淡水",))
        pages = [p for p in self.pages.values() if p["kind"] == "fish"]
        bullets = {}
        for p in pages:
            text = self.zh_raw(p["title"])["text"]
            info = wt.first_template(text, "Infobox")
            lead = wt.sections(text[info[4]:] if info else text)[0]["body"]
            # 传说鱼导言列出钓起它的特殊要求（站位、抛竿水域）；齐先生任务的同族鱼沿用原版的要求。
            if "传奇鱼" in "".join(p["categories"]):
                bullets[p["title"]] = (P.lead_bullets(lead, self.plain), [self.resolve(t) for t in wt.page_links(lead)])
        for p in pages:
            info = wt.first_template(self.zh_raw(p["title"])["text"], "Infobox")[1]
            loc_raw = info.get("location", "")
            own, links = bullets.get(p["title"], ([], []))
            parent = None if own else next((t for t in links if t != p["title"] and bullets.get(t, ([],))[0]), None)
            fish.append({
                "page": p["title"], "id": p["item_id"], "en": p["en"], "image": p["image"],
                "locations": [self.resolve(t) for t in wt.page_links(loc_raw)],
                "location_text": self.plain(loc_raw) or None,
                "seasons": P.seasons(info.get("season", "")),
                "season_text": self.plain(info.get("season", "")) or None,
                "times": P.time_ranges(self.plain(P.regular_part(info.get("time", ""), self.plain, "time"))),
                "time_text": self.plain(info.get("time", "")) or None,
                "weather": P.weather(P.regular_part(info.get("weather", ""), self.plain, "weather")),
                "weather_text": self.plain(info.get("weather", "")) or None,
                "difficulty": _int(info.get("difficulty")), "behavior": info.get("behavior") or None,
                "size": info.get("size") or None, "price": _int(self.plain(info.get("price", ""))),
                "categories": p["categories"], "map_pins": p["map_pins"],
                "source_text": self.plain(info.get("source", "")) or None,
                # 时段、天气按条拆开：鳟鱼大赛、鱿鱼节、瀑布等例外是单独一条，不能和常规时段连成一句。
                "time_list": P.list_entries(info.get("time", ""), self.plain),
                "weather_list": P.list_entries(info.get("weather", ""), self.plain),
                "requirements": own or (bullets[parent][0] if parent else []),
                "requirements_from": parent,
                "submarine": submarine.get(p["title"]) if p["title"] in submarine else None,
                "crab_water": "ocean" if p["title"] in ocean else "fresh" if p["title"] in fresh else None,
            })
        return fish

    # —— 作物与树木 ——
    def build_crops(self):
        seeds, crops, trees = [], [], []
        for p in self.pages.values():
            raw = self.zh_raw(p["title"])["text"]
            info = wt.first_template(raw, "Infobox")
            if not info:
                continue
            fields = info[1]
            kind = p["kind"]
            if kind == "seed":
                crop = P.item_refs(fields.get("crop", ""), self.catalog)
                prices = {}
                for key, shop in (("gPrice", "皮埃尔的杂货店"), ("jPrice", "Joja超市"), ("tPrice", "旅行货车"),
                                  ("oPrice", "绿洲"), ("iPrice", "姜岛商人"), ("otherprice", "其他")):
                    if fields.get(key):
                        amount, unit = P.price(fields[key])
                        prices[shop] = {"amount": amount, "currency": unit, "text": self.plain(fields[key])}
                growth_text = self.plain(fields.get("growth", ""))
                seeds.append({
                    "page": p["title"], "id": p["item_id"], "image": p["image"],
                    "crop": crop[0] if crop else None,
                    "seasons": P.seasons(fields.get("season", "")),
                    "season_text": self.plain(fields.get("season", "")),
                    "growth_days": P.days(growth_text), "growth_text": growth_text,
                    "regrow_days": _regrow(self.plain(raw)),
                    "sell_price": P.price(fields.get("sellprice", ""))[0],
                    "buy": prices,
                    "night_market_day": _int(fields.get("nmday")),
                })
            elif kind == "crop" or (kind in ("item", "cooking") and fields.get("seed")):
                seed = P.item_refs(fields.get("seed", ""), self.catalog)
                crops.append({
                    "page": p["title"], "id": p["item_id"], "image": p["image"],
                    "seed": seed[0] if seed else None,
                    "seasons": P.seasons(fields.get("season", "")),
                    "growth_days": P.days(self.plain(fields.get("growth", ""))),
                    "regrow_days": _regrow(self.plain(raw)),
                    "sell_price": _int(self.plain(fields.get("sellprice", ""))),
                    "xp": self.plain(fields.get("xp", "")) or None,
                })
            elif kind in ("fruit_tree", "tree"):
                trees.append({
                    "page": p["title"], "kind": kind, "image": p["image"],
                    "sapling": (P.item_refs(fields.get("sapling", "") or fields.get("seed", ""), self.catalog) or [None])[0],
                    "produce": P.item_refs(fields.get("produce", "") or fields.get("tapper", ""), self.catalog),
                    "seasons": P.seasons(fields.get("season", "")),
                    "growth_days": P.days(self.plain(fields.get("growth", ""))),
                    "price": P.price(fields.get("price", ""))[0] if fields.get("price") else None,
                })
        return seeds, crops, trees

    # —— 人物 ——
    def build_villagers(self):
        out = []
        for p in self.pages.values():
            if p["kind"] != "villager":
                continue
            info = wt.first_template(self.zh_raw(p["title"])["text"], "Infobox")[1]
            en = p["en"] or self.npc_en.get(p["title"])
            birthday = P.season_day(info.get("birthday", ""))
            tastes = self.npc_tastes.get(en, {}) if en else {}
            npc_list = lambda raw: [self.npc_zh.get(a.get("1"), a.get("1")) for _, a, _ in wt.templates(raw, {"NPC"})]
            out.append({
                "page": p["title"], "en": en, "image": self.image(info.get("portrait"), en),
                "birthday": {"season": birthday[0], "day": birthday[1]} if birthday else None,
                "region": self.plain(info.get("location", "")) or None,
                "address": self.plain(info.get("address", "")) or None,
                "family": npc_list(info.get("family", "")),
                "friends": npc_list(info.get("friends", "")),
                "marriage": self.plain(info.get("marriage", "")) or None,
                "favorites": P.item_refs(info.get("favorites", ""), self.catalog),
                "clinic": self.plain(info.get("clinic", "")) or None,
                "gift_tastes": {k: v for k, v in tastes.items()},
                "map_pins": p["map_pins"],
            })
        return out

    # —— 地点 ——
    def build_locations(self):
        out = []
        for p in self.pages.values():
            if p["infobox"] and p["infobox"].lower() == "infobox location":
                info = wt.first_template(self.zh_raw(p["title"])["text"], "Infobox")[1]
                island = info.get("island", "").strip()
                out.append({
                    "page": p["title"], "en": p["en"], "image": self.image(info.get("building")),
                    "map": "island" if island == "true" else ("island_small" if island == "small" else "valley"),
                    "x": _int(info.get("mapx")), "y": _int(info.get("mapy")),
                    "open_hours": self.plain(info.get("openhours", "")) or None,
                    "open_ranges": P.time_ranges(self.plain(info.get("openhours", ""))),
                    "closed": self.plain(info.get("closed", "")) or None,
                    "address": self.plain(info.get("address", "")) or None,
                    "occupants": [self.npc_zh.get(a.get("1"), a.get("1")) for _, a, _ in wt.templates(info.get("occupants", ""), {"NPC"})]
                    or [self.resolve(t) for t in wt.page_links(info.get("occupants", ""))],
                    "categories": p["categories"],
                })
        return out

    # —— 建筑 ——
    def build_buildings(self):
        out = {}
        for p in self.pages.values():
            if p["kind"] != "building":
                continue
            info = wt.first_template(self.zh_raw(p["title"])["text"], "Infobox")[1]
            amount, unit = P.price(info.get("cost", ""))
            out[p["title"]] = {
                "page": p["title"], "en": p["en"], "image": self.image(info.get("image"), p["en"]),
                "cost": amount, "currency": unit, "cost_text": self.plain(info.get("cost", "")),
                "materials": P.item_refs(info.get("materials", ""), self.catalog),
                "size": self.plain(info.get("sizehv", "") or info.get("size", "")) or None,
                "animals": self.plain(info.get("animals", "")) or None,
                "capacity": self.plain(info.get("capacity", "")) or None,
                "upgrade_text": self.plain(info.get("upgrade", "")) or None,
                "build_days": None, "description": None, "sold_by": None,
            }
        # 木匠的商店建筑表：补充建造时间、描述，以及只在表里出现的建筑
        shop = self.zh.get("木匠的商店")
        for table in wt.wikitables(shop["text"]) if shop else []:
            if not table["rows"]:
                continue
            header = [self.plain(c["text"]) for c in table["rows"][0]]
            if header[:4] == ["图片", "名称", "描述", "花费"] and len(header) == 4:
                self._house_upgrades(table, out)
                continue
            if not ("建造时间" in header and ("花费" in header or "建造成本" in header)):
                continue
            col = {h: i for i, h in enumerate(header)}
            for row in table["rows"][1:]:
                if len(row) < len(header):
                    continue
                link = next(iter(wt.iter_links(row[col["名称"]]["text"])), None)
                # “[[鸡舍|大鸡舍]]”：显示名是建筑名，链接目标是所属条目
                title = (link[1] or link[0]).strip() if link else self.plain(row[col["名称"]]["text"])
                page_title = self.resolve(link[0]) if link else title
                if title in ("售卖", "出货箱"):
                    continue
                title = {"魚塘": "鱼塘"}.get(title, title)
                if title == "鱼塘" and "鱼塘" in out and out["鱼塘"].get("build_days"):
                    continue
                cost_raw = row[col["花费"]]["text"]
                amount, unit = P.price(cost_raw)
                rec = out.setdefault(title, {"page": page_title, "en": self.pages.get(title, {}).get("en"),
                                             "image": None, "cost": amount, "currency": unit,
                                             "cost_text": self.plain(cost_raw),
                                             "materials": P.item_refs(cost_raw, self.catalog), "size": None,
                                             "animals": None, "capacity": None, "upgrade_text": None})
                rec["name"] = title
                rec["page"] = page_title
                rec["cost"], rec["currency"] = amount, unit
                rec["materials"] = P.item_refs(cost_raw, self.catalog)
                rec["build_days"] = P.days(self.plain(row[col["建造时间"]]["text"])) or (0 if "瞬间" in row[col["建造时间"]]["text"] else None)
                rec["description"] = self.plain(row[col["描述"]]["text"]) if "描述" in col else None
                desc = rec["description"] or ""
                m = re.search(r"(?:由|从)([一-龥]{2,6}?)(?:升级|扩建)", desc)
                if m:
                    rec["upgrade_from"] = m.group(1)
                rec["sold_by"] = "木匠的商店"
                files = wt.files(row[0]["text"])
                rec["image"] = rec["image"] or self.image(files[0].split("|")[0] if files else None)
        for name, rec in out.items():
            rec.setdefault("name", name)
            rec.setdefault("upgrade_from", _upgrade_from(rec))
        return list(out.values())

    def _house_upgrades(self, table, out):
        """木匠的商店里的农舍升级表：初始农舍 → 第一次 → 第二次 → 第三次升级。"""
        prev = "农舍"
        out.setdefault("农舍", {"name": "农舍", "page": "农舍", "en": self.pages.get("农舍", {}).get("en"), "image": self.image("House (tier 1).png"),
                              "cost": None, "currency": None, "cost_text": "初始", "materials": [], "size": None,
                              "animals": None, "capacity": None, "upgrade_text": None, "build_days": None,
                              "description": "游戏开始时就有的农舍。", "sold_by": None, "upgrade_from": None})
        for row in table["rows"][1:]:
            if len(row) < 4:
                continue
            name = self.plain(row[1]["text"]).strip()
            cost_raw = row[3]["text"]
            amount, unit = P.price(cost_raw)
            files = wt.files(row[0]["text"])
            title = f"农舍（{name}）"
            out[title] = {"name": title, "page": "农舍", "en": None,
                          "image": self.image(files[0].split("|")[0] if files else None),
                          "cost": amount, "currency": unit, "cost_text": self.plain(cost_raw),
                          "materials": P.item_refs(cost_raw, self.catalog), "size": None, "animals": None,
                          "capacity": None, "upgrade_text": None, "build_days": 3,
                          "description": self.plain(row[2]["text"]), "sold_by": "木匠的商店", "upgrade_from": prev}
            prev = title

    # —— 怪物、动物、矿物与古物 ——
    def build_misc(self):
        monsters, animals, minerals = [], [], []
        for p in self.pages.values():
            info = wt.first_template(self.zh_raw(p["title"])["text"], "Infobox")
            if not info:
                continue
            f = info[1]
            if p["kind"] == "monster":
                place = f.get("location", "").strip()
                place = f"[[{MONSTER_PLACES[place.lower()]}]]" if place.lower() in MONSTER_PLACES else place
                monsters.append({
                    "page": p["title"], "en": p["en"], "image": self.image(f.get("portrait"), p["en"]),
                    # 括号里是出现条件（“接受[[任务]]或激活挑战之神庙”），不算地点。
                    "locations": [self.resolve(t) for t in wt.page_links(re.sub(r"（[^）]*）|\([^)]*\)", "", place))],
                    "location_text": "；".join(P.list_entries(place, self.plain)),
                    "levels": "；".join(P.list_entries(f.get("levels", ""), self.plain)) or None,
                    # 信息框原文：多数是数值，史莱姆等写“各不相同”或按变种列出。
                    "stats": {k: _one_line(self.plain(f.get(k, ""))) for k in ("hp", "dmg", "def", "spd", "exp") if f.get(k, "").strip()},
                    "drops_seq": P.ordered_refs(f.get("drops", ""), self.catalog, self.plain),
                    "variations": [v for v in P.list_entries(f.get("variations", ""), self.plain) if v != "无"],
                    "hp": _int(self.plain(f.get("hp", ""))), "damage": self.plain(f.get("dmg", "")) or None,
                    "defense": _int(self.plain(f.get("def", ""))), "speed": _int(self.plain(f.get("spd", ""))),
                    "xp": _int(self.plain(f.get("exp", ""))),
                    "drops": P.item_refs(f.get("drops", ""), self.catalog),
                    "slayer_group": self.plain(f.get("killable", "")) or None,
                })
            elif p["kind"] == "animal":
                # {{name|Deluxe Barn}} 在名称表里写作“畜棚|高级畜棚”：前半是条目，后半是显示名。
                homes = []
                for ref in P.item_refs(f.get("building", ""), self.catalog):
                    override = self.catalog.override_names.get((ref["en"] or "").lower(), "")
                    homes.append({"zh": ref["zh"], "page": override.split("|")[0] if "|" in override else ref["zh"]})
                # 棕色蛋等在游戏数据里与白色的蛋同名，查不到物品 ID：保留 Wiki 的名称，链接到名称表写的所属条目。
                # “Large Goat Milk”在游戏里叫“L. Goat Milk”，Wiki 名称就是条目名，取条目对应的物品。
                produce = []
                for ref in P.item_refs(f.get("produce", ""), self.catalog):
                    qid = ref["id"] or (self.pages.get(ref["zh"]) or {}).get("item_id")
                    if qid:
                        produce.append({"id": qid})
                        continue
                    override = self.catalog.override_names.get((ref["en"] or "").lower(), "")
                    page = override.split("|")[0] if "|" in override else (ref["zh"] if ref["zh"] in self.pages else None)
                    produce.append({"zh": ref["zh"], "en": ref["en"], "page": page, "image": self.image(ref["en"])})
                animals.append({
                    "page": p["title"], "en": p["en"], "image": self.image(f.get("image"), p["en"]),
                    "building": [self.resolve(t) for t in wt.page_links(f.get("building", ""))],
                    "homes": homes, "produce_list": produce,
                    "produce": P.item_refs(f.get("produce", ""), self.catalog),
                    "buy_price": _int(self.plain(f.get("buyprice", ""))),
                })
            elif p["kind"] in ("mineral", "artifact"):
                minerals.append({
                    "page": p["title"], "id": p["item_id"], "kind": p["kind"], "image": p["image"],
                    "source_text": self.plain(f.get("source", "")) or None,
                    "sources": [self.resolve(t) for t in wt.page_links(f.get("source", "") + f.get("os", "") + f.get("as", "") + f.get("dr", "") + f.get("md", ""))],
                    "sell_price": _int(self.plain(f.get("sellprice", ""))),
                })
        return monsters, animals, minerals

    # —— 收集包（社区中心进度） ——
    def build_bundles(self):
        r = self.zh.get("收集包")
        rooms = []
        if not r:
            return rooms
        sections = wt.sections(r["text"])
        for i, sec in enumerate(sections):
            title = _clean_heading(sec["title"]) if sec["title"] else None
            if not title or sec["level"] != 3:
                continue
            tables = wt.wikitables(sec["body"])
            bundles = []
            room_reward = None
            for table in tables:
                rows = table["rows"]
                if not rows:
                    continue
                head_text = " ".join(c["text"] for c in rows[0])
                if "Bundle Complete Balloon" in head_text or ("奖励" in head_text and len(rows) == 1):
                    room_reward = self.plain(rows[0][-1]["text"])
                    continue
                if not rows[0][0]["header"]:
                    continue
                name = self.plain(rows[0][0]["text"]).strip()
                if not name.endswith("收集包"):
                    continue
                items, reward, slots = [], [], None
                for row in rows[1:]:
                    joined = " ".join(c["text"] for c in row)
                    if "Bundle Slot" in joined:
                        slots = joined.count("Bundle Slot")
                    if "奖励" in joined:
                        reward = P.item_refs(row[-1]["text"], self.catalog) or [{"zh": self.plain(row[-1]["text"])}]
                        continue
                    for idx, cell in enumerate(row):
                        refs = P.item_refs(cell["text"], self.catalog)
                        if not refs:
                            for _, args, _ in wt.templates(cell["text"], {"Quality"}):
                                item = self.catalog.resolve(args.get("1", ""))
                                if not item or not item.get("id"):
                                    continue
                                qty = re.search(r"[（(](\d+)[）)]", cell["text"])
                                quality = {"silver": "银星品质", "gold": "金星品质", "iridium": "铱星品质"}.get(args.get("2", ""), args.get("2"))
                                refs.append({**item, "qty": int(qty.group(1)) if qty else 1, "quality": args.get("2"), "note": quality})
                        if refs and "Bundle Slot" not in cell["text"]:
                            note = self.plain(row[idx + 1]["text"]) if idx + 1 < len(row) else None
                            for ref in refs:
                                ref["source_text"] = note
                                items.append(ref)
                            break
                cost = re.fullmatch(r"([\d,]+)金收集包", name)
                bundles.append({"name": name, "items": items, "slots": slots or len(items), "cost": int(cost.group(1).replace(",", "")) if cost else None,
                                "choose": (slots or len(items)) < len(items), "reward": reward})
            if bundles:
                rooms.append({"room": title, "reward": room_reward, "bundles": bundles,
                              "source": zh_url("收集包") + "#" + title})
        return rooms

    # —— 商店库存（表格里带价格的物品行） ——
    def build_shops(self):
        shops = []
        for p in self.pages.values():
            if "商店" not in p["categories"] and p["kind"] != "shop":
                continue
            raw = self.zh_raw(p["title"])["text"]
            stock = []
            for sec in wt.sections(raw):
                for table in wt.wikitables(sec["body"]):
                    rows = table["rows"]
                    if len(rows) < 2:
                        continue
                    header = [self.plain(c["text"]) for c in rows[0] if c["header"]]
                    if not header or not any(re.search(r"价格|售价|花费|费用|单价|代价", h) for h in header):
                        continue
                    # 同时列出购买价格和出售价格（哈维的诊所）时，取购买价格那一列；“其他来源”列另存，不当作购买备注。
                    buy_col = next((i for i, h in enumerate(header) if "购买价格" in h), None)
                    other_col = next((i for i, h in enumerate(header) if h == "其他来源"), None)
                    plain_cols = {i for i, h in enumerate(header) if re.fullmatch(r"描述|效果|图像|图片", h)}
                    for row in rows[1:]:
                        cells = [c["text"] for c in row]
                        # 名称列通常是链接；也有直接写物品名的（哈维的诊所），这时按名称认物品。
                        name_idx = next((i for i, c in enumerate(cells[1:], 1)
                                         if wt.page_links(c) or (self.catalog.resolve(self.plain(c)) or {}).get("id")), None)
                        if name_idx is None:
                            continue
                        price_idx = next((i for i in range(len(cells) - 1, name_idx, -1)
                                          if re.search(r"\{\{\s*[Pp]rice|\{\{\s*tprice|\{\{\s*[Nn]ame", cells[i])), None)
                        if buy_col is not None and buy_col < len(cells) and re.search(r"\{\{\s*[Pp]rice", cells[buy_col]):
                            price_idx = buy_col
                        # 按年份分列的价格（铁匠铺矿石：第 1 年 / 第 2 年起）：取第 1 年，其余列带表头写进备注。
                        yearly = [i for i in range(name_idx + 1, len(cells)) if re.search(r"\{\{\s*[Pp]rice", cells[i])]
                        if len(yearly) > 1 and all(i < len(header) and re.search(r"年|Year", header[i]) for i in yearly):
                            price_idx = yearly[0]
                        else:
                            yearly = []
                        if price_idx is None:
                            continue
                        refs = P.item_refs(cells[name_idx], self.catalog)
                        links = wt.page_links(cells[name_idx])
                        name = refs[0]["zh"] if refs else self.resolve(links[0]) if links else self.plain(cells[name_idx])
                        hit = self.catalog.resolve(name) or {}
                        amount, unit = P.price(cells[price_idx])
                        barter = P.item_refs(cells[price_idx], self.catalog)
                        # 购买价格之后的出售价格只是回收价，不作购买备注。
                        skip = {name_idx, price_idx, 0, other_col} | ({price_idx + 1} | plain_cols if price_idx == buy_col else set())
                        # “描述”列开头是物品说明（详情顶部已显示），只保留 Wiki 附加的说明（如“只能在第二年后购买”）。
                        item_id = (refs[0]["id"] if refs else None) or hit.get("id")
                        own_desc = self.plain(self.catalog.description(item_id) or "") if item_id else ""
                        notes = []
                        for i, c in enumerate(cells):
                            text = self.plain(c) if i not in skip else ""
                            if text and i in yearly[1:]:
                                text = re.sub(r"\s+", " ", header[i]) + "：" + text
                            if own_desc and header[i:i + 1] == ["描述"]:
                                text = text.replace(own_desc, "", 1).strip()
                            if text:
                                notes.append(text)
                        other = P.list_entries(cells[other_col], self.plain) if other_col is not None and other_col < len(cells) else []
                        stock.append({"zh": name, "id": (refs[0]["id"] if refs else None) or hit.get("id"),
                                      "price": amount, "currency": unit, "barter": barter,
                                      "section": _clean_heading(sec["title"]) if sec["title"] else None,
                                      "notes": notes[-2:] if notes else [], "other": other})
            info = wt.first_template(raw, "Infobox")
            fields = info[1] if info else {}
            shops.append({"page": p["title"], "en": p["en"], "open_hours": self.plain(fields.get("openhours", "")) or None,
                          "closed": self.plain(fields.get("closed", "")) or None, "stock": stock})
        return shops

    # —— 搜索索引 ——
    def build_search(self, items):
        entries = []
        for p in self.pages.values():
            entries.append({"t": p["title"], "en": p["en"], "k": p["kind"], "a": p["aliases"],
                            "id": p["item_id"], "img": p["image"], "s": (p["summary"] or "")[:80]})
        covered = {p["item_id"] for p in self.pages.values() if p["item_id"]}
        for it in items:
            if it["id"] in covered or it["type"] in ("WP", "FL"):
                continue
            entries.append({"t": it["zh"], "en": it["en"], "k": "item", "a": [], "id": it["id"],
                            "img": it["image"], "s": (it["desc"] or "")[:80], "page": it["page"]})
        return entries


def _first_paragraph(text):
    for para in text.split("\n"):
        para = para.strip()
        # “:关于家具，请见……”一类缩进提示不是导言。
        if len(para) > 8 and not para.startswith(("{|", "|", "!", ":")):
            return para[:400]
    return text[:400] if text else ""


def _simplified(text):
    """个别字段混入繁体（咖啡的“120分鐘（2小時）”），换成本站使用的简体。"""
    return (text or "").translate(str.maketrans("鐘時間製", "钟时间制"))


def _one_line(text):
    return re.sub(r"\s*\n\s*", " ", text or "").strip()


def _zh_duration(text):
    """“1m 23s”“30s”“7m”换成中文单位；其他写法（“8分钟24秒”“永久”）原样保留。"""
    m = re.fullmatch(r"\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?\s*", text or "")
    if not m or not (m.group(1) or m.group(2)):
        return text
    return (f"{m.group(1)}分" if m.group(1) else "") + (f"{m.group(2)}秒" if m.group(2) else "")


def _clean_heading(title):
    return title.strip("= ").strip() if title else title


def _int(value):
    if value is None:
        return None
    m = re.search(r"-?\d[\d,]*", str(value))
    return int(m.group(0).replace(",", "")) if m else None


def _regrow(plain):
    """多次收获作物：“成熟后，每4天可以收获一次”“每2天重复”“每隔4天继续产出”“持续收获 每4天”。"""
    for pattern in (r"成熟后[，,]?\s*每隔?\s*(\d+)\s*天", r"每隔?\s*(\d+)\s*天\s*(?:可以收获|继续|重复|持续)",
                    r"持续收获\s*每\s*(\d+)\s*天", r"(?:之后|此后|然后|以后)(?:每|会每|还会每|将每)\s*(\d+)\s*天"):
        m = re.search(pattern, plain)
        if m:
            return int(m.group(1))
    return None


def _find_table(tables, name_headers, cost_headers):
    for table in tables:
        if not table["rows"]:
            continue
        header = [re.sub(r"<[^>]+>|'''", "", c["text"]).strip() for c in table["rows"][0]]
        if any(h in header for h in name_headers) and any(h in header for h in cost_headers):
            return header, table["rows"][1:]
    return None


def _columns(header, wanted):
    col = {}
    for key, names in wanted.items():
        for i, h in enumerate(header):
            if any(h.startswith(n) for n in names):
                col[key] = i
                break
    return col


# 木匠的商店表格中“[[小屋|大屋子]]”的描述没有写“由…升级”，按链接所属条目补上
_UPGRADES = {"大鸡舍": "鸡舍", "高级鸡舍": "大鸡舍", "大畜棚": "畜棚", "高级畜棚": "大畜棚", "大屋子": "小屋"}


def _upgrade_from(rec):
    if rec.get("name") in _UPGRADES:
        return _UPGRADES[rec["name"]]
    text = (rec.get("description") or "") + (rec.get("upgrade_text") or "")
    m = re.search(r"(?:将|把)?([一-龥]{2,6})升级", text)
    return None if not m else None


def write(name, data):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        if name.endswith(".jsonl"):
            for row in data:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        else:
            json.dump(data, f, ensure_ascii=False, indent=1)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    b = Builder()
    pages, texts = b.build_pages()
    items = b.build_items()
    outputs = {
        "pages.json": pages,
        "page-text.jsonl": texts,
        "items.json": items,
        "recipes.json": b.build_recipes(),
        "tool-chains.json": b.build_tool_chains(),
        "fish.json": b.build_fish(),
        "villagers.json": b.build_villagers(),
        "locations.json": b.build_locations(),
        "buildings.json": b.build_buildings(),
        "bundles.json": b.build_bundles(),
        "shops.json": b.build_shops(),
    }
    seeds, crops, trees = b.build_crops()
    outputs.update({"seeds.json": seeds, "crops.json": crops, "trees.json": trees})
    monsters, animals, minerals = b.build_misc()
    outputs.update({"monsters.json": monsters, "animals.json": animals, "minerals.json": minerals})
    outputs["images.json"] = b.images
    outputs["image-coverage.json"] = {
        "total_items": len(items),
        "with_image": sum(bool(i["image"]) for i in items),
        "resolution_kinds": dict(Counter(i["image_kind"] for i in items)),
        "missing": [{k: i.get(k) for k in ("id", "zh", "en", "page")} for i in items if not i["image"]],
    }
    outputs["search-index.json"] = b.build_search(items)
    outputs["names.json"] = {
        "npc_en_to_zh": b.npc_zh,
        "bundle_key_to_zh": b.bundle_zh,
        "title_zh_to_en": {p["title"]: p["en"] for p in pages if p["en"]},
    }
    sizes = {name: write(name, data) for name, data in outputs.items()}
    counts = {name: len(data) for name, data in outputs.items()}
    kinds = Counter(p["kind"] for p in pages)
    manifest = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "sources": SOURCES,
        "wiki": {"zh_pages_total": len(b.zh_all), "zh_articles": len(b.articles), "zh_redirects": len(b.redirects),
                 "en_pages_total": len(b.en_all), "images": len(b.images),
                 "zh_latest_edit": max(r["timestamp"] for r in b.zh_all)},
        "counts": counts, "bytes": sizes, "page_kinds": dict(kinds.most_common()),
        "issues": dict(b.issues),
    }
    write("manifest.json", manifest)
    print(json.dumps({k: manifest[k] for k in ("wiki", "counts", "page_kinds", "issues")}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
