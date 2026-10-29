#!/usr/bin/env node
/* 维护者查看和回复访客反馈：D1 数据库 stardewvalley-wiki-feedback，见 docs/cloudflare-pages.md。
   用法（在仓库根目录执行；加 --local 操作本机 wrangler pages dev 用的数据库）：
     node scripts/feedback.mjs list [--all]                     待处理的反馈（新提交的和访客追问过的）；--all 列出最近 50 条
     node scripts/feedback.mjs show <id>                        一条反馈的全部信息和对话
     node scripts/feedback.mjs reply <id> <内容> [--status done]  以维护者身份回复，访客在“我的反馈”里能看到；状态默认改为 replied
     node scripts/feedback.mjs status <id> <状态> [--note <备注>]  改状态（new、replied、done、wontfix、duplicate）；备注只有维护者能看到
   通过 npx wrangler 执行 SQL，需要账号持有人先 npx --yes wrangler@4.152.0 login。 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const WRANGLER = ["--yes", "wrangler@4.152.0"];
const DB = "stardewvalley-wiki-feedback";
export const STATUSES = ["new", "replied", "done", "wontfix", "duplicate"];
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const quote = value => value == null ? "NULL" : `'${String(value).replace(/'/g, "''")}'`;
function idOf(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`反馈编号不对：${value}`);
  return id;
}

// 每个命令对应的 SQL（测试里直接在内存 SQLite 上执行这些语句）。
export const statements = {
  list: all => `SELECT f.id, f.created_at, COALESCE(f.updated_at, f.created_at) AS updated_at, f.status, f.kind, f.entry_title, f.message, f.contact,
  f.token_hash IS NOT NULL AS visible, (SELECT COUNT(*) FROM feedback_messages m WHERE m.feedback_id = f.id) AS replies,
  (SELECT author FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.id DESC LIMIT 1) AS last_author
FROM feedback f ${all ? "" : "WHERE f.status = 'new' "}ORDER BY COALESCE(f.updated_at, f.created_at) DESC LIMIT 50`,
  show: id => [
    `SELECT id, created_at, updated_at, status, kind, message, contact, entry, entry_title, url, lang, viewport, user_agent, app_version, note,
  token_hash IS NOT NULL AS visible FROM feedback WHERE id = ${idOf(id)}`,
    `SELECT id, created_at, author, message FROM feedback_messages WHERE feedback_id = ${idOf(id)} ORDER BY id`,
  ],
  // 只在这条反馈存在时写入回复；最后一句读回状态，用来确认和提醒。
  reply: (id, text, status = "replied") => {
    if (!STATUSES.includes(status)) throw new Error(`状态只能是 ${STATUSES.join("、")}`);
    if (String(text).trim().length < 2) throw new Error("回复内容太短");
    return [
      `INSERT INTO feedback_messages (feedback_id, author, message) SELECT id, 'team', ${quote(String(text).trim())} FROM feedback WHERE id = ${idOf(id)}`,
      `UPDATE feedback SET status = ${quote(status)}, updated_at = ${NOW} WHERE id = ${idOf(id)}`,
      `SELECT id, status, contact, token_hash IS NOT NULL AS visible FROM feedback WHERE id = ${idOf(id)}`,
    ];
  },
  status: (id, status, note) => {
    if (!STATUSES.includes(status)) throw new Error(`状态只能是 ${STATUSES.join("、")}`);
    return [
      `UPDATE feedback SET status = ${quote(status)}, updated_at = ${NOW}${note == null ? "" : `, note = ${quote(note)}`} WHERE id = ${idOf(id)}`,
      `SELECT id, status, note FROM feedback WHERE id = ${idOf(id)}`,
    ];
  },
};

// 执行一条或多条 SQL，返回每条语句的结果行。
function run(sql, local) {
  const command = [].concat(sql).join(";\n");
  let out;
  try {
    out = execFileSync("npx", [...WRANGLER, "d1", "execute", DB, local ? "--local" : "--remote", "--json", "--command", command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  } catch (error) {
    throw new Error(`wrangler 执行失败：${(error.stdout || "") + (error.stderr || "") || error.message}`);
  }
  return JSON.parse(out).map(result => result.results || []);
}

const when = iso => iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "";
const NAMES = { visitor: "访客", team: "维护者" };
const excerpt = (text, n = 60) => {
  const line = String(text).replace(/\s+/g, " ").trim();
  return Array.from(line).length > n ? Array.from(line).slice(0, n).join("") + "…" : line;
};

function main(argv) {
  const flags = { local: false, all: false, status: undefined, note: undefined }, args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--local" || arg === "--all") flags[arg.slice(2)] = true;
    else if (arg === "--status" || arg === "--note") flags[arg.slice(2)] = argv[++i];
    else args.push(arg);
  }
  const [command, ...rest] = args;
  if (command === "list") {
    const [rows] = run(statements.list(flags.all), flags.local);
    if (!rows.length) return console.log(flags.all ? "还没有反馈。" : "没有待处理的反馈。");
    for (const row of rows) {
      const thread = row.replies ? `，${row.replies} 条留言，最后是${NAMES[row.last_author] || row.last_author}` : "";
      console.log(`#${row.id} ${when(row.updated_at)} [${row.status}/${row.kind}]${row.entry_title ? " 关于：" + row.entry_title : ""}${thread}${row.visible ? "" : "（访客看不到回复）"}`);
      console.log(`    ${excerpt(row.message)}${row.contact ? `  联系方式：${row.contact}` : ""}`);
    }
  } else if (command === "show") {
    const [[row], messages] = run(statements.show(rest[0]), flags.local);
    if (!row) throw new Error(`没有第 ${rest[0]} 条反馈`);
    console.log(`#${row.id} [${row.status}/${row.kind}] 提交于 ${when(row.created_at)}${row.updated_at ? "，更新于 " + when(row.updated_at) : ""}`);
    for (const [label, key] of [["关于", "entry_title"], ["条目", "entry"], ["联系方式", "contact"], ["页面", "url"], ["语言", "lang"],
      ["窗口", "viewport"], ["浏览器", "user_agent"], ["版本", "app_version"], ["备注", "note"]]) if (row[key]) console.log(`${label}：${row[key]}`);
    if (!row.visible) console.log("（这条提交时还没有“我的反馈”，访客看不到回复；需要追问请用联系方式。）");
    console.log(`\n访客 · ${when(row.created_at)}\n${row.message}`);
    for (const message of messages) console.log(`\n${NAMES[message.author] || message.author} · ${when(message.created_at)}\n${message.message}`);
  } else if (command === "reply") {
    const [id, ...words] = rest;
    const results = run(statements.reply(id, words.join(" "), flags.status), flags.local);
    const [row] = results.at(-1);
    if (!row) throw new Error(`没有第 ${id} 条反馈`);
    console.log(`已回复 #${row.id}，状态：${row.status}。`);
    if (!row.visible) console.log(`这条提交时还没有“我的反馈”，访客看不到这条回复${row.contact ? `；联系方式：${row.contact}` : "，也没有留联系方式"}。`);
  } else if (command === "status") {
    const [id, status] = rest;
    const results = run(statements.status(id, status, flags.note), flags.local);
    const [row] = results.at(-1);
    if (!row) throw new Error(`没有第 ${id} 条反馈`);
    console.log(`#${row.id} 状态：${row.status}${row.note ? `，备注：${row.note}` : ""}。`);
  } else {
    console.log("用法：node scripts/feedback.mjs list [--all] | show <id> | reply <id> <内容> [--status done] | status <id> <状态> [--note <备注>]；加 --local 用本机数据库。");
    process.exitCode = command ? 1 : 0;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
