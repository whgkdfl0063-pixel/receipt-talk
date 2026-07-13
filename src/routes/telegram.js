const express = require("express");
const fetch = require("node-fetch");
const router = express.Router();
const { processReceipt } = require("../services/receiptPipeline");

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_API = TG_TOKEN ? `https://api.telegram.org/bot${TG_TOKEN}` : null;

async function sendMessage(chatId, text) {
  if (!TG_API) return;
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function downloadPhotoAsBase64(fileId) {
  const fileInfoRes = await fetch(`${TG_API}/getFile?file_id=${fileId}`);
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${filePath}`);
  const buffer = await fileRes.buffer();
  return { base64: buffer.toString("base64"), ext: filePath.split(".").pop() };
}

// 텔레그램에 등록할 웹훅: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<PUBLIC_BASE_URL>/webhook/telegram
router.post("/webhook", express.json(), async (req, res) => {
  res.sendStatus(200); // 텔레그램은 즉시 200 응답을 기대함 (느린 처리는 비동기로)

  try {
    const message = req.body.message;
    if (!message) return;
    const chatId = message.chat.id;
    const userId = `telegram:${chatId}`;

    if (message.photo && message.photo.length) {
      const largest = message.photo[message.photo.length - 1];
      const { base64, ext } = await downloadPhotoAsBase64(largest.file_id);
      const mediaType = ext === "png" ? "image/png" : "image/jpeg";
      const caption = message.caption || "";

      const result = await processReceipt({
        userId,
        channel: "telegram",
        base64Image: base64,
        mediaType,
        userNote: caption,
      });
      await sendMessage(chatId, result.replyText);
      return;
    }

    if (message.text) {
      const text = message.text.trim();
      if (text === "/start") {
        await sendMessage(
          chatId,
          "안녕하세요! 영수증 톡입니다 🧾\n영수증 사진을 그대로 보내주세요. AI가 자동으로 경비/세액공제 항목을 분류해 드려요."
        );
      } else if (/요약/.test(text)) {
        const { db } = require("../db");
        const ym = new Date().toISOString().slice(0, 7);
        const rows = db
          .prepare(
            `SELECT category, SUM(amount) as total, COUNT(*) as cnt FROM receipts
             WHERE user_id = ? AND receipt_date LIKE ? GROUP BY category`
          )
          .all(userId, `${ym}%`);
        if (!rows.length) {
          await sendMessage(chatId, "이번 달 기록된 영수증이 아직 없어요.");
        } else {
          const lines = rows
            .map((r) => `- ${r.category || "미분류"}: ${r.cnt}건, ${r.total.toLocaleString()}원`)
            .join("\n");
          await sendMessage(chatId, `📊 이번 달(${ym}) 요약\n${lines}`);
        }
      } else {
        await sendMessage(chatId, "영수증 사진을 보내주시면 바로 분류해 드려요!");
      }
    }
  } catch (err) {
    console.error("telegram webhook error", err);
  }
});

module.exports = router;
