/* ============================================================
   app.js — 대시보드 렌더링 로직
   데이터는 data/config.json + data/dashboard.json 에서 로드
   ============================================================ */

/* ─── 유틸 ────────────────────────────── */
const fmt = n => Number(n).toLocaleString('ko-KR');
const fmtDate = s => {
  const d = new Date(s);
  return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\.\s?$/, '');
};
const $ = id => document.getElementById(id);

/* ─── 데이터 로드 ────────────────────────── */
// cache-bust 쿼리 (GitHub Pages CDN 캐시 우회 위해 timestamp 부여)
const CACHE_BUST = `?t=${Date.now()}`;
let DATA = { project: {}, daily: [], errors: [] };
// 날짜별 1점 집계 시리즈 (하루 여러 행이면 그날 마지막 연속값으로 모음).
// 일자별·주차별 연속 사이클 차트가 모두 이 시리즈에서 파생되어 서로 일치한다.
let DAILY_BY_DATE = [];
// 연속 사이클 추이 Y축 모드 — false: 기본 고정범위(0-400), true: 데이터 오토스케일
let autoScale = { cum: false, weekly: false };
// 일자별 차트 주차 필터 — null: 전체, 0-base 주차 인덱스: 해당 주차만
let dailyWeek = null;
// 주차 인덱스 계산 (startDate 기준 7일 버킷)
function weekIndexOf(dateStr) {
  const start = new Date(DATA.project.startDate);
  return Math.max(0, Math.floor(Math.floor((new Date(dateStr) - start) / 86400000) / 7));
}

async function loadData() {
  try {
    const [cfg, dash] = await Promise.all([
      fetch(`data/config.json${CACHE_BUST}`).then(r => r.json()),
      fetch(`data/dashboard.json${CACHE_BUST}`).then(r => r.json())
    ]);
    DATA = {
      project: cfg.project,
      daily:   dash.daily   || [],
      errors:  dash.errors  || [],
      _meta:   { generatedAt: dash.generatedAt, source: dash.source }
    };
  } catch (err) {
    console.error('데이터 로드 실패:', err);
    alert('데이터 파일을 불러오지 못했습니다. data/config.json, data/dashboard.json 을 확인하세요.');
  }
}

