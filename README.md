# 로봇 자동화 양산평가 대시보드

사내 관리용 정적 대시보드. GitHub Pages로 호스팅하여 URL로 공유하고, 업체가 보내준 엑셀(.xlsx)을 `data/raw/`에 올리면 GitHub Actions가 자동 변환·반영합니다.

## 폴더 구조

```
dashboard-project/
├── index.html                          ← 페이지 구조
├── styles.css                          ← 디자인 (색·폰트·레이아웃)
├── app.js                              ← 렌더링·차트 로직
├── data/
│   ├── config.json                     ← 프로젝트 설정 (수동 편집, 거의 변경 안 함)
│   ├── dashboard.json                  ← 일일·에러 데이터 (자동 생성)
│   └── raw/
│       └── <업체-원본>.xlsx            ← 업체가 보내준 엑셀 원본
├── scripts/
│   ├── build_dashboard_json.py         ← xlsx → JSON 변환 스크립트
│   └── requirements.txt
└── .github/
    └── workflows/
        ├── build-data.yml              ← xlsx 변경 시 dashboard.json 자동 생성
        └── deploy-pages.yml             ← 변경 시 GitHub Pages 재배포
```

## 초기 GitHub 셋업 (1회)

### 1. GitHub 저장소 생성
- github.com 로그인 → 우상단 `+` → `New repository`
- 이름 예시: `mtbi-dashboard` (공개/비공개 무관 — 공개면 누구나 URL 접근 가능, 비공개면 협업자만)
- README, .gitignore, license 모두 **체크 해제** (이미 폴더에 있음)
- `Create repository`

### 2. 로컬 폴더를 저장소에 푸시
프로젝트 폴더에서 PowerShell:

```powershell
git init
git add .
git commit -m "Initial dashboard"
git branch -M main
git remote add origin https://github.com/<USERNAME>/<REPO>.git
git push -u origin main
```

### 3. GitHub Pages 활성화
- GitHub 저장소 페이지 → `Settings` → 좌측 `Pages`
- `Build and deployment` → `Source`를 **GitHub Actions** 로 선택
- 저장하면 `deploy-pages.yml` 워크플로우가 실행됨 (1~2분)
- 완료되면 상단에 사이트 URL 표시 — `https://<USERNAME>.github.io/<REPO>/`

### 4. 공유
위 URL을 그대로 슬랙·메일·문서에 붙이면 됩니다.

## 매일 운영 — 데이터 갱신

### 방법 A: GitHub 웹에서 업로드 (가장 쉬움)
1. 업체에서 받은 `.xlsx` 파일을 준비 (시트명·컬럼은 아래 "xlsx 양식" 참고).
2. 저장소 페이지에서 `data/raw/` 폴더로 이동.
3. 우상단 `Add file → Upload files`로 xlsx 끌어다 놓기 (기존 파일과 같은 이름이면 덮어쓰기됨).
4. `Commit changes` 클릭.
5. 약 1~2분 후 GitHub Actions가 자동으로:
   - `data/dashboard.json` 재생성 + 커밋
   - GitHub Pages 재배포
6. 페이지 새로고침하면 신규 데이터가 보입니다.

진행 상황은 저장소 상단 `Actions` 탭에서 실시간 확인 가능.

### 방법 B: 로컬에서 git push

```powershell
# 업체에게 받은 파일을 data/raw/ 폴더에 복사
git add data/raw/
git commit -m "data: 업체 5/27 데이터 수령"
git push
```

## xlsx 양식

업체에서 받는 엑셀은 다음 두 시트를 포함해야 합니다. 시트명은 정확하지 않아도 부분 일치(예: "일일", "에러")로 인식하며, 컬럼명도 유사어를 허용합니다.

### 시트 ① 일일평가
| 평가일 | 입실인원 | 주평가내용 | 일일평가 | 일일에러 | 연속성공 | 비고 |
|---|---|---|---|---|---|---|
| 2026-04-15 | 홍길동, 김철수 | JOB 생성 - 픽업 - 적재 사이클 셋업 | 42 | 0 | 42 | 초기 셋업 |
| 2026-04-16 | 홍길동, 김철수 | 사이클 반복 안정성 검증 | 78 | 0 | 120 | 정상 |
| ... | | | | | | |

### 시트 ② 에러로그
| No | 발생일 | 시각 | 회차 | 코드 | 유형 | 상세 | 원인 | 조치 | 결과 | 담당 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-04-21 | 14:32 | 358 | ERR-001 | 비전 인식 오류 | ... | ... | ... | 정상복귀 | 박영희 |
| ... | | | | | | | | | | |

**Tip**: 양식이 처음과 다르더라도 [build_dashboard_json.py](scripts/build_dashboard_json.py) 상단의 `DAILY_FIELD_ALIASES`, `ERROR_FIELD_ALIASES` 사전에 별칭을 추가하면 그대로 인식됩니다.

## 프로젝트 설정 변경

`data/config.json`을 직접 수정:

```json
{
  "project": {
    "name":       "로봇 자동화 양산평가",
    "vendor":     "○○○ 자동화",
    "pm":         "HD",
    "startDate":  "2026-04-15",
    "target":     360,
    "errorLimit": 3
  }
}
```

GitHub 웹에서 파일 → 연필 아이콘 → 수정 → Commit 으로도 가능. 커밋만 하면 Pages도 자동 재배포됩니다.

## 로컬에서 테스트하기

브라우저는 보안상 `file://` 경로에서 `fetch()`로 JSON을 못 읽습니다. 따라서 로컬 미리보기는 간단한 HTTP 서버가 필요합니다.

```powershell
# Python이 깔려 있다면
python -m http.server 8000
# 그 후 브라우저에서 http://localhost:8000 열기
```

또는 VS Code의 **Live Server** 확장 사용 — `index.html` 우클릭 → `Open with Live Server`.

xlsx → JSON 변환을 로컬에서 직접 돌리려면:

```powershell
pip install -r scripts/requirements.txt
python scripts/build_dashboard_json.py
```

## 한 줄 트러블슈팅

| 증상 | 해결 |
|---|---|
| Pages URL이 404 | Settings → Pages에서 Source가 "GitHub Actions"인지 확인. Actions 탭에서 deploy-pages 실행 결과 확인 |
| 데이터가 옛날 그대로 | 브라우저 강제 새로고침 (Ctrl+Shift+R). app.js는 `?t=...` 쿼리로 캐시 우회 |
| Actions가 실패 | Actions 탭 → 실패한 run 클릭 → 로그 확인. 보통 xlsx 시트명/컬럼명 불일치 |
| xlsx 컬럼 인식 안 됨 | scripts/build_dashboard_json.py의 별칭 사전(`*_FIELD_ALIASES`)에 새 헤더명 추가 |
| 로컬에서 차트 안 보임 | file:// 직접 열기는 fetch 차단됨. `python -m http.server` 또는 Live Server 사용 |

## 라이선스 / 사용
사내 전용.
