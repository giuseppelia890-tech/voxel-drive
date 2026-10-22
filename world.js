/* ================================================================
   VOXEL DRIVE: INFINITE HORIZON — world.js
   Mondo aperto in 3 biomi: Città Neon, Autostrada Infinita, Montagna.
   Terreno a heightfield voxel, piazzole di parcheggio delimitate,
   drag strip, porte drift e percorso consegne off-road.
   ================================================================ */
(function () {
  'use strict';

  window.VD = window.VD || {};
  const { clamp, lerp, smoothstep } = VD.util;

  const PARKING_BAYS = [
    {
      id: 'A', name: 'PARCHEGGIO NEON', x: 120, z: 80, yaw: 0,
      w: 4.2, d: 9.0, color: 0x57e39b, accent: '#57e39b', record: 0
    },
    {
      id: 'B', name: 'AREA DI SOSTA', x: 28, z: 150, yaw: Math.PI / 2,
      w: 4.2, d: 9.0, color: 0xffc857, accent: '#ffc857', record: 0
    },
    {
      id: 'C', name: 'PARCHEGGIO MONTANO', x: -90, z: -130, yaw: 0,
      w: 4.4, d: 9.2, color: 0xff5e9c, accent: '#ff5e9c', record: 0
    }
  ];

  class World {
    constructor(scene) {
      this.scene = scene;
      this.colliders = [];
      this.parkingBays = PARKING_BAYS.map((b) => Object.assign({}, b, { progress: 0, done: false, best: 0 }));
      this.drag = {
        x: 0, stageZ0: -338, stageZ1: -308, startZ: -300, finishZ: 140,
        length: 440, lights: [], state: 'idle'
      };
      this.drift = {
        x: -300, z: 100, radius: 92, duration: 60,
        gates: [
          { x: -300, z: 35 }, { x: -355, z: 62 }, { x: -380, z: 125 },
          { x: -340, z: 185 }, { x: -268, z: 178 }, { x: -238, z: 108 }
        ]
      };
      this.delivery = {
        depot: { x: -330, z: -200, r: 16, h: 6 },
        route: [
          { x: -378, z: -300, r: 15 },
          { x: -445, z: -62, r: 15 },
          { x: -312, z: 232, r: 17 }
        ]
      };
      this.paddock = {
        x: 95, z: -360, padW: 86, padD: 48,
        garage: { x: 95, z: -386, w: 54, d: 14, h: 8 },
        pit: { x: 95, z: -348, r: 7.5 },
        triggerR: 48,
        cars: [], mechanics: []
      };
      this.spawns = {
        free: { x: 0, z: -24, yaw: 0 },
        parking: { x: 120, z: 57, yaw: 0 },
        drag: { x: 0, z: -332, yaw: 0 },
        drift: { x: -240, z: 100, yaw: -Math.PI / 2 },
        delivery: { x: -330, z: -232, yaw: 0 },
        lobby: { x: 24, z: -360, yaw: Math.PI / 2 }
      };
      this.city = { xmin: 40, xmax: 320, zmin: -260, zmax: 260 };
      this.cityRoadsX = [80, 160, 240];
      this.cityRoadsZ = [-200, -120, -40, 40, 120, 200];
      this.xBlocks = [
        { min: 41, max: 74 }, { min: 86, max: 154 }, { min: 166, max: 234 }, { min: 246, max: 319 }
      ];
      this.zBlocks = [
        { min: -259, max: -206 }, { min: -194, max: -126 }, { min: -114, max: -46 },
        { min: -34, max: 34 }, { min: 46, max: 114 }, { min: 126, max: 194 }, { min: 206, max: 259 }
      ];
      this.buildingColliders = this.colliders;
      this._seed = 20261022;
      this._tmpColor = new THREE.Color();
      this.roadMat = null;
      this.parkingMeshes = [];
      this.driftGateMeshes = [];
      this.checkpointMeshes = [];
      this.depotMesh = null;

      /* streaming del mondo: 5x5 chunk da 300 m attorno al giocatore */
      this.chunkSize = 300;
      this.chunkRadius = 2;
      this.chunkSegs = 32;
      this.chunkGroup = null;
      this.chunkPool = [];
      this.activeChunks = new Map();
      this._cx = null;
      this._cz = null;
      this._lastDashZ = null;
      this._lastLampZ = null;
      this._streamTime = 0;
    }

    rand() {
      this._seed = (this._seed * 16807) % 2147483647;
      return (this._seed - 1) / 2147483646;
    }

    randRange(a, b) { return a + this.rand() * (b - a); }
    randInt(n) { return Math.floor(this.rand() * n); }
    pick(arr) { return arr[this.randInt(arr.length)]; }

    /* ------------------------- terreno ------------------------- */
    heightAt(x, z) {
      let h = 0;
      h += Math.sin(x * 0.018) * Math.cos(z * 0.021) * 11;
      h += Math.sin(x * 0.047 + 2.0) * Math.cos(z * 0.039 + 1.0) * 4;
      h += Math.sin((x + z) * 0.085) * 1.1;
      h = Math.max(0, h + 4);

      /* catena montuosa a ovest: onde sovrapposte, dossi e creste (infinita) */
      const mask = smoothstep(40, 220, -x);
      if (mask > 0.001) {
        const ridge =
          15.5 +
          Math.sin(z * 0.019 + 0.9) * 10.5 +
          Math.sin(z * 0.045 - x * 0.013) * 7.0 +
          Math.cos(x * 0.028 + z * 0.011) * 5.5 +
          Math.sin((x + z) * 0.071) * 2.4;
        const bumps =
          Math.sin(x * 0.17) * Math.cos(z * 0.135) * 3.4 +
          Math.sin(x * 0.31 + z * 0.22) * 1.5;
        h += mask * (Math.max(0, ridge) + bumps);
      }

      /* autostrada e città: superfici piatte */
      const hw = 1 - smoothstep(18, 60, Math.abs(x));
      const cityX = smoothstep(30, 70, x) * (1 - smoothstep(300, 380, x));
      const cityZ = 1 - smoothstep(250, 330, Math.abs(z));
      const flat = Math.max(hw, cityX * cityZ);
      h *= (1 - flat);

      /* piazzole: spianate per la precisione millimetrica */
      for (const p of this.parkingBays) {
        const d = Math.hypot(x - p.x, z - p.z);
        const f = 1 - smoothstep(p.d * 2.0, p.d * 3.4, d);
        h *= (1 - f);
      }

      /* piazzale consegne */
      const dep = this.delivery.depot;
      const dd = Math.hypot(x - dep.x, z - dep.z);
      const df = 1 - smoothstep(dep.r * 0.8, dep.r * 1.55, dd);
      if (df > 0) h = lerp(h, dep.h, df);

      /* paddock/lobby fisica e accesso dall'autostrada */
      const pd = Math.hypot(x - this.paddock.x, z - this.paddock.z);
      const pf = 1 - smoothstep(30, 58, pd);
      if (pf > 0) h = lerp(h, 0.12, pf);
      const accessZ = 1 - smoothstep(6, 19, Math.abs(z - this.paddock.z));
      const accessX = smoothstep(2, 18, x) * (1 - smoothstep(98, 128, x));
      const af = accessZ * accessX;
      if (af > 0) h = lerp(h, 0.1, af);

      return Math.round(h / 0.9) * 0.9;
    }

    surfaceAt(x, z) {
      const h = this.heightAt(x, z);
      const offroad = h > 2.2 || x < -55;
      return { offroad, grip: offroad ? 0.86 : 1, height: h };
    }

    isOffroad(x, z) {
      return this.heightAt(x, z) > 1.4 || x < -55;
    }

    zoneName(x, z) {
      if (this.inPaddock(x, z)) return 'PADDOCK';
      if (x < -55) return 'MONTAGNA OFF-ROAD';
      if (Math.abs(x) < 17) return 'AUTOSTRADA INFINITA';
      if (x > 35 && x < 345 && Math.abs(z) < 285) return 'CITTÀ NEON';
      return 'PRATERIA INFINITA';
    }

    inPaddock(x, z) {
      const pad = Math.hypot(x - this.paddock.x, z - this.paddock.z) < this.paddock.triggerR;
      const access = x > 8 && x < 142 && Math.abs(z - this.paddock.z) < 10;
      return pad || access;
    }

    inPit(x, z) {
      return Math.hypot(x - this.paddock.pit.x, z - this.paddock.pit.z) < this.paddock.pit.r;
    }

    build() {
      this.buildTerrain();
      this.buildHighway();
      this.buildCity();
      this.buildNature();
      this.buildParkings();
      this.buildDragStrip();
      this.buildDriftZone();
      this.buildDelivery();
      this.buildPaddock();
      this.buildWayfinding();
      this.updateStreaming(this.spawns.free.x, this.spawns.free.z, true);
      this.updateHighway(this.spawns.free.z, true);
    }

    /* --------------------------- cielo -------------------------- */
    addSky() {
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        -1, -1, 0, 1, -1, 0, 1, 1, 0,
        -1, -1, 0, 1, 1, 0, -1, 1, 0
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
        0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1
      ]), 2));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          top: { value: new THREE.Color(0x2f6fbe) },
          bottom: { value: new THREE.Color(0xf7b56b) }
        },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.999,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec2 vUv; void main(){ gl_FragColor=vec4(mix(bottom,top,clamp(vUv.y,0.0,1.0)),1.0); }',
        depthWrite: false,
        depthTest: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -10;
      this.scene.add(mesh);
      this.sky = mesh;
    }

    /* ------------------------- terreno streaming ---------------- */
    buildTerrain() {
      this.chunkGroup = new THREE.Group();
      this.chunkGroup.name = 'terrain-stream';
      this.scene.add(this.chunkGroup);
      this._terrainColors = {
        grass: new THREE.Color(0x76c95f),
        grass2: new THREE.Color(0x4d8f4a),
        rock: new THREE.Color(0x9a9270),
        snow: new THREE.Color(0xe8f4ff),
        dirt: new THREE.Color(0xb98a5a),
        neon: new THREE.Color(0x2c3a55),
        tmp: new THREE.Color()
      };
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 1, metalness: 0, flatShading: true
      });
      const count = (this.chunkRadius * 2 + 1) * (this.chunkRadius * 2 + 1);
      for (let i = 0; i < count; i++) {
        const geo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, this.chunkSegs, this.chunkSegs);
        geo.rotateX(-Math.PI / 2);
        const colors = new Float32Array(geo.attributes.position.count * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.userData.isTerrainChunk = true;
        this.chunkGroup.add(mesh);
        this.chunkPool.push({ mesh, geo, key: null });
      }
      this.terrainMesh = this.chunkGroup;
    }

    buildChunk(slot, cx, cz) {
      const size = this.chunkSize;
      const originX = cx * size;
      const originZ = cz * size;
      const pos = slot.geo.attributes.position;
      const colors = slot.geo.attributes.color;
      const c = this._terrainColors;
      const tmp = c.tmp;

      for (let i = 0; i < pos.count; i++) {
        const x = originX + pos.getX(i);
        const z = originZ + pos.getZ(i);
        const h = this.heightAt(x, z);
        pos.setY(i, h);

        const t = clamp((h - 4) / 28, 0, 1);
        if (x < -60 && h < 8) tmp.copy(c.dirt).lerp(c.rock, clamp(h / 18, 0, 1));
        else if (t < 0.52) tmp.copy(c.grass).lerp(c.grass2, t / 0.52);
        else tmp.copy(c.rock).lerp(c.snow, (t - 0.52) / 0.48);
        if (x > 35 && x < 340 && Math.abs(z) < 280) tmp.lerp(c.neon, 0.55);
        const v = Math.sin(x * 0.7) * Math.cos(z * 0.6) * 0.04;
        colors.setXYZ(i,
          clamp(tmp.r + v, 0, 1),
          clamp(tmp.g + v, 0, 1),
          clamp(tmp.b + v, 0, 1));
      }

      pos.needsUpdate = true;
      colors.needsUpdate = true;
      slot.geo.computeVertexNormals();
      slot.geo.computeBoundingSphere();
      slot.mesh.position.set(originX, 0, originZ);
      slot.mesh.visible = true;
      slot.key = cx + ',' + cz;
    }

    updateStreaming(x, z, force) {
      const size = this.chunkSize;
      const cx = Math.floor(x / size);
      const cz = Math.floor(z / size);
      if (!force && cx === this._cx && cz === this._cz) return;
      this._cx = cx;
      this._cz = cz;

      const r = this.chunkRadius;
      const needed = new Set();
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) needed.add((cx + dx) + ',' + (cz + dz));
      }

      const free = [];
      for (const [key, slot] of this.activeChunks) {
        if (!needed.has(key)) {
          this.activeChunks.delete(key);
          slot.key = null;
          slot.mesh.visible = false;
          free.push(slot);
        }
      }

      for (const key of needed) {
        if (this.activeChunks.has(key)) continue;
        const slot = free.pop() || this.chunkPool.find((s) => !s.key);
        if (!slot) continue;
        const parts = key.split(',');
        this.buildChunk(slot, Number(parts[0]), Number(parts[1]));
        this.activeChunks.set(key, slot);
      }
    }

    update(x, z) {
      this._streamTime += 1;
      this.updateStreaming(x, z);
      this.updateHighway(z);
      for (const m of this.paddock.mechanics) {
        const t = this._streamTime * 0.035 + m.phase;
        m.armL.rotation.z = 0.35 + Math.sin(t) * 0.22;
        m.armR.rotation.z = -0.35 - Math.cos(t * 1.15) * 0.2;
        m.group.position.y = m.baseY + Math.sin(t * 1.7) * 0.025;
      }
    }

    addBox(w, h, d, x, y, z, color, opts) {
      opts = opts || {};
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: opts.roughness === undefined ? 0.8 : opts.roughness,
        metalness: opts.metalness === undefined ? 0.05 : opts.metalness,
        emissive: opts.emissive || 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 0,
        flatShading: true
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      if (opts.rotY) mesh.rotation.y = opts.rotY;
      mesh.castShadow = opts.castShadow !== false;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    }

    addCollider(x, z, hw, hd, yaw) {
      this.colliders.push({ x, z, hw, hd, yaw: yaw || 0 });
    }

    /* ------------------------- autostrada infinita ------------- */
    buildHighway() {
      this.roadMat = new THREE.MeshStandardMaterial({ color: 0x2b303b, roughness: 0.96 });
      this.highwayGroup = new THREE.Group();
      this.highwayGroup.name = 'infinite-highway';
      this.scene.add(this.highwayGroup);

      const road = new THREE.Mesh(new THREE.PlaneGeometry(26, 2400), this.roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0.03, 0);
      road.receiveShadow = true;
      this.highwayGroup.add(road);

      const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9eff8, roughness: 0.8 });
      const railMat = new THREE.MeshStandardMaterial({ color: 0x27313f, roughness: 0.65, metalness: 0.25 });
      for (const x of [-12.55, 12.55]) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 2400), edgeMat);
        line.position.set(x, 0.06, 0);
        this.highwayGroup.add(line);
      }
      for (const x of [-13.4, 13.4]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 2400), railMat);
        rail.position.set(x, 0.3, 0);
        this.highwayGroup.add(rail);
      }

      /* trattini riciclati: restano fissi nel mondo mentre l'auto avanza */
      const dashGeo = new THREE.BoxGeometry(0.22, 0.02, 4.4);
      const dashMat = new THREE.MeshStandardMaterial({ color: 0xd5dde9, roughness: 0.9 });
      this.highwayDashCount = 160;
      const dashes = new THREE.InstancedMesh(dashGeo, dashMat, 3 * this.highwayDashCount);
      dashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      dashes.frustumCulled = false;
      this.highwayDashes = dashes;
      this.scene.add(dashes);

      /* lampioni neon autostrada, anch'essi in streaming */
      const lampGeo = new THREE.BoxGeometry(0.28, 7.5, 0.28);
      const lampMat = new THREE.MeshStandardMaterial({
        color: 0x27313f, emissive: 0x5ee7ff, emissiveIntensity: 0.35, roughness: 0.5
      });
      this.highwayLampCount = 72;
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, this.highwayLampCount);
      lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      lamps.frustumCulled = false;
      this.highwayLamps = lamps;
      this.scene.add(lamps);
    }

    updateHighway(z, force) {
      if (!this.highwayGroup) return;
      this.highwayGroup.position.z = z;

      const dashSteps = this.highwayDashCount;
      if (force || this._lastDashZ === null || Math.abs(z - this._lastDashZ) > 3) {
        const start = Math.floor((z - 1120) / 14) * 14;
        const dummy = this._dashDummy || (this._dashDummy = new THREE.Object3D());
        let i = 0;
        for (const x of [-6.5, 0, 6.5]) {
          for (let k = 0; k < dashSteps; k++) {
            dummy.position.set(x, 0.065, start + k * 14);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            this.highwayDashes.setMatrixAt(i++, dummy.matrix);
          }
        }
        this.highwayDashes.count = i;
        this.highwayDashes.instanceMatrix.needsUpdate = true;
        this._lastDashZ = z;
      }

      if (force || this._lastLampZ === null || Math.abs(z - this._lastLampZ) > 8) {
        const lampSpan = Math.floor(this.highwayLampCount / 2) * 48;
        const start = Math.floor((z - lampSpan / 2) / 48) * 48;
        const dummy = this._dashDummy || (this._dashDummy = new THREE.Object3D());
        for (let k = 0; k < this.highwayLampCount; k++) {
          const side = k % 2 === 0 ? -1 : 1;
          dummy.position.set(side * 13.6, 3.6, start + Math.floor(k / 2) * 48);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          this.highwayLamps.setMatrixAt(k, dummy.matrix);
        }
        this.highwayLamps.instanceMatrix.needsUpdate = true;
        this._lastLampZ = z;
      }
    }

    /* ---------------------------- città ------------------------ */
    buildCity() {
      const roadMat = new THREE.MeshStandardMaterial({ color: 0x343a45, roughness: 0.96 });
      const city = this.city;

      for (const x of this.cityRoadsX) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(11, city.zmax - city.zmin), roadMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.03, (city.zmin + city.zmax) / 2);
        m.receiveShadow = true;
        this.scene.add(m);
      }
      for (const z of this.cityRoadsZ) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(city.xmax - city.xmin, 11), roadMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set((city.xmin + city.xmax) / 2, 0.031, z);
        m.receiveShadow = true;
        this.scene.add(m);
      }

      const bGeo = new THREE.BoxGeometry(1, 1, 1);
      const bMat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.08, flatShading: true });
      const MAXB = 88;
      const buildings = new THREE.InstancedMesh(bGeo, bMat, MAXB);
      buildings.castShadow = true;
      buildings.receiveShadow = true;

      const neonGeo = new THREE.BoxGeometry(1, 1, 1);
      const neonMat = new THREE.MeshStandardMaterial({
        roughness: 0.35, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.9
      });
      const neon = new THREE.InstancedMesh(neonGeo, neonMat, MAXB * 2);
      neon.castShadow = false;

      const dummy = new THREE.Object3D();
      const palette = [0x93a6bb, 0xa8b8c9, 0x7f91a6, 0xbcc9d6, 0x8fa3b8, 0xc9d4de];
      const neonPalette = [0x5ee7ff, 0xff5e9c, 0x57e39b, 0xffc857, 0xb69cff];
      let bi = 0;
      let ni = 0;

      for (const xb of this.xBlocks) {
        for (const zb of this.zBlocks) {
          const cx = (xb.min + xb.max) / 2;
          const cz = (zb.min + zb.max) / 2;

          let skip = false;
          for (const p of this.parkingBays) {
            if (Math.hypot(cx - p.x, cz - p.z) < 42) skip = true;
          }
          if (skip) continue;

          const usableW = (xb.max - xb.min) - 4;
          const usableD = (zb.max - zb.min) - 4;
          const count = (usableW > 52 && usableD > 52) ? 2 : 1;

          for (let k = 0; k < count && bi < MAXB; k++) {
            const w = clamp(usableW * (count === 1 ? this.randRange(0.55, 0.82) : this.randRange(0.34, 0.44)), 9, 30);
            const d = clamp(usableD * this.randRange(0.42, 0.72), 9, 30);
            const h = this.randRange(10, 48);
            let ox, oz;
            if (count === 1) {
              ox = this.randRange(-(usableW - w) / 2, (usableW - w) / 2);
              oz = this.randRange(-(usableD - d) / 2, (usableD - d) / 2);
            } else {
              ox = (k === 0 ? -1 : 1) * usableW * 0.23;
              oz = this.randRange(-(usableD - d) / 2, (usableD - d) / 2) * 0.55;
            }
            const bxo = cx + ox;
            const bzo = cz + oz;
            dummy.position.set(bxo, h / 2, bzo);
            dummy.scale.set(w, h, d);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            buildings.setMatrixAt(bi, dummy.matrix);
            buildings.setColorAt(bi, new THREE.Color(this.pick(palette)));
            this.addCollider(bxo, bzo, w / 2, d / 2, 0);

            if (ni < MAXB * 2) {
              const nh = this.randRange(4, Math.min(18, h * 0.5));
              dummy.position.set(bxo + (this.rand() < 0.5 ? -1 : 1) * (w / 2 + 0.06), this.randRange(nh, h - 2), bzo);
              dummy.scale.set(0.18, nh, 0.5);
              dummy.updateMatrix();
              neon.setMatrixAt(ni, dummy.matrix);
              neon.setColorAt(ni, new THREE.Color(this.pick(neonPalette)));
              ni++;
            }
            bi++;
          }
        }
      }
      buildings.count = bi;
      buildings.instanceMatrix.needsUpdate = true;
      if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
      neon.count = ni;
      neon.instanceMatrix.needsUpdate = true;
      if (neon.instanceColor) neon.instanceColor.needsUpdate = true;
      this.scene.add(buildings, neon);

      /* semafori e lampioni città */
      const poleGeo = new THREE.BoxGeometry(0.22, 5.4, 0.22);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x232b38, roughness: 0.7 });
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0x5ee7ff, emissiveIntensity: 1.3, roughness: 0.4
      });
      for (let i = 0; i < 24; i++) {
        const onX = this.rand() < 0.5;
        const x = onX ? this.pick(this.cityRoadsX) + (this.rand() < 0.5 ? -7 : 7) : this.randRange(50, 320);
        const z = onX ? this.randRange(-250, 250) : this.pick(this.cityRoadsZ) + (this.rand() < 0.5 ? -7 : 7);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(x, 2.7, z);
        pole.castShadow = true;
        this.scene.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.4), headMat);
        head.position.set(x, 5.35, z);
        this.scene.add(head);
      }
    }

    /* -------------------------- natura -------------------------- */
    buildNature() {
      const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 2.4, 6);
      trunkGeo.translate(0, 1.2, 0);
      const leafGeo = new THREE.BoxGeometry(2.6, 2.4, 2.6);
      leafGeo.translate(0, 3.3, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1, flatShading: true });
      const leafMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });

      const N = 150;
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
      const leaves = new THREE.InstancedMesh(leafGeo, leafMat, N);
      trunks.castShadow = true;
      leaves.castShadow = true;

      const dummy = new THREE.Object3D();
      let count = 0;
      let tries = 0;
      while (count < N && tries < 7000) {
        tries++;
        const x = this.randRange(-545, 545);
        const z = this.randRange(-545, 545);
        if (Math.abs(x) < 48) continue;
        if (x > 35 && x < 340 && Math.abs(z) < 280) continue;
        if (Math.hypot(x - this.delivery.depot.x, z - this.delivery.depot.z) < 34) continue;
        let nearRoute = false;
        for (const r of this.delivery.route) if (Math.hypot(x - r.x, z - r.z) < 24) nearRoute = true;
        if (nearRoute) continue;
        const h = this.heightAt(x, z);
        if (h < 2.4 || h > 36) continue;

        const s = this.randRange(0.75, 1.55);
        dummy.position.set(x, h - 0.05, z);
        dummy.rotation.set(0, this.randRange(0, Math.PI * 2), 0);
        dummy.scale.set(s, s * this.randRange(0.9, 1.3), s);
        dummy.updateMatrix();
        trunks.setMatrixAt(count, dummy.matrix);
        leaves.setMatrixAt(count, dummy.matrix);
        leaves.setColorAt(count, new THREE.Color().setHSL(0.28 + this.randRange(-0.05, 0.05), 0.45, 0.3 + this.randRange(-0.04, 0.1)));
        count++;
      }
      trunks.count = count;
      leaves.count = count;
      trunks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
      this.scene.add(trunks, leaves);

      const rockGeo = new THREE.BoxGeometry(1.6, 1.3, 1.6);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 1, flatShading: true });
      const R = 110;
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, R);
      rocks.castShadow = true;
      let rc = 0;
      tries = 0;
      while (rc < R && tries < 6000) {
        tries++;
        const x = this.randRange(-545, 545);
        const z = this.randRange(-545, 545);
        if (Math.abs(x) < 44) continue;
        if (x > 35 && x < 340 && Math.abs(z) < 280) continue;
        if (Math.hypot(x - this.delivery.depot.x, z - this.delivery.depot.z) < 30) continue;
        let nearRoute = false;
        for (const r of this.delivery.route) if (Math.hypot(x - r.x, z - r.z) < 18) nearRoute = true;
        if (nearRoute) continue;
        const h = this.heightAt(x, z);
        if (h < 1.4) continue;
        const s = this.randRange(0.5, 1.8);
        dummy.position.set(x, h + 0.2 * s, z);
        dummy.rotation.set(this.randRange(0, 1), this.randRange(0, Math.PI * 2), this.randRange(0, 1));
        dummy.scale.set(s, s * this.randRange(0.6, 1.1), s);
        dummy.updateMatrix();
        rocks.setMatrixAt(rc, dummy.matrix);
        rocks.setColorAt(rc, new THREE.Color().setHSL(0.08, 0.05, 0.42 + this.randRange(-0.08, 0.18)));
        rc++;
      }
      rocks.count = rc;
      rocks.instanceMatrix.needsUpdate = true;
      if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
      this.scene.add(rocks);
    }

    makeSignTexture(letter, colorHex) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const color = '#' + colorHex.toString(16).padStart(6, '0');
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, 112, 112);
      ctx.fillStyle = color;
      ctx.font = 'bold 92px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 64, 70);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    /* ---------------------- piazzole parcheggio ---------------- */
    buildParkings() {
      for (const p of this.parkingBays) {
        p.cos = Math.cos(p.yaw);
        p.sin = Math.sin(p.yaw);
        p.padY = 0.08;

        const lot = new THREE.Mesh(
          new THREE.BoxGeometry(12, 0.1, 19),
          new THREE.MeshStandardMaterial({ color: 0x202836, roughness: 0.9 })
        );
        lot.position.set(p.x, 0.045, p.z);
        lot.rotation.y = p.yaw;
        lot.receiveShadow = true;
        this.scene.add(lot);

        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(p.w, 0.12, p.d),
          new THREE.MeshStandardMaterial({
            color: p.color, emissive: p.color, emissiveIntensity: 0.18,
            roughness: 0.75, metalness: 0.05
          })
        );
        pad.position.set(p.x, 0.1, p.z);
        pad.rotation.y = p.yaw;
        pad.receiveShadow = true;
        this.scene.add(pad);
        p.mesh = pad;

        const lineMat = new THREE.MeshStandardMaterial({
          color: 0xffffff, emissive: p.color, emissiveIntensity: 0.9, roughness: 0.4
        });
        const lineLong = new THREE.BoxGeometry(0.1, 0.03, p.d);
        const lineShort = new THREE.BoxGeometry(p.w, 0.03, 0.1);
        for (const sx of [-1, 1]) {
          const line = new THREE.Mesh(lineLong, lineMat);
          line.position.set(sx * p.w / 2, 0.17, 0);
          line.rotation.y = p.yaw;
          line.translateOnAxis(new THREE.Vector3(0, 0, 0), 0);
          line.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0);
          /* posizione nel sistema locale della piazzola */
          const lx = sx * p.w / 2;
          line.position.set(p.x + p.cos * lx, 0.17, p.z - p.sin * lx);
          this.scene.add(line);
        }
        const back = new THREE.Mesh(lineShort, lineMat);
        back.position.set(p.x + p.sin * (p.d / 2), 0.17, p.z + p.cos * (p.d / 2));
        back.rotation.y = p.yaw;
        this.scene.add(back);

        /* cordoli e blocchi delimitatori */
        const blockMat = new THREE.MeshStandardMaterial({
          color: p.color, emissive: p.color, emissiveIntensity: 0.32, roughness: 0.55
        });
        const railGeo = new THREE.BoxGeometry(0.34, 0.46, p.d + 0.4);
        for (const sx of [-1, 1]) {
          const lx = sx * (p.w / 2 + 0.34);
          const rail = new THREE.Mesh(railGeo, blockMat);
          rail.position.set(p.x + p.cos * lx, 0.23, p.z - p.sin * lx);
          rail.rotation.y = p.yaw;
          rail.castShadow = true;
          this.scene.add(rail);
          this.addCollider(rail.position.x, rail.position.z, 0.17, (p.d + 0.4) / 2, p.yaw);
        }
        const backRail = new THREE.Mesh(new THREE.BoxGeometry(p.w + 1.0, 0.46, 0.34), blockMat);
        backRail.position.set(p.x + p.sin * (p.d / 2 + 0.17), 0.23, p.z + p.cos * (p.d / 2 + 0.17));
        backRail.rotation.y = p.yaw;
        backRail.castShadow = true;
        this.scene.add(backRail);
        this.addCollider(backRail.position.x, backRail.position.z, (p.w + 1) / 2, 0.17, p.yaw);

        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const lx = sx * (p.w / 2 + 0.34);
            const lz = sz * (p.d / 2 + 0.17);
            const pillar = this.addBox(0.42, 1.5, 0.42,
              p.x + p.cos * lx + p.sin * lz, 0.75, p.z - p.sin * lx + p.cos * lz,
              p.color, { emissive: p.color, emissiveIntensity: 0.5, roughness: 0.5 });
            pillar.rotation.y = p.yaw;
            this.addCollider(pillar.position.x, pillar.position.z, 0.21, 0.21, p.yaw);
          }
        }

        const poleZ = p.d / 2 + 4.5;
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 4.4, 6),
          new THREE.MeshStandardMaterial({ color: 0x2a3240, roughness: 0.8 })
        );
        pole.position.set(p.x + p.sin * poleZ, 2.2, p.z + p.cos * poleZ);
        this.scene.add(pole);
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 4),
          new THREE.MeshBasicMaterial({ map: this.makeSignTexture('P', p.color), side: THREE.DoubleSide })
        );
        sign.position.set(p.x + p.sin * poleZ, 4.5, p.z + p.cos * poleZ);
        sign.rotation.y = p.yaw + Math.PI;
        this.scene.add(sign);
      }
    }

    bayLocal(bay, x, z) {
      const dx = x - bay.x;
      const dz = z - bay.z;
      return {
        x: dx * Math.cos(bay.yaw) - dz * Math.sin(bay.yaw),
        z: dx * Math.sin(bay.yaw) + dz * Math.cos(bay.yaw)
      };
    }

    bayWorld(bay, lx, lz) {
      return {
        x: bay.x + Math.cos(bay.yaw) * lx + Math.sin(bay.yaw) * lz,
        z: bay.z - Math.sin(bay.yaw) * lx + Math.cos(bay.yaw) * lz
      };
    }

    /* -------------------------- drag strip --------------------- */
    buildDragStrip() {
      const d = this.drag;
      const dark = new THREE.MeshStandardMaterial({ color: 0x171d27, roughness: 0.9 });
      const surface = new THREE.Mesh(new THREE.PlaneGeometry(24, d.length), dark);
      surface.rotation.x = -Math.PI / 2;
      surface.position.set(0, 0.045, (d.startZ + d.finishZ) / 2);
      surface.receiveShadow = true;
      this.scene.add(surface);

      const white = new THREE.MeshStandardMaterial({ color: 0xf2f5ff, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.6 });
      for (const z of [d.startZ, d.finishZ]) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(24, 0.04, 0.5), white);
        line.position.set(0, 0.075, z);
        this.scene.add(line);
      }
      for (let i = 1; i < 9; i++) {
        const z = d.startZ + (d.length / 9) * i;
        for (const x of [-10.5, 10.5]) {
          const marker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 2.6), white);
          marker.position.set(x, 0.07, z);
          this.scene.add(marker);
          const label = new THREE.Mesh(
            new THREE.PlaneGeometry(4, 4),
            new THREE.MeshBasicMaterial({ map: this.makeSignTexture(String(i * 50), 0x5ee7ff), side: THREE.DoubleSide, transparent: true })
          );
          label.position.set(x * 0.86, 2.4, z);
          label.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
          this.scene.add(label);
        }
      }

      /* gantry start + 5 luci */
      const postMat = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.6, metalness: 0.35 });
      for (const z of [d.startZ, d.finishZ]) {
        for (const x of [-13, 13]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), postMat);
          post.position.set(x, 4, z);
          post.castShadow = true;
          this.scene.add(post);
          this.addCollider(x, z, 0.35, 0.35, 0);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(26.6, 0.7, 0.7), postMat);
        beam.position.set(0, 8, z);
        this.scene.add(beam);
      }

      const lightGeo = new THREE.SphereGeometry(0.62, 10, 8);
      for (let i = 0; i < 5; i++) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0x1a1f28, emissive: 0x220000, emissiveIntensity: 0.4, roughness: 0.4
        });
        const light = new THREE.Mesh(lightGeo, mat);
        light.position.set(-4 + i * 2, 6.6, d.startZ + 0.2);
        this.scene.add(light);
        d.lights.push(light);
      }

      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(13, 2.6),
        new THREE.MeshBasicMaterial({ map: this.makeSignTexture('400', 0xff5e9c), side: THREE.DoubleSide })
      );
      banner.position.set(0, 10, d.startZ);
      this.scene.add(banner);
    }

    /* -------------------------- drift zone --------------------- */
    buildDriftZone() {
      const zone = this.drift;
      const gateMat = new THREE.MeshStandardMaterial({
        color: 0x1b2430, roughness: 0.55, metalness: 0.3,
        emissive: 0xff5e9c, emissiveIntensity: 0.45
      });
      for (let i = 0; i < zone.gates.length; i++) {
        const g = zone.gates[i];
        const h = this.heightAt(g.x, g.z);
        const next = zone.gates[(i + 1) % zone.gates.length];
        const yaw = Math.atan2(next.x - g.x, next.z - g.z);
        const group = new THREE.Group();
        group.position.set(g.x, h, g.z);
        group.rotation.y = yaw;

        const c1 = new THREE.Color(0x5ee7ff);
        const c2 = new THREE.Color(0xff5e9c);
        const mat = gateMat.clone();
        mat.emissive.copy(i % 2 ? c2 : c1);
        for (const sx of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.2, 0.6), mat);
          post.position.set(sx * 7.5, 3.6, 0);
          post.castShadow = true;
          group.add(post);
        }
        const top = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.6, 0.6), mat);
        top.position.y = 7.2;
        group.add(top);
        this.scene.add(group);
        zone.gates[i].mesh = group;
      }

      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 9),
        new THREE.MeshBasicMaterial({ map: this.makeSignTexture('D', 0xff5e9c), side: THREE.DoubleSide, transparent: true })
      );
      label.position.set(zone.x, this.heightAt(zone.x, zone.z) + 12, zone.z);
      this.scene.add(label);
    }

    /* ------------------------- consegne ------------------------- */
    buildDelivery() {
      const dep = this.delivery.depot;
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(26, 0.35, 26),
        new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.95 })
      );
      pad.position.set(dep.x, dep.h + 0.18, dep.z);
      pad.receiveShadow = true;
      this.scene.add(pad);
      this.depotMesh = pad;

      const railMat = new THREE.MeshStandardMaterial({
        color: 0xffa94d, emissive: 0xffa94d, emissiveIntensity: 0.4, roughness: 0.6
      });
      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 0.5), railMat);
        rail.position.set(dep.x, dep.h + 0.55, dep.z + sx * 13);
        this.scene.add(rail);
      }
      const depotSign = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 8),
        new THREE.MeshBasicMaterial({ map: this.makeSignTexture('C', 0xffa94d), side: THREE.DoubleSide })
      );
      depotSign.position.set(dep.x, dep.h + 8, dep.z - 13);
      this.scene.add(depotSign);

      for (let i = 0; i < this.delivery.route.length; i++) {
        const p = this.delivery.route[i];
        const h = this.heightAt(p.x, p.z);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x2a3340, roughness: 0.5, metalness: 0.3,
          emissive: 0x57e39b, emissiveIntensity: 0.5
        });
        for (const sx of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.4, 0.5), mat);
          post.position.set(p.x + sx * 6, h + 2.7, p.z);
          this.scene.add(post);
        }
        const top = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.5, 0.5), mat);
        top.position.set(p.x, h + 5.4, p.z);
        this.scene.add(top);
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, 9, 1.2),
          new THREE.MeshStandardMaterial({
            color: 0xffa94d, emissive: 0xffa94d, emissiveIntensity: 1.1, transparent: true, opacity: 0.7, roughness: 0.3
          })
        );
        beam.position.set(p.x, h + 8, p.z);
        this.scene.add(beam);
        this.checkpointMeshes.push(beam);
      }
    }

    /* ---------------------- paddock / lobby fisica -------------- */
    makeBannerTexture(text, colorHex) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const color = '#' + colorHex.toString(16).padStart(6, '0');
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = color;
      ctx.lineWidth = 7;
      ctx.strokeRect(7, 7, 498, 114);
      ctx.fillStyle = color;
      ctx.font = 'bold 58px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 68);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    makeMechanic(x, z, yaw, suitColor, helmetColor) {
      const g = new THREE.Group();
      const suit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.78, flatShading: true });
      const dark = new THREE.MeshStandardMaterial({ color: 0x202733, roughness: 0.8, flatShading: true });
      const skin = new THREE.MeshStandardMaterial({ color: 0xd7a06e, roughness: 0.9, flatShading: true });
      const helmet = new THREE.MeshStandardMaterial({ color: helmetColor, roughness: 0.45, metalness: 0.1, flatShading: true });
      const add = (geo, mat, px, py, pz) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
        return m;
      };
      add(new THREE.BoxGeometry(0.2, 0.62, 0.24), dark, -0.16, 0.31, 0);
      add(new THREE.BoxGeometry(0.2, 0.62, 0.24), dark, 0.16, 0.31, 0);
      add(new THREE.BoxGeometry(0.58, 0.7, 0.32), suit, 0, 0.96, 0);
      add(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin, 0, 1.47, 0);
      add(new THREE.BoxGeometry(0.36, 0.2, 0.36), helmet, 0, 1.66, 0);
      add(new THREE.BoxGeometry(0.36, 0.06, 0.38), helmet, 0, 1.58, 0.01);
      const armL = new THREE.Group();
      armL.position.set(-0.38, 1.22, 0);
      const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.18), suit);
      armLMesh.position.y = -0.27;
      armLMesh.castShadow = true;
      armL.add(armLMesh);
      g.add(armL);
      const armR = new THREE.Group();
      armR.position.set(0.38, 1.22, 0);
      const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.18), suit);
      armRMesh.position.y = -0.27;
      armRMesh.castShadow = true;
      armR.add(armRMesh);
      g.add(armR);
      const baseY = this.heightAt(x, z);
      g.position.set(x, baseY, z);
      g.rotation.y = yaw;
      this.scene.add(g);
      this.paddock.mechanics.push({ group: g, armL, armR, baseY, phase: this.rand() * Math.PI * 2 });
    }

    buildPaddock() {
      const p = this.paddock;
      const asphalt = new THREE.MeshStandardMaterial({ color: 0x252c38, roughness: 0.94 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x151b25, roughness: 0.8, metalness: 0.15 });
      const neon = new THREE.MeshStandardMaterial({
        color: 0x57e39b, emissive: 0x57e39b, emissiveIntensity: 0.85, roughness: 0.4
      });
      const cyan = new THREE.MeshStandardMaterial({
        color: 0x5ee7ff, emissive: 0x5ee7ff, emissiveIntensity: 0.9, roughness: 0.4
      });

      const pad = new THREE.Mesh(new THREE.BoxGeometry(p.padW, 0.12, p.padD), asphalt);
      pad.position.set(p.x, 0.06, p.z);
      pad.receiveShadow = true;
      this.scene.add(pad);

      const access = new THREE.Mesh(new THREE.BoxGeometry(96, 0.1, 11), asphalt);
      access.position.set(59, 0.05, p.z);
      access.receiveShadow = true;
      this.scene.add(access);

      /* corsie e box pit */
      for (let i = 0; i < 4; i++) {
        const z = p.z - 15 + i * 10;
        const line = new THREE.Mesh(new THREE.BoxGeometry(p.padW - 8, 0.03, 0.12), neon);
        line.position.set(p.x, 0.135, z);
        this.scene.add(line);
      }
      for (const x of [70, 95, 120]) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(15, 0.035, 7), dark);
        box.position.set(x, 0.13, p.z - 8);
        this.scene.add(box);
        const outline = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.02, 0.12), cyan);
        outline.position.set(x, 0.15, p.z - 11.5);
        this.scene.add(outline);
      }

      /* garage */
      const gh = p.garage;
      const garage = this.addBox(gh.w, gh.h, gh.d, gh.x, gh.h / 2, gh.z, 0x202836, {
        roughness: 0.65, metalness: 0.25
      });
      garage.castShadow = true;
      this.addBox(gh.w + 2, 0.5, gh.d + 2, gh.x, gh.h + 0.25, gh.z, 0x39465a, { roughness: 0.5, metalness: 0.35 });
      this.addCollider(gh.x, gh.z, gh.w / 2, gh.d / 2, 0);
      for (const x of [70, 95, 120]) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(15, 4.2, 0.2), new THREE.MeshStandardMaterial({
          color: 0x0d1520, roughness: 0.3, metalness: 0.45, emissive: 0x142a35, emissiveIntensity: 0.5
        }));
        door.position.set(x, 2.25, gh.z + gh.d / 2 + 0.11);
        this.scene.add(door);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.1, 0.08), neon);
        strip.position.set(x, 4.35, gh.z + gh.d / 2 + 0.23);
        this.scene.add(strip);
      }

      /* insegna PADDOCK sopra il garage */
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 5.5),
        new THREE.MeshBasicMaterial({ map: this.makeBannerTexture('VOXEL PADDOCK', 0x57e39b), side: THREE.DoubleSide })
      );
      banner.position.set(gh.x, gh.h + 3.2, gh.z + gh.d / 2 + 0.3);
      this.scene.add(banner);

      /* arco d'ingresso sull'accesso */
      for (const z of [p.z - 7, p.z + 7]) {
        this.addBox(0.8, 7.5, 0.8, 38, 3.75, z, 0x1b2430, { metalness: 0.35 });
        this.addCollider(38, z, 0.4, 0.4, 0);
      }
      this.addBox(0.9, 0.7, 15.6, 38, 7.5, p.z, 0x1b2430, { metalness: 0.35 });
      const gateSign = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 2.5),
        new THREE.MeshBasicMaterial({ map: this.makeBannerTexture('PADDOCK', 0xffd166), side: THREE.DoubleSide })
      );
      gateSign.position.set(38.55, 6.5, p.z);
      gateSign.rotation.y = -Math.PI / 2;
      this.scene.add(gateSign);

      /* piazzola servizio gomme / meccanici */
      const pitPad = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 6), new THREE.MeshStandardMaterial({
        color: 0x12303a, emissive: 0x2fa8c9, emissiveIntensity: 0.3, roughness: 0.5
      }));
      pitPad.position.set(p.pit.x, 0.15, p.pit.z);
      this.scene.add(pitPad);
      const pitSign = new THREE.Mesh(
        new THREE.PlaneGeometry(5.2, 2.2),
        new THREE.MeshBasicMaterial({ map: this.makeBannerTexture('PIT', 0x5ee7ff), side: THREE.DoubleSide })
      );
      pitSign.position.set(p.pit.x, 3.2, p.pit.z + 4);
      this.scene.add(pitSign);
      this.addBox(0.18, 2.8, 0.18, p.pit.x - 2.6, 1.4, p.pit.z + 4, 0x27313f);
      this.addBox(0.18, 2.8, 0.18, p.pit.x + 2.6, 1.4, p.pit.z + 4, 0x27313f);

      /* auto in esposizione: F1, supercar, pick-up */
      const defs = VD.CAR_DEFS || {};
      const show = [defs.f1, defs.supercar, defs.pickup].filter(Boolean);
      const spots = [70, 95, 120];
      if (VD.buildCar) {
        for (let i = 0; i < show.length; i++) {
          const def = show[i];
          const car = VD.buildCar(def.color, { def, simple: true });
          const x = spots[i];
          const z = p.z - 5;
          car.position.set(x, this.heightAt(x, z) + 0.04, z);
          car.rotation.y = 0;
          this.scene.add(car);
          this.paddock.cars.push(car);
          this.addCollider(x, z, 1.1, 2.3, 0);
        }
      }

      /* meccanici animati */
      this.makeMechanic(83, p.z + 2, 0.2, 0xff2b3d, 0xffd166);
      this.makeMechanic(107, p.z + 2, -0.2, 0x57e39b, 0xf2f5ff);
      this.makeMechanic(95, p.z + 9, Math.PI, 0xffd166, 0xff2b3d);
      this.makeMechanic(65, p.z - 1, 0.6, 0x5ee7ff, 0x1b2430);
      this.makeMechanic(127, p.z - 1, -0.6, 0xff8fb1, 0xf2f5ff);

      /* bandiere e luci */
      for (const x of [55, 135]) {
        this.addBox(0.16, 5, 0.16, x, 2.5, p.z - 20, 0x27313f);
        const flag = this.addBox(2.4, 1.2, 0.08, x + 1.2, 4.3, p.z - 20, 0x57e39b, {
          emissive: 0x57e39b, emissiveIntensity: 0.4
        });
        flag.castShadow = false;
      }
    }

    buildWayfinding() {
      /* frecce a terra verso le sfide */
      const spots = [
        { x: 30, z: -18, color: 0x57e39b, yaw: Math.PI / 2 },
        { x: -8, z: -280, color: 0xff5e9c, yaw: 0 },
        { x: -210, z: 100, color: 0x5ee7ff, yaw: -Math.PI / 2 }
      ];
      for (const s of spots) {
        const arrow = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.05, 7),
          new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 0.6, roughness: 0.5 })
        );
        arrow.position.set(s.x, 0.09, s.z);
        arrow.rotation.y = s.yaw;
        this.scene.add(arrow);
      }
    }
  }

  VD.World = World;
  VD.PARKING_BAYS = PARKING_BAYS;
})();
