/* ============================================================
 * tests/test_minimap.js — v5.16 小地图情报：
 * 1) 敌方载具标注：有视野才显示（玩家/队友 LOS），无视野隐藏
 * 2) 反炮击预警：队友被敌方迫击炮命中 → 高亮敌方迫击炮手（无视视野），到期清除
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_minimap: 小地图情报 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9259);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // ---- 布置：沙漠图（默认）+ 清场 ----
    const setup = await cdp.eval('(function(){' +
      'var G=Game; G.godMode=true;' +
      'G.applySelection("conquest", "snow"); G.deployPlayer(); G.godMode=true;' +
      // v5.41 固定玩家位置到红基地，消除 deployPlayer 随机偏移导致的 LOS 断言偶发失败
      'G.player.pos.x = -108; G.player.pos.z = 0; G.player.pos.y = G.heightAt(-108, 0); G.player.vel = {x:0,y:0,z:0};' +
      // 红方迫击炮哑火（防止 AI 抢先炮击靶子）；蓝方迫击炮保留（反炮击预警主角）
      'G.bots.forEach(function(b){ if (b.clsKey==="mortar" && b.team===0) b.gadgetAmmo = 0; });' +
      'G.__blueMortar = G.bots.filter(function(b){ return b.clsKey==="mortar" && b.team===1 && !b.bot.crew; })[0];' +
      'G.__redMortar = G.bots.filter(function(b){ return b.clsKey==="mortar" && b.team===0 && !b.bot.crew; })[0];' +
      'G.__victim = G.bots.filter(function(b){ return b.team===0 && !b.bot.crew && b.clsKey!=="mortar"; })[0];' +
      'G.__pinned = [];' +
      'G.bots.forEach(function(b){ if (b===G.__blueMortar || b===G.__victim || b===G.__redMortar) return;' +
      '  var px = b.team===0 ? -78 : 78, pz = b.team===0 ? -74 : 74;' +
      '  b.pos.x=px; b.pos.z=pz; b.pos.y=G.heightAt(px,pz); b.vel={x:0,y:0,z:0}; b.spawnProtect=0;' +
      '  G.__pinned.push({ id: b.id, x: px, z: pz }); });' +
      'G.__vehPin = [];' +
      'G.vehicles.forEach(function(v){' +
      '  if (v.occupant) G.Vehicles.exit(v.occupant);' +
      '  G.__vehPin.push({ id: v.id, x: v.team===0 ? -68 : 68, z: v.team===0 ? 55 : -55, y: 30 });' +
      '});' +
      'G.__tank = G.vehicles.filter(function(v){ return v.kind==="tank" && v.team===1; })[0];' +
      // 蓝方迫击炮位：东侧开阔区（v5.44 5旗后需避开楼群/墙，否则炮弹出膛即炸）
      'var mortX = 60, mortZ = 30;' +
      'G.__mortPos = { x: mortX, z: mortZ };' +
      'G.__victimPos = { x: -105, z: 5 };' +   // 红基地压平区（开阔，新城区非网格后需更贴近基地）
      'var pe = G.weapons.getEyePos(G.player);' +
      'var mortLos = G.terrain.blocksLOS(pe.x, pe.y, pe.z, mortX, G.heightAt(mortX, mortZ) + 1.8, mortZ);' +
      'return JSON.stringify({ blueMortar: !!G.__blueMortar, victim: !!G.__victim, mortLos: mortLos });' +
      '})()');
    const s = JSON.parse(setup);
    assert(s.blueMortar === true && s.victim === true, '布置蓝方迫击炮兵与红方靶子');
    assert(s.mortLos === true, '迫击炮手对玩家无视野（楼群遮挡，blocksLOS=true）');

    // 步进助手（含 hud.update —— 驱动小地图视野判定与预警清理）
    const step = (frames) => cdp.eval('(function(){ var G=Game;' +
      'var mort=null, rmort=null, victim=null, tank=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ var ss=G.soldiers[k]; if(ss.id===G.__blueMortar.id)mort=ss; if(ss.id===G.__victim.id)victim=ss; if(ss.id===G.__redMortar.id)rmort=ss; }' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tank.id)tank=G.vehicles[j]; }' +
      'for (var i=0;i<' + frames + ';i++){ var dt=1/30; G.time+=dt;' +
      '  for (var p=0;p<G.__pinned.length;p++){ var pb=G.__pinned[p]; var bot=G.soldiers[pb.id];' +
      '    bot.pos.x=pb.x; bot.pos.z=pb.z; bot.pos.y=G.heightAt(pb.x,pb.z); bot.vel={x:0,y:0,z:0}; }' +
      '  if (mort && G.__mortPos){ mort.pos.x=G.__mortPos.x; mort.pos.z=G.__mortPos.z; mort.pos.y=G.heightAt(G.__mortPos.x,G.__mortPos.z); mort.vel={x:0,y:0,z:0}; mort.spawnProtect=999; }' +
      '  if (rmort && G.__rmortPos){ rmort.pos.x=G.__rmortPos.x; rmort.pos.z=G.__rmortPos.z; rmort.pos.y=G.heightAt(G.__rmortPos.x,G.__rmortPos.z); rmort.vel={x:0,y:0,z:0}; rmort.spawnProtect=0; }' +
      '  if (victim && G.__victimPos){ victim.pos.x=G.__victimPos.x; victim.pos.z=G.__victimPos.z; victim.pos.y=G.heightAt(G.__victimPos.x,G.__victimPos.z); victim.vel={x:0,y:0,z:0}; victim.spawnProtect=0; }' +
      '  for (var q=0;q<G.__vehPin.length;q++){ var vp=G.__vehPin[q]; var vv=null;' +
      '    for (var vk=0;vk<G.vehicles.length;vk++){ if(G.vehicles[vk].id===vp.id){ vv=G.vehicles[vk]; break; } }' +
      '    if (vv && vv!==tank){ vv.pos.x=vp.x; vv.pos.z=vp.z;' +
      '      vv.pos.y = vv.kind==="heli" ? vp.y : G.heightAt(vp.x,vp.z); vv.vel={x:0,y:0,z:0}; } }' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt);' +
      '  G.hud.update(dt); }' +
      'return "ok"; })()');

    // ---- 1) 敌方载具：有视野才标注 ----
    // A) 开阔位（红基地压平区，玩家 LOS 必通）→ 视野标注激活
    const r1 = await cdp.eval('(function(){ var G=Game; var tank=null;' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tank.id)tank=G.vehicles[j]; }' +
      'tank.pos.x = -100; tank.pos.z = 0; tank.pos.y = G.heightAt(-100, 0); tank.vel = {x:0,y:0,z:0};' +
      'tank.minimapSeenUntil = 0; tank.visCheckT = 0;' +
      'return "ok"; })()');
    await step(3);
    const a = await cdp.eval('(function(){ var G=Game; var tank=null;' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tank.id)tank=G.vehicles[j]; }' +
      'return JSON.stringify({ seen: tank.minimapSeenUntil > G.time }); })()');
    assert(JSON.parse(a).seen === true, '有视野 → 敌方载具被标注（minimapSeenUntil 激活）');

    // B) 楼群后（玩家无视野）→ 视野窗口过期后不再标注
    const r2 = await cdp.eval('(function(){ var G=Game; var tank=null;' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tank.id)tank=G.vehicles[j]; }' +
      'var pe = G.weapons.getEyePos(G.player);' +
      'tank.pos.x = 62; tank.pos.z = 12; tank.pos.y = G.heightAt(62, 12); tank.vel = {x:0,y:0,z:0};' +
      'tank.minimapSeenUntil = 0; tank.visCheckT = 0;' +
      'var los = G.terrain.blocksLOS(pe.x, pe.y, pe.z, tank.pos.x, tank.pos.y + 1.8, tank.pos.z);' +
      'return JSON.stringify({ los: los }); })()');
    const b = JSON.parse(r2);
    assert(b.los === true, '楼群后位置对玩家无视野（blocksLOS=true）');
    await step(50);   // 1.67s：节流 0.4s 复查 + 视野窗口 1.2s 过期
    const c = await cdp.eval('(function(){ var G=Game; var tank=null;' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tank.id)tank=G.vehicles[j]; }' +
      'return JSON.stringify({ seen: tank.minimapSeenUntil > G.time }); })()');
    assert(JSON.parse(c).seen === false, '无视野 → 敌方载具不标注（窗口过期后隐藏）');

    // ---- 2) 反炮击预警：队友被敌方迫击炮命中 → 无视视野高亮迫击炮手 ----
    await cdp.eval('(function(){ var G=Game;' +
      'var mort=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__blueMortar.id)mort=G.soldiers[k]; }' +
      'mort.gadgetAmmo = 6; mort.gadgetCooldown = 0; mort.bot.mortarT = undefined;' +   // 确保蓝方迫击炮有弹可发
      'mort.bot.mortarTarget = { x: -105, z: 5 };' +
      'G.weapons.fireGadget(mort);' +
      'return "ok"; })()');
    await step(140);   // 4.7s：弹道 3.9s + 溅射
    const r3 = await cdp.eval('(function(){ var G=Game;' +
      'var mort=null, victim=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ var ss=G.soldiers[k]; if(ss.id===G.__blueMortar.id)mort=ss; if(ss.id===G.__victim.id)victim=ss; }' +
      'var reveals = G.hud.mortarReveals || [];' +
      'var hit = reveals.some(function(r){ return r.s.id === mort.id && r.until > G.time; });' +
      'return JSON.stringify({ victimHp: Math.round(victim.health), reveals: reveals.length, hit: hit });' +
      '})()');
    const d = JSON.parse(r3);
    assert(d.victimHp < 100, '队友被敌方迫击炮命中（HP ' + d.victimHp + '/100）');
    assert(d.hit === true, '敌方迫击炮手位置被高亮标注（无视视野，reveals=' + d.reveals + '）');

    // ---- 3) v5.26 AI 反迫击炮：敌方迫击炮暴露 → 我方迫击炮反打 + 开火自动暴露 ----
    await cdp.eval('(function(){ var G=Game;' +
      'var rm=null, bm=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ var ss=G.soldiers[k]; if(ss.id===G.__redMortar.id)rm=ss; if(ss.id===G.__blueMortar.id)bm=ss; }' +
      'G.__rmortPos = { x: -55, z: 10 };' +
      'G.__mortPos = { x: 55, z: 10 };' +   // 蓝迫击炮挪到 55,10（距红 110m，避开油罐/墙）
      'G.bots.forEach(function(b){ if (b.clsKey==="mortar" && b.team===1 && b !== bm) b.gadgetAmmo = 0; });' +   // 其余蓝迫击炮哑火（只留主角反打）
      'rm.spottedUntil = G.time + 99;' +   // 红方迫击炮开火暴露
      'bm.gadgetAmmo = 6; bm.gadgetCooldown = 0; bm.bot.mortarT = 0;' +
      'G.__origFG = G.weapons.fireGadget;' +
      'G.__cb = null;' +
      'G.weapons.fireGadget = function(s){ if (s.id === bm.id) { var t = s.bot.mortarTarget; if (t) G.__cb = { x: t.x, z: t.z }; } return G.__origFG.call(G.weapons, s); };' +
      'return "ok"; })()');
    await step(15);   // 0.5 秒：AI 索敌反打
    const r9 = await cdp.eval('(function(){ var G=Game;' +
      'var bm=null, rm=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ var ss=G.soldiers[k]; if(ss.id===G.__blueMortar.id)bm=ss; if(ss.id===G.__redMortar.id)rm=ss; }' +
      'var fired = !!G.__cb;' +
      'var onTarget = fired && Math.abs(G.__cb.x + 55) <= 12 && Math.abs(G.__cb.z - 10) <= 12;' +
      'var exposed = bm.spottedUntil > G.time;' +
      'G.weapons.fireGadget = G.__origFG;' +
      'return JSON.stringify({ fired: fired, onTarget: onTarget, exposed: exposed, cb: G.__cb });' +
      '})()');
    const g2 = JSON.parse(r9);
    assert(g2.fired === true && g2.onTarget === true, 'AI 反迫击炮：蓝方迫击炮反打暴露的红方迫击炮（' + JSON.stringify(g2.cb) + '）');
    assert(g2.exposed === true, '迫击炮开火自动暴露（spottedUntil）');

    // 到期清除（哑火后等全部预警过 8 秒寿命）
    await cdp.eval('(function(){ var G=Game;' +
      'var bm=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__blueMortar.id)bm=G.soldiers[k]; }' +
      'bm.gadgetAmmo = 0; bm.bot.mortarT = 999999;' +   // 停火，防新预警刷新
      'return "ok"; })()');
    await step(400);   // 13.3 秒
    const r4 = await cdp.eval('(function(){ var G=Game;' +
      'return JSON.stringify({ reveals: (G.hud.mortarReveals || []).length }); })()');
    assert(JSON.parse(r4).reveals === 0, '预警到期后清除（' + JSON.parse(r4).reveals + ' 条）');

    const errors = cdp.errors();
    for (const err of errors) console.error('  !! ' + err);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_minimap');
})();
