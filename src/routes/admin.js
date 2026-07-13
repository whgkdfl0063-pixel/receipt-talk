const express = require("express");
const router = express.Router();
const { db } = require("../db");
const path = require("path");
const fs = require("fs");

function requireAdmin(req, res, next) {
  const key = req.query.key || req.headers["x-admin-key"];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "관리자 인증 실패 (ADMIN_KEY 확인)" });
  }
  next();
}

// 검수 대기 목록 (기본: pending_review, 최신순)
router.get("/api/admin/receipts", requireAdmin, (req, res) => {
  const status = req.query.status || "pending_review";
  const rows = db
    .prepare(`SELECT * FROM receipts WHERE status = ? ORDER BY created_at DESC LIMIT 200`)
    .all(status);
  res.json(rows);
});

// 승인 (AI 분류가 맞으면 그대로 승인)
router.post("/api/admin/receipts/:id/approve", requireAdmin, (req, res) => {
  db.prepare(
    `UPDATE receipts SET status = 'approved', approved_at = datetime('now') WHERE id = ?`
  ).run(req.params.id);
  res.json({ ok: true });
});

// 수정 후 승인 (분류가 틀렸을 때 카테고리/purpose_type을 고쳐서 저장)
router.post("/api/admin/receipts/:id/correct", requireAdmin, express.json(), (req, res) => {
  const { category, purpose_type, amount, merchant } = req.body;
  db.prepare(
    `UPDATE receipts
     SET category = COALESCE(?, category),
         purpose_type = COALESCE(?, purpose_type),
         amount = COALESCE(?, amount),
         merchant = COALESCE(?, merchant),
         status = 'approved',
         approved_at = datetime('now')
     WHERE id = ?`
  ).run(category, purpose_type, amount, merchant, req.params.id);
  res.json({ ok: true });
});

router.post("/api/admin/receipts/:id/reject", requireAdmin, (req, res) => {
  db.prepare(`UPDATE receipts SET status = 'rejected' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// 간단 대시보드 통계 - 자동화 전환 시점 판단용 (정확도 추정을 위해 correct 비율 등 참고)
router.get("/api/admin/stats", requireAdmin, (req, res) => {
  const total = db.prepare(`SELECT COUNT(*) as c FROM receipts`).get().c;
  const pending = db.prepare(`SELECT COUNT(*) as c FROM receipts WHERE status='pending_review'`).get().c;
  const approved = db.prepare(`SELECT COUNT(*) as c FROM receipts WHERE status='approved'`).get().c;
  const rejected = db.prepare(`SELECT COUNT(*) as c FROM receipts WHERE status='rejected'`).get().c;
  res.json({ total, pending, approved, rejected });
});

// 관리자 검수 화면에서 영수증 원본 이미지를 미리보기로 보여주기 위한 엔드포인트
router.get("/data-image", requireAdmin, (req, res) => {
  const imgPath = req.query.path;
  if (!imgPath || !fs.existsSync(imgPath)) return res.status(404).end();
  res.sendFile(path.resolve(imgPath));
});

module.exports = router;
