/* ============================================================
 * tests/test_aa.js — v5.10 防空炮车：对空克制环（喷气机已删除，仅直升机）
 * 1) 伤害类型倍率（载具全存活时测）
 * 2) AA 攻击空中直升机（×3 伤害）
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_aa: 防空车克制环 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9252);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    const setup = await cdp.eval('(function(){' +
      'var G = Game;' +
      'CONFIG.DOWNED_ENABLED = undefined; G.godMode = true;' +
      'G.applySelection("conquest", "snow"); G.deployPlayer();' +
      'var aa = G.vehicles.filter(function(v){ return v.kind==="aa" && v.team===1; })[0];' +
      'var aaPilot = G.bots.filter(function(b){ return b.team===1 && b.bot.crew==="aa"; })[0];' +
      'var heli = G.vehicles.filter(function(v){ return v.kind==="heli" && v.team===0; })[0];' +
      'G.Vehicles.enter(aa, aaPilot);' +
      'G.__pinned = [];' +
      'G.bots.forEach(function(b){ if (b === aaPilot) return;' +
      '  var x = b.team===0 ? -78 : 78, z = b.team===0 ? -74 : 74;' +
      '  b.pos.x = x; b.pos.z = z; b.pos.y = G.heightAt(x,z); b.vel = {x:0,y:0,z:0}; b.spawnProtect = 0;' +
      '  G.__pinned.push({ id: b.id, x: x, z: z }); });' +
      'aa.pos.x = -108; aa.pos.z = 0; aa.pos.y = G.heightAt(-108,0);' +
      'heli.pos.x = -50; heli.pos.z = 0; heli.pos.y = 26; heli.vel = {x:0,y:0,z:0};' +
      'return JSON.stringify({ vehCount: G.vehicles.length, aaId: aa.id, heliId: heli.id });' +
      '})()');
    const s = JSON.parse(setup);
    assert(s.vehCount === 10, '10 载具（喷气机已删除，直升机 ×4）');

    // ---- 伤害倍率（此刻载具全存活） ----
    const m = await cdp.eval('(function(){' +
      'var G = Game;' +
      'var tank = G.vehicles.filter(function(v){ return v.kind==="tank" && v.alive && v.team===1; })[0];' +
      'var apc = G.vehicles.filter(function(v){ return v.kind==="apc" && v.alive && v.team===1; })[0];' +
      'var aaV = G.vehicles.filter(function(v){ return v.kind==="aa" && v.alive && v.team===1; })[0];' +
      'var heli = G.vehicles.filter(function(v){ return v.kind==="heli" && v.alive && v.team===1; })[0];' +
      'var t0 = tank.hp; G.weapons.damageVehicle(tank, 100, null, "smallarms"); var smallTank = Math.round((t0 - tank.hp) * 10) / 10;' +
      'var t2 = tank.hp; G.weapons.damageVehicle(tank, 100, null, "smallarms", WEAPONS.sniper); var sniperTank = Math.round((t2 - tank.hp) * 10) / 10;' +
      'var a0 = apc.hp; G.weapons.damageVehicle(apc, 100, null, "smallarms"); var smallApc = Math.round((a0 - apc.hp) * 10) / 10;' +
      'var av0 = aaV.hp; G.weapons.damageVehicle(aaV, 100, null, "smallarms"); var smallAa = Math.round((av0 - aaV.hp) * 10) / 10;' +
      'var h1 = heli.hp; G.weapons.damageVehicle(heli, 100, null, "smallarms"); var smallHeli = Math.round((h1 - heli.hp) * 10) / 10;' +
      'var t1 = tank.hp; G.weapons.damageVehicle(tank, 100, null, "aa"); var aaTank = Math.round((t1 - tank.hp) * 10) / 10;' +
      'var h0 = heli.hp; G.weapons.damageVehicle(heli, 10, null, "aa"); var aaHeli = Math.round((h0 - heli.hp) * 10) / 10;' +
      'return JSON.stringify({ smallTank: smallTank, sniperTank: sniperTank, smallApc: smallApc, smallAa: smallAa, smallHeli: smallHeli, aaTank: aaTank, aaHeli: aaHeli });' +
      '})()');
    const d = JSON.parse(m);
    assert(d.smallTank === 0, '步枪对坦克零伤害（重甲免疫轻武器，实测 ' + d.smallTank + '）');
    assert(d.sniperTank === 20, '栓动狙击可穿坦克（80% 减伤 → 实测 ' + d.sniperTank + '）');
    assert(d.smallApc === 40, '装甲车枪械减伤 60%（实测 ' + d.smallApc + '）');
    assert(d.smallAa === 45, '防空车枪械减伤 55%（实测 ' + d.smallAa + '）');
    assert(d.smallHeli === 70, '直升机枪械减伤 30%（实测 ' + d.smallHeli + '）');
    assert(d.aaTank === 15, 'AA 对坦克仅 15%（实测 ' + d.aaTank + '）');
    assert(d.aaHeli === 30, 'AA 对直升机 ×3（实测 ' + d.aaHeli + '）');

    // ---- 实战：AA 攻击直升机 ----
    const r = await cdp.eval('(function(){' +
      'var G=Game, AID=' + JSON.stringify(s.aaId) + ', HID=' + JSON.stringify(s.heliId) + ';' +
      'var AA=null,H=null;' +
      'for (var k=0;k<G.vehicles.length;k++){ var v=G.vehicles[k]; if(v.id===AID)AA=v; if(v.id===HID)H=v; }' +
      'for (var i=0;i<180;i++){' +
      '  var dt=1/30; G.time+=dt;' +
      '  AA.pos.x=-108; AA.pos.z=0; AA.pos.y=G.heightAt(-108,0); AA.vel={x:0,y:0,z:0};' +
      '  H.pos.x=-50; H.pos.z=0; H.pos.y=26; H.vel={x:0,y:0,z:0};' +
      '  for (var p=0;p<G.__pinned.length;p++){ var pb=G.__pinned[p]; var bot=G.soldiers[pb.id];' +
      '    bot.pos.x=pb.x; bot.pos.z=pb.z; bot.pos.y=G.heightAt(pb.x,pb.z); bot.vel={x:0,y:0,z:0}; }' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); }' +
      'return JSON.stringify({ heliHp: Math.round(H.hp), heliAlive: H.alive });' +
      '})()');
    const a = JSON.parse(r);
    assert(a.heliHp < 480, 'AA 攻击空中直升机（HP ' + a.heliHp + '/480）');

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_aa');
})();
