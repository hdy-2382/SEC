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

  // 누적 계산
  let cum = 0, cumErr = 0, maxStreak = 0;
  DATA.daily.forEach(d => {
    cum += d.total;
    cumErr += d.errors;
    d.cumTotal = cum;
    d.cumErr = cumErr;
    if (d.streak > maxStreak) maxStreak = d.streak;
  });

  const target = DATA.project.target;
  const errLimit = DATA.project.errorLimit;
  const lastDay = DATA.daily[DATA.daily.length - 1];
  const totalCycles = lastDay ? lastDay.cumTotal : 0;
  const totalErrs = lastDay ? lastDay.cumErr : 0;
  const pct = totalCycles / target;

  // Hero
  $('hero-num').textContent = fmt(totalCycles);
  $('hero-denom').textContent = fmt(target);
  $('hero-goal').textContent = fmt(target);
  $('hero-fill').style.width = Math.min(pct * 100, 100) + '%';
  $('hero-pct').textContent = (pct * 100).toFixed(1) + '%';

  // Error card
  $('err-num').textContent = totalErrs;
  $('err-limit').textContent = errLimit;
  const errCard = $('error-card');
  errCard.classList.toggle('danger', totalErrs >= errLimit);

  const blocks = $('err-blocks');
  blocks.innerHTML = '';
  for (let i = 0; i < errLimit; i++) {
    const b = document.createElement('div');
    b.className = 'block' + (i < totalErrs ? ' used' : '');
    blocks.appendChild(b);
  }

  $('err-desc').textContent = totalErrs >= errLimit
    ? `허용 한도 ${errLimit}회 도달 — 즉시 검토 필요.`
    : totalErrs === 0
      ? '한도 내 안정 운영 중.'
      : `한도까지 ${errLimit - totalErrs}회 여유.`;

  // KPI
  $('kpi-streak').textContent = fmt(maxStreak);
  $('kpi-streak-sub').textContent = lastDay && lastDay.streak === maxStreak
    ? '현재 연속 진행 중' : `최근 종료 ${lastDay.streak}회`;

  $('kpi-days').textContent = DATA.daily.length;
  $('kpi-days-sub').textContent = `${DATA.project.startDate} 이후`;

  const avg = DATA.daily.length ? Math.round(totalCycles / DATA.daily.length) : 0;
  $('kpi-avg').textContent = fmt(avg);

  // ETA
  if (avg > 0 && totalCycles < target) {
    const remaining = target - totalCycles;
    const daysNeeded = Math.ceil(remaining / avg);
    const eta = new Date(lastDay.date);
    eta.setDate(eta.getDate() + daysNeeded);
    $('kpi-eta').textContent = `D-${daysNeeded}`;
    $('kpi-eta-sub').textContent = eta.toISOString().slice(0, 10) + ' 예상';
  } else if (totalCycles >= target) {
    $('kpi-eta').textContent = '달성';
    $('kpi-eta-sub').textContent = '목표 도달';
  }

  // Summary
  const summaryParts = [];
  summaryParts.push(`평가 시작 후 <strong>${DATA.daily.length}일</strong> 경과, 누적 <strong>${fmt(totalCycles)}회</strong> 진행 (${(pct*100).toFixed(1)}%).`);
  if (totalErrs === 0) summaryParts.push(`<span class="ok">에러 0건</span>으로 안정 운영 중.`);
  else if (totalErrs < errLimit) summaryParts.push(`에러 <strong>${totalErrs}건</strong> 발생, 한도(${errLimit}건) 내 여유 ${errLimit - totalErrs}건.`);
  else summaryParts.push(`<span class="warn">에러 한도 초과 — 즉시 검토 필요.</span>`);
  summaryParts.push(`최장 연속 <strong>${fmt(maxStreak)}회</strong> 기록.`);
  $('summary-text').innerHTML = summaryParts.join(' ');

  drawCumulativeChart();
  drawErrorChart();
  drawDailyChart();
  drawDailyTable();
  drawErrorTable();
}

