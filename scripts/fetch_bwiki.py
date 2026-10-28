"""从星露谷物语 BWIKI（wiki.biligame.com/stardewvalley）抓取每个页面的最新修订。

中文编辑团队 2024 年 10 月起在 BWIKI 编辑，官方中文 Wiki 的内容落后于它（见 data/README.md）。
只走 MediaWiki API（robots.txt 没有禁止 api.php），每次请求间隔 1 秒，每批 50 页。

输出：
  data/raw/bwiki-<日期>/siteinfo.json   站点信息与统计
  data/raw/bwiki-<日期>/pages.jsonl     API 原样的修订记录
  data/wiki/zh-pages.jsonl              与 extract_latest.py 相同的格式，供 build_data.py 等读取

用法：python3 -I scripts/fetch_bwiki.py [日期，默认今天] [--offline | --html [--only 条目清单文件] [--delay 秒]]
  --offline  不联网，只用已有的 data/raw/bwiki-<日期>/pages.jsonl 重新生成 zh-pages.jsonl
  --html     抓取每个条目渲染后的 HTML（action=parse），写入 data/raw/bwiki-<日期>/html.jsonl；
             可以中断后重跑，已抓过的修订会跳过。条目正文由 build_articles.py 从这里转换：BWIKI 的
             日程、对话、任务、配方行等由 Lua 模块生成，原文里只有模块调用。
  --only     只抓清单里的条目（每行一个，按顺序）；--delay 为两次请求之间的秒数（默认 5）。
             B站对 wiki.biligame.com 连续请求会限流（HTTP 567），被限流时等待后重试，仍被限流就停止。
"""

import datetime
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://wiki.biligame.com/stardewvalley/api.php"
UA = "stardewvalley-wiki-builder/1.0 (+https://stardewvalley-wiki.pages.dev; non-commercial reference site)"
NAMESPACES = (0, 4, 10, 14, 828)  # 条目、站务、模板、分类、模块；不取 SVE、模组分区
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from sdvdata.bwiki import skip_page  # noqa: E402
# BWIKI 的命名空间用中文名；改成官方中文 Wiki 归档里的写法，构建脚本按“Template:Bundle”这类标题取页面。
NS_PREFIX = {10: ("模板:", "Template:"), 14: ("分类:", "Category:")}
REDIRECT_RE = re.compile(r"^\s*#\s*(?:REDIRECT|重定向|重新導向)\s*:?\s*\[\[([^\]|#]+)(?:#([^\]|]*))?", re.IGNORECASE)


def get(params, tries=6):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                data = json.load(r)
            if "error" in data:
                raise RuntimeError(data["error"])
            return data
        except Exception as exc:
            if attempt == tries - 1:
                raise
            # B站的限流返回 567（也可能是 429、503）：等一两分钟再试；其他网络抖动短暂退避。
            limited = getattr(exc, "code", None) in (429, 503, 567)
            wait = 60 * 2 ** attempt if limited else 5 * (attempt + 1)
            print(f"retry in {wait}s after {exc}", file=sys.stderr)
            time.sleep(wait)


def list_pages(ns):
    pages, cont = [], {}
    while True:
        data = get({"action": "query", "list": "allpages", "apnamespace": ns, "aplimit": "max", **cont})
        pages += data["query"]["allpages"]
        if "continue" not in data:
            return pages
        cont = data["continue"]
        time.sleep(1)


def fetch_revisions(page_ids):
    data = get({"action": "query", "prop": "revisions", "pageids": "|".join(map(str, page_ids)),
                "rvprop": "ids|timestamp|sha1|user|content", "rvslots": "main"})
    return data["query"]["pages"]


