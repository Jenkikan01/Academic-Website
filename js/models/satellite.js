// satellite.js — BANTAY-LUPA (Space Layer)
// A Sentinel-1-style SAR satellite beaming radar pulses at a delta
// fishpond terrain; interferometric fringe rings pulse where the
// ground is sinking; a GNSS station and holo readout anchor the story.
import * as THREE from 'three';

const COL = {
  bus: 0xcfd8dc,
  busDark: 0x8a979e,
  gold: 0xd4af37,        // MLI blanket foil
  sar: 0x9fb4bd,
  sarGrid: 0x2dd4bf,
  solar: 0x1e3a5f,
  solarFrame: 0x141a1e,
  topsoil: 0x4a5d3a,
  clay: 0x8a6d3b,
  aquifer: 0x2b6d8f,
  water: 0x1d5f8a,
  dike: 0x5c6b4a,
  teal: 0x2dd4bf,
  amber: 0xf59e0b,
  red: 0xef4444,
  white: 0xe8ecee,
};

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, ...opts });
}
function glow(color, opacity = 0.5) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

export function createSatellite() {
  const group = new THREE.Group();
  const parts = [];
  const _v = new THREE.Vector3();
  let kExplode = 0;

  function track(obj, off) {
    obj.userData.basePos = obj.position.clone();
    parts.push({ obj, off: new THREE.Vector3(off[0], off[1], off[2]) });
    return obj;
  }

  /* ================= GROUND PATCH (delta cross-section) ================= */
  const GW = 4.6, GD = 3.0; // ground width/depth

  // Aquifer layer (bottom)
  const aquiferGrp = new THREE.Group();
  const aquifer = new THREE.Mesh(
    new THREE.BoxGeometry(GW, 0.5, GD),
    std(COL.aquifer, { roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.9 })
  );
  aquifer.position.y = -0.77;
  aquiferGrp.add(aquifer);
  // faint internal water shimmer plane
  const aqWater = new THREE.Mesh(new THREE.BoxGeometry(GW * 0.96, 0.1, GD * 0.96), glow(0x3aa7d9, 0.14));
  aqWater.position.y = -0.8;
  aquiferGrp.add(aqWater);
  track(aquiferGrp, [0, -0.55, 0]);
  group.add(aquiferGrp);

  // Clay / aquitard layer
  const clayGrp = new THREE.Group();
  const clay = new THREE.Mesh(
    new THREE.BoxGeometry(GW, 0.28, GD),
    std(COL.clay, { roughness: 0.85, metalness: 0.05 })
  );
  clay.position.y = -0.38;
  clayGrp.add(clay);
  track(clayGrp, [0, -0.18, 0]);
  group.add(clayGrp);

  // Topsoil layer with terrain detail (everything surface rides with it)
  const topGrp = new THREE.Group();
  const topsoil = new THREE.Mesh(
    new THREE.BoxGeometry(GW, 0.24, GD),
    std(COL.topsoil, { roughness: 0.9, metalness: 0.02 })
  );
  topsoil.position.y = -0.12;
  topGrp.add(topsoil);

  // Fishpond water rectangles + dikes
  const pondMat = std(COL.water, { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x0a2e44, emissiveIntensity: 0.5 });
  const dikeMat = std(COL.dike, { roughness: 0.95, metalness: 0 });
  const ponds = [
    { x: -1.15, z: -0.55, w: 1.5, d: 1.15 },
    { x: 0.75, z: -0.85, w: 1.3, d: 0.85 },
    { x: 1.35, z: 0.55, w: 1.1, d: 0.95 },
  ];
  for (const p of ponds) {
    const pond = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.04, p.d), pondMat);
    pond.position.set(p.x, 0.02, p.z);
    topGrp.add(pond);
    // perimeter dikes
    const t = 0.07;
    const mk = (w, d, x, z) => {
      const dk = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), dikeMat);
      dk.position.set(x, 0.045, z);
      topGrp.add(dk);
    };
    mk(p.w + t * 2, t, p.x, p.z - p.d / 2 - t / 2);
    mk(p.w + t * 2, t, p.x, p.z + p.d / 2 + t / 2);
    mk(t, p.d, p.x - p.w / 2 - t / 2, p.z);
    mk(t, p.d, p.x + p.w / 2 + t / 2, p.z);
  }

  // Pump wells (small cylinders + pump boxes) near the sinking zone
  const pumpMat = std(0xb8bec4, { roughness: 0.4, metalness: 0.7 });
  const pumpBoxMat = std(0x37474f, { roughness: 0.6, metalness: 0.4 });
  const pumpPositions = [[-0.55, 0.75], [-0.25, 1.0], [-0.85, 1.05]];
  for (const [px, pz] of pumpPositions) {
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), pumpMat);
    well.position.set(px, 0.11, pz);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.12), pumpBoxMat);
    head.position.set(px, 0.24, pz);
    topGrp.add(well, head);
  }

  /* ---- Deformation (sinking) zones: heat disc + interferometric fringes ---- */
  const sinkZones = [];
  function makeSinkZone(x, z, maxR, hue) {
    const zGrp = new THREE.Group();
    zGrp.position.set(x, 0.012, z);
    const heatMat = glow(hue === 'red' ? COL.red : COL.amber, 0.22);
    const heat = new THREE.Mesh(new THREE.CircleGeometry(maxR * 0.55, 28), heatMat);
    heat.rotation.x = -Math.PI / 2;
    heat.position.y = 0.004;
    zGrp.add(heat);
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = maxR * (0.35 + i * 0.3);
      const ringMat = glow(hue === 'red' ? COL.red : COL.amber, 0.5);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.02, r + 0.02, 48), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.008 + i * 0.002;
      zGrp.add(ring);
      rings.push(ringMat);
    }
    topGrp.add(zGrp);
    sinkZones.push({ grp: zGrp, x, z, heatMat, rings, phase: Math.random() * Math.PI * 2 });
    return zGrp;
  }
  const sinkA = makeSinkZone(-0.55, 0.9, 0.62, 'red');   // near pumps — fastest
  const sinkB = makeSinkZone(1.1, -0.35, 0.5, 'amber');  // municipal average

  /* ---- GNSS ground station (tripod + dome + blink) ---- */
  const gnssGrp = new THREE.Group();
  const legMat = std(0x565f66, { roughness: 0.4, metalness: 0.75 });
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 6), legMat);
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.07, 0.15, Math.sin(a) * 0.07);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = -Math.sin(a) * 0.35;
    gnssGrp.add(leg);
  }
  const gnssDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    std(COL.white, { roughness: 0.3, metalness: 0.2 })
  );
  gnssDome.position.y = 0.32;
  const gnssLedMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 2.0, roughness: 0.4 });
  const gnssLed = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), gnssLedMat);
  gnssLed.position.set(0.05, 0.3, 0.03);
  gnssGrp.add(gnssDome, gnssLed);
  gnssGrp.position.set(0.45, 0, 1.15);
  topGrp.add(gnssGrp);

  track(topGrp, [0, 0.32, 0]);
  group.add(topGrp);

  /* ================= SATELLITE ================= */
  const satGrp = new THREE.Group();
  satGrp.position.set(0, 2.95, 0);
  group.add(satGrp);

  // Bus (gold MLI-wrapped box)
  const busGrp = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.78), std(COL.gold, { roughness: 0.35, metalness: 0.8 }));
  const busTop = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.8), std(COL.busDark, { roughness: 0.5, metalness: 0.6 }));
  busTop.position.y = 0.39;
  busGrp.add(bus, busTop);
  track(busGrp, [0, 0, 0]);
  satGrp.add(busGrp);

  // Star tracker + beacon on top
  const starGrp = new THREE.Group();
  const stBaffle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 12), std(0x22292c, { roughness: 0.4, metalness: 0.6 }));
  stBaffle.rotation.z = 0.5;
  stBaffle.position.set(-0.15, 0.47, 0);
  const beaconMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 2.2, roughness: 0.4 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), beaconMat);
  beacon.position.set(0.18, 0.45, 0.2);
  starGrp.add(stBaffle, beacon);
  track(starGrp, [0, 0.55, 0]);
  satGrp.add(starGrp);

  // SAR antenna panel (big slanted radar panel under the bus)
  const sarGrp = new THREE.Group();
  const sarPanel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.85), std(COL.sar, { roughness: 0.45, metalness: 0.55 }));
  sarGrp.add(sarPanel);
  // radiator grid lines on the panel face
  const sarLineMat = std(COL.sarGrid, { emissive: COL.sarGrid, emissiveIntensity: 0.9, roughness: 0.5 });
  for (let i = 0; i < 5; i++) {
    const ln = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.012, 0.02), sarLineMat);
    ln.position.set(0, -0.03, -0.32 + i * 0.16);
    sarGrp.add(ln);
  }
  sarGrp.position.set(0.1, -0.45, 0.1);
  sarGrp.rotation.z = 0.18; // side-looking geometry (Sentinel-1 looks off-nadir)
  track(sarGrp, [0, -0.75, 0]);
  satGrp.add(sarGrp);

  // Solar wings (two, each 2 panels)
  const wingMat = std(COL.solar, { roughness: 0.25, metalness: 0.6, emissive: 0x0d2038, emissiveIntensity: 0.4 });
  const wingFrameMat = std(COL.solarFrame, { roughness: 0.4, metalness: 0.5 });
  function makeWing(side) {
    const wGrp = new THREE.Group();
    const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), wingFrameMat);
    yoke.rotation.z = Math.PI / 2;
    yoke.position.x = side * 0.45;
    wGrp.add(yoke);
    for (let i = 0; i < 2; i++) {
      const px = side * (0.75 + i * 0.82);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.025, 0.95), wingFrameMat);
      frame.position.set(px, 0, 0);
      const cells = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.012, 0.89), wingMat);
      cells.position.set(px, 0.012, 0);
      wGrp.add(frame, cells);
      // cell dividers
      for (let c = 0; c < 3; c++) {
        const div = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.89), wingFrameMat);
        div.position.set(px - 0.24 + c * 0.24, 0.016, 0);
        wGrp.add(div);
      }
    }
    return wGrp;
  }
  const wingL = makeWing(-1);
  const wingR = makeWing(1);
  track(wingL, [-1.1, 0.12, 0]);
  track(wingR, [1.1, 0.12, 0]);
  satGrp.add(wingL, wingR);

  /* ================= RADAR BEAM + PULSES ================= */
  // Beam cone from the SAR panel to the ground target
  const beamMat = glow(COL.teal, 0.1);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.34, 1, 20, 1, true), beamMat);
  group.add(beam);

  // Travelling pulses (small bright spheres down the beam)
  const PULSE_N = 4;
  const pulseMat = glow(0x9ff5e9, 0.95);
  const pulses = [];
  for (let i = 0; i < PULSE_N; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), pulseMat.clone());
    group.add(p);
    pulses.push(p);
  }

  // Ground-hit ring pool (expanding ring where a pulse lands)
  const hitRings = [];
  for (let i = 0; i < 4; i++) {
    const m = glow(COL.teal, 0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), m);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    group.add(ring);
    hitRings.push({ mesh: ring, mat: m, birth: -10 });
  }
  let hitIdx = 0;

  /* ================= HOLOGRAPHIC READOUT ================= */
  const holoCanvas = document.createElement('canvas');
  holoCanvas.width = 512; holoCanvas.height = 168;
  const hctx = holoCanvas.getContext('2d');
  const holoTex = new THREE.CanvasTexture(holoCanvas);
  holoTex.colorSpace = THREE.SRGBColorSpace;
  const holoMat = new THREE.SpriteMaterial({ map: holoTex, transparent: true, opacity: 0.95, depthWrite: false });
  const holo = new THREE.Sprite(holoMat);
  holo.raycast = () => {}; // hologram is glass — never blocks hotspot occlusion rays
  holo.scale.set(1.9, 0.62, 1);
  holo.position.set(-1.85, 1.25, 1.15);
  group.add(holo);
  // tether line from the readout down to the fast-sinking zone
  const tetherMat = glow(COL.amber, 0.4);
  const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), tetherMat);
  group.add(tether);

  const HOLO_LINES = [
    { big: '−70.2 mm/yr', small: 'Municipal mean velocity' },
    { big: '−124.5 mm/yr', small: 'Near pumping zones' },
    { big: 'Sentinel-1', small: 'C-band SAR • 6-day revisit' },
  ];
  let holoIdx = -1;
  function drawHolo(i) {
    hctx.clearRect(0, 0, 512, 168);
    // holo frame
    hctx.strokeStyle = 'rgba(45,212,191,0.9)';
    hctx.lineWidth = 3;
    hctx.strokeRect(6, 6, 500, 156);
    hctx.fillStyle = 'rgba(11,19,21,0.55)';
    hctx.fillRect(6, 6, 500, 156);
    // corner ticks
    hctx.fillStyle = 'rgba(45,212,191,0.9)';
    hctx.fillRect(6, 6, 26, 5); hctx.fillRect(6, 6, 5, 26);
    hctx.fillRect(480, 157, 26, 5); hctx.fillRect(501, 136, 5, 26);
    hctx.textAlign = 'center';
    hctx.fillStyle = i === 1 ? '#f59e0b' : '#2dd4bf';
    hctx.font = '700 54px "Space Grotesk", sans-serif';
    hctx.fillText(HOLO_LINES[i].big, 256, 82);
    hctx.fillStyle = 'rgba(231,242,240,0.85)';
    hctx.font = '400 26px "Inter", sans-serif';
    hctx.fillText(HOLO_LINES[i].small, 256, 128);
    holoTex.needsUpdate = true;
  }

  /* ================= contract helpers ================= */
  const antTip = new THREE.Vector3();   // beam origin (SAR panel face)
  const target = new THREE.Vector3();   // beam ground target
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();

  function setExploded(k) {
    kExplode = k;
    for (const p of parts) {
      _v.copy(p.off).multiplyScalar(k);
      p.obj.position.copy(p.obj.userData.basePos).add(_v);
    }
  }

  function tick(t) {
    const live = 1 - kExplode * 0.92; // beam & pulses fade out when exploded

    // Satellite gentle bob + solar-wing sun tracking
    satGrp.position.y = 2.95 + Math.sin(t * 0.55) * 0.05;
    satGrp.rotation.y = Math.sin(t * 0.22) * 0.06;
    wingL.rotation.x = Math.sin(t * 0.3) * 0.25;
    wingR.rotation.x = Math.sin(t * 0.3) * 0.25;

    // Beacon + GNSS blinks
    beaconMat.emissiveIntensity = (t % 1.4) < 0.14 ? 3.0 : 0.5;
    gnssLedMat.emissiveIntensity = ((t + 0.6) % 1.1) < 0.12 ? 3.2 : 0.4;

    // Beam sweep: ground target walks across the fishpond belt
    const tx = Math.sin(t * 0.33) * 1.7;
    const tz = 0.45 + Math.sin(t * 0.21) * 0.55;
    target.set(tx, 0.02, tz);
    sarGrp.getWorldPosition(antTip);
    antTip.y -= 0.06;

    dir.copy(target).sub(antTip);
    const len = dir.length();
    mid.copy(antTip).addScaledVector(dir, 0.5);
    beam.position.copy(mid);
    beam.scale.set(1, len, 1);
    beam.quaternion.setFromUnitVectors(up, dir.normalize());
    beamMat.opacity = (0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 5.2))) * live;

    // Pulses race down the beam; landing spawns an expanding hit ring
    for (let i = 0; i < PULSE_N; i++) {
      const phase = (t * 0.55 + i / PULSE_N) % 1;
      const p = pulses[i];
      p.position.copy(antTip).addScaledVector(dir, phase * len);
      const s = (0.75 + 0.5 * Math.sin(phase * Math.PI)) * live;
      p.scale.setScalar(Math.max(s, 0.001));
      p.material.opacity = 0.95 * live;
      if (phase > 0.985 && t - hitRings[hitIdx].birth > 0.5 && live > 0.5) {
        const hr = hitRings[hitIdx];
        hr.birth = t;
        hr.mesh.position.set(tx, 0.03, tz);
        hr.mesh.visible = true;
        hitIdx = (hitIdx + 1) % hitRings.length;
      }
    }
    for (const hr of hitRings) {
      const age = t - hr.birth;
      if (age < 0 || age > 1.3) { hr.mesh.visible = false; continue; }
      hr.mesh.scale.setScalar(0.25 + age * 1.5);
      hr.mat.opacity = 0.7 * (1 - age / 1.3);
    }

    // Interferometric fringes breathe; hotter when the beam sweeps close
    for (const z of sinkZones) {
      const d = Math.hypot(tx - z.x, tz - z.z);
      const prox = Math.max(0, 1 - d / 1.1);
      const breathe = 0.5 + 0.5 * Math.sin(t * 2.4 + z.phase);
      z.heatMat.opacity = 0.12 + 0.1 * breathe + 0.3 * prox;
      z.grp.scale.setScalar(1 + 0.06 * breathe + 0.12 * prox);
      z.rings.forEach((rm, i) => {
        rm.opacity = (0.28 + 0.2 * Math.sin(t * 2.4 + z.phase - i * 0.7)) * (0.6 + 0.9 * prox);
      });
    }

    // Readout cycles every ~2.6 s; tether tracks the fast-sinking zone
    const idx = Math.floor(t / 2.6) % HOLO_LINES.length;
    if (idx !== holoIdx) { holoIdx = idx; drawHolo(idx); }
    holoMat.opacity = 0.85 + 0.1 * Math.sin(t * 3.1);
    const zoneW = new THREE.Vector3();
    sinkA.getWorldPosition(zoneW);
    dir.copy(holo.position).sub(zoneW);
    const tl = dir.length();
    tether.position.copy(zoneW).addScaledVector(dir, 0.5);
    tether.scale.set(1, tl, 1);
    tether.quaternion.setFromUnitVectors(up, dir.normalize());
    tetherMat.opacity = 0.28 + 0.12 * Math.sin(t * 3.1);
  }

  const hotspots = [
    { title: 'SAR Antenna (C-band)', desc: 'Radar panel that images the ground through clouds and at night — the raw material of every subsidence map.', pos: [0.1, 2.5, 0.1], obj: sarGrp },
    { title: 'GNSS Ground Station', desc: 'A u-blox ZED-F9P reference receiver (with NAMRIA PageNET) that anchors satellite pixels to surveyed truth.', pos: [0.45, 0.2, 1.15], obj: gnssGrp },
    { title: 'PS-InSAR Sinking Zone', desc: '−124.5 mm/yr near pumping zones — persistent-scatterer fringes flag where the aquifer is compacting fastest.', pos: [-0.55, 0.1, 0.9], obj: sinkA },
    { title: 'Municipal Subsidence Zone', desc: 'Bulacan sank up to 109 mm/yr (2014–2020) — the fastest measured in the Philippines.', pos: [1.1, 0.1, -0.35], obj: sinkB },
  ];

  return { group, tick, setExploded, hotspots };
}
