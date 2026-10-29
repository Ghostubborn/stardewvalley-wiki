-- 访客能在“我的反馈”里看到自己提交的反馈和维护者的回复，可以继续追问或补充。
-- 访客浏览器里存一把随机令牌，这里只存它的摘要 token_hash；没有令牌的旧反馈只有维护者能看到。
ALTER TABLE feedback ADD COLUMN token_hash TEXT;
ALTER TABLE feedback ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS feedback_token_hash ON feedback (token_hash, id);

-- 反馈下面的留言：visitor 是访客的追问或补充，team 是维护者的回复（用 scripts/feedback.mjs 写入）。
-- status 的取值：new 待处理（访客追问后也回到 new）、replied 已回复、done 已处理、wontfix 暂不处理、duplicate 重复。
CREATE TABLE IF NOT EXISTS feedback_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL REFERENCES feedback (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  author TEXT NOT NULL,
  message TEXT NOT NULL,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS feedback_messages_thread ON feedback_messages (feedback_id, id);
CREATE INDEX IF NOT EXISTS feedback_messages_ip_hash ON feedback_messages (ip_hash, created_at);
