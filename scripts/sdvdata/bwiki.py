"""把星露谷物语 BWIKI 的写法换成构建脚本原本按官方中文 Wiki 解析的形式。

中文编辑团队 2024 年 10 月起在 BWIKI 编辑，那里做过一次大翻新：
- 通用信息框按物品类型拆成了“制作品、工匠物品、蔬菜、资源……”，帽子信息框改名，果树并进树木信息框；
- 英文条目名写在 {{EN|…}} 模板里，不再写跨语言链接；
- 季节、天气、时间常写成英文关键词（all、rainy、any），由信息框模板显示成中文；
- 古物、矿物的来源字段换了名字，熔炉加工只写矿石名，由模板补上数量和设备。
读入页面时在这里统一换回原来的写法，后面的解析只认一套。规则照 BWIKI 相应模板的写法（2026-10-29 抓取）。
"""

import glob
import json
import os
import re

from . import wikitext as wt

# 按物品类型拆开的信息框 → 原来的通用信息框（类型另记在 bwtype 字段里）。
GENERIC = {
    "infobox craft", "infobox item", "infobox artisan", "infobox fruit", "infobox vegetable", "infobox flower",
    "infobox special item", "infobox book", "infobox resource", "infobox forage", "infobox ground feature",
    "infobox animal prod",
}
RENAMED = {"infobox hat": "Infobox mousehat"}
# Template:Season、Template:Weather inline 认的关键词；值只由这些词组成时按模板显示。
SEASON_WORDS = {"spring", "summer", "fall", "autumn", "winter", "all", "any", "1", "2", "3", "4", "5"}
WEATHER_WORDS = {"all", "any", "both", "sun", "sunny", "rain", "rainy", "storm", "snow", "springwind", "fallwind", "festival"}
ANY_TIME = {"随时", "任意时间", "任何", "任意", "any"}
# Template:Infobox artifact / Infobox mineral 的字段 → 原来的字段（远古斑点、怪物掉落、其他来源、捐赠奖励）。
ARTIFACT_FIELDS = {"spot": "as", "monster": "md", "othersource": "os", "reward": "dr"}
# Template:Infobox mineral 的“晶球”一行。
GEODES = {
    "common": "{{Name|Geode|3.13%|class=inline}}<br/>{{Name|Omni Geode|1.13%|class=inline}}",
    "frozen": "{{Name|Frozen Geode|3.33%|class=inline}}<br/>{{Name|Omni Geode|1.13%|class=inline}}",
    "magma": "{{Name|Magma Geode|3.85%|class=inline}}<br/>{{Name|Omni Geode|1.13%|class=inline}}",
}
GEODES.update({"普通": GEODES["common"], "冰封": GEODES["frozen"], "岩浆": GEODES["magma"]})
_WORDS = re.compile(r"\s*(?:,|，|、|/|•|&|\band\b)\s*")


def _words(value, allowed):
    """值只由关键词组成时返回这些词（小写），否则返回 None。"""
    raw = (value or "").strip()
    if not raw or not re.fullmatch(r"[A-Za-z0-9 ,，、/•&]+", raw):
        return None
    words = [w.lower() for w in _WORDS.split(raw) if w.strip()]
    return words if words and all(w in allowed for w in words) else None


def normalize_infobox(name, fields):
    """BWIKI 信息框 → (原来的模板名, 字段)。"""
    low = name.strip().lower()
    fields = dict(fields)
    if low in GENERIC:
        fields.setdefault("bwtype", low[len("infobox "):])
        name = "Infobox"
    elif low in RENAMED:
        name = RENAMED[low]
    elif low == "infobox tree" and (fields.get("tag") or "").strip().lower() == "fruit":
        # Template:Infobox tree 的果树：树苗是“<水果> Sapling”，28 天长成，季节外在姜岛全年结果。
        fruit = (fields.get("fruit") or "").strip()
        name = "Infobox fruit tree"
        fields.setdefault("sapling", fruit + " Sapling")
        fields.setdefault("produce", fruit)
        fields.setdefault("growth", "28 天")
    season = _words(fields.get("season"), SEASON_WORDS)
    if season:
        fields["season"] = " • ".join("{{Season|%s}}" % w for w in season)
    weather = _words(fields.get("weather"), WEATHER_WORDS)
    if weather:
        fields["weather"] = " • ".join("{{Weather inline|%s}}" % w for w in weather)
    if (fields.get("time") or "").strip().lower() in ANY_TIME:
        fields["time"] = "全天"
    if low in ("infobox artifact", "infobox mineral"):
        for new, old in ARTIFACT_FIELDS.items():
            if fields.get(new, "").strip() and not fields.get(old, "").strip():
                fields[old] = fields.pop(new)
    if low == "infobox mineral":
        # 采矿（矿石节点）与晶球都是来源，接在来源后面。
        extra = [fields.get("node", "").strip(), GEODES.get((fields.get("geode") or "").strip().lower(), (fields.get("geode") or "").strip())]
        extra = [x for x in extra if x]
        if extra:
            fields["source"] = "<br/>".join([fields["source"].strip()] + extra if fields.get("source", "").strip() else extra)
    if low == "infobox resource" and fields.get("reingredients", "").strip():
        # Template:Infobox resource 的熔炼：金属锭 5 个矿石 + 1 煤炭，精炼石英用石英或火水晶加 1 煤炭。
        # 另记在 smelt 字段：ingredients 若有，是打造配方（转化：铜锭 ×2 → 铁锭），耗时字段属于熔炼。
        ore = fields["reingredients"].strip()
        if (fields.get("tag") or "").strip().lower() == "quartz":
            fields["smelt"] = "{{name|Quartz|1}}{{name|Coal|1}}或{{name|Fire Quartz|1}}{{name|Coal|1}}"
        else:
            fields["smelt"] = "{{name|%s|5}}{{name|Coal|1}}" % ore
        fields["smeltstation"] = "{{name|Furnace|link=熔炉}}"
    return name, fields


