/* ============================================================
   PROJECT TINDIG — Deck Engine (main.js)
   Navigation, progress, entrance animations, counters,
   Matrix worker FX, and per-slide lifecycle orchestration.
   ============================================================ */

import { initViewers, activateViewer, deactivateViewers } from "./viewer.js";
import { initOrbitVerification } from "./mesh-anim.js";
import { renderBudget, renderGantt, renderSubsidence } from "./charts.js";
import { initMatrixRain } from "./matrix-rain.js";

document.body.classList.remove("no-js");

const slides = Array.from(document.querySelectorAll(".slide"));
const TOTAL = slides.length;
let current = 0;
let transitioning = false;

const progressFill = document.getElementById("progressFill");
const dotNav = document.getElementById("dotNav");
const navPrev = document.getElementById("navPrev");
const navNext = document.getElementById("navNext");
const counterCurrent = document.getElementById("counterCurrent");
const routeSweep = document.getElementById("routeSweep");
const routeLabel = document.getElementById("routeLabel");
let routeTimer = null;

const hasGSAP = () => typeof window.gsap !== "undefined";
const pad2 = (n) => String(n).padStart(2, "0");

/* ------------------------------------------------------------
   Dot navigation
   ------------------------------------------------------------ */
slides.forEach((slide, i) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", `Go to slide ${i + 1}: ${slide.dataset.title || ""}`);
  btn.dataset.title = slide.dataset.title || `FRAME ${pad2(i + 1)}`;
  btn.addEventListener("click", () => goTo(i));
  dotNav.appendChild(btn);
});
const dots = Array.from(dotNav.children);

/* ------------------------------------------------------------
   Cinematic routing flash
   ------------------------------------------------------------ */
function triggerRouteSweep(index) {
  if (!routeSweep || !routeLabel) return;
  routeLabel.textContent = `RE-ROUTING // SECTOR ${pad2(index + 1)} // ${slides[index].dataset.title || "FRAME"}`;
  document.body.classList.remove("is-jumping");
  void routeSweep.offsetWidth;
  document.body.classList.add("is-jumping");
  if (routeTimer) window.clearTimeout(routeTimer);
  routeTimer = window.setTimeout(() => document.body.classList.remove("is-jumping"), 620);
}

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
  prev.classList.remove("active");

  current = index;
  next.classList.add("active");
  triggerRouteSweep(index);

  // Chrome
  dots.forEach((d, i) => {
    const active = i === index;
    d.classList.toggle("active", active);
    if (active) d.setAttribute("aria-current", "step");
    else d.removeAttribute("aria-current");
  });
  progressFill.style.width = `${(index / (TOTAL - 1)) * 100}%`;
  if (counterCurrent) counterCurrent.textContent = pad2(index + 1);
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
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((el) => el.classList.add("no-anim"));
    return;
  }

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

/* Matrix rain lives in a dedicated worker (matrix-rain.js). */

/* ------------------------------------------------------------
   Terminal command deck — local slide search, no network calls
   ------------------------------------------------------------ */
const commandOverlay = document.getElementById("commandOverlay");
const commandInput = document.getElementById("commandInput");
const commandResults = document.getElementById("commandResults");
const commandOpen = document.getElementById("commandOpen");
let commandActive = 0;
let commandMatches = [];

function paintCommandResults(query = "") {
  if (!commandResults) return;
  const needle = query.trim().toLowerCase();
  commandMatches = slides
    .map((slide, index) => ({ slide, index, title: slide.dataset.title || `Slide ${index + 1}` }))
    .filter(({ title, index, slide }) => !needle || `${title} ${index + 1} ${pad2(index + 1)} ${slide.dataset.model || ""} ${slide.textContent}`.toLowerCase().includes(needle));
  commandActive = 0;
  commandResults.replaceChildren();

  if (!commandMatches.length) {
    const empty = document.createElement("p");
    empty.className = "command-empty";
    empty.textContent = "NO MATCH // Try a slide title, number, or layer name.";
    commandResults.appendChild(empty);
    return;
  }

  commandMatches.forEach(({ index, title }, resultIndex) => {
    const option = document.createElement("button");
    option.type = "button";
    option.id = `command-option-${index}`;
    option.className = "command-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", resultIndex === commandActive ? "true" : "false");
    option.innerHTML = `<span class="command-option-index">${pad2(index + 1)}</span><span class="command-option-title"></span><span class="command-option-action">JUMP ↗</span>`;
    option.querySelector(".command-option-title").textContent = title;
    option.addEventListener("mouseenter", () => setCommandActive(resultIndex));
    option.addEventListener("click", () => {
      goTo(index, { force: true });
      closeCommand();
    });
    commandResults.appendChild(option);
  });
  syncCommandActive();
}

function syncCommandActive() {
  const options = Array.from(commandResults?.querySelectorAll(".command-option") || []);
  options.forEach((option, index) => {
    option.classList.toggle("is-selected", index === commandActive);
    option.setAttribute("aria-selected", index === commandActive ? "true" : "false");
  });
  if (options[commandActive]) {
    commandInput?.setAttribute("aria-activedescendant", options[commandActive].id);
    options[commandActive].scrollIntoView({ block: "nearest" });
  } else {
    commandInput?.removeAttribute("aria-activedescendant");
  }
}