/* ─── 미니 시각화 헬퍼 ───────────────────── */
// 스파크라인: 부드러운 area + line
function drawSparkline(svgId, values) {
  const svg = $(svgId);
  svg.innerHTML = '';
  if (!values || values.length < 2) return;
  const W = 100, H = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const recent = values.slice(-20);
  const n = recent.length;
  const xs = i => (i / (n - 1)) * W;
  const ys = v => H - 2 - ((v - min) / range) * (H - 4);
  const pts = recent.map((v, i) => [xs(i), ys(v)]);
  // smooth path
  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L ${pts[pts.length - 1][0]} ${H} L ${pts[0][0]} ${H} Z`;
  svg.innerHTML = `
    <path class="spark-area" d="${areaPath}"/>
    <path class="spark-line" d="${linePath}"/>
    <circle class="spark-dot" cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.2"/>
  `;
}

// Catmull-Rom 풍의 단순 smoothing (cubic Bezier)
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/* ─── 숫자 카드 우측 미니 시각화 ─────────────
   viewBox 0 0 100 32 기준. 데이터가 부족하면 비워둔다. */
function drawMiniSpark(id, values, color = '#2E89D6') {
  const svg = $(id);
  if (!svg) return;
  svg.innerHTML = '';
  const v = (values || []).filter(x => Number.isFinite(x));
  if (v.length < 2) return;
  const W = 100, H = 32;
  const rec = v.slice(-24), n = rec.length;
  const min = Math.min(...rec), max = Math.max(...rec), range = (max - min) || 1;
  const xs = i => (i / (n - 1)) * W;
  const ys = val => H - 3 - ((val - min) / range) * (H - 6);
  const pts = rec.map((val, i) => [xs(i), ys(val)]);
  const line = smoothPath(pts);
  const area = `${line} L ${pts[n - 1][0]} ${H} L ${pts[0][0]} ${H} Z`;
  svg.innerHTML =
    `<path d="${area}" fill="${color}" opacity="0.14"/>` +
    `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="2.4" fill="${color}"/>`;
}

function drawMiniBar(id, pct, color = '#2E89D6') {
  const svg = $(id);
  if (!svg) return;
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  svg.innerHTML =
    `<rect x="0" y="12" width="100" height="8" rx="4" fill="#E8E4D8"/>` +
    `<rect x="0" y="12" width="${p}" height="8" rx="4" fill="${color}"/>`;
}

// 축 자동 스케일 — 데이터 최댓값에 맞춘 보기 좋은 상한·격자 간격(1·2·5·10 배수).
// minStep: 정수 카운트 축에서 분수 간격(2.5 등)을 막기 위한 최소 간격.
function niceScale(maxVal, ticks = 5, minStep = 0) {
  maxVal = Math.max(maxVal, minStep || 1);
  const rawStep = maxVal / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  if (minStep) step = Math.max(step, minStep);
  return { max: Math.ceil(maxVal / step) * step, step };
}

/* ─── 일자별 차트 주차 필터 버튼 (전체 / 1주차 / 2주차 …) ─── */
function drawDailyWeekTabs() {
  const host = $('cum-week-tabs');
  if (!host) return;
  const weeks = [...new Set(DAILY_BY_DATE.map(d => weekIndexOf(d.date)))].sort((a, b) => a - b);
  let html = `<button class="wk-tab${dailyWeek == null ? ' active' : ''}" data-wk="all">전체</button>`;
  weeks.forEach(wi => {
    html += `<button class="wk-tab${dailyWeek === wi ? ' active' : ''}" data-wk="${wi}">${wi + 1}주차</button>`;
  });
  host.innerHTML = html;
  host.querySelectorAll('.wk-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      dailyWeek = btn.dataset.wk === 'all' ? null : +btn.dataset.wk;
      drawDailyWeekTabs();
      drawCumulativeChart();
    });
  });
}

/* ─── 메인 렌더링 ──────────────────────── */
function render() {
  // 메타
  $('m-location').textContent   = DATA.project.name;
  $('m-department').textContent = DATA.project.department;
  $('m-team').textContent       = DATA.project.team;
  $('m-start').textContent      = DATA.project.startDate;
  $('m-end').textContent        = DATA.project.endDate || '—';
  // LAST UPDATED — 데이터 파일이 마지막으로 빌드된 시각(UTC ISO)을 표시.
  // 새로고침 시각이 아니라 데이터 갱신 시점이라야 사용자가 "갱신됐는지" 정확히 판단 가능.
  const builtAt = DATA._meta && DATA._meta.generatedAt;
  $('m-now').textContent = builtAt ? builtAt.replace('T', ' ').replace('Z', ' UTC') : '—';

  // 정렬 (date 누락 row 방어)
  DATA.daily.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  // target / errorLimit — config 누락/0 fallback. 분모로 쓰이는 곳에서 NaN/Infinity 방지.
  const target   = Math.max(1, +DATA.project.target   || 360);
  const errLimit = Math.max(1, +DATA.project.errorLimit || 3);

  // 누적 계산
  // - cumTotal/cumErr: 전체 누적 (참고용)
  // - mtbiStreak: 현재 MTBI 시도에서의 누적 사이클. 에러 누적이 한도 초과(>errLimit)되면 0으로 초기화
  // - attemptErrs: 현재 MTBI 시도에서의 누적 에러
  let cum = 0, cumErr = 0;
  let mtbiStreak = 0, attemptErrs = 0;
  let maxMtbiStreak = 0;
  let mtbiAttempt = 1;   // 몇 번째 시도인지

  DATA.daily.forEach(d => {
    // null/undefined/NaN 들어와도 0 처리 — 손수 편집한 JSON, 누락 셀 등 방어
    d.total  = Number.isFinite(+d.total)  ? +d.total  : 0;
    d.errors = Number.isFinite(+d.errors) ? +d.errors : 0;
    cum += d.total;
    cumErr += d.errors;
    d.cumTotal = cum;
    d.cumErr = cumErr;

    attemptErrs += d.errors;
    if (attemptErrs > errLimit) {
      // 허용 한도 초과 → 시도 무효, 다음 시도 시작
      mtbiStreak = 0;
      attemptErrs = 0;
      mtbiAttempt += 1;
      d.reset = true;       // 차트에서 리셋 지점 표시용
    } else {
      mtbiStreak += d.total;
    }
    d.mtbiStreak = mtbiStreak;
    d.attemptErrs = attemptErrs;
    d.mtbiAttempt = mtbiAttempt;
    if (mtbiStreak > maxMtbiStreak) maxMtbiStreak = mtbiStreak;
  });

  // ── 날짜별 1점 집계 ─────────────────────────────────────
  // 하루에 여러 행이 있으면: total/errors는 합, mtbiStreak은 그날 마지막(=end-of-date),
  // reset은 그날 중 한 번이라도 있었으면 true. (DATA.daily는 위에서 날짜순 정렬됨)
  const _byDate = new Map();
  DATA.daily.forEach(d => {
    let e = _byDate.get(d.date);
    if (!e) { e = { date: d.date, total: 0, errors: 0, mtbiStreak: 0, reset: false }; _byDate.set(d.date, e); }
    e.total += d.total;
    e.errors += d.errors;
    e.mtbiStreak = d.mtbiStreak;   // 마지막 행 값으로 갱신 → 그날 마지막 연속값
    if (d.reset) e.reset = true;
  });
  DAILY_BY_DATE = [..._byDate.values()];

  const lastDay = DATA.daily[DATA.daily.length - 1];
  const totalCycles = lastDay ? lastDay.cumTotal : 0;   // 전체 누적
  const totalErrs   = lastDay ? lastDay.cumErr   : 0;
  const currentMtbi = lastDay ? lastDay.mtbiStreak : 0;
  const currentAttemptErrs = lastDay ? lastDay.attemptErrs : 0;
  const achieved = currentMtbi >= target;
  const pct = Math.min(currentMtbi / target, 1);

  // ── 평가 기간 (startDate ~ endDate) 계산 ─────────────
  // 기준일자 = max(오늘, 데이터의 마지막 평가일).
  // 시스템 날짜가 평가 기간 이전이거나 데이터가 미래일자로 들어와도 진행률이 반영되도록.
  const ONE_DAY = 86400000;
  const startD  = new Date(DATA.project.startDate);
  const endD    = DATA.project.endDate ? new Date(DATA.project.endDate) : null;
  const today   = new Date(new Date().toISOString().slice(0, 10));   // 시간 제거
  const lastDataD = lastDay ? new Date(lastDay.date) : null;
  const refD = (lastDataD && lastDataD > today) ? lastDataD : today;
  const totalPeriodDays = endD ? Math.round((endD - startD) / ONE_DAY) + 1 : null;
  const elapsedDays    = Math.max(0, Math.round((refD - startD) / ONE_DAY) + 1);
  const remainingDays  = endD ? Math.max(0, Math.round((endD - refD) / ONE_DAY)) : null;

  // Hero — 도넛 + 통계 (MTBI 연속 성공 기준)
  $('hero-num').textContent = fmt(currentMtbi);
  $('hero-goal').textContent = fmt(target);
  $('hero-remain').textContent = fmt(Math.max(target - currentMtbi, 0));
  $('hero-pct').textContent = achieved ? 'PASS' : (pct * 100).toFixed(1) + '%';
  // 도넛 채우기: stroke-dashoffset 으로 진행률 표현 (둘레 = 2π × r = 2π × 100 ≈ 628.32)
  const CIRC = 628.32;
  $('hero-donut-fill').style.strokeDashoffset = CIRC * (1 - pct);
  // 달성 시 도넛/숫자 컬러를 골드 톤으로
  document.querySelector('.hero').classList.toggle('achieved', achieved);

  // Error card — 현재 MTBI 시도 내 에러 카운트 기준
  $('err-num').textContent = currentAttemptErrs;
  $('err-limit').textContent = errLimit;
  const errCard = $('error-card');
  errCard.classList.toggle('danger', currentAttemptErrs >= errLimit);

  const blocks = $('err-blocks');
  blocks.innerHTML = '';
  for (let i = 0; i < errLimit; i++) {
    const b = document.createElement('div');
    b.className = 'block' + (i < currentAttemptErrs ? ' used' : '');
    blocks.appendChild(b);
  }

  // 일평균 에러 (평가일 기준) / 주평균 에러 (경과 주 기준, 최소 1주)
  const avgErrPerDay = DATA.daily.length ? totalErrs / DATA.daily.length : 0;
  $('err-avg').textContent = avgErrPerDay.toFixed(2);
  const weeksElapsed = Math.max(1, elapsedDays / 7);
  $('err-avg-week').textContent = (totalErrs / weeksElapsed).toFixed(2);

  $('err-desc').textContent = currentAttemptErrs >= errLimit
    ? `현재 시도 에러 한도 도달 — 1건 추가 시 MTBI 재시작.`
    : currentAttemptErrs === 0
      ? `현재 ${mtbiAttempt}차 시도 · 에러 0건, 안정 운영 중.`
      : `현재 ${mtbiAttempt}차 시도 · 한도까지 ${errLimit - currentAttemptErrs}건 여유.`;

  // ── 평가 현황 숫자: 진행 일수 · 일평균 · 시도 차수 ───────
  // MTBI 시도 차수
  $('m-attempt').textContent = mtbiAttempt;
  $('m-attempt-sub').textContent = mtbiAttempt === 1
    ? `리셋 없이 진행 중 · 에러 ${currentAttemptErrs}/${errLimit}`
    : `과거 ${mtbiAttempt - 1}회 리셋 · 현재 ${currentAttemptErrs}/${errLimit}`;
  // 평가 진행 일수
  $('m-days').textContent = fmt(elapsedDays);
  $('m-days-sub').innerHTML = (endD && totalPeriodDays)
    ? `총 ${fmt(totalPeriodDays)}일 · 잔여 ${fmt(remainingDays)}일`
    : `${DATA.project.startDate} 이후`;

  // ── 평가 처리량 숫자 (일평균은 평가 현황 탭에도 동일 표시) ──
  $('m-cum-total').textContent = fmt(totalCycles);
  const avg = DATA.daily.length ? Math.round(totalCycles / DATA.daily.length) : 0;
  $('m-avg').textContent = fmt(avg);
  $('m-avg-status').textContent = fmt(avg);

  // ── 평가 상세 숫자: 안정성 (MTBF / 무에러 / 에러율) ───────
  const errorDays = DATA.daily.filter(d => d.errors > 0);
  // MTBF — 평균 에러 간격 (에러일 사이 일수)
  let mtbfStr = '—';
  if (errorDays.length >= 2) {
    const intervals = [];
    for (let i = 1; i < errorDays.length; i++) {
      const a = new Date(errorDays[i - 1].date);
      const b = new Date(errorDays[i].date);
      const days = Math.round((b - a) / ONE_DAY);
      if (Number.isFinite(days)) intervals.push(days);   // Invalid Date 방어
    }
    if (intervals.length > 0) {
      const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      mtbfStr = avg.toFixed(1);
    }
  }
  $('m-mtbf').textContent = mtbfStr;

  // 무에러 연속일 — 마지막 에러일로부터 refD 까지
  let noErrDays = 0;
  if (errorDays.length === 0) {
    noErrDays = elapsedDays;
  } else {
    const lastErrD = new Date(errorDays[errorDays.length - 1].date);
    const calc = Math.round((refD - lastErrD) / ONE_DAY);
    noErrDays = Number.isFinite(calc) ? Math.max(0, calc) : 0;
  }
  $('m-noerr').textContent = fmt(noErrDays);

  // 누적 에러율 (%) — 0 cycles 일 때는 '—'
  const errRate = totalCycles > 0 ? (totalErrs / totalCycles) * 100 : null;
  $('m-err-rate').textContent = errRate === null ? '—' : errRate.toFixed(2);

  // 14일 이동 에러율 (%) — 최근 14일 윈도우의 에러합/평가합
  // 14일 미만 데이터에서는 가용한 모든 데이터로 fallback
  const WIN = 14;
  const recent = DATA.daily.slice(-WIN);
  const recentErr = recent.reduce((s, d) => s + (d.errors || 0), 0);
  const recentTot = recent.reduce((s, d) => s + (d.total  || 0), 0);
  const errRate14 = recentTot > 0 ? (recentErr / recentTot) * 100 : null;
  $('m-err-rate-14').textContent = errRate14 === null ? '—' : errRate14.toFixed(2);

  // ── 숫자 카드 미니 시각화 ────────────────────────────
  // 시계열 시리즈 (스파크라인용)
  const dailyTotals = DATA.daily.map(d => d.total || 0);
  const cumTotals   = DATA.daily.map(d => d.cumTotal || 0);
  const cumRateSer  = DATA.daily.map(d => d.cumTotal > 0 ? (d.cumErr / d.cumTotal) * 100 : 0);
  const winRateSer  = DATA.daily.map((d, i) => {
    let e = 0, t = 0;
    for (let k = Math.max(0, i - WIN + 1); k <= i; k++) { e += DATA.daily[k].errors || 0; t += DATA.daily[k].total || 0; }
    return t > 0 ? (e / t) * 100 : 0;
  });
  const mtbfSer = DATA.daily.map(d => {
    const el = Math.max(1, Math.round((new Date(d.date) - startD) / ONE_DAY) + 1);
    return el / Math.max(d.cumErr, 1);
  });
  // 현황: 진행일수(바) · 일평균(스파크) · 시도차수=에러버짓 사용량(바)
  drawMiniBar('viz-days', totalPeriodDays ? (elapsedDays / totalPeriodDays) * 100 : 100, '#1E4A7A');
  drawMiniSpark('viz-avgs', dailyTotals, '#2E89D6');
  drawMiniBar('viz-attempt', (currentAttemptErrs / errLimit) * 100, currentAttemptErrs >= errLimit ? '#8B2E1F' : '#B88A2B');
  // 안정성: 누적/14일 에러율(스파크) · MTBF(스파크) · 무에러 연속(바)
  drawMiniSpark('viz-errrate', cumRateSer, '#8B2E1F');
  drawMiniSpark('viz-errrate14', winRateSer, '#8B2E1F');
  drawMiniSpark('viz-mtbf', mtbfSer, '#2E89D6');
  drawMiniBar('viz-noerr', elapsedDays ? Math.min(noErrDays / elapsedDays, 1) * 100 : 0, '#2F5D3F');
  // 처리량: 총 누적(스파크) · 일평균(스파크)
  drawMiniSpark('viz-cum', cumTotals, '#1E4A7A');
  drawMiniSpark('viz-avg', dailyTotals, '#2E89D6');

  drawDailyWeekTabs();
  drawCumulativeChart();
  drawWeeklyStreakChart();
  drawErrorChart();
  drawStabilityChart();
  drawDailyChart();
  drawKeywordTop5();
  drawDailyTable();
  drawErrorTable();
}

/* ─── 알람 키워드 Top 5 ───────────────────
   에러의 "유형" 필드 전체를 하나의 카테고리로 보고 동일 문자열끼리 빈도 집계.
   예: "비전 인식 오류", "그리퍼 그립 실패" 가 각각 하나의 키. */
function extractKeywords(errors) {
  if (!errors || !errors.length) return [];
  const counts = new Map();   // type → { count, samples: Set<errorNo> }
  errors.forEach(e => {
    // 공백 정규화 (다중 공백 → 단일) 후 trim. 비어있으면 스킵.
    const type = (e.type || '').replace(/\s+/g, ' ').trim();
    if (!type) return;
    if (!counts.has(type)) counts.set(type, { count: 0, samples: new Set() });
    const entry = counts.get(type);
    entry.count += 1;
    entry.samples.add(e.no);
  });
  return [...counts.entries()]
    .map(([word, v]) => ({ word, count: v.count, samples: [...v.samples] }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, 5);
}

function drawKeywordTop5() {
  const host = $('keyword-list');
  const top = extractKeywords(DATA.errors);
  if (!top.length) {
    host.innerHTML = `<div class="keyword-empty">에러 데이터가 쌓이면 키워드가 표시됩니다.</div>`;
    return;
  }
  const maxCount = top[0].count;
  host.innerHTML = top.map((k, i) => `
    <div class="keyword-item">
      <div class="keyword-rank">${i + 1}</div>
      <div class="keyword-body">
        <div class="keyword-row">
          <span class="keyword-text">${k.word}</span>
          <span class="keyword-count">${k.count}<span class="u">건</span></span>
        </div>
        <div class="keyword-bar">
          <div class="fill" style="width:${(k.count / maxCount) * 100}%"></div>
        </div>
      </div>
    </div>
  `).join('');
}

/* ─── 차트: MTBI 연속 사이클 추이 ──────────── */
function drawCumulativeChart() {
  const svg = $('chart-cum');
  svg.innerHTML = '';
  const W = 1200, H = 280, PAD = { l: 60, r: 30, t: 24, b: 40 };
  const w = W - PAD.l - PAD.r;
  const h = H - PAD.t - PAD.b;

  // 날짜별 1점 시리즈. 주차 필터가 켜져 있으면 해당 주차만.
  const series = dailyWeek == null
    ? DAILY_BY_DATE
    : DAILY_BY_DATE.filter(d => weekIndexOf(d.date) === dailyWeek);
  const target = Math.max(1, +DATA.project.target || 360);
  const n = series.length;
  // Y축 — 기본은 목표(360) 포함 고정 범위, [오토스케일] 켜면 데이터에 맞춰 자동.
  const auto = autoScale.cum;
  const maxObservedStreak = series.reduce((m, d) => Math.max(m, d.mtbiStreak || 0), 0);
  let maxY, gridStep;
  if (auto) {
    const targetClose = target <= maxObservedStreak * 1.5;
    const rawMax = targetClose ? Math.max(maxObservedStreak * 1.15, target * 1.05)
                               : Math.max(maxObservedStreak * 1.25, 5);
    ({ max: maxY, step: gridStep } = niceScale(rawMax, 5, 1));
  } else {
    maxY = Math.max(Math.ceil(target * 1.1 / 50) * 50, Math.ceil(maxObservedStreak * 1.1 / 50) * 50, 100);
    gridStep = 50;
  }
  const targetInRange = target <= maxY;

  const xs = i => PAD.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const ys = v => PAD.t + h - (v / maxY) * h;

  // ── 배경 zones: 목표가 범위 안이면 위/아래로 분할, 밖이면 전체를 진행존 ──
  const tgtY = ys(target);
  if (targetInRange) {
    svg.innerHTML += `<rect x="${PAD.l}" y="${PAD.t}" width="${w}" height="${tgtY - PAD.t}" fill="url(#zoneTargetGrad)"/>`;
    svg.innerHTML += `<rect x="${PAD.l}" y="${tgtY}" width="${w}" height="${PAD.t + h - tgtY}" fill="url(#zoneSafeGrad)"/>`;
  } else {
    svg.innerHTML += `<rect x="${PAD.l}" y="${PAD.t}" width="${w}" height="${h}" fill="url(#zoneSafeGrad)"/>`;
  }

  // ── Y축 grid + 라벨 (기본: 50 minor/100 major · 오토: nice step 전부 라벨) ──
  for (let v = 0; v <= maxY + 1e-6; v += gridStep) {
    const y = ys(v);
    const major = auto || (Math.round(v) % 100 === 0);
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="${major ? '#D6D2C4' : '#EDE9DC'}" stroke-width="1"/>`;
    if (major) {
      svg.innerHTML += `<text x="${PAD.l - 10}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="700" fill="#3D4147">${fmt(Math.round(v))}</text>`;
    }
  }

  // ── TARGET — 범위 안이면 라인, 벗어나면 우상단 '목표 N ↑' 배지 ─────
  if (targetInRange) {
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${tgtY}" y2="${tgtY}" stroke="#2E89D6" stroke-width="2" stroke-dasharray="8,5" opacity="0.85"/>`;
    svg.innerHTML += `
      <g transform="translate(${PAD.l + 6}, ${tgtY - 9})">
        <rect x="0" y="-12" width="98" height="20" rx="10" fill="#2E89D6"/>
        <text x="49" y="2" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#FFFFFF" letter-spacing="0.08em">TARGET ${fmt(target)}</text>
      </g>`;
  } else {
    svg.innerHTML += `
      <g transform="translate(${W - PAD.r - 150}, ${PAD.t + 2})">
        <rect x="0" y="0" width="150" height="22" rx="11" fill="#2E89D6"/>
        <text x="75" y="15" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#FFFFFF" letter-spacing="0.04em">TARGET ${fmt(target)} ↑ (above)</text>
      </g>`;
  }

  if (n > 0) {
    // ── MTBI 라인: 시도(attempt)별로 segment 분할 (reset 지점에서 라인 끊김) ──
    const segments = [];
    let seg = [];
    series.forEach((d, i) => {
      if (d.reset && seg.length > 0) {
        segments.push(seg);
        seg = [];
      }
      seg.push([xs(i), ys(d.mtbiStreak), d, i]);
    });
    if (seg.length > 0) segments.push(seg);

    segments.forEach(segment => {
      if (segment.length < 1) return;
      const pts = segment.map(s => [s[0], s[1]]);
      const lineD = pts.length >= 2 ? smoothPath(pts) : `M ${pts[0][0]} ${pts[0][1]}`;
      if (pts.length >= 2) {
        const areaD = `${lineD} L ${pts[pts.length-1][0]} ${PAD.t + h} L ${pts[0][0]} ${PAD.t + h} Z`;
        svg.innerHTML += `<path d="${areaD}" fill="url(#areaGrad)"/>`;
        svg.innerHTML += `<path d="${lineD}" fill="none" stroke="url(#lineGrad)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#lineGlow)"/>`;
      }
      // 데이터 포인트
      // - reset 점: 일반 흰 원만 표시 (빨간 표시 생략)
      // - 그 외 에러 있는 날: 빨간 강조 원
      // - 정상 날: 작은 흰 원
      segment.forEach(([x, y, d]) => {
        if (d.reset || d.errors === 0) {
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="4" fill="#FFFFFF" stroke="#1A2942" stroke-width="2"/>`;
        } else {
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="8" fill="#FFFFFF" stroke="#8B2E1F" stroke-width="2.5"/>`;
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="3.5" fill="#8B2E1F"/>`;
        }
      });
    });

    // ── 현재 위치 마커 + 값 라벨 ───────────────────────────
    const lastD = series[n - 1];
    const lx = xs(n - 1), ly = ys(lastD.mtbiStreak);
    svg.innerHTML += `<line x1="${lx}" x2="${lx}" y1="${ly}" y2="${PAD.t + h}" stroke="#1A2942" stroke-width="1" stroke-dasharray="2,3" opacity="0.4"/>`;
    svg.innerHTML += `<circle cx="${lx}" cy="${ly}" r="8" fill="#1A2942" opacity="0.15"/>`;
    svg.innerHTML += `<circle cx="${lx}" cy="${ly}" r="5" fill="#1A2942"/>`;
    svg.innerHTML += `<circle cx="${lx}" cy="${ly}" r="2" fill="#FFFFFF"/>`;
    // 현재 값 박스
    const labelW = 76;
    const labelX = Math.min(lx + 8, W - PAD.r - labelW);
    svg.innerHTML += `
      <g transform="translate(${labelX}, ${ly - 14})">
        <rect x="0" y="0" width="${labelW}" height="28" rx="14" fill="#0F1419" filter="url(#lineGlow)"/>
        <text x="${labelW/2}" y="18" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="13" font-weight="700" fill="#FFFFFF" letter-spacing="0.04em">${fmt(lastD.mtbiStreak)}</text>
      </g>`;
  }

  // X축 라벨 (시작·끝·중간 몇 개)
  if (n > 0) {
    const xTicks = n <= 8 ? [...Array(n).keys()] : [0, Math.floor(n*0.25), Math.floor(n*0.5), Math.floor(n*0.75), n - 1];
    xTicks.forEach(i => {
      const x = xs(i);
      svg.innerHTML += `<text x="${x}" y="${H - PAD.b + 18}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${fmtDate(series[i].date)}</text>`;
    });
  }

  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + h}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1.5"/>`;
}


/* ─── 차트: 주차별 연속 사이클 추이 ─────────────────────────
   - 가로축: 주차(1,2,3,…) — 평가 시작일(startDate) 기준 7일 버킷
   - 막대 2종(그룹):
       ① 주차 연속 성공(초록) — 그 주 안에서 도달한 최대 연속(매주 0에서 시작, 에러 시 리셋)
       ② 누적 연속(네이비)    — 주말 시점의 연속 streak(주차 넘어 누적, 에러 시 리셋 반영)
   - 목표: 0→360 램프 (2차 곡선 메인 + 선형 비교), config.target / weeklyTargetExp */
function drawWeeklyStreakChart() {
  const svg = $('chart-weekly');
  if (!svg) return;
  svg.innerHTML = '';
  const W = 1200, H = 280, PAD = { l: 60, r: 30, t: 24, b: 44 };
  const w = W - PAD.l - PAD.r, h = H - PAD.t - PAD.b;

  const target = Math.max(1, +DATA.project.target || 360);
  const TARGET_EXP = Math.max(1, +DATA.project.weeklyTargetExp || 2);  // 1=선형, 2=2차곡선
  const ONE_DAY = 86400000;
  const startD = new Date(DATA.project.startDate);
  const endD = DATA.project.endDate ? new Date(DATA.project.endDate) : null;
  const n = DATA.daily.length;

  const weekOf = dateStr => Math.max(0, Math.floor(Math.floor((new Date(dateStr) - startD) / ONE_DAY) / 7));

  let lastDataWeek = 0;
  DATA.daily.forEach(d => { lastDataWeek = Math.max(lastDataWeek, weekOf(d.date)); });

  const totalDays = endD ? Math.round((endD - startD) / ONE_DAY) + 1 : (lastDataWeek + 1) * 7;
  const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));

  // ① 누적 연속 — 주말(그 주 마지막 날짜) 시점의 연속 streak. (DAILY_BY_DATE는 날짜순)
  const cumWeek = new Array(totalWeeks).fill(null);
  DAILY_BY_DATE.forEach(d => {
    const wi = weekOf(d.date);
    if (wi < totalWeeks) cumWeek[wi] = d.mtbiStreak || 0;
  });

  // ② 주차 연속 성공 — 매주 0에서 시작, 에러 한도 초과 시 0으로 리셋.
  // 리셋이 있던 주는 '최댓값'이 아니라 '리셋 이후 현재(주말 시점) 연속'을 반영한다.
  const perWeek = new Array(totalWeeks).fill(null);
  const weekReset = new Array(totalWeeks).fill(0);
  let _cw = -1, _acc = 0;
  DATA.daily.forEach(d => {
    const wi = weekOf(d.date);
    if (wi >= totalWeeks) return;
    if (wi !== _cw) { _cw = wi; _acc = 0; }
    if (d.reset) { _acc = 0; weekReset[wi] += 1; }
    else { _acc += (d.total || 0); }
    perWeek[wi] = _acc;   // 최신값(그 주 마지막 행 기준) — 리셋되면 그 이후 누적만 반영
  });

  // 목표 램프 (0→target)
  const quadTarget = w1 => target * Math.pow(Math.min(w1, totalWeeks) / totalWeeks, TARGET_EXP);
  const lineTarget = w1 => target * (Math.min(w1, totalWeeks) / totalWeeks);

  // Y 스케일 — 기본은 목표(360) 포함 고정, [오토스케일] 켜면 데이터에 맞춰 자동.
  const auto = autoScale.weekly;
  const maxObserved = Math.max(
    cumWeek.reduce((m, v) => Math.max(m, v || 0), 0),
    perWeek.reduce((m, v) => Math.max(m, v || 0), 0)
  );
  let maxY, gridStep;
  if (auto) {
    const targetClose = target <= Math.max(maxObserved, 1) * 1.5;
    const rawMax = targetClose ? Math.max(maxObserved * 1.15, target * 1.05)
                               : Math.max(maxObserved * 1.25, quadTarget(lastDataWeek + 1) * 1.4, 5);
    ({ max: maxY, step: gridStep } = niceScale(rawMax, 5, 1));
  } else {
    maxY = Math.max(Math.ceil(target * 1.1 / 50) * 50, Math.ceil(maxObserved * 1.1 / 50) * 50, 100);
    gridStep = 50;
  }

  const slot = w / totalWeeks;
  const cx = i => PAD.l + slot * (i + 0.5);
  const ys = v => PAD.t + h - (v / maxY) * h;

  // Y축 grid + 라벨
  for (let v = 0; v <= maxY + 1e-6; v += gridStep) {
    const y = ys(v);
    const major = auto || (Math.round(v) % 100 === 0);
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="${major ? '#D6D2C4' : '#EDE9DC'}" stroke-width="1"/>`;
    if (major) {
      svg.innerHTML += `<text x="${PAD.l - 10}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="700" fill="#3D4147">${fmt(Math.round(v))}</text>`;
    }
  }

  // 그룹 막대 — 좌: 주차 연속 성공(초록), 우: 누적 연속(네이비)
  const groupW = Math.min(46, slot * 0.72);
  const barW = groupW / 2 - 2;
  const lblFont = `font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="10" font-weight="700"`;
  for (let i = 0; i < totalWeeks; i++) {
    const pv = perWeek[i], cv = cumWeek[i];
    if (pv === null && cv === null) {
      svg.innerHTML += `<rect x="${cx(i) - 2}" y="${PAD.t + h - 3}" width="4" height="3" rx="1.5" fill="#E8E4D8"/>`;
      continue;
    }
    const x0 = cx(i) - groupW / 2;
    // ① 주차 연속 성공 (좌, 초록)
    if (pv !== null) {
      const by = ys(pv), bh = (PAD.t + h) - by;
      svg.innerHTML += `<rect x="${x0}" y="${by}" width="${barW}" height="${bh}" rx="3" fill="#3E9B6E"/>`;
      svg.innerHTML += `<text x="${x0 + barW / 2}" y="${by - 4}" text-anchor="middle" ${lblFont} fill="#256B4A">${fmt(pv)}</text>`;
    }
    // ② 누적 연속 (우, 네이비) + 리셋 마커
    if (cv !== null) {
      const bx = x0 + barW + 4;
      const by = ys(cv), bh = (PAD.t + h) - by;
      const reset = weekReset[i] > 0;
      const stroke = reset ? ` stroke="#8B2E1F" stroke-width="2"` : '';
      svg.innerHTML += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="3" fill="url(#lineGrad)"${stroke}/>`;
      svg.innerHTML += `<text x="${bx + barW / 2}" y="${by - 4}" text-anchor="middle" ${lblFont} fill="#0F2E54">${fmt(cv)}</text>`;
      if (reset) {
        const my = bh > 24 ? by + 12 : by - 13;
        svg.innerHTML += `<circle cx="${bx + barW / 2}" cy="${my}" r="8" fill="#8B2E1F"/>`;
        svg.innerHTML += `<text x="${bx + barW / 2}" y="${my + 4}" text-anchor="middle" ${lblFont} fill="#FFFFFF">↺</text>`;
        if (weekReset[i] > 1) {
          svg.innerHTML += `<text x="${bx + barW / 2 + 11}" y="${my - 5}" text-anchor="start" ${lblFont} fill="#8B2E1F">×${weekReset[i]}</text>`;
        }
      }
    }
  }

  // 목표 곡선 — 2차(메인)+선형(비교). 상한 위는 실제값+clip 으로 자연스럽게.
  svg.innerHTML += `<defs><clipPath id="weeklyPlotClip"><rect x="${PAD.l}" y="${PAD.t}" width="${w}" height="${h}"/></clipPath></defs>`;
  const capY = val => Math.max(ys(val), PAD.t - h);
  const quadPts = [], linePts = [];
  for (let i = 0; i < totalWeeks; i++) {
    quadPts.push([cx(i), capY(quadTarget(i + 1))]);
    linePts.push([cx(i), capY(lineTarget(i + 1))]);
  }
  if (totalWeeks >= 2) {
    let curves = '';
    curves += `<path d="${smoothPath(linePts)}" fill="none" stroke="#9AA0A8" stroke-width="2" stroke-dasharray="5,5" opacity="0.8"/>`;
    curves += `<path d="${smoothPath(quadPts)}" fill="none" stroke="#1565C0" stroke-width="2.4" stroke-dasharray="8,5"/>`;
    svg.innerHTML += `<g clip-path="url(#weeklyPlotClip)">${curves}</g>`;
  }

  // TARGET 배지 (우상단)
  svg.innerHTML += `
    <g transform="translate(${W - PAD.r - 96}, ${PAD.t + 4})">
      <rect x="0" y="-12" width="96" height="20" rx="10" fill="#1565C0"/>
      <text x="48" y="2" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#FFFFFF" letter-spacing="0.06em">TARGET ${fmt(target)}</text>
    </g>`;

  // X축 라벨 — 주차 번호
  const step = totalWeeks <= 16 ? 1 : Math.ceil(totalWeeks / 16);
  for (let i = 0; i < totalWeeks; i++) {
    if (i % step !== 0 && i !== totalWeeks - 1) continue;
    svg.innerHTML += `<text x="${cx(i)}" y="${H - PAD.b + 20}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${i + 1}주</text>`;
  }

  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + h}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1.5"/>`;

  // 하단 안내
  const hint = $('weekly-hint');
  if (hint) {
    if (n === 0) {
      hint.innerHTML = `<span class="neutral">데이터 누적 중</span> · 평가가 시작되면 주차별 추이를 표시합니다.`;
    } else {
      const curWeek = lastDataWeek + 1;
      const curCum = cumWeek[lastDataWeek] || 0;
      const curPer = perWeek[lastDataWeek] || 0;
      const goalNow = quadTarget(curWeek);
      const onTrack = curCum >= goalNow;
      const tag = onTrack ? `<span class="good">목표 상회</span>` : `<span class="bad">목표 미달</span>`;
      const totalResets = weekReset.reduce((s, v) => s + v, 0);
      const resetTxt = totalResets > 0 ? ` · <span class="bad">리셋 ${totalResets}회</span>(↺)` : '';
      hint.innerHTML = `${tag} · <strong>${curWeek}주차</strong> 누적 연속 <strong>${fmt(curCum)}</strong>회 ` +
        `· 그 주 연속성공 <strong>${fmt(curPer)}</strong>회 · 2차 목표 ${fmt(Math.round(goalNow))}회 (전체 ${totalWeeks}주 · 최종 ${fmt(target)})${resetTxt}`;
    }
  }
}


