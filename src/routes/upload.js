const express = require("express");
const multer = require("multer");
const router = express.Router();
const { processReceipt } = require("../services/receiptPipeline");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 카카오 웹뷰(upload.html)나 다른 웹 채널에서 이미지를 업로드할 때 쓰는 엔드포인트
router.post("/api/upload", upload.single("receipt"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "receipt 파일이 필요합니다." });
    const userId = req.body.userId || "web:anonymous";
    const note = req.body.note || "";

    const result = await processReceipt({
      userId,
      channel: userId.startsWith("kakao:") ? "kakao" : "web",
      base64Image: req.file.buffer.toString("base64"),
      mediaType: req.file.mimetype,
      userNote: note,
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
