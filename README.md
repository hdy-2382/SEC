# 로봇 자동화 양산평가 대시보드

사내 관리용 정적 대시보드. 사내 GitHub Enterprise Pages로 호스팅하여 URL로 공유하고, 업체가 보내준 엑셀(.xlsx)을 `data/raw/`에 두고 로컬에서 변환 스크립트를 돌린 뒤 push 하면 갱신됩니다.

## 폴더 구조

```
dashboard-project/
├── index.html                          ← 페이지 구조
├── styles.css                          ← 디자인 (색·폰트·레이아웃)
├── app.js                              ← 렌더링·차트 로직
├── .nojekyll                           ← Pages의 Jekyll 빌드 비활성화 (빈 파일)
├── data/
│   ├── config.json                     ← 프로젝트 설정 (수동 편집, 거의 변경 안 함)
│   ├── dashboard.json                  ← 일일·에러 데이터 (로컬 빌드로 생성)
│   ├── vendor_template.xlsx            ← 업체 배포용 표준 양식 (로컬 빌드로 생성)
│   ├── errors/                         ← 에러 첨부 사진 (업체가 보낸 파일을 여기에 둠)
│   │   └── <에러코드_순번>.jpg         ← 예) ERR-001_1.jpg  (에러로그 '사진(파일명)' 과 이름 일치)
│   └── raw/
│       └── <업체-원본>.xlsx            ← 업체가 보내준 엑셀 원본
├── samples/                            ← 업체에게 보여줄 "제출 샘플" (로컬 빌드로 생성)
│   ├── 제출샘플_양산평가.xlsx           ← 채워진 예시 엑셀
│   └── photos/                         ← 샘플 사진 (파일명이 엑셀과 일치)
└── scripts/
    ├── build_dashboard_json.py         ← xlsx → dashboard.json 변환
    ├── generate_vendor_template.py     ← 업체 양식 xlsx 생성 (빈 양식)
    ├── generate_sample_submission.py   ← 업체 제출 샘플(채워진 엑셀+사진) 생성
    └── requirements.txt
```

## 초기 사내 GHE 셋업 (1회)

### 1. 사내 GHE에 빈 리포 생성
- 사내 GitHub Enterprise → `New repository`
- 이름 예시: `SEC` 또는 `mtbi-dashboard`
- **README / .gitignore / license 모두 체크 해제** (이미 폴더에 있음)
- Visibility: Private 또는 Internal

### 2. 로컬 폴더를 사내 GHE에 push

```powershell
git init
git add .
git commit -m "initial: dashboard"
git branch -M main
git remote add origin https://<사내-GHE>/<your-team>/<REPO>.git
git push -u origin main
```

이미 외부망에서 클론해서 받은 폴더라면 `origin`만 사내 URL로 교체:
```powershell
git remote set-url origin https://<사내-GHE>/<your-team>/<REPO>.git
git push -u origin main
```

### 3. GHE Pages 활성화
- 사내 GHE 리포 → `Settings` → 좌측 `Pages`
- `Build and deployment` → `Source`를 **`Deploy from a branch`** 로 선택
- Branch: **`main`** / Folder: **`/ (root)`** 선택 후 `Save`
- 1~2분 후 상단에 사이트 URL 표시 — 예: `https://pages.<사내-GHE>/<team>/<REPO>/`

> **왜 "GitHub Actions" 소스가 아닌가**: 사내 GHE는 self-hosted 러너가 별도 등록되어야 Actions가 동작합니다. 본 프로젝트는 러너 없이도 운영할 수 있도록 브랜치 소스 + 로컬 빌드 방식으로 설계되어 있습니다.

### 4. 공유
표시된 URL을 슬랙/메일/사내 문서에 그대로 붙이면 됩니다.

## 로컬 환경 준비 (1회)

빌드 스크립트를 돌릴 Python 환경:

```powershell
pip install -r scripts/requirements.txt
```

> **DRM 보호 xlsx를 받는 환경이라면**: 사내 보안 솔루션이 xlsx를 감싸면 일반 파서(openpyxl)로는 못 읽습니다. 이 경우 스크립트가 자동으로 **xlwings**(Excel을 띄워 셀 값을 읽는 방식)로 폴백합니다. xlwings는 `requirements.txt` 에 포함돼있어 Windows에서 위 명령으로 함께 설치됩니다. 단, 그 PC에 **Excel이 설치**돼 있어야 하고, **DRM 에이전트가 정상 동작**해야 합니다 (= 평소 Excel로 그 파일이 열리는 PC).

## 업체에 보내줄 양식 (xlsx)

