const { nanoid } = require("nanoid");
const fs = require("fs");
const path = require("path");
const {
  db,
  ensureUser,
  getMonthlyCount,
  incrementMonthlyCount,
} = require("../db");
const { classifyReceiptImage } = require("./classify");

const FREE_MONTHLY_LIMIT = parseInt(process.env.FREE_MONTHLY_LIMIT || "10", 10);
const UPLOAD_DIR = path.join(__dirname, "..", "..", "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

/**
 * 영수증 이미지(base64) 1건을 처리한다.
 * - 무료 플랜 월 10장 제한 체크
 * - Claude Vision으로 OCR + 맥락 분류
 * - DB 저장 (기본 상태: pending_review)
 * - 채널에 보낼 응답 문구를 함께 반환
 */
async function processReceipt({ userId, channel, base64Image, mediaType, userNote }) {
  const user = ensureUser(userId, channel);
  const ym = currentYearMonth();
  const usedCount = getMonthlyCount(userId, ym);

  if (user.plan === "free" && usedCount >= FREE_MONTHLY_LIMIT) {
    return {
      limited: true,
      replyText: `이번 달 무료 분류(${FREE_MONTHLY_LIMIT}장)를 모두 사용하셨어요.\n월 4,900원 구독하시면 무제한 분류 + 연말 신고용 파일 다운로드가 가능합니다.`,
    };
  }

  // 이미지 파일 보관 (증빙자료로 재열람 가능해야 하므로)
  const receiptId = nanoid(12);
  const ext = mediaType && mediaType.includes("png") ? "png" : "jpg";
  const imagePath = path.join(UPLOAD_DIR, `${receiptId}.${ext}`);
  fs.writeFileSync(imagePath, Buffer.from(base64Image, "base64"));

  const { parsed, raw } = await classifyReceiptImage({ base64Image, mediaType, userNote });

  db.prepare(
    `INSERT INTO receipts
      (id, user_id, image_path, merchant, amount, currency, receipt_date,
       category, purpose_type, context_note, ai_raw_response, confidence, status)
     VALUES (@id, @user_id, @image_path, @merchant, @amount, @currency, @receipt_date,
       @category, @purpose_type, @context_note, @ai_raw_response, @confidence, @status)`
  ).run({
    id: receiptId,
    user_id: userId,
    image_path: imagePath,
    merchant: parsed.merchant || null,
    amount: parsed.amount || null,
    currency: parsed.currency || "KRW",
    receipt_date: parsed.receipt_date || null,
    category: parsed.category || null,
    purpose_type: parsed.purpose_type || null,
    context_note: userNote || null,
    ai_raw_response: raw,
    confidence: parsed.confidence || null,
    status: "pending_review",
  });

  incrementMonthlyCount(userId, ym);

  let replyText;
  if (parsed.needs_context && parsed.context_question) {
    replyText = `${parsed.merchant || "가맹점"} / ${(parsed.amount || 0).toLocaleString()}원 기록했어요.\n${parsed.context_question}`;
  } else {
    replyText = `✅ 기록 완료!\n${parsed.merchant || "가맹점"} · ${(parsed.amount || 0).toLocaleString()}원\n분류: ${parsed.category || "미분류"} (${parsed.purpose_type || "-"})`;
  }

  return { limited: false, receiptId, parsed, replyText };
}

module.exports = { processReceipt, FREE_MONTHLY_LIMIT };
