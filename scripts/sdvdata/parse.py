"""把条目字段解析成结构化值：物品列表、季节、时间段、天气、价格和解锁条件。"""

import re

from . import wikitext as wt

SEASONS = {
    "spring": "spring", "1": "spring", "01": "spring", "春季": "spring", "春": "spring",
    "summer": "summer", "2": "summer", "02": "summer", "夏季": "summer", "夏": "summer",
    "fall": "fall", "autumn": "fall", "3": "fall", "03": "fall", "秋季": "fall", "秋": "fall",
    "winter": "winter", "4": "winter", "04": "winter", "冬季": "winter", "冬": "winter",
    "all": "all", "any": "all", "5": "all", "所有季节": "all", "任意季节": "all", "一年四季": "all", "季节": "all",
    "所有": "all", "全部": "all", "四季": "all", "全年": "all", "all seasons": "all", "every season": "all",
}
SEASON_ZH = {"spring": "春季", "summer": "夏季", "fall": "秋季", "winter": "冬季", "all": "任意季节"}
WEATHER = {
    "any": "any", "all": "any", "任何": "any", "任意": "any", "both": "any",
    "sun": "sun", "sunny": "sun", "晴天": "sun", "晴": "sun",
    "rain": "rain", "雨": "rain", "雨天": "rain",
    "storm": "storm", "暴风雨": "storm", "风暴": "storm",
    "snow": "snow", "下雪": "snow", "雪天": "snow",
    "springwind": "wind", "fallwind": "wind",
}
WEATHER_ZH = {"any": "任意天气", "sun": "晴天", "rain": "雨天", "storm": "暴风雨", "snow": "下雪", "wind": "刮风"}
SKILLS = {"耕种": "farming", "采矿": "mining", "采集": "foraging", "钓鱼": "fishing", "战斗": "combat"}
CURRENCIES = {"walnut": "金色核桃", "qi": "齐币", "gem": "齐钻", "token": "奖券", "calico": "卡利科蛋", "jopk": "JOPK 币"}


def item_refs(text, catalog):
    """{{name|X|数量|link=…}} → [{'id','en','zh','qty','note','link'}]，按出现顺序。"""
    out = []
    for name, args, _ in _ordered_templates(text, {"name"}):
        raw_name = args.get("1", "").strip()
        if not raw_name:
            continue
        hit = catalog.resolve(raw_name) or {}
        extra = args.get("2", "").strip()
        qty = None
        note = None
        if re.fullmatch(r"\d+", extra):
            qty = int(extra)
        elif re.fullmatch(r"(\d+)\s*[-~–]\s*(\d+)", extra):
            lo, hi = re.fullmatch(r"(\d+)\s*[-~–]\s*(\d+)", extra).groups()
            qty = int(lo)
            note = f"{lo}-{hi}"
        elif extra:
            note = extra
        link = args.get("link")
        if link:
            link = link.replace("{{!}}", "|").split("|")[0].strip()
        zh = hit.get("zh") or (args.get("alt") or "").strip() or None
        if not zh and link:
            zh = link.split("#")[0]
        out.append({"id": hit.get("id"), "en": hit.get("en") or (raw_name if raw_name.isascii() else None),
                    "zh": zh or raw_name, "qty": qty, "note": note, "link": link})
    return out


def _ordered_templates(text, names):
    """按文本顺序遍历（含嵌套的）指定模板。"""
    found = []
    stack = [(text, 0)]
    while stack:
        chunk, offset = stack.pop()
        for raw, start, end in wt.iter_templates(chunk):
            name, args = wt.parse_template(raw)
            if name.lower() in names:
                found.append((offset + start, name, args, raw))
            inner = raw[2:-2]
            if "{{" in inner:
                stack.append((inner, offset + start + 2))
    found.sort(key=lambda x: x[0])
    return [(n, a, r) for _, n, a, r in found]


