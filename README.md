# cpcli — 쿠팡 쇼핑 자동화 CLI

Playwright 브라우저 자동화로 쿠팡에서 **검색, 장바구니, 주문/결제**를 터미널에서 처리하는 CLI 도구.

실제 Chrome 브라우저를 CDP(Chrome DevTools Protocol)로 제어합니다.

## 설치

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

- `paymentPin`: 쿠페이 결제 비밀번호 (6자리)

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

## 결제 PIN 키패드

쿠팡은 결제 시 랜덤 배치 PIN 키패드를 사용합니다. cpcli는 다음 방식으로 처리합니다:

1. 각 키패드 버튼을 스크린샷으로 캡쳐 (`~/.coupang-session/screenshots/pad-key-*.png`)
2. `~/.coupang-session/keypad-ready` 시그널 파일 생성
3. 외부에서 스크린샷을 읽고 `~/.coupang-session/keypad-mapping.json` 작성 대기 (최대 120초)
4. 매핑 파일이 생기면 자동으로 PIN 입력 완료

**매핑 파일 형식** (`keypad-mapping.json`):

```json
{"0":"3","1":"7","2":"5","3":"1","4":"9","5":"0","6":"8","7":"4","8":"2","9":"6"}
```

키: 버튼 인덱스 (0~9), 값: 해당 버튼에 표시된 숫자.

> Claude Code의 이미지 인식 기능과 연동하면 완전 자동 결제가 가능합니다.

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
  ├─ PIN 키패드 처리 (스크린샷 → 매핑 → 자동 입력)
  └─ 주문 완료 확인
```

## 파일 구조

```
~/.coupang-session/
├── credentials.json          # 계정 정보
├── storage-state.json        # 브라우저 세션
├── chrome-user-data/         # Chrome 사용자 데이터
├── keypad-mapping.json       # PIN 키패드 매핑 (런타임)
├── keypad-ready              # 키패드 준비 시그널 (런타임)
└── screenshots/              # 디버깅용 스크린샷
    ├── pad-key-0.png ~ 9.png # PIN 키패드 버튼
    └── order-*.png           # 주문 과정 스크린샷
```

## 주의사항

- **macOS 전용**: Chrome 경로가 macOS 기준으로 하드코딩되어 있습니다
- **결제 주의**: `order-now` 명령은 확인 없이 바로 결제를 진행합니다
- **세션 유지**: Chrome은 주문 후에도 계속 실행 상태를 유지합니다
- **정책 변경**: 쿠팡의 정책에 따라 동작이 변경될 수 있습니다

## 라이선스

MIT
