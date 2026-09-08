/* ============================================================
   PROJECT TINDIG — Verification from Orbit (mesh-anim.js)
   2D canvas loop: a Sentinel-1-style satellite passes over the
   pilot site, pings the ground, and an independent KPI gauge
   fills past the ≥25% target with a verified checkmark.
   Same lifecycle contract as the reference: init(canvas) →
   { setActive(bool) }; rAF runs only while the slide is active.
   ============================================================ */

const TEAL = "#2dd4bf";
const BLUE = "#38bdf8";
const AMBER = "#f59e0b";
const INK = "#e7f2f0";
const INK_DIM = "#9db8b3";
const INK_FAINT = "#647d78";
const GLASS = "rgba(20, 32, 35, 0.72)";

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initOrbitVerification(canvas) {
  if (!canvas) return { setActive() {} };
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, rafId = null, active = false;
  let stars = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || 600;
    H = canvas.clientHeight || 380;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rand = mulberry32(2026);
    stars = Array.from({ length: 90 }, () => ({
      x: rand() * W, y: rand() * H * 0.72, r: rand() * 1.3 + 0.3, tw: rand() * Math.PI * 2,
    }));
  }

  const CYCLE = 12; // seconds per verification loop

  function drawSatellite(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.12);
    // solar wings
    ctx.fillStyle = "#1e3a5f";
    ctx.strokeStyle = "rgba(56,189,248,0.7)";
    ctx.lineWidth = 1;
    ctx.fillRect(-3.4 * s, -0.7 * s, 2.2 * s, 1.4 * s);
    ctx.fillRect(1.2 * s, -0.7 * s, 2.2 * s, 1.4 * s);
    ctx.strokeRect(-3.4 * s, -0.7 * s, 2.2 * s, 1.4 * s);
    ctx.strokeRect(1.2 * s, -0.7 * s, 2.2 * s, 1.4 * s);
    // bus
    ctx.fillStyle = "#d4af37";
    ctx.fillRect(-1.1 * s, -0.9 * s, 2.2 * s, 1.8 * s);
    // SAR panel
    ctx.fillStyle = "#9fb4bd";
    ctx.fillRect(-0.9 * s, 0.9 * s, 1.8 * s, 0.45 * s);
    ctx.restore();
  }

  function frame(now) {
    if (!active) { rafId = null; return; }
    rafId = requestAnimationFrame(frame);
    const t = now / 1000;
    const ph = (t % CYCLE) / CYCLE; // 0..1 loop phase

    ctx.clearRect(0, 0, W, H);

    // stars
    for (const st of stars) {
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 1.7 + st.tw);
      ctx.fillStyle = "#bfe8e0";
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const gy = H * 0.82;               // ground line
    const siteX = W * 0.34;            // pilot site position

    // ground band
    const grad = ctx.createLinearGradient(0, gy - 6, 0, H);
    grad.addColorStop(0, "rgba(45,212,191,0.10)");
    grad.addColorStop(1, "rgba(11,19,21,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, gy - 6, W, H - gy + 6);
    ctx.strokeStyle = "rgba(45,212,191,0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();

    // tiny diorama on the ground: ponds, a house, a well
    ctx.fillStyle = "rgba(29,95,138,0.8)";
    ctx.fillRect(siteX - 120, gy - 5, 46, 5);
    ctx.fillRect(siteX + 66, gy - 5, 38, 5);
    ctx.fillStyle = "#d8cfc0";
    ctx.fillRect(siteX - 40, gy - 15, 22, 15);
    ctx.fillStyle = "#b3541e";
    ctx.beginPath();
    ctx.moveTo(siteX - 44, gy - 15);
    ctx.lineTo(siteX - 29, gy - 26);
    ctx.lineTo(siteX - 14, gy - 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#b8bec4";
    ctx.fillRect(siteX + 30, gy - 12, 4, 12);
    ctx.fillStyle = INK_FAINT;
    ctx.font = "10.5px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Hagonoy pilot site — GNSS + 6 wells", siteX, gy + 18);

    // site marker pulse
    const pulse = (t * 0.8) % 1;
    ctx.strokeStyle = `rgba(45,212,191,${0.7 * (1 - pulse)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(siteX, gy, 6 + pulse * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = TEAL;
    ctx.beginPath();
    ctx.arc(siteX, gy, 4, 0, Math.PI * 2);
    ctx.fill();

    // satellite path across the sky
    const satX = W * (-0.08 + 1.16 * ph);
    const satY = H * 0.2 + Math.sin(ph * Math.PI) * -H * 0.06;
    drawSatellite(satX, satY, 7);
    ctx.fillStyle = INK_DIM;
    ctx.font = "10.5px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sentinel-1 · 6-day revisit", Math.min(Math.max(satX, 70), W - 70), satY - 22);

    // radar pings while the satellite is overhead (phase 0.28–0.5)
    if (ph > 0.24 && ph < 0.52) {
      const beamA = 0.35 + 0.2 * Math.sin(t * 6);
      ctx.strokeStyle = `rgba(45,212,191,${beamA})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(satX, satY + 10);
      ctx.lineTo(siteX, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      // expanding interferometric rings on the ground
      for (let i = 0; i < 3; i++) {
        const rp = ((t * 1.4 + i / 3) % 1);
        ctx.strokeStyle = `rgba(245,158,11,${0.55 * (1 - rp)})`;
        ctx.beginPath();
        ctx.arc(siteX, gy, 5 + rp * 42, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // data packet traveling site → KPI panel after each pass
    const panelX = W * 0.58, panelY = H * 0.18, panelW = W * 0.38, panelH = Math.min(225, H * 0.56);
    if (ph > 0.5 && ph < 0.66) {
      const dp = (ph - 0.5) / 0.16;
      const px = siteX + (panelX + 20 - siteX) * dp;
      const py = gy + (panelY + 30 - gy) * dp - Math.sin(dp * Math.PI) * 60;
      ctx.fillStyle = TEAL;
      ctx.shadowColor = TEAL;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(45,212,191,0.25)";
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(siteX, gy);
      ctx.quadraticCurveTo((siteX + panelX) / 2, Math.min(gy, panelY) - 90, panelX + 20, panelY + 30);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // KPI panel
    const verified = ph > 0.66;
    const gauge = verified ? Math.min((ph - 0.66) / 0.18, 1) : 0;
    ctx.fillStyle = GLASS;
    ctx.strokeStyle = verified ? "rgba(45,212,191,0.85)" : "rgba(45,212,191,0.25)";
    ctx.lineWidth = verified ? 2 : 1;
    const r = 12;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, r);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = TEAL;
    ctx.font = "600 12px 'Space Grotesk', sans-serif";
    ctx.fillText("ORBIT-VERIFIED KPI", panelX + 16, panelY + 26);
    ctx.fillStyle = INK;
    ctx.font = "700 30px 'Space Grotesk', sans-serif";
    ctx.fillText("≥25%", panelX + 16, panelY + 66);
    ctx.fillStyle = INK_DIM;
    ctx.font = "11.5px Inter, sans-serif";
    ctx.fillText("reduction in subsidence velocity", panelX + 16, panelY + 86);
    ctx.fillText("by Month 30 vs M1–6 baseline", panelX + 16, panelY + 102);

    // gauge bar: fills to 31% (past the 25% marker)
    const gY = panelY + 122, gW = panelW - 32;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(panelX + 16, gY, gW, 12);
    const fill = 0.31 * (1 - Math.pow(1 - gauge, 3));
    ctx.fillStyle = fill >= 0.25 ? TEAL : AMBER;
    ctx.fillRect(panelX + 16, gY, gW * fill / 0.4, 12);
    // 25% target tick
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(panelX + 16 + gW * (0.25 / 0.4), gY - 3);
    ctx.lineTo(panelX + 16 + gW * (0.25 / 0.4), gY + 15);
    ctx.stroke();
    ctx.fillStyle = INK_FAINT;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("target 25%", panelX + 16 + gW * (0.25 / 0.4), gY + 28);
    ctx.textAlign = "left";
    ctx.fillStyle = INK_DIM;
    ctx.font = "10.5px Inter, sans-serif";
    ctx.fillText("measured by Sentinel-1 (ESA) — a satellite", panelX + 16, gY + 44);
    ctx.fillText("the proponent does not control", panelX + 16, gY + 58);
    ctx.fillText("+ UP academic peer review", panelX + 16, gY + 72);
    ctx.fillText("+ NAMRIA PageNET GNSS", panelX + 16, gY + 86);

    // verified checkmark pops in
    if (verified) {
      const pop = Math.min((ph - 0.66) / 0.1, 1);
      const back = 1 + 0.4 * Math.sin(Math.min(pop, 1) * Math.PI);
      const cx = panelX + panelW - 34, cy = panelY + 30;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(back, back);
      ctx.globalAlpha = Math.min(pop * 1.6, 1);
      ctx.fillStyle = "rgba(45,212,191,0.18)";
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = TEAL;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6.5, 0.5);
      ctx.lineTo(-1.5, 6);
      ctx.lineTo(8, -5.5);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas.parentElement || canvas);
  window.addEventListener("resize", resize);
  resize();

  return {
    setActive(isActive) {
      if (isActive && !active) {
        active = true;
        resize();
        if (!rafId) rafId = requestAnimationFrame(frame);
      } else if (!isActive && active) {
        active = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
