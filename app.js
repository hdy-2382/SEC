/* Reliability Dashboard — dashboard.json(데이터) + config.json의 ui(모든 화면 글자)를 읽어 v5 화면을 동적 렌더 */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ko-KR');
let DATA = null;

/* ── 화면 글자(ui) 접근 헬퍼 ──
   U = config.json 의 ui 블록. T()=글자 가져오기, TT()=글자+{치환}, tpl()=치환 엔진 */
let U = {};
const tpl = (s, vars) => String(s == null ? '' : s)
  .replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null) ? vars[k] : '');
const T = (path, fb) => {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), U);
  return v == null ? (fb == null ? '' : fb) : v;
};
const TT = (path, vars, fb) => tpl(T(path, fb), vars);

/* ── 차트 헬퍼 (SVG 문자열) ── */
function spark(series, color) {
  if (!series || !series.length) series = [1, 1];
  if (series.length === 1) series = [series[0], series[0]];
  const mn = Math.min(...series), mx = Math.max(...series), rng = (mx - mn) || 1;
  const pts = series.map((v, i) => {
    const x = 2 + i * (66 / (series.length - 1));
    const y = 32 - ((v - mn) / rng) * 26;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 70 36"><polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg>`;
}
function heroDonut(pct, size = 128) {
  pct = Math.max(0, Math.min(100, pct));
  return `<svg width="${size}" height="${size}" viewBox="0 0 42 42">
    <circle cx="21" cy="21" r="15.9" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="5"/>
    <circle cx="21" cy="21" r="15.9" fill="none" stroke="#5fb0ec" stroke-width="5" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="25" stroke-linecap="round"/></svg>`;
}
// 달성률 도넛(밝은 배경용): fill=목표 대비 달성률(%), 중앙=실제값, 아래=라벨/부가
function miniDonut(pct, color, center, label, sub, size = 72) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div style="text-align:center;flex:1;min-width:62px">
    <svg width="${size}" height="${size}" viewBox="0 0 42 42" style="display:block;margin:0 auto">
      <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--line-soft)" stroke-width="4.5"/>
      <circle cx="21" cy="21" r="15.9" fill="none" stroke="${color}" stroke-width="4.5" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="25" stroke-linecap="round"/>
      <text x="21" y="21" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="800" fill="var(--navy-deep)">${esc(center)}</text>
    </svg>
    <div style="font-size:11.5px;font-weight:700;color:var(--navy-deep);margin-top:5px">${esc(label)}</div>
    <div style="font-size:10px;color:var(--muted)">${esc(sub)}</div>
  </div>`;
}
function sevDonut(sd) {
  const tot = sd.total || 1; let cum = 0, c = '';
  [['#C0392B', sd.Critical || 0], ['#E08600', sd.Major || 0], ['#3F7CC4', sd.Minor || 0]].forEach(([col, n]) => {
    const pct = n / tot * 100;
    c += `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${col}" stroke-width="6" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${25 - cum}"/>`;
    cum += pct;
  });
  return `<svg width="104" height="104" viewBox="0 0 42 42">${c}</svg>`;
}
// 목표 곡선 모양: 진행률 p(0~1) → 목표값. K=1 선형, 2 이차, 3 삼차.
const CURVE_K = { linear: 1, quad: 2, cubic: 3 };
let weeklyAuto = false;   // 주차별 추이 y축 auto scale 토글 상태

const parseYMD = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
// 값 v 이상에서 가장 가까운 "깔끔한" 상한 (1·2·5 ×10ⁿ). 작은 값(에러율 %)도 처리.
function niceCeil(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * pow;
}
// 축 눈금 간격 (4~5칸)
function niceStep(maxv) {
  if (maxv <= 5) return 1;
  if (maxv <= 10) return 2;
  if (maxv <= 20) return 5;
  if (maxv <= 50) return 10;
  if (maxv <= 100) return 25;
  if (maxv <= 200) return 50;
  if (maxv <= 500) return 100;
  return Math.round(maxv / 5);
}
// 평가기간(startDate~endDate)을 주(월요일 시작) 단위로 분할한 시작일 목록
function weekAxis(startStr, endStr, fallbackN) {
  if (!startStr || !endStr) return Array.from({ length: fallbackN }, () => '');
  const end = parseYMD(endStr), mon = parseYMD(startStr);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));   // 그 주의 월요일로 정렬
  const slots = [];
  for (const d = new Date(mon); d <= end; d.setDate(d.getDate() + 7)) {
    slots.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return slots;
}

// 주차 시작일 → "(M/D-M/D)" 7일 범위 (평가종료일 endStr 넘으면 그날로 클램프)
function weekRange(s, endStr) {
  if (!s) return '';
  const a = parseYMD(s), b = new Date(a); b.setDate(b.getDate() + 6);
  if (endStr) { const e = parseYMD(endStr); if (b > e) b.setTime(e.getTime()); }
  return `(${a.getMonth() + 1}/${a.getDate()}-${b.getMonth() + 1}/${b.getDate()})`;
}
function weeklyChart(weekly, target, opt) {
  opt = opt || {};
  const C = (DATA && DATA.config) || {}, proj = C.project || {};
  const top = 16, bot = opt.bot || 188, left = 50, right = 986, vbH = opt.vbH || 244;
  // x축: 평가기간 전체를 주차로 분할, 데이터 주차를 weekStart로 슬롯 매핑
  const slots = weekAxis(proj.startDate, proj.endDate, weekly.length || 1);
  const nSlots = Math.max(slots.length, weekly.length, 1);
  const placed = weekly.map((w, i) => {
    let idx = w.weekStart ? slots.indexOf(w.weekStart) : -1;
    return { ...w, slot: idx < 0 ? i : idx };
  });
  // y축 최대: 고정(기본 400) ↔ auto(데이터에 맞춤). y는 클램프하지 않고 목표곡선만 clip → 왜곡 방지
  const dataMax = Math.max(...weekly.map(w => w.cumStreak), 1);
  const yMax = (opt.auto || weeklyAuto) ? niceCeil(dataMax) : (Number(T('steps.yAxisMax', 400)) || 400);
  const y = v => bot - (v / yMax) * (bot - top);
  const slotW = (right - left) / nSlots;
  const cx = i => left + slotW * (i + 0.5);

  // y축 격자 + 눈금
  const step = niceStep(yMax);
  let yaxis = '';
  for (let v = 0; v <= yMax + 0.1; v += step) {
    yaxis += `<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="${v === 0 ? '#C9DCEC' : '#EAF0F6'}"/>`;
    yaxis += `<text x="${left - 8}" y="${y(v) + 4.5}" font-size="13" fill="#5A6B7E" text-anchor="end">${v}</text>`;
  }
  // 목표 곡선 0 → target (전체 슬롯 폭). plot 영역으로 clip → auto scale에서도 모양 유지
  const curve = T('steps.targetCurve', 'linear');
  const K = CURVE_K[curve] || 1;
  const ramp = Array.from({ length: 61 }, (_, i) => {
    const p = i / 60;
    return `${(left + (right - left) * p).toFixed(1)},${y(target * Math.pow(p, K)).toFixed(1)}`;
  }).join(' ');
  // x축 라벨: "N주차" + 그 아래 "(시작-끝)" 날짜 범위
  let xaxis = '';
  slots.forEach((s, i) => {
    xaxis += `<text x="${cx(i)}" y="${bot + 22}" font-size="13" font-weight="600" fill="#3D4F63" text-anchor="middle">${i + 1}주차</text>`;
    xaxis += `<text x="${cx(i)}" y="${bot + 39}" font-size="9.5" fill="#8A99AC" text-anchor="middle">${esc(weekRange(s, proj.endDate))}</text>`;
  });
  // 막대(누적연속=빨강, 슬롯 중앙 정렬) + 리셋 ✕
  let bars = '';
  placed.forEach(w => {
    const x = cx(w.slot), bw = Math.min(17, slotW * 0.34);
    bars += `<rect x="${x - bw / 2}" y="${y(w.cumStreak)}" width="${bw}" height="${bot - y(w.cumStreak)}" fill="#C0392B"/>`;
    if (w.errors > 0) {
      const yy = y(w.cumStreak) - 10, r = 5;
      bars += `<path d="M${x - r},${yy - r} L${x + r},${yy + r} M${x - r},${yy + r} L${x + r},${yy - r}" stroke="#8B2E1F" stroke-width="2.4" stroke-linecap="round"/>`;
    }
  });
  const curveName = (T('steps.targetCurveNames', {})[curve]) || curve;
  return `<svg viewBox="0 0 1000 ${vbH}" style="width:100%;height:auto;display:block">
    <defs><clipPath id="wkclip"><rect x="${left}" y="${top - 2}" width="${right - left}" height="${bot - top + 2}"/></clipPath></defs>
    ${yaxis}
    <polyline fill="none" stroke="#1565C0" stroke-width="2" stroke-dasharray="6 5" points="${ramp}" clip-path="url(#wkclip)"/>
    <text x="${right - 4}" y="${Math.max(top + 11, y(target) - 6)}" font-size="13" font-weight="600" fill="#1565C0" text-anchor="end">${esc(TT('steps.growthTargetLabel', { v: target, curve: curveName }))}</text>
    <line x1="${left}" y1="${top}" x2="${left}" y2="${bot}" stroke="#C9DCEC"/>
    ${bars}${xaxis}</svg>`;
}
// 우하단 토글: y축 auto scale on/off → 차트만 다시 그림
function toggleWeeklyScale() {
  weeklyAuto = !weeklyAuto;
  if (DATA) { const el = $('weekly-chart'); if (el) el.innerHTML = weeklyChart(DATA.metrics.weekly, DATA.metrics.progress.target); }
  const btn = $('weekly-scale-btn'); if (btn) btn.textContent = T('steps.autoScaleLabel', 'Auto scale') + ': ' + (weeklyAuto ? 'ON' : 'OFF');
}
function lineChart(series, target) {
  const top = 16, bot = 150, left = 42, right = 406;
  const yMax = niceCeil(Math.max(target || 1, ...series, 1));
  const n = series.length || 1;
  const x = i => n === 1 ? (left + right) / 2 : left + (right - left) * i / (n - 1);
  const y = v => bot - (v / yMax) * (bot - top);
  // y축 격자 + 눈금
  const step = niceStep(yMax);
  let yaxis = '';
  for (let v = 0; v <= yMax + 0.1; v += step) {
    yaxis += `<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="${v === 0 ? '#C9DCEC' : '#EAF0F6'}"/>`;
    yaxis += `<text x="${left - 6}" y="${y(v) + 4}" font-size="11.5" fill="#5A6B7E" text-anchor="end">${v}</text>`;
  }
  // x축: N주차
  let xaxis = '';
  series.forEach((v, i) => { xaxis += `<text x="${x(i)}" y="${bot + 18}" font-size="11.5" fill="#5A6B7E" text-anchor="middle">${i + 1}주차</text>`; });
  const pts = series.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const dots = series.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#2E89D6"/>`).join('');
  const tl = target ? `<line x1="${left}" y1="${y(target)}" x2="${right}" y2="${y(target)}" stroke="#E08600" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${right - 4}" y="${y(target) - 5}" font-size="11.5" fill="#E08600" text-anchor="end">${esc(TT('steps.chartTargetLabel', { v: target }))}</text>` : '';
  return `<svg viewBox="0 0 420 176" style="width:100%;height:auto;display:block">${yaxis}<line x1="${left}" y1="${top}" x2="${left}" y2="${bot}" stroke="#C9DCEC"/>${tl}<polyline fill="none" stroke="#2E89D6" stroke-width="2.5" points="${pts}"/>${dots}${xaxis}</svg>`;
}
function stabChart(weekly) {
  // 듀얼 축: 좌=이동 에러율(%, 빨강), 우=누적 MTBF(Cycle, 파랑)
  const top = 16, bot = 150, left = 44, right = 376;
  const errs = weekly.map(w => w.errRate), mt = weekly.map(w => w.mtbf);
  const n = weekly.length || 1;
  const x = i => n === 1 ? (left + right) / 2 : left + (right - left) * i / (n - 1);
  const eMax = niceCeil(Math.max(...errs, 1)), mMax = niceCeil(Math.max(...mt, 1));
  const yL = v => bot - (v / eMax) * (bot - top);
  const yR = v => bot - (v / mMax) * (bot - top);
  // 격자 4분할 + 좌/우 눈금
  let axis = '';
  const ticks = 4;
  for (let k = 0; k <= ticks; k++) {
    const yy = top + (bot - top) * k / ticks, ev = eMax * (1 - k / ticks), mv = mMax * (1 - k / ticks);
    axis += `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="${k === ticks ? '#C9DCEC' : '#EAF0F6'}"/>`;
    axis += `<text x="${left - 6}" y="${yy + 4}" font-size="11" fill="#8B2E1F" text-anchor="end">${ev < 10 ? ev.toFixed(1) : Math.round(ev)}</text>`;
    axis += `<text x="${right + 6}" y="${yy + 4}" font-size="11" fill="#2E89D6" text-anchor="start">${Math.round(mv)}</text>`;
  }
  let xaxis = '';
  weekly.forEach((w, i) => { xaxis += `<text x="${x(i)}" y="${bot + 18}" font-size="11.5" fill="#5A6B7E" text-anchor="middle">${i + 1}주차</text>`; });
  const pe = errs.map((v, i) => `${x(i)},${yL(v)}`).join(' ');
  const pm = mt.map((v, i) => `${x(i)},${yR(v)}`).join(' ');
  const ed = errs.map((v, i) => `<circle cx="${x(i)}" cy="${yL(v)}" r="3" fill="#8B2E1F"/>`).join('');
  const md = mt.map((v, i) => `<circle cx="${x(i)}" cy="${yR(v)}" r="3" fill="#2E89D6"/>`).join('');
  return `<svg viewBox="0 0 420 176" style="width:100%;height:auto;display:block">${axis}
    <line x1="${left}" y1="${top}" x2="${left}" y2="${bot}" stroke="#C9DCEC"/><line x1="${right}" y1="${top}" x2="${right}" y2="${bot}" stroke="#C9DCEC"/>
    <polyline fill="none" stroke="#8B2E1F" stroke-width="2.4" points="${pe}"/>${ed}
    <polyline fill="none" stroke="#2E89D6" stroke-width="2.4" points="${pm}"/>${md}${xaxis}</svg>`;
}
// 기간별 에러율 안정화: 막대=그 기간 실측 에러율(건/100Cy), 선=누적 평균(안정화 추세)
function errRateChart(rows, opt) {
  opt = opt || {};
  const top = 18, bot = opt.bot || 176, left = 54, right = 980, vbH = opt.vbH || 226;
  const n = rows.length || 1;
  const yMax = niceCeil(Math.max(...rows.map(r => Math.max(r.rate, r.cumRate)), 1));
  const y = v => bot - (v / yMax) * (bot - top);
  const slotW = (right - left) / n;
  const cx = i => left + slotW * (i + 0.5);
  const step = niceStep(yMax);
  let yaxis = '';
  for (let v = 0; v <= yMax + 0.1; v += step) {
    yaxis += `<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="${v === 0 ? '#C9DCEC' : '#EAF0F6'}"/>`;
    yaxis += `<text x="${left - 8}" y="${y(v) + 4.5}" font-size="13" fill="#5A6B7E" text-anchor="end">${v}%</text>`;
  }
  let bars = '', xaxis = '';
  rows.forEach((r, i) => {
    const x = cx(i), bw = Math.min(48, slotW * 0.5);
    bars += `<rect x="${x - bw / 2}" y="${y(r.rate)}" width="${bw}" height="${bot - y(r.rate)}" rx="2" fill="#E08600" opacity="0.85"/>`;
    bars += `<text x="${x}" y="${y(r.rate) - 7}" font-size="12.5" font-weight="600" fill="#B36A00" text-anchor="middle">${r.rate}%</text>`;
    xaxis += `<text x="${x}" y="${bot + 24}" font-size="13" font-weight="600" fill="#3D4F63" text-anchor="middle">${esc(r.period)}</text>`;
    if (r.range) xaxis += `<text x="${x}" y="${bot + 40}" font-size="9.5" fill="#8A99AC" text-anchor="middle">${esc(r.range)}</text>`;
  });
  const pts = rows.map((r, i) => `${cx(i)},${y(r.cumRate)}`).join(' ');
  const dots = rows.map((r, i) => `<circle cx="${cx(i)}" cy="${y(r.cumRate)}" r="4" fill="#8B2E1F"/>`).join('');
  const line = n > 1 ? `<polyline fill="none" stroke="#8B2E1F" stroke-width="2.5" points="${pts}"/>` : '';
  return `<svg viewBox="0 0 1000 ${vbH}" style="width:100%;height:auto;display:block">${yaxis}<line x1="${left}" y1="${top}" x2="${left}" y2="${bot}" stroke="#C9DCEC"/>${bars}${line}${dots}${xaxis}</svg>`;
}
// 최근 N주 롤링 에러율 배지: 업데이트일 기준 '현재 상태' 스냅샷 (양산 전환 시 월별 편차 보상)
function recentErrBadge(rw) {
  if (!rw) return '';
  const dim = rw.lowSample;
  const low = dim ? `<span style="font-size:10.5px;font-weight:700;color:#fff;background:#B0392B;padding:2px 8px;border-radius:9px">${esc(T('steps.errRateRecentLow', '표본부족'))}</span>` : '';
  return `<div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin:4px 0 14px;padding:8px 12px;background:#F6F9FC;border:1px solid #E3ECF4;border-radius:8px">
    <span style="font-size:12.5px;font-weight:700;color:#3D4F63">${esc(TT('steps.errRateRecentLabel', { weeks: rw.weeks }))}</span>
    <span style="font-size:19px;font-weight:800;color:${dim ? '#8A99AC' : '#E08600'};line-height:1">${rw.rate}<small style="font-size:12px;font-weight:700">%</small></span>
    <span style="font-size:11.5px;color:var(--muted)">${esc(TT('steps.errRateRecentDetail', { errors: rw.errors, cycles: rw.cycles, from: rw.fromDate, to: rw.toDate }))}</span>
    ${low}
  </div>`;
}

