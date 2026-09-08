/* ============================================================
   PROJECT S.I.N.A.G. 2.0 — 3D Slide Viewer (viewer.js)
   One Three.js scene per 3D slide. Per the locked contract,
   ./js/models/<name>.js must export a factory returning:
     { group, tick(t, dt), setExploded(k), hotspots: [{title, desc, pos:[x,y,z], obj?}] }
   `obj` (optional THREE.Object3D) is the live part reference: labels
   track it through explode/rotation, and parts-list hover pulses it.
   Degrades to a styled fallback card when WebGL / CDN / model
   modules are unavailable. rAF runs only while the slide is
   active; the renderer is disposed on slide leave.

   Framing is bounding-SPHERE based (identical at every orbit
   angle), so exploded parts can never leave the frame as the
   model rotates. Slides open ASSEMBLED (k=0); the Explode
   button animates 0->1 and relabels to "Assemble".
   ============================================================ */

const MODEL_REGISTRY = {
  "satellite":      { file: "./models/satellite.js",      factory: "createSatellite" },
  "ground-station": { file: "./models/ground-station.js", factory: "createGroundStation" },
  "ai-core":        { file: "./models/ai-core.js",        factory: "createAICore" },
  "recharge":       { file: "./models/recharge.js",       factory: "createRecharge" },
};

const BG_COLOR = 0x0b1315;
const TEAL = 0x2dd4bf;
const FOV = 45;
const FIT_MARGIN = 1.18;    // bounding-sphere margin: model never touches an edge
const BIAS_PX = 40;         // model rides ~40px high to clear the bottom control strip
const ROT_SPEED = 0.01;     // rad per px of horizontal drag
const ROT_SPEED_Y = 0.008;  // rad per px of vertical drag
const INERTIA_DECAY = 0.92; // per-frame velocity decay after release
const IDLE_RESUME_MS = 4000;// idle auto-rotate pause after user interaction
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.2; // wheel zoom range (x current-k fit distance)
// Pleasing default 3/4 view: azimuth -35 deg, elevation 20 deg
const DEFAULT_THETA = (-35 * Math.PI) / 180;
const DEFAULT_PHI = ((90 - 20) * Math.PI) / 180;

let THREE = null;              // three module namespace, loaded lazily
let RoomEnvironment = null;    // three/addons environment (best-effort)
let threeFailed = false;
const viewers = new Map();     // slideEl -> viewer state
let activeViewer = null;
let rafId = null;
let lastT = 0;

/* ------------------------------------------------------------
   Lazy three.js loader (dynamic import so CDN failure is fatal
   to nothing except the 3D slides)
   ------------------------------------------------------------ */
async function loadThree() {
  if (THREE || threeFailed) return THREE;
  try {
    THREE = await import("three");
    try {
      ({ RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js"));
    } catch (envErr) {
      // Non-fatal: lights-only fallback still renders, just flatter
      console.warn("[viewer] RoomEnvironment unavailable (lights-only):", envErr);
    }
  } catch (err) {
    threeFailed = true;
    console.warn("[viewer] three.js failed to load:", err);
  }
  return THREE;
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext &&
      (c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------
   Fallback card
   ------------------------------------------------------------ */
function showFallback(slideEl) {
  const mount = slideEl.querySelector(".viewer-mount");
  const fallback = slideEl.querySelector(".viewer-fallback");
  const controls = slideEl.querySelector(".viewer-controls");
  if (mount) mount.style.display = "none";
  if (controls) controls.style.display = "none";
  if (fallback) fallback.hidden = false;
}

/* ------------------------------------------------------------
   Scene construction
   ------------------------------------------------------------ */
function buildScene(state) {
  const { mount } = state;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(BG_COLOR, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.Fog(BG_COLOR, 16, 40);

  // Image-based lighting: MeshStandardMaterial looks flat/dark without
  // an environment map — this is the single biggest visibility upgrade.
  if (RoomEnvironment) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      state.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      state.pmrem = pmrem;
      scene.environment = state.envTex;
    } catch (err) {
      console.warn("[viewer] environment map build failed (lights-only):", err);
    }
  }

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120);

  // Lighting rig on top of the IBL: ambient + hemisphere + key + rim +
  // front fill, tuned so graphite shells read against #0b1315 without
  // blowing out now that the environment contributes base illumination
  scene.add(new THREE.AmbientLight(0xbfe8e0, 0.55));
  scene.add(new THREE.HemisphereLight(0xbdf5ec, 0x11201f, 0.45));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.5);
  key.position.set(5, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(TEAL, 1.2);
  rim.position.set(-6, 4, -7);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x9fd8cf, 0.5);
  fill.position.set(0, 2, 9);
  scene.add(fill);

  // Ground grid — kept dim so it grounds the model without dominating
  const grid = new THREE.GridHelper(24, 24, TEAL, 0x22444a);
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  grid.position.y = -2.2;
  scene.add(grid);

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.grid = grid;
}

/* ------------------------------------------------------------
   Camera fitting — bounding-SPHERE based.
   A sphere's projected silhouette is identical at every azimuth
   and elevation, so a sphere fit can never break as the model
   orbits (the old 8-corner box projection only held for the
   exact angles it was computed at). The sphere is re-measured at
   the live explode k whenever k changes, and the camera distance
   is recomputed from the sphere radius each frame:

     dist = radius * FIT_MARGIN / sin(min(halfFovV', halfFovH))

   halfFovV' uses the usable height (viewport minus 2*BIAS_PX)
   because the look-at target is biased down BIAS_PX in world
   units, lifting the model ~40px above optical center to clear
   the bottom control strip. Result: at ANY rotation and ANY k,
   the whole model is inside the frame with margin.
   ------------------------------------------------------------ */
function measureSphere(state) {
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3);
  const box = new THREE.Box3().setFromObject(state.group);
  if (!box.isEmpty()) box.getBoundingSphere(sphere);
  sphere.radius = Math.max(sphere.radius, 0.8);
  return sphere;
}

