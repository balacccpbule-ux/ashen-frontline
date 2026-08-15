/* ============================================================
 * tests/test_menu.js — v5.3 菜单功能：AI 难度选择 + 退出对局重新选图
 * 真实菜单流程（无 autotest，rAF 主循环运行）
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_menu: AI 难度 + 退出重新选图 ===');
  const { proc, cdp } = await launchChrome(gameUrl(''), 9254);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }
    await sleep(800);

    const visible = (sel) => cdp.eval('(function(){var e=document.querySelector("' + sel + '");return e && !e.classList.contains("hidden") && e.offsetParent!==null;})()');

    const s0 = await cdp.eval('JSON.stringify({ phase: Game.phase, diffBtns: document.querySelectorAll(".diff-btn").length, selDiff: Game.hud.selectedDiff, presetNames: [AI_PRESETS.easy.name, AI_PRESETS.normal.name, AI_PRESETS.hard.name].join("/") })');
    const r0 = JSON.parse(s0);
    assert(r0.phase === 'menu' && (await visible('#menu')) === true, '初始主菜单');
    assert(r0.diffBtns === 3, '难度三档按钮 (' + r0.diffBtns + ')');
    assert(r0.selDiff === 'normal', '默认普通难度');
    assert(r0.presetNames === '简单/普通/困难', '三档预设存在');

    await cdp.eval('document.querySelector(".diff-btn[data-diff=hard]").click()');
    await cdp.eval('document.querySelector(".map-btn[data-map=snow]").click()');
    await cdp.eval('document.getElementById("btn-start").click()');
    await sleep(400);
    const s1 = await cdp.eval('JSON.stringify({ phase: Game.phase, map: Game.mapId, diff: Game.aiDifficulty, fire: CONFIG.AI_FIRE_CHANCE, engage: CONFIG.AI_ENGAGE_RANGE, react: CONFIG.AI_REACT_MIN, errMin: CONFIG.AI_AIM_ERROR_MIN })');
    const r1 = JSON.parse(s1);
    assert(r1.phase === 'class-select' && r1.map === 'snow', '困难+雪域 → 选兵种界面 (' + r1.map + ')');
    assert(r1.diff === 'hard' && r1.fire === 0.55 && r1.engage === 100 && r1.react === 0.2 && r1.errMin === 0.05, '困难难度参数已应用 (' + r1.fire + '/' + r1.engage + '/' + r1.react + '/' + r1.errMin + ')');

    await cdp.eval('document.getElementById("btn-deploy").click()');
    await sleep(3000);   // v5.42 开局也走俯瞰俯冲飞行视角，需更久真实时间落地
    const playing = await cdp.eval('Game.phase === "playing" && !document.getElementById("hud").classList.contains("hidden")');
    assert(playing === true, '部署进入战斗');
    await cdp.eval('document.getElementById("btn-exit").click()');
    await sleep(400);
    const s2 = await cdp.eval('JSON.stringify({ phase: Game.phase, over: Game.over, hudHidden: document.getElementById("hud").classList.contains("hidden"), menuVisible: !document.getElementById("menu").classList.contains("hidden") })');
    const r2 = JSON.parse(s2);
    assert(r2.phase === 'menu' && r2.over === true && r2.hudHidden === true && r2.menuVisible === true, '退出对局 → 回到主菜单');

    await cdp.eval('document.querySelector(".diff-btn[data-diff=easy]").click()');
    await cdp.eval('document.querySelector(".map-btn[data-map=fort]").click()');
    await cdp.eval('document.getElementById("btn-start").click()');
    await sleep(400);
    const s3 = await cdp.eval('JSON.stringify({ map: Game.mapId, diff: Game.aiDifficulty, fire: CONFIG.AI_FIRE_CHANCE, engage: CONFIG.AI_ENGAGE_RANGE })');
    const r3 = JSON.parse(s3);
    assert(r3.map === 'fort' && r3.diff === 'easy' && r3.fire === 0.25 && r3.engage === 60, '重新选图（钢铁防线）+ 简单难度 (' + r3.map + '/' + r3.diff + ')');

    const errors = cdp.errors();
    for (const e of errors) console.error('  !! ' + e);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_menu');
})();