const SEV_BADGE = { Critical: 'b-crit', Major: 'b-major', Minor: 'b-minor' };
const SEV_BAR = { Critical: 'var(--crit)', Major: 'var(--major)', Minor: 'var(--minor)' };
const PRIO = {
  'Critical|드묾': 'Medium', 'Critical|보통': 'High', 'Critical|빈발': 'High',
  'Major|드묾': 'Low', 'Major|보통': 'Medium', 'Major|빈발': 'High',
  'Minor|드묾': 'Low', 'Minor|보통': 'Low', 'Minor|빈발': 'Medium',
};
const RES_BADGE = { '검증완료': 'b-ok', '검증중': 'b-prog', '조치중': 'b-wait', '재발': 'b-crit' };

/* ── 사이드 내비게이션 (라벨은 ui.nav, 아이콘/링크는 고정) ── */
const NAV = [
  { href: '#s-overview', icon: '◉', key: 'overview', label: '한눈에 보기', active: true },
  { href: '#all', icon: '▤', key: 'all', label: '상세 보기' },
  { href: '#s-status', icon: '▦', key: 'status' },
  { href: '#s0', icon: '▣', key: 'summary' },
  { group: 'stepsGroup', href: '#s-steps' },
  { href: '#s1', icon: '1', key: 'step1' },
  { href: '#s2', icon: '2', key: 'step2' },
  { href: '#s3', icon: '3', key: 'step3' },
  { href: '#s4', icon: '4', key: 'step4' },
  { href: '#s5', icon: '5', key: 'step5' },
  { href: '#s6', icon: '6', key: 'step6' },
  { group: 'refGroup' },
  { href: '#s-info', icon: 'ℹ', key: 'info' },
];
function buildNav() {
  // '상세 보기'(all)를 접이식 헤더로, 그 아래 개별 현황~프로젝트 정보를 #detail-group 으로 묶어 숨김/펼침
  let html = '', detailOpen = false;
  NAV.forEach(it => {
    if (it.key === 'all') {
      html += `<a href="${it.href}"${it.active ? ' class="active"' : ''} data-detailtoggle="1"><span class="st">${esc(it.icon)}</span> ${esc(T('nav.' + it.key, it.label || ''))}<span class="nav-caret">▾</span></a>`;
      html += `<div class="nav-collapse collapsed" id="detail-group">`;
      detailOpen = true;
      return;
    }
    if (it.group)   // 그룹 라벨: href 있으면 클릭 가능(해당 그룹 전체 보기), 없으면 단순 라벨
      html += it.href
        ? `<a href="${it.href}" class="t t-group">${esc(T('nav.' + it.group))}</a>`
        : `<div class="t">${esc(T('nav.' + it.group))}</div>`;
    else
      html += `<a href="${it.href}"${it.active ? ' class="active"' : ''}><span class="st">${esc(it.icon)}</span> ${esc(T('nav.' + it.key, it.label || ''))}</a>`;
  });
  if (detailOpen) html += `</div>`;
  return html;
}
// '상세 보기' 하위 탭 그룹 펼침/접힘 (한눈에 보기 활성 시 접힘)
function setDetailCollapsed(collapsed) {
  const g = $('detail-group'); if (g) g.classList.toggle('collapsed', collapsed);
  const t = document.querySelector('.nav a[data-detailtoggle]'); if (t) t.classList.toggle('detail-open', !collapsed);
}