function sphereFitDistance(state, radius) {
  const w = state.mount.clientWidth || 1;
  const h = state.mount.clientHeight || 1;
  const tanHalfV = Math.tan((FOV / 2) * (Math.PI / 180));
  const effH = Math.max(h - 2 * BIAS_PX, 120); // vertical budget after the up-bias
  const halfV = Math.atan(tanHalfV * (effH / h));
  const halfH = Math.atan(tanHalfV * (w / h));
  return Math.max((radius * FIT_MARGIN) / Math.sin(Math.min(halfV, halfH)), 1.5);
}

// Re-fit the camera on the CURRENT explode state. Cheap (one Box3
// walk over small models); called on build, resize, fullscreen
// changes, and every frame while explode k is animating.
function refit(state) {
  if (!state.group || !state.camera || !state.mount) return;
  const sphere = measureSphere(state);
  state.sphere = sphere;
  state.baseDist = sphereFitDistance(state, sphere.radius);
  // Debug/measurement compatibility handles
  state.fitDistAsm = state.baseDist;
  state.fitDistExp = state.baseDist;
  state.targetCenter = sphere.center.clone();
  applyCameraFraming(state);
}

// Derive camDist (fit x zoom) and the biased look-at target for
// this frame. Zoom is always relative to the current-k fit.
function applyCameraFraming(state) {
  const h = state.mount.clientHeight || 1;
  const tanHalfV = Math.tan((FOV / 2) * (Math.PI / 180));
  const dist = (state.baseDist || 3) * (state.zoom || 1);
  state.camDist = dist;
  const worldPerPx = (2 * dist * tanHalfV) / h;
  const c = state.targetCenter || state.target || new THREE.Vector3();
  state.target = new THREE.Vector3(c.x, c.y - BIAS_PX * worldPerPx, c.z);
}

function frameCameraOnGroup(state) {
  const { group } = state;

  // Entry state is ASSEMBLED: settle at k=0 (some models lerp explode
  // state inside tick(), so pump a few frames to let them land), then
  // sphere-fit so the model is framed within the first rendered frame.
  if (state.model && typeof state.model.setExploded === "function") {
    try { state.model.setExploded(0); } catch (_) { /* model guard */ }
  }
  if (state.model && typeof state.model.tick === "function") {
    for (let i = 0; i < 10; i++) {
      try { state.model.tick(10 + i * 0.5, 0.5); } catch (_) { /* model guard */ }
    }
  }

  // Seat the grid just under the assembled model
  const boxA = new THREE.Box3().setFromObject(group);
  if (state.grid && !boxA.isEmpty()) state.grid.position.y = boxA.min.y - 0.05;

  // Pleasant default 3/4 view (azimuth -35 deg, elevation 20 deg)
  state.orbit.theta = DEFAULT_THETA;
  state.orbit.phi = DEFAULT_PHI;
  refit(state);
  updateCamera(state);
}

function updateCamera(state) {
  const { camera, orbit, target, camDist } = state;
  const sinPhi = Math.sin(orbit.phi);
  camera.position.set(
    target.x + camDist * sinPhi * Math.sin(orbit.theta),
    target.y + camDist * Math.cos(orbit.phi),
    target.z + camDist * sinPhi * Math.cos(orbit.theta)
  );
  camera.lookAt(target);
}

