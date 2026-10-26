"""Verify that every basics answer retains its exact archived source revision.

Does not rebuild prototype/data.js or touch generated assets.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / "data/curated/guides.json").read_text())
expected = {"新手指南", "控制", "物品栏", "游戏内时间", "季节", "天气", "能量", "生命值", "技能", "钓鱼攻略", "友谊", "合作", "存档"}
assert set(data["entries"]) == expected, "The thirteen existing basics entries must all have an answer"
pages = {row["title"] for row in json.loads((ROOT / "data/build/pages.json").read_text())}
assert expected <= pages, "A guide must open through an existing page entry"

raw = {}
for language in ("zh", "en"):
    for line in (ROOT / f"data/wiki/{language}-pages.jsonl").open():
        record = json.loads(line)
        key = (language, record["title"])
        if record["title"] in data["sources"] and record["ns"] == 0:
            raw[key] = record

for title, source in data["sources"].items():
    language = "en" if source["localSource"].endswith("en-pages.jsonl") else "zh"
    original = raw[(language, title)]
    assert original["rev_id"] == source["revisionId"], title
    assert original["timestamp"] == source["revisionAt"], title
    assert original["sha1"] == source["sourceSha1"], title
    assert hashlib.sha256(original["text"].encode()).hexdigest() == source["textSha256"], title
    assert source["url"].startswith("https://") and source["archiveUrl"].startswith("https://archive.org/"), title

for title, entry in data["entries"].items():
    assert entry["title"] == title and entry["summary"] and entry["verifiedAt"], title
    assert all(name in expected for name in entry["related"]), title
    sections = entry["sections"] + [s for platform in entry.get("platforms", []) for s in platform["sections"]]
    referenced = {name for section in sections for name in section["sources"]}
    assert referenced == set(entry["sources"]), title
    assert referenced <= data["sources"].keys(), title
    for section in sections:
        assert section["heading"] and section["sources"], title
        assert any(section.get(field) for field in ("paragraphs", "steps", "bullets", "facts")), title
    # Basics should not reveal later regions, story rewards, or puzzle solutions.
    visible = json.dumps({"summary": entry["summary"], "sections": sections}, ensure_ascii=False)
    for hidden in ("姜岛", "齐先生", "精通山洞", "电影院", "金色核桃", "爷爷的评价"):
        assert hidden not in visible, f"{title}: later content appeared in a basics answer: {hidden}"

print(f"Guides verified: {len(expected)} answers, {len(data['sources'])} exact archived revisions, complete per-section attribution.")
