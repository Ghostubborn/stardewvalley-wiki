"""Wikitext 解析工具：模板、链接、表格、章节与纯文本渲染。

只覆盖星露谷 Wiki 条目里实际出现的写法，目标是稳定抽取结构，不追求完整 MediaWiki 语义。
"""

import html
import re

LANG_CODES = {"de", "en", "es", "fr", "it", "ja", "ko", "hu", "pt", "ru", "tr", "zh"}
FILE_PREFIXES = ("file:", "image:", "文件:", "图像:", "media:")
CATEGORY_PREFIXES = ("category:", "分类:", "分類:")

_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_REF_RE = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", re.S | re.I)
_HEADING_RE = re.compile(r"^(={2,6})\s*(.+?)\s*\1\s*$", re.M)


def strip_comments(text):
    return _COMMENT_RE.sub("", text)


def _match_close(text, start, open_tok, close_tok):
    """从 start 处的 open_tok 起找到配对的结束位置（返回结束后的下标）。"""
    depth = 0
    i = start
    n = len(text)
    while i < n:
        if text.startswith(open_tok, i):
            depth += 1
            i += len(open_tok)
        elif text.startswith(close_tok, i):
            depth -= 1
            i += len(close_tok)
            if depth == 0:
                return i
        else:
            i += 1
    return n


def iter_templates(text):
    """遍历顶层模板，返回 (raw, start, end)。跳过 {{{参数}}}。"""
    i = 0
    n = len(text)
    while True:
        i = text.find("{{", i)
        if i < 0 or i >= n:
            return
        if text.startswith("{{{", i):
            end = _match_close(text, i, "{{{", "}}}")
            i = end
            continue
        end = _match_close(text, i, "{{", "}}")
        yield text[i:end], i, end
        i = end


def split_top(body, sep="|"):
    """按顶层分隔符切分，忽略模板、链接和表格内部的分隔符。"""
    parts = []
    depth_t = depth_l = 0
    cur = []
    i = 0
    n = len(body)
    while i < n:
        if body.startswith("{{", i):
            depth_t += 1
            cur.append("{{")
            i += 2
        elif body.startswith("}}", i) and depth_t:
            depth_t -= 1
            cur.append("}}")
            i += 2
        elif body.startswith("[[", i):
            depth_l += 1
            cur.append("[[")
            i += 2
        elif body.startswith("]]", i) and depth_l:
            depth_l -= 1
            cur.append("]]")
            i += 2
        elif body.startswith(sep, i) and depth_t == 0 and depth_l == 0:
            parts.append("".join(cur))
            cur = []
            i += len(sep)
        else:
            cur.append(body[i])
            i += 1
    parts.append("".join(cur))
    return parts


def parse_template(raw):
    """把 {{name|a|k=v}} 解析成 (规范化名称, 参数字典)。位置参数用 '1'、'2'…"""
    body = raw[2:-2] if raw.endswith("}}") else raw[2:]
    parts = split_top(body)
    name = parts[0].strip()
    args = {}
    pos = 1
    for part in parts[1:]:
        key, eq, value = part.partition("=")
        if eq and "{{" not in key and "[[" not in key and "\n" not in key.strip():
            args[key.strip()] = value.strip()
        else:
            args[str(pos)] = part.strip()
            pos += 1
    return normalize_name(name), args


def normalize_name(name):
    name = name.replace("_", " ").strip()
    if not name:
        return name
    if name.startswith(":"):
        return name
    return (name[0].upper() + name[1:]) if name[0].isascii() else name


def templates(text, wanted=None):
    """返回所有（含嵌套）模板 [(name, args, raw)]；wanted 为名称集合（规范化后比较，忽略大小写）。"""
    wanted_l = {w.lower() for w in wanted} if wanted else None
    out = []
    stack = [text]
    while stack:
        chunk = stack.pop()
        for raw, _, _ in iter_templates(chunk):
            name, args = parse_template(raw)
            if wanted_l is None or name.lower() in wanted_l:
                out.append((name, args, raw))
            inner = raw[2:-2]
            if "{{" in inner:
                stack.append(inner)
    return out


def first_template(text, prefix):
    """返回第一个名称以 prefix 开头的顶层模板。"""
    prefix_l = prefix.lower()
    for raw, start, end in iter_templates(text):
        name, args = parse_template(raw)
        if name.lower().startswith(prefix_l):
            return name, args, raw, start, end
    return None


def iter_links(text):
    """遍历 [[目标|显示]] 链接，返回 (target, label, raw)。"""
    i = 0
    while True:
        i = text.find("[[", i)
        if i < 0:
            return
        end = _match_close(text, i, "[[", "]]")
        raw = text[i:end]
        inner = raw[2:-2]
        parts = split_top(inner)
        target = parts[0].strip()
        label = parts[-1].strip() if len(parts) > 1 else None
        yield target, label, raw
        i = end


def classify_link(target):
    low = target.lower().lstrip(":")
    if low.startswith(FILE_PREFIXES):
        return "file"
    if low.startswith(CATEGORY_PREFIXES):
        return "category"
    head = low.split(":", 1)[0]
    if ":" in low and head in LANG_CODES:
        return "interlanguage"
    if ":" in low and head in {"wikipedia", "w", "wikt", "mw", "modding"}:
        return "interwiki"
    return "page"


def page_title(target):
    title = target.lstrip(":").split("#", 1)[0].replace("_", " ").strip()
    if title and title[0].isascii():
        title = title[0].upper() + title[1:]
    return title


def categories(text):
    out = []
    for target, _, _ in iter_links(text):
        if classify_link(target) == "category":
            name = target.split(":", 1)[1].split("|", 1)[0].strip()
            if name and name not in out:
                out.append(name)
    return out


