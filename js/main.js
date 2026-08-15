// ============================================================
//  main.js  ·  渲染器/天空光照 + 征服/突破双模式 + 主循环 + 流程
//  v4 爆改：突破模式（线性扇区攻防）+ 双地图切换 + 地形弹坑冲刷
// ============================================================
(function () {
  'use strict';
  const M = Game.math;
  const AUTOTEST = (location.search || '').indexOf('autotest') >= 0;
  const URLP = new URLSearchParams(location.search);

  // ---- 模式/地图运行时状态 ----
  Game.mode = URLP.get('mode') === 'breakthrough' ? 'breakthrough' : 'conquest';
  const mapParam = URLP.get('map');
  Game.mapId = (mapParam === 'desert' || mapParam === 'snow' || mapParam === 'fort') ? mapParam : 'desert';
  Game.sectors = [];        // 突破模式扇区
  Game.activeSector = 1;
  Game.supplyBoxes = [];     // v5.31 地面补给箱（医疗/弹药）
  Game.matchTimeLimit = CONFIG.MATCH_TIME_LIMIT;

  // ---- 命中顿帧（hit-stop）：命中瞬间冻结一小段，提升打击感 ----
  Game.hitStopScale = 1;
  Game.hitStopT = 0;
  Game.hitStop = function (dur, scale) {
    Game.hitStopT = Math.max(Game.hitStopT || 0, dur);
    Game.hitStopScale = Math.min(Game.hitStopScale || 1, scale);
  };

  // ================= 场景初始化 =================
  function initScene() {
    const md = MAP_DEFS[Game.mapId];
    Game.scene = new THREE.Scene();
    Game.scene.background = new THREE.Color(md.sky);
    Game.scene.fog = new THREE.Fog(md.sky, md.fogNear, md.fogFar);
    setFogImmediate(md.fogNear, md.fogFar);   // v5.40 启动时同步迷雾
    Game.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 2400);
    Game.camera.position.set(0, 60, 200);
    Game.scene.add(Game.camera);

    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5a5240, 0.95);
    Game.scene.add(hemi);
    const sun = new THREE.DirectionalLight(md.sun, 1.35);
    sun.position.set(md.sunPos[0], md.sunPos[1], md.sunPos[2]);
    if (CONFIG.SHADOWS) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(CONFIG.SHADOW_SIZE, CONFIG.SHADOW_SIZE);
      sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
      sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
      sun.shadow.camera.near = 10; sun.shadow.camera.far = 600;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.02;
    }
    Game.scene.add(sun);
    Game.sun = sun;
    const rim = new THREE.DirectionalLight(0x8aa0c0, 0.4);
    rim.position.set(-120, 80, -100);
    Game.scene.add(rim);

    try {
      Game.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      console.error('WebGL 初始化失败', e);
      return;
    }
    Game.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    Game.renderer.setSize(innerWidth, innerHeight);
    const container = document.getElementById('game-container');
    container.insertBefore(Game.renderer.domElement, container.firstChild);
    window.addEventListener('resize', () => {
      Game.camera.aspect = innerWidth / innerHeight;
      Game.camera.updateProjectionMatrix();
      Game.renderer.setSize(innerWidth, innerHeight);
    });
  }

  function applyAtmosphere() {
    const md = MAP_DEFS[Game.mapId];
    Game.scene.background = new THREE.Color(md.sky);
    Game.scene.fog = new THREE.Fog(md.sky, md.fogNear, md.fogFar);
    setFogImmediate(md.fogNear, md.fogFar);   // v5.40 重置迷雾为地图默认
    if (Game.sun) { Game.sun.color.setHex(md.sun); Game.sun.position.set(md.sunPos[0], md.sunPos[1], md.sunPos[2]); }
  }

  // ============================================================
  //  v5.40 迷雾渐变：死后灵魂俯视战场时把迷雾推远（两套迷雾标准，渐变切换）
  // ============================================================
  let fogCur = { near: 0, far: 0 };
  let fogTarget = { near: 0, far: 0 };
  function fogOverview() {
    // 俯瞰标准：近端拉远、远端大幅推远，战场不被迷雾挡住
    return { near: CONFIG.WORLD * 1.5, far: CONFIG.WORLD * 4 };
  }
  function setFogTarget(near, far) { fogTarget = { near, far }; }
  function setFogImmediate(near, far) {
    fogCur = { near, far }; fogTarget = { near, far };
    if (Game.scene && Game.scene.fog) { Game.scene.fog.near = near; Game.scene.fog.far = far; }
  }
  function updateFog(dt) {
    if (!Game.scene || !Game.scene.fog) return;
    const k = 1 - Math.exp(-2.5 * dt);
    fogCur.near += (fogTarget.near - fogCur.near) * k;
    fogCur.far += (fogTarget.far - fogCur.far) * k;
    Game.scene.fog.near = fogCur.near;
    Game.scene.fog.far = fogCur.far;
  }

  // ================= 占领点 =================
  function initFlags() {
    // 清旧旗点
    for (const f of Game.flags) {
      if (f.mesh) { Game.scene.remove(f.mesh); f.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    }
    Game.flags = [];
    Game.sectors = [];
    const md = MAP_DEFS[Game.mapId];
    const mkFlag = (def, sector, locked) => {
      const f = {
        id: def.id, name: def.name || def.id, sector: sector || 0, locked: !!locked,
        x: def.x, z: def.z, y: Game.heightAt(def.x, def.z),
        // 突破：control 0 起步（0 = 均势，-100 = 攻方夺旗，+100 = 守方固守）
        control: 0,
        owner: Game.mode === 'breakthrough' ? TEAM_BLUE : -1,
        radius: 14, redCount: 0, blueCount: 0,
        mesh: null, flagMesh: null, ring: null, ui: null,
      };
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), new THREE.MeshStandardMaterial({ color: 0x555555 }));
      pole.position.y = 3;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 0.06), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      flag.position.set(0.95, 5.2, 0);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x606060 }));
      base.position.y = 0.25;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(f.radius - 0.4, f.radius, 40),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: f.locked ? 0.1 : 0.25, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.15;
      g.add(pole, flag, base, ring);
      g.position.set(f.x, f.y, f.z);
      Game.scene.add(g);
      f.mesh = g; f.flagMesh = flag; f.ring = ring;
      Game.flags.push(f);
      return f;
    };
    if (Game.mode === 'breakthrough') {
      for (const sec of md.flags.breakthrough) {
        Game.sectors.push(sec);
        for (const f of sec.flags) mkFlag(f, sec.sector, sec.sector !== 1);
      }
      Game.activeSector = 1;
      Game.matchTimeLimit = CONFIG.BT_TIME_LIMIT;
    } else {
      for (const f of md.flags.conquest) mkFlag(f, 0, false);
      Game.matchTimeLimit = CONFIG.MATCH_TIME_LIMIT;
    }
  }

  // ================= 模式逻辑 =================
  function updateConquest(dt) {
    for (const f of Game.flags) {
      f.redCount = 0; f.blueCount = 0;
      for (const s of Game.soldiers) {
        if (!s.alive || s.ridingVehicle) continue;
        const d = M.dist2(s.pos.x, s.pos.z, f.x, f.z);
        if (d < f.radius) {
          if (s.team === TEAM_RED) f.redCount++; else f.blueCount++;
        }
      }
      const prevOwner = f.owner;
      if (f.redCount > 0 && f.blueCount === 0) f.control -= CONFIG.CAPTURE_SPEED * dt;
      else if (f.blueCount > 0 && f.redCount === 0) f.control += CONFIG.CAPTURE_SPEED * dt;
      f.control = M.clamp(f.control, -100, 100);
      if (f.control <= -100) f.owner = TEAM_RED;
      else if (f.control >= 100) f.owner = TEAM_BLUE;
      if (f.owner !== prevOwner) onFlagCapture(f, prevOwner);
      const col = f.owner === TEAM_RED ? 0xe04a3e : f.owner === TEAM_BLUE ? 0x3e7ae0 : 0xdddddd;
      f.flagMesh.material.color.setHex(col);
      f.ring.material.color.setHex(col);
    }
    // 兵力流失
    let redFlags = 0, blueFlags = 0;
    for (const f of Game.flags) {
      if (f.owner === TEAM_RED) redFlags++;
      else if (f.owner === TEAM_BLUE) blueFlags++;
    }
    const majority = redFlags - blueFlags;
    if (majority > 0) Game.ticketsBlue = Math.max(0, Game.ticketsBlue - majority * CONFIG.BLEED_PER_FLAG * dt);
    else if (majority < 0) Game.ticketsRed = Math.max(0, Game.ticketsRed - (-majority) * CONFIG.BLEED_PER_FLAG * dt);
    if (Game.ticketsRed <= 0 || Game.ticketsBlue <= 0 || Game.time >= Game.matchTimeLimit) endMatch();
  }

  function updateBreakthrough(dt) {
    const active = Game.flags.filter((f) => f.sector === Game.activeSector);
    for (const f of active) {
      f.redCount = 0; f.blueCount = 0;
      for (const s of Game.soldiers) {
        if (!s.alive || s.ridingVehicle) continue;
        const d = M.dist2(s.pos.x, s.pos.z, f.x, f.z);
        if (d < f.radius) {
          if (s.team === TEAM_RED) f.redCount++; else f.blueCount++;
        }
      }
      const prevOwner = f.owner;
      // 攻方独占推进（快）；守方在场回拉（慢）
      if (f.redCount > 0 && f.blueCount === 0) f.control -= CONFIG.CAPTURE_SPEED * 1.15 * dt;
      else if (f.blueCount > 0 && f.redCount === 0) f.control += CONFIG.CAPTURE_SPEED * 0.5 * dt;
      f.control = M.clamp(f.control, -100, 100);
      if (f.control <= -100) f.owner = TEAM_RED;
      else if (f.control >= 100) f.owner = TEAM_BLUE;
      if (f.owner !== prevOwner) {
        onFlagCapture(f, prevOwner);
      }
      const col = f.owner === TEAM_RED ? 0xe04a3e : 0x3e7ae0;
      f.flagMesh.material.color.setHex(col);
      f.ring.material.color.setHex(col);
    }
    // 扇区推进判定
    let allCaptured = active.length > 0;
    for (const f of active) if (f.owner !== TEAM_RED) { allCaptured = false; break; }
    if (allCaptured) {
      const maxSector = Game.sectors.length;
      const secName = Game.sectors[Game.activeSector - 1] ? Game.L(Game.sectors[Game.activeSector - 1]) : '';
      if (Game.activeSector >= maxSector) {
        Game.hud.announce(Game.t('epic.finalSector'), '#ff6a5e');
        endMatch(TEAM_RED);
        return;
      }
      // v5.30 热血时刻：扇区陷落——连环爆炸 + 震屏 + 闪光 + 史诗播报
      for (const f of Game.flags) {
        if (f.sector === Game.activeSector) {
          Game.effects.explosion({ x: f.x, y: f.y + 4, z: f.z }, 10, true);
        }
      }
      Game.effects.addShake(0.85);
      if (Game.player && Game.hud && Game.hud.explosionFlash) Game.hud.explosionFlash(0.32);
      const epicLines = [Game.t('epic.break1', secName), Game.t('epic.break2', secName), Game.t('epic.break3', secName)];
      Game.hud.announce(epicLines[(Game.activeSector - 1) % epicLines.length], '#ffd27a');
      for (const f of Game.flags) if (f.sector === Game.activeSector) f.locked = true;
      Game.activeSector++;
      if (Game.activeSector >= Game.sectors.length) {
        Game.hud.announce(Game.t('epic.finalStand'), '#ff6a5e');   // v5.30 最终扇区宣言
      }
      for (const f of Game.flags) {
        if (f.sector === Game.activeSector) { f.locked = false; f.control = 0; f.owner = TEAM_BLUE; }
        f.ring.material.opacity = f.locked ? 0.1 : 0.25;
      }
      Game.ticketsRed += CONFIG.BT_SECTOR_BONUS;
    }
    // 胜负：攻方票尽→守方胜；守方票尽→攻方胜；时间到→守方胜
    if (Game.ticketsRed <= 0) endMatch(TEAM_BLUE);
    else if (Game.ticketsBlue <= 0) endMatch(TEAM_RED);
    else if (Game.time >= Game.matchTimeLimit) endMatch(TEAM_BLUE);
  }

  function updateMode(dt) {
    if (Game.mode === 'breakthrough') updateBreakthrough(dt);
    else updateConquest(dt);
  }

  function onFlagCapture(f, prevOwner) {
    const p = Game.player, H = Game.hud;
    const label = Game.L(f) || f.id;
    if (f.owner === p.team) {
      // v5.28 播报文案多样性（按旗点 id 确定性选择，不消耗随机数）
      const caps = [Game.t('cap.ours.1'), Game.t('cap.ours.2'), Game.t('cap.ours.3'), Game.t('cap.ours.4')];
      H.announce(caps[f.id.charCodeAt(0) % caps.length] + label, '#ffd27a');
      H.popup('+150', { x: f.x, y: f.y + 6, z: f.z }, '#ffd27a');
      p.score += 150;
      if (H.merit) H.merit('capture', 150);   // v5.18 占领功绩
      Game.stats.captures++;
    } else if (f.owner !== -1) {
      H.announce(Game.t('cap.enemy', label), '#ff6a5e');
    } else {
      H.announce(Game.t('cap.neutral', label), '#cccccc');
    }
  }

  // ================= AI 难度（v5.3 菜单可选） =================
  function applyDifficulty(key) {
    const p = AI_PRESETS[key] || AI_PRESETS.normal;
    for (const k in p) {
      if (k !== 'name' && k !== 'desc') CONFIG[k] = p[k];
    }
    Game.aiDifficulty = (AI_PRESETS[key] ? key : 'normal');
  }

  // ================= 退出对局 → 主菜单（重新选图/模式/难度） =================
  function exitToMenu() {
    Game.over = true; Game.running = false; Game.winner = -1;
    Game.phase = 'menu';
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    const p = Game.player;
    if (p.ridingVehicle) Game.Vehicles.exit(p);
    Game.Player.setMortarDeployed(false);
    p.alive = false; p.downed = undefined;
    Game.Player.resetInput();
    for (const v of Game.vehicles) Game.sound.engineStop(v.id);
    if (Game.sound.ambientStop) Game.sound.ambientStop();
    Game.killfeed = [];
    if (Game.supplyBoxes && Game.weapons && Game.weapons.destroySupplyBox) {
      for (const b of Game.supplyBoxes.slice()) Game.weapons.destroySupplyBox(b);   // v5.31 退局清理补给箱
    }
    Game.supplyBoxes = [];
    Game.hud.showScreen('menu');
    Game.hud.el.hud.classList.add('hidden');
    Game.hud.el.vehicleHud.classList.add('hidden');
  }

  function endMatch(forceWinner) {
    if (Game.over) return;
    Game.over = true; Game.running = false; Game.phase = 'over';
    if (Game.sound.ambientStop) Game.sound.ambientStop();
    let winner = forceWinner;
    if (winner === undefined || winner === null) {
      if (Game.ticketsRed <= 0) winner = TEAM_BLUE;
      else if (Game.ticketsBlue <= 0) winner = TEAM_RED;
      else winner = Game.ticketsRed >= Game.ticketsBlue ? TEAM_RED : TEAM_BLUE;
    }
    Game.winner = winner;
    const p = Game.player;
    const won = winner === p.team;
    const H = Game.hud;
    H.save.totalScore += p.score;
    H.save.kills += Game.stats.kills;
    H.save.deaths += Game.stats.deaths;
    if (won) H.save.wins++; else H.save.losses++;
    H.save.bestStreak = Math.max(H.save.bestStreak, Game.stats.bestStreak);
    H.saveGame();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    H.el.endTitle.textContent = won ? Game.t('end.victory') : Game.t('end.defeat');
    H.el.endTitle.style.color = won ? '#ffd27a' : '#ff6a5e';
    H.el.endInfo.innerHTML = Game.t('end.score', p.score) + '<br>' +
      Game.t('end.stats', Game.stats.kills, Game.stats.deaths, Game.stats.bestStreak) + '<br>' +
      Game.t('menu.rank.line', Game.L(H.rankName(H.save.totalScore)), H.save.totalScore);
    H.showScreen('end-screen');
  }

  // ================= 模式服务（AI 出生 / 目标） =================
  Game.modes = {
    // BOT 出生点
    spawnPoint(s) {
      if (Game.mode === 'breakthrough') {
        const isAttacker = s.team === TEAM_RED;
        const active = Game.flags.filter((f) => f.sector === Game.activeSector);
        const f = active[Math.floor(Math.random() * active.length)] || Game.flags[0];
        const lastStand = Game.activeSector >= Game.sectors.length;   // v5.30 最终扇区守军死守前沿
        const behind = isAttacker ? -13 : (lastStand ? 8 : 13);   // 攻方在前线后方集结，守方在防线后方
        return {
          x: f.x + behind + (Math.random() - 0.5) * 12,
          z: f.z + (Math.random() - 0.5) * 16,
        };
      }
      const owned = Game.flags.filter((f) => f.owner === s.team);
      const base = BASE_DEFS.find((b) => b.team === s.team);
      if (owned.length && Math.random() < 0.8) {
        const f = owned[Math.floor(Math.random() * owned.length)];
        return { x: f.x + (Math.random() - 0.5) * 10, z: f.z + (Math.random() - 0.5) * 10 };
      }
      return { x: base.x + (Math.random() - 0.5) * 12, z: base.z + (Math.random() - 0.5) * 12 };
    },
    // BOT 推进目标
    objectiveFor(s) {
      if (Game.mode === 'breakthrough') {
        const active = Game.flags.filter((f) => f.sector === Game.activeSector && !f.locked);
        let best = null, bd = Infinity;
        if (s.team === TEAM_RED) {
          for (const f of active) {
            if (f.owner === TEAM_RED) continue;   // 攻方推未占旗
            const d = M.dist2(f.x, f.z, s.pos.x, s.pos.z);
            if (d < bd) { bd = d; best = f; }
          }
        } else {
          for (const f of active) {               // 守方守当前扇区
            const d = M.dist2(f.x, f.z, s.pos.x, s.pos.z);
            if (d < bd) { bd = d; best = f; }
          }
        }
        if (best) return { x: best.x, z: best.z };
        const fallback = active[0] || Game.flags[0];
        return { x: fallback.x, z: fallback.z };
      }
      // 征服：最近的敌方旗
      let best = null, bd = Infinity;
      for (const f of Game.flags) {
        if (f.owner === s.team) continue;
        const d = M.dist2(f.x, f.z, s.pos.x, s.pos.z);
        if (d < bd) { bd = d; best = f; }
      }
      if (!best) best = Game.flags[Math.floor(Math.random() * Game.flags.length)];
      return { x: best.x, z: best.z };
    },
  };

  // ================= 玩家部署 =================
  function rearmPlayer(p, clsKey) {
    p.clsKey = clsKey; p.cls = CLASSES[clsKey];
    const w = WEAPONS[p.cls.weapon];
    p.slots.primary = { def: w, mag: w.mag, reserve: w.reserve };
    p.gadget = p.cls.gadget;
    const g = GADGETS[p.cls.gadget];
    p.gadgetAmmo = g && g.ammo > 0 ? g.ammo : 0;
    p.gadgetCooldown = 0; p.gadgetCdMax = p.cls.gadgetCooldown || 0;
    p.slot = 'primary'; p.reloading = false; p.reloadPhase = 0; p.fireTimer = 0; p.semiMode = false;
    Game.weapons.initRecoil(p);
    Game.weapons.initShield(p);   // v5.10 护盾随部署重置
  }

  function deployPlayer(spawnFlag) {
    const p = Game.player;
    rearmPlayer(p, Game.hud.selectedClass);
    // v5.39 支持选点复活：部署到所选点位附近（小幅偏移防扎堆）
    const spot = spawnFlag
      ? { x: spawnFlag.x + (Math.random() - 0.5) * 8, z: spawnFlag.z + (Math.random() - 0.5) * 8 }
      : Game.modes.spawnPoint(p);
    // v5.40 面向敌军基地（红朝 +x / 蓝朝 -x，而非原先朝北/朝南）
    const enemyBase = BASE_DEFS.find((b) => b.team !== p.team);
    let yaw = p.team === TEAM_RED ? 0 : Math.PI;
    if (enemyBase) {
      const dx = enemyBase.x - spot.x, dz = enemyBase.z - spot.z;
      yaw = Math.atan2(-dx, -dz);
    }
    pendingSpawn = { x: spot.x, z: spot.z, yaw };
    Game.Player.resetAds();   // 保险：清开镜残留
    if (Game.Player.view) Game.Player.view.visible = false;
    Game.hud.showScreen('none');
    const oy = Game.heightAt(0, 0) + CONFIG.WORLD * 1.5;
    const ov = new THREE.Vector3(0, oy, 30);
    // v5.42 复活俯冲：从当前灵魂位置平滑续飞（视角不突变，向敌军方向转动，转动与俯冲同速）；
    //            开局部署（无 spawnFlag）：从战场正上方俯瞰开始俯冲（lookAt 原点，不再从菜单角落）
    const fromPos = spawnFlag
      ? { x: Game.camera.position.x, y: Game.camera.position.y, z: Game.camera.position.z }
      : { x: ov.x, y: ov.y, z: ov.z };
    const q0 = spawnFlag
      ? Game.camera.quaternion.clone()
      : new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
          ov, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)));
    deathFly = {
      mode: 'deploy', t: 0, dur: 1.0,
      from: fromPos,
      to: { x: spot.x, y: Game.heightAt(spot.x, spot.z) + CONFIG.EYE_HEIGHT, z: spot.z },
      q0,
      q1: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')),
    };
    Game.phase = 'dead';      // 开局也走同一"灵魂归位"俯冲流程（死亡界面不会显示）
    Game.running = false;     // 战斗继续推演，等灵魂归位
    if (AUTOTEST) finalizeSpawn();   // 自动测试无 rAF：直接落地，不走飞行视角
  }

  // 灵魂到位后的落地：生成人物 + 显示枪械 + 进入战斗
  function finalizeSpawn() {
    const p = Game.player;
    const sp = pendingSpawn; pendingSpawn = null;
    p.pos = { x: sp.x, y: Game.heightAt(sp.x, sp.z), z: sp.z };
    p.yaw = sp.yaw; p.pitch = 0; p.vel = { x: 0, y: 0, z: 0 };
    p.crouching = false; p.sprinting = false;
    p.alive = true; p.health = p.maxHealth;
    p.spawnProtect = CONFIG.SPAWN_PROTECT;
    if (p.ridingVehicle) Game.Vehicles.exit(p);   // 车内直接重部署 → 先下车，防载具卡死
    p.ridingVehicle = null; p.vehicleSeat = -1;
    Game.Player.resetInput();                      // 清残留 dx/dy/换枪/开镜态，防复活瞬间甩视角
    Game.weapons.refillAmmo(p);
    if (Game.Player.view) Game.Player.view.visible = true;
    Game.phase = 'playing';
    Game.running = true; Game.over = false;
    Game.hud.showScreen('none');
    Game.hud.el.hud.classList.remove('hidden');
    Game.hud.el.vehicleHud.classList.add('hidden');
    Game.Player.requestLock();
    // v5.40 复活：迷雾渐变恢复为地图默认
    const md = MAP_DEFS[Game.mapId];
    setFogTarget(md.fogNear, md.fogFar);
    // v5.8 战场氛围：按当前地图重启环境音（风声强度/远处战场）
    if (Game.sound.ambientStop) Game.sound.ambientStop();
    if (Game.sound.ambientStart) Game.sound.ambientStart();
    if (Game.mode === 'breakthrough') {
      Game.hud.message(p.team === TEAM_RED ? Game.t('msg.deploy.bt.att') : Game.t('msg.deploy.bt.def'));
    } else {
      Game.hud.message(Game.t('msg.deploy.conquest'));
    }
  }

  function showDeathScreen() {
    Game.phase = 'dead';
    Game.running = false;   // 死亡界面不锁定鼠标（修复：点击按钮抢 pointer lock）
    const p = Game.player, c = Game.camera;
    // v5.40 先第一人称倒地：相机从眼高跌到尸体旁地面 + 侧倾（倒地后再灵魂出窍）
    deathFall = {
      t: 0, dur: 0.3,
      from: { x: c.position.x, y: c.position.y, z: c.position.z },
      to: { x: p.pos.x, y: p.pos.y + 0.4, z: p.pos.z },
      q0: c.quaternion.clone(),
      q1: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, p.yaw, 1.15, 'YXZ')),
    };
    if (Game.sound && Game.sound.deathSting) Game.sound.deathSting();   // v5.33 死亡低鸣
  }

  // 倒地完成后：隐藏枪械 → 灵魂出窍（飘向战场正上方）
  function startDeathFly() {
    const ov = fogOverview();
    setFogTarget(ov.near, ov.far);   // v5.40 死后俯视：迷雾渐变推远，不挡战场
    const oy = Game.heightAt(0, 0) + CONFIG.WORLD * 1.5;   // v5.40 提高俯瞰高度
    deathFly = {
      mode: 'death', t: 0, dur: 2.4, screenT: 1.0, screenShown: false,
      from: { x: Game.camera.position.x, y: Game.camera.position.y, z: Game.camera.position.z },
      to: { x: 0, y: oy, z: 30 },
      q0: Game.camera.quaternion.clone(),
      q1: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
        new THREE.Vector3(0, oy, 30), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0))),
    };
  }

  // ================= 重置对局 =================
  function resetMatch() {
    if (Game.mode === 'breakthrough') {
      Game.ticketsRed = CONFIG.BT_ATK_TICKETS;
      Game.ticketsBlue = CONFIG.BT_DEF_TICKETS;
      Game.matchTimeLimit = CONFIG.BT_TIME_LIMIT;
      Game.activeSector = 1;
      for (const f of Game.flags) {
        f.control = 0; f.owner = TEAM_BLUE;
        f.locked = f.sector !== 1;
        f.ring.material.opacity = f.locked ? 0.1 : 0.25;
      }
    } else {
      Game.ticketsRed = CONFIG.TICKETS;
      Game.ticketsBlue = CONFIG.TICKETS;
      Game.matchTimeLimit = CONFIG.MATCH_TIME_LIMIT;
      for (const f of Game.flags) { f.control = 0; f.owner = -1; f.locked = false; }
    }
    Game.time = 0; Game.over = false; Game.winner = -1;
    Game.killfeed = [];
    // v5.31 补给箱清理（残留箱体销毁）
    if (Game.supplyBoxes && Game.weapons && Game.weapons.destroySupplyBox) {
      for (const b of Game.supplyBoxes.slice()) Game.weapons.destroySupplyBox(b);
    }
    Game.supplyBoxes = [];
    Game.stats = { kills: 0, deaths: 0, captures: 0, bestStreak: 0 };
    for (const s of Game.soldiers) {
      s.alive = true; s.health = s.maxHealth; s.kills = 0; s.deaths = 0; s.score = 0; s.streak = 0;
      s.lastKillTime = -999; s.multikill = 0;   // 修复：新局首杀误判连杀
      s.lastHitBy = null;
      Game.weapons.initShield(s);
      s.ridingVehicle = null; s.vehicleSeat = -1;
      s.reloading = false; s.fireTimer = 0; s.bloom = 0; s.spawnProtect = 0;
      s.sliding = false; s.slideT = 0; s.slideCd = 0;   // v5.49 滑铲复位
      s.corpseT = -1;
      Game.weapons.refillAmmo(s);
      if (!s.isPlayer) Game.ai.respawn(s);
    }
    Game.Vehicles.resetAll();
    Game.phase = 'class-select';
    Game.hud.showScreen('class-select');
  }

  // ================= 相机（菜单/阵亡） =================
  function menuCamera() {
    const t = performance.now() / 1000 * 0.06;
    const r = CONFIG.WORLD * 1.4;
    const cx = Math.cos(t) * r, cz = Math.sin(t) * r;
    const cy = Game.heightAt(cx, cz) + 60;
    Game.camera.position.set(cx, cy, cz);
    Game.camera.lookAt(0, 6, 0);
  }
  // v5.40 阵亡/复活视角序列：第一人称倒地 → 灵魂出窍（上浮）/ 灵魂归位（复活俯冲）
  let deathFall = null;
  let deathFly = null;
  let pendingSpawn = null;
  const _slerpQ = new THREE.Quaternion();   // 复用四元数：干净 slerp（不原地改写 q0，保证转动与位移同步）
  function deathCamera(dt) {
    // 1) 第一人称倒地（smoothstep 渐渐加速-渐渐减速）
    if (deathFall) {
      deathFall.t += dt;
      const k = M.clamp(deathFall.t / deathFall.dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      Game.camera.position.set(
        deathFall.from.x + (deathFall.to.x - deathFall.from.x) * e,
        deathFall.from.y + (deathFall.to.y - deathFall.from.y) * e,
        deathFall.from.z + (deathFall.to.z - deathFall.from.z) * e);
      _slerpQ.copy(deathFall.q0).slerp(deathFall.q1, e);
      Game.camera.quaternion.copy(_slerpQ);
      if (k >= 1) {
        deathFall = null;
        if (Game.Player.view) Game.Player.view.visible = false;   // 倒地完成 → 隐藏枪械
        startDeathFly();                                          // 灵魂出窍
      }
      return;
    }
    // 2) 灵魂出窍（上浮）/ 灵魂归位（复活俯冲），共用 smoothstep 渐渐加速-渐渐减速
    if (!deathFly) return;
    deathFly.t += dt;
    const k = M.clamp(deathFly.t / deathFly.dur, 0, 1);
    const e = k * k * (3 - 2 * k);
    Game.camera.position.set(
      deathFly.from.x + (deathFly.to.x - deathFly.from.x) * e,
      deathFly.from.y + (deathFly.to.y - deathFly.from.y) * e,
      deathFly.from.z + (deathFly.to.z - deathFly.from.z) * e);
    _slerpQ.copy(deathFly.q0).slerp(deathFly.q1, e);
    Game.camera.quaternion.copy(_slerpQ);
    if (deathFly.mode === 'death' && !deathFly.screenShown && deathFly.t >= deathFly.screenT) {
      deathFly.screenShown = true;
      const p = Game.player;
      const H = Game.hud;
      const killer = p.lastHitBy;
      const killerName = killer ? (killer.team === TEAM_BLUE ? Game.L(TEAMS[TEAM_BLUE]) : Game.L(TEAMS[TEAM_RED], 'short')) : Game.t('death.battlefield');
      H.el.deathInfo.innerHTML = Game.t('death.killer', killerName) +
        '<br>' + Game.t('death.stats', p.kills, p.deaths, p.score);
      H.showScreen('death-screen');
    }
    if (k >= 1) {
      const mode = deathFly.mode;
      deathFly = null;
      if (mode === 'deploy') finalizeSpawn();   // 灵魂到位 → 生成人物 + 显示枪械
    }
  }

  // ================= 主循环 =================
  function animate() {
    requestAnimationFrame(animate);
    const rawDt = Math.min(0.05, Game.clock.getDelta());
    // 命中顿帧：真实时间计时，到期恢复时间流速（不影响 debug 慢动作的 timeScale）
    if (Game.hitStopT > 0) {
      Game.hitStopT -= rawDt;
      if (Game.hitStopT <= 0) { Game.hitStopT = 0; Game.hitStopScale = 1; }
    }
    const dt = rawDt * (Game.timeScale || 1) * (Game.hitStopScale || 1);
    updateFog(dt);   // v5.40 迷雾渐变
    const phase = Game.phase;
    if (phase === 'playing' || phase === 'dead') {
      if (!Game.over) {
        Game.time += dt;
        Game.shake = Math.max(0, Game.shake - dt * 3);
        if (Game.player.alive) Game.Player.update(dt);
        Game.ai.update(dt);
        Game.Vehicles.update(dt);
        Game.weapons.update(dt);
        updateMode(dt);
        Game.effects.update(dt);
        Game.terrain.update(dt);   // 弹坑冲刷到地形网格
        if (phase === 'playing' && !Game.player.alive) {
          Game.phase = 'dead';
          if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
          showDeathScreen();
        }
        if (Game.phase === 'dead') deathCamera(dt);
        Game.hud.update(dt);
        if (Game.sound.ambientUpdate) Game.sound.ambientUpdate(dt);   // v5.8 远处战场随机音
      }
    } else if (phase === 'menu' || phase === 'class-select') {
      menuCamera();
      Game.effects.update(dt);
    } else if (phase === 'over') {
      Game.effects.update(dt);
    }
    Game.renderer.render(Game.scene, Game.camera);
  }

  // ================= 地图/模式切换 =================
  function applySelection(mode, mapId) {
    Game.mode = mode;
    const mapChanged = mapId !== Game.mapId;
    Game.mapId = mapId;
    if (mapChanged) {
      // 重建地形 + 旗点 + 载具 + 小地图
      for (const v of Game.vehicles) {
        if (v.group) { Game.scene.remove(v.group); v.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
      }
      Game.vehicles.length = 0;
      Game.terrain.generate(Game.scene, Game.mapId);
      applyAtmosphere();
      Game.effects.setWeather(MAP_DEFS[Game.mapId].weather || null);
      initFlags();
      Game.Vehicles.init();
      Game.hud.initMinimap();
      Game.hud.buildFlags();
      Game.hud.buildSectorBar();
    } else {
      initFlags();
      Game.hud.buildFlags();
      Game.hud.buildSectorBar();
    }
    resetMatch();
  }

  // ================= 启动 =================
  function boot() {
    applyDifficulty('normal');   // 默认普通难度（与 CONFIG 初始值一致，autotest 行为不变）
    if (AUTOTEST) CONFIG.SHADOWS = false;
    initScene();
    Game.terrain.generate(Game.scene, Game.mapId);
    Game.effects.init(Game.scene);
    Game.effects.setWeather(MAP_DEFS[Game.mapId].weather || null);   // v5 天气粒子
    Game.clock = new THREE.Clock();
    Game.ticketsRed = CONFIG.TICKETS;
    Game.ticketsBlue = CONFIG.TICKETS;
    Game.phase = 'menu';

    Game.Player.init();
    initFlags();
    Game.ai.init();
    Game.Vehicles.init();
    Game.hud.init();
    Game.hud.initMinimap();
    Game.hud.buildSectorBar();
    // 修复：?mode=/?map= URL 参数此前对菜单选择无效（hud 求值时 Game.mode 尚未赋值）
    Game.hud.syncMenuSelection(Game.mode, Game.mapId);

    // 多语言：应用初始语言 + 绑定语言切换
    Game.applyLang();
    document.querySelectorAll('.lang-btn').forEach((b) => {
      b.onclick = () => Game.setLang(b.getAttribute('data-lang'));
    });

    // 按钮
    document.getElementById('btn-start').onclick = () => {
      Game.audio.init();
      applyDifficulty(Game.hud.selectedDiff);   // v5.3 应用所选 AI 难度
      applySelection(Game.hud.selectedMode, Game.hud.selectedMap);
      Game.phase = 'class-select';
      Game.hud.showScreen('class-select');
    };
    document.getElementById('btn-deploy').onclick = () => { Game.audio.init(); deployPlayer(); };
    document.getElementById('btn-restart').onclick = () => { Game.audio.init(); resetMatch(); };
    // v5.3 退出按钮（HUD / 阵亡 / 结束界面共用）
    const onExit = () => { exitToMenu(); };
    document.getElementById('btn-exit').onclick = onExit;
    document.getElementById('btn-exit-dead').onclick = onExit;
    document.getElementById('btn-exit-end').onclick = onExit;

    Game.hud.showScreen('menu');

    if (AUTOTEST) {
      console.log('[autotest] 自动部署');
      deployPlayer();
      // 自动测试：不启动 rAF 主循环（测试脚本手动确定性步进）
      setInterval(() => {
        console.log('[autotest] time=' + Game.time.toFixed(1) +
          ' tickets=' + Math.ceil(Game.ticketsRed) + '/' + Math.ceil(Game.ticketsBlue) +
          ' flags=' + Game.flags.map((f) => f.id + ':' + Math.round(f.control)).join(',') +
          ' kills=' + Game.stats.kills);
      }, 2000);
    } else {
      animate();
    }

    console.log('[main] 灰烬战线 启动完成 · 模式 ' + Game.mode + ' · 地图 ' + Game.mapId +
      ' · 士兵 ' + Game.soldiers.length + ' · 载具 ' + Game.vehicles.length + ' · 占领点 ' + Game.flags.length);
  }

  Game.updateConquest = updateConquest;
  Game.updateBreakthrough = updateBreakthrough;
  Game.endMatch = endMatch;
  Game.applySelection = applySelection;   // 测试/外部：切换模式+地图
  Game.deployPlayer = deployPlayer;       // 测试/外部：部署
  Game.applyDifficulty = applyDifficulty; // 测试/外部：AI 难度
  Game.exitToMenu = exitToMenu;           // 测试/外部：退出对局回菜单
  window.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
