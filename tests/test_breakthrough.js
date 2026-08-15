/* ============================================================
 * tests/test_breakthrough.js — 突破模式：扇区推进/锁定/胜负
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_breakthrough: 突破模式 ===');
  const { proc, cdp } = await launchChrome(gameUrl('autotest=1&mode=breakthrough'), 9237);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // 显式重置（autotest 下 rAF 会在页面加载期间自动推进战局）
    await cdp.eval('Game.applySelection("breakthrough", "city")');

    // 1. 初始状态
    const init = await cdp.eval(`JSON.stringify({
      mode: Game.mode, flags: Game.flags.length, sectors: Game.sectors.length,
      active: Game.activeSector, tRed: Game.ticketsRed, tBlue: Game.ticketsBlue,
      locked1: Game.flags.filter(function(f){return f.sector===1;}).every(function(f){return f.locked;}),
      locked2: Game.flags.filter(function(f){return f.sector===2;}).every(function(f){return f.locked;}),
    })`);
    const i = JSON.parse(init);
    assert(i.mode === 'breakthrough', '突破模式生效');
    assert(i.flags === 6 && i.sectors === 3, `3 扇区 × 2 旗 = 6 旗 (${i.flags}/${i.sectors})`);
    assert(i.active === 1, '初始扇区 1');
    assert(i.tRed === 400 && i.tBlue === 250, `攻方 400 / 守方 250 票 (${i.tRed}/${i.tBlue})`);
    assert(!i.locked1 && i.locked2, '扇区 1 可占 · 扇区 2/3 锁定');

    // 2. 攻方占领扇区 1 → 推进 + 补票 + 锁定
    const adv = await cdp.eval(`(function(){
      var G=Game;
      G.flags.forEach(function(f){ if(f.sector===1){ f.control=-100; f.owner=0; } });
      for (var k=0;k<30;k++){ var dt=1/30; G.time+=dt; G.updateBreakthrough(dt); }
      return JSON.stringify({
        active: G.activeSector, tRed: G.ticketsRed,
        locked1: G.flags.filter(function(f){return f.sector===1;}).every(function(f){return f.locked;}),
        locked2: G.flags.filter(function(f){return f.sector===2;}).every(function(f){return f.locked;}),
        over: G.over,
      });
    })()`);
    const a = JSON.parse(adv);
    assert(a.active === 2, `扇区推进到 2 (实际 ${a.active})`);
    assert(a.tRed > 400, `攻方补票 (${a.tRed})`);
    assert(a.locked1 && !a.locked2, '扇区 1 锁定 · 扇区 2 解锁');

    // 3. 连下两扇区 → 攻方胜利
    const win = await cdp.eval(`(function(){
      var G=Game;
      for (var s=2;s<=3;s++){
        G.flags.forEach(function(f){ if(f.sector===s){ f.control=-100; f.owner=0; } });
        for (var k=0;k<30;k++){ var dt=1/30; G.time+=dt; G.updateBreakthrough(dt); if(G.over) break; }
      }
      return JSON.stringify({ over: G.over, winner: G.winner });
    })()`);
    const w = JSON.parse(win);
    assert(w.over && w.winner === 0, `攻方全境攻陷 → 红军胜利 (winner=${w.winner})`);

    // 4. 时间到 → 守方胜
    const timeWin = await cdp.eval(`(function(){
      Game.applySelection('breakthrough', 'city');   // 重置战局
      Game.ticketsRed=400; Game.ticketsBlue=250;
      Game.time = Game.matchTimeLimit;
      Game.updateBreakthrough(1/30);
      return JSON.stringify({ over: Game.over, winner: Game.winner });
    })()`);
    const t = JSON.parse(timeWin);
    assert(t.over && t.winner === 1, '守满时间 → 蓝军（守方）胜利');

    // 5. BOT 出生在扇区 1 前线
    const spawn = await cdp.eval(`(function(){
      var near=0, total=10;
      for (var k=0;k<total;k++){
        var b=Game.bots[k];
        var sp=Game.modes.spawnPoint(b);
        // 距扇区1任一旗点 22m 内（前线集结区）
        var ok = Game.flags.filter(function(f){return f.sector===1;}).some(function(f){
          var dx=sp.x-f.x, dz=sp.z-f.z; return dx*dx+dz*dz <= 22*22;
        });
        if (ok) near++;
      }
      return JSON.stringify({ near: near, total: total });
    })()`);
    const s = JSON.parse(spawn);
    assert(s.near >= 8, `攻方 BOT 出生在扇区 1 前线集结区 (${s.near}/${s.total})`);

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_breakthrough');
})();
