"""由中文 Wiki 的 Lua 数据模块建立物品目录，并提供中英文名称与限定 ID 的互查。"""

import re

from .lua import parse_module

# 游戏物品分类编号（StardewValley.Object 中的常量）对应的中文名
OBJECT_CATEGORIES = {
    0: "其他", -2: "宝石", -4: "鱼", -5: "蛋", -6: "奶", -7: "料理", -8: "可制作物品",
    -9: "大型可制作物品", -12: "矿物", -14: "肉类", -15: "金属资源", -16: "建筑材料",
    -17: "皮埃尔商店收购", -18: "皮埃尔与玛妮收购", -19: "肥料", -20: "垃圾", -21: "鱼饵",
    -22: "钓具", -23: "鱼店收购", -24: "装饰", -25: "烹饪原料", -26: "工匠物品", -27: "树液类",
    -28: "怪物掉落", -29: "装备", -74: "种子", -75: "蔬菜", -79: "水果", -80: "花卉",
    -81: "采集品", -95: "帽子", -96: "戒指", -97: "鞋类", -98: "武器", -99: "工具",
    -100: "服装", -101: "饰品", -102: "书籍", -103: "技能书", -999: "杂物",
}

# 限定 ID 前缀（1.6 的 ItemRegistry 类型标识）
ITEM_TYPES = {
    "O": "物品", "BC": "大型物品", "F": "家具", "H": "帽子", "S": "上衣", "P": "裤子",
    "B": "鞋类", "W": "武器", "T": "工具", "TR": "饰品", "M": "人体模型", "WP": "壁纸", "FL": "地板",
}

_QID_RE = re.compile(r"^\(([a-z]+)\)(.+)$", re.I)


def norm_qid(raw):
    """'(o)24' / '(O)24' → '(O)24'。"""
    match = _QID_RE.match(raw.strip())
    if not match:
        return raw.strip()
    return f"({match.group(1).upper()}){match.group(2)}"


def split_ids(raw):
    """模块里多个 ID 以 '\\' 或 '<br />' 连接。"""
    parts = re.split(r"\\|<br\s*/?>", raw)
    return [norm_qid(p) for p in parts if p.strip()]


