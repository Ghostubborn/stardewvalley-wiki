"""Regression cases for Wiki map templates: python3 -I scripts/test_map_parser.py."""
import runpy
from pathlib import Path

Builder = runpy.run_path(str(Path(__file__).with_name("build_data.py")))["Builder"]
parse = lambda text: Builder._map_pins(None, text)

both = parse("{{Map|275|200|loc2x=120|loc2y=150|island=true|islandloc1x=68|islandloc1y=175}}")
assert [(p["map"], p["x"], p["y"]) for p in both] == [
    ("valley", 275, 200), ("valley", 120, 150), ("island", 68, 175)]
island = parse("{{Map|main=false|island=true|islandloc1x=195|islandloc1y=135}}")
assert len(island) == 1 and island[0]["map"] == "island"
small = parse("{{Map|360|214|island=small}}")
assert small[0]["map"] == "island_small"
scaled = parse("{{Map|50.5|20|200}}")
assert scaled[0]["width"] == 200 and scaled[0]["x"] == 50.5
assert parse("{{Map|10|20|0}}") == []
assert parse("{{Map|island=true}}") == [], "Missing coordinates must not create a point at (0,0)"
print("Map parser checks passed: both maps, display width, fractional offsets, omitted and invalid coordinates.")
