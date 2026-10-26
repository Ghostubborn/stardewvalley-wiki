"""解析 Wiki 数据模块中的 Lua 表字面量（只支持数据模块用到的子集）。"""

import re

_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_NUMBER_RE = re.compile(r"-?(?:0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)")
_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'", "0": "\0"}


class LuaParser:
    def __init__(self, text):
        self.text = text
        self.pos = 0

    def skip(self):
        text = self.text
        while self.pos < len(text):
            ch = text[self.pos]
            if ch.isspace():
                self.pos += 1
            elif text.startswith("--[[", self.pos):
                end = text.find("]]", self.pos + 4)
                self.pos = len(text) if end < 0 else end + 2
            elif text.startswith("--", self.pos):
                end = text.find("\n", self.pos)
                self.pos = len(text) if end < 0 else end + 1
            else:
                break

    def peek(self, token):
        self.skip()
        return self.text.startswith(token, self.pos)

    def expect(self, token):
        if not self.peek(token):
            raise ValueError(f"expected {token!r} at {self.pos}: {self.text[self.pos:self.pos + 40]!r}")
        self.pos += len(token)

    def value(self):
        self.skip()
        text = self.text
        ch = text[self.pos]
        if ch == "{":
            return self.table()
        if ch in "\"'":
            return self.string()
        if text.startswith("[[", self.pos):
            end = text.index("]]", self.pos)
            result = text[self.pos + 2:end]
            self.pos = end + 2
            return result
        for word, result in (("true", True), ("false", False), ("nil", None)):
            if text.startswith(word, self.pos) and not text[self.pos + len(word):self.pos + len(word) + 1].isalnum():
                self.pos += len(word)
                return result
        match = _NUMBER_RE.match(text, self.pos)
        if match:
            self.pos = match.end()
            raw = match.group(0)
            if raw.lower().startswith(("0x", "-0x")):
                return int(raw, 16)
            return float(raw) if any(c in raw for c in ".eE") else int(raw)
        raise ValueError(f"unexpected value at {self.pos}: {text[self.pos:self.pos + 40]!r}")

    def string(self):
        quote = self.text[self.pos]
        self.pos += 1
        out = []
        text = self.text
        while True:
            ch = text[self.pos]
            if ch == quote:
                self.pos += 1
                return "".join(out)
            if ch == "\\":
                nxt = text[self.pos + 1]
                out.append(_ESCAPES.get(nxt, nxt))
                self.pos += 2
                continue
            out.append(ch)
            self.pos += 1

    def table(self):
        self.expect("{")
        result = {}
        positional = 1
        while True:
            self.skip()
            if self.peek("}"):
                self.pos += 1
                break
            if self.peek("[") and not self.text.startswith("[[", self.pos):
                self.pos += 1
                key = self.value()
                self.expect("]")
                self.expect("=")
                result[key] = self.value()
            else:
                match = _NAME_RE.match(self.text, self.pos)
                after = self.text[match.end():].lstrip() if match else ""
                if match and after.startswith("=") and not after.startswith("=="):
                    self.pos = match.end()
                    self.expect("=")
                    result[match.group(0)] = self.value()
                else:
                    result[positional] = self.value()
                    positional += 1
            self.skip()
            if self.peek(",") or self.peek(";"):
                self.pos += 1
        if result and all(isinstance(k, int) for k in result) and list(result) == list(range(1, len(result) + 1)):
            return list(result.values())
        if not result:
            return []
        return result


def parse_module(text):
    """返回模块里第一个顶层表构造式（`return {...}` 或 `local x = {...}`）。"""
    match = re.search(r"(?:^|\n)\s*(?:return|local\s+\w+\s*=)\s*\{", text)
    if not match:
        raise ValueError("no table constructor found")
    parser = LuaParser(text)
    parser.pos = match.end() - 1
    return parser.table()