/* ------------------------------------------------------------
   Pointer-drag orbit (dependency-free)
   Bound to the ENTIRE viewer stage with pointer capture, inertial
   damping after release, and wheel zoom that never changes slides.
   ------------------------------------------------------------ */
function attachOrbit(state) {
  const el = state.stage || state.mount;
  const orbit = state.orbit;
  orbit.dragging = false;
  orbit.velTheta = 0;
  orbit.velPhi = 0;
  let lastX = 0, lastY = 0, lastMoveT = 0;

  function onDown(e) {
    // Let the explode/fullscreen buttons and slider keep their own behavior
    if (e.target.closest && e.target.closest(".viewer-controls")) return;
    if (e.button !== undefined && e.button > 0) return; // primary button only
    orbit.dragging = true;
    lastX = e.clientX; lastY = e.clientY; lastMoveT = performance.now();
    orbit.velTheta = 0; orbit.velPhi = 0;
    orbit.idleUntil = performance.now() + IDLE_RESUME_MS;
    if (el.setPointerCapture && e.pointerId !== undefined) {
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* pointer guard */ }
    }
    el.classList.add("dragging");
    e.preventDefault();
  }
  function onMove(e) {
    if (!orbit.dragging) return;
    const now = performance.now();
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    const dtMs = Math.max(now - lastMoveT, 1);
    lastX = e.clientX; lastY = e.clientY; lastMoveT = now;
    orbit.theta -= dx * ROT_SPEED;
    orbit.phi = Math.min(Math.PI - 0.25, Math.max(0.25, orbit.phi - dy * ROT_SPEED_Y));
    // Flick velocity in rad per ~16.7ms frame, for inertia after release
    const frameScale = 16.7 / dtMs;
    orbit.velTheta = -dx * ROT_SPEED * frameScale;
    orbit.velPhi = -dy * ROT_SPEED_Y * frameScale;
    orbit.idleUntil = now + IDLE_RESUME_MS;
  }
  function onUp() {
    if (!orbit.dragging) return;
    orbit.dragging = false;
    el.classList.remove("dragging");
    // A held-still release should not fling the model
    if (performance.now() - lastMoveT > 120) {
      orbit.velTheta = 0; orbit.velPhi = 0;
    }
    // Idle auto-rotate stays off for a while after the user lets go
    orbit.idleUntil = performance.now() + IDLE_RESUME_MS;
  }
  function onWheel(e) {
    // Zoom the model, never the slide deck. camDist is derived from
    // zoom every frame in the render loop (relative to the current-k
    // fit), so we only track the zoom factor here.
    e.preventDefault();
    e.stopPropagation();
    const factor = Math.exp(Math.max(-240, Math.min(240, e.deltaY)) * 0.0012);
    state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (state.zoom || 1) * factor));
  }

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  state.cleanupOrbit = () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("wheel", onWheel);
  };
}

/* ------------------------------------------------------------
   Explode control (button 0<->1 with label toggle + slider).
   No auto-play: slides always open assembled (k=0).
   ------------------------------------------------------------ */
function attachExplode(state) {
  const slideEl = state.slideEl;
  const btn = slideEl.querySelector('[data-action="explode"]');
  const slider = slideEl.querySelector(".viewer-slider");
  state.explode = { k: 0, target: 0, sliderDrag: false };
  const cleanups = [];
  const on = (el, ev, fn, opts) => {
    el.addEventListener(ev, fn, opts);
    cleanups.push(() => el.removeEventListener(ev, fn, opts));
  };

  const syncUI = () => {
    const exploded = state.explode.target > 0.5;
    if (btn) {
      btn.classList.toggle("active", exploded);
      btn.textContent = exploded ? "Assemble" : "Explode";
    }
  };
  state.syncExplodeUI = syncUI;

  if (btn) {
    on(btn, "click", () => {
      state.explode.target = state.explode.target > 0.5 ? 0 : 1;
      syncUI();
      if (slider) slider.value = String(state.explode.target * 100);
    });
    state.explodeBtn = btn;
    syncUI();
  }
  if (slider) {
    on(slider, "pointerdown", () => { state.explode.sliderDrag = true; });
    on(slider, "pointerup", () => { state.explode.sliderDrag = false; });
    on(slider, "input", () => {
      state.explode.target = Number(slider.value) / 100;
      syncUI();
    });
    state.explodeSlider = slider;
  }
  state.cleanupExplode = () => cleanups.forEach((fn) => fn());
}

