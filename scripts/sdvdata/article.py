"""Wiki 条目正文：把 wikitext 转成分节的段落、列表和表格，详情页按需载入。

输出（JSON 友好）：
  {"f": [[字段名, 片段], …],            信息框里的字段（可选）
   "s": [[标题或 None, 层级, [块, …]], …]} 第一节是导言
块：["p", 片段] 段落 · ["n", 片段] 提示（主条目等） · ["h", 片段] 小标题（; 行）
    ["l", 有序, [[层级, 片段], …]] 列表 · ["q", 片段, 出处片段] 引文
    ["t", 行, 标题] 表格，单元格为片段或 {"h": 1, "c": 跨列, "r": 跨行, "v": 片段, "b": 块}
    ["d", 标题, [块, …]] 折叠的详情 · ["g", [[图片, 宽, 说明片段, 大图], …]] 图片组（缩略图、图集、肖像）
片段：字符串，或 ["i", 物品 ID, 文字]、["l", 条目, 文字]、["f", 图片, 显示宽度]。
条目链接可以带小节（"版本历史#1.6"），打开条目后滚到那一节。
图片按 Wiki 指定的宽度显示（行内最宽 IMAGE_LIMIT，缩略图和图集 320，单独占一行的 WIDE_LIMIT）。
边长不超过 FIGURE_LIMIT（或文件不超过 FIGURE_BYTES）的图照原尺寸发布，超过 HEAVY_BYTES 的转成同尺寸的 WebP；
更大的地图、信息图显示 WebP 缩略图，图片组里的“大图”是原尺寸的 WebP。做不了 WebP 时图片为 None，
“大图”是 Wiki 原图文件名，只给链接。

只处理星露谷 Wiki 实际用到的写法；不认识的模板不显示，不猜测内容。
"""

import html
import math
import re

from . import wikitext as wt

# 渲染结果里用控制字符包住物品与条目链接，最后再拆成片段（\x01、\x02 已被英文渲染用来连接相邻名称）。
_MARK = re.compile("\x0e([ilf])([^\x1f\x0e\x0f]*)\x1f([^\x0e\x0f]*)\x0f")
# 折叠详情、引文和图片组在展开阶段写成独立的行，块解析时识别。
_DETAILS_OPEN, _DETAILS_CLOSE, _QUOTE, _FIGURE = "\x03D", "\x03/D", "\x03Q", "\x03G"
IMAGE_LIMIT = 400   # 行内图片的显示宽度（表格里的作物阶段、建筑图、头像、品质星）
FIGURE_LIMIT = 800  # 缩略图和图集（布局图、截图）；更大的地图、信息图转成 WebP（缩略图 + 原尺寸）
FIGURE_BYTES = 200_000  # 像素画截图压缩后很小（温室布局图 914 像素只有 25 KB），不超过这个大小的也收录
WIDE_LIMIT = 720    # 单独占一行的图（手柄键位图、形象演变时间轴）按 Wiki 的尺寸显示，最宽不超过正文栏
HEAVY_BYTES = 150_000  # 超过这个大小的图（GIF 动图除外）转成同尺寸的 WebP，截图通常能小一半以上
_FILE_PREFIX = r"(?:File|文件|Image|图像)"
_FLOATING = {"thumb", "thumbnail", "frame", "framed", "frameless", "left", "right"}

# 不收录的章节：参考文献（脚注已去掉）、外部链接（只有站外网址）、导航。
SKIP_SECTIONS = {
    "参考", "参考资料", "参考文献", "外部链接", "导航",
    "references", "reference", "external links", "navigation",
}
# 只作页面装饰或导航的模板。
_DROP_TEMPLATES = re.compile(
    r"^(navbox|infobox|for$|toc|clear|stub|map$|basics-top|calendar|upcoming|version history|collections |"
    r"numberofarticles|mainlinks|css$|englishdoc|documentation|hatnote|about$|otheruses|distinguish|translate|"
    r"incomplete|cleanup|expand|update|outdated|spoiler|rewrite|seo|infoboxseo|pp-|defaultsort|displaytitle)", re.I)


def item_mark(qid, label):
    return f"\x0ei{qid}\x1f{label}\x0f"


def link_mark(key, label):
    return f"\x0el{key}\x1f{label}\x0f"


def image_mark(file, width):
    return f"\x0ef{file}\x1f{width}\x0f"


def strip_marks(text):
    return _MARK.sub(lambda m: "" if m.group(1) == "f" else m.group(3), text or "").replace("\x0e", "").replace("\x0f", "").replace("\x1f", "")


def image_options(parts):
    """[[File:名|选项…|说明]] → (显示宽度或 None, 是否浮动缩略图, 说明原文)。"""
    width, floating, caption = None, False, ""
    for part in parts:
        opt = part.strip()
        low = opt.lower()
        m = re.fullmatch(r"(\d+)?(?:x(\d+))?px", low)
        if m and (m.group(1) or m.group(2)):
            width = int(m.group(1)) if m.group(1) else -int(m.group(2))
        elif low in _FLOATING:
            floating = True
        elif low in ("center", "centre", "none", "border", "baseline", "middle", "top", "bottom", "text-top", "text-bottom", "upright") \
                or re.match(r"(link|alt|class|page|lang)\s*=", low):
            continue
        else:
            caption = opt
    return width, floating, caption


