"""条目正文：把中英文 Wiki 条目转成分节的段落、列表和表格，写到 prototype/articles/{zh,en}/。

详情页按需载入（fetch 单个条目的 JSON），不进 data.js。只有摘要的条目直接显示正文，
其他条目在页尾“Wiki 条目全文”里展开。英文正文只取英文 Wiki 的同名条目，没有就不显示。

用法：python3 -I scripts/build_articles.py（build_prototype.py 也会调用 build()）
"""

import hashlib
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from sdvdata import article as AR  # noqa: E402
from sdvdata.webp import WebP  # noqa: E402

OUT = os.path.join(ROOT, "prototype", "articles")
CJK = re.compile(r"[㐀-鿿]")
IMG_OUT = os.path.join(ROOT, "prototype", "assets", "img")
# Wiki 首页只是导航。
SKIP_PAGES = {"Stardew Valley Wiki"}

LABELS = {
    "zh": {
        "main": "主条目：", "see_also": "另见：", "list_sep": "、", "details": "详情", "energy": "能量", "health": "生命值",
        "none": "无", "inedible": "不可食用", "friendship": "好感度 {n}", "no_friendship": "不影响好感度",
        "crafting_source": "配方来源", "friendship_page": "友谊", "gift_list_page": "礼物列表",
        "version_page": "版本历史", "history_sep": "：",
        # Template:Recipes 的表头（hide= 里写的列不显示）。
        "recipe_cols": [("name", "名称"), ("description", "描述"), ("ingredients", "所需原料"), ("restores", "能量 / 生命值"),
                        ("buff", "增益效果"), ("duration", "增益时长"), ("recipe", "食谱来源"), ("sellprice", "售出价格")],
        "gift_levels": [("love", "最爱"), ("like", "喜欢"), ("neutral", "一般"), ("dislike", "不喜欢"), ("hate", "讨厌")],
        "fish_cols": ["鱼", "地点", "时间", "天气"], "any_time": "全天",
        "grange_cols": ["物品", "普通", "银星", "金星", "铱星"],
        # 操作说明里用图标表示的鼠标键和手柄键（文件名去掉平台前缀后按这里改写，其余照写按键名）。
        "icons": {"left-click": "左键", "right-click": "右键", "mouse middle key light": "鼠标中键", "left stick": "左摇杆",
                  "right stick": "右摇杆", "dpad": "十字键", "touch pad": "触控板", "menu": "菜单键", "view": "查看键",
                  "start": "开始键", "back": "返回键", "options": "选项键", "share": "分享键",
                  "plus": "+", "minus": "-", "square": "方块键", "cross": "叉键", "circle": "圆圈键", "triangle": "三角键"},
        "weathers": {"": "任意", "rainy": "雨天", "sunny": "晴天", "snowy": "雪天"},
    },
    "en": {
        "main": "Main article: ", "see_also": "See also: ", "list_sep": ", ", "details": "Details", "energy": "Energy",
        "health": "Health", "none": "N/A", "inedible": "Inedible", "friendship": "{n} friendship",
        "no_friendship": "No effect on friendship", "crafting_source": "Recipe Source(s)",
        "friendship_page": "Friendship", "gift_list_page": "List of All Gifts",
        "version_page": "Version History", "history_sep": ": ",
        "recipe_cols": [("name", "Name"), ("description", "Description"), ("ingredients", "Ingredients"),
                        ("restores", "Energy / Health"), ("buff", "Buff(s)"), ("duration", "Buff Duration"),
                        ("recipe", "Recipe Source(s)"), ("sellprice", "Sell Price")],
        "gift_levels": [("love", "Love"), ("like", "Like"), ("neutral", "Neutral"), ("dislike", "Dislike"), ("hate", "Hate")],
        "fish_cols": ["Fish", "Location", "Time", "Weather"], "any_time": "Any time",
        "grange_cols": ["Item", "Base", "Silver", "Gold", "Iridium"],
        "icons": {"left-click": "Left-click", "right-click": "Right-click", "mouse middle key light": "Middle-click",
                  "left stick": "Left stick", "right stick": "Right stick", "dpad": "D-pad", "touch pad": "Touch pad",
                  "plus": "+", "minus": "−"},
        "weathers": {"": "Any", "rainy": "Rain", "sunny": "Sun", "snowy": "Snow"},
    },
}


