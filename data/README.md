# 星露谷 Wiki 数据快照

中英文 Wiki 的全站内容，以及由此整理出的结构化数据。原型和后续产品都从这里取数。

## 来源

| 内容 | 来源 | 快照时间 |
| --- | --- | --- |
| 中文 Wiki 全部页面（含修订历史） | [Internet Archive · WikiTeam](https://archive.org/details/wiki-zh.stardewvalleywiki.com_mediawiki-20251218) | 2025-12-18（最新一次编辑 2025-12-17） |
| 英文 Wiki 全部页面与 7,141 张图片 | [Internet Archive · WikiTeam](https://archive.org/details/wiki-stardewvalleywiki.com_mediawiki-20251218) | 2025-12-18 |

没有抓取线上站点。2026-10-22 实测，线上 API 返回 503，`action=raw` 被 Cloudflare 验证页拦截（403），而 `robots.txt` 对 ClaudeBot、GPTBot 等 AI 爬虫是全站禁止的。

中文站不托管图片，图标与地图都使用英文站的文件。两个站点的 siteinfo 声明许可为 **CC BY-NC-SA 3.0**（署名、非商业、相同方式共享），游戏美术版权属于 ConcernedApe。批量复用或商业化之前需要先和站方确认授权，见 `research/README.md` 的授权部分。

## 目录

```text
raw/    归档原件：修订历史 .zst、站点信息、图片（已解压）
wiki/   每个页面的最新修订：zh-pages.jsonl（3,211 页）、en-pages.jsonl（12,476 页）
build/  结构化数据（JSON），manifest.json 记录数量与生成时间
curated/progression.json  人工核对的世界进度门槛，每条附 Wiki 原句
curated/map-positions.json  当前地图底图的示意锚点校准、精度与保护归属
```

`build/` 的主要内容：

| 文件 | 数量 | 说明 |
| --- | --- | --- |
| `items.json` | 2,905 | 全部物品的官方中英文名、描述、售价、分类与礼物偏好（取自中文站 Lua 数据模块；游戏里同名的棕色蛋按显示名键改用 Wiki 名称）。墙纸、地板、纸条和通用上衣按 Wiki 图标编号命名（“壁纸 #13”）；`src` 为合集页表格里的逐件来源；`internal` 标记矿井石头、杂草等地图物件和游戏内部占位；`eat` 为按游戏数据可食用度算出的能量和生命值，物品自己的条目没有写时使用；`mentions` 为没有条目和来源的物品在其他条目里被讲到的句子 |
| `image-coverage.json` | — | 图标匹配来源和未匹配清单；当前 2,771 件物品有图片，134 件未匹配 |
| `pages.json` / `page-text.jsonl` | 1,997 | 中文条目的类型、摘要、信息框字段、章节、链接、地图坐标与纯文本；`src` 为信息框逐条来源（家具、帽子按模板的行），`dr` 为捐赠奖励，`obtain` 为“获取途径”一类章节；`props` 为物品属性：`eat`（能量、生命值，按信息框决定是否分品质）、`buff` 与 `buff_time`、`stats`（戒指、靴子、武器的附加属性）、`weapon`（类型、等级、伤害、暴击率） |
| `recipes.json` | 1,097 | 打造、烹饪、加工、裁缝配方：材料、设备、耗时与解锁条件（技能、好感来信、烹饪频道等）。含按产品系列条目生成的带口味工匠物品加工（368 条），和《裁缝》上衣、下装表的裁缝做法 |
| `tool-chains.json` | 6 | 五种工具的铁匠铺升级链，以及鱼竿各级的购买条件 |
| `buildings.json` | 29 | 建筑造价、材料、工期与升级关系（鸡舍、畜棚、小屋、农舍） |
| `bundles.json` | 7 | 社区中心各房间的收集包、可选数量、奖励与房间奖励 |
| `shops.json` | 21 | 商店库存、价格、以物换物和星期轮换；同时列出购买价与出售价时取购买价，按年份分列的价格取第 1 年，“其他来源”列另存为 `other` |
| `fish.json` 等 | — | 鱼 77、居民 48、地点 48、种子 69、作物 56、树 15、怪物 58、动物 11、矿物与古物 99。鱼另有逐条的时段与天气（例外条目不参与结构化解析）、传说鱼导言里的特殊要求、夜市潜艇出现率和蟹笼水体。怪物另有信息框的基础数值 `stats`、按原顺序的掉落物与说明 `drops_seq`、变种和出没地点（括号里的出现条件不算地点）；动物另有居住建筑 `homes` 和产物 `produce_list`（查不到物品编号的保留 Wiki 名称和所属条目） |

## 英文版资料

`scripts/build_en.py` 为英文版生成显示用资料（`prototype/data.en.js`），不改动上面的中文结构化数据：

- 中文条目名和物品 ID 仍是内部键；英文只提供显示文字。
- 名称、摘要、信息框字段、游戏内物品说明（英文站 `Template:Description`）、鱼类条件、营业时间、工具效果、建筑说明、收集包、配方来源、商店备注和居民日程，都从 `wiki/en-pages.jsonl` 解析。
- 收集包按房间、包名与物品 ID 对齐；对不上的项不显示英文来源说明。
- 物品属性（`pr`）与怪物的地点、层数、数值、掉落和变种（`monsters`）取自英文站信息框；属性名称按英文站 `Template:Name` 的写法（“Speed (+1)”）。两站数据偶有出入（如臭虫出现层数），各语言显示各自 Wiki 的写法。
- 新手指南（`curated/guides.en.json`）与世界进度说明（`curated/progression.en.json`）为对照英文 Wiki 改写，引用均为英文站原句。
- 界面文案在 `i18n/ui.en.json`，以中文原文为键。
- 条目正文（`prototype/articles/en/`）只取英文 Wiki 的同名条目；英文站个别条目本身引用了中文（版本历史里的中文字体修改、熊猫帽子的中文说明），照原文保留。

## 已知限制

- 结构化字段来自信息框和表格。正文里的特殊规则（比如鲶鱼在不同水域的季节不同）只保留原文说明，没有拆成条件；传说鱼的特殊要求按导言列表原样逐条保留。
- 蟹笼类鱼的条件写在“蟹笼”条目，鱼本身的信息框为空；水体取自该条目的“海洋”“淡水”两节。9 个配方的材料无法识别，在 `manifest.json` 的 `issues` 中计数。
- 17 件物品（多为游戏数据里未使用的物品，如铱奶、石基、野营灶）没有条目，也没有表格写到来源；其中能在其他条目找到相关句子的（组合戒指、宠物饲养证、镶边幸运紫色短裤）列出这些句子，其余如实写明 Wiki 没有说明。
- 条目正文由 `scripts/build_articles.py` 转换：只处理两个 Wiki 实际用到的模板和表格写法，不认识的模板不显示（不猜内容）；图片、图集和依赖 Lua 模块计算的展览会分数表没有转换。
- 快照晚于 2025-12-17 的线上修改不在其中。
- 部分加工变体共用产品图标，`image_note` 会注明；没有精确匹配的资源保留缺图状态。服装、墙纸和地板的图片编号由归档表格对应，不能直接用物品英文名推导所有文件名。

## 重新生成

```bash
# 解压修订历史（窗口很大，需要 --long=31）
zstd -d --long=31 raw/wikiteam-zh-20251218/*.xml.zst -o raw/wikiteam-zh-20251218/zh-history.xml
zstd -d --long=31 raw/wikiteam-en-20251218/*history.xml.zst -o raw/wikiteam-en-20251218/en-history.xml

python3 -I scripts/extract_latest.py data/raw/wikiteam-zh-20251218/zh-history.xml data/wiki/zh-pages.jsonl zh
python3 -I scripts/extract_latest.py data/raw/wikiteam-en-20251218/en-history.xml data/wiki/en-pages.jsonl en
python3 -I scripts/build_data.py        # → data/build/
python3 -I scripts/build_prototype.py   # → prototype/data.js、图标与字体子集，并调用 build_en.py、build_articles.py
```

命令在项目根目录运行。解压后的 XML 约 4.8 GB，生成 `wiki/` 后可以删除。
