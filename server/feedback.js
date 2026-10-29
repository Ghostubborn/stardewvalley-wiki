/* 访客反馈接口（functions/api/feedback/）共用的代码：JSON 答复、请求检查、限流用的 IP 摘要、访客令牌。
   放在 functions/ 外面：functions/ 里的每个文件都会成为一个网址。 */

export const KINDS = new Set(["error", "missing", "spoiler", "display", "idea", "other"]);
export const MAX_BODY = 8 * 1024;
export const WINDOW_MS = 10 * 60 * 1000;
export const MAX_MESSAGE = 2000;
// 不保存原始 IP：IP、UTC 日期和这个固定字符串一起取 SHA-256，同一天内可以限流，跨天不能关联。
const SALT = "stardewvalley-wiki/feedback";
// 访客令牌（浏览器里随机生成，见 prototype/js/feedback.js）只存摘要；有令牌的人才能看到对应的反馈。
const TOKEN_SALT = "stardewvalley-wiki/feedback-token";
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

export function reply(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
export const fail = (status, error, headers) => reply(status, { ok: false, error }, headers);

// 只收本站页面发来的写入请求：带 Origin 的必须是同一个站点；正文必须是不超过 8 KB 的 JSON 对象。
export async function readJson(request) {
  const origin = request.headers.get("Origin");
  if (origin !== null && hostOf(origin) !== new URL(request.url).host) return { error: fail(403, "bad_origin") };
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return { error: fail(415, "bad_content_type") };
  const text = await readBody(request);
  if (text === null) return { error: fail(413, "too_large") };
  let data;
  try { data = JSON.parse(text); } catch { return { error: fail(400, "bad_json") }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: fail(400, "bad_json") };
  return { data };
}

function hostOf(origin) {
  try { return new URL(origin).host; } catch { return null; }
}

// 最多读 8 KB，超过就停止读取并返回 null。
async function readBody(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

// 按码点截断，不会留下半个字；空白和非字符串存为 NULL。
export function clip(value, max) {
  if (typeof value !== "string") return null;
  const chars = Array.from(value.trim());
  return chars.length ? chars.slice(0, max).join("") : null;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export const ipHash = (request, now) => sha256(`${request.headers.get("CF-Connecting-IP") || ""}|${now.toISOString().slice(0, 10)}|${SALT}`);

// 访客令牌放在 X-Feedback-Token 请求头里；格式不对的当作没有。
export function tokenOf(request) {
  const token = (request.headers.get("X-Feedback-Token") || "").trim();
  return TOKEN_RE.test(token) ? token : null;
}
export const tokenHash = token => sha256(`${token}|${TOKEN_SALT}`);

// 同一来源 10 分钟内写入的条数（新反馈和追问分别计数）。
export async function recentCount(db, table, ipHashValue, now) {
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const extra = table === "feedback_messages" ? " AND author = 'visitor'" : "";
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ip_hash = ? AND created_at > ?${extra}`).bind(ipHashValue, since).first();
  return Number(row?.n) || 0;
}
