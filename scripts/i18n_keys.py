"""List the Chinese UI strings that the front end passes to t(), plus labels that are
translated dynamically (categories, kinds, weekdays). Used to keep data/i18n/ui.en.json complete.

Usage: python3 -I scripts/i18n_keys.py [--missing]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, "prototype", "js")
CJK = re.compile(r"[㐀-鿿]")
CALL = re.compile(r"(?<![\w$.])(?:App\.|A\.|window\.App\?\.)?t\(")
STRING = re.compile(r'"((?:[^"\\\n]|\\.)*)"')

# Translated with t(variable): item categories, page kinds, field labels, weekdays and other data labels.
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from sdvdata.catalog import ITEM_TYPES, OBJECT_CATEGORIES  # noqa: E402

DYNAMIC = [
    *OBJECT_CATEGORIES.values(), *ITEM_TYPES.values(),
    "物品", "料理", "家具", "帽子", "鱼", "种子", "作物", "武器", "服饰", "怪物", "矿物", "居民", "人物", "地点", "古物",
    "建筑", "工具", "动物", "果树", "树木", "商店", "任务", "节日", "成就", "技能", "消歧义", "玩法", "条目",
    "来源", "季节", "时间", "天气", "配方", "材料", "售价", "营业时间", "休息", "地址", "生日", "可结婚", "生长", "产出",
    "加工设备", "耗时", "增益", "能量",
    "周日", "周一", "周二", "周三", "周四", "周五", "周六", "周二随机供应",
    "起步", "日常", "探索", "一起玩", "查阅",
    "第一天从哪里开始？", "移动、使用工具与菜单操作", "携带、整理和使用物品", "一天怎样安排？", "换季前需要了解什么？",
    "天气会影响哪些活动？", "体力如何消耗与恢复？", "受伤和恢复的规则", "经验、等级与职业选择", "抛竿和收鱼怎样操作？",
    "聊天和送礼的基本规则", "多人农场与合作方式", "进度怎样保存？",
    "{n} 件", "{n} 层",
]


def call_args(src, start):
    """Return the text of the call's first argument, starting just after "t(" ."""
    depth, i, n, first_end = 0, start, len(src), None
    while i < n:
        ch = src[i]
        if ch in "\"'`":
            quote = ch
            i += 1
            while i < n and src[i] != quote:
                i += 2 if src[i] == "\\" else 1
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                return src[start:first_end or i]
            depth -= 1
        elif ch == "," and depth == 0 and first_end is None:
            first_end = i
        i += 1
    return src[start:]


def keys():
    found = {}
    for name in sorted(os.listdir(JS)):
        if not name.endswith(".js"):
            continue
        src = open(os.path.join(JS, name), encoding="utf-8").read()
        for m in CALL.finditer(src):
            arg = call_args(src, m.end())
            for s in STRING.findall(arg):
                s = json.loads('"' + s + '"')
                if CJK.search(s):
                    found.setdefault(s, name)
    for s in DYNAMIC:
        found.setdefault(s, "(dynamic)")
    return found


if __name__ == "__main__":
    k = keys()
    path = os.path.join(ROOT, "data", "i18n", "ui.en.json")
    have = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    if "--missing" in sys.argv:
        missing = [s for s in k if s not in have]
        print(json.dumps(missing, ensure_ascii=False, indent=1))
        print(len(missing), "missing of", len(k), file=sys.stderr)
    else:
        print(len(k))