`data/vendor_template.xlsx` 가 업체 배포용 표준 양식입니다. `scripts/generate_vendor_template.py` 가 자동 생성합니다.

### 양식 다시 생성하기 (양식 변경 시)
```powershell
python scripts/generate_vendor_template.py
git add data/vendor_template.xlsx
git commit -m "chore(template): 양식 갱신"
git push
```

### 양식 받기 (업체에 전달용)
1. 사내 GHE repo 페이지에서 `data/vendor_template.xlsx` 클릭
2. 우측 상단 `Download` 또는 `Raw` 버튼으로 다운로드
3. 업체 담당자에게 메일/메신저로 전달

### 양식 구성
세 개의 시트가 들어 있습니다.

| 시트 | 용도 |
|---|---|
| **안내** | 작성 방법·주의사항 설명 (업체가 먼저 봐야 할 페이지) |
| **일일평가** | 매일 평가 후 1행씩 추가. 컬럼: 평가일 / 입실인원 / 주평가내용 / 일일평가 / 일일에러 / 연속성공 / 비고 |
| **에러로그** | 에러 발생 시마다 1행 추가. 컬럼: No / 발생일 / 시각 / 회차 / 코드 / 유형 / 상세 / 원인 / 조치 / 결과 / 삼성 담당자 / 업체 담당자 |

**중요**: 업체가 시트명·헤더명을 변경하면 자동 변환이 실패합니다. 양식 그대로 유지하도록 안내하세요. (`build_dashboard_json.py`는 유사어도 부분 매칭하지만, 안정성을 위해 양식 준수 권장)

---

## 매일 운영 — 데이터 갱신

### 업체에서 받는 파일 → 넣는 폴더
| 받는 것 | 넣는 폴더 | 비고 |
|---|---|---|
| **엑셀 1개** (일일평가+에러로그) | **`data/raw/`** | 빌드가 이 폴더의 **최신(수정시각) xlsx** 자동 선택 → 이전 파일은 정리 권장 |
| **에러 사진들** (선택) | **`data/errors/`** | 엑셀 `사진(파일명)` 칸 이름과 **파일명 정확히 일치** (다르면 "이미지 없음") |

> 사진은 엑셀에 붙여넣지 않고 **파일명만 엑셀에 적고, 이미지 파일은 따로(zip 등) 받아** `data/errors/` 에 둡니다. 형식 예시는 [`samples/`](samples/) 참고.

### 절차

```powershell
# 1) 업체 엑셀을 data/raw/ 에 복사 (이전 파일은 지우거나 한 파일로 누적 관리)
copy <받은파일>.xlsx data\raw\

# 1-2) 에러 사진이 있으면 data/errors/ 에 복사 (엑셀 기재명과 동일하게)
copy ERR-001_1.jpg data\errors\

# 2) JSON 변환
python scripts\build_dashboard_json.py

# 3) 커밋 & push
git add data\
git commit -m "data: 업체 6/15 데이터 수령"
git push
```

1~2분 후 Pages URL에서 갱신된 대시보드 확인. 브라우저는 강제 새로고침(Ctrl+Shift+R) 권장.

### 갱신 체크리스트
- [ ] 엑셀을 **`data/raw/`** 에 두었다 (이전 파일 정리)
- [ ] 에러 사진을 **`data/errors/`** 에 두었다 (파일명 = 엑셀 `사진(파일명)` 기재명과 동일)
- [ ] `python scripts/build_dashboard_json.py` 실행 → 오류 없이 `daily/errors 건수` 출력 확인
- [ ] `git add data/ && git commit && git push`

> **단순 흐름 요약**: (엑셀→`raw/`, 사진→`errors/`) → `python` 한 줄 → `git push` 한 번. 끝.
>
> 업체 엑셀이 **DRM(보안)** 파일이면 openpyxl 실패 시 **xlwings 자동 폴백** — 이 경우 **Windows + Excel 설치** 필요.

## xlsx 양식 (참고)

업체 엑셀은 다음 두 시트를 포함해야 합니다. 시트명은 정확하지 않아도 부분 일치(예: "일일", "에러")로 인식하며, 컬럼명도 유사어를 허용합니다.

### 시트 ① 일일평가
| 평가일 | 입실인원 | 주평가내용 | 일일평가 | 일일에러 | 연속성공 | 비고 |
|---|---|---|---|---|---|---|
| 2026-04-15 | 홍길동, 김철수 | JOB 생성 - 픽업 - 적재 사이클 셋업 | 42 | 0 | 42 | 초기 셋업 |
| 2026-04-16 | 홍길동, 김철수 | 사이클 반복 안정성 검증 | 78 | 0 | 120 | 정상 |

