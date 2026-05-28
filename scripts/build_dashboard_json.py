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

기대 컬럼:
  일일평가 시트  : 평가일, 입실인원, 주평가내용, 일일평가, 일일에러, 연속성공, 비고
  에러로그 시트  : No, 발생일, 시각, 회차, 코드, 유형, 상세, 원인, 조치, 결과, 담당
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime, time
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_PATH = ROOT / "data" / "dashboard.json"


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
    "owner":  ["담당", "담당자", "owner"],
}


def _norm(s) -> str:
    if s is None:
        return ""
    return re.sub(r"\s+", "", str(s)).lower()


def _find_sheet(wb, keywords: list[str]):
    """시트명에 keywords 중 하나라도 포함되는 첫 시트를 반환."""
    norm_names = {name: _norm(name) for name in wb.sheetnames}
    for kw in keywords:
        kw_n = _norm(kw)
        for name, n in norm_names.items():
            if kw_n in n:
                return wb[name]
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


def _cell_to_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, time):
        return v.strftime("%H:%M")
    return str(v).strip()


def _cell_to_int(v) -> int:
    if v is None or v == "":
        return 0
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _parse_daily(sheet) -> list[dict]:
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []
    header, *body = rows
    cmap = _build_column_map(header, DAILY_FIELD_ALIASES)
    if "date" not in cmap or "total" not in cmap:
        raise SystemExit(
            f"[일일평가] 시트에서 필수 컬럼(평가일/일일평가)을 찾지 못했습니다. "
            f"감지된 헤더: {[str(h) for h in header]}"
        )

    out = []
    for row in body:
        if row is None or all(c is None or c == "" for c in row):
            continue
        date_val = _cell_to_str(row[cmap["date"]])
        if not date_val:
            continue
        out.append({
            "date":      date_val,
            "personnel": _cell_to_str(row[cmap["personnel"]]) if "personnel" in cmap else "",
            "activity":  _cell_to_str(row[cmap["activity"]])  if "activity"  in cmap else "",
            "total":     _cell_to_int(row[cmap["total"]]),
            "errors":    _cell_to_int(row[cmap["errors"]])    if "errors"    in cmap else 0,
            "streak":    _cell_to_int(row[cmap["streak"]])    if "streak"    in cmap else 0,
            "notes":     _cell_to_str(row[cmap["notes"]])     if "notes"     in cmap else "",
        })
    out.sort(key=lambda r: r["date"])
    return out


def _parse_errors(sheet) -> list[dict]:
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []
    header, *body = rows
    cmap = _build_column_map(header, ERROR_FIELD_ALIASES)
    out = []
    for row in body:
        if row is None or all(c is None or c == "" for c in row):
            continue
        no_val = _cell_to_int(row[cmap["no"]]) if "no" in cmap else 0
        date_val = _cell_to_str(row[cmap["date"]]) if "date" in cmap else ""
        if not no_val and not date_val:
            continue
        out.append({
            "no":     no_val,
            "date":   date_val,
            "time":   _cell_to_str(row[cmap["time"]])   if "time"   in cmap else "",
            "cycle":  _cell_to_int(row[cmap["cycle"]])  if "cycle"  in cmap else 0,
            "code":   _cell_to_str(row[cmap["code"]])   if "code"   in cmap else "",
            "type":   _cell_to_str(row[cmap["type"]])   if "type"   in cmap else "",
            "detail": _cell_to_str(row[cmap["detail"]]) if "detail" in cmap else "",
            "cause":  _cell_to_str(row[cmap["cause"]])  if "cause"  in cmap else "",
            "action": _cell_to_str(row[cmap["action"]]) if "action" in cmap else "",
            "result": _cell_to_str(row[cmap["result"]]) if "result" in cmap else "",
            "owner":  _cell_to_str(row[cmap["owner"]])  if "owner"  in cmap else "",
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
    return xlsxs[0]


def main():
    src = _pick_latest_xlsx()
    print(f"[build] 입력 파일: {src.name}")

    wb = load_workbook(src, data_only=True)
    daily_sheet  = _find_sheet(wb, ["일일평가", "일일", "daily"])
    errors_sheet = _find_sheet(wb, ["에러로그", "에러", "error"])

    if daily_sheet is None:
        raise SystemExit(
            f"'일일평가' 시트를 찾지 못했습니다. 시트 목록: {wb.sheetnames}"
        )

    daily = _parse_daily(daily_sheet)
    errors = _parse_errors(errors_sheet) if errors_sheet is not None else []

    out = {
        "generatedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":      src.name,
        "daily":       daily,
        "errors":      errors,
    }
    OUT_PATH.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[build] 출력: {OUT_PATH.relative_to(ROOT)}  (daily {len(daily)}건, errors {len(errors)}건)")


if __name__ == "__main__":
    main()
