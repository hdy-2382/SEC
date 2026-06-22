"""
build_dashboard_json.py
-----------------------
업체가 보낸 .xlsx 파일을 읽어서 data/dashboard.json 으로 변환한다.

규칙:
  - data/raw/ 폴더 내에서 가장 최근에 수정된 .xlsx 파일을 입력으로 사용
  - 엑셀 시트:
      "일일평가"  → daily 배열
      "에러로그"  → errors 배열
    (시트명이 정확히 일치하지 않으면 부분 매칭으로 찾는다)
  - 출력: data/dashboard.json (UTF-8, 한글 그대로)

읽기 방식:
  - 1차: openpyxl (빠름, 일반 xlsx 전용)
  - 2차 폴백: xlwings (Excel 실행, DRM 보호된 xlsx도 처리 가능)
    → Windows + Excel 설치 필요. openpyxl이 zipfile.BadZipFile로 실패하면 자동 전환.

기대 컬럼:
  일일평가 시트  : 평가일, 입실인원, 주평가내용, 일일평가, 일일에러, 연속성공, 비고
  에러로그 시트  : No, 발생일, 시각, 회차, 코드, 유형, 상세, 원인, 조치, 결과, 삼성 담당자, 업체 담당자

'시각' 처리:
  업체가 custom h:mm 서식으로 시각을 보내면 openpyxl이 시간을 '하루의 분수'(0~1 float)로
  넘겨 0.xxxxx 형태로 깨질 수 있다. _cell_to_time() 가 이를 h:mm 으로 복원한다.
"""

from __future__ import annotations

import json
import math
import re
import zipfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_PATH = ROOT / "data" / "dashboard.json"
CONFIG_PATH = ROOT / "data" / "config.json"
MGMT_PATH = ROOT / "data" / "mgmt.xlsx"


# ── 컬럼 헤더 매핑 ─────────────────────────────────────────────
# 한글 헤더에서 공백/괄호 제거 후 매칭한다 (오타 방지)
DAILY_FIELD_ALIASES = {
    "date":      ["평가일", "일자", "date"],
    "personnel": ["입실인원", "입실자", "인원", "personnel"],
    "activity":  ["주평가내용", "평가내용", "내용", "activity"],
    "total":     ["일일평가", "평가횟수", "사이클", "total"],
    "errors":    ["일일에러", "에러", "errors"],
    "streak":    ["연속성공", "연속", "streak"],
    "notes":     ["비고", "메모", "notes"],
}
ERROR_FIELD_ALIASES = {
    "no":     ["no", "번호", "순번", "no."],
    "date":   ["발생일", "일자", "date"],
    "time":   ["시각", "시간", "time"],
    "cycle":  ["회차", "사이클", "cycle"],
    "code":   ["코드", "code"],
    "type":   ["유형", "타입", "type"],
    "detail": ["상세", "상세내용", "detail"],
    "cause":  ["원인", "cause"],
    "action": ["조치", "조치사항", "action"],
    "result": ["결과", "조치결과", "result"],
    # 삼성 담당자 / 업체 담당자 — 둘 다 "담당"을 포함하므로 구체적인 후보를 먼저 둔다.
    # owner_sec(삼성)를 owner(업체)보다 먼저 매핑해 교차 매칭을 방지.
    "owner_sec": ["삼성담당자", "삼성담당", "삼성", "secowner", "sec"],
    "owner":     ["업체담당자", "업체담당", "협력사담당", "업체", "협력사", "vendor", "담당", "owner"],
    # 업체가 입력하는 확장 자료 (선택) — "더 상세" 모달에서만 표시.
    #   detail_more : 긴 설명 텍스트
    #   images      : 사진 파일명(쉼표/줄바꿈 구분). 실제 파일은 data/errors/ 폴더에 둔다.
    "detail_more": ["상세설명", "추가상세", "상세자료", "추가설명", "detailmore"],
    "images":      ["사진", "이미지", "첨부파일", "첨부", "파일명", "image", "photo", "attachment"],
}

