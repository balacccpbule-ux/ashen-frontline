/* ============================================================
 * tests/test_fort.js — v5.30 钢铁防线（突破模式史诗地图）
 * 1) 生成：峡谷要塞地形 / 中央油库 / 西线堑壕 / 东侧堡垒 / 血色黄昏灰烬天气
 * 2) 突破特殊设计：扇区陷落连环爆炸 + 史诗播报 / 最终扇区守军死守前沿
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_fort: 钢铁防线 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9264);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // ---- 生成 ----
    const r1 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'G.applySelection("breakthrough", "fort"); G.deployPlayer();' +
      'var md = MAP_DEFS.fort;' +
      'var bld = G.terrain.buildings.length;' +
      'var bunkers = G.terrain.destructibles.filter(function(s){return s.kind==="bunker";}).length;' +
      'var tanks = G.terrain.destructibles.filter(function(s){return s.kind==="oilTank";}).length;' +
      'var walls = G.terrain.fortwalls.length;' +
      'var bags = G.terrain.destructibles.filter(function(s){return s.kind==="sandbag";}).length;' +
      'return JSON.stringify({ map: G.mapId, name: md.name, weather: md.weather, fog: md.fogFar, flags: G.flags.length,' +
      '  sectors: G.sectors.length, soldiers: G.soldiers.length, vehicles: G.vehicles.length,' +
      '  bld: bld, bunkers: bunkers, tanks: tanks, walls: walls, bags: bags,' +
      '  hWest: +G.heightAt(-38, 0).toFixed(1), hEast: +G.heightAt(58, 0).toFixed(1) });' +
      '})()');
    const a = JSON.parse(r1);
    assert(a.map === 'fort' && a.name === '钢铁防线', '第五张地图钢铁防线（' + a.map + '/' + a.name + '）');
    assert(a.weather === 'ash' && a.fog === 140, '血色黄昏 + 灰烬天气 + 近距离雾（' + a.weather + '/' + a.fog + '）');
    assert(a.flags === 6 && a.sectors === 3, '突破 3 扇区 × 2 旗 = 6 旗（' + a.flags + '/' + a.sectors + '）');
    assert(a.soldiers === 48 && a.vehicles === 10, '24v24 48 士兵 / 10 载具');
    assert(a.bld >= 6, '东侧堡垒建筑 ≥ 6（' + a.bld + '）');
    assert(a.bunkers >= 6, '混凝土碉堡 ≥ 6（' + a.bunkers + '）');
    assert(a.tanks >= 10, '中央油库油罐 ≥ 10（' + a.tanks + '，殉爆链）');
    assert(a.walls >= 8, '永久墙工事 ≥ 8（' + a.walls + '）');
    assert(a.bags >= 20, '西线堑壕沙袋 ≥ 20（' + a.bags + '）');
    assert(a.hEast > a.hWest + 2, '峡谷要塞地形：东侧堡垒高台（西 ' + a.hWest + 'm → 东 ' + a.hEast + 'm）');

    // ---- 扇区陷落：连环爆炸 + 史诗播报 + 推进 ----
    const r2 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'for (var k=0;k<G.flags.length;k++){ if (G.flags[k].sector === 1) { G.flags[k].owner = 0; G.flags[k].control = -100; } }' +
      'var dt=1/30; G.time+=dt;' +
      'G.updateBreakthrough(dt);' +
      'var ann = document.getElementById("announce").textContent;' +
      'return JSON.stringify({ sector: G.activeSector, ann: ann, tickets: G.ticketsRed });' +
      '})()');
    const b = JSON.parse(r2);
    assert(b.sector === 2, '扇区 1 陷落 → 推进到扇区 2（' + b.sector + '）');
    assert(b.ann.indexOf('西线堑壕') >= 0, '史诗播报（' + b.ann + '）');
    assert(b.tickets > 400, '攻方补票（' + b.tickets + '）');

    // ---- 最终扇区：守军死守前沿 ----
    const r3 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'for (var k=0;k<G.flags.length;k++){ if (G.flags[k].sector === 2) { G.flags[k].owner = 0; G.flags[k].control = -100; } }' +
      'var dt=1/30; G.time+=dt;' +
      'G.updateBreakthrough(dt);' +
      'var blue = G.bots.filter(function(b){return b.team===1 && !b.bot.crew;})[0];' +
      'var sp = Game.modes.spawnPoint(blue);' +
      'var best = 999;' +
      'for (var k=0;k<G.flags.length;k++){ var f=G.flags[k]; if (f.sector !== 3) continue;' +
      '  var d = Math.hypot(sp.x - f.x, sp.z - f.z); if (d < best) best = d; }' +
      'return JSON.stringify({ sector: G.activeSector, ann: document.getElementById("announce").textContent, spawnDist: +best.toFixed(1) });' +
      '})()');
    const c = JSON.parse(r3);
    assert(c.sector === 3, '扇区 2 陷落 → 最终扇区（' + c.sector + '）');
    assert(c.ann.indexOf('最终防线') >= 0 || c.ann.indexOf('死守堡垒') >= 0, '最终扇区宣言（' + c.ann + '）');
    assert(c.spawnDist < 30, '守军死守前沿（出生点距 S3 旗 ' + c.spawnDist + 'm < 30）');

    // ---- 最后扇区攻陷 → 红军胜利 ----
    const r4 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'for (var k=0;k<G.flags.length;k++){ if (G.flags[k].sector === 3) { G.flags[k].owner = 0; G.flags[k].control = -100; } }' +
      'var dt=1/30; G.time+=dt;' +
      'G.updateBreakthrough(dt);' +
      'return JSON.stringify({ over: G.over, winner: G.winner });' +
      '})()');
    const d = JSON.parse(r4);
    assert(d.over === true && d.winner === 0, '堡垒陷落 → 红军胜利（over=' + d.over + ' winner=' + d.winner + '）');

    const errors = cdp.errors();
    for (const err of errors) console.error('  !! ' + err);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_fort');
})();
