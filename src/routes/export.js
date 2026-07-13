const express = require("express");
const ExcelJS = require("exceljs");
const router = express.Router();
const { db, ensureUser } = require("../db");
const { FREE_MONTHLY_LIMIT } = require("../services/receiptPipeline");

router.get("/api/export/excel", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId가 필요합니다." });

  const user = ensureUser(userId, "web");
  const isPro = user.plan === "pro";

  const rows = db
    .prepare(
      `SELECT * FROM receipts WHERE user_id = ? AND status != 'rejected' ORDER BY receipt_date DESC, created_at DESC`
    )
    .all(userId);

  const limited = isPro ? rows : rows.slice(0, FREE_MONTHLY_LIMIT);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "영수증 톡 (Receipt Talk)";

  const sheet = workbook.addWorksheet("경비-세액공제 내역");
  sheet.columns = [
    { header: "날짜", key: "receipt_date", width: 14 },
    { header: "가맹점", key: "merchant", width: 24 },
    { header: "금액", key: "amount", width: 14 },
    { header: "통화", key: "currency", width: 8 },
    { header: "분류(구분)", key: "purpose_type", width: 18 },
    { header: "카테고리", key: "category", width: 18 },
    { header: "메모/맥락", key: "context_note", width: 30 },
    { header: "검수상태", key: "status", width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };

  const purposeLabel = {
    business_expense: "회사경비",
    tax_deduction: "세액공제",
    personal: "개인지출",
  };
  const statusLabel = {
    pending_review: "검수대기",
    approved: "승인완료",
  };

  limited.forEach((r) => {
    sheet.addRow({
      receipt_date: r.receipt_date || "",
      merchant: r.merchant || "",
      amount: r.amount || 0,
      currency: r.currency || "KRW",
      purpose_type: purposeLabel[r.purpose_type] || r.purpose_type || "",
      category: r.category || "",
      context_note: r.context_note || "",
      status: statusLabel[r.status] || r.status,
    });
  });

  sheet.getColumn("amount").numFmt = "#,##0";

  // 요약 시트 (카테고리별 합계) - 종합소득세 신고 시 참고용
  const summarySheet = workbook.addWorksheet("카테고리별 요약");
  summarySheet.columns = [
    { header: "카테고리", key: "category", width: 20 },
    { header: "건수", key: "count", width: 10 },
    { header: "합계금액", key: "total", width: 16 },
  ];
  summarySheet.getRow(1).font = { bold: true };

  const grouped = {};
  limited.forEach((r) => {
    const key = r.category || "미분류";
    if (!grouped[key]) grouped[key] = { count: 0, total: 0 };
    grouped[key].count += 1;
    grouped[key].total += r.amount || 0;
  });
  Object.entries(grouped).forEach(([category, v]) => {
    summarySheet.addRow({ category, count: v.count, total: v.total });
  });
  summarySheet.getColumn("total").numFmt = "#,##0";

  if (!isPro && rows.length > FREE_MONTHLY_LIMIT) {
    sheet.addRow({});
    sheet.addRow({
      merchant: `무료 플랜은 최근 ${FREE_MONTHLY_LIMIT}건까지만 제공됩니다. 구독(월 4,900원) 시 전체 내역이 포함돼요.`,
    });
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="receipt-talk-export.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
