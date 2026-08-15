// ============================================================
//  utils.js  ·  确定性 PRNG + 数学/几何工具
// ============================================================
(function () {
  'use strict';

  // --- 确定性 PRNG（mulberry32），保证地图每次一致 ---
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- 基础数学 ---
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1; return Math.sqrt(dx * dx + dz * dz); };
  const dist3 = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const randRange = (rng, a, b) => a + rng() * (b - a);
  const randInt = (rng, a, b) => Math.floor(randRange(rng, a, b + 1));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  // --- 向量工具 ---
  function v3(x, y, z) { return new THREE.Vector3(x, y, z); }

  // --- 射线 vs 球体 ---
  // 返回 t（命中距离）或 null
  function raySphere(o, d, c, r) {
    const ocx = o.x - c.x, ocy = o.y - c.y, ocz = o.z - c.z;
    const b = ocx * d.x + ocy * d.y + ocz * d.z;
    const c2 = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    const disc = b * b - c2;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    let t = -b - s;
    if (t < 0) t = -b + s;
    return t >= 0 ? t : null;
  }

  // --- 射线 vs 竖直有限圆柱（士兵碰撞体） ---
  // c = 底面中心 (x,z)，y0/y1 = 底/顶高度，r = 半径
  function rayCylinder(o, d, cx, cz, y0, y1, r) {
    const dx = d.x, dz = d.z;
    const ox = o.x - cx, oz = o.z - cz;
    const a = dx * dx + dz * dz;
    if (a < 1e-8) {
      // 射线几乎垂直；无竖直分量或方向退化 → 无交点（防除零 NaN）
      if (Math.abs(d.y) < 1e-8) return null;
      const t = (y0 + (y1 - y0) / 2 - o.y) / d.y;
      if (t < 0) return null;
      const px = o.x + d.x * t, pz = o.z + d.z * t;
      const dd = Math.sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz));
      return dd <= r ? t : null;
    }
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
    let best = null;
    for (const t of [t1, t2]) {
      if (t < 0) continue;
      const y = o.y + d.y * t;
      if (y >= y0 && y <= y1) { if (best === null || t < best) best = t; }
    }
    return best;
  }

  // --- 射线 vs AABB（slab 法），用于建筑/箱子 ---
  function rayAABB(o, d, min, max) {
    let tmin = 0, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
      const oi = (i === 0 ? o.x : i === 1 ? o.y : o.z);
      const di = (i === 0 ? d.x : i === 1 ? d.y : d.z);
      const mini = (i === 0 ? min.x : i === 1 ? min.y : min.z);
      const maxi = (i === 0 ? max.x : i === 1 ? max.y : max.z);
      if (Math.abs(di) < 1e-8) {
        if (oi < mini || oi > maxi) return null;
      } else {
        let t1 = (mini - oi) / di, t2 = (maxi - oi) / di;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    return tmin >= 0 ? tmin : null;
  }

  // --- 射线 vs 高度场（射线步进 + 二分精化） ---
  // heightAt(x,z) 由 terrain.js 提供
  function rayGround(o, d, maxDist, heightAt) {
    let t = 0;
    const step = 0.7;
    // 先大步进，直到射线低于地表
    let prevAbove = o.y > heightAt(o.x, o.z);
    while (t < maxDist) {
      const p = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
      const gh = heightAt(p.x, p.z);
      if (p.y <= gh) break;
      t += step;
    }
    if (t >= maxDist) return null;
    // 二分精化
    let lo = Math.max(0, t - step), hi = t;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const p = { x: o.x + d.x * mid, y: o.y + d.y * mid, z: o.z + d.z * mid };
      if (p.y <= heightAt(p.x, p.z)) hi = mid; else lo = mid;
    }
    return hi;
  }

  // --- 数值 → 十六进制颜色串 ---
  function hexColor(c) { return '#' + c.toString(16).padStart(6, '0'); }

  // ============================================================
  //  空间哈希网格（64 BOT 索敌，替代 O(n²) 全量扫描）
  // ============================================================
  function Grid(cell) { this.cell = cell || CONFIG.GRID_CELL; this.map = new Map(); }
  Grid.prototype._key = function (cx, cz) { return cx * 100000 + cz; };
  Grid.prototype.rebuild = function (entities) {
    this.map.clear();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const cx = Math.floor(e.pos.x / this.cell), cz = Math.floor(e.pos.z / this.cell);
      const k = this._key(cx, cz);
      let arr = this.map.get(k);
      if (!arr) { arr = []; this.map.set(k, arr); }
      arr.push(e);
    }
  };
  Grid.prototype.queryCircle = function (x, z, r, out) {
    out = out || [];
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    const r2 = r * r;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.map.get(this._key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          const dx = e.pos.x - x, dz = e.pos.z - z;
          if (dx * dx + dz * dz <= r2) out.push(e);
        }
      }
    }
    return out;
  };
  Game.Grid = Grid;
  Game.grid = new Grid();

  // ============================================================
  //  后坐/手感数学（参考 Claude-of-Duty springs.js）
  // ============================================================
  const TAU = Math.PI * 2;
  const approach = (v, target, tau, dt) => v + (target - v) * (1 - Math.exp(-dt / tau));
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  // --- 弹簧（半隐式欧拉 + 子步积分，防低帧率爆炸） ---
  function Spring(freq, damping, target) {
    const w = TAU * freq;
    this.k = w * w;
    this.c = 2 * damping * w;
    this.target = target === undefined ? 0 : target;
    this.value = 0;
    this.velocity = 0;
  }
  Spring.prototype.step = function (dt) {
    const steps = Math.max(1, Math.ceil(dt * 360));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.value - this.target) - this.c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
  };

  // --- 后坐轴：位移 kick + 快弹簧回位 + 慢指数残差 ---
  // kick 的一次性位移产生"脆"的冲击；residual 以 residualTau 缓慢归零，
  // 连射时残差持续累积 → 枪口持续上抬；停火后弹簧迅速回中、残差慢拖尾
  function RecoilAxis(freq, damping, residualShare, residualTau) {
    this.spring = new Spring(freq, damping, 0);
    this.residual = 0;
    this.residualShare = residualShare === undefined ? 0.22 : residualShare;
    this.residualTau = residualTau === undefined ? 0.28 : residualTau;
    this.value = 0;
  }
  RecoilAxis.prototype.kick = function (amount) {
    this.spring.value += amount * (1 - this.residualShare);
    this.residual += amount * this.residualShare;
  };
  RecoilAxis.prototype.step = function (dt) {
    this.spring.step(dt);
    this.residual = approach(this.residual, 0, this.residualTau, dt);
    this.value = this.spring.value + this.residual;
  };
  RecoilAxis.prototype.reset = function () {
    this.spring.value = 0; this.spring.velocity = 0;
    this.residual = 0; this.value = 0;
  };

  // --- 圆盘均匀采样（扩散锥） ---
  function disc(rng) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng());
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  // --- 确定性后坐 pattern（同种子序列一致，可记忆可压枪） ---
  // recoilDef: { pitch, yaw, climbShape:[…], drift, bias }
  // 返回 Float32Array [pitch0, yaw0, pitch1, yaw1, …]，每发取一对
  function buildRecoilPattern(recoilDef, seed) {
    const rng = mulberry32(seed >>> 0);
    const N = 48;
    const out = new Float32Array(N * 2);
    const climbShape = recoilDef.climbShape || [1.45, 1.3, 1.15, 1.05, 1.0];
    let phase = rng() * TAU, phase2 = rng() * TAU;
    for (let i = 0; i < N; i++) {
      const climb = climbShape[Math.min(i, climbShape.length - 1)];
      // 垂直恒为正（本游戏 pitch 正 = 抬头），幅度做确定性微变，保证可记忆
      out[i * 2] = (recoilDef.pitch || 0) * climb * (0.85 + rng() * 0.3);
      phase += 0.4 + rng() * 1.1;
      phase2 += 0.8 + rng() * 1.6;
      const snake = Math.sin(phase + i * 2.6) * 0.75 + Math.sin(phase2 + i * 5.1) * 0.35;
      out[i * 2 + 1] = (recoilDef.yaw || 0) * (snake * (recoilDef.drift === undefined ? 1 : recoilDef.drift) * 3.2 +
        (recoilDef.bias || 0) + (rng() * 2 - 1) * 0.25);
    }
    return out;
  }

  // 暴露
  Game.rng = mulberry32(20260813);
  Game.newRng = mulberry32;   // 供地图等需要确定性独立随机源的地方
  Game.reseed = function (seed) { Game.rng = mulberry32(seed); };
  Game.math = {
    clamp, lerp, dist2, dist3, randRange, randInt, pick, v3,
    TAU, approach, disc, easeInOutCubic, easeOutCubic,
    Spring, RecoilAxis,
    buildRecoilPattern,
  };
  Game.ray = { raySphere, rayCylinder, rayAABB, rayGround, hexColor };
})();
