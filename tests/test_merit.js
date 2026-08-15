/* ============================================================
 * tests/test_merit.js — v5.18 功绩播报系统：
 * 1) 只播玩家功绩（他人击杀不播；助攻/火力压制播）
 * 2) 击杀加成映射（爆头/复仇/防守/进攻/连杀/载具/治疗/补给/占领/标记）
 * 3) 标记累加跳数字 · 最多 5 项滚动 · 3s 寿命渐变消失
 * 4) 分数值渐缓增长 + 3s 未更新快速淡出
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_merit: 功绩播报系统 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9260);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // ---- 布置：清场 + 靶子 ----
    await cdp.eval('(function(){' +
      'var G=Game; G.godMode=true;' +
      'G.applySelection("conquest", "city"); G.deployPlayer(); G.godMode=true;' +
      'G.bots.forEach(function(b){ if (b.clsKey==="mortar") { b.gadgetAmmo = 0; b.bot.mortarT = undefined; } });' +
      'G.__foe = G.bots.filter(function(b){ return b.team===1 && !b.bot.crew; })[0];' +
      'G.__foe2 = G.bots.filter(function(b){ return b.team===1 && !b.bot.crew; })[1];' +
      'G.__foe3 = G.bots.filter(function(b){ return b.team===1 && !b.bot.crew; })[2];' +
      'G.__ally = G.bots.filter(function(b){ return b.team===0 && !b.bot.crew; })[0];' +
      'G.__redBot = G.bots.filter(function(b){ return b.team===0 && !b.bot.crew; })[5];' +
      'G.__pinned = [];' +
      'G.bots.forEach(function(b){ if (b===G.__foe || b===G.__foe2 || b===G.__foe3 || b===G.__ally) return;' +
      '  var px = b.team===0 ? -78 : 78, pz = b.team===0 ? -74 : 74;' +
      '  b.pos.x=px; b.pos.z=pz; b.pos.y=G.heightAt(px,pz); b.vel={x:0,y:0,z:0}; b.spawnProtect=0;' +
      '  G.__pinned.push({ id: b.id, x: px, z: pz }); });' +
      'G.vehicles.forEach(function(v){ if (v.occupant) G.Vehicles.exit(v.occupant);' +
      '  v.pos.x = v.team===0 ? -68 : 68; v.pos.z = v.team===0 ? 55 : -55; v.pos.y = G.heightAt(v.pos.x, v.pos.z); v.vel = {x:0,y:0,z:0}; });' +
      'var feed = document.getElementById("scorefeed"); while (feed.firstChild) feed.removeChild(feed.firstChild);' +
      'G.player.score = 0; G.player.kills = 0; G.player.streak = 0;' +
      'G.__pin = function(id, x, z){ var s=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===id){ s=G.soldiers[k]; break; } }' +
      '  if (s){ s.pos.x=x; s.pos.z=z; s.pos.y=G.heightAt(x,z); s.vel={x:0,y:0,z:0}; s.spawnProtect=0; } };' +
      'return "ok"; })()');

    const step = (frames) => cdp.eval('(function(){ var G=Game;' +
      'for (var i=0;i<' + frames + ';i++){ var dt=1/30; G.time+=dt;' +
      '  for (var p=0;p<G.__pinned.length;p++){ var pb=G.__pinned[p]; var bot=G.soldiers[pb.id];' +
      '    bot.pos.x=pb.x; bot.pos.z=pb.z; bot.pos.y=G.heightAt(pb.x,pb.z); bot.vel={x:0,y:0,z:0}; }' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt); G.hud.update(dt); }' +
      'return "ok"; })()');

    // ---- 1) 玩家击杀 → 击杀功绩 + 爆头功绩；分数缓动启动 ----
    const r1 = await cdp.eval('(function(){ var G=Game;' +
      'G.__pin(G.__foe.id, -60, 0);' +
      'var foe=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe.id)foe=G.soldiers[k]; }' +
      'foe.spawnProtect=0; foe.deaths=0;' +
      'G.weapons.applyDamage(foe, 120, G.player, foe.pos, true);' +   // 爆头击杀
      'var kids = document.getElementById("scorefeed").children;' +
      'var kinds = []; for (var k=0;k<kids.length;k++) kinds.push(kids[k].getAttribute("data-kind"));' +
      'return JSON.stringify({ kinds: kinds, score: G.player.score, kills: G.player.kills });' +
      '})()');
    const a = JSON.parse(r1);
    assert(a.kinds.indexOf('headshot') >= 0 && a.kinds.indexOf('kill') >= 0, '玩家击杀 → 击杀/爆头功绩（' + a.kinds.join(',') + '）');
    assert(a.score === 125 && a.kills === 1, '击杀得分 +125（100 基础 + 25 爆头，实测 ' + a.score + '）');
    await step(30);   // 1 秒：分数缓动追到目标
    const s1 = await cdp.eval('(function(){' +
      'var el = document.getElementById("merit-score");' +
      'return JSON.stringify({ visible: !el.classList.contains("hidden"), val: parseInt(el.textContent, 10) }); })()');
    const b = JSON.parse(s1);
    assert(b.visible === true && b.val >= 100, '分数值渐缓增长到目标（' + b.val + '）');

    // ---- 1.5) v5.22 多杀功绩：替代原 CF 击杀播报（双杀/三杀动态标签 + 计分） ----
    const r15 = await cdp.eval('(function(){ var G=Game;' +
      'var foes = [G.__foe2, G.__foe3];' +
      'var s0 = G.player.score;' +
      'for (var i=0;i<2;i++){' +
      '  var f=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===foes[i].id)f=G.soldiers[k]; }' +
      '  if (!f.alive) G.ai.respawn(f);' +
      '  G.__pin(f.id, 60, 0); f.spawnProtect = 0; f.shield = 0;' +
      '  G.weapons.applyDamage(f, 120, G.player, f.pos);' +
      '}' +
      'var entries = []; var kids = document.getElementById("scorefeed").children;' +
      'for (var k=0;k<kids.length;k++) entries.push(kids[k].textContent);' +
      'return JSON.stringify({ gain: G.player.score - s0, entries: entries });' +
      '})()');
    const m = JSON.parse(r15);
    assert(m.entries.indexOf('+25 双杀') >= 0 && m.entries.indexOf('+50 三杀') >= 0, '多杀进功绩（双杀/三杀动态标签）');
    assert(m.gain >= 325, '多杀计分（双杀 +25 / 三杀 +50 / 连杀 +50，总 +' + m.gain + '）');

    // ---- 2) 他人击杀不播（除非我有助攻） ----
    const r2 = await cdp.eval('(function(){ var G=Game;' +
      'G.__pin(G.__foe2.id, 60, 0);' +
      'var foe2=null, red=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ var ss=G.soldiers[k]; if(ss.id===G.__foe2.id)foe2=ss; if(ss.id===G.__redBot.id)red=ss; }' +
      'foe2.spawnProtect=0;' +
      'var before = document.getElementById("scorefeed").children.length;' +
      'G.weapons.applyDamage(foe2, 120, red, foe2.pos);' +   // 红军 BOT 击杀蓝军（玩家未参与）→ 无我方功绩
      'var after1 = document.getElementById("scorefeed").children.length;' +
      'G.ai.respawn(foe2); G.__pin(G.__foe2.id, 60, 0);' +
      'var foe2b=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe2.id)foe2b=G.soldiers[k]; }' +
      'foe2b.shield = 0;' +   // 清护盾保证真实伤害入账
      'var scoreBefore = G.player.score;' +
      'G.weapons.applyDamage(foe2b, 40, G.player, foe2b.pos);' +   // 我先打 40 → 助攻
      'G.weapons.applyDamage(foe2b, 120, red, foe2b.pos);' +       // 红军队友击杀 → 我获得助攻功绩
      'var kinds2 = []; var kids2 = document.getElementById("scorefeed").children;' +
      'for (var k=0;k<kids2.length;k++) kinds2.push(kids2[k].getAttribute("data-kind"));' +
      'return JSON.stringify({ before: before, after1: after1, kinds2: kinds2, gain: G.player.score - scoreBefore });' +
      '})()');
    const c = JSON.parse(r2);
    assert(c.after1 === c.before, '他人击杀不播功绩（' + c.before + ' → ' + c.after1 + '）');
    assert(c.kinds2.indexOf('assist') >= 0, '我有助攻 → 助攻功绩（' + c.kinds2.join(',') + '）');
    assert(c.gain === 50, '助攻得分 +50（实测 ' + c.gain + '）');

    // ---- 3) 火力压制助攻（伤害不足 40） ----
    const r3 = await cdp.eval('(function(){ var G=Game;' +
      'var foe3=null, red=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ var ss=G.soldiers[k]; if(ss.id===G.__foe3.id)foe3=ss; if(ss.id===G.__redBot.id)red=ss; }' +
      'if (!foe3.alive) G.ai.respawn(foe3);' +
      'G.__pin(G.__foe3.id, 60, 0);' +
      'foe3.spawnProtect=0; foe3.shield = 0;' +   // 清护盾保证真实伤害入账
      'var scoreBefore = G.player.score;' +
      'G.weapons.applyDamage(foe3, 10, G.player, foe3.pos);' +   // 只打 10 → 火力压制
      'G.weapons.applyDamage(foe3, 120, red, foe3.pos);' +
      'var kinds = []; var kids = document.getElementById("scorefeed").children;' +
      'for (var k=0;k<kids.length;k++) kinds.push(kids[k].getAttribute("data-kind"));' +
      'return JSON.stringify({ kinds: kinds, gain: G.player.score - scoreBefore });' +
      '})()');
    const d = JSON.parse(r3);
    assert(d.kinds.indexOf('suppress') >= 0, '火力压制助攻功绩（' + d.kinds.join(',') + '）');
    assert(d.gain === 25, '火力压制得分 +25（实测 ' + d.gain + '）');

    // ---- 4) 标记累加跳数字 + 其余功绩类型 + 5 项上限 + 滚动 ----
    const r4 = await cdp.eval('(function(){ var G=Game;' +
      'G.hud.merit("spot", 25);' +
      'G.hud.merit("spot", 25);' +   // 累加：同一条目跳数字
      'var spot = document.querySelector("#scorefeed .mf-entry[data-kind=spot]");' +
      'var spotN = spot ? spot.getAttribute("data-n") : -1;' +
      'var spotText = spot ? spot.textContent : null;' +
      'G.hud.merit("vehicle", 150);' +
      'G.hud.merit("heal", 30);' +
      'G.hud.merit("ammo", 20);' +
      'G.hud.merit("capture", 150);' +
      'G.hud.merit("revenge", 50);' +   // 第 6 条 → 挤掉最老
      'var kids = document.getElementById("scorefeed").children;' +
      'var kinds = []; for (var k=0;k<kids.length;k++) kinds.push(kids[k].getAttribute("data-kind"));' +
      'var t0 = kids.length > 0 ? kids[0].style.transform : null;' +
      'var t1 = kids.length > 1 ? kids[1].style.transform : null;' +
      'return JSON.stringify({ spotN: spotN, spotText: spotText, count: kids.length, kinds: kinds, t0: t0, t1: t1 });' +
      '})()');
    const e = JSON.parse(r4);
    assert(e.spotN === '2' && e.spotText === '+50 标记 ×2', '标记累加跳数字（' + e.spotText + '）');
    assert(e.count === 5, '最多滚动 5 项（' + e.count + '）');
    assert(e.kinds[0] === 'revenge', '新功绩在最上方（' + e.kinds.join(',') + '）');
    assert(/0px/.test(e.t0 || ''), '顶部条目位于原位（' + e.t0 + '）');
    assert(/33px/.test(e.t1 || ''), '第二条向下滚动 33px（' + e.t1 + '）');
    assert(/scale\(0\.88\)/.test(e.t1 || ''), '老功绩同时缩小（scale 0.88）');

    // ---- 5) 3s 寿命 → 渐变消失 → 移除 ----
    await sleep(3300);
    const r5 = await cdp.eval('(function(){' +
      'var kids = document.getElementById("scorefeed").children;' +
      'var fading = 0; for (var k=0;k<kids.length;k++){ if (kids[k].classList.contains("mf-out")) fading++; }' +
      'return JSON.stringify({ count: kids.length, fading: fading }); })()');
    const f = JSON.parse(r5);
    assert(f.fading >= 4, '3 秒寿命后渐变消失（fading ' + f.fading + '/' + f.count + '）');
    await sleep(700);
    const r6 = await cdp.eval('document.getElementById("scorefeed").children.length;');
    assert(r6 < f.count, '渐变结束后条目移除（' + f.count + ' → ' + r6 + '）');

    // ---- 6) 分数值空闲 3s → 快速淡出 ----
    await cdp.eval('(function(){ var G=Game; G.hud.merit("heal", 15); return "ok"; })()');
    await step(120);   // 4 秒游戏时间（分数追平 + 空闲超 3s）
    const r7 = await cdp.eval('(function(){' +
      'var el = document.getElementById("merit-score");' +
      'return JSON.stringify({ out: el.classList.contains("ms-out") }); })()');
    assert(JSON.parse(r7).out === true, '分数值空闲 3s 后快速淡出（非立即消失）');

    const errors = cdp.errors();
    for (const err of errors) console.error('  !! ' + err);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_merit');
})();