DAILY_SHEET_KEYWORDS  = ["일일평가", "일일", "daily"]
ERRORS_SHEET_KEYWORDS = ["에러로그", "에러", "error"]


def _norm(s) -> str:
    if s is None:
        return ""
    return re.sub(r"\s+", "", str(s)).lower()


def _find_name(names: list[str], keywords: list[str]) -> str | None:
    """시트명 리스트에서 keywords 중 하나라도 포함된 첫 이름을 반환."""
    norm_map = {n: _norm(n) for n in names}
    for kw in keywords:
        kw_n = _norm(kw)
        for name in names:
            if kw_n in norm_map[name]:
                return name
    return None


def _build_column_map(header_row, aliases: dict[str, list[str]]) -> dict[str, int]:
    """헤더 행을 보고 {필드명: 컬럼인덱스} 매핑을 만든다."""
    norm_cells = [_norm(c) for c in header_row]
    col_map: dict[str, int] = {}
    for field, candidates in aliases.items():
        for cand in candidates:
            cand_n = _norm(cand)
            for idx, cell in enumerate(norm_cells):
                if cell == cand_n or (cand_n and cand_n in cell):
                    col_map[field] = idx
                    break
            if field in col_map:
                break
    return col_map


def _find_header_row(rows: list[list], aliases: dict[str, list[str]]) -> int:
    """선두 최대 10행에서 헤더처럼 보이는 행 인덱스를 찾는다.
    vendor가 상단에 제목/병합 안내를 넣었을 때 1행이 아닐 수 있어서 자동 감지.
    헤더 후보 매칭 개수가 가장 많은 행을 선택. 매칭이 전혀 없으면 0(첫행) fallback.
    """
    best_idx, best_hits = 0, 0
    candidates_flat: list[str] = []
    for cands in aliases.values():
        candidates_flat.extend(_norm(c) for c in cands if c)
    for idx, row in enumerate(rows[:10]):
        if row is None:
            continue
        norm_cells = [_norm(c) for c in row]
        hits = 0
        for cell in norm_cells:
            if not cell:
                continue
            for cand_n in candidates_flat:
                if cell == cand_n or (cand_n and cand_n in cell):
                    hits += 1
                    break
        if hits > best_hits:
            best_idx, best_hits = idx, hits
    return best_idx


_DATE_TEXT_RE = re.compile(
    r"^\s*(\d{2,4})[\s\.\-/년]+(\d{1,2})[\s\.\-/월]+(\d{1,2})\s*일?\s*$"
)


def _try_normalize_date(s: str) -> str:
    """텍스트로 들어온 날짜를 YYYY-MM-DD 로 정규화. 매칭 안 되면 원문 반환.
    지원 포맷: 2026-06-01, 2026/06/01, 2026.6.1, 26-6-1, 2026년 6월 1일 등.
    """
    m = _DATE_TEXT_RE.match(s)
    if not m:
        return s
    y, mo, d = m.group(1), m.group(2), m.group(3)
    if len(y) == 2:
        y = f"20{y}"
    try:
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    except ValueError:
        return s


_EXCEL_EPOCH = datetime(1899, 12, 30)   # Excel 1900 leap-year 버그 보정 포함


def _cell_to_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, time):
        return v.strftime("%H:%M")
    # Excel 직렬 날짜 — 셀 서식이 '일반/숫자'면 float로 넘어옴.
    # 20000~80000 범위면 1954~2118년 사이 → 날짜로 해석. (bool은 int 서브클래스라 명시적으로 제외)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        try:
            f = float(v)
            if 20000 < f < 80000:
                return (_EXCEL_EPOCH + timedelta(days=f)).strftime("%Y-%m-%d")
        except (OverflowError, ValueError):
            pass
    s = str(v).strip()
    # 날짜처럼 보이면 정규화 시도 (다양한 구분자/생략 연도 등 대응)
    return _try_normalize_date(s)


def _cell_to_int(v) -> int:
    if v is None or v == "":
        return 0
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


