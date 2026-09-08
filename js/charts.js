/* ============================================================
   PROJECT TINDIG — Charts (charts.js)
   No chart library: hand-rolled canvas subsidence curve,
   animated budget bars, and a 30-month CSS-grid Gantt.
   All figures from the TINDIG proposal document.
   ============================================================ */

const TEAL = "#2dd4bf";
const BLUE = "#38bdf8";
const AMBER = "#f59e0b";
const RED = "#ef4444";
const INK = "#e7f2f0";
const INK_DIM = "#9db8b3";
const INK_FAINT = "#647d78";

/* ------------------------------------------------------------
   Subsidence curve — Bulacan ground level, 2014–2030
   Cumulative cm relative to 2014 datum; measured segment to
   2020 (peak −109 mm/yr), then two trajectories: unmanaged
   (red dashed) vs TINDIG target ≥25% slower (teal).
   ------------------------------------------------------------ */
const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];
// cumulative cm (stylized from the published 2014–2020 rates)
const MEASURED = [0, -4, -9, -15, -22, -31, -42, -53, -64];
const FLOODS = [
  { year: 2018, label: "severe monsoon floods" },
  { year: 2021, label: "flood season" },
  { year: 2024, label: "flood season" },
];

export function renderSubsidence(container) {
  if (!container) return;
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "subchart-canvas";
  container.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = container.clientWidth || 600;
  const H = container.clientHeight || 300;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padL = 46, padR = 18, padT = 30, padB = 34;
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
  const minY = -160, maxY = 10;
  const X = (yr) => x0 + ((yr - 2014) / (2030 - 2014)) * (x1 - x0);
  const Y = (cm) => y0 + (1 - (cm - minY) / (maxY - minY)) * (y1 - y0);

  // Trajectories after 2020 (last measured point anchors both)
  const anchor = { yr: 2022, cm: -64 };
  const unmanaged = YEARS.filter((y) => y >= 2022).map((yr) => ({ yr, cm: anchor.cm - (yr - 2022) * 10.9 }));
  const tindig = YEARS.filter((y) => y >= 2022).map((yr, i) => {
    // business-as-usual until 2026, then the program bends the curve ≥25%
    const pre = Math.min(yr, 2026);
    let cm = anchor.cm - (pre - 2022) * 10.9;
    if (yr > 2026) cm -= (yr - 2026) * 10.9 * 0.72;
    return { yr, cm };
  });

  let raf = null;
  const t0 = performance.now();
  const DUR = 1400;

  function frame(now) {
    const p = Math.min((now - t0) / DUR, 1);
    const e = 1 - Math.pow(1 - p, 3);
    ctx.clearRect(0, 0, W, H);

    // grid + axes
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = INK_FAINT;
    ctx.font = "10.5px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.lineWidth = 1;
    for (let cm = 0; cm >= -150; cm -= 30) {
      ctx.beginPath();
      ctx.moveTo(x0, Y(cm)); ctx.lineTo(x1, Y(cm));
      ctx.stroke();
      ctx.fillText(cm + "", x0 - 8, Y(cm) + 3.5);
    }
    ctx.textAlign = "center";
    for (let yr = 2014; yr <= 2030; yr += 4) {
      ctx.fillText(yr + "", X(yr), y1 + 16);
    }
    ctx.save();
    ctx.translate(13, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText("cumulative ground loss (cm)", 0, 0);
    ctx.restore();

    // "today" divider
    ctx.strokeStyle = "rgba(231,242,240,0.25)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(X(2026), y0); ctx.lineTo(X(2026), y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = INK_DIM;
    ctx.textAlign = "center";
    ctx.fillText("today", X(2026), y0 - 6);

    const clipX = x0 + (x1 - x0) * e;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, clipX, H);
    ctx.clip();

    // measured curve (solid ink)
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    MEASURED.forEach((cm, i) => {
      const yr = YEARS[i];
      i === 0 ? ctx.moveTo(X(yr), Y(cm)) : ctx.lineTo(X(yr), Y(cm));
    });
    ctx.stroke();

    // unmanaged trajectory (red dashed)
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    unmanaged.forEach((pt, i) => {
      i === 0 ? ctx.moveTo(X(pt.yr), Y(pt.cm)) : ctx.lineTo(X(pt.yr), Y(pt.cm));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // TINDIG trajectory (teal, glow)
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    tindig.forEach((pt, i) => {
      i === 0 ? ctx.moveTo(X(pt.yr), Y(pt.cm)) : ctx.lineTo(X(pt.yr), Y(pt.cm));
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    // flood event markers (only once the sweep passes them)
    ctx.textAlign = "center";
    for (const f of FLOODS) {
      if (X(f.year) > clipX) continue;
      const i = YEARS.indexOf(f.year);
      const cy = Y(MEASURED[i]);
      ctx.fillStyle = AMBER;
      ctx.beginPath();
      ctx.moveTo(X(f.year), cy - 16);
      ctx.lineTo(X(f.year) - 6, cy - 6);
      ctx.lineTo(X(f.year) + 6, cy - 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(245,158,11,0.85)";
      ctx.font = "9.5px Inter, sans-serif";
      ctx.fillText(f.label, X(f.year), cy - 22);
      ctx.font = "10.5px Inter, sans-serif";
    }

    // annotations (fade in at the end)
    if (p > 0.75) {
      const a = (p - 0.75) / 0.25;
      ctx.globalAlpha = a;
      ctx.textAlign = "left";
      ctx.font = "600 11px 'Space Grotesk', sans-serif";
      ctx.fillStyle = RED;
      ctx.fillText("unmanaged: ~−109 mm/yr", X(2027.2), Y(-152) + 4);
      ctx.fillStyle = TEAL;
      ctx.fillText("TINDIG target: ≥25% slower by Month 30", X(2026.6), Y(-104) + 4);
      ctx.fillStyle = INK_DIM;
      ctx.font = "10.5px Inter, sans-serif";
      ctx.fillText("measured −42 cm by 2020 (InSAR)", X(2014.6), Y(-52));
      ctx.globalAlpha = 1;
    }

    if (p < 1) raf = requestAnimationFrame(frame);
  }
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

/* ------------------------------------------------------------
   Budget — ₱24,150,000 total (Section 7)
   ------------------------------------------------------------ */
const BUDGET = [
  { code: "CAP", name: "Capital equipment & civil works", amount: 11000000, cls: "", pct: "45.6%" },
  { code: "LAB", name: "Labor (science, engineering, field)", amount: 7600000, cls: "is-labor", pct: "31.5%" },
  { code: "OPX", name: "Operations & maintenance (30 mo)", amount: 1200000, cls: "is-program", pct: "5.0%" },
  { code: "IEC", name: "Training & community IEC", amount: 800000, cls: "is-program", pct: "3.3%" },
  { code: "M&E", name: "Monitoring & evaluation", amount: 400000, cls: "is-program", pct: "1.7%" },
  { code: "ADM", name: "Administration & compliance", amount: 1050000, cls: "is-program", pct: "4.3%" },
  { code: "CTG", name: "Contingency", amount: 2100000, cls: "is-contingency", pct: "8.7%" },
];
const LAYERS = [
  { code: "L1", name: "BANTAY-LUPA — space layer", amount: 2750000 },
  { code: "L2", name: "BANTAY-TUBIG — ground layer", amount: 2850000 },
  { code: "L4", name: "SIBOL — action layer", amount: 5400000 },
];
const BUDGET_MAX = Math.max(...BUDGET.map((b) => b.amount));
const peso = (n) => "\u20B1" + n.toLocaleString("en-US");

function barRow(code, name, amount, pct, cls, delayBase, i) {
  const row = document.createElement("div");
  row.className = `bar-row ${cls}`.trim();
  const c = document.createElement("div");
  c.className = "bar-code";
  c.textContent = code;
  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  fill.className = "bar-fill";
  const label = document.createElement("div");
  label.className = "bar-name";
  label.textContent = name;
  track.appendChild(fill);
  track.appendChild(label);
  const value = document.createElement("div");
  value.className = "bar-value";
  value.textContent = peso(amount) + (pct ? ` · ${pct}` : "");
  row.appendChild(c);
  row.appendChild(track);
  row.appendChild(value);
  fill.style.transitionDelay = `${delayBase + i * 70}ms`;
  return { row, fill, width: (amount / BUDGET_MAX) * 100 };
}

export function renderBudget(container) {
  if (!container) return;
  container.innerHTML = "";
  const rows = [];
  BUDGET.forEach((b, i) => {
    const r = barRow(b.code, b.name, b.amount, b.pct, b.cls, 0, i);
    container.appendChild(r.row);
    rows.push(r);
  });
  const sub = document.createElement("div");
  sub.className = "bar-subhead";
  sub.textContent = "Of which, by layer (UTAK-TUBIG rides on the Labor line — 100% open-source software)";
  container.appendChild(sub);
  LAYERS.forEach((b, i) => {
    const r = barRow(b.code, b.name, b.amount, "", "is-layer", BUDGET.length * 70, i);
    container.appendChild(r.row);
    rows.push(r);
  });
  requestAnimationFrame(() => {
    rows.forEach(({ fill, width }) => { fill.style.width = `${width}%`; });
  });
}

/* ------------------------------------------------------------
   Gantt — 30 months (M1–M30), 4 phases + milestones
   ------------------------------------------------------------ */
const GANTT = [
  { act: "Mobilization & MOAs (LGU, NWRB, academe)", from: 1, to: 3, phase: 1 },
  { act: "Baseline InSAR stack + drone LiDAR survey", from: 1, to: 6, phase: 1 },
  { act: "Monitoring wells + GNSS reference stations", from: 4, to: 9, phase: 2 },
  { act: "IoT deployment (~40 nodes, 4 gateways)", from: 7, to: 12, phase: 2 },
  { act: "UTAK-TUBIG: MODFLOW + ML engine build", from: 7, to: 18, phase: 2 },
  { act: "Recharge construction (wells + basin)", from: 13, to: 24, phase: 3 },
  { act: "Rainwater harvesting retrofits (8 sites)", from: 13, to: 18, phase: 3 },
  { act: "Water banking & governance (Community Water Banking)", from: 10, to: 27, phase: 3 },
  { act: "Training & IEC (12 Bantay Balon techs)", from: 4, to: 30, phase: 4 },
  { act: "M&E — quarterly InSAR verification bulletins", from: 1, to: 30, phase: 4 },
  { act: "Handover & TINDIG Playbook", from: 25, to: 30, phase: 4 },
];
const MILESTONES = [
  { m: 18, label: "Budget v1" },
  { m: 24, label: "First recharge + ordinance" },
  { m: 30, label: "Impact report" },
];

export function renderGantt(container) {
  if (!container) return;
  container.innerHTML = "";
  container.classList.remove("revealed");

  const grid = document.createElement("div");
  grid.className = "gantt-grid gantt-grid-30";

  // Header: quarter row + month row
  const corner = document.createElement("div");
  corner.className = "gantt-head gantt-corner";
  corner.textContent = "Workstream \\ Month";
  grid.appendChild(corner);
  for (let q = 1; q <= 10; q++) {
    const h = document.createElement("div");
    h.className = "gantt-head gantt-quarter";
    h.textContent = `Q${q}`;
    grid.appendChild(h);
  }
  for (let m = 1; m <= 30; m++) {
    const mm = document.createElement("div");
    mm.className = "gantt-head gantt-month";
    mm.textContent = `M${m}`;
    grid.appendChild(mm);
  }

  // Activity rows
  let cellIndex = 0;
  for (const row of GANTT) {
    const label = document.createElement("div");
    label.className = "gantt-act";
    label.textContent = row.act;
    grid.appendChild(label);
    for (let m = 1; m <= 30; m++) {
      const cell = document.createElement("div");
      const on = m >= row.from && m <= row.to;
      cell.className = on ? `gantt-cell on phase-${row.phase}` : "gantt-cell";
      if (on) cell.style.transitionDelay = `${cellIndex++ * 14}ms`;
      grid.appendChild(cell);
    }
  }

  // Milestone row
  const mLabel = document.createElement("div");
  mLabel.className = "gantt-act gantt-ms-label";
  mLabel.textContent = "Milestones";
  grid.appendChild(mLabel);
  for (let m = 1; m <= 30; m++) {
    const cell = document.createElement("div");
    cell.className = "gantt-cell";
    const ms = MILESTONES.find((x) => x.m === m);
    if (ms) {
      const d = document.createElement("div");
      d.className = "gantt-ms";
      d.title = ms.label;
      cell.appendChild(d);
    }
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  const legend = document.createElement("div");
  legend.className = "gantt-legend";
  legend.innerHTML =
    `<span><i class="legend-swatch"></i>Phase 1 · Baseline (M1–M6)</span>` +
    `<span><i class="legend-swatch p2"></i>Phase 2 · Instrument & Model (M4–M18)</span>` +
    `<span><i class="legend-swatch p3"></i>Phase 3 · Treat & Govern (M10–M27)</span>` +
    `<span><i class="legend-swatch p4"></i>Phase 4 · Verify & Hand over (M1–M30)</span>` +
    `<span class="gantt-peak-note"><i class="legend-swatch peak"></i>◆ M18 Budget v1 · M24 First recharge + ordinance · M30 Impact report</span>`;
  container.appendChild(legend);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => container.classList.add("revealed"));
  });
}
