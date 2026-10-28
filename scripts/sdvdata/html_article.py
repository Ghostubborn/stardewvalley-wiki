"""中文条目正文：把星露谷物语 BWIKI 渲染后的页面（action=parse 的 HTML）转成与 article.py 相同的分节格式。

BWIKI 的日程、对话、任务、配方行、送礼表等由 Lua 模块生成，原文里只有模块调用，所以读渲染结果：
段落、列表、表格、引文、折叠块、标签页、对话气泡和图片按 Wiki 显示的样子收录。信息框、导航框、
目录、参考文献、人物行走动画等只在 BWIKI 上有用的部分不收录。块与片段的格式见 article.py。
"""

import re

from . import html as H
from .article import FIGURE_BYTES, FIGURE_LIMIT, IMAGE_LIMIT, SKIP_SECTIONS, pick_image, ship_image

# 不收录的元素（按 class）：信息框、导航框、目录、参考文献、编辑链接、人物动画、音频、站务提示框。
_SKIP_CLASSES = {
    "infoboxborder", "infoboxtable", "navbox", "navbox-wrapper", "toc", "toccolours", "mw-references-wrap", "references",
    "reflist", "mw-editsection", "noprint", "villiager-sprites", "sprite-preparing", "audio-player", "messagebox",
    "ambox", "metadata", "navigation-not-searchable", "mw-empty-elt", "printfooter", "catlinks", "portrait",
}
_SKIP_TAGS = {"style", "script", "link", "meta", "noscript", "audio", "video", "source", "input", "button", "template"}
_INLINE = {"a", "abbr", "b", "bdi", "big", "br", "cite", "code", "del", "em", "font", "i", "img", "ins", "kbd", "q", "s",
           "samp", "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr", "label", "nowiki"}
