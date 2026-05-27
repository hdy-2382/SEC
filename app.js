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
// 평가 기간 timeline 막대: 경과·잔여 비율 표현
function drawTimelineBar(elapsed, total) {
  const host = $('kpi-days-timeline');
  if (!host) return;
  const pct = total > 0 ? Math.min(elapsed / total, 1) * 100 : 0;
  host.innerHTML = `
    <div class="tl-track">
      <div class="tl-fill" style="width:${pct}%"></div>
      <div class="tl-marker" style="left:${pct}%"></div>
    </div>
    <div class="tl-labels">
      <span>D+${elapsed}</span>
      <span>총 ${total}일</span>
    </div>
  `;
}

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

/* ─── 메인 렌더링 ──────────────────────── */
function render() {
  // 메타
  $('m-project').textContent = DATA.project.name;
  $('m-vendor').textContent  = DATA.project.vendor;
  $('m-pm').textContent      = DATA.project.pm;
  $('m-start').textContent   = DATA.project.startDate;
  $('m-now').textContent     = new Date().toISOString().slice(0, 10);

  // 정렬
  DATA.daily.sort((a, b) => a.date.localeCompare(b.date));

  const target = DATA.project.target;
  const errLimit = DATA.project.errorLimit;

  // 누적 계산
  // - cumTotal/cumErr: 전체 누적 (참고용)
  // - mtbiStreak: 현재 MTBI 시도에서의 누적 사이클. 에러 누적이 한도 초과(>errLimit)되면 0으로 초기화
  // - attemptErrs: 현재 MTBI 시도에서의 누적 에러
  let cum = 0, cumErr = 0;
  let mtbiStreak = 0, attemptErrs = 0;
  let maxMtbiStreak = 0;
  let mtbiAttempt = 1;   // 몇 번째 시도인지

  DATA.daily.forEach(d => {
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

  const lastDay = DATA.daily[DATA.daily.length - 1];
  const totalCycles = lastDay ? lastDay.cumTotal : 0;   // 전체 누적
  const totalErrs   = lastDay ? lastDay.cumErr   : 0;
  const currentMtbi = lastDay ? lastDay.mtbiStreak : 0;
  const currentAttemptErrs = lastDay ? lastDay.attemptErrs : 0;
  const achieved = currentMtbi >= target;
  const pct = Math.min(currentMtbi / target, 1);

  // ── 평가 기간 (startDate ~ endDate) 계산 ─────────────
  const ONE_DAY = 86400000;
  const startD  = new Date(DATA.project.startDate);
  const endD    = DATA.project.endDate ? new Date(DATA.project.endDate) : null;
  const today   = new Date(new Date().toISOString().slice(0, 10));   // 시간 제거
  const totalPeriodDays = endD ? Math.round((endD - startD) / ONE_DAY) + 1 : null;
  const elapsedDays    = Math.max(0, Math.round((today - startD) / ONE_DAY) + 1);
  const remainingDays  = endD ? Math.max(0, Math.round((endD - today) / ONE_DAY)) : null;

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

  // 일평균 에러
  const avgErrPerDay = DATA.daily.length ? totalErrs / DATA.daily.length : 0;
  $('err-avg').textContent = avgErrPerDay.toFixed(2);

  $('err-desc').textContent = currentAttemptErrs >= errLimit
    ? `현재 시도 에러 한도 도달 — 1건 추가 시 MTBI 재시작.`
    : currentAttemptErrs === 0
      ? `현재 ${mtbiAttempt}차 시도 · 에러 0건, 안정 운영 중.`
      : `현재 ${mtbiAttempt}차 시도 · 한도까지 ${errLimit - currentAttemptErrs}건 여유.`;

  // KPI ① 최장 MTBI 연속 (역대 최고치)
  $('kpi-streak').textContent = fmt(maxMtbiStreak);
  $('kpi-streak-sub').textContent = currentMtbi === maxMtbiStreak && !achieved
    ? '현재 시도가 역대 최고'
    : currentMtbi < maxMtbiStreak
      ? `현재 ${fmt(currentMtbi)}회 (재시작 후)`
      : 'MTBI 목표 도달';
  // 막대: 최장 MTBI를 목표 대비로 표현
  const streakBarPct = Math.min(maxMtbiStreak / target, 1) * 100;
  $('kpi-streak-bar').setAttribute('width', streakBarPct);

  // KPI ② 평가 진행 일수 — 시작일~종료일 timeline 기준
  $('kpi-days').textContent = fmt(elapsedDays);
  if (endD && totalPeriodDays) {
    $('kpi-days-sub').innerHTML = `총 <strong>${fmt(totalPeriodDays)}일</strong> · 잔여 <strong>${fmt(remainingDays)}일</strong>`;
  } else {
    $('kpi-days-sub').textContent = `${DATA.project.startDate} 이후`;
  }
  // 미니 viz: 점 패턴 → timeline 막대로 교체
  drawTimelineBar(elapsedDays, totalPeriodDays || elapsedDays);

  // KPI ③ 일평균 평가 — 스파크라인
  const avg = DATA.daily.length ? Math.round(totalCycles / DATA.daily.length) : 0;
  $('kpi-avg').textContent = fmt(avg);
  drawSparkline('kpi-avg-spark', DATA.daily.map(d => d.total));

  // KPI ④ MTBI 시도 차수
  $('kpi-attempt').innerHTML = `${mtbiAttempt}<span class="unit">차 시도</span>`;
  if (mtbiAttempt === 1) {
    $('kpi-attempt-sub').innerHTML = currentAttemptErrs === 0
      ? `리셋 없이 진행 중 · 에러 ${currentAttemptErrs}/${errLimit}`
      : `에러 ${currentAttemptErrs}/${errLimit}건 사용 중`;
  } else {
    $('kpi-attempt-sub').innerHTML = `과거 ${mtbiAttempt - 1}회 리셋 · 현재 에러 ${currentAttemptErrs}/${errLimit}`;
  }
  // 미니 viz: 현재 시도 내 에러 사용량 (errors / limit)
  const errUsagePct = Math.min(currentAttemptErrs / errLimit, 1) * 100;
  $('kpi-attempt-bar').setAttribute('width', errUsagePct);

  // Summary
  const summaryParts = [];
  summaryParts.push(`평가 시작 후 <strong>${DATA.daily.length}일</strong> 경과 · 누적 <strong>${fmt(totalCycles)}회</strong> 진행.`);
  if (achieved) {
    summaryParts.push(`<span class="ok">MTBI 목표(${fmt(target)}회) 달성</span> — ${mtbiAttempt}차 시도 성공.`);
  } else {
    summaryParts.push(`현재 ${mtbiAttempt}차 MTBI 시도 — <strong>${fmt(currentMtbi)} / ${fmt(target)}</strong> (${(pct*100).toFixed(1)}%).`);
  }
  if (currentAttemptErrs === 0) summaryParts.push(`<span class="ok">시도 내 에러 0건</span>.`);
  else if (currentAttemptErrs < errLimit) summaryParts.push(`시도 내 에러 <strong>${currentAttemptErrs}건</strong> · 한도까지 ${errLimit - currentAttemptErrs}건 여유.`);
  else summaryParts.push(`<span class="warn">시도 내 에러 한도 도달</span> — 1건 추가 시 재시작.`);
  summaryParts.push(`역대 최장 MTBI <strong>${fmt(maxMtbiStreak)}회</strong>.`);
  $('summary-text').innerHTML = summaryParts.join(' ');

  drawCumulativeChart();
  drawErrorChart();
  drawDailyErrorTrend();
  drawDailyChart();
  drawKeywordTop5();
  drawDailyTable();
  drawErrorTable();
}

/* ─── 알람 키워드 Top 5 ─────────────────── */
// 한글 불용어 (의미 없는 조사·일반어). 필요시 도메인 키워드에 맞춰 확장.
const STOPWORDS = new Set([
  '오류','에러','문제','발생','확인','시험','검토','조정','조치','보정',
  '추정','등의','등을','등은','또는','그리고','하지만','그러나',
  '대상','이슈','이후','진행','완료','정상','복귀','상황','상태','관련',
  '있음','없음','부분','경우','전체','일부','이번','당일','금일','금주',
  '시스템','로봇'
]);

function extractKeywords(errors) {
  if (!errors || !errors.length) return [];
  // 에러 1건당 어떤 필드에서 추출했는지 추적 (요약 가능)
  const counts = new Map();   // word → { count, samples: Set<errorNo> }
  errors.forEach(e => {
    const blob = `${e.type || ''} ${e.detail || ''} ${e.cause || ''} ${e.action || ''}`;
    // 한글 2자 이상, 영문 3자 이상 토큰
    const tokens = blob.match(/[가-힣]{2,}|[A-Za-z][A-Za-z0-9]{2,}/g) || [];
    const seen = new Set();   // 같은 에러에서 같은 단어는 1회만
    tokens.forEach(t => {
      const k = t.toLowerCase();
      if (STOPWORDS.has(k) || STOPWORDS.has(t)) return;
      if (seen.has(k)) return;
      seen.add(k);
      if (!counts.has(t)) counts.set(t, { count: 0, samples: new Set() });
      const entry = counts.get(t);
      entry.count += 1;
      entry.samples.add(e.no);
    });
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

  const target = DATA.project.target;
  const maxY = Math.max(target * 1.15, ...DATA.daily.map(d => d.mtbiStreak)) || target;
  const n = DATA.daily.length;

  const xs = i => PAD.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const ys = v => PAD.t + h - (v / maxY) * h;

  // ── 배경 banded zones: TARGET 위쪽(달성존), 아래쪽(진행존) ─────
  const tgtY = ys(target);
  svg.innerHTML += `<rect x="${PAD.l}" y="${PAD.t}" width="${w}" height="${tgtY - PAD.t}" fill="url(#zoneTargetGrad)"/>`;
  svg.innerHTML += `<rect x="${PAD.l}" y="${tgtY}" width="${w}" height="${PAD.t + h - tgtY}" fill="url(#zoneSafeGrad)"/>`;

  // ── Y축 grid + tick labels ─────────────────────────────────
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const y = PAD.t + (i / ticks) * h;
    const val = Math.round(maxY * (1 - i / ticks));
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#E8E4D8" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg.innerHTML += `<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${fmt(val)}</text>`;
  }

  // ── TARGET 라인 ────────────────────────────────────────────
  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${tgtY}" y2="${tgtY}" stroke="#B88A2B" stroke-width="2" stroke-dasharray="8,5" opacity="0.85"/>`;
  svg.innerHTML += `
    <g transform="translate(${PAD.l + 6}, ${tgtY - 9})">
      <rect x="0" y="-12" width="98" height="20" rx="10" fill="#B88A2B"/>
      <text x="49" y="2" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#FFFFFF" letter-spacing="0.08em">TARGET ${fmt(target)}</text>
    </g>`;

  if (n > 0) {
    // ── MTBI 라인: 시도(attempt)별로 segment 분할 (reset 지점에서 라인 끊김) ──
    const segments = [];
    let seg = [];
    DATA.daily.forEach((d, i) => {
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
      segment.forEach(([x, y, d]) => {
        if (d.errors > 0) {
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="8" fill="#FFFFFF" stroke="#8B2E1F" stroke-width="2.5"/>`;
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="3.5" fill="#8B2E1F"/>`;
        } else {
          svg.innerHTML += `<circle cx="${x}" cy="${y}" r="4" fill="#FFFFFF" stroke="#1A2942" stroke-width="2"/>`;
        }
      });
    });

    // ── 리셋 지점 표시 (검정 수직 점선 + RESTART 라벨) ──
    DATA.daily.forEach((d, i) => {
      if (d.reset) {
        const x = xs(i);
        svg.innerHTML += `<line x1="${x}" x2="${x}" y1="${PAD.t}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.55"/>`;
        svg.innerHTML += `
          <g transform="translate(${x}, ${PAD.t + 8})">
            <rect x="-32" y="-8" width="64" height="16" rx="8" fill="#0F1419"/>
            <text x="0" y="3" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="10" font-weight="700" fill="#FFFFFF" letter-spacing="0.1em">RESTART</text>
          </g>`;
      }
    });

    // ── 현재 위치 마커 + 값 라벨 ───────────────────────────
    const lastD = DATA.daily[n - 1];
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
      svg.innerHTML += `<text x="${x}" y="${H - PAD.b + 18}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${fmtDate(DATA.daily[i].date)}</text>`;
    });
  }

  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + h}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1.5"/>`;
}

