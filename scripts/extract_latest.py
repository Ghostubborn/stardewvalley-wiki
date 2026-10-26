"""从 WikiTeam 全量修订 XML 中流式抽取每个页面的最新修订。

WikiTeam 的 xmlrevisions 模式会把同一页面按修订分段写成多个 <page>，
因此按页面 ID 合并，只保留修订号最大的版本。

用法：python3 -I scripts/extract_latest.py <history.xml> <输出 pages.jsonl> <站点标签>
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter

NS = "{http://www.mediawiki.org/xml/export-0.11/}"
REDIRECT_RE = re.compile(r"^\s*#\s*(?:REDIRECT|重定向|重新導向)\s*:?\s*\[\[([^\]|#]+)(?:#([^\]|]*))?", re.IGNORECASE)


def main(src, dest, site):
    pages = {}
    rev_counts = Counter()
    for _, elem in ET.iterparse(src, events=("end",)):
        if elem.tag != NS + "page":
            continue
        page_id = int(elem.findtext(NS + "id"))
        current = pages.get(page_id)
        for rev in elem.iter(NS + "revision"):
            rev_counts[page_id] += 1
            rev_id = int(rev.findtext(NS + "id") or 0)
            if current is not None and rev_id <= current["rev_id"]:
                continue
            text = rev.findtext(NS + "text") or ""
            match = REDIRECT_RE.match(text)
            current = {
                "site": site,
                "ns": int(elem.findtext(NS + "ns")),
                "title": elem.findtext(NS + "title"),
                "page_id": page_id,
                "rev_id": rev_id,
                "timestamp": rev.findtext(NS + "timestamp"),
                "redirect": match.group(1).strip().replace("_", " ") if match else None,
                "redirect_fragment": match.group(2) if match and match.group(2) else None,
                "sha1": rev.findtext(NS + "sha1"),
                "text": text,
            }
        if current is not None:
            pages[page_id] = current
        elem.clear()

    by_ns = Counter()
    with open(dest, "w", encoding="utf-8") as out:
        for page_id in sorted(pages):
            record = pages[page_id]
            record["rev_count"] = rev_counts[page_id]
            by_ns[record["ns"]] += 1
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(json.dumps({"site": site, "pages": len(pages),
                      "redirects": sum(1 for r in pages.values() if r["redirect"]),
                      "by_ns": dict(sorted(by_ns.items()))}, ensure_ascii=False))


if __name__ == "__main__":
    main(*sys.argv[1:4])
