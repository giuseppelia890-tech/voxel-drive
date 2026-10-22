/* ================================================================
   VOXEL DRIVE: INFINITE HORIZON — game.js
   Loop principale, input, camera, HUD, audio, 5 sfide e salvataggi.
   ================================================================ */
(function () {
  'use strict';

  window.VD = window.VD || {};
  const { clamp, lerp, normAngle, fmtTime, fmtClock } = VD.util;
  const el = (id) => document.getElementById(id);

  /* ------------------------ device / quality ------------------- */
  const forceTouch = /(?:\?|&)touch=1/.test(location.search);
  const coarsePointer = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const isTouch = forceTouch || coarsePointer || ((navigator.maxTouchPoints || 0) > 0 && mobileUA);
  const isMobile = isTouch && Math.min(innerWidth, innerHeight) < 900;
  if (isTouch) document.body.classList.add('touch');

  const QUALITY = {
    shadow: isMobile ? 1024 : 2048,
    pixelRatio: isMobile ? 1.6 : 2,
    traffic: 120
  };

  /* --------------------------- scene --------------------------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd8ff);
  scene.fog = new THREE.Fog(0xa8dcff, 250, 720);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1800);
  camera.position.set(0, 6, -18);
  camera.lookAt(0, 1.4, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.domElement.id = 'gameCanvas';
  document.body.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xc9e8ff, 0x3f4a34, 0.72);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.16);
  sun.position.set(70, 120, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(QUALITY.shadow, QUALITY.shadow);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 460;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  /* ---------------------------- mondo -------------------------- */
  const world = new VD.World(scene);
  world.build();
  world.addSky();

  const traffic = new VD.TrafficSystem(scene, world, QUALITY.traffic);
  const physics = new VD.VehiclePhysics(world, VD.CAR_DEFS.supercar.physics);
  physics.colliders = world.colliders;

  /* --------------------------- player -------------------------- */
  let state = 'menu';
  let autoMode = true;
  let selectedCar = 'supercar';
  let playerType = 'supercar';
  let playerCar = null;
  let cargo = null;
  let currentMode = 'free';
  let parkedCount = 0;
  let driftTotal = 0;

  const RECOMMENDED = {
    free: 'supercar', parking: 'citycar', drag: 'supercar',
    drift: 'supercar', delivery: 'pickup'
  };

  const records = loadRecords();

  /* ------------------------- salvataggi ------------------------ */
  function loadRecords() {
    const def = { drag: 0, drift: 0, delivery: 0, parking: {}, perfect: 0 };
    try {
      const raw = localStorage.getItem('vd_records_v2');
      if (!raw) return def;
      const parsed = JSON.parse(raw);
      return Object.assign(def, parsed, { parking: parsed.parking || {} });
    } catch (err) {
      return def;
    }
  }

  function saveRecords() {
    try { localStorage.setItem('vd_records_v2', JSON.stringify(records)); } catch (err) {}
    updateRecordLine();
  }

  function updateRecordLine() {
    const line = el('recordLine');
    if (!line) return;
    const parts = [];
    if (records.drag) parts.push('0-400: ' + fmtTime(records.drag));
    if (records.drift) parts.push('DRIFT: ' + Math.floor(records.drift));
    if (records.delivery) parts.push('CONSEGNA: ' + fmtClock(records.delivery));
    parts.push('PARKING PERFECT: ' + (records.perfect || 0));
    line.textContent = 'RECORD · ' + parts.join(' · ');
  }

  /* ---------------------- costruzione auto --------------------- */
  function disposeCar(car) {
    if (!car) return;
    car.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }

  function setupCargo(def) {
    if (cargo) {
      for (const cube of cargo.cubes) {
        if (cube.node.parent) cube.node.parent.remove(cube.node);
      }
      if (cargo.group.parent) cargo.group.parent.remove(cargo.group);
      cargo = null;
    }
    if (!def || !def.bed) return;
    cargo = VD.buildCargo(def);
    playerCar.add(cargo.group);
  }

  function makePlayerCar(type, keepPosition) {
    if (!VD.CAR_DEFS[type]) type = 'supercar';
    const def = VD.CAR_DEFS[type];
    if (playerCar) {
      scene.remove(playerCar);
      disposeCar(playerCar);
    }
    playerType = type;
    playerCar = VD.buildCar(def.color, { def });
    playerCar.rotation.order = 'YXZ';
    scene.add(playerCar);
    physics.applySpec(def.physics);
    physics.gear = 1;
    physics.rpm = physics.idleRpm;
    setupCargo(def);
    if (!keepPosition) {
      const sp = world.spawns.free;
      physics.reset(sp.x, sp.z, sp.yaw);
    }
    syncPlayer(0);
  }

  function resetCargo() {
    if (!cargo) return;
    for (const cube of cargo.cubes) {
      cube.seated = true;
      cube.lost = false;
      cube.life = 0;
      cube.vel.set(0, 0, 0);
      cube.spin.set(0, 0, 0);
      if (cube.node.parent !== cargo.group) cargo.group.add(cube.node);
      cube.node.position.set(cargo.bed.x + cube.slotX, cargo.bed.y, cargo.bed.z);
      cube.node.rotation.set(0, 0, 0);
    }
    cargo.loaded = true;
  }

  function syncPlayer(dt) {
    if (!playerCar) return;
    playerCar.position.copy(physics.position);
    playerCar.rotation.set(physics.bodyPitch, physics.yaw, physics.bodyRoll);

    const spin = (physics.forwardSpeed / physics.wheelRadius) * dt;
    const wheels = playerCar.userData.wheels;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      w.mesh.rotation.x += spin;
      if (w.front) w.mesh.rotation.y = physics.steerAngle * 0.85;
    }
    if (cargo && cargo.loaded) {
      for (const cube of cargo.cubes) {
        if (cube.seated) cube.node.position.set(cargo.bed.x + cube.slotX, cargo.bed.y, cargo.bed.z);
      }
    }
  }

  /* ---------------------------- audio -------------------------- */
  const Sound = {
    ctx: null, ready: false, muted: false, paused: false,
    engine: null, sub: null, filter: null, engineGain: null,
    noise: null, noiseGain: null,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 650;
      this.filter.Q.value = 0.8;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0.0001;

      this.engine = ctx.createOscillator();
      this.engine.type = 'sawtooth';
      this.engine.frequency.value = 60;
      this.sub = ctx.createOscillator();
      this.sub.type = 'square';
      this.sub.frequency.value = 30;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.3;
      this.engine.connect(this.filter);
      this.sub.connect(subGain);
      subGain.connect(this.filter);
      this.filter.connect(this.engineGain);
      this.engineGain.connect(ctx.destination);
      this.engine.start();
      this.sub.start();

      const len = Math.floor(ctx.sampleRate * 1.2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = ctx.createBufferSource();
      this.noise.buffer = buf;
      this.noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 0.8;
      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0.0001;
      this.noise.connect(bp);
      bp.connect(this.noiseGain);
      this.noiseGain.connect(ctx.destination);
      this.noise.start();
      this.ready = true;
    },

    resume() {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    update(rpm, throttle, speed, drifting, redline) {
      if (!this.ready || this.muted || this.paused) return;
      const t = this.ctx.currentTime;
      const n = clamp(rpm / (redline || 7600), 0, 1);
      const f = 45 + n * 165;
      this.engine.frequency.setTargetAtTime(f, t, 0.06);
      this.sub.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      this.filter.frequency.setTargetAtTime(480 + n * 1200, t, 0.08);
      const vol = 0.015 + throttle * 0.032 + clamp(speed / 60, 0, 1) * 0.012;
      this.engineGain.gain.setTargetAtTime(vol, t, 0.12);
      this.noiseGain.gain.setTargetAtTime(drifting ? 0.03 : 0.0001, t, 0.12);
    },

    setPaused(p) {
      this.paused = !!p;
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      if (p) {
        this.engineGain.gain.setTargetAtTime(0.0001, t, 0.12);
        this.noiseGain.gain.setTargetAtTime(0.0001, t, 0.12);
      }
    },

    chime(freq, dur, type) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq || 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.14));
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start(t);
      o.stop(t + (dur || 0.14) + 0.03);
    },

    crash(power) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * 0.4);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = clamp(0.1 + power * 0.03, 0.1, 0.5);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900 + power * 40;
      src.connect(f);
      f.connect(g);
      g.connect(ctx.destination);
      src.start(t);
    }
  };
  Sound.muted = localStorage.getItem('vd_muted') === '1';

  /* ---------------------------- input -------------------------- */
  const keys = Object.create(null);
  const blocked = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  const touchInput = { left: false, right: false, throttle: false, brake: false, handbrake: false };

  addEventListener('keydown', (e) => {
    if (blocked.indexOf(e.code) !== -1) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;

    if (e.code === 'Enter' && state === 'menu') {
      startGame('free');
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      return;
    }
    if (state !== 'playing') return;

    if (e.code === 'KeyC') cycleCamera();
    if (e.code === 'KeyM') toggleMode();
    if (e.code === 'KeyR') respawn();
    if (e.code === 'KeyH') toggleHelp();
    if (e.code === 'KeyE') {
      if (physics.autoMode) toggleMode();
      if (physics.shiftUp()) Sound.chime(720, 0.05);
      toastShift();
    }
    if (e.code === 'KeyQ') {
      if (physics.autoMode) toggleMode();
      if (physics.shiftDown()) Sound.chime(620, 0.05);
      toastShift();
    }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    resetTouchInput();
  });

  function toastShift() {
    if (physics.badShift && physics.badShiftTimer > 0) {
      toast(physics.badShift, 'warn');
    }
  }

  function resetTouchInput() {
    for (const k in touchInput) touchInput[k] = false;
    document.querySelectorAll('.tbtn.active').forEach((b) => b.classList.remove('active'));
  }

  function bindTouchControls() {
    document.querySelectorAll('#touchControls .tbtn').forEach((btn) => {
      const act = btn.dataset.act;
      const press = (e) => {
        e.preventDefault();
        if (state !== 'playing') return;
        try { btn.setPointerCapture(e.pointerId); } catch (err) {}
        btn.classList.add('active');
        if (act === 'gearUp') {
          if (physics.autoMode) toggleMode();
          if (physics.shiftUp()) Sound.chime(720, 0.05);
          toastShift();
        } else if (act === 'gearDown') {
          if (physics.autoMode) toggleMode();
          if (physics.shiftDown()) Sound.chime(620, 0.05);
          toastShift();
        } else {
          touchInput[act] = true;
        }
      };
      const release = (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        if (act !== 'gearUp' && act !== 'gearDown') touchInput[act] = false;
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }
  bindTouchControls();

  function readInput() {
    const left = keys['KeyA'] || keys['ArrowLeft'] || touchInput.left;
    const right = keys['KeyD'] || keys['ArrowRight'] || touchInput.right;
    return {
      steer: (left ? 1 : 0) - (right ? 1 : 0),
      throttle: (keys['KeyW'] || keys['ArrowUp'] || touchInput.throttle) ? 1 : 0,
      brake: (keys['KeyS'] || keys['ArrowDown'] || touchInput.brake) ? 1 : 0,
      handbrake: !!(keys['Space'] || touchInput.handbrake)
    };
  }

  /* ---------------------------- HUD refs ----------------------- */
  const speedEl = el('speed');
  const gearEl = el('gear');
  const rpmEl = el('rpm');
  const rpmArc = el('rpmArc');
  const driftEl = el('drift');
  const comboEl = el('combo');
  const driftBar = el('driftBar');
  const driftTimeEl = el('driftTime');
  const zeroEl = el('zero');
  const zoneEl = el('zonePill');
  const toastEl = el('toast');
  const parkInfoEl = el('parkInfo');
  const parkMeterEl = el('parkMeter');
  const parkAngleEl = el('parkAngle');
  const parkOffsetEl = el('parkOffset');
  const parkBarEl = el('parkBar');
  const parkGradeEl = el('parkGrade');
  const parkHintEl = el('parkHint');
  const challengePanel = el('challengePanel');
  const chKind = el('chKind');
  const chTitle = el('chTitle');
  const chTimer = el('chTimer');
  const chSub = el('chSub');
  const chProgress = el('chProgress');
  const cargoPanel = el('cargoPanel');
  const cargoDots = el('cargoDots');
  const cargoText = el('cargoText');
  const deliveryTimeEl = el('deliveryTime');
  const launchPanel = el('launchPanel');
  const launchBar = el('launchBar');
  const launchText = el('launchText');

  const modeBtn = el('modeBtn');
  const pauseBtn = el('pauseBtn');
  const soundBtn = el('soundBtn');
  const camBtn = el('camBtn');
  const fsBtn = el('fsBtn');
  const startScreen = el('startScreen');
  const pauseScreen = el('pauseScreen');
  const carGrid = el('carGrid');
  const transBtn = el('transBtn');
  const audioOptBtn = el('audioOptBtn');
  const installBtn = el('installBtn');
  const startBtn = el('startBtn');
  const resumeBtn = el('resumeBtn');
  const restartBtn = el('restartBtn');
  const menuBtn = el('menuBtn');
  const pauseSoundBtn = el('pauseSoundBtn');
  const pauseCamBtn = el('pauseCamBtn');
  const helpBtn = el('helpBtn');

  /* --------------------------- stato sfide --------------------- */
  const parking = {
    nearest: null, timer: 0, grade: '', lastAward: 0
  };

  const drag = {
    state: 'idle', countdown: 0, elapsed: 0, finishTimer: 0,
    best: records.drag || 0, lastResult: 0, quiet: false
  };

  const drift = {
    zoneState: 'idle', timeLeft: 0, score: 0, best: records.drift || 0,
    live: false, liveTime: 0, livePoints: 0, multiplier: 1, idle: 0, lastBank: 0
  };

  const delivery = {
    active: false, failed: false, done: false, time: 0, routeIndex: 0,
    armed: true, best: records.delivery || 0, cooldown: 0
  };

  const zero = { state: 0, start: 0, display: '--' };
  let camMode = 0;
  let camShake = 0;
  let lastCrash = 0;
  let lastZoneName = '';
  let lastPill = '';
  let wasOffroad = false;
  let menuAngle = 0;
  let hudTimer = 0;
  let lastDriftToast = 0;
  let cargoHintCooldown = 0;

  /* --------------------------- camera -------------------------- */
  const camTarget = new THREE.Vector3();
  const idealPos = new THREE.Vector3();

  function updateCamera(dt) {
    const yaw = physics.yaw;
    const back = camMode === 0 ? 9.5 : 15;
    const up = camMode === 0 ? 4.3 : 6.8;

    idealPos.set(
      physics.position.x - Math.sin(yaw) * back,
      physics.position.y + up,
      physics.position.z - Math.cos(yaw) * back
    );
    const k = 1 - Math.exp(-6 * dt);
    camera.position.lerp(idealPos, k);

    const ground = world.heightAt(camera.position.x, camera.position.z);
    if (camera.position.y < ground + 1.4) camera.position.y = ground + 1.4;

    if (camShake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * camShake;
      camera.position.y += (Math.random() - 0.5) * camShake * 0.6;
      camera.position.z += (Math.random() - 0.5) * camShake;
      camShake *= Math.exp(-7 * dt);
    }

    camTarget.set(
      physics.position.x + Math.sin(yaw) * 5,
      physics.position.y + 1.5,
      physics.position.z + Math.cos(yaw) * 5
    );
    camera.lookAt(camTarget);

    const targetFov = 60 + clamp(physics.speed * 0.42, 0, 15);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 2.5);
    camera.updateProjectionMatrix();
  }

  function updateSun() {
    sun.position.set(physics.position.x + 70, 125, physics.position.z + 50);
    sun.target.position.set(physics.position.x, 0, physics.position.z);
    sun.target.updateMatrixWorld();
  }

  function updateMenuCamera(dt) {
    menuAngle += dt * 0.22;
    const p = physics.position;
    const r = 15;
    camera.position.set(
      p.x + Math.cos(menuAngle) * r,
      p.y + 6.2,
      p.z + Math.sin(menuAngle) * r
    );
    camera.lookAt(p.x, p.y + 1.1, p.z);
    camera.fov += (58 - camera.fov) * Math.min(1, dt * 2);
    camera.updateProjectionMatrix();
  }

  /* --------------------------- toast --------------------------- */
  let toastTimer = 0;
  function toast(text, type) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.className = 'toast ' + (type || '');
    }, 2400);
  }

  /* ------------------------ menu / avvio ----------------------- */
  function buildCarCards() {
    if (!carGrid) return;
    carGrid.innerHTML = '';
    for (const key of Object.keys(VD.CAR_DEFS)) {
      const def = VD.CAR_DEFS[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'car-card' + (key === selectedCar ? ' selected' : '');
      btn.dataset.car = key;
      btn.innerHTML =
        '<span class="car-visual" style="--c:' + def.accent + '"></span>' +
        '<span class="car-title">' + def.label + '</span>' +
        '<span class="car-tag">' + def.tagline + '</span>' +
        '<span class="statline"><em>VEL</em><i class="bar"><b style="width:' + (def.stats.speed * 100) + '%"></b></i></span>' +
        '<span class="statline"><em>GRIP</em><i class="bar"><b style="width:' + (def.stats.grip * 100) + '%"></b></i></span>' +
        '<span class="statline"><em>OFF</em><i class="bar"><b style="width:' + (def.stats.offroad * 100) + '%"></b></i></span>';
      btn.addEventListener('click', () => {
        selectedCar = key;
        document.querySelectorAll('.car-card').forEach((c) => {
          c.classList.toggle('selected', c.dataset.car === key);
        });
        if (state === 'menu') makePlayerCar(key, true);
        Sound.resume();
        Sound.chime(620, 0.06);
      });
      carGrid.appendChild(btn);
    }
  }

  function applyModeUI() {
    if (modeBtn) modeBtn.textContent = autoMode ? 'AUTO' : 'MANUALE';
    document.body.classList.toggle('manual', !autoMode);
    if (transBtn) transBtn.textContent = 'CAMBIO: ' + (autoMode ? 'AUTO' : 'MANUALE');
  }

  function updateAudioUI() {
    const on = !Sound.muted;
    if (soundBtn) {
      soundBtn.textContent = on ? '♪' : '✕';
      soundBtn.classList.toggle('off', !on);
    }
    if (audioOptBtn) audioOptBtn.textContent = 'AUDIO: ' + (on ? 'ON' : 'OFF');
    if (pauseSoundBtn) pauseSoundBtn.textContent = 'AUDIO: ' + (on ? 'ON' : 'OFF');
  }

  function toggleSound() {
    Sound.muted = !Sound.muted;
    localStorage.setItem('vd_muted', Sound.muted ? '1' : '0');
    if (!Sound.muted) {
      Sound.resume();
      Sound.chime(780, 0.07);
    }
    updateAudioUI();
  }

  function toggleMode() {
    autoMode = !autoMode;
    physics.setAuto(autoMode);
    applyModeUI();
    Sound.chime(520, 0.07);
    toast(autoMode ? 'CAMBIO AUTOMATICO' : 'CAMBIO MANUALE · Q/E o + / −', 'good');
  }

  function cycleCamera() {
    camMode = (camMode + 1) % 3;
    Sound.chime(760, 0.05);
    toast(camMode === 0 ? 'CAMERA VICINA' : camMode === 1 ? 'CAMERA LONTANA' : 'CAMERA ALTA', 'good');
  }

  async function goFullscreen() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (err) {}
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await goFullscreen();
      else await document.exitFullscreen();
    } catch (err) {}
  }

  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (err) {}
  }

  let deferredPrompt = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = '';
  });

  /* ------------------------ sfide: reset ----------------------- */
  function resetChallengeState(mode) {
    currentMode = mode;

    for (const bay of world.parkingBays) {
      bay.progress = 0;
      bay.done = false;
      bay.perfect = false;
      bay.armed = true;
      bay.lastGrade = '';
      bay.mesh.material.emissiveIntensity = 0.18;
    }
    parkedCount = 0;
    parking.timer = 0;
    parking.grade = '';
    parking.nearest = null;

    drag.state = 'idle';
    drag.countdown = 0;
    drag.elapsed = 0;
    drag.finishTimer = 0;
    drag.lastResult = 0;
    drag.quiet = false;
    setDragLights(-1);

    drift.zoneState = 'idle';
    drift.timeLeft = world.drift.duration;
    drift.score = 0;
    drift.live = false;
    drift.liveTime = 0;
    drift.livePoints = 0;
    drift.multiplier = 1;
    drift.idle = 0;

    delivery.active = false;
    delivery.failed = false;
    delivery.done = false;
    delivery.time = 0;
    delivery.routeIndex = 0;
    delivery.armed = true;
    delivery.cooldown = 0;
    resetCargo();

    driftTotal = 0;
    zero.state = 0;
    zero.start = 0;
    zero.display = '--';
    if (zeroEl) zeroEl.textContent = '--';
    lastCrash = 0;
    camShake = 0;
    cargoHintCooldown = 0;
  }

  function spawnFor(mode) {
    const sp = world.spawns[mode] || world.spawns.free;
    physics.reset(sp.x, sp.z, sp.yaw);
    physics.setAuto(autoMode);
    syncPlayer(0);

    const back = camMode === 0 ? 9.5 : 15;
    camera.position.set(
      sp.x - Math.sin(sp.yaw) * back,
      physics.position.y + 4.6,
      sp.z - Math.cos(sp.yaw) * back
    );
    camTarget.set(sp.x, physics.position.y + 1.4, sp.z);
    camera.lookAt(camTarget);
  }

  function startGame(mode) {
    mode = mode || 'free';
    startScreen.classList.add('hidden');
    pauseScreen.classList.add('hidden');
    document.body.classList.add('playing');
    state = 'playing';

    if (mode !== 'free' && RECOMMENDED[mode]) {
      selectedCar = RECOMMENDED[mode];
      buildCarCards();
    }
    makePlayerCar(selectedCar, true);
    spawnFor(mode);
    resetChallengeState(mode);
    applyModeUI();
    Sound.resume();
    Sound.setPaused(false);
    updateAudioUI();
    resetTouchInput();
    if (isTouch) {
      goFullscreen();
      requestWakeLock();
    }

    const intro = {
      free: 'ESPOLAZIONE LIBERA · 3 BIOMI',
      parking: 'PARCHEGGIO ESTREMO · ALLINEATI AL MILLIMETRO',
      drag: 'DRAG 400M · CAMBIO MANUALE CON Q/E',
      drift: 'SFIDA DRIFT · 60 SECONDI IN MONTAGNA',
      delivery: 'CONSEGNA OFF-ROAD · 3 CUBI NEL CASSÙ'
    };
    toast(intro[mode] || intro.free, 'good');
    Sound.chime(880, 0.1);
    setTimeout(() => {
      if (mode === 'drag' && state === 'playing') toast('TIENI FRENO + GAS AL VIA · RILASCIA AL VERDE', 'warn');
      if (mode === 'delivery' && state === 'playing') toast('RAGGIUNGI IL DEPOT E CARICA I CUBI', 'warn');
    }, 2600);
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    pauseScreen.classList.remove('hidden');
    Sound.setPaused(true);
    resetTouchInput();
    for (const k in keys) keys[k] = false;
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    pauseScreen.classList.add('hidden');
    Sound.resume();
    Sound.setPaused(false);
    resetTouchInput();
  }

  function respawn() {
    if (state !== 'playing') return;
    const sp = world.spawns[currentMode] || world.spawns.free;
    physics.reset(sp.x, sp.z, sp.yaw);
    physics.setAuto(autoMode);
    syncPlayer(0);
    resetChallengeState(currentMode);
    toast('RESET · ' + (currentMode === 'free' ? 'SI RIPARTE' : currentMode.toUpperCase()), 'good');
    Sound.chime(660, 0.08);
  }

  function restartRun() {
    pauseScreen.classList.add('hidden');
    startScreen.classList.add('hidden');
    document.body.classList.add('playing');
    state = 'playing';
    makePlayerCar(selectedCar, true);
    spawnFor(currentMode);
    resetChallengeState(currentMode);
    Sound.resume();
    Sound.setPaused(false);
    resetTouchInput();
    toast('RESET · SI RIPARTE', 'good');
    Sound.chime(660, 0.08);
  }

  function showMenu() {
    pauseScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    document.body.classList.remove('playing');
    state = 'menu';
    Sound.setPaused(true);
    currentMode = 'free';
    physics.reset(world.spawns.free.x, world.spawns.free.z, world.spawns.free.yaw);
    syncPlayer(0);
    menuAngle = 0;
    selectedCar = playerType;
    buildCarCards();
    applyModeUI();
    updateRecordLine();
    resetChallengeState('free');
    resetTouchInput();
  }

  /* --------------------------- 0-100 --------------------------- */
  function updateZero() {
    const kmh = physics.speed * 3.6;
    if (zero.state === 0) {
      if (physics.gear > 0 && kmh > 1) {
        zero.state = 1;
        zero.start = performance.now();
        zero.display = '...';
      }
    } else if (zero.state === 1) {
      if (kmh >= 100) {
        zero.state = 2;
        const t = (performance.now() - zero.start) / 1000;
        zero.display = t.toFixed(2) + 's';
        toast('0-100 KM/H · ' + t.toFixed(2) + 's', 'good');
        Sound.chime(980, 0.12);
      } else if (performance.now() - zero.start > 22000) {
        zero.state = 0;
        zero.display = '--';
      }
    } else if (zero.state === 2 && kmh < 1) {
      zero.state = 0;
      zero.display = '--';
    }
    if (zeroEl) zeroEl.textContent = zero.display;
  }

  /* -------------------------- parcheggio ----------------------- */
  function analyzeBay(bay) {
    const l = world.bayLocal(bay, physics.position.x, physics.position.z);
    const raw = Math.abs(normAngle(physics.yaw - bay.yaw));
    const parallel = Math.min(raw, Math.PI - raw);
    const halfW = physics.trackWidth / 2;
    const halfL = physics.wheelBase / 2;
    let allInside = true;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wx = physics.position.x + physics.right.x * sx * halfW + physics.forward.x * sz * halfL;
        const wz = physics.position.z + physics.right.z * sx * halfW + physics.forward.z * sz * halfL;
        const wl = world.bayLocal(bay, wx, wz);
        if (Math.abs(wl.x) > bay.w / 2 - 0.02 || Math.abs(wl.z) > bay.d / 2 - 0.02) allInside = false;
      }
    }
    return {
      lx: l.x, lz: l.z,
      angle: parallel * 180 / Math.PI,
      offset: Math.hypot(l.x, l.z),
      allInside
    };
  }

  function gradeParking(a) {
    if (!a.allInside) return { key: 'out', label: 'RUOTA FUORI LINEA', score: 0, color: '#ff5e9c' };
    if (a.angle <= 1.5 && a.offset <= 0.18) return { key: 'perfect', label: 'PERFECT', score: 1000, color: '#57e39b' };
    if (a.angle <= 4 && a.offset <= 0.45) return { key: 'great', label: 'OTTIMO', score: 720, color: '#5ee7ff' };
    if (a.angle <= 8 && a.offset <= 0.9) return { key: 'good', label: 'BUONO', score: 420, color: '#ffc857' };
    return { key: 'align', label: 'ALLINEA', score: 0, color: '#ffc857' };
  }

  function updateParking(dt) {
    let nearest = null;
    let best = Infinity;
    for (const bay of world.parkingBays) {
      const d = Math.hypot(physics.position.x - bay.x, physics.position.z - bay.z);
      if (d < best) { best = d; nearest = bay; }
      if (!bay.armed && d > 14) bay.armed = true;
    }
    parking.nearest = nearest;

    if (!nearest || best > 34) {
      if (parkMeterEl) parkMeterEl.classList.remove('show');
      if (parkInfoEl) parkInfoEl.classList.remove('show');
      parking.timer = 0;
      return;
    }

    const a = analyzeBay(nearest);
    const grade = gradeParking(a);
    parking.grade = grade.key;
    if (parkMeterEl) parkMeterEl.classList.add('show');
    if (parkAngleEl) parkAngleEl.textContent = a.angle.toFixed(1) + '°';
    if (parkOffsetEl) parkOffsetEl.textContent = (a.offset * 100).toFixed(0) + ' cm';
    if (parkGradeEl) {
      parkGradeEl.textContent = grade.label;
      parkGradeEl.style.color = grade.color;
    }
    if (parkBarEl) {
      const precision = clamp(1 - a.offset / 2.2, 0, 1) * clamp(1 - a.angle / 20, 0, 1);
      parkBarEl.style.width = (precision * 100).toFixed(1) + '%';
      parkBarEl.style.background = grade.color;
    }
    if (parkHintEl) {
      parkHintEl.textContent = nearest.done
        ? 'PIAZZOLA COMPLETATA' + (nearest.perfect ? ' · PERFECT' : '')
        : 'FERMO < 0,2 M/S PER 1,2 S · TUTTE LE RUOTE DENTRO';
    }

    if (parkInfoEl) {
      parkInfoEl.textContent = nearest.name + ' · ' + grade.label + ' · Δ ' + (a.offset * 100).toFixed(0) + ' cm';
      parkInfoEl.classList.add('show');
    }

    const stopped = physics.speed < 0.2;
    if (stopped && a.allInside && !nearest.done && nearest.armed) {
      nearest.progress += dt;
    } else if (!stopped) {
      nearest.progress = 0;
    }

    if (nearest.progress >= 1.2 && !nearest.done && nearest.armed) {
      nearest.done = true;
      nearest.armed = false;
      nearest.progress = 0;
      nearest.lastGrade = grade.key;
      if (grade.key === 'perfect') nearest.perfect = true;
      if (grade.key !== 'align' && grade.key !== 'out') {
        parkedCount++;
        const prev = records.parking[nearest.id] || 0;
        records.parking[nearest.id] = Math.max(prev, grade.score);
        if (grade.key === 'perfect') records.perfect = (records.perfect || 0) + 1;
        saveRecords();
        nearest.mesh.material.emissiveIntensity = 0.75;
        nearest.mesh.material.color.setHex(grade.score >= 1000 ? 0x57e39b : 0x5ee7ff);
        toast(
          nearest.name + ' · ' + grade.label + ' · ' +
          (grade.key === 'perfect'
            ? 'Δ ' + Math.round(a.offset * 1000) + ' mm / ' + a.angle.toFixed(1) + '°'
            : grade.score + ' PT'),
          'good'
        );
        Sound.chime(grade.key === 'perfect' ? 1180 : 920, 0.16);
        if (grade.key === 'perfect') setTimeout(() => Sound.chime(1480, 0.18), 140);
      } else {
        nearest.done = false;
        nearest.armed = true;
        toast(grade.label + ' · RIPROVA', 'warn');
      }
    }
  }

  /* ----------------------------- drag -------------------------- */
  function setDragLights(phase) {
    const lights = world.drag.lights;
    for (let i = 0; i < lights.length; i++) {
      const mat = lights[i].material;
      if (phase === -1) {
        mat.emissive.setHex(0x220000);
        mat.emissiveIntensity = 0.3;
        mat.color.setHex(0x1a1f28);
      } else if (phase === 0) {
        const red = i === 0;
        mat.emissive.setHex(red ? 0xff2a3d : 0x332200);
        mat.emissiveIntensity = red ? 1.6 : 0.3;
        mat.color.setHex(red ? 0xff4757 : 0x1a1f28);
      } else if (phase === 1) {
        const red = i < 2;
        mat.emissive.setHex(red ? 0xff2a3d : 0x332200);
        mat.emissiveIntensity = red ? 1.6 : 0.3;
        mat.color.setHex(red ? 0xff4757 : 0x1a1f28);
      } else if (phase === 2) {
        const red = i < 3;
        mat.emissive.setHex(red ? 0xff2a3d : 0x332200);
        mat.emissiveIntensity = red ? 1.6 : 0.3;
        mat.color.setHex(red ? 0xff4757 : 0x1a1f28);
      } else if (phase === 3) {
        mat.emissive.setHex(0x57e39b);
        mat.emissiveIntensity = 2.0;
        mat.color.setHex(0x57e39b);
      }
    }
  }

  function resetDragLights() {
    setDragLights(-1);
  }

  function updateDrag(dt) {
    const d = world.drag;
    const p = physics.position;
    const inStage = Math.abs(p.x) < 10 && p.z > d.stageZ0 && p.z < d.stageZ1;
    const distance = clamp(p.z - d.startZ, 0, d.length);

    if (drag.state === 'idle') {
      if (inStage && physics.speed < 2.2 && physics.grounded) {
        drag.state = 'countdown';
        drag.countdown = 3.2;
        drag.elapsed = 0;
        drag.lastResult = 0;
        setDragLights(0);
        toast('STAGING · TIENI FRENO + GAS', 'warn');
        Sound.chime(520, 0.1);
      }
    } else if (drag.state === 'countdown') {
      if (!inStage) {
        drag.state = 'idle';
        resetDragLights();
      } else {
        drag.countdown -= dt;
        if (drag.countdown > 2.3) setDragLights(0);
        else if (drag.countdown > 1.4) setDragLights(1);
        else if (drag.countdown > 0.5) setDragLights(2);
        else setDragLights(3);
        if (drag.countdown <= 0) {
          drag.state = 'running';
          drag.elapsed = 0;
          toast('VIA! · 400 METRI', 'good');
          Sound.chime(1180, 0.18);
        }
      }
    } else if (drag.state === 'running') {
      drag.elapsed += dt;
      if (p.z >= d.finishZ) {
        drag.state = 'finished';
        drag.finishTimer = 6;
        drag.lastResult = drag.elapsed;
        setDragLights(3);
        const best = !drag.best || drag.elapsed < drag.best;
        if (best) {
          drag.best = drag.elapsed;
          records.drag = drag.elapsed;
          saveRecords();
        }
        toast('TRAGUARDO · ' + fmtTime(drag.elapsed) + (best ? ' · NUOVO RECORD' : ''), 'good');
        Sound.chime(1320, 0.2);
        setTimeout(() => Sound.chime(980, 0.18), 160);
      } else if (p.z < d.startZ - 35 || Math.abs(p.x) > 22) {
        drag.state = 'idle';
        resetDragLights();
        toast('DRAG ANNULLATO · TORNA ALLO STAGING', 'warn');
      }
    } else if (drag.state === 'finished') {
      drag.finishTimer -= dt;
      if (drag.finishTimer <= 0) {
        drag.state = 'idle';
        resetDragLights();
      }
    }

    drag.quiet = drag.state === 'countdown' || drag.state === 'running';
  }

  /* ----------------------------- drift ------------------------- */
  function updateDrift(dt) {
    const zone = world.drift;
    const p = physics.position;
    const dist = Math.hypot(p.x - zone.x, p.z - zone.z);

    if (drift.zoneState === 'idle' && dist < zone.radius) {
      drift.zoneState = 'running';
      drift.timeLeft = zone.duration;
      drift.score = 0;
      drift.livePoints = 0;
      driftTotal = 0;
      toast('SFIDA DRIFT · 60 SECONDI · ACCUMULA PUNTI', 'drift');
      Sound.chime(880, 0.14, 'triangle');
    }

    if (drift.zoneState === 'running') {
      drift.timeLeft = Math.max(0, drift.timeLeft - dt);
      if (drift.timeLeft <= 0) {
        drift.zoneState = 'done';
        if (drift.score > drift.best) {
          drift.best = drift.score;
          records.drift = drift.score;
          saveRecords();
          toast('DRIFT COMPLETATO · ' + Math.floor(drift.score) + ' PT · RECORD', 'drift');
        } else {
          toast('DRIFT COMPLETATO · ' + Math.floor(drift.score) + ' PT', 'drift');
        }
        Sound.chime(1180, 0.18, 'triangle');
      }
    } else if (drift.zoneState === 'done' && dist > zone.radius + 26) {
      drift.zoneState = 'idle';
      drift.timeLeft = zone.duration;
    }

    if (physics.drifting) {
      if (!drift.live) {
        drift.live = true;
        drift.liveTime = 0;
      }
      drift.liveTime += dt;
      drift.idle = 0;
      drift.multiplier = 1 + physics.driftIntensity * 2.6 + clamp(physics.speed / 55, 0, 1) * 0.9;
      const gain = dt * physics.speed * (0.75 + physics.slipAngle * 4.2) * drift.multiplier * 4.2;
      drift.livePoints += gain;
      driftTotal += gain;
      if (drift.zoneState === 'running') drift.score += gain;

      if (performance.now() - lastDriftToast > 3600 && drift.livePoints > 400) {
        lastDriftToast = performance.now();
        toast('DRIFT! · ' + Math.floor(drift.livePoints) + ' PT', 'drift');
      }
    } else if (drift.live) {
      drift.idle += dt;
      if (drift.idle > 1.15) {
        drift.live = false;
        drift.liveTime = 0;
        drift.multiplier = 1;
      }
    }
  }

  /* --------------------------- consegne ------------------------ */
  function beginDelivery() {
    if (!cargo || playerType !== 'pickup') return;
    resetCargo();
    delivery.active = true;
    delivery.failed = false;
    delivery.done = false;
    delivery.time = 0;
    delivery.routeIndex = 0;
    delivery.armed = false;
    delivery.cooldown = 1.5;
    toast('CUBI CARICATI · RAGGIUNGI I 3 CHECKPOINT', 'good');
    Sound.chime(760, 0.14);
  }

  function failDelivery(reason) {
    if (!delivery.active || delivery.failed || delivery.done) return;
    delivery.failed = true;
    delivery.active = false;
    delivery.armed = false;
    toast('CONSEGNA FALLITA · ' + (reason || 'CARICO PERDUTO'), 'warn');
    Sound.chime(240, 0.32, 'square');
  }

  function completeDelivery() {
    delivery.done = true;
    delivery.active = false;
    const best = !delivery.best || delivery.time < delivery.best;
    if (best) {
      delivery.best = delivery.time;
      records.delivery = delivery.time;
      saveRecords();
    }
    toast('CONSEGNA COMPLETA · ' + fmtClock(delivery.time) + (best ? ' · RECORD' : ''), 'good');
    Sound.chime(1180, 0.18);
    setTimeout(() => Sound.chime(1480, 0.2), 150);
  }

  function ejectCargo(reason) {
    if (!cargo || !cargo.loaded) return;
    cargo.loaded = false;
    const wp = new THREE.Vector3();
    for (const cube of cargo.cubes) {
      if (!cube.seated) continue;
      cube.node.getWorldPosition(wp);
      playerCar.remove(cube.node);
      scene.add(cube.node);
      cube.node.position.copy(wp);
      cube.seated = false;
      cube.life = 0;
      cube.vel.set(
        physics.velocity.x * 0.72 + (Math.random() - 0.5) * 4.5,
        3.4 + Math.random() * 2.6,
        physics.velocity.z * 0.72 + (Math.random() - 0.5) * 4.5
      );
      cube.spin.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
    }
    camShake = Math.max(camShake, 0.6);
    if (delivery.active) failDelivery(reason || 'CARICO PERDUTO');
    else toast('CUBI ESPULSI DAL CASSÙ', 'warn');
  }

  function updateCargo(dt) {
    if (!cargo) return;

    if (delivery.active) {
      delivery.time += dt;
      if (cargo.loaded) {
        const rough = physics.jolt;
        if (rough > 37 || Math.abs(physics.bodyRoll) > 0.92 || physics.rollover || physics.wallImpact > 8.5) {
          ejectCargo(rough > 37 ? 'DOSSIO TROPPO VIOLENTO' : 'RIBALTAMENTO / URTO');
        }
      }
    }

    for (const cube of cargo.cubes) {
      if (cube.seated) continue;
      cube.life += dt;
      cube.vel.y -= 22 * dt;
      cube.node.position.addScaledVector(cube.vel, dt);
      cube.node.rotation.x += cube.spin.x * dt;
      cube.node.rotation.y += cube.spin.y * dt;
      cube.node.rotation.z += cube.spin.z * dt;
      const ground = world.heightAt(cube.node.position.x, cube.node.position.z) + 0.3;
      if (cube.node.position.y < ground) {
        cube.node.position.y = ground;
        if (cube.vel.y < -1.2) {
          cube.vel.y *= -0.32;
          cube.vel.x *= 0.7;
          cube.vel.z *= 0.7;
          cube.spin.multiplyScalar(0.65);
        } else {
          cube.vel.y = 0;
          cube.vel.x *= Math.exp(-3 * dt);
          cube.vel.z *= Math.exp(-3 * dt);
          cube.spin.multiplyScalar(Math.exp(-4 * dt));
        }
      }
      if (cube.life > 2.2) cube.lost = true;
      if (cube.node.position.y < -20) cube.lost = true;
    }
  }

  function updateDelivery(dt) {
    if (delivery.cooldown > 0) delivery.cooldown -= dt;
    if (cargoHintCooldown > 0) cargoHintCooldown -= dt;

    const dep = world.delivery.depot;
    const dist = Math.hypot(physics.position.x - dep.x, physics.position.z - dep.z);

    if (dist > dep.r + 6) delivery.armed = true;

    if (dist < dep.r && physics.speed < 2.6 && delivery.cooldown <= 0) {
      if (playerType !== 'pickup') {
        if (cargoHintCooldown <= 0) {
          cargoHintCooldown = 4;
          toast('SERVE IL PICK-UP 4x4 PER LE CONSEGNE', 'warn');
        }
      } else if (!delivery.active && delivery.armed && !delivery.done) {
        beginDelivery();
      }
    }

    if (!delivery.active) return;

    if (playerType !== 'pickup') {
      failDelivery('VEICOLO NON ADATTO');
      return;
    }

    if (cargo && cargo.loaded) {
      const cp = world.delivery.route[delivery.routeIndex];
      if (cp) {
        const d = Math.hypot(physics.position.x - cp.x, physics.position.z - cp.z);
        if (d < cp.r) {
          delivery.routeIndex++;
          if (delivery.routeIndex >= world.delivery.route.length) completeDelivery();
          else {
            toast('CHECKPOINT ' + delivery.routeIndex + '/3 · CONTINUA', 'good');
            Sound.chime(980, 0.12);
          }
        }
      }
    }

    if (cargo) {
      for (const c of cargo.cubes) {
        if (!c.seated && c.lost) {
          failDelivery('CARICO PERDUTO');
          break;
        }
      }
    }
  }

  /* ------------------------ traffic impacts -------------------- */
  function onTrafficHit(hit) {
    const strength = clamp(hit.power / 22, 0.15, 1);
    physics.velocity.multiplyScalar(0.52);
    physics.applyImpulse(
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 0.5
    );
    physics.impactCooldown = 0.45;
    camShake = Math.max(camShake, 0.8 + strength);
    Sound.crash(hit.power);
    if (delivery.active && strength > 0.35) ejectCargo('INCIDENTE CON IL TRAFFICO');
    if (drift.live && strength > 0.3) {
      drift.live = false;
      drift.liveTime = 0;
      drift.multiplier = 1;
      toast('COMBO PERSA · URTO', 'warn');
    }
  }

  function checkWallImpact() {
    if (physics.wallImpact > 7 && performance.now() - lastCrash > 600) {
      lastCrash = performance.now();
      camShake = Math.max(camShake, 0.55);
      Sound.crash(physics.wallImpact * 0.7);
      if (delivery.active) ejectCargo('URTO CONTRO UN OSTACOLO');
    }
  }

  /* --------------------------- HUD ----------------------------- */
  function updateHUD(dt) {
    if (speedEl) speedEl.textContent = Math.round(physics.speed * 3.6);
    const gearText = physics.gear === -1 ? 'R' : physics.gear === 0 ? 'N' : String(physics.gear);
    if (gearEl && gearEl.textContent !== gearText) gearEl.textContent = gearText;

    const rpmVal = (physics.rpm / 1000).toFixed(1);
    if (rpmEl && rpmEl.textContent !== rpmVal) rpmEl.textContent = rpmVal;
    if (rpmArc) {
      const p = clamp(physics.rpm / physics.maxRpm, 0, 1);
      rpmArc.style.strokeDasharray = (p * 235.6).toFixed(1) + ' 314.16';
      rpmArc.style.stroke = p > 0.9 ? '#ff5e9c' : p > 0.74 ? '#ffc857' : '#5ee7ff';
    }

    hudTimer += dt;
    if (hudTimer < 0.07) {
      updateLaunchHUD();
      return;
    }
    hudTimer = 0;

    const shownPoints = drift.zoneState === 'running' ? drift.score : drift.livePoints;
    if (driftEl) driftEl.textContent = Math.floor(shownPoints);
    if (comboEl) comboEl.textContent = 'x' + (drift.live ? drift.multiplier : 1).toFixed(1);
    if (driftBar) driftBar.style.width = clamp((drift.live ? drift.multiplier / 4 : 0) * 100, 0, 100) + '%';
    if (driftTimeEl) {
      driftTimeEl.textContent = drift.zoneState === 'running'
        ? fmtClock(drift.timeLeft)
        : fmtClock(drift.liveTime);
    }

    if (zoneEl) {
      const name = world.zoneName(physics.position.x, physics.position.z);
      lastZoneName = name;
      const pill = name + ' · P ' + parkedCount + '/3';
      if (pill !== lastPill) {
        lastPill = pill;
        zoneEl.textContent = pill;
      }
    }

    updateZero();
    updateParkingHUD();
    updateChallengeHUD();
    updateCargoHUD();
    updateLaunchHUD();

    if (physics.drifting && drift.livePoints > 800 && performance.now() - lastDriftToast > 4000) {
      lastDriftToast = performance.now();
      toast('DRIFT! · x' + drift.multiplier.toFixed(1) + ' · ' + Math.floor(drift.livePoints) + ' PT', 'drift');
    }
  }

  function updateParkingHUD() {
    /* la logica di prossimità è in updateParking; qui solo lo stato visivo */
    if (!parkMeterEl) return;
    if (!parking.nearest || Math.hypot(physics.position.x - parking.nearest.x, physics.position.z - parking.nearest.z) > 34) {
      parkMeterEl.classList.remove('show');
    }
  }

  function updateChallengeHUD() {
    if (!challengePanel) return;
    let show = false;
    let kind = '';
    let title = '';
    let timer = '';
    let sub = '';
    let progress = 0;

    if (drag.state !== 'idle' || (Math.abs(physics.position.x) < 12 && physics.position.z > world.drag.stageZ0 - 25 && physics.position.z < world.drag.stageZ1 + 10)) {
      show = true;
      kind = 'DRAG 400 M · CAMBIO MANUALE';
      if (drag.state === 'countdown') {
        title = 'STAGING';
        timer = Math.max(0, drag.countdown).toFixed(1) + 's';
        sub = physics.staged
          ? 'RPM ' + Math.round(physics.rpm) + ' · RILASCIA IL FRENO AL VERDE'
          : 'TIENI FRENO + GAS PER SALIRE DI GIRI';
        progress = 1 - drag.countdown / 3.2;
      } else if (drag.state === 'running') {
        title = 'VIA!';
        timer = fmtTime(drag.elapsed);
        sub = Math.round(Math.hypot(physics.velocity.x, physics.velocity.z) * 3.6) + ' KM/H · ' +
          Math.max(0, Math.round(world.drag.finishZ - physics.position.z)) + ' M AL TRAGUARDO';
        progress = clamp((physics.position.z - world.drag.startZ) / world.drag.length, 0, 1);
      } else if (drag.state === 'finished') {
        title = 'TRAGUARDO';
        timer = fmtTime(drag.lastResult);
        sub = 'RECORD ' + (drag.best ? fmtTime(drag.best) : '--');
        progress = 1;
      } else {
        title = 'DRAG STRIP';
        timer = '400 M';
        sub = 'FERMATI ALLO STAGING · Q/E PER LE MARCE';
        progress = 0;
      }
    } else if (drift.zoneState === 'running') {
      show = true;
      kind = 'SFIDA DRIFT · 60 SECONDI';
      title = Math.floor(drift.score) + ' PT';
      timer = fmtClock(drift.timeLeft);
      sub = 'MOLT x' + drift.multiplier.toFixed(1) + ' · ' + (physics.drifting ? 'DERAPATA' : 'CERCA L\'ANGOLO');
      progress = 1 - drift.timeLeft / world.drift.duration;
    } else if (delivery.active || (Math.hypot(physics.position.x - world.delivery.depot.x, physics.position.z - world.delivery.depot.z) < 50 && playerType === 'pickup')) {
      show = true;
      kind = 'CONSEGNA OFF-ROAD';
      title = delivery.failed ? 'FALLITA' : delivery.active ? 'IN CONSEGNA' : 'DEPOT';
      timer = delivery.active ? fmtClock(delivery.time) : '3 CUBI';
      sub = 'CHECKPOINT ' + delivery.routeIndex + '/3 · CARICO ' + (cargo ? cargo.cubes.filter((c) => c.seated).length : 0) + '/3';
      progress = delivery.routeIndex / 3;
    }

    challengePanel.classList.toggle('hidden', !show);
    if (!show) return;
    if (chKind) chKind.textContent = kind;
    if (chTitle) chTitle.textContent = title;
    if (chTimer) chTimer.textContent = timer;
    if (chSub) chSub.textContent = sub;
    if (chProgress) chProgress.style.width = clamp(progress * 100, 0, 100) + '%';
  }

  function updateCargoHUD() {
    if (!cargoPanel) return;
    const nearDepot = Math.hypot(physics.position.x - world.delivery.depot.x, physics.position.z - world.delivery.depot.z) < 55;
    const show = playerType === 'pickup' && (delivery.active || nearDepot);
    cargoPanel.classList.toggle('hidden', !show);
    if (!show) return;
    const seated = cargo ? cargo.cubes.filter((c) => c.seated && !c.lost).length : 0;
    if (cargoDots) {
      const dots = cargoDots.querySelectorAll('i');
      for (let i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('lost', i >= seated);
        dots[i].classList.toggle('ok', i < seated);
      }
    }
    if (cargoText) cargoText.textContent = seated + '/3';
    if (deliveryTimeEl) deliveryTimeEl.textContent = delivery.active ? fmtClock(delivery.time) : delivery.failed ? 'FALLITA' : 'PRONTO';
  }

  function updateLaunchHUD() {
    if (!launchPanel) return;
    const p = physics.position;
    const nearDrag = currentMode === 'drag' ||
      (Math.abs(p.x) < 12 && p.z > world.drag.stageZ0 - 20 && p.z < world.drag.stageZ1 + 12);
    const show = nearDrag && (physics.staged || physics.launchMessageTimer > 0);
    launchPanel.classList.toggle('hidden', !show);
    if (!show) return;
    const frac = clamp(physics.rpm / physics.redline, 0, 1.1);
    if (launchBar) launchBar.style.width = (frac * 100).toFixed(1) + '%';
    if (launchText) {
      if (physics.staged) {
        launchText.textContent = 'RPM ' + Math.round(physics.rpm) + ' · FINESTRA ' +
          Math.round(physics.launchWindow[0] * physics.redline) + '–' +
          Math.round(physics.launchWindow[1] * physics.redline);
      } else {
        launchText.textContent = physics.launchLabel || 'LAUNCH';
      }
    }
  }

  /* --------------------------- step ---------------------------- */
  function step(dt) {
    const input = readInput();
    /* il semaforo trattiene l'auto: si può solo far salire di giri */
    if (drag.state === 'countdown') input.brake = 1;
    physics.update(dt, input);
    checkWallImpact();

    const hit = traffic.collidePlayer(physics);
    if (hit) onTrafficHit(hit);

    traffic.update(dt, physics.position, drag.quiet, true);

    updateParking(dt);
    updateDrag(dt);
    updateDrift(dt);
    updateCargo(dt);
    updateDelivery(dt);

    if (physics.overRev && Math.random() < 0.06) camShake = Math.max(camShake, 0.12);
  }

  /* --------------------------- loop ---------------------------- */
  const clock = new THREE.Clock();
  let accumulator = 0;

  function animate() {
    requestAnimationFrame(animate);
    const raw = Math.min(clock.getDelta(), 0.1);

    if (state === 'playing') {
      accumulator += raw;
      let steps = 0;
      while (accumulator >= 1 / 60 && steps < 3) {
        step(1 / 60);
        accumulator -= 1 / 60;
        steps++;
      }
      if (steps === 3) accumulator = 0;

      syncPlayer(raw);
      updateCamera(raw);
      updateSun();
      updateHUD(raw);
      Sound.update(physics.rpm, physics.throttle, physics.speed, physics.drifting, physics.redline);

      if (wasOffroad !== physics.offroad) {
        wasOffroad = physics.offroad;
        if (physics.offroad) toast('FUORISTRADA · SOSPENSIONI ATTIVE', 'warn');
      }
    } else if (state === 'menu') {
      updateMenuCamera(raw);
      traffic.update(raw * 0.6, physics.position, false, false);
      updateSun();
      Sound.setPaused(true);
    }

    renderer.render(scene, camera);
  }

  /* ------------------------ event binding ---------------------- */
  startBtn.addEventListener('click', () => startGame('free'));
  resumeBtn.addEventListener('click', resumeGame);
  restartBtn.addEventListener('click', restartRun);
  menuBtn.addEventListener('click', showMenu);
  pauseBtn.addEventListener('click', pauseGame);
  soundBtn.addEventListener('click', toggleSound);
  audioOptBtn.addEventListener('click', toggleSound);
  pauseSoundBtn.addEventListener('click', toggleSound);
  camBtn.addEventListener('click', cycleCamera);
  pauseCamBtn.addEventListener('click', cycleCamera);
  fsBtn.addEventListener('click', toggleFullscreen);
  modeBtn.addEventListener('click', toggleMode);
  if (helpBtn) helpBtn.addEventListener('click', toggleHelp);
  transBtn.addEventListener('click', () => {
    autoMode = !autoMode;
    physics.setAuto(autoMode);
    applyModeUI();
    Sound.resume();
    Sound.chime(520, 0.06);
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (err) {}
      deferredPrompt = null;
      installBtn.style.display = 'none';
    });
  }

  document.querySelectorAll('.challenge-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      Sound.resume();
      startGame(btn.dataset.mode);
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state === 'playing') pauseGame();
    } else if (state === 'playing') {
      requestWakeLock();
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
  });

  function toggleHelp() {
    const help = el('helpPanel');
    if (!help) return;
    help.classList.toggle('hidden');
    if (!help.classList.contains('hidden')) setTimeout(() => help.classList.add('hidden'), 9000);
  }

  traffic.hitCallback = (car, power) => {
    if (power > 7) Sound.crash(power * 0.8);
  };

  /* --------------------------- avvio --------------------------- */
  window.VD.debug = {
    get state() { return state; },
    get mode() { return currentMode; },
    get playerType() { return playerType; },
    get car() { return playerCar; },
    get cargo() { return cargo; },
    get physics() { return physics; },
    get delivery() { return delivery; },
    get drag() { return drag; },
    get drift() { return drift; },
    get parking() { return parking; },
    get records() { return records; },
    world, traffic, startGame, spawnFor, resetChallengeState,
    beginDelivery, ejectCargo, completeDelivery,
    get renderer() { return renderer; },
    get scene() { return scene; },
    get camera() { return camera; }
  };

  if (location.protocol === 'file:') {
    const apkLink = document.querySelector('.apk-btn');
    if (apkLink) apkLink.style.display = 'none';
  }

  makePlayerCar(selectedCar, true);
  buildCarCards();
  applyModeUI();
  updateAudioUI();
  updateRecordLine();
  physics.reset(world.spawns.free.x, world.spawns.free.z, world.spawns.free.yaw);
  syncPlayer(0);
  updateMenuCamera(0);
  animate();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();
