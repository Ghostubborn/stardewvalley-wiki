# Cloudflare Pages 部署

本项目以静态网站为主。仓库包含运行所需的页面、数据、图片、字体和音频，部署时不需要 Python 虚拟环境或原始 Wiki 归档。唯一的后端是访客反馈：根目录 `functions/` 下的 Pages Functions 把反馈和回复存进 D1 数据库，见[访客反馈](#访客反馈pages-functions--d1)。

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

页面上的“反馈”对话框分“写反馈”和“我的反馈”两页，后端是根目录 `functions/api/feedback/` 下的 Pages Functions：Pages 会把 `functions/` 自动部署成 Functions（Git 集成和 `wrangler pages deploy` 都是如此），静态页面仍只发布 `prototype`。三个接口共用的代码放在 `server/feedback.js`（放在 `functions/` 外面，免得它自己成为一个网址；部署时会打包进去）。

| 接口 | 文件 | 作用 |
| --- | --- | --- |
| `POST /api/feedback` | `index.js` | 提交反馈，同一来源 10 分钟内最多 5 条 |
| `GET /api/feedback/mine` | `mine.js` | 按访客令牌列出这个访客的反馈、状态和留言（最多 50 条） |
| `POST /api/feedback/reply` | `reply.js` | 访客在自己的反馈下追问或补充，同一来源 10 分钟内最多 10 条；追问后这条回到 `new` |

数据在 D1 数据库 `stardewvalley-wiki-feedback`，绑定名 `FEEDBACK_DB` 写在 `wrangler.toml`：`feedback` 表一行一条反馈，`feedback_messages` 表是下面的留言（`author` 为 `visitor` 访客、`team` 维护者）。不保存原始 IP，只存按日变化的摘要，用来限流。

访客不用登录：第一次发送时浏览器生成一个随机令牌，存在本机 `localStorage`，随请求放在 `X-Feedback-Token` 请求头里；数据库只存它加盐后的 SHA-256 摘要。有令牌才能看到对应的反馈，“我的反馈”只返回访客自己写的内容、维护者的回复和处理状态，不返回联系方式、页面地址、浏览器信息和备注。访客可以复制“查看链接”（`/?fbk=令牌`）带到别的设备；拿到链接的人也能看到并补充，页面上已提醒不要公开分享。2026-10-29 之前提交的反馈没有令牌，访客看不到回复，需要追问请用联系方式。

### 首次启用

已于 2026-10-29 完成：数据库 `stardewvalley-wiki-feedback`（区域 WNAM，`database_id` 见 `wrangler.toml`），`migrations/` 里的两个文件都已执行。以下步骤只在换账号或重建时需要。Wrangler 的登录要包含 D1 权限（默认的 `wrangler login` 就有；只授权 Pages 的登录建库会报 “Authentication error”）。

```sh
npx --yes wrangler@4.152.0 login
npx --yes wrangler@4.152.0 d1 create stardewvalley-wiki-feedback
```

把输出里的 `database_id` 填进 `wrangler.toml` 的 `[[d1_databases]]`，再建表：

```sh
npx --yes wrangler@4.152.0 d1 migrations apply stardewvalley-wiki-feedback --remote
```

提交并推送 `wrangler.toml` 后，下一次部署就带上这个绑定；使用 `wrangler.toml` 时绑定以文件为准，不在控制台另行设置。预览部署（非 `main` 分支）也读写同一个数据库，可从 `url` 字段分辨。以后表结构要变，在 `migrations/` 里加下一个编号的文件，**先**执行上面的 apply，再推送用到新结构的代码。

### 查看和回复

用 `scripts/feedback.mjs`（通过 `npx wrangler d1 execute` 执行 SQL，需要已登录）：

```sh
node scripts/feedback.mjs list                       # 待处理：新提交的，以及访客追问过的
node scripts/feedback.mjs list --all                 # 最近 50 条，任何状态
node scripts/feedback.mjs show 12                    # 一条的全部信息（联系方式、页面、浏览器）和对话
node scripts/feedback.mjs reply 12 "谢谢！已经改好了。"          # 回复，状态改为 replied
node scripts/feedback.mjs reply 12 "已修正：木材的来源。" --status done   # 回复并标记已处理
node scripts/feedback.mjs status 13 wontfix --note "和游戏一致"    # 只改状态；备注只有维护者能看到
```

- 状态：`new` 待处理、`replied` 已回复、`done` 已处理、`wontfix` 暂不处理、`duplicate` 重复反馈。访客在“我的反馈”里看到对应的中文或英文名称；回复或改状态后，访客的“反馈”按钮上会出现红点。
- 回复会原样显示给访客。访客可能开着防剧透，回复里不要提还没解锁的地点、人物和剧情，也不要写个人信息。
- `kind`：访客选的类型，`error` 资料有误、`missing` 缺少内容、`spoiler` 被剧透了、`display` 显示或操作问题、`idea` 建议、`other` 其他（没选也记为 `other`）。
- `entry` 是条目引用（如 `item:(O)388`、`fish:鲶鱼`），`entry_title` 是访客当时在页面上看到的标题，受防剧透保护的条目记为“尚未确认探索的内容”；访客取消勾选时两项为空。
- `url` 带着当时的视图和条目；`app_version` 是 `js/ui.js` 的内容指纹，可对照提交记录判断访客看到的是哪一版；时间在数据库里是 UTC，脚本按本机时区显示。

也可以直接执行 SQL，例如删除一条测试反馈：

```sh
npx --yes wrangler@4.152.0 d1 execute stardewvalley-wiki-feedback --remote --command "DELETE FROM feedback_messages WHERE feedback_id = 12; DELETE FROM feedback WHERE id = 12"
```

### 本机调试

```sh
npx --yes wrangler@4.152.0 d1 migrations apply stardewvalley-wiki-feedback --local
npx --yes wrangler@4.152.0 pages dev prototype --port 8788
```

本地数据库不需要登录，数据在 `.wrangler/`（不提交）。打开 <http://127.0.0.1:8788/> 提交一条，再用 `node scripts/feedback.mjs list --local`、`reply … --local` 查看和回复，回到页面的“我的反馈”看效果。`python3 -m http.server` 的预览没有后端，提交时对话框会提示“没能发送”，可以重试或复制内容。

检查：`node scripts/test_feedback_function.cjs`（三个接口和维护脚本的 SQL：校验、蜜罐、来源、限流、令牌、只能看和回复自己的反馈，用内存 SQLite 代替 D1）；对话框在浏览器里用 `scripts/test_feedback_browser.js`。

## 上线核对

- 首页、直接条目链接及浏览器返回正常；`/en/` 英文版同样可用，语言切换保留当前条目。
- 图片、字体和脚本加载成功，背景音乐默认关闭。
- 开启防剧透，条件对照默认关闭。
- 核对中文图片文件名和音频加载，确认发布的是 `prototype` 而非整个仓库。
- 在一个条目里点“反馈”发一条测试，用 `node scripts/feedback.mjs list` 确认收到、`entry_title` 是页面上的标题；`reply` 回复一句，回到页面确认“反馈”上出现红点、“我的反馈”里能看到回复并能追问，最后删掉这条测试。

## 官方参考

- [静态 HTML 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [GitHub 集成](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [直接上传](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Pages 配置文件](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)
