/* ============================================================
   PROJECT TINDIG — Deck Engine (main.js)
   Navigation, progress, entrance animations, counters,
   hero particle field, and per-slide lifecycle orchestration.
   ============================================================ */

import { initViewers, activateViewer, deactivateViewers } from "./viewer.js";
import { initOrbitVerification } from "./mesh-anim.js";
import { renderBudget, renderGantt, renderSubsidence } from "./charts.js";

const slides = Array.from(document.querySelectorAll(".slide"));
const TOTAL = slides.length;
let current = 0;
let transitioning = false;

const progressFill = document.getElementById("progressFill");
const slideCounter = document.getElementById("slideCounter");
const dotNav = document.getElementById("dotNav");
const navPrev = document.getElementById("navPrev");
const navNext = document.getElementById("navNext");

const hasGSAP = () => typeof window.gsap !== "undefined";
const pad2 = (n) => String(n).padStart(2, "0");

/* ------------------------------------------------------------
   Dot navigation
   ------------------------------------------------------------ */
slides.forEach((slide, i) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", `Go to slide ${i + 1}: ${slide.dataset.title || ""}`);
  btn.addEventListener("click", () => goTo(i));
  dotNav.appendChild(btn);
});
const dots = Array.from(dotNav.children);

/* ------------------------------------------------------------
   Core navigation
   ------------------------------------------------------------ */
function goTo(index, opts = {}) {
  if (index < 0 || index >= TOTAL) return;
  if (index === current && !opts.force) return;
  if (transitioning && !opts.force) return;
  transitioning = true;

  const prev = slides[current];
  const next = slides[index];

  // Lifecycle: leave
  deactivateViewers(prev);
  orbitAnim.setActive(index === 8);
  heroParticles.setActive(index === 0);
  prev.classList.remove("active");

  current = index;
  next.classList.add("active");

  // Chrome
  dots.forEach((d, i) => d.classList.toggle("active", i === index));
  progressFill.style.width = `${(index / (TOTAL - 1)) * 100}%`;
  slideCounter.textContent = `${pad2(index + 1)} / ${TOTAL}`;
  navPrev.disabled = index === 0;
  navNext.disabled = index === TOTAL - 1;

  // Lifecycle: enter
  runEntranceAnimations(next);
  scheduleScrollCheck(next);
  if (next.dataset.model) activateViewer(next);
  if (next.querySelector(".counter-value")) runCounters(next);
  if (index === 1) renderSubsidence(document.getElementById("subChart"));
  if (index === 10) renderBudget(document.getElementById("budgetChart"));
  if (index === 11) renderGantt(document.getElementById("ganttChart"));

  window.setTimeout(() => { transitioning = false; }, 560);
}

/* Enable inner scrolling only when content genuinely overflows
   (checked after entrance animations settle, so transient 18px
   translate offsets never flash a phantom scrollbar). */
let scrollCheckTimer = null;
function scheduleScrollCheck(slide) {
  if (scrollCheckTimer) clearTimeout(scrollCheckTimer);
  scrollCheckTimer = window.setTimeout(() => {
    document.querySelectorAll(".slide-inner.can-scroll").forEach((el) => {
      if (el.scrollHeight <= el.clientHeight + 24) el.classList.remove("can-scroll");
    });
    const inner = slide.querySelector(".slide-inner");
    if (inner && inner.scrollHeight > inner.clientHeight + 24) {
      inner.classList.add("can-scroll");
    }
  }, 1700);
}

const nextSlide = () => goTo(current + 1);
const prevSlide = () => goTo(current - 1);

/* ------------------------------------------------------------
   Entrance micro-animations (staggered); GSAP if available
   ------------------------------------------------------------ */
function runEntranceAnimations(slide) {
  const items = Array.from(slide.querySelectorAll(".anim-in"));
  items.forEach((el) => el.classList.remove("in", "no-anim"));
  // Force reflow so transitions replay on re-entry
  void slide.offsetWidth;

  if (hasGSAP()) {
    items.forEach((el, i) => {
      window.gsap.fromTo(
        el,
        { opacity: 0, y: 18 },
        {
          opacity: 1, y: 0, duration: 0.65, delay: 0.12 + i * 0.07,
          ease: "power3.out", overwrite: true,
          onStart: () => el.classList.add("no-anim"),
        }
      );
    });
  } else {
    items.forEach((el, i) => {
      window.setTimeout(() => el.classList.add("in"), 100 + i * 70);
    });
  }
}

/* ------------------------------------------------------------
   Animated counters (Slide 1)
   ------------------------------------------------------------ */
