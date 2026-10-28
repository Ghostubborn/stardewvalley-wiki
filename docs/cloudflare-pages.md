# Cloudflare Pages 部署

本项目以静态网站为主。仓库包含运行所需的页面、数据、图片、字体和音频，部署时不需要 Python 虚拟环境或原始 Wiki 归档。唯一的后端是访客反馈：根目录 `functions/` 下的 Pages Function 把反馈写进 D1 数据库，见[访客反馈](#访客反馈pages-functions--d1)。

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

根目录的 `wrangler.toml` 声明了 Pages 项目名称、发布目录和反馈用的 D1 绑定。部署后以 Cloudflare 返回的实际 `*.pages.dev` 地址为准。之后推送到 `main` 即更新生产站点；自定义域名可以稍后绑定。

## 本机直接上传

仅在选择直接上传方式，或已有项目允许 Wrangler 部署时使用：

```sh
npx --yes wrangler@4.152.0 login
npx --yes wrangler@4.152.0 pages project create stardewvalley-wiki --production-branch main
npx --yes wrangler@4.152.0 pages deploy prototype --project-name stardewvalley-wiki --branch main
```

已有同名项目时跳过创建步骤。在仓库根目录执行，`functions/` 会一起部署。直接上传项目不能原地切换为 Cloudflare 的 Git 集成；需要 Git 自动部署时应一开始选择连接仓库。

OAuth 授权由账号持有人在 Cloudflare 网页完成，密码和令牌不写入仓库。

## 访客反馈（Pages Functions + D1）

页面上的“反馈”对话框把内容 POST 到 `/api/feedback`，由 `functions/api/feedback.js` 处理：Pages 会把仓库根目录的 `functions/` 自动部署成 Functions（Git 集成和 `wrangler pages deploy` 都是如此），静态页面仍只发布 `prototype`。反馈存进 D1 数据库 `stardewvalley-wiki-feedback` 的 `feedback` 表，绑定名 `FEEDBACK_DB` 写在 `wrangler.toml`。没有读取反馈的公开接口；不保存原始 IP，只存按日变化的摘要，用来限制同一来源 10 分钟内最多 5 条。

### 首次启用

```sh
npx --yes wrangler@4.152.0 login
npx --yes wrangler@4.152.0 d1 create stardewvalley-wiki-feedback
```

把输出里的 `database_id` 填进 `wrangler.toml` 的 `[[d1_databases]]`（替换 `REPLACE_WITH_D1_ID`），再建表：

```sh
npx --yes wrangler@4.152.0 d1 migrations apply stardewvalley-wiki-feedback --remote
```

提交并推送 `wrangler.toml` 后，下一次部署就带上这个绑定；使用 `wrangler.toml` 时绑定以文件为准，不在控制台另行设置。预览部署（非 `main` 分支）也写入同一个数据库，可从 `url` 字段分辨。以后表结构要变，在 `migrations/` 里加下一个编号的文件，再执行上面的 apply。

### 查看新反馈

```sh
npx --yes wrangler@4.152.0 d1 execute stardewvalley-wiki-feedback --remote --json --command "SELECT id, created_at, kind, message, contact, entry_title, entry, url, lang, viewport, user_agent, app_version FROM feedback WHERE status = 'new' ORDER BY id DESC LIMIT 50"
```

- `kind`：访客选的类型，`error` 资料有误、`missing` 缺少内容、`spoiler` 被剧透了、`display` 显示或操作问题、`idea` 建议、`other` 其他（没选也记为 `other`）。
- `entry` 是条目引用（如 `item:(O)388`、`fish:鲶鱼`），`entry_title` 是访客当时在页面上看到的标题，受防剧透保护的条目记为“尚未确认探索的内容”；访客取消勾选时两项为空。
- `url` 带着当时的视图和条目；`app_version` 是 `js/ui.js` 的内容指纹，可对照提交记录判断访客看到的是哪一版；`created_at` 为 UTC。

### 标记已处理

```sh
npx --yes wrangler@4.152.0 d1 execute stardewvalley-wiki-feedback --remote --command "UPDATE feedback SET status = 'done', note = '已修正：木材的来源' WHERE id IN (12, 13)"
```

不打算处理的记成 `wontfix`、重复的记成 `duplicate`，`note` 写明原因。查询时按 `status = 'new'` 就只剩待处理的。

### 本机调试

```sh
npx --yes wrangler@4.152.0 d1 migrations apply stardewvalley-wiki-feedback --local
npx --yes wrangler@4.152.0 pages dev prototype --port 8788
```

本地数据库不需要登录，`database_id` 还是占位符时也能用，数据在 `.wrangler/`（不提交）。打开 <http://127.0.0.1:8788/> 提交一条，再把上面查询命令的 `--remote` 换成 `--local` 查看。`python3 -m http.server` 的预览没有后端，提交时对话框会提示“没能发送”，可以重试或复制内容。

检查：`node scripts/test_feedback_function.cjs`（校验、蜜罐、来源、限流、请求方法，用内存 SQLite 代替 D1）；对话框在浏览器里用 `scripts/test_feedback_browser.js`。

## 上线核对

- 首页、直接条目链接及浏览器返回正常；`/en/` 英文版同样可用，语言切换保留当前条目。
- 图片、字体和脚本加载成功，背景音乐默认关闭。
- 开启防剧透，条件对照默认关闭。
- 核对中文图片文件名和音频加载，确认发布的是 `prototype` 而非整个仓库。
- 在一个条目里点“反馈”发一条测试，用上面的查询确认收到、`entry_title` 是页面上的标题，再把它标记为 `done`。

## 官方参考

- [静态 HTML 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [GitHub 集成](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [直接上传](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Pages 配置文件](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)