def pick_image(image, name, width, limit=IMAGE_LIMIT, max_bytes=0, cap=IMAGE_LIMIT):
    """归档里的图片 → (文件名, 显示宽度, 是否超出 limit, 字节数)；没有这张图返回 None。width 为负数时表示指定的高度；
    显示宽度不超过 cap。"""
    meta = image(name)
    if not meta:
        return None
    w, h = meta.get("w") or 0, meta.get("h") or 0
    if width is not None and width < 0:
        width = round(w * -width / h) if h else None
    shown = min(width or w or 48, w or width or 48, cap)
    small_file = meta.get("bytes", 0) <= max_bytes and max(w, h) <= 2000
    return meta["file"], shown, max(w, h) > limit and not small_file, meta.get("bytes", 0)


def ship_image(picked, webp, inline):
    """pick_image 选出的图 → (显示用的文件, 原尺寸 WebP 或 None)；做不出缩略图时返回 None。
    webp(文件名, "thumb" 或 "full") 返回派生的 WebP 文件名，做不了时为 None。行内图不需要原尺寸。"""
    file, _, large, size = picked
    if large:
        thumb = webp(file, "thumb") if webp else None
        full = None if inline or not thumb else webp(file, "full")
        return (thumb, full) if thumb and (inline or full) else None
    if size > HEAVY_BYTES and webp:
        return webp(file, "full") or file, None
    return file, None


def runs(text):
    """渲染结果 → 片段列表；相邻的文字合并，首尾空白去掉。"""
    out, pos = [], 0
    for m in _MARK.finditer(text):
        if m.start() > pos:
            out.append(text[pos:m.start()])
        label = m.group(3).strip()
        if m.group(1) == "f":
            out.append(["f", m.group(2), int(label) if label.isdigit() else 0])
        elif label:
            out.append([m.group(1), m.group(2), label])
        pos = m.end()
    if pos < len(text):
        out.append(text[pos:])
    merged = []
    for piece in out:
        if isinstance(piece, str):
            piece = piece.replace("\x0e", "").replace("\x0f", "").replace("\x1f", "")
            if merged and isinstance(merged[-1], str):
                merged[-1] += piece
                continue
        merged.append(piece)
    if merged and isinstance(merged[0], str):
        merged[0] = merged[0].lstrip()
    if merged and isinstance(merged[-1], str):
        merged[-1] = merged[-1].rstrip()
    return [p for p in merged if p != ""]


def plain(parts):
    return "".join(p if isinstance(p, str) else ("" if p[0] == "f" else p[2]) for p in parts)


def has_image(parts):
    return any(isinstance(p, list) and p[0] == "f" for p in parts or [])


class LinkRenderer(wt.Renderer):
    """在纯文本渲染的基础上保留站内条目链接（[[目标|文字]] → 链接标记）。"""

    def __init__(self, handlers, link_key, image=None, webp=None):
        super().__init__(handlers)
        self.link_key = link_key
        self.image = image  # 文件名 → 归档图片信息；没有时行内图片不显示
        self.webp = webp    # (文件名, 种类) → 派生的 WebP，见 ship_image
        self.used_images = set()
        self.dropped_images = set()  # 做不了缩略图的大图（动图），构建时报告数量

    def render(self, text):
        # 跨行的粗体、斜体标记没有配对，渲染后会剩下单独的引号。
        return re.sub(r"'{2,}", "", super().render(text))

    def _links(self, text):
        out, last = [], 0
        while True:
            i = text.find("[[", last)
            if i < 0:
                break
            end = wt._match_close(text, i, "[[", "]]")
            out.append(text[last:i])
            raw = text[i:end]
            parts = wt.split_top(raw[2:-2])
            target = parts[0].strip()
            kind = wt.classify_link(target)
            if kind == "file" and self.image:
                # 行内图（品质星、作物阶段、表格里的建筑图）按 Wiki 指定的宽度显示，最宽 IMAGE_LIMIT；
                # 文件太大的换成 WebP 缩略图，找不到的图不显示。
                width, _, _ = image_options(parts[1:])
                picked = pick_image(self.image, target.split(":", 1)[1], width, FIGURE_LIMIT, FIGURE_BYTES)
                shipped = ship_image(picked, self.webp, inline=True) if picked else None
                if shipped:
                    self.used_images.add(shipped[0])
                    out.append(image_mark(shipped[0], picked[1]))
                elif picked:
                    self.dropped_images.add(picked[0])
            elif kind == "page" or kind == "interwiki" or target.startswith(":"):
                label = parts[-1] if len(parts) > 1 else target.split("#")[0].lstrip(":")
                if kind == "interwiki" and len(parts) == 1:
                    label = target.split(":", 1)[-1]
                label = strip_marks(self._links(label))
                key = self.link_key(target.lstrip(":")) if kind == "page" else None
                anchor = target.partition("#")[2].replace("_", " ").strip()
                if key and anchor:
                    key += "#" + anchor
                out.append(link_mark(key, label) if key and label.strip() else label)
            last = end
        out.append(text[last:])
        return re.sub(r"\[(?:https?:)?//[^\s\]]+\s*([^\]]*)\]", r"\1", "".join(out))


