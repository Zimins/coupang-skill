# cpcli — 쿠팡 쇼핑 CLI

Playwright 브라우저 자동화로 쿠팡에서 **검색, 장바구니, 주문/결제**를 터미널에서 처리하는 CLI 도구.

실제 Chrome 브라우저를 CDP(Chrome DevTools Protocol)로 제어합니다.

## 사용 방법 1: Claude Code Skill (추천)

Claude Code에서 스킬로 설치하면 자연어로 쿠팡 쇼핑을 할 수 있습니다.

### 스킬 설치

```bash
npx skills add Zimins/coupang-cli
```

### 사용 예시

Claude Code에서 자연어로 요청하면 됩니다:

```
쿠팡에서 펩시 제로 500ml 24개 주문해줘
쿠팡에서 무선 키보드 검색해줘
장바구니에 두루마리 휴지 담아줘
```

또는 슬래시 커맨드로 직접 호출:

```
/coupang-shopping 생수 2L 12개 주문해줘
```

> 스킬이 내부적으로 cpcli CLI를 호출하므로, 아래 초기 설정(계정 정보 등록)은 동일하게 필요합니다.

---

## 사용 방법 2: CLI 직접 사용

### 설치

```bash
npm install -g cpcli
```

또는 설치 없이 바로 실행:

```bash
npx cpcli <command>
```

> **요구사항**: Node.js 18+, macOS (Chrome 설치 필요)

## 초기 설정

### 1. 계정 정보 등록

`~/.coupang-session/credentials.json` 파일을 생성합니다:

```json
{
  "email": "your@email.com",
  "password": "your-password",
  "paymentPin": "123456"
}
```

- `paymentPin`: 쿠페이 결제 비밀번호 (6자리) — **결제 시 필수**. 없으면 결제 단계에서 실패합니다.

### 2. 로그인

```bash
cpcli login
```

- 저장된 계정 정보가 있으면 자동 로그인 시도
- 없거나 실패하면 Chrome 브라우저가 열려 수동 로그인
- 로그인 후 세션이 `~/.coupang-session/`에 저장됨

## 명령어

### 상품 검색

```bash
cpcli search "검색어"
cpcli search "무선 키보드" -o  # 검색 후 바로 주문
```

### 검색 → 바로 주문 (비인터랙티브)

```bash
cpcli order-now "펩시 제로 500ml 24개"                  # 1번 상품, 쿠페이 머니
cpcli order-now "뿌셔뿌셔 1박스" -p card                # 신용/체크카드
cpcli order-now "생수 2L 12개" -n 3                     # 3번 상품 선택
cpcli order-now "휴지" -n 2 -p card                     # 2번 상품, 카드 결제
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-n, --pick <번호>` | 검색 결과에서 선택할 상품 번호 | 1 |
| `-p, --payment <방식>` | 결제 수단 (`coupay` 또는 `card`) | `coupay` |

### 장바구니 담기 (비인터랙티브)

```bash
cpcli cart-add "두루마리 휴지"
cpcli cart-add "코카콜라 제로" -n 2  # 2번 상품
```

### URL로 직접 주문

```bash
cpcli order "https://www.coupang.com/vp/products/..."
```

### 장바구니 조회

```bash
cpcli cart
```

### 로그인 상태 확인 / 로그아웃

```bash
cpcli status
cpcli logout
```

## 동작 방식

```
cpcli order-now "상품명"
  │
  ├─ Chrome 서브프로세스 실행 (CDP 포트 9222)
  ├─ 쿠팡 로그인
  ├─ 쿠팡 검색 → 상품 선택
  ├─ 검색 결과에서 상품 링크 클릭
  ├─ 바로구매 → 주문서 페이지
  ├─ 결제 수단 선택 (쿠페이 머니 / 신용카드)
  ├─ 결제하기 클릭
  ├─ PIN 입력
  └─ 주문 완료 확인
```

## 파일 구조

```
~/.coupang-session/
├── credentials.json          # 계정 정보
├── storage-state.json        # 브라우저 세션
├── chrome-user-data/         # Chrome 사용자 데이터
└── screenshots/              # 디버깅용 스크린샷
    └── order-*.png           # 주문 과정 스크린샷
```

## 주의사항

- **macOS 전용**: Chrome 경로가 macOS 기준으로 하드코딩되어 있습니다
- **결제 주의**: `order-now` 명령은 확인 없이 바로 결제를 진행합니다
- **세션 유지**: Chrome은 주문 후에도 계속 실행 상태를 유지합니다
- **정책 변경**: 쿠팡의 정책에 따라 동작이 변경될 수 있습니다

## 라이선스

MIT