_HEADINGS = {"h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


def _hidden(node):
    style = (node.get("style") or "").replace(" ", "").lower()
    return "display:none" in style or node.has_class(*_SKIP_CLASSES) or node.tag in _SKIP_TAGS \
        or (node.tag == "sup" and node.has_class("reference")) or node.get("id") == "reference_page"


def _merge(parts):
    """相邻文字合并，空白收拢，首尾空白去掉（与 article.runs 一致）。"""
    out = []
    for p in parts:
        if isinstance(p, str):
            p = re.sub(r"[ \t\r\f\v]+", " ", p.replace("\xa0", " "))
            if out and isinstance(out[-1], str):
                out[-1] += p
                continue
        out.append(p)
    if out and isinstance(out[0], str):
        out[0] = out[0].lstrip()
    if out and isinstance(out[-1], str):
        out[-1] = out[-1].rstrip()
    out = [re.sub(r" *\n *", "\n", p) if isinstance(p, str) else p for p in out]
    return [p for p in out if p != ""]


def _text(raw):
    """源码里的文字：连续空白算一个空格；没能生效的空标签链接（[[版本历史/1.4#1.4|]]）在 Wiki 上照字面显示，只留小节名。"""
    raw = re.sub(r"\[\[([^\]|]+)\|\]\]", lambda m: m.group(1).split("#")[-1].rsplit("/", 1)[-1], raw)
    return re.sub(r"\s+", " ", raw)


def _text_of(parts):
    return "".join(p if isinstance(p, str) else ("" if p[0] == "f" else p[2]) for p in parts)


class HtmlArticle:
    """link_key(条目名) → 站内条目名或 None；item_of(条目名, 图片文件名) → 物品 ID 或 None；
    image(文件名) → 归档图片信息；webp(文件名, 种类) → 派生的 WebP。"""

    def __init__(self, link_key, item_of, image, webp=None, labels=None):
        self.link_key, self.item_of, self.image, self.webp = link_key, item_of, image, webp
        self.labels = labels or {}
        self.used_images, self.dropped_images = set(), set()

    # —— 入口 ——
    def build(self, markup, facts_from_infobox=False):
        root = H.parse(markup)
        body = root.find("div", "mw-parser-output") or root
        facts = self._facts(body) if facts_from_infobox else []
        sections, current = [], [None, 1, []]
        pending = []
        for node in body.children:
            if isinstance(node, H.Node) and node.tag in _HEADINGS:
                current[2].extend(self.blocks(pending))
                pending = []
                sections.append(current)
                head = node.find("span", "mw-headline") or node
                current = [H.clean(head.text()), _HEADINGS[node.tag], []]
                continue
            pending.append(node)
        current[2].extend(self.blocks(pending))
        sections.append(current)
        # 跳过参考文献、外部链接、导航等章节（连同其下的小节）。
        kept, skip_level = [], None
        for heading, level, blocks in sections:
            if skip_level is not None and level > skip_level:
                continue
            skip_level = None
            if heading and heading.lower() in SKIP_SECTIONS:
                skip_level = level
                continue
            if blocks or (heading and level <= 2):
                kept.append([heading, level, blocks])
        out = []
        for i, (heading, level, blocks) in enumerate(kept):
            if not blocks:
                nxt = kept[i + 1] if i + 1 < len(kept) else None
                if not nxt or nxt[1] <= level:
                    continue
            out.append([heading, level, blocks])
        if not out and not facts:
            return None
        article = {"s": out}
        if facts:
            article["f"] = facts
        return article

    # —— 信息框：标签 / 内容两列的行 ——
    def _facts(self, body):
        box = body.find("table", "infoboxtable")
        if not box:
            return []
        facts = []
        for tr in box.iter("tr"):
            cells = [c for c in tr.elements() if c.tag in ("td", "th")]
            if len(cells) != 2 or not cells[0].has_class("infoboxsection") or not cells[1].has_class("infoboxdetail"):
                continue
            label = H.clean(cells[0].text())
            value = _merge(self.inline(cells[1]))
            if label and _text_of(value).strip():
                facts.append([label, value])
        return facts

    # —— 行内 ——
    def inline(self, node):
        parts = []
        for child in node.children:
            if isinstance(child, str):
                # 和浏览器一样，换行只来自 <br> 和块的边界。
                parts.append(_text(child))
                continue
            if _hidden(child):
                continue
            tag = child.tag
            if tag == "br":
                parts.append("\n")
            elif tag == "img":
                parts.extend(self._image(child))
            elif tag == "a":
                parts.extend(self._link(child))
            elif tag == "span" and child.has_class("nametemplate", "nametemplateinline"):
                parts.extend(self._name(child))
            elif tag in ("p", "div", "li", "dd", "dt", "tr"):
                parts.extend(["\n", *self.inline(child), "\n"])
            elif tag in ("td", "th"):
                parts.extend([" ", *self.inline(child), " "])
            elif tag in ("ul", "ol", "dl", "table", "tbody", "thead", "details", "summary"):
                parts.extend(["\n", *self.inline(child), "\n"])
            else:
                parts.extend(self.inline(child))
        return parts

    def _image(self, img, inline=True):
        file = H.image_file(img)
        if not file or not self.image:
            return []
        try:
            width = int(img.get("width") or 0) or None
        except ValueError:
            width = None
        picked = pick_image(self.image, file, width)
        if not picked:
            return []
        shipped = ship_image(picked, self.webp, inline=True)
        if not shipped:
            self.dropped_images.add(picked[0])
            return []
        self.used_images.add(shipped[0])
        return [["f", shipped[0], picked[1]]]

    def _link(self, a):
        if a.has_class("image") or (a.find("img") and not H.clean(a.text())):
            img = a.find("img")
            return self._image(img) if img else []
        label = _merge(self.inline(a))
        text = _text_of(label).strip()
        target = H.link_title(a)
        key = self.link_key(target[0]) if target else None
        if not key or not text:
            return label
        images = [p for p in label if not isinstance(p, str) and p[0] == "f"]
        anchor = ("#" + target[1]) if target[1] else ""
        return images + [["l", key + anchor, text]]

    def _name(self, span):
        """{{Name}} 的渲染：图标 + 链接 + 数量。能对上物品的写成物品片段（详情页显示图标）。"""
        img = span.find("img")
        a = next((x for x in span.iter("a") if not x.has_class("image")), None)
        target = H.link_title(a) if a else None
        label = H.clean(a.text()) if a else ""
        qid = self.item_of(target[0] if target else None, H.image_file(img) if img else None, label)
        if not qid or not label:
            return self.inline(span)
        rest = []
        seen = False
        for child in span.children:
            if child is a:
                seen = True
                continue
            if seen:
                rest.extend([_text(child)] if isinstance(child, str) else self.inline(child) if child.tag != "img" else [])
        return [["i", qid, label], *rest]

    # —— 块 ——
    def blocks(self, nodes):
        out, para = [], []

        def flush():
            parts = _merge(para)
            para.clear()
            if parts and (_text_of(parts).strip() or any(not isinstance(p, str) for p in parts)):
                out.append(["p", parts])

        for node in nodes:
            if isinstance(node, str):
                para.append(_text(node))
                continue
            if _hidden(node):
                continue
            tag = node.tag
            if tag in _INLINE and not node.find("table") and not node.find("div"):
                if tag == "span" and node.has_class("nametemplate", "nametemplateinline"):
                    para.extend(self._name(node))
                elif tag == "a":
                    para.extend(self._link(node))
                elif tag == "img":
                    para.extend(self._image(node))
                elif tag == "br":
                    para.append("\n")
                else:
                    para.extend(self.inline(node))
                continue
            flush()
            out.extend(self.block(node))
        flush()
        return out

    def block(self, node):
        tag = node.tag
        if tag == "p":
            # 段落里夹着块级内容（模板拼出来的）时拆开处理。
            if any(isinstance(c, H.Node) and c.tag in ("table", "div", "ul", "ol") for c in node.children):
                return self.blocks(node.children)
            # 单独占一行的图（手柄键位图、形象演变时间轴）按 Wiki 的尺寸显示，最宽 WIDE_LIMIT。
            imgs = list(node.iter("img"))
            if imgs and not H.clean(node.text()):
                entries = [e for e in (self._figure(H.image_file(i), int(i.get("width") or 0) or None, [], wide=True) for i in imgs) if e]
                return [["g", entries]] if entries else []
            parts = _merge(self.inline(node))
            return [["p", parts]] if parts and (_text_of(parts).strip() or any(not isinstance(p, str) for p in parts)) else []
        if tag in _HEADINGS:
            text = H.clean((node.find("span", "mw-headline") or node).text())
            return [["h", [text]]] if text else []
        if tag in ("ul", "ol"):
            if node.has_class("gallery"):
                return self._gallery(node)
            items = self._list_items(node, 1)
            return [["l", tag == "ol", items]] if items else []
        if tag == "dl":
            out = []
            for child in node.elements():
                if child.tag == "dt":
                    parts = _merge(self.inline(child))
                    if parts:
                        out.append(["h", parts])
                elif child.tag == "dd":
                    out.extend(self.blocks(child.children))
            return out
        if tag == "table":
            return self._table(node)
        if tag == "details":
            return self._details(node)
        if tag == "blockquote":
            parts = _merge(self.inline(node))
            return [["q", parts, []]] if parts else []
        if tag in ("div", "figure", "center", "section", "span", "font", "small", "big", "b", "i"):
            if node.has_class("hatnote"):
                parts = _merge(self.inline(node))
                return [["n", parts]] if parts else []
            if node.has_class("collapsed") and node.find("details"):
                return self._details(node.find("details"))
            if node.has_class("custom-tabs-container"):
                return self._tabs(node)
            if node.has_class("dialog-item"):
                return self._dialog(node)
            if node.has_class("thumb") or tag == "figure":
                return self._thumb(node)
            return self.blocks(node.children)
        return self.blocks(node.children)

    def _list_items(self, node, level):
        items = []
        for li in node.elements():
            if li.tag != "li":
                continue
            own, nested = [], []
            for child in li.children:
                if isinstance(child, H.Node) and child.tag in ("ul", "ol"):
                    nested.extend(self._list_items(child, level + 1))
                elif isinstance(child, H.Node) and child.tag in ("table", "div") and child.find("table"):
                    continue
                elif isinstance(child, H.Node) and _hidden(child):
                    continue
                else:
                    own.extend(self.inline(child) if isinstance(child, H.Node) else [_text(child)])
            parts = _merge(own)
            if parts:
                items.append([level, parts])
            items.extend(nested)
        return items

    def _details(self, details):
        summary = details.find("summary")
        title = H.clean(summary.text()) if summary else ""
        content = [c for c in details.children if c is not summary]
        blocks = self.blocks(content)
        if not blocks:
            return []
        # 标签页里每个面板外面包着一层没有标题的折叠，展开显示即可。
        return [["d", title, blocks]] if title else blocks

    def _tabs(self, node):
        names = [H.clean(a.text()) for a in node.find_all("a", "custom-tabs-tab")]
        panels = node.find_all("div", "custom-tabs-panel")
        out = []
        for name, panel in zip(names, panels):
            blocks = self.blocks(panel.children)
            if blocks:
                out.append(["d", name or self.labels.get("details", "详情"), blocks])
        return out

    def _dialog(self, node):
        speaker = node.find("div", "speaker")
        message = node.find("div", "message")
        if not message:
            return []
        parts = _merge(self.inline(message))
        if not parts:
            return []
        if node.has_class("right"):
            return [["q", parts, [self.labels.get("player", "玩家")]]]
        if node.has_class("narrative", "center"):
            return [["p", parts]]
        return [["q", parts, _merge(self.inline(speaker)) if speaker else []]]

    def _table(self, table):
        if table.has_class("infoboxtable", "navbox"):
            return []
        if table.has_class("quotetable"):
            text = table.find("td", "squotetext")
            source = table.find("td", "squotesource") or table.find("td", "squoteauthor")
            parts = _merge(self.inline(text)) if text else []
            return [["q", parts, _merge(self.inline(source)) if source else []]] if parts else []
        rows = H.table_rows(table)
        if not rows:
            return []
        # 折叠表（日程的每个季节等）：第一行只有一个表头，其余行是内容 → 折叠的详情。
        first = {id(c[0]): c for c in rows[0]}
        if table.has_class("mw-collapsible") and len(first) == 1 and rows[0][0][1]:
            title = H.clean(rows[0][0][0].text())
            inner = []
            for row in rows[1:]:
                for cell in {id(c[0]): c[0] for c in row}.values():
                    inner.extend(self.blocks(cell.children))
            return [["d", title or self.labels.get("details", "详情"), inner]] if inner else []
        # 排版用的表格（单元格里是段落、表格）：拆成里面的块。
        cells = [c for row in rows for c in row]
        if not table.has_class("wikitable") and any(c[0].find("table") or c[0].find("p") for c in cells):
            out = []
            for cell in dict((id(c[0]), c[0]) for c in cells).values():
                out.extend(self.blocks(cell.children))
            return out
        caption = table.find("caption")
        out_rows, seen = [], set()
        for row in rows:
            out_row = []
            for cell, header, col, span in row:
                if id(cell) in seen:
                    continue
                seen.add(id(cell))
                out_row.append(self._cell(cell, header))
            if out_row and any(_cell_text(c).strip() or _cell_has_image(c) for c in out_row):
                out_rows.append(out_row)
        if not out_rows:
            return []
        return [["t", out_rows, H.clean(caption.text()) if caption else None]] if caption else [["t", out_rows]]

    def _cell(self, cell, header):
        complex_ = cell.find("table") or cell.find("ul") or cell.find("ol") or len([c for c in cell.elements() if c.tag == "p"]) > 1
        out = {}
        if header:
            out["h"] = 1
        span = int(re.sub(r"\D", "", cell.get("colspan") or "1") or 1)
        down = int(re.sub(r"\D", "", cell.get("rowspan") or "1") or 1)
        if span > 1:
            out["c"] = span
        if down > 1:
            out["r"] = down
        if complex_:
            out["b"] = self.blocks(cell.children)
            return out
        parts = _merge(self.inline(cell))
        if not out:
            return parts
        out["v"] = parts
        return out

    # —— 图片 ——
    def _figure(self, file, width, caption, wide=False):
        if not file or not self.image:
            return None
        from .article import WIDE_LIMIT
        picked = pick_image(self.image, file, width, FIGURE_LIMIT, FIGURE_BYTES, cap=WIDE_LIMIT if wide else IMAGE_LIMIT)
        if not picked:
            return None
        shown = picked[1]
        shipped = ship_image(picked, self.webp, inline=False)
        if not shipped:
            return [None, 0, caption, picked[0]]
        file, full = shipped
        self.used_images.update(x for x in shipped if x)
        if full:
            return [file, min(shown, 640 if wide else 320), caption, full]
        return [file, shown if wide else min(shown, 320), caption]

    def _gallery(self, ul):
        entries = []
        portrait = ul.has_class("portraitgallery")
        for li in ul.find_all("li", "gallerybox"):
            img = li.find("img")
            if not img:
                continue
            text = li.find("div", "gallerytext")
            caption = _merge(self.inline(text)) if text else []
            width = 64 if portrait else (int(img.get("width") or 0) or None)
            entry = self._figure(H.image_file(img), width, caption)
            if entry:
                entries.append(entry)
        return [["g", entries]] if entries else []

    def _thumb(self, node):
        img = node.find("img")
        if not img:
            return self.blocks(node.children)
        caption_node = node.find("div", "thumbcaption") or node.find("figcaption")
        caption = _merge(self.inline(caption_node)) if caption_node else []
        try:
            width = int(img.get("width") or 0) or None
        except ValueError:
            width = None
        entry = self._figure(H.image_file(img), width, caption)
        return [["g", [entry]]] if entry else []


def _cell_text(cell):
    if isinstance(cell, list):
        return _text_of(cell)
    if cell.get("v") is not None:
        return _text_of(cell["v"])
    return " ".join(str(b) for b in cell.get("b") or [])


def _cell_has_image(cell):
    parts = cell if isinstance(cell, list) else cell.get("v") or []
    return any(not isinstance(p, str) and p[0] == "f" for p in parts) or bool(not isinstance(cell, list) and cell.get("b"))
