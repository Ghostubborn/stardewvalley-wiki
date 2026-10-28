# 星露谷 Wiki 数据快照

中英文 Wiki 的全站内容，以及由此整理出的结构化数据。原型和后续产品都从这里取数。

## 来源

| 内容 | 来源 | 快照时间 |
| --- | --- | --- |
| 中文：星露谷物语中文百科（BWIKI）全部条目、模板、分类与 Lua 数据模块 | [wiki.biligame.com/stardewvalley](https://wiki.biligame.com/stardewvalley/)，`scripts/fetch_bwiki.py` 经 MediaWiki API 抓取 | 2026-10-29（最新一次编辑 2026-10-28） |
| 中文：BWIKI 条目渲染后的页面（条目正文、由模块生成的表格） | 同上，`fetch_bwiki.py --html`（`action=parse`） | 2026-10-29，2,078 个条目中已抓到 958 个 |
| 中文：官方中文 Wiki 全部页面（含修订历史） | [Internet Archive · WikiTeam](https://archive.org/details/wiki-zh.stardewvalleywiki.com_mediawiki-20251218) | 2025-12-18，只用于下文“沿用归档”的几处 |
| 英文 Wiki 全部页面与 7,141 张图片 | [Internet Archive · WikiTeam](https://archive.org/details/wiki-stardewvalleywiki.com_mediawiki-20251218) | 2025-12-18 |

中文编辑团队 2024 年 10 月起在 BWIKI 编辑，官方中文 Wiki 的内容落后于它（BWIKI《站务:互通站》，官方中文 Wiki《管理员布告板》“关于近期的行动”）。两站由同一团队管理，计划日后把 BWIKI 的内容并回官方中文 Wiki。BWIKI 的结构化数据放在 Lua 数据模块里（`模块:Object/data`、`模块:FishPond/data`、`模块:Bundles/data` 等），由游戏解包数据生成；生成脚本见团队公开的[仓库](https://github.com/sizau/stardew-valley-wiki)。

抓取只走 API（BWIKI 的 robots.txt 没有限制 `api.php`）。条目原文每 50 页一次请求；渲染页面每页一次请求，间隔 5 秒以上。2026-10-29 连续请求几百次后，B站的防护对抓取所用的网络返回 HTTP 567 约一小时，恢复后 30 秒一次也很快再被限制，所以还有部分条目没有渲染结果（见“已知限制”）。官方中英文 Wiki 的线上站没有抓取：2026-10-22 实测线上 API 返回 503，`action=raw` 被 Cloudflare 验证页拦截，`robots.txt` 对 ClaudeBot、GPTBot 等 AI 爬虫全站禁止。

**沿用官方中文 Wiki 归档的部分：**地图标记坐标（`curated/map-positions.json` 按归档坐标逐点校准过，BWIKI 重新摆过 39 种鱼的标记）；新手指南的引用修订（`curated/guides.json`）；防剧透的后期来源名单（`curated/legacy-late-sources.json`，两站写法不同，只增加保护）；还没有渲染结果、部分章节由模块生成的条目里缺的那几节（好感度事件、对话、观影、生长日历），这几节开头写明取自归档。

**许可：**官方中英文 Wiki 的 siteinfo 声明许可为 **CC BY-NC-SA 3.0**（署名、非商业、相同方式共享）；BWIKI 的页面和 siteinfo 没有声明内容许可，页脚只有 B站的版权声明。BWIKI 的内容是官方中文 Wiki 同一编辑团队在其基础上继续编写的，本站按 CC BY-NC-SA 3.0 的要求署名、非商业使用；批量复用或商业化之前需要先和站方确认授权，见 `research/README.md` 的授权部分。游戏美术版权属于 ConcernedApe。BWIKI 和官方中文 Wiki 都只用英文站的图片文件名，图标与地图都使用英文站归档里的文件；BWIKI 自己上传、英文站没有的 451 张图（熏鱼图标、部分人物头像等）不显示。

## 目录

```text
raw/    归档原件：官方中英文 Wiki 的修订历史 .zst、图片（已解压）；bwiki-<日期>/ 下是 BWIKI 的
        pages.jsonl（API 原样的修订）、html.jsonl 与 html-extra.jsonl（渲染后的页面）、siteinfo.json；
        legacy-articles-20251218/ 是官方中文 Wiki 归档转换出的条目正文（暂时补缺用）
wiki/   每个页面的最新修订：zh-pages.jsonl（BWIKI，6,175 页，命名空间按官方中文 Wiki 的写法：Template:、Category:）、
        zh-official-20251218.jsonl（官方中文 Wiki 归档，3,211 页）、en-pages.jsonl（12,476 页）
build/  结构化数据（JSON），manifest.json 记录数量与生成时间
curated/progression.json  人工核对的世界进度门槛，每条附 Wiki 原句
curated/map-positions.json  当前地图底图的示意锚点校准、精度与保护归属
curated/legacy-late-sources.json  防剧透：官方中文 Wiki 归档里来源提到后期内容的条目名
```

`build/` 的主要内容：

| 文件 | 数量 | 说明 |
| --- | --- | --- |
| `items.json` | 2,905 | 全部物品的官方中英文名、描述、售价、分类与礼物偏好（取自 BWIKI 的 Lua 数据模块；游戏里同名的棕色蛋按显示名键改用 Wiki 名称）。墙纸、地板、纸条和通用上衣按 Wiki 图标编号命名（“壁纸 #13”）；`src` 为合集页表格里的逐件来源；`internal` 标记矿井石头、杂草等地图物件和游戏内部占位；`eat` 为按游戏数据可食用度算出的能量和生命值，物品自己的条目没有写时使用；`mentions` 为没有条目和来源的物品在其他条目里被讲到的句子 |
| `image-coverage.json` | — | 图标匹配来源和未匹配清单；当前 2,771 件物品有图片，134 件未匹配 |
| `pages.json` / `page-text.jsonl` | 2,078 | 中文条目的类型、摘要、信息框字段、章节、链接、地图坐标与纯文本；`src` 为信息框逐条来源（家具、帽子按模板的行），`dr` 为捐赠奖励，`obtain` 为“获取途径”一类章节；`props` 为物品属性：`eat`（能量、生命值，按信息框决定是否分品质）、`buff` 与 `buff_time`、`stats`（戒指、靴子、武器的附加属性）、`weapon`（类型、等级、伤害、暴击率） |
| `recipes.json` | 1,112 | 打造、烹饪、加工、裁缝配方：材料、设备、耗时与解锁条件（技能、好感来信、烹饪频道等）。含按产品系列条目生成的带口味工匠物品加工（368 条），和《裁缝》上衣、下装表的裁缝做法 |
| `tool-chains.json` | 6 | 五种工具的铁匠铺升级链，以及鱼竿各级的购买条件 |
| `buildings.json` | 30 | 建筑造价、材料、工期与升级关系：BWIKI 把每座建筑（鸡舍、畜棚、小屋各级分开，在“X/infobox”子页面里）写成建筑信息框，`base` 是上一级、`build` 是工期；《木匠的商店》《法师塔》的建筑表只引用这些信息框，出售者按引用它的页面定（法师塔的六座魔法建筑取回魔法墨水后开放、立即建成），用金色核桃的两座在姜岛上建造；农舍各级取自《木匠的商店》的房屋升级表 |
| `fish-pond.json` | 250 | 《鱼塘》“产出”表（BWIKI 由 模块:FishPond 按游戏数据算出，读渲染后的页面）：73 种鱼各自的产物、数量、从几条起开始产出、鱼的数量 1～10 时对应概率的范围和实际概率；物品按排序值里的英文名对应，对不上的按链接条目找 |
| `bundles.json` | 7 | 社区中心各房间的收集包、可选数量、奖励与房间奖励 |
| `shops.json` | 21 | 商店库存、价格、以物换物和星期轮换；同时列出购买价与出售价时取购买价，按年份分列的价格取第 1 年，“其他来源”列另存为 `other` |
| `fish.json` 等 | — | 鱼 71、居民 49、地点 51、种子 70、作物 54、树 17、怪物 61、动物 12、矿物与古物 95（BWIKI 把珊瑚、海胆、彩虹贝壳、鹦鹉螺、绿藻、白藻写成采集品或物品，不再算鱼）。鱼另有逐条的时段与天气（例外条目不参与结构化解析）、传说鱼导言里的特殊要求、夜市潜艇出现率和蟹笼水体。怪物另有信息框的基础数值 `stats`、按原顺序的掉落物与说明 `drops_seq`、变种和出没地点（括号里的出现条件不算地点）；动物另有居住建筑 `homes` 和产物 `produce_list`（查不到物品编号的保留 Wiki 名称和所属条目） |

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

- 结构化字段来自信息框、数据模块和表格。BWIKI 把鳟鱼大赛、瀑布、鱿鱼节这类钓鱼例外写在条目正文里，信息框只写常规条件，所以鱼的时段、天气不再单列例外；季节按水域分写的（鲤鱼、姜岛全年可钓的鱼）按原文拆成各水域的条件。传说鱼的特殊要求按导言列表原样逐条保留。
- 蟹笼类鱼的条件写在“蟹笼”条目，鱼本身的信息框为空；水体取自该条目的“海洋”“淡水”两节。少数配方的材料无法识别，在 `manifest.json` 的 `issues` 中计数。
- 没有条目、也没有表格写到来源的物品，能在其他条目找到相关句子的列出这些句子，其余如实写明 Wiki 没有说明。
- 中文条目正文由 `scripts/build_articles.py` 转换：有渲染结果的条目按 BWIKI 显示的样子收录（`sdvdata/html_article.py`），信息框、导航框、目录、参考文献、人物行走动画不收录；还没有渲染结果的条目按原文转换（`sdvdata/article.py`），BWIKI 常用的模块类模板（文本片段、收集包需求、打造表、送礼表、日程）按模块规则展开，其余不认识的模板不显示（不猜内容）；其中部分章节由 Lua 模块生成的 142 个条目（居民的好感度事件与对话、鱼的鱼塘一节、作物的生长日历等），缺的几节暂用官方中文 Wiki 归档的内容并注明，等 B站不再限制抓取后补抓（清单按优先级生成，`fetch_bwiki.py --html --only <清单> --delay 30`）。英文正文仍按英文 Wiki 归档的原文转换。
- 正文图片取自英文 Wiki 的图片归档，按 Wiki 指定的尺寸显示：边长不超过 800 像素（或文件不超过 200 KB）的图照原样发布，超过 150 KB 的转成同尺寸的 WebP；更大的地图和信息图转成 640 像素宽的 WebP 缩略图加原尺寸 WebP（像素画用无损压缩，照片和渐变多的信息图用有损压缩）。当作图标的大图（如鹈鹕镇全景）换成长边 192 像素的 WebP。转换由 `scripts/sdvdata/webp.py` 调用 cwebp（`brew install webp`）完成，结果按源文件散列记在 `build/webp.json`，源图不变就不重新编码；没有 cwebp 又没有旧结果时，大图退回只链接 Wiki 原图。
- BWIKI 新增、只有中文 Wiki 有的条目（人鱼、姜岛的东西北分区、版本历史的分页等）只在中文版出现；英文版不显示没有英文 Wiki 对应的条目和关系图节点。
- BWIKI 的快照晚于 2026-10-28 的线上修改不在其中；英文资料是 2025-12-18 的归档。两站偶有出入（如铁锭的转化配方 BWIKI 写 2 个铜锭、英文 Wiki 写 3 个），各语言显示各自 Wiki 的写法。
- 部分加工变体共用产品图标，`image_note` 会注明；没有精确匹配的资源保留缺图状态。服装、墙纸和地板的图片编号由表格对应，不能直接用物品英文名推导所有文件名。

## 重新生成

```bash
# 英文 Wiki 与官方中文 Wiki 归档：解压修订历史（窗口很大，需要 --long=31）
zstd -d --long=31 raw/wikiteam-zh-20251218/*.xml.zst -o raw/wikiteam-zh-20251218/zh-history.xml
zstd -d --long=31 raw/wikiteam-en-20251218/*history.xml.zst -o raw/wikiteam-en-20251218/en-history.xml
python3 -I scripts/extract_latest.py data/raw/wikiteam-zh-20251218/zh-history.xml data/wiki/zh-official-20251218.jsonl zh
python3 -I scripts/extract_latest.py data/raw/wikiteam-en-20251218/en-history.xml data/wiki/en-pages.jsonl en

# 中文：BWIKI（写出 data/raw/bwiki-<日期>/ 与 data/wiki/zh-pages.jsonl；--offline 只用已有的抓取结果重新生成）
python3 -I scripts/fetch_bwiki.py
python3 -I scripts/fetch_bwiki.py --html          # 渲染后的页面，慢；被限流（HTTP 567）时会停下，之后重跑会接着抓

python3 -I scripts/build_data.py        # → data/build/
python3 -I scripts/build_prototype.py   # → prototype/data.js、图标与字体子集，并调用 build_en.py、build_articles.py
```

命令在项目根目录运行。解压后的 XML 约 4.8 GB，生成 `wiki/` 后可以删除。
