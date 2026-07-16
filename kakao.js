const express = require("express");
const router = express.Router();

/**
 * 카카오 i 오픈빌더 스킬 응답 포맷 헬퍼
 * https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format
 */
function simpleText(text) {
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text } }] },
  };
}

// 카카오톡 실제 채널에서는 퀵리플라이(webLink) 버튼이 안정적으로 노출되지 않는
// 경우가 있어, 링크를 문구 안에 직접 넣는 방식을 기본으로 사용한다.
// 카카오톡은 메시지 내 URL을 자동으로 탭 가능한 링크로 표시해준다.
function simpleTextWithLink(text, label, url) {
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text: `${text}\n\n${url}` } }] },
  };
}

/**
 * ⚠️ 중요한 구조적 제약:
 * 카카오 i 오픈빌더의 스킬 서버는 "발화(텍스트)"를 기반으로 동작합니다.
 * 사용자가 챗봇 대화창에 사진을 첨부해도, 그 이미지 파일 자체가 스킬 서버로
 * 전달되는 표준 스펙은 없습니다 (2026-07 기준). 따라서 이 라우트는:
 *   1) 텍스트 명령(요약, 내보내기 등)에는 즉시 답하고
 *   2) "영수증 올리기"류 발화에는 업로드 전용 웹뷰 링크(quickReply webLink)를 내려줘서
 *      사용자가 그 링크에서 사진을 업로드하도록 유도합니다.
 * 사진을 실제로 대화창에서 바로 받고 싶다면 텔레그램 채널(src/routes/telegram.js)이
 * 훨씬 간단하므로, 초기 검증 단계에서는 텔레그램 병행을 권장합니다.
 */
router.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const utterance = (body.userRequest && body.userRequest.utterance) || "";
    const kakaoUserId =
      (body.userRequest &&
        body.userRequest.user &&
        body.userRequest.user.id) ||
      "unknown";
    const userId = `kakao:${kakaoUserId}`;

    const uploadBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
    const uploadUrl = `${uploadBaseUrl}/upload.html?u=${encodeURIComponent(userId)}`;
    const ymNow = new Date().toISOString().slice(0, 7);

    const {
      addInvoiceClient,
      listInvoiceClients,
      removeInvoiceClient,
      markInvoiceIssued,
      getUnissuedClients,
    } = require("../db");

    // 거래처 등록: "거래처 등록 OO상사"
    const registerMatch = utterance.match(/거래처\s*등록\s+(.+)/);
    if (registerMatch) {
      const clientName = registerMatch[1].trim();
      if (!clientName) {
        return res.json(simpleText("거래처 이름을 같이 적어주세요. 예: 거래처 등록 OO상사"));
      }
      addInvoiceClient(userId, clientName);
      return res.json(
        simpleText(
          `'${clientName}' 거래처를 등록했어요.\n매달 세금계산서/현금영수증 발행하시면 '발행완료 ${clientName}'라고 말씀해주세요.\n'거래처 목록'이라고 하시면 등록된 거래처를 확인하실 수 있어요.`
        )
      );
    }

    // 거래처 목록 조회
    if (/거래처\s*목록|거래처\s*확인/.test(utterance)) {
      const clients = listInvoiceClients(userId);
      if (!clients.length) {
        return res.json(
          simpleText("등록된 거래처가 없어요. '거래처 등록 OO상사'라고 말씀해서 추가해보세요.")
        );
      }
      const unissued = new Set(getUnissuedClients(userId, ymNow).map((c) => c.client_name));
      const lines = clients
        .map((c) => `- ${c.client_name} ${unissued.has(c.client_name) ? "(이번 달 미발행)" : "(발행완료)"}`)
        .join("\n");
      return res.json(simpleText(`📋 등록된 거래처\n${lines}`));
    }

    // 발행 완료 기록: "발행완료 OO상사" 또는 "세금계산서 발행 OO상사"
    const issueMatch = utterance.match(/(?:발행\s*완료|세금계산서\s*발행)\s+(.+)/);
    if (issueMatch) {
      const clientName = issueMatch[1].trim();
      if (!clientName) {
        return res.json(simpleText("거래처 이름을 같이 적어주세요. 예: 발행완료 OO상사"));
      }
      addInvoiceClient(userId, clientName); // 등록 안 된 거래처면 자동 등록
      markInvoiceIssued(userId, clientName, ymNow);
      return res.json(simpleText(`✅ '${clientName}' 이번 달(${ymNow}) 세금계산서 발행 기록했어요.`));
    }

    if (/영수증|올리기|사진|업로드/.test(utterance)) {
      return res.json(
        simpleTextWithLink(
          "아래 버튼을 눌러 영수증 사진을 올려주세요! 촬영 즉시 AI가 분류해 드려요.",
          "영수증 올리기",
          uploadUrl
        )
      );
    }

    if (/요약|이번\s*달|얼마/.test(utterance)) {
      const { db } = require("../db");
      const ym = ymNow;
      const rows = db
        .prepare(
          `SELECT category, SUM(amount) as total, COUNT(*) as cnt
           FROM receipts
           WHERE user_id = ? AND receipt_date LIKE ?
           GROUP BY category`
        )
        .all(userId, `${ym}%`);

      const unissuedClients = getUnissuedClients(userId, ym);
      const unissuedNote = unissuedClients.length
        ? `\n\n⚠️ 이번 달 세금계산서 미발행 거래처: ${unissuedClients.map((c) => c.client_name).join(", ")}`
        : "";

      if (!rows.length) {
        return res.json(
          simpleText(`이번 달 기록된 영수증이 아직 없어요. 영수증 사진을 보내주세요!${unissuedNote}`)
        );
      }
      const lines = rows
        .map((r) => `- ${r.category || "미분류"}: ${r.cnt}건, ${r.total.toLocaleString()}원`)
        .join("\n");
      return res.json(simpleText(`📊 이번 달(${ym}) 요약\n${lines}${unissuedNote}`));
    }

    if (/내보내기|다운로드|엑셀|신고/.test(utterance)) {
      const exportUrl = `${uploadBaseUrl}/api/export/excel?userId=${encodeURIComponent(userId)}`;
      return res.json(
        simpleTextWithLink(
          "아래 링크에서 지금까지의 경비/공제 내역을 엑셀로 받으실 수 있어요. (무료 플랜은 최근 10건만 포함)",
          "엑셀 다운로드",
          exportUrl
        )
      );
    }

    // 기본 안내
    return res.json(
      simpleTextWithLink(
        "안녕하세요! 영수증 톡입니다 🧾\n영수증 사진을 보내주시면 AI가 자동으로 경비/세액공제 항목을 분류해 드려요.\n'이번 달 요약', '엑셀 내보내기', '거래처 등록 OO상사', '발행완료 OO상사'라고 말씀하셔도 돼요.",
        "영수증 올리기",
        uploadUrl
      )
    );
  } catch (err) {
    console.error(err);
    return res.json(simpleText("죄송해요, 처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요."));
  }
});

module.exports = router;
