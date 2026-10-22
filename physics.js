/* ================================================================
   VOXEL DRIVE: INFINITE HORIZON — physics.js
   VehiclePhysics: motore, cambio manuale a 6 rapporti, sospensioni
   a 4 punti, vettori di derapata, urti e vincoli del terreno.
   ================================================================ */
(function () {
  'use strict';

  window.VD = window.VD || {};

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const normAngle = (a) => {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  };

  VD.util = {
    clamp,
    lerp,
    smoothstep,
    normAngle,
    fmtTime(sec) {
      if (!isFinite(sec) || sec < 0) return '--';
      return sec.toFixed(2) + 's';
    },
    fmtClock(sec) {
      const s = Math.max(0, Math.ceil(sec));
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }
  };

  class VehiclePhysics {
    constructor(terrain, spec) {
      this.terrain = terrain;
      this.position = new THREE.Vector3(0, 0, 0);
      this.velocity = new THREE.Vector3();
      this.forward = new THREE.Vector3(0, 0, 1);
      this.right = new THREE.Vector3(1, 0, 0);
      this.colliders = [];

      this.autoMode = true;
      this.autoShiftUp = 0.87;
      this.autoShiftDown = 0.32;
      this.spec = null;

      this.gear = 1;
      this.rpm = 850;
      this.idleRpm = 850;
      this.redline = 7000;
      this.maxRpm = 7300;
      this.shiftTimer = 0;
      this.shiftFlash = 0;
      this.fuelCut = 0;
      this.stopTimer = 0;
      this.wheelSpin = 0;
      this.bogTimer = 0;
      this.staged = false;
      this.launchRpm = 0;
      this.launchAt = 0;
      this.launchLabel = '';
      this.launchMessageTimer = 0;
      this.badShift = '';
      this.badShiftTimer = 0;
      this.overRev = false;

      this.throttle = 0;
      this.brake = 0;
      this.handbrake = 0;
      this.steer = 0;
      this.steerAngle = 0;

      this.speed = 0;
      this.forwardSpeed = 0;
      this.lateralSpeed = 0;
      this.accel = 0;
      this.slipAngle = 0;
      this.drifting = false;
      this.driftIntensity = 0;

      this.verticalVel = 0;
      this.prevVerticalVel = 0;
      this.jolt = 0;
      this.grounded = true;
      this.airborneTimer = 0;
      this.bodyPitch = 0;
      this.bodyRoll = 0;
      this.leanPitch = 0;
      this.leanRoll = 0;
      this.wheelHeights = [0, 0, 0, 0];
      this.wheelOffsets = [0, 0, 0, 0];
      this.offroad = false;

      this.wallImpact = 0;
      this.impactCooldown = 0;
      this.rollover = false;

      this.driftPoints = 0;
      this.driftCombo = 0;
      this.distance = 0;

      this.applySpec(spec || {
        mass: 1200, wheelRadius: 0.37, wheelBase: 2.7, trackWidth: 2,
        gearRatios: [4.5, 2.9, 2.1, 1.65, 1.4, 1.2], reverseRatio: 4,
        finalDrive: 4.3, gearAccel: [0, 13, 9, 6.6, 5, 3.9, 3], maxSpeed: 58,
        grip: 10, offroadGrip: 6, steerLock: 0.54, redline: 7200
      });

      this.reset(0, 0, 0);
    }

    applySpec(spec) {
      this.spec = spec;
      this.mass = spec.mass || 1200;
      this.wheelRadius = spec.wheelRadius;
      this.wheelBase = spec.wheelBase;
      this.trackWidth = spec.trackWidth;
      this.gearRatios = spec.gearRatios.slice();
      this.reverseRatio = spec.reverseRatio;
      this.finalDrive = spec.finalDrive;
      this.gearAccel = spec.gearAccel.slice();
      this.maxSpeed = spec.maxSpeed;
      this.grip = spec.grip;
      this.offroadGrip = spec.offroadGrip;
      this.steerLock = spec.steerLock || 0.54;
      this.idleRpm = spec.idleRpm || 850;
      this.redline = spec.redline || 7200;
      this.maxRpm = this.redline + 240;
      this.autoShiftUp = spec.autoShiftUp || 0.87;
      this.autoShiftDown = spec.autoShiftDown || 0.32;
      this.launchWindow = spec.launchWindow || [0.46, 0.68];
      this.brakeForce = spec.brakeForce || 18;

      if (this.gear > 6) this.gear = 6;
      if (this.rpm > this.maxRpm) this.rpm = this.idleRpm;
    }

    setAuto(v) {
      this.autoMode = !!v;
      if (this.autoMode && this.gear <= 0) {
        this.gear = 1;
        this.stopTimer = 0;
      }
      if (this.autoMode) this.shiftTimer = 0;
    }

    shiftUp() {
      if (this.autoMode) return false;
      const before = this.rpm;
      let changed = false;
      if (this.gear === -1) { this.gear = 0; changed = true; }
      else if (this.gear === 0) { this.gear = 1; changed = true; }
      else if (this.gear < 6) { this.gear++; changed = true; }
      if (!changed) return false;

      this.shiftTimer = 0.17;
      this.shiftFlash = 0.55;
      this.stopTimer = 0;
      this.badShift = '';
      if (this.throttle > 0.72 && this.gear > 1) {
        this.wheelSpin = Math.min(1, this.wheelSpin + 0.32);
        this.badShift = 'CAMBIO SENZA GAS RILASCIATO';
        this.badShiftTimer = 1.4;
      }
      if (this.gear > 1 && before > this.redline * 0.955) {
        this.wheelSpin = Math.min(1, this.wheelSpin + 0.35);
        this.badShift = 'FUORI GIRI · GOMME IN PATTINAMENTO';
        this.badShiftTimer = 1.4;
      }
      return true;
    }

    shiftDown() {
      if (this.autoMode) return false;
      const before = this.rpm;
      const speed = Math.abs(this.forwardSpeed);
      let changed = false;
      if (this.gear === 1) { this.gear = 0; changed = true; }
      else if (this.gear === 0) { this.gear = -1; changed = true; }
      else if (this.gear > 1) { this.gear--; changed = true; }
      if (!changed) return false;

      this.shiftTimer = 0.17;
      this.shiftFlash = 0.55;
      this.stopTimer = 0;
      this.badShift = '';

      if (this.gear > 0) {
        const ratio = this.gearRatios[this.gear - 1];
        const newRpm = (speed / (2 * Math.PI * this.wheelRadius)) * ratio * this.finalDrive * 60;
        if (this.gear > 0 && newRpm > this.redline * 1.02 && speed > 6) {
          this.wheelSpin = Math.min(1, this.wheelSpin + 0.65);
          this.badShift = 'SOVRAGIRI · TRAZIONE PERSA';
          this.badShiftTimer = 1.6;
          this.fuelCut = 0.25;
        }
      } else if (before > this.redline * 0.8) {
        this.wheelSpin = Math.min(1, this.wheelSpin + 0.3);
      }
      return true;
    }

    reset(x, z, yaw) {
      x = x === undefined ? 0 : x;
      z = z === undefined ? 0 : z;
      const h = this.terrain ? this.terrain.heightAt(x, z) : 0;
      this.position.set(x, h + 0.03, z);
      this.velocity.set(0, 0, 0);
      this.yaw = yaw || 0;
      this.steer = 0;
      this.steerAngle = 0;
      this.gear = 1;
      this.rpm = this.idleRpm;
      this.shiftTimer = 0;
      this.shiftFlash = 0;
      this.fuelCut = 0;
      this.stopTimer = 0;
      this.wheelSpin = 0;
      this.bogTimer = 0;
      this.staged = false;
      this.launchRpm = 0;
      this.launchAt = 0;
      this.launchLabel = '';
      this.launchMessageTimer = 0;
      this.badShift = '';
      this.badShiftTimer = 0;
      this.verticalVel = 0;
      this.prevVerticalVel = 0;
      this.jolt = 0;
      this.bodyPitch = 0;
      this.bodyRoll = 0;
      this.leanPitch = 0;
      this.leanRoll = 0;
      this.grounded = true;
      this.airborneTimer = 0;
      this.throttle = 0;
      this.brake = 0;
      this.handbrake = 0;
      this.speed = 0;
      this.forwardSpeed = 0;
      this.lateralSpeed = 0;
      this.accel = 0;
      this.slipAngle = 0;
      this.drifting = false;
      this.driftIntensity = 0;
      this.driftCombo = 0;
      this.distance = 0;
      this.wallImpact = 0;
      this.impactCooldown = 0;
      this.rollover = false;
      this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    }

    applyImpulse(ix, iz, yawKick) {
      this.velocity.x += ix;
      this.velocity.z += iz;
      if (yawKick) this.yaw += yawKick;
      this.impactCooldown = 0.35;
    }

    get speedKmh() {
      return this.speed * 3.6;
    }

    update(dt, input) {
      dt = clamp(dt, 1 / 240, 1 / 30);
      input = input || {};
      const terrain = this.terrain;

      /* ---------------- pedali progressivi ---------------- */
      const targetThrottle = clamp(input.throttle || 0, 0, 1);
      const targetBrake = clamp(input.brake || 0, 0, 1);
      this.throttle += (targetThrottle - this.throttle) * Math.min(1, dt * (targetThrottle > this.throttle ? 8.5 : 15));
      this.brake += (targetBrake - this.brake) * Math.min(1, dt * 12);
      this.handbrake += ((input.handbrake ? 1 : 0) - this.handbrake) * Math.min(1, dt * 11);

      /* ---------------- sterzo ---------------- */
      const targetSteer = clamp(input.steer || 0, -1, 1);
      this.steer += (targetSteer - this.steer) * Math.min(1, dt * (targetSteer ? 7.5 : 10));

      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      this.speed = speed;

      let fwdX = Math.sin(this.yaw);
      let fwdZ = Math.cos(this.yaw);
      const vf0 = this.velocity.x * fwdX + this.velocity.z * fwdZ;

      const lock = this.steerLock * (1 - clamp(speed / (this.maxSpeed * 1.7), 0, 0.58));
      this.steerAngle = this.steer * lock;

      /* ---------------- imbardata ---------------- */
      const desiredYaw = (vf0 / Math.max(this.wheelBase, 1.8)) * Math.tan(this.steerAngle);
      let maxYaw = Math.min(2.85, 15 / Math.max(Math.abs(vf0), 4));
      let yawRate = clamp(desiredYaw, -maxYaw, maxYaw);
      if (this.handbrake > 0.15 && Math.abs(vf0) > 2) {
        yawRate += this.steer * 1.3 * clamp(Math.abs(vf0) / 21, 0, 1) * this.handbrake;
      }
      if (this.drifting) yawRate += this.steer * 0.45;
      this.yaw = normAngle(this.yaw + yawRate * dt);

      fwdX = Math.sin(this.yaw);
      fwdZ = Math.cos(this.yaw);
      const rX = Math.cos(this.yaw);
      const rZ = -Math.sin(this.yaw);
      this.forward.set(fwdX, 0, fwdZ);
      this.right.set(rX, 0, rZ);

      let vf = this.velocity.x * fwdX + this.velocity.z * fwdZ;
      let vl = this.velocity.x * rX + this.velocity.z * rZ;

      /* ---------------- cambio automatico / retromarcia ---------------- */
      if (this.autoMode) {
        if (this.gear >= 1 && this.brake > 0.3 && this.throttle < 0.05 && Math.abs(vf) < 0.9) {
          this.stopTimer += dt;
          if (this.stopTimer > 0.32) { this.gear = -1; this.stopTimer = 0; }
        } else if (this.gear === -1 && this.throttle > 0.3 && this.brake < 0.05 && Math.abs(vf) < 0.9) {
          this.stopTimer += dt;
          if (this.stopTimer > 0.32) { this.gear = 1; this.stopTimer = 0; }
        } else {
          this.stopTimer = 0;
        }
      }

      this.shiftTimer = Math.max(0, this.shiftTimer - dt);
      this.shiftFlash = Math.max(0, this.shiftFlash - dt);
      this.fuelCut = Math.max(0, this.fuelCut - dt);
      this.bogTimer = Math.max(0, this.bogTimer - dt);
      this.launchMessageTimer = Math.max(0, this.launchMessageTimer - dt);
      this.badShiftTimer = Math.max(0, this.badShiftTimer - dt);
      this.impactCooldown = Math.max(0, this.impactCooldown - dt);

      /* ---------------- staging / launch ---------------- */
      const holdingBrake = this.brake > 0.28 || this.handbrake > 0.45;
      if (holdingBrake && Math.abs(vf) < 1.4 && this.gear >= 1) {
        this.staged = true;
      } else if (this.staged) {
        this.staged = false;
        this.evaluateLaunch();
      }

      /* ---------------- contagiri ---------------- */
      const ratio = this.gear === -1 ? this.reverseRatio : (this.gear > 0 ? this.gearRatios[this.gear - 1] : 0);
      let targetRpm;
      if (this.gear > 0 || this.gear === -1) {
        if (this.staged && this.gear > 0) {
          targetRpm = this.idleRpm + this.throttle * (this.redline * 0.985 - this.idleRpm);
        } else {
          const wheelRps = Math.abs(vf) / (2 * Math.PI * this.wheelRadius);
          targetRpm = wheelRps * ratio * this.finalDrive * 60;
          if (this.gear === 0) targetRpm = this.idleRpm;
        }
        if (this.shiftTimer > 0) targetRpm = Math.max(this.idleRpm, targetRpm * 0.55);
      } else {
        targetRpm = this.idleRpm + this.throttle * (this.redline - this.idleRpm) * 0.85;
      }
      targetRpm = Math.max(targetRpm, this.idleRpm) + this.wheelSpin * 1500;
      this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 10.5);
      this.rpm = clamp(this.rpm, this.idleRpm, this.maxRpm);

      this.overRev = false;
      if (!this.staged && this.rpm > this.redline && this.gear > 0) {
        this.fuelCut = Math.max(this.fuelCut, 0.08);
        this.overRev = true;
      }

      /* cambio automatico (in manuale comanda il giocatore) */
      if (this.autoMode && this.shiftTimer <= 0 && this.gear > 0 && !this.staged) {
        if (this.rpm > this.redline * this.autoShiftUp && this.gear < 6) {
          this.gear++;
          this.shiftTimer = 0.4;
          this.shiftFlash = 0.4;
        } else if (this.rpm < this.redline * this.autoShiftDown && this.gear > 1) {
          this.gear--;
          this.shiftTimer = 0.45;
          this.shiftFlash = 0.4;
        }
      }

      /* ---------------- motore ---------------- */
      let throttle = this.throttle;
      let brake = this.brake;
      if (this.gear === -1) {
        throttle = this.brake;
        brake = this.throttle;
      }

      let engineAccel = 0;
      if (this.gear !== 0 && throttle > 0.01 && this.fuelCut <= 0 && this.shiftTimer <= 0 && !this.staged) {
        const base = this.gear === -1 ? 7.2 : this.gearAccel[this.gear];
        const torque = 0.5 + 0.5 * Math.sin(Math.PI * clamp(this.rpm / this.redline, 0.06, 1));
        engineAccel = throttle * base * torque * (1 - this.wheelSpin * 0.62);
        if (this.bogTimer > 0) engineAccel *= 0.38;
        if (this.gear === -1) engineAccel = -engineAccel;
      }

      const drag = 0.00075 * vf * Math.abs(vf);
      const rolling = 0.022 * vf;
      let accel = engineAccel - drag - rolling;

      if (this.throttle < 0.04 && this.gear > 0 && Math.abs(vf) > 0.2) {
        accel -= Math.sign(vf) * (0.9 + Math.abs(vf) * 0.012);
      }
      if (brake > 0.02 && Math.abs(vf) > 0.04) {
        accel -= Math.sign(vf) * Math.min(this.brakeForce * brake, Math.abs(vf) / Math.max(dt, 0.001));
      }
      if (this.handbrake > 0.02 && Math.abs(vf) > 0.04) {
        accel -= Math.sign(vf) * Math.min(4.8 * this.handbrake, Math.abs(vf) / Math.max(dt, 0.001));
      }

      const oldVf = vf;
      vf += accel * dt;
      if (brake > 0.05 && oldVf !== 0 && Math.sign(vf) !== Math.sign(oldVf)) vf = 0;
      vf = clamp(vf, -17, this.maxSpeed);
      this.forwardSpeed = vf;
      this.accel = accel;

      /* ---------------- aderenza laterale / drift ---------------- */
      const surf = terrain && terrain.surfaceAt ? terrain.surfaceAt(this.position.x, this.position.z) : { grip: 1, offroad: false };
      this.offroad = !!surf.offroad;
      let grip = this.offroad ? this.offroadGrip : this.grip;
      grip *= surf.grip === undefined ? 1 : surf.grip;
      if (this.handbrake > 0.05) grip = lerp(grip, 1.15, this.handbrake);
      else if (speed > 17 && Math.abs(this.steer) > 0.55) grip *= 0.42;
      if (this.wheelSpin > 0.15) grip *= 0.78;
      vl *= Math.exp(-grip * dt);
      this.lateralSpeed = vl;

      this.slipAngle = Math.atan2(Math.abs(vl), Math.abs(vf) + 0.42);
      this.drifting = speed > 8 && this.slipAngle > 0.17 && Math.abs(vf) > 2.5;
      this.driftIntensity = this.drifting ? clamp(this.slipAngle / 0.9, 0, 1) : 0;

      /* ---------------- wheelspin ---------------- */
      this.wheelSpin = Math.max(0, this.wheelSpin - dt * (1.25 + speed * 0.055));

      /* ---------------- integrazione ---------------- */
      this.velocity.set(fwdX * vf + rX * vl, 0, fwdZ * vf + rZ * vl);
      const oldX = this.position.x;
      const oldZ = this.position.z;
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
      this.position.x = clamp(this.position.x, -548, 548);
      this.position.z = clamp(this.position.z, -548, 548);
      this.distance += Math.hypot(this.position.x - oldX, this.position.z - oldZ);

      /* ---------------- collisioni con gli ostacoli ---------------- */
      this.resolveCollisions();

      /* ---------------- sospensioni a 4 punti ---------------- */
      this.updateSuspension(dt);

      /* ---------------- rollover ---------------- */
      const roll = Math.abs(this.bodyRoll);
      const pitch = Math.abs(this.bodyPitch);
      this.rollover = roll > 1.05 || pitch > 1.15;
    }

    evaluateLaunch() {
      this.launchAt = clamp(this.rpm / this.redline, 0, 1.3);
      this.launchRpm = Math.round(this.rpm);
      const lo = this.launchWindow[0];
      const hi = this.launchWindow[1];
      this.launchLabel = '';
      if (!this.forwardSpeed && Math.abs(this.speed) > 3) return;
      if (this.launchAt > 0.79) {
        this.wheelSpin = Math.min(1, this.wheelSpin + 0.95);
        this.launchLabel = 'WHEELSPIN · TROPPO GAS';
      } else if (this.launchAt < 0.3) {
        this.bogTimer = 0.9;
        this.launchLabel = 'BOG · POCHI GIRI';
      } else if (this.launchAt >= lo && this.launchAt <= hi) {
        this.wheelSpin = 0.06;
        this.launchLabel = 'LAUNCH PERFETTO';
      } else {
        this.wheelSpin = Math.min(1, this.wheelSpin + 0.3);
        this.launchLabel = 'LAUNCH OK · LEGGERO SLITTAMENTO';
      }
      this.launchMessageTimer = 2.2;
    }

    resolveCollisions() {
      const carRadius = Math.max(1.02, this.trackWidth * 0.5);
      let strongest = 0;
      for (let i = 0; i < this.colliders.length; i++) {
        const c = this.colliders[i];
        const dx = this.position.x - c.x;
        const dz = this.position.z - c.z;
        const cos = Math.cos(c.yaw || 0);
        const sin = Math.sin(c.yaw || 0);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const penX = c.hw + carRadius - Math.abs(lx);
        const penZ = c.hd + carRadius - Math.abs(lz);
        if (penX <= 0 || penZ <= 0) continue;

        let nx, nz, push;
        if (penX < penZ) {
          const s = lx >= 0 ? 1 : -1;
          nx = cos * s;
          nz = -sin * s;
          push = penX;
        } else {
          const s = lz >= 0 ? 1 : -1;
          nx = sin * s;
          nz = cos * s;
          push = penZ;
        }
        this.position.x += nx * push;
        this.position.z += nz * push;
        const vn = this.velocity.x * nx + this.velocity.z * nz;
        if (vn < 0) {
          strongest = Math.max(strongest, -vn);
          this.velocity.x -= nx * vn * 1.12;
          this.velocity.z -= nz * vn * 1.12;
          this.velocity.multiplyScalar(0.9);
          this.wheelSpin = Math.min(1, this.wheelSpin + Math.min(0.3, -vn * 0.015));
        }
      }
      if (strongest > 0) {
        this.wallImpact = strongest;
        if (this.impactCooldown <= 0) {
          this.impactCooldown = 0.3;
          this.applyImpulse(0, 0, 0);
        }
      } else {
        this.wallImpact = 0;
      }
    }

    updateSuspension(dt) {
      const terrain = this.terrain;
      if (!terrain || !terrain.heightAt) return;

      const halfW = this.trackWidth / 2;
      const halfL = this.wheelBase / 2;
      const fx = this.forward.x;
      const fz = this.forward.z;
      const rx = this.right.x;
      const rz = this.right.z;
      const px = this.position.x;
      const pz = this.position.z;
      const sample = (ox, oz) => terrain.heightAt(px + rx * ox + fx * oz, pz + rz * ox + fz * oz);

      const hFL = sample(halfW, halfL);
      const hFR = sample(-halfW, halfL);
      const hRL = sample(halfW, -halfL);
      const hRR = sample(-halfW, -halfL);
      this.wheelHeights[0] = hFL;
      this.wheelHeights[1] = hFR;
      this.wheelHeights[2] = hRL;
      this.wheelHeights[3] = hRR;

      const frontH = (hFL + hFR) * 0.5;
      const rearH = (hRL + hRR) * 0.5;
      const leftH = (hFL + hRL) * 0.5;
      const rightH = (hFR + hRR) * 0.5;
      const targetY = (frontH + rearH) * 0.5 + 0.02;

      this.prevVerticalVel = this.verticalVel;
      this.verticalVel += ((targetY - this.position.y) * 78 - this.verticalVel * 12) * dt;
      if (this.position.y > targetY + 0.5) this.verticalVel -= 19 * dt;
      this.position.y += this.verticalVel * dt;

      const minY = targetY - 0.72;
      if (this.position.y < minY) {
        this.position.y = minY;
        if (this.verticalVel < 0) this.verticalVel = 0;
      }

      const rawJolt = Math.abs((this.verticalVel - this.prevVerticalVel) / Math.max(dt, 0.001));
      this.jolt += (rawJolt - this.jolt) * Math.min(1, dt * 8);
      this.grounded = Math.abs(this.position.y - targetY) < 0.55;
      this.airborneTimer = this.grounded ? 0 : this.airborneTimer + dt;

      const terrainPitch = Math.atan2(rearH - frontH, this.wheelBase);
      const terrainRoll = Math.atan2(leftH - rightH, Math.max(this.trackWidth, 1.4));
      const leanPitchTarget = -this.accel * 0.0042;
      const leanRollTarget = this.steer * Math.min(Math.abs(this.forwardSpeed), 45) * 0.0028;
      const leanSmooth = Math.min(1, dt * 8);
      this.leanPitch += (leanPitchTarget - this.leanPitch) * leanSmooth;
      this.leanRoll += (leanRollTarget - this.leanRoll) * leanSmooth;

      const attSmooth = Math.min(1, dt * 11);
      this.bodyPitch += ((terrainPitch + this.leanPitch) - this.bodyPitch) * attSmooth;
      this.bodyRoll += ((terrainRoll + this.leanRoll) - this.bodyRoll) * attSmooth;

      this.wheelOffsets[0] = hFL - targetY;
      this.wheelOffsets[1] = hFR - targetY;
      this.wheelOffsets[2] = hRL - targetY;
      this.wheelOffsets[3] = hRR - targetY;
    }
  }

  VD.VehiclePhysics = VehiclePhysics;
})();
