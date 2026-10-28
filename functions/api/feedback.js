/* 访客反馈：POST /api/feedback（Cloudflare Pages Function），写入 D1 的 feedback 表（绑定 FEEDBACK_DB）。
   只收不读：没有列出反馈的接口，维护者用 wrangler d1 execute 查看，见 docs/cloudflare-pages.md。 */

const KINDS = new Set(["error", "missing", "spoiler", "display", "idea", "other"]);
const MAX_BODY = 8 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_IN_WINDOW = 5;
// 不保存原始 IP：IP、UTC 日期和这个固定字符串一起取 SHA-256，同一天内可以限流，跨天不能关联。
const SALT = "stardewvalley-wiki/feedback";
// 自动附带的信息超长时截断，不因此拒收。
const CAPS = { entry: 200, entry_title: 200, url: 1000, lang: 16, viewport: 32, user_agent: 400, app_version: 64 };
const COLUMNS = ["created_at", "kind", "message", "contact", ...Object.keys(CAPS), "ip_hash"];

function reply(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
const fail = (status, error, headers) => reply(status, { ok: false, error }, headers);

// 其他请求方法一律 405；POST 交给 onRequestPost（Pages 先匹配带方法的处理函数，这里只是兜底）。
export function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return fail(405, "method_not_allowed", { Allow: "POST" });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin !== null && hostOf(origin) !== new URL(request.url).host) return fail(403, "bad_origin");
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return fail(415, "bad_content_type");
  const text = await readBody(request);
  if (text === null) return fail(413, "too_large");
  let data;
  try { data = JSON.parse(text); } catch { return fail(400, "bad_json"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail(400, "bad_json");
  // 蜜罐：页面上看不见的 website 栏，填了的是机器人。照常答复，但不保存。
  if (data.website != null && String(data.website).trim() !== "") return reply(200, { ok: true });

  if (!KINDS.has(data.kind)) return fail(400, "bad_kind");
  const message = typeof data.message === "string" ? data.message.trim() : "";
  if (message.length < 2) return fail(400, "message_too_short");
  if (message.length > 2000) return fail(400, "message_too_long");
  const contact = typeof data.contact === "string" ? data.contact.trim() : "";
  if (contact.length > 100) return fail(400, "contact_too_long");
  const extra = Object.fromEntries(Object.entries(CAPS).map(([key, max]) => [key, clip(data[key], max)]));
  extra.user_agent ??= clip(request.headers.get("User-Agent"), CAPS.user_agent);

  const db = env.FEEDBACK_DB;
  if (!db) return fail(503, "unavailable");
  const now = new Date();
  try {
    const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") || "", now);
    const since = new Date(now.getTime() - WINDOW_MS).toISOString();
    const recent = await db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created_at > ?").bind(ipHash, since).first();
    if (Number(recent?.n) >= MAX_IN_WINDOW) return fail(429, "rate_limited", { "Retry-After": String(WINDOW_MS / 1000) });
    const row = { created_at: now.toISOString(), kind: data.kind, message, contact: contact || null, ...extra, ip_hash: ipHash };
    const result = await db.prepare(`INSERT INTO feedback (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`)
      .bind(...COLUMNS.map(column => row[column])).run();
    return reply(200, { ok: true, id: result.meta?.last_row_id ?? null });
  } catch (error) {
    // 日志里不写反馈内容。
    console.error("feedback: D1 error", error?.message || error);
    return fail(500, "server_error");
  }
}

function hostOf(origin) {
  try { return new URL(origin).host; } catch { return null; }
}

// 按码点截断，不会留下半个字；空白和非字符串存为 NULL。
function clip(value, max) {
  if (typeof value !== "string") return null;
  const chars = Array.from(value.trim());
  return chars.length ? chars.slice(0, max).join("") : null;
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

async function hashIp(ip, now) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${now.toISOString().slice(0, 10)}|${SALT}`));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
