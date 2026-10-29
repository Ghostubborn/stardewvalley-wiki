/* 访客反馈：POST /api/feedback（Cloudflare Pages Function），写入 D1 的 feedback 表（绑定 FEEDBACK_DB）。
   带访客令牌（X-Feedback-Token）的反馈，访客之后能在“我的反馈”里看到（mine.js），并继续追问（reply.js）。
   维护者用 scripts/feedback.mjs 查看和回复，见 docs/cloudflare-pages.md。 */
import { KINDS, MAX_MESSAGE, WINDOW_MS, reply, fail, readJson, clip, ipHash, tokenOf, tokenHash, recentCount } from "../../../server/feedback.js";

const MAX_IN_WINDOW = 5;
// 自动附带的信息超长时截断，不因此拒收。
const CAPS = { entry: 200, entry_title: 200, url: 1000, lang: 16, viewport: 32, user_agent: 400, app_version: 64 };
const COLUMNS = ["created_at", "updated_at", "kind", "message", "contact", ...Object.keys(CAPS), "ip_hash", "token_hash"];

// 其他请求方法一律 405；POST 交给 onRequestPost（Pages 先匹配带方法的处理函数，这里只是兜底）。
export function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return fail(405, "method_not_allowed", { Allow: "POST" });
}

export async function onRequestPost({ request, env }) {
  const { data, error } = await readJson(request);
  if (error) return error;
  // 蜜罐：页面上看不见的 website 栏，填了的是机器人。照常答复，但不保存。
  if (data.website != null && String(data.website).trim() !== "") return reply(200, { ok: true });

  if (!KINDS.has(data.kind)) return fail(400, "bad_kind");
  const message = typeof data.message === "string" ? data.message.trim() : "";
  if (message.length < 2) return fail(400, "message_too_short");
  if (message.length > MAX_MESSAGE) return fail(400, "message_too_long");
  const contact = typeof data.contact === "string" ? data.contact.trim() : "";
  if (contact.length > 100) return fail(400, "contact_too_long");
  const extra = Object.fromEntries(Object.entries(CAPS).map(([key, max]) => [key, clip(data[key], max)]));
  extra.user_agent ??= clip(request.headers.get("User-Agent"), CAPS.user_agent);
  const token = tokenOf(request);

  const db = env.FEEDBACK_DB;
  if (!db) return fail(503, "unavailable");
  const now = new Date();
  try {
    const ip = await ipHash(request, now);
    if (await recentCount(db, "feedback", ip, now) >= MAX_IN_WINDOW) return fail(429, "rate_limited", { "Retry-After": String(WINDOW_MS / 1000) });
    const at = now.toISOString();
    const row = { created_at: at, updated_at: at, kind: data.kind, message, contact: contact || null, ...extra,
      ip_hash: ip, token_hash: token ? await tokenHash(token) : null };
    const result = await db.prepare(`INSERT INTO feedback (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`)
      .bind(...COLUMNS.map(column => row[column])).run();
    return reply(200, { ok: true, id: result.meta?.last_row_id ?? null });
  } catch (error) {
    // 日志里不写反馈内容。
    console.error("feedback: D1 error", error?.message || error);
    return fail(500, "server_error");
  }
}