_TIME_TEXT_RE = re.compile(r"^\s*(?:(?:오전|오후|am|pm)\s*)?(\d{1,2})\s*[:시]\s*(\d{1,2})")


def _cell_to_time(v) -> str:
    """에러로그 '시각' 셀 → 'h:mm' 문자열.
    업체가 custom h:mm 서식으로 보내면 openpyxl이 시간을 '하루의 분수'(0~1 float)로
    넘겨 셀 값이 0.xxxxx 로 깨지는 문제를 보정한다. (업체 입력 방식 h:mm 에 맞춰 복원)
    """
    if v is None or v == "":
        return ""
    if isinstance(v, datetime):
        return f"{v.hour}:{v.minute:02d}"
    if isinstance(v, time):
        return f"{v.hour}:{v.minute:02d}"
    # 숫자 — Excel 시간 직렬값. 정수부=날짜, 소수부=하루 중 비율. 소수부만 분으로 환산.
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        try:
            frac = float(v) % 1.0
        except (OverflowError, ValueError):
            frac = None
        if frac is not None:
            total_min = round(frac * 1440) % 1440   # 분 단위 반올림 + 자정 롤오버 보정
            h, m = divmod(total_min, 60)
            return f"{h}:{m:02d}"
    # 문자열 — 이미 'HH:MM'/'오후 2:32' 등으로 들어온 경우 h:mm 로 정리해서 반환
    s = str(v).strip()
    mt = _TIME_TEXT_RE.match(s)
    if mt:
        h = int(mt.group(1))
        ampm = re.match(r"^\s*(오후|pm)", s, re.IGNORECASE)
        if ampm and h < 12:
            h += 12
        return f"{h}:{int(mt.group(2)):02d}"
    return s


def _split_images(v) -> list[str]:
    """'사진' 셀 → 파일명 리스트. 쉼표/줄바꿈/세미콜론 구분. 빈 값은 제거.
    실제 이미지 파일은 data/errors/ 폴더에 같은 이름으로 둔다(프론트가 그 경로로 로드)."""
    if v is None:
        return []
    parts = re.split(r"[,\n;]+", str(v))
    return [p.strip() for p in parts if p.strip()]


def _safe_idx(row: list, idx: int):
    """row가 짧으면 None 반환 — vendor가 컬럼 수를 다르게 보낼 때 IndexError 방지."""
    return row[idx] if idx is not None and 0 <= idx < len(row) else None


def _parse_daily(rows: list[list]) -> list[dict]:
    if not rows:
        return []
    header_idx = _find_header_row(rows, DAILY_FIELD_ALIASES)
    header = rows[header_idx]
    body = rows[header_idx + 1:]
    cmap = _build_column_map(header, DAILY_FIELD_ALIASES)
    if "date" not in cmap or "total" not in cmap:
        raise SystemExit(
            f"[일일평가] 시트에서 필수 컬럼(평가일/일일평가)을 찾지 못했습니다. "
            f"감지된 헤더(행 {header_idx + 1}): {[str(h) for h in header]}"
        )

    out = []
    for row in body:
        if row is None or all(c is None or c == "" for c in row):
            continue
        date_val = _cell_to_str(_safe_idx(row, cmap["date"]))
        if not date_val:
            continue
        # YYYY-MM-DD 형식이 아니면 skip (헤더 잔여 행이나 잘못된 행 한 번 더 거름)
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_val):
            continue
        out.append({
            "date":      date_val,
            "personnel": _cell_to_str(_safe_idx(row, cmap.get("personnel"))),
            "activity":  _cell_to_str(_safe_idx(row, cmap.get("activity"))),
            "total":     max(0, _cell_to_int(_safe_idx(row, cmap["total"]))),
            "errors":    max(0, _cell_to_int(_safe_idx(row, cmap.get("errors")))),
            "streak":    max(0, _cell_to_int(_safe_idx(row, cmap.get("streak")))),
            "notes":     _cell_to_str(_safe_idx(row, cmap.get("notes"))),
        })
    out.sort(key=lambda r: r["date"])
    return out