/* ------------------------------------------------------------
   Fullscreen toggle (⛶). Uses the Fullscreen API on the viewer
   STAGE (canvas + labels + controls) with vendor prefixes and
   Promise-rejection handling; if fullscreen is unsupported or
   blocked (some Android WebViews), falls back to an "expanded
   overlay" mode (position: fixed inset 0) that looks identical.
   ------------------------------------------------------------ */
function attachFullscreen(state) {
  const controls = state.slideEl.querySelector(".viewer-controls");
  const stage = state.stage;
  if (!controls || !stage) return;

  let btn = controls.querySelector('[data-action="fullscreen"]');
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "viewer-btn viewer-fs-btn";
    btn.dataset.action = "fullscreen";
    btn.textContent = "⛶";
    btn.title = "Fullscreen";
    btn.setAttribute("aria-label", "Toggle fullscreen");
    btn.setAttribute("aria-pressed", "false");
    const hint = controls.querySelector(".viewer-hint");
    controls.insertBefore(btn, hint || null);
  }

  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const inOverlay = () => stage.classList.contains("fs-overlay");

  const afterChange = () => {
    const on = fsElement() === stage;
    stage.classList.toggle("is-fullscreen", on);
    btn.classList.toggle("active", on || inOverlay());
    btn.setAttribute("aria-pressed", on || inOverlay() ? "true" : "false");
    // Layout settles async in some WebViews: resize now and next frame
    resize(state);
    requestAnimationFrame(() => resize(state));
  };
  const enterOverlay = () => { stage.classList.add("fs-overlay"); afterChange(); };
  const exitOverlay = () => { stage.classList.remove("fs-overlay"); afterChange(); };

  const onClick = async () => {
    state.orbit.idleUntil = performance.now() + IDLE_RESUME_MS;
    if (inOverlay()) { exitOverlay(); return; }
    if (fsElement()) {
      try {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        const p = exit && exit.call(document);
        if (p && p.catch) p.catch(() => {});
      } catch (_) { /* fullscreen guard */ }
      return;
    }
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (!req) { enterOverlay(); return; }
    try {
      const p = req.call(stage);
      if (p && typeof p.then === "function") await p;
      afterChange(); // some prefixed impls never fire an event
    } catch (_) {
      enterOverlay(); // unsupported / blocked: identical-looking overlay
    }
  };
  const onFsChange = () => afterChange();
  const onKey = (e) => { if (e.key === "Escape" && inOverlay()) exitOverlay(); };

  btn.addEventListener("click", onClick);
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);
  document.addEventListener("keydown", onKey);
  state.fullscreenBtn = btn;
  state.cleanupFullscreen = () => {
    btn.removeEventListener("click", onClick);
    document.removeEventListener("fullscreenchange", onFsChange);
    document.removeEventListener("webkitfullscreenchange", onFsChange);
    document.removeEventListener("keydown", onKey);
  };
}

/* ------------------------------------------------------------
   Hotspots: 3D -> screen-space labels + connector lines.
   All projection math uses the mount's CSS-pixel clientWidth /
   clientHeight (never the drawing-buffer pixels), so labels sit
   on their parts at any devicePixelRatio.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   Parts list <-> 3D highlight linkage.
   Hovering (desktop) or tapping (touch) a parts-list row pulses the
   matching part's emissive teal, emphasizes its on-canvas label, and
   dims the other labels; hovering a canvas label lights the list row.
   Original emissive color/intensity are stored per material on first
   highlight and restored exactly on release. Tap != drag: a press is
   only a tap when the pointer moved less than 8 px.
   ------------------------------------------------------------ */
const TAP_SLOP_PX = 8;

function setHotspotHighlight(state, i, on) {
  const entry = state.hotspotEls[i];
  if (!entry || entry.hlActive === on) return;
  entry.hlActive = on;
  entry.label.classList.toggle("active", on);
  entry.line.classList.toggle("active", on);
  if (entry.li) entry.li.classList.toggle("hotspot-active", on);
  state.mount.classList.toggle(
    "has-active",
    state.hotspotEls.some((e) => e.hlActive)
  );

  const obj = entry.hs.obj;
  if (!obj) return;
  if (on && !entry.savedMats) {
    // Snapshot every emissive-capable material under the part (groups
    // and multi-material meshes included), de-duplicating shared mats
    entry.savedMats = [];
    obj.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!("emissive" in m)) continue;
        if (entry.savedMats.some((s) => s.m === m)) continue;
        entry.savedMats.push({ m, color: m.emissive.getHex(), intensity: m.emissiveIntensity });
      }
    });
  }
  if (!entry.savedMats) return;
  if (on) {
    for (const s of entry.savedMats) {
      s.m.emissive.setHex(TEAL);
      // intensity is driven by the pulse in the render loop each frame
      s.m.emissiveIntensity = Math.max(s.intensity, 0.25) + 1.6;
    }
  } else {
    for (const s of entry.savedMats) {
      s.m.emissive.setHex(s.color);
      s.m.emissiveIntensity = s.intensity;
    }
  }
}

