# 영수증 톡 (Receipt Talk) — MVP 백엔드

카카오톡/텔레그램으로 영수증 사진을 보내면 Claude Vision API가 OCR + 맥락 분류(경비/세액공제/개인지출)를
해주고, 관리자는 하루 한 번 검수만 하면 되는 구조의 백엔드입니다.

## 1. 구조

```
src/
  server.js              앱 진입점
  db/index.js            SQLite 스키마 + 헬퍼
  services/
    classify.js           Claude Vision API 호출 (OCR + 분류를 한 번에)
    receiptPipeline.js     무료 한도 체크 → 분류 → 저장 (채널 공통 로직)
  routes/
    kakao.js               카카오 i 오픈빌더 스킬 서버 웹훅
    telegram.js             텔레그램 봇 웹훅 (사진 직접 수신, 초기 검증용)
    upload.js               웹뷰용 이미지 업로드 API
    admin.js                관리자 검수 API
    export.js               엑셀(경비/세액공제 내역 + 카테고리 요약) 내보내기
public/
  upload.html             모바일 업로드 웹뷰 (카카오 챗봇 링크에서 열림)
  admin.html              관리자 검수 대시보드
```

## 2. 아주 중요한 구조적 제약 (먼저 읽어주세요)

**카카오 i 오픈빌더의 스킬 서버는 "텍스트 발화" 기반입니다.** 사용자가 챗봇 대화창에 사진을 첨부해도
그 이미지 파일이 스킬 서버로 표준적으로 전달되는 방법이 없습니다 (2026-07 기준 공식 문서 확인).

그래서 이 코드는 두 가지 경로를 같이 열어뒀습니다.

- **카카오 경로**: 텍스트 명령(요약/내보내기 등)은 챗봇이 바로 답하고, "영수증 올리기"라고 하면
  `public/upload.html` 웹뷰 링크를 버튼으로 내려줍니다. 사용자는 그 링크를 눌러 사진을 업로드합니다.
  → 카카오톡 안에서는 열리지만, "톡에 사진을 툭 던지면 끝"인 경험은 아니고 한 번의 탭이 더 필요합니다.
- **텔레그램 경로** (`src/routes/telegram.js`): 텔레그램 Bot API는 대화창에 보낸 사진을 그대로
  웹훅으로 받을 수 있어서, 사업계획서에서 그리신 "사진 툭 던지기" UX를 지금 당장 100% 구현할 수 있습니다.
  **MVP 검증(특히 지인 테스트, 초기 트래픽 확인)은 텔레그램으로 먼저 하고, 카카오는 검증 후 정식 채널로
  붙이는 순서를 권장드립니다.**

두 경로 모두 내부적으로는 동일한 `services/receiptPipeline.js`를 사용하므로 로직 중복은 없습니다.

## 3. 로컬 실행

```bash
npm install
cp .env.example .env
# .env에 ANTHROPIC_API_KEY, ADMIN_KEY 채워넣기
npm start
# http://localhost:3000/health 로 확인
```

외부(카카오/텔레그램)에서 로컬 서버로 웹훅을 보내려면 개발 중에는 ngrok 등으로 터널링하고,
`PUBLIC_BASE_URL`을 그 주소로 맞춰주세요. 실제 운영은 Vercel/Render/Cafe24 등에 배포하시면 됩니다.

## 4. 카카오 채널 연동 순서

1. 카카오톡 채널 개설 (비즈니스 채널)
2. [카카오 i 오픈빌더](https://i.kakao.com/) 에서 챗봇 생성 → 채널 연결
3. **스킬** 메뉴에서 스킬 생성, URL을 `https://<배포주소>/webhook/kakao/webhook` 로 등록
4. 폴백 블록(및 필요한 블록들)의 파라미터 설정에서 방금 만든 스킬 연결
5. **배포** 버튼을 눌러야 실제 반영됩니다.

## 5. 텔레그램 봇 연동 순서 (더 간단, 먼저 추천)

1. 텔레그램에서 **@BotFather** 에게 `/newbot` → 토큰 발급 → `.env`의 `TELEGRAM_BOT_TOKEN`에 입력
2. 서버 배포 후 아래 URL을 브라우저로 한 번 호출해 웹훅 등록:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<배포주소>/webhook/telegram/webhook
   ```
3. 봇에게 사진을 보내면 바로 분류 결과가 옵니다.

## 6. 관리자 검수

`https://<배포주소>/admin.html` 접속 → ADMIN_KEY 입력 → 검수대기 목록에서 사진/분류 확인 후
**승인/반려**. 하루 1번, 오류만 눈으로 훑는 용도로 설계했습니다.

정확도가 충분히 쌓이면(사업계획서상 98%+) `receiptPipeline.js`에서 `status`를
`pending_review` 대신 바로 `approved`로 저장하도록 한 줄만 바꾸면 "인간 검수 없이 즉시 발송" 모드로
전환됩니다.

## 7. 수익 모델 구현 지점

- `FREE_MONTHLY_LIMIT` (기본 10장/월) — `receiptPipeline.js`에서 체크, 초과 시 구독 유도 메시지 발송
- `users.plan` 컬럼을 `'pro'`로 바꾸면 무제한 + 엑셀 전체 다운로드 허용 (`export.js`가 자동 반영)
- 실제 결제 연동(예: 카카오페이 정기결제, 토스페이먼츠 빌링)은 아직 붙어있지 않습니다.
  결제 성공 웹훅에서 `UPDATE users SET plan='pro' WHERE id=?` 한 줄만 실행하면 되는 구조로 만들어뒀습니다.

## 8. 다음 단계 제안

1. 텔레그램으로 먼저 지인 20~30명 대상 2주 파일럿 → 분류 정확도/이탈 지점 확인
2. 결제 연동 (토스페이먼츠 빌링 API가 개인사업자 기준 붙이기 가장 쉬움)
3. 정확도 데이터 쌓이면 few-shot 예시를 `classify.js`의 시스템 프롬프트에 추가해 정확도 개선
4. 카카오 채널은 파일럿에서 검증된 뒤 정식 확장