def _fruit_tree(lang):
    """果树信息框：树苗、皮埃尔的杂货店与旅行货车的树苗价格（price 为基础价）。"""
    zh = lang == "zh"

    def sapling(f):
        return (zh and "树苗" or "Sapling", "{{name|%s}}" % f["sapling"]) if f.get("sapling") else None

    def price(f):
        if (f.get("altprice") or "").strip():
            return (zh and "树苗来源" or "Sapling Source", f["altprice"])
        try:
            base = int(float((f.get("price") or "").replace(",", "")))
        except ValueError:
            return None
        return (zh and "树苗价格" or "Sapling Price",
                ("皮埃尔的杂货店 {{price|%d}}；旅行货车 {{tprice|%d}}" if zh else "Pierre's: {{price|%d}}; Traveling Cart: {{tprice|%d}}")
                % (base * 4, base))

    def produce(f):
        return (zh and "出产" or "Produce", "{{name|%s}}" % f["produce"]) if f.get("produce") else None

    def season(f):
        return (zh and "丰收季节" or "Harvest Season", "{{Season|%s}}" % f["season"]) if f.get("season") else None

    return [("sapling", sapling), ("price", price), ("produce", produce),
            ("growth", zh and "成长时间" or "Growth Time"), ("season", season)]


INFOBOX = {
    "zh": {
        "infobox building": [("cost", "建造成本"), ("materials", "建筑材料"), ("animals", "动物"), ("capacity", "容量"), ("sizehv", "尺寸")],
        "infobox tree": [("seed", "种子"), ("tapper", "树液采集器产出"), ("growth", "生长时间")],
        "infobox fruit tree": _fruit_tree("zh"),
        "infobox": [("source", "来源"), ("season", "季节"), ("growth", "生长时间"), ("seed", "种子"), ("produces", "产出"),
                    ("craftingstation", "加工设备"), ("ingredients", "原料"), ("crafttime", "加工时间"), ("sellprice", "售价")],
    },
    "en": {
        "infobox building": [("cost", "Build cost"), ("materials", "Build materials"), ("animals", "Animals"), ("capacity", "Capacity"),
                             ("sizehv", "Size")],
        "infobox tree": [("seed", "Seed"), ("tapper", "Tapper Product"), ("growth", "Growth Time")],
        "infobox fruit tree": _fruit_tree("en"),
        "infobox": [("source", "Source"), ("season", "Season"), ("growth", "Growth Time"), ("seed", "Seed"), ("produces", "Produces"),
                    ("craftingstation", "Equipment"), ("ingredients", "Ingredients"), ("crafttime", "Processing Time"),
                    ("sellprice", "Sell Price")],
    },
}


def image_index():
    """归档图片：小写、下划线写法的文件名 → {'file', 'w', 'h', 'bytes', 'path'}（两个 Wiki 的图片归档合在一起）。"""
    with open(os.path.join(ROOT, "data", "build", "images.json"), encoding="utf-8") as f:
        images = json.load(f)
    index = {name.strip().replace(" ", "_").casefold(): meta for name, meta in images.items()}
    return lambda name: index.get((name or "").strip().replace(" ", "_").casefold())


def webp_images(image, webp):
    """正文图片 → 派生的 WebP（thumb 缩略图、full 同尺寸）；GIF，或者没有 cwebp 又没有旧结果时为 None。"""
    return lambda file, kind: webp.name(image(file), kind)


def article_key(title):
    return hashlib.sha1(title.encode("utf-8")).hexdigest()[:10]


