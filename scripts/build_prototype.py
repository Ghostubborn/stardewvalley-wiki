"""为交互原型打包数据：prototype/data.js、所需图标和像素字体子集。

用法：python3 -I scripts/build_prototype.py
字体子集需要项目虚拟环境里的 fontTools（.venv/bin/pyftsubset）。
"""

import base64
import hashlib
import html
import json
import os
import re
import runpy
import shutil
import subprocess
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from sdvdata.webp import WebP  # noqa: E402

BUILD = os.path.join(ROOT, "data", "build")
CURATED = os.path.join(ROOT, "data", "curated")
PROTO = os.path.join(ROOT, "prototype")
IMG_OUT = os.path.join(PROTO, "assets", "img")
FONT_SRC = os.path.join(PROTO, "assets", "fonts", "fusion-pixel-12px-proportional-zh_hans.otf")
FONT_OUT = os.path.join(PROTO, "assets", "fonts", "pixel-subset.woff2")
PYFTSUBSET = os.path.join(ROOT, ".venv", "bin", "pyftsubset")
UI_EN = os.path.join(ROOT, "data", "i18n", "ui.en.json")
SITE = "https://stardewvalley-wiki.pages.dev/"
# 当作图标的大图（地点全景、节日截图）超过这个大小就换成长边 192 像素的 WebP。
ICON_BYTES = 60_000
CJK = re.compile(r"[㐀-鿿]")

UI_IMAGES = [
    "Controls_Icon.png",
    "Spring.png", "Summer.png", "Fall.png", "Winter.png", "Sunny.png", "Rain.png", "Thunderstorm.png",
    "Snow.png", "Pollen_spring.png", "Pollen_fall.png", "Gold.png", "Farming_Skill_Icon.png",
    "Mining_Skill_Icon.png", "Foraging_Skill_Icon.png", "Fishing_Skill_Icon.png", "Combat_Skill_Icon.png",
    "Mastery_Icon.png", "Bundle_Green.png", "Bundle_Yellow.png", "Bundle_Orange.png", "Bundle_Teal.png",
    "Bundle_Red.png", "Bundle_Purple.png", "Bundle_Blue.png", "HeartIconLarge.png", "Golden_Walnut.png",
    "Rusty_Key.png", "Skull_Key.png", "Maplocation.png", "Festival.png", "Hardwood.png", "Battery_Pack.png",
    "Iridium_Bar.png", "Copper_Bar.png", "Iron_Bar.png", "Gold_Bar.png", "Furnace.png", "Krobus_Icon.png",
    "Clint_Icon.png", "Robin_Icon.png", "Willy_Icon.png", "Wizard_Icon.png", "Gunther_Icon.png", "Calendar.png",
    "Quest_Icon.png", "Gift_Icon.png", "Birthday_Icon.png", "Time_Icon.png", "Chest.png", "Joja_Icon.png",
    "Greenhouse.png", "Minecart.png", "Bus.png", "Ginger_Island.png", "Secret_Woods_Icon.png", "Sewer.png",
    "TV.png", "Scroll.png", "Museum.png", "Daffodil.png", "Fishing_Treasure_Chest.png",
    # 食用效果：游戏物品说明里的能量（绿色加号）、生命值（红色 H）图标和品质星。
    "Energy.png", "Health.png", "Silver_Quality.png", "Gold_Quality.png", "Iridium_Quality.png",
]

WEEKDAYS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0}


# 信息框漏填、正文写明的休息日。cd 单独给出：周五只是 16:00 后不营业，不能按“周五”算整天休息。
ARTICLE_CLOSURES = {
    # BWIKI《木匠的商店》：“房子里商店的柜台于每天09:00至17:00可供玩家使用，但周二除外……而在周五，罗宾会在下午 4 点前往星之果实酒吧。”
    "木匠的商店": {"closed": "周二；周五 16:00 以后", "cd": [2], "cdc": False},
}


