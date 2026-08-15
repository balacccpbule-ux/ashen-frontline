// ============================================================
//  ai.js  ·  机器人 AI（索敌/交火/推进/占领/重生）
//  v4 爆改：64 人规模 —— 士兵改 InstancedMesh（全队 1 draw call）、
//           空间哈希索敌（替代 O(n²) 扫描）、按距离降频 tick、
//           载具机组扩至 4 类（坦克/APC/直升机/战斗机）。
// ============================================================
(function () {
  'use strict';
  const M = Game.math;

  // ============================================================
  //  实例化士兵渲染（每队一个 InstancedMesh，合并部件 + 顶点色）
  // ============================================================
  // v5.45 士兵建模细化：腿+靴+躯干+背包+肩+双臂+手+头+盔+枪
  const PARTS = [
    { w: 0.15, h: 0.68, d: 0.17, x: -0.12, y: 0.4, z: 0, c: 0x262626 },    // 左腿
    { w: 0.15, h: 0.68, d: 0.17, x: 0.12, y: 0.4, z: 0, c: 0x262626 },     // 右腿
    { w: 0.17, h: 0.13, d: 0.28, x: -0.12, y: 0.06, z: -0.03, c: 0x1a1a1a }, // 左靴
    { w: 0.17, h: 0.13, d: 0.28, x: 0.12, y: 0.06, z: -0.03, c: 0x1a1a1a },  // 右靴
    { w: 0.52, h: 0.72, d: 0.32, x: 0, y: 1.08, z: 0, c: 'team' },         // 躯干
    { w: 0.36, h: 0.4, d: 0.16, x: 0, y: 1.12, z: 0.24, c: 0x33302a },     // 背包
    { w: 0.16, h: 0.13, d: 0.2, x: -0.34, y: 1.38, z: 0, c: 'team' },      // 左肩
    { w: 0.16, h: 0.13, d: 0.2, x: 0.34, y: 1.38, z: 0, c: 'team' },       // 右肩
    { w: 0.13, h: 0.56, d: 0.15, x: 0.32, y: 1.08, z: 0, c: 'team' },      // 持枪臂
    { w: 0.13, h: 0.56, d: 0.15, x: -0.32, y: 1.08, z: 0, c: 'team' },     // 左臂
    { w: 0.09, h: 0.09, d: 0.09, x: 0.32, y: 0.8, z: 0, c: 0xd8b088 },     // 右手
    { w: 0.09, h: 0.09, d: 0.09, x: -0.32, y: 0.8, z: 0, c: 0xd8b088 },    // 左手
    { w: 0.25, h: 0.26, d: 0.24, x: 0, y: 1.6, z: 0, c: 0xd8b088 },        // 头
    { w: 0.31, h: 0.15, d: 0.31, x: 0, y: 1.75, z: 0, c: 'team' },         // 头盔
    { w: 0.07, h: 0.09, d: 0.85, x: 0.28, y: 1.12, z: -0.35, c: 0x262626 }, // 枪
  ];
  const TEAM_CLOTH = [0xc0463a, 0x3a66c0];
  // v5 LOD：远距低模（躯干 + 头 + 头盔，3 部件；近距为完整 7 部件）
  const FAR_PARTS = [
    { w: 0.5, h: 0.72, d: 0.3, x: 0, y: 1.05, z: 0, c: 'team' },
    { w: 0.24, h: 0.26, d: 0.24, x: 0, y: 1.58, z: 0, c: 0xd8b088 },
    { w: 0.3, h: 0.15, d: 0.3, x: 0, y: 1.74, z: 0, c: 'team' },
  ];

  let instancers = null;   // [{near, far}, {near, far}] 每队近/远两套实例化网格
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _hidden = (function () {
    const m = new THREE.Matrix4();
    m.makeScale(0.0001, 0.0001, 0.0001);
    m.setPosition(0, -500, 0);
    return m;
  })();

  function mergePart(color, partsList) {
    // 把部件 BoxGeometry 平移后焊进合并几何（手动合并，无 examples 依赖）
    const parts = [];
    for (const p of partsList) {
      const b = new THREE.BoxGeometry(p.w, p.h, p.d);
      b.translate(p.x, p.y, p.z);
      const c = p.c === 'team' ? color : p.c;
      const cols = new Float32Array(b.attributes.position.count * 3);
      for (let i = 0; i < b.attributes.position.count; i++) {
        cols[i * 3] = ((c >> 16) & 255) / 255;
        cols[i * 3 + 1] = ((c >> 8) & 255) / 255;
        cols[i * 3 + 2] = (c & 255) / 255;
      }
      b.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      parts.push(b);
    }
    // 合并
    let vCount = 0, iCount = 0;
    for (const b of parts) { vCount += b.attributes.position.count; iCount += b.index.count; }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const idx = new Uint32Array(iCount);
    let vo = 0, io = 0;
    for (const b of parts) {
      pos.set(b.attributes.position.array, vo * 3);
      nor.set(b.attributes.normal.array, vo * 3);
      col.set(b.attributes.color.array, vo * 3);
      for (let i = 0; i < b.index.count; i++) idx[io + i] = b.index.array[i] + vo;
      vo += b.attributes.position.count; io += b.index.count;
      b.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
    merged.setIndex(new THREE.BufferAttribute(idx, 1));
    return merged;
  }

  function initInstancers(maxSlots) {
    if (instancers) return;
    instancers = [];
    for (let team = 0; team < 2; team++) {
      const geoNear = mergePart(TEAM_CLOTH[team], PARTS);
      const geoFar = mergePart(TEAM_CLOTH[team], FAR_PARTS);
      const im = new THREE.InstancedMesh(geoNear, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), maxSlots);
      const imFar = new THREE.InstancedMesh(geoFar, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), maxSlots);
      for (const m of [im, imFar]) {
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.castShadow = true;
        for (let i = 0; i < maxSlots; i++) m.setMatrixAt(i, _hidden);
        m.instanceMatrix.needsUpdate = true;
        Game.scene.add(m);
      }
      instancers.push({ near: im, far: imFar });
    }
  }

  function updateInstance(s) {
    const ims = instancers ? instancers[s.team] : null;
    if (!ims || s.instSlot === undefined) return;
    const dead = !s.alive;
    // 隐藏：死亡消散（倒地等待救援者保持可见）/ 车内 / 超远
    const dPlayer = s.isPlayer ? 0 : M.dist2(s.pos.x, s.pos.z, Game.player.pos.x, Game.player.pos.z);
    if ((dead && s.corpseT > 4) || s.ridingVehicle || (!s.isPlayer && dPlayer > CONFIG.SOLDIER_CULL_DIST)) {
      ims.near.setMatrixAt(s.instSlot, _hidden);
      ims.far.setMatrixAt(s.instSlot, _hidden);
      ims.near.instanceMatrix.needsUpdate = true;
      ims.far.instanceMatrix.needsUpdate = true;
      return;
    }
    // v5 LOD：超距换低模网格（每队仍各 1 draw call）
    const useNear = s.isPlayer || dPlayer <= CONFIG.SOLDIER_LOD_DIST;
    const im = useNear ? ims.near : ims.far;
    const other = useNear ? ims.far : ims.near;
    other.setMatrixAt(s.instSlot, _hidden);
    other.instanceMatrix.needsUpdate = true;
    // v5.45 士兵姿态动画：蹲姿微微前倾（不再过度压缩 0.62→0.88）、移动前倾
    const crouchK = s.crouching ? 0.88 : 1;
    const lean = (s.crouching ? -0.16 : 0) + (!dead && s.moving && s.grounded ? -0.08 : 0);
    _e.set(lean, s.yaw, dead ? -(Math.min(s.corpseT, 0.5) / 0.5) * Math.PI / 2 : 0, 'YXZ');
    _q.setFromEuler(_e);
    // v5.38 兵种外观差异：体型差异（支援壮硕 / 侦察纤细）+ 身高微差
    const clsK = s.clsKey === 'support' ? 1.07 : s.clsKey === 'assault' ? 1.03 : s.clsKey === 'recon' ? 0.94 : s.clsKey === 'engineer' ? 1.02 : s.clsKey === 'medic' ? 0.98 : 1.0;
    _s.set(clsK, crouchK * clsK, clsK);
    const bob = !dead && s.moving && s.grounded ? Math.abs(Math.sin(Game.time * 8 + s.id)) * 0.05 : 0;
    _p.set(s.pos.x, s.pos.y + (dead ? 0.05 : bob) - (s.crouching ? 0.12 : 0), s.pos.z);
    _m.compose(_p, _q, _s);
    im.setMatrixAt(s.instSlot, _m);
    im.instanceMatrix.needsUpdate = true;
  }

  // ---- 初始布置 ----
  function init() {
    instancers = null;
    const maxSlots = CONFIG.BOT_COUNT_PER_TEAM + 1;
    initInstancers(maxSlots);
    for (let team of [TEAM_RED, TEAM_BLUE]) {
      // 红军 31 BOT + 玩家 = 32；蓝军 32 BOT → 32v32 共 64 人
      const count = CONFIG.BOT_COUNT_PER_TEAM + (team === TEAM_BLUE ? 1 : 0);
      // v5.31 职业均衡分配：1:1:1…轮询配额；除不尽的余数随机；
      // 玩家（红方）优先选职业——其职业配额让出 1 个名额
      const quota = {};
      const teamSize = team === TEAM_RED ? count + 1 : count;
      const per = Math.floor(teamSize / CLASS_ORDER.length);
      for (const c of CLASS_ORDER) quota[c] = per;
      let rem = teamSize % CLASS_ORDER.length;
      const pCls = (team === TEAM_RED && Game.hud) ? Game.hud.selectedClass : 'assault';
      if (team === TEAM_RED) {
        if (quota[pCls] > 0) quota[pCls]--;
        else rem = Math.max(0, rem - 1);
      }
      const seq = [];
      // 轮询排布（每轮每职业一个名额），保证各职业均匀散布、乘员名额不吞掉整类职业；
      // 红方首轮跳过玩家所选职业 1 个名额（玩家优先选职业）
      let playerSkipped = false;
      for (let q = 0; q < per; q++) {
        for (const c of CLASS_ORDER) {
          if (team === TEAM_RED && q === 0 && c === pCls && !playerSkipped) { playerSkipped = true; continue; }
          seq.push(c);
        }
      }
      for (let r = 0; r < rem; r++) seq.push(CLASS_ORDER[Math.floor(Game.rng() * CLASS_ORDER.length)]);   // v5.38 用固定流，保证跨启动确定性
      for (let i = 0; i < count; i++) {
        const clsKey = seq[i % seq.length];
        const s = Game.createSoldier(team, false, clsKey);
        s.instSlot = i;
        s.name = BOT_NAMES[(i * 2 + team) % BOT_NAMES.length];   // v5.28 呼号（计分板多样性）
        s.bot = {
          respawnT: 0, aimError: M.randRange(Game.rng, CONFIG.AI_AIM_ERROR_MIN, CONFIG.AI_AIM_ERROR_MAX), scanT: 0,
          alert: -999, state: 'advance', lastTarget: null, aimStart: -999, reactT: 0,
          burst: 0, burstDelay: 0,
          mayFire: false, graceUntil: -999,
          seeEnemy: false, seeEnemyDist: Infinity, seeTarget: null,
          hunt: null,
          flankDir: 0,           // v5.13 侧翼包抄方向（0=直行 / ±1=垂直包抄）
          wpnScanT: 0,
          homeFlag: Game.flags[i % Game.flags.length],
          crew: i === 0 ? 'tank' : (i === 1 ? 'apc' : (i === 2 ? 'heli' : (i === 3 ? 'aa' : null))),
          aiT: M.randRange(Game.rng, 0, 0.1),
          losT: 0,
          wish: { wx: 0, wz: 0, speed: 0 },
        };
        respawn(s);
        // 60% 直接布置在占领点附近（载具乘员留在基地旁登车）
        if (i < Math.ceil(count * 0.6) && !s.bot.crew) {
          const f = Game.flags[i % Game.flags.length];
          s.pos.x = f.x + (Game.rng() - 0.5) * 9;
          s.pos.z = f.z + (Game.rng() - 0.5) * 9;
          s.pos.y = Game.heightAt(s.pos.x, s.pos.z);
        }
        updateInstance(s);
      }
    }
  }

  // ---- 重生 ----
  function respawn(s) {
    s.alive = true; s.health = s.maxHealth;
    s.spawnProtect = CONFIG.SPAWN_PROTECT;
    s.slot = 'primary'; s.reloading = false; s.reloadPhase = 0; s.fireTimer = 0; s.bloom = 0;
    s.pitch = 0; s.vel = { x: 0, y: 0, z: 0 }; s.grounded = true;
    s.corpseT = -1; s.corpseGroup = null;
    Game.weapons.refillAmmo(s);
    Game.weapons.initRecoil(s);
    Game.weapons.initShield(s);   // v5.10 护盾随重生重置
    let spot;
    if (s.bot.crew) {
      // 机组直接重生在座驾刷新点旁（飞行员回机场登机）
      const sp = VEHICLE_SPAWNS.find((x) => x.kind === s.bot.crew && x.team === s.team);
      if (sp) spot = { x: sp.x + (Math.random() - 0.5) * 6, z: sp.z + (Math.random() - 0.5) * 6 };
    }
    if (!spot) {
      if (Game.modes && Game.modes.spawnPoint) spot = Game.modes.spawnPoint(s);
      else {
        const owned = Game.flags.filter((f) => f.owner === s.team);
        const base = BASE_DEFS.find((b) => b.team === s.team);
        if (owned.length && Math.random() < 0.8) {
          const f = owned[Math.floor(Math.random() * owned.length)];
          spot = { x: f.x + (Math.random() - 0.5) * 10, z: f.z + (Math.random() - 0.5) * 10 };
        } else {
          spot = { x: base.x + (Math.random() - 0.5) * 12, z: base.z + (Math.random() - 0.5) * 12 };
        }
      }
    }
    s.pos = { x: spot.x, y: Game.heightAt(spot.x, spot.z), z: spot.z };
    s.yaw = Math.random() * Math.PI * 2;
    s.bot.respawnT = 0;
    s.bot.aimError = M.randRange(Game.rng, CONFIG.AI_AIM_ERROR_MIN, CONFIG.AI_AIM_ERROR_MAX);
    s.bot.mayFire = false; s.bot.graceUntil = -999; s.bot.hunt = null;
    s.bot.seeEnemy = false; s.bot.seeEnemyDist = Infinity; s.bot.seeTarget = null;
    s.bot.wish = { wx: 0, wz: 0, speed: 0 };
    s.bot.lastTarget = null;
    s.bot.flankDir = 0;   // v5.13
  }

  // ---- 视野/视线 ----
  function los(a, b) {
    return !Game.terrain.blocksLOS(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  function aimAt(s, pos, b) {
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    const L = Math.hypot(dx, dz) || 1;
    const targetYaw = Math.atan2(-dx, -dz);
    const eyeY = s.pos.y + CONFIG.EYE_HEIGHT;
    const targetPitch = Math.atan2((pos.y + 1) - eyeY, L);
    const lock = M.clamp((Game.time - b.aimStart) / CONFIG.AI_LOCK_TIME, 0, 1);
    let err = b.aimError * (1 - lock * 0.75) * (1 + L / 150);
    // v5.41 烟雾内/穿烟：AI 精度极差（不得透过烟雾精准射击）
    if (Game.effects && (Game.effects.inSmoke(s.pos.x, s.pos.z) || Game.effects.inSmoke(pos.x, pos.z) ||
        Game.effects.smokeOnLine(s.pos.x, s.pos.z, pos.x, pos.z))) {
      err = Math.max(err, 0.3);
    }
    s.yaw = targetYaw + err * Math.sin(Game.time * 3 + s.id * 1.7);
    s.pitch = targetPitch + err * 0.5 * Math.sin(Game.time * 2.3 + s.id);
  }

  // ---- 移动（愿望方向由 think 设定，每帧平滑积分） ----
  function setWish(s, wx, wz, speed) {
    const n = Math.hypot(wx, wz);
    if (n < 1e-6) { s.bot.wish.wx = 0; s.bot.wish.wz = 0; s.bot.wish.speed = 0; return; }
    s.bot.wish.wx = wx / n; s.bot.wish.wz = wz / n; s.bot.wish.speed = speed;
  }

  function applyMove(s, wx, wz, speed, dt) {
    const k = 1 - Math.exp(-8 * dt);
    s.vel.x += (wx * speed - s.vel.x) * k;
    s.vel.z += (wz * speed - s.vel.z) * k;
    s.moving = Math.hypot(wx, wz) > 0.1;
    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;
    Game.terrain.resolveCircle(s.pos, s.radius);
    s.pos.x = M.clamp(s.pos.x, -CONFIG.WORLD + 1, CONFIG.WORLD - 1);
    s.pos.z = M.clamp(s.pos.z, -CONFIG.WORLD + 1, CONFIG.WORLD - 1);
    const gh = Game.heightAt(s.pos.x, s.pos.z);
    if (s.grounded) {
      if (s.pos.y <= gh + 0.05) s.pos.y = gh; else { s.grounded = false; s.vel.y = 0; s.fallStartY = s.pos.y; }
    } else {
      s.vel.y -= CONFIG.GRAVITY * dt;
      s.pos.y += s.vel.y * dt;
      if (s.pos.y <= gh) {
        const fall = s.fallStartY !== undefined ? (s.fallStartY - gh) : 0;
        s.pos.y = gh; s.vel.y = 0; s.grounded = true; s.fallStartY = undefined;
        if (fall > CONFIG.FALL_DMG_THRESHOLD) {
          Game.weapons.applyDamage(s, (fall - CONFIG.FALL_DMG_THRESHOLD) * CONFIG.FALL_DMG_PER_M, null, { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z });
        }
      }
    }
  }

  function moveToward(s, pos, dt, dir) {
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    const L = Math.hypot(dx, dz) || 1;
    const wob = Math.sin(Game.time * 0.6 + s.id) * 0.35;
    let wx = (dx / L) * dir + (-dz / L) * wob;
    let wz = (dz / L) * dir + (dx / L) * wob;
    const n = Math.hypot(wx, wz) || 1;
    setWish(s, wx / n, wz / n, CONFIG.WALK_SPEED);
  }

  function strafe(s, dt) {
    const r = Math.sin(Game.time * 0.9 + s.id);
    const px = Math.cos(s.yaw), pz = -Math.sin(s.yaw);
    setWish(s, px * r, pz * r, CONFIG.WALK_SPEED * 0.5);
  }

  function nearestEnemyFlag(s) {
    let best = null, bestD = Infinity;
    for (const f of Game.flags) {
      if (f.owner === s.team) continue;
      const d = M.dist2(f.x, f.z, s.pos.x, s.pos.z);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (!best) best = Game.flags[Math.floor(Math.random() * Game.flags.length)];
    return best;
  }

  function findCrewVehicle(s) {
    let best = null, bd = Infinity;
    for (const v of Game.vehicles) {
      if (v.team !== s.team || !v.alive || v.occupant || v.kind !== s.bot.crew) continue;
      const d = M.dist2(v.pos.x, v.pos.z, s.pos.x, s.pos.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ---- AI 选枪打分 ----
  const WEAPON_SCORES = {
    ar:      [1.0, 1.0, 0.8],
    lmg:     [0.8, 1.0, 1.0],
    smg:     [1.0, 0.7, 0.3],
    sniper:  [0.3, 0.9, 1.0],
    pistol:  [0.9, 0.5, 0.2],
    shotgun: [1.25, 0.55, 0.2],   // 近战王者
    aa12:    [1.3, 0.5, 0.2],     // 全自动连喷
    dmr:     [0.5, 1.0, 1.1],     // 中远距离
  };
  function chooseWeapon(s, dist) {
    const prim = s.slots.primary, sec = s.slots.secondary;
    if (prim.mag <= 0 && prim.reserve <= 0) return 'secondary';
    if (sec.mag <= 0 && sec.reserve <= 0) return 'primary';
    const band = dist < 25 ? 0 : (dist < 60 ? 1 : 2);
    const score = (slot) => {
      const row = WEAPON_SCORES[slot.def.key] || [0.6, 0.6, 0.6];
      return (slot.mag + slot.reserve) > 0 ? row[band] : 0;
    };
    const sp = score(prim), ss = score(sec);
    const cur = s.slot === 'primary' ? sp : ss;
    const alt = s.slot === 'primary' ? ss : sp;
    if (alt > cur + 0.5) return s.slot === 'primary' ? 'secondary' : 'primary';
    return s.slot;
  }

  function nearestCover(s) {
    let best = null, bd = Infinity;
    for (const so of Game.terrain.solids) {
      if (!so.solid || !so.blocksLOS) continue;
      const d = M.dist2(so.cx, so.cz, s.pos.x, s.pos.z);
      if (d < 15 && d < bd) { bd = d; best = so; }
    }
    return best ? { x: best.cx, z: best.cz } : null;
  }

  // ---- 感知：网格邻居 + LOS 缓存 ----
  const _query = [];
  function perceive(s) {
    const b = s.bot;
    const dPlayer = M.dist2(s.pos.x, s.pos.z, Game.player.pos.x, Game.player.pos.z);
    const losInterval = dPlayer < 40 ? CONFIG.AI_LOS_NEAR : CONFIG.AI_LOS_FAR;
    // 网格查询附近敌兵 + 载具
    Game.grid.queryCircle(s.pos.x, s.pos.z, CONFIG.AI_ENGAGE_RANGE, _query);
    let enemy = null, enemyD = Infinity, eveh = null, evehD = Infinity;
    for (const e of _query) {
      const isVeh = e.hitRadius !== undefined;
      if (e.team === s.team) continue;
      if (isVeh) {
        if (!e.alive) continue;
        const d = M.dist2(e.pos.x, e.pos.z, s.pos.x, s.pos.z);
        if (d < evehD) { evehD = d; eveh = e; }
      } else {
        if (!e.alive || e.ridingVehicle || e === s) continue;
        const d = M.dist2(e.pos.x, e.pos.z, s.pos.x, s.pos.z);
        if (d < enemyD) { enemyD = d; enemy = e; }
      }
    }
    // 侦察标记：可穿墙
    if (enemy && enemy.spottedUntil > Game.time) {
      b.seeEnemy = true; b.seeEnemyDist = enemyD; b.seeTarget = enemy;
      return { enemy, enemyD, eveh, evehD };
    }
    // LOS 刷新（缓存窗口内沿用上次结果；缓存目标须仍存活，防沿用已死者）
    if (b.losT > 0) {
      const tgt = b.seeTarget;
      const keep = (tgt === enemy || tgt === eveh) && tgt && tgt.alive;
      if (keep) return { enemy: b.seeEnemy && tgt === enemy ? enemy : null, enemyD, eveh, evehD };
    }
    b.losT = losInterval;
    const eye = { x: s.pos.x, y: s.pos.y + CONFIG.EYE_HEIGHT, z: s.pos.z };
    let seeEnemy = false, seeTarget = null;
    if (enemy && los(eye, { x: enemy.pos.x, y: enemy.pos.y + 1, z: enemy.pos.z })) { seeEnemy = true; seeTarget = enemy; }
    else if (eveh && los(eye, { x: eveh.pos.x, y: eveh.pos.y + 2, z: eveh.pos.z })) { seeTarget = eveh; }
    b.seeEnemy = seeEnemy; b.seeEnemyDist = seeEnemy ? enemyD : Infinity; b.seeTarget = seeTarget;
    if (b.seeTarget === eveh) return { enemy: null, enemyD, eveh, evehD };
    return { enemy: seeEnemy ? enemy : null, enemyD, eveh, evehD };
  }

  // ---- 决策 ----
  function think(s, dt) {
    const b = s.bot;
    const weapon = Game.weapons.activeWeapon(s);
    const range = weapon.def.range;

    // 1) 载具乘员：优先登车
    if (b.crew) {
      const v = findCrewVehicle(s);
      if (v) {
        const d = M.dist2(s.pos.x, s.pos.z, v.pos.x, v.pos.z);
        if (d < 6.5) { Game.Vehicles.enter(v, s); return; }
        moveToward(s, v.pos, dt, 1);
        return;
      }
      // 座驾阵亡 → 按步兵行动（落回下方推进逻辑）
    }

    // 2) 感知
    const { enemy, enemyD, eveh, evehD } = perceive(s);
    const seeEnemy = !!enemy;
    const seeVeh = !!eveh && b.seeTarget === eveh;

    // 3) 受击压制 → 找掩体
    if (b.alert > Game.time - 2.5 && s.health < 70 && !seeEnemy) {
      b.state = 'cover';
      s.crouching = true;
      const cover = nearestCover(s);
      if (cover) moveToward(s, cover, dt, 1);
      else if (enemy) moveToward(s, enemy.pos, dt, -1);
      else strafe(s, dt);
      return;
    }
    s.crouching = false;

    // 3.1) v5.13 步兵避载具：非工程兵被敌方载具逼近时拉开距离
    if (seeVeh && s.clsKey !== 'engineer' && evehD < 26) {
      b.state = 'avoid';
      moveToward(s, eveh.pos, dt, -1);
      s.crouching = true;
      return;
    }

    // 3.2) v5.13 换弹掩护：交火中换弹时退到掩体后
    if (s.reloading && seeEnemy && enemyD < 60) {
      b.state = 'cover';
      const cover = nearestCover(s);
      if (cover) moveToward(s, cover, dt, 1);
      else strafe(s, dt);
      s.crouching = true;
      return;
    }

    // 3.3) v5.13 濒死撤退：残血且近距威胁 → 撤向掩体/拉开距离
    if (s.health < 35 && seeEnemy && enemyD < 30) {
      b.state = 'retreat';
      const cover = nearestCover(s);
      if (cover) moveToward(s, cover, dt, 1);
      else moveToward(s, enemy.pos, dt, -1);
      s.crouching = true;
      return;
    }

    // 3.5) 医疗兵：治疗伤员（v5.6 无救援系统，阵亡立即重生；医疗箱范围治疗）
    if (s.clsKey === 'medic') {
      let wounded = null, wd = Infinity;
      for (const t of Game.soldiers) {
        if (t.team !== s.team || !t.alive || t === s) continue;
        if (t.health >= t.maxHealth * 0.7) continue;
        const d = M.dist2(t.pos.x, t.pos.z, s.pos.x, s.pos.z);
        if (d < wd) { wd = d; wounded = t; }
      }
      if (wounded && wd < 70) {
        b.state = 'heal';
        if (wd < (GADGETS.medkit.healRadius || 8)) {
          s.crouching = true;
          if (s.gadgetCooldown <= 0) Game.weapons.fireGadget(s);
        } else {
          moveToward(s, wounded.pos, dt, 1);
        }
        return;
      }
      // 自疗
      if (s.health < s.maxHealth * 0.6 && s.gadgetCooldown <= 0) Game.weapons.fireGadget(s);
    }

    // 3.6) 支援兵：自动部署弹药箱（自己或附近队友弹药告急时）
    if (s.clsKey === 'support' && s.gadgetCooldown <= 0) {
      const needAmmo = (x) => {
        const p1 = x.slots.primary, p2 = x.slots.secondary;
        return (p1.mag + p1.reserve) / (p1.def.mag + p1.def.reserve) < 0.4;
      };
      let deploy = needAmmo(s);
      if (!deploy) {
        for (const t of Game.soldiers) {
          if (t.team !== s.team || !t.alive || t === s) continue;
          if (M.dist2(t.pos.x, t.pos.z, s.pos.x, s.pos.z) < 14 && needAmmo(t)) { deploy = true; break; }
        }
      }
      if (deploy) { Game.weapons.fireGadget(s); return; }
    }

    // 4) v5.26 反迫击炮：敌方迫击炮兵暴露（开火/命中暴露 spottedUntil）→ 优先反打其位置
    if (s.clsKey === 'mortar') {
      const minR = GADGETS.mortar.minRange || 15, maxR = GADGETS.mortar.maxRange || 180;
      let em = null, emD = Infinity;
      for (const e of Game.soldiers) {
        if (e === s || e.team === s.team || !e.alive || e.ridingVehicle) continue;
        if (e.clsKey !== 'mortar' || !(e.spottedUntil > Game.time)) continue;
        const d = M.dist2(e.pos.x, e.pos.z, s.pos.x, s.pos.z);
        if (d < emD) { emD = d; em = e; }
      }
      if (em && emD >= minR && emD <= maxR) {
        b.state = 'mortar';
        if (b.mortarT === undefined) b.mortarT = Game.time + 1.5;
        if (Game.time >= b.mortarT && s.gadgetAmmo > 0 && s.gadgetCooldown <= 0) {
          b.mortarTarget = { x: em.pos.x + (Game.rng() - 0.5) * 8, z: em.pos.z + (Game.rng() - 0.5) * 8 };
          Game.weapons.fireGadget(s);
          b.mortarT = Game.time + 5 + Game.rng() * 3;
        }
        if (emD < 50) moveToward(s, em.pos, dt, -1);
        else if (emD > 110) moveToward(s, em.pos, dt, 1);
        else strafe(s, dt);
        return;
      }
    }

    // 4.05) v5.44 迫击炮反载具：索敌到敌方载具（坦克/装甲车/直升机）→ 高价值目标，优先曲射
    if (s.clsKey === 'mortar' && eveh && (seeVeh || eveh.spottedUntil > Game.time) &&
        evehD >= (GADGETS.mortar.minRange || 15) && evehD <= (GADGETS.mortar.maxRange || 180)) {
      b.state = 'mortar';
      if (b.mortarT === undefined) b.mortarT = Game.time + 1.2;
      if (Game.time >= b.mortarT && s.gadgetAmmo > 0 && s.gadgetCooldown <= 0) {
        // 载具目标大，散布更小（更精准反载具）
        let tx = eveh.pos.x + (Game.rng() - 0.5) * 5;
        let tz = eveh.pos.z + (Game.rng() - 0.5) * 5;
        const dx = tx - s.pos.x, dz = tz - s.pos.z;
        const dd = Math.hypot(dx, dz) || 1;
        const minR = GADGETS.mortar.minRange || 15;
        if (dd < minR) { tx = s.pos.x + (dx / dd) * minR; tz = s.pos.z + (dz / dd) * minR; }
        b.mortarTarget = { x: tx, z: tz };
        Game.weapons.fireGadget(s);
        b.mortarT = Game.time + 4 + Game.rng() * 2.5;
      }
      if (evehD < 50) moveToward(s, eveh.pos, dt, -1);
      else if (evehD > 110) moveToward(s, eveh.pos, dt, 1);
      else strafe(s, dt);
      return;
    }

    // 4.1) 迫击炮兵：中远距曲射压制（无视线也能打，目标为索敌/被标记敌人）
    if (s.clsKey === 'mortar' && seeEnemy && enemyD >= (GADGETS.mortar.minRange || 15)) {   // v5.24 跟随配置最小射程
      b.state = 'mortar';
      if (b.mortarT === undefined) b.mortarT = Game.time + 1.5;
      if (Game.time >= b.mortarT && s.gadgetAmmo > 0 && s.gadgetCooldown <= 0) {
        let tx = enemy.pos.x + (Game.rng() - 0.5) * 10;
        let tz = enemy.pos.z + (Game.rng() - 0.5) * 10;
        // 落点散布后保证不低于最小射程（fireMortarAt 对近距直接拒绝）
        const dx = tx - s.pos.x, dz = tz - s.pos.z;
        const dd = Math.hypot(dx, dz) || 1;
        const minR = GADGETS.mortar.minRange || 15;
        if (dd < minR) { tx = s.pos.x + (dx / dd) * minR; tz = s.pos.z + (dz / dd) * minR; }
        b.mortarTarget = { x: tx, z: tz };
        Game.weapons.fireGadget(s);
        b.mortarT = Game.time + 5 + Game.rng() * 3;
      }
      if (enemyD < 50) moveToward(s, enemy.pos, dt, -1);
      else if (enemyD > 110) moveToward(s, enemy.pos, dt, 1);
      else strafe(s, dt);
      return;
    }

    // 4.4) v5.38 工程兵维修：附近友军载具受损 → 靠近维修（无敌情时）
    if (s.clsKey === 'engineer' && !seeEnemy) {
      let rv = null, rd = 16;
      for (const v of Game.vehicles) {
        if (!v.alive || v.team !== s.team || v.hp >= v.maxHp * 0.98) continue;
        const d = M.dist2(v.pos.x, v.pos.z, s.pos.x, s.pos.z);
        if (d < rd) { rd = d; rv = v; }
      }
      if (rv) {
        if (rd < 7) {
          b.state = 'repair';
          s.crouching = true;
          Game.Vehicles.repairVehicle(rv, s, dt);
          return;
        }
        moveToward(s, rv.pos, dt, 1);
        return;
      }
    }

    // 4.5) 工程兵反载具
    if (s.clsKey === 'engineer' && seeVeh && evehD < 70) {
      aimAt(s, { x: eveh.pos.x, y: eveh.pos.y + 1, z: eveh.pos.z }, b);
      if (Math.random() < 0.03 && s.gadgetAmmo > 0 && s.gadgetCooldown <= 0) {
        Game.weapons.fireGadget(s);
      } else if (evehD < range && s.fireTimer <= 0 && Math.random() < 0.5) {
        Game.weapons.fireWeapon(s);
      }
      if (evehD < 28) moveToward(s, eveh.pos, dt, -1); else strafe(s, dt);
      return;
    }

    // 5) 交火
    if (seeEnemy) {
      b.state = 'engage';
      if (b.lastTarget !== enemy) {
        b.lastTarget = enemy;
        b.aimStart = Game.time;
        b.graceUntil = Game.time + CONFIG.AI_GRACE_TIME;
        b.hunt = null;
        b.reactT = M.randRange(Game.rng, CONFIG.AI_REACT_MIN, CONFIG.AI_REACT_MAX);
        // v5.13 侧翼判定：已有队友盯同一目标 → 本 BOT 走垂直包抄路线
        let shared = false;
        for (const t of Game.bots) {
          if (t !== s && t.team === s.team && t.bot && t.bot.lastTarget === enemy) { shared = true; break; }
        }
        b.flankDir = shared ? (Game.rng() < 0.5 ? 1 : -1) : 0;
      }
      aimAt(s, enemy.pos, b);
      // v5.12 自动标记：交火中的敌人周期性上报全队（高亮边框/小地图共享）
      if (b.spotT === undefined) b.spotT = Game.time + 2 + Game.rng() * 3;
      if (Game.time >= b.spotT) {
        b.spotT = Game.time + 4 + Game.rng() * 4;
        if (!(enemy.spottedUntil > Game.time)) enemy.spottedUntil = Game.time + CONFIG.SPOT_TIME;
      }
      b.wpnScanT -= dt;
      if (b.wpnScanT <= 0) {
        b.wpnScanT = 0.5;
        const slot = chooseWeapon(s, enemyD);
        if (slot !== s.slot && !s.reloading) Game.weapons.switchSlot(s, slot);
      }
      const ideal = range * 0.55;
      // v5.13 兵种分工：侦察兵保持远距；支援兵远距架枪蹲姿
      if (s.clsKey === 'recon' && enemyD < 45 && !b.flankDir) {
        moveToward(s, enemy.pos, dt, -1);
      } else if (b.flankDir && enemyD > 18 && enemyD < 80) {
        // 侧翼包抄：前压 + 垂直偏移
        const fx = enemy.pos.x - s.pos.x, fz = enemy.pos.z - s.pos.z;
        const fL = Math.hypot(fx, fz) || 1;
        setWish(s, (fx / fL) * 0.55 + (-fz / fL) * b.flankDir * 0.85, (fz / fL) * 0.55 + (fx / fL) * b.flankDir * 0.85, CONFIG.WALK_SPEED);
      } else if (enemyD > ideal + 6) moveToward(s, enemy.pos, dt, 1);
      else if (enemyD < ideal - 6) moveToward(s, enemy.pos, dt, -1);
      else if (b.burstDelay > 0) {
        // 点射间歇：蹲进掩体而非站桩横移
        const cover = nearestCover(s);
        if (cover && M.dist2(cover.x, cover.z, s.pos.x, s.pos.z) > 2.5) moveToward(s, cover, dt, 1);
        else strafe(s, dt);
      } else strafe(s, dt);
      if (s.clsKey === 'support' && enemyD > 20) s.crouching = true;   // 重机枪架枪
      if (b.reactT > 0) b.reactT -= dt;
      if (b.burstDelay > 0) b.burstDelay -= dt;
      if (b.reactT <= 0 && Game.time >= b.graceUntil && b.mayFire &&
          enemyD < range * 0.85 && s.fireTimer <= 0) {
        if (b.burst > 0) {
          FIRELOG.push({ t: +Game.time.toFixed(2), s: s.id, tgt: enemy.id });
          if (FIRELOG.length > 300) FIRELOG.shift();
          Game.weapons.fireWeapon(s);
          b.burst--;
          if (b.burst <= 0) b.burstDelay = M.randRange(Game.rng, 0.35, 0.8);
        } else if (b.burstDelay <= 0 && Math.random() < CONFIG.AI_FIRE_CHANCE) {
          b.burst = Math.floor(M.randRange(Game.rng, 2, 4));
        }
      }
      // v5.13 智能掷雷：目标附近有队友聚集（≥2 敌人 8m 内）才投
      if (enemyD > 10 && enemyD < 25 && s.grenades > 0 && Math.random() < 0.015) {
        let cluster = 0;
        for (const t of Game.soldiers) {
          if (t !== enemy && t.team !== s.team && t.alive && !t.ridingVehicle &&
              M.dist2(t.pos.x, t.pos.z, enemy.pos.x, enemy.pos.z) < 8) cluster++;
        }
        if (cluster >= 1) Game.weapons.throwGrenade(s);
      }
      return;
    }

    // 6) 攻占目标：模式目标优先（突破=推扇区），否则本命点
    let tgt;
    if (b.hunt && Game.time < b.hunt.until) tgt = b.hunt;
    else if (Game.modes && Game.modes.objectiveFor) tgt = Game.modes.objectiveFor(s);
    else if (b.homeFlag) {
      // 修复：换图后 homeFlag 指向旧旗点对象 → 按 id 在当前 flags 重新解析
      const hf = Game.flags.find((f) => f.id === b.homeFlag.id);
      tgt = (hf && hf.owner !== s.team) ? hf : nearestEnemyFlag(s);
    }
    else tgt = nearestEnemyFlag(s);
    b.state = 'advance';
    // v5.44 反抱团：每个 bot 按 ID 围绕目标点分散（黄金角环形散开），不再挤成一团
    const spreadAng = s.id * 2.39996;          // 黄金角：均匀散开
    const spreadR = 5 + (s.id % 6) * 2.5;      // 5~17.5m 分散半径
    moveToward(s, { x: tgt.x + Math.cos(spreadAng) * spreadR, z: tgt.z + Math.sin(spreadAng) * spreadR }, dt, 1);
    b.scanT += dt;
    if (b.scanT > 1.6) { b.scanT = 0; s.yaw += (Math.random() - 0.5) * 1.4; }
  }

  // ============================================================
  //  战斗导演（5Hz：射击配额 + 残局清扫）
  // ============================================================
  const DIR = { t: 0, sweeps: [0, 0] };
  const FIRELOG = [];

  function updateCombatDirector(dt) {
    DIR.t += dt;
    if (DIR.t < 0.1999) return;
    DIR.t -= 0.2;

    const max = CONFIG.COMBAT_MAX_SHOOTERS_PER_TARGET;
    for (const b of Game.bots) if (b.bot) b.bot.mayFire = false;
    const attackers = [];
    for (const t of Game.soldiers) {
      if (!t.alive || t.ridingVehicle) continue;
      attackers.length = 0;
      for (const b of Game.bots) {
        if (!b.alive || b.ridingVehicle || !b.bot.seeEnemy || b.bot.lastTarget !== t) continue;
        attackers.push(b);
      }
      if (attackers.length <= max) {
        for (const b of attackers) b.bot.mayFire = true;
      } else {
        attackers.sort((a, c) => a.bot.seeEnemyDist - c.bot.seeEnemyDist);
        for (let i = 0; i < max; i++) attackers[i].bot.mayFire = true;
      }
    }

    // 残局清扫
    for (let team = 0; team < 2; team++) {
      let alive = 0;
      for (const b of Game.bots) if (b.team === team && b.alive) alive++;
      if (alive > CONFIG.SWEEP_MIN_ALIVE) { DIR.sweeps[team] = 0; continue; }
      DIR.sweeps[team] += 0.2;
      if (DIR.sweeps[team] < CONFIG.SWEEP_INTERVAL) continue;
      DIR.sweeps[team] = 0;
      for (const b of Game.bots) {
        if (b.team !== team || !b.alive || b.ridingVehicle || b.bot.seeEnemy) continue;
        let best = null, bd = Infinity;
        for (const e of Game.soldiers) {
          if (e.team === team || !e.alive) continue;
          const d = M.dist2(e.pos.x, e.pos.z, b.pos.x, b.pos.z);
          if (d < bd) { bd = d; best = e; }
        }
        if (!best) continue;
        b.bot.hunt = {
          x: best.pos.x + (Math.random() - 0.5) * 8,
          z: best.pos.z + (Math.random() - 0.5) * 8,
          until: Game.time + CONFIG.SWEEP_HUNT_TIME,
        };
      }
    }
  }

  // ---- 每帧更新 ----
  function update(dt) {
    // 1) 重建空间网格（存活士兵 + 存活载具）
    const entities = [];
    for (const s of Game.soldiers) if (s.alive && !s.ridingVehicle) entities.push(s);
    for (const v of Game.vehicles) if (v.alive) entities.push(v);
    Game.grid.rebuild(entities);

    // 2) 机器人
    for (const s of Game.bots) {
      const b = s.bot;
      if (!s.alive) {
        b.respawnT += dt;
        if (b.respawnT > CONFIG.RESPAWN_TIME) { respawn(s); updateInstance(s); }
        continue;
      }
      if (s.ridingVehicle) { updateInstance(s); continue; }   // 载具系统驾驶
      // 距离降频 tick：near 30Hz / mid 15Hz / far 6Hz
      b.aiT += dt;
      const dPlayer = M.dist2(s.pos.x, s.pos.z, Game.player.pos.x, Game.player.pos.z);
      const interval = dPlayer < 30 ? CONFIG.AI_TICK_NEAR : (dPlayer < 80 ? CONFIG.AI_TICK_MID : CONFIG.AI_TICK_FAR);
      if (b.aiT >= interval) {
        b.losT = Math.max(0, b.losT - b.aiT);
        think(s, b.aiT);
        b.aiT = 0;
      }
      // 愿望方向平滑积分（think 间帧持续移动）
      applyMove(s, b.wish.wx, b.wish.wz, b.wish.speed, dt);
      updateInstance(s);
    }

    // 3) 尸体计时
    for (const s of Game.soldiers) {
      if (s.corpseT >= 0) { s.corpseT += dt; updateInstance(s); }
    }

    updateCombatDirector(dt);
  }

  Game.ai = {
    init, update, respawn,
    buildBotMesh: () => { /* v4：士兵改实例化渲染，无独立网格 */ },
    updateCombatDirector, chooseWeapon,
    directorState: DIR,
    _fireLog: FIRELOG,
    resetFireLog: () => { FIRELOG.length = 0; },
  };
})();