def seasons(text):
    """返回出现过的季节代码（去重保序）。"""
    out = []
    for _, args, _ in _ordered_templates(text, {"season"}):
        code = SEASONS.get(args.get("1", "").strip().lower().strip("[]"))
        if code and code not in out:
            out.append(code)
    plain = re.sub(r"\{\{.*?\}\}", "", text)
    for word, code in (("春季", "spring"), ("夏季", "summer"), ("秋季", "fall"), ("冬季", "winter"),
                       ("所有季节", "all"), ("任意季节", "all"), ("一年四季", "all")):
        if word in plain and code not in out:
            out.append(code)
    if not out:
        for token in re.split(r"[\s•,，、/]+", plain.strip()):
            code = SEASONS.get(token.lower())
            if code and code not in out:
                out.append(code)
    return out


def season_day(text):
    """{{Season|Spring|14}} → ('spring', 14)。"""
    for _, args, _ in _ordered_templates(text, {"season"}):
        code = SEASONS.get(args.get("1", "").strip().lower())
        day = args.get("2", "").strip()
        if code and day.isdigit():
            return code, int(day)
    return None


_CLOCK = r"(上午|早上|中午|下午|晚上|凌晨|午夜)?\s*(\d{1,2})(?:[:：](\d{2})|点(?:(\d{1,2})分)?)"
_TIME_RE = re.compile(_CLOCK + r"\s*(?:至|到|-|–|~|—)\s*" + _CLOCK)


def _to_24(period, hour, minute, is_end=False):
    hour = int(hour)
    minute = int(minute)
    if period in ("下午", "晚上") and hour < 12:
        hour += 12
    elif period == "中午" and hour < 12:
        hour += 12 if hour < 6 else 0
    elif period in ("凌晨", "午夜"):
        hour = hour + 24 if hour < 12 else 24 if hour == 12 else hour
        if hour == 36:
            hour = 24
    elif period in ("上午", "早上") and hour == 12:
        hour = 12
    return hour * 100 + minute


def time_ranges(text):
    """把“上午6:00至晚上7:00”之类转成 [[600, 1900]]；“任何/任意时间/随时/全天”记为 [[600, 2600]]。"""
    plain = text
    ranges = []
    for m in _TIME_RE.finditer(plain):
        p1, h1, m1a, m1b, p2, h2, m2a, m2b = m.groups()
        m1 = m1a or m1b or "0"
        m2 = m2a or m2b or "0"
        if p1 is None and p2 is None:
            # 24 小时制，例如 17:00-02:00
            start = int(h1) * 100 + int(m1)
            end = int(h2) * 100 + int(m2)
            if start < 600:
                start += 2400
        else:
            start = _to_24(p1, h1, m1)
            end = _to_24(p2 or p1, h2, m2)
            if end <= start and p2 is None:
                end = _to_24("凌晨", h2, m2)
        if end <= start:
            end += 2400
        ranges.append([start, end])
    if not ranges and re.search(r"任何|任意|随时|全天", plain):
        ranges.append([600, 2600])
    return ranges


def weather(text):
    out = []
    for _, args, _ in _ordered_templates(text, {"weather inline"}):
        code = WEATHER.get(args.get("1", "").strip().lower())
        if code and code not in out:
            out.append(code)
    plain = re.sub(r"\{\{.*?\}\}", "", text).strip().lower()
    for key, code in WEATHER.items():
        if key and (plain == key or (not key.isascii() and key in plain)) and code not in out:
            out.append(code)
    return out


def price(text):
    """取第一个 {{price|N[|单位]}} 或纯数字；返回 (数值, 货币)。"""
    for _, args, _ in _ordered_templates(text, {"price", "tprice"}):
        value = args.get("1", "").replace(",", "").strip()
        try:
            amount = int(float(value))
        except ValueError:
            continue
        unit = CURRENCIES.get(args.get("2", "").strip().lower(), "金")
        return amount, unit
    match = re.search(r"(?<![\d.])(\d[\d,]*)(?![\d.])", re.sub(r"\[\[.*?\]\]|\{\{.*?\}\}", "", text))
    if match:
        return int(match.group(1).replace(",", "")), "金"
    return None, None