function buildHotspots(state, hotspots) {
  const frag = document.createDocumentFragment();
  state.hotspotEls = [];
  hotspots.forEach((hs) => {
    if (!hs || !Array.isArray(hs.pos)) return;
    const label = document.createElement("div");
    label.className = "hotspot-label";
    label.innerHTML =
      `<div class="hs-title"></div><div class="hs-desc"></div>`;
    label.querySelector(".hs-title").textContent = hs.title || "Part";
    label.querySelector(".hs-desc").textContent = hs.desc || "";

    const line = document.createElement("div");
    line.className = "hotspot-line";

    frag.appendChild(line);
    frag.appendChild(label);
    state.hotspotEls.push({ hs, label, line, world: new THREE.Vector3(), hlActive: false, tapped: false, savedMats: null });
  });
  state.mount.appendChild(frag);
  // Cache label widths once (used by the model-avoidance placement)
  state.hotspotEls.forEach((e) => { e.lw = e.label.offsetWidth || 130; });

  // Feed the side parts list from the model's hotspots
  const list = state.slideEl.querySelector(".parts-list");
  if (list && hotspots.length) {
    list.innerHTML = "";
    hotspots.forEach((hs, i) => {
      const entry = state.hotspotEls[i];
      const li = document.createElement("li");
      li.textContent = hs.desc ? `${hs.title} — ${hs.desc}` : hs.title;
      li.classList.add("hotspot-linked");
      if (entry) entry.li = li;

      // Desktop: hover links row <-> label + 3D part
      li.addEventListener("mouseenter", () => { if (!entry || !entry.tapped) setHotspotHighlight(state, i, true); });
      li.addEventListener("mouseleave", () => { if (!entry || !entry.tapped) setHotspotHighlight(state, i, false); });

      // Touch: tap toggles a stuck highlight (tap != drag, <8px slop)
      let downX = 0, downY = 0;
      li.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
      li.addEventListener("click", (e) => {
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_SLOP_PX) return;
        if (!entry) return;
        entry.tapped = !entry.tapped;
        setHotspotHighlight(state, i, entry.tapped);
      });

      // Canvas label hover lights the corresponding list row
      if (entry) {
        entry.label.addEventListener("mouseenter", () => li.classList.add("hotspot-active"));
        entry.label.addEventListener("mouseleave", () => {
          if (!entry.hlActive) li.classList.remove("hotspot-active");
        });
      }
      list.appendChild(li);
    });
  }
}

// A ray hit on the mesh that CONTAINS the anchor is the anchor's own
// part (hotspot authors place anchors at part centers) — not occlusion
function hitIsOwnPart(hit, worldPoint) {
  const obj = hit.object;
  if (!obj || !obj.geometry) return false;
  if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
  const bb = obj.geometry.boundingBox;
  if (!bb) return false;
  const p = obj.worldToLocal(worldPoint.clone());
  const eps = 0.03;
  return p.x >= bb.min.x - eps && p.x <= bb.max.x + eps &&
         p.y >= bb.min.y - eps && p.y <= bb.max.y + eps &&
         p.z >= bb.min.z - eps && p.z <= bb.max.z + eps;
}

