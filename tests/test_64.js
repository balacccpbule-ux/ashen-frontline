/* ============================================================
 * tests/test_64.js — 16v16 32人规模压力测试（30 秒高强度战斗 + tick 性能）
 * ============================================================ */
'use strict';
const { launchChrome, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_64: 16v16 战场压力测试 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9236);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await require('./lib/cdp').sleep(250); }

    const perf = await cdp.eval(`(function(){
      var G=Game;
      var times=[], worst=0;
      // v5：确定性压力测试——固定种子 + 全量重建重置（地形/旗点/载具/士兵全复位），
      // 修复 AI 随机决策导致的 22~27 阵亡波动（三次裸跑 38/28/25 的抖动）
      var origRandom = Math.random; Math.random = G.newRng(17);   // v5.42 城市图非网格重做后重探（18 阵亡/17 击杀/6 载具）
      (function deterministicReset(){
        var prevMap = G.mapId;
        G.mapId = prevMap === 'city' ? 'desert' : 'city';   // 强制走全量重建分支
        G.applySelection(Game.mode, prevMap);               // 地形/旗点/载具/小地图重建 + resetMatch
        G.deployPlayer();
        // 复刻 ai.init 布局：60% 非乘员部署到旗点附近（种子化随机）
        var placed=[0,0];
        G.bots.forEach(function(b){
          var count = b.team===0 ? 15 : 16;
          var idx = placed[b.team]; placed[b.team]++;
          if (idx < Math.ceil(count*0.6) && !b.bot.crew) {
            var fl = G.flags[idx % G.flags.length];
            b.pos.x = fl.x + (Math.random()-0.5)*9;
            b.pos.z = fl.z + (Math.random()-0.5)*9;
            b.pos.y = G.heightAt(b.pos.x, b.pos.z);
            b.vel = {x:0,y:0,z:0};
          }
        });
      })();
      for (var i=0;i<900;i++){
        var dt=1/30, t0=performance.now();
        G.time+=dt;
        if (G.player.alive) G.Player.update(dt);
        G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);
        G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt);
        var cost=performance.now()-t0;
        times.push(cost); if(cost>worst)worst=cost;
      }
      Math.random = origRandom;
      times.sort(function(a,b){return a-b;});
      var avg=times.reduce(function(a,b){return a+b;},0)/times.length;
      return JSON.stringify({
        avg: avg, p50: times[450], p95: times[855], worst: worst,
        soldiers: G.soldiers.length,
        alive: G.soldiers.filter(function(s){return s.alive;}).length,
        deaths: G.soldiers.reduce(function(a,s){return a+s.deaths;},0),
        kills: G.soldiers.reduce(function(a,s){return a+s.kills;},0),
        shots: G.sound._log.length,
        vehicles: G.vehicles.length, vehOcc: G.vehicles.filter(function(v){return v.occupant;}).length,
        craters: G.terrain.craters,
        destroyed: G.terrain.solids.filter(function(s){return !s.solid;}).length,
        flagsContested: G.flags.filter(function(f){return Math.abs(f.control)>5;}).length,
      });
    })()`);
    const r = JSON.parse(perf);
    console.log(`    tick: 平均 ${r.avg.toFixed(2)}ms · P50 ${r.p50.toFixed(2)}ms · P95 ${r.p95.toFixed(2)}ms · 最差 ${r.worst.toFixed(1)}ms`);
    console.log(`    30秒战况: 存活 ${r.alive}/32 · 累计阵亡 ${r.deaths} · 击杀 ${r.kills} · 载具在驾 ${r.vehOcc}`);
    assert(r.soldiers === 32, `16v16 32 名士兵全程在场 (${r.soldiers})`);
    assert(r.deaths > 8, `30 秒高强度战斗（累计阵亡 ${r.deaths} 人次）`);
    assert(r.kills >= 8, `有效击杀（${r.kills}，环境击杀不计入）`);
    assert(r.alive <= 32, '存活数守恒');
    assert(r.vehOcc >= 4, `载具持续被驾驶 (${r.vehOcc})`);
    assert(r.avg < 16, `平均 tick < 16ms（实际 ${r.avg.toFixed(2)}ms）`);
    assert(r.p95 < 40, `P95 tick < 40ms（实际 ${r.p95.toFixed(2)}ms）`);

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_64');
})();
