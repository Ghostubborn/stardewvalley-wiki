/* 我的反馈：GET /api/feedback/mine，按访客令牌（X-Feedback-Token）列出这个访客提交过的反馈和下面的留言。
   只返回访客自己写的内容、维护者的回复和处理状态；不返回联系方式、IP 摘要和浏览器信息。 */
import { reply, fail, tokenOf, tokenHash } from "../../../server/feedback.js";

const MAX_THREADS = 50;

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return fail(405, "method_not_allowed", { Allow: "GET" });
}

export async function onRequestGet({ request, env }) {
  const token = tokenOf(request);
  if (!token) return fail(400, "bad_token");
  const db = env.FEEDBACK_DB;
  if (!db) return fail(503, "unavailable");
  try {
    const hash = await tokenHash(token);
    const { results: threads = [] } = await db.prepare(
      "SELECT id, created_at, updated_at, kind, message, entry, entry_title, status FROM feedback WHERE token_hash = ? ORDER BY id DESC LIMIT ?",
    ).bind(hash, MAX_THREADS).all();
    if (!threads.length) return reply(200, { ok: true, threads: [] });
    const ids = threads.map(row => row.id);
    const { results: messages = [] } = await db.prepare(
      `SELECT id, feedback_id, created_at, author, message FROM feedback_messages WHERE feedback_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
    ).bind(...ids).all();
    const byThread = new Map(ids.map(id => [id, []]));
    for (const { feedback_id, ...message } of messages) byThread.get(feedback_id)?.push(message);
    return reply(200, { ok: true, threads: threads.map(row => ({ ...row, messages: byThread.get(row.id) })) });
  } catch (error) {
    console.error("feedback/mine: D1 error", error?.message || error);
    return fail(500, "server_error");
  }
}