/* ─── 차트: 누적 평가 추이 ────────────────── */
function drawCumulativeChart() {
  const svg = $('chart-cum');
  svg.innerHTML = '';
  const W = 1200, H = 280, PAD = { l: 60, r: 30, t: 20, b: 40 };
  const w = W - PAD.l - PAD.r;
  const h = H - PAD.t - PAD.b;

  const target = DATA.project.target;
  const maxY = Math.max(target * 1.1, ...DATA.daily.map(d => d.cumTotal)) || target;
  const n = DATA.daily.length;

  const xs = i => PAD.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const ys = v => PAD.t + h - (v / maxY) * h;

  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const y = PAD.t + (i / ticks) * h;
    const val = Math.round(maxY * (1 - i / ticks));
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#E8E4D8" stroke-width="1"/>`;
    svg.innerHTML += `<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${fmt(val)}</text>`;
  }

  const tgtY = ys(target);
  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${tgtY}" y2="${tgtY}" stroke="#8B2E1F" stroke-width="1.5" stroke-dasharray="6,4"/>`;
  svg.innerHTML += `<text x="${W - PAD.r}" y="${tgtY - 6}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="700" fill="#8B2E1F">TARGET ${fmt(target)}</text>`;

  if (n > 0) {
    let pathD = '';
    let areaD = `M ${xs(0)} ${PAD.t + h}`;
    DATA.daily.forEach((d, i) => {
      const x = xs(i), y = ys(d.cumTotal);
      pathD += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
      areaD += ` L ${x} ${y}`;
    });
    areaD += ` L ${xs(n - 1)} ${PAD.t + h} Z`;

    svg.innerHTML += `<path d="${areaD}" fill="#1A2942" fill-opacity="0.06"/>`;
    svg.innerHTML += `<path d="${pathD}" fill="none" stroke="#1A2942" stroke-width="2.5"/>`;

    DATA.daily.forEach((d, i) => {
      const x = xs(i), y = ys(d.cumTotal);
      svg.innerHTML += `<circle cx="${x}" cy="${y}" r="3" fill="#1A2942"/>`;
      if (d.errors > 0) {
        svg.innerHTML += `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#8B2E1F" stroke-width="1.5"/>`;
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

/* ─── 차트: 에러 추이 ────────────────────── */
function drawErrorChart() {
  const svg = $('chart-err');
  svg.innerHTML = '';
  const W = 1200, H = 180, PAD = { l: 60, r: 30, t: 20, b: 40 };
  const w = W - PAD.l - PAD.r, h = H - PAD.t - PAD.b;

  const limit = DATA.project.errorLimit;
  const maxY = Math.max(limit + 1, ...DATA.daily.map(d => d.cumErr));
  const n = DATA.daily.length;
  const xs = i => PAD.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const ys = v => PAD.t + h - (v / maxY) * h;

  for (let i = 0; i <= maxY; i++) {
    const y = ys(i);
    svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#E8E4D8" stroke-width="1"/>`;
    svg.innerHTML += `<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="600" fill="#7B8087">${i}</text>`;
  }

  const ly = ys(limit);
  svg.innerHTML += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${ly}" y2="${ly}" stroke="#8B2E1F" stroke-width="1.5" stroke-dasharray="6,4"/>`;
  svg.innerHTML += `<text x="${W - PAD.r}" y="${ly - 6}" text-anchor="end" font-family="'Malgun Gothic', '맑은 고딕', monospace" font-size="12" font-weight="700" fill="#8B2E1F">LIMIT ${limit}</text>`;

  if (n > 0) {
    let pathD = '';
    DATA.daily.forEach((d, i) => {
      const x = xs(i), y = ys(d.cumErr);
      if (i === 0) pathD += `M ${x} ${y}`;
      else {
        const py = ys(DATA.daily[i - 1].cumErr);
        pathD += ` L ${x} ${py} L ${x} ${y}`;
      }
    });
    svg.innerHTML += `<path d="${pathD}" fill="none" stroke="#8B2E1F" stroke-width="2.5"/>`;

    DATA.daily.forEach((d, i) => {
      if (d.errors > 0) {
        const x = xs(i), y = ys(d.cumErr);
        svg.innerHTML += `<circle cx="${x}" cy="${y}" r="4" fill="#8B2E1F"/>`;
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
      svg.innerHTML += `<rect x="${x}" y="${PAD.t + h - totalH}" width="${barW}" height="${successH}" fill="#1A2942"/>`;
    }
    if (errH > 0) {
      svg.innerHTML += `<rect x="${x}" y="${PAD.t + h - errH}" width="${barW}" height="${errH}" fill="#8B2E1F"/>`;
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
    const pct = ((d.cumTotal / target) * 100).toFixed(1);
    tr.innerHTML = `
      <td class="center">${d.date}</td>
      <td>${d.personnel}</td>
      <td>${d.activity}</td>
      <td class="num">${fmt(d.total)}</td>
      <td class="num ${d.errors > 0 ? 'err' : ''}">${d.errors}</td>
      <td class="num">${fmt(d.streak)}</td>
      <td class="num">${fmt(d.cumTotal)}</td>
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
