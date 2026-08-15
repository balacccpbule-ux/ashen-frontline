/* ============================================================
 * tests/test_spot.js — v5.12/v5.19 侦察系统 + 战地式加分
 * Q 标记（步兵/载具、锥角/LOS/冷却/得分）+ 载具隔墙透视高亮 + 开火自动暴露
 * v5.19：步兵不再高亮；标记成功不进上方提示、只进功绩
 * + 复仇/防守/助攻加分
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_spot: 侦察标记 + 加分 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9259);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // 布置：两个蓝方敌人（一个正前方 50m，一个侧方 40m），全部钉住
    const setup = await cdp.eval('(function(){' +
      'var G=Game; G.godMode=true;' +
      'var foes = G.bots.filter(function(b){return b.team===1 && !b.bot.crew;});' +
      'var f1=foes[0], f2=foes[1];' +
      'G.__pinned=[];' +
      'G.bots.forEach(function(b){ if (b===f1 || b===f2) return;' +
      '  var x = b.team===0 ? -78 : 78, z = b.team===0 ? -74 : 74;' +
      '  b.pos.x=x; b.pos.z=z; b.pos.y=G.heightAt(x,z); b.vel={x:0,y:0,z:0}; b.spawnProtect=0;' +
      '  G.__pinned.push({ id: b.id, x: x, z: z }); });' +
      'var p=G.player; p.pos.x=-108; p.pos.z=0; p.pos.y=G.heightAt(-108,0); p.spawnProtect=0; p.spotCooldown=0;' +
      'f1.pos.x=-108; f1.pos.z=20; f1.pos.y=G.heightAt(-108,20); f1.spawnProtect=0;' +
      'f2.pos.x=-92; f2.pos.z=0; f2.pos.y=G.heightAt(-92,0); f2.spawnProtect=0;' +   // 红基地压平区开阔地（避开楼群保证 LOS）
      'G.__f1=f1.id; G.__f2=f2.id;' +
      'return "ok";' +
      '})()');
    assert(setup === 'ok', '场景布置');

    // 1) 正前方敌人：标记成功 + 得分 + 进功绩（v5.19 步兵不再高亮、上方无提示）
    const r1 = await cdp.eval('(function(){' +
      'var G=Game; var p=G.player;' +
      'G.__msgs = []; var origMsg = G.hud.message; G.hud.message = function(t){ G.__msgs.push(t); };' +
      'p.yaw=Math.PI; p.pitch=0;' +   // 朝 +z（f1 方向）
      'var s0=p.score;' +
      'G.weapons.trySpot(p);' +
      'G.hud.message = origMsg;' +
      'G.effects.update(0.016);' +   // 高亮边框在 effects.update 中刷新
      'var f1=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__f1)f1=G.soldiers[k]; }' +
      'var outlineOn = G.effects.spotOutlines.some(function(l){ return l.visible; });' +
      'var meritEl = document.querySelector("#scorefeed .mf-entry[data-kind=spot]");' +
      'return JSON.stringify({ spotted: f1.spottedUntil > G.time, gain: p.score - s0, outline: outlineOn, msgs: G.__msgs.length, merit: !!meritEl });' +
      '})()');
    const a = JSON.parse(r1);
    assert(a.spotted === true, 'Q 标记正前方敌人');
    assert(a.gain === 25, '标记得分 +25（实测 ' + a.gain + '）');
    assert(a.outline === false, '步兵不再高亮显示（无边框）');
    assert(a.msgs === 0, '标记成功不在上方提示');
    assert(a.merit === true, '标记加入功绩系统');

    // 2) 冷却：立即再标记不重复得分
    const r2 = await cdp.eval('(function(){' +
      'var G=Game; var p=G.player; var s0=p.score;' +
      'G.weapons.trySpot(p);' +
      'return JSON.stringify({ gain: p.score - s0 });' +
      '})()');
    const b = JSON.parse(r2);
    assert(b.gain === 0, '冷却期内不重复得分（' + b.gain + '）');

    // 3) 锥角：侧方敌人不在准星内 → 不标记
    const r3 = await cdp.eval('(function(){' +
      'var G=Game; var p=G.player; p.spotCooldown=0;' +
      'G.weapons.trySpot(p);' +   // 仍朝 +z，f2 在 +x 方向 90° 外
      'var f2=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__f2)f2=G.soldiers[k]; }' +
      'var s0=p.score; p.spotCooldown=0;' +
      'var dx2=f2.pos.x-p.pos.x, dz2=f2.pos.z-p.pos.z;' +
      'p.yaw=Math.atan2(-dx2,-dz2); p.pitch=0;' +   // 转向 f2
      'G.weapons.trySpot(p);' +
      'return JSON.stringify({ f2Spotted: f2.spottedUntil > G.time, gain2: p.score - s0 });' +
      '})()');
    const c = JSON.parse(r3);
    assert(c.f2Spotted === true && c.gain2 === 25, '转向侧方敌人后可标记（+25）');

    // 4) LOS：建筑内的敌人无法标记
    const r4 = await cdp.eval('(function(){' +
      'var G=Game; var p=G.player; p.spotCooldown=0;' +
      'var bld = G.terrain.buildings.filter(function(s){return (s.kind==="building" || s.kind==="shack") && s.solid && s.blocksLOS;})[0];' +
      'var f3 = G.bots.filter(function(b){return b.team===1 && !b.bot.crew;})[2];' +
      'f3.pos.x = bld.cx; f3.pos.z = bld.cz; f3.pos.y = G.heightAt(bld.cx, bld.cz);' +
      'var dx = f3.pos.x - p.pos.x, dz = f3.pos.z - p.pos.z;' +
      'p.yaw = Math.atan2(-dx, -dz); p.pitch = 0;' +
      'var s0 = p.score;' +
      'G.weapons.trySpot(p);' +
      'return JSON.stringify({ spotted: f3.spottedUntil > G.time, gain: p.score - s0 });' +
      '})()');
    const d = JSON.parse(r4);
    assert(d.spotted === false && d.gain === 0, '视线被遮挡 → 无法标记');

    // 4.5) v5.19 载具标记：Q 可标记 + 隔墙透视高亮 + 开火自动暴露
    const r45 = await cdp.eval('(function(){' +
      'var G=Game; var p=G.player; p.spotCooldown=0;' +
      'var tank = G.vehicles.filter(function(v){ return v.kind==="tank" && v.team===1; })[0];' +
      'if (tank.occupant) G.Vehicles.exit(tank.occupant);' +
      'tank.pos.x = -108; tank.pos.z = 15; tank.pos.y = G.heightAt(-108, 15); tank.vel = {x:0,y:0,z:0};' +   // 基地压平区内（沙漠沙丘会挡 LOS，须在压平区）
      'tank.spottedUntil = 0;' +
      'var f1x=null, f2x=null; for (var k=0;k<G.soldiers.length;k++){ var ss=G.soldiers[k]; if(ss.id===G.__f1)f1x=ss; if(ss.id===G.__f2)f2x=ss; }' +
      'if (f1x){ f1x.pos.x=120; f1x.pos.z=120; f1x.pos.y=G.heightAt(120,120); }' +
      'if (f2x){ f2x.pos.x=120; f2x.pos.z=-120; f2x.pos.y=G.heightAt(120,-120); }' +
      'p.yaw = Math.PI; p.pitch = 0;' +   // 朝 +z（载具方向）
      'var s0 = p.score;' +
      'G.weapons.trySpot(p);' +
      'G.effects.update(0.016);' +
      'var outline = G.effects.spotOutlines.filter(function(l){ return l.visible; });' +
      'var wallHack = outline.length > 0 && outline[0].material.depthTest === false && outline[0].renderOrder >= 900;' +
      'var near = outline.length > 0 ? Math.hypot(outline[0].position.x - tank.pos.x, outline[0].position.z - tank.pos.z) < 2 : false;' +
      'var spotEl = document.querySelector("#scorefeed .mf-entry[data-kind=spot]");' +
      'var spotN = spotEl ? spotEl.getAttribute("data-n") : -1;' +
      'return JSON.stringify({ spotted: tank.spottedUntil > G.time, gain: p.score - s0, outlineCount: outline.length, wallHack: wallHack, near: near, spotN: spotN });' +
      '})()');
    const e2 = JSON.parse(r45);
    assert(e2.spotted === true, 'Q 可标记载具');
    assert(e2.gain === 25, '载具标记得分 +25（实测 ' + e2.gain + '）');
    assert(e2.outlineCount === 0, 'v5.39 取消载具 3D 高亮（无边框）');
    assert(e2.spotN === '3', '步兵/载具标记累加同一功绩（×' + e2.spotN + '）');

    // 4.6) 载具开火 → 自动标记（暴露）
    const r46 = await cdp.eval('(function(){' +
      'var G=Game; var tank=null;' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].kind==="tank" && G.vehicles[j].team===1) tank=G.vehicles[j]; }' +
      'var driver = G.bots.filter(function(b){ return b.team===1 && b.bot.crew==="tank"; })[0];' +
      'if (!tank.occupant) G.Vehicles.enter(tank, driver);' +
      'tank.spottedUntil = 0;' +
      'G.Vehicles.fireSecondary(tank);' +   // 车载机枪开火 → 自动暴露
      'return JSON.stringify({ exposed: tank.spottedUntil > G.time });' +
      '})()');
    assert(JSON.parse(r46).exposed === true, '载具开火自动标记（暴露）');

    // 5) 复仇 + 防守 + 助攻加分
    const r5 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'var reds = G.bots.filter(function(b){return b.team===0 && !b.bot.crew;});' +
      'var blues = G.bots.filter(function(b){return b.team===1 && !b.bot.crew;});' +
      'var D=reds[0], E=blues[0], A=reds[1], B=blues[1], C=reds[2];' +
      'G.flags[0].owner = 0;' +   // A 旗归红方（防守击杀判定）
      'E.pos.x = -50; E.pos.z = -20; E.pos.y = G.heightAt(-50,-20); E.spawnProtect = 0;' +
      'D.pos.x = -52; D.pos.z = -20; D.pos.y = G.heightAt(-52,-20); D.spawnProtect = 0;' +
      'B.pos.x = -40; B.pos.z = -20; B.pos.y = G.heightAt(-40,-20); B.spawnProtect = 0;' +
      'A.pos.x = -42; A.pos.z = -20; A.pos.y = G.heightAt(-42,-20); A.spawnProtect = 0;' +
      'C.pos.x = -44; C.pos.z = -20; C.pos.y = G.heightAt(-44,-20); C.spawnProtect = 0;' +
      'G.weapons.kill(D, E, false);' +      // E 击杀 D → D.lastKiller = E
      'G.ai.respawn(D);' +
      'var d0 = D.score;' +
      'G.weapons.kill(E, D, false);' +      // D 复仇击杀 E（E 在红方旗 A 附近？(-50,-20) 距旗 A(0,-20) 50m > 30 → 无防守加分，仅复仇）
      'var revengeGain = D.score - d0;' +
      'var a0 = A.score;' +
      'var c0 = C.score;' +   // C 的致命一击前记分
      'G.weapons.applyDamage(B, 60, A, B.pos);' +   // A 造成 60 伤害（助攻）
      'G.weapons.applyDamage(B, 40, C, B.pos);' +   // C 补 40 → 击杀（内部走 kill）
      'var assistGain = A.score - a0;' +
      'var killGain = C.score - c0;' +
      'return JSON.stringify({ revengeGain: revengeGain, assistGain: assistGain, killGain: killGain });' +
      '})()');
    const e = JSON.parse(r5);
    assert(e.revengeGain === 150, '复仇击杀 +150（100 基础 + 50 复仇，实测 ' + e.revengeGain + '）');
    assert(e.assistGain === 50, '助攻 +50（实测 ' + e.assistGain + '）');
    assert(e.killGain === 100, '基础击杀 +100（实测 ' + e.killGain + '）');

    // 6) 得分播报 DOM
    const r6 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'G.hud.scoreFeed("测试 +50", "#ffd27a");' +
      'return document.getElementById("scorefeed").children.length;' +
      '})()');
    assert(r6 >= 1, '得分播报条目显示');

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_spot');
})();