def _parse_errors(rows: list[list]) -> list[dict]:
    if not rows:
        return []
    header_idx = _find_header_row(rows, ERROR_FIELD_ALIASES)
    header = rows[header_idx]
    body = rows[header_idx + 1:]
    cmap = _build_column_map(header, ERROR_FIELD_ALIASES)
    out = []
    for row in body:
        if row is None or all(c is None or c == "" for c in row):
            continue
        no_val = _cell_to_int(_safe_idx(row, cmap.get("no")))
        date_val = _cell_to_str(_safe_idx(row, cmap.get("date")))
        if not no_val and not date_val:
            continue
        out.append({
            "no":        no_val,
            "date":      date_val,
            "time":      _cell_to_time(_safe_idx(row, cmap.get("time"))),
            "cycle":     _cell_to_int(_safe_idx(row, cmap.get("cycle"))),
            "code":      _cell_to_str(_safe_idx(row, cmap.get("code"))),
            "type":      _cell_to_str(_safe_idx(row, cmap.get("type"))),
            "detail":    _cell_to_str(_safe_idx(row, cmap.get("detail"))),
            "cause":     _cell_to_str(_safe_idx(row, cmap.get("cause"))),
            "action":    _cell_to_str(_safe_idx(row, cmap.get("action"))),
            "result":    _cell_to_str(_safe_idx(row, cmap.get("result"))),
            "owner_sec": _cell_to_str(_safe_idx(row, cmap.get("owner_sec"))),
            "owner":     _cell_to_str(_safe_idx(row, cmap.get("owner"))),
            # 확장 자료(선택): 더 상세 모달에서만 사용
            "detailMore": _cell_to_str(_safe_idx(row, cmap.get("detail_more"))),
            "images":     _split_images(_safe_idx(row, cmap.get("images"))),
        })
    out.sort(key=lambda r: r.get("no", 0))
    return out


