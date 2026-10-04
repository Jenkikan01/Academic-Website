/*
 * Starts the decorative Matrix rain in a dedicated Worker where
 * OffscreenCanvas is available. A light main-thread fallback keeps
 * older browsers and restricted previews attractive and functional.
 */
const SYMBOLS = "アカサタナハマヤラワ0123456789ABCDEF<>[]{}";
const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

export function initMatrixRain(canvas, statusNode) {
  if (!canvas) return { setPaused() {}, destroy() {}, mode: "unavailable" };

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let userPaused = Boolean(reducedMotion?.matches);
  let pageHidden = document.hidden;
  let worker = null;
  let ctx = null;
  let rafId = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let drops = [];
  let disposed = false;
  let mode = "static";
  let workerTransferred = false;
  let workerHandshakeTimer = 0;

  const status = (label, className = "") => {
    if (!statusNode) return;
    statusNode.textContent = label;
    statusNode.classList.toggle("is-worker", className === "worker");
    statusNode.classList.toggle("is-fallback", className === "fallback");
  };

  function currentPauseState() {
    return userPaused || pageHidden || disposed;
  }

  function size() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5));
    return { width, height, dpr };
  }

  function drawFallback() {
    rafId = 0;
    if (disposed || currentPauseState() || !ctx) return;
    ctx.clearRect(0, 0, width, height);
    const font = width < 560 ? 15 : 17;
    ctx.font = `${font}px monospace`;
    ctx.textBaseline = "top";
    for (let i = 0; i < drops.length; i += 1) {
      const drop = drops[i];
      const x = i * font;
      for (let trail = 0; trail < 7; trail += 1) {
        const y = drop.y - trail * font;
        if (y < 0 || y > height) continue;
        ctx.fillStyle = trail === 0
          ? "rgba(206,255,218,.9)"
          : `rgba(86,255,131,${(1 - trail / 7) * 0.5})`;
        ctx.fillText(pick(), x, y);
      }
      drop.y += drop.speed;
      if (drop.y > height + font * 7 && Math.random() > 0.98) {
        drop.y = -Math.random() * height * 0.2;
        drop.speed = 1.4 + Math.random() * 4;
      }
    }
    rafId = requestAnimationFrame(drawFallback);
  }

  function resizeFallback() {
    if (!ctx) return;
    const { width: w, height: h, dpr: ratio } = size();
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const font = w < 560 ? 15 : 17;
    drops = Array.from({ length: Math.ceil(w / font) }, () => ({
      y: Math.random() * h,
      speed: 1.4 + Math.random() * 4,
    }));
    ctx.clearRect(0, 0, w, h);
    if (!currentPauseState() && !rafId) rafId = requestAnimationFrame(drawFallback);
  }

  function syncWorker() {
    if (!worker) return;
    worker.postMessage({ type: "pause", value: currentPauseState() });
  }

  function onResize() {
    if (worker) {
      worker.postMessage({ type: "resize", ...size() });
    } else if (ctx) {
      resizeFallback();
    }
  }

  function onVisibility() {
    pageHidden = document.hidden;
    if (worker) syncWorker();
    else if (ctx && !currentPauseState() && !rafId) rafId = requestAnimationFrame(drawFallback);
    else if (currentPauseState() && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function startMainThreadFallback(label = "MAIN THREAD // FX FALLBACK") {
    if (disposed) return;
    if (workerHandshakeTimer) {
      window.clearTimeout(workerHandshakeTimer);
      workerHandshakeTimer = 0;
    }
    if (worker) worker.terminate();
    if (workerTransferred) {
      worker = null;
      mode = "static";
      canvas.classList.add("matrix-static");
      status("FX STATIC // WORKER INTERRUPTED", "fallback");
      return;
    }
    worker = null;
    try {
      ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("2D canvas context unavailable");
      mode = "fallback";
      status(label, "fallback");
      resizeFallback();
    } catch {
      mode = "static";
      canvas.classList.add("matrix-static");
      status("FX STATIC // REDUCED MOTION", "fallback");
    }
  }

  function startWorkerRender() {
    if (disposed || !worker || workerTransferred) return;
    if (workerHandshakeTimer) {
      window.clearTimeout(workerHandshakeTimer);
      workerHandshakeTimer = 0;
    }
    try {
      const offscreen = canvas.transferControlToOffscreen();
      workerTransferred = true;
      worker.postMessage({
        type: "init",
        canvas: offscreen,
        ...size(),
        paused: currentPauseState(),
      }, [offscreen]);
      mode = "worker";
      status("WORKER THREAD // CONNECTING", "worker");
    } catch {
      startMainThreadFallback("MAIN THREAD // WORKER UNAVAILABLE");
    }
  }

  canvas.classList.toggle("matrix-static", userPaused);
  const canUseWorker = typeof Worker !== "undefined" && typeof canvas.transferControlToOffscreen === "function";
  if (canUseWorker) {
    try {
      worker = new Worker(new URL("./matrix-worker.js", import.meta.url), { name: "tindig-matrix-renderer" });
      worker.addEventListener("message", (event) => {
        if (event.data?.type === "handshake") {
          startWorkerRender();
        } else if (event.data?.type === "ready") {
          status("WORKER THREAD // ONLINE", "worker");
        } else if (event.data?.type === "error") {
          worker?.terminate();
          worker = null;
          mode = "static";
          status("FX STATIC // OFFSCREEN UNAVAILABLE", "fallback");
          canvas.classList.add("matrix-static");
        }
      });
      worker.addEventListener("error", () => {
        if (!workerTransferred) startMainThreadFallback("MAIN THREAD // WORKER UNAVAILABLE");
        else {
          worker?.terminate();
          worker = null;
          mode = "static";
          status("FX STATIC // WORKER OFFLINE", "fallback");
          canvas.classList.add("matrix-static");
        }
      });
      worker.postMessage({ type: "handshake" });
      mode = "worker-pending";
      status("WORKER THREAD // HANDSHAKE", "worker");
      workerHandshakeTimer = window.setTimeout(() => {
        if (!workerTransferred) startMainThreadFallback("MAIN THREAD // HANDSHAKE TIMEOUT");
      }, 900);
    } catch {
      startMainThreadFallback("MAIN THREAD // WORKER UNAVAILABLE");
    }
  } else {
    startMainThreadFallback("MAIN THREAD // FX FALLBACK");
  }

  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  reducedMotion?.addEventListener?.("change", (event) => {
    userPaused = event.matches;
    canvas.classList.toggle("matrix-static", event.matches);
    if (worker) syncWorker();
    else if (ctx) onVisibility();
  });

  return {
    get mode() { return mode; },
    get paused() { return currentPauseState(); },
    setPaused(value) {
      userPaused = Boolean(value);
      canvas.classList.toggle("matrix-static", userPaused);
      if (worker) syncWorker();
      else if (ctx) onVisibility();
      if (userPaused && !ctx) status("FX PAUSED // STATIC FIELD", "fallback");
      else if (!userPaused && worker) status("WORKER THREAD // ONLINE", "worker");
    },
    destroy() {
      disposed = true;
      if (workerHandshakeTimer) window.clearTimeout(workerHandshakeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      if (rafId) cancelAnimationFrame(rafId);
      if (worker) {
        worker.postMessage({ type: "stop" });
        worker.terminate();
      }
      worker = null;
      ctx = null;
      drops = [];
    },
  };
}