/* ─── 차트: 시도 내 에러 추이 (한도 초과 시 0으로 리셋) ─── */
function drawErrorChart() {
  const svg = $('chart-err');
  svg.innerHTML = '';
  const W = 1200, H = 180, PAD = { l: 60, r: 30, t: 24, b: 40 };
  const w = W - PAD.l - PAD.r, h = H - PAD.t - PAD.b;

  const limit = DATA.project.errorLimit;
  // attemptErrs 기준: 시도 안에서만 에러를 누적, 한도 초과 시 0
  const maxY = limit + 1;
  const n = DATA.daily.length;
  const xs = i => PAD.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const ys = v => PAD.t + h - (v / maxY) * h;

  // ── Danger zone: limit 초과 영역 빨간 음영 ─────────
  const ly = ys(limit);
  svg.innerHTML += `<rect x="${PAD.l}" y="${PAD.t}" width="${w}" height="${ly - PAD.t}" fill="url(#errAreaGrad)" opacity="0.6"/>`;

  // ── grid + tick ─────────────────────────────────
  for (let i = 0; i <= maxY; i++) {
    const y = ys(i);
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#E8E4D8" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg.innerHTML += `<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${i}</text>`;
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

    // 리셋 지점 표시 (검정)
    DATA.daily.forEach((d, i) => {
      if (d.reset) {
        const x = xs(i);
        svg.innerHTML += `<line x1="${x}" x2="${x}" y1="${PAD.t}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.55"/>`;
        svg.innerHTML += `
          <g transform="translate(${x}, ${PAD.t + 8})">
            <rect x="-32" y="-8" width="64" height="16" rx="8" fill="#0F1419"/>
            <text x="0" y="3" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="10" font-weight="700" fill="#FFFFFF" letter-spacing="0.1em">RESTART</text>
          </g>`;
      }
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

/* ─── 차트: 일일 에러 발생 추이 (안정화 지표) ──── */
function drawDailyErrorTrend() {
  const svg = $('chart-daily-err');
  if (!svg) return;
  svg.innerHTML = '';
  const W = 1200, H = 220, PAD = { l: 60, r: 30, t: 24, b: 40 };
  const w = W - PAD.l - PAD.r, h = H - PAD.t - PAD.b;

  const n = DATA.daily.length;
  if (n === 0) return;

  const errors = DATA.daily.map(d => d.errors || 0);
  const maxY = Math.max(...errors, 3);
  const xs = i => PAD.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const ys = v => PAD.t + h - (v / maxY) * h;

  // 7일 이동평균
  const WINDOW = 7;
  const ma = errors.map((_, i) => {
    const start = Math.max(0, i - WINDOW + 1);
    const slice = errors.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  // Y축 grid + tick
  const ticks = Math.min(maxY, 5);
  for (let i = 0; i <= ticks; i++) {
    const y = PAD.t + (i / ticks) * h;
    const val = (maxY * (1 - i / ticks)).toFixed(maxY >= 5 ? 0 : 1);
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#E8E4D8" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg.innerHTML += `<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${val}</text>`;
  }

  // 일일 에러 막대
  const barW = Math.max(6, Math.min(28, (w / n) * 0.6));
  DATA.daily.forEach((d, i) => {
    const e = d.errors || 0;
    if (e <= 0) {
      // 0 에러는 아주 옅은 막대 (시각적으로 "이 날 에러 없음"을 표시)
      const baseY = ys(0);
      svg.innerHTML += `<rect x="${xs(i) - barW/2}" y="${baseY - 4}" width="${barW}" height="4" rx="2" fill="#E8E4D8"/>`;
      return;
    }
    const x = xs(i) - barW / 2;
    const y = ys(e);
    const barH = (PAD.t + h) - y;
    svg.innerHTML += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="url(#errLineGrad)"/>`;
    // 값 라벨
    svg.innerHTML += `<text x="${xs(i)}" y="${y - 6}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#8B2E1F">${e}</text>`;
  });

  // 7일 이동평균 추세선 (smooth)
  if (n >= 2) {
    const pts = ma.map((v, i) => [xs(i), ys(v)]);
    const lineD = smoothPath(pts);
    svg.innerHTML += `<path d="${lineD}" fill="none" stroke="#B88A2B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0" opacity="0.9" filter="url(#lineGlow)"/>`;
    // 마지막 값에 점
    const lastIdx = pts.length - 1;
    svg.innerHTML += `<circle cx="${pts[lastIdx][0]}" cy="${pts[lastIdx][1]}" r="4" fill="#FFFFFF" stroke="#B88A2B" stroke-width="2.2"/>`;
    // 현재 이동평균 값 라벨
    const labelX = Math.min(pts[lastIdx][0] + 8, W - PAD.r - 80);
    svg.innerHTML += `
      <g transform="translate(${labelX}, ${pts[lastIdx][1] - 14})">
        <rect x="0" y="0" width="80" height="22" rx="11" fill="#B88A2B"/>
        <text x="40" y="15" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="11" font-weight="700" fill="#FFFFFF">MA${WINDOW} ${ma[lastIdx].toFixed(2)}</text>
      </g>`;
  }

  // X축 라벨
  const xTicks = n <= 10 ? [...Array(n).keys()] : [0, Math.floor(n*0.25), Math.floor(n*0.5), Math.floor(n*0.75), n - 1];
  xTicks.forEach(i => {
    const x = xs(i);
    svg.innerHTML += `<text x="${x}" y="${H - PAD.b + 18}" text-anchor="middle" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${fmtDate(DATA.daily[i].date)}</text>`;
  });

  // X축 라인
  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + h}" y2="${PAD.t + h}" stroke="#0F1419" stroke-width="1.5"/>`;
}

/* ─── 차트: 일일 평가 막대 ──────────────── */
function drawDailyChart() {
  const svg = $('chart-daily');
  svg.innerHTML = '';
  const W = 1200, H = 240, PAD = { l: 60, r: 30, t: 20, b: 40 };
  const w = W - PAD.l - PAD.r, h = H - PAD.t - PAD.b;

  const maxY = Math.max(...DATA.daily.map(d => d.total), 10);
  const n = DATA.daily.length;
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
  const target = DATA.project.target;
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
  DATA.errors.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="center"><span class="badge err">${e.no}</span></td>
      <td class="center">${e.date}</td>
      <td class="center">${e.time}</td>
      <td class="num">${fmt(e.cycle)}</td>
      <td class="center"><span class="badge err">${e.code}</span></td>
      <td><strong>${e.type}</strong><br><span style="color:var(--ink-soft)">${e.detail}</span></td>
      <td><span style="color:var(--ink-soft)">원인:</span> ${e.cause}<br><span style="color:var(--ink-soft)">조치:</span> ${e.action} → <span class="badge">${e.result}</span></td>
      <td class="center">${e.owner}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ─── 탭 전환 ───────────────────────────── */
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('panel-' + t.dataset.tab).classList.add('active');
  });
});

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
      owner: r[10] || ''
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