function openCommand() {
  if (!commandOverlay) return;
  commandOverlay.hidden = false;
  commandOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("command-open");
  if (commandInput) {
    commandInput.value = "";
    paintCommandResults();
    window.requestAnimationFrame(() => commandInput.focus());
  }
}

function closeCommand() {
  if (!commandOverlay || commandOverlay.hidden) return;
  commandOverlay.hidden = true;
  commandOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("command-open");
  commandOpen?.focus();
}

commandOpen?.addEventListener("click", openCommand);
commandOverlay?.querySelectorAll("[data-command-close]").forEach((el) => el.addEventListener("click", closeCommand));
commandInput?.addEventListener("input", () => paintCommandResults(commandInput.value));
commandInput?.addEventListener("keydown", (e) => {
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !commandMatches.length) {
    e.preventDefault();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    commandActive = Math.min(commandActive + 1, commandMatches.length - 1);
    syncCommandActive();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    commandActive = Math.max(commandActive - 1, 0);
    syncCommandActive();
  } else if (e.key === "Enter" && commandMatches[commandActive]) {
    e.preventDefault();
    goTo(commandMatches[commandActive].index, { force: true });
    closeCommand();
  }
});
commandOverlay?.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusable = Array.from(commandOverlay.querySelectorAll("input:not([disabled]), button:not([disabled])"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
});

/* ------------------------------------------------------------
   Input handling: keys, arrows, wheel, touch swipe
   ------------------------------------------------------------ */
document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (e.key === "Escape" && commandOverlay && !commandOverlay.hidden) {
    closeCommand();
    return;
  }
  if (!commandOverlay?.hidden) return;
  if (e.key === "/" && tag !== "input" && tag !== "textarea") {
    e.preventDefault();
    openCommand();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openCommand();
    return;
  }
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
  if (commandOverlay && !commandOverlay.hidden) return;
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
  if (commandOverlay && !commandOverlay.hidden) { touching = false; return; }
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
  scheduleScrollCheck(slides[current]);
});

// Layer cards: tap toggles the one-liner (touch devices have no hover)
document.querySelectorAll(".layer-card").forEach((card) => {
  card.addEventListener("click", () => card.classList.toggle("reveal"));
});

/* ------------------------------------------------------------
   Boot — cinematic intro, clock, worker FX, controls
   ------------------------------------------------------------ */
const orbitAnim = initOrbitVerification(document.getElementById("orbitCanvas"));
initViewers();

const matrixRain = initMatrixRain(document.getElementById("matrixRain"), document.getElementById("renderStatus"));
const fxToggle = document.getElementById("fxToggle");
const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let motionPaused = Boolean(motionQuery?.matches);
function updateFxButton() {
  if (!fxToggle) return;
  fxToggle.setAttribute("aria-pressed", String(motionPaused));
  fxToggle.setAttribute("aria-label", motionPaused ? "Resume Matrix rain animation" : "Pause Matrix rain animation");
  const glyph = fxToggle.querySelector("span");
  if (glyph) glyph.textContent = motionPaused ? "▶" : "Ⅱ";
}
updateFxButton();
fxToggle?.addEventListener("click", () => {
  motionPaused = !motionPaused;
  matrixRain.setPaused(motionPaused);
  updateFxButton();
});
motionQuery?.addEventListener?.("change", (event) => {
  motionPaused = event.matches;
  matrixRain.setPaused(motionPaused);
  updateFxButton();
});

const systemClock = document.getElementById("systemClock");
function updateClock() {
  if (!systemClock) return;
  try {
    const time = new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date());
    systemClock.textContent = `CEBU // ${time}`;
  } catch {
    systemClock.textContent = "CEBU // LOCAL TIME";
  }
}
updateClock();
window.setInterval(updateClock, 1000);

const terminalMessage = document.getElementById("terminalMessage");
const terminalLines = [
  "mapping subsurface signal",
  "loading proposed sensor mesh",
  "routing data / orbit → barangay",
  "rendering concept blueprint",
];
let terminalLine = 0;
if (terminalMessage) {
  window.setInterval(() => {
    terminalLine = (terminalLine + 1) % terminalLines.length;
    terminalMessage.textContent = terminalLines[terminalLine];
  }, 2800);
}

const bootScreen = document.getElementById("bootScreen");
const skipBoot = document.getElementById("skipBoot");
let bootDismissTimer = 0;
function dismissBoot() {
  if (!bootScreen || bootScreen.hidden) return;
  if (bootDismissTimer) window.clearTimeout(bootDismissTimer);
  bootScreen.classList.add("is-exiting");
  bootScreen.setAttribute("aria-hidden", "true");
  window.setTimeout(() => { bootScreen.hidden = true; }, 620);
}
skipBoot?.addEventListener("click", dismissBoot);
window.setTimeout(dismissBoot, motionPaused ? 450 : 1850);

document.getElementById("beginBtn")?.addEventListener("click", () => {
  dismissBoot();
  goTo(1);
});

// Graceful no-JS-animation fallback: make the first frame active even if GSAP is unavailable.
slides[0]?.classList.add("active");
goTo(0, { force: true });
