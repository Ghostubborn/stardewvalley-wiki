"""Verify meaningful timetable facts and do not accept unrelated wiki tables."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_schedules", ROOT / "scripts/build_schedules.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
data = mod.build(ROOT)

abigail = data["阿比盖尔"]["groups"]
assert {"spring", "summer", "fall", "winter", "marriage"} <= {g["season"] for g in abigail}
rain = [g for g in abigail if g["season"] == "fall" and "雨天" in g["label"]]
assert len(rain) == 2, "Rain alternatives must remain separate"
assert any(r["time"] == "14:50" and "星之果实酒吧" in r["text"] for g in rain for r in g["rows"])
clinic = [g for g in abigail if "春季4日" == g["label"]]
assert clinic and any("哈维的诊所" in r["links"] for r in clinic[0]["rows"])
assert any("星期二" in g["label"] or "周二" in g["label"] for g in data["罗宾"]["groups"])
assert any("秋季18日" in g["label"] for g in data["玛妮"]["groups"])
assert not data["马龙"]["groups"] and any("柜台" in p for p in data["马龙"]["notes"]), "Stationary NPC source notes should remain available"
assert all(g["rows"] and g["label"] for s in data.values() for g in s["groups"])
assert all(600 <= r["at"] <= 2659 for s in data.values() for g in s["groups"] for r in g["rows"])
assert any(r["at"] >= 2400 for s in data.values() for g in s["groups"] for r in g["rows"]), "After-midnight times must stay on the same game day"
assert "祝尼魔" not in data, "Unrelated data must not become a timetable"
print(f"Schedule extraction passed: {len(data)} villagers, source labels, rain alternatives, clinic, weekdays, midnight, and references.")
