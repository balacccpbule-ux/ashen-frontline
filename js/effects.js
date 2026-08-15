// ============================================================
//  effects.js  ·  粒子池 / 曳光 / 爆炸 / 冲击波 / 震屏
// ============================================================
(function () {
  'use strict';

  const E = {
    points: null,        // 加色粒子池 (THREE.Points)
    transients: [],
    tracers: [],
    CAP: 4000,
    // 粒子数据
    p: null, // {x,y,z,vx,vy,vz,life,maxLife,r,g,b}
    scene: null,
    // 弹壳池（黄铜弹壳）
    shells: [], SHELL_N: 30,
  };

  function init(scene) {
    E.scene = scene;
    const CAP = E.CAP;
    const posAttr = new Float32Array(CAP * 3);
    const colAttr = new Float32Array(CAP * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posAttr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colAttr, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.38, vertexColors: true, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, sizeAttenuation: true,
    });
    E.points = new THREE.Points(geo, mat);
    E.points.frustumCulled = false;
    scene.add(E.points);

    // 枪口闪光（复用单点光，开火瞬间照亮周围，提升手感）
    E.muzzleLight = new THREE.PointLight(0xffc880, 0, 9);
    E.muzzleLight.position.set(0, -99999, 0);
    scene.add(E.muzzleLight);

    initDecals();
    initShells();
    initTracers();
    initFlashPool();
    initPuffPool();
    initSmokePuffs();
    initRingPool();
    initSpotOutlines();

    E.p = [];
    E.free = [];           // 空闲槽位 freelist（替代每粒子 O(CAP) 线性扫描）
    for (let i = 0; i < CAP; i++) {
      E.p.push({ x: 0, y: -99999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1 });
      E.free.push(i);
    }
    // 初始写入
    const pa = geo.attributes.position.array;
    for (let i = 0; i < CAP; i++) { pa[i * 3 + 1] = -99999; }
    geo.attributes.position.needsUpdate = true;
    E.posAttr = pa;
    E.colAttr = geo.attributes.color.array;
  }

  // ---- 曳光池（单位圆柱共享几何 + 环形复用；v4 每发 new 几何+材质） ----
  const TRACER_N = 48;
  const _up = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  function initTracers() {
    E.tracerPool = [];
    E.tracerGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
    for (let i = 0; i < TRACER_N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const beam = new THREE.Mesh(E.tracerGeo, mat);
      beam.visible = false;
      E.scene.add(beam);
      E.tracerPool.push(beam);
    }
    E.tracerHead = 0;
  }

  // ---- 枪口火光/爆炸球池（单位球共享几何） ----
  const FLASH_N = 24;
  function initFlashPool() {
    E.flashPool = [];
    E.flashGeo = new THREE.SphereGeometry(0.5, 10, 10);
    for (let i = 0; i < FLASH_N; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(E.flashGeo, mat);
      m.visible = false;
      E.scene.add(m);
      E.flashPool.push(m);
    }
    E.flashHead = 0;
    // v5.37 星形枪口焰池：十字尖刺 + 小核心光（加色混合，替代大光球）
    E.starPool = [];
    const spikeGeo = new THREE.BoxGeometry(0.06, 0.06, 1);
    for (let i = 0; i < FLASH_N; i++) {
      const g = new THREE.Group();
      const matA = new THREE.MeshBasicMaterial({ color: 0xffe09a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const spikeA = new THREE.Mesh(spikeGeo, matA);
      const matB = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const spikeB = new THREE.Mesh(spikeGeo, matB);
      spikeB.rotation.z = Math.PI / 2;
      const coreGeo = new THREE.SphereGeometry(0.09, 8, 8);
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(spikeA, spikeB, core);
      g.visible = false;
      E.scene.add(g);
      E.starPool.push({ g, spikeA, spikeB, core, matA, matB });
    }
    E.starHead = 0;
  }
  function nextPoolMesh(pool, headKey) {
    const m = pool[E[headKey]]; E[headKey] = (E[headKey] + 1) % pool.length;
    if (m._live) {
      for (let i = 0; i < E.transients.length; i++) {
        const tr = E.transients[i];
        if (tr && tr.obj === m) { E.transients[i] = null; break; }
      }
    }
    m._live = true;
    m.visible = true;
    return m;
  }

  // ---- 命中尘爆 puff 池 ----
  const PUFF_N = 12;
  function initPuffPool() {
    E.puffPool = [];
    E.puffGeo = new THREE.SphereGeometry(0.5, 6, 6);
    for (let i = 0; i < PUFF_N; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(E.puffGeo, mat);
      m.visible = false;
      E.scene.add(m);
      E.puffPool.push(m);
    }
    E.puffHead = 0;
  }

  // ---- v5.41 烟雾弹白球池（白色浓烟球，替代灰点烟雾） ----
  const SMOKE_PUFF_N = 64;
  function initSmokePuffs() {
    E.smokePuffs = [];
    E.smokeGeo = new THREE.SphereGeometry(0.5, 8, 8);
    for (let i = 0; i < SMOKE_PUFF_N; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(E.smokeGeo, mat);
      m.visible = false;
      E.scene.add(m);
      E.smokePuffs.push(m);
    }
    E.smokeHead = 0;
  }

  // ---- 冲击波环池 ----
  const RING_N = 10;
  function initRingPool() {
    E.ringPool = [];
    E.ringGeo = new THREE.RingGeometry(0.6, 0.85, 24);
    for (let i = 0; i < RING_N; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(E.ringGeo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      E.scene.add(m);
      E.ringPool.push(m);
    }
    E.ringHead = 0;
  }

  // 发射粒子（freelist 取槽：O(1) 替代 O(CAP) 扫描；颜色直接按位解，零分配）
  function emit(x, y, z, color, count, speed, life, size, gravity, upBias) {
    const rng = Game.rng;
    const cr = ((color >> 16) & 255) / 255, cg = ((color >> 8) & 255) / 255, cb = (color & 255) / 255;
    for (let n = 0; n < count; n++) {
      if (!E.free.length) return;   // 池满丢弃
      const idx = E.free.pop();
      const p = E.p[idx];
      const th = rng() * Math.PI * 2;
      const ph = (rng() - 0.5) * Math.PI;
      const sp = speed * (0.3 + rng() * 0.7);
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(th) * Math.cos(ph) * sp;
      p.vz = Math.sin(th) * Math.cos(ph) * sp;
      p.vy = Math.sin(ph) * sp * (upBias !== undefined ? upBias : 0.5) + speed * 0.2;
      p.life = p.maxLife = life * (0.5 + rng() * 0.7);
      p.r = cr; p.g = cg; p.b = cb;
      p.size = size;
      p.grav = gravity;
    }
  }

  // 曳光（瞬时光束，池化：单位圆柱缩放复用，零几何分配）
  function tracer(a, b, color, life) {
    if (!E.scene || !E.tracerPool) return;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.001) return;
    const beam = E.tracerPool[E.tracerHead]; E.tracerHead = (E.tracerHead + 1) % TRACER_N;
    if (beam._live) {
      // 环形复用：作废该 mesh 的旧条目（池满时旧曳光提前消失，可接受）
      for (let i = 0; i < E.tracers.length; i++) {
        if (E.tracers[i] && E.tracers[i].line === beam) { E.tracers[i] = null; break; }
      }
    }
    beam._live = true;
    beam.visible = true;
    beam.material.color.setHex(color);
    beam.material.opacity = 0.95;
    beam.scale.set(0.07, len, 0.07);   // 单位圆柱半径 0.5 → 目标半径 0.035
    beam.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    _dir.set(dx / len, dy / len, dz / len);
    beam.quaternion.setFromUnitVectors(_up, _dir);
    E.tracers.push({ line: beam, t: 0, life: life || 0.12 });
  }

  // v5.37 枪口焰：星形尖刺（加色混合）——告别挡视线的大光球；
  // 星体朝向相机（首/第三人称观感一致），滚转角按时间+位置确定性变化（不消耗随机数）
  function muzzleFlash(pos, power) {
    if (!E.scene || !E.starPool) return;
    const pw = power === undefined ? 1 : power;
    const st = E.starPool[E.starHead]; E.starHead = (E.starHead + 1) % E.starPool.length;
    const g = st.g;
    if (g._live) {
      for (let i = 0; i < E.transients.length; i++) {
        const tr = E.transients[i];
        if (tr && tr.obj === g) { E.transients[i] = null; break; }
      }
    }
    g._live = true;
    g.visible = true;
    const len = 0.55 * (0.6 + pw * 0.4);
    st.spikeA.scale.set(1, len, 1);
    st.spikeB.scale.set(1, len, 1);
    st.core.scale.setScalar(0.8 + pw * 0.3);
    st.matA.opacity = 0.9;
    st.matB.opacity = 0.75;
    st.core.material.opacity = 0.85;
    g.position.set(pos.x, pos.y, pos.z);
    if (Game.camera) g.lookAt(Game.camera.position);
    g.rotation.z += Math.sin(Game.time * 53 + pos.x * 7 + pos.z * 11) * 1.2;
    transient(g, 0.05, (o, k) => {
      st.matA.opacity = 0.9 * (1 - k);
      st.matB.opacity = 0.75 * (1 - k);
      st.core.material.opacity = 0.85 * (1 - k);
      const s = 1 - k * 0.4;
      st.spikeA.scale.set(1, len * s, 1);
      st.spikeB.scale.set(1, len * s, 1);
    }, () => { g.visible = false; });
    // 动态光（复用单点光，开火瞬间照亮；强度收敛防近距过曝）
    if (E.muzzleLight) { E.muzzleLight.position.set(pos.x, pos.y, pos.z); E.muzzleLight.intensity = 1.5 * pw; }
  }

  // ============================================================
  //  弹孔贴花：已按用户要求移除（大量黑色无厚度图形污染地图）
  //  保留空实现兼容调用方；命中反馈由火花/尘爆/血雾粒子承担
  // ============================================================
  function initDecals() { /* 无操作 */ }
  function addDecal(point, normal) { /* 无操作 */ }

  // ============================================================
  //  弹壳池（黄铜弹壳：小圆柱，重力 19、落地反弹 ≤3 次、5.5s 缩放淡出）
  // ============================================================
  function initShells() {
    if (!E.scene) return;
    for (let i = 0; i < E.SHELL_N; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, 0.09, 6),
        new THREE.MeshBasicMaterial({ color: 0xb08d4a, transparent: true })
      );
      body.rotation.x = Math.PI / 2;
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.017, 0.017, 0.035, 6),
        new THREE.MeshBasicMaterial({ color: 0x8a6b35, transparent: true })
      );
      neck.rotation.x = Math.PI / 2; neck.position.x = 0.062;
      g.add(body, neck);
      g.visible = false;
      E.scene.add(g);
      E.shells.push({ g, active: false, life: 0, bounces: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, baseScale: 1 });
    }
  }
  function ejectShell(pos, dir) {
    if (!E.scene) return;
    let sh = null;
    for (const s of E.shells) { if (!s.active) { sh = s; break; } }
    if (!sh) return; // 池满丢弃
    sh.active = true; sh.life = 0; sh.bounces = 0;
    const rgt = { x: -dir.z, y: 0, z: dir.x }; // 右向（水平）
    const rl = Math.hypot(rgt.x, rgt.z) || 1;
    sh.vx = dir.x * (1.6 + Math.random() * 1.6) + (rgt.x / rl) * (Math.random() - 0.5) * 1.6;
    sh.vz = dir.z * (1.6 + Math.random() * 1.6) + (rgt.z / rl) * (Math.random() - 0.5) * 1.6;
    sh.vy = 2.2 + Math.random() * 1.4;
    sh.rx = (Math.random() - 0.5) * 24; sh.rz = (Math.random() - 0.5) * 24;
    sh.g.position.set(pos.x + (rgt.x / rl) * 0.18, pos.y - 0.08, pos.z + (rgt.z / rl) * 0.18);
    sh.g.visible = true;
    sh.g.scale.setScalar(1);
    E.lastShell = sh; // 测试钩子
  }
  function updateShells(dt) {
    for (const sh of E.shells) {
      if (!sh.active) continue;
      sh.life += dt;
      sh.vy -= 19 * dt;
      sh.g.position.x += sh.vx * dt;
      sh.g.position.y += sh.vy * dt;
      sh.g.position.z += sh.vz * dt;
      sh.g.rotation.x += sh.rx * dt;
      sh.g.rotation.z += sh.rz * dt;
      const gh = Game.heightAt(sh.g.position.x, sh.g.position.z);
      if (sh.g.position.y < gh + 0.05 && sh.vy < 0) {
        if (sh.bounces < 3) {
          sh.vy = -sh.vy * 0.42; sh.vx *= 0.62; sh.vz *= 0.62;
          sh.bounces++;
          if (Math.abs(sh.vy) > 1.2 && Game.sound.shellDrop) Game.sound.shellDrop();
        } else {
          sh.vy = 0; sh.vx *= 0.8; sh.vz *= 0.8; sh.rx *= 0.7; sh.rz *= 0.7;
        }
        sh.g.position.y = gh + 0.05;
      }
      if (sh.life > 5.5) {
        sh.active = false; sh.g.visible = false;
      } else if (sh.life > 4.6) {
        sh.g.scale.setScalar(Math.max(0.01, 1 - (sh.life - 4.6) / 0.9));
      }
    }
  }

  // ============================================================
  //  分层命中反馈（参考 ironhold fxImpactWall / fxImpactFlesh）
  // ============================================================
  // 墙面/金属：弹孔 + 火花锥 + 尘爆闪 + 慢尘 + 碎屑
  function impactWall(point, normal, shooter, dist) {
    if (!E.scene) return;
    emit(point.x, point.y, point.z, 0xfff0b0, 4, 7, 0.12, 0.09, 16, 1);
    emit(point.x, point.y, point.z, 0xffa040, 7, 5.5, 0.3, 0.1, 12, 0.8);
    // 尘爆闪（命中"咔"一下的关键，池化球体）
    const puff = nextPoolMesh(E.puffPool, 'puffHead');
    puff.material.color.setHex(0xd8d2c4);
    puff.material.opacity = 0.55;
    puff.scale.setScalar(0.28 / 0.5);
    puff.position.set(point.x, point.y, point.z);
    transient(puff, 0.16, (o, k) => { o.material.opacity = 0.55 * (1 - k); o.scale.setScalar((0.28 / 0.5) * (1 + k * 1.4)); }, () => { puff.visible = false; });
    // 慢漂灰尘 + 落屑
    emit(point.x, point.y + 0.1, point.z, 0x999280, 5, 1.2, 0.8, 0.18, 1.5, 1);
    emit(point.x, point.y, point.z, 0x8a7a5c, 3, 3.5, 0.5, 0.12, 20, 0.4);
  }
  // 命中肉体：血雾入孔 + 出口喷溅，爆头翻倍
  function impactFlesh(point, dir, head, shooter) {
    if (!E.scene) return;
    const n = head ? 18 : 11;
    const m = head ? 9 : 5;
    emit(point.x, point.y, point.z, 0xc02020, n, 4.5, 0.45, 0.16, 10, 1);
    emit(point.x - dir.x * 0.15, point.y - dir.y * 0.15, point.z - dir.z * 0.15,
      0xa01010, m, 5.5, 0.5, 0.15, 12, 0.8);
    const r0 = head ? 0.42 : 0.3;
    const puff = nextPoolMesh(E.puffPool, 'puffHead');
    puff.material.color.setHex(0xd03030);
    puff.material.opacity = 0.5;
    puff.scale.setScalar(r0 / 0.5);
    puff.position.set(point.x, point.y, point.z);
    transient(puff, 0.22, (o, k) => { o.material.opacity = 0.5 * (1 - k); o.scale.setScalar((r0 / 0.5) * (1 + k * 1.6)); }, () => { puff.visible = false; });
  }
  // 地面：尘土 + 少量火星
  function impactGround(point, shooter) {
    if (!E.scene) return;
    emit(point.x, point.y + 0.05, point.z, 0x8a7a5c, 5, 2.5, 0.5, 0.14, 14, 1);
    emit(point.x, point.y + 0.02, point.z, 0xffd27a, 3, 4, 0.2, 0.08, 16, 1);
  }

  // 命中火花
  function impact(pos, color) {
    emit(pos.x, pos.y, pos.z, color || 0xffe6a0, 5, 6, 0.3, 0.1, 12, 0.6);
  }

  // 通用瞬态（pooled 对象传 cleanup 回调：到期不 dispose，只隐藏归还池）
  function transient(obj, life, anim, cleanup) {
    E.transients.push({ obj, t: 0, life, anim, cleanup: cleanup || null });
  }

  // 爆炸（火球 + 冲击波 + 烟 + 光 + 震屏）
  function explosion(pos, radius, big) {
    if (!E.scene) return;
    const scale = big ? 1.6 : 1;
    // 火球（池化）
    const fireR = radius * 0.5 * scale;
    const fire = nextPoolMesh(E.flashPool, 'flashHead');
    fire.material.color.setHex(0xffb050);
    fire.material.opacity = 0.9;
    fire.scale.setScalar(fireR / 0.5);
    fire.position.set(pos.x, pos.y, pos.z);
    transient(fire, 0.28, (o, k) => {
      o.material.opacity = 0.9 * (1 - k);
      o.scale.setScalar((fireR / 0.5) * (0.5 + k * 1.6));
    }, () => { fire.visible = false; });
    // 冲击波环（池化）
    const ring = nextPoolMesh(E.ringPool, 'ringHead');
    ring.material.opacity = 0.9;
    ring.position.set(pos.x, pos.y, pos.z);
    transient(ring, 0.4, (o, k) => { o.material.opacity = 0.9 * (1 - k); o.scale.setScalar(1 + k * radius * 1.4); }, () => { ring.visible = false; });
    // 火星
    emit(pos.x, pos.y, pos.z, 0xffa040, Math.floor(26 * scale), 14, 0.6, 0.2, 20, 1.2);
    emit(pos.x, pos.y, pos.z, 0xffffff, Math.floor(12 * scale), 20, 0.25, 0.15, 16, 1);
    // 烟（几次灰色烟团，池化）
    for (let i = 0; i < 4; i++) {
      const smokeR = radius * 0.4;
      const s = nextPoolMesh(E.puffPool, 'puffHead');
      s.material.color.setHex(0x444444);
      s.material.opacity = 0.4;
      s.scale.setScalar(smokeR / 0.5);
      s.position.set(pos.x + (Game.rng() - 0.5) * 2, pos.y + Game.rng() * 2, pos.z + (Game.rng() - 0.5) * 2);
      transient(s, 1.0 + Game.rng() * 0.6, (o, k) => {
        o.material.opacity = 0.4 * (1 - k);
        o.scale.setScalar((smokeR / 0.5) * (1 + k * 2.4));
        o.position.y += 0.02;
      }, () => { s.visible = false; });
    }
    // 点光源闪
    const light = new THREE.PointLight(0xffa050, big ? 3 : 1.8, radius * 6);
    light.position.set(pos.x, pos.y + 1, pos.z);
    E.scene.add(light);
    transient(light, 0.22, (o, k) => { o.intensity = (big ? 3 : 1.8) * (1 - k); });
    // 震屏
    const d = Game.player ? Game.math.dist3(pos, Game.player.pos) : 0;
    if (d < radius * 4) addShake((1 - d / (radius * 4)) * (big ? 0.9 : 0.5));
  }

  // 可破坏物毁坏特效
  function destroyBurst(s, type) {
    if (!E.scene) return;
    const pos = { x: s.cx, y: s.baseH + s.h / 2, z: s.cz };
    const count = type === 'collapse' ? 60 : 26;
    const color = s.kind === 'barrel' ? 0xff8840 : (s.kind === 'sandbag' ? 0x9c8a5c : 0x8a7a5c);
    emit(pos.x, pos.y, pos.z, color, count, 10, 1.2, 0.3, 26, 1.0);
    emit(pos.x, pos.y, pos.z, 0x777777, count / 2, 6, 0.9, 0.2, 20, 0.8);
    if (type === 'explode') explosion(pos, 6, false);
    else if (type === 'collapse') explosion(pos, 5, true);
  }

  // 震屏
  function addShake(v) { Game.shake = Math.min(1.4, Game.shake + v); }
  function setShake(v) { Game.shake = Math.min(1.4, v); } // 覆盖而非累加（开火震屏）

  // ============================================================
  //  v5.19 侦察标记高亮边框：改为载具专属（步兵不再高亮，仅小地图红点 + 功绩）；
  //  载具线框 depthTest=false + 高 renderOrder → 隔墙透视（标记后墙后可见）
  // ============================================================
  function initSpotOutlines() {
    E.spotOutlines = [];
    const geo = new THREE.BoxGeometry(1, 1, 1);   // 单位盒，按载具尺寸缩放
    const edges = new THREE.EdgesGeometry(geo);
    for (let i = 0; i < 8; i++) {
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff3340, transparent: true, opacity: 0.9, depthTest: false }));
      line.renderOrder = 999;   // 透视渲染（墙后可见）
      line.visible = false;
      E.scene.add(line);
      E.spotOutlines.push(line);
    }
  }
  function updateSpotOutlines() {
    // v5.39 取消载具 3D 高亮：仅保留小地图坦克符号标记（见 hud.drawMinimap）
    if (E.spotOutlines) {
      for (const l of E.spotOutlines) if (l.visible) l.visible = false;
    }
  }

  // ============================================================
  //  天气粒子（v5：雪 / 沙尘；跟随玩家，环绕盒内循环）
  // ============================================================
  const WEATHER = { points: null, kind: null, N: 0, pos: null, isSnow: false };
  function setWeather(kind) {
    if (WEATHER.points) {
      E.scene.remove(WEATHER.points);
      WEATHER.points.geometry.dispose();
      WEATHER.points.material.dispose();
      WEATHER.points = null;
    }
    WEATHER.kind = kind || null;
    if (!kind) return;
    const isSnow = kind === 'snow';
    const isAsh = kind === 'ash';
    const N = isSnow ? 900 : isAsh ? 260 : 350;
    const pos = new Float32Array(N * 3);
    const r = isSnow ? 60 : 55, h = isSnow ? 34 : 26;
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * r;
      pos[i * 3 + 1] = Math.random() * h;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: isSnow ? 0.16 : isAsh ? 0.1 : 0.24, transparent: true,
      opacity: isSnow ? 0.9 : isAsh ? 0.35 : 0.32,
      color: isSnow ? 0xffffff : isAsh ? 0x9a958e : 0xd8c090,
      depthWrite: false, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    E.scene.add(pts);
    WEATHER.points = pts; WEATHER.pos = pos; WEATHER.N = N; WEATHER.isSnow = isSnow;
  }
  function updateWeather(dt) {
    if (!WEATHER.points || !Game.player) return;
    const pos = WEATHER.pos;
    const r = WEATHER.isSnow ? 60 : 55, h = WEATHER.isSnow ? 34 : 26;
    const px = Game.player.pos.x, py = Game.player.pos.y, pz = Game.player.pos.z;
    for (let i = 0; i < WEATHER.N; i++) {
      let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (WEATHER.isSnow) {
        y -= (2.2 + (i % 5) * 0.5) * dt;
        x += Math.sin(Game.time * 0.8 + i) * 0.6 * dt;
        z += Math.cos(Game.time * 0.7 + i * 0.7) * 0.5 * dt;
        if (y < -1) { y += h; x = (Math.random() * 2 - 1) * r; z = (Math.random() * 2 - 1) * r; }
      } else if (WEATHER.kind === 'sand') {
        x += 4.5 * dt;
        y += Math.sin(Game.time * 0.9 + i) * 0.8 * dt;
        if (x > r) x -= r * 2;
      } else {
        // 灰烬：余烬缓慢上飘 + 轻微摇曳（灰烬都市氛围）
        y += 0.9 * dt;
        x += Math.sin(Game.time * 0.6 + i * 1.3) * 0.35 * dt;
        z += Math.cos(Game.time * 0.5 + i * 0.9) * 0.3 * dt;
        if (y > h) { y = 0; x = (Math.random() * 2 - 1) * r; z = (Math.random() * 2 - 1) * r; }
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    WEATHER.points.position.set(px, py, pz);
    WEATHER.points.geometry.attributes.position.needsUpdate = true;
  }

  // 每帧更新
  function update(dt) {
    // 枪口闪光衰减
    if (E.muzzleLight && E.muzzleLight.intensity > 0) {
      E.muzzleLight.intensity = Math.max(0, E.muzzleLight.intensity - dt * 30);
    }
    // 粒子
    const pa = E.posAttr, ca = E.colAttr;
    for (let i = 0; i < E.CAP; i++) {
      const p = E.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        pa[i * 3 + 1] = -99999;
        E.free.push(i);          // 归还 freelist
        continue;
      }
      p.vy -= (p.grav || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      pa[i * 3] = p.x; pa[i * 3 + 1] = p.y; pa[i * 3 + 2] = p.z;
      const f = p.life / p.maxLife;
      ca[i * 3] = p.r * f; ca[i * 3 + 1] = p.g * f; ca[i * 3 + 2] = p.b * f;
    }
    E.points.geometry.attributes.position.needsUpdate = true;
    E.points.geometry.attributes.color.needsUpdate = true;

    // 曳光（池化：到期隐藏归还，共享几何不 dispose）
    for (let i = E.tracers.length - 1; i >= 0; i--) {
      const t = E.tracers[i];
      if (!t) { E.tracers.splice(i, 1); continue; }
      t.t += dt;
      if (t.t >= t.life) {
        t.line.visible = false;
        t.line._live = false;
        E.tracers.splice(i, 1);
      } else {
        t.line.material.opacity = 0.9 * (1 - t.t / t.life);
      }
    }

    // 瞬态（池化对象走 cleanup 归还；一次性对象才 dispose）
    for (let i = E.transients.length - 1; i >= 0; i--) {
      const tr = E.transients[i];
      if (!tr) { E.transients.splice(i, 1); continue; }
      tr.t += dt;
      if (tr.t >= tr.life) {
        if (tr.obj._live !== undefined) tr.obj._live = false;
        if (tr.cleanup) tr.cleanup();
        else {
          E.scene.remove(tr.obj);
          if (tr.obj.geometry) tr.obj.geometry.dispose();
          if (tr.obj.material) tr.obj.material.dispose();
        }
        E.transients.splice(i, 1);
      } else {
        tr.anim(tr.obj, tr.t / tr.life);
      }
    }

    // 弹壳物理
    updateShells(dt);

    // v5.41 烟雾弹白球浓烟：持续喷出白色烟球（膨胀 + 渐隐）
    for (let i = E.smokeZones.length - 1; i >= 0; i--) {
      const z = E.smokeZones[i];
      if (Game.time > z.until) { E.smokeZones.splice(i, 1); continue; }
      z.acc = (z.acc || 0) + dt;
      if (z.acc >= 0.1) {
        z.acc = 0;
        const ph = Game.time * 5 + z.x * 0.31 + z.z * 0.17;
        const r = Math.sqrt((Math.sin(ph * 1.3) + 1) / 2) * z.r * 0.85;
        spawnSmokePuff(z.x + Math.sin(ph) * r, z.y + 0.6, z.z + Math.cos(ph * 0.8) * r, 2.6);
      }
    }

    // v5.28 氛围：被毁地面载具持续冒烟柱（正弦确定性节奏，位置随相位漂移）
    for (const v of Game.vehicles) {
      if (v.alive || v.kind === 'heli') continue;
      v.smokeAcc = (v.smokeAcc || 0) + dt;
      if (v.smokeAcc >= 0.22) {
        v.smokeAcc = 0;
        const ph = Game.time * 2 + v.id * 2.4;
        emit(v.pos.x + Math.sin(ph) * 1.1, v.pos.y + 1.6, v.pos.z + Math.cos(ph * 0.7) * 1.1,
          0x3a3a36, 3, 1.1, 2.2, 0.26, 13, 0.9);
      }
    }
    // v5.28 氛围：受损建筑冒烟（每帧最多 6 栋，正弦门控）
    let smokeN = 0;
    for (const s of Game.terrain.buildings) {
      if (!s.solid || !s.stages || s.state < 1) continue;
      if (smokeN >= 6) break;
      smokeN++;
      if (Math.sin(Game.time * 1.7 + s.cx * 0.13 + s.cz * 0.07) > 0.9) {
        emit(s.cx + Math.sin(Game.time * 0.9 + s.cz) * 2, s.baseH + s.h * 0.65, s.cz + Math.cos(Game.time * 0.8 + s.cx) * 2,
          0x2e2e2a, 3, 1.5, 2.6, 0.3, 16, 0.9);
      }
    }

    // 天气
    updateWeather(dt);

    // v5.12 侦察标记高亮
    updateSpotOutlines();
  }

  E.smokeZones = [];   // v5.38 烟墙区域 [{x,y,z,r,until}]
  function spawnSmokePuff(x, y, z, r) {
    if (!E.smokePuffs) return;
    const m = nextPoolMesh(E.smokePuffs, 'smokeHead');
    m.material.color.setHex(0xffffff);
    m.material.opacity = 0.55;
    const s0 = r / 0.5;
    m.scale.setScalar(s0);
    m.position.set(x, y, z);
    transient(m, 1.6, (o, k) => {
      o.material.opacity = 0.55 * (1 - k * k);
      o.scale.setScalar(s0 * (1 + k * 1.5));
    }, () => { m.visible = false; });
  }
  function spawnSmoke(pos, radius, duration) {
    E.smokeZones.push({ x: pos.x, y: pos.y, z: pos.z, r: radius, until: Game.time + (duration || SMOKE.duration) });
    // 起爆瞬间浓烟迸发（一圈白球）
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      spawnSmokePuff(pos.x + Math.cos(a) * radius * 0.55, pos.y + 0.6, pos.z + Math.sin(a) * radius * 0.55, 3.2);
    }
  }
  E.spawnSmoke = spawnSmoke;
  // v5.41 烟雾判定（供 AI 精度惩罚 / 玩家视野遮罩使用）
  E.inSmoke = function (px, pz) {
    if (!E.smokeZones || !E.smokeZones.length) return false;
    for (let i = 0; i < E.smokeZones.length; i++) {
      const z = E.smokeZones[i];
      const dx = px - z.x, dz = pz - z.z;
      if (dx * dx + dz * dz < z.r * z.r) return true;
    }
    return false;
  };
  E.smokeOnLine = function (ax, az, bx, bz) {
    if (!E.smokeZones || !E.smokeZones.length) return false;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const steps = Math.max(3, Math.ceil(len / 4));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      for (let j = 0; j < E.smokeZones.length; j++) {
        const zz = E.smokeZones[j];
        const dx = x - zz.x, dz = z - zz.z;
        if (dx * dx + dz * dz < zz.r * zz.r) return true;
      }
    }
    return false;
  };
  E.init = init; E.emit = emit; E.tracer = tracer; E.muzzleFlash = muzzleFlash;
  E.impact = impact; E.explosion = explosion; E.destroyBurst = destroyBurst;
  E.addShake = addShake; E.setShake = setShake; E.update = update;
  E.ejectShell = ejectShell;
  E.impactWall = impactWall; E.impactFlesh = impactFlesh; E.impactGround = impactGround;
  E.setWeather = setWeather;
  E.weatherState = WEATHER;   // 测试钩子
  Game.effects = E;
})();