class ArticleBuilder:
    """lang：zh 或 en；get_page(标题) 返回 wikitext（含模板页）；render 为保留标记的行内渲染；
    labels 为该语言的固定文字；link_key(链接目标) 返回站内条目名；npc_key(英文名) 返回居民条目名。"""

    def __init__(self, lang, get_page, render, labels, link_key, npc_key, infobox_labels, image=None, webp=None):
        self.image = image
        self.webp = webp  # (文件名, 种类) → 派生的 WebP，见 ship_image
        self.used_images = set()
        self.lang = lang
        self.get_page = get_page
        self.render = render
        self.labels = labels
        self.link_key = link_key
        self.npc_key = npc_key
        self.infobox_labels = infobox_labels

    # —— 入口 ——
    def build(self, title, text):
        text = self._prepare(text or "", transcluded=False)
        # 直接查看时参数取默认值（料理条目用 {{{{{1|Infobox cooking}}} 作信息框名）。
        prev = None
        while prev != text:
            prev, text = text, re.sub(r"\{\{\{[^{}|]*\|([^{}]*)\}\}\}", r"\1", text)
        facts = []
        info = wt.first_template(text, "Infobox")
        if info:
            facts = self._facts(info[0], info[1])
        text = self._expand(text, depth=0)
        text = self._cleanup(text)
        sections = []
        for sec in wt.sections(text):
            heading = sec["title"]
            if heading:
                heading = strip_marks(self.render(re.sub(r"\[\[(?:File|文件|Image|图像):[^\]]*\]\]", "", heading))).strip()
                if heading.lower() in SKIP_SECTIONS:
                    continue
            blocks = self.blocks(sec["body"])
            if blocks or (heading and sec["level"] <= 2):
                sections.append([heading or None, sec["level"], blocks])
        # 去掉没有内容的二级标题（其下各小节都没有内容时）。
        out = []
        for i, (heading, level, blocks) in enumerate(sections):
            if not blocks:
                nxt = sections[i + 1] if i + 1 < len(sections) else None
                if not nxt or nxt[1] <= level:
                    continue
            out.append([heading, level, blocks])
        if not out and not facts:
            return None
        article = {"s": out}
        if facts:
            article["f"] = facts
        return article

    # —— 预处理：包含/不包含标记、注释、图集 ——
    @staticmethod
    def _prepare(text, transcluded):
        text = wt.strip_comments(text)
        # 脚注先去掉：<ref name="…"> 里的等号会让模板参数被当成命名参数（{{History|1.6|说明<ref name="x">…}}）。
        text = re.sub(r"<references[^>]*/>|<references[^>]*>.*?</references>", "", text, flags=re.S | re.I)
        text = re.sub(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)
        # 段落、分区标签换成换行；模板里的 <p> 也一样，这样跨段的引文仍是完整的一行模板。
        text = re.sub(r"</?(?:p|div|center|blockquote|poem)\b[^>]*>", "\n", text, flags=re.I)
        if transcluded:
            parts = re.findall(r"<onlyinclude>(.*?)</onlyinclude>", text, re.S)
            if parts:
                text = "".join(parts)
            text = re.sub(r"<noinclude>.*?(</noinclude>|$)", "", text, flags=re.S)
            text = re.sub(r"</?includeonly>", "", text)
        else:
            text = re.sub(r"<includeonly>.*?(</includeonly>|$)", "", text, flags=re.S)
            text = re.sub(r"</?(noinclude|onlyinclude)>", "", text)
        return text

    def _cleanup(self, text):
        text = _unwrap_heading_tables(text)
        # 图集与浮动缩略图写成独立的图片行（\x03G名\x1f宽\x1f说明），连续的几行组成一组。
        # 居民肖像（128 像素）按 64 像素显示，一组几十张也不占太多地方。
        def gallery(m):
            width = "64" if "portraitgallery" in m.group(1) else ""
            lines = []
            for line in m.group(2).split("\n"):
                parts = wt.split_top(line.strip())
                name = re.sub(r"^%s:" % _FILE_PREFIX, "", parts[0].strip(), flags=re.I).strip() if parts else ""
                if name and re.search(r"\.(png|gif|jpe?g|webp)$", name, re.I):
                    _, _, caption = image_options(parts[1:])
                    lines.append(f"{_FIGURE}{name}\x1f{width}\x1f{caption}")
            return "\n" + "\n".join(lines) + "\n" if lines else "\n"
        text = re.sub(r"<gallery([^>]*)>(.*?)</gallery>", gallery, text, flags=re.S | re.I)
        text = _figures(text)
        text = re.sub(r"<references[^>]*/>|<references[^>]*>.*?</references>", "", text, flags=re.S | re.I)
        text = re.sub(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)
        text = re.sub(r"<section[^>]*/?>", "", text, flags=re.I)
        text = re.sub(r"<templatestyles[^>]*/?>", "", text, flags=re.I)
        text = re.sub(r"__[A-Z]+__", "", text)
        # 角注编号（<sup>[[#注释|[1]]]</sup>）没有对应的注释列表，去掉。
        text = re.sub(r"<sup>\s*\[\[#[^\]]*\]\]\s*</sup>", "", text)
        text = re.sub(r"\[\[(?:Category|分类|分類):[^\]]*\]\]", "", text, flags=re.I)
        text = re.sub(r"(?m)^\s*\[\[(?:%s):[^\]]*\]\]\s*$" % "|".join(sorted(wt.LANG_CODES)), "", text)
        text = re.sub(r"</?(?:span|small|big|font)\b[^>]*>", "", text, flags=re.I)
        text = re.sub(r"(?m)^\s*-{4,}\s*$", "", text)
        return text

    # —— 模板展开：嵌入页面与少数生成表格、折叠的模板 ——
    def _expand(self, text, depth):
        if depth > 4 or "{{" not in text:
            return text
        out, last = [], 0
        for raw, start, end in wt.iter_templates(text):
            out.append(text[last:start])
            out.append(self._expand_one(raw, text, start, end, depth))
            last = end
        out.append(text[last:])
        return "".join(out)

    def _expand_one(self, raw, text, start, end, depth):
        name, args = wt.parse_template(raw)
        key = name.strip()
        low = key.lower()
        line_start = start == 0 or text[start - 1] == "\n"
        line_end = end >= len(text) or not text[end:].split("\n", 1)[0].strip()
        whole_line = line_start and line_end
        if low.startswith("#lst:") or low.startswith("#lsth:") or low.startswith("#lstx:"):
            page = self.get_page(key.split(":", 1)[1].strip())
            arg = (args.get("1") or "").strip()
            if not page or not arg:
                return ""
            page = self._prepare(page, transcluded=True)
            part = _labeled_section(page, arg) if low.startswith("#lst:") else _heading_section(page, arg)
            return self._expand(part, depth + 1)
        if key.startswith(":"):
            target = key[1:].strip()
            page = self.get_page(target)
            if not page:
                return ""
            row = (args.get("1") or "").strip()
            if row:
                body = re.sub(r"\{\{\{[^{}|]*\|([^{}]*)\}\}\}", r"\1", self._prepare(page, transcluded=True))
                info = wt.first_template(body, "")
                return self._row_template(row, info[1] if info else {}, target)
            return self._expand(self._prepare(page, transcluded=True), depth + 1)
        if low == "history":
            return self._history(args, depth, line_start, line_end)
        if _DROP_TEMPLATES.match(low) or low in ("!-", "gallery"):
            return ""
        if low in ("main article", "main", "see also", "further"):
            pages = [args[k] for k in sorted((k for k in args if k.isdigit()), key=int) if args[k].strip()]
            if not pages:
                return ""
            links = self.labels["list_sep"].join(f"[[{p.strip()}]]" for p in pages)
            label = self.labels["see_also"] if low == "see also" else self.labels["main"]
            return f"\n\x03N{label}{links}\n"
        if low == "collapse":
            body = args.get("content") or args.get("2") or ""
            return f"\n{_DETAILS_OPEN}{(args.get('1') or self.labels['details']).strip()}\n{self._expand(body, depth + 1)}\n{_DETAILS_CLOSE}\n"
        if low in ("quote", "squote") and whole_line:
            body = self._expand(args.get("1") or "", depth + 1)
            source = self._expand(args.get("2") or "", depth + 1)
            # 引文里的对话选项按缩进写（“:选项”“::回答”），显示时去掉缩进符号。
            body = re.sub(r"(?m)^[ \t]*[:*]+[ \t]*", "", body.strip())
            return f"\n{_QUOTE}{body.replace(chr(10), '<br>')}\x1f{source}\n"
        if low == "recipes":
            return self._recipes(args)
        if low in ("reciperow", "reciperow/nobuffs"):
            return self._row_template(key, args, args.get("name", ""))
        if low == "villager":
            who = (args.get("1") or "").strip()
            if who.lower() in ("head", "header", "foot", "footer", ""):
                return ""
            label = args.get("2") or ""
            return f"\n* {{{{npc|{who}}}}}\n" if not label else f"\n* [[{label}]]\n"
        if low == "giftsbyitem":
            return self._gifts(args)
        if low == "edibilitygrid":
            return self._edibility(args)
        if low in ("energy", "health"):
            value = (args.get("1") or "").strip()
            return f"{self.labels[low]} {value}" if value else self.labels[low]
        if low == "choice":
            return self._choice(args)
        if low in ("quality", "recipe", "hearts", "overlayimg"):
            return ""
        if low == "heart event":
            # 触发条件照常显示，事件经过和选项放进折叠的“详情”（同 Wiki 模板）。
            trigger = self._expand(args.get("trigger") or "", depth + 1)
            details = self._expand(args.get("details") or "", depth + 1)
            return f"\n{trigger}\n{_DETAILS_OPEN}{self.labels['details']}\n{details}\n{_DETAILS_CLOSE}\n"
        if low == "scheduleheader":
            # 日程表：每季一个折叠表格，表格的结束符写在条目里。
            return f"\n{{| class=\"mw-collapsible\"\n! {{{{Season|{(args.get('1') or '').strip()}}}}}\n"
        if low == "giftheader":
            return f"\n\x03N{self.labels['main']}[[{self.labels['friendship_page']}]]\n\x03N{self.labels['see_also']}[[{self.labels['gift_list_page']}]]\n"
        if low == "grangeptswrapper":
            # 展览会各类别：计入该类别的物品与各品质的展览分数（不含职业加成；职业影响见条目正文）。
            if (args.get("1") or "").strip().lower() == "footer":
                return f"\n|}}\n{_DETAILS_CLOSE}\n"
            note = self._expand(args.get("note") or "", depth + 1)
            head = "!!".join(self.labels["grange_cols"])
            return f"\n{_DETAILS_OPEN}{(args.get('catname') or '').strip()}\n{note}\n{{| class=\"wikitable\"\n!{head}\n"
        if low == "fishlocationheader":
            # 鱼类地点表：Wiki 用 20 个小时格画时间条，这里写成时间段。
            head = ""
            if (args.get("time") or "").strip():
                head = "\n{| class=\"wikitable\"\n!" + "!!".join(self.labels["fish_cols"]) + "\n"
            return head + "|-\n! colspan=\"4\" | {{Season|%s}}\n" % (args.get("1") or "").strip()
        if low == "fishlocationentry":
            return self._fish_entry(args)
        if low == "grangeptsrow":
            return self._grange_row(args)
        if low == "version":
            return (args.get("2") or args.get("1") or "").strip()
        if low in self.simple_templates or low.startswith("fishlocations "):
            body = self.get_page("Template:" + key)
            if body:
                body = self._prepare(body, transcluded=True)
                for k, v in args.items():
                    body = re.sub(r"\{\{\{%s(?:\|[^{}]*)?\}\}\}" % re.escape(k), lambda m: v, body)
                body = re.sub(r"\{\{\{[^{}|]*\|([^{}]*)\}\}\}", r"\1", body)
                body = re.sub(r"\{\{\{[^{}]*\}\}\}", "", body)
                return self._expand(body, depth + 1)
        # 行内模板（name、price、season 等）留给渲染；参数里的嵌入照样展开。
        if "{{" in raw[2:-2]:
            inner = self._expand(raw[2:-2], depth + 1)
            return "{{" + inner + "}}"
        return raw

    # 只做参数替换就能显示的模板（导航条、鱼类地点表等）。
    simple_templates = {"kegproductivity-top", "preservesjarproductivity-top", "fishlocations town", "fishlocations beach",
                        "fishlocations mountain", "fishlocations forest", "fishlocations river"}

    # —— 具体模板 ——
    def _history(self, args, depth, line_start, line_end):
        """{{History|版本|说明}}：一条版本更新记录，写成列表项，版本号链接到版本历史条目的那一节。"""
        version = (args.get("1") or "").strip()
        body = self._expand(args.get("2") or "", depth + 1).strip()
        if not version or not body:
            return ""
        label = (args.get("version label") or version).strip()
        # 说明分几条写的（“\n:* …”“\n** …”）作为下一级列表；其余换行留在同一项里。
        body = re.sub(r"\n(?![ \t]*[:*#])", "<br>", body)
        if body[:1] in (":", "*", "#"):
            body = "\n" + body
        item = f"* [[{self.labels['version_page']}#{version}|{label}]]{self.labels['history_sep']}{body}"
        return ("" if line_start else "\n") + item + ("" if line_end else "\n")

    def _recipes(self, args):
        what = (args.get("1") or "").strip().lower()
        if what in ("foot", "footer"):
            return "\n|}\n"
        if what not in ("head", "header"):
            return ""
        hide = (args.get("hide") or "").lower()
        cols = [c for c in self.labels["recipe_cols"] if c[0] not in hide]
        if (args.get("crafting") or "").strip().lower() == "true":
            cols = [(k, self.labels["crafting_source"] if k == "recipe" else v) for k, v in cols]
        self._recipe_hide = hide
        return "\n{| class=\"wikitable\"\n|-\n!" + "!!".join(v for _, v in cols) + "\n"

    def _row_template(self, row, fields, page_title):
        """{{:料理名|RecipeRow}}：取该料理条目的信息框字段，按食谱表的列写成一行。"""
        low = row.strip().lower()
        if low not in ("reciperow", "reciperow/nobuffs"):
            return ""
        hide = getattr(self, "_recipe_hide", "")
        name = (fields.get("name") or page_title or "").strip()
        cells = {"name": f"[[{name}]]"}
        cells["description"] = fields.get("description") or "{{Description|%s}}" % name
        cells["ingredients"] = fields.get("ingredients") or ""
        ed = (fields.get("edibility") or "").strip()
        try:
            value = int(ed)
            energy = -(-value * 5 // 2) if value > 0 else int(value * 2.5)
            health = (fields.get("health") or "").strip() or str(int(energy * 0.45) if value > 0 else 0)
            cells["restores"] = f"{self.labels['energy']} {energy}<br>{self.labels['health']} {health}"
        except ValueError:
            cells["restores"] = self.labels["none"]
        if low == "reciperow":
            cells["buff"] = fields.get("buff") or self.labels["none"]
            cells["duration"] = fields.get("duration") or self.labels["none"]
        cells["recipe"] = fields.get("recipe") or ""
        price = (fields.get("sellprice") or "").strip()
        cells["sellprice"] = "{{price|%s}}" % price if price else ""
        order = ["name"] + [k for k, _ in self.labels["recipe_cols"][1:] if k not in hide]
        if low == "reciperow/nobuffs":
            order = [k for k in order if k not in ("buff", "duration")]
        body = "\n".join("|" + (cells.get(k) or "").replace("\n", " ") for k in order)
        return "\n|-\n" + body + "\n"

    def _fish_entry(self, args):
        try:
            length = int((args.get("length") or "20").strip())
            offset = int((args.get("offset") or "").strip()) if (args.get("offset") or "").strip() else None
        except ValueError:
            length, offset = 20, None
        night = (args.get("timeofday") or "").strip().lower() == "night"
        start = 6 + offset if offset is not None else (26 - length if night else 6)
        end = start + length
        when = self.labels["any_time"] if length >= 20 else f"{start % 24}:00–{end % 24}:00"
        weather = self.labels["weathers"].get((args.get("weather") or "").strip().lower(), self.labels["weathers"][""])
        fish = (args.get("fish") or "").strip()
        alt = (args.get("alt") or "").strip()
        name = "{{name|%s%s}}" % (fish, "|alt=" + alt if alt else "") if fish else ""
        return f"\n|-\n|{name}\n|{(args.get('location') or '').strip()}\n|{when}\n|{weather}\n"

    def _grange_row(self, args):
        """{{Grangeptsrow|英文名|中文名|售价|类别|qualities=0,1,2,4}}：按模块:Calcsellprice、Calcgrangepoints 算各品质的分数。"""
        # 工匠物品（类别 -26）第一个参数是图标，名称写在第二个参数，计价用 item= 的产品种类。
        artisan = (args.get("4") or "").strip() == "-26"
        name = (args.get("item") or ("" if artisan else args.get("1")) or "").strip()
        label = (args.get("2") or "").strip() if artisan else "{{name|%s}}" % name
        try:
            base = int((args.get("3") or "").replace(",", "").strip())
        except ValueError:
            return ""
        qualities = {q.strip() for q in (args.get("qualities") or "0").split(",")}
        cells = [str(grange_points(sell_price(name, base, q), q)) if str(q) in qualities else "—" for q in (0, 1, 2, 4)]
        return "\n|-\n|%s\n|%s\n" % (label, "||".join(cells))

    def _gifts(self, args):
        rows = []
        for key, label in self.labels["gift_levels"]:
            who = [w.strip() for w in (args.get(key) or "").split(",") if w.strip()]
            if who:
                rows.append(f"|-\n!{label}\n|" + self.labels["list_sep"].join("{{npc|%s}}" % w for w in who))
        if not rows:
            return ""
        return "\n{| class=\"wikitable\"\n" + "\n".join(rows) + "\n|}\n"

    def _edibility(self, args):
        try:
            value = int((args.get("2") or "0").strip())
        except ValueError:
            return ""
        if value == 0 or value == -300:
            return self.labels["inedible"]
        energy = -(-value * 5 // 2) if value > 0 else int(value * 2.5)
        health = (args.get("health") or "").strip() or str(int(energy * 0.45) if value > 0 else 0)
        return f"{self.labels['energy']} {energy}<br>{self.labels['health']} {health}"

    def _choice(self, args):
        text = args.get("1") or ""
        try:
            points = int((args.get("2") or "").strip())
        except ValueError:
            points = 0
        note = self.labels["friendship"].format(n=f"+{points}" if points > 0 else str(points)) if points else self.labels["no_friendship"]
        who = (args.get("3") or "").strip()
        return f"{text}（{who + '：' if who else ''}{note}）" if self.lang == "zh" else f"{text} ({note}{' with ' + who if who else ''})"

    # —— 信息框 ——
    def _facts(self, kind, fields):
        labels = self.infobox_labels.get(kind.strip().lower())
        if not labels:
            return []
        facts = []
        for key, label in labels:
            if callable(label):
                pair = label(fields)
                if pair:
                    facts.append([pair[0], runs(self.render(pair[1]))])
                continue
            raw = (fields.get(key) or "").strip()
            if not raw or raw.upper() == "N/A":
                continue
            if key == "sellprice" and raw.replace(",", "").isdigit():
                raw = "{{price|%s}}" % raw
            value = runs(self.render(self._expand(raw, 1)))
            if value and plain(value).strip():
                facts.append([label, value])
        return facts

    # —— 块解析 ——
    def blocks(self, text):
        out, para = [], []
        lines = _join_template_lines(text.split("\n"))
        i = 0

        def flush():
            if para:
                parts = runs(self.render("\n".join(para)))
                if plain(parts).strip() or has_image(parts):
                    out.append(["p", parts])
                para.clear()

        while i < len(lines):
            line = lines[i]
            s = line.strip()
            if re.match(r"[:*#]+\s*\{\|", s):
                # 缩进或列表里的表格（“: {|”）按普通表格处理。
                lines[i] = line = re.sub(r"^\s*[:*#]+\s*", "", line)
                s = line.strip()
            if s.startswith("{|"):
                flush()
                chunk, i = _take_table(lines, i)
                block = self.table(chunk)
                if block:
                    out.append(block)
                continue
            if s.startswith(_DETAILS_OPEN):
                flush()
                title, body, depth, i = s[len(_DETAILS_OPEN):], [], 1, i + 1
                while i < len(lines):
                    t = lines[i].strip()
                    if t.startswith(_DETAILS_OPEN):
                        depth += 1
                    elif t == _DETAILS_CLOSE:
                        depth -= 1
                        if depth == 0:
                            i += 1
                            break
                    body.append(lines[i])
                    i += 1
                inner = self.blocks("\n".join(body))
                if inner:
                    out.append(["d", strip_marks(self.render(title)) or self.labels["details"], inner])
                continue
            if s.startswith(_FIGURE):
                flush()
                entries = []
                while i < len(lines) and lines[i].strip().startswith(_FIGURE):
                    name, width, caption, mode = (lines[i].strip()[len(_FIGURE):].split("\x1f") + ["", "", ""])[:4]
                    entry = self._figure(name, int(width) if width.lstrip("-").isdigit() else None, caption, mode == "wide")
                    if entry:
                        entries.append(entry)
                    i += 1
                if entries:
                    out.append(["g", entries])
                continue
            if s.startswith(_QUOTE):
                flush()
                body, _, source = s[len(_QUOTE):].partition("\x1f")
                parts = runs(self.render(body))
                if plain(parts).strip():
                    out.append(["q", parts, runs(self.render(source))])
                i += 1
                continue
            if s.startswith("\x03N"):
                flush()
                parts = runs(self.render(s[2:]))
                if plain(parts).strip():
                    out.append(["n", parts])
                i += 1
                continue
            if s[:1] in ("*", "#"):
                flush()
                items, ordered = [], s[0] == "#"
                while i < len(lines) and lines[i].strip()[:1] in ("*", "#", ":") and (lines[i].strip()[:1] != ":" or items):
                    t = lines[i].strip()
                    marks = re.match(r"[*#:;]+", t).group(0)
                    body = t[len(marks):].strip()
                    parts = runs(self.render(body))
                    if plain(parts).strip() or has_image(parts):
                        if marks.endswith(":") and items:
                            items[-1][1].extend(["\n", *parts])
                        else:
                            items.append([len(marks), parts])
                    i += 1
                if items:
                    out.append(["l", 1 if ordered else 0, items])
                continue
            if s.startswith(";"):
                flush()
                term, _, rest = s[1:].partition(" : ")
                parts = runs(self.render(term))
                if plain(parts).strip():
                    out.append(["h", parts])
                if rest.strip():
                    para.append(rest)
                i += 1
                continue
            if s.startswith(":"):
                flush()
                parts = runs(self.render(s.lstrip(":").strip()))
                if plain(parts).strip():
                    out.append(["p", parts])
                i += 1
                continue
            if not s or s in ("|}", "|-"):
                # 表格外多出来的结束符（条目原文的笔误）不显示。
                flush()
                i += 1
                continue
            para.append(line)
            i += 1
        flush()
        return out

    def _figure(self, name, width, caption, wide=False):
        """图片组的一项：[文件, 显示宽度, 说明片段]；大图为 [缩略图, 显示宽度, 说明片段, 原尺寸 WebP]，
        做不了 WebP 时为 [None, 0, 说明片段, Wiki 原图文件名]（只给链接）。
        缩略图、图集最宽 320 像素；单独占一行的图（wide）照 Wiki 的尺寸，最宽 WIDE_LIMIT（缩略图本身 640 像素宽）。"""
        if not self.image:
            return None
        picked = pick_image(self.image, name, width, FIGURE_LIMIT, FIGURE_BYTES, cap=WIDE_LIMIT if wide else IMAGE_LIMIT)
        if not picked:
            return None
        shown = picked[1]
        text = runs(self.render(caption)) if caption else []
        shipped = ship_image(picked, self.webp, inline=False)
        if not shipped:
            return [None, 0, text, picked[0]]
        file, full = shipped
        self.used_images.update(x for x in shipped if x)
        if full:
            return [file, min(shown, 640 if wide else 320), text, full]
        return [file, shown if wide else min(shown, 320), text]

    def table(self, raw):
        parsed = wt._parse_table(raw)
        rows = []
        for row in parsed["rows"]:
            cells = []
            for cell in row:
                attrs = cell["attrs"] or ""
                span = {}
                for attr in ("colspan", "rowspan"):
                    m = re.search(attr + r'\s*=\s*"?(\d+)', attrs, re.I)
                    if m and int(m.group(1)) > 1:
                        span["c" if attr == "colspan" else "r"] = int(m.group(1))
                content = re.sub(r"(?m)^[ \t]*[:;]+[ \t]*", "", cell["text"])
                if content.startswith("|"):
                    content = content[1:]  # “||内容”：多写了一个分隔符
                nested = "{|" in content or "\x03" in content or re.search(r"(?m)^\s*[*#]", content)
                if nested:
                    blocks = self.blocks(content)
                    value = blocks[0][1] if len(blocks) == 1 and blocks[0][0] == "p" else None
                else:
                    value = runs(self.render(content))
                    blocks = None
                entry = {**span}
                if cell["header"]:
                    entry["h"] = 1
                if value is not None:
                    entry["v"] = value
                elif blocks:
                    entry["b"] = blocks
                cells.append(entry if (entry.keys() - {"v"}) else (value or []))
            if cells:
                rows.append(cells)
        rows = _drop_empty(rows)
        if not rows:
            return None
        # 折叠表格（“详情”标题 + 一列内容格）按折叠详情显示。
        if "mw-collapsible" in parsed["attrs"] and len(rows) >= 2 and all(len(r) == 1 for r in rows):
            title = _cell_text(rows[0][0])
            blocks = []
            for (body,) in rows[1:]:
                if isinstance(body, dict) and "b" in body:
                    blocks.extend(body["b"])
                elif _cell_text(body).strip():
                    blocks.append(["p", body.get("v", []) if isinstance(body, dict) else body])
            return ["d", title or self.labels["details"], blocks] if blocks else None
        caption = strip_marks(self.render(parsed.get("caption") or "")) or None
        return ["t", rows, caption] if caption else ["t", rows]


def _join_template_lines(lines):
    """模板跨行（{{Description\n|Wild Bait}}）时并成一行，避免被当成表格单元或分段；表格本身不合并。"""
    out, buf, depth = [], None, 0
    for line in lines:
        if buf is None:
            opened = line.count("{{") - line.count("}}")
            if opened > 0 and not line.strip().startswith("{|"):
                buf, depth = line, opened
            else:
                out.append(line)
            continue
        buf += " " + line.strip()
        depth += line.count("{{") - line.count("}}")
        if depth <= 0:
            out.append(buf)
            buf = None
    if buf is not None:
        out.extend(buf.split("\n"))
    return out


def _take_table(lines, i):
    """从第 i 行的 {| 起取到配对的 |}，返回 (表格原文, 下一行下标)。"""
    depth, chunk = 0, []
    while i < len(lines):
        s = lines[i].strip()
        if s.startswith("{|"):
            depth += 1
        chunk.append(lines[i])
        if s.startswith("|}") or (s.endswith("|}") and not s.startswith("{|") and depth):
            depth -= s.count("|}") if s.startswith("|}") else 1
            if depth <= 0:
                return "\n".join(chunk), i + 1
        i += 1
    return "\n".join(chunk) + "\n|}", i


def sell_price(item, base, quality, profession=1):
    """模块:Calcsellprice：品质倍率 1.25/1.5/2，部分工匠物品按原料价换算。"""
    item = item.lower()
    mult = {1: 1.25, 2: 1.5, 4: 2}.get(quality, 1)
    if item in ("coffee", "oil"):
        profession = 1
    if "wine" in item:
        price = base * 3
    elif "juice" in item:
        price = math.floor(base * 2.25)
    elif "jelly" in item or "pickles" in item:
        price = 50 + base * 2
    elif "dried" in item:
        price = math.floor(base * 7.5 + 25)
    elif item == "honey":
        price = 100 + base * 2 if base != 100 else 100
    elif "aged roe" in item:
        price = 2 * (30 + base // 2)
    elif "roe" in item:
        price = 30 + base // 2
    else:
        price = base
    return math.floor(math.floor(profession * 10 * math.floor(mult * price)) / 10)


def grange_points(price, quality):
    """模块:Calcgrangepoints：品质 + 1，售价达到 20、90、200 各加 1 分，300（普通、银星）、400（普通）再加 1 分。"""
    return (quality + 1 + (price >= 20) + (price >= 90) + (price >= 200)
            + (price >= 300 and quality < 2) + (price >= 400 and quality < 1))


def _figures(text):
    """浮动的缩略图（[[File:名|thumb|说明]]）和单独占一行的图单独成行，块解析时组成图片组；
    段落、表格里的小图留给行内渲染。"""
    out, pos = [], 0
    for m in re.finditer(r"\[\[%s:" % _FILE_PREFIX, text, flags=re.I):
        if m.start() < pos:
            continue
        end = wt._match_close(text, m.start(), "[[", "]]")
        parts = wt.split_top(text[m.start() + 2:end - 2])
        width, floating, caption = image_options(parts[1:])
        line_start = text.rfind("\n", 0, m.start()) + 1
        line_end = text.find("\n", end)
        alone = not text[line_start:m.start()].strip() and not text[end:line_end if line_end >= 0 else len(text)].strip()
        if not floating and not alone:
            continue
        name = parts[0].split(":", 1)[1].strip()
        out.append(text[pos:m.start()])
        mode = "" if floating else "wide"
        out.append(f"\n{_FIGURE}{name}\x1f{width if width is not None else ''}\x1f{caption.replace(chr(10), ' ')}\x1f{mode}\n")
        pos = end
    out.append(text[pos:])
    return "".join(out)


def _unwrap_heading_tables(text):
    """表格里放了小标题（排版用的分栏表格、“完整公式”的折叠表格），章节切分会把表格拆断：去掉外层表格，保留内容。"""
    out, pos = [], 0
    while True:
        m = re.search(r"(?m)^[ \t]*\{\|[^\n]*$", text[pos:])
        if not m:
            break
        start = pos + m.start()
        end = wt._match_close(text, start + m.group(0).index("{|"), "{|", "|}")
        body = text[start:end]
        if not re.search(r"(?m)^={2,6}[^=]", body):
            out.append(text[pos:end])
            pos = end
            continue
        lines = body.split("\n")[1:]
        if lines and lines[-1].strip().endswith("|}"):
            lines[-1] = lines[-1].strip()[:-2]
        kept, depth = [], 0
        for line in lines:
            s = line.strip()
            if depth == 0 and (s.startswith("|-") or s.startswith("|+")):
                continue
            if depth == 0 and s.startswith("!"):
                kept.append(";" + re.sub(r"^!\s*(?:[^|\[{]*\|)?", "", s).strip("'"))
                continue
            if depth == 0 and s.startswith("|") and not s.startswith("|}"):
                line = re.sub(r"^\s*\|\s*(?:[^|\[{=]*=\"[^\"]*\"\s*\|)?", "", line)
            depth += s.count("{|") - s.count("|}")
            kept.append(line)
        out.append(text[pos:start] + "\n".join(kept))
        pos = end
    out.append(text[pos:])
    return "".join(out)


def _cell_text(cell):
    if isinstance(cell, dict):
        return plain(cell.get("v") or [])
    return plain(cell)


def _cell_empty(cell):
    if isinstance(cell, dict):
        return not cell.get("b") and not plain(cell.get("v") or []).strip() and not has_image(cell.get("v"))
    return not plain(cell).strip() and not has_image(cell)


_IMAGE_HEADERS = {"图片", "图像", "图标", "image", "images", "icon", "picture"}


def _drop_image_column(rows):
    """首列是“图片”列、数据格都是空的（图片已去掉）时整列去掉；跨到这一列的单元格少跨一列。"""
    head = rows[0][0] if rows and rows[0] else None
    if not (isinstance(head, dict) and head.get("h") and _cell_text(head).strip().lower() in _IMAGE_HEADERS):
        return rows
    out = []
    for i, row in enumerate(rows):
        cell = row[0]
        if isinstance(cell, dict) and cell.get("r", 1) > 1:
            return rows
        span = cell.get("c", 1) if isinstance(cell, dict) else 1
        if i == 0 or (span == 1 and _cell_empty(cell)):
            out.append(row[1:])
        elif span > 1:
            cell = {**cell, "c": span - 1} if span > 2 else {k: v for k, v in cell.items() if k != "c"}
            out.append([cell if (cell.keys() - {"v"}) else cell.get("v", []), *row[1:]])
        else:
            return rows
    return [r for r in out if r]


def _drop_empty(rows):
    """去掉全空的行；没有跨行跨列时，再去掉数据格全空的列（多为图片列）。"""
    rows = _drop_image_column([r for r in rows if not all(_cell_empty(c) for c in r)])
    if not rows or any(isinstance(c, dict) and ("c" in c or "r" in c) for r in rows for c in r):
        return rows
    width = max(len(r) for r in rows)
    if any(len(r) != width for r in rows):
        return rows
    data_rows = [r for r in rows if not all(isinstance(c, dict) and c.get("h") for c in r)]
    if not data_rows:
        return rows
    keep = [j for j in range(width) if not all(_cell_empty(r[j]) for r in data_rows)]
    if len(keep) == width or not keep:
        return rows
    return [[r[j] for j in keep] for r in rows]


def _labeled_section(text, name):
    m = re.search(r'<section\s+begin\s*=\s*"?%s"?\s*/>(.*?)<section\s+end\s*=\s*"?%s"?\s*/>' % (re.escape(name), re.escape(name)), text, re.S)
    return m.group(1) if m else ""


def _heading_section(text, heading):
    for m in re.finditer(r"(?m)^(={2,6})\s*(.+?)\s*\1\s*$", text):
        if m.group(2).strip() == heading.strip():
            level = len(m.group(1))
            rest = text[m.end():]
            nxt = re.search(r"(?m)^(={2,%d})[^=].*?\1\s*$" % level, rest)
            return rest[:nxt.start()] if nxt else rest
    return ""


def unescape(text):
    return html.unescape(text)