def days(text):
    match = re.search(r"(\d+)\s*天", text)
    return int(match.group(1)) if match else None


def unlock_conditions(plain):
    """从渲染后的“配方来源/解锁条件”文本中识别条件，返回 [{group, …, text}]。

    识别不了的部分整体保留为 group='other'，不做猜测。
    """
    conds = []
    text = re.sub(r"[\u200b-\u200f\u2060\ufeff]", "", plain).strip()
    if not text:
        return conds
    for m in re.finditer(r"(耕种|采矿|采集|钓鱼|战斗)\s*(?:技能)?\s*(?:等级|Lv\.?)?\s*[（(]?\s*(?:等级)?\s*(\d{1,2})\s*级?", text):
        conds.append({"group": "skill", "skill": SKILLS[m.group(1)], "skill_zh": m.group(1),
                      "level": int(m.group(2)), "text": f"{m.group(1)} {int(m.group(2))} 级"})
    for m in re.finditer(r"([一-龥A-Za-z.·]{1,8}?)\s*[（(]?\s*(\d{1,2})\s*(?:颗)?心(事件)?", text):
        npc = m.group(1).strip("（(")
        conds.append({"group": "friendship", "npc_zh": npc, "hearts": int(m.group(2)),
                      "event": bool(m.group(3)), "text": f"{npc} {int(m.group(2))} 心{'事件' if m.group(3) else ''}"})
    for m in re.finditer(r"([一-龥]{1,6})\s*[（(]\s*(\d{1,2})\s*\+?\s*❤\s*[）)]", text):
        conds.append({"group": "friendship", "npc_zh": m.group(1), "hearts": int(m.group(2)), "event": False,
                      "text": f"{m.group(1)} {int(m.group(2))} 心"})
    for m in re.finditer(r"([一-龥]{1,6})[（(]\s*(?:邮件|信件)\s*[-–]\s*(\d{1,2})\s*\+?\s*❤?", text):
        conds.append({"group": "friendship", "npc_zh": m.group(1), "hearts": int(m.group(2)), "event": False,
                      "mail": True, "text": f"{m.group(1)} {int(m.group(2))} 心来信"})
    m = re.search(r"烹饪频道[（(]([^）)]*)[）)]", text)
    if m:
        conds.append({"group": "tv", "text": f"烹饪频道 {m.group(1)}"})
    if "精通" in text:
        m = re.search(r"(耕种|采矿|采集|钓鱼|战斗)精通", text)
        conds.append({"group": "mastery", "skill": SKILLS.get(m.group(1)) if m else None,
                      "text": m.group(0) if m else "精通"})
    if re.search(r"特别任务|任务", text):
        m = re.search(r"([一-龥]{1,6}?)\s*[（(]?\s*特别任务", text)
        conds.append({"group": "quest", "npc_zh": m.group(1) if m else None, "text": text})
    m = re.search(r"([一-龥]{2,6})\s*[×x]\s*(\d+)", text)
    if m and re.search(r"购买|出售|消耗|花费", text):
        conds.append({"group": "purchase", "amount": int(m.group(2)), "currency": m.group(1), "text": text})
    if re.search(r"博物馆|升级|全套收集|集齐", text) and not conds:
        conds.append({"group": "world", "text": text})
    if re.search(r"初始|起始|开局|默认", text):
        conds.append({"group": "initial", "text": "初始拥有"})
    m = re.search(r"(\d[\d,]*)\s*(金|金色核桃|齐钻|齐币|奖券)", text)
    if m:
        conds.append({"group": "purchase", "amount": int(m.group(1).replace(",", "")), "currency": m.group(2),
                      "text": text})
    if not conds:
        conds.append({"group": "other", "text": text})
    return conds