/* ─── 차트: 시도 내 에러 추이 (한도 초과 시 0으로 리셋) ─── */
function drawErrorChart() {
  const svg = $('chart-err');
  svg.innerHTML = '';
  const W = 1200, H = 180, PAD = { l: 60, r: 30, t: 24, b: 40 };
  const w = W - PAD.l - PAD.r, h = H - PAD.t - PAD.b;

  const limit = Math.max(1, +DATA.project.errorLimit || 3);
  // Y축 — limit + 2 또는 관측된 최대 attemptErrs + 1 중 큰 값
  const maxObservedAttemptErrs = DATA.daily.reduce((m, d) => Math.max(m, d.attemptErrs || 0), 0);
  const maxY = Math.max(limit + 2, maxObservedAttemptErrs + 1, 5);
  const n = DATA.daily.length;
  const xs = i => PAD.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const ys = v => PAD.t + h - (v / maxY) * h;

  // ── Danger zone: limit 초과 영역 빨간 음영 ─────────
  const ly = ys(limit);
  svg.innerHTML += `<rect x="${PAD.l}" y="${PAD.t}" width="${w}" height="${ly - PAD.t}" fill="url(#errAreaGrad)" opacity="0.6"/>`;

  // ── grid: 1단위 진한 실선 + 라벨 ─────────────────
  for (let i = 0; i <= maxY; i++) {
    const y = ys(i);
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#D6D2C4" stroke-width="1"/>`;
    svg.innerHTML += `<text x="${PAD.l - 10}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="700" fill="#3D4147">${i}</text>`;
  }

  // ── LIMIT 라벨 ──────────────────────────────────
  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${ly}" y2="${ly}" stroke="#8B2E1F" stroke-width="2" stroke-dasharray="8,5"/>`;
  svg.innerHTML += `
    <g transform="translate(${W - PAD.r - 6}, ${ly - 9})">
      <rect x="-72" y="-12" width="72" height="20" rx="10" fill="#8B2E1F"/>
      <text x="-36" y="2" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#FFFFFF" letter-spacing="0.08em">LIMIT ${limit}</text>
    </g>`;

  if (n > 0) {
    // 시도별 segment 분리 (reset 지점에서 라인 끊기)
    const segments = [];
    let seg = [];
    DATA.daily.forEach((d, i) => {
      if (d.reset && seg.length > 0) {
        segments.push(seg);
        seg = [];
      }
      seg.push([xs(i), ys(d.attemptErrs), d, i]);
    });
    if (seg.length > 0) segments.push(seg);

    segments.forEach(segment => {
      if (segment.length < 1) return;
      // 계단식(step) path — 에러는 정수 누적이라 step이 더 직관적
      let pathD = '';
      let areaD = '';
      segment.forEach(([x, y], k) => {
        if (k === 0) {
          pathD += `M ${x} ${y}`;
          areaD = `M ${x} ${PAD.t + h} L ${x} ${y}`;
        } else {
          const py = segment[k - 1][1];
          pathD += ` L ${x} ${py} L ${x} ${y}`;
          areaD += ` L ${x} ${py} L ${x} ${y}`;
        }
      });
      areaD += ` L ${segment[segment.length - 1][0]} ${PAD.t + h} Z`;

      svg.innerHTML += `<path d="${areaD}" fill="url(#errAreaGrad)"/>`;
      svg.innerHTML += `<path d="${pathD}" fill="none" stroke="url(#errLineGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#errLineGlow)"/>`;

      // 에러 발생 점 표시 (시도 내)
      segment.forEach(([x, y, d]) => {
        if (d.errors > 0) {
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="9" fill="#8B2E1F" opacity="0.15"/>`;
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="6" fill="#FFFFFF" stroke="#8B2E1F" stroke-width="2.5"/>`;
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="3" fill="#8B2E1F"/>`;
        }
      });
    });

  }

  DATA.daily.forEach((d, i) => {
    if (i % Math.ceil(n / 10) === 0 || i === n - 1) {
      const x = xs(i);
      svg.innerHTML += `<text x="${x}" y="${H - PAD.b + 16}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${fmtDate(d.date)}</text>`;
    }
  });

  svg.innerHTML += `<line x1="${PAD.l}" x2="${PAD.l}" y1="${PAD.t}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1"/>`;
  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + h}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1"/>`;
}

/* ─── 차트: 시스템 안정성 추이 (이동 에러율 + 누적 에러율 + MTBF) ───
   - 14일 이동 에러율(%) = 최근 14일 에러합 / 최근 14일 평가합 × 100  → 좌축, 빨강 실선(메인)
     · 14일 미만 데이터에서는 가용한 모든 데이터로 fallback
     · "최근 안정화 여부"를 즉각 보여주는 지표
   - 누적 에러율(%)      = (누적에러 / 누적평가) × 100                → 좌축, 빨강 점선(베이스라인)
     · 전체 신뢰도. 천천히 변함
   - 누적 MTBF(일)       = 경과일수 / max(누적에러, 1)               → 우축, 파랑
     · 에러 0건일 땐 분모 1 fallback (발산 방지)
   이동 에러율 ↓ + MTBF ↑ 가 동시에 진행되면 안정화. */
function drawStabilityChart() {
  const svg = $('chart-stability');
  if (!svg) return;
  svg.innerHTML = '';
  const W = 1200, H = 240, PAD = { l: 60, r: 70, t: 28, b: 40 };
  const w = W - PAD.l - PAD.r, h = H - PAD.t - PAD.b;

  const n = DATA.daily.length;
  if (n === 0) return;

  // 시점별 지표 계산
  const startD = new Date(DATA.project.startDate);
  const ONE_DAY = 86400000;
  const WINDOW = 14;
  const points = DATA.daily.map((d, i) => {
    const dDate = new Date(d.date);
    const elapsed = Math.max(1, Math.round((dDate - startD) / ONE_DAY) + 1);
    const rateCum = d.cumTotal > 0 ? (d.cumErr / d.cumTotal) * 100 : 0;
    // 14일 윈도우 (또는 가용한 모든 과거 데이터): 윈도우 내 에러합/평가합
    const wStart = Math.max(0, i - WINDOW + 1);
    let wErr = 0, wTot = 0;
    for (let k = wStart; k <= i; k++) {
      wErr += DATA.daily[k].errors || 0;
      wTot += DATA.daily[k].total  || 0;
    }
    const rateWin = wTot > 0 ? (wErr / wTot) * 100 : 0;
    const mtbf = elapsed / Math.max(d.cumErr, 1);
    return { date: d.date, rateCum, rateWin, mtbf, cumErr: d.cumErr };
  });

  // 스케일: 좌축(에러율) — 두 라인 중 최댓값 기준. 최소 5% 보장.
  const maxObservedRate = Math.max(...points.map(p => Math.max(p.rateCum, p.rateWin)));
  const maxRate = Math.max(5, Math.ceil(maxObservedRate * 1.2));
  const maxMtbf = Math.max(10, Math.ceil(Math.max(...points.map(p => p.mtbf)) * 1.15));

  const xs = i => PAD.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const ysR = v => PAD.t + h - (v / maxRate) * h;   // 에러율(좌축)
  const ysM = v => PAD.t + h - (v / maxMtbf) * h;   // MTBF(우축)

  // 가로 grid
  const TICKS = 5;
  for (let i = 0; i <= TICKS; i++) {
    const y = PAD.t + (i / TICKS) * h;
    const rateVal = (maxRate * (1 - i / TICKS));
    const mtbfVal = (maxMtbf * (1 - i / TICKS));
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#E8E4D8" stroke-width="1" stroke-dasharray="2,3"/>`;
    // 좌축: 에러율 (%)
    svg.innerHTML += `<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#8B2E1F">${rateVal.toFixed(maxRate >= 10 ? 0 : 1)}%</text>`;
    // 우축: MTBF (일)
    svg.innerHTML += `<text x="${W - PAD.r + 8}" y="${y + 4}" text-anchor="start" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#2E89D6">${mtbfVal.toFixed(maxMtbf >= 10 ? 0 : 1)}d</text>`;
  }

  // 축 타이틀
  svg.innerHTML += `<text x="${PAD.l - 8}" y="${PAD.t - 10}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="10" font-weight="700" fill="#8B2E1F" letter-spacing="0.08em">ERROR %</text>`;
  svg.innerHTML += `<text x="${W - PAD.r + 8}" y="${PAD.t - 10}" text-anchor="start" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="10" font-weight="700" fill="#2E89D6" letter-spacing="0.08em">MTBF d</text>`;

  if (n >= 2) {
    // ── 14일 이동 에러율 (메인, 빨강 area + 굵은 실선) ─────────
    const winPts = points.map((p, i) => [xs(i), ysR(p.rateWin)]);
    const winLine = smoothPath(winPts);
    const winArea = `${winLine} L ${winPts[winPts.length - 1][0]} ${PAD.t + h} L ${winPts[0][0]} ${PAD.t + h} Z`;
    svg.innerHTML += `<path d="${winArea}" fill="url(#errAreaGrad)" opacity="0.55"/>`;
    svg.innerHTML += `<path d="${winLine}" fill="none" stroke="#8B2E1F" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#errLineGlow)"/>`;

    // ── 누적 에러율 (베이스라인, 빨강 점선) ─────────────────
    const cumPts = points.map((p, i) => [xs(i), ysR(p.rateCum)]);
    const cumLine = smoothPath(cumPts);
    svg.innerHTML += `<path d="${cumLine}" fill="none" stroke="#8B2E1F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6,4" opacity="0.7"/>`;

    // ── MTBF 라인 (파랑, 우축) ──────────────────────────
    const mtbfPts = points.map((p, i) => [xs(i), ysM(p.mtbf)]);
    const mtbfLine = smoothPath(mtbfPts);
    svg.innerHTML += `<path d="${mtbfLine}" fill="none" stroke="#2E89D6" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#lineGlow)"/>`;

    // 마지막 값 마커
    const lastIdx = points.length - 1;
    const last = points[lastIdx];
    svg.innerHTML += `<circle cx="${winPts[lastIdx][0]}" cy="${winPts[lastIdx][1]}" r="5" fill="#FFFFFF" stroke="#8B2E1F" stroke-width="2.5"/>`;
    svg.innerHTML += `<circle cx="${cumPts[lastIdx][0]}" cy="${cumPts[lastIdx][1]}" r="3.5" fill="#FFFFFF" stroke="#8B2E1F" stroke-width="1.5" opacity="0.75"/>`;
    svg.innerHTML += `<circle cx="${mtbfPts[lastIdx][0]}" cy="${mtbfPts[lastIdx][1]}" r="5" fill="#FFFFFF" stroke="#2E89D6" stroke-width="2.5"/>`;

    // 라벨: 14일 이동(굵게) · 누적(작게) · MTBF
    // 세 라벨이 같은 X에 모이므로 Y를 정렬하면서 겹침 회피.
    const lblX = Math.min(winPts[lastIdx][0] + 10, W - PAD.r - 100);
    const positions = [
      { y: winPts[lastIdx][1],  text: `14D ${last.rateWin.toFixed(2)}%`, fill: '#8B2E1F', w: 92 },
      { y: cumPts[lastIdx][1],  text: `CUM ${last.rateCum.toFixed(2)}%`, fill: '#6B1F14', w: 92, faded: true },
      { y: mtbfPts[lastIdx][1], text: `MTBF ${last.mtbf.toFixed(1)}d`,    fill: '#2E89D6', w: 92 },
    ].sort((a, b) => a.y - b.y);
    // 위에서부터 최소 26px 간격 유지 (겹침 방지)
    for (let k = 1; k < positions.length; k++) {
      if (positions[k].y - positions[k-1].y < 26) {
        positions[k].y = positions[k-1].y + 26;
      }
    }
    positions.forEach(pos => {
      svg.innerHTML += `
        <g transform="translate(${lblX}, ${pos.y - 11})" opacity="${pos.faded ? 0.85 : 1}">
          <rect x="0" y="0" width="${pos.w}" height="22" rx="11" fill="${pos.fill}"/>
          <text x="${pos.w/2}" y="15" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#FFFFFF">${pos.text}</text>
        </g>`;
    });
  } else if (n === 1) {
    // 데이터 1점만 있을 때는 점만 표시
    svg.innerHTML += `<circle cx="${xs(0)}" cy="${ysR(points[0].rateWin)}" r="5" fill="#FFFFFF" stroke="#8B2E1F" stroke-width="2.5"/>`;
    svg.innerHTML += `<circle cx="${xs(0)}" cy="${ysM(points[0].mtbf)}" r="5" fill="#FFFFFF" stroke="#2E89D6" stroke-width="2.5"/>`;
  }

  // X축 라벨
  const xTicks = n <= 10 ? [...Array(n).keys()] : [0, Math.floor(n*0.25), Math.floor(n*0.5), Math.floor(n*0.75), n - 1];
  xTicks.forEach(i => {
    const x = xs(i);
    svg.innerHTML += `<text x="${x}" y="${H - PAD.b + 18}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${fmtDate(DATA.daily[i].date)}</text>`;
  });

  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + h}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1.5"/>`;

  // 하단 안내 텍스트 — 추세 평가 (14일 이동 에러율 기준으로 "최근 안정성" 판정)
  const hint = $('stability-hint');
  if (hint && n >= 2) {
    const first = points[0], last = points[points.length - 1];
    const rateDelta = last.rateWin - first.rateWin;   // 음수면 개선
    const mtbfDelta = last.mtbf    - first.mtbf;      // 양수면 개선
    const tag = last.rateWin < first.rateWin && mtbfDelta >= 0
      ? `<span class="good">안정화 진행</span>`
      : (rateDelta > 0 && mtbfDelta < 0)
        ? `<span class="bad">악화 추세</span>`
        : `<span class="neutral">혼합 추세</span>`;
    hint.innerHTML = `${tag} · 14일 이동 에러율 ${first.rateWin.toFixed(2)}% → <strong>${last.rateWin.toFixed(2)}%</strong> · 누적 에러율 <strong>${last.rateCum.toFixed(2)}%</strong> · MTBF ${first.mtbf.toFixed(1)}d → <strong>${last.mtbf.toFixed(1)}d</strong>`;
  } else if (hint) {
    hint.innerHTML = `<span class="neutral">데이터 누적 중</span> · 2일 이상 누적되면 추세 분석을 표시합니다.`;
  }
}

/* ─── 차트: 일일 평가 막대 ──────────────── */
function drawDailyChart() {
  const svg = $('chart-daily');
  svg.innerHTML = '';
  const W = 1200, H = 240, PAD = { l: 60, r: 30, t: 20, b: 40 };
  const w = W - PAD.l - PAD.r, h = H - PAD.t - PAD.b;

  const n = DATA.daily.length;
  if (n === 0) return;   // 데이터 없을 때 0 나눗셈 방지

  const maxY = Math.max(...DATA.daily.map(d => d.total || 0), 10);
  const barW = (w / n) * 0.7;
  const gap = (w / n) * 0.3;

  for (let i = 0; i <= 5; i++) {
    const y = PAD.t + (i / 5) * h;
    const val = Math.round(maxY * (1 - i / 5));
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#E8E4D8" stroke-width="1"/>`;
    svg.innerHTML += `<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${val}</text>`;
  }

  DATA.daily.forEach((d, i) => {
    const x = PAD.l + (w / n) * i + gap / 2;
    const totalH = (d.total / maxY) * h;
    const errH = (d.errors / maxY) * h;
    const successH = totalH - errH;

    if (successH > 0) {
      svg.innerHTML += `<rect x="${x}" y="${PAD.t + h - totalH}" width="${barW}" height="${successH}" fill="url(#lineGrad)" rx="3" ry="3"/>`;
    }
    if (errH > 0) {
      svg.innerHTML += `<rect x="${x}" y="${PAD.t + h - errH}" width="${barW}" height="${errH}" fill="#8B2E1F" rx="3" ry="3"/>`;
    }

    svg.innerHTML += `<text x="${x + barW / 2}" y="${PAD.t + h - totalH - 6}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="700" fill="#0F1419">${d.total}</text>`;
    svg.innerHTML += `<text x="${x + barW / 2}" y="${H - PAD.b + 16}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${fmtDate(d.date)}</text>`;
  });

  svg.innerHTML += `<line x1="${PAD.l}" x2="${PAD.l}" y1="${PAD.t}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1"/>`;
  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + h}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1"/>`;
}

