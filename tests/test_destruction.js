/* ============================================================
 * tests/test_destruction.js — 建筑多级破坏 + 地形保持不变（弹坑已移除）
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_destruction: 全域破坏 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9238);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // 1. 大建筑三级破坏：完好 → 开裂 → 残破 → 倒塌 + 瓦砾
    const stages = await cdp.eval(`(function(){
      var b = Game.terrain.buildings.filter(function(s){ return s.kind==='building' && s.stages && s.solid; })[0];
      if (!b) return '{"err":"no building"}';
      var h0 = b.h;
      var m = b.maxHp;                     // v5.2 建筑耐久 ×20，按比例破坏
      Game.terrain.damageSolid(b, m * 0.40);   // 60%
      var s1 = b.state;
      Game.terrain.damageSolid(b, m * 0.28);   // 32%
      var s2 = b.state, h2 = b.h;
      Game.terrain.damageSolid(b, m * 0.50);   // 倒塌
      var s3 = !b.solid;
      var rubble = Game.terrain.solids.filter(function(s){ return s.kind==='rubble' && Math.abs(s.cx-b.cx)<1 && Math.abs(s.cz-b.cz)<1; }).length;
      return JSON.stringify({ h0: h0, s1: s1, s2: s2, h2: h2, s3: s3, rubble: rubble });
    })()`);
    const r = JSON.parse(stages);
    if (r.err) { console.error('  !! ' + r.err); process.exit(1); }
    assert(r.s1 === 1, `建筑开裂状态 (state=${r.s1})`);
    assert(r.s2 === 2, `建筑残破状态 (state=${r.s2})`);
    assert(r.h2 === 1.2, `残破后碰撞高度 1.2m (实际 ${r.h2})`);
    assert(r.s3 === true, '建筑倒塌');
    assert(r.rubble >= 1, '生成瓦砾堆（低掩体）');

    // 2. 油桶殉爆：地面不再雕刻（弹坑系统已按用户要求移除）
    const boom = await cdp.eval(`(function(){
      var b = Game.terrain.destructibles.filter(function(s){ return s.kind==='barrel' && s.solid; })[0];
      if (!b) return '{"err":"no barrel"}';
      var gh0 = Game.heightAt(b.cx, b.cz);
      var c0 = Game.terrain.craters;
      Game.weapons.areaDamage({x:b.cx, y:b.baseH+1, z:b.cz}, 2, 200, null, 'test');
      Game.terrain.damageSolid(b, 999);   // 殉爆
      for (var k=0;k<60;k++){ var dt=1/30; Game.time+=dt; Game.weapons.update(dt); Game.terrain.update(dt); }
      var gh1 = Game.heightAt(b.cx, b.cz);
      return JSON.stringify({ destroyed: !b.solid, cratersAdded: Game.terrain.craters - c0, drop: +(gh0-gh1).toFixed(2) });
    })()`);
    const bo = JSON.parse(boom);
    assert(!bo.err && bo.destroyed, '油桶殉爆销毁');
    assert(bo.cratersAdded === 0, `爆炸不再雕刻弹坑 (${bo.cratersAdded} 个)`);
    assert(bo.drop === 0, `地形高度保持不变 (${bo.drop}m)`);

    // 3. 坦克主炮轰楼（真实管线）
    const shell = await cdp.eval(`(function(){
      var b = Game.terrain.buildings.filter(function(s){ return s.kind==='building' && s.stages && s.solid; })[0];
      if (!b) return '{"err":"no building2"}';
      var hp0 = b.hp;
      var tank = Game.vehicles.filter(function(v){ return v.kind==='tank' && v.alive; })[0];
      var s = Game.player;
      if (tank && tank.occupant) Game.Vehicles.exit(tank.occupant);
      Game.Vehicles.enter(tank, s);
      tank.pos = { x: b.cx - 30, y: Game.heightAt(b.cx-30, b.cz), z: b.cz };
      tank.yaw = 0; tank.turretYaw = 0; tank.turretPitch = 0;
      Game.Vehicles.firePrimary && tank.cannonTimer <= 0;
      // 直接模拟炮击：命中点范围伤害
      Game.weapons.areaDamage({x:b.cx, y:b.baseH+b.h/2, z:b.cz}, 12, 250, s, 'shell');
      Game.Vehicles.exit(s);
      return JSON.stringify({ dmg: hp0 - b.hp, state: b.state });
    })()`);
    const sh = JSON.parse(shell);
    assert(!sh.err && sh.dmg > 0, `炮弹伤害建筑 (${sh.dmg} 伤害)`);

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_destruction');
})();
