// ai-core.js — UTAK-TUBIG (AI Layer)
// An "AI core" server monolith thinking over a holographic MODFLOW
// voxel aquifer: cells compress and recover in a live simulation wave,
// a neural ring pulses around it, satellite/sensor/rain data streams
// flow in, and a hologram counts out the seasonal Extraction Budget.
import * as THREE from 'three';

const COL = {
  core: 0x1a2428,
  coreDark: 0x111a1d,
  panel: 0x22333a,
  teal: 0x2dd4bf,
  blue: 0x38bdf8,
  amber: 0xf59e0b,
  voxelA: 0x2dd4bf,
  voxelB: 0x38bdf8,
  voxelHot: 0xf59e0b,
  iconBody: 0x9fb4bd,
  iconDark: 0x37474f,
};

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.45, ...opts });
}
function glow(color, opacity = 0.5) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

export function createAICore() {
  const group = new THREE.Group();
  const parts = [];
  const _v = new THREE.Vector3();
  let kExplode = 0;

  function track(obj, off) {
    obj.userData.basePos = obj.position.clone();
    parts.push({ obj, off: new THREE.Vector3(off[0], off[1], off[2]) });
    return obj;
  }

  /* ================= PLINTH + SERVER MONOLITH ================= */
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.25, 0.16, 28),
    std(0x141e21, { roughness: 0.4, metalness: 0.6 })
  );
  plinth.position.y = 0.08;
  track(plinth, [0, 0, 0]);
  group.add(plinth);

  // main body
  const bodyGrp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 1.1), std(COL.core, { roughness: 0.35, metalness: 0.65 }));
  body.position.y = 1.11;
  bodyGrp.add(body);
  // glowing vertical bus strips
  const stripMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 1.6, roughness: 0.4 });
  for (const sx of [-0.4, 0, 0.4]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.02), stripMat);
    strip.position.set(sx, 1.11, 0.56);
    bodyGrp.add(strip);
  }
  // rack LED matrix on the front face
  const ledMats = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const lm = std(COL.blue, { emissive: COL.blue, emissiveIntensity: 1, roughness: 0.4 });
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.015), lm);
      led.position.set(-0.42 + c * 0.115, 0.45 + r * 0.09, 0.558);
      bodyGrp.add(led);
      ledMats.push(lm);
    }
  }
  // crown glow ring
  const crownMat = glow(COL.teal, 0.5);
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.02, 10, 40), crownMat);
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 2.08;
  bodyGrp.add(crown);
  track(bodyGrp, [0, 0, 0]);
  group.add(bodyGrp);

  // side panels + inner compute slab (revealed on explode)
  const panelMat = std(COL.panel, { roughness: 0.4, metalness: 0.6 });
  const panelL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.7, 0.95), panelMat);
  panelL.position.set(-0.58, 1.11, 0);
  track(panelL, [-0.75, 0.1, 0]);
  const panelR = panelL.clone();
  panelR.position.set(0.58, 1.11, 0);
  track(panelR, [0.75, 0.1, 0]);
  const computeMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 1.1, roughness: 0.35, metalness: 0.3, transparent: true, opacity: 0.9 });
  const compute = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.7), computeMat);
  compute.position.set(0, 1.11, 0);
  track(compute, [0, 0.85, 0]);
  group.add(panelL, panelR, compute);

  /* ================= MODFLOW VOXEL GRID (hologram above) ================= */
  const voxGrp = new THREE.Group();
  voxGrp.position.set(0, 2.85, 0);
  group.add(voxGrp);

  const NV = 8, NL = 3, CS = 0.17, GAP = 0.055, PITCH = CS + GAP;
  const voxGeo = new THREE.BoxGeometry(CS, CS, CS);
  const voxMats = [
    std(COL.voxelA, { emissive: COL.voxelA, emissiveIntensity: 0.55, transparent: true, opacity: 0.5, roughness: 0.3 }),
    std(COL.voxelB, { emissive: COL.voxelB, emissiveIntensity: 0.5, transparent: true, opacity: 0.45, roughness: 0.3 }),
    std(COL.voxelHot, { emissive: COL.voxelHot, emissiveIntensity: 0.7, transparent: true, opacity: 0.65, roughness: 0.3 }),
  ];
  const cells = []; // { mesh, bx, by, bz, r, layer, hot }
  for (let l = 0; l < NL; l++) {
    for (let ix = 0; ix < NV; ix++) {
      for (let iz = 0; iz < NV; iz++) {
        const cx = (ix - (NV - 1) / 2) * PITCH;
        const cz = (iz - (NV - 1) / 2) * PITCH;
        const cy = l * PITCH - (NL - 1) * PITCH / 2;
        const r = Math.hypot(cx, cz) / ((NV / 2) * PITCH); // 0 center → ~1 edge
        const hot = r < 0.34 && l === 0; // cone-of-depression core cells
        const mesh = new THREE.Mesh(voxGeo, hot ? voxMats[2] : voxMats[l % 2]);
        mesh.position.set(cx, cy, cz);
        voxGrp.add(mesh);
        cells.push({ mesh, bx: cx, by: cy, bz: cz, r, layer: l, hot });
      }
    }
  }
  // holo frame under the grid
  const gridFrameMat = glow(COL.teal, 0.3);
  const gridFrame = new THREE.Mesh(new THREE.RingGeometry(NV * PITCH * 0.72, NV * PITCH * 0.76, 48), gridFrameMat);
  gridFrame.rotation.x = -Math.PI / 2;
  gridFrame.position.y = -(NL - 1) * PITCH / 2 - 0.16;
  voxGrp.add(gridFrame);
  // light column projecting the hologram from the crown
  const projMat = glow(COL.teal, 0.06);
  const projector = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.35, 0.85, 24, 1, true), projMat);
  projector.position.y = 2.5;
  group.add(projector);
  track(voxGrp, [0, 0.95, 0]);

  /* ================= NEURAL RING ================= */
  const NN = 10;
  const ringGrp = new THREE.Group();
  ringGrp.position.y = 1.55;
  ringGrp.rotation.x = 0.22;
  group.add(ringGrp);
  const nodeMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 2.0, roughness: 0.35 });
  const nNodes = [];
  for (let i = 0; i < NN; i++) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), nodeMat.clone());
    ringGrp.add(n);
    nNodes.push(n);
  }
  // pulsing connections: ring edges + spokes to the core
  const linePos = new Float32Array((NN * 2) * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: COL.teal, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  ringGrp.add(lines);

  /* ================= INPUT DATA STREAMS (satellite / sensor / rain) ================= */
  function makeDishIcon() {
    const g = new THREE.Group();
    const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 8), std(COL.iconDark));
    tri.position.y = 0.15;
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), std(COL.iconBody, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }));
    dish.position.y = 0.36;
    dish.rotation.x = Math.PI / 3;
    const feed = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), std(COL.teal, { emissive: COL.teal, emissiveIntensity: 1.5 }));
    feed.position.set(0, 0.42, 0.1);
    g.add(tri, dish, feed);
    return g;
  }
  function makeSensorIcon() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.42, 8), std(COL.iconDark));
    pole.position.y = 0.21;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.08), std(COL.iconBody));
    box.position.y = 0.44;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), std(COL.teal, { emissive: COL.teal, emissiveIntensity: 1.5 }));
    led.position.set(0.05, 0.48, 0.05);
    g.add(pole, box, led);
    return g;
  }
  function makeRainIcon() {
    const g = new THREE.Group();
    const puffMat = std(0xc7d3d8, { roughness: 0.7, metalness: 0.05 });
    const p1 = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), puffMat);
    p1.position.set(-0.07, 0.42, 0);
    const p2 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), puffMat);
    p2.position.set(0.04, 0.46, 0);
    const p3 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), puffMat);
    p3.position.set(0.14, 0.4, 0.02);
    g.add(p1, p2, p3);
    const dropMat = std(COL.blue, { emissive: COL.blue, emissiveIntensity: 1.2 });
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), dropMat);
      d.position.set(-0.05 + i * 0.07, 0.24, 0);
      g.add(d);
    }
    return g;
  }
  const streamDefs = [
    { icon: makeDishIcon(), pos: [-1.95, 0, 0.85], off: [-0.55, 0.1, 0.35], label: 'sat' },
    { icon: makeSensorIcon(), pos: [1.95, 0, 0.85], off: [0.55, 0.1, 0.35], label: 'iot' },
    { icon: makeRainIcon(), pos: [0.2, 0, -2.15], off: [0.1, 0.1, -0.6], label: 'rain' },
  ];
  const streams = [];
  const streamMat = glow(COL.teal, 0.9);
  for (const def of streamDefs) {
    def.icon.position.set(def.pos[0], def.pos[1], def.pos[2]);
    track(def.icon, def.off);
    group.add(def.icon);
    const start = new THREE.Vector3(def.pos[0], 0.5, def.pos[2]);
    const end = new THREE.Vector3(0, 1.35, 0);
    const ctrl = start.clone().lerp(end, 0.5); ctrl.y += 0.75;
    const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);
    const dots = [];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), streamMat.clone());
      group.add(d);
      dots.push(d);
    }
    streams.push({ curve, dots, phase: Math.random() });
  }

  /* ================= EXTRACTION BUDGET HOLOGRAM ================= */
  const budCanvas = document.createElement('canvas');
  budCanvas.width = 640; budCanvas.height = 360;
  const bctx = budCanvas.getContext('2d');
  const budTex = new THREE.CanvasTexture(budCanvas);
  budTex.colorSpace = THREE.SRGBColorSpace;
  const budMat = new THREE.SpriteMaterial({ map: budTex, transparent: true, opacity: 0.95, depthWrite: false });
  const budget = new THREE.Sprite(budMat);
  budget.raycast = () => {}; // hologram is glass — never blocks hotspot occlusion rays
  budget.scale.set(1.85, 1.04, 1);
  budget.position.set(2.0, 2.5, 0.75);
  group.add(budget);

  const SEASONS = [
    { label: 'DRY SEASON 2028 · BRGY TIBAGUIN', value: 8340000 },
    { label: 'WET SEASON 2028 · BRGY TIBAGUIN', value: 9120000 },
    { label: 'DRY SEASON 2029 · BRGY PUGAD', value: 7860000 },
  ];
  let lastDraw = -1;
  function drawBudget(season, frac) {
    const shown = Math.round(season.value * frac);
    bctx.clearRect(0, 0, 640, 360);
    bctx.fillStyle = 'rgba(11,19,21,0.6)';
    bctx.fillRect(4, 4, 632, 352);
    bctx.strokeStyle = 'rgba(45,212,191,0.9)';
    bctx.lineWidth = 3;
    bctx.strokeRect(4, 4, 632, 352);
    bctx.fillStyle = 'rgba(45,212,191,0.9)';
    bctx.fillRect(4, 4, 30, 6); bctx.fillRect(4, 4, 6, 30);
    bctx.fillRect(600, 350, 32, 6); bctx.fillRect(630, 326, 6, 30);
    bctx.textAlign = 'left';
    bctx.fillStyle = 'rgba(45,212,191,0.95)';
    bctx.font = '600 24px "Space Grotesk", sans-serif';
    bctx.fillText('UTAK-TUBIG · EXTRACTION BUDGET', 30, 48);
    bctx.fillStyle = 'rgba(231,242,240,0.7)';
    bctx.font = '400 20px "Inter", sans-serif';
    bctx.fillText(season.label, 30, 82);
    bctx.fillStyle = '#2dd4bf';
    bctx.font = '700 66px "Space Grotesk", sans-serif';
    bctx.fillText(shown.toLocaleString('en-US') + ' m³', 30, 165);
    // gauge
    bctx.fillStyle = 'rgba(255,255,255,0.08)';
    bctx.fillRect(30, 200, 580, 26);
    bctx.fillStyle = frac > 0.9 ? '#f59e0b' : '#2dd4bf';
    bctx.fillRect(30, 200, 580 * Math.min(frac, 1), 26);
    bctx.fillStyle = 'rgba(231,242,240,0.75)';
    bctx.font = '400 18px "Inter", sans-serif';
    bctx.fillText('MODFLOW 6 + LSTM forecast · RF/XGBoost zonation (AUC 0.99)', 30, 258);
    bctx.fillText('Monthly cap → barangay ordinance → SMS to permittees', 30, 290);
    bctx.fillStyle = 'rgba(245,158,11,0.9)';
    bctx.font = '600 18px "Space Grotesk", sans-serif';
    bctx.fillText('100% open-source — ₱0 license cost', 30, 332);
    budTex.needsUpdate = true;
  }

  /* ================= contract ================= */
  function setExploded(k) {
    kExplode = k;
    for (const p of parts) {
      _v.copy(p.off).multiplyScalar(k);
      p.obj.position.copy(p.obj.userData.basePos).add(_v);
    }
  }

  function tick(t) {
    const live = 1 - kExplode * 0.85;

    // rack LEDs flicker like a busy server
    for (let i = 0; i < ledMats.length; i++) {
      const h = Math.sin(t * 7 + i * 12.9898) * 43758.5453;
      ledMats[i].emissiveIntensity = (h - Math.floor(h)) > 0.55 ? 1.6 : 0.15;
    }
    stripMat.emissiveIntensity = 1.3 + 0.5 * Math.sin(t * 2.4);
    computeMat.emissiveIntensity = 0.8 + 0.4 * Math.sin(t * 1.7);
    crownMat.opacity = 0.35 + 0.2 * Math.sin(t * 2.4);
    projMat.opacity = (0.045 + 0.03 * Math.sin(t * 3.2)) * live;

    // MODFLOW voxels: cone-of-depression compression wave + recovery
    const simPh = (t / 10) % 1;                       // 10 s pump–recover loop
    const stress = simPh < 0.5 ? simPh / 0.5 : 1 - (simPh - 0.5) / 0.5; // 0→1→0
    for (const c of cells) {
      const cone = Math.max(0, 1 - c.r * 1.4);        // deepest at the center
      const wave = Math.sin(t * 2.2 + c.r * 5 + c.layer) * 0.008;
      const squash = 1 - cone * stress * 0.45;        // hot cells visibly compact
      c.mesh.scale.y = squash;
      c.mesh.position.y =
        c.by - cone * stress * 0.09 + wave + (c.layer * 0.3 + 0.0) * kExplode;
      c.mesh.position.x = c.bx * (1 + kExplode * 0.25);
      c.mesh.position.z = c.bz * (1 + kExplode * 0.25);
      if (c.hot) voxMats[2].emissiveIntensity = 0.55 + stress * 0.9;
    }
    gridFrameMat.opacity = (0.22 + 0.15 * Math.sin(t * 2.2)) * live;
    voxGrp.rotation.y = Math.sin(t * 0.18) * 0.3;

    // Neural ring: orbiting nodes + pulsing synapses
    ringGrp.rotation.y = t * 0.35;
    const R = 1.55 + kExplode * 0.45;
    const lp = lineGeo.attributes.position.array;
    for (let i = 0; i < NN; i++) {
      const a = (i / NN) * Math.PI * 2;
      const n = nNodes[i];
      n.position.set(Math.cos(a) * R, Math.sin(t * 1.8 + i * 1.7) * 0.1, Math.sin(a) * R);
      n.material.emissiveIntensity = 1.4 + 0.9 * Math.sin(t * 3 + i * 1.3);
      const j = (i + 1) % NN;
      lp.set([n.position.x, n.position.y, n.position.z,
              nNodes[j].position.x, nNodes[j].position.y, nNodes[j].position.z], i * 6);
      lp.set([n.position.x, n.position.y, n.position.z, 0, 0, 0], (NN + i) * 6);
    }
    lineGeo.attributes.position.needsUpdate = true;
    lineMat.opacity = (0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 4.5))) * live;

    // Input streams: packets flow icon → core
    for (const s of streams) {
      for (let i = 0; i < s.dots.length; i++) {
        const p = (t * 0.3 + i / s.dots.length + s.phase) % 1;
        s.dots[i].position.copy(s.curve.getPoint(p));
        const sc = (0.7 + 0.5 * Math.sin(p * Math.PI)) * live;
        s.dots[i].scale.setScalar(Math.max(sc, 0.001));
        s.dots[i].material.opacity = 0.9 * live;
      }
    }

    // Budget hologram: counts up each season, holds, rolls to the next
    const cyc = (t / 7) % SEASONS.length;
    const si = Math.floor(cyc);
    const frac = Math.min((cyc - si) / 0.7, 1);
    const eased = 1 - Math.pow(1 - frac, 3);
    if (t - lastDraw > 0.09) {
      lastDraw = t;
      drawBudget(SEASONS[si], eased);
    }
    budMat.opacity = (0.85 + 0.1 * Math.sin(t * 3.1)) * (0.35 + 0.65 * live);
  }

  const hotspots = [
    { title: 'AI Core Server', desc: 'Edge workstation running MODFLOW 6 physics + ML — 100% open-source, no license fees ever.', pos: [0, 1.2, 0.4], obj: bodyGrp, anchorOffset: [0, 1.15, 0.3] },
    { title: 'MODFLOW Groundwater Model', desc: 'The USGS physics core: aquifer cells compact under pumping stress and recover in the simulation loop.', pos: [0, 2.85, 0], obj: voxGrp, anchorOffset: [0, 0.62, 0] },
    { title: 'ML Forecasting (RF/XGBoost + LSTM)', desc: 'RF/XGBoost zonation + LSTM forecaster fuse every data stream into next-season risk (AUC 0.99 benchmark).', pos: [1.55, 1.55, 0], obj: nNodes[0] },
    { title: 'Satellite Data Stream', desc: 'PS-InSAR velocity maps flow straight into the model — space and ground never disagree for long.', pos: [-1.95, 0.5, 0.85], obj: streamDefs[0].icon },
    { title: 'Extraction Budget', desc: 'The output: a defensible m³/season cap per barangay, first issued Month 18, reissued quarterly, pushed by dashboard + SMS.', pos: [2.0, 2.5, 0.75], obj: budget },
  ];

  return { group, tick, setExploded, hotspots };
}
