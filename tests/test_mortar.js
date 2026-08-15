/* ============================================================
 * tests/test_mortar.js — v5.5 迫击炮兵：高抛曲射 + AI 自动炮击
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_mortar: 迫击炮兵 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9255);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // 布置：迫击炮兵(-108,-8) 与蓝方目标(-108,33)（基地压平区周边，LOS 必通）
    const setup = await cdp.eval('(function(){' +
      'var G=Game; G.godMode=true;' +
      'var mort = G.bots.filter(function(b){ return b.team===0 && b.clsKey==="mortar" && !b.bot.crew; })[0];' +
      'var foe = G.bots.filter(function(b){ return b.team===1 && !b.bot.crew; })[0];' +
      'G.__pinned=[];' +
      'G.bots.forEach(function(b){ if (b===mort || b===foe) return;' +
      '  var x = b.team===0 ? -78 : 78, z = b.team===0 ? -74 : 74;' +
      '  b.pos.x=x; b.pos.z=z; b.pos.y=G.heightAt(x,z); b.vel={x:0,y:0,z:0}; b.spawnProtect=0;' +
      '  G.__pinned.push({ id: b.id, x: x, z: z }); });' +
      'mort.pos.x=-108; mort.pos.z=-8; mort.pos.y=G.heightAt(-108,-8); mort.spawnProtect=999;' +   // 无敌：防目标在炮击前反杀（保证测的是曲射路径）
      'foe.pos.x=-108; foe.pos.z=33; foe.pos.y=G.heightAt(-108,33); foe.spawnProtect=0; foe.deaths=0;' +
      'foe.spottedUntil = 99999;' +
      'G.__mortId=mort.id; G.__foeId=foe.id;' +
      'return JSON.stringify({ mortarBots: G.bots.filter(function(b){return b.clsKey==="mortar" && !b.bot.crew;}).length, ammo: mort.gadgetAmmo, gadget: GADGETS.mortar });' +
      '})()');
    const s = JSON.parse(setup);
    assert(s.mortarBots >= 1, '队伍中有迫击炮兵 (' + s.mortarBots + ')');
    assert(s.ammo === 6, '迫击炮 6 发备弹');
    assert(s.gadget.minRange === 15 && s.gadget.maxRange === 180 && s.gadget.damage === 300, '射程 15-180m · 溅射 300');

    const step = (frames) => cdp.eval('(function(){ var G=Game;' +
      'var mort=null, foe=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__mortId)mort=G.soldiers[k]; if(G.soldiers[k].id===G.__foeId)foe=G.soldiers[k]; }' +
      'for (var i=0;i<' + frames + ';i++){ var dt=1/30; G.time+=dt;' +
      '  mort.pos.x=-108; mort.pos.z=-8; mort.pos.y=G.heightAt(-108,-8); mort.vel={x:0,y:0,z:0};' +
      '  if (foe.alive){ foe.pos.x=-108; foe.pos.z=33; foe.pos.y=G.heightAt(-108,33); foe.vel={x:0,y:0,z:0}; }' +
      '  for (var p=0;p<G.__pinned.length;p++){ var pb=G.__pinned[p]; var bot=G.soldiers[pb.id];' +
      '    bot.pos.x=pb.x; bot.pos.z=pb.z; bot.pos.y=G.heightAt(pb.x,pb.z); bot.vel={x:0,y:0,z:0}; }' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt); }' +
      'return "ok"; })()');

    // 1) 指定落点直射（AI 路径：bot.mortarTarget）
    const r1 = await cdp.eval('(function(){ var G=Game; var mort=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__mortId)mort=G.soldiers[k]; }' +
      'var n0 = G.projectiles.length;' +
      'mort.bot.mortarTarget = { x: -108, z: 33 };' +
      'G.weapons.fireGadget(mort);' +
      'var n1 = G.projectiles.length;' +
      'var shell = G.projectiles[G.projectiles.length-1];' +
      'return JSON.stringify({ fired: n1-n0===1, kind: shell ? shell.kind : null, vy0: shell ? +shell.vel.y.toFixed(1) : 0, ammo: mort.gadgetAmmo,' +
      '  launch: G.sound._log.some(function(l){return l.n==="mortarLaunch";}) });' +
      '})()');
    const a = JSON.parse(r1);
    assert(a.fired === true && a.kind === 'mortarShell', '迫击炮弹发射（高抛弹道）');
    assert(a.vy0 > 5, '初速上扬（vy0=' + a.vy0 + '）');
    assert(a.ammo === 5, '弹药 -1');
    assert(a.launch === true, '出膛轰鸣音效（mortarLaunch）');

    await step(120);   // 4 秒：飞行 1.8s + 溅射
    const r2 = await cdp.eval('(function(){ var G=Game; var foe=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foeId)foe=G.soldiers[k]; }' +
      'return JSON.stringify({ deaths: foe.deaths, alive: foe.alive, hp: Math.round(foe.health),' +
      '  whistle: G.sound._log.some(function(l){return l.n==="mortarWhistle";}) }); })()');
    const b = JSON.parse(r2);
    assert(b.deaths >= 1, '炮弹落地溅射击杀目标（阵亡 ' + b.deaths + ' 次）');
    assert(b.whistle === true, '炮弹下落呼啸音效（mortarWhistle）');

    // 2) AI 自动炮击（think 分支，无视线压制）
    const r3 = await cdp.eval('(function(){ var G=Game; var foe=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foeId)foe=G.soldiers[k]; }' +
      'G.ai.respawn(foe); foe.deaths=0; foe.pos.x=-108; foe.pos.z=33; foe.pos.y=G.heightAt(-108,33); foe.spawnProtect=0; foe.spottedUntil=99999;' +
      'var mort=null; for (var j=0;j<G.soldiers.length;j++){ if(G.soldiers[j].id===G.__mortId)mort=G.soldiers[j]; }' +
      'mort.gadgetAmmo = 6; mort.gadgetCooldown = 0; mort.bot.mortarT = undefined;' +
      'return "ok"; })()');
    await step(300);   // 10 秒：索敌 + 1.5s 起手 + 炮击
    const r4 = await cdp.eval('(function(){ var G=Game; var foe=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foeId)foe=G.soldiers[k]; }' +
      'return JSON.stringify({ deaths: foe.deaths, alive: foe.alive }); })()');
    const c = JSON.parse(r4);
    assert(c.deaths >= 1, 'AI 自动曲射压制（目标阵亡 ' + c.deaths + ' 次）');

    // 3) 玩家路径：扳机部署 → 右下地图选点发射
    const r5 = await cdp.eval('(function(){ var G=Game;' +
      'G.hud.selectClass("mortar"); G.deployPlayer();' +
      'var p=G.player; p.pos.x=-108; p.pos.z=0; p.pos.y=G.heightAt(-108,0);' +
      'p.slot="gadget";' +
      'G.weapons.fireGadget(p);' +   // 扳机 → 部署（打开地图）
      'var deployed = G.Player.mortarDeployed === true;' +
      'var panelVisible = !document.getElementById("mortar-map-panel").classList.contains("hidden");' +
      'var near = G.weapons.fireMortarAt(p, -108, 10);' +      // 10m < 15 最小射程
      'var ammoNear = p.gadgetAmmo;' +
      'var far = G.weapons.fireMortarAt(p, -108, 180);' +      // 180m 上限
      'var ammoFar = p.gadgetAmmo;' +
      'var cam0 = G.Player.mortarCam;' +
      'var camOn = !!cam0 && cam0.phase === "fly" && cam0.proj.kind === "mortarShell";' +
      'var hintWhileDeployed = document.getElementById("pause-hint").classList.contains("hidden");' +
      'p.gadgetCooldown = 0;' +   // 清装填以便单独验证超射程拒绝
      'var tooFar = G.weapons.fireMortarAt(p, -108, 200);' +   // 超最大射程
      'var rect = document.getElementById("mortar-map").getBoundingClientRect();' +
      'var mid = G.hud.mortarCanvasToWorld(rect.left + 190, rect.top + 190);' +   // 画布中心 → 世界原点
      'G.Player.setMortarDeployed(false);' +
      'var undeployed = G.Player.mortarDeployed === false && document.getElementById("mortar-map-panel").classList.contains("hidden");' +
      'var hintAfter = document.getElementById("pause-hint").classList.contains("hidden");' +
      'return JSON.stringify({ deployed: deployed, panelVisible: panelVisible, near: near, ammoNear: ammoNear, far: far, ammoFar: ammoFar, tooFar: tooFar, midX: +mid.x.toFixed(1), midZ: +mid.z.toFixed(1), undeployed: undeployed, camOn: camOn, hintWhileDeployed: hintWhileDeployed, hintAfter: hintAfter,' +
      '  ambient: G.sound._log.some(function(l){return l.n==="ambientStart";}) });' +
      '})()');
    const d = JSON.parse(r5);
    assert(d.deployed === true && d.panelVisible === true, '按扳机 → 部署 + 右下地图自动打开');
    assert(d.near === 'too-close' && d.ammoNear === 6, '地图选点太近 → 拒绝且不耗弹（' + d.near + '/' + d.ammoNear + '）');
    assert(d.far === 'ok' && d.ammoFar === 5, '地图选点 180m → 发射（' + d.far + '/' + d.ammoFar + '）');
    assert(d.tooFar === 'too-far', '超出最大射程 → 拒绝');
    assert(Math.abs(d.midX) < 1 && Math.abs(d.midZ) < 1, '地图像素→世界坐标换算正确 (' + d.midX + ',' + d.midZ + ')');
    assert(d.undeployed === true, '右键/3 → 收起迫击炮并隐藏地图');
    assert(d.ambient === true, '部署时启动战场氛围音（ambientStart）');
    assert(d.camOn === true, '发射后切入炮弹第一人称跟随视角');
    assert(d.hintWhileDeployed === true, '部署时不显示「Esc 释放鼠标」提示');
    assert(d.hintAfter === false, '收起后提示恢复（仅部署时隐藏，非永久）');

    // 3.5) 炮弹跟随视角：随弹运动 + 始终朝向落点 + 爆炸后平滑切回
    const r6 = await cdp.eval('(function(){ var G=Game; var p=G.player; G.godMode=true;' +
      'p.gadgetAmmo = 6; p.gadgetCooldown = 0;' +
      'G.Player.setMortarDeployed(true);' +
      'var res = G.weapons.fireMortarAt(p, -108, 150);' +
      'var cam = G.Player.mortarCam;' +
      'return JSON.stringify({ res: res, camOn: !!cam && cam.phase==="fly" });' +
      '})()');
    const e = JSON.parse(r6);
    assert(e.res === 'ok' && e.camOn === true, '重新部署发射 → 镜头跟随 (' + e.res + ')');

    await step(45);   // 1.5 秒：飞行中段
    const r7 = await cdp.eval('(function(){ var G=Game; var cam=G.Player.mortarCam; var p=G.player;' +
      'var shell = cam ? cam.proj : null;' +
      'var eye = G.weapons.getEyePos(p);' +
      'var cd = cam && shell ? Math.hypot(cam.pos.x-shell.pos.x, cam.pos.y-shell.pos.y, cam.pos.z-shell.pos.z) : -1;' +
      'var pd = cam ? Math.hypot(cam.pos.x-eye.x, cam.pos.y-eye.y, cam.pos.z-eye.z) : -1;' +
      'var fwd = new THREE.Vector3(0,0,-1).applyQuaternion(G.camera.quaternion);' +
      'var toT = new THREE.Vector3(cam.tx-cam.pos.x, cam.ty-cam.pos.y, cam.tz-cam.pos.z).normalize();' +
      'var ang = Math.acos(Math.max(-1, Math.min(1, fwd.dot(toT)))) * 180 / Math.PI;' +
      'return JSON.stringify({ active: !!cam, cd: +cd.toFixed(1), pd: +pd.toFixed(1), ang: +ang.toFixed(1) });' +
      '})()');
    const f = JSON.parse(r7);
    assert(f.active === true, '飞行中镜头保持跟随');
    assert(f.cd < 8, '镜头贴随弹体（距 ' + f.cd + 'm < 8）');
    assert(f.pd > 40, '镜头已离开玩家视角（距玩家 ' + f.pd + 'm）');
    assert(f.ang < 8, '镜头始终朝向落点（夹角 ' + f.ang + '° < 8°）');

    await step(230);   // 飞行 4.41s + 悬停 1.15s + 切回 0.45s 之后
    const r8 = await cdp.eval('(function(){ var G=Game; var p=G.player;' +
      'var eye = G.weapons.getEyePos(p);' +
      'var d = Math.hypot(G.camera.position.x-eye.x, G.camera.position.y-eye.y, G.camera.position.z-eye.z);' +
      'return JSON.stringify({ camCleared: G.Player.mortarCam===null, d: +d.toFixed(2) });' +
      '})()');
    const h = JSON.parse(r8);
    assert(h.camCleared === true, '爆炸悬停后镜头切回（cam 已清除）');
    assert(h.d < 2, '切回玩家第一人称视角（偏差 ' + h.d + 'm < 2）');

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_mortar');
})();
