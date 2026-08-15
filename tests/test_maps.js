/* ============================================================
 * tests/test_maps.js — 三地图：沙暴行动 ↔ 雪域要塞 ↔ 钢铁防线
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_maps: 三地图切换 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9239);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // 1. 沙漠图（默认）
    const desert0 = await cdp.eval(`JSON.stringify({
      map: Game.mapId, name: MAP_DEFS.desert.name,
      flags: Game.flags.length, vehicles: Game.vehicles.length, soldiers: Game.soldiers.length,
      oilTanks: Game.terrain.destructibles.filter(function(s){return s.kind==='oilTank';}).length,
      walls: Game.terrain.destructibles.filter(function(s){return s.kind==='wall';}).length,
      buildings: Game.terrain.buildings.filter(function(s){return s.kind==='building';}).length,
    })`);
    const c = JSON.parse(desert0);
    assert(c.map === 'desert' && c.flags === 4, `初始沙漠图 · 4 旗 (${c.flags})`);
    assert(c.oilTanks >= 8, `油田油罐 >= 8 (${c.oilTanks})`);
    assert(c.walls >= 6, `村庄院墙 >= 6 (${c.walls})`);
    assert(c.buildings >= 10, `土坯房屋 >= 10 (${c.buildings})`);
    assert(c.vehicles === 10 && c.soldiers === 48, '10 载具 / 24v24 48 士兵');

    // 2. 切雪域
    const snow = await cdp.eval(`(function(){
      Game.applySelection('conquest', 'snow');
      Game.deployPlayer();
      for (var k=0;k<60;k++){ var dt=1/30; Game.time+=dt; Game.ai.update(dt); Game.Vehicles.update(dt); Game.weapons.update(dt); Game.updateConquest(dt); Game.effects.update(dt); }
      return JSON.stringify({
        map: Game.mapId, flags: Game.flags.length, soldiers: Game.soldiers.length,
        vehicles: Game.vehicles.length,
        pines: Game.terrain.trees.filter(function(t){return t.kind==='pine';}).length,
        ice: !!Game.terrain.iceMesh,
      });
    })()`);
    const s = JSON.parse(snow);
    console.log(`    雪域: ${JSON.stringify(s)}`);
    assert(s.map === 'snow', '切换到雪域要塞');
    assert(s.flags === 4, `雪域征服 4 旗 (${s.flags})`);
    assert(s.pines >= 40, `雪松林 >= 40 (${s.pines})`);
    assert(s.ice === true, '冰湖冰面生成');
    assert(s.vehicles === 10 && s.soldiers === 48, '载具与士兵保持');

    // 3. 切钢铁防线 + 突破模式
    const back = await cdp.eval(`(function(){
      Game.applySelection('breakthrough', 'fort');
      Game.deployPlayer();
      return JSON.stringify({ map: Game.mapId, mode: Game.mode, flags: Game.flags.length, active: Game.activeSector, tRed: Game.ticketsRed });
    })()`);
    const b = JSON.parse(back);
    assert(b.map === 'fort' && b.mode === 'breakthrough', `切钢铁防线 + 突破模式 (${b.mode})`);
    assert(b.flags === 6 && b.active === 1, `突破 6 旗 · 扇区 1`);
    assert(b.tRed === 400, `攻方票数 400 (${b.tRed})`);

    // 4. 地图切换后实体重建
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
