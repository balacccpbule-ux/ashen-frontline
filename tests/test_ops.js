/* ============================================================
 * tests/test_ops.js — v5.38 玩法补齐 + 表现力（A+B 路线）
 * 1) 工程兵维修载具（持续回血 + 维修功绩计分）
 * 2) 装甲车机枪位（第二乘员，司机不被赶下车）
 * 3) 烟雾弹（烟墙遮挡视线 + 到期消散）
 * 4) 濒死反馈（心跳音 + 低血量暗角）
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_ops: 玩法补齐 + 表现力 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9267);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    await cdp.eval('(function(){' +
      'var G=Game; G.godMode=true;' +
      'G.applySelection("conquest", "desert"); G.deployPlayer(); G.godMode=true;' +
      'G.bots.forEach(function(b){ if (b.clsKey==="mortar") { b.gadgetAmmo = 0; b.bot.mortarT = undefined; } });' +
      'G.__pinned = [];' +
      'G.bots.forEach(function(b){' +
      '  var px = b.team===0 ? -78 : 78, pz = b.team===0 ? -74 : 74;' +
      '  b.pos.x=px; b.pos.z=pz; b.pos.y=G.heightAt(px,pz); b.vel={x:0,y:0,z:0}; b.spawnProtect=0;' +
      '  G.__pinned.push({ id: b.id, x: px, z: pz }); });' +
      'G.vehicles.forEach(function(v){ if (v.occupant) G.Vehicles.exit(v.occupant);' +
      '  v.pos.x = v.team===0 ? -68 : 68; v.pos.z = v.team===0 ? 55 : -55; v.pos.y = G.heightAt(v.pos.x, v.pos.z); v.vel = {x:0,y:0,z:0}; });' +
      'return "ok"; })()');

    const step = (frames) => cdp.eval('(function(){ var G=Game;' +
      'for (var i=0;i<' + frames + ';i++){ var dt=1/30; G.time+=dt;' +
      '  for (var p=0;p<G.__pinned.length;p++){ var pb=G.__pinned[p]; var bot=G.soldiers[pb.id];' +
      '    bot.pos.x=pb.x; bot.pos.z=pb.z; bot.pos.y=G.heightAt(pb.x,pb.z); bot.vel={x:0,y:0,z:0}; }' +
      '  for (var q=0;q<G.vehicles.length;q++){ var vv=G.vehicles[q];' +
      '    vv.pos.x = vv.team===0 ? -68 : 68; vv.pos.z = vv.team===0 ? 55 : -55;' +
      '    vv.pos.y = G.heightAt(vv.pos.x, vv.pos.z); vv.vel={x:0,y:0,z:0}; }' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt); G.hud.update(dt); }' +
      'return "ok"; })()');

    // ---- 1) 工程兵维修载具 ----
    const r1 = await cdp.eval('(function(){ var G=Game;' +
      'G.hud.selectClass("engineer"); G.deployPlayer();' +
      'var p=G.player; p.pos.x=-108; p.pos.z=0; p.pos.y=G.heightAt(-108,0); p.vel={x:0,y:0,z:0};' +
      'var tank = G.vehicles.filter(function(v){ return v.kind==="tank" && v.team===0; })[0];' +
      'tank.pos.x = -108; tank.pos.z = 3; tank.pos.y = G.heightAt(-108,3); tank.vel={x:0,y:0,z:0};' +
      'tank.hp = 300;' +
      'G.Player.keys.add("KeyE");' +
      'var t0 = Game.time; var hp0 = tank.hp; var s0 = p.score;' +
      'for (var i=0;i<90;i++){ var dt=1/30; G.time+=dt;' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt); G.hud.update(dt); }' +
      'G.Player.keys.delete("KeyE");' +
      'var repairMerit = false; var kids = document.getElementById("scorefeed").children;' +
      'for (var k=0;k<kids.length;k++){ if (kids[k].getAttribute("data-kind")==="repair") repairMerit = true; }' +
      'return JSON.stringify({ hpGain: Math.round(tank.hp - hp0), scoreGain: p.score - s0, repairMerit: repairMerit, heartbeat: typeof Game.sound.heartbeat === "function" });' +
      '})()');
    const a = JSON.parse(r1);
    assert(a.hpGain >= 50, '工程兵按住 E 维修载具（3 秒回血 +' + a.hpGain + '）');
    assert(a.scoreGain > 0 && a.repairMerit === true, '维修计分并进功绩（+ ' + a.scoreGain + '）');
    assert(a.heartbeat === true, '濒死心跳音已接入');

    // ---- 2) 玩家接管 AI 驾驶的载具（v5.40：AI 司机被请下车，玩家接管驾驶） ----
    const r2 = await cdp.eval('(function(){ var G=Game;' +
      'var p=G.player; p.pos.x=-108; p.pos.z=0; p.pos.y=G.heightAt(-108,0); p.vel={x:0,y:0,z:0};' +
      'var tank = G.vehicles.filter(function(v){ return v.kind==="tank" && v.team===0; })[0];' +
      'tank.pos.x = -108; tank.pos.z = -15; tank.pos.y = G.heightAt(-108,-15); tank.vel={x:0,y:0,z:0};' +   // 移走坦克，确保 APC 最近
      'var apc = G.vehicles.filter(function(v){ return v.kind==="apc" && v.team===0; })[0];' +
      'apc.pos.x = -108; apc.pos.z = 4; apc.pos.y = G.heightAt(-108,4); apc.vel={x:0,y:0,z:0};' +
      'var driver = G.bots.filter(function(b){ return b.team===0 && b.bot.crew==="apc"; })[0];' +
      'G.Vehicles.enter(apc, driver);' +
      'G.Vehicles.tryInteract(p);' +   // 玩家接管驾驶（AI 司机被请下车，不再由 AI 控制）
      'var takeoverOk = apc.occupant === p && apc.gunner === null && driver.ridingVehicle === null;' +
      'var n0 = G.sound._log.length;' +
      'G.Player.trigger = true;' +
      'var dt=1/30; G.time+=dt;' +
      'if (G.player.alive) G.Player.update(dt);' +
      'G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      'G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt);' +
      'G.Player.trigger = false;' +
      'var fired = G.sound._log.length > n0;' +
      'G.Vehicles.exit(p);' +
      'var exitOk = apc.occupant === null && p.ridingVehicle === null;' +
      'return JSON.stringify({ takeoverOk: takeoverOk, fired: fired, exitOk: exitOk });' +
      '})()');
    const b = JSON.parse(r2);
    assert(b.takeoverOk === true, '玩家接管 AI 驾驶的载具（AI 司机被请下车）');
    assert(b.fired === true, '接管后可开火');
    assert(b.exitOk === true, '下车后驾驶位释放');

    // ---- 3) 烟雾弹 ----
    const r3 = await cdp.eval('(function(){ var G=Game;' +
      'var p=G.player; p.pos.x=-108; p.pos.z=0; p.pos.y=G.heightAt(-108,0); p.vel={x:0,y:0,z:0};' +
      'p.yaw = -Math.PI/2; p.pitch = 0;' +   // 朝地图内（+x 方向）
      'var s0 = p.smoke;' +
      'G.weapons.throwSmoke(p);' +
      'var s1 = p.smoke;' +
      'var nProj = G.projectiles.filter(function(pr){ return pr.kind==="smoke"; }).length;' +
      'return JSON.stringify({ s0: s0, s1: s1, nProj: nProj });' +
      '})()');
    const c = JSON.parse(r3);
    assert(c.s0 === 1 && c.s1 === 0, '烟雾弹投掷（备弹 1→0）');
    assert(c.nProj === 1, '烟雾弹飞行中');
    await step(90);   // 3 秒：引信 1.6s + 落地 → 烟墙
    const r4 = await cdp.eval('(function(){ var G=Game;' +
      'var z = G.effects.smokeZones[0];' +
      'if (!z) return JSON.stringify({ zones: 0, blocked: false });' +
      'var blocked = G.terrain.blocksLOS(z.x - 14, z.y + 1.6, z.z - 14, z.x + 14, z.y + 1.6, z.z + 14);' +
      'var clear = !G.terrain.blocksLOS(z.x - 60, z.y + 1.6, z.z, z.x - 40, z.y + 1.6, z.z);' +
      'return JSON.stringify({ zones: G.effects.smokeZones.length, blocked: blocked, clear: clear });' +
      '})()');
    const d = JSON.parse(r4);
    assert(d.zones >= 1, '烟墙生成（' + d.zones + ' 个）');
    assert(d.blocked === true, '烟墙遮挡视线（blocksLOS=true）');
    await step(420);   // 14 秒后消散
    const r5 = await cdp.eval('(function(){ return Game.effects.smokeZones.length; })()');
    assert(r5 === 0, '烟墙到期消散');

    // ---- 4) 濒死反馈 ----
    const r6 = await cdp.eval('(function(){ var G=Game;' +
      'G.Player.keys.delete("KeyE"); G.hud.selectClass("assault"); G.deployPlayer();' +
      'var p=G.player; p.spawnProtect = 0; p.health = 30;' +
      'G.hud.update(1/30);' +
      'var on = !document.getElementById("lowhp").classList.contains("hidden");' +
      'return JSON.stringify({ on: on, op: parseFloat(document.getElementById("lowhp").style.opacity) });' +
      '})()');
    const e = JSON.parse(r6);
    assert(e.on === true && e.op > 0.2, '低血量暗角红晕显示（opacity ' + e.op + '）');

    const errors = cdp.errors();
    for (const err of errors) console.error('  !! ' + err);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_ops');
})();