def fetch(raw_dir):
    os.makedirs(raw_dir, exist_ok=True)
    info = get({"action": "query", "meta": "siteinfo", "siprop": "general|statistics"})
    info["fetched"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    with open(os.path.join(raw_dir, "siteinfo.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, ensure_ascii=False, indent=1)
    listed = []
    for ns in NAMESPACES:
        listed += list_pages(ns)
        time.sleep(1)
    print(f"{len(listed)} pages listed", file=sys.stderr)
    with open(os.path.join(raw_dir, "pages.jsonl"), "w", encoding="utf-8") as raw:
        for i in range(0, len(listed), 50):
            for page in fetch_revisions([p["pageid"] for p in listed[i:i + 50]]):
                raw.write(json.dumps(page, ensure_ascii=False) + "\n")
            print(f"{min(i + 50, len(listed))}/{len(listed)}", file=sys.stderr)
            time.sleep(1)


def convert(raw_dir):
    records = []
    with open(os.path.join(raw_dir, "pages.jsonl"), encoding="utf-8") as raw:
        for line in raw:
            page = json.loads(line)
            rev = (page.get("revisions") or [None])[0]
            if not rev:
                continue
            text = rev["slots"]["main"].get("content", "")
            title = page["title"]
            zh_prefix, prefix = NS_PREFIX.get(page["ns"], (None, None))
            if zh_prefix and title.startswith(zh_prefix):
                title = prefix + title[len(zh_prefix):]
            match = REDIRECT_RE.match(text)
            records.append({
                "site": "zh", "ns": page["ns"], "title": title, "page_id": page["pageid"],
                "rev_id": rev["revid"], "timestamp": rev["timestamp"],
                "redirect": match.group(1).strip().replace("_", " ") if match else None,
                "redirect_fragment": match.group(2) if match and match.group(2) else None,
                "sha1": rev.get("sha1"), "text": text, "source": "bwiki",
            })
    records.sort(key=lambda r: r["page_id"])
    with open(os.path.join(ROOT, "data", "wiki", "zh-pages.jsonl"), "w", encoding="utf-8") as out:
        for record in records:
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
    by_ns = {}
    for r in records:
        by_ns[r["ns"]] = by_ns.get(r["ns"], 0) + 1
    print(json.dumps({"pages": len(records), "redirects": sum(1 for r in records if r["redirect"]),
                      "by_ns": dict(sorted(by_ns.items())),
                      "latest_edit": max(r["timestamp"] for r in records)}, ensure_ascii=False))


def fetch_html(raw_dir, only=None, delay=5):
    """逐个条目取渲染后的正文；以 zh-pages.jsonl 的修订号为准，修订没变的不重抓。"""
    path = os.path.join(raw_dir, "html.jsonl")
    done = set()
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            done = {(r["page_id"], r["rev_id"]) for r in map(json.loads, fh)}
    with open(os.path.join(ROOT, "data", "wiki", "zh-pages.jsonl"), encoding="utf-8") as fh:
        rows = [r for r in map(json.loads, fh) if r["ns"] == 0 and not r["redirect"]]
    texts = {r["title"]: r["text"] for r in rows}
    if only is not None:
        by_title = {r["title"]: r for r in rows}
        rows = [by_title[t] for t in only if t in by_title]
    todo = [r for r in rows if not skip_page(r["title"], r["text"], texts.get(r["title"].rsplit("/", 1)[0]))
            and (r["page_id"], r["rev_id"]) not in done]
    print(f"{len(done)} done, {len(todo)} to fetch", file=sys.stderr)
    with open(path, "a", encoding="utf-8") as out:
        for i, r in enumerate(todo, 1):
            data = get({"action": "parse", "pageid": r["page_id"], "prop": "text|sections|displaytitle",
                        "disableeditsection": 1, "disablelimitreport": 1, "disabletoc": 1}, tries=3)["parse"]
            out.write(json.dumps({"page_id": r["page_id"], "rev_id": data.get("revid", r["rev_id"]), "title": r["title"],
                                  "displaytitle": data.get("displaytitle"), "sections": data.get("sections", []),
                                  "html": data["text"]}, ensure_ascii=False) + "\n")
            out.flush()
            if i % 10 == 0:
                print(f"{i}/{len(todo)}", file=sys.stderr)
            # 渲染请求较重；间隔 1～3 秒连续几百次会被 B站限流（567），默认 5 秒。
            time.sleep(delay)


def main(*args):
    day = next((a for a in args if re.fullmatch(r"\d{4}-\d{2}-\d{2}", a)), None) or datetime.date.today().isoformat()
    raw_dir = os.path.join(ROOT, "data", "raw", "bwiki-" + day.replace("-", ""))
    if "--html" in args:
        only, delay = None, 5
        if "--only" in args:
            with open(args[args.index("--only") + 1], encoding="utf-8") as fh:
                only = [line.strip() for line in fh if line.strip()]
        if "--delay" in args:
            delay = float(args[args.index("--delay") + 1])
        fetch_html(raw_dir, only, delay)
        return
    if "--offline" not in args:
        fetch(raw_dir)
    convert(raw_dir)


if __name__ == "__main__":
    main(*sys.argv[1:])
