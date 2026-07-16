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

-- 세금계산서/현금영수증 발행 리마인더용 테이블
-- 카카오 스킬 서버는 사용자가 먼저 말을 걸어야만 응답 가능한 구조라(푸시 알림 불가,
-- 별도의 알림톡/친구톡 API 및 심사가 필요) "매달 자동으로 톡이 온다"가 아니라,
-- 사용자가 '이번 달 요약'을 물어볼 때 "아직 발행 안 한 거래처"를 같이 알려주는 방식으로 동작한다.
CREATE TABLE IF NOT EXISTS invoice_clients (
  user_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_name)
);

CREATE TABLE IF NOT EXISTS invoice_log (
  user_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  year_month TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_name, year_month)
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

function addInvoiceClient(userId, clientName) {
  db.prepare(
    `INSERT OR IGNORE INTO invoice_clients (user_id, client_name) VALUES (?, ?)`
  ).run(userId, clientName);
}

function listInvoiceClients(userId) {
  return db
    .prepare(`SELECT client_name FROM invoice_clients WHERE user_id = ? ORDER BY created_at`)
    .all(userId);
}

function removeInvoiceClient(userId, clientName) {
  db.prepare(`DELETE FROM invoice_clients WHERE user_id = ? AND client_name = ?`).run(
    userId,
    clientName
  );
}

function markInvoiceIssued(userId, clientName, yearMonth) {
  db.prepare(
    `INSERT OR IGNORE INTO invoice_log (user_id, client_name, year_month) VALUES (?, ?, ?)`
  ).run(userId, clientName, yearMonth);
}

function getUnissuedClients(userId, yearMonth) {
  return db
    .prepare(
      `SELECT c.client_name FROM invoice_clients c
       WHERE c.user_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM invoice_log l
         WHERE l.user_id = c.user_id AND l.client_name = c.client_name AND l.year_month = ?
       )
       ORDER BY c.created_at`
    )
    .all(userId, yearMonth);
}

module.exports = {
  db,
  ensureUser,
  getMonthlyCount,
  incrementMonthlyCount,
  addInvoiceClient,
  listInvoiceClients,
  removeInvoiceClient,
  markInvoiceIssued,
  getUnissuedClients,
};