def zh_articles(image, derive):
    import build_data as BD
    b = BD.Builder()
    pages, _ = b.build_pages()
    titles = {p["title"] for p in pages}

    def link_key(target):
        t = target.split("#")[0].strip()
        if not t:
            return None
        t = b.resolve(BD.norm_title(t))
        return t if t in titles else None

    handlers = dict(BD.make_renderer(b.catalog, b.npc_zh, b.bundle_zh).handlers)
    icons = _icons("zh")
    render = _rich_render(handlers, b.catalog, link_key, image, derive, lambda en: b.npc_zh.get(en, en),
                          lambda raw: b.catalog.zh_name(raw),
                          pre=lambda t: icons(re.sub(r"\[\[(?:File|文件):HeartIcon[^\]]*\]\]", "❤", t or "")))

    def get_page(title):
        r = b.zh.get(b.resolve(BD.norm_title(title)))
        return r["text"] if r else None

    builder = AR.ArticleBuilder("zh", get_page, render, LABELS["zh"], link_key, None, INFOBOX["zh"], image, derive)
    out = {}
    for p in pages:
        if p["title"] in SKIP_PAGES:
            continue
        article = builder.build(p["title"], get_page(p["title"]))
        if article:
            out[p["title"]] = article
    # 整页重定向的中文名（“体力”→“能量”）；英文名另有对照，不算在内。
    synonyms = _synonyms((BD.norm_title(r["title"]), b.resolve(BD.norm_title(r["redirect"])))
                         for r in b.zh_all if r["ns"] == 0 and r["redirect"] and not r.get("redirect_fragment"))
    synonyms = {t: [n for n in names if CJK.search(n)] for t, names in synonyms.items() if t in out}
    return out, builder.used_images | render.used_images, render.dropped_images, synonyms


def en_articles(image, derive):
    import build_en as EN
    e = EN.English()
    with open(os.path.join(ROOT, "data", "build", "pages.json"), encoding="utf-8") as f:
        zh_pages = json.load(f)
    titles = {p["title"] for p in zh_pages}

    def resolve(title):
        title = EN.norm_title(title)
        for _ in range(4):
            title = e.redirects.get(title, title)
        return title

    def link_key(target):
        t = target.split("#")[0].strip()
        if not t:
            return None
        zh = e.title_zh.get(resolve(t))
        return zh if zh in titles else None

    def label_only(text):
        return (text or "").replace(EN.OPEN, "").replace(EN.CLOSE, "")

    handlers = dict(e.handlers)
    icons = _icons("en")
    render = _rich_render(handlers, e.catalog, link_key, image, derive, lambda en: en, lambda raw: raw, clean=label_only, paren=" ({})",
                          pre=lambda t: icons(re.sub(r"</?p\b[^>]*>", "\n", re.sub(r"\[\[(?:File|Image):HeartIcon[^\]]*\]\]", "❤", t or ""))))

    def get_page(title):
        row = e.en.get(resolve(title))
        return row["text"] if row and not row["redirect"] else None

    p_en = {p["title"]: p.get("en") for p in zh_pages}
    builder = AR.ArticleBuilder("en", get_page, render, LABELS["en"], link_key, None, INFOBOX["en"], image, derive)
    out = {}
    for p in zh_pages:
        if not p.get("en") or p["title"] in SKIP_PAGES:
            continue
        text = get_page(p["en"])
        if not text:
            continue
        article = builder.build(p["en"], text)
        if article:
            out[p["title"]] = article
    # 整页重定向的英文名（“Exhaustion”→“Energy”、英式拼写“Travelling Cart”）。
    synonyms = _synonyms((EN.norm_title(r["title"]), e.title_zh.get(resolve(r["redirect"])))
                         for r in e.en.values() if r["ns"] == 0 and r["redirect"] and not r.get("redirect_fragment"))
    synonyms = {t: [n for n in names if not CJK.search(n) and n.casefold() != (p_en.get(t) or "").casefold()]
                for t, names in synonyms.items() if t in out}
    return out, builder.used_images | render.used_images, render.dropped_images, synonyms


