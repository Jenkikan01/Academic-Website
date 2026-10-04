/*
 * TINDIG Matrix renderer — dedicated Worker + OffscreenCanvas.
 * The animated data-rain is intentionally decorative; project data is not live.
 */

const GLYPHS = "アカサタナハマヤラワ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:;+=<>/{}[]";
const TRAIL = 9;
const TARGET_FPS = 30;

let canvas = null;
let ctx = null;
let width = 0;
let height = 0;
let dpr = 1;
let fontSize = 16;
let columns = [];
let running = false;
let paused = false;
let timer = null;
let lastFrame = 0;

const rand = (min, max) => Math.random() * (max - min) + min;
const pickGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

function setup(nextWidth, nextHeight, nextDpr) {
  if (!canvas || !ctx) return;
  width = Math.max(1, nextWidth);
  height = Math.max(1, nextHeight);
  dpr = Math.max(1, Math.min(nextDpr || 1, 1.5));
  fontSize = width < 560 ? 15 : 17;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `${fontSize}px "IBM Plex Mono", "Yu Gothic", monospace`;
  ctx.textBaseline = "top";
  columns = Array.from({ length: Math.ceil(width / fontSize) }, () => ({
    y: rand(-height * 0.3, height),
    speed: rand(1.4, 5.5),
    accent: Math.random() < 0.025,
  }));
  ctx.clearRect(0, 0, width, height);
}

function schedule() {
  if (timer || !running || paused) return;
  timer = setTimeout(draw, 1000 / TARGET_FPS);
}

function draw() {
  timer = null;
  if (!running || paused || !ctx) return;

  const now = performance.now();
  // Avoid catch-up bursts if the browser throttled a background tab.
  if (now - lastFrame < 1000 / TARGET_FPS - 2) {
    schedule();
    return;
  }
  lastFrame = now;
  ctx.clearRect(0, 0, width, height);

  for (let colIndex = 0; colIndex < columns.length; colIndex += 1) {
    const drop = columns[colIndex];
    const x = colIndex * fontSize;

    for (let trailIndex = 0; trailIndex < TRAIL; trailIndex += 1) {
      const y = drop.y - trailIndex * fontSize;
      if (y < -fontSize || y > height + fontSize) continue;

      const fade = 1 - trailIndex / TRAIL;
      if (trailIndex === 0) {
        ctx.fillStyle = drop.accent
          ? "rgba(83, 221, 255, 0.9)"
          : "rgba(206, 255, 218, 0.94)";
      } else if (drop.accent && trailIndex < 3) {
        ctx.fillStyle = `rgba(80, 217, 255, ${fade * 0.55})`;
      } else {
        ctx.fillStyle = `rgba(86, 255, 131, ${fade * 0.58})`;
      }

      ctx.fillText(pickGlyph(), x, y);
    }

    drop.y += drop.speed;
    if (drop.y - TRAIL * fontSize > height && Math.random() > 0.978) {
      drop.y = rand(-height * 0.42, -fontSize);
      drop.speed = rand(1.4, 5.5);
      drop.accent = Math.random() < 0.025;
    }
  }

  schedule();
}

function setPaused(value) {
  paused = Boolean(value);
  if (paused && timer) {
    clearTimeout(timer);
    timer = null;
  } else if (!paused) {
    schedule();
  }
}

self.addEventListener("message", (event) => {
  const message = event.data || {};

  if (message.type === "handshake") {
    self.postMessage({ type: "handshake" });
    return;
  }

  if (message.type === "init") {
    canvas = message.canvas;
    ctx = canvas?.getContext("2d", { alpha: true, desynchronized: true }) || null;
    if (!ctx) {
      self.postMessage({ type: "error", message: "OffscreenCanvas 2D context unavailable" });
      return;
    }
    setup(message.width, message.height, message.dpr);
    running = true;
    setPaused(message.paused);
    self.postMessage({ type: "ready" });
  } else if (message.type === "resize") {
    setup(message.width, message.height, message.dpr);
  } else if (message.type === "pause") {
    setPaused(message.value);
  } else if (message.type === "stop") {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    columns = [];
    ctx = null;
    canvas = null;
    self.close();
  }
});
