/* ============================================================
 * tests/test_shotgun.js — v5 霰弹枪 SG-12：8 弹丸/发 + 陡峭距离衰减
 * 确定性弹丸散布（替换 Math.random 为固定种子 rng）
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_shotgun: 霰弹枪多弹丸 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9250);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    const res = await cdp.eval(`(function(){
      var G = Game, P = G.player;
      G.godMode = true;
      P.slots.primary.def = WEAPONS.shotgun;
      P.slots.primary.mag = WEAPONS.shotgun.mag;
      P.slots.primary.reserve = 99;
      P.slot = 'primary'; P.fireTimer = 0; P.reloading = false;
      G.weapons.initRecoil(P);
      P.pos.x = -108; P.pos.z = 0; P.pos.y = G.heightAt(-108, 0); P.yaw = Math.PI; P.pitch = 0;
      var seedRng = G.newRng(20260707);
      var origRandom = Math.random;
      Math.random = seedRng;
      var pool = G.bots.filter(function(b){ return b.team===1 && !b.bot.crew; });
      var tgt = pool[0];
      tgt.pos.x = P.pos.x; tgt.pos.z = 8; tgt.pos.y = G.heightAt(P.pos.x, 8);
      tgt.vel = {x:0,y:0,z:0}; tgt.spawnProtect = 0; tgt.health = tgt.maxHealth;
      var magBefore = P.slots.primary.mag;
      var fired = G.weapons.fireWeapon(P);
      var magAfterFirst = P.slots.primary.mag;
      var closeDmg = tgt.maxHealth - tgt.health;
      var tgt2 = pool[1];
      tgt2.pos.x = P.pos.x; tgt2.pos.z = 30; tgt2.pos.y = G.heightAt(P.pos.x, 30);
      tgt2.vel = {x:0,y:0,z:0}; tgt2.spawnProtect = 0; tgt2.health = tgt2.maxHealth;
      P.fireTimer = 0;
      var fired2 = G.weapons.fireWeapon(P);
      var farDmg = tgt2.maxHealth - tgt2.health;
      Math.random = origRandom;
      return JSON.stringify({
        pellets: WEAPONS.shotgun.pellets,
        fired: fired, fired2: fired2,
        magUsed: magBefore - magAfterFirst,
        closeDmg: Math.round(closeDmg), farDmg: Math.round(farDmg),
        closeFalloff: +G.weapons.falloffFactor(WEAPONS.shotgun, 8).toFixed(2),
        farFalloff: +G.weapons.falloffFactor(WEAPONS.shotgun, 30).toFixed(2),
        dmrDamage: WEAPONS.dmr ? WEAPONS.dmr.damage : 0,
      });
    })()`);
    const r = JSON.parse(res);
    assert(r.pellets === 8, '霰弹枪 8 弹丸/发 (' + r.pellets + ')');
    assert(r.fired === true && r.fired2 === true && r.magUsed === 1, '一枪一发（单发弹匣 -1，实测 ' + r.magUsed + '）');
    assert(r.closeFalloff > 0.8, '8m 衰减轻微 (' + r.closeFalloff + ')');
    assert(r.farFalloff < 0.4, '30m 衰减陡峭 (' + r.farFalloff + ')');
    assert(r.closeDmg >= 60, '近距高伤（≥60，实测 ' + r.closeDmg + '）');
    assert(r.closeDmg > r.farDmg * 2, '近距伤害显著高于远距 (' + r.closeDmg + ' vs ' + r.farDmg + ')');
    assert(r.dmrDamage === 55, 'DMR 55 伤害存在（v5 新武器）');

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_shotgun');
})();