def _synonyms(pairs):
    """(重定向名, 条目) → {条目: [重定向名, …]}：正文搜索时提示 Wiki 的写法。只取不指向某一节的整页重定向，
    指向小节的（“能量滋补水”→ 哈维的诊所的医疗用品）是条目里的一部分，不是别名。"""
    out = defaultdict(set)
    for name, title in pairs:
        if title and name.casefold() != title.casefold():
            out[title].add(name)
    return {title: sorted(names) for title, names in out.items()}


def _icons(lang):
    icons = LABELS[lang]["icons"]

    def replace(m):
        name = re.sub(r"\.(png|gif|jpg)$", "", m.group(1).strip().replace("_", " "), flags=re.I)
        button = re.fullmatch(r"(?:360|PS4|Switch|XboxOne) (.+)", name, flags=re.I)
        if button:
            key = button.group(1)
            label = icons.get(key.lower(), key) if key.lower() not in ("logo",) else ""
        else:
            label = icons.get(name.lower(), m.group(0))
        # 图标后面紧跟着同样的文字（“[[File:360 A.png]]A”“[[File:360 Left Stick.png]]<br />左摇杆”）时不再重复。
        rest = re.sub(r"^\s*(?:<br\s*/?>\s*)?", "", m.string[m.end():m.end() + 40], flags=re.I)
        return "" if label and label != m.group(0) and rest.startswith(label) else label
    return lambda text: re.sub(r"\[\[(?:File|文件|Image):([^|\]]+)[^\]]*\]\]", replace, text or "")


def _rich_render(handlers, catalog, link_key, image, derive, npc_page, page_name, clean=lambda s: s, pre=lambda s: s, paren="（{}）"):
    """行内渲染：在纯文本渲染的基础上，物品名保留物品 ID（显示图标），居民与条目名保留站内链接。"""
    name0, npc0 = handlers["name"], handlers["npc"]

    def flat(label):
        # 标签里还有模板或链接时先渲染成纯文字，避免链接标记套着物品标记。
        return AR.strip_marks(clean(renderer.render(label))) if "{{" in label or "[[" in label else clean(label)

    def name(a):
        label = flat(name0(a))
        raw = a.get("1", "").strip()
        hit = catalog.resolve(raw) if raw else None
        if hit and hit.get("id"):
            return AR.item_mark(hit["id"], label)
        target = (a.get("link") or "").replace("{{!}}", "|").split("|")[0].strip() or page_name(raw)
        key = link_key(target) if target else None
        return AR.link_mark(key, label) if key else label

    def npc(a):
        # 只把名字做成链接；括号里的说明（“[[任务|特别任务]]”）照常渲染，可能自带链接。
        who = a.get("1", "").strip()
        label = flat(npc0({"1": who}))
        key = link_key(npc_page(who))
        head = AR.link_mark(key, label) if key else label
        extra = a.get("2", "").strip()
        return head + paren.format(extra) if extra else head

    handlers.update(name=name, npc=npc)
    renderer = AR.LinkRenderer(handlers, link_key, image, derive)
    render = lambda text: clean(renderer.render(pre(text)))
    render.used_images = renderer.used_images
    render.dropped_images = renderer.dropped_images
    return render


def _text(node):
    """片段、单元格或块 → 纯文字（图片不算）。"""
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        return _text(node.get("v") or []) + " ".join(_block_text(b) for b in node.get("b") or [])
    if node and node[0] in ("i", "l") and len(node) == 3 and isinstance(node[1], str):
        return node[2]
    if node and node[0] == "f" and len(node) == 3:
        return ""
    return "".join(_text(x) for x in node)


