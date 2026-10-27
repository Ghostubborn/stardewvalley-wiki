# 星露谷交互手册

**English:** A spoiler-safe Stardew Valley reference — how to get items, where and when fish bite, and what each upgrade needs, plus a valley map and progression tree. Later-game content stays folded until you choose to open it. Open the English version at <https://stardewvalley-wiki.pages.dev/en/>. The English text comes from the [Stardew Valley Wiki](https://stardewvalleywiki.com/) archive (2025-12-18); feedback is welcome in [Issues](https://github.com/Ghostubborn/stardewvalley-wiki/issues).

基于星露谷 Wiki 资料、默认不剧透的查询站：物品怎么获得、鱼在哪片水域什么时候出现、升级前要准备什么，都能直接查；也可以在山谷地图上按地点浏览，或在成长路线里看升级和解锁的先后。还没到的内容先收起，想看再点开；查阅无需连接游戏或维护游戏时间。提供中文版（`/`）与英文版（`/en/`），首次访问按浏览器语言自动进入，页头可切换。

## 本地运行

在项目根目录执行：

```sh
python3 -I -m http.server 8765 --bind 127.0.0.1 --directory prototype
```

打开 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)。仓库包含已生成的页面、数据和运行资源，无需安装前端依赖或重新生成资料。

## Cloudflare Pages

连接本仓库的 `main` 分支，框架选择 `None`，构建命令填写 `node scripts/check_assets.cjs`，输出目录填写 `prototype`。不需要环境变量。完整设置与直接上传方式见[部署说明](docs/cloudflare-pages.md)。

## 项目内容

- [`prototype/`](prototype/README.md)：静态网站、交互代码及运行资源。
- [`data/`](data/README.md)：结构化数据、人工整理规则及来源说明。
- [`scripts/`](scripts/)：数据生成与验证脚本。
- [`research/`](research/README.md)：产品调研、设计记录与[产品定位](research/wiki-product-boundary.md)。

原始下载归档 `data/raw/`、提取后的 Wiki 原文 `data/wiki/` 和本地 `.venv/` 不纳入 Git。重新生成数据需要按[数据说明](data/README.md)准备这些输入；直接运行网站不需要它们。

## 来源与致谢

感谢[星露谷物语中文维基](https://zh.stardewvalleywiki.com/)及 [Stardew Valley Wiki](https://stardewvalleywiki.com/) 的编辑者、翻译者与贡献者。本站根据归档资料重新整理查询界面，各条目保留原文来源。

游戏美术与音乐版权归 ConcernedApe。Wiki 内容、字体与音频的来源和许可说明分别见[数据说明](data/README.md)、[`prototype/assets/fonts/`](prototype/assets/fonts/)及[音频说明](prototype/assets/audio/README.md)；本仓库没有为这些第三方素材另行授予许可。