def _pick_latest_xlsx() -> Path:
    xlsxs = sorted(
        [p for p in RAW_DIR.glob("*.xlsx") if not p.name.startswith("~$")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not xlsxs:
        raise SystemExit(f"data/raw/ 폴더에 .xlsx 파일이 없습니다. ({RAW_DIR})")
    if len(xlsxs) > 1:
        print(f"[build] ⚠ data/raw/ 에 xlsx 파일이 {len(xlsxs)}개 있습니다. 최신(mtime) 파일을 사용합니다:")
        for p in xlsxs:
            ts = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
            marker = "→" if p == xlsxs[0] else " "
            print(f"        {marker} {p.name}  (mtime {ts})")
        print(f"        다른 파일을 쓰려면 불필요한 파일을 제거하거나 사용할 파일을 다시 저장(터치)하세요.")
    return xlsxs[0]


# ── 시트 로딩: openpyxl 우선, 실패하면 xlwings ────────────────────
def _load_via_openpyxl(src: Path) -> tuple[list[list], list[list], list[str]]:
    from openpyxl import load_workbook
    wb = load_workbook(src, data_only=True)
    names = wb.sheetnames
    daily_name  = _find_name(names, DAILY_SHEET_KEYWORDS)
    errors_name = _find_name(names, ERRORS_SHEET_KEYWORDS)

    if daily_name is None:
        raise SystemExit(f"'일일평가' 시트를 찾지 못했습니다. 시트 목록: {names}")

    daily_rows  = [list(r) for r in wb[daily_name].iter_rows(values_only=True)]
    errors_rows = (
        [list(r) for r in wb[errors_name].iter_rows(values_only=True)]
        if errors_name else []
    )
    return daily_rows, errors_rows, names


def _xlwings_sheet_rows(sheet) -> list[list]:
    rng = sheet.used_range
    val = rng.value
    if val is None:
        return []
    if not isinstance(val, list):
        return [[val]]
    if val and not isinstance(val[0], list):
        # 1D 결과 — 단일 행 or 단일 열
        if rng.rows.count == 1:
            return [val]
        return [[v] for v in val]
    return val


def _load_via_xlwings(src: Path) -> tuple[list[list], list[list], list[str]]:
    try:
        import xlwings as xw
    except ImportError as e:
        raise SystemExit(
            "xlwings 미설치. DRM 보호 파일을 읽으려면 'pip install xlwings' 후 재시도. "
            "(Windows + Excel 설치 필수)"
        ) from e

    app = xw.App(visible=False, add_book=False)
    app.display_alerts = False
    try:
        wb = app.books.open(str(src), update_links=False, read_only=True)
        try:
            names = [s.name for s in wb.sheets]
            daily_name  = _find_name(names, DAILY_SHEET_KEYWORDS)
            errors_name = _find_name(names, ERRORS_SHEET_KEYWORDS)

            if daily_name is None:
                raise SystemExit(f"'일일평가' 시트를 찾지 못했습니다. 시트 목록: {names}")

            daily_rows  = _xlwings_sheet_rows(wb.sheets[daily_name])
            errors_rows = (
                _xlwings_sheet_rows(wb.sheets[errors_name])
                if errors_name else []
            )
            return daily_rows, errors_rows, names
        finally:
            wb.close()
    finally:
        app.quit()


def _load_workbook_rows(src: Path) -> tuple[list[list], list[list]]:
    try:
        daily_rows, errors_rows, _ = _load_via_openpyxl(src)
        return daily_rows, errors_rows
    except zipfile.BadZipFile:
        # DRM 래핑 추정 — openpyxl은 zip 구조가 아니라고 거부함
        print("[build] openpyxl 실패 (DRM 추정) → xlwings로 Excel 통한 재시도")
        daily_rows, errors_rows, _ = _load_via_xlwings(src)
        return daily_rows, errors_rows


# ── 관리 데이터(config + mgmt.xlsx) 로딩 ─────────────────────────
def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[build] ⚠ config.json 읽기 실패: {e}")
        return {}


CODE_FIELDS = {"code": ["코드"], "type": ["유형"], "severity": ["등급", "심각도"], "desc": ["설명"]}
ACTION_FIELDS = {"id": ["조치id"], "code": ["대상코드"], "action": ["조치내용"],
                 "owner": ["담당"], "due": ["목표일"], "status": ["상태"],
                 "verifyStart": ["검증시작cycle", "검증시작"]}


def _norm_sev(v) -> str:
    s = _cell_to_str(v).lower()
    if "crit" in s or "치명" in s:
        return "Critical"
    if "maj" in s or "중대" in s:
        return "Major"
    if "min" in s or "경미" in s:
        return "Minor"
    return _cell_to_str(v) or "Minor"


def _read_mgmt_sheet(ws, fields) -> list[dict]:
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    if not rows:
        return []
    hidx = _find_header_row(rows, fields)
    cmap = _build_column_map(rows[hidx], fields)
    out = []
    for row in rows[hidx + 1:]:
        if row is None or all(c is None or c == "" for c in row):
            continue
        out.append({f: _safe_idx(row, cmap.get(f)) for f in fields})
    return out


def _load_mgmt() -> tuple[list[dict], list[dict]]:
    if not MGMT_PATH.exists():
        print("[build] mgmt.xlsx 없음 — 코드마스터/조치 없이 진행 (generate_mgmt_template.py로 생성)")
        return [], []
    from openpyxl import load_workbook
    wb = load_workbook(MGMT_PATH, data_only=True)
    names = wb.sheetnames
    cm = _find_name(names, ["코드마스터", "코드", "code"])
    am = _find_name(names, ["조치검증", "조치", "action"])
    raw_c = _read_mgmt_sheet(wb[cm], CODE_FIELDS) if cm else []
    raw_a = _read_mgmt_sheet(wb[am], ACTION_FIELDS) if am else []
    codes = [{"code": _cell_to_str(c["code"]), "type": _cell_to_str(c["type"]),
              "severity": _norm_sev(c["severity"]), "desc": _cell_to_str(c["desc"])}
             for c in raw_c if _cell_to_str(c["code"])]
    actions = [{"id": _cell_to_str(a["id"]), "code": _cell_to_str(a["code"]),
                "action": _cell_to_str(a["action"]), "owner": _cell_to_str(a["owner"]),
                "due": _cell_to_str(a["due"]), "status": _cell_to_str(a["status"]),
                "verifyStart": _cell_to_int(a["verifyStart"])}
               for a in raw_a if _cell_to_str(a["id"])]
    return codes, actions


def _iso_week(date_str: str):
    try:
        y, w, _ = date.fromisoformat(date_str).isocalendar()
        return (y, w)
    except Exception:
        return None


def _occ_band(n: int) -> str:
    return "빈발" if n >= 6 else ("보통" if n >= 3 else "드묾")


_PRIORITY = {
    ("Critical", "드묾"): "Medium", ("Critical", "보통"): "High", ("Critical", "빈발"): "High",
    ("Major", "드묾"): "Low", ("Major", "보통"): "Medium", ("Major", "빈발"): "High",
    ("Minor", "드묾"): "Low", ("Minor", "보통"): "Low", ("Minor", "빈발"): "Medium",
}


# ── 파생 지표 계산 (신뢰성 대시보드 v5) ──────────────────────────
def _compute(daily, errors, config, codes, actions) -> dict:
    acc = config.get("acceptance") or {}
    target = acc.get("targetCycle") or config.get("project", {}).get("target", 360)
    mtbf_t = acc.get("mtbfTargetCycle", 100)
    conf_lv = acc.get("confidenceLevel", 0.80)
    verify_cy = acc.get("verifyCycle", 200)
    recur_lim = acc.get("recurrenceLimit", 0)

    cum_total = sum(d["total"] for d in daily)
    cum_err = sum(d["errors"] for d in daily)
    success = max(0, cum_total - cum_err)
    streak_cur = daily[-1]["streak"] if daily else 0
    streak_max = max((d["streak"] for d in daily), default=0)
    mtbf_cur = round(cum_total / cum_err) if cum_err else cum_total

    # ── 에러 버짓 리셋 모델 ──────────────────────────────────────
    # 한 '시도(attempt)'는 연속 target Cycle + 에러 ≤ error_limit 를 동시에 만족해야 합격.
    # error_limit 를 초과하는 에러(= error_limit+1번째)가 나오면 그 시도는 실패 →
    # 해당 에러 지점부터 새 시도 시작(진행 Cycle·버짓 0). 진행률은 '현재 시도' 기준.
    error_limit = acc.get("errorLimit", config.get("project", {}).get("errorLimit", 3))
    attempt_start = 0          # 현재 시도가 시작된 누적 Cycle
    budget_used = 0            # 현재 시도의 누적 에러 (0~error_limit)
    budget_resets = 0          # 버짓 초과로 시도가 리셋된 횟수
    for c in sorted(e["cycle"] for e in errors if e.get("cycle")):
        if budget_used + 1 > error_limit:      # 다음 에러가 한도 초과 → 시도 실패·리셋
            budget_resets += 1
            attempt_start = c                  # 이 에러 지점부터 새 시도 (이 에러는 실패로 소진)
            budget_used = 0
        else:
            budget_used += 1
    attempt_cycles = max(0, cum_total - attempt_start)   # 현재 시도 진행 Cycle

    # 주차별 누적연속 + 안정성(에러율↓/MTBF↑)
    weekly = {}
    for d in sorted(daily, key=lambda x: x["date"]):
        wk = _iso_week(d["date"])
        if wk is None:
            continue
        w = weekly.setdefault(wk, {"total": 0, "errors": 0, "lastStreak": 0})
        w["total"] += d["total"]; w["errors"] += d["errors"]; w["lastStreak"] = d["streak"]
    weekly_list = []
    run_t = run_e = 0
    for i, (key, w) in enumerate(sorted(weekly.items()), start=1):
        run_t += w["total"]; run_e += w["errors"]
        try:
            week_start = date.fromisocalendar(key[0], key[1], 1).isoformat()
        except Exception:
            week_start = ""
        weekly_list.append({
            "week": f"W{i}", "weekStart": week_start, "cumStreak": w["lastStreak"],
            "weekSuccess": max(0, w["total"] - w["errors"]), "errors": w["errors"],
            "errRate": round(run_e / run_t * 100, 1) if run_t else 0,
            "mtbf": round(run_t / run_e) if run_e else run_t,
        })

    # 신뢰수준 (무고장 시험): C = 1 − e^(−n/MTBF목표)
    def required(c):
        return round(mtbf_t * (-math.log(1 - c))) if 0 < c < 1 else 0
    conf_cur = 1 - math.exp(-streak_cur / mtbf_t) if mtbf_t else 0
    conf_table = [{"c": round(c * 100), "required": required(c)} for c in (0.80, 0.87, 0.90)]

    # 코드 집계 + 코드마스터(등급) 조인
    sev_of = {c["code"]: c["severity"] for c in codes}
    type_of = {c["code"]: c["type"] for c in codes}
    cnt = {}
    for e in errors:
        if e["code"]:
            cnt[e["code"]] = cnt.get(e["code"], 0) + 1

    top5 = sorted(cnt.items(), key=lambda kv: -kv[1])[:5]
    top5_by_code = [{"code": c, "type": type_of.get(c, ""), "count": n,
                     "severity": sev_of.get(c, "Minor"), "recur": n > 1} for c, n in top5]

    sev_dist = {"Critical": 0, "Major": 0, "Minor": 0}
    for e in errors:
        s = sev_of.get(e["code"], "Minor")
        sev_dist[s] = sev_dist.get(s, 0) + 1
    sev_dist["total"] = len(errors)

    tcnt = {}
    for e in errors:
        t = e["type"] or "기타"
        tcnt[t] = tcnt.get(t, 0) + 1
    pareto = []
    run = 0; tot = sum(tcnt.values()) or 1
    for t, n in sorted(tcnt.items(), key=lambda kv: -kv[1]):
        run += n
        pareto.append({"type": t, "count": n, "cumPct": round(run / tot * 100)})

    matrix = []
    for c, n in sorted(cnt.items(), key=lambda kv: -kv[1]):
        sev = sev_of.get(c, "Minor"); ob = _occ_band(n)
        matrix.append({"code": c, "type": type_of.get(c, ""), "severity": sev,
                       "count": n, "occ": ob, "priority": _PRIORITY.get((sev, ob), "Low")})

    recur_count = sum(n - 1 for n in cnt.values() if n > 1)
    recur_items = [{"code": c, "type": type_of.get(c, ""), "count": n}
                   for c, n in cnt.items() if n > 1]

    # 조치/검증 (조치 후 verify_cy Cycle 무발생 → 검증완료 자동판정)
    act_out = []
    open_critical = verified = relevant = 0
    for a in actions:
        c = a["code"]; vs = a["verifyStart"] or 0
        later_same = any(e["code"] == c and e["cycle"] > vs for e in errors) if vs else False
        no_fail = 0 if (later_same or not vs) else max(0, cum_total - vs)
        if later_same:
            result = "재발"
        elif vs and no_fail >= verify_cy:
            result = "검증완료"
        elif vs and no_fail > 0:
            result = "검증중"
        else:
            result = "조치중"
        sev = sev_of.get(c, "Minor")
        if sev in ("Critical", "Major"):
            relevant += 1
            if result == "검증완료":
                verified += 1
        if sev == "Critical" and result != "검증완료":
            open_critical += 1
        act_out.append({**a, "severity": sev, "type": type_of.get(c, ""),
                        "noFailCycles": no_fail, "verifyTarget": verify_cy,
                        "verifyProgress": round(min(1, no_fail / verify_cy) * 100) if verify_cy else 0,
                        "verifyResult": result})
    verify_closed_rate = round(verified / relevant * 100) if relevant else 100

    def st(ok, prog=False):
        return "pass" if ok else ("prog" if prog else "fail")
    criteria = [
        {"key": "완주", "value": f"{attempt_cycles}/{target}",
         "status": st(attempt_cycles >= target, prog=attempt_cycles < target)},
        {"key": f"MTBF≥{mtbf_t} @{int(conf_lv * 100)}%", "value": f"{round(conf_cur * 100)}%",
         "status": st(conf_cur >= conf_lv)},
        {"key": "미해결 Critical=0", "value": f"{open_critical}건",
         "status": st(open_critical <= acc.get("criticalOpenLimit", 0))},
        {"key": f"재발≤{recur_lim}", "value": f"{recur_count}건",
         "status": st(recur_count <= recur_lim)},
        {"key": "전 결함 검증종결", "value": f"{verified}/{relevant}",
         "status": st(relevant and verified == relevant, prog=verified < relevant)},
    ]
    passed = sum(1 for c in criteria if c["status"] == "pass")

    if recur_count >= 1 or open_critical >= 1:
        op_grade = "주의"
    elif recur_count == 0 and open_critical == 0 and verify_closed_rate >= 80:
        op_grade = "양호"
    else:
        op_grade = "보통"

    return {
        "metrics": {
            "progress": {"cum": attempt_cycles, "target": target,
                         "pct": round(attempt_cycles / target * 100, 1) if target else 0},
            "errorBudget": {"used": budget_used, "limit": error_limit,
                            "resets": budget_resets, "lifetimeErrors": cum_err,
                            "dailyAvg": round(cum_err / len(daily), 2) if daily else 0,
                            "weeklyAvg": round(cum_err / len(weekly_list), 2) if weekly_list else 0},
            "successRate": round(success / cum_total * 100, 1) if cum_total else 0,
            "success": success, "errorsTotal": cum_err,
            "mtbf": {"current": mtbf_cur, "target": mtbf_t},
            "streak": {"current": streak_cur, "max": streak_max},
            "weekly": weekly_list,
            "throughput": {"total": cum_total,
                           "daily": round(cum_total / len(daily), 1) if daily else 0},
            "confidence": {"level": conf_lv, "current": round(conf_cur, 3),
                           "currentPct": round(conf_cur * 100), "currentCycles": streak_cur,
                           "requiredForLevel": required(conf_lv), "table": conf_table},
        },
        "failure": {"top5ByCode": top5_by_code, "paretoByType": pareto,
                    "severityDist": sev_dist, "matrix": matrix},
        "actions": act_out,
        "recurrence": {"count": recur_count,
                       "rate": round(recur_count / len(errors) * 100, 1) if errors else 0,
                       "items": recur_items},
        "acceptance": {"criteria": criteria, "passed": passed, "total": len(criteria)},
        "opReliability": {"grade": op_grade, "recur": recur_count,
                          "openCritical": open_critical, "verifyClosedRate": verify_closed_rate},
    }


def main():
    src = _pick_latest_xlsx()
    print(f"[build] 입력 파일: {src.name}")

    daily_rows, errors_rows = _load_workbook_rows(src)
    daily  = _parse_daily(daily_rows)
    errors = _parse_errors(errors_rows)

    config = _load_config()
    codes, actions = _load_mgmt()
    computed = _compute(daily, errors, config, codes, actions)

    out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":      src.name,
        "config":      config,
        "codes":       codes,
        "daily":       daily,
        "errors":      errors,
        **computed,
    }
    OUT_PATH.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    m = computed["metrics"]
    print(f"[build] 출력: {OUT_PATH.relative_to(ROOT)}  "
          f"(daily {len(daily)}, errors {len(errors)}, 진행 {m['progress']['pct']}%, "
          f"신뢰수준 {m['confidence']['currentPct']}%, 합격 {computed['acceptance']['passed']}/5)")


if __name__ == "__main__":
    main()
