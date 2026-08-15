/* ============================================================
 * tests/test_medkit.js — v5.6 医疗兵/医疗箱（无救援）+ AI 自动弹药箱
 * + 调试面板默认关闭
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_medkit: 医疗箱 + AI 弹药箱 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9256);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // 0) 调试面板默认关闭
    const dbg = await cdp.eval('document.getElementById("debug-panel").classList.contains("hidden")');
    assert(dbg === true, '调试面板默认关闭（hidden）');
    await cdp.eval('Game.debug.toggle()');
    const dbg2 = await cdp.eval('document.getElementById("debug-panel").classList.contains("hidden")');
    assert(dbg2 === false, 'F1/toggle 可打开调试面板');
    await cdp.eval('Game.debug.toggle()');

    // 布置
    const setup = await cdp.eval('(function(){' +
      'var G=Game; G.godMode=true;' +
      'var medic = G.bots.filter(function(b){ return b.team===0 && b.clsKey==="medic" && !b.bot.crew; })[0];' +
      'var supp = G.bots.filter(function(b){ return b.team===0 && b.clsKey==="support" && !b.bot.crew; })[0];' +
      'var reds = G.bots.filter(function(b){ return b.team===0 && !b.bot.crew && b!==medic && b!==supp; });' +
      'var ally1 = reds[0], ally2 = reds[1];' +
      'G.__pinned=[];' +
      'G.bots.forEach(function(b){ if (b===medic || b===supp || b===ally1 || b===ally2) return;' +
      '  var x = b.team===0 ? -78 : 78, z = b.team===0 ? -74 : 74;' +
      '  b.pos.x=x; b.pos.z=z; b.pos.y=G.heightAt(x,z); b.vel={x:0,y:0,z:0}; b.spawnProtect=0;' +
      '  G.__pinned.push({ id: b.id, x: x, z: z }); });' +
      'medic.pos.x=-60; medic.pos.z=0; medic.pos.y=G.heightAt(-60,0); medic.spawnProtect=999;' +
      'supp.pos.x=-40; supp.pos.z=0; supp.pos.y=G.heightAt(-40,0); supp.spawnProtect=999;' +
      'ally1.pos.x=-58; ally1.pos.z=0; ally1.pos.y=G.heightAt(-58,0); ally1.spawnProtect=0; ally1.health=20;' +
      'ally2.pos.x=-40; ally2.pos.z=3; ally2.pos.y=G.heightAt(-40,3); ally2.spawnProtect=0;' +
      'ally2.slots.primary.mag=1; ally2.slots.primary.reserve=0;' +
      'G.__ids = { medic: medic.id, supp: supp.id, a1: ally1.id, a2: ally2.id };' +
      'return JSON.stringify({ medicBots: G.bots.filter(function(b){return b.clsKey==="medic" && !b.bot.crew;}).length, medkit: GADGETS.medkit });' +
      '})()');
    const s = JSON.parse(setup);
    assert(s.medicBots >= 1, '队伍中有医疗兵 (' + s.medicBots + ')');
    assert(s.medkit.kind === 'medic' && s.medkit.healAmount === 35 && s.medkit.healRadius === 8, '医疗箱参数（35 治疗/8m 半径）');

    const step = (frames) => cdp.eval('(function(){ var G=Game, IDS=G.__ids;' +
      'var get=function(id){ for(var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===id)return G.soldiers[k]; } return null; };' +
      'var medic=get(IDS.medic), supp=get(IDS.supp), a1=get(IDS.a1), a2=get(IDS.a2);' +
      'for (var i=0;i<' + frames + ';i++){ var dt=1/30; G.time+=dt;' +
      '  medic.pos.x=-60; medic.pos.z=0; medic.pos.y=G.heightAt(-60,0); medic.vel={x:0,y:0,z:0};' +
      '  supp.pos.x=-40; supp.pos.z=0; supp.pos.y=G.heightAt(-40,0); supp.vel={x:0,y:0,z:0};' +
      '  a1.pos.x=-58; a1.pos.z=0; a1.pos.y=G.heightAt(-58,0); a1.vel={x:0,y:0,z:0};' +
      '  a2.pos.x=-40; a2.pos.z=3; a2.pos.y=G.heightAt(-40,3); a2.vel={x:0,y:0,z:0};' +
      '  for (var p=0;p<G.__pinned.length;p++){ var pb=G.__pinned[p]; var bot=G.soldiers[pb.id];' +
      '    bot.pos.x=pb.x; bot.pos.z=pb.z; bot.pos.y=G.heightAt(pb.x,pb.z); bot.vel={x:0,y:0,z:0}; }' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt); }' +
      'return "ok"; })()');

    // 1) v5.31 AI 医疗兵：放置地面医疗箱持续治疗伤员
    await step(90);   // 3 秒
    const r1 = await cdp.eval('(function(){ var G=Game; var a=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__ids.a1)a=G.soldiers[k]; }' +
      'var boxes = G.supplyBoxes.filter(function(b){ return b.kind==="medic"; });' +
      'return JSON.stringify({ hp: Math.round(a.health), boxes: boxes.length, onGround: boxes.length > 0 && !!boxes[0].mesh }); })()');
    const h = JSON.parse(r1);
    assert(h.hp >= 35 && h.hp <= 70, 'AI 医疗兵放置地面医疗箱持续治疗（20 → ' + h.hp + '）');
    assert(h.boxes >= 1 && h.onGround === true, '医疗箱放置在地上（箱体网格存在，' + h.boxes + ' 个）');

    // 2) v5.31 AI 支援兵：放置地面弹药箱持续补给（弹匣逐渐补满）
    await step(240);   // 再 8 秒
    const r2 = await cdp.eval('(function(){ var G=Game; var a=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__ids.a2)a=G.soldiers[k]; }' +
      'var boxes = G.supplyBoxes.filter(function(b){ return b.kind==="ammo"; });' +
      'return JSON.stringify({ mag: a.slots.primary.mag, full: a.slots.primary.def.mag, boxes: boxes.length }); })()');
    const m = JSON.parse(r2);
    assert(m.boxes >= 1, 'AI 支援兵放置地面弹药箱（' + m.boxes + ' 个）');
    assert(m.mag === m.full, '弹药箱持续补给直至补满（弹匣 ' + m.mag + '/' + m.full + '）');

    // 3) v5.31 玩家医疗箱：放地上持续治疗自己 + 队友；一人一个（放新毁旧）
    const r3 = await cdp.eval('(function(){ var G=Game;' +
      'G.hud.selectClass("medic"); G.deployPlayer();' +
      'var p=G.player; p.pos.x=-72; p.pos.z=0; p.pos.y=G.heightAt(-72,0); p.health=50;' +
      'var a=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__ids.a1)a=G.soldiers[k]; }' +
      'a.health=30; a.pos.x=-72; a.pos.z=4; a.pos.y=G.heightAt(-72,4);' +
      'G.weapons.fireGadget(p);' +
      'var c1 = G.supplyBoxes.filter(function(b){ return b.owner===p; }).length;' +
      'p.gadgetCooldown = 0;' +
      'G.weapons.fireGadget(p);' +   // 再放一个 → 旧的立刻销毁
      'var c2 = G.supplyBoxes.filter(function(b){ return b.owner===p; }).length;' +
      'return JSON.stringify({ c1: c1, c2: c2, pHp0: Math.round(p.health), aHp0: Math.round(a.health) });' +
      '})()');
    const u = JSON.parse(r3);
    assert(u.c1 === 1 && u.c2 === 1, '一人只能放一个，放新的旧的立刻销毁（' + u.c1 + ' → ' + u.c2 + '）');
    await step(150);   // 5 秒持续治疗
    const r3b = await cdp.eval('(function(){ var G=Game; var p=G.player;' +
      'var a=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__ids.a1)a=G.soldiers[k]; }' +
      'return JSON.stringify({ pHp: Math.round(p.health), aHp: Math.round(a.health) }); })()');
    const v = JSON.parse(r3b);
    assert(v.pHp > u.pHp0 + 15, '玩家医疗箱持续自疗（' + u.pHp0 + ' → ' + v.pHp + '）');
    assert(v.aHp > u.aHp0 + 15, '玩家医疗箱持续治疗队友（' + u.aHp0 + ' → ' + v.aHp + '）');

    // 4) 无救援系统：击杀立即阵亡，正常重生
    const r4 = await cdp.eval('(function(){ var G=Game;' +
      'var v=null, atk=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ var b=G.soldiers[k];' +
      '  if (b.team===0 && !b.isPlayer && !b.bot.crew && b!==null && b.id!==G.__ids.medic && b.id!==G.__ids.supp && b.id!==G.__ids.a1 && b.id!==G.__ids.a2) v=b;' +
      '  if (b.team===1 && !b.bot.crew && b.id!==G.__ids.medic) atk=b; }' +
      'G.weapons.kill(v, atk, false);' +
      'var noDowned = v.downed === undefined;' +
      'var deadNow = !v.alive;' +
      'return JSON.stringify({ noDowned: noDowned, deadNow: deadNow, id: v.id });' +
      '})()');
    const k = JSON.parse(r4);
    assert(k.noDowned === true && k.deadNow === true, '致命伤直接阵亡（无击倒/救援状态）');

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_medkit');
})();
