// ============================================================
//  weapons.js  ·  士兵工厂 + hitscan 战斗 + 兵种装备 + 弹道
// ============================================================
(function () {
  'use strict';
  const M = Game.math;
  const W = {};

  // ================= 士兵工厂（玩家与 AI 同构） =================
  function createSoldier(team, isPlayer, clsKey) {
    const cls = CLASSES[clsKey];
    const wdef = WEAPONS[cls.weapon];
    const gdef = GADGETS[cls.gadget];
    const s = {
      id: Game.soldiers.length,
      team, isPlayer, clsKey, cls,
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      yaw: team === TEAM_RED ? 0 : Math.PI, pitch: 0,
      health: 100, maxHealth: 100,
      radius: CONFIG.PLAYER_RADIUS, height: CONFIG.SOLDIER_HEIGHT, eyeHeight: CONFIG.EYE_HEIGHT,
      grounded: true, sprinting: false, crouching: false, moving: false,
      slot: 'primary',
      slots: {
        primary: { def: wdef, mag: wdef.mag, reserve: wdef.reserve },
        secondary: { def: WEAPONS.pistol, mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve },
      },
      grenades: GRENADE.ammo,
      smoke: SMOKE.ammo,   // v5.38 烟雾弹
      gadget: cls.gadget, gadgetAmmo: (gdef && gdef.ammo > 0 ? gdef.ammo : 0),
      gadgetCooldown: 0, gadgetCdMax: cls.gadgetCooldown || 0,
      fireTimer: 0, reloadTimer: 0, reloading: false, reloadPhase: 0,
      dryFireT: 0, semiMode: false,
      bloom: 0, moveSpread: 0,          // 旧字段（HUD/调试兼容），手感逻辑已切 spreadDeg
      spreadDeg: 0,                     // 连射累积扩散（度）
      recoilPitch: null, recoilYaw: null, // 后坐弹簧轴（RecoilAxis）
      patterns: null, patternIdx: -1, lastFireAge: 999,
      kills: 0, deaths: 0, score: 0, streak: 0, assists: 0,
      lastKillTime: -999, multikill: 0,
      shield: clsKey === 'assault' ? CONFIG.ASSAULT_SHIELD : 0,   // v5.10 突击兵护盾（无法补充）
      lastFireTime: -999, spottedUntil: -999,
      ridingVehicle: null, vehicleSeat: -1,
      spawnProtect: CONFIG.SPAWN_PROTECT,
      alive: true, corpseT: -1, corpseGroup: null,
      lastHitBy: null,
      bot: null, group: null,
    };
    initRecoil(s);
    Game.soldiers.push(s);
    if (!isPlayer) Game.bots.push(s);
    return s;
  }
  Game.createSoldier = createSoldier;

  // ================= 后坐 / 扩散状态 =================
  function initRecoil(s) {
    const k = CONFIG.RECOIL_FREQ, d = CONFIG.RECOIL_DAMPING, sh = CONFIG.RECOIL_SHARE, tau = CONFIG.RECOIL_TAU;
    if (s.recoilPitch) { s.recoilPitch.reset(); } else { s.recoilPitch = new Game.math.RecoilAxis(k, d, sh, tau); }
    if (s.recoilYaw) { s.recoilYaw.reset(); } else { s.recoilYaw = new Game.math.RecoilAxis(k, d, sh, tau); }
    if (!s.patterns) s.patterns = {};
    s.patternIdx = -1; s.spreadDeg = 0; s.dryFireT = 0; s.lastFireAge = 999;
  }
  function getPattern(s, wdef) {
    if (!s.patterns[wdef.key]) {
      s.patterns[wdef.key] = Game.math.buildRecoilPattern(wdef.recoilDef, wdef.recoilDef.seed);
    }
    return s.patterns[wdef.key];
  }
  // 静止扩散（度）：hip/ads 插值 × 姿态惩罚（CoD SPREAD_MODS）
  // 装备槽（gadget）无 activeWeapon → 返回 0，防闪退
  function restSpreadDeg(s, adsEase) {
    const wslot = activeWeapon(s);
    if (!wslot) return 0;
    const w = wslot.def;
    let rest = M.lerp(w.spreadHip, w.spreadAds, adsEase || 0);
    const mods = CONFIG.SPREAD_MODS;
    const spd = Math.hypot(s.vel.x, s.vel.z);
    if (s.crouching) rest *= mods.crouch;
    else if (s.sprinting) rest *= mods.sprinting;
    else if (!s.grounded) rest *= mods.airborne;
    else if (spd < 0.4) rest *= mods.still;
    else if (spd > 3.2) rest *= mods.walking;
    return rest;
  }
  function totalSpreadDeg(s, adsEase) {
    return restSpreadDeg(s, adsEase) + (s.spreadDeg || 0);
  }
  // 距离衰减（平方插值，dropoff 0 = 无衰减）
  function falloffFactor(w, dist) {
    if (!w.dropoff || w.dropoff <= 0) return 1;
    const r = w.falloffRange || w.range || 100;
    const t = Math.min(Math.max(dist, 0), r) / r;
    return 1 - (1 - w.dropoff) * t * t;
  }

  // ================= 瞄准向量 =================
  function aimVectors(s) {
    // 后坐由弹簧轴叠加（相机与弹道同源，AI 与玩家一致）；
    // 组合角钳制 ±1.5，防止后坐把视角顶过天顶（v2.4 翻顶 bug 的延续修复）
    const pitch = M.clamp(s.pitch + (s.recoilPitch ? s.recoilPitch.value : 0), -1.5, 1.5);
    const yaw = s.yaw + (s.recoilYaw ? s.recoilYaw.value : 0);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = { x: -Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp };
    const r = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    return { f, r };
  }
  function getEyePos(s) {
    const ey = s.crouching ? CONFIG.CROUCH_EYE : CONFIG.EYE_HEIGHT;
    return { x: s.pos.x, y: s.pos.y + ey, z: s.pos.z };
  }
  function getAimDir(s, adsEase) {
    // 锥角扩散：rest（姿态惩罚）+ 连射累积，圆盘均匀采样 + tan 映射
    const spreadDeg = totalSpreadDeg(s, adsEase);
    const { f, r } = aimVectors(s);
    if (spreadDeg <= 0.0005) return f;
    const k = Math.tan(spreadDeg * Math.PI / 180);
    const d = Game.math.disc(Math.random);
    const dx = f.x + r.x * k * d.x, dy = f.y + k * d.y, dz = f.z + r.z * k * d.x;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  }
  function activeWeapon(s) { return s.slots[s.slot]; }

  // ================= 命中测试 =================
  function hitTest(o, dir, maxDist, shooter) {
    let best = null, bestT = maxDist;
    const d = dir;
    // 士兵（敌队）
    for (const s of Game.soldiers) {
      if (s === shooter || !s.alive) continue;
      if (s.team === shooter.team) continue;
      if (s.ridingVehicle) continue;
      const h = s.crouching ? 1.25 : CONFIG.SOLDIER_HEIGHT;
      const t = Game.ray.rayCylinder(o, d, s.pos.x, s.pos.z, s.pos.y, s.pos.y + h, s.radius);
      if (t !== null && t < bestT) {
        const p = at(o, d, t);
        // 部位判定（高度带）：头 顶部15% / 腿 底部25% / 其余躯干
        const rel = (p.y - s.pos.y) / h;
        const part = rel > 0.85 ? 'head' : (rel < 0.25 ? 'legs' : 'torso');
        bestT = t; best = { type: 'soldier', soldier: s, t, point: p, headshot: part === 'head', part };
      }
    }
    // 载具（敌队）
    for (const v of Game.vehicles) {
      if (!v.alive || v.hp <= 0) continue;
      if (v.team === shooter.team) continue;
      const t = Game.ray.raySphere(o, d, { x: v.pos.x, y: v.pos.y + v.hitRadius * 0.5, z: v.pos.z }, v.hitRadius);
      if (t !== null && t < bestT) {
        bestT = t; best = { type: 'vehicle', vehicle: v, t, point: at(o, d, t) };
      }
    }
    // 实体（建筑/掩体）
    const sHit = Game.terrain.raySolid(o, d, bestT);
    if (sHit && sHit.t < bestT) { bestT = sHit.t; best = sHit; }
    // 地表
    const gT = Game.ray.rayGround(o, d, bestT, Game.heightAt);
    if (gT !== null && gT < bestT) { bestT = gT; best = { type: 'ground', t: gT, point: at(o, d, gT) }; }
    return best;
  }
  function at(o, d, t) { return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }; }

  // ================= 开火 =================
  function fireWeapon(s) {
    const slot = activeWeapon(s);
    if (!slot || s.reloading || s.fireTimer > 0) return false;
    if (slot.mag <= 0) {
      // 空仓干火（咔哒），随后自动换弹
      if (s.dryFireT <= 0) {
        if (s.isPlayer) Game.sound.dryFire();
        s.dryFireT = 0.3;
      }
      startReload(s);
      return false;
    }
    slot.mag--;
    const w = slot.def;
    s.fireTimer = w.rate;
    if (w.boltTime) s.boltT = w.boltTime;   // v5.17 栓动拉栓计时
    s.lastFireAge = 0;
    s.lastFireTime = Game.time;
    s.spottedUntil = Game.time + CONFIG.SPOTTED_TIME;

    const adsEase = s.isPlayer ? (Game.Player.adsEase || 0) : 0;
    const eye = getEyePos(s);
    const pellets = w.pellets || 1;   // v5：霰弹枪多弹丸
    const dir = getAimDir(s, adsEase);
    const muzzle = { x: eye.x + dir.x * 0.7, y: eye.y + dir.y * 0.7 - 0.06, z: eye.z + dir.z * 0.7 };
    Game.effects.muzzleFlash(muzzle, w.flashPower || 1);
    if (Game.effects.ejectShell) Game.effects.ejectShell(muzzle, dir); // 抛壳
    const shotVol = s.isPlayer ? 1 : Game.audio.distanceVol(eye);
    if (shotVol > 0.02) Game.sound.shot(w.sound, shotVol, s.isPlayer ? null : eye);   // v5.46 3D 音效
    let lastHit = null, lastDir = dir, lastEnd = at(eye, dir, w.range);
    for (let pi = 0; pi < pellets; pi++) {
      // 多弹丸：锥内随机散布（单弹丸 = 原逻辑零开销）
      let pdir = dir;
      if (pellets > 1) {
        const { f, r } = aimVectors(s);
        const k = Math.tan((w.pelletsSpread || 1.6) * Math.PI / 180);
        const dd = Game.math.disc(Math.random);
        const dx = f.x + r.x * k * dd.x, dy = f.y + k * dd.y, dz = f.z + r.z * k * dd.x;
        const ln = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        pdir = { x: dx / ln, y: dy / ln, z: dz / ln };
      }
      const hit = hitTest(eye, pdir, w.range, s);
      if (!hit) { Game.effects.tracer(muzzle, at(eye, pdir, w.range), w.tracer); continue; }
      lastHit = hit; lastDir = pdir; lastEnd = hit.point;
      Game.effects.tracer(muzzle, hit.point, w.tracer);
      const falloff = falloffFactor(w, hit.t);
      if (hit.type === 'soldier') {
        const headshot = !!hit.headshot;
        const mult = CONFIG.BODY_PARTS[hit.part] || 1;
        applyDamage(hit.soldier, w.damage * falloff * mult, s, hit.point, headshot);
        if (s.isPlayer) {
          const killed = !hit.soldier.alive;
          // 分层命中音效：爆头清脆"叮" / 血肉"噗"
          if (headshot) { if (Game.sound.hitHead) Game.sound.hitHead(); }
          else if (Game.sound.hitFlesh) Game.sound.hitFlesh(shotVol);
          // 非击杀命中才在此标记（击杀由 kill() 的 hitmarker 处理，避免覆盖）
          if (!killed && Game.hud) Game.hud.hitmarker(false, headshot);
          // 命中顿帧：击杀最重、单发武器爆头次之（自动连射不打顿帧，防卡顿）
          if (killed) Game.hitStop(0.09, 0.05);
          else if (headshot && !w.auto) Game.hitStop(0.05, 0.22);
        }
        if (Game.effects.impactFlesh) Game.effects.impactFlesh(hit.point, pdir, headshot, s);
        else Game.effects.impact(hit.point, headshot ? 0xffd700 : 0xe05550);
      } else if (hit.type === 'vehicle') {
        // v5 克制环：枪械伤害按载具装甲类型折算（v5.34 分级减伤，栓狙可穿坦克）
        damageVehicle(hit.vehicle, w.damage, s, 'smallarms', w);
        if (s.isPlayer) {
          if (Game.sound.hitArmor) Game.sound.hitArmor();
          if (Game.hud) Game.hud.hitmarker(false, false, true);   // 装甲命中反馈（琥珀色）
        }
        if (Game.effects.impactWall) Game.effects.impactWall(hit.point, null, s, hit.t);
        else Game.effects.impact(hit.point, 0xffd27a);
      } else if (hit.type === 'solid') {
        if (hit.solid.destructible) Game.terrain.damageSolid(hit.solid, w.damage);
        if (Game.effects.impactWall) Game.effects.impactWall(hit.point, null, s, hit.t);
        else Game.effects.impact(hit.point, 0xcccccc);
      } else if (hit.type === 'ground') {
        if (Game.effects.impactGround) Game.effects.impactGround(hit.point, s);
        else Game.effects.impact(hit.point, 0x8a7a5c);
      }
    }
    // 近失弹呼啸：AI 子弹命中玩家附近墙面/地面（ironhold 式"擦身而过"提示）
    if (!s.isPlayer && lastHit && (lastHit.type === 'solid' || lastHit.type === 'ground') &&
        Game.player && Game.player.alive && Game.sound.whizz) {
      const d = M.dist3(lastHit.point, { x: Game.player.pos.x, y: Game.player.pos.y + 1, z: Game.player.pos.z });
      if (d < 4.5 && Math.random() < 0.6) Game.sound.whizz();
    }
    // 连射扩散累积（度，cap spreadMax）
    s.spreadDeg = Math.min(w.spreadMax, s.spreadDeg + w.spreadPerShot);
    // 确定性 pattern 后坐：弹簧 kick（相机与弹道同源）
    const pat = getPattern(s, w);
    s.patternIdx = (s.patternIdx + 1) % (pat.length / 2);
    s.recoilPitch.kick(pat[s.patternIdx * 2]);
    s.recoilYaw.kick(pat[s.patternIdx * 2 + 1]);
    if (s.isPlayer) {
      // v5.43 重武器更明显震屏：狙击/霰弹/DMR 更有"重量感"
      let shakeAmt = w.recoilDef.pitch * 2.2 + 0.06;
      if (w.sound === 'shotgun') shakeAmt += 0.22;
      else if (w.sound === 'sniper') shakeAmt += 0.18;
      else if (w.sound === 'dmr') shakeAmt += 0.08;
      Game.effects.setShake(shakeAmt);
      Game.Player.onShotFired(w.recoilDef);
    }
    return true;
  }

  function startReload(s) {
    const slot = activeWeapon(s);
    if (!slot || s.reloading) return;
    if (slot.mag >= slot.def.mag || slot.reserve <= 0) return;
    s.reloading = true; s.reloadTimer = slot.def.reload;
    s.reloadPhase = 0;
    if (s.isPlayer) {
      if (Game.sound.reloadStart) Game.sound.reloadStart();
      else Game.sound.reload();
      if (Game.hud) Game.hud.showReload();
    }
  }

  function switchSlot(s, slot) {
    if (!s.slots[slot]) return;
    s.slot = slot; s.reloading = false; s.reloadPhase = 0; s.fireTimer = 0;
    s.spreadDeg = 0; s.patternIdx = -1;
    if (s.isPlayer && Game.hud) Game.hud.hideReload();
  }

  // ================= 伤害 / 击杀 =================
  function applyDamage(s, dmg, attacker, point, headshot, sourceName) {
    if (!s.alive || s.spawnProtect > 0) return;
    if (s.isPlayer && Game.godMode) return; // 调试：无敌
    const rawDmg = dmg;
    let shieldDrained = false;
    // v5.10 突击兵护盾：每 1 点伤害消耗 2 点护盾（120 护盾 ≈ 60 血），无法补充
    if (s.shield > 0) {
      const drain = Math.min(s.shield, dmg * CONFIG.SHIELD_DRAIN_RATE);
      s.shield -= drain;
      dmg -= drain / CONFIG.SHIELD_DRAIN_RATE;
      shieldDrained = true;
    }
    s.health -= dmg;
    s.lastHitBy = attacker;
    s.lastHurtTime = Game.time;
    s.lastHitDmg = rawDmg;   // 受击方向指示/红晕按伤害缩放
    // v5.23 准星跳伤害数字（玩家造成的伤害；护盾全吸则不显示）
    if (attacker && attacker.isPlayer && Game.hud && Game.hud.damagePop && dmg > 0) {
      Game.hud.damagePop(dmg, headshot ? '#ffd75e' : '#ffe9a8');
    }
    if (Game.__dmgDebug) Game.__dmgDebug.push({ v: s.id, d: Math.round(dmg * 10) / 10, a: attacker ? attacker.id : -1, t: +Game.time.toFixed(2) });
    // v5.12 助攻追踪：记录近期伤害来源
    if (attacker && attacker !== s) {
      if (!s.recentDamage) s.recentDamage = {};
      const r = s.recentDamage[attacker.id];
      if (r) { r.amount += dmg; r.t = Game.time; }
      else s.recentDamage[attacker.id] = { amount: dmg, t: Game.time };
    }
    if (point) Game.effects.impact(point, 0xd03030);
    // v5.43 被打击感：红晕随伤害缩放 + 受击音效 + 护盾电流 + 镜头 Flinch + 硬直减速
    if (s.isPlayer) {
      if (Game.hud) Game.hud.flashDamage(rawDmg);
      if (Game.sound) {
        if (shieldDrained && Game.sound.shieldHit) Game.sound.shieldHit();
        if (Game.sound.hurt) Game.sound.hurt(rawDmg);
        if (rawDmg >= 60 && Game.sound.tinnitus) Game.sound.tinnitus(rawDmg);
      }
      if (Game.Player && Game.Player.flinch) Game.Player.flinch(rawDmg, point);
      Game.effects.addShake(Math.min(0.9, 0.3 + rawDmg / 90));   // 受击震屏随伤害缩放
      if (rawDmg >= 60 && Game.hitStop) Game.hitStop(0.05, 0.4); // 大伤害短暂硬直
    }
    if (s.isPlayer && attacker) {
      const dx = attacker.pos.x - s.pos.x, dz = attacker.pos.z - s.pos.z;
      s.lastHitYaw = Math.atan2(-dx, -dz); // 面对攻击者的朝向
      s.lastHitTime = Game.time;
    }
    if (s.bot) s.bot.alert = Game.time;
    if (s.health <= 0) kill(s, attacker, headshot, sourceName);
  }

  function kill(s, attacker, headshot, sourceName) {
    if (!s.alive) return;
    s.alive = false;
    s.deaths++;
    s.streak = 0; s.multikill = 0;   // v5.32 阵亡重置连杀/多杀（上条命的击杀不算数）
    // 兵力扣除
    if (s.team === TEAM_RED) Game.ticketsRed = Math.max(0, Game.ticketsRed - CONFIG.BLEED_PER_DEATH);
    else Game.ticketsBlue = Math.max(0, Game.ticketsBlue - CONFIG.BLEED_PER_DEATH);
    // v5.12 击杀奖励（战地式：基础 + 复仇/防守/进攻/爆头/连杀加成）
    let gained = 0;
    const badges = [];
    if (attacker && attacker.team !== s.team) {
      attacker.kills++; attacker.streak++;
      gained = 100;
      if (attacker.lastKiller === s) { gained += 50; badges.push('复仇 +50'); }
      for (const f of Game.flags) {
        if (f.owner === attacker.team && M.dist2(s.pos.x, s.pos.z, f.x, f.z) < 30) {
          gained += 50; badges.push('防守击杀 +50');
          break;
        }
      }
      // v5.18 进攻击杀：受害者在敌方占领点 30m 内（攻势中击杀守军）
      for (const f of Game.flags) {
        if (f.owner === s.team && M.dist2(s.pos.x, s.pos.z, f.x, f.z) < 30) {
          gained += 50; badges.push('进攻击杀 +50');
          break;
        }
      }
      if (headshot) { gained += 25; badges.push('爆头 +25'); }
      if (attacker.streak >= 3 && attacker.streak % 3 === 0) { gained += 50; badges.push('连杀 +50'); }
      attacker.score += gained;
      // 多杀判定（3 秒内连续击杀 → 双杀/三杀…）
      const now = Game.time;
      attacker.multikill = (now - attacker.lastKillTime < 3) ? ((attacker.multikill || 0) + 1) : 1;
      attacker.lastKillTime = now;
      // 助攻：8 秒内造成伤害的队友（≥40 伤害 = 助攻 +50；否则 = 火力压制 +25）
      if (s.recentDamage) {
        for (const id in s.recentDamage) {
          const r = s.recentDamage[id];
          if (r && Game.time - r.t < 8 && r.amount > 0 && Number(id) !== attacker.id) {
            const helper = Game.soldiers[Number(id)];
            if (helper && helper.alive && helper.team === attacker.team) {
              if (r.amount >= 40) {
                helper.score += 50; helper.assists = (helper.assists || 0) + 1;
                if (helper.isPlayer && Game.hud) Game.hud.merit('assist', 50);
              } else {
                helper.score += 25;   // v5.18 火力压制助攻
                if (helper.isPlayer && Game.hud) Game.hud.merit('suppress', 25);
              }
            }
          }
        }
        s.recentDamage = null;
      }
      if (attacker.isPlayer) {
        Game.stats.kills++;
        Game.stats.bestStreak = Math.max(Game.stats.bestStreak, attacker.streak);
        Game.sound.kill();
        if (Game.hud) Game.hud.hitmarker(true, headshot);
        if (Game.hitStop) Game.hitStop(0.09, 0.05);   // v5.43 击杀顿帧
        if (Game.hud) Game.hud.popup('+' + gained, { x: s.pos.x, y: s.pos.y + 2, z: s.pos.z }, '#ffd27a');
        if (Game.hud) {
          // v5.18 功绩播报（只播玩家本人）
          Game.hud.merit('kill', 100);
          for (const b of badges) {
            if (b === '复仇 +50') Game.hud.merit('revenge', 50);
            else if (b === '防守击杀 +50') Game.hud.merit('defense', 50);
            else if (b === '进攻击杀 +50') Game.hud.merit('attack', 50);
            else if (b === '爆头 +25') Game.hud.merit('headshot', 25);
            else if (b === '连杀 +50') Game.hud.merit('streak', 50);
          }
        }
        if (attacker.multikill >= 2) {
          // v5.22 多杀功绩：替代原 CF 式播报横幅（双杀 +25 / 三杀 +50 / …）
          const mk = Math.min(attacker.multikill, 7);
          const mLabel = Game.t('multi.' + (mk < 2 ? 2 : mk));
          const mBonus = 25 * (attacker.multikill - 1);
          attacker.score += mBonus;
          Game.hud.merit('multi', mBonus, mLabel);
        } else if (attacker.streak >= 3 && attacker.streak % 3 === 0) {
          Game.hud.message(Game.t('streak.msg', attacker.streak));
        }
      }
    }
    s.lastKiller = attacker;   // v5.12 复仇追踪
    // v5.47 侦察助攻：被标记敌人被击杀，标记者得助攻（非击杀者、同阵营）
    if (attacker && s.spottedBy && s.spottedBy !== attacker && s.spottedBy.alive && s.spottedBy.team === attacker.team) {
      s.spottedBy.score += 25;
      if (s.spottedBy.isPlayer && Game.hud) Game.hud.merit('spotAssist', 25);
    }
    if (s.isPlayer) {
      Game.stats.deaths++;
      if (Game.Player.setMortarDeployed) Game.Player.setMortarDeployed(false);   // 阵亡收起迫击炮
      if (Game.Player.resetAds) Game.Player.resetAds();   // v5.40 开镜阵亡：复位 FOV + 开镜态
    }
    // 击杀播报（CF 式横幅）；装备槽击杀用装备名，防 activeWeapon 为空闪退
    // v5.14 sourceName（如「载具碾压」）优先，用于非武器致死
    let weaponName = sourceName || '环境';
    if (attacker && !sourceName) {
      const w = activeWeapon(attacker);
      if (w) weaponName = w.def.name;
      else if (attacker.slot === 'gadget' && GADGETS[attacker.gadget]) weaponName = GADGETS[attacker.gadget].name;
    }
    // v5.22 数据保留（测试/统计用），UI 播报已由功绩系统替代
    Game.killfeed.push({
      killer: attacker ? attacker : null, victim: s,
      weapon: weaponName,
      headshot: !!headshot,
      time: Game.time,
      score: (attacker && attacker.team !== s.team) ? gained : 0,
      badges: (attacker && attacker.team !== s.team) ? badges : [],
    });
    if (Game.killfeed.length > 6) Game.killfeed.shift();
    // 击杀音效（多杀/本人击杀/本人阵亡；他人击杀不再有任何播报）
    if (Game.sound) {
      if (attacker && attacker.isPlayer && attacker.multikill >= 2) Game.sound.multi();
      else if (attacker && attacker.isPlayer) Game.sound.killBanner(!!headshot);
      else if (s.isPlayer) Game.sound.death();
    }
    // 尸体（v4：BOT 为实例化渲染，倒地姿态由 ai.js 实例矩阵处理）
    if (!s.isPlayer) s.corpseT = 0;
    else if (s.group) { s.corpseGroup = s.group; s.group = null; s.corpseT = 0; }
    // 若在载具内，弹出
    if (s.ridingVehicle && Game.Vehicles) Game.Vehicles.exit(s);
    // 死亡粒子
    if (s.pos) {
      const c = s.team === TEAM_RED ? 0xe04a3e : 0x3e7ae0;
      Game.effects.emit(s.pos.x, s.pos.y + 1, s.pos.z, c, 14, 6, 0.8, 0.2, 14, 1);
    }
  }

  // ================= 范围伤害 =================
  function areaDamage(pos, radius, dmg, attacker, source, antiVehicle) {
    // v5.10 反甲弹药（RPG/火箭）：对步兵溅射小（×0.35）、对载具高伤（×2）
    const vsInf = antiVehicle ? 0.35 : 1;
    const vsVeh = antiVehicle ? 2.0 : 1;
    for (const s of Game.soldiers) {
      if (!s.alive || s.spawnProtect > 0) continue;
      if (s.ridingVehicle) continue;   // 乘员由载具装甲保护，伤害打在载具上
      if (attacker && s.team === attacker.team) continue;
      const d = M.dist3(pos, { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z });
      if (d < radius) {
        applyDamage(s, dmg * vsInf * (1 - d / radius), attacker, { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z });
        // v5.16 反炮击预警：我方士兵被敌方迫击炮命中 → 小地图高亮敌方迫击炮手（无视视野）
        // v5.26 同时全局暴露炮手（双方 AI 迫击炮反打情报源）
        if (source === 'mortarShell' && attacker && attacker.clsKey === 'mortar') {
          attacker.spottedUntil = Math.max(attacker.spottedUntil || 0, Game.time + CONFIG.MORTAR_REVEAL_TIME);
        }
        if (source === 'mortarShell' && attacker && s.team === Game.player.team &&
            attacker.team !== Game.player.team && Game.hud && Game.hud.revealMortar) {
          Game.hud.revealMortar(attacker);
        }
      }
    }
    for (const v of Game.vehicles) {
      if (!v.alive) continue;
      if (attacker && v.team === attacker.team) continue;
      const d = M.dist3(pos, v.pos);
      if (d < radius + v.hitRadius) damageVehicle(v, dmg * vsVeh * (1 - d / (radius + v.hitRadius)), attacker);
    }
    // 可破坏实体（含多级建筑，v4：大建筑进爆炸伤害管线）
    for (const d of Game.terrain.solids) {
      if (!d.solid || !d.destructible) continue;
      const dd = M.dist3(pos, { x: d.cx, y: d.baseH + d.h / 2, z: d.cz });
      if (dd < radius + 2) Game.terrain.damageSolid(d, dmg * (1 - dd / (radius + 2)));
    }
  }

  // v5 克制环：伤害类型 × 载具装甲类型倍率
  // smallarms（枪械）：heavy 0 / light 0.35 / air 0.8
  // aa（防空炮）：air 3.0 / heavy 0.15 / light 0.5
  // 其他（爆炸/火箭/炮弹）：原伤害（火箭 4×320=1280 > 坦克 1000 可单拆）
  function damageVehicle(v, dmg, attacker, dmgType, wdef) {
    if (!v.alive) return;
    let final = dmg;
    const kind = v.kind;
    if (dmgType === 'smallarms') {
      // v5.34 枪械对载具分级减伤：
      //  - 主战坦克（重甲）：免疫枪械，仅栓动狙击可穿透（80% 减伤 → 20%）
      //  - 装甲车（轻甲）：60% 减伤 → 40% 伤害
      //  - 防空车（轻甲）：55% 减伤 → 45%
      //  - 直升机（航空器）：30% 减伤 → 70%
      const isBolt = wdef && wdef.type === 'bolt';
      if (kind === 'tank') final = isBolt ? dmg * 0.2 : 0;
      else if (kind === 'apc') final = dmg * 0.4;
      else if (kind === 'aa') final = dmg * 0.45;
      else if (kind === 'heli' || kind === 'jet') final = dmg * 0.7;
    } else if (dmgType === 'aa') {
      if (kind === 'heli') final = dmg * 3.0;          // 直升机：专治
      else if (kind === 'jet') final = dmg * 1.5;      // 喷气机：快目标，伤害折减 + 瞄准噪声
      else if (kind === 'tank') final = dmg * 0.15;
      else final = dmg * 0.5;
    }
    v.hp -= final;
    v.lastHitBy = attacker;
    // v5.47 载具助攻追踪：记录近期伤害来源
    if (attacker && final > 0) {
      if (!v.recentDamage) v.recentDamage = {};
      const r = v.recentDamage[attacker.id];
      if (r) { r.amount += final; r.t = Game.time; }
      else v.recentDamage[attacker.id] = { amount: final, t: Game.time };
    }
    // v5.23 准星跳伤害数字（玩家对载具造成伤害）
    if (attacker && attacker.isPlayer && Game.hud && Game.hud.damagePop && final > 0) {
      Game.hud.damagePop(final, '#ffd27a');
    }
    if (v.occupant && v.occupant.isPlayer && Game.hud) Game.hud.flashDamage();
    if (v.hp <= 0) destroyVehicle(v, attacker);
  }

  function destroyVehicle(v, attacker) {
    if (!v.alive) return;
    v.alive = false; v.hp = 0;
    // v5.12 做事加分：载具摧毁
    if (attacker && attacker.team !== v.team) {
      attacker.score += 150;
      if (attacker.isPlayer && Game.hud) Game.hud.merit('vehicle', 150);   // v5.18 功绩
    }
    // v5.47 载具助攻：8 秒内造成伤害的队友（非击杀者）各得助攻
    if (v.recentDamage) {
      for (const id in v.recentDamage) {
        const r = v.recentDamage[id];
        if (r && Game.time - r.t < 8 && r.amount >= 50 && Number(id) !== (attacker ? attacker.id : -1)) {
          const helper = Game.soldiers[Number(id)];
          if (helper && helper.alive && helper.team === (attacker ? attacker.team : -1)) {
            helper.score += 30;
            if (helper.isPlayer && Game.hud) Game.hud.merit('vehicleAssist', 30);
          }
        }
      }
      v.recentDamage = null;
    }
    // 爆炸
    Game.effects.explosion({ x: v.pos.x, y: v.pos.y + 1, z: v.pos.z }, 9, true);
    Game.sound.explosion(true, Game.audio.distanceVol(v.pos), v.pos);
    areaDamage({ x: v.pos.x, y: v.pos.y + 1, z: v.pos.z }, 12, 240, attacker, 'vehicle');
    // 乘客处理（司机 + 机枪手都弹出；司机是玩家时先正常下车，否则引擎音残留）
    if (v.occupant) {
      const occ = v.occupant;
      if (occ.isPlayer) {
        // v5.41 修复：先正常下车（exit 内部 engineStop 停止引擎音），
        // 旧代码先清空 occ.ridingVehicle 再 exit → exit 提前 return，直升机噪音一直残留
        Game.Vehicles.exit(occ);
        if (Game.hud) Game.hud.message(Game.t('msg.vehicleDestroyed'));
      } else {
        v.occupant = null;
        occ.ridingVehicle = null; occ.vehicleSeat = -1;
        occ.pos = { x: v.pos.x + (Math.random() - 0.5) * 4, y: Game.heightAt(v.pos.x, v.pos.z), z: v.pos.z + (Math.random() - 0.5) * 4 };
        occ.vel = { x: 0, y: 0, z: 0 };
        if (occ.group) occ.group.visible = true;
        applyDamage(occ, 60, attacker, occ.pos);   // AI 乘客重伤
      }
    }
    if (v.gunner) {
      const g = v.gunner;
      if (g.isPlayer) {
        Game.Vehicles.exit(g);   // v5.41 机枪手也一并弹出，防卡在已毁载具上
      } else {
        v.gunner = null;
        g.ridingVehicle = null; g.vehicleSeat = -1;
        g.pos = { x: v.pos.x + (Math.random() - 0.5) * 4, y: Game.heightAt(v.pos.x, v.pos.z), z: v.pos.z + (Math.random() - 0.5) * 4 };
        g.vel = { x: 0, y: 0, z: 0 };
        if (g.group) g.group.visible = true;
        applyDamage(g, 60, attacker, g.pos);
      }
    }
    // 隐藏载具 + 残骸粒子
    if (v.group) { v.group.visible = false; }
    Game.effects.emit(v.pos.x, v.pos.y + 1, v.pos.z, 0x333333, 30, 10, 1.4, 0.3, 22, 1);
  }

  // ================= 弹道（手雷/榴弹/火箭/炮弹/信号弹/导弹） =================
  function spawnProjectile(kind, pos, vel, owner, opts) {
    const p = {
      kind, pos: { x: pos.x, y: pos.y, z: pos.z }, vel: { x: vel.x, y: vel.y, z: vel.z },
      gravity: opts.gravity || 0, radius: opts.radius || 1,
      damage: opts.damage || 0, fuse: opts.fuse || 0,
      bounce: !!opts.bounce, antiVehicle: !!opts.antiVehicle,
      homing: opts.homing || null, turnRate: opts.turnRate || 5,
      owner, team: owner ? owner.team : -1, life: 0,
    };
    const col = kind === 'grenade' ? 0x1a1a1a : kind === 'flare' ? 0xffffff : kind === 'mortarShell' ? 0x1a1a1a : 0xffcc66;
    const g = kind === 'missile'
      ? new THREE.ConeGeometry(0.14, 0.7, 6)
      : new THREE.SphereGeometry(kind === 'grenade' ? 0.14 : 0.18, 6, 6);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col }));
    m.position.set(p.pos.x, p.pos.y, p.pos.z);
    if (kind === 'missile') {
      // 导弹头朝飞行方向
      const len = Math.hypot(vel.x, vel.y, vel.z) || 1;
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(vel.x / len, vel.y / len, vel.z / len));
    }
    Game.scene.add(m);
    p.mesh = m;
    Game.projectiles.push(p);
    return p;
  }

  // v5.38 烟雾弹：投掷 → 引信后生成烟墙（遮挡视线/AI 索敌，无伤害）
  function throwSmoke(s) {
    if (!s.alive || s.smoke <= 0) return;
    s.smoke--;
    const eye = getEyePos(s);
    const { f } = aimVectors(s);
    spawnProjectile('smoke', eye,
      { x: f.x * SMOKE.speed + s.vel.x * 0.5, y: f.y * SMOKE.speed + 6, z: f.z * SMOKE.speed + s.vel.z * 0.5 },
      s, { gravity: SMOKE.gravity, fuse: SMOKE.fuse, bounce: true });
    if (s.isPlayer && Game.hud) Game.hud.message(Game.t('msg.smokeThrown'));
  }
  function throwGrenade(s) {
    if (s.grenades <= 0) return;
    s.grenades--;
    const eye = getEyePos(s);
    const { f } = aimVectors(s);
    spawnProjectile('grenade', eye,
      { x: f.x * GRENADE.speed + s.vel.x * 0.5, y: f.y * GRENADE.speed + 7, z: f.z * GRENADE.speed + s.vel.z * 0.5 },
      s, { gravity: GRENADE.gravity, radius: GRENADE.radius, damage: GRENADE.damage, fuse: GRENADE.fuse, bounce: true });
    if (s.isPlayer && Game.sound.pinPull) Game.sound.pinPull();   // v5.47 拉安全栓清脆音效（替代投掷音）
    if (s.isPlayer && Game.hud) Game.hud.message(Game.t('msg.grenadeThrown'));
  }

  function fireGadget(s) {
    const g = GADGETS[s.gadget];
    if (!g) return;
    if (s.gadgetCooldown > 0) return;
    const eye = getEyePos(s);
    const { f } = aimVectors(s);
    if (g.kind === 'projectile') {
      if (s.gadgetAmmo <= 0) { if (s.isPlayer && Game.hud) Game.hud.message(Game.t('msg.gadgetEmpty')); return; }
      s.gadgetAmmo--;
      s.gadgetCooldown = g.reload || 0; // 装填时间（AI 与玩家一致）
      s.gadgetCdMax = g.reload || 0;    // v5.10 装填读条基准
      spawnProjectile(s.gadget, eye,
        { x: f.x * g.speed, y: f.y * g.speed + 2, z: f.z * g.speed },
        s, { gravity: g.gravity, radius: g.radius, damage: g.damage, fuse: g.fuse, antiVehicle: g.antiVehicle });
      Game.sound.shot('pistol', s.isPlayer ? 1 : Game.audio.distanceVol(eye), s.isPlayer ? null : eye);
    } else if (g.kind === 'instant') {
      // v5.31 弹药箱：放地上持续补给（一人一个，放新的旧的销毁）
      s.gadgetCooldown = s.gadgetCdMax;
      placeSupplyBox(s, 'ammo');
      if (s.isPlayer) Game.hud.message(Game.t('msg.ammoDeployed'));
    } else if (g.kind === 'flare') {
      s.gadgetCooldown = s.gadgetCdMax;
      spawnProjectile('flare', eye,
        { x: f.x * 30, y: f.y * 30 + 6, z: f.z * 30 },
        s, { gravity: 18, radius: CONFIG.SPOT_RADIUS, damage: 0, fuse: 1.4 });
      Game.sound.shot('pistol', s.isPlayer ? 1 : Game.audio.distanceVol(eye), s.isPlayer ? null : eye);
    } else if (g.kind === 'mortar') {
      // v5.7：玩家按扳机 = 部署/收起（部署后右下地图选点，见 fireMortarAt）；
      // AI 用 bot.mortarTarget 直接指定落点
      if (s.bot && s.bot.mortarTarget) {
        const t = s.bot.mortarTarget; s.bot.mortarTarget = null;
        fireMortarAt(s, t.x, t.z);
      } else if (s.isPlayer) {
        Game.Player.setMortarDeployed(!Game.Player.mortarDeployed);
      }
    } else if (g.kind === 'medic') {
      // v5.31 医疗箱：放地上持续治疗（自己 + 附近队友），无救援系统（阵亡立即重生）
      s.gadgetCooldown = s.gadgetCdMax || g.cooldown || 3;
      s.gadgetCdMax = s.gadgetCooldown;   // v5.10 装填读条基准
      placeSupplyBox(s, 'medic');
      if (Game.effects) Game.effects.emit(s.pos.x, s.pos.y + 1, s.pos.z, 0x6ad06a, 14, 4, 0.7, 0.16, 10, 1);
      if (Game.sound.heal) Game.sound.heal();
      if (s.isPlayer && Game.hud) Game.hud.message(Game.t('msg.medkitDeployed'));
    }
  }

  // v5.10 医疗兵呼吸回血（脱战 N 秒后缓慢回血，无法回护盾）
  function updateMedicRegen(dt) {
    for (const s of Game.soldiers) {
      if (!s.alive || s.clsKey !== 'medic') continue;
      if (s.health >= s.maxHealth) continue;
      const since = Game.time - (s.lastHurtTime === undefined ? -999 : s.lastHurtTime);
      if (since > CONFIG.MEDIC_REGEN_DELAY) {
        s.health = Math.min(s.maxHealth, s.health + CONFIG.MEDIC_REGEN_RATE * dt);
      }
    }
  }
  // 突击兵护盾初始化（重生/部署重置；无法补充）
  function initShield(s) {
    s.shield = s.clsKey === 'assault' ? CONFIG.ASSAULT_SHIELD : 0;
  }

  // ================= v5.12/v5.19 侦察：Q 键标记准星附近目标（步兵/载具） =================
  // v5.19：步兵不再高亮（仅小地图红点 + 功绩）；载具可标记且高亮可隔墙透视
  function trySpot(s) {
    if (!s || !s.alive) return;
    if ((s.spotCooldown || -1) > Game.time) return;
    const eye = getEyePos(s);
    const { f } = aimVectors(s);
    let best = null, bestAng = CONFIG.SPOT_ANGLE * Math.PI / 180;
    for (const t of Game.soldiers) {
      if (!t.alive || t.team === s.team || t.ridingVehicle) continue;
      const dx = t.pos.x - eye.x, dy = (t.pos.y + 1) - eye.y, dz = t.pos.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > CONFIG.SPOT_RANGE) continue;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / (d || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (ang < bestAng) { bestAng = ang; best = { type: 'soldier', obj: t }; }
    }
    // v5.19 载具标记（锥角内最近者优先，仍需视线）
    for (const v of Game.vehicles) {
      if (!v.alive || v.team === s.team) continue;
      const dx = v.pos.x - eye.x, dy = (v.pos.y + v.hitRadius * 0.5) - eye.y, dz = v.pos.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > CONFIG.SPOT_RANGE) continue;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / (d || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (ang < bestAng) { bestAng = ang; best = { type: 'vehicle', obj: v }; }
    }
    if (!best) {
      if (s.isPlayer && Game.hud) Game.hud.message(Game.t('msg.noTarget'));
      return;
    }
    const o = best.obj;
    const ty = best.type === 'vehicle' ? (o.pos.y + o.hitRadius * 0.5) : (o.pos.y + 1);
    if (Game.terrain.blocksLOS(eye.x, eye.y, eye.z, o.pos.x, ty, o.pos.z)) {
      if (s.isPlayer && Game.hud) Game.hud.message(Game.t('msg.spotBlocked'));
      return;
    }
    const first = !(o.spottedUntil > Game.time);
    o.spottedUntil = Game.time + CONFIG.SPOT_TIME;
    o.spottedBy = s;   // v5.47 侦察助攻追踪：记录标记者
    s.spotCooldown = Game.time + CONFIG.SPOT_COOLDOWN;
    if (first) {
      s.score += CONFIG.SPOT_SCORE;
      // v5.19 不再于上方提示「标记成功」，只进功绩系统
      if (s.isPlayer && Game.hud) Game.hud.merit('spot', CONFIG.SPOT_SCORE);
    }
  }

  // ================= v5.7 迫击炮：按世界坐标选点发射 =================
  // 返回 'ok' | 'too-close' | 'too-far' | 'no-ammo' | 'cooling'（供地图 UI 提示）
  function fireMortarAt(s, tx, tz) {
    const g = GADGETS[s.gadget];
    if (!g || g.kind !== 'mortar') return 'no-mortar';
    if (s.gadgetAmmo <= 0) return 'no-ammo';
    if (s.gadgetCooldown > 0) return 'cooling';
    const eye = getEyePos(s);
    const d = M.dist2(eye.x, eye.z, tx, tz);
    const minR = g.minRange || 40, maxR = g.maxRange || 180;
    if (d < minR - 1) return 'too-close';
    if (d > maxR + 2) return 'too-far';
    s.gadgetAmmo--;
    s.gadgetCooldown = g.reload || 4.5;
    s.gadgetCdMax = g.reload || 4.5;   // v5.10 装填读条基准
    // 高抛弹道：固定重力 24，飞行时间随距离（1.8~4.5 秒弧线）
    const T = M.clamp(d / 34, 1.8, 4.5);
    const grav = 24;
    const tgtY = Game.heightAt(tx, tz);
    const proj = spawnProjectile('mortarShell', { x: eye.x, y: eye.y + 0.4, z: eye.z },
      {
        x: (tx - eye.x) / T,
        y: (tgtY - eye.y + 0.5 * grav * T * T) / T,   // 精确弹道解：T 秒后恰好落在目标点（此前 +1.5 余量导致落点偏移 ~10m）
        z: (tz - eye.z) / T,
      },
      s, { gravity: grav, radius: g.radius || 12, damage: g.damage || 300, fuse: 0, antiVehicle: g.antiVehicle });
    // v5.13 玩家发射后：镜头切到炮弹第一人称跟随视角（随弹运动，始终朝向落点）
    if (s.isPlayer && Game.Player && Game.Player.startMortarCam) Game.Player.startMortarCam(proj, tx, tz, tgtY);
    // v5.8 出膛轰鸣（低沉管口声，距离衰减）
    Game.sound.mortarLaunch(s.isPlayer ? 1 : Game.audio.distanceVol(eye));
    // v5.26 开火自动暴露：敌方反迫击炮/小地图特殊标记的信息源
    s.spottedUntil = Game.time + CONFIG.SPOTTED_TIME;
    return 'ok';
  }

  function refillAmmo(s) {
    for (const k in s.slots) {
      s.slots[k].mag = s.slots[k].def.mag;
      s.slots[k].reserve = s.slots[k].def.reserve;
    }
    s.grenades = GRENADE.ammo;
    s.smoke = SMOKE.ammo;   // v5.38 烟雾弹补给
    const g = GADGETS[s.gadget];
    if (g && g.ammo > 0) s.gadgetAmmo = g.ammo;
  }
  // ================= v5.31 地面补给箱：持续治疗/补给，一人一个 =================
  function destroySupplyBox(box) {
    if (box.mesh) {
      Game.scene.remove(box.mesh);
      box.mesh.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    var i = Game.supplyBoxes.indexOf(box);
    if (i >= 0) Game.supplyBoxes.splice(i, 1);
  }
  function placeSupplyBox(s, kind) {
    // 一人一个：放新的旧的立刻销毁
    for (var i = Game.supplyBoxes.length - 1; i >= 0; i--) {
      if (Game.supplyBoxes[i].owner === s) destroySupplyBox(Game.supplyBoxes[i]);
    }
    var g = GADGETS[kind === 'medic' ? 'medkit' : 'ammo'];
    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.42, 0.42),
      new THREE.MeshStandardMaterial({ color: kind === 'medic' ? 0xd8d8d8 : 0x4a4a3a, roughness: 0.6, metalness: 0.3 }));
    var crossM = new THREE.MeshBasicMaterial({ color: kind === 'medic' ? 0xff5050 : 0xffcc66 });
    var top = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.09), crossM);
    top.position.y = 0.23;
    var top2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.34), crossM);
    top2.position.y = 0.23;
    mesh.add(top); mesh.add(top2);
    mesh.position.set(s.pos.x, Game.heightAt(s.pos.x, s.pos.z) + 0.22, s.pos.z);
    Game.scene.add(mesh);
    var box = {
      kind: kind, owner: s, mesh: mesh,
      x: s.pos.x, z: s.pos.z,
      radius: kind === 'medic' ? (g.healRadius || 8) : 14,
      tick: 0, until: Game.time + 60, pending: 0, lastMeritT: -99,
    };
    Game.supplyBoxes.push(box);
    return box;
  }
  function updateSupplyBoxes(dt) {
    if (!Game.supplyBoxes) return;
    for (var i = Game.supplyBoxes.length - 1; i >= 0; i--) {
      var b = Game.supplyBoxes[i];
      if (Game.time > b.until) { destroySupplyBox(b); continue; }
      b.tick -= dt;
      if (b.tick > 0) continue;
      b.tick = b.kind === 'medic' ? 0.6 : 1.0;
      var n = 0;
      for (var ti = 0; ti < Game.soldiers.length; ti++) {
        var t = Game.soldiers[ti];
        if (!t.alive || t.team !== b.owner.team) continue;
        if (M.dist2(t.pos.x, t.pos.z, b.x, b.z) > b.radius) continue;
        if (b.kind === 'medic') {
          if (t.health >= t.maxHealth) continue;
          t.health = Math.min(t.maxHealth, t.health + 4);
          n++;
        } else {
          var supplied = false;
          for (var k2 in t.slots) {
            var sl = t.slots[k2];
            if (sl.mag < sl.def.mag) { sl.mag = Math.min(sl.def.mag, sl.mag + 4); supplied = true; }
            if (sl.reserve < sl.def.reserve) { sl.reserve = Math.min(sl.def.reserve, sl.reserve + 10); supplied = true; }
          }
          if (t.grenades < GRENADE.ammo) { t.grenades = Math.min(GRENADE.ammo, t.grenades + 1); supplied = true; }
          if (supplied) n++;
        }
      }
      if (n > 0) {
        var pts = b.kind === 'medic' ? 4 : 3;
        b.owner.score += pts * n;
        b.pending += pts * n;
        if (b.owner.isPlayer && Game.time - b.lastMeritT > 2.5 && Game.hud) {
          Game.hud.merit(b.kind === 'medic' ? 'heal' : 'ammo', b.pending);
          b.lastMeritT = Game.time;
          b.pending = 0;
        }
      }
    }
  }


  function updateProjectiles(dt) {
    for (let i = Game.projectiles.length - 1; i >= 0; i--) {
      const p = Game.projectiles[i];
      p.life += dt;
      const prev = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      p.vel.y -= p.gravity * dt;
      // v5.8 迫击炮弹过顶点后：下落呼啸（按弹体位置距离衰减）
      if (p.kind === 'mortarShell' && !p._whistled && p.vel.y < -6) {
        p._whistled = true;
        if (Game.sound.mortarWhistle) Game.sound.mortarWhistle(Game.audio.distanceVol(p.pos));
      }
      p.pos.x += p.vel.x * dt; p.pos.y += p.vel.y * dt; p.pos.z += p.vel.z * dt;
      if (p.mesh) {
        p.mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
        if (p.kind === 'missile') {
          const len = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
          p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(p.vel.x / len, p.vel.y / len, p.vel.z / len));
        }
      }
      // v5.46 迫击炮黑色尾迹（每隔一小段喷黑烟）
      if (p.kind === 'mortarShell') {
        p._trailT = (p._trailT || 0) - dt;
        if (p._trailT <= 0) {
          p._trailT = 0.05;
          Game.effects.emit(p.pos.x, p.pos.y, p.pos.z, 0x1a1a1a, 2, 0.8, 0.5, 0.1, 1, 1);
        }
      }
      let boom = false;
      if (p.fuse > 0 && p.life >= p.fuse) boom = true;
      const ground = Game.heightAt(p.pos.x, p.pos.z);
      if (p.bounce) {
        if (p.pos.y < ground + 0.12) { p.pos.y = ground + 0.12; p.vel.y = -p.vel.y * 0.35; p.vel.x *= 0.7; p.vel.z *= 0.7; }
      } else if (p.pos.y < ground + 0.2) boom = true;
      // 实体命中（分段检测防穿墙）
      if (!boom) {
        const len = M.dist3(prev, p.pos);
        if (len > 0.001) {
          const d = { x: (p.pos.x - prev.x) / len, y: (p.pos.y - prev.y) / len, z: (p.pos.z - prev.z) / len };
          const h = Game.terrain.raySolid(prev, d, len);
          if (h) boom = true;
        }
      }
      // 目标命中（直接命中才引爆，溅射由爆炸范围负责）
      if (!boom) {
        for (const v of Game.vehicles) {
          if (!v.alive || v.team === p.team) continue;
          if (M.dist3(p.pos, v.pos) < v.hitRadius + 1.0) { boom = true; break; }
        }
      }
      if (!boom) {
        for (const s of Game.soldiers) {
          if (!s.alive || s.team === p.team || s.ridingVehicle) continue;
          if (M.dist3(p.pos, { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z }) < 1.2) { boom = true; break; }
        }
      }
      if (boom) {
        detonate(p);
        Game.projectiles.splice(i, 1);
      } else if (p.life > 20) {
        if (p.mesh) { Game.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
        Game.projectiles.splice(i, 1);
      }
    }
  }

  function detonate(p) {
    const pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    if (Game.__boomDebug) Game.__boomDebug.push({ k: p.kind, x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(1), z: +p.pos.z.toFixed(1), t: +Game.time.toFixed(2) });
    if (p.mesh) { Game.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    if (p.kind === 'smoke') {
      // v5.38 烟雾弹：生成烟墙（无伤害，遮挡视线）
      if (Game.effects && Game.effects.spawnSmoke) Game.effects.spawnSmoke(pos, SMOKE.radius, SMOKE.duration);
      return;
    }
    if (p.kind === 'flare') {
      // 侦察信号弹：标记半径内敌人
      Game.effects.explosion(pos, 4, false);
      Game.sound.explosion(false);
      const now = Game.time;
      for (const s of Game.soldiers) {
        if (s.team === p.team || !s.alive) continue;
        if (M.dist3(pos, { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z }) < CONFIG.SPOT_RADIUS) {
          s.spottedUntil = now + CONFIG.FLARE_SPOT_TIME;
        }
      }
      if (p.owner && p.owner.isPlayer && Game.hud) Game.hud.message(Game.t('msg.spotted'));
      return;
    }
    const big = p.damage >= 200;
    Game.effects.explosion(pos, p.radius, big);
    Game.sound.explosion(big, Game.audio.distanceVol(pos), pos);
    // v5.28 氛围：近距爆炸全屏暖光一闪（玩家 45m 内）
    if (Game.player && Game.hud && Game.hud.explosionFlash &&
        M.dist3(pos, { x: Game.player.pos.x, y: Game.player.pos.y + 1, z: Game.player.pos.z }) < 45) {
      Game.hud.explosionFlash(big ? 0.38 : 0.2);
    }
    areaDamage(pos, p.radius, p.damage, p.owner, p.kind, p.antiVehicle);
  }

  // ================= 每帧更新 =================
  function update(dt) {
    for (const s of Game.soldiers) {
      if (!s.alive) continue;
      if (s.fireTimer > 0) s.fireTimer -= dt;
      if (s.boltT > 0) s.boltT = Math.max(0, s.boltT - dt);   // v5.17 拉栓计时
      if (s.dryFireT > 0) s.dryFireT -= dt;
      s.lastFireAge += dt;
      if (s.lastFireAge > 0.6) s.patternIdx = -1; // 停火后重置后坐序列（下一发按首发 kick）
      // 连射扩散恢复（度/秒，开镜恢复加速；装备槽无 activeWeapon 时跳过）
      if (s.spreadDeg > 0) {
        const w = activeWeapon(s);
        if (w) {
          const adsEase = s.isPlayer ? (Game.Player.adsEase || 0) : 0;
          s.spreadDeg = Math.max(0, s.spreadDeg - w.def.spreadDecay * dt * (1 + adsEase));
        }
      }
      // 后坐弹簧（快回位 + 慢残差）
      if (s.recoilPitch) { s.recoilPitch.step(dt); s.recoilYaw.step(dt); }
      if (s.gadgetCooldown > 0) s.gadgetCooldown -= dt;
      if (s.spawnProtect > 0) s.spawnProtect -= dt;
      if (s.reloading) {
        const slot = activeWeapon(s);
        s.reloadTimer -= dt;
        if (slot) {
          // 换弹相位（ironhold 时序）：38% 进匣、78% 拉机柄，边沿触发一次
          const remain = s.reloadTimer / slot.def.reload;
          if (s.reloadPhase === 0 && remain <= 0.62) {
            s.reloadPhase = 1;
            if (s.isPlayer && Game.sound.reloadMagIn) Game.sound.reloadMagIn();
          } else if (s.reloadPhase === 1 && remain <= 0.22) {
            s.reloadPhase = 2;
            if (s.isPlayer && Game.sound.reloadBolt) Game.sound.reloadBolt();
          }
        }
        if (s.reloadTimer <= 0) {
          s.reloading = false; s.reloadPhase = 0;
          if (slot) {
            const need = slot.def.mag - slot.mag;
            const take = Math.min(need, slot.reserve);
            slot.mag += take; slot.reserve -= take;
          }
          s.spreadDeg = 0; s.patternIdx = -1;
          if (s.isPlayer && Game.hud) Game.hud.hideReload();
        }
      }
    }
    updateProjectiles(dt);
    updateMedicRegen(dt);
    updateSupplyBoxes(dt);   // v5.31 地面补给箱持续治疗/补给
  }

  W.createSoldier = createSoldier;
  W.fireWeapon = fireWeapon; W.startReload = startReload; W.switchSlot = switchSlot;
  W.hitTest = hitTest; W.applyDamage = applyDamage; W.kill = kill;
  W.areaDamage = areaDamage; W.damageVehicle = damageVehicle; W.destroyVehicle = destroyVehicle;
  W.spawnProjectile = spawnProjectile; W.throwGrenade = throwGrenade; W.throwSmoke = throwSmoke; W.fireGadget = fireGadget;
  W.refillAmmo = refillAmmo; W.update = update;
  W.placeSupplyBox = placeSupplyBox; W.destroySupplyBox = destroySupplyBox;   // v5.31 补给箱
  W.getEyePos = getEyePos; W.getAimDir = getAimDir; W.activeWeapon = activeWeapon;
  W.aimVectors = aimVectors;
  W.initRecoil = initRecoil;
  W.restSpreadDeg = restSpreadDeg; W.totalSpreadDeg = totalSpreadDeg;
  W.falloffFactor = falloffFactor;
  W.fireMortarAt = fireMortarAt;
  W.initShield = initShield; W.updateMedicRegen = updateMedicRegen;
  W.trySpot = trySpot;

  Game.weapons = W;
})();
