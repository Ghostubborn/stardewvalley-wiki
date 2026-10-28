-- 访客反馈：由 functions/api/feedback.js 写入。没有原始 IP，ip_hash 是按日变化的摘要，只用于限流。
-- status：new 待处理；处理后由维护者改成 done（或 wontfix、duplicate），note 写处理说明。
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  contact TEXT,
  entry TEXT,
  entry_title TEXT,
  url TEXT,
  lang TEXT,
  viewport TEXT,
  user_agent TEXT,
  app_version TEXT,
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT
);
CREATE INDEX IF NOT EXISTS feedback_created_at ON feedback (created_at);
CREATE INDEX IF NOT EXISTS feedback_ip_hash_created_at ON feedback (ip_hash, created_at);
