/* 追问或补充：POST /api/feedback/reply，正文 {id, message}，带访客令牌（X-Feedback-Token）。
   只能回复自己的反馈（令牌对不上一律 404，不透露这条反馈是否存在）；回复后这条反馈回到“待处理”，维护者能看到。 */
import { MAX_MESSAGE, WINDOW_MS, reply, fail, readJson, ipHash, tokenOf, tokenHash, recentCount } from "../../../server/feedback.js";

const MAX_IN_WINDOW = 10;

export function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return fail(405, "method_not_allowed", { Allow: "POST" });
}

export async function onRequestPost({ request, env }) {
  const { data, error } = await readJson(request);
  if (error) return error;
  const id = Number(data.id);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "bad_id");
  const message = typeof data.message === "string" ? data.message.trim() : "";
  if (message.length < 2) return fail(400, "message_too_short");
  if (message.length > MAX_MESSAGE) return fail(400, "message_too_long");
  const token = tokenOf(request);
  if (!token) return fail(400, "bad_token");

  const db = env.FEEDBACK_DB;
  if (!db) return fail(503, "unavailable");
  const now = new Date();
  try {
    const thread = await db.prepare("SELECT id FROM feedback WHERE id = ? AND token_hash = ?").bind(id, await tokenHash(token)).first();
    if (!thread) return fail(404, "not_found");
    const ip = await ipHash(request, now);
    if (await recentCount(db, "feedback_messages", ip, now) >= MAX_IN_WINDOW) return fail(429, "rate_limited", { "Retry-After": String(WINDOW_MS / 1000) });
    const at = now.toISOString();
    const result = await db.prepare("INSERT INTO feedback_messages (feedback_id, created_at, author, message, ip_hash) VALUES (?, ?, 'visitor', ?, ?)")
      .bind(id, at, message, ip).run();
    await db.prepare("UPDATE feedback SET updated_at = ?, status = 'new' WHERE id = ?").bind(at, id).run();
    return reply(200, { ok: true, id: result.meta?.last_row_id ?? null, created_at: at });
  } catch (error) {
    console.error("feedback/reply: D1 error", error?.message || error);
    return fail(500, "server_error");
  }
}