/* ── 섹션 렌더러 ── */
function renderStatus(C, m) {
  const lc = (C.lifecycle || []).map((s, i) => {
    const cls = s.status === 'done' ? 'done' : s.status === 'current' ? 'cur' : 'todo';
    const dot = s.status === 'done' ? '✓' : s.status === 'current' ? '●' : (i + 1);
    const stt = s.status === 'done' ? T('common.stDone') : s.status === 'current' ? T('common.stCurrent') : T('common.stTodo');
    const note = s.note ? `<div class="note">${esc(s.note)}</div>` : `<div class="note empty">${esc(T('common.noteEmpty'))}</div>`;
    return `<div class="lc ${cls}"><div class="dot">${dot}</div><div class="nm">${esc(s.stage)}</div><div class="stt">${esc(stt)}</div>${note}</div>`;
  }).join('');
  const cur = (C.lifecycle || []).find(s => s.status === 'current');
  const stations = (C.line && C.line.stations) || [];
  const curSt = stations.find(s => s.status === 'current');
  const passed = stations.filter(s => s.status === 'pass').map(s => s.name).join('·');
  const waiting = stations.filter(s => s.status === 'wait').map(s => s.name).join('·');
  const cap = curSt
    ? `${esc(T('status.lineCapEval'))} <b>${esc(curSt.name)} (${esc(curSt.role)})${m ? ' · ' + m.progress.cum + '/' + m.progress.target : ''}</b>${passed ? ' · ' + esc(passed) + ' ' + esc(T('status.lineCapPassed')) : ''}${waiting ? ' · ' + esc(waiting) + ' ' + esc(T('status.lineCapWaiting')) : ''}`
    : esc(T('status.lineCapFallback'));
  const img = (C.line && C.line.layoutImage) || 'data/assets/line_layout.png';
  const sw = C.swModules || [];
  const swAvg = sw.length ? Math.round(sw.reduce((a, s) => a + s.pct, 0) / sw.length) : 0;
  const mods = sw.map(s => {
    const col = s.pct >= 100 ? 'var(--green)' : s.pct >= 50 ? 'var(--major)' : '#cdd6e2';
    return `<div class="mod"><span class="nm">${esc(s.name)}</span><div class="bar"><i style="width:${s.pct}%;background:${col}"></i></div><span class="pc">${s.pct}%</span></div>`;
  }).join('');
  const incomplete = sw.filter(s => s.pct < 50).map(s => `${esc(s.name)}(${s.pct}%)`).join('·') || esc(T('status.swNone'));
  const inprog = sw.filter(s => s.pct >= 50 && s.pct < 100).map(s => esc(s.name)).join('·') || esc(T('status.swNone'));
  // 사진/글자 비율 — config(ui.status.layout)에서 직접 조절
  const Lh = T('status.layout.lineImageHeight', 300);
  const Lfit = T('status.layout.lineImageFit', 'contain');
  const swH = T('status.layout.swImageHeight', 240);
  const swP = T('status.layout.swPhotoRatio', 3);
  const swC = T('status.layout.swContentRatio', 1);
  const swFit = T('status.layout.swImageFit', 'contain');
  return `
    <div class="sbox-h"><span class="tag">${esc(T('status.tag'))}</span><h2>${esc(T('status.title'))}</h2><span class="d">${esc(T('status.desc'))}</span></div>
    <div class="panel" style="margin-bottom:14px">
      <div class="ph"><h3>${esc(T('status.stageTitle'))}</h3><span class="vlabel" style="margin-left:auto">${esc(T('status.stageCurrentPrefix'))}${esc(cur ? cur.stage : '—')}</span></div>
      <div class="psub">${esc(TT('status.stageSub', { n: (C.lifecycle || []).length }))}</div>
      <div class="lifecycle">${lc}</div>
    </div>
    <div class="grid g2 status-grid">
      <div class="panel">
        <div class="ph"><h3>${esc(T('status.lineTitle'))}</h3><span class="vlabel" style="margin-left:auto">${esc(TT('status.lineBadge', { n: stations.length }))}</span></div>
        <div class="psub">${esc(T('status.lineSub'))}</div>
        <div class="layout-figure">
          <div class="layout-img" style="height:${Lh}px"><img src="${esc(img)}" alt="${esc(T('status.lineTitle'))}" style="object-fit:${esc(Lfit)}" onerror="this.style.opacity=.25"></div>
          <div class="layout-cap">${cap}</div>
        </div>
      </div>
      <div class="panel">
        <div class="ph"><h3>${esc(T('status.swTitle'))}</h3><span class="vlabel" style="margin-left:auto">${esc(TT('status.swBadge', { n: swAvg }))}</span></div>
        <div class="psub">${esc(T('status.swSub'))}</div>
        <div class="sw-2col" style="grid-template-columns:${swP}fr ${swC}fr">
          <div class="sw-photo" style="height:${swH}px"><img src="${esc(T('status.swImage', 'data/assets/sw_status.png'))}" alt="${esc(T('status.swTitle'))}" style="object-fit:${esc(swFit)}" onerror="this.style.display='none';this.parentNode.classList.add('empty')"><span class="ph">${esc(T('status.swImageHint', '사진 영역'))}</span></div>
          <div class="sw-content">
            <div class="mods">${mods}</div>
            <div class="mini" style="margin-top:10px">${TT('status.swFoot', { incomplete: `<b>${incomplete}</b>`, inprog })}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderPeriod(C) {
  const p = C.project || {};
  if (!p.startDate || !p.endDate) return '';
  const s = new Date(p.startDate), e = new Date(p.endDate);
  const today = DATA.generatedAt ? new Date(DATA.generatedAt.slice(0, 10)) : new Date();
  const tot = (e - s) / 86400000, el = (today - s) / 86400000;
  const pct = tot > 0 ? Math.max(0, Math.min(100, el / tot * 100)) : 0;
  const dplus = Math.max(0, Math.round(el));
  return `<div class="hperiod">
    <div class="hp-h">${esc(T('period.label'))} <span>${fmtMD(s)} ~ ${fmtMD(e)} · ${esc(TT('period.summary', { tot: Math.round(tot), dplus, pct: Math.round(pct) }))}</span></div>
    <div class="hp-bar">
      <i style="width:${pct.toFixed(1)}%"></i>
      <span class="hp-dot" style="left:${pct.toFixed(1)}%"></span>
      <span class="hp-now" style="left:${pct.toFixed(1)}%">${esc(TT('period.today', { md: fmtMD(today) }))}</span>
      <span class="hp-s">${fmtMD(s)}</span>
      <span class="hp-e">${fmtMD(e)}</span>
    </div>
  </div>`;
}

function renderSummary(C, m, acc, op) {
  const errLimit = (C.acceptance && C.acceptance.errorLimit) || 3;
  const eb = m.errorBudget || {
    used: m.errorsTotal, limit: errLimit, resets: 0, lifetimeErrors: m.errorsTotal,
    dailyAvg: DATA.daily.length ? Math.round(m.errorsTotal / DATA.daily.length * 100) / 100 : 0,
    weeklyAvg: m.weekly.length ? Math.round(m.errorsTotal / m.weekly.length * 100) / 100 : 0,
  };
  const conf = m.confidence;
  const goalCrit = acc.criteria[0], goalConf = acc.criteria[1];
  // 신뢰성 입증 목표 달성률 도넛 (입증단계·신뢰수준·MTBF·기간에러율). 에러율은 lower-better → 목표/현재.
  const recentRate = (m.recentWindow || {}).rate || 0, errTgt = m.errRateTarget;
  const dMtbf = m.mtbf.target ? m.mtbf.current / m.mtbf.target * 100 : 0;
  const dErr = errTgt != null ? (recentRate > 0 ? Math.min(100, errTgt / recentRate * 100) : 100) : 0;
  const levelPct = Math.round(conf.level * 100);
  const dConf = levelPct ? conf.currentPct / levelPct * 100 : 0;
  const succ = m.successRate || 0;
  const remain = Math.max(0, m.progress.target - m.progress.cum);
  const ebudNote = eb.resets ? TT('summary.ebudReset', { n: eb.resets, total: eb.lifetimeErrors }) : TT('summary.ebudNoReset', { total: eb.lifetimeErrors });
  return `
    <div class="sbox-h"><span class="tag">${esc(T('summary.tag'))}</span><h2>${esc(T('summary.title'))}</h2><span class="d">${esc(T('summary.desc'))}</span></div>
    <div class="goals">
      <div class="goal primary">
        <span class="gstatus ${goalCrit.status === 'pass' ? 'gs-go' : 'gs-warn'}">${esc(goalCrit.status === 'pass' ? T('summary.goalPrimaryDone') : T('summary.goalPrimaryProg'))}</span>
        <div class="gl">${esc(TT('summary.goalPrimaryTitle', { end: (C.project && C.project.endDate) || '' }))}</div>
        <div class="gt">${esc(TT('summary.goalPrimaryGoal', { target: m.progress.target, limit: errLimit }))}</div>
        <div class="pmain">
          <div class="hdonut sm">${heroDonut(m.progress.pct, 104)}<div class="ctr"><b>${m.progress.pct}%</b><span>${esc(T('summary.heroDonutSub'))}</span></div></div>
          <div class="pstats">
            <div class="s"><div class="l">${esc(T('summary.pCum'))}</div><div class="v">${m.progress.cum}<small>/${m.progress.target}</small></div></div>
            <div class="s"><div class="l">${esc(T('summary.streakLabel'))}</div><div class="v">${remain}<small>Cy</small></div></div>
            <div class="s"><div class="l">${esc(T('summary.heroThroughput'))}</div><div class="v">${m.throughput.daily}<small>회/일</small></div></div>
          </div>
        </div>
        <div class="prow">
          ${renderPeriod(C)}
          <div class="pebud">
            <div class="lbl">${esc(T('summary.ebudLabel'))}</div>
            <div class="num">${eb.used} <span class="of">${esc(TT('summary.ebudOf', { limit: eb.limit }))}</span></div>
            <div class="blocks" style="margin:8px 0 7px">${Array.from({ length: eb.limit }, (_, i) => `<i class="${i < eb.used ? 'used' : 'free'}"></i>`).join('')}</div>
            <div class="mini" style="${eb.resets ? 'color:#ffce86' : 'color:#9fb6d4'}">${esc(ebudNote)}</div>
          </div>
        </div>
        <div class="gnote">${esc(TT('summary.goalPrimaryNote', { errors: m.errorsTotal, remain }))}</div>
      </div>
      <div class="goal secondary">
        <span class="gstatus gs-cond">${acc.passed}/${acc.total} · ${esc(goalConf.status === 'pass' ? T('summary.goalSecondaryPass') : T('summary.goalSecondaryCond'))}</span>
        <div class="gl">${esc(T('summary.goalSecondaryTitle'))}</div>
        <div class="gt">${esc(TT('summary.goalSecondaryGoal', { mtbf: m.mtbf.target, conf: Math.round(conf.level * 100), err: m.errRateTarget }))}</div>
        <div style="display:flex;gap:8px;margin:12px 0 8px;justify-content:space-around">
          ${miniDonut(dConf, '#C0392B', `${conf.currentPct}%`, T('summary.donutConf'), TT('summary.donutConfSub', { t: levelPct }), 96)}
          ${miniDonut(dMtbf, '#2E89D6', `${m.mtbf.current}`, T('summary.donutMtbf'), TT('summary.donutMtbfSub', { t: m.mtbf.target }), 96)}
          ${miniDonut(dErr, '#E08600', `${recentRate}%`, T('summary.donutErrRate'), TT('summary.donutErrRateSub', { t: errTgt }), 96)}
        </div>
        <div class="srow" style="border-top:1px solid var(--line);padding-top:9px;margin-top:0">
          <span>${esc(T('summary.kpiSuccess'))} <b>${succ.toFixed(1)}%</b> <span class="mini">(성공 ${fmt(m.success)}·실패 ${fmt(m.errorsTotal)})</span></span>
          <span>최근 에러율 <b>${recentRate}%</b> <span class="mini">목표 &lt;${errTgt}%</span></span>
        </div>
        <div class="srow">${T('summary.opRel')} <span class="badge ${op.grade === '양호' ? 'b-ok' : op.grade === '주의' ? 'b-major' : 'b-prog'}">${esc(op.grade)}</span> ${TT('summary.opRelDetail', { recur: op.recur, closed: op.verifyClosedRate, open: op.openCritical })}</div>
        <div class="gnote" style="color:var(--muted)">${esc(T('summary.goalSecondaryNote'))}</div>
      </div>
    </div>
    <div class="goals-cap">
      <span>${T('summary.capPrimary')}</span>
      <span>${T('summary.capSecondary')}</span>
    </div>
    `;
}

function stepHead(no, title, q, chip, cls) {
  return `<div class="step-h"><div class="step-no">${no}</div><div class="tt"><h2>${esc(title)}</h2><div class="q">${esc(q)}</div></div><span class="chip ${cls}">${esc(chip)}</span></div>`;
}

function renderSteps(C, m, f, acc, op) {
  const conf = m.confidence, verifyCy = (C.acceptance || {}).verifyCycle || 200;
  const critStatus = st => st === 'pass' ? T('steps.critPass') : st === 'fail' ? T('steps.critFail') : T('steps.critProg');
  const crit = acc.criteria.map(c =>
    `<div class="crit"><div class="k">${esc(c.key)}</div><div class="v">${esc(c.value)}</div><span class="s ${c.status}">${esc(critStatus(c.status))}</span></div>`).join('');
  const fracasH = T('steps.fracasH', []);
  const fracas = DATA.actions.map(a => `
    <tr><td><b>${esc(a.code)}</b></td><td>${esc(a.type || '')}</td><td>${esc(a.action)}</td>
    <td class="c"><div class="prog-bar" style="width:90px;display:inline-block"><i style="width:${a.verifyProgress}%;${a.verifyResult === '검증완료' ? 'background:var(--green)' : ''}"></i></div>${a.noFailCycles ? `<div class="mini">${a.noFailCycles}/${a.verifyTarget}</div>` : ''}</td>
    <td class="c"><span class="badge ${RES_BADGE[a.verifyResult] || 'b-wait'}">${esc(a.verifyResult)}</span></td></tr>`).join('');
  const maxTop = f.top5ByCode[0] ? f.top5ByCode[0].count : 1;
  const top5 = f.top5ByCode.map(t =>
    `<tr><td><b>${esc(t.code)}</b></td><td>${esc(t.type) || '<span class="mini">(미분류)</span>'}${t.recur ? ' <span style="color:var(--crit)">↺</span>' : ''}</td><td class="c"><b>${t.count}</b></td><td style="width:54px"><div class="prog-bar"><i style="width:${Math.round(t.count / maxTop * 100)}%;background:${SEV_BAR[t.severity]}"></i></div></td><td class="c"><span class="badge ${SEV_BADGE[t.severity]}">${esc(t.severity.slice(0, 4))}</span></td></tr>`).join('');
  const rows = ['Critical', 'Major', 'Minor'], cols = ['드묾', '보통', '빈발'], cell = {};
  f.matrix.forEach((it, i) => { (cell[it.severity + '|' + it.occ] = cell[it.severity + '|' + it.occ] || []).push(i + 1); });
  const mcls = { High: 'm-h', Medium: 'm-m', Low: 'm-l' };
  let grid = `<div class="lab"></div>` + cols.map(c => `<div class="lab">${c}</div>`).join('');
  rows.forEach(rk => {
    grid += `<div class="lab">${rk.slice(0, 4)}</div>`;
    cols.forEach(ck => {
      const p = PRIO[rk + '|' + ck], dots = (cell[rk + '|' + ck] || []).map(n => `<span class="pt">${n}</span>`).join('');
      grid += `<div class="cell ${mcls[p]}">${dots}</div>`;
    });
  });
  const legend = f.matrix.map((it, i) => `<span><b>${i + 1}</b>${esc(it.type || it.code)}</span>`).join('');
  const gw = conf.requiredForLevel ? Math.min(100, Math.round(conf.currentCycles / conf.requiredForLevel * 100)) : 0;
  const levelPct = Math.round(conf.level * 100);
  const s4TableH = T('steps.s4TableH', []);
  // s4 보조 지표(한눈에 보기와 동일 정보): 성공률·최근 에러율·MTBF·재발·입증 신뢰수준
  const s4recentRate = (m.recentWindow || {}).rate || 0, s4errTgt = m.errRateTarget;
  const s4metrics = [
    ['성공률', m.successRate.toFixed(1) + '%', m.successRate >= 95 ? 'pass' : 'prog'],
    ['최근 에러율', s4recentRate + '%', s4recentRate <= s4errTgt ? 'pass' : 'fail'],
    ['MTBF', m.mtbf.current + '/' + m.mtbf.target, m.mtbf.current >= m.mtbf.target ? 'pass' : 'prog'],
    ['재발', DATA.recurrence.count + '건', DATA.recurrence.count <= 0 ? 'pass' : 'fail'],
    ['입증 신뢰수준', conf.currentPct + '%', conf.currentPct >= levelPct ? 'pass' : 'prog'],
  ].map(([k, v, st]) => `<div class="crit"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><span class="s ${st}">${esc(critStatus(st))}</span></div>`).join('');
  const ctable = `<tr class="now"><td>${esc(TT('steps.s4Now', { pct: conf.currentPct }))}</td><td>${conf.currentCycles}</td><td class="c"><span class="badge b-prog">${esc(T('steps.s4Achieved'))}</span></td></tr>` +
    conf.table.map(t => `<tr><td>${t.c}%${t.c === levelPct ? esc(T('steps.s4GoalMark')) : ''}</td><td>${t.required}</td><td class="c"><span class="badge b-wait">${conf.currentCycles >= t.required ? esc(T('steps.s4Achieved')) : '+' + (t.required - conf.currentCycles)}</span></td></tr>`).join('');
  const openActions = DATA.actions.filter(a => a.verifyResult !== '검증완료').length;
  const s5ActH = T('steps.s5ActH', []);
  const actTable = DATA.actions.map(a => `
    <tr><td>${esc(a.id)}</td><td>${esc(a.action)}</td><td>${esc(a.code)}</td><td class="c">${esc(a.owner)}</td><td class="c">${esc(a.due)}</td>
    <td class="c"><span class="badge ${a.status === '완료' ? 'b-ok' : 'b-prog'}">${esc(a.status)}</span></td>
    <td class="c"><span class="badge ${RES_BADGE[a.verifyResult] || 'b-wait'}">${esc(a.verifyResult)}</span></td>
    <td><div class="prog-bar"><i style="width:${a.verifyProgress}%;${a.verifyResult === '검증완료' ? 'background:var(--green)' : ''}"></i></div></td></tr>`).join('');
  const dailyH = T('steps.dailyH', []);
  const daily = DATA.daily.map(d => `<tr><td>${esc(d.date.slice(5))}</td><td class="c">${d.total}</td><td class="c">${d.errors}</td><td class="c">${d.streak}</td><td class="mini">${esc(d.notes)}</td></tr>`).join('');
  const errlogH = T('steps.errlogH', []);
  const errlog = DATA.errors.map((e, i) => `<tr><td><b>${esc(e.code)}</b></td><td>${esc(e.type)}<br><span class="mini">${esc((e.cause || '').slice(0, 30))}</span></td><td class="c">${esc(e.owner_sec || e.owner || '')}</td><td class="c"><button class="btn" style="padding:4px 9px" onclick="openModal(${i})">${esc(T('steps.errlogBtn'))}</button></td></tr>`).join('');
  const flow = T('steps.flow', []);
  const flowHtml = flow.map((s, i) => `<span class="b${i === flow.length - 1 ? ' last' : ''}">${esc(s)}</span>`).join('<span class="ar">→</span>');
  // 주차별 추이 범례 — 누적연속(빨강)·리셋(✕)·목표곡선(점선 --)
  const GROWTH_LG = [{ color: '#C0392B' }, { color: '#8B2E1F', x: true }, { color: '#1565C0', dash: true }];
  const growthLegendHtml = (T('steps.growthLegend', [])).map((lg, i) => {
    const mt = GROWTH_LG[i] || {};
    const icon = mt.x
      ? `<span style="color:${mt.color};font-weight:700;margin-right:4px">✕</span>`
      : mt.dash
        ? `<span style="display:inline-block;width:16px;border-top:2px dashed ${mt.color};margin-right:5px;vertical-align:middle"></span>`
        : `<i style="background:${mt.color || '#999'}"></i>`;
    return `<span>${icon}${esc(lg)}</span>`;
  }).join('');

  return `
    <div class="sbox-h"><span class="tag">${esc(T('steps.tag'))}</span><h2>${esc(T('steps.title'))}</h2><span class="d">${esc(T('steps.desc'))}</span></div>

    <section class="step" id="s1">
      ${stepHead(1, T('steps.s1Title'), T('steps.s1Q'), TT('steps.s1Chip', { passed: acc.passed, total: acc.total }), 'prog')}
      <div class="step-body"><div class="panel">
        <div class="ph"><h3>${esc(T('steps.s1PanelTitle'))}</h3><span class="ps">${esc(T('steps.s1PanelSub'))}</span></div>
        <div class="crit-grid">${crit}</div>
      </div></div>
    </section>

    <section class="step" id="s2">
      ${stepHead(2, T('steps.s2Title'), T('steps.s2Q'), T('steps.s2Chip'), 'prog')}
      <div class="step-body">
        <div class="panel">
          <div class="flow">${flowHtml}</div>
          <div class="tbl-scroll"><table><tr><th>${esc(fracasH[0] || '')}</th><th>${esc(fracasH[1] || '')}</th><th>${esc(fracasH[2] || '')}</th><th class="c" style="width:150px">${esc(tpl(fracasH[3] || '', { verify: verifyCy }))}</th><th class="c">${esc(fracasH[4] || '')}</th></tr>${fracas}</table></div>
        </div>
        <div class="grid g3 mt">
          <div class="panel"><div class="ph"><h3>${esc(T('steps.top5Title'))}</h3><span class="ps">${esc(T('steps.top5Sub'))}</span></div><table><tr>${(T('steps.top5H', [])).map((h, i) => i === 2 || i === 4 ? `<th class="c">${esc(h)}</th>` : `<th>${esc(h)}</th>`).join('')}</tr>${top5}</table></div>
          <div class="panel"><div class="ph"><h3>${esc(T('steps.matrixTitle'))}</h3><span class="ps">${esc(T('steps.matrixSub'))}</span></div><div class="matrix">${grid}</div><div class="legend-row">${legend}</div></div>
          <div class="panel"><div class="ph"><h3>${esc(T('steps.recurTitle'))}</h3><span class="ps">${esc(T('steps.recurSub'))}</span></div><div class="stat-big"><b>${DATA.recurrence.count}</b><span>${esc(TT('steps.recurUnit', { rate: DATA.recurrence.rate }))}</span></div><div class="mini">${DATA.recurrence.items.map(it => esc(it.code) + '(' + it.count + ')').join(', ') || esc(T('steps.recurNone'))}</div><div class="mini" style="margin-top:6px">${esc(T('steps.recurWarn'))}</div></div>
        </div>
      </div>
    </section>

    <section class="step" id="s3">
      ${stepHead(3, T('steps.s3Title'), T('steps.s3Q'), T('steps.s3Chip'), 'pass')}
      <div class="step-body">
        <div class="panel"><div class="ph"><h3>${esc(T('steps.growthTitle'))}</h3><span class="ps">${esc(TT('steps.growthSub', { target: m.progress.target }))}</span></div>
          <div id="weekly-chart">${weeklyChart(m.weekly, m.progress.target)}</div>
          <div class="clegend">${growthLegendHtml}<button id="weekly-scale-btn" class="btn" onclick="toggleWeeklyScale()" style="margin-left:auto;padding:3px 10px;font-size:11px">${esc(T('steps.autoScaleLabel', 'Auto scale'))}: ${weeklyAuto ? 'ON' : 'OFF'}</button></div></div>
        <div class="grid g2 mt">
          <div class="panel"><div class="ph"><h3>${esc(TT('steps.mtbfTitle', { target: m.mtbf.target }))}</h3><span class="ps">${esc(T('steps.mtbfSub'))}</span></div>${lineChart(m.weekly.map(w => w.mtbf), m.mtbf.target)}</div>
          <div class="panel"><div class="ph"><h3>${esc(T('steps.errRateTitle'))}</h3><span class="ps">${esc(T('steps.errRateSub'))}</span></div>
            ${recentErrBadge(m.recentWindow)}
            ${errRateChart(m.errRate || [])}
            <div class="clegend">${(T('steps.errRateLegend', [])).map((lg, i) => `<span><i style="background:${['#E08600', '#8B2E1F'][i]}"></i>${esc(lg)}</span>`).join('')}</div></div>
        </div>
      </div>
    </section>

    <section class="step" id="s4">
      ${stepHead(4, T('steps.s4Title'), T('steps.s4Q'), `${conf.currentPct}% ${conf.current >= conf.level ? '≥' : '<'} ${levelPct}%`, conf.current >= conf.level ? 'pass' : 'fail')}
      <div class="step-body"><div class="panel">
        <div class="ph"><h3>${esc(T('steps.s4PanelTitle'))}</h3><span class="ps">${esc(T('steps.s4PanelSub'))}</span></div>
        <div class="crit-grid" style="margin-bottom:14px">${s4metrics}</div>
        <div class="demo">
          <div>
            <div class="big">${TT('steps.s4Goal', { mtbf: m.mtbf.target, level: levelPct })}</div>
            <div class="gauge-wrap"><div class="glabel"><span>${TT('steps.s4Gauge1', { cur: conf.currentCycles })}</span><span>${TT('steps.s4Gauge2', { req: conf.requiredForLevel })}</span></div>
              <div class="prog-bar" style="height:14px"><i style="width:${gw}%;background:linear-gradient(90deg,#2E89D6,#5fb0ec)"></i></div></div>
            <div class="big">${TT('steps.s4Result', { pct: conf.currentPct })}${conf.currentCycles < conf.requiredForLevel ? TT('steps.s4Need', { need: conf.requiredForLevel - conf.currentCycles }) : T('steps.s4Met')}</div>
            <div class="formula">${T('steps.s4Formula')}</div>
          </div>
          <table class="ctable"><tr><th>${esc(s4TableH[0] || '')}</th><th>${esc(s4TableH[1] || '')}</th><th class="c">${esc(tpl(s4TableH[2] || '', { cur: conf.currentCycles }))}</th></tr>${ctable}</table>
        </div>
      </div></div>
    </section>

    <section class="step" id="s5">
      ${stepHead(5, T('steps.s5Title'), T('steps.s5Q'), TT('steps.s5Chip', { open: openActions, crit: op.openCritical }), op.openCritical ? 'fail' : 'prog')}
      <div class="step-body">
        <div class="grid g3">
          <div class="panel"><div class="ph"><h3>${esc(T('steps.s5OpenCritTitle'))}</h3><span class="ps">${esc(T('steps.s5OpenCritSub'))}</span></div><div class="big-num" style="color:${op.openCritical ? 'var(--crit)' : 'var(--green)'}">${op.openCritical}<span style="font-size:13px;color:var(--muted)"> 건</span></div><div class="mini">${esc(op.openCritical ? T('steps.s5OpenCritUnmet') : T('steps.s5OpenCritMet'))}</div></div>
          <div class="panel"><div class="ph"><h3>${esc(T('steps.s5OpenActTitle'))}</h3><span class="ps">${esc(T('steps.s5OpenActSub'))}</span></div><div class="big-num" style="color:var(--major)">${openActions}<span style="font-size:13px;color:var(--muted)"> / ${DATA.actions.length}</span></div></div>
          <div class="panel"><div class="ph"><h3>${esc(T('steps.s5ClosedTitle'))}</h3><span class="ps">${esc(T('steps.s5ClosedSub'))}</span></div><div class="big-num" style="color:var(--navy-deep)">${op.verifyClosedRate}<span style="font-size:13px;color:var(--muted)">%</span></div><div class="prog-bar" style="margin-top:8px"><i style="width:${op.verifyClosedRate}%;background:var(--green)"></i></div></div>
        </div>
        <div class="panel mt">
          <div class="ph"><h3>${esc(T('steps.s5ActTitle'))}</h3><span class="vlabel" style="margin-left:8px">${esc(T('steps.s5ActBadge'))}</span></div>
          <div class="psub">${esc(T('steps.s5ActSub'))}</div>
          <div class="tbl-scroll"><table><tr>${s5ActH.map((h, i) => i === 0 ? `<th>${esc(h)}</th>` : i === 1 ? `<th>${esc(h)}</th>` : i === 7 ? `<th style="width:96px">${esc(h)}</th>` : `<th class="c">${esc(h)}</th>`).join('')}</tr>${actTable}</table></div>
        </div>
      </div>
    </section>

    <section class="step" id="s6">
      ${stepHead(6, T('steps.s6Title'), T('steps.s6Q'), T('steps.s6Chip'), 'pass')}
      <div class="step-body">
        <div class="op-rel" style="margin-bottom:14px">${T('steps.s6Integrity')} <span class="mini" style="margin-left:auto">${esc(TT('steps.s6Source', { source: DATA.source }))}</span></div>
        <div class="grid g2">
          <div class="panel"><div class="ph"><h3>${esc(T('steps.dailyTitle'))}</h3><span class="ps">${esc(T('steps.dailySub'))}</span></div><div class="tbl-scroll"><table><tr>${dailyH.map((h, i) => i === 0 || i === 4 ? `<th>${esc(h)}</th>` : `<th class="c">${esc(h)}</th>`).join('')}</tr>${daily}</table></div></div>
          <div class="panel"><div class="ph"><h3>${esc(T('steps.errlogTitle'))}</h3><span class="badge b-prog" style="margin-left:8px">${esc(T('steps.errlogBadge'))}</span></div><div class="psub">${esc(T('steps.errlogSub'))}</div><div class="tbl-scroll"><table><tr>${errlogH.map((h, i) => i === 0 || i === 1 ? `<th>${esc(h)}</th>` : `<th class="c">${esc(h)}</th>`).join('')}</tr>${errlog}</table></div></div>
        </div>
      </div>
    </section>`;
}

/* ── 한눈에 보기(관제) : 같은 데이터로 한 화면 밀집 요약 ── */
function renderOverview(C, m, f, acc, op) {
  const prog = m.progress || {}, mtbf = m.mtbf || {}, conf = m.confidence || {}, rw = m.recentWindow || {};
  const rec = DATA.recurrence || {}, accept = C.acceptance || {};
  const errTgt = m.errRateTarget || accept.errRateTargetPct || 5;
  const recentRate = rw.rate != null ? rw.rate : (m.errRateCur || 0);
  const succ = m.successRate || 0, recurN = rec.count || 0;
  const confPct = conf.currentPct != null ? conf.currentPct : 0, confLv = Math.round((conf.level || 0.8) * 100);
  const passed = acc.passed || 0, total = acc.total || 5, grade = op.grade || '—';
  const gradeCls = grade === '양호' ? 'go' : grade === '주의' ? 'warn' : 'bad';

  // KPI 카드 (상태색: go=녹 / warn=황 / bad=적 / info=파랑)
  const kc = (cls, k, v, unit, sub, tag) =>
    `<div class="kcard ${cls}"><div class="kk">${esc(k)}</div>
      <div class="kv">${v}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
      <div class="ks">${esc(sub)}</div>${tag ? `<span class="kt">${esc(tag)}</span>` : ''}</div>`;
  const kstrip = [
    kc('k-info', '평가 진행률', (prog.pct != null ? prog.pct : 0), '%', `${fmt(prog.cum)}/${fmt(prog.target)} Cycle`, '진행'),
    kc(succ >= 95 ? 'k-go' : succ >= 85 ? 'k-warn' : 'k-bad', '성공률', succ.toFixed(1), '%', `성공 ${fmt(m.success)} · 실패 ${fmt(m.errorsTotal)}`, succ >= 95 ? '양호' : '관찰'),
    kc(recentRate <= errTgt ? 'k-go' : recentRate <= errTgt * 2 ? 'k-warn' : 'k-bad', '최근 에러율', recentRate, '%', `목표 <${errTgt}% · 에러 ${fmt(rw.errors)}/${fmt(rw.cycles)}Cy`, recentRate <= errTgt ? '충족' : '초과'),
    kc(recurN <= (accept.recurrenceLimit != null ? accept.recurrenceLimit : 0) ? 'k-go' : 'k-bad', '재발', recurN, '건', `재발률 ${rec.rate != null ? rec.rate : 0}% · 목표 0`, recurN <= 0 ? '없음' : '발생'),
    kc(mtbf.current >= mtbf.target ? 'k-go' : mtbf.current >= mtbf.target * 0.5 ? 'k-warn' : 'k-bad', 'MTBF', fmt(mtbf.current), `/${fmt(mtbf.target)}`, '평균 고장간 Cycle', mtbf.current >= mtbf.target ? '충족' : '성장중'),
    kc(confPct >= confLv ? 'k-go' : confPct >= confLv * 0.6 ? 'k-warn' : 'k-bad', '입증 신뢰수준', confPct, '%', `목표 ${confLv}% · 무고장 ${fmt(conf.currentCycles)}Cy`, confPct >= confLv ? '입증' : '진행'),
  ].join('');

  // 위험 매트릭스 (renderSteps 와 동일 구조)
  const mrows = ['Critical', 'Major', 'Minor'], mcols = ['드묾', '보통', '빈발'], mcell = {};
  (f.matrix || []).forEach((it, i) => { (mcell[it.severity + '|' + it.occ] = mcell[it.severity + '|' + it.occ] || []).push(i + 1); });
  const mcls = { High: 'm-h', Medium: 'm-m', Low: 'm-l' };
  let mx = `<div class="lab"></div>` + mcols.map(c => `<div class="lab">${esc(c)}</div>`).join('');
  mrows.forEach(rk => {
    mx += `<div class="lab">${esc(rk.slice(0, 4))}</div>`;
    mcols.forEach(ck => {
      const p = PRIO[rk + '|' + ck], dots = (mcell[rk + '|' + ck] || []).map(n => `<span class="pt">${n}</span>`).join('');
      mx += `<div class="cell ${mcls[p]}">${dots}</div>`;
    });
  });
  const mlegend = (f.matrix || []).map((it, i) => `<span><b>${i + 1}</b>${esc(it.type || it.code)}</span>`).join('');

  // Top5
  const top5 = (f.top5ByCode || []).map(t =>
    `<tr><td><b>${esc(t.code)}</b></td><td>${esc(t.type || '-')}</td><td class="c">${t.count}</td>
      <td class="c"><span class="badge ${SEV_BADGE[t.severity] || ''}">${esc(t.severity.slice(0, 4))}</span></td>
      <td class="c">${t.recur ? '<span class="badge b-crit">재발</span>' : '—'}</td></tr>`).join('');

  // 합격 기준 체크리스트
  const SL = { pass: '충족', fail: '미달', prog: '진행' };
  const chk = (acc.criteria || []).map(c =>
    `<div class="chk"><span class="cs s ${c.status}">${esc(SL[c.status] || c.status)}</span>
      <span class="nm">${esc(c.key)}</span><span class="vv">${esc(c.value)}</span></div>`).join('');

  // 운용 신뢰도 도넛
  const opDon = [
    miniDonut(op.verifyClosedRate || 0, 'var(--green)', (op.verifyClosedRate || 0) + '%', '검증 종결', 'Critical·Major', 104),
    miniDonut(op.openCritical > 0 ? 100 : 0, op.openCritical > 0 ? 'var(--crit)' : 'var(--green)', fmt(op.openCritical), '미해결 Crit', '종료 시 0', 104),
    miniDonut(recurN > 0 ? 100 : 0, recurN > 0 ? 'var(--crit)' : 'var(--green)', fmt(op.recur != null ? op.recur : recurN), '재발', '목표 0', 104),
  ].join('');

  // 양산평가 합격 기준(계약 게이트) — 연속 {target} Cycle 완주 + 에러버짓
  const errLimit = accept.errorLimit || 3;
  const eb = m.errorBudget || { used: m.errorsTotal, limit: errLimit, resets: 0, lifetimeErrors: m.errorsTotal };
  const remain = Math.max(0, prog.target - prog.cum);
  const goalCrit = (acc.criteria || [])[0] || { status: 'prog' };
  const ebudNote = eb.resets ? TT('summary.ebudReset', { n: eb.resets, total: eb.lifetimeErrors }) : TT('summary.ebudNoReset', { total: eb.lifetimeErrors });
  const ebBlocks = Array.from({ length: eb.limit }, (_, i) => `<i class="${i < eb.used ? 'used' : 'free'}"></i>`).join('');

  // lifecycle 미니
  const lcStat = { done: '완료', current: '진행 중', todo: '예정' };
  const lcm = (C.lifecycle || []).map(s => {
    const cls = s.status === 'done' ? 'done' : s.status === 'current' ? 'cur' : 'todo';
    return `<div class="lcm ${cls}"><div class="s">${esc(lcStat[s.status] || '')}</div><div class="n">${esc(s.stage)}</div></div>`;
  }).join('');

  // SW 모듈 바
  const mods = (C.swModules || []).map(s => {
    const col = s.pct >= 100 ? 'var(--green)' : s.pct >= 70 ? 'var(--sky)' : 'var(--major)';
    return `<div class="mod"><span class="nm">${esc(s.name)}</span><div class="bar"><i style="width:${s.pct}%;background:${col}"></i></div><span class="pc">${s.pct}%</span></div>`;
  }).join('');

  // 심각도 분포
  const sd = f.severityDist || { total: 0 };

  // 최근 알람 피드
  const codeSev = {};
  (DATA.codes || []).forEach(c => { codeSev[c.code] = c.severity; });
  const feed = (DATA.errors || []).slice().reverse().slice(0, 5).map(e => {
    const sevCls = SEV_BADGE[codeSev[e.code]] || 'b-minor';
    return `<div class="it"><span class="badge ${sevCls}">${esc(e.code)}</span>
      <div class="tp"><div class="t1">${esc(e.type || '-')}</div><div class="t2">${esc(e.detail || e.cause || '')}</div></div>
      <span class="dt">${esc(e.date || '')}<br>${esc(e.result || '')}</span></div>`;
  }).join('');

  // 신뢰수준 입증 표
  const ctable = (conf.table || []).map(t =>
    `<tr class="${t.c === confLv ? 'now' : ''}"><td>${t.c}%</td><td class="c">${t.required}</td>
      <td class="c">${(conf.currentCycles || 0) >= t.required ? '<span class="badge b-ok">달성</span>' : '+' + (t.required - (conf.currentCycles || 0))}</td></tr>`).join('');

  return `
    <div class="sbox-h"><span class="tag">관제</span><h2>한눈에 보기 · 신뢰성 관제</h2>
      <span class="d">핵심 지표 한 화면 · 6단계 근거는 ‘전체 보기’</span>
      <span class="ov-grade ${gradeCls}">운용 신뢰도 ${esc(grade)}</span></div>
    <div class="kstrip">${kstrip}</div>
    <div class="ct-grid">
      <div class="panel tight sp4"><div class="ph"><h3>양산평가 합격 기준</h3><span class="badge ${goalCrit.status === 'pass' ? 'b-ok' : 'b-prog'}" style="margin-left:auto">${esc(goalCrit.status === 'pass' ? '달성' : '진행 중')}</span></div>
        <div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:10px">계약 게이트 · 연속 <b>${fmt(prog.target)} Cycle</b> 완주 · 에러 <b>${errLimit}회</b>까지 허용(초과 시 리셋)</div>
        <div style="display:flex;align-items:center;gap:14px">
          <div style="flex:none"><div class="big-num" style="color:var(--navy-deep);line-height:1">${fmt(prog.cum)}<span style="font-size:15px;color:var(--muted)">/${fmt(prog.target)}</span></div><div class="mini" style="margin-top:2px">남은 <b>${fmt(remain)}</b> Cycle</div></div>
          <div style="flex:1">
            <div class="mini" style="margin-bottom:5px">Error Budget <b>${eb.used}</b> / ${eb.limit}</div>
            <div class="blocks" style="margin:0">${ebBlocks}</div>
            <div class="mini" style="margin-top:7px">${esc(ebudNote)}</div>
          </div>
        </div></div>
      <div class="panel tight sp4"><div class="ph"><h3>양산사양 합격 기준</h3><span class="ps">총 ${total}개 · ${passed} 충족</span></div>${chk}</div>
      <div class="panel tight sp4"><div class="ph"><h3>운용 신뢰도 (대응)</h3><span class="ps">등급 ${esc(grade)}</span></div><div class="donrow">${opDon}</div></div>

      <div class="panel tight sp6"><div class="ph"><h3>개발 단계</h3><span class="ps">전체 ${(C.lifecycle || []).length}단계 중 현재 위치</span></div><div class="lcmini">${lcm}</div></div>
      <div class="panel tight sp6"><div class="ph"><h3>소프트웨어 완성도</h3><span class="ps">🟢완료 🔵진행 🟠미흡</span></div><div class="mods">${mods}</div></div>

      <div class="panel tight sp6"><div class="ph"><h3>위험 매트릭스 · 심각도 분포</h3><span class="ps">S×O 우선순위 + 등급 분포</span></div>
        <div style="display:flex;gap:18px;align-items:center">
          <div style="flex:1;min-width:0"><div class="matrix">${mx}</div><div class="legend-row">${mlegend}</div></div>
          <div style="flex:none;display:flex;align-items:center;gap:14px;border-left:1px solid var(--line-soft);padding-left:18px">
            <div style="position:relative;flex:none;width:132px;height:132px">${sevDonut(sd).replace('width="104" height="104"', 'width="132" height="132"')}
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><b style="font-size:27px;font-weight:800;color:var(--navy-deep)">${sd.total || 0}</b><span style="font-size:10px;color:var(--muted)">총 고장</span></div></div>
            <div class="legend">
              <div class="li"><span class="sw" style="background:#C0392B"></span>Critical<b>${sd.Critical || 0}</b></div>
              <div class="li"><span class="sw" style="background:#E08600"></span>Major<b>${sd.Major || 0}</b></div>
              <div class="li"><span class="sw" style="background:#3F7CC4"></span>Minor<b>${sd.Minor || 0}</b></div></div></div></div></div>
      <div class="panel tight sp3"><div class="ph"><h3>빈발 고장 Top 5</h3><span class="ps">등급·재발</span></div>
        <table><tr><th>코드</th><th>유형</th><th class="c">건수</th><th class="c">등급</th><th class="c">재발</th></tr>${top5}</table></div>
      <div class="panel tight sp3"><div class="ph"><h3>최근 알람 / 이벤트</h3><span class="ps">최신순</span></div><div class="feed">${feed || '<div class="mini">기록 없음</div>'}</div></div>

      <div class="panel tight sp3 ovchart" onclick="openChart('weekly')" title="클릭하면 크게 보기"><div class="ph"><h3>주차별 연속 추이</h3><span class="ps">목표 0→${fmt(prog.target)} 곡선 ⤢</span></div>${weeklyChart(m.weekly || [], prog.target, { bot: 372, vbH: 418 })}
        <div class="clegend"><span><i style="background:#C0392B"></i>누적 연속</span><span style="color:#8B2E1F">✕ 리셋</span><span><span style="display:inline-block;width:16px;border-top:2px dashed #1565C0;vertical-align:middle"></span> 목표</span></div></div>
      <div class="panel tight sp3 ovchart" onclick="openChart('mtbf')" title="클릭하면 크게 보기"><div class="ph"><h3>MTBF 추이</h3><span class="ps">목표 ${fmt(m.mtbf.target)} Cy ⤢</span></div>${lineChart((m.weekly || []).map(w => w.mtbf), m.mtbf.target)}</div>
      <div class="panel tight sp3 ovchart" onclick="openChart('stab')" title="클릭하면 크게 보기"><div class="ph"><h3>시스템 안정성 추이</h3><span class="ps">에러율↓ MTBF↑ ⤢</span></div>${stabChart(m.weekly || [])}
        <div class="clegend"><span><i style="background:#8B2E1F"></i>에러율(좌%)</span><span><i style="background:#2E89D6"></i>MTBF(우)</span></div></div>
      <div class="panel tight sp3 ovchart" onclick="openChart('errrate')" title="클릭하면 크게 보기"><div class="ph"><h3>기간별 에러율 안정화</h3><span class="ps">막대=실측·선=평균 ⤢</span></div>${errRateChart(m.errRate || [], { bot: 372, vbH: 418 })}
        <div class="clegend"><span><i style="background:#E08600"></i>기간 에러율</span><span><i style="background:#8B2E1F"></i>누적 평균</span></div></div>
    </div>`;
}

function renderInfo(C, m) {
  const p = C.project || {}, a = C.acceptance || {};
  const stations = (C.line && C.line.stations) || [];
  const stationStr = stations.map(s => s.name + '(' + s.role + ')').join('·');
  return `
    <div class="sbox-h"><span class="tag">${esc(T('info.tag'))}</span><h2>${esc(T('info.title'))}</h2><span class="d">${esc(T('info.desc'))}</span></div>
    <div class="grid g2">
      <div class="panel"><div class="ph"><h3>${esc(T('info.overviewTitle'))}</h3><span class="ps">${esc(T('info.overviewSub'))}</span></div>
        <table>
          <tr><th style="width:110px">${esc(T('info.rowProject'))}</th><td>${esc(p.name || '')}</td></tr>
          <tr><th>${esc(T('info.rowTarget'))}</th><td>${esc(TT('info.rowTargetVal', { n: stations.length, stations: stationStr }))}</td></tr>
          <tr><th>${esc(T('info.rowPeriod'))}</th><td>${esc(p.startDate || '')} ~ ${esc(p.endDate || '')}</td></tr>
          <tr><th>${esc(T('info.rowOwner'))}</th><td>${esc(p.team || '')}${p.department ? ' · ' + esc(p.department) : ''}</td></tr>
          <tr><th>${esc(T('info.rowSource'))}</th><td>${esc(T('info.rowSourceVal'))}</td></tr>
        </table>
      </div>
      <div class="panel"><div class="ph"><h3>${esc(T('info.critTitle'))}</h3><span class="ps">${esc(T('info.critSub'))}</span></div>
        <table>
          <tr><th style="width:120px">${esc(T('info.critPass'))}</th><td>${TT('info.critPassVal', { target: a.targetCycle || m.progress.target, limit: a.errorLimit || 3 })}</td></tr>
          <tr><th>${esc(T('info.critRel'))}</th><td>${TT('info.critRelVal', { mtbf: a.mtbfTargetCycle || 100, conf: Math.round((a.confidenceLevel || 0.8) * 100), req: m.confidence.requiredForLevel })}</td></tr>
          <tr><th>${esc(T('info.critVerify'))}</th><td>${TT('info.critVerifyVal', { verify: a.verifyCycle || 200 })}</td></tr>
          <tr><th>${esc(T('info.critRecur'))}</th><td>${T('info.critRecurVal')}</td></tr>
          <tr><th>${esc(T('info.critMethod'))}</th><td>${T('info.critMethodVal')}</td></tr>
        </table>
      </div>
    </div>`;
}

/* ── 에러 상세 모달 ── */
function openModal(i) {
  const e = DATA.errors[i]; if (!e) return;
  $('modal-title').textContent = TT('modal.titleFull', { code: e.code || '', no: e.no });
  const imgs = (e.images || []).map(fn =>
    `<img src="data/errors/${esc(fn)}" alt="${esc(fn)}" onclick="lightbox('data/errors/${esc(fn)}')" onerror="this.replaceWith(document.createTextNode('${esc(TT('modal.imgMissing', { fn }))}'))">`).join('');
  $('modal-body').innerHTML = `
    <div class="ed-meta"><span><b>${esc(T('modal.occur'))}</b> ${esc(e.date)} ${esc(e.time || '')}</span><span><b>${esc(T('modal.cycle'))}</b> ${fmt(e.cycle)}</span>
    <span><b>${esc(T('modal.type'))}</b> ${esc(e.type || '—')}</span><span><b>${esc(T('modal.owner'))}</b> ${esc(TT('modal.ownerVal', { sec: e.owner_sec || '—', vendor: e.owner || '—' }))}</span></div>
    <div class="ed-block"><div class="ed-lbl">${esc(T('modal.detail'))}</div><div class="ed-txt">${esc(e.detail) || '—'}</div></div>
    <div class="ed-block"><div class="ed-lbl">${esc(T('modal.cause'))}</div><div class="ed-txt">${esc(e.cause) || '—'}</div></div>
    <div class="ed-block"><div class="ed-lbl">${esc(T('modal.action'))}</div><div class="ed-txt">${esc(e.action) || '—'} ${e.result ? '→ <span class="badge b-ok">' + esc(e.result) + '</span>' : ''}</div></div>
    ${e.detailMore ? `<div class="ed-block"><div class="ed-lbl">${esc(T('modal.detailMore'))}</div><div class="ed-txt">${esc(e.detailMore).replace(/\n/g, '<br>')}</div></div>` : ''}
    ${imgs ? `<div class="ed-block"><div class="ed-lbl">${esc(T('modal.images'))}</div><div class="ed-imgs">${imgs}</div></div>` : ''}`;
  $('modal-back').classList.add('open');
}
function closeModal() {
  $('modal-back').classList.remove('open');
  const modal = document.querySelector('#modal-back .modal'); if (modal) modal.classList.remove('wide');
}
function lightbox(src) { $('lightbox-img').src = src; $('lightbox').classList.add('open'); }

/* 관제 그래프 확대 팝업: 클릭 시 같은 차트를 넓은 기본 형상으로 다시 그려 모달 표시 */
let chartModalAuto = false;   // 팝업 내 주차별 추이 y축 오토스케일 상태 (기본 OFF = 목표 곡선 표시)
function weeklyModalBody() {
  const m = DATA.metrics || {};
  return `<div style="padding:4px 2px">${weeklyChart(m.weekly || [], m.progress.target, { auto: chartModalAuto })}
    <div class="clegend" style="margin-top:12px">
      <span><i style="background:#C0392B"></i>누적 연속</span>
      <span style="color:#8B2E1F">✕ 리셋</span>
      <span><span style="display:inline-block;width:16px;border-top:2px dashed #1565C0;vertical-align:middle"></span> 목표 곡선</span>
      <button class="btn" onclick="toggleChartScale()" style="margin-left:auto;padding:4px 11px;font-size:11.5px">오토스케일: ${chartModalAuto ? 'ON' : 'OFF'}</button>
    </div></div>`;
}
function toggleChartScale() { chartModalAuto = !chartModalAuto; $('modal-body').innerHTML = weeklyModalBody(); }
function openChart(key) {
  if (!DATA) return;
  const m = DATA.metrics || {};
  const lg = (items) => `<div class="clegend" style="margin-top:12px">${items}</div>`;
  let title, body;
  if (key === 'weekly') {
    title = '주차별 연속 사이클 추이'; body = weeklyModalBody();
  } else {
    const REG = {
      mtbf: () => ({ t: 'MTBF 추이 (목표 ' + fmt(m.mtbf.target) + ' Cy)', s: lineChart((m.weekly || []).map(w => w.mtbf), m.mtbf.target), l: '' }),
      stab: () => ({ t: '시스템 안정성 추이', s: stabChart(m.weekly || []),
        l: lg('<span><i style="background:#8B2E1F"></i>이동 에러율(좌·%)</span><span><i style="background:#2E89D6"></i>누적 MTBF(우·Cy)</span>') }),
      errrate: () => ({ t: '기간별 에러율 안정화', s: errRateChart(m.errRate || []),
        l: lg('<span><i style="background:#E08600"></i>기간 에러율</span><span><i style="background:#8B2E1F"></i>누적 평균(추세)</span>') }),
    };
    const c = REG[key] && REG[key](); if (!c) return;
    title = c.t; body = `<div style="padding:4px 2px">${c.s}${c.l}</div>`;
  }
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = body;
  const modal = document.querySelector('#modal-back .modal'); if (modal) modal.classList.add('wide');
  $('modal-back').classList.add('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); $('lightbox').classList.remove('open'); } });

/* ── 평가 기간 타임라인 ── */
function fmtMD(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

/* ── 정적 셸(브랜드·제목·내비) 텍스트 주입 ── */
function applyShellText() {
  document.title = T('app.title', document.title);
  const set = (id, prop, val) => { const el = $(id); if (el) el[prop] = val; };
  set('brand-logo', 'textContent', T('app.brandLogo'));
  set('brand-name', 'innerHTML', T('app.brandName'));
  set('page-title', 'textContent', T('app.title'));
  set('print-btn', 'textContent', T('app.printBtn'));
  set('foot-brand', 'textContent', T('app.footBrand'));
  set('modal-title', 'textContent', T('modal.title'));
  const nav = $('nav'); if (nav) nav.innerHTML = buildNav();
}

/* ── 단일 섹션 뷰: 탭을 누르면 그 내용만 표시 (보고용) ──
   #s1~#s6 은 #s-steps 컨테이너 안에 있으므로, step 탭은 #s-steps 를 켜고 그 안에서 해당 step 만 남긴다. */
const TOP_SECTIONS = ['s-overview', 's-status', 's0', 's-steps', 's-info'];
let activeHref = '#s-overview';
function showOnly(href) {
  const id = (href || '#all').replace('#', '');
  if (id === 'all') {                       // 전체 보기: 모든 섹션 + 6단계 전부
    showAllSections();
  } else {
    // step 탭은 #s-steps 안에서 해당 step만 / 그룹(#s-steps) 클릭은 6단계 전부
    const isStep = /^s[1-6]$/.test(id);
    const topId = (isStep || id === 's-steps') ? 's-steps' : id;
    TOP_SECTIONS.forEach(t => { const el = $(t); if (el) el.style.display = (t === topId) ? '' : 'none'; });
    document.querySelectorAll('#s-steps section.step').forEach(s => { s.style.display = (!isStep || s.id === id) ? '' : 'none'; });
  }
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === href));
  setDetailCollapsed(href === '#s-overview');   // 한눈에 보기면 접고, 상세/개별 탭이면 펼침
  activeHref = href;
  scrollTo(0, 0);
}
function showAllSections() {   // 전체 보기·인쇄: 6단계 리포트 전부 펼침 (관제 요약 탭은 제외 — 중복 방지)
  TOP_SECTIONS.forEach(t => { const el = $(t); if (el) el.style.display = (t === 's-overview') ? 'none' : ''; });
  document.querySelectorAll('#s-steps section.step').forEach(s => { s.style.display = ''; });
}
function initRouter() {
  const valid = NAV.filter(it => it.href).map(it => it.href);
  document.querySelectorAll('.nav a').forEach(a =>
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      e.preventDefault();
      if (history.replaceState) history.replaceState(null, '', href);
      showOnly(href);
    }));
  showOnly(valid.includes(location.hash) ? location.hash : '#s-overview');
  addEventListener('hashchange', () => { if (valid.includes(location.hash)) showOnly(location.hash); });
  addEventListener('beforeprint', showAllSections);
  addEventListener('afterprint', () => showOnly(activeHref));
}

/* ── 마운트 ── */
function mount() {
  const C = DATA.config || {}, m = DATA.metrics, f = DATA.failure, acc = DATA.acceptance, op = DATA.opReliability;
  applyShellText();
  const evalDate = DATA.generatedAt ? DATA.generatedAt.slice(0, 10) : '—';
  $('topmeta').innerHTML = `<span>${esc(T('app.evalDateLabel'))} <b>${esc(evalDate)}</b></span>`;
  $('foot-updated').textContent = T('app.updatedPrefix') + evalDate;
  $('s-overview').innerHTML = renderOverview(C, m, f, acc, op);
  $('s-status').innerHTML = renderStatus(C, m);
  $('s0').innerHTML = renderSummary(C, m, acc, op);
  $('s-steps').innerHTML = renderSteps(C, m, f, acc, op);
  $('s-info').innerHTML = renderInfo(C, m);

  initRouter();   // 탭 = 해당 섹션만 표시 (단일 섹션 뷰). 인쇄 시에는 전체 펼침.
}

/* dashboard.json(데이터) + config.json(화면 글자 ui)를 함께 로드.
   config.json 의 ui 를 우선 사용해 글자만 고쳐도 새로고침으로 즉시 반영되게 한다. */
Promise.all([
  fetch('data/dashboard.json?t=' + Date.now()).then(r => r.json()),
  fetch('data/config.json?t=' + Date.now()).then(r => r.json()).catch(() => null),
]).then(([d, cfg]) => {
  DATA = d;
  U = (cfg && cfg.ui) || (d.config && d.config.ui) || {};
  mount();
}).catch(err => {
  document.querySelector('.main').innerHTML = `<div class="banner" style="margin-top:20px">${esc(T('modal.errorLoad', '데이터를 불러오지 못했습니다 (data/dashboard.json). 로컬에서는 HTTP 서버로 여세요.'))}<br><span class="mini">${esc(err.message)}</span></div>`;
});
