// ============================================================
//  player.js  ·  第一人称控制器 + viewmodel + 输入 + 相机
// ============================================================
(function () {
  'use strict';
  const M = Game.math;
  const P = {
    keys: new Set(),
    dx: 0, dy: 0, locked: false,
    trigger: false,
    clickBuf: 0,          // 点击缓冲（高速点击不丢枪；冷却/换弹末的点击排队 0.12s）
    ads: false, adsK: 0, adsEase: 0, scoped: false,
    sensScale: 1,         // ADS 灵敏度缩放（tan 半角比）
    switching: 0, switchTotal: 1, drawTime: 0.4, pendingSlot: null, // 换枪两段（收枪+掏枪）
    view: null, muzzleLocal: null,
    bobT: 0, viewKick: 0, lastShot: -999,
    landKick: 0, lastFallY: null,   // v5.10 落地顿挫动画
    flinchPitch: 0, flinchYaw: 0, flinchT: 0,   // v5.43 受击镜头甩动（被打击感）
    stepT: 0, lastSlot: 'primary', lastClsKey: null,   // v5.25 模型自动对账基准
    fov: 75,
    mortarDeployed: false,   // v5.7 迫击炮部署状态（部署后右下地图选点）
    mortarCam: null,         // v5.13 炮弹跟随视角 { proj, tx, tz, ty, dx, dz, phase, t, pos, quat }
    camFly: null,            // v5.32 部署飞行视角（天上 → 士兵，渐快）
  };
  // v5.13 迫击炮镜头临时量（复用避免每帧分配）
  const _mcM = new THREE.Matrix4(), _mcQ = new THREE.Quaternion();
  const _mcEye = new THREE.Vector3(), _mcTgt = new THREE.Vector3(), _mcUp = new THREE.Vector3(0, 1, 0);
  const _cfQ = new THREE.Quaternion();   // v5.32 部署飞行视角临时量

  function init() {
    Game.player = Game.createSoldier(TEAM_RED, true, 'assault');
    setupInput();
    buildViewmodel();
  }

  function setupInput() {
    window.addEventListener('keydown', (e) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'KeyC'].includes(e.code)) {
        e.preventDefault();
      }
      P.keys.add(e.code);
      const s = Game.player;
      if (!Game.running || !s || !s.alive) return;
      switch (e.code) {
        case 'KeyR': if (!s.ridingVehicle) Game.weapons.startReload(s); break;
        case 'Digit1':
          if (s.ridingVehicle) s.ridingVehicle.weaponSlot = 'primary';
          else P.requestSwitch('primary');
          break;
        case 'Digit2':
          if (s.ridingVehicle) s.ridingVehicle.weaponSlot = 'secondary';
          else P.requestSwitch('secondary');
          break;
        case 'Digit3':
          if (s.ridingVehicle) break;
          if (P.mortarDeployed) { setMortarDeployed(false); break; }   // 已部署 → 再按 3 收起
          P.requestSwitch('gadget');
          break;
        case 'KeyB':
          // 半自动切换（仅支持 modes 含 'semi' 的枪，如 AR-40）
          if (!s.ridingVehicle) {
            const w = Game.weapons.activeWeapon(s);
            if (w && w.def.modes && w.def.modes.indexOf('semi') >= 0) {
              s.semiMode = !s.semiMode;
              if (Game.hud) Game.hud.message(s.semiMode ? Game.t('player.semiMode') : Game.t('player.autoMode'));
            }
          }
          break;
        case 'KeyG': if (!s.ridingVehicle) Game.weapons.throwGrenade(s); break;
        case 'KeyH': if (!s.ridingVehicle && Game.weapons.throwSmoke) Game.weapons.throwSmoke(s); break;   // v5.38 烟雾弹
        case 'KeyQ': if (!s.ridingVehicle) Game.weapons.trySpot(s); break;   // v5.12 侦察标记
        case 'KeyF': if (Game.Vehicles) Game.Vehicles.tryInteract(s); break;
        case 'KeyV':
          if (s.ridingVehicle && Game.Vehicles) {
            Game.Vehicles.thirdPerson = !Game.Vehicles.thirdPerson;
            if (Game.hud) Game.hud.message(Game.Vehicles.thirdPerson ? Game.t('player.thirdPerson') : Game.t('player.firstPerson'));
          }
          break;
        case 'Tab': if (Game.hud) Game.hud.toggleScoreboard(true); e.preventDefault(); break;
      }
    });
    window.addEventListener('keyup', (e) => {
      P.keys.delete(e.code);
      if (e.code === 'Tab' && Game.hud) Game.hud.toggleScoreboard(false);
    });

    const canvas = () => Game.renderer ? Game.renderer.domElement : document.body;
    document.addEventListener('mousemove', (e) => {
      // v5.36 修复「瞬间转一大圈」：过滤指针锁定过渡/切回标签页时的异常大位移伪事件，
      // 并对单帧累积量钳制（步战/载具/飞行视角全部经过此入口，统一生效）
      if (!P.locked) return;
      if (Math.abs(e.movementX) > 320 || Math.abs(e.movementY) > 320) return;   // 锁后重定位伪事件 → 丢弃
      P.dx = M.clamp(P.dx + e.movementX, -220, 220);
      P.dy = M.clamp(P.dy + e.movementY, -220, 220);
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        if (P.mortarDeployed) return;   // 部署状态：点击交给迫击炮地图 UI，不重新锁指针
        // v5.10 调参面板/界面交互不再抢指针锁（修复滑动条"黏手"、要不断 Esc 的问题）
        if (e.target && e.target.closest && e.target.closest('#debug-panel, .screen, #mortar-map-panel, button, input, select, textarea')) return;
        if (!P.locked && Game.running) { requestLock(); return; }
        P.trigger = true;
        // 点击缓冲：>= 射速间隔 + 0.02（v4 固定 0.12 < 手枪 0.2 射速，快速点射第二枪被吞）
        const s = Game.player;
        let buf = 0.12;
        if (s && s.alive && s.slot !== 'gadget') {
          const w = Game.weapons.activeWeapon(s);
          if (w && w.def && w.def.rate) buf = Math.max(0.12, w.def.rate + 0.02);
        }
        // v5.11：换枪期间的点击排队到枪就绪再射（消除霰弹枪"前摇"、点快了没反应的手感）
        buf = Math.max(buf, P.switching + 0.06);
        P.clickBuf = buf;
        if (s && s.alive && Game.running && !Game.over) {
          if (s.slot === 'gadget') Game.weapons.fireGadget(s);
        }
      }
      if (e.button === 2) P.ads = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) P.trigger = false;
      if (e.button === 2) P.ads = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      P.locked = document.pointerLockElement != null;
      if (!P.locked) P.dx = P.dy = 0;
      if (Game.hud) Game.hud.setLocked(P.locked);
    });
  }

  function requestLock() {
    const el = Game.renderer ? Game.renderer.domElement : document.body;
    try {
      const p = el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* headless 环境无手势，忽略 */ }
  }
  P.requestLock = requestLock;

  // v5.7 迫击炮部署/收起：部署 → 释放鼠标 + 打开右下地图；收起 → 重新锁定
  function setMortarDeployed(on) {
    const s = Game.player;
    if (on) {
      if (!s || !s.alive || s.ridingVehicle || s.slot !== 'gadget' || s.gadget !== 'mortar') return;
      P.mortarDeployed = true;
      P.ads = false;
      if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
      if (Game.hud) {
        Game.hud.showMortarMap(true);
        Game.hud.setLocked(P.locked);   // v5.13 部署时不显示「Esc 释放鼠标」提示
        Game.hud.message(Game.t('player.mortarDeploy'));
      }
    } else {
      P.mortarDeployed = false;
      if (Game.hud) { Game.hud.showMortarMap(false); Game.hud.setLocked(P.locked); }
      if (Game.running && s && s.alive) requestLock();
    }
  }
  P.setMortarDeployed = setMortarDeployed;

  // ============================================================
  //  v5.32 部署飞行视角：从天上的战场俯视飞回士兵（渐快，战地式）
  // ============================================================
  function startDeployCam() {
    const s = Game.player;
    const eye = Game.weapons.getEyePos(s);
    P.camFly = {
      t: 0, dur: 1.3, mode: 'deploy',
      fromPos: { x: Game.camera.position.x, y: Game.camera.position.y, z: Game.camera.position.z },
      fromQuat: Game.camera.quaternion.clone(),
      toPos: { x: eye.x, y: eye.y, z: eye.z },
    };
    if (P.view) P.view.visible = false;
  }
  P.startDeployCam = startDeployCam;
  function updateCamFly(dt) {
    const f = P.camFly;
    if (!f) return;
    const s = Game.player;
    f.t += dt;
    const k = M.clamp(f.t / f.dur, 0, 1);
    const e = k * k * (3 - 2 * k);   // v5.39 渐渐加速-渐渐减速（smoothstep）
    // 目标实时跟随士兵眼睛（部署瞬间士兵已就位）
    const eye = Game.weapons.getEyePos(s);
    Game.camera.position.set(
      f.fromPos.x + (eye.x - f.fromPos.x) * e,
      f.fromPos.y + (eye.y - f.fromPos.y) * e,
      f.fromPos.z + (eye.z - f.fromPos.z) * e);
    _cfQ.setFromEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
    f.fromQuat.slerp(_cfQ, e);
    Game.camera.quaternion.copy(f.fromQuat);
    if (k >= 1) {
      P.camFly = null;
      if (P.view) P.view.visible = true;
      if (Game.sound && Game.sound.deploy) Game.sound.deploy();   // v5.33 部署落地音效
    }
  }

  // ============================================================
  //  v5.13 迫击炮第一人称跟随视角：发射后镜头平滑追上炮弹，
  //  全程朝向落点；爆炸后悬停俯瞰落点，再平滑切回玩家视角
  // ============================================================
  function startMortarCam(proj, tx, tz, ty) {
    const s = Game.player;
    if (!s) return;
    const eye = Game.weapons.getEyePos(s);
    const dl = Math.hypot(tx - eye.x, tz - eye.z) || 1;
    P.mortarCam = {
      proj, tx, tz, ty,
      dx: (tx - eye.x) / dl, dz: (tz - eye.z) / dl,   // 射手→落点水平方向（悬停位置用）
      phase: 'fly', t: 0,
      pos: { x: Game.camera.position.x, y: Game.camera.position.y, z: Game.camera.position.z },
      quat: Game.camera.quaternion.clone(),
    };
  }
  P.startMortarCam = startMortarCam;

  function endMortarCam() {
    P.mortarCam = null;
    if (P.view) P.view.visible = true;
  }

  function updateMortarCam(dt) {
    const cam = P.mortarCam;
    if (!cam) return;
    const s = Game.player;
    // 阵亡/上车：立即退出
    if (!s || !s.alive || s.ridingVehicle) { endMortarCam(); return; }
    // 收起迫击炮：转入快速切回（仍平滑，不瞬移）
    if (!P.mortarDeployed && cam.phase === 'fly') { cam.phase = 'return'; cam.t = 0; }
    cam.t += dt;
    const kPos = 1 - Math.exp(-14 * dt);
    const kRot = 1 - Math.exp(-10 * dt);
    if (cam.phase === 'fly') {
      if (P.view) P.view.visible = false;
      const proj = cam.proj;
      if (Game.projectiles.indexOf(proj) !== -1) {
        // 弹体后方 1.1m 跟随（首 0.7s 加速贴近，之后紧密咬合）
        const vl = Math.hypot(proj.vel.x, proj.vel.y, proj.vel.z) || 1;
        const k = 1 - Math.exp(-(cam.t < 0.7 ? 9 : 22) * dt);
        cam.pos.x += ((proj.pos.x - proj.vel.x / vl * 1.1) - cam.pos.x) * k;
        cam.pos.y += ((proj.pos.y - proj.vel.y / vl * 1.1 + 0.2) - cam.pos.y) * k;
        cam.pos.z += ((proj.pos.z - proj.vel.z / vl * 1.1) - cam.pos.z) * k;
      } else { cam.phase = 'impact'; cam.t = 0; }
    } else if (cam.phase === 'impact') {
      // 爆炸后：掠到落点斜上方（射手一侧 9m、高 5m）俯瞰落点
      const gx = cam.tx - cam.dx * 9, gz = cam.tz - cam.dz * 9, gy = cam.ty + 5;
      cam.pos.x += (gx - cam.pos.x) * kPos;
      cam.pos.y += (gy - cam.pos.y) * kPos;
      cam.pos.z += (gz - cam.pos.z) * kPos;
      if (cam.t > 1.15) { cam.phase = 'return'; cam.t = 0; }
    } else {
      // 切回玩家第一人称（眼睛位置 + 当前朝向）
      const eye = Game.weapons.getEyePos(s);
      cam.pos.x += (eye.x - cam.pos.x) * kPos;
      cam.pos.y += (eye.y - cam.pos.y) * kPos;
      cam.pos.z += (eye.z - cam.pos.z) * kPos;
      _mcQ.setFromEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
      cam.quat.slerp(_mcQ, kRot);
      Game.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
      Game.camera.quaternion.copy(cam.quat);
      if (cam.t > 0.45) { endMortarCam(); }
      return;
    }
    Game.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
    // 飞行/悬停阶段：始终朝向落点
    _mcTgt.set(cam.tx, cam.ty, cam.tz);
    _mcEye.set(cam.pos.x, cam.pos.y, cam.pos.z);
    _mcM.lookAt(_mcEye, _mcTgt, _mcUp);
    _mcQ.setFromRotationMatrix(_mcM);
    cam.quat.slerp(_mcQ, kRot);
    Game.camera.quaternion.copy(cam.quat);
  }

  // 部署/重生时重置全部输入态（修复：死亡界面锁定鼠标期间 dx/dy 持续累积
  // 导致复活第一帧相机猛转；换枪半途/开镜状态不应带到新一局）
  function resetInput() {
    P.dx = P.dy = 0;
    P.ads = false; P.adsK = 0; P.adsEase = 0;
    P.switching = 0; P.pendingSlot = null;
    P.clickBuf = 0; P.trigger = false; P.scoped = false;
    P.mortarDeployed = false;
    P.mortarCam = null;
  }
  P.resetInput = resetInput;

  // v5.40 开镜阵亡修复：复位开镜态 + FOV（否则开镜时死会保持低 FOV 俯视/飞行，观感 bug）
  function resetAds() {
    P.ads = false; P.adsK = 0; P.adsEase = 0; P.scoped = false;
    P.sensScale = 1;
    P.fov = 75;
    if (Game.camera) { Game.camera.fov = 75; Game.camera.updateProjectionMatrix(); }
  }
  P.resetAds = resetAds;

  // 换枪请求（收枪 0.22s + 掏枪 drawTime 两段，期间禁火）
  // 换枪中再按 → 覆盖目标并重启计时（后按优先，不会丢请求）
  function requestSwitch(slot) {
    const s = Game.player;
    if (!s) return;
    if (P.mortarDeployed && slot !== 'gadget') setMortarDeployed(false);   // 切枪自动收起迫击炮
    if (P.switching <= 0 && s.slot === slot) return; // 静止且同槽 → 忽略
    const nextDef = (slot !== 'gadget' && s.slots[slot]) ? s.slots[slot].def : null;
    P.pendingSlot = slot;
    P.drawTime = nextDef ? nextDef.drawTime : 0.4;
    P.switching = P.drawTime + 0.22;
    P.switchTotal = P.switching;
    P.ads = false;
  }
  P.requestSwitch = requestSwitch;

  // 开火后的 viewmodel 视觉 kick（幅度来自确定性 pattern 的 pitch）
  function onShotFired(recoilDef) {
    P.viewKick = Math.min(1, (recoilDef.pitch || 0.03) * 26);
  }
  P.onShotFired = onShotFired;

  // v5.43 受击镜头 Flinch：向命中方向猛甩一下再回中（被打击感核心）
  function flinch(dmg, point) {
    const s = Game.player;
    if (!s || !s.alive || s.ridingVehicle) return;
    const strength = M.clamp((dmg || 0) / 90, 0.25, 1);
    let hitYaw = s.yaw;
    if (point) {
      const dx = point.x - s.pos.x, dz = point.z - s.pos.z;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) hitYaw = Math.atan2(-dx, -dz);
    }
    let rel = hitYaw - s.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    // 向命中侧甩 + 轻微上抬
    P.flinchYaw += -Math.sin(rel) * (0.05 + 0.07 * strength);
    P.flinchPitch += 0.05 + 0.06 * strength;
    P.flinchT = 0.18;
    P.flinchPitch = M.clamp(P.flinchPitch, -0.14, 0.14);
    P.flinchYaw = M.clamp(P.flinchYaw, -0.14, 0.14);
  }
  P.flinch = flinch;

  function box(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
  function cyl(r, h, m, seg) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 12), m); }

  // 红点瞄准镜（供非狙击枪使用）
  function redDotSight() {
    const g = new THREE.Group();
    const base = box(0.05, 0.045, 0.1, new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.35, metalness: 0.6 }));
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 10),
      new THREE.MeshStandardMaterial({ color: 0x300808, roughness: 0.2, metalness: 0.5 }));
    lens.rotation.x = Math.PI / 2; lens.position.set(0, 0, -0.05);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    dot.position.set(0, 0, -0.035);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.copy(dot.position);
    g.add(base, lens, dot, glow);
    return g;
  }

  // ---- 枪械模型（低模，每种枪有辨识度高的剪影） ----
  function buildGunModel(key) {
    const g = new THREE.Group();
    const mat = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.45 : r, metalness: m === undefined ? 0.6 : m });
    const metal = mat(0x2a2e34, 0.35, 0.85);
    const dark = mat(0x14171b, 0.4, 0.7);
    const poly = mat(0x33383f, 0.55, 0.45);
    const wood = mat(0x6b4f2e, 0.72, 0.12);
    const glow = mat(0x0a0c0e, 0.35, 0.65);
    if (key === 'pistol') {
      const slide = box(0.075, 0.09, 0.34, metal); slide.position.set(0, 0.03, -0.1);
      const frame = box(0.065, 0.12, 0.2, poly); frame.position.set(0, -0.04, 0.03);
      const grip = box(0.06, 0.16, 0.1, dark); grip.position.set(0, -0.13, 0.06); grip.rotation.x = 0.25;
      const muzzle = box(0.045, 0.045, 0.06, glow); muzzle.position.set(0, 0.03, -0.3);
      const sight = redDotSight(); sight.position.set(0, 0.1, -0.12); sight.scale.setScalar(0.7);
      g.add(slide, frame, grip, muzzle, sight);
    } else if (key === 'sniper') {
      const body = box(0.06, 0.1, 0.5, poly); body.position.set(0, 0.02, 0.05);
      const barrel = cyl(0.028, 0.62, dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.05, -0.58);
      const muzzle = cyl(0.04, 0.08, glow); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.05, -0.9);
      // v5.45 瞄准镜改柱状镂空长方体（四壁镜管 + 前后镜环，可透视中心）
      const scope = new THREE.Group();
      { const st = 0.008, tl = 0.28, tw = 0.08, th = 0.06;
        const wT = box(tw, st, tl, dark); wT.position.y = th / 2;
        const wB = box(tw, st, tl, dark); wB.position.y = -th / 2;
        const wL = box(st, th, tl, dark); wL.position.x = -tw / 2;
        const wR = box(st, th, tl, dark); wR.position.x = tw / 2;
        const rF = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.007, 6, 16), metal); rF.position.z = -tl / 2;
        const rB = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.007, 6, 16), metal); rB.position.z = tl / 2;
        scope.add(wT, wB, wL, wR, rF, rB);
      }
      scope.position.set(0, 0.13, -0.08);
      g.userData.scopeLocal = { x: 0, y: 0.13, z: -0.08 };
      const stock = box(0.055, 0.1, 0.3, wood); stock.position.set(0, -0.02, 0.36);
      const mag = box(0.05, 0.12, 0.08, metal); mag.position.set(0, -0.1, -0.18);
      const bipod = box(0.05, 0.15, 0.03, dark); bipod.position.set(0, -0.11, -0.42); bipod.rotation.x = 0.22;
      const bolt = box(0.028, 0.028, 0.14, metal); bolt.position.set(0.055, 0.045, -0.06);   // v5.17 拉栓柄（动画部件）
      g.add(body, barrel, muzzle, scope, stock, mag, bipod, bolt);
      g.userData.bolt = bolt;
    } else if (key === 'lmg') {
      const body = box(0.08, 0.13, 0.55, poly); body.position.set(0, 0.02, 0.02);
      const barrel = cyl(0.045, 0.5, metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.06, -0.5);
      const muzzle = cyl(0.06, 0.08, glow); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.06, -0.77);
      const mag = box(0.09, 0.17, 0.13, metal); mag.position.set(0, -0.13, 0.05);
      const stock = box(0.07, 0.1, 0.28, wood); stock.position.set(0, 0.02, 0.4);
      const bipod = box(0.06, 0.16, 0.04, dark); bipod.position.set(0, -0.12, -0.44); bipod.rotation.x = 0.15;
      const handle = box(0.04, 0.07, 0.12, poly); handle.position.set(0, 0.15, -0.1);
      const sight = redDotSight(); sight.position.set(0, 0.15, -0.18);
      g.add(body, barrel, muzzle, mag, stock, bipod, handle, sight);
    } else if (key === 'smg') {
      const body = box(0.06, 0.11, 0.38, poly); body.position.set(0, 0.03, -0.02);
      const barrel = cyl(0.032, 0.2, dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.06, -0.28);
      const muzzle = cyl(0.045, 0.06, glow); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.06, -0.4);
      const mag = box(0.05, 0.2, 0.07, metal); mag.position.set(0, -0.13, -0.02); mag.rotation.x = 0.15;
      const stock = box(0.05, 0.08, 0.22, dark); stock.position.set(0, 0.02, 0.22);
      const grip = box(0.04, 0.1, 0.05, dark); grip.position.set(0, -0.08, 0.08);
      const sight = redDotSight(); sight.position.set(0, 0.12, -0.06); sight.scale.setScalar(0.8);
      g.add(body, barrel, muzzle, mag, stock, grip, sight);
    } else if (key === 'shotgun') {
      // 泵动霰弹枪：粗管 + 管式弹仓 + 木托 + 泵把
      const body = box(0.07, 0.11, 0.55, wood); body.position.set(0, 0.01, 0.02);
      const barrel = cyl(0.045, 0.55, metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.06, -0.42);
      const tubeMag = cyl(0.035, 0.4, dark); tubeMag.rotation.x = Math.PI / 2; tubeMag.position.set(0, -0.02, -0.35);
      const muzzle = cyl(0.06, 0.07, glow); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.06, -0.72);
      const pump = box(0.08, 0.07, 0.16, poly); pump.position.set(0, -0.03, -0.2);
      const stock = box(0.06, 0.12, 0.3, wood); stock.position.set(0, 0, 0.36); stock.rotation.x = 0.1;
      g.add(body, barrel, tubeMag, muzzle, pump, stock);
    } else if (key === 'aa12') {
      // AA-12 全自动霰弹枪：粗管 + 弹鼓 + 战术托
      const body = box(0.08, 0.12, 0.6, poly); body.position.set(0, 0.02, 0);
      const barrel = cyl(0.05, 0.5, metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.07, -0.4);
      const muzzle = cyl(0.065, 0.07, glow); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.07, -0.66);
      const drum = cyl(0.13, 0.12, metal); drum.rotation.x = Math.PI / 2; drum.position.set(0, -0.1, 0.02);
      const stock = box(0.06, 0.1, 0.26, dark); stock.position.set(0, 0.01, 0.36);
      const grip = box(0.045, 0.12, 0.05, dark); grip.position.set(0, -0.11, 0.16);
      g.add(body, barrel, muzzle, drum, stock, grip);
    } else if (key === 'dmr') {
      // 精确射手步枪：长枪管 + 中倍镜 + 垂直握把
      const body = box(0.06, 0.11, 0.55, poly); body.position.set(0, 0.01, 0.02);
      const barrel = cyl(0.026, 0.5, metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.05, -0.5);
      const muzzle = cyl(0.04, 0.09, glow); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.05, -0.78);
      // v5.45 中倍镜镂空镜管
      const scope = new THREE.Group();
      { const st = 0.008, tl = 0.3, tw = 0.07, th = 0.055;
        const wT = box(tw, st, tl, dark); wT.position.y = th / 2;
        const wB = box(tw, st, tl, dark); wB.position.y = -th / 2;
        const wL = box(st, th, tl, dark); wL.position.x = -tw / 2;
        const wR = box(st, th, tl, dark); wR.position.x = tw / 2;
        const rF = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 16), metal); rF.position.z = -tl / 2;
        const rB = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 16), metal); rB.position.z = tl / 2;
        scope.add(wT, wB, wL, wR, rF, rB);
      }
      scope.position.set(0, 0.13, -0.06);
      g.userData.scopeLocal = { x: 0, y: 0.13, z: -0.06 };
      const mag = box(0.05, 0.14, 0.08, metal); mag.position.set(0, -0.11, -0.12); mag.rotation.x = 0.2;
      const stock = box(0.055, 0.09, 0.28, poly); stock.position.set(0, -0.01, 0.34);
      const grip = box(0.045, 0.12, 0.05, dark); grip.position.set(0, -0.1, 0.14);
      g.add(body, barrel, muzzle, scope, mag, stock, grip);
    } else {
      // ar 自动步枪（默认）
      const body = box(0.07, 0.11, 0.5, poly); body.position.set(0, 0.01, 0);
      const barrel = cyl(0.03, 0.4, metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.05, -0.46);
      const muzzle = cyl(0.042, 0.08, glow); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.05, -0.68);
      const mag = box(0.055, 0.17, 0.1, metal); mag.position.set(0, -0.14, 0.02); mag.rotation.x = 0.25;
      const stock = box(0.06, 0.1, 0.24, poly); stock.position.set(0, -0.01, 0.32);
      const grip = box(0.045, 0.12, 0.05, dark); grip.position.set(0, -0.1, 0.16);
      const sight = redDotSight(); sight.position.set(0, 0.12, -0.04);
      g.add(body, barrel, muzzle, mag, stock, grip, sight);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    return g;
  }

  // ---- 道具/装备模型 ----
  function buildGadgetModel(key) {
    const g = new THREE.Group();
    const mat = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.5 : r, metalness: m === undefined ? 0.5 : m });
    const metal = mat(0x2a2e34, 0.35, 0.85);
    const dark = mat(0x14171b, 0.4, 0.7);
    if (key === 'rocket') {
      const tube = cyl(0.09, 0.62, metal); tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.03, -0.3);
      const muzzle = cyl(0.11, 0.1, dark); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.03, -0.64);
      const grip = box(0.05, 0.13, 0.06, dark); grip.position.set(0, -0.13, 0.12);
      const sight = box(0.03, 0.05, 0.06, dark); sight.position.set(0, 0.13, 0.05);
      g.add(tube, muzzle, grip, sight);
    } else if (key === 'ammo') {
      const body = box(0.24, 0.16, 0.34, mat(0x4a4a3a, 0.8, 0.1)); body.position.set(0, -0.06, -0.2);
      const lid = box(0.26, 0.04, 0.36, mat(0x3a3a2e, 0.8, 0.1)); lid.position.set(0, 0.05, -0.2);
      const handle = box(0.04, 0.05, 0.14, dark); handle.position.set(0, 0.1, -0.2);
      const mark = box(0.06, 0.1, 0.02, mat(0xd04a3e)); mark.position.set(0, -0.06, -0.02);
      g.add(body, lid, handle, mark);
    } else if (key === 'flare') {
      const tube = cyl(0.05, 0.22, metal); tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.03, -0.16);
      const frame = box(0.06, 0.1, 0.16, dark); frame.position.set(0, -0.05, 0.02);
      const grip = box(0.05, 0.13, 0.08, dark); grip.position.set(0, -0.12, 0.06); grip.rotation.x = 0.2;
      g.add(tube, frame, grip);
    } else if (key === 'mortar') {
      // 迫击炮：斜置炮管 + 圆形座钣
      const tube = cyl(0.09, 0.8, metal);
      tube.rotation.x = Math.PI / 2 - 0.45;   // 上扬 45°
      tube.position.set(0, 0.02, -0.2);
      const muzzle = cyl(0.11, 0.08, dark);
      muzzle.rotation.x = Math.PI / 2 - 0.45;
      muzzle.position.set(0, 0.3, -0.44);
      const base = cyl(0.24, 0.05, dark);
      base.rotation.x = Math.PI / 2;
      base.position.set(0, -0.28, 0.06);
      const bipod = box(0.05, 0.26, 0.05, dark);
      bipod.position.set(0, -0.1, 0.14);
      g.add(tube, muzzle, base, bipod);
    } else if (key === 'medkit') {
      // 医疗箱：箱体 + 白色十字
      const bag = box(0.2, 0.14, 0.26, mat(0x3a7a4a, 0.7, 0.1)); bag.position.set(0, -0.05, -0.18);
      const cross1 = box(0.16, 0.035, 0.02, mat(0xf0f0f0, 0.5, 0.2)); cross1.position.set(0, -0.05, -0.04);
      const cross2 = box(0.035, 0.16, 0.02, mat(0xf0f0f0, 0.5, 0.2)); cross2.position.set(0, -0.05, -0.04);
      g.add(bag, cross1, cross2);
    } else {
      // 下挂榴弹发射器
      const tube = cyl(0.07, 0.36, metal); tube.rotation.x = Math.PI / 2; tube.position.set(0, -0.04, -0.3);
      const muzzle = cyl(0.09, 0.08, dark); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.04, -0.5);
      const grip = box(0.05, 0.11, 0.06, dark); grip.position.set(0, -0.14, 0.06);
      g.add(tube, muzzle, grip);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    return g;
  }

  function syncModel() {
    const s = Game.player;
    P.lastSlot = s.slot; P.lastClsKey = s.clsKey;   // v5.25 记录模型状态供自动对账
    if (s.slot === 'gadget') {
      for (const k in P.models) P.models[k].visible = false;
      for (const k in P.gadgetModels) P.gadgetModels[k].visible = (k === s.gadget);
      return;
    }
    const key = s.slot === 'primary' ? s.cls.weapon : 'pistol';
    for (const k in P.models) P.models[k].visible = (k === key);
    for (const k in P.gadgetModels) P.gadgetModels[k].visible = false;
  }

  function buildViewmodel() {
    P.view = new THREE.Group();
    P.models = {};
    for (const k in WEAPONS) {
      const m = buildGunModel(k); m.visible = false; P.view.add(m); P.models[k] = m;
    }
    P.gadgetModels = {};
    for (const k in GADGETS) {
      const m = buildGadgetModel(k); m.visible = false; P.view.add(m); P.gadgetModels[k] = m;
    }
    // v5.17 拉栓动画部件索引（含 userData.bolt 的枪型）
    P.boltParts = {};
    for (const k in P.models) { if (P.models[k].userData && P.models[k].userData.bolt) P.boltParts[k] = P.models[k].userData.bolt; }
    P.view.position.set(0.34, -0.31, -0.6);
    P.view.rotation.y = 0.03;
    Game.camera.add(P.view);
    P.muzzleLocal = new THREE.Vector3(0, 0.05, -0.68);
    P.hipPos = new THREE.Vector3(0.34, -0.31, -0.6);
    P.adsPos = new THREE.Vector3(0, -0.125, -0.34);
    syncModel();
  }

  function update(dt) {
    const s = Game.player;
    if (!Game.running || Game.over || !s) return;
    updateMortarCam(dt);   // v5.13 炮弹跟随视角（先于死亡/部署分支，保证全程平滑）
    updateCamFly(dt);       // v5.32 部署飞行视角（天上 → 士兵，渐快）
    // v5.25 枪模自动对账：换兵种/重生/直接改槽后无需手动切枪刷新
    if (P.lastSlot !== s.slot || P.lastClsKey !== s.clsKey) syncModel();
    if (!s.alive) { P.switching = 0; P.pendingSlot = null; P.ads = false; updateViewmodel(dt, 0); return; }
    if (s.ridingVehicle) { P.switching = 0; P.pendingSlot = null; return; } // 载具控制由 vehicles.js 处理
    if (P.mortarDeployed) { updateViewmodel(dt, 0); return; }   // v5.7 部署状态：禁止移动/射击，专注地图选点

    const wslot = Game.weapons.activeWeapon(s);
    let wdef = wslot ? wslot.def : null;
    // v5.10 可开镜装备（工程兵 RPG）：装备槽也支持 ADS/狙击镜遮罩
    if (!wdef && s.slot === 'gadget') {
      const gd = GADGETS[s.gadget];
      if (gd && gd.scope) wdef = gd;
    }
    // v5.45 镜枪：读取枪模上的镜管位置，用于开镜时对准屏幕中心
    P.scopeLocal = null;
    if (wdef && wdef.scope && wslot && P.models && P.models[wdef.key] && P.models[wdef.key].userData.scopeLocal) {
      P.scopeLocal = P.models[wdef.key].userData.scopeLocal;
    }

    // --- ADS 缓动（adsK 线性爬升 + easeInOutCubic 塑形；出镜快 1.25×） ---
    if (s.reloading) P.ads = false; // 换弹强制退出开镜
    // v5.17 拉栓期间强制收镜（拉完按住右键自动恢复开镜）
    const bolting = wslot && wslot.def.boltTime && s.boltT > 0;
    const adsWant = P.ads && P.switching <= 0 && wdef && !bolting ? 1 : 0;
    const adsRate = wdef ? (adsWant > 0 ? 1 / wdef.adsTime : 1 / (wdef.adsTime * 0.8)) : 1;
    P.adsK = M.clamp(P.adsK + (adsWant > 0 ? adsRate : -adsRate) * dt, 0, 1);
    P.adsEase = M.easeInOutCubic(P.adsK);
    // 灵敏度缩放（tan 半角比；狙击镜钳到 0.18 下限）
    if (wdef) {
      P.sensScale = M.lerp(1, M.clamp(Math.tan(wdef.adsFov * Math.PI / 360) / Math.tan(75 * Math.PI / 360), 0.18, 1), P.adsEase);
    }

    // --- 换枪两段状态机：倒计时独立运行（修 bug：切完一瞬间计时器冻结半途）；
    //     到 drawTime 时刻切换，之后计时继续归零，全程可再次发起换枪 ---
    if (P.switching > 0) {
      P.switching -= dt;
      if (P.pendingSlot && P.switching <= P.drawTime) {
        const slot = P.pendingSlot; P.pendingSlot = null;
        if (slot === 'gadget') { s.slot = 'gadget'; s.reloading = false; s.fireTimer = 0; s.spreadDeg = 0; }
        else Game.weapons.switchSlot(s, slot);
        P.lastSlot = s.slot;
        syncModel();
      }
      if (P.switching <= 0) P.switching = 0;
    }

    // --- 视角 ---
    if (P.locked) {
      s.yaw -= P.dx * 0.0022 * P.sensScale;
      s.pitch -= P.dy * 0.0022 * P.sensScale;
      s.pitch = M.clamp(s.pitch, -1.5, 1.5);
    }
    P.dx = P.dy = 0;

    // --- 移动（ADS 减速 40%） ---
    const fwd = (P.keys.has('KeyW') ? 1 : 0) - (P.keys.has('KeyS') ? 1 : 0);
    const strafe = (P.keys.has('KeyD') ? 1 : 0) - (P.keys.has('KeyA') ? 1 : 0);
    s.sprinting = (P.keys.has('ShiftLeft') || P.keys.has('ShiftRight')) && fwd > 0 && P.adsEase < 0.05;
    s.crouching = P.keys.has('KeyC') || P.keys.has('ControlLeft');
    let speed = s.crouching ? CONFIG.CROUCH_SPEED : (s.sprinting ? CONFIG.SPRINT_SPEED : CONFIG.WALK_SPEED);
    speed *= 1 - 0.40 * P.adsEase;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    let mx = fx * fwd + rx * strafe, mz = fz * fwd + rz * strafe;
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }
    const k = 1 - Math.exp(-12 * dt);
    s.vel.x += (mx * speed - s.vel.x) * k;
    s.vel.z += (mz * speed - s.vel.z) * k;
    s.moving = ml > 0.1;
    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;
    Game.terrain.resolveCircle(s.pos, s.radius);
    // 边界
    s.pos.x = M.clamp(s.pos.x, -CONFIG.WORLD + 1, CONFIG.WORLD - 1);
    s.pos.z = M.clamp(s.pos.z, -CONFIG.WORLD + 1, CONFIG.WORLD - 1);

    const gh = Game.heightAt(s.pos.x, s.pos.z);
    if (s.grounded) {
      if (s.pos.y <= gh + 0.05) s.pos.y = gh;
      else { s.grounded = false; s.fallStartY = s.pos.y; }
      if (P.keys.has('Space')) { s.vel.y = CONFIG.JUMP_VEL; s.grounded = false; s.fallStartY = s.pos.y; }
    } else {
      s.vel.y -= CONFIG.GRAVITY * dt;
      s.pos.y += s.vel.y * dt;
      if (s.pos.y <= gh) {
        // v5 坠落伤害
        const fall = s.fallStartY !== undefined ? (s.fallStartY - gh) : 0;
        s.pos.y = gh; s.vel.y = 0; s.grounded = true; s.fallStartY = undefined;
        if (fall > 0.8) P.landKick = Math.min(1, fall / 4);   // v5.10 落地顿挫
        if (fall > CONFIG.FALL_DMG_THRESHOLD) {
          Game.weapons.applyDamage(s, (fall - CONFIG.FALL_DMG_THRESHOLD) * CONFIG.FALL_DMG_PER_M, null, { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z });
        }
      }
    }

    // v5.38 工程兵维修载具（按住 E：停在受损友军载具旁持续维修）
    if (s.clsKey === 'engineer' && P.keys.has('KeyE')) {
      let best = null, bd = 6.5;
      for (const v of Game.vehicles) {
        if (!v.alive || v.hp >= v.maxHp || v.team !== s.team) continue;
        const d = M.dist2(v.pos.x, v.pos.z, s.pos.x, s.pos.z);
        if (d < bd) { bd = d; best = v; }
      }
      if (best) {
        s.vel.x = 0; s.vel.z = 0;   // 停下专心维修
        Game.Vehicles.repairVehicle(best, s, dt);
      }
    }

    // 速度比（bob 用）；移动扩散惩罚在 weapons.restSpreadDeg 按姿态实时计算
    const spdRatio = Math.hypot(s.vel.x, s.vel.z) / CONFIG.WALK_SPEED;

    // --- 脚步声 ---
    if (s.moving && s.grounded) {
      P.stepT -= dt;
      if (P.stepT <= 0) { P.stepT = s.sprinting ? 0.28 : 0.42; Game.sound.footstep(s.sprinting); }
    }

    // --- 开火（自动：按住扳机；半自动：点击缓冲；换枪期禁火） ---
    if (s.slot !== 'gadget' && P.switching <= 0) {
      const isAuto = wslot && wslot.def.auto && !s.semiMode;
      if (isAuto) {
        if (P.trigger) Game.weapons.fireWeapon(s);
      } else if (P.clickBuf > 0) {
        if (Game.weapons.fireWeapon(s)) P.clickBuf = 0;
      }
    }
    if (P.clickBuf > 0) P.clickBuf -= dt;

    // --- 镜头后坐视觉（viewKick 已由 onShotFired 设置） ---
    if (s.lastFireTime !== P.lastShot) { P.lastShot = s.lastFireTime; }

    // --- 相机（后坐弹簧叠加在瞄准角之上） ---
    const eye = Game.weapons.getEyePos(s);
    const targetFov = wdef ? M.lerp(75, wdef.adsFov, P.adsEase) : 75;
    P.fov += (targetFov - P.fov) * (1 - Math.exp(-12 * dt));
    Game.camera.fov = P.fov;
    Game.camera.updateProjectionMatrix();
    // v5.43 受击 Flinch 衰减（快速回中）
    if (P.flinchT > 0) {
      P.flinchT -= dt;
      const fk = 1 - Math.exp(-16 * dt);
      P.flinchPitch *= (1 - fk);
      P.flinchYaw *= (1 - fk);
      if (P.flinchT <= 0) { P.flinchT = 0; P.flinchPitch = 0; P.flinchYaw = 0; }
    }
    // v5.43 濒死呼吸晃动（低血量镜头随"呼吸"轻微起伏）
    let breath = 0;
    if (s.health <= 45 && s.alive) {
      const bk = 1 - s.health / 45;
      breath = Math.sin(Game.time * (2.2 + bk * 2.5)) * 0.004 * (0.4 + bk);
    }
    if (!P.mortarCam && !P.camFly) {   // v5.13/v5.32 跟随/飞行视角期间由专用逻辑接管相机
      const sh = Game.shake;
      const sx = (Math.random() * 2 - 1) * sh * 0.05, sy = (Math.random() * 2 - 1) * sh * 0.05;
      const rsh = sh * 0.08; // 角度摇晃
      Game.camera.position.set(eye.x + sx, eye.y + sy, eye.z);
      Game.camera.rotation.set(
        M.clamp(s.pitch + (s.recoilPitch ? s.recoilPitch.value : 0) + P.flinchPitch + breath, -1.5, 1.5) + (Math.random() * 2 - 1) * rsh,
        s.yaw + (s.recoilYaw ? s.recoilYaw.value : 0) + P.flinchYaw + (Math.random() * 2 - 1) * rsh,
        (Math.random() * 2 - 1) * rsh * 0.5, 'YXZ');
    }

    P.scoped = !!(wdef && wdef.scope && P.adsEase > 0.55);
    // v5.45 镜枪开镜不隐藏枪模（看穿镂空镜管）；非镜枪仍隐藏
    const scopedGun = !!(wdef && wdef.scope);
    if (P.view) P.view.visible = !(P.ads && P.adsEase > 0.5 && !scopedGun);
    updateViewmodel(dt, spdRatio);
  }

  function updateViewmodel(dt, spdRatio) {
    if (!P.view) return;
    // v5.45 平滑后坐：指数衰减，后移与回正都更顺滑
    P.viewKick *= Math.exp(-7 * dt);
    P.landKick *= Math.exp(-3.5 * dt);
    // 走路晃动
    if (Game.player.alive && Game.player.grounded && spdRatio > 0.1) {
      P.bobT += dt * (4 + spdRatio * 6);
    } else P.bobT += dt * 2;
    const bobX = Math.cos(P.bobT) * 0.012 * spdRatio;
    const bobY = Math.abs(Math.sin(P.bobT)) * 0.012 * spdRatio;
    // 换弹动画
    let reloadDip = 0;
    if (Game.player.reloading) {
      const slot = Game.player.slots[Game.player.slot];
      if (slot) { const prog = 1 - Game.player.reloadTimer / slot.def.reload; reloadDip = Math.sin(prog * Math.PI) * 0.45; }
    }
    // 换枪两段动画：收枪下探 → 掏枪回位
    let switchDip = 0;
    if (P.switching > 0 && P.switchTotal > 0) {
      const t = 1 - P.switching / P.switchTotal;
      const h = 0.22 / P.switchTotal; // 收枪段占比
      if (t < h) switchDip = M.easeOutCubic(t / h);
      else switchDip = 1 - M.easeOutCubic((t - h) / (1 - h));
    }
    // v5.17 栓动拉栓动画：拉栓柄后拉-上抬-回推（正弦周期），枪身微下沉
    const pw = Game.player.slots[Game.player.slot];
    const boltActive = pw && pw.def.boltTime && Game.player.boltT > 0;
    let boltWave = 0;
    if (boltActive) {
      boltWave = Math.sin((1 - Game.player.boltT / pw.def.boltTime) * Math.PI);
      if (P.boltParts && P.boltParts[pw.def.key]) {
        P.boltParts[pw.def.key].position.z = 0.1 * boltWave;
        P.boltParts[pw.def.key].rotation.y = 0.9 * boltWave;
      }
    }
    if (P.boltParts) {
      for (const bk in P.boltParts) {
        if (!(bk === (pw ? pw.def.key : null) && boltActive)) {
          P.boltParts[bk].position.z = 0; P.boltParts[bk].rotation.y = 0;
        }
      }
    }
    // 目标位置（瞄准 / 腰射 / v5.10 冲刺压低持枪）
    const sprinting = Game.player.sprinting && !(P.ads && P.adsEase > 0.5);
    let target = P.ads && P.adsEase > 0.5 ? P.adsPos : P.hipPos;
    // v5.45 镜枪开镜：把镂空镜管对准屏幕中心（看穿镜管）
    if (P.ads && P.adsEase > 0.5 && P.scopeLocal) {
      target = { x: -P.scopeLocal.x, y: -P.scopeLocal.y, z: -0.42 - P.scopeLocal.z };
    }
    const k = 1 - Math.exp(-14 * dt);
    P.view.position.x = M.lerp(P.view.position.x, target.x + bobX, k);
    P.view.position.y = M.lerp(P.view.position.y,
      target.y + bobY - P.viewKick * 0.03 - reloadDip * 0.12 - switchDip * 0.28 - P.landKick * 0.09 - (sprinting ? 0.07 : 0) - boltWave * 0.05, k);
    P.view.position.z = M.lerp(P.view.position.z, target.z + P.viewKick * 0.12 - reloadDip * 0.1 - (sprinting ? 0.05 : 0), k);
    // 开火后座 + 换弹/切枪旋转 + 冲刺前倾 + 落地点头 + 拉栓微倾
    P.view.rotation.x = M.lerp(P.view.rotation.x,
      P.viewKick * 0.2 + reloadDip * 0.9 + switchDip * 0.6 + (sprinting ? 0.28 : 0) + P.landKick * 0.16 + boltWave * 0.14, k);
  }

  P.init = init; P.update = update;
  Game.Player = P;
})();
