/* ============================================================
 * tests/test_snow.js — v5 第三张地图：雪域要塞
 * URL 参数直进雪图；松林/碉堡/木屋/冰湖/降雪；地面不雕刻；切图清理
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_snow: 雪域要塞 + 天气 ===');
  const { proc, cdp } = await launchChrome(gameUrl('autotest=1&map=snow'), 9253);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    const s0 = await cdp.eval(`(function(){
      var G = Game;
      return JSON.stringify({
        map: G.mapId, name: MAP_DEFS.snow ? MAP_DEFS.snow.name : null,
        flags: G.flags.length, vehicles: G.vehicles.length, soldiers: G.soldiers.length,
        pines: G.terrain.trees.filter(function(t){return t.kind==='pine';}).length,
        bunkers: G.terrain.destructibles.filter(function(s){return s.kind==='bunker';}).length,
        cabins: G.terrain.buildings.filter(function(s){return s.snowCabin;}).length,
        ice: !!G.terrain.iceMesh,
        weather: G.effects.weatherState.kind,
        weatherPts: G.effects.weatherState.N,
        menuBtns: document.querySelectorAll('.map-btn').length,
      });
    })()`);
    const r = JSON.parse(s0);
    assert(r.map === 'snow' && r.name === '雪域要塞', 'URL ?map=snow 直进雪域要塞 (' + r.map + ')');
    assert(r.flags === 4 && r.soldiers === 48 && r.vehicles === 10, '4 旗 / 24v24 48 士兵 / 10 载具');
    assert(r.pines >= 40, '雪松林 ≥ 40 (' + r.pines + ')');
    assert(r.bunkers >= 8, '混凝土碉堡 ≥ 8 (' + r.bunkers + ')');
    assert(r.cabins >= 6, '林间木屋 ≥ 6 (' + r.cabins + ')');
    assert(r.ice === true, '冰湖冰面生成');
    assert(r.weather === 'snow' && r.weatherPts === 900, '降雪粒子 900 (' + r.weatherPts + ')');
    assert(r.menuBtns === 3, '菜单三地图按钮 (' + r.menuBtns + ')');

    // 弹坑系统已移除：爆炸不雕刻地形（地面与贴图保持一致）
    const cr = await cdp.eval(`(function(){
      var T = Game.terrain;
      var k = T.hIdx(80, 80);   // 世界原点 (0,0)
      var before = T.hf[k];
      for (var i=0;i<6;i++) T.addCrater(0, 0, 6, 1.4);
      Game.weapons.areaDamage({x:0, y:Game.heightAt(0,0)+0.5, z:0}, 12, 260, null, 'shell');
      T.update(1);
      return JSON.stringify({ before: +before.toFixed(2), after: +T.hf[k].toFixed(2), craters: T.craters });
    })()`);
    const c = JSON.parse(cr);
    assert(c.before === c.after, '爆炸不雕刻地形（' + c.before + ' → ' + c.after + '）');
    assert(c.craters === 0, '弹坑计数为 0 (' + c.craters + ')');

    // 切回沙漠：冰面/天气清理
    const back = await cdp.eval(`(function(){
      Game.applySelection('conquest', 'desert');
      Game.deployPlayer();
      return JSON.stringify({ map: Game.mapId, ice: !!Game.terrain.iceMesh, weather: Game.effects.weatherState.kind });
    })()`);
    const b = JSON.parse(back);
    assert(b.map === 'desert' && b.ice === false && b.weather === 'sand', '切回沙漠 → 冰面清理 + 沙尘天气');

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_snow');
})();