def serialize(name, fields):
    return "{{" + name + "".join(f"\n|{k} = {v.strip()}" for k, v in fields.items()) + "\n}}"


def en_title(text):
    """{{EN|英文条目名}}。"""
    for name, args, _ in wt.templates(text, {"EN"}):
        title = (args.get("1") or "").strip()
        if title:
            return title
    return None


def expand_defaults(text):
    """{{{参数|默认值}}} 换成默认值（BWIKI 用 {{{{{1|Infobox forage}}} 让别的页面换一个模板引用信息框）。"""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"\{\{\{[^{}|]*\|([^{}]*)\}\}\}", r"\1", text)
    return text


def switch_infoboxes(text):
    """“X/infobox”子页面：{{#switch:{{{1|}}}|分支名={{Infobox …}}…}}，按出现顺序返回 [(分支名, 模板名, 字段)]。
    分支写成 {{{{{2|}}} 的（农舍第二次升级）沿用前一个分支的模板名。"""
    text = expand_defaults(re.sub(r"</?includeonly>", "", text))
    out, last = [], "Infobox"
    for raw, start, end in wt.iter_templates(text):
        if not raw[2:].lstrip().lower().startswith("#switch"):
            continue
        body = raw[2:-2]
        prev_end = 0
        for inner, i_start, i_end in wt.iter_templates(body):
            label = re.search(r"\|\s*([^|=]+?)\s*=\s*$", body[prev_end:i_start])
            prev_end = i_end
            name, fields = wt.parse_template(inner)
            name = name.strip() or last
            if not name.lower().startswith("infobox") or not label:
                continue
            last = name
            out.append((label.group(1).strip(), name, fields))
    return out


def transcluded_infobox(text, title, get_text):
    """条目本身没有信息框、而是按标签页引用“X/infobox”子页面（蝙蝠的各个变种、畜棚的各级）时，
    取与条目同名的分支，没有就取第一个；返回 (模板名, 字段, 其他分支名) 或 None。"""
    calls = re.findall(r"\{\{:([^|{}]+/infobox)\s*(?:\|\s*([^|{}]*?)\s*)?\}\}", text)
    if not calls:
        return None
    sub = get_text(calls[0][0].strip())
    branches = switch_infoboxes(sub) if sub else []
    if not branches:
        return None
    chosen = next((b for b in branches if b[0] == title), None) or next((b for b in branches if b[0] == calls[0][1]), branches[0])
    others = [b[0] for b in branches if b is not chosen]
    return chosen[1], chosen[2], others


# 不当作条目收录的页面：BWIKI 的工具、站务页，信息框子页面，以及只引用别的条目信息框的口味产品页
# （“杏子果酒”= {{:杏子|Artisan/Wine}}，原来就按产品系列条目“果酒”显示）。
META_PAGES = {"星露谷物语百科", "星露谷物语百科App", "创建新页面", "星露谷物语维基/传统"}
# 网页小工具（存档检查、作物利润、规划器……）只在 BWIKI 上能用，不是资料条目。
TOOL_PAGES = {"信件生成", "农场规划器", "作物利润计算", "存档进度检查", "存档事件预测", "火山地牢预测", "物品编号查询",
              "星露谷展览会/计分小助手"}
TOOL_MARKERS = ("ww-tool-links", "{{#Widget:")