/* ─── 테이블 ───────────────────────────── */
function drawDailyTable() {
  const tbody = document.querySelector('#tbl-daily tbody');
  tbody.innerHTML = '';
  const target = Math.max(1, +DATA.project.target || 360);
  [...DATA.daily].reverse().forEach(d => {
    const tr = document.createElement('tr');
    const pct = ((d.mtbiStreak / target) * 100).toFixed(1);
    const resetTag = d.reset ? ` <span class="badge err" title="에러 한도 초과로 MTBI 재시작">RESTART</span>` : '';
    tr.innerHTML = `
      <td class="center">${d.date}</td>
      <td>${d.personnel}</td>
      <td>${d.activity}${resetTag}</td>
      <td class="num">${fmt(d.total)}</td>
      <td class="num ${d.errors > 0 ? 'err' : ''}">${d.errors}</td>
      <td class="num">${fmt(d.streak)}</td>
      <td class="num">${fmt(d.mtbiStreak)}</td>
      <td class="num">${pct}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function drawErrorTable() {
  const tbody = document.querySelector('#tbl-err tbody');
  tbody.innerHTML = '';
  DATA.errors.forEach((e, i) => {
    const imgCount = Array.isArray(e.images) ? e.images.length : 0;
    const hasMore = (e.detailMore && String(e.detailMore).trim()) || imgCount > 0;
    const moreCell = hasMore
      ? `<button class="btn-more" onclick="openErrorDetail(${i})">＋ 상세${imgCount ? ` <span class="img-badge">📷 ${imgCount}</span>` : ''}</button>`
      : `<span class="muted-dash">—</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="center"><span class="badge err">${e.no}</span></td>
      <td class="center">${e.date}</td>
      <td class="center">${e.time}</td>
      <td class="num">${fmt(e.cycle)}</td>
      <td class="center"><span class="badge err">${e.code}</span></td>
      <td><strong>${e.type}</strong><br><span style="color:var(--ink-soft)">${e.detail}</span></td>
      <td><span style="color:var(--ink-soft)">원인:</span> ${e.cause}<br><span style="color:var(--ink-soft)">조치:</span> ${e.action} → <span class="badge">${e.result}</span></td>
      <td class="center">${e.owner_sec || ''}</td>
      <td class="center">${e.owner || ''}</td>
      <td class="center">${moreCell}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ─── 에러 상세자료 모달 (＋상세 버튼) ─────────────
   업체가 엑셀에 입력한 상세설명/사진을 클릭 시에만 모달로 표시.
   사진 파일은 data/errors/<파일명> 경로에서 로드한다. */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openErrorDetail(i) {
  const e = DATA.errors[i];
  if (!e) return;
  $('err-modal-title').textContent = `에러 상세자료 · ${e.code || ''} (No.${e.no})`;
  const imgs = Array.isArray(e.images) ? e.images : [];

  const meta = `
    <div class="ed-meta">
      <span><b>발생</b> ${escapeHtml(e.date)} ${escapeHtml(e.time || '')}</span>
      <span><b>회차</b> ${fmt(e.cycle)}</span>
      <span><b>유형</b> ${escapeHtml(e.type || '—')}</span>
      <span><b>담당</b> 삼성 ${escapeHtml(e.owner_sec || '—')} / 업체 ${escapeHtml(e.owner || '—')}</span>
    </div>`;

  const base = `
    <div class="ed-block"><div class="ed-lbl">상세</div><div class="ed-txt">${escapeHtml(e.detail) || '—'}</div></div>
    <div class="ed-block"><div class="ed-lbl">원인</div><div class="ed-txt">${escapeHtml(e.cause) || '—'}</div></div>
    <div class="ed-block"><div class="ed-lbl">조치</div><div class="ed-txt">${escapeHtml(e.action) || '—'} ${e.result ? '→ ' + escapeHtml(e.result) : ''}</div></div>`;

  const moreTxt = (e.detailMore && String(e.detailMore).trim())
    ? `<div class="ed-block"><div class="ed-lbl">상세설명</div><div class="ed-txt ed-more">${escapeHtml(e.detailMore).replace(/\n/g, '<br>')}</div></div>`
    : '';

  const imgGrid = imgs.length
    ? `<div class="ed-block"><div class="ed-lbl">사진 (${imgs.length})</div><div class="ed-imgs">` +
      imgs.map(fn => {
        const src = 'data/errors/' + encodeURIComponent(fn);
        return `<figure class="ed-thumb">
          <img src="${src}" alt="${escapeHtml(fn)}" loading="lazy"
               onclick="openLightbox('${src}')"
               onerror="this.closest('.ed-thumb').classList.add('missing')">
          <figcaption>${escapeHtml(fn)}</figcaption>
        </figure>`;
      }).join('') + `</div>
      <div class="ed-imgnote">이미지가 안 보이면 <code>data/errors/</code> 폴더에 해당 파일이 아직 없는 것입니다.</div></div>`
    : '';

  $('err-modal-body').innerHTML = meta + base + moreTxt + imgGrid;
  $('err-modal').classList.add('active');
}
function closeErrModal() { $('err-modal').classList.remove('active'); }
function openLightbox(src) { $('lightbox-img').src = src; $('lightbox').classList.add('active'); }
function closeLightbox() { $('lightbox').classList.remove('active'); $('lightbox-img').src = ''; }

// ESC 로 모달/라이트박스 닫기
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('lightbox').classList.contains('active')) closeLightbox();
  else if ($('err-modal').classList.contains('active')) closeErrModal();
});

