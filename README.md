# 배드민턴 전술판

태블릿(아이패드 / 갤럭시 탭)용 오프라인 배드민턴 전술판. 서버가 필요 없습니다.

- 선수·셔틀 배치, 펜/화살표/지우개
- 담당 존 표시 (자동 존 = 두 선수 위치 기반, 원형 존)
- **프레임**: 배치를 여러 장 찍어 로테이션을 순서대로 재생
- **전술 저장**: 이름을 붙여 여러 전술을 저장/불러오기, JSON으로 내보내기·가져오기
- PNG 저장 (iOS는 공유 시트로 바로 전달)

## 화면 배치

코트 크기를 먼저 최대로 잡고, **남는 띠가 조작 패널**이 됩니다. 코트 비율이 1.95:1로
고정이라 화면과 어긋나는 쪽에 항상 여백이 생기는데, 패널이 그 여백을 쓰기 때문에
코트는 늘 그 화면에서 가능한 최대 크기가 됩니다.

- 가로 태블릿 → 남는 쪽이 아래 → 패널이 코트 아래 가로 띠로
- 세로 태블릿 → 남는 쪽이 옆 → 패널이 코트 옆 세로 열로

어느 변에 붙을지는 `js/ui.js`의 `layout()`이 두 후보의 코트 크기를 비교해 매번 고릅니다
(고정 분기나 미디어 쿼리가 아닙니다). 상단 **도구 숨기기**는 패널을 감춰 코트만 보여줍니다 —
선수들에게 화면을 보여줄 때 쓰는 버튼이고, 화면이 짧을 때를 빼면 코트 크기는 그대로입니다.

## 파일 구조

```
index.html              화면 구조
css/app.css             레이아웃 (세로/가로 한 벌로 처리)
js/geometry.js          코트 치수(미터)와 화면 좌표 변환
js/state.js             프레임 문서, 되돌리기, 저장소, 전술 라이브러리
js/render.js            캔버스 그리기 (화면·PNG 공용)
js/ui.js                입력, 재생, 라이브러리 UI
manifest.webmanifest    설치 정보
sw.js                   오프라인 캐시
icons/                  앱 아이콘
tools/make-icons.py     아이콘 생성 스크립트 (의존성 없음)
legacy/index-v1.html    이전 단일 파일 버전 (참고용)
```

좌표는 전부 **미터**로 다룹니다. 코트 규격(길이 13.40m, 복식 폭 6.10m, 단식 폭 5.18m,
숏서비스라인 1.98m, 복식 롱서비스라인 0.76m)은 `js/geometry.js`의 `COURT` 한 곳에만 있습니다.

## 로컬에서 보기

```bash
python3 -m http.server 8777
# http://localhost:8777
```

서비스 워커(오프라인 캐시)는 `http://localhost` 또는 `https://`에서만 동작합니다.
`index.html`을 파일로 직접 열어도 앱 자체는 돌아가지만 설치·오프라인 캐시는 안 됩니다.

## 배포 (무료)

GitHub Pages 기준:

```bash
git init
git add .
git commit -m "배드민턴 전술판"
git branch -M main
git remote add origin https://github.com/<계정>/badminton.git
git push -u origin main
```

GitHub 저장소 → Settings → Pages → Source를 `main` / `/ (root)`로 지정하면
`https://<계정>.github.io/badminton/` 에서 열립니다.
(Cloudflare Pages, Netlify 무료 플랜도 동일하게 정적 업로드만 하면 됩니다.)

### 태블릿에 설치

- **아이패드**: Safari로 주소를 열고 → 공유 → "홈 화면에 추가"
- **갤럭시 탭**: Chrome으로 열고 → 메뉴 → "앱 설치" 또는 "홈 화면에 추가"

설치 후에는 네트워크 없이 열립니다. 주소창 없는 전체 화면으로 뜹니다.

### 업데이트할 때

파일을 고친 뒤 **반드시 `sw.js`의 `CACHE` 값을 올리세요** (예: `bts-v2.0.0` → `bts-v2.0.1`).
값이 그대로면 설치된 기기가 이전 버전을 계속 캐시에서 보여줍니다.
새 파일을 추가했다면 `sw.js`의 `ASSETS` 목록에도 넣어야 오프라인에서 받습니다.

## 나중에 네이티브 앱으로 (선택)

웹 코드를 그대로 감싸는 방식이라 추가 작업이 적습니다.

```bash
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "배드민턴 전술판" com.example.badminton --web-dir=.
npx cap add ios && npx cap add android
npx cap open ios      # Xcode
npx cap open android  # Android Studio
```

비용: Capacitor는 무료, Google Play 개발자 등록 $25(일회), Apple Developer Program $99/년.
Apple 계정 없이 Xcode 무료 프로비저닝으로 본인 기기에 설치하면 7일마다 만료됩니다.

## 저장 위치

전술은 브라우저 `localStorage`에 저장됩니다(`bts.plays.v2`).
기기·브라우저마다 따로 보관되므로, 다른 기기로 옮기거나 백업하려면
전술 목록 → **전체 내보내기**로 JSON을 저장한 뒤 **가져오기** 하세요.

이전 단일 파일 버전(`bts-v1`)의 배치가 남아 있으면 처음 실행할 때 자동으로 변환됩니다.
