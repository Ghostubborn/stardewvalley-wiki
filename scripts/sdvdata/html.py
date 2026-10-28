"""MediaWiki 渲染结果（action=parse 的 HTML）的极简 DOM，只用标准库。

BWIKI 的日程、对话、任务、配方行、鱼塘产物表等由 Lua 模块生成，原文里只有模块调用；构建时读渲染后的 HTML。
"""

import html as _html
import re
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# 遇到这些开始标签时，自动关闭尚未关闭的同类元素（HTML 的隐式结束）。
_IMPLIED = {"p": {"p"}, "li": {"li"}, "tr": {"tr", "td", "th"}, "td": {"td", "th"}, "th": {"td", "th"},
            "dt": {"dt", "dd"}, "dd": {"dt", "dd"}, "option": {"option"}}
_BLOCK_STOP = {"table", "ul", "ol", "dl", "div"}


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag, self.attrs, self.children, self.parent = tag, dict(attrs or {}), [], parent

    # —— 查询 ——
    def get(self, name, default=None):
        return self.attrs.get(name, default)

    @property
    def classes(self):
        return set((self.attrs.get("class") or "").split())

    def has_class(self, *names):
        return bool(self.classes & set(names))

    def iter(self, tag=None):
        for child in self.children:
            if isinstance(child, Node):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.iter(tag)

    def find_all(self, tag=None, cls=None):
        return [n for n in self.iter(tag) if cls is None or cls in n.classes]

    def find(self, tag=None, cls=None):
        return next((n for n in self.iter(tag) if cls is None or cls in n.classes), None)

    def elements(self):
        return [c for c in self.children if isinstance(c, Node)]

    def text(self):
        out = []
        for child in self.children:
            if isinstance(child, Node):
                out.append("\n" if child.tag == "br" else child.text())
            else:
                out.append(child)
        return "".join(out)

    def __repr__(self):
        return f"<{self.tag} {self.attrs}>"


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        closes = _IMPLIED.get(tag)
        if closes:
            node = self.cur
            while node is not self.root and node.tag not in _BLOCK_STOP:
                if node.tag in closes:
                    self.cur = node.parent
                    break
                node = node.parent
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        node = self.cur
        while node is not self.root and node.tag != tag:
            node = node.parent
        if node is not self.root:
            self.cur = node.parent

    def handle_data(self, data):
        if data:
            self.cur.children.append(data)


def parse(markup):
    builder = _Builder()
    builder.feed(markup or "")
    builder.close()
    return builder.root


def clean(text):
    return re.sub(r"\s+", " ", _html.unescape(text or "").replace("\xa0", " ")).strip()


def link_title(a):
    """<a href="/stardewvalley/条目#小节" title="条目"> → (条目, 小节)；站外、红链和文件链接返回 None。"""
    href = a.get("href") or ""
    if not href or a.has_class("external", "new", "image") or "/index.php" in href:
        return None
    title = a.get("title")
    if not title or re.match(r"^(文件|File|分类|Category|模板|Template|模块|Module|特殊|Special|用户|User)[:：]", title):
        return None
    m = re.search(r"#(.+)$", href)
    return title, (_html.unescape(m.group(1)) if m else None)


def image_file(img):
    """<img alt="Dandelion.png" …>：MediaWiki 把文件名写在 alt；没有就从 src 末段取。"""
    alt = (img.get("alt") or "").strip()
    if re.search(r"\.(png|gif|jpe?g|webp)$", alt, re.I):
        return alt.replace("_", " ")
    src = img.get("src") or ""
    m = re.search(r"/(?:\d+px-)?([^/]+\.(?:png|gif|jpe?g|webp))(?:$|\?)", src, re.I)
    return _html.unescape(m.group(1)).replace("_", " ") if m else None


def table_rows(table):
    """表格 → 行（[(单元格节点, 是否表头, 起始列号, 跨列数)]，每列一项），按 rowspan/colspan 展开后定位。"""
    rows, pending = [], {}
    body = [n for n in table.iter("tr") if _owner_table(n) is table]
    for tr in body:
        cells, col = [], 0
        for cell in tr.elements():
            if cell.tag not in ("td", "th"):
                continue
            while col in pending and pending[col][0] > 0:
                cells.append(pending[col][1])
                pending[col] = (pending[col][0] - 1, pending[col][1])
                col += 1
            span = int(re.sub(r"\D", "", cell.get("colspan") or "1") or 1)
            down = int(re.sub(r"\D", "", cell.get("rowspan") or "1") or 1)
            entry = (cell, cell.tag == "th", col, span)
            for k in range(span):
                cells.append(entry)
                if down > 1:
                    pending[col + k] = (down - 1, entry)
            col += span
        while col in pending and pending[col][0] > 0:
            cells.append(pending[col][1])
            pending[col] = (pending[col][0] - 1, pending[col][1])
            col += 1
        rows.append(cells)
    return rows


def _owner_table(node):
    while node is not None and node.tag != "table":
        node = node.parent
    return node