function formatCounter(value, format) {
  switch (format) {
    case "peso-b":
      return `\u20B1${value.toFixed(2)}B`;
    case "peso-int":
      return `\u20B1${Math.round(value).toLocaleString("en-US")}`;
    case "rank":
      return `#${Math.round(value)}`;
    case "tilde":
      return `~${Math.round(value).toLocaleString("en-US")}`;
    case "mult":
      return `~${Math.round(value)}\u00D7`;
    case "negdec1":
      return `\u2212${value.toFixed(1)}`;
    case "dec1":
      return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case "pct":
      return `${Math.round(value)}%`;
    default:
      return Math.round(value).toLocaleString("en-US");
  }
}

function runCounters(slide) {
  slide.querySelectorAll(".counter-value").forEach((el) => {
    const target = parseFloat(el.dataset.count);
    const format = el.dataset.format || "int";
    const duration = 1600;
    const start = performance.now();

    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatCounter(target * eased, format);
      if (t < 1 && slides[current] === slide) {
        requestAnimationFrame(step);
      } else if (t >= 1) {
        el.textContent = formatCounter(target, format);
      }
    }
    requestAnimationFrame(step);
  });
}

/* ------------------------------------------------------------
   Hero particle network (cheap 2D canvas, only on slide 0)
   ------------------------------------------------------------ */
const heroParticles = (() => {
  const canvas = document.getElementById("heroParticles");
  const ctx = canvas.getContext("2d");
  let particles = [];
  let rafId = null;
  let active = false;
  let W = 0, H = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    const count = Math.min(90, Math.floor((W * H) / 16000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 0.6,
    }));
  }

  function frame() {
    if (!active) return;
    ctx.clearRect(0, 0, W, H);
    const LINK = 130;

    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK * LINK) {
          const alpha = (1 - Math.sqrt(d2) / LINK) * 0.22;
          ctx.strokeStyle = `rgba(45, 212, 191, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    for (const p of particles) {
      ctx.fillStyle = "rgba(45, 212, 191, 0.55)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    rafId = requestAnimationFrame(frame);
  }

  return {
    setActive(isActive) {
      if (isActive && !active) {
        active = true;
        if (!W) resize();
        rafId = requestAnimationFrame(frame);
      } else if (!isActive && active) {
        active = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
    resize,
  };
})();

/* ------------------------------------------------------------
   Input handling: keys, arrows, wheel, touch swipe
   ------------------------------------------------------------ */
document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "button") return;
  if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
    e.preventDefault(); nextSlide();
  } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
    e.preventDefault(); prevSlide();
  } else if (e.key === "Home") { goTo(0); }
  else if (e.key === "End") { goTo(TOTAL - 1); }
});

navNext.addEventListener("click", nextSlide);
navPrev.addEventListener("click", prevSlide);

// Wheel / trackpad (debounced, ignores scrollable inner content)
let wheelLock = false;
document.addEventListener("wheel", (e) => {
  const inner = e.target.closest(".slide-inner");
  if (inner && inner.scrollHeight > inner.clientHeight + 4) {
    const atTop = inner.scrollTop <= 0;
    const atBottom = inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 2;
    if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) return; // let it scroll
  }
  if (wheelLock || Math.abs(e.deltaY) < 24) return;
  wheelLock = true;
  window.setTimeout(() => { wheelLock = false; }, 700);
  if (e.deltaY > 0) nextSlide(); else prevSlide();
}, { passive: true });

// Touch swipe
let touchStartX = 0, touchStartY = 0, touching = false;
document.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return;
  touching = true;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!touching) return;
  touching = false;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  // Don't hijack drags inside the 3D viewer
  if (e.target.closest(".viewer-mount")) return;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) nextSlide(); else prevSlide();
  } else if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) {
    if (dy < 0) nextSlide(); else prevSlide();
  }
}, { passive: true });

window.addEventListener("resize", () => {
  heroParticles.resize();
  scheduleScrollCheck(slides[current]);
});

// Layer cards: tap toggles the one-liner (touch devices have no hover)
document.querySelectorAll(".layer-card").forEach((card) => {
  card.addEventListener("click", () => card.classList.toggle("reveal"));
});

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
const orbitAnim = initOrbitVerification(document.getElementById("orbitCanvas"));
initViewers();

// Graceful no-JS-anim fallback: ensure first slide content visible even if GSAP late
slides[0].classList.add("active");
goTo(0, { force: true });
heroParticles.setActive(true);
heroParticles.resize();