def closed_weekdays(text):
    """休息日（0 是周日）。范围写法“星期一至星期四”展开成每一天，不能只取两端。"""
    days = set()
    order = [1, 2, 3, 4, 5, 6, 0]
    for a, b in re.findall(r"(?:星期|周)([一二三四五六日天])\s*(?:至|到|~|-|–|—)\s*(?:星期|周)?([一二三四五六日天])", text):
        i, j = order.index(WEEKDAYS[a]), order.index(WEEKDAYS[b])
        days.update(order[i:j + 1] if i <= j else order[i:] + order[:j + 1])
    days.update(WEEKDAYS[d] for d in re.findall(r"(?:星期|周)([一二三四五六日天])", text))
    return sorted(days)


def load(name):
    with open(os.path.join(BUILD, name), encoding="utf-8") as f:
        return json.load(f)


def cut_sentence(text, limit):
    """导言摘要截在句末，避免半句话（截不出完整句时才加省略号）。"""
    if len(text) <= limit:
        return text
    head = text[:limit]
    end = max(head.rfind(mark) for mark in "。！？")
    return head[:end + 1] if end >= limit // 4 else head.rstrip() + "…"


def main():
    pages = load("pages.json")
    items = load("items.json")
    images = load("images.json")
    used_images = {name for name in UI_IMAGES if name in images}
    webp = WebP(ROOT, IMG_OUT)
    derived = set()  # 转换出来的 WebP 图标

    with open(os.path.join(CURATED, "map-positions.json"), encoding="utf-8") as f:
        calibration = json.load(f)["points"]
    map_points, point_aliases = {}, {}

    def point_id(key, x, y):
        return f"{key}:{x:g}:{y:g}"

    def position(point, wiki=False):
        if point.get("x") is None or point.get("y") is None:
            return None
        x, y, key = point["x"], point["y"], point["map"]
        # Wiki Map uses a 20px avatar at a CSS top/left offset. Normalize its
        # centre once, including display width, then apply illustration anchors.
        old_id = point_id(key, x + 10 if wiki else x, y + 10 if wiki else y)
        if wiki:
            scale = 400 / point.get("width", 400)
            x, y = (x + 10) * scale, (y + 10) * scale
        correction = calibration.get(point_id(key, x, y), {})
        if correction.get("omit"):
            return None
        x, y, key = correction.get("x", x), correction.get("y", y), correction.get("map", key)
        if key not in ("valley", "island"):
            raise ValueError(f"地图坐标没有对应的底图，需校准：{old_id}")
        x, y = round(x, 3), round(y, 3)
        if not (0 <= x <= 400 and 0 <= y <= 244):
            raise ValueError(f"地图坐标越界：{key}:{x}:{y}")
        current_id = point_id(key, x, y)
        if old_id != current_id:
            if old_id in point_aliases and point_aliases[old_id] != current_id:
                raise ValueError(f"地图旧链接存在歧义：{old_id}")
            point_aliases[old_id] = current_id
        meta = map_points.setdefault(current_id, {"precision": "region"})
        meta.update({k: v for k, v in correction.items() if k in ("precision", "area", "title")})
        return [x, y, key]

    def wiki_pins(pins):
        return [result for p in pins if (result := position(p, wiki=True))]

    def img(name):
        if name:
            if name not in images:
                raise ValueError(f"图片引用没有对应归档文件：{name}")
            meta = images[name]
            # 图标只显示 48～80 像素，不必为它下载几 MB 的全景图（鹈鹕镇的地图有 3.7 MB）。
            if meta.get("bytes", 0) > ICON_BYTES and max(meta.get("w") or 0, meta.get("h") or 0) > 192:
                small = webp.name(meta, "icon")
                if small:
                    derived.add(small)
                    return small
            used_images.add(name)
        return name

    page_by_title = {p["title"]: p for p in pages}
    item_by_id = {i["id"]: i for i in items}

    # —— 条目 ——
    out_pages = {}
    for p in pages:
        out_pages[p["title"]] = {
            "k": p["kind"], "kz": p["kind_zh"], "s": cut_sentence(p["summary"] or "", 160), "u": p["url"],
            "e": p["en"], "i": img(p["image"] or item_by_id.get(p["item_id"], {}).get("image")), "id": p["item_id"], "sec": p["sections"][:14],
            "a": p["aliases"][:6], "f": {k: v if k == "source" else v[:120] for k, v in p["fields"].items()
                                         if k in ("source", "season", "location", "time", "weather", "recipe",
                                                  "ingredients", "sellprice", "openhours", "closed", "address",
                                                  "occupants", "birthday", "marriage", "growth", "produces",
                                                  "craftingstation", "crafttime", "buff", "edibility") and v},
        }
        # 逐条来源（远古斑点、怪物掉落、其他来源或“来源”）、古物的捐赠奖励，以及“获取途径”一类章节。
        for key, field in (("src", "src"), ("dr", "dr"), ("ob", "obtain"), ("pr", "props")):
            if p.get(field):
                out_pages[p["title"]][key] = p[field]

    # —— 物品 ——
    referenced = set()

    def ref(i):
        if i and i.get("id"):
            referenced.add(i["id"])
        return i

    out_items = {}
    # 有配方或商店出售的物品已有获取途径，不再附带其他条目里提到它的句子。
    covered = {r["output"]["id"] for r in load("recipes.json")} | {x["id"] for shop in load("shops.json") for x in shop["stock"] if x.get("id")}

    def add_item(it):
        out_items[it["id"]] = {
            "z": it["zh"], "e": it["en"], "i": img(it["image"]), "c": it.get("category_name") or it["type_name"],
            "p": it.get("price"), "d": (it["desc"] or "")[:90], "pg": it["page"],
            "inote": it.get("image_note"),
        }
        # 能量与生命值以条目信息框为准；条目不是写这件物品（如哈维的诊所里的药），才用游戏数据按同一公式补算。
        page = page_by_title.get(it["page"]) or {}
        own_eat = page.get("item_id") == it["id"] and (page.get("props") or {}).get("eat")
        extra = {"src": it.get("src") or None, "x": 1 if it.get("internal") else None, "eat": None if own_eat else it.get("eat"),
                 "mn": [{"p": m["page"], "t": m["text"]} for m in it.get("mentions", [])] if it["id"] not in covered else None}
        # 蜂蜜随附近的花、鱼籽随鱼塘里的鱼而不同：保留口味来源，详情据此说明产出方式。
        if it.get("made_by") in ("(O)340", "(O)812"):
            extra.update(fo=it["flavor_of"], mb=it["made_by"])
        out_items[it["id"]].update({k: v for k, v in extra.items() if v})

    # —— 鱼 ——
    fish_text = {}
    with open(os.path.join(BUILD, "page-text.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            fish_text[r["title"]] = " ".join(s["text"] for s in r["sections"][:2])
    fish = []
    # 鱼塘产物（《鱼塘》产物表）：鱼籽写的是通用的“鱼籽”，换成这种鱼自己的鱼籽（“河豚鱼籽”）。
    item_ids = {i["id"] for i in items}
    pond = defaultdict(list)
    fish_ids = {f["page"]: f["id"] for f in load("fish.json")}
    for r in load("fish-pond.json"):
        fid, pid = fish_ids.get(r["fish"]), r["id"]
        own = fid and pid == "(O)812" and "(O)812/" + fid.split(")", 1)[-1]
        pond[r["fish"]].append({"id": own if own in item_ids else pid, "z": r["zh"], "q": r["qty"], "n": r["pop"], "c": r["chance"], "d": r["daily"]})
    # 地点写成纯文字、没有链接的鱼：“河流”指小镇与森林两段河，虾虎鱼在森林河流下游的瀑布。
    river_text = {"河流": ["鹈鹕镇河流", "煤矿森林河流"], "煤矿森林下方瀑布": ["煤矿森林河流"]}
    for f in load("fish.json"):
        cats = [re.sub(r"[\u200b-\u200f]", "", c) for c in f["categories"]]
        text = fish_text.get(f["page"], "")
        rules = {"tl": f["time_list"], "wl": f["weather_list"], "req": f["requirements"], "sub": f["submarine"], "cw": f["crab_water"]}
        fish.append({
            "p": f["page"], "id": f["id"], "i": img(f["image"]), "L": f["locations"] or river_text.get(f["location_text"] or "", []), "lt": f["location_text"],
            "S": f["seasons"], "st": f["season_text"], "T": f["times"], "tt": f["time_text"],
            "W": f["weather"], "wt": f["weather_text"], "d": f["difficulty"], "pr": f["price"],
            "pins": wiki_pins(f["map_pins"]),
            "var": bool(f["season_text"] and "：" in f["season_text"]),
            "crab": "蟹笼鱼类" in cats,
            "legend": "传奇鱼" in cats,
            "qi": "大家族" in text and "任务期间" in text,
            "pond": pond.get(f["page"]) or None,
            **{k: v for k, v in rules.items() if v},
        })
        ref({"id": f["id"]})

    # —— 居民 ——
    villagers = []
    for v in load("villagers.json"):
        tastes = v["gift_tastes"] or {}
        for t in ("love", "like"):
            for iid in tastes.get(t, []):
                referenced.add(iid)
        icon = None
        if v["en"]:
            cand = f"{v['en'].replace(' ', '_')}_Icon.png"
            icon = cand if cand in images else None
        villagers.append({
            "p": v["page"], "en": v["en"], "i": img(icon or v["image"]), "portrait": img(v["image"]),
            "bd": v["birthday"], "region": v["region"], "addr": v["address"], "fam": v["family"],
            "mar": v["marriage"], "love": tastes.get("love", []), "like": tastes.get("like", []),
            "fav": [ref(x)["id"] for x in v["favorites"] if x.get("id")],
            "pins": wiki_pins(v["map_pins"]),
        })

    # —— 地点 ——
    locations = []
    for l in load("locations.json"):
        fix = ARTICLE_CLOSURES.get(l["page"]) if not l["closed"] else None
        closed = fix["closed"] if fix else l["closed"] or ""
        days = fix["cd"] if fix else closed_weekdays(closed)
        x, y, key = position(l, wiki=True) or [None, None, l["map"]]
        locations.append({
            "p": l["page"], "en": l["en"], "map": key, "x": x, "y": y,
            "i": img(l["image"]),
            "hours": l["open_hours"], "R": l["open_ranges"], "closed": closed or None, "cd": days,
            "cdc": fix["cdc"] if fix else bool(days and re.search(r"后|之后|以后|如果|若", closed)),
            "addr": l["address"], "occ": l["occupants"],
        })

    # —— 作物 ——
    crops_by_seed = {}
    crops = load("crops.json")
    for c in crops:
        if c["seed"] and c["seed"].get("id"):
            crops_by_seed[c["seed"]["id"]] = c
    seeds = []
    for s in load("seeds.json"):
        crop = (s["crop"] or {})
        c = crops_by_seed.get(s["id"]) or next((x for x in crops if crop.get("id") and x["id"] == crop.get("id")), None)
        buy = {k: v["amount"] for k, v in s["buy"].items() if v.get("amount")}
        seeds.append({
            "p": s["page"], "id": s["id"], "i": img(s["image"]),
            "crop": {"id": crop.get("id"), "z": crop.get("zh"), "i": img((item_by_id.get(crop.get("id")) or {}).get("image"))} if crop else None,
            "S": s["seasons"] or (c and c["seasons"]) or [], "g": s["growth_days"] or (c and c["growth_days"]),
            "rg": (c and c["regrow_days"]) or s["regrow_days"], "buy": buy,
            "sell": c and c["sell_price"],
        })
        ref({"id": s["id"]})
        ref({"id": crop.get("id")})

    # —— 配方 ——
    recipes = []
    for r in load("recipes.json"):
        for x in r["inputs"]:
            ref(x)
        for x in r["stations"]:
            ref(x)
        ref({"id": r["output"]["id"]})
        recipes.append({
            "id": r["id"], "k": r["kind"],
            "out": {"id": r["output"]["id"], "z": r["output"]["zh"], "pg": r["output"]["page"], "q": r["output"]["qty"]},
            "in": [{"id": x["id"], "z": x["zh"], "q": x["qty"], "g": x.get("generic", False)} for x in r["inputs"]],
            "st": [{"id": x["id"], "z": x["zh"]} for x in r["stations"]],
            "t": r["time"], "u": r["unlock_text"], "uc": r["unlock"],
        })

    # —— 工具、建筑、收集包、商店 ——
    chains = load("tool-chains.json")
    for c in chains:
        for t in c["tiers"]:
            ref(t)
            img(t["image"])
            for m in t.get("materials", []):
                ref(m)
    buildings = load("buildings.json")
    for b in buildings:
        img(b["image"])
        for m in b["materials"]:
            ref(m)
    bundles = load("bundles.json")
    for room in bundles:
        for b in room["bundles"]:
            for x in b["items"]:
                ref(x)
            for x in b["reward"] or []:
                ref(x)
    shops = []
    for s in load("shops.json"):
        stock = []
        for x in s["stock"]:
            if not x["zh"] or len(x["zh"]) > 20:
                continue
            ref(x)
            for b in x.get("barter") or []:
                ref(b)
            stock.append({"z": x["zh"], "id": x["id"], "pr": x["price"], "cur": x["currency"],
                          "bt": [{"id": b["id"], "z": b["zh"], "q": b["qty"]} for b in x.get("barter") or []],
                          "n": [n[:40] for n in x["notes"] if len(n) <= 40][:2], "sec": x["section"]})
        shops.append({"p": s["page"], "hours": s["open_hours"], "closed": s["closed"], "stock": stock})

    for it in items:
        add_item(it)
    # 商店表里的“其他来源”列（哈维的诊所）：没有独立条目的物品以它作逐条来源。
    for s in load("shops.json"):
        for x in s["stock"]:
            if x.get("other") and x["id"] in out_items and not out_items[x["id"]].get("src"):
                out_items[x["id"]]["src"] = x["other"]

    unresolved = {p["id"] for p in out_pages.values() if p["id"] and p["id"] not in out_items}
    if unresolved:
        raise ValueError(f"页面引用的物品未打包：{sorted(unresolved)}")

    # —— 怪物与动物 ——
    monsters = []
    for m in load("monsters.json"):
        drops = [{"t": v} if kind == "t" else {k: x for k, x in (("id", v["id"]), ("z", None if v["id"] else v["zh"]), ("n", v["note"])) if x}
                 for kind, v in m["drops_seq"]]
        record = {"p": m["page"], "i": img(m["image"]), "lt": m["location_text"], "L": list(dict.fromkeys(m["locations"])),
                  "lv": m["levels"], "s": m["stats"], "dr": drops, "vr": m["variations"]}
        monsters.append({k: v for k, v in record.items() if v})
    # 普通树的树液采集器产物（枫糖浆、橡树树脂……）；果树的果实已由种植途径覆盖。
    trees = [{"p": t["page"], "pr": [x["id"] for x in t["produce"] if x.get("id")]} for t in load("trees.json")
             if t["kind"] == "tree" and any(x.get("id") for x in t["produce"])]
    animals = []
    for a in load("animals.json"):
        record = {"p": a["page"], "i": img(a["image"]), "h": [{"z": h["zh"], "pg": h["page"]} for h in a["homes"]],
                  "pr": [x["id"] if x.get("id") else {"z": x["zh"], "e": x["en"], "pg": x["page"], "i": img(x["image"])} for x in a["produce_list"]],
                  "bp": a["buy_price"]}
        animals.append({k: v for k, v in record.items() if v})

    # —— 地图点位 ——
    pins = []
    seen = set()
    for p in pages:
        for m in p["map_pins"]:
            point = position(m, wiki=True)
            if point is None:
                continue
            x, y, map_key = point
            key = (p["title"], map_key, x, y)
            if key in seen:
                continue
            seen.add(key)
            pins.append({"t": p["title"], "k": p["kind"], "map": map_key, "x": x, "y": y,
                         "i": img(p["image"])})

    # —— 技能解锁的配方 ——
    skill_unlocks = defaultdict(lambda: defaultdict(list))
    for r in recipes:
        for c in r["uc"]:
            if c["group"] == "skill":
                skill_unlocks[c["skill"]][c["level"]].append({"id": r["out"]["id"], "z": r["out"]["z"], "k": r["k"]})

    with open(os.path.join(CURATED, "progression.json"), encoding="utf-8") as f:
        progression = json.load(f)
    for area in progression["areas"]:
        area["x"], area["y"], area["map"] = position(area)

    manifest = load("manifest.json")
    with open(os.path.join(CURATED, "guides.json"), encoding="utf-8") as f:
        guides = json.load(f)
    # 防剧透：官方中文 Wiki 归档里来源提到后期内容的条目，仍按后期内容保护（见文件说明）。
    with open(os.path.join(CURATED, "legacy-late-sources.json"), encoding="utf-8") as f:
        legacy_late = [name for name in json.load(f)["names"] if name in out_pages]

    def data_url(name):
        path = images[name]["path"]
        with open(os.path.join(ROOT, path), "rb") as f:
            return "data:image/png;base64," + base64.b64encode(f.read()).decode()

    # 条目正文按条目单独写到 prototype/articles/，这里只记下文件名（ar）。
    articles, article_text, article_images = runpy.run_path(os.path.join(ROOT, "scripts", "build_articles.py"))["build"](webp)
    webp.run()
    for title, key in articles["zh"].items():
        if title in out_pages:
            out_pages[title]["ar"] = key

    data = {
        "meta": {"generated": manifest["generated_at"], "sources": manifest["sources"], "wiki": manifest["wiki"],
                 "counts": {k.replace(".json", ""): v for k, v in manifest["counts"].items()}},
        "maps": {"valley": {"src": data_url("Map.png"), "w": 400, "h": 244},
                 "island": {"src": data_url("Ginger_Island_Map.png"), "w": 400, "h": 244}},
        "mapPoints": map_points, "mapPointAliases": point_aliases,
        "pages": out_pages, "items": out_items, "fish": fish, "villagers": villagers, "locations": locations,
        "seeds": seeds, "recipes": recipes, "chains": chains, "buildings": buildings, "bundles": bundles,
        "shops": shops, "pins": pins, "skillUnlocks": skill_unlocks, "progression": progression,
        "monsters": monsters, "animals": animals, "trees": trees,
        "guides": guides, "legacyLate": legacy_late,
        "schedules": runpy.run_path(os.path.join(ROOT, "scripts", "build_schedules.py"))["build"](ROOT),
    }

    os.makedirs(IMG_OUT, exist_ok=True)
    copied = missing = 0
    for name in sorted(n for n in used_images if n):
        meta = images.get(name)
        if not meta:
            missing += 1
            continue
        dest = os.path.join(IMG_OUT, name)
        # 重新生成必须修复旧的、不完整的复制结果，不能因为文件存在就跳过。
        shutil.copyfile(os.path.join(ROOT, meta["path"]), dest)
        copied += 1
    data["imgs"] = sorted({n for n in used_images if n and n in images} | derived)
    # 条目正文里的图片只按文件名引用，不进图标清单。
    for name in article_images:
        meta = images.get(name)
        if meta and name not in used_images:
            shutil.copyfile(os.path.join(ROOT, meta["path"]), os.path.join(IMG_OUT, name))
            copied += 1
    # 以前构建留下、现在没有引用的图片删掉，部署时不再上传。
    keep = set(used_images) | set(article_images) | derived
    for name in os.listdir(IMG_OUT):
        if name not in keep:
            os.remove(os.path.join(IMG_OUT, name))

    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(PROTO, "data.js"), "w", encoding="utf-8") as f:
        f.write("/* 由 scripts/build_prototype.py 生成；中文资料来自星露谷物语 BWIKI（2026-10-29 抓取），图片来自 Stardew Valley Wiki（CC BY-NC-SA 3.0）的 2025-12-18 归档。 */\n")
        f.write("window.SDV = " + payload + ";\n")

    english = build_english(articles["en"])
    subset_font(payload + english + article_text)
    version_assets()
    print(json.dumps({"data_js_mb": round(os.path.getsize(os.path.join(PROTO, "data.js")) / 1e6, 2),
                      "items": len(out_items), "pages": len(out_pages), "pins": len(pins), "recipes": len(recipes),
                      "images_copied": copied, "images_missing": missing}, ensure_ascii=False))


def build_english(articles):
    """英文版：data.en.js（英文 Wiki 的显示文本）、js/strings.en.js（界面词典）和 en/index.html。"""
    data, report = runpy.run_path(os.path.join(ROOT, "scripts", "build_en.py"))["build"]()
    for title, key in articles.items():
        if title in data["pages"]:
            data["pages"][title]["ar"] = key
    missing = report["missing"]
    if missing:
        print("英文资料缺口：", json.dumps(missing, ensure_ascii=False))
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(PROTO, "data.en.js"), "w", encoding="utf-8") as f:
        f.write("/* 由 scripts/build_prototype.py 生成；英文显示文本来自 Stardew Valley Wiki（CC BY-NC-SA 3.0）的 2025-12-18 归档。 */\n")
        f.write("window.SDV_EN = " + payload + ";\n")
    with open(UI_EN, encoding="utf-8") as f:
        ui = json.load(f)
    strings = json.dumps(ui, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    with open(os.path.join(PROTO, "js", "strings.en.js"), "w", encoding="utf-8") as f:
        f.write("/* 由 scripts/build_prototype.py 从 data/i18n/ui.en.json 生成：界面文案，以中文原文为键。 */\n")
        f.write("window.SDV_UI_EN = " + strings + ";\n")
    page = english_page(ui)
    os.makedirs(os.path.join(PROTO, "en"), exist_ok=True)
    with open(os.path.join(PROTO, "en", "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print("英文版：", json.dumps(report["counts"], ensure_ascii=False))
    return payload + strings + page


# 英文页只改显示文字与语言相关的属性；脚本和注释原样保留。
EN_HEAD = {
    "title": "Stardew Valley Interactive Guide – a spoiler-safe reference",
    "description": "A spoiler-safe Stardew Valley reference: how to get items, where and when fish bite, and what each upgrade needs, plus a valley map and progression tree. Built from the Stardew Valley Wiki. Free, no ads, no sign-up.",
    "og_description": "How to get items, where and when fish bite, and what each upgrade needs, spoiler-safe by default. Built from the Stardew Valley Wiki.",
}
TEXT_ATTRS = ("aria-label", "title", "placeholder", "alt", "data-title")


def english_page(ui):
    with open(os.path.join(PROTO, "index.html"), encoding="utf-8") as f:
        page = f.read()
    missing = []

    def tr(text):
        core = text.strip()
        if not core or not CJK.search(core):
            return text
        value = ui.get(html.unescape(core))
        if value is None:
            missing.append(core)
            return text
        return text.replace(core, html.escape(value, quote=False))

    def attr(match):
        name, value = match.group(1), match.group(2)
        if not CJK.search(value):
            return match.group(0)
        out = ui.get(html.unescape(value))
        if out is None:
            missing.append(value)
            return match.group(0)
        return f'{name}="{html.escape(out)}"'

    parts = re.split(r"(<script\b.*?</script>|<!--.*?-->)", page, flags=re.S)
    for i in range(0, len(parts), 2):
        chunk = parts[i]
        chunk = re.sub(r"<title>.*?</title>", f"<title>{EN_HEAD['title']}</title>", chunk)
        chunk = re.sub(r'(<meta name="description" content=")[^"]*"', lambda m: m.group(1) + html.escape(EN_HEAD["description"]) + '"', chunk)
        chunk = re.sub(r'(<meta property="og:site_name" content=")[^"]*"', r'\1Stardew Valley Interactive Guide"', chunk)
        chunk = re.sub(r'(<meta property="og:title" content=")[^"]*"', lambda m: m.group(1) + html.escape(EN_HEAD["title"]) + '"', chunk)
        chunk = re.sub(r'(<meta property="og:description" content=")[^"]*"', lambda m: m.group(1) + html.escape(EN_HEAD["og_description"]) + '"', chunk)
        chunk = chunk.replace(f'<meta property="og:url" content="{SITE}">', f'<meta property="og:url" content="{SITE}en/">')
        chunk = chunk.replace('<meta property="og:locale" content="zh_CN">', '<meta property="og:locale" content="en_US">')
        chunk = chunk.replace("assets/social/preview-zh.png", "assets/social/preview-en.png")
        chunk = re.sub(r'href="([^"]+)" data-href-en="([^"]+)"', r'href="\2"', chunk)
        chunk = re.sub(r"(%s)=\"([^\"]*)\"" % "|".join(TEXT_ATTRS), attr, chunk)
        chunk = re.sub(r">([^<>]+)<", lambda m: ">" + tr(m.group(1)) + "<", chunk)
        parts[i] = chunk
    page = "".join(parts)
    # 切换按钮在英文页指向中文版，按钮文字保持中文。
    page = re.sub(r'<a class="lang-switch"[^>]*>EN</a>',
                  '<a class="lang-switch" id="lang-switch" href="./" hreflang="zh-Hans" lang="zh-Hans" data-lang="zh" title="切换到中文">中文</a>', page)
    page = page.replace('<html lang="zh-CN">', '<html lang="en">', 1)
    # 英文页在 /en/，静态资源与中文页共用根目录的文件。
    page = page.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="../">', 1)
    page = page.replace('<script src="js/i18n.js', '<script src="js/strings.en.js"></script>\n<script src="data.en.js"></script>\n<script src="js/i18n.js', 1)
    if missing:
        raise ValueError("英文页缺少翻译：" + json.dumps(sorted(set(missing)), ensure_ascii=False))
    visible = re.sub(r"<script\b.*?</script>|<!--.*?-->", "", page, flags=re.S)
    leftover = [x for x in CJK.findall(re.sub(r'title="切换到中文">中文<', "", visible))]
    if leftover:
        raise ValueError("英文页仍有中文：" + "".join(leftover)[:80])
    return page


def subset_font(payload):
    if not os.path.exists(PYFTSUBSET) or not os.path.exists(FONT_SRC):
        print("跳过字体子集：缺少 pyftsubset 或源字体")
        return
    texts = [payload]
    for name in ("index.html", "app.js", "styles.css", "guides.css"):
        path = os.path.join(PROTO, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                texts.append(f.read())
    for name in os.listdir(os.path.join(PROTO, "js")):
        if name.endswith(".js"):
            with open(os.path.join(PROTO, "js", name), encoding="utf-8") as f:
                texts.append(f.read())
    chars = set("".join(texts))
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars = "".join(sorted(c for c in chars if c.isprintable()))
    chars_path = os.path.join(BUILD, "font-chars.txt")
    with open(chars_path, "w", encoding="utf-8") as f:
        f.write(chars)
    subprocess.run([PYFTSUBSET, FONT_SRC, f"--text-file={chars_path}", "--flavor=woff2",
                    f"--output-file={FONT_OUT}", "--layout-features=*", "--no-hinting"], check=True)
    print("字体子集：", len(chars), "字，", round(os.path.getsize(FONT_OUT) / 1e3), "KB")


def version_assets():
    """Keep cached scripts/data in sync after any generated-data or UI change."""
    def digest(path):
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()[:12]
    css_path = os.path.join(PROTO, "styles.css")
    if os.path.isfile(FONT_OUT):
        with open(css_path, encoding="utf-8") as f:
            css = f.read()
        css = re.sub(r'assets/fonts/pixel-subset\.woff2(?:\?v=[^"\)]+)?',
                     "assets/fonts/pixel-subset.woff2?v=" + digest(FONT_OUT), css)
        with open(css_path, "w", encoding="utf-8") as f:
            f.write(css)
    def replace(match):
        attr, name = match.group(1), match.group(2)
        path = os.path.join(PROTO, name)
        if not name.endswith((".js", ".css", ".woff2")) or not os.path.isfile(path):
            return match.group(0)
        return f'{attr}="{name}?v={digest(path)}"'
    def social(match):
        # 分享预览图写在 meta 的绝对地址里；带上指纹，换图后各平台不再沿用旧缓存。
        path = os.path.join(PROTO, match.group(2))
        return f'{match.group(1)}{match.group(2)}?v={digest(path)}"' if os.path.isfile(path) else match.group(0)
    # 两个语言版本的页面引用同一批根目录资源（英文页通过 <base href="../">）。
    for html_path in (os.path.join(PROTO, "index.html"), os.path.join(PROTO, "en", "index.html")):
        if not os.path.isfile(html_path):
            continue
        with open(html_path, encoding="utf-8") as f:
            page = f.read()
        page = re.sub(r'(src|href)="([^"?]+)(?:\?[^\"]*)?"', replace, page)
        page = re.sub(r'(content="%s)(assets/social/[^"?]+)(?:\?[^"]*)?"' % re.escape(SITE), social, page)
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(page)


if __name__ == "__main__":
    main()
