// recharge.js — SIBOL (Action Layer)
// Managed aquifer recharge diorama: an injection well pumps filtered
// water DOWN, a school roof harvests rain into a tank feeding an
// infiltration basin, and the aquifer's water table visibly rises —
// the cone of depression heals and a piezometer confirms recovery.
import * as THREE from 'three';

const COL = {
  topsoil: 0x4a5d3a,
  clay: 0x8a6d3b,
  aquifer: 0x2b6d8f,
  casing: 0xb8bec4,
  headworks: 0x37474f,
  pipe: 0x565f66,
  water: 0x38bdf8,
  pond: 0x1d5f8a,
  school: 0xd8cfc0,
  roof: 0xb3541e,
  tank: 0x2c3a3d,
  teal: 0x2dd4bf,
  amber: 0xf59e0b,
  pvc: 0xe8ecee,
};

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3, ...opts });
}
function glow(color, opacity = 0.5) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

export function createRecharge() {
  const group = new THREE.Group();
  const parts = [];
  const _v = new THREE.Vector3();
  let kExplode = 0;

  function track(obj, off) {
    obj.userData.basePos = obj.position.clone();
    parts.push({ obj, off: new THREE.Vector3(off[0], off[1], off[2]) });
    return obj;
  }

  /* ================= CUTAWAY STRATA (z: -1.3 .. 0.15, cut face +z) ================= */
  const BW = 4.6, BD = 1.45, BZ = -0.575;

  function makeLayer(h, yCenter, color, opts, off) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(BW, h, BD), std(color, opts));
    m.position.set(0, yCenter, BZ);
    g.add(m);
    track(g, off);
    group.add(g);
    return { grp: g, mesh: m };
  }

  const top = makeLayer(0.34, -0.17, COL.topsoil, { roughness: 0.95, metalness: 0.02 }, [0, 0.5, 0]);
  makeLayer(0.44, -0.56, COL.clay, { roughness: 0.9, metalness: 0.05 }, [0, 0.18, 0]);
  const aq = makeLayer(0.62, -1.09, COL.aquifer, { roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.78 }, [0, -0.2, 0]);
  makeLayer(0.3, -1.55, 0x1d4a63, { roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.9 }, [0, -0.6, 0]);

  // Rising water table slab (child of the aquifer layer)
  const wtMat = glow(0x3aa7d9, 0.26);
  const waterTable = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.96, 0.2, BD * 0.9), wtMat);
  waterTable.position.set(0, -1.3, BZ);
  aq.grp.add(waterTable);

  // Cone of depression (heals as recharge works) — amber wire cone
  const coneMat = glow(COL.amber, 0.18);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.55, 28, 1, true), coneMat);
  cone.rotation.x = Math.PI; // apex down
  cone.position.set(-0.35, -1.0, 0.05);
  aq.grp.add(cone);

  /* ================= INJECTION / RECHARGE WELL ================= */
  const WX = -1.55, WZ = -0.45;
  // casing (semi-transparent so the descending flow is visible)
  const casingGrp = new THREE.Group();
  const casing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 2.0, 14, 1, true),
    std(COL.casing, { roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  casing.position.set(WX, -0.7, WZ);
  const screenMat = glow(COL.teal, 0.25);
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.4, 14, 1, true), screenMat);
  screen.position.set(WX, -1.45, WZ);
  casingGrp.add(casing, screen);
  track(casingGrp, [0, -0.3, 0]);
  group.add(casingGrp);

  // headworks: filtration skid + control box + feed pipe
  const headGrp = new THREE.Group();
  const skid = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.34), std(COL.headworks, { roughness: 0.5, metalness: 0.5 }));
  skid.position.set(WX + 0.34, 0.12, WZ);
  const filter1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.34, 12), std(0x9fb4bd, { metalness: 0.6, roughness: 0.35 }));
  filter1.position.set(WX + 0.22, 0.4, WZ - 0.06);
  const filter2 = filter1.clone();
  filter2.position.set(WX + 0.44, 0.4, WZ + 0.06);
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 10), std(COL.pipe, { metalness: 0.7, roughness: 0.35 }));
  riser.position.set(WX, 0.18, WZ);
  const hwLedMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 2.2, roughness: 0.4 });
  const hwLed = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), hwLedMat);
  hwLed.position.set(WX + 0.34, 0.28, WZ + 0.18);
  headGrp.add(skid, filter1, filter2, riser, hwLed);
  track(headGrp, [-0.4, 0.55, -0.25]);
  group.add(headGrp);

  // descending flow particles inside the casing
  const flowMat = glow(COL.water, 0.95);
  const wellFlow = [];
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), flowMat.clone());
    group.add(p);
    wellFlow.push(p);
  }

  /* ================= SCHOOL + RAINWATER HARVESTING ================= */
  const SX = 0.35, SZ = -0.95;
  const schoolGrp = new THREE.Group();
  const bldg = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.45, 0.55), std(COL.school, { roughness: 0.8, metalness: 0.02 }));
  bldg.position.set(SX, 0.225, SZ);
  // roof prism
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-0.5, 0); roofShape.lineTo(0, 0.26); roofShape.lineTo(0.5, 0); roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 0.62, bevelEnabled: false });
  roofGeo.translate(0, 0, -0.31);
  const roof = new THREE.Mesh(roofGeo, std(COL.roof, { roughness: 0.6, metalness: 0.15 }));
  roof.position.set(SX, 0.45, SZ);
  // gutters along the roof eaves
  const gutterMat = std(COL.pipe, { metalness: 0.7, roughness: 0.35 });
  const gutter = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 8), gutterMat);
  gutter.rotation.x = Math.PI / 2;
  gutter.position.set(SX + 0.48, 0.44, SZ);
  // windows
  const winMat = std(0x9fd8cf, { emissive: 0x2dd4bf, emissiveIntensity: 0.35, roughness: 0.3 });
  for (const wx of [-0.22, 0.1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.02), winMat);
    win.position.set(SX + wx + 0.1, 0.26, SZ + 0.28);
    schoolGrp.add(win);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.02), std(0x6b4f2a, { roughness: 0.8 }));
  door.position.set(SX - 0.28, 0.12, SZ + 0.28);
  schoolGrp.add(bldg, roof, gutter, door);
  track(schoolGrp, [0, 0, 0]);
  group.add(schoolGrp);

  // roof flies on explode (classic)
  track(roof, [0, 0.7, 0]);

  // rainwater tank + downpipe + feed to the basin
  const tankGrp = new THREE.Group();
  const TX = 1.05, TZ = -0.95;
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 18), std(COL.tank, { roughness: 0.45, metalness: 0.4 }));
  tank.position.set(TX, 0.25, TZ);
  const tankWaterMat = glow(COL.water, 0.3);
  const tankWater = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.34, 14), tankWaterMat);
  tankWater.position.set(TX, 0.22, TZ);
  const downpipe = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.45, 8), gutterMat);
  downpipe.position.set(SX + 0.48, 0.22, SZ + 0.28);
  downpipe.rotation.z = 0.12;
  tankGrp.add(tank, tankWater, downpipe);
  track(tankGrp, [0.5, 0.25, -0.3]);
  group.add(tankGrp);

  /* ================= INFILTRATION BASIN ================= */
  const BSX = 1.35, BSZ = -0.1;
  const basinGrp = new THREE.Group();
  // excavated rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 10, 36), std(COL.topsoil, { roughness: 0.95 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(BSX, 0.02, BSZ);
  rim.scale.z = 0.6;
  const pondMat = std(COL.pond, { roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.85, emissive: 0x0a2e44, emissiveIntensity: 0.6 });
  const pond = new THREE.Mesh(new THREE.CircleGeometry(0.58, 32), pondMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(BSX, 0.015, BSZ);
  basinGrp.add(rim, pond);
  // ripple rings on the pond
  const ripples = [];
  for (let i = 0; i < 3; i++) {
    const rm = glow(0x9fdcff, 0.5);
    const r = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.34, 32), rm);
    r.rotation.x = -Math.PI / 2;
    r.position.set(BSX, 0.025, BSZ);
    basinGrp.add(r);
    ripples.push({ mesh: r, mat: rm, off: i / 3 });
  }
  track(basinGrp, [0.35, 0.3, 0.35]);
  group.add(basinGrp);

  // feed pipe tank → basin (gentle arc of two segments)
  const feedGrp = new THREE.Group();
  const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), gutterMat);
  seg1.position.set(1.2, 0.1, -0.55);
  seg1.rotation.x = Math.PI / 2 - 0.25;
  const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), gutterMat);
  seg2.position.set(1.28, 0.05, -0.3);
  seg2.rotation.x = Math.PI / 2 - 0.5;
  feedGrp.add(seg1, seg2);
  track(feedGrp, [0.25, 0.15, 0]);
  group.add(feedGrp);

  // soak particles: pond → aquifer
  const soakMat = glow(COL.water, 0.85);
  const soaks = [];
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), soakMat.clone());
    group.add(p);
    soaks.push({ mesh: p, off: i / 6, ang: (i / 6) * Math.PI * 2 });
  }

  /* ================= RECOVERY PIEZOMETER ================= */
  const pzGrp = new THREE.Group();
  const PX = 2.0, PZ = 0.25;
  const pzTube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 1.85, 12, 1, true),
    std(COL.pvc, { roughness: 0.35, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  pzTube.position.set(PX, -0.45, PZ);
  const pzWaterMat = std(COL.water, { roughness: 0.15, transparent: true, opacity: 0.85, emissive: 0x0b3d5c, emissiveIntensity: 0.7 });
  const pzWater = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1, 10), pzWaterMat);
  pzWater.position.set(PX, -0.9, PZ);
  const pzCap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.08, 12), std(0x565f66, { metalness: 0.7, roughness: 0.35 }));
  pzCap.position.set(PX, 0.5, PZ);
  const okLedMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 1.8, roughness: 0.4 });
  const okLed = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), okLedMat);
  okLed.position.set(PX + 0.04, 0.55, PZ + 0.02);
  pzGrp.add(pzTube, pzWater, pzCap, okLed);
  track(pzGrp, [0.5, 0.4, 0.35]);
  group.add(pzGrp);

  /* ================= contract ================= */
  function setExploded(k) {
    kExplode = k;
    for (const p of parts) {
      _v.copy(p.off).multiplyScalar(k);
      p.obj.position.copy(p.obj.userData.basePos).add(_v);
    }
  }

  const PZ_BOTTOM = -1.35;
  function tick(t) {
    const live = 1 - kExplode * 0.9;

    // 16 s recovery loop: the water table climbs, the cone heals,
    // the land surface lifts a breath, the piezometer confirms.
    const ph = (t / 16) % 1;
    const rise = ph < 0.85 ? ph / 0.85 : 1 - (ph - 0.85) / 0.15; // up, quick reset
    const eased = rise * rise * (3 - 2 * rise);                  // smoothstep
    const wtY = -1.32 + eased * 0.42;
    waterTable.position.y = wtY;
    wtMat.opacity = (0.16 + 0.14 * eased) * live + 0.05;
    // cone of depression shrinks as the aquifer refills
    cone.scale.set(1 - eased * 0.55, 1 - eased * 0.7, 1 - eased * 0.55);
    coneMat.opacity = (0.2 * (1 - eased * 0.8)) * live;
    // the ground surface subtly lifts with recovery (preserving explode offset)
    const topPart = parts.find((p) => p.obj === top.grp);
    top.grp.position.y = top.grp.userData.basePos.y + topPart.off.y * kExplode + eased * 0.045;
    // piezometer column rises in step
    const lvl = wtY + 0.12;
    const h = Math.max(lvl - PZ_BOTTOM, 0.05);
    pzWater.scale.y = h;
    pzWater.position.y = PZ_BOTTOM + h / 2;

    // headworks + confirmation LEDs
    hwLedMat.emissiveIntensity = (t % 1.1) < 0.12 ? 3 : 0.6;
    okLedMat.emissiveIntensity = 0.6 + eased * (1.6 + 0.8 * Math.sin(t * 4));

    // Injection flow: particles pour DOWN the well casing
    for (let i = 0; i < wellFlow.length; i++) {
      const p = (t * 0.5 + i / wellFlow.length) % 1;
      const y = 0.3 - p * 1.85;
      wellFlow[i].position.set(WX, y, WZ);
      const s = (0.75 + 0.4 * Math.sin(p * Math.PI)) * live;
      wellFlow[i].scale.setScalar(Math.max(s, 0.001));
      wellFlow[i].material.opacity = 0.95 * live;
    }
    screenMat.opacity = (0.18 + 0.15 * (0.5 + 0.5 * Math.sin(t * 3))) * live;

    // Basin ripples + soak particles
    for (const rp of ripples) {
      const p = (t * 0.45 + rp.off) % 1;
      rp.mesh.scale.setScalar(0.3 + p * 1.7);
      rp.mat.opacity = 0.55 * (1 - p) * live;
    }
    for (const sk of soaks) {
      const p = (t * 0.32 + sk.off) % 1;
      const r = 0.35 * (1 - p * 0.6);
      sk.mesh.position.set(BSX + Math.cos(sk.ang) * r, 0.0 - p * 1.05, BSZ + Math.sin(sk.ang) * r * 0.7);
      sk.mesh.material.opacity = 0.85 * live * (1 - p * 0.5);
    }
    // tank water level sloshes gently
    tankWater.scale.y = 0.8 + 0.15 * Math.sin(t * 0.9);
    tankWaterMat.opacity = 0.25 + 0.1 * Math.sin(t * 1.3);
  }

  const hotspots = [
    { title: 'Injection Well Headworks', desc: 'Filtration skid + controls push treated water straight into the aquifer — ≥150,000 m³/yr metered recharge target.', pos: [WX + 0.3, 0.35, WZ], obj: headGrp },
    { title: 'Infiltration Basin', desc: 'A shallow recharge pond where monsoon rain soaks down through the vadose zone instead of drowning streets.', pos: [BSX, 0.1, BSZ], obj: basinGrp },
    { title: 'School Rainwater Tank', desc: 'One of 8 school/LGU retrofits: every roof becomes a catchment, gutters feeding storage and the basin.', pos: [TX, 0.3, TZ], obj: tankGrp },
    { title: 'Aquifer (Recovering)', desc: 'Watch the water table rise and the amber cone of depression heal — that lift is subsidence defense working.', pos: [0, -1.05, 0.1], obj: aq.grp },
    { title: 'Recovery Piezometer', desc: 'The proof point: a rising column the community can read — verified from orbit by Sentinel-1.', pos: [PX, -0.3, PZ], obj: pzGrp },
  ];

  return { group, tick, setExploded, hotspots };
}
