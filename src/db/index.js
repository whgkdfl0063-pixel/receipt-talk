const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite"); // Node 22.5+ 내장 모듈 - 별도 컴파일/설치 불필요

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "receipt-talk.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,          -- 카카오 botUserKey 또는 텔레그램 chat id (channel 접두어 포함)
  channel TEXT NOT NULL,        -- 'kakao' | 'telegram' | 'web'
  plan TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  image_path TEXT,
  merchant TEXT,
  amount INTEGER,
  currency TEXT DEFAULT 'KRW',
  receipt_date TEXT,
  category TEXT,               -- 예: 접대비, 교통비, 식비(개인), 세액공제_의료비 등
  purpose_type TEXT,           -- 'business_expense' | 'tax_deduction' | 'personal'
  context_note TEXT,           -- AI가 물어본 맥락에 대한 사용자 답변
  ai_raw_response TEXT,        -- LLM 원본 응답(JSON) 보관
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending_review', -- 'pending_review' | 'approved' | 'rejected'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);

CREATE TABLE IF NOT EXISTS monthly_usage (
  user_id TEXT NOT NULL,
  year_month TEXT NOT NULL,     -- '2026-07'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year_month)
);
`);

function ensureUser(userId, channel) {
  db.prepare(
    `INSERT INTO users (id, channel) VALUES (?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(userId, channel);
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
}

function getMonthlyCount(userId, yearMonth) {
  const row = db
    .prepare(`SELECT count FROM monthly_usage WHERE user_id = ? AND year_month = ?`)
    .get(userId, yearMonth);
  return row ? row.count : 0;
}

function incrementMonthlyCount(userId, yearMonth) {
  db.prepare(
    `INSERT INTO monthly_usage (user_id, year_month, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, year_month) DO UPDATE SET count = count + 1`
  ).run(userId, yearMonth);
}

module.exports = { db, ensureUser, getMonthlyCount, incrementMonthlyCount };