def skip_page(title, text, parent_text=None):
    """parent_text：子页面（“矿井/矿石分布”）所属条目的原文；子页面已被所属条目整页引用的，不重复收录。"""
    if title in META_PAGES or title in TOOL_PAGES or re.search(r"/(?:infobox|模板|旧版|许可说明)$", title):
        return True
    if "/" in title and title.isascii():  # “Combat/Skill”等模板数据页
        return True
    if parent_text and "/" in title and re.search(r"\{\{\s*(?::%s|/%s)\s*[|}]" % (re.escape(title), re.escape(title.rsplit("/", 1)[1])), parent_text):
        return True
    if re.fullmatch(r"\s*\{\{:[^{}]+\}\}\s*", text):
        return True
    body = re.sub(r"<!--.*?-->|__[A-Z]+__", "", text, flags=re.S).strip()
    return any(marker in body[:400] for marker in TOOL_MARKERS)


def normalize_page(text, title=None, get_text=None):
    """条目原文：信息框换成原来的写法（引用子页面信息框的，补在条目开头）；{{EN|…}} 补成跨语言链接 [[en:…]]。"""
    if get_text and not wt.first_template(text, "Infobox"):
        found = transcluded_infobox(text, title, get_text)
        if found:
            name, fields, others = found
            if name.lower() == "infobox monster" and others and not fields.get("variations", "").strip():
                fields = {**fields, "variations": "<br/>".join(others)}
            text = serialize(name, fields) + "\n" + text
    info = wt.first_template(text, "Infobox")
    if info:
        name, fields, _, start, end = info
        new_name, new_fields = normalize_infobox(name, fields)
        if (new_name, new_fields) != (name, fields):
            text = text[:start] + serialize(new_name, new_fields) + text[end:]
    en = en_title(text)
    if en and not wt.interlanguage(text).get("en"):
        text += f"\n[[en:{en}]]"
    return text


def version_page(version):
    """模块:Templates 的 getVerP：版本号 → 所在的版本历史页面（1.0x 都在 1.0，1.11 在 1.1）。"""
    version = (version or "").strip()
    if re.fullmatch(r"1\.0\d?[a-z]?|1\.0", version):
        return "版本历史/1.0"
    if version == "1.11":
        return "版本历史/1.1"
    m = re.match(r"(\d+)\.(\d+)", version)
    return f"版本历史/{m.group(1)}.{m.group(2)}" if m else "版本历史"


def raw_dir(root):
    """最近一次抓取的 BWIKI 归档目录（data/raw/bwiki-<日期>）。"""
    dirs = sorted(glob.glob(os.path.join(root, "data", "raw", "bwiki-*")))
    return dirs[-1] if dirs else None


def load_html(root):
    """{条目名: 渲染后的 HTML}：html.jsonl（fetch_bwiki.py --html）及补抓的 html-extra.jsonl，后读到的覆盖先读到的。"""
    out = {}
    base = raw_dir(root)
    for name in ("html.jsonl", "html-extra.jsonl"):
        path = os.path.join(base, name) if base else None
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    rec = json.loads(line)
                    out[rec["title"]] = rec["html"]
    return out


# —— 按原文转换条目正文（还没有渲染结果的条目）时，先把常用的模块类模板换成等价的原文 ——
# 规则照 BWIKI 的 模块:Snippets、Template:BundleReq、Template:Crafts / CraftRow、模块:Schedule 的写法。
NOT_USED_ALIAS = {"b": "收集包", "r": "食谱", "c": "配方", "q": "任务", "t": "裁制", "裁缝": "裁制"}
SCHEDULE_EXCEPTION = {"谢恩": "", "哈维": "工作日或", "潘妮": "工作日、体检日或", "玛鲁": "工作日、体检日或",
                      "艾米丽": "秋季 15 日（桑迪的生日）、体检日或"}


def _lua_string(raw):
    body = raw[1:-1]
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), body)


def snippet_table(module_text):
    """模块:Snippets 的 categories 表 → {类别: {子类型: 文本} 或 文本}。"""
    start = module_text.find("local categories = {")
    end = module_text.find("\n}", start)  # 表在行首的“}”处结束
    body = module_text[start:end if end > 0 else None]
    out = {}
    for m in re.finditer(r"\['([^']+)'\]\s*=\s*(\{.*?\n\s*\}|'(?:[^'\\]|\\.)*')", body, re.S):
        name, value = m.group(1), m.group(2)
        if value.startswith("'"):
            out[name] = _lua_string(value)
        else:
            out[name] = {k.group(1): _lua_string(k.group(2)) for k in re.finditer(r"\['([^']+)'\]\s*=\s*('(?:[^'\\]|\\.)*')", value)}
    return out