def _block_text(block):
    kind = block[0]
    if kind == "l":
        return "\n".join(_text(parts) for _, parts in block[2])
    if kind == "t":
        return "\n".join(" · ".join(t for t in (_text(c).strip() for c in row) if t) for row in block[1])
    if kind == "d":
        return block[1] + "\n" + "\n".join(_block_text(b) for b in block[2])
    if kind == "q":
        return _text(block[1])
    if kind == "g":
        return " ".join(_text(entry[2]) for entry in block[1])
    return _text(block[1])


def search_corpus(articles, synonyms):
    """全文搜索用的纯文本：[[条目, [[小节标题, 文字], …], 别名?], …]，搜索时才下载。
    别名是 Wiki 里整页重定向到这个条目的名称，搜索时提示 Wiki 的写法。"""
    out = []
    for title, article in articles.items():
        sections = []
        for heading, _, blocks in article["s"]:
            text = re.sub(r"[ \t]+", " ", "\n".join(t for t in (_block_text(b).strip() for b in blocks) if t))
            if text.strip():
                sections.append([heading or "", text])
        if sections:
            out.append([title, sections, synonyms[title]] if synonyms.get(title) else [title, sections])
    return out


def write(lang, articles, synonyms):
    """每个条目一个 JSON（文件名取中文条目名的散列），删掉不再生成的旧文件；返回 {条目: 文件名}。"""
    folder = os.path.join(OUT, lang)
    os.makedirs(folder, exist_ok=True)
    index, keep = {}, set()
    for title, article in articles.items():
        key = article_key(title)
        index[title] = key
        keep.add(key + ".json")
        path = os.path.join(folder, key + ".json")
        payload = json.dumps(article, ensure_ascii=False, separators=(",", ":"))
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                if f.read() == payload:
                    continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(payload)
    keep.add("search.json")
    with open(os.path.join(folder, "search.json"), "w", encoding="utf-8") as f:
        json.dump(search_corpus(articles, synonyms), f, ensure_ascii=False, separators=(",", ":"))
    for name in os.listdir(folder):
        if name.endswith(".json") and name not in keep:
            os.remove(os.path.join(folder, name))
    return index


def headings(articles):
    """正文的标题和信息框字段名用像素字体显示，交给字体子集。"""
    out = []
    for article in articles.values():
        out.extend(label for label, _ in article.get("f", []))
        out.extend(h for h, _, _ in article["s"] if h)
        stack = [b for _, _, blocks in article["s"] for b in blocks]
        while stack:
            block = stack.pop()
            if block[0] == "d":
                out.append(block[1])
                stack.extend(block[2])
    return "\n".join(out)


def build(webp=None):
    """webp：build_prototype.py 传入同一个转换器（图标也用它），由它统一等编码完成；单独运行时这里自己做完。"""
    image = image_index()
    own = webp is None
    webp = webp or WebP(ROOT, IMG_OUT)
    derive = webp_images(image, webp)
    (zh, zh_images, zh_dropped, zh_synonyms), (en, en_images, en_dropped, en_synonyms) = zh_articles(image, derive), en_articles(image, derive)
    sizes = {lang: round(sum(len(json.dumps(a, ensure_ascii=False, separators=(",", ":")).encode()) for a in arts.values()) / 1e6, 2)
             for lang, arts in (("zh", zh), ("en", en))}
    index = {"zh": write("zh", zh, zh_synonyms), "en": write("en", en, en_synonyms)}
    images = sorted(zh_images | en_images)
    if own:
        webp.run(keep_others=True)
    # 行内大图做不了缩略图的（动图）不显示，这里只报告数量。
    print("条目正文：", json.dumps({"zh": len(zh), "en": len(en), "mb": sizes, "images": len(images),
                                  "inline_dropped": {"zh": len(zh_dropped), "en": len(en_dropped)}}, ensure_ascii=False))
    return index, headings(zh) + "\n" + headings(en), images


if __name__ == "__main__":
    build()