### 시트 ② 에러로그
| No | 발생일 | 시각 | 회차 | 코드 | 유형 | 상세 | 원인 | 조치 | 결과 | 삼성 담당자 | 업체 담당자 | 상세설명 | 사진(파일명) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-04-21 | 14:32 | 358 | ERR-001 | 비전 인식 오류 | ... | ... | ... | 정상복귀 | 양희두 | 박영희 | 긴 분석 설명… | ERR-001_1.jpg, ERR-001_2.jpg |

> **시각 서식**: 업체가 `custom h:mm` 셀 서식으로 보내도 자동 인식됩니다. (엑셀이 시간을 `0.xxxxx` 분수로 저장해도 빌드 시 `h:mm` 으로 복원)

### 에러 상세자료 (상세설명 · 사진) — 선택 입력
업체가 채워두면 대시보드 **평가 상세 → 에러 상세 로그**의 행마다 **`＋ 상세`** 버튼이 생기고, 클릭 시 모달로만 표시됩니다(표에는 바로 안 보임).

- **상세설명**: 긴 분석/경위 텍스트. 줄바꿈 그대로 표시됩니다.
- **사진(파일명)**: 이미지 파일명을 쉼표로 구분해 입력 (예: `ERR-001_1.jpg, ERR-001_2.jpg`).
  엑셀에 사진을 붙여넣지 말고 **파일명만** 적고, 이미지 파일은 엑셀과 함께 전달합니다.
- PM은 받은 이미지 파일을 **`data/errors/`** 폴더에 같은 이름으로 넣고 함께 커밋합니다.
  대시보드는 `data/errors/<파일명>` 경로로 로드 → 클릭하면 라이트박스로 확대됩니다.
  (파일이 아직 없으면 모달에 "이미지 없음" 으로 표시되고, 두 컬럼 모두 비어 있으면 버튼 자체가 안 보입니다.)

#### 업체 제출 샘플
업체에게 "이대로 따라 보내면 된다"고 보여줄 샘플을 자동 생성합니다.

```powershell
python scripts/generate_sample_submission.py
```

- `samples/제출샘플_양산평가.xlsx` — 일일평가·에러로그가 채워진 예시 (상세설명·사진 파일명 포함, 시각은 `h:mm` 서식)
- `samples/photos/` — 파일명이 에러로그와 일치하는 샘플 사진 (`ERR-001_1.jpg` 등)

업체에는 **이 엑셀 + photos 폴더**를 함께 전달해, 「엑셀엔 파일명만 / 사진은 따로(zip)」 방식을 그대로 따라 하도록 안내하면 됩니다.

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

사내 GHE 웹에서 파일 → 연필 아이콘 → 수정 → Commit 으로도 가능. 커밋만 하면 Pages가 자동 갱신됩니다.

## 로컬에서 테스트하기

브라우저는 보안상 `file://` 경로에서 `fetch()`로 JSON을 못 읽습니다. 따라서 로컬 미리보기는 간단한 HTTP 서버가 필요합니다.

```powershell
python -m http.server 8000
# 브라우저에서 http://localhost:8000 열기
```

또는 VS Code의 **Live Server** 확장 사용 — `index.html` 우클릭 → `Open with Live Server`.

## 한 줄 트러블슈팅

| 증상 | 해결 |
|---|---|
| Pages URL이 404 | Settings → Pages에서 Source가 "Deploy from a branch / main / root"인지 확인 |
| Pages가 이상하게 렌더링됨 (`_` 시작 파일 누락 등) | `.nojekyll` 파일이 root에 있는지 확인 |
| 데이터가 옛날 그대로 | 브라우저 강제 새로고침 (Ctrl+Shift+R). app.js는 `?t=...` 쿼리로 캐시 우회 |
| `python scripts/build_dashboard_json.py` 실패 | xlsx 시트명/컬럼명 불일치. 별칭 사전(`*_FIELD_ALIASES`)에 새 헤더명 추가 |
| `zipfile.BadZipFile: File is not a zip file` | 사내 DRM 보호 파일. 스크립트가 자동으로 xlwings(Excel) 폴백 시도 — `pip install xlwings` 필요 (Windows + Excel 설치 PC 한정). 그래도 안 되면 Excel로 파일 열고 "다른 이름으로 저장 → DRM 해제 영역" 후 재시도 |
| 로컬에서 차트 안 보임 | file:// 직접 열기는 fetch 차단됨. `python -m http.server` 또는 Live Server 사용 |
| push 인증 실패 | 사내 GHE의 PAT(Personal Access Token) 발급 또는 SSH 키 등록 |

## 라이선스 / 사용
사내 전용.
