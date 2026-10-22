/* ================================================================
   VOXEL DRIVE: INFINITE HORIZON — cars.js
   Modelli voxel delle 3 auto guidabili + traffico ambientale
   (120 auto simultanee) con THREE.InstancedMesh, deformazione
   dei blocchi, carambole a catena e detriti.
   ================================================================ */
(function () {
  'use strict';

  window.VD = window.VD || {};
  const { clamp } = VD.util;

  const CAR_DEFS = {
    citycar: {
      label: 'CITYCAR', tagline: 'Agile e facile', color: 0x4dd6c1, accent: '#4dd6c1',
      body: { w: 1.82, h: 0.7, l: 3.45 },
      cabin: { w: 1.46, h: 0.62, l: 1.62, z: -0.04 },
      wheel: { r: 0.34, thickness: 0.27, x: 0.89, z: 1.05 },
      stats: { speed: 0.55, grip: 0.85, offroad: 0.45 },
      physics: {
        mass: 1040, gearAccel: [0, 12.0, 8.4, 6.2, 4.8, 3.8, 2.9],
        grip: 9.8, offroadGrip: 5.2, wheelRadius: 0.34, wheelBase: 2.1, trackWidth: 1.78,
        gearRatios: [4.4, 2.8, 2.0, 1.6, 1.35, 1.15], reverseRatio: 3.9,
        finalDrive: 4.2, maxSpeed: 44, steerLock: 0.56, redline: 6800,
        idleRpm: 820, launchWindow: [0.48, 0.7], autoShiftUp: 0.88, autoShiftDown: 0.32,
        brakeForce: 17
      }
    },
    supercar: {
      label: 'SUPERCAR', tagline: 'Velocità pura', color: 0xff4757, accent: '#ff5e9c',
      body: { w: 2.04, h: 0.6, l: 4.1 },
      cabin: { w: 1.5, h: 0.52, l: 1.5, z: -0.1 },
      wheel: { r: 0.37, thickness: 0.3, x: 1.0, z: 1.35 },
      spoiler: true,
      stats: { speed: 1.0, grip: 0.9, offroad: 0.25 },
      physics: {
        mass: 1280, gearAccel: [0, 14.5, 10.2, 7.4, 5.6, 4.3, 3.3],
        grip: 10.2, offroadGrip: 4.3, wheelRadius: 0.37, wheelBase: 2.7, trackWidth: 2.0,
        gearRatios: [4.5, 2.9, 2.1, 1.65, 1.4, 1.2], reverseRatio: 4.0,
        finalDrive: 4.3, maxSpeed: 58, steerLock: 0.54, redline: 7600,
        idleRpm: 900, launchWindow: [0.46, 0.66], autoShiftUp: 0.87, autoShiftDown: 0.3,
        brakeForce: 19
      }
    },
    pickup: {
      label: 'PICK-UP 4x4', tagline: 'Re dell\'off-road', color: 0xffa94d, accent: '#ffc857',
      body: { w: 2.04, h: 0.9, l: 4.5 },
      cabin: { w: 1.66, h: 0.78, l: 1.55, z: 0.35 },
      wheel: { r: 0.47, thickness: 0.34, x: 1.0, z: 1.45 },
      bed: true,
      stats: { speed: 0.7, grip: 0.75, offroad: 1.0 },
      physics: {
        mass: 1720, gearAccel: [0, 11.2, 8.0, 6.0, 4.6, 3.6, 2.8],
        grip: 8.8, offroadGrip: 6.8, wheelRadius: 0.47, wheelBase: 2.9, trackWidth: 2.0,
        gearRatios: [4.7, 3.0, 2.2, 1.7, 1.45, 1.25], reverseRatio: 4.2,
        finalDrive: 4.6, maxSpeed: 48, steerLock: 0.52, redline: 6200,
        idleRpm: 800, launchWindow: [0.42, 0.62], autoShiftUp: 0.88, autoShiftDown: 0.34,
        brakeForce: 21
      }
    }
  };

  function buildCar(color, opts) {
    opts = opts || {};
    const def = opts.def || CAR_DEFS.supercar;
    const simple = !!opts.simple;
    const b = def.body;
    const c = def.cabin;
    const wh = def.wheel;
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.22, flatShading: true });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x2b4058, roughness: 0.32, metalness: 0.45, flatShading: true });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.7, metalness: 0.2, flatShading: true });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9, metalness: 0.05, flatShading: true });

    const bodyY = wh.r + b.h * 0.5 - 0.06;
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.l), bodyMat);
    body.position.y = bodyY;
    body.castShadow = !simple;
    body.receiveShadow = true;
    g.add(body);

    const cabinY = bodyY + b.h * 0.5 + c.h * 0.5 - 0.06;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.l), glassMat);
    cabin.position.set(0, cabinY, c.z);
    cabin.castShadow = !simple;
    g.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(c.w * 0.98, 0.07, c.l * 0.92), bodyMat);
    roof.position.set(0, cabinY + c.h * 0.5 + 0.005, c.z);
    roof.castShadow = !simple;
    g.add(roof);

    if (def.bed) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.86, 0.28, b.l * 0.34), darkMat);
      bed.position.set(0, bodyY + b.h * 0.5 + 0.04, -b.l * 0.25);
      bed.castShadow = !simple;
      g.add(bed);
      const railGeo = new THREE.BoxGeometry(0.09, 0.22, b.l * 0.34);
      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(railGeo, bodyMat);
        rail.position.set(sx * b.w * 0.42, bodyY + b.h * 0.5 + 0.16, -b.l * 0.25);
        g.add(rail);
      }
    }

    if (def.spoiler && !simple) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.9, 0.08, 0.32), darkMat);
      wing.position.set(0, bodyY + b.h * 0.5 + 0.28, -b.l * 0.5 + 0.28);
      wing.castShadow = true;
      g.add(wing);
      for (const sx of [-1, 1]) {
        const support = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), darkMat);
        support.position.set(sx * b.w * 0.32, bodyY + b.h * 0.5 + 0.12, -b.l * 0.5 + 0.28);
        g.add(support);
      }
    }

    if (!simple) {
      const nose = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.92, 0.14, b.l * 0.2), bodyMat);
      nose.position.set(0, bodyY + b.h * 0.5 + 0.01, b.l * 0.3);
      nose.castShadow = true;
      g.add(nose);

      const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe08a, emissiveIntensity: 1.1, roughness: 0.4 });
      const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3b5c, emissive: 0xff2a4a, emissiveIntensity: 1.0, roughness: 0.4 });
      for (const sx of [-1, 1]) {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.08), lightMat);
        head.position.set(sx * (b.w * 0.5 - 0.3), bodyY + 0.04, b.l * 0.5 + 0.005);
        g.add(head);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.08), tailMat);
        tail.position.set(sx * (b.w * 0.5 - 0.3), bodyY + 0.04, -b.l * 0.5 - 0.005);
        g.add(tail);
      }
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.92, 0.22, 0.26), darkMat);
      bumper.position.set(0, bodyY - b.h * 0.5 + 0.11, b.l * 0.5 - 0.06);
      g.add(bumper);
      const bumperR = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.92, 0.22, 0.26), darkMat);
      bumperR.position.set(0, bodyY - b.h * 0.5 + 0.11, -b.l * 0.5 + 0.06);
      g.add(bumperR);
    }

    const wheelGeo = new THREE.CylinderGeometry(wh.r, wh.r, wh.thickness, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheels = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(sx * wh.x, wh.r, sz * wh.z);
        w.castShadow = !simple;
        w.rotation.order = 'YXZ';
        g.add(w);
        wheels.push({ mesh: w, front: sz > 0, sx, sz });
      }
    }
    g.userData.wheels = wheels;
    g.userData.def = def;
    g.scale.setScalar(opts.scale || 1);
    return g;
  }

  function getBed(def) {
    const b = def.body;
    const bodyY = def.wheel.r + b.h * 0.5 - 0.06;
    const floor = bodyY + b.h * 0.5 + 0.18;
    return {
      x: 0, y: floor + 0.3, z: -b.l * 0.25,
      w: b.w * 0.78, l: b.l * 0.3
    };
  }

  function buildCargo(def) {
    const bed = getBed(def);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.7, metalness: 0.1, flatShading: true });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x9a5b1e, roughness: 0.8 });
    const cubes = [];
    const size = 0.56;
    const slots = [-0.58, 0, 0.58];
    for (let i = 0; i < 3; i++) {
      const piece = new THREE.Group();
      const cube = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
      cube.castShadow = true;
      cube.receiveShadow = true;
      piece.add(cube);
      const band = new THREE.Mesh(new THREE.BoxGeometry(size + 0.03, 0.08, 0.08), edgeMat);
      band.position.y += 0.02;
      piece.add(band);
      piece.position.set(bed.x + slots[i], bed.y, bed.z);
      group.add(piece);
      cubes.push({
        node: piece, mesh: cube, band, index: i, slotX: slots[i],
        seated: true, lost: false, life: 0,
        vel: new THREE.Vector3(), spin: new THREE.Vector3()
      });
    }
    return { group, cubes, bed, size };
  }

  /* ============================================================
     TRAFFIC SYSTEM — 120 auto in 4 InstancedMesh
     ============================================================ */
  const TRAFFIC_COLORS = [0x5ee7ff, 0xffc857, 0x8affc1, 0xff8fb1, 0xb69cff, 0xf2f5ff, 0xffd166, 0x7be0ad, 0xff6b6b, 0x9ad5ff];
  const TRAFFIC_TYPES = ['citycar', 'supercar', 'pickup'];

  class TrafficSystem {
    constructor(scene, world, count) {
      this.scene = scene;
      this.world = world;
      this.count = count || 120;
      this.cars = [];
      this.debris = [];
      this.debrisCursor = 0;
      this.dummy = new THREE.Object3D();
      this.dummy.rotation.order = 'YXZ';
      this.tmp = new THREE.Vector3();
      this.deformSeed = 1;
      this.hitCallback = null;
      this.build();
    }

    rnd() {
      this.deformSeed = (this.deformSeed * 16807) % 2147483647;
      return (this.deformSeed - 1) / 2147483646;
    }

    build() {
      const n = this.count;
      this.bodyGeo = new THREE.BoxGeometry(1, 1, 1);
      this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.46, metalness: 0.18, flatShading: true });
      this.bodies = new THREE.InstancedMesh(this.bodyGeo, this.bodyMat, n);
      this.bodies.castShadow = true;
      this.bodies.receiveShadow = true;
      this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      this.cabinGeo = new THREE.BoxGeometry(1, 1, 1);
      this.cabinMat = new THREE.MeshStandardMaterial({ color: 0x2b4058, roughness: 0.32, metalness: 0.45, flatShading: true });
      this.cabins = new THREE.InstancedMesh(this.cabinGeo, this.cabinMat, n);
      this.cabins.castShadow = true;
      this.cabins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      this.roofGeo = new THREE.BoxGeometry(1, 1, 1);
      this.roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.46, metalness: 0.18, flatShading: true });
      this.roofs = new THREE.InstancedMesh(this.roofGeo, this.roofMat, n);
      this.roofs.castShadow = true;
      this.roofs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      this.wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
      this.wheelGeo.rotateZ(Math.PI / 2);
      this.wheelMat = new THREE.MeshStandardMaterial({ color: 0x121419, roughness: 0.92, flatShading: true });
      this.wheels = new THREE.InstancedMesh(this.wheelGeo, this.wheelMat, n * 4);
      this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      this.debrisGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
      this.debrisMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true });
      this.debrisMesh = new THREE.InstancedMesh(this.debrisGeo, this.debrisMat, 120);
      this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.debrisMesh.frustumCulled = false;

      this.scene.add(this.bodies, this.cabins, this.roofs, this.wheels, this.debrisMesh);

      const wheelDummy = new THREE.Object3D();
      for (let i = 0; i < n; i++) {
        const type = TRAFFIC_TYPES[i % TRAFFIC_TYPES.length];
        const def = CAR_DEFS[type];
        const car = {
          index: i, type, def,
          mode: 'hw', lane: 0, p: 0, dir: 1, speed: 10,
          x: 0, z: 0, y: 0, yaw: 0,
          wreck: false, wreckTimer: 0, vx: 0, vz: 0, vy: 0, yawVel: 0,
          hp: 1, deform: 0, crumple: this.rnd() * 2 - 1,
          color: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length],
          active: true, hitCooldown: 0, wheelSpin: 0
        };
        this.cars.push(car);
        this.bodies.setColorAt(i, new THREE.Color(car.color));
        this.cabins.setColorAt(i, new THREE.Color(0x20314a));
        this.roofs.setColorAt(i, new THREE.Color(car.color));
        this.spawnCar(car, true, { x: 0, z: 0 });
      }
      this.bodies.instanceColor.needsUpdate = true;
      this.cabins.instanceColor.needsUpdate = true;
      this.roofs.instanceColor.needsUpdate = true;

      /* detriti: 120 blocchi pooling */
      const dCol = [0xffb347, 0x6f7c8c, 0xff5e9c, 0x5ee7ff, 0x2a3340];
      for (let i = 0; i < 120; i++) {
        this.debris.push({
          active: false, life: 0, x: 0, y: -100, z: 0,
          vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, spin: 0
        });
        this.debrisMesh.setColorAt(i, new THREE.Color(dCol[i % dCol.length]));
      }
      if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;

      for (let i = 0; i < this.wheels.count; i++) {
        wheelDummy.position.set(0, -100, 0);
        wheelDummy.scale.set(0.001, 0.001, 0.001);
        wheelDummy.updateMatrix();
        this.wheels.setMatrixAt(i, wheelDummy.matrix);
      }
      this.wheels.instanceMatrix.needsUpdate = true;
    }

    spawnCar(car, initial, playerPos) {
      const px = playerPos ? playerPos.x : 0;
      const pz = playerPos ? playerPos.z : 0;
      car.wreck = false;
      car.wreckTimer = 0;
      car.hp = 1;
      car.deform = 0;
      car.crumple = this.rnd() * 2 - 1;
      car.vy = 0;
      car.vx = 0;
      car.vz = 0;
      car.yawVel = 0;
      car.hitCooldown = 0;

      const nearHighway = Math.abs(px) < 55;
      const roll = this.rnd();
      if (roll < (nearHighway ? 0.62 : 0.34)) {
        car.mode = 'hw';
        car.lane = [-9, -4.5, 4.5, 9][Math.floor(this.rnd() * 4)];
        car.dir = car.lane < 0 ? 1 : -1;
        car.p = pz + (initial ? this.rnd() * 700 - 350 : (this.rnd() < 0.5 ? -1 : 1) * (230 + this.rnd() * 80));
        car.speed = 12 + this.rnd() * 9;
      } else if (roll < 0.68) {
        car.mode = 'cz';
        car.lane = [80, 160, 240][Math.floor(this.rnd() * 3)] + (this.rnd() < 0.5 ? -3.2 : 3.2);
        car.dir = this.rnd() < 0.5 ? 1 : -1;
        car.p = pz + (initial ? this.rnd() * 440 - 220 : (this.rnd() < 0.5 ? -1 : 1) * (240 + this.rnd() * 60));
        car.speed = 8 + this.rnd() * 6;
      } else {
        car.mode = 'cx';
        car.lane = [-200, -120, -40, 40, 120, 200][Math.floor(this.rnd() * 6)] + (this.rnd() < 0.5 ? -3.2 : 3.2);
        car.dir = this.rnd() < 0.5 ? 1 : -1;
        car.p = px + (initial ? this.rnd() * 260 - 130 : (this.rnd() < 0.5 ? -1 : 1) * (230 + this.rnd() * 60));
        car.speed = 8 + this.rnd() * 6;
      }
      this.placeCar(car);
    }

    placeCar(car) {
      if (car.mode === 'hw' || car.mode === 'cz') {
        car.x = car.lane;
        car.z = car.p;
        car.yaw = car.dir > 0 ? 0 : Math.PI;
      } else {
        car.x = car.p;
        car.z = car.lane;
        car.yaw = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      car.y = this.world.heightAt(car.x, car.z);
    }

    setMatrixForCar(car) {
      const def = car.def;
      const s = 0.92;
      const d = this.dummy;
      const b = def.body;
      const c = def.cabin;
      const wh = def.wheel;
      const yaw = car.yaw;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const deform = car.deform;
      const crash = car.wreck;

      const bodyY = car.y + (wh.r + b.h * 0.5 - 0.06) * s;
      d.position.set(car.x, bodyY, car.z);
      d.rotation.set(crash ? deform * 0.2 * car.crumple : 0, yaw, crash ? deform * 0.24 * car.crumple : 0);
      d.scale.set(
        b.w * s * (1 + deform * 0.16),
        b.h * s * (1 - deform * 0.38),
        b.l * s * (1 + deform * 0.1)
      );
      d.updateMatrix();
      this.bodies.setMatrixAt(car.index, d.matrix);

      const cabY = bodyY + (b.h * 0.5 + c.h * 0.5 - 0.06) * s;
      const ox = cos * (c.z * s);
      const oz = -sin * (c.z * s);
      d.position.set(car.x + ox, cabY, car.z + oz);
      d.rotation.set(crash ? -deform * 0.3 : 0, yaw, crash ? deform * 0.3 : 0);
      d.scale.set(c.w * s * (1 + deform * 0.2), c.h * s * (1 - deform * 0.45), c.l * s);
      d.updateMatrix();
      this.cabins.setMatrixAt(car.index, d.matrix);

      const roofY = cabY + (c.h * 0.5 + 0.03) * s;
      d.position.set(car.x + ox, roofY, car.z + oz);
      d.rotation.set(crash ? -deform * 0.3 : 0, yaw, crash ? deform * 0.3 : 0);
      d.scale.set(c.w * s * 0.97, 0.08 * s, c.l * s * 0.9);
      d.updateMatrix();
      this.roofs.setMatrixAt(car.index, d.matrix);

      for (let k = 0; k < 4; k++) {
        const sx = k < 2 ? 1 : -1;
        const sz = (k % 2 === 0) ? 1 : -1;
        const lx = sx * wh.x * s;
        const lz = sz * wh.z * s;
        const wx = car.x + cos * lx + sin * lz;
        const wz = car.z - sin * lx + cos * lz;
        const wobble = crash ? deform * 0.5 * car.crumple : 0;
        d.position.set(wx, car.y + wh.r * s + (crash ? 0.06 : 0), wz);
        d.rotation.set(car.wheelSpin, yaw + wobble, 0);
        d.scale.set(wh.thickness * s, wh.r * 2 * s, wh.r * 2 * s);
        d.updateMatrix();
        this.wheels.setMatrixAt(car.index * 4 + k, d.matrix);
      }
    }

    update(dt, playerPos, quiet, playing) {
      dt = Math.min(dt, 1 / 25);
      const px = playerPos ? playerPos.x : 0;
      const pz = playerPos ? playerPos.z : 0;
      this.dummy.rotation.order = 'YXZ';

      for (const car of this.cars) {
        if (car.hitCooldown > 0) car.hitCooldown -= dt;

        if (car.wreck) {
          car.wreckTimer += dt;
          car.vy -= 24 * dt;
          car.x += car.vx * dt;
          car.z += car.vz * dt;
          car.y += car.vy * dt;
          car.yaw += car.yawVel * dt;
          const ground = this.world.heightAt(car.x, car.z);
          if (car.y < ground + 0.25) {
            car.y = ground + 0.25;
            if (car.vy < -1.5) {
              car.vy *= -0.28;
              car.vx *= 0.72;
              car.vz *= 0.72;
            } else {
              car.vy = 0;
            }
            car.vx *= Math.exp(-2.2 * dt);
            car.vz *= Math.exp(-2.2 * dt);
            car.yawVel *= Math.exp(-2.6 * dt);
          }
          if (car.wreckTimer > 9 || Math.abs(car.x) > 560 || Math.abs(car.z) > 560) {
            this.spawnCar(car, false, playerPos);
          }
          car.wheelSpin += dt * 2;
          this.setMatrixForCar(car);
          continue;
        }

        car.p += car.dir * car.speed * dt;
        this.placeCar(car);
        car.wheelSpin += (car.speed / 0.4) * dt;

        const dx = car.x - px;
        const dz = car.z - pz;
        const dist2 = dx * dx + dz * dz;
        const out =
          (car.mode === 'hw' && Math.abs(car.p) > 530) ||
          (car.mode === 'cz' && Math.abs(car.p) > 280) ||
          (car.mode === 'cx' && (car.p < 30 || car.p > 335));

        if (dist2 > 430 * 430 || out || (quiet && car.mode === 'hw')) {
          this.spawnCar(car, false, playerPos);
        }
        this.setMatrixForCar(car);
      }

      this.updateDebris(dt);
      this.bodies.instanceMatrix.needsUpdate = true;
      this.cabins.instanceMatrix.needsUpdate = true;
      this.roofs.instanceMatrix.needsUpdate = true;
      this.wheels.instanceMatrix.needsUpdate = true;
    }

    updateDebris(dt) {
      for (let i = 0; i < this.debris.length; i++) {
        const p = this.debris[i];
        if (!p.active) continue;
        p.life -= dt;
        p.vy -= 22 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.rx += p.spin * dt;
        p.ry += p.spin * 0.8 * dt;
        const ground = this.world.heightAt(p.x, p.z);
        if (p.y < ground + 0.16) {
          p.y = ground + 0.16;
          p.vy *= -0.3;
          p.vx *= 0.7;
          p.vz *= 0.7;
          p.spin *= 0.7;
        }
        if (p.life <= 0) {
          p.active = false;
          p.y = -100;
        }
        const d = this.dummy;
        d.position.set(p.x, p.y, p.z);
        d.rotation.set(p.rx, p.ry, 0);
        d.scale.setScalar(p.active ? 1 : 0.001);
        d.updateMatrix();
        this.debrisMesh.setMatrixAt(i, d.matrix);
      }
      this.debrisMesh.instanceMatrix.needsUpdate = true;
    }

    spawnDebris(car, power) {
      const n = Math.min(12, 5 + Math.floor(power * 0.4));
      for (let k = 0; k < n; k++) {
        const p = this.debris[this.debrisCursor];
        this.debrisCursor = (this.debrisCursor + 1) % this.debris.length;
        p.active = true;
        p.life = 3 + this.rnd() * 3;
        p.x = car.x + (this.rnd() - 0.5) * 1.5;
        p.y = car.y + 0.6 + this.rnd() * 0.8;
        p.z = car.z + (this.rnd() - 0.5) * 2;
        p.vx = (this.rnd() - 0.5) * (4 + power * 0.25) + car.vx * 0.4;
        p.vy = 2 + this.rnd() * (3 + power * 0.15);
        p.vz = (this.rnd() - 0.5) * (4 + power * 0.25) + car.vz * 0.4;
        p.spin = (this.rnd() - 0.5) * 12;
      }
    }

    smash(car, vx, vz, power, depth) {
      if (!car || car.wreck || car.hitCooldown > 0) return;
      depth = depth || 0;
      car.wreck = true;
      car.wreckTimer = 0;
      car.hp = 0;
      car.hitCooldown = 0.6;
      car.deform = clamp(0.35 + power / 30, 0.35, 1);
      car.crumple = this.rnd() * 2 - 1;
      car.vx = vx * 0.82 + (this.rnd() - 0.5) * 3;
      car.vz = vz * 0.82 + (this.rnd() - 0.5) * 3;
      car.vy = 2.4 + power * 0.1;
      car.yawVel = (this.rnd() - 0.5) * (2.5 + power * 0.16);
      car.y = Math.max(car.y, this.world.heightAt(car.x, car.z)) + 0.2;
      this.spawnDebris(car, power);

      if (this.hitCallback) this.hitCallback(car, power);

      if (depth < 3 && power > 3.5) {
        for (const other of this.cars) {
          if (other === car || other.wreck) continue;
          const dx = other.x - car.x;
          const dz = other.z - car.z;
          const d = Math.hypot(dx, dz);
          if (d < 12.5) {
            const k = (1 - d / 12.5) * 0.72;
            this.smash(
              other,
              (dx / (d || 1)) * power * 0.6 + car.vx * 0.4,
              (dz / (d || 1)) * power * 0.6 + car.vz * 0.4,
              power * k,
              depth + 1
            );
          }
        }
      }
      this.setMatrixForCar(car);
    }

    collidePlayer(physics) {
      if (physics.impactCooldown > 0) return null;
      const sp = physics.speed;
      if (sp < 3.5) return null;
      let nearest = null;
      let best = Infinity;
      for (const car of this.cars) {
        if (car.wreck) continue;
        const dx = car.x - physics.position.x;
        const dz = car.z - physics.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 4.3 * 4.3 && d2 < best) { best = d2; nearest = car; }
      }
      if (!nearest) return null;
      const power = clamp(sp * 0.62, 3, 24);
      this.smash(nearest, physics.velocity.x * 1.05, physics.velocity.z * 1.05, power, 0);
      return {
        index: nearest.index,
        x: nearest.x,
        z: nearest.z,
        power,
        speed: sp
      };
    }

    reset() {
      for (const car of this.cars) this.spawnCar(car, true, { x: 0, z: 0 });
      for (const p of this.debris) { p.active = false; p.y = -100; }
    }
  }

  VD.CAR_DEFS = CAR_DEFS;
  VD.buildCar = buildCar;
  VD.getBed = getBed;
  VD.buildCargo = buildCargo;
  VD.TrafficSystem = TrafficSystem;
})();
