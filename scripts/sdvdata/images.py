"""Resolve archived item artwork without inventing filenames or downloading substitutes."""

import re

# The snapshot's composite IDs aren't all real registry parent IDs (398, for
# example, means dried fruit in those composite records but grape on its own).
# Map the archived product family explicitly instead of borrowing any parent icon.
FAMILY_IMAGES = {
    "(O)340": ("Honey.png", "蜂蜜"), "(O)342": ("Pickles.png", "腌菜"),
    "(O)344": ("Jelly.png", "果酱"), "(O)348": ("Wine.png", "果酒"),
    "(O)350": ("Juice.png", "果汁"), "(O)398": ("Dried_Fruit.png", "水果干"),
    "(O)447": ("Aged_Roe.png", "腌鱼籽"), "(O)812": ("Roe.png", "鱼籽"),
    "(O)DriedMushrooms": ("Dried_Mushrooms.png", "蘑菇干"),
    "(O)SmokedFish": ("Smoked_Fish.png", "熏鱼"),
    "(O)SpecificBait": ("Bait.png", "鱼饵"),
    "(O)79": ("Secret_Note_Icon.png", "纸条"), "(O)842": ("Journal_Scrap.png", "日记残页"),
}

class ImageResolver:
    def __init__(self, images, clothing_table=""):
        self.files = {self.key(meta["file"]): meta["file"] for meta in images.values()}
        self.clothing = {}
        for filename, name in re.findall(r"\[\[File:([^\]|]+)(?:\|[^\]]*)?\]\]\s*\|\|\s*([^|\n]+)\s*\|\|", clothing_table):
            self.clothing.setdefault(name.strip().casefold(), set()).add(filename)

    @staticmethod
    def key(name):
        return name.strip().replace(" ", "_").casefold()

    def find(self, *names):
        for name in names:
            if not name:
                continue
            name = name.strip()
            if not re.search(r"\.(png|gif|jpe?g|webp|svg)$", name, re.I):
                name += ".png"
            for candidate in (name, name.replace("#", "")):
                hit = self.files.get(self.key(candidate))
                if hit:
                    return hit
        return None

    def for_item(self, item, pages, redirects):
        """Return filename, provenance type, and an optional user-facing illustration note."""
        name, raw, kind = item["en"], item["id"].split(")", 1)[1], item["type"]
        hit = self.find(name, redirects.get(name))
        if hit:
            return hit, "exact", None
        # These indexed files are listed in the archived Tailoring / Wallpaper / Flooring tables.
        indexed = None
        if kind in {"S", "P"}:
            matches = self.clothing.get(name.casefold(), set())
            if len(matches) == 1 and (hit := self.find(next(iter(matches)))):
                return hit, "clothing-table", None
        if raw.isdigit():
            number = int(raw)
            if kind == "S" and 1000 <= number < 2000:
                # 有两种配色的上衣只存了“Shirt259a.png”“Shirt259b.png”。
                indexed = f"Shirt{number - 1000:03}.png"
                if not self.find(indexed):
                    indexed = f"Shirt{number - 1000:03}a.png"
            elif kind == "O" and self.find(f"Springobjects{number:03}.png"):
                # Wiki 用游戏贴图的编号文件（Springobjects071.png）配图的物品，如镶边幸运紫色短裤。
                indexed = f"Springobjects{number:03}.png"
            elif kind == "WP":
                indexed = f"Wallpaper_{number + 1:03}_Icon.png"
            elif kind == "FL":
                # Wiki's catalogue gallery lists 01–56, 66–97, then the MoreFloors set 57–65.
                indexed = f"Flooring_{number + (1 if number < 56 else 10):02}_Icon.png"
        elif kind == "WP" and re.fullmatch(r"MoreWalls:\d+", raw):
            indexed = f"Wallpaper_{113 + int(raw.split(':')[1]):03}_Icon.png"
        elif kind == "FL" and re.fullmatch(r"MoreFloors:\d+", raw):
            indexed = f"Flooring_{57 + int(raw.split(':')[1]):02}_Icon.png"
        hit = self.find(indexed)
        if hit:
            return hit, "indexed", None
        if kind == "T" and name.endswith(" Trash Can"):
            hit = self.find("Trash Can " + name.removesuffix(" Trash Can"))
            if hit:
                return hit, "tool-table", None
        aliases = {"Bait (item)": "Bait.png", "Lost Axe": "Robins_Lost_Axe.png", "Wild Honey": "Honey.png",
                   "Artifact Spot": "Artifact_tile.gif", "SeedSpot": "Seed_Spot.gif",
                   # 同一张贴图的裤子版本（镶边幸运紫色短裤）与 Wiki 补给箱的三种外观。
                   "Trimmed Lucky Purple Shorts": "Springobjects071.png"}
        aliases.update({f"(O){922 + i}": f"Supply_Crate_{i + 1}.png" for i in range(3)})
        hit = self.find(aliases.get(name) or aliases.get(item["id"]) or (raw if not raw.isdigit() else None))
        if hit:
            return hit, "alias", None
        page = pages.get(item.get("page")) or {}
        hit = self.find(page.get("image"))
        if hit:
            note = "同类物品示意图" if page.get("item_id") != item["id"] else None
            return hit, "page", note
        return None, "missing", None

    def resolve_items(self, items, pages, redirects):
        for item in items:
            item["image"], item["image_kind"], item["image_note"] = self.for_item(item, pages, redirects)
        # Flavoured jelly, wine, juice, dried produce and roe use the parent product illustration.
        # Keep the exact ingredient/name and explicitly mark this as a family illustration.
        for item in items:
            if item["image"] or not item.get("made_by"):
                continue
            family = FAMILY_IMAGES.get(item["made_by"])
            if family and (image := self.find(family[0])):
                item.update(image=image, image_kind="family", image_note=f"{family[1]}类通用图标")