def interlanguage(text):
    out = {}
    for target, label, _ in iter_links(text):
        if classify_link(target) == "interlanguage" and not target.startswith(":"):
            lang, _, title = target.partition(":")
            out.setdefault(lang.strip().lower(), title.strip())
    return out


def page_links(text):
    out = []
    for target, _, _ in iter_links(text):
        if classify_link(target) == "page":
            title = page_title(target)
            if title and title not in out:
                out.append(title)
    return out


def files(text):
    out = []
    for target, _, _ in iter_links(text):
        if classify_link(target) == "file":
            name = target.split(":", 1)[1].strip()
            if name and name not in out:
                out.append(name)
    return out


def sections(text):
    """按二级及以下标题切分，返回 [{level, title, body}]，第一个为导言（level 1）。"""
    out = []
    last = 0
    last_title = None
    last_level = 1
    for match in _HEADING_RE.finditer(text):
        out.append({"level": last_level, "title": last_title, "body": text[last:match.start()]})
        last_level = len(match.group(1))
        last_title = match.group(2).strip()
        last = match.end()
    out.append({"level": last_level, "title": last_title, "body": text[last:]})
    return out


def wikitables(text):
    """解析 {| … |} 表格为行列表；每个单元格为 {'header': bool, 'text': 原始 wikitext, 'attrs': str}。"""
    tables = []
    i = 0
    while True:
        start = text.find("{|", i)
        if start < 0:
            return tables
        end = _match_close(text, start, "{|", "|}")
        tables.append(_parse_table(text[start:end]))
        i = end


def _split_cell(raw):
    parts = split_top(raw)
    if len(parts) > 1 and "=" in parts[0] and "[[" not in parts[0] and "{{" not in parts[0]:
        return parts[0].strip(), "|".join(parts[1:]).strip()
    return "", raw.strip()


def _parse_table(raw):
    body = raw[2:-2]
    lines = body.split("\n")
    attrs = lines[0].strip()
    rows = []
    cur = []
    caption = None
    buf = None
    nested = 0

    def flush():
        nonlocal buf
        if buf is not None:
            header, content = buf
            cell_attrs, cell_text = _split_cell(content)
            cur.append({"header": header, "text": cell_text, "attrs": cell_attrs})
            buf = None

    for line in lines[1:]:
        stripped = line.strip()
        if nested:
            buf = (buf[0], buf[1] + "\n" + line) if buf else (False, line)
            nested += line.count("{|") - line.count("|}")
            continue
        if stripped.startswith("{|"):
            nested = 1 + stripped.count("{|") - 1 - stripped.count("|}")
            buf = (buf[0], buf[1] + "\n" + line) if buf else (False, line)
            continue
        if stripped.startswith("|+"):
            flush()
            caption = stripped[2:].strip()
        elif stripped.startswith("|-"):
            flush()
            if cur:
                rows.append(cur)
            cur = []
        elif stripped.startswith("!"):
            flush()
            for piece in split_top(stripped[1:], "!!"):
                for sub in split_top(piece, "||"):
                    buf = (True, sub)
                    flush()
        elif stripped.startswith("|"):
            flush()
            pieces = split_top(stripped[1:], "||")
            for piece in pieces[:-1]:
                buf = (False, piece)
                flush()
            buf = (False, pieces[-1])
        else:
            if buf is not None:
                buf = (buf[0], buf[1] + "\n" + line)
    flush()
    if cur:
        rows.append(cur)
    return {"attrs": attrs, "caption": caption, "rows": rows}


_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
_BR_RE = re.compile(r"<br\s*/?>", re.I)


class Renderer:
    """把 wikitext 渲染为纯文本。template_handlers: {小写模板名: fn(args) -> str}。"""

    def __init__(self, template_handlers=None):
        self.handlers = template_handlers or {}

    def render(self, text):
        if not text:
            return ""
        text = strip_comments(text)
        text = _REF_RE.sub("", text)
        text = self._templates(text)
        text = self._links(text)
        text = re.sub(r"'''''(.*?)'''''", r"\1", text)
        text = re.sub(r"'''(.*?)'''", r"\1", text)
        text = re.sub(r"''(.*?)''", r"\1", text)
        text = _BR_RE.sub("\n", text)
        text = _TAG_RE.sub("", text)
        text = re.sub(r"__[A-Z]+__", "", text)
        text = html.unescape(text)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n\s*\n+", "\n", text)
        return text.strip()

    def _templates(self, text):
        out = []
        last = 0
        for raw, start, end in iter_templates(text):
            out.append(text[last:start])
            name, args = parse_template(raw)
            handler = self.handlers.get(name.lower())
            if handler:
                rendered = handler(args)
            else:
                rendered = ""
            out.append(self._templates(rendered) if rendered and "{{" in rendered else (rendered or ""))
            last = end
        out.append(text[last:])
        return "".join(out)

    def _links(self, text):
        out = []
        last = 0
        i = 0
        while True:
            i = text.find("[[", last)
            if i < 0:
                break
            end = _match_close(text, i, "[[", "]]")
            out.append(text[last:i])
            raw = text[i:end]
            parts = split_top(raw[2:-2])
            target = parts[0].strip()
            kind = classify_link(target)
            if kind == "page" or kind == "interwiki" or target.startswith(":"):
                label = parts[-1] if len(parts) > 1 else target.split("#")[0].lstrip(":")
                if kind == "interwiki" and len(parts) == 1:
                    label = target.split(":", 1)[-1]
                out.append(self._links(label))
            last = end
        out.append(text[last:])
        joined = "".join(out)
        # 外部链接 [url 文本]
        return re.sub(r"\[(?:https?:)?//[^\s\]]+\s*([^\]]*)\]", r"\1", joined)
