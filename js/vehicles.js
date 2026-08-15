// ============================================================
//  vehicles.js  ·  主战坦克 / 装甲运兵车 / 武装直升机 / 喷气战斗机
//  v4 爆改：新增固定翼战斗机（物理/航炮/火箭/锁定导弹/BOT 飞行员），
//           修复直升机 BOT AI（原版只读玩家输入），BOT 机组全系可用。
// ============================================================
(function () {
  'use strict';
  const M = Game.math;
  const V = { list: Game.vehicles };

  function box(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
  function cyl(r, h, m, seg) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 10), m); }
  function normAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  // ---- 生成全部载具 ----
  function init() {
    for (const sp of VEHICLE_SPAWNS) {
      const v = createVehicle(sp.kind, sp.team, sp.x, sp.z);
      V.list.push(v);
    }
  }

  function createVehicle(kind, team, x, z) {
    const def = VEHICLES[kind];
    const v = {
      id: Game.vehicles.length, kind, team, def,
      pos: {
        x,
        y: kind === 'heli' ? Game.heightAt(x, z) + 6 : Game.heightAt(x, z),
        z,
      },
      vel: { x: 0, y: 0, z: 0 },
      yaw: team === TEAM_RED ? 0 : Math.PI,
      turretYaw: 0, turretPitch: 0, hovPitch: 0, hovRoll: 0,
      hp: def.hp, maxHp: def.hp, alive: true,
      occupant: null, gunner: null, throttle: 0,   // v5.38 gunner=装甲车机枪手（第二乘员）
      weaponSlot: 'primary',
      cannonTimer: 0, mgTimer: 0, rocketTimer: 0,
      mgBurstT: 0, mgPauseT: 0, mgLong: false, trampleT: 0,   // v5.14 点射/碾压状态
      stuckT: 0,   // v5.29 卡死检测计时
      respawnT: 0, group: null, parts: {},
      lastFireTime: -999, hitRadius: def.hitRadius,
      barrelRecoil: 0,   // v5.10 炮管后座动画
      // BOT 输入（直升机驾驶员）
      botYaw: null, botPitch: null, botRoll: null, botThrottle: null, botAlt: 28,
    };
    buildMesh(v);
    return v;
  }

  // ---- 网格 ----
  function buildMesh(v) {
    const g = new THREE.Group();
    const teamC = v.team === TEAM_RED ? 0xb8443a : 0x355ca8;
    const bodyM = new THREE.MeshStandardMaterial({ color: teamC, roughness: 0.55, metalness: 0.45 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7, metalness: 0.4 });

    if (v.kind === 'tank') {
      const hull = box(3.0, 1.5, 4.8, bodyM); hull.position.y = 1.1;
      const treadL = box(0.9, 1.0, 4.9, darkM); treadL.position.set(-1.6, 0.5, 0);
      const treadR = box(0.9, 1.0, 4.9, darkM); treadR.position.set(1.6, 0.5, 0);
      g.add(hull, treadL, treadR);
      const turret = new THREE.Group();
      const turretBody = box(2.3, 0.8, 2.8, bodyM); turretBody.position.y = 1.9;
      const barrelPivot = new THREE.Group(); barrelPivot.position.set(0, 2.0, -0.6);
      const barrel = cyl(0.16, 3.4, darkM); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, -1.7);
      barrelPivot.add(barrel);
      turret.add(turretBody, barrelPivot);
      g.add(turret);
      v.parts.turret = turret; v.parts.barrelPivot = barrelPivot;
    } else if (v.kind === 'apc') {
      const hull = box(2.6, 1.6, 4.6, bodyM); hull.position.y = 1.3;
      const roof = box(2.2, 0.4, 3.2, darkM); roof.position.y = 2.0;
      g.add(hull, roof);
      for (let i = 0; i < 4; i++) {
        const wx = (i % 2 === 0 ? -1.2 : 1.2), wz = (i < 2 ? 1.4 : -1.4);
        const wheel = cyl(0.5, 0.4, darkM, 8); wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.5, wz);
        g.add(wheel);
      }
      const turret = new THREE.Group();
      const mg = box(0.16, 0.16, 1.6, darkM); mg.position.set(0, 2.2, -0.4);
      turret.add(mg);
      turret.position.y = 2.0;
      g.add(turret);
      v.parts.turret = turret; v.parts.barrelPivot = turret;
    } else if (v.kind === 'aa') {
      // 防空炮车：半开式炮塔 + 双联高射炮管
      const hull = box(2.6, 1.4, 4.6, bodyM); hull.position.y = 1.2;
      const roof = box(2.2, 0.3, 3.0, darkM); roof.position.y = 2.0;
      g.add(hull, roof);
      for (let i = 0; i < 4; i++) {
        const wx = (i % 2 === 0 ? -1.2 : 1.2), wz = (i < 2 ? 1.4 : -1.4);
        const wheel = cyl(0.5, 0.4, darkM, 8); wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.5, wz);
        g.add(wheel);
      }
      const turret = new THREE.Group();
      const turretBody = box(1.6, 0.6, 1.8, bodyM); turretBody.position.y = 2.3;
      const barrelPivot = new THREE.Group(); barrelPivot.position.set(0, 2.3, -0.4);
      const barrel1 = cyl(0.09, 3.6, darkM); barrel1.rotation.x = Math.PI / 2; barrel1.position.set(0.25, 0.25, -1.8);
      const barrel2 = cyl(0.09, 3.6, darkM); barrel2.rotation.x = Math.PI / 2; barrel2.position.set(-0.25, 0.25, -1.8);
      const mag1 = box(0.2, 0.26, 0.4, darkM); mag1.position.set(0.25, 0.3, -0.3);
      const mag2 = box(0.2, 0.26, 0.4, darkM); mag2.position.set(-0.25, 0.3, -0.3);
      barrelPivot.add(barrel1, barrel2, mag1, mag2);
      turret.add(turretBody, barrelPivot);
      g.add(turret);
      v.parts.turret = turret; v.parts.barrelPivot = barrelPivot;
    } else if (v.kind === 'heli') {
      const fuse = box(2.0, 1.4, 4.6, bodyM); fuse.position.y = 1.5;
      const cockpit = box(1.6, 1.0, 1.2, new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.2, metalness: 0.6 }));
      cockpit.position.set(0, 1.6, -1.8);
      const tail = box(0.5, 0.5, 3.0, darkM); tail.position.set(0, 1.6, 3.2);
      const tailFin = box(0.1, 0.9, 0.7, darkM); tailFin.position.set(0, 2.0, 4.2);
      const rotor = box(6.0, 0.08, 0.35, darkM); rotor.position.y = 2.6;
      const tailRotor = box(0.1, 1.2, 0.12, darkM); tailRotor.position.set(0.5, 1.7, 4.5);
      const skidL = box(0.12, 0.2, 3.0, darkM); skidL.position.set(-0.9, 0.25, -0.3);
      const skidR = box(0.12, 0.2, 3.0, darkM); skidR.position.set(0.9, 0.25, -0.3);
      g.add(fuse, cockpit, tail, tailFin, rotor, tailRotor, skidL, skidR);
      v.parts.rotor = rotor;
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    v.group = g;
    Game.scene.add(g);
    updateMesh(v, 0);
  }

  function updateMesh(v, dt) {
    if (!v.group) return;
    v.group.position.set(v.pos.x, v.pos.y, v.pos.z);
    v.group.rotation.order = 'YXZ';
    v.group.rotation.y = v.yaw;
    if (v.kind === 'heli') {
      v.group.rotation.z = -v.hovRoll * 0.5;
      v.group.rotation.x = -v.hovPitch * 0.4;
      if (v.parts.rotor) v.parts.rotor.rotation.y += dt * (v.occupant ? 26 : 4);
    } else if (v.parts.turret) {
      v.parts.turret.rotation.y = v.turretYaw;
      if (v.parts.barrelPivot) {
        v.parts.barrelPivot.rotation.x = v.turretPitch;
        // v5.10 炮管后座动画：开火后退 + 弹簧回位
        v.barrelRecoil = Math.max(0, v.barrelRecoil - dt * 5);
        v.parts.barrelPivot.position.z = -0.6 - v.barrelRecoil * 0.55;
      }
    }
  }

  // ---- 交互（上下车） ----
  function tryInteract(s) {
    if (s.ridingVehicle) { exit(s); return; }
    let best = null, bestD = 7;
    for (const v of Game.vehicles) {
      if (!v.alive) continue;
      // v5.38 装甲车机枪位：仅当司机是【玩家队友】时可坐机枪位（司机不被赶下车）；
      // v5.40 司机是 AI 时玩家上车直接接管驾驶（把 AI 请下车），避免车仍由 AI 控制
      if (v.kind === 'apc' && v.occupant && v.occupant.isPlayer && !v.gunner && s.isPlayer && v.occupant.team === s.team) {
        const d = M.dist2(s.pos.x, s.pos.z, v.pos.x, v.pos.z);
        if (d < bestD) { bestD = d; best = v; }
        continue;
      }
      // 玩家可抢占队友驾驶的载具（队友被请下车）；敌方占用则不可进入；BOT 只上空车
      if (v.occupant && (!s.isPlayer || v.occupant.team !== s.team)) continue;
      const d = M.dist2(s.pos.x, s.pos.z, v.pos.x, v.pos.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best) {
      if (best.kind === 'apc' && best.occupant && best.occupant.isPlayer && !best.gunner) {
        enterGunner(best, s);   // v5.38 机枪位（仅队友玩家司机在驾时）
      } else {
        if (best.occupant) {
          exit(best.occupant);   // 把里面的队友赶出来
          if (s.isPlayer && Game.hud) Game.hud.message('已请队友下车');
        }
        enter(best, s);
      }
    }
    else if (s.isPlayer && Game.hud) Game.hud.message('附近没有可用的载具');
  }

  function enter(v, s) {
    if (v.occupant) return;
    if (s.isPlayer && Game.Player.setMortarDeployed) Game.Player.setMortarDeployed(false);   // 上车收起迫击炮
    v.occupant = s;
    s.ridingVehicle = v; s.vehicleSeat = 0;
    s.pos = { x: v.pos.x, y: v.pos.y, z: v.pos.z };
    if (s.isPlayer) {
      Game.sound.engineStart(v.id, v.kind);
      if (Game.Player.view) Game.Player.view.visible = false;
      Game.Player.requestLock();
      if (Game.hud) Game.hud.message('进入 ' + v.def.name + '（F 退出）');
    }
    if (s.group) s.group.visible = false;
  }

  // v5.38 装甲车机枪位（第二乘员）：控制炮塔与机枪，司机只管驾驶
  function enterGunner(v, s) {
    if (v.gunner || !s) return;
    if (s.isPlayer && Game.Player.setMortarDeployed) Game.Player.setMortarDeployed(false);
    v.gunner = s;
    s.ridingVehicle = v; s.vehicleSeat = 1;
    s.pos = { x: v.pos.x, y: v.pos.y, z: v.pos.z };
    if (s.isPlayer) {
      if (Game.Player.view) Game.Player.view.visible = false;
      Game.Player.requestLock();
      if (Game.hud) Game.hud.message('坐上机枪位（鼠标开火 · F 下车）');
    }
    if (s.group) s.group.visible = false;
  }

  function exit(s) {
    const v = s.ridingVehicle;
    if (!v) return;
    if (v.gunner === s) v.gunner = null;   // v5.38 机枪手下车
    else v.occupant = null;
    s.ridingVehicle = null; s.vehicleSeat = -1;
    const ang = v.yaw + Math.PI / 2;
    s.pos = { x: v.pos.x + Math.cos(ang) * 3, y: Game.heightAt(v.pos.x, v.pos.z), z: v.pos.z + Math.sin(ang) * 3 };
    s.vel = { x: 0, y: 0, z: 0 };
    v.vel = { x: 0, y: 0, z: 0 };
    if (s.isPlayer) {
      Game.sound.engineStop(v.id);
      if (Game.Player.view) Game.Player.view.visible = true;
      Game.Player.requestLock();
    }
    if (s.group) s.group.visible = true;
    if (v.group) v.group.visible = true;
  }

  // ---- 武器 ----
  // v5.14 弹道对齐：玩家载具全部弹道沿准星（相机轴）射出——射线从炮口出发、
  // 指向准星 120m 汇聚点（命中判定含敌人），彻底解决「子弹落点不在准星」；
  // BOT 无相机，仍按炮塔/机头指向直射（无任何自动抬高）
  function aimInfo(v) {
    const occ = v.occupant;
    if (occ && occ.isPlayer) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(Game.camera.quaternion);
      return { camPos: { x: Game.camera.position.x, y: Game.camera.position.y, z: Game.camera.position.z }, camDir: { x: fwd.x, y: fwd.y, z: fwd.z } };
    }
    let yaw, pitch;
    if (v.kind === 'heli') { yaw = v.yaw; pitch = v.hovPitch; }
    else { yaw = v.yaw + v.turretYaw; pitch = v.turretPitch; }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    return { camPos: { x: v.pos.x, y: v.pos.y + v.def.camHeight, z: v.pos.z }, camDir: { x: -Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp } };
  }
  function muzzleFor(v) {
    let yaw, pitch;
    if (v.kind === 'heli') { yaw = v.yaw; pitch = v.hovPitch; }
    else { yaw = v.yaw + v.turretYaw; pitch = v.turretPitch; }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = { x: -Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp };
    const ey = v.pos.y + v.def.camHeight;
    return { x: v.pos.x + dir.x * 3.5, y: ey + dir.y * 3.5 - 0.4, z: v.pos.z + dir.z * 3.5 };
  }
  function fireRay(v, spread) {
    const ai = aimInfo(v);
    const m = muzzleFor(v);
    const R = 120;
    let dir = { x: (ai.camPos.x + ai.camDir.x * R) - m.x, y: (ai.camPos.y + ai.camDir.y * R) - m.y, z: (ai.camPos.z + ai.camDir.z * R) - m.z };
    let l = Math.hypot(dir.x, dir.y, dir.z) || 1; dir.x /= l; dir.y /= l; dir.z /= l;
    if (spread) {
      dir.x += (Math.random() * 2 - 1) * spread; dir.y += (Math.random() * 2 - 1) * spread; dir.z += (Math.random() * 2 - 1) * spread;
      l = Math.hypot(dir.x, dir.y, dir.z) || 1; dir.x /= l; dir.y /= l; dir.z /= l;
    }
    return { dir, muzzle: m };
  }

  function hitscan(v, dmg, spread, shooter, color, dmgType, range) {
    const { dir, muzzle } = fireRay(v, spread);
    range = range || 320;
    const hit = Game.weapons.hitTest(muzzle, dir, range, shooter);
    const end = hit ? hit.point : { x: muzzle.x + dir.x * range, y: muzzle.y + dir.y * range, z: muzzle.z + dir.z * range };
    Game.effects.tracer(muzzle, end, color);
    if (hit) {
      if (hit.type === 'soldier') Game.weapons.applyDamage(hit.soldier, dmg, shooter, hit.point);
      else if (hit.type === 'vehicle') Game.weapons.damageVehicle(hit.vehicle, dmg, shooter, dmgType || 'smallarms');
      else if (hit.type === 'solid') { if (hit.solid.destructible) Game.terrain.damageSolid(hit.solid, dmg); Game.effects.impact(hit.point, 0xcccccc); }
      else Game.effects.impact(hit.point, 0x8a7a5c);
    }
    Game.sound.shot('rifle', shooter && shooter.isPlayer ? 1 : Game.audio.distanceVol(muzzle));
    v.spottedUntil = Game.time + CONFIG.SPOTTED_TIME;   // v5.19 开火自动暴露（可被标记系统捕捉）
    v.lastFireTime = Game.time;
  }

  function firePrimary(v) {
    const occ = v.occupant; if (!occ) return;
    const def = v.def;
    if (v.kind === 'tank') {
      if (v.cannonTimer > 0) return;
      v.cannonTimer = def.shellReload;
      const { dir, muzzle } = fireRay(v, def.shellSpread || 0.002);   // v5.14 沿准星射出
      Game.weapons.spawnProjectile('shell', muzzle,
        { x: dir.x * def.shellSpeed, y: dir.y * def.shellSpeed, z: dir.z * def.shellSpeed },
        occ, { gravity: 4, radius: def.shellRadius, damage: def.shellDamage });
      Game.effects.muzzleFlash(muzzle);
      Game.sound.explosion(false);
      Game.shake += 0.15;
      v.barrelRecoil = 1;   // v5.10 炮管后座动画
      v.spottedUntil = Game.time + CONFIG.SPOTTED_TIME;   // v5.19 开火自动暴露
      v.lastFireTime = Game.time;
    } else if (v.kind === 'apc') {
      if (v.mgTimer > 0) return;
      v.mgTimer = def.mgRate;
      hitscan(v, def.mgDamage, def.mgSpread, occ, 0xffe08a);
    } else if (v.kind === 'aa') {
      if (v.cannonTimer > 0) return;
      v.cannonTimer = def.cannonRate;
      hitscan(v, def.cannonDamage, def.cannonSpread, occ, 0xffd27a, 'aa', def.range || 400);
      Game.effects.muzzleFlash(muzzleFor(v));
      v.lastFireTime = Game.time;
    } else if (v.kind === 'heli') {
      if (v.rocketTimer > 0) return;
      v.rocketTimer = def.rocketReload;
      const { dir, muzzle } = fireRay(v, def.rocketSpread || 0.002);   // v5.14 沿准星射出
      Game.weapons.spawnProjectile('rocket', muzzle,
        { x: dir.x * def.rocketSpeed, y: dir.y * def.rocketSpeed, z: dir.z * def.rocketSpeed },
        occ, { gravity: 3, radius: def.rocketRadius, damage: def.rocketDamage, antiVehicle: true });
      Game.effects.muzzleFlash(muzzle);
      Game.sound.shot('rifle');
      v.spottedUntil = Game.time + CONFIG.SPOTTED_TIME;   // v5.19 开火自动暴露
      v.lastFireTime = Game.time;
    }
  }

  function fireSecondary(v) {
    const occ = v.occupant; if (!occ) return;
    const def = v.def;
    if (v.kind === 'tank') {
      if (v.mgTimer > 0) return;
      v.mgTimer = def.mgRate;
      hitscan(v, def.mgDamage, def.mgSpread, occ, 0xfff0a0);
    } else if (v.kind === 'heli') {
      if (v.mgTimer > 0) return;
      v.mgTimer = def.cannonRate;
      hitscan(v, def.cannonDamage, def.cannonSpread, occ, 0xfff0a0);
    }
  }

  // ---- 物理 ----
  function groundPhysics(v, dt) {
    let throttle = 0, steer = 0;
    if (v.occupant && v.occupant.isPlayer) {
      const P = Game.Player;
      throttle = (P.keys.has('KeyW') ? 1 : 0) - (P.keys.has('KeyS') ? 1 : 0);
      steer = (P.keys.has('KeyD') ? 1 : 0) - (P.keys.has('KeyA') ? 1 : 0);
    } else if (v.occupant && v.occupant.bot) {
      throttle = v.botThrottle || 0;
      steer = v.botSteer || 0;
    }
    v.yaw -= steer * v.def.turnRate * dt;
    const spd = throttle > 0 ? v.def.speed : v.def.reverseSpeed;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const k = 1 - Math.exp(-6 * dt);
    v.vel.x += (fx * spd * throttle - v.vel.x) * k;
    v.vel.z += (fz * spd * throttle - v.vel.z) * k;
    const px0 = v.pos.x, pz0 = v.pos.z;
    v.pos.x += v.vel.x * dt;
    v.pos.z += v.vel.z * dt;
    Game.terrain.resolveCircle(v.pos, v.hitRadius * 0.8);
    v.pos.x = M.clamp(v.pos.x, -CONFIG.WORLD + 2, CONFIG.WORLD - 2);
    v.pos.z = M.clamp(v.pos.z, -CONFIG.WORLD + 2, CONFIG.WORLD - 2);
    v.pos.y = Game.heightAt(v.pos.x, v.pos.z);
    v.throttle = Math.abs(throttle);
    // v5.29 防卡死机动①：碰撞推出时顺推挤方向偏航 → 沿墙滑动，不再死顶障碍
    const pushX = v.pos.x - px0, pushZ = v.pos.z - pz0;
    const push = Math.hypot(pushX, pushZ);
    if (push > 0.04 && v.throttle > 0.1) {
      const fx2 = -Math.sin(v.yaw), fz2 = -Math.cos(v.yaw);
      let tx = fx2 + (pushX / push) * 1.8, tz = fz2 + (pushZ / push) * 1.8;
      const tl = Math.hypot(tx, tz) || 1;
      const targetYaw = Math.atan2(-tx / tl, -tz / tl);
      const d = normAngle(targetYaw - v.yaw);
      const maxTurn = v.def.turnRate * dt * 4;
      v.yaw = normAngle(v.yaw + M.clamp(d, -maxTurn, maxTurn) * Math.min(1, push * 2.5));
    }
    // v5.29 防卡死机动②：大油门但速度起不来 → 倒车 + 急转脱困
    const spdNow = Math.hypot(v.vel.x, v.vel.z);
    if (throttle > 0.5 && spdNow < 1.6) {
      v.stuckT = (v.stuckT || 0) + dt;
      if (v.stuckT > 0.5) {
        v.stuckT = 0;
        v.yaw = normAngle(v.yaw + (v.id % 2 ? 1 : -1) * 1.15);
        const fx3 = -Math.sin(v.yaw), fz3 = -Math.cos(v.yaw);
        v.vel.x = -fx3 * v.def.reverseSpeed * 0.6;
        v.vel.z = -fz3 * v.def.reverseSpeed * 0.6;
      }
    } else v.stuckT = 0;
    // v5.14 载具碾压：高速撞上敌方步兵直接碾死（驾驶者计分；spawn 保护/车组豁免）
    const vspd = Math.hypot(v.vel.x, v.vel.z);
    v.trampleT = Math.max(0, v.trampleT - dt);
    if (vspd > 6 && v.trampleT <= 0) {
      for (const s of Game.soldiers) {
        if (!s.alive || s.team === v.team || s.ridingVehicle) continue;
        const dx = s.pos.x - v.pos.x, dz = s.pos.z - v.pos.z;
        const rr = v.hitRadius * 0.95 + s.radius;
        if (dx * dx + dz * dz < rr * rr) {
          Game.weapons.applyDamage(s, 130, v.occupant || null, { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z }, false, '载具碾压');
          v.trampleT = 0.8;
        }
      }
    }
  }

  function heliPhysics(v, dt) {
    let thr = 0, roll = 0;
    if (v.occupant && v.occupant.isPlayer) {
      const P = Game.Player;
      // v5.42 空格上升 / Shift 下降 / WASD 前后左右（俯仰=前后、横滚=左右）
      thr = (P.keys.has('Space') ? 1 : 0) - ((P.keys.has('ShiftLeft') || P.keys.has('ShiftRight')) ? 1 : 0);
      roll = (P.keys.has('KeyD') ? 1 : 0) - (P.keys.has('KeyA') ? 1 : 0);
      const pitchWant = (P.keys.has('KeyS') ? 1 : 0) - (P.keys.has('KeyW') ? 1 : 0);
      v.hovPitch = M.lerp(v.hovPitch, pitchWant * 0.55, 1 - Math.exp(-4 * dt));
    } else if (v.occupant && v.occupant.bot) {
      // BOT 飞行员：botThrottle=爬升 / botYaw=航向 / botPitch=俯仰
      thr = v.botThrottle !== null ? v.botThrottle : 0;
      if (v.botYaw !== null) v.yaw = normAngle(v.yaw + M.clamp(normAngle(v.botYaw - v.yaw) * 1.5 * dt, -1.2 * dt, 1.2 * dt));
      if (v.botPitch !== null) v.hovPitch = M.lerp(v.hovPitch, v.botPitch, 1 - Math.exp(-3 * dt));
      roll = v.botRoll || 0;
    }
    const k = 1 - Math.exp(-4 * dt);
    // 升力
    v.vel.y += (thr * v.def.speed - v.vel.y) * k;
    // 姿态
    v.hovRoll += (roll * 0.6 - v.hovRoll) * k * 2;
    v.hovPitch = M.clamp(v.hovPitch, -0.9, 0.9);
    // 水平速度来自俯仰/横滚
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const hx = fx * (-v.hovPitch * 24) + rx * (v.hovRoll * 16); // 低头前飞
    const hz = fz * (-v.hovPitch * 24) + rz * (v.hovRoll * 16);
    v.vel.x += (hx - v.vel.x) * k;
    v.vel.z += (hz - v.vel.z) * k;
    v.pos.x += v.vel.x * dt; v.pos.y += v.vel.y * dt; v.pos.z += v.vel.z * dt;
    const gh = Game.heightAt(v.pos.x, v.pos.z);
    if (v.pos.y < gh + 1.6) { v.pos.y = gh + 1.6; v.vel.y = Math.max(0, v.vel.y); }
    v.pos.y = M.clamp(v.pos.y, 0, 130);
    v.pos.x = M.clamp(v.pos.x, -CONFIG.WORLD + 3, CONFIG.WORLD - 3);
    v.pos.z = M.clamp(v.pos.z, -CONFIG.WORLD + 3, CONFIG.WORLD - 3);
    v.throttle = Math.abs(thr);
    // v5.14 直升机贴地高速掠过同样碾杀（旋翼/机身撞击）
    v.trampleT = Math.max(0, v.trampleT - dt);
    if (v.trampleT <= 0 && Math.hypot(v.vel.x, v.vel.z) > 8 && v.pos.y < Game.heightAt(v.pos.x, v.pos.z) + 3.2) {
      for (const s of Game.soldiers) {
        if (!s.alive || s.team === v.team || s.ridingVehicle) continue;
        const dx = s.pos.x - v.pos.x, dz = s.pos.z - v.pos.z;
        const rr = v.hitRadius * 0.95 + s.radius;
        if (dx * dx + dz * dz < rr * rr) {
          Game.weapons.applyDamage(s, 130, v.occupant || null, { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z }, false, '载具碾压');
          v.trampleT = 0.8;
        }
      }
    }
  }

  // ---- 相机 ----
  function updateCamera(v, dt) {
    // v5.38 机枪手同样享受载具相机（第一/第三人称）
    const me = (v.occupant && v.occupant.isPlayer) ? v.occupant : (v.gunner && v.gunner.isPlayer) ? v.gunner : null;
    if (!me) return;
    const cam = Game.camera;
    const P = Game.Player;
    const targetFov = P.ads ? 26 : 75;
    cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-12 * (dt || 0.016)));
    cam.updateProjectionMatrix();
    // v5 第三人称（V 键）：地面载具与直升机的追尾视角
    if (V.thirdPerson) {
      const fwd = { x: -Math.sin(v.yaw), z: -Math.cos(v.yaw) };
      const dist = v.kind === 'heli' ? 17 : 11;
      const height = v.kind === 'heli' ? 6 : 5.6;
      cam.position.set(v.pos.x - fwd.x * dist, v.pos.y + height, v.pos.z - fwd.z * dist);
      const ly = v.pos.y + (v.kind === 'heli' ? -0.5 : v.def.camHeight * 0.75);
      cam.lookAt(v.pos.x, ly, v.pos.z);
      return;
    }
    if (v.kind === 'heli') {
      if (v.group) v.group.visible = !P.ads;
      const yaw = v.yaw, pitch = v.hovPitch;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const fwd = { x: -Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp };
      const camDist = 10, camHeight = 3.5;
      cam.position.set(v.pos.x - fwd.x * camDist, v.pos.y + camHeight - fwd.y * camDist, v.pos.z - fwd.z * camDist);
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
    } else {
      const yaw = v.yaw + v.turretYaw, pitch = v.turretPitch;
      cam.position.set(v.pos.x, v.pos.y + v.def.camHeight, v.pos.z);
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
    }
  }

  // ---- 重生 ----
  function respawnVehicle(v) {
    const sp = VEHICLE_SPAWNS.find((s) => s.kind === v.kind && s.team === v.team) || VEHICLE_SPAWNS[0];
    v.alive = true; v.hp = v.maxHp;
    v.occupant = null;
    v.pos = {
      x: sp.x,
      y: v.kind === 'heli' ? Game.heightAt(sp.x, sp.z) + 6 : Game.heightAt(sp.x, sp.z),
      z: sp.z,
    };
    v.vel = { x: 0, y: 0, z: 0 };
    v.yaw = v.team === TEAM_RED ? 0 : Math.PI;
    v.turretYaw = 0; v.turretPitch = 0; v.hovPitch = 0; v.hovRoll = 0;
    v.throttle = 0;
    v.botYaw = v.botPitch = v.botRoll = v.botThrottle = null;
    if (v.group) v.group.visible = true;
    v.respawnT = 0;
  }

  // ---- 机器人驾驶 ----
  function aimVehicleTurret(v, tx, ty, tz) {
    const dx = tx - v.pos.x, dz = tz - v.pos.z;
    v.turretYaw = normAngle(Math.atan2(-dx, -dz) - v.yaw);
    const L = Math.hypot(dx, dz) || 1;
    const pmax = v.kind === 'aa' ? 1.35 : 0.6;   // 防空炮大仰角
    const pmin = v.kind === 'aa' ? -0.15 : -0.45;
    v.turretPitch = M.clamp(Math.atan2((ty - (v.pos.y + v.def.camHeight)), L), pmin, pmax);
  }

  // v5.14 AI 车载机枪点射控制：短点射（~3 发）/长点射（~7 发）交替 + 随机间歇，
  // 削弱 AI 持续满速扫射；want=true 且处于点射窗口内才开火，无目标时计时照走
  function mgBurstWant(v, want, dt) {
    if (v.mgBurstT > 0) v.mgBurstT -= dt;
    else if (v.mgPauseT > 0) v.mgPauseT -= dt;
    else if (want) {
      v.mgLong = !v.mgLong;
      v.mgBurstT = v.mgLong ? 0.65 + Math.random() * 0.3 : 0.3 + Math.random() * 0.15;
      v.mgPauseT = 0.35 + Math.random() * 0.45;
    }
    return want && v.mgBurstT > 0;
  }

  function botDrive(v, dt) {
    if (v.kind === 'heli') { botDriveHeli(v, dt); return; }
    if (v.kind === 'aa') { botDriveAA(v, dt); return; }
    // ---- 地面载具（坦克/APC） ----
    const team = v.team;
    let enemy = null, ed = Infinity;
    for (const s of Game.soldiers) {
      if (s.team === team || !s.alive || s.ridingVehicle) continue;
      const d = M.dist2(s.pos.x, s.pos.z, v.pos.x, v.pos.z);
      if (d < ed) { ed = d; enemy = s; }
    }
    for (const vv of Game.vehicles) {
      if (vv === v || vv.team === team || !vv.alive) continue;
      const d = M.dist2(vv.pos.x, vv.pos.z, v.pos.x, v.pos.z);
      if (d < ed) { ed = d; enemy = vv; }
    }
    let tx, tz;
    if (enemy && ed < 240) { tx = enemy.pos.x; tz = enemy.pos.z; }
    else {
      let bf = null, bd = Infinity;
      for (const f of Game.flags) {
        if (f.owner === team) continue;
        const d = M.dist2(f.x, f.z, v.pos.x, v.pos.z);
        if (d < bd) { bd = d; bf = f; }
      }
      bf = bf || Game.flags[0];
      tx = bf.x; tz = bf.z;
    }
    const desired = Math.atan2(-(tx - v.pos.x), -(tz - v.pos.z));
    v.botSteer = -M.clamp(normAngle(desired - v.yaw) * 2, -1, 1);
    v.botThrottle = (enemy && ed < 160) ? 0.35 : 1;   // v5.3：接敌时减速停稳射击（更好命中、不再满场乱窜）
    if (enemy && ed < 12) v.botThrottle = -1;
    if (enemy) {
      aimVehicleTurret(v, enemy.pos.x, enemy.pos.y + 1, enemy.pos.z);
      const mgWant = ed < (v.kind === 'tank' ? 60 : 90);
      mgBurstWant(v, mgWant, dt);   // v5.14 点射窗口控制
      if (v.kind === 'tank') {
        const isVeh = enemy.hitRadius !== undefined;
        if (v.cannonTimer <= 0 && (isVeh || ed > 25) && ed < 220) firePrimary(v);
        else if (v.mgTimer <= 0 && mgWant && v.mgBurstT > 0) fireSecondary(v);
      } else if (v.kind === 'apc') {
        if (v.mgTimer <= 0 && mgWant && v.mgBurstT > 0 && !v.gunner) firePrimary(v);   // v5.38 有机枪手时司机不开火
      }
    } else {
      v.turretYaw = M.lerp(v.turretYaw, 0, 0.1);
      v.turretPitch = M.lerp(v.turretPitch, 0, 0.1);
      mgBurstWant(v, false, dt);
    }
  }

  // 防空车 BOT：优先对空（带提前量），无空目标时随队前压
  function botDriveAA(v, dt) {
    const team = v.team;
    let air = null, ad = Infinity;
    for (const vv of Game.vehicles) {
      if (vv === v || vv.team === team || !vv.alive) continue;
      if (vv.kind !== 'heli') continue;   // 防空车目标：直升机
      const d = M.dist2(vv.pos.x, vv.pos.z, v.pos.x, v.pos.z);
      if (d < ad && !Game.terrain.blocksLOS(v.pos.x, v.pos.y + v.def.camHeight, v.pos.z, vv.pos.x, vv.pos.y + 1, vv.pos.z)) { ad = d; air = vv; }
    }
    if (air && ad < 420) {
      aimVehicleTurret(v, air.pos.x, air.pos.y, air.pos.z);
      // 高速目标瞄准噪声：直升机易中、喷气机难追（速度越快误差越大）
      const spd = Math.hypot(air.vel.x, air.vel.z) || 0;
      const err = spd * 0.00016;
      v.turretYaw += Math.sin(Game.time * 7 + v.id * 3) * err;
      v.turretPitch += Math.sin(Game.time * 5 + v.id) * err * 0.6;
      if (Math.abs(v.turretYaw) < 0.14 && v.cannonTimer <= 0) firePrimary(v);
      const desired = Math.atan2(-(air.pos.x - v.pos.x), -(air.pos.z - v.pos.z));
      v.botSteer = -M.clamp(normAngle(desired - v.yaw) * 1.5, -1, 1);
      v.botThrottle = 0.35;
      return;
    }
    // 无空目标：朝敌方旗点机动，炮管回正
    let bf = null, bd = Infinity;
    for (const f of Game.flags) {
      if (f.owner === team) continue;
      const d = M.dist2(f.x, f.z, v.pos.x, v.pos.z);
      if (d < bd) { bd = d; bf = f; }
    }
    bf = bf || Game.flags[0];
    const desired = Math.atan2(-(bf.x - v.pos.x), -(bf.z - v.pos.z));
    v.botSteer = -M.clamp(normAngle(desired - v.yaw) * 2, -1, 1);
    v.botThrottle = 1;
    v.turretYaw = M.lerp(v.turretYaw, 0, 0.1);
    v.turretPitch = M.lerp(v.turretPitch, 0.4, 0.1);
  }

  // 直升机 BOT：盘旋压制（原版缺失，此处实现）
  function botDriveHeli(v, dt) {
    const team = v.team;
    let enemy = null, ed = Infinity;
    for (const s of Game.soldiers) {
      if (s.team === team || !s.alive || s.ridingVehicle) continue;
      const d = M.dist2(s.pos.x, s.pos.z, v.pos.x, v.pos.z);
      if (d < ed) { ed = d; enemy = s; }
    }
    for (const vv of Game.vehicles) {
      if (vv === v || vv.team === team || !vv.alive) continue;
      const d = M.dist2(vv.pos.x, vv.pos.z, v.pos.x, v.pos.z);
      if (d < ed) { ed = d; enemy = vv; }
    }
    if (enemy) {
      // v5.42 面对敌人（机头指向目标）+ 俯仰对准 → 正常倾斜火力
      const ang = Math.atan2(-(enemy.pos.x - v.pos.x), -(enemy.pos.z - v.pos.z));
      v.botYaw = ang;
      const hd = Math.max(Math.sqrt(ed), 12);
      let pitchTgt = Math.atan2(enemy.pos.y + 1 - v.pos.y, hd);
      if (ed < 40) pitchTgt = 0.35;   // 过近 → 抬头爬升脱离
      v.botPitch = M.clamp(pitchTgt, -0.55, 0.55);
      const wantAlt = M.clamp(24 + Math.sqrt(ed) * 0.25, 20, 46);
      v.botThrottle = M.clamp((wantAlt - v.pos.y) * 0.2, -1, 1);
      v.botRoll = 0;
      // 开火：航向 + 俯仰都对齐才开火（对载具火箭，对步兵机炮）
      const yawOk = Math.abs(normAngle(v.botYaw - v.yaw)) < 0.18;
      const pitchOk = Math.abs(v.hovPitch - v.botPitch) < 0.1;
      const aligned = yawOk && pitchOk;
      const isVeh = enemy.hitRadius !== undefined;
      const mgWant = !isVeh && ed < 2600;
      mgBurstWant(v, mgWant, dt);
      if (aligned && Math.abs(v.pos.y - wantAlt) < 8) {
        if (isVeh && ed < 4900 && v.rocketTimer <= 0) firePrimary(v);
        else if (mgWant && v.mgTimer <= 0 && v.mgBurstT > 0) fireSecondary(v);
      }
    } else {
      // 无目标：前往本方目标旗点
      let bf = null, bd = Infinity;
      for (const f of Game.flags) {
        if (f.owner === team) continue;
        const d = M.dist2(f.x, f.z, v.pos.x, v.pos.z);
        if (d < bd) { bd = d; bf = f; }
      }
      bf = bf || Game.flags[0];
      v.botYaw = Math.atan2(-(bf.x - v.pos.x), -(bf.z - v.pos.z));
      v.botThrottle = M.clamp((30 - v.pos.y) * 0.2, -1, 1);
      v.botPitch = -0.25;
      v.botRoll = 0;
    }
  }

  // ---- 每帧更新 ----
  function update(dt) {
    for (const v of V.list) {
      if (!v.alive) { v.respawnT += dt; if (v.respawnT > 18) respawnVehicle(v); continue; }
      v.cannonTimer = Math.max(0, v.cannonTimer - dt);
      v.mgTimer = Math.max(0, v.mgTimer - dt);
      v.rocketTimer = Math.max(0, v.rocketTimer - dt);
      if (v.occupant && v.occupant.isPlayer) {
        const P = Game.Player;
        if (P.locked) {
          if (v.kind === 'heli') {
            v.yaw -= P.dx * 0.0022;
            // v5.42 直升机俯仰改由 W/S 控制（见 heliPhysics），鼠标 Y 不再控俯仰
          } else {
            v.turretYaw -= P.dx * 0.002;
            const pmax = v.kind === 'aa' ? 1.35 : 0.6;
            const pmin = v.kind === 'aa' ? -0.15 : -0.45;
            v.turretPitch = M.clamp(v.turretPitch - P.dy * 0.002, pmin, pmax);
          }
        }
        P.dx = P.dy = 0;
        if (P.trigger) {
          if (v.weaponSlot === 'secondary') fireSecondary(v);
          else firePrimary(v);
        }
      } else if (v.occupant && v.occupant.bot) {
        botDrive(v, dt);
      }
      // v5.38 装甲车机枪手：控制炮塔并开火（司机只管驾驶）
      if (v.gunner) {
        const P = Game.Player;
        if (v.gunner.isPlayer && P.locked) {
          v.turretYaw -= P.dx * 0.002;
          v.turretPitch = M.clamp(v.turretPitch - P.dy * 0.002, -0.45, 0.6);
        }
        if (v.gunner.isPlayer) P.dx = P.dy = 0;
        if (v.gunner.isPlayer && P.trigger && v.mgTimer <= 0) firePrimary(v);
      }
      if (v.kind === 'heli') heliPhysics(v, dt);
      else groundPhysics(v, dt);
      if (v.occupant) {
        v.occupant.pos = { x: v.pos.x, y: v.pos.y, z: v.pos.z };
        v.occupant.vel = { x: 0, y: 0, z: 0 };
        v.occupant.grounded = true;
      }
      if (v.gunner) {
        v.gunner.pos = { x: v.pos.x, y: v.pos.y, z: v.pos.z };
        v.gunner.vel = { x: 0, y: 0, z: 0 };
        v.gunner.grounded = true;
      }
      updateCamera(v, dt);
      updateMesh(v, dt);
      if (v.occupant && v.occupant.isPlayer) {
        Game.sound.engineUpdate(v.id, v.throttle + (v.kind === 'heli' ? 0.5 : 0));
      }
    }
  }

  function resetAll() {
    for (const v of V.list) {
      if (v.occupant) { v.occupant.ridingVehicle = null; v.occupant.vehicleSeat = -1; v.occupant = null; }
      if (v.gunner) { v.gunner.ridingVehicle = null; v.gunner.vehicleSeat = -1; v.gunner = null; }   // v5.38
      Game.sound.engineStop(v.id);
      respawnVehicle(v);
    }
  }

  // v5.38 工程兵维修载具：持续回血 + 火花 + 计分功绩（玩家）
  function repairVehicle(v, s, dt) {
    if (!v || !v.alive || v.hp >= v.maxHp || !s || !s.alive) return false;
    v.hp = Math.min(v.maxHp, v.hp + 22 * dt);
    if (Game.effects && (Game.time - (v._repFxT || 0) > 0.12)) {
      v._repFxT = Game.time;
      // 确定性火花位置（正弦相位，不消耗随机数）
      const fx = Math.sin(Game.time * 19 + v.id * 3.1) * v.hitRadius * 0.5;
      const fz = Math.cos(Game.time * 13 + v.id * 1.7) * v.hitRadius * 0.5;
      Game.effects.emit(v.pos.x + fx, v.pos.y + 1.2, v.pos.z + fz, 0xffb040, 3, 2, 0.35, 0.08, 6, 1);
    }
    if (s.isPlayer) {
      s._repAcc = (s._repAcc || 0) + 22 * dt * 0.1;   // ≈2.2 分/秒
      if (Game.hud && Game.time - (s._repMeritT || -99) > 2.5) {
        s.score += Math.round(s._repAcc);
        Game.hud.merit('repair', Math.round(s._repAcc));
        s._repAcc = 0; s._repMeritT = Game.time;
      }
      if (Game.sound && Game.sound.repairTick && Game.time - (v._repSndT || -99) > 0.25) {
        v._repSndT = Game.time;
        Game.sound.repairTick(Game.audio ? Game.audio.distanceVol(v.pos) : 1);
      }
    }
    return true;
  }

  V.init = init; V.update = update; V.enter = enter; V.exit = exit; V.tryInteract = tryInteract; V.repairVehicle = repairVehicle;
  V.resetAll = resetAll;
  V.firePrimary = firePrimary; V.fireSecondary = fireSecondary;
  V.thirdPerson = false;   // v5 第三人称开关（V 键，玩家偏好）
  Game.Vehicles = V;
})();