class Catalog:
    def __init__(self, modules):
        load = lambda name: parse_module(modules["模块:" + name])
        self.ids_by_en = {k.lower(): split_ids(v) for k, v in load("Items/en/name/ids").items()}
        self.ids_by_zh = {k.lower(): split_ids(v) for k, v in load("Items/zh/name/ids").items()}
        # id/name 模块的键全部小写，name/ids 模块保留了原始大小写，用后者还原规范 ID
        # MediaWiki 模块中的键有时把下划线转成空格；名称→ID 表保留真实注册 ID。
        id_key = lambda value: value.lower().replace(" ", "_")
        canon = {id_key(qid): qid for ids in (*self.ids_by_en.values(), *self.ids_by_zh.values()) for qid in ids}
        restore = lambda raw: canon.get(id_key(raw), norm_qid(raw))
        self.en_by_id = {restore(k): v for k, v in load("Items/en/id/name").items()}
        self.zh_by_id = {restore(k): v for k, v in load("Items/zh/id/name").items()}
        self.desc_by_raw_id = load("Items/zh/id/desc")
        self.desc_by_zh = load("Items/zh/name/desc")
        self.override_names = {k.lower(): v for k, v in load("Items/overrides/name").items()}
        self.override_desc = {k.lower(): v for k, v in load("Items/overrides/description").items()}
        self.objects = load("Object/data")
        self._split_same_names()
        self.gifts = load("GiftsByItem/data")
        self.furniture = load("Furniture/data")
        self.weapons = load("Weapons/data")

    def _split_same_names(self):
        """棕色的蛋与白色的蛋在游戏里同名（Egg、Large Egg），只有显示名的本地化键不同（BrownEgg_Name）。
        Wiki 名称表按这个键写作“蛋|棕色蛋”：同名物品改用这个名称，按名称查物品时也能分开。"""
        for raw, obj in self.objects.items():
            qid = f"(O){raw}"
            en = self.en_by_id.get(qid) or ""
            m = re.search(r":(\w+)_Name\]", obj.get("DisplayName") or "")
            if not m or len(self.ids_by_en.get(en.lower(), [])) < 2:
                continue
            key = re.sub(r"(?<!^)(?=[A-Z])", " ", m.group(1)).lower()
            if key == en.lower() or key not in self.override_names:
                continue
            zh_old = (self.zh_by_id.get(qid) or "").lower()
            for table, name in ((self.ids_by_en, en.lower()), (self.ids_by_zh, zh_old)):
                if qid in table.get(name, []) and len(table[name]) > 1:
                    table[name] = [x for x in table[name] if x != qid]
            self.en_by_id[qid] = key.title()
            self.zh_by_id[qid] = self.override_names[key].split("|")[-1]
            self.ids_by_en[key] = [qid]
            self.ids_by_zh[self.zh_by_id[qid].lower()] = [qid]

    # —— 名称解析 ——
    def ids_for(self, name):
        key = name.strip().lower().replace("_", " ")
        return self.ids_by_en.get(key) or self.ids_by_zh.get(key) or []

    def resolve(self, name):
        """英文名 / 中文名 → {'id','en','zh'}；无法识别时 id 为 None。"""
        if not name:
            return None
        ids = self.ids_for(name)
        qid = ids[0] if ids else None
        en = self.en_by_id.get(qid) if qid else None
        zh = self.zh_by_id.get(qid) if qid else None
        override = self.override_names.get(name.strip().lower())
        if override:
            zh = override.split("|")[-1]
        if not qid and not override:
            return {"id": None, "en": name.strip() if name.isascii() else None, "zh": None if name.isascii() else name.strip()}
        return {"id": qid, "en": en or (name.strip() if name.isascii() else None), "zh": zh or (None if name.isascii() else name.strip())}

    def zh_name(self, name):
        hit = self.resolve(name)
        return (hit and hit["zh"]) or name

    def description(self, qid):
        zh = self.zh_by_id.get(qid)
        raw = qid.split(")", 1)[1] if qid.startswith("(") else qid
        en = (self.en_by_id.get(qid) or "").lower()
        return (self.override_desc.get(en) or self.override_desc.get(raw)
                or (qid.startswith("(O)") and self.desc_by_raw_id.get(raw))
                or (zh and self.desc_by_zh.get(zh)) or None)

    # —— 物品清单 ——
    def items(self):
        out = []
        for qid, en in self.en_by_id.items():
            prefix = qid[1:qid.index(")")]
            raw = qid[qid.index(")") + 1:]
            record = {
                "id": qid,
                "type": prefix,
                "type_name": ITEM_TYPES.get(prefix, prefix),
                "en": en,
                "zh": self.zh_by_id.get(qid) or en,
                "desc": self.description(qid),
                "flavor_of": None,
            }
            if "/" in raw:
                base, flavor = raw.split("/", 1)
                record["flavor_of"] = f"({prefix}){flavor}"
                record["made_by"] = f"({prefix}){base}"
            obj = self.objects.get(raw) if prefix == "O" else None
            if obj:
                record.update({
                    "category": obj.get("Category"),
                    "category_name": OBJECT_CATEGORIES.get(obj.get("Category"), str(obj.get("Category"))),
                    "obj_type": obj.get("Type"),
                    "price": obj.get("Price"),
                    "edibility": obj.get("Edibility"),
                    "is_drink": obj.get("IsDrink") or False,
                    "context_tags": obj.get("ContextTags") or [],
                    "buffs": obj.get("Buffs"),
                    "geode_drops": obj.get("GeodeDrops"),
                    "artifact_spot_chances": obj.get("ArtifactSpotChances"),
                    "can_be_gift": obj.get("CanBeGivenAsGift"),
                })
            if prefix == "W" and raw in self.weapons:
                record["weapon"] = self.weapons[raw]
            if prefix == "F" and raw in self.furniture:
                fields = self.furniture[raw].split("/")
                record["furniture"] = {"kind": fields[1] if len(fields) > 1 else None,
                                       "price": _int(fields[5]) if len(fields) > 5 else None}
            gifts = self.gifts.get(raw) if prefix == "O" else None
            if gifts:
                record["gift_tastes"] = {k.lower(): v for k, v in gifts.items() if v}
            out.append(record)
        return out


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
