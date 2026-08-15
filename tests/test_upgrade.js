/* ============================================================
 * tests/test_upgrade.js — v5.10 综合升级：
 * RPG 反甲弹药倍率 / 突击兵护盾 / 医疗兵回血 / 装填读条 /
 * 装备开镜 / 迫击炮&医疗兵换枪
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_upgrade: v5.10 综合 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9258);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // 1) RPG 参数 + 反甲倍率
    const r1 = await cdp.eval('(function(){' +
      'var G=Game, g=GADGETS.rocket;' +
      'var tank = G.vehicles.filter(function(v){return v.kind==="tank" && v.alive;})[0];' +
      'var foe = G.bots.filter(function(b){return b.team===1 && !b.bot.crew;})[0];' +
      'tank.pos.x = -50; tank.pos.z = 0; foe.pos.x = -50; foe.pos.z = 0; foe.pos.y = G.heightAt(-50,0); foe.spawnProtect = 0; foe.health = 100;' +
      'var t0 = tank.hp;' +
      'G.weapons.areaDamage({x:tank.pos.x, y:tank.pos.y, z:tank.pos.z}, 5, 100, null, "rocket", true);' +
      'var tankDrop = Math.round(t0 - tank.hp);' +
      'tank.pos.x = 60; tank.pos.z = 0; foe.health = 100;' +   // 移开坦克，避免第一发溅射波及步兵
      'G.weapons.areaDamage({x:foe.pos.x, y:foe.pos.y + 1, z:foe.pos.z}, 5, 100, null, "rocket", true);' +
      'var infDrop = Math.round(100 - foe.health);' +
      'return JSON.stringify({ speed: g.speed, gravity: g.gravity, scope: !!g.scope, adsFov: g.adsFov, ammo: g.ammo, tankDrop: tankDrop, infDrop: infDrop });' +
      '})()');
    const a = JSON.parse(r1);
    assert(a.speed === 95 && a.gravity === 2, 'RPG 飞弹快 + 下坠小（' + a.speed + 'm/s / 重力 ' + a.gravity + '）');
    assert(a.scope === true && a.adsFov === 30, 'RPG 可开镜（30°）');
    assert(a.tankDrop === 200, 'RPG 对载具 ×2（实测 ' + a.tankDrop + '）');
    assert(a.infDrop === 35, 'RPG 对步兵溅射 ×0.35（实测 ' + a.infDrop + '）');

    // 2) 突击兵护盾：120 点 ≈ 60 血，无法补充
    const r2 = await cdp.eval('(function(){' +
      'var G=Game; G.hud.selectClass("assault"); G.deployPlayer();' +
      'var p=G.player; p.spawnProtect=0;' +
      'var sh0 = p.shield;' +
      'G.weapons.applyDamage(p, 40, null, p.pos);' +
      'var sh1 = p.shield, hp1 = p.health;' +
      'G.weapons.applyDamage(p, 40, null, p.pos);' +
      'var sh2 = p.shield, hp2 = Math.round(p.health);' +
      'return JSON.stringify({ sh0: sh0, sh1: sh1, hp1: hp1, sh2: sh2, hp2: hp2 });' +
      '})()');
    const b = JSON.parse(r2);
    assert(b.sh0 === 120, '突击兵 120 护盾');
    assert(b.sh1 === 40 && b.hp1 === 100, '护盾吸收伤害（40 伤害 → 护盾 40 / 血量不变）');
    assert(b.sh2 === 0 && b.hp2 === 80, '护盾耗尽后扣血（120 护盾 ≈ 60 血）');

    // 3) 医疗兵呼吸回血
    const r3 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'var med = G.bots.filter(function(b){return b.team===0 && b.clsKey==="medic" && !b.bot.crew;})[0];' +
      'med.health = 30; med.lastHurtTime = G.time - 10;' +
      'G.weapons.updateMedicRegen(2);' +
      'return JSON.stringify({ hp: Math.round(med.health) });' +
      '})()');
    const c = JSON.parse(r3);
    assert(c.hp === 38, '医疗兵呼吸回血（30 → ' + c.hp + '，+4/s）');

    // 4) 装填读条（换弹 + 装备冷却）
    const r4 = await cdp.eval('(function(){' +
      'var G=Game; G.hud.selectClass("assault"); G.deployPlayer();' +
      'var p=G.player; p.pos.x=-72; p.pos.z=0;' +
      'p.slots.primary.mag = 1;' +   // 弹匣不满才能触发换弹
      'G.weapons.startReload(p);' +
      'G.hud.update(0.016);' +
      'var barVisible = !document.getElementById("reload-bar").classList.contains("hidden");' +
      'var w1 = document.getElementById("reload-fill").style.width;' +
      'p.reloading = false; p.gadgetCooldown = 1.25; p.gadgetCdMax = 2.5;' +
      'G.hud.update(0.016);' +
      'var w2 = document.getElementById("reload-fill").style.width;' +
      'return JSON.stringify({ barVisible: barVisible, w1: w1, w2: w2 });' +
      '})()');
    const d = JSON.parse(r4);
    assert(d.barVisible === true, '装填读条显示');
    assert(parseFloat(d.w1) >= 0 && parseFloat(d.w1) < 100, '换弹读条进行中（' + d.w1 + '）');
    assert(parseFloat(d.w2) === 50, '装备冷却读条（' + d.w2 + '）');

    // 5) 装备开镜（RPG）
    const r5 = await cdp.eval('(function(){' +
      'var G=Game; G.hud.selectClass("engineer"); G.deployPlayer();' +
      'var p=G.player; p.pos.x=-72; p.pos.z=0; p.slot="gadget";' +
      'G.Player.ads = true;' +
      'for (var k=0;k<30;k++){ var dt=1/30; G.time+=dt; G.Player.update(dt); }' +
      'return JSON.stringify({ scoped: G.Player.scoped, fov: Math.round(G.camera.fov) });' +
      '})()');
    const e = JSON.parse(r5);
    assert(e.scoped === true && e.fov <= 32, '工程兵 RPG 开镜（scoped / FOV ' + e.fov + '）');

    // 6) 迫击炮兵 → DMR，医疗兵 → 霰弹枪
    const r6 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'var mort = G.bots.filter(function(b){return b.team===0 && b.clsKey==="mortar" && !b.bot.crew;})[0];' +
      'var med = G.bots.filter(function(b){return b.team===0 && b.clsKey==="medic" && !b.bot.crew;})[0];' +
      'return JSON.stringify({ mW: mort.slots.primary.def.key, dW: med.slots.primary.def.key, mCls: CLASSES.mortar.weapon, dCls: CLASSES.medic.weapon });' +
      '})()');
    const f = JSON.parse(r6);
    assert(f.mW === 'dmr' && f.mCls === 'dmr', '迫击炮兵配 MK-14 DMR');
    assert(f.dW === 'aa12' && f.dCls === 'aa12', '医疗兵配 AA-12 全自动霰弹枪');

    // 6.5) v5.25 枪模自动刷新：换兵种后无需切枪即显示正确枪模
    const r65 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'G.hud.selectClass("medic"); G.deployPlayer();' +   // 换医疗兵（AA-12）
      'var p=G.player; p.pos.x=-72; p.pos.z=0;' +
      'var dt=1/30; G.time+=dt; G.Player.update(dt);' +   // 一帧自动对账
      'var aa12On = G.Player.models.aa12.visible === true;' +
      'var arOn = G.Player.models.ar.visible === true;' +
      'G.hud.selectClass("recon"); G.deployPlayer();' +   // 换侦察兵（狙击）
      'var dt2=1/30; G.time+=dt2; G.Player.update(dt2);' +
      'var sniperOn = G.Player.models.sniper.visible === true;' +
      'var aa12Off = G.Player.models.aa12.visible === false;' +
      'return JSON.stringify({ aa12On: aa12On, arOn: arOn, sniperOn: sniperOn, aa12Off: aa12Off });' +
      '})()');
    const g65 = JSON.parse(r65);
    assert(g65.aa12On === true && g65.arOn === false, '换兵种后枪模自动刷新（AA-12 显示 / AR 隐藏），无需切枪');
    assert(g65.sniperOn === true && g65.aa12Off === true, '再换兵种枪模继续跟随（狙击显示 / AA-12 隐藏）');

    // 7) AA-12 全自动连喷 + 读条非战斗隐藏 + 换枪点击排队
    const r7 = await cdp.eval('(function(){' +
      'var G=Game;' +
      'var aa = WEAPONS.aa12;' +
      'var p = G.player; p.reloading = false; p.gadgetCooldown = 0;' +
      'G.hud.update(0.016);' +
      'var idleHidden = document.getElementById("reload-bar").classList.contains("hidden");' +
      'G.Player.locked = true;' +
      'G.Player.switching = 0.5; G.Player.switchTotal = 0.5;' +
      'document.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));' +
      'var buf = G.Player.clickBuf;' +
      'G.Player.locked = false; G.Player.switching = 0;' +
      'return JSON.stringify({ auto: aa.auto, pellets: aa.pellets, rate: aa.rate, idleHidden: idleHidden, buf: +buf.toFixed(2) });' +
      '})()');
    const g = JSON.parse(r7);
    assert(g.auto === true && g.pellets === 8 && g.rate === 0.14, 'AA-12 全自动 8 弹丸 7 发/秒');
    assert(g.idleHidden === true, '非换弹/装填时读条隐藏（不常驻）');
    assert(g.buf >= 0.5, '换枪期间点击排队到枪就绪（clickBuf ' + g.buf + 's）');

    // 8) v5.17 栓狙拉栓：动画（拉栓柄后拉）+ 强制收镜 + 拉栓读条
    const r8 = await cdp.eval('(function(){' +
      'var G=Game; G.hud.selectClass("recon"); G.deployPlayer();' +
      'var p=G.player; p.pos.x=-72; p.pos.z=0; p.spawnProtect=0;' +
      'p.slot = "primary";' +
      'G.Player.ads = true;' +
      'var dt;' +
      'for (var i=0;i<20;i++){ dt=1/30; G.time+=dt;' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.weapons.update(dt); }' +   // 开镜完全展开
      'var scopedBefore = G.Player.scoped;' +
      'G.weapons.fireWeapon(p);' +
      'var boltT0 = p.boltT;' +
      'for (var i=0;i<5;i++){ dt=1/30; G.time+=dt;' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.weapons.update(dt); G.hud.update(dt); }' +   // 拉栓中段
      'var adsEaseDuring = +G.Player.adsEase.toFixed(2);' +
      'var barVisible = !document.getElementById("reload-bar").classList.contains("hidden");' +
      'var barColor = document.getElementById("reload-fill").style.background;' +
      'var boltZ = G.Player.boltParts && G.Player.boltParts.sniper ? +G.Player.boltParts.sniper.position.z.toFixed(3) : -1;' +
      'for (var j=0;j<30;j++){ dt=1/30; G.time+=dt;' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.weapons.update(dt); G.hud.update(dt); }' +   // 拉栓结束 + 回镜
      'var boltAfter = p.boltT;' +
      'var adsEaseAfter = +G.Player.adsEase.toFixed(2);' +
      'var barHiddenAfter = document.getElementById("reload-bar").classList.contains("hidden");' +
      'var boltZAfter = G.Player.boltParts && G.Player.boltParts.sniper ? +G.Player.boltParts.sniper.position.z.toFixed(3) : -1;' +
      'G.Player.ads = false;' +
      'return JSON.stringify({ boltT0: +boltT0.toFixed(2), scopedBefore: scopedBefore, adsEaseDuring: adsEaseDuring, barVisible: barVisible,' +
      '  barColor: barColor, boltZ: boltZ, boltAfter: boltAfter, adsEaseAfter: adsEaseAfter, barHiddenAfter: barHiddenAfter, boltZAfter: boltZAfter });' +
      '})()');
    const h = JSON.parse(r8);
    assert(h.boltT0 === 0.9, '栓狙开火进入拉栓（boltT=' + h.boltT0 + '）');
    assert(h.scopedBefore === true, '开火前处于开镜状态');
    assert(h.adsEaseDuring < 0.8, '拉栓期间强制收镜（adsEase ' + h.adsEaseDuring + '）');
    assert(h.barVisible === true, '拉栓读条显示');
    assert(h.barColor.indexOf('255, 176, 74') >= 0, '拉栓读条为琥珀色（' + h.barColor + '）');
    assert(h.boltZ > 0.01, '拉栓柄后拉动画（z=' + h.boltZ + '）');
    assert(h.boltAfter <= 0, '拉栓结束（boltT=' + h.boltAfter + '）');
    assert(h.adsEaseAfter > h.adsEaseDuring, '拉栓结束按住右键自动回镜（' + h.adsEaseDuring + '→' + h.adsEaseAfter + '）');
    assert(h.barHiddenAfter === true, '拉栓读条结束后隐藏');
    assert(h.boltZAfter === 0, '拉栓柄回位（z=' + h.boltZAfter + '）');

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_upgrade');
})();