def _snippet(table, args, title):
    category = (args.get("1") or "").strip()
    entry = table.get(category)
    if entry is None:
        return ""
    actor = (args.get("actor") or args.get("villager") or title or "").strip()
    if isinstance(entry, str):
        text, start = entry, 2
    else:
        sub = (args.get("2") or "").strip()
        if category == "不用于":
            sub = NOT_USED_ALIAS.get(sub.lower(), sub)
        text, start = entry.get(sub), 3
        if text is None:
            return ""
    param = lambda i: (args.get(f"param{i}") or args.get(str(i)) or "").strip()
    text = text.replace("{villager}", actor).replace("{{PAGENAME}}", title or "")
    for k in range(6):
        text = text.replace("{param%d}" % (k + 1), param(start + k))
    if category == "日程" and (args.get("2") or "").strip() == "度假村":
        text = text.replace("{schedule_exception}", SCHEDULE_EXCEPTION.get(actor, "体检日或"))
    return text


def _craft_row(fields):
    name = (fields.get("name") or "").strip()
    produces = (fields.get("produces") or "").strip()
    label = (fields.get("displayname") or "").strip() or f"[[{name}]]"
    if re.fullmatch(r"\d+", produces) and produces != "1":
        label += f"（{produces}）"
    cells = [f"[[File:{(fields.get('eng') or '').strip()}.png|center|link=]]", label,
             fields.get("description") or "{{Description|%s}}" % name, fields.get("recipe") or "", fields.get("ingredients") or ""]
    return "\n|-\n" + "\n".join("|" + c.replace("\n", " ") for c in cells) + "\n"


def expand_article_templates(text, title, snippets, gifts=None, get_text=None):
    """snippets：snippet_table() 的结果；gifts(条目名) → {love/like/neutral/dislike/hate: [英文居民名]}；
    get_text(条目名) → 原文（取被引用条目的信息框）。"""
    out, last = [], 0
    for raw, start, end in wt.iter_templates(text):
        name, args = wt.parse_template(raw)
        key = name.strip()
        low = key.lower()
        new = None
        if low == "snippets":
            new = _snippet(snippets, args, title)
        elif low == "不用于":
            new = _snippet(snippets, {"1": "不用于", "2": args.get("1", "")}, title)
        elif low == "bundlereq":
            qty, mw = (args.get("2") or "").strip(), (args.get("mw") or "个").strip()
            quality = "金星品质的" if "quality" in (args.get("1") or "").lower() else (args.get("quality") or "")
            extra = {"c": "（作为可选项）", "r": "（作为随机项）"}.get((args.get("3") or "").strip().lower(), "")
            new = "{{Bundle|%s||y}}需要 %s %s%s%s%s" % ((args.get("1") or "").strip(), qty, mw, quality, (args.get("item") or title or "").strip(), extra)
        elif low == "giftsbyitem" and not any(k for k in args if k not in ("1",)) and gifts:
            tastes = gifts(title) or {}
            new = "{{GiftsByItem|" + "|".join(f"{k}={','.join(v)}" for k, v in tastes.items() if v) + "}}" if tastes else ""
        elif low == "crafts":
            what = (args.get("1") or "").strip().lower()
            new = "\n|}\n" if what in ("foot", "footer") else \
                "\n{| class=\"wikitable\"\n!图片!!名称!!描述!!配方来源!!所需原料\n" if what.startswith("head") else ""
        elif key.startswith(":") and re.match(r"craftrow", (args.get("1") or "").strip(), re.I) and get_text:
            info = wt.first_template(expand_defaults(get_text(key[1:].strip()) or ""), "Infobox")
            new = _craft_row(info[1]) if info else ""
        elif low == "daily":
            count = max((int(k) for k in args if k.isdigit()), default=0)
            cells = [(args.get(str(i)) or "").strip() for i in range(1, count + 1)] + [""]
            rows = [f"|{cells[i]}\n|{cells[i + 1]}" for i in range(0, count, 2) if cells[i]]
            new = "\n{| class=\"wikitable\"\n!时间!!地点\n|-\n" + "\n|-\n".join(rows) + "\n|}\n"
        if new is None:
            continue
        out.append(text[last:start])
        out.append(new)
        last = end
    out.append(text[last:])
    # 空标签的链接（[[版本历史/1.4#1.4|]]）：显示小节名，没有小节时显示最后一级页面名。
    return re.sub(r"\[\[([^\]|{}]+)\|\]\]", lambda m: "[[%s|%s]]" % (m.group(1), m.group(1).split("#")[-1].rsplit("/", 1)[-1]), "".join(out))