function projectHotspots(state) {
  const { camera, mount, hotspotEls, group } = state;
  const w = mount.clientWidth, h = mount.clientHeight; // CSS px (DPR-independent)
  if (!w || !h) return;

  // True occlusion via raycast: an anchor is hidden only when actual
  // geometry blocks the camera->anchor segment (the old facing-dot
  // heuristic wrongly hid off-center parts of wide/flat models)
  if (!state.raycaster) state.raycaster = new THREE.Raycaster();
  const ray = state.raycaster;
  // Sprites (hologram readouts) raycast against the camera plane and
  // throw when Raycaster.camera is unset — bind it before every pass.
  ray.camera = camera;
  const anchorDir = new THREE.Vector3();

  // Projected model footprint (screen-space bbox of the live bounding
  // box): labels that would cover the model are pushed clear of it
  const mbox = new THREE.Box3().setFromObject(group);
  let mb = null;
  if (!mbox.isEmpty()) {
    const v = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const fx of [0, 1]) for (const fy of [0, 1]) for (const fz of [0, 1]) {
      v.set(fx ? mbox.max.x : mbox.min.x, fy ? mbox.max.y : mbox.min.y, fz ? mbox.max.z : mbox.min.z);
      v.project(camera);
      const px = (v.x * 0.5 + 0.5) * w, py = (-v.y * 0.5 + 0.5) * h;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    mb = { x0: x0 - 10, x1: x1 + 10, y0: y0 - 6, y1: y1 + 6 };
  }

  // Pass 1: project all hotspots, decide visibility decisively
  const visible = [];
  for (const entry of hotspotEls) {
    // Anchor source: the live part object (tracks explode / slider /
    // rotation every frame); falls back to the static assembled pos.
    // Optional anchorOffset (group-space) nudges the anchor away from
    // the part origin for tall assemblies (e.g. a pole's midsection).
    if (entry.hs.obj) {
      entry.hs.obj.getWorldPosition(entry.world);
      if (entry.hs.anchorOffset) {
        anchorDir.fromArray(entry.hs.anchorOffset);
        entry.world.add(anchorDir);
      }
    } else {
      entry.world.fromArray(entry.hs.pos);
      group.localToWorld(entry.world);
    }

    const ndc = entry.world.clone().project(camera);
    const behind = ndc.z > 1 || ndc.z < -1;
    const sx = (ndc.x * 0.5 + 0.5) * w;
    const sy = (-ndc.y * 0.5 + 0.5) * h;

    // Occluded only when real geometry blocks the anchor
    let occluded = behind;
    if (!occluded) {
      anchorDir.copy(entry.world).sub(camera.position);
      const dist = anchorDir.length();
      ray.set(camera.position, anchorDir.normalize());
      ray.near = 0;
      ray.far = dist - Math.max(0.08, dist * 0.03); // tolerance: anchor sits ON its part
      occluded = ray.intersectObject(group, true)
        .some((h) => !hitIsOwnPart(h, entry.world));
    }

    // A user-highlighted hotspot stays fully visible even when its
    // anchor is currently occluded (emphasis beats the fade)
    const hide = occluded && !entry.hlActive;
    entry.label.classList.toggle("occluded", hide);
    entry.line.classList.toggle("occluded", hide);
    if (hide) continue;

    const lw = entry.lw || 130; // measured once at build (no per-frame reflow)
    const lh = 28;              // collapsed label height (desc expands on hover only)
    const halfW = lw / 2 + 8;
    let lx = Math.min(Math.max(sx, halfW), w - halfW);
    let ly = Math.min(Math.max(sy - 46, 26), h - 60); // keep clear of the control strip

    // If the label would cover the model, park it just outside the
    // model's footprint on the anchor's side; the connector line
    // still lands exactly on the part
    if (mb && lx + halfW > mb.x0 && lx - halfW < mb.x1 && ly > mb.y0 && ly - lh < mb.y1) {
      const goLeft = sx <= (mb.x0 + mb.x1) / 2;
      lx = goLeft ? mb.x0 - halfW : mb.x1 + halfW;
      lx = Math.min(Math.max(lx, halfW), w - halfW);
    }

    visible.push({ entry, sx, sy, lx, ly, lh });
  }

  // Pass 2: vertical de-overlap — if two labels land within 26px
  // vertically (and roughly the same column), nudge the lower one down
  visible.sort((a, b) => a.ly - b.ly);
  const placed = [];
  for (const v of visible) {
    for (const p of placed) {
      if (Math.abs(v.lx - p.lx) < 140 && v.ly - p.ly < 26) {
        v.ly = p.ly + 26;
      }
    }
    v.ly = Math.min(v.ly, h - 60);
    placed.push(v);
  }

  // Pass 3: apply label positions and connector-line geometry
  for (const { entry, sx, sy, lx, ly } of visible) {
    entry.label.style.left = `${lx}px`;
    entry.label.style.top = `${ly}px`;

    const dx = sx - lx, dy = sy - ly;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    entry.line.style.left = `${lx}px`;
    entry.line.style.top = `${ly}px`;
    entry.line.style.width = `${len}px`;
    entry.line.style.height = "1px";
    entry.line.style.transform = `rotate(${angle}rad)`;
  }
}

/* ------------------------------------------------------------
   Render loop (single loop; only the active viewer renders)
   ------------------------------------------------------------ */
