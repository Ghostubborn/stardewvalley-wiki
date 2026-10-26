# Cloudflare Pages 部署

本项目为静态网站。仓库包含运行所需的页面、数据、图片、字体和音频，部署时不需要 Python 虚拟环境、原始 Wiki 归档、数据库或后端服务。

## 连接 GitHub 自动部署

在 Cloudflare 控制台的 **Workers & Pages → Create application → Pages → Import an existing Git repository** 中选择仓库。首次使用需要登录 Cloudflare，并授权 Cloudflare 的 GitHub 应用访问这个仓库。

| 设置 | 值 |
| --- | --- |
| GitHub 仓库 | `Ghostubborn/stardewvalley-wiki` |
| 项目名称 | `stardewvalley-wiki` |
| 生产分支 | `main` |
| 框架预设 | `None` |
| 根目录 | 仓库根目录（留空） |
| 构建命令 | `node scripts/check_assets.cjs` |
| 构建输出目录 | `prototype` |
| 环境变量 | 不需要 |

构建命令只验证已提交的资源引用，不重新生成 Wiki 数据。不要在云端执行 `scripts/build_data.py` 或 `scripts/build_prototype.py`，它们依赖未提交的原始归档和本地字体工具。

根目录的 `wrangler.toml` 声明了 Pages 项目名称和发布目录。部署后以 Cloudflare 返回的实际 `*.pages.dev` 地址为准。之后推送到 `main` 即更新生产站点；自定义域名可以稍后绑定。

## 本机直接上传

仅在选择直接上传方式，或已有项目允许 Wrangler 部署时使用：

```sh
npx --yes wrangler@4.152.0 login
npx --yes wrangler@4.152.0 pages project create stardewvalley-wiki --production-branch main
npx --yes wrangler@4.152.0 pages deploy prototype --project-name stardewvalley-wiki --branch main
```

已有同名项目时跳过创建步骤。直接上传项目不能原地切换为 Cloudflare 的 Git 集成；需要 Git 自动部署时应一开始选择连接仓库。

OAuth 授权由账号持有人在 Cloudflare 网页完成，密码和令牌不写入仓库。

## 上线核对

- 首页、直接条目链接及浏览器返回正常；`/en/` 英文版同样可用，语言切换保留当前条目。
- 图片、字体和脚本加载成功，背景音乐默认关闭。
- 开启防剧透，条件对照默认关闭。
- 核对中文图片文件名和音频加载，确认发布的是 `prototype` 而非整个仓库。

## 官方参考

- [静态 HTML 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [GitHub 集成](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [直接上传](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Pages 配置文件](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
