/* ============================================================
 * tests/test_maps.js — 三地图：雪域要塞 ↔ 钢铁防线 ↔ 雨林沼泽
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

    // 1. 雪域（默认）
    const snow0 = await cdp.eval(`JSON.stringify({
      map: Game.mapId, name: MAP_DEFS.snow.name,
      flags: Game.flags.length, vehicles: Game.vehicles.length, soldiers: Game.soldiers.length,
      pines: Game.terrain.trees.filter(function(s){return s.kind==='pine';}).length,
      bunkers: Game.terrain.destructibles.filter(function(s){return s.kind==='bunker';}).length,
      ice: !!Game.terrain.iceMesh,
    })`);
    const c = JSON.parse(snow0);
    assert(c.map === 'snow' && c.flags === 5, `初始雪域图 · 5 旗 (${c.flags})`);
    assert(c.pines >= 40, `雪松林 >= 40 (${c.pines})`);
    assert(c.bunkers >= 8, `碉堡 >= 8 (${c.bunkers})`);
    assert(c.ice === true, '冰湖冰面生成');
    assert(c.vehicles === 10 && c.soldiers === 48, '10 载具 / 24v24 48 士兵');

    // 2. 切钢铁防线
    const fort = await cdp.eval(`(function(){
      Game.applySelection('conquest', 'fort');
      Game.deployPlayer();
      for (var k=0;k<60;k++){ var dt=1/30; Game.time+=dt; Game.ai.update(dt); Game.Vehicles.update(dt); Game.weapons.update(dt); Game.updateConquest(dt); Game.effects.update(dt); }
      return JSON.stringify({
        map: Game.mapId, flags: Game.flags.length, soldiers: Game.soldiers.length,
        vehicles: Game.vehicles.length,
        buildings: Game.terrain.buildings.filter(function(t){return t.kind==='building';}).length,
        oilTanks: Game.terrain.destructibles.filter(function(t){return t.kind==='oilTank';}).length,
      });
    })()`);
    const s = JSON.parse(fort);
    console.log(`    钢铁防线: ${JSON.stringify(s)}`);
    assert(s.map === 'fort', '切换到钢铁防线');
    assert(s.flags === 5, `钢铁防线征服 5 旗 (${s.flags})`);
    assert(s.buildings >= 5, `堡垒建筑 >= 5 (${s.buildings})`);
    assert(s.oilTanks >= 8, `油库油罐 >= 8 (${s.oilTanks})`);
    assert(s.vehicles === 10 && s.soldiers === 48, '载具与士兵保持');

    // 3. 切雨林沼泽 + 突破模式
    const back = await cdp.eval(`(function(){
      Game.applySelection('breakthrough', 'jungle');
      Game.deployPlayer();
      return JSON.stringify({ map: Game.mapId, mode: Game.mode, flags: Game.flags.length, active: Game.activeSector, tRed: Game.ticketsRed });
    })()`);
    const b = JSON.parse(back);
    assert(b.map === 'jungle' && b.mode === 'breakthrough', `切雨林沼泽 + 突破模式 (${b.mode})`);
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