function loop(now) {
  if (!activeViewer) { rafId = null; return; }
  rafId = requestAnimationFrame(loop);

  const state = activeViewer;
  // Model may still be loading asynchronously — keep the loop alive but skip work
  if (!state.model || !state.renderer || !state.group) return;

  const t = now / 1000;
  const dt = Math.min(t - lastT, 0.1);
  lastT = t;

  // Explode easing (only when the user asks for it — no auto-play)
  const ex = state.explode;
  if (ex) {
    const prevK = ex.k;
    ex.k += (ex.target - ex.k) * Math.min(1, dt * 4.5);
    if (Math.abs(ex.k - ex.target) < 0.002) ex.k = ex.target;
    if (ex.k !== prevK) {
      if (typeof state.model.setExploded === "function") {
        try { state.model.setExploded(ex.k); } catch (_) { /* model guard */ }
      }
      if (state.explodeSlider && !ex.sliderDrag) {
        state.explodeSlider.value = String(Math.round(ex.k * 100));
      }
      // Sphere must be re-measured at the new k (after tick below)
      state.fitDirty = true;
    }
  }

  // Inertial damping after a drag release (velocity decays per frame)
  const o = state.orbit;
  if (!o.dragging && (Math.abs(o.velTheta) > 1e-4 || Math.abs(o.velPhi) > 1e-4)) {
    o.theta += o.velTheta;
    o.phi = Math.min(Math.PI - 0.25, Math.max(0.25, o.phi + o.velPhi));
    o.velTheta *= INERTIA_DECAY;
    o.velPhi *= INERTIA_DECAY;
  }

  // Gentle idle auto-rotation (resumes a few seconds after interaction)
  if (!o.dragging && performance.now() > o.idleUntil) {
    o.theta += dt * 0.12;
  }

  if (typeof state.model.tick === "function") {
    try { state.model.tick(t, dt); } catch (_) { /* model guard */ }
  }

  // Highlight pulse: runs AFTER the model tick so animated materials
  // (LEDs, strips) can't overwrite the highlight for this frame
  if (state.mount.classList.contains("has-active")) {
    const pulse = 1.5 + 1.0 * Math.sin(t * 5.5);
    for (const e of state.hotspotEls) {
      if (!e.hlActive || !e.savedMats) continue;
      for (const s of e.savedMats) {
        s.m.emissiveIntensity = Math.max(s.intensity, 0.25) + pulse;
      }
    }
  }

  // Re-fit at the live explode k while k is animating, so every
  // separated part stays inside the frame through the transition
  if (state.fitDirty) {
    state.fitDirty = false;
    refit(state);
  }

  applyCameraFraming(state); // camDist = current-k fit x zoom
  updateCamera(state);

  projectHotspots(state);
  state.renderer.render(state.scene, state.camera);
}

/* ------------------------------------------------------------
   Viewer lifecycle
   ------------------------------------------------------------ */
async function build(state) {
  const token = ++state.buildToken;
  const ok3 = await loadThree();
  if (token !== state.buildToken) return;          // left slide while loading
  if (!ok3 || !webglAvailable()) { showFallback(state.slideEl); return; }

  const spec = MODEL_REGISTRY[state.modelName];
  let model = null;
  try {
    const mod = await import(spec.file);
    if (token !== state.buildToken) return;
    if (typeof mod[spec.factory] !== "function") {
      throw new Error(`${spec.file} does not export ${spec.factory}()`);
    }
    model = mod[spec.factory]();
    if (!model || !model.group) throw new Error(`${spec.factory}() returned no group`);
  } catch (err) {
    console.warn(`[viewer] model "${state.modelName}" unavailable:`, err);
    if (token === state.buildToken) showFallback(state.slideEl);
    return;
  }

  try {
    buildScene(state);
  } catch (err) {
    console.warn("[viewer] WebGL renderer failed:", err);
    showFallback(state.slideEl);
    return;
  }

  // Slide may have been left while the model was loading — tear down
  // the half-built scene instead of attaching orphaned UI
  if (token !== state.buildToken) {
    dispose(state);
    return;
  }

  state.model = {
    group: model.group,
    tick: model.tick,
    setExploded: model.setExploded,
  };
  state.group = model.group;
  state.stage = state.mount.closest(".viewer-stage") || state.mount;
  state.scene.add(model.group);
  frameCameraOnGroup(state); // assembled (k=0), sphere-fitted, framed immediately
  attachOrbit(state);
  attachExplode(state);
  attachFullscreen(state);
  buildHotspots(state, Array.isArray(model.hotspots) ? model.hotspots : []);
  resize(state);

  state.resizeObs = new ResizeObserver(() => resize(state));
  state.resizeObs.observe(state.mount);

  state.built = true;
  // Measurement/debug handles for automated visual checks (no UI impact)
  state.THREE = THREE;
  state.mount.__viewer = state;
}

