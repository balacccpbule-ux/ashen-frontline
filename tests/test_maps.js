/* ============================================================
 * tests/test_maps.js — 双地图：灰烬都市 ↔ 沙暴行动
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_maps: 双地图切换 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9239);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // 1. 城市图
    const city = await cdp.eval(`JSON.stringify({
      map: Game.mapId, name: MAP_DEFS.city.name,
      buildings: Game.terrain.buildings.filter(function(s){return s.kind==='building';}).length,
      solids: Game.terrain.solids.length, flags: Game.flags.length,
      vehicles: Game.vehicles.length, soldiers: Game.soldiers.length,
    })`);
    const c = JSON.parse(city);
    assert(c.map === 'city' && c.flags === 3, `初始城市图 · 3 旗 (${c.flags})`);
    assert(c.buildings > 30, `城市街区建筑 > 30 (${c.buildings})`);
    assert(c.vehicles === 8 && c.soldiers === 32, `8 载具 / 16v16 32 士兵（v5.10 删除喷气机）`);

    // 2. 切沙漠
    const desert = await cdp.eval(`(function(){
      Game.applySelection('conquest', 'desert');
      Game.deployPlayer();
      for (var k=0;k<60;k++){ var dt=1/30; Game.time+=dt; Game.ai.update(dt); Game.Vehicles.update(dt); Game.weapons.update(dt); Game.updateConquest(dt); Game.effects.update(dt); }
      return JSON.stringify({
        map: Game.mapId, flags: Game.flags.length, soldiers: Game.soldiers.length,
        vehicles: Game.vehicles.length,
        oilTanks: Game.terrain.destructibles.filter(function(s){return s.kind==='oilTank';}).length,
        walls: Game.terrain.destructibles.filter(function(s){return s.kind==='wall';}).length,
        buildings: Game.terrain.buildings.filter(function(s){return s.kind==='building';}).length,
        hMin: +Game.terrain.hf[0].toFixed(0),
      });
    })()`);
    const d = JSON.parse(desert);
    console.log(`    沙漠: ${JSON.stringify(d)}`);
    assert(d.map === 'desert', '切换到沙暴行动');
    assert(d.flags === 4, `沙漠征服 4 旗 (${d.flags})`);
    assert(d.oilTanks >= 8, `油田油罐 >= 8 (${d.oilTanks})`);
    assert(d.walls >= 6, `村庄院墙 >= 6 (${d.walls})`);
    assert(d.buildings >= 10, `土坯房屋 >= 10 (${d.buildings})`);
    assert(d.vehicles === 8 && d.soldiers === 32, '载具与士兵保持');

    // 3. 切回城市 + 突破模式
    const back = await cdp.eval(`(function(){
      Game.applySelection('breakthrough', 'city');
      Game.deployPlayer();
      return JSON.stringify({ map: Game.mapId, mode: Game.mode, flags: Game.flags.length, active: Game.activeSector, tRed: Game.ticketsRed });
    })()`);
    const b = JSON.parse(back);
    assert(b.map === 'city' && b.mode === 'breakthrough', `切回城市 + 突破模式 (${b.mode})`);
    assert(b.flags === 6 && b.active === 1, `突破 6 旗 · 扇区 1`);
    assert(b.tRed === 400, `攻方票数 400 (${b.tRed})`);

    // 4. 弹坑在地图切换后清零重建
    const craters = await cdp.eval(`JSON.stringify({ craters: Game.terrain.craters, solids: Game.terrain.solids.length })`);
    const cr = JSON.parse(craters);
    assert(cr.solids > 100, `新图实体重建 (${cr.solids})`);

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_maps');
})();