/* ─── 탭 전환 ───────────────────────────── */
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('panel-' + t.dataset.tab).classList.add('active');
  });
});

/* ─── 연속 사이클 추이 Y축 오토스케일 토글 ───────── */
function _wireScaleToggle(btnId, key, redraw) {
  const btn = $(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    autoScale[key] = !autoScale[key];
    btn.classList.toggle('active', autoScale[key]);
    btn.textContent = autoScale[key] ? 'Fixed Range ⤡' : 'Auto-Scale ⤢';
    redraw();
  });
}
_wireScaleToggle('btn-scale-cum', 'cum', drawCumulativeChart);
_wireScaleToggle('btn-scale-weekly', 'weekly', drawWeeklyStreakChart);

/* ─── 데이터 입력 모달 ───────────────────── */
$('btn-load').addEventListener('click', () => $('modal').classList.add('active'));

function closeModal() {
  $('modal').classList.remove('active');
}

function parsePaste(text) {
  return text.trim().split('\n').map(line => {
    return line.split(/\t|,/).map(s => s.trim());
  }).filter(r => r.length > 0 && r[0]);
}

function applyPaste() {
  const dailyText = $('paste-area').value.trim();
  const errText = $('paste-err').value.trim();

  if (dailyText) {
    const rows = parsePaste(dailyText);
    DATA.daily = rows.map(r => ({
      date: r[0],
      personnel: r[1] || '',
      activity: r[2] || '',
      total: parseInt(r[3]) || 0,
      errors: parseInt(r[4]) || 0,
      streak: parseInt(r[5]) || 0,
      notes: r[6] || ''
    }));
  }

  if (errText) {
    const rows = parsePaste(errText);
    DATA.errors = rows.map(r => ({
      no: parseInt(r[0]) || 0,
      date: r[1] || '',
      time: r[2] || '',
      cycle: parseInt(r[3]) || 0,
      code: r[4] || '',
      type: r[5] || '',
      detail: r[6] || '',
      cause: r[7] || '',
      action: r[8] || '',
      result: r[9] || '',
      owner_sec: r[10] || '',
      owner: r[11] || '',
      detailMore: r[12] || '',
      images: (r[13] || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean)
    }));
  }

  closeModal();
  render();
}

/* ─── 초기 렌더 ─────────────────────────── */
(async () => {
  await loadData();
  render();
})();
