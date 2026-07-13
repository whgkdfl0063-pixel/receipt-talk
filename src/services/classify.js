/**
 * 영수증 이미지를 Claude Vision API에 보내서
 * 1) OCR (가맹점명, 금액, 날짜 추출)
 * 2) 맥락 기반 경비/세액공제 분류안 생성
 * 을 한 번의 호출로 처리한다.
 *
 * 별도의 OCR API(Google Vision/Naver Clova 등)를 쓰지 않고 Claude의 이미지 이해 능력을
 * 그대로 활용하는 구조 - API 비용/연동 단계를 하나 줄여준다.
 */

const fetch = require("node-fetch");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `당신은 한국 직장인/프리랜서를 위한 경비·세액공제 분류 비서입니다.
사용자가 보낸 영수증(또는 카드 승인 문자) 이미지를 보고 아래 JSON 스키마로만 답하세요.
다른 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력합니다.

분류 기준:
- purpose_type: "business_expense"(회사/사업 경비로 청구 가능해 보임), "tax_deduction"(연말정산/종합소득세 공제 대상 성격, 예: 의료비/교육비/기부금/신용카드 소득공제 등), "personal"(개인 소비, 공제/경비 무관) 중 하나
- category: 위 purpose_type에 맞는 세부 카테고리 한글 명칭 (예: 접대비, 회의비, 교통비, 소모품비, 의료비, 교육비, 식비(개인) 등)
- confidence: 0~1 사이 분류 확신도
- needs_context: 금액/가맹점 특성상 업무용인지 개인용인지 애매하여 사용자에게 되물어야 하면 true
- context_question: needs_context가 true일 때, 사용자에게 자연스럽게 되물을 한 문장 질문 (예: "오늘 미팅하신 분과의 식사 자리인가요? 접대비로 분류해 둘까요?")

JSON 스키마:
{
  "merchant": string,
  "amount": number,
  "currency": "KRW",
  "receipt_date": "YYYY-MM-DD" | null,
  "purpose_type": "business_expense" | "tax_deduction" | "personal",
  "category": string,
  "confidence": number,
  "needs_context": boolean,
  "context_question": string | null
}`;

async function classifyReceiptImage({ base64Image, mediaType = "image/jpeg", userNote = "" }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다 (.env 확인).");
  }

  const userContent = [
    {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64Image },
    },
    {
      type: "text",
      text: userNote
        ? `이 영수증을 분류해 주세요. 사용자가 추가로 남긴 메모: "${userNote}"`
        : "이 영수증을 분류해 주세요.",
    },
  ];

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API 오류 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude 응답에서 텍스트를 찾을 수 없습니다.");

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`AI 응답 JSON 파싱 실패: ${cleaned}`);
  }

  return { parsed, raw: textBlock.text };
}

/**
 * 사용자가 되물음(context_question)에 답변한 뒤, 최종 분류를 확정할 때 사용.
 * 이미지 없이 텍스트 답변만으로 재분류한다.
 */
async function reclassifyWithContext({ previousParsed, userAnswer }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY가 설정되어 있지 않습니다 (.env 확인).");
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `아래는 이전에 분류한 영수증 정보와, 사용자에게 되물은 질문에 대한 답변입니다.
답변을 반영하여 같은 JSON 스키마로 최종 분류 결과만 다시 출력하세요 (needs_context는 false로).

이전 분류: ${JSON.stringify(previousParsed)}
사용자 답변: "${userAnswer}"`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API 오류 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

module.exports = { classifyReceiptImage, reclassifyWithContext };
