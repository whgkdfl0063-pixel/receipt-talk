require("dotenv").config();
const express = require("express");
const path = require("path");

const kakaoRoutes = require("./routes/kakao");
const telegramRoutes = require("./routes/telegram");
const uploadRoutes = require("./routes/upload");
const adminRoutes = require("./routes/admin");
const exportRoutes = require("./routes/export");

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/webhook/kakao", kakaoRoutes);
app.use("/webhook/telegram", telegramRoutes);
app.use("/", uploadRoutes);
app.use("/", adminRoutes);
app.use("/", exportRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`영수증 톡 서버 실행 중: http://localhost:${PORT}`);
});