function resize(state) {
  if (!state.renderer || !state.camera) return;
  const w = state.mount.clientWidth || 1;
  const h = state.mount.clientHeight || 1;
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // updateStyle=true: canvas CSS size must equal the mount's CSS size,
  // otherwise at devicePixelRatio > 1 the buffer-sized canvas overflows
  // the mount and the model renders shifted down-right, half-clipped
  state.renderer.setSize(w, h, true);
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
  refit(state); // keep the sphere framing correct for the new box
}

function dispose(state) {
  state.buildToken++;
  if (state.resizeObs) { state.resizeObs.disconnect(); state.resizeObs = null; }
  if (state.cleanupOrbit) { state.cleanupOrbit(); state.cleanupOrbit = null; }
  if (state.cleanupExplode) { state.cleanupExplode(); state.cleanupExplode = null; }
  if (state.cleanupFullscreen) { state.cleanupFullscreen(); state.cleanupFullscreen = null; }
  // Never strand the deck in fullscreen / overlay when the slide leaves
  if (state.stage) {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs === state.stage) {
      try {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        const p = exit && exit.call(document);
        if (p && p.catch) p.catch(() => {});
      } catch (_) { /* fullscreen guard */ }
    }
    state.stage.classList.remove("fs-overlay", "is-fullscreen");
  }
  if (state.hotspotEls) {
    state.hotspotEls.forEach((e) => { e.label.remove(); e.line.remove(); });
    state.hotspotEls = [];
  }
  if (state.mount) state.mount.classList.remove("has-active");
  if (state.scene) {
    state.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material])
          .forEach((m) => m.dispose());
      }
    });
  }
  if (state.envTex) { state.envTex.dispose(); state.envTex = null; }
  if (state.pmrem) { state.pmrem.dispose(); state.pmrem = null; }
  if (state.renderer) {
    state.renderer.dispose();
    if (state.renderer.domElement.parentNode) {
      state.renderer.domElement.parentNode.removeChild(state.renderer.domElement);
    }
  }
  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.model = null;
  state.group = null;
  state.stage = null;
  state.sphere = null;
  state.baseDist = null;
  state.fitDistAsm = null;
  state.fitDistExp = null;
  state.targetCenter = null;
  state.raycaster = null;
  state.fitDirty = false;
  state.zoom = 1;
  state.built = false;
}

/* ------------------------------------------------------------
   Public API used by main.js
   ------------------------------------------------------------ */
export function initViewers() {
  document.querySelectorAll(".slide[data-model]").forEach((slideEl) => {
    const modelName = slideEl.dataset.model;
    if (!MODEL_REGISTRY[modelName]) return;
    viewers.set(slideEl, {
      slideEl,
      modelName,
      mount: slideEl.querySelector(".viewer-mount"),
      built: false,
      buildToken: 0,
      orbit: { theta: DEFAULT_THETA, phi: DEFAULT_PHI, idleUntil: 0, velTheta: 0, velPhi: 0, dragging: false },
      zoom: 1,
      explode: null,
      hotspotEls: [],
    });
  });
}

export function activateViewer(slideEl) {
  const state = viewers.get(slideEl);
  if (!state) return;
  if (!state.built || !state.renderer) {
    state.built = false;
    build(state); // async; opens assembled, framed on first frame
  } else if (state.explode) {
    // Re-entry without rebuild: always open assembled and framed
    state.explode.k = 0;
    state.explode.target = 0;
    if (state.model && typeof state.model.setExploded === "function") {
      try { state.model.setExploded(0); } catch (_) { /* model guard */ }
    }
    state.zoom = 1;
    state.orbit.theta = DEFAULT_THETA;
    state.orbit.phi = DEFAULT_PHI;
    if (state.syncExplodeUI) state.syncExplodeUI();
    if (state.explodeSlider) state.explodeSlider.value = "0";
    refit(state);
  }
  activeViewer = state;
  lastT = performance.now() / 1000;
  if (!rafId) rafId = requestAnimationFrame(loop);
}

export function deactivateViewer(slideEl) {
  const state = viewers.get(slideEl);
  if (!state) return;
  if (activeViewer === state) {
    activeViewer = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }
  if (state.built || state.renderer) dispose(state);
}

export { deactivateViewer as deactivateViewers };
