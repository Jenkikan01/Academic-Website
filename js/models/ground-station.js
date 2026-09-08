// ground-station.js — BANTAY-TUBIG (Ground Layer)
// Cutaway aquifer diorama: a piezometer whose water column falls and
// recovers, a solar LoRa node pushing glowing telemetry packets to a
// LoRaWAN gateway and up to the cloud, and an EC sensor that flashes
// amber as the saltwater-intrusion front sweeps past.
import * as THREE from 'three';

const COL = {
  topsoil: 0x4a5d3a,
  clay: 0x8a6d3b,
  aquifer: 0x2b6d8f,
  deep: 0x1d4a63,
  pvc: 0xe8ecee,
  waterCol: 0x38bdf8,
  pole: 0x3d464c,
  panel: 0x1e3a5f,
  panelFrame: 0x141a1e,
  enclosure: 0x2c3a3d,
  antenna: 0x101516,
  gwBody: 0xe8ecee,
  teal: 0x2dd4bf,
  amber: 0xf59e0b,
  salt: 0xf59e0b,
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

export function createGroundStation() {
  const group = new THREE.Group();
  const parts = [];
  const _v = new THREE.Vector3();
  let kExplode = 0;

  function track(obj, off) {
    obj.userData.basePos = obj.position.clone();
    parts.push({ obj, off: new THREE.Vector3(off[0], off[1], off[2]) });
    return obj;
  }

  /* ================= CUTAWAY STRATA (z: -1.3 .. 0.15, cut face at +z) ================= */
  const BW = 4.4, BD = 1.45, BZ = -0.575; // block width/depth/center-z

  function makeLayer(h, yCenter, color, opts, off) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(BW, h, BD), std(color, opts));
    m.position.set(0, yCenter, BZ);
    g.add(m);
    track(g, off);
    group.add(g);
    return g;
  }

  const topGrp = makeLayer(0.32, -0.16, COL.topsoil, { roughness: 0.95, metalness: 0.02 }, [0, 0.5, 0]);
  makeLayer(0.42, -0.53, COL.clay, { roughness: 0.9, metalness: 0.05 }, [0, 0.18, 0]);
  const aqGrp = makeLayer(0.52, -1.0, COL.aquifer, { roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.82 }, [0, -0.2, 0]);
  makeLayer(0.34, -1.43, COL.deep, { roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.9 }, [0, -0.6, 0]);

  // Water table slab inside the aquifer (rises/falls opposite the piezo)
  const wtMat = glow(0x3aa7d9, 0.22);
  const waterTable = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.96, 0.16, BD * 0.9), wtMat);
  waterTable.position.set(0, -1.02, BZ);
  aqGrp.add(waterTable); // child: rides with the aquifer layer on explode

  // Saltwater intrusion front — translucent amber wall sweeping the aquifer
  const saltMat = glow(COL.salt, 0.16);
  const saltFront = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.48, 0.03), saltMat);
  saltFront.position.set(-2.0, -1.0, 0.17);
  aqGrp.add(saltFront);

  /* ================= PIEZOMETER (monitoring well) ================= */
  const piezoGrp = new THREE.Group();
  const PZX = -0.7, PZZ = 0.28;
  // surface collar + protective cap
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.08, 14), std(0x565f66, { metalness: 0.7, roughness: 0.35 }));
  collar.position.set(PZX, 0.04, PZZ);
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 2.1, 14, 1, true),
    std(COL.pvc, { roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  tube.position.set(PZX, -0.55, PZZ);
  // inner water column — height animates
  const wcMat = std(COL.waterCol, { roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.85, emissive: 0x0b3d5c, emissiveIntensity: 0.7 });
  const waterCol = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 1, 12), wcMat);
  waterCol.position.set(PZX, -1.0, PZZ);
  // water surface meniscus dot
  const menMat = glow(0x9fdcff, 0.9);
  const meniscus = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.012, 12), menMat);
  meniscus.position.set(PZX, -0.9, PZZ);
  // logger cap (Solinst-style) + cable
  const logger = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), std(0x101516, { roughness: 0.5, metalness: 0.3 }));
  logger.position.set(PZX, 0.32, PZZ);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 6), std(0x101516));
  cable.position.set(PZX, 0.05, PZZ);
  const logLedMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 2, roughness: 0.4 });
  const logLed = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), logLedMat);
  logLed.position.set(PZX + 0.03, 0.38, PZZ + 0.02);
  piezoGrp.add(collar, tube, waterCol, meniscus, logger, cable, logLed);
  track(piezoGrp, [-0.55, 0.45, 0.4]);
  group.add(piezoGrp);

  /* ================= SOLAR LoRa SENSOR NODE ================= */
  const nodeBase = new THREE.Group();
  const NX = 0.85, NZ = -0.25;
  // pole (stays planted on explode)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.5, 12), std(COL.pole, { metalness: 0.7, roughness: 0.4 }));
  pole.position.set(NX, 0.75, NZ);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.07, 14), std(0x1c2326, { roughness: 0.7 }));
  foot.position.set(NX, 0.035, NZ);
  nodeBase.add(pole, foot);
  track(nodeBase, [0, 0, 0]);
  group.add(nodeBase);

  // solar panel kit (tilted)
  const solarGrp = new THREE.Group();
  const spFrame = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.03, 0.4), std(COL.panelFrame, { roughness: 0.4, metalness: 0.5 }));
  const spCells = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.014, 0.34), std(COL.panel, { roughness: 0.25, metalness: 0.6, emissive: 0x0d2038, emissiveIntensity: 0.4 }));
  spCells.position.y = 0.012;
  solarGrp.add(spFrame, spCells);
  for (let c = 0; c < 2; c++) {
    const div = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.34), std(COL.panelFrame));
    div.position.set(-0.12 + c * 0.24, 0.016, 0);
    solarGrp.add(div);
  }
  solarGrp.position.set(NX, 1.32, NZ);
  solarGrp.rotation.x = -0.42;
  solarGrp.rotation.y = 0.3;
  track(solarGrp, [0.45, 0.45, -0.2]);
  group.add(solarGrp);

  // sensor enclosure (IP67 box)
  const encGrp = new THREE.Group();
  const enc = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.14), std(COL.enclosure, { roughness: 0.55, metalness: 0.35 }));
  const encLedMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 2.2, roughness: 0.4 });
  const encLed = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), encLedMat);
  encLed.position.set(0.1, 0.06, 0.075);
  encGrp.add(enc, encLed);
  encGrp.position.set(NX, 0.95, NZ + 0.09);
  track(encGrp, [0, 0.1, 0.55]);
  group.add(encGrp);

  // whip antenna
  const antGrp = new THREE.Group();
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.42, 8), std(COL.antenna, { roughness: 0.8 }));
  whip.position.y = 0.21;
  const whipTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), std(COL.antenna));
  whipTip.position.y = 0.43;
  antGrp.add(whip, whipTip);
  antGrp.position.set(NX, 1.52, NZ);
  track(antGrp, [0, 0.6, 0]);
  group.add(antGrp);

  /* ================= LoRaWAN GATEWAY MAST (background) ================= */
  const gwBase = new THREE.Group();
  const GX = 1.85, GZ = -1.0;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, 2.3, 12), std(COL.pole, { metalness: 0.7, roughness: 0.4 }));
  mast.position.set(GX, 1.15, GZ);
  const gwFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.08, 14), std(0x1c2326, { roughness: 0.7 }));
  gwFoot.position.set(GX, 0.04, GZ);
  gwBase.add(mast, gwFoot);
  track(gwBase, [0, 0, 0]);
  group.add(gwBase);

  const gwBoxGrp = new THREE.Group();
  const gwBox = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.12), std(COL.enclosure, { roughness: 0.55, metalness: 0.35 }));
  const gwLedMat = std(COL.teal, { emissive: COL.teal, emissiveIntensity: 2.2, roughness: 0.4 });
  const gwLed = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.008), gwLedMat);
  gwLed.position.set(-0.04, -0.06, 0.064);
  gwBoxGrp.add(gwBox, gwLed);
  gwBoxGrp.position.set(GX, 1.55, GZ + 0.08);
  track(gwBoxGrp, [0.5, 0.15, 0.3]);
  group.add(gwBoxGrp);

  const gwAntGrp = new THREE.Group();
  const omni = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.6, 10), std(COL.gwBody, { roughness: 0.35, metalness: 0.2 }));
  omni.position.y = 0.3;
  const omniTip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), std(COL.gwBody));
  omniTip.position.y = 0.62;
  gwAntGrp.add(omni, omniTip);
  gwAntGrp.position.set(GX, 2.28, GZ);
  track(gwAntGrp, [0, 0.6, 0]);
  group.add(gwAntGrp);

  /* ================= EC / SALINITY SENSOR (at the water table) ================= */
  const ecGrp = new THREE.Group();
  const EX = 0.35, EY = -1.0, EZ = 0.2;
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 10), std(0x22292c, { roughness: 0.5, metalness: 0.5 }));
  probe.position.set(EX, EY, EZ);
  const ecLedMat = std(COL.amber, { emissive: COL.amber, emissiveIntensity: 0.6, roughness: 0.4 });
  const ecLed = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), ecLedMat);
  ecLed.position.set(EX, EY + 0.13, EZ);
  const ecCable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.0, 6), std(0x101516));
  ecCable.position.set(EX, EY + 0.6, EZ);
  ecGrp.add(probe, ecLed, ecCable);
  track(ecGrp, [0.35, -0.1, 0.5]);
  group.add(ecGrp);

  /* ================= TELEMETRY PACKETS ================= */
  const nodeTop = new THREE.Vector3(NX, 1.6, NZ);
  const gwTop = new THREE.Vector3(GX, 2.3, GZ);
  const skyPt = new THREE.Vector3(0.6, 3.5, -1.1);
  const curveA = new THREE.QuadraticBezierCurve3(
    nodeTop, new THREE.Vector3((NX + GX) / 2, 2.6, (NZ + GZ) / 2 + 0.4), gwTop);
  const curveB = new THREE.QuadraticBezierCurve3(
    gwTop, new THREE.Vector3(GX - 0.6, 3.3, GZ + 0.2), skyPt);

  const packetMat = glow(COL.teal, 0.95);
  const packets = [];
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), packetMat.clone());
    group.add(p);
    packets.push({ mesh: p, curve: i < 3 ? curveA : curveB, off: (i % 3) / 3 });
  }

  // cloudlet at the uplink terminus
  const cloudMat = glow(COL.teal, 0.35);
  const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), cloudMat);
  cloud.position.copy(skyPt);
  group.add(cloud);

  /* ================= contract ================= */
  function setExploded(k) {
    kExplode = k;
    for (const p of parts) {
      _v.copy(p.off).multiplyScalar(k);
      p.obj.position.copy(p.obj.userData.basePos).add(_v);
    }
  }

  const WC_BOTTOM = -1.62; // piezometer water-column bottom (screen intake)
  function tick(t) {
    const live = 1 - kExplode * 0.9;

    // Piezometer: slow drawdown then recovery (~14 s cycle)
    const ph = (t / 14) % 1;
    const dd = ph < 0.62 ? ph / 0.62 : 1 - (ph - 0.62) / 0.38; // 0→1→0
    const level = -0.78 - dd * 0.62; // water surface y (-0.78 … -1.40)
    const h = Math.max(level - WC_BOTTOM, 0.05);
    waterCol.scale.y = h;
    waterCol.position.y = WC_BOTTOM + h / 2;
    meniscus.position.y = level;
    menMat.opacity = (0.5 + 0.4 * Math.sin(t * 4)) * live + 0.2;
    // aquifer slab shadows the well level
    waterTable.position.y = level - 0.12;
    wtMat.opacity = (0.16 + 0.1 * (1 - dd)) * live + 0.06;

    // Logger / node / gateway LEDs
    logLedMat.emissiveIntensity = ((t + 0.3) % 1.6) < 0.12 ? 3 : 0.4;
    encLedMat.emissiveIntensity = (t % 1.2) < 0.1 ? 3.2 : 0.5;
    gwLedMat.emissiveIntensity = ((t + 0.7) % 0.9) < 0.14 ? 3.2 : 0.6;

    // Telemetry packets: node → gateway → cloud
    for (const pk of packets) {
      const p = (t * 0.28 + pk.off) % 1;
      pk.mesh.position.copy(pk.curve.getPoint(p));
      const s = (0.7 + 0.5 * Math.sin(p * Math.PI)) * live;
      pk.mesh.scale.setScalar(Math.max(s, 0.001));
      pk.mesh.material.opacity = 0.95 * live;
    }
    cloudMat.opacity = (0.22 + 0.18 * (0.5 + 0.5 * Math.sin(t * 2.2))) * live;
    cloud.scale.setScalar(1 + 0.15 * Math.sin(t * 2.2));

    // Saltwater front sweeps the aquifer; EC sensor alarms when it passes
    const fx = -2.0 + 4.0 * ((t / 16) % 1);
    saltFront.position.x = fx;
    const edge = Math.min((t / 16) % 1, 1 - ((t / 16) % 1)); // fade at loop ends
    saltMat.opacity = Math.min(0.22, edge * 2.2) * live;
    const prox = Math.max(0, 1 - Math.abs(fx - EX) / 0.5);
    ecLedMat.emissiveIntensity = 0.5 + prox * (2.2 + 1.2 * Math.sin(t * 9));
    ecLed.scale.setScalar(1 + prox * 0.5 * (0.5 + 0.5 * Math.sin(t * 9)));
  }

  const hotspots = [
    { title: 'Piezometer Tube', desc: 'A monitoring well giving the aquifer a pulse — 6 wells track the water table that drives subsidence.', pos: [PZX, -0.4, PZZ], obj: piezoGrp },
    { title: 'Water-Level Logger', desc: 'A Solinst-class vented logger recording the drawdown–recovery cycle you can watch in the column below.', pos: [PZX, 0.35, PZZ], obj: piezoGrp, anchorOffset: [0, 0.7, 0] },
    { title: 'Solar Kit', desc: 'A low-cost local solar kit (₱8,000–20,000) — panel + LiFePO4 battery keeps every node reporting for years, off-grid.', pos: [NX, 1.35, NZ], obj: solarGrp },
    { title: 'LoRa Node Antenna', desc: 'Dragino-class AS923 node — each reading hops kilometers on a whisper of radio power.', pos: [NX, 1.7, NZ], obj: antGrp },
    { title: 'LoRaWAN Gateway', desc: 'One of 2–3 private gateways, backed by the public Packetworx network (or DOST-ASTI arQ backhaul) — aggregating ~40 field nodes.', pos: [GX, 1.6, GZ], obj: gwBoxGrp },
    { title: 'EC / Salinity Sensor', desc: 'Flashes amber as the saltwater-intrusion front passes — the aquifer’s early-warning for the 700 ha of riceland already lost.', pos: [EX, EY + 0.1, EZ], obj: ecGrp },
  ];

  return { group, tick, setExploded, hotspots };
}
