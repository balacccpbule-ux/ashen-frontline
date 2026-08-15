/* 灰烬战线 · 武器系统验证（v2.6 手感/数值/FX/音效/换枪/装备 11 项断言）
 * 用法：node test_weapons.js
 * 全部在确定性 eval 内完成（不调用 ai.update，bot 不会移动）：
 *  T1 后坐 pattern 确定性（同种子序列一致）
 *  T2 后坐弹簧回中（10 枪峰值 → 停火 1.5s 回落至 40% 以下）
 *  T3 距离衰减数值（平方插值，狙击无衰减）
 *  T4 部位倍率（射线直测 head/torso/legs 高度带）
 *  T5 ADS（FOV 收敛/灵敏度缩放/移速降低）
 *  T6 点击缓冲（同帧点击恰一发）
 *  T7 换弹三阶段音效时序（sound._log 边沿事件）
 *  T8 FX 池（弹孔环形复用/弹壳抛射与回收）
 *  T9 AI 选枪打分（近/远/打空）
 *  T10 换枪状态机（单次完成/后按优先/切完可开火）
 *  T11 爆炸物槽（切换无异常/装备击杀播报/切回）
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
// GAME_FILE 环境变量可指定被测文件（默认 index.html；打包产物验证用）
const FILE = path.resolve(__dirname, process.env.GAME_FILE || 'index.html').replace(/\\/g, '/');
const URL = 'file:///' + FILE + '?autotest=1';
const PORT = Number(process.env.TEST_PORT) || 9232;
const GADGET_NAME = '下挂榴弹'; // 突击兵默认装备（autotest 部署兵种）
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-wpn-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('CDP 超时');
}

function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--enable-unsafe-swiftshader', '--disable-gpu', '--use-angle=swiftshader',
    '--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,720', `--user-data-dir=${profile}`, URL,
  ], { stdio: 'ignore' });

  (async () => {
    const ws = new WebSocket(await getPageWs());
    let id = 0; const pending = new Map();
    const exceptions = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data.toString());
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown')
        exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const send = (method, params = {}) => new Promise((res) => {
      const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
    await send('Runtime.enable'); await send('Log.enable');

    for (let i = 0; i < 40; i++) {
      const r = await evl('typeof Game !== "undefined" && Game.player ? "ok" : "waiting"');
      if (r === 'ok') break;
      await sleep(300);
    }

    const results = [];
    const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '✓' : '✗') + ' ' + name + (detail ? ' · ' + detail : '')); };
    const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

    // ---- 环境准备：玩家置于红基地、bot 全隔离（本测试不步进 ai，bot 静止） ----
    await evl(`(function(){
      var G=Game, P=G.player;
      G.godMode=true; P.spawnProtect=0;
      P.pos.x=-72; P.pos.z=0; P.pos.y=G.heightAt(-72,0); P.vel={x:0,y:0,z:0};
      G.bots.forEach(function(b){
        var x = b.team===0 ? -78 : 78, z = b.team===0 ? 78 : -78;
        b.pos.x=x; b.pos.z=z; b.pos.y=G.heightAt(x,z); b.vel={x:0,y:0,z:0};
        b.spawnProtect=9999;
      });
      return 'ok';
    })()`);

    // ---- T1 后坐 pattern 确定性 ----
    const R1 = parse(await evl(`(function(){
      var a = Game.math.buildRecoilPattern(WEAPONS.ar.recoilDef, 12345);
      var b = Game.math.buildRecoilPattern(WEAPONS.ar.recoilDef, 12345);
      var c = Game.math.buildRecoilPattern(WEAPONS.ar.recoilDef, 54321);
      var same = true, diff = false, N = 20;
      for (var i=0;i<N;i++){ if (a[i] !== b[i]) same = false; if (a[i] !== c[i]) diff = true; }
      return JSON.stringify({ same: same, diff: diff, pitch0: +a[0].toFixed(4) });
    })()`));
    check('T1 pattern：同种子序列一致且异种子不同', R1 && R1.same === true && R1.diff === true && R1.pitch0 > 0,
      'pitch0=' + (R1 ? R1.pitch0 : '?'));

    // ---- T2 后坐弹簧回中 ----
    const R2 = parse(await evl(`(function(){
      var G=Game, P=G.player;
      Game.weapons.initRecoil(P);
      Game.weapons.switchSlot(P, 'primary');
      P.slots.primary.mag = 30;
      var mag0 = P.slots.primary.mag;
      for (var i=0;i<10;i++){ P.fireTimer=0; Game.weapons.fireWeapon(P); }
      Game.weapons.update(1/30); // kick 只在 step 后写入 value（与 CoD 一致），先同步一帧再测峰值
      var peak = Math.abs(P.recoilPitch.value);
      for (var j=0;j<44;j++){ Game.weapons.update(1/30); }
      var after = Math.abs(P.recoilPitch.value);
      return JSON.stringify({ shots: mag0 - P.slots.primary.mag, peak: +peak.toFixed(4), after: +after.toFixed(5) });
    })()`));
    check('T2 弹簧回中：10 枪有峰值且停火 1.5s 回落 <40%',
      R2 && R2.shots === 10 && R2.peak > 0.05 && R2.after < R2.peak * 0.4,
      'peak=' + (R2 ? R2.peak : '?') + ' after=' + (R2 ? R2.after : '?'));

    // ---- T2.5 v5.20 后坐强度回归：全自动 1.5s 枪口爬升明显（修复"无后座感"） ----
    const R25 = parse(await evl(`(function(){
      var G=Game, P=G.player;
      Game.weapons.initRecoil(P);
      Game.weapons.switchSlot(P, 'primary');
      P.slots.primary.mag = 30;
      P.fireTimer = 0; P.reloading = false;
      P.pitch = 0; P.yaw = 0;
      var peak = 0;
      for (var i=0;i<45;i++){
        var dt=1/30; G.time+=dt;
        if (P.fireTimer <= 0 && !P.reloading && P.slots.primary.mag > 0) Game.weapons.fireWeapon(P);
        Game.weapons.update(dt);
        if (P.recoilPitch.value > peak) peak = P.recoilPitch.value;
      }
      return JSON.stringify({ peak: +peak.toFixed(4) });
    })()`));
    check('T2.5 后坐强度：全自动 1.5s 枪口爬升 ≥0.05rad（~2.9°，可感知）',
      R25 && R25.peak >= 0.05, 'peak=' + (R25 ? R25.peak : '?'));

    // ---- T3 距离衰减 ----
    // v5.52 参数重调：AR/LMG dropoff=0（无衰减）、狙击本无衰减；用 SMG（dropoff 0.45）验证平方插值仍生效
    const R3 = parse(await evl(`(function(){
      var f1 = Game.weapons.falloffFactor(WEAPONS.ar, 60);
      var f2 = Game.weapons.falloffFactor(WEAPONS.ar, 120);
      var f3 = Game.weapons.falloffFactor(WEAPONS.sniper, 400);
      var f4 = Game.weapons.falloffFactor(WEAPONS.ar, 0);
      var s1 = Game.weapons.falloffFactor(WEAPONS.smg, 45);
      var s2 = Game.weapons.falloffFactor(WEAPONS.smg, 90);
      return JSON.stringify({ f1:+f1.toFixed(4), f2:+f2.toFixed(4), f3:+f3.toFixed(4), f4:+f4.toFixed(4), s1:+s1.toFixed(4), s2:+s2.toFixed(4) });
    })()`));
    check('T3 衰减：AR/狙击无衰减（dropoff 0）+ SMG 平方插值',
      R3 && R3.f1 === 1 && R3.f2 === 1 && R3.f3 === 1 && R3.f4 === 1 &&
      Math.abs(R3.s1 - 0.8625) < 0.001 && Math.abs(R3.s2 - 0.45) < 0.001,
      'ar(60/120)=' + (R3 ? R3.f1 + '/' + R3.f2 : '?') + ' smg(45/90)=' + (R3 ? R3.s1 + '/' + R3.s2 : '?'));

    // ---- T4 部位倍率（射线直测高度带） ----
    const R4 = parse(await evl(`(function(){
      var G=Game;
      var tgt = G.bots.filter(function(b){return b.team===1 && !b.bot.crew;})[0];
      tgt.pos.x=-100; tgt.pos.z=0; tgt.pos.y=G.heightAt(-100,0);
      tgt.alive=true; tgt.health=100; tgt.spawnProtect=0; tgt.vel={x:0,y:0,z:0}; tgt.crouching=false;
      function probe(y){ var h = Game.weapons.hitTest({x:-108,y:tgt.pos.y+y,z:0},{x:1,y:0,z:0},50,G.player); return h && h.type==='soldier' ? h.part : null; }
      return JSON.stringify({ head: probe(1.7), torso: probe(1.0), legs: probe(0.2) });
    })()`));
    check('T4 部位：头/躯干/腿高度带判定',
      R4 && R4.head === 'head' && R4.torso === 'torso' && R4.legs === 'legs',
      JSON.stringify(R4));

    // ---- T5 ADS 三件套 ----
    const R5 = parse(await evl(`(function(){
      var G=Game, P=G.Player;
      Game.weapons.switchSlot(G.player,'primary');
      P.ads=true; P.switching=0;
      for (var i=0;i<45;i++){ P.update(1/30); }
      var fov = Game.camera.fov, ease = P.adsEase, sens = P.sensScale;
      P.keys.add('KeyW');
      for (var j=0;j<30;j++){ P.update(1/30); }
      P.keys.delete('KeyW');
      var spd = Math.hypot(G.player.vel.x, G.player.vel.z);
      P.ads=false;
      return JSON.stringify({ fov:+fov.toFixed(1), ease:+ease.toFixed(2), sens:+sens.toFixed(3), spd:+spd.toFixed(2) });
    })()`));
    check('T5 ADS：FOV 收敛到 adsFov、灵敏度缩放、移速 -40%',
      R5 && Math.abs(R5.fov - 47) < 1.5 && R5.ease > 0.9 && R5.sens < 0.6 && R5.sens > 0.17 && R5.spd > 4.0 && R5.spd < 4.7,
      'fov=' + (R5 ? R5.fov : '?') + ' sens=' + (R5 ? R5.sens : '?') + ' spd=' + (R5 ? R5.spd : '?'));

    // ---- T6 点击缓冲 ----
    const R6 = parse(await evl(`(function(){
      var G=Game, P=G.Player;
      Game.weapons.switchSlot(G.player,'secondary');
      G.player.fireTimer=0;
      var mag0 = G.player.slots.secondary.mag;
      P.clickBuf = 0.12; P.trigger = false; P.switching = 0;
      P.update(1/30);
      P.update(1/30);
      var used = mag0 - G.player.slots.secondary.mag;
      Game.weapons.switchSlot(G.player,'primary');
      return JSON.stringify({ used: used });
    })()`));
    check('T6 点击缓冲：一次点击恰一发', R6 && R6.used === 1, 'used=' + (R6 ? R6.used : '?'));

    // ---- T7 换弹三阶段音效时序 ----
    const R7 = parse(await evl(`(function(){
      var G=Game, P=G.player;
      Game.weapons.switchSlot(P,'primary');
      P.fireTimer=0;
      P.slots.primary.mag = 0; P.slots.primary.reserve = 30;
      Game.sound.resetLog();
      Game.weapons.startReload(P);
      for (var i=0;i<66;i++){ G.time += 1/30; Game.weapons.update(1/30); }
      var log = Game.sound._log.filter(function(e){ return /^reload/.test(e.n); });
      var seq = log.map(function(e){ return e.n; });
      var dt1 = -1, dt2 = -1;
      if (log.length >= 3) { dt1 = log[1].t - log[0].t; dt2 = log[2].t - log[0].t; }
      return JSON.stringify({ seq: seq, dt1:+dt1.toFixed(2), dt2:+dt2.toFixed(2), mag: P.slots.primary.mag, reloading: P.reloading });
    })()`));
    check('T7 换弹：退匣→入匣(≈38%)→拉机柄(≈78%) 时序',
      R7 && R7.seq.length === 3 && R7.seq[0] === 'reloadStart' && R7.seq[1] === 'reloadMagIn' && R7.seq[2] === 'reloadBolt' &&
      R7.dt1 > 0.7 && R7.dt1 < 0.9 && R7.dt2 > 1.5 && R7.dt2 < 1.8 && R7.mag === 30 && R7.reloading === false,
      (R7 ? R7.seq.join('→') : '?') + ' Δ=' + (R7 ? R7.dt1 + '/' + R7.dt2 : '?'));

    // ---- T8 FX 池（弹孔贴花已按用户要求移除，只验证弹壳池） ----
    const R8 = parse(await evl(`(function(){
      var G=Game, E=Game.effects;
      var n0 = E.shells.filter(function(s){return s.active;}).length;
      E.ejectShell({x:0,y:2,z:0},{x:0,y:0,z:-1});
      var n1 = E.shells.filter(function(s){return s.active;}).length;
      for (var i=0;i<200;i++){ G.time+=1/30; E.update(1/30); }
      var n2 = E.shells.filter(function(s){return s.active;}).length;
      return JSON.stringify({ eject: (n1-n0)===1, recycled: n2===0, pool: E.shells.length });
    })()`));
    check('T8 FX 池：弹壳抛射/寿命回收（弹孔已移除）',
      R8 && R8.eject === true && R8.recycled === true && R8.pool === 30,
      JSON.stringify(R8));

    // ---- T9 AI 选枪打分 ----
    const R9 = parse(await evl(`(function(){
      var G=Game;
      var bot = G.bots.filter(function(b){return b.team===1 && !b.bot.crew && b.clsKey==='recon';})[0];
      var r1 = Game.ai.chooseWeapon(bot, 10);   // 近距：狙击弱 → 手枪
      var r2 = Game.ai.chooseWeapon(bot, 200);  // 远距：狙击强 → 主武器
      var saveM = bot.slots.primary.mag, saveR = bot.slots.primary.reserve;
      bot.slots.primary.mag = 0; bot.slots.primary.reserve = 0;
      var r3 = Game.ai.chooseWeapon(bot, 50);   // 打空 → 手枪
      bot.slots.primary.mag = saveM; bot.slots.primary.reserve = saveR;
      return JSON.stringify({ near: r1, far: r2, empty: r3 });
    })()`));
    check('T9 AI 选枪：近距切手枪/远距狙击/打空切手枪',
      R9 && R9.near === 'secondary' && R9.far === 'primary' && R9.empty === 'secondary',
      JSON.stringify(R9));

    // ---- T10 换枪状态机（v2.6 卡死回归：倒计时冻结 → 切不出/开不了火） ----
    const R10 = parse(await evl(`(function(){
      var G=Game, P=G.Player, s=G.player;
      P.switching=0; P.pendingSlot=null;
      // 单次切换：主→副（pistol drawTime 0.35+0.22=0.57s，30 帧足够）
      P.requestSwitch('secondary');
      for (var i=0;i<30;i++){ P.update(1/30); }
      var r1 = (s.slot==='secondary' && P.switching===0);
      // 换枪中后按优先：请求副武器后立刻请求主武器 → 应停在主武器
      P.requestSwitch('secondary'); P.requestSwitch('primary');
      for (var j=0;j<40;j++){ P.update(1/30); }
      var r2 = (s.slot==='primary' && P.switching===0);
      // 切完必须能开火（switching 不冻结）：切到手枪后点击一发
      P.requestSwitch('secondary');
      for (var k=0;k<30;k++){ P.update(1/30); }
      var mag0 = s.slots.secondary.mag;
      s.fireTimer=0; P.clickBuf=0.12; P.trigger=false;
      P.update(1/30);
      var fired = mag0 - s.slots.secondary.mag;
      Game.weapons.switchSlot(s,'primary');
      return JSON.stringify({ single: r1, override: r2, fired: fired });
    })()`));
    check('T10 换枪：单次完成、后按优先、切完可开火',
      R10 && R10.single === true && R10.override === true && R10.fired === 1,
      JSON.stringify(R10));

    // ---- T11 爆炸物切换/击杀（v2.6 闪退回归：gadget 槽无 activeWeapon） ----
    const R11 = parse(await evl(`(function(){
      var G=Game, P=G.Player, s=G.player;
      var err = null;
      P.switching=0; P.pendingSlot=null;
      P.requestSwitch('gadget');
      for (var i=0;i<30;i++){
        try { P.update(1/30); G.weapons.update(1/30); G.hud.update(1/30); }
        catch(e){ err = String(e); break; }
      }
      var slotOk = s.slot==='gadget';
      // 装备击杀 → 击杀播报应使用装备名（activeWeapon 为空时不崩）
      var tgt = G.bots.filter(function(b){return b.team===1 && !b.bot.crew;})[0];
      tgt.pos.x=-100; tgt.pos.z=0; tgt.pos.y=G.heightAt(-100,0);
      tgt.alive=true; tgt.health=100; tgt.spawnProtect=0;
      var killErr = null;
      try { G.weapons.applyDamage(tgt, 9999, s, tgt.pos, false); } catch(e){ killErr = String(e); }
      var feed = G.killfeed[G.killfeed.length-1];
      var feedName = feed ? feed.weapon : 'none';
      // 切回主武器继续可用
      P.requestSwitch('primary');
      for (var j=0;j<40;j++){ try { P.update(1/30); } catch(e){ err = err || String(e); break; } }
      var backOk = s.slot==='primary';
      return JSON.stringify({ err: err, slotOk: slotOk, killErr: killErr, feedName: feedName, backOk: backOk });
    })()`));
    check('T11 爆炸物：切换无异常、击杀播报用装备名、可切回',
      R11 && R11.err === null && R11.slotOk === true && R11.killErr === null &&
      R11.feedName === GADGET_NAME && R11.backOk === true,
      JSON.stringify(R11));

    // ---- T12 v5.23 伤害跳数字：准星附近显示伤害值（爆头金色 / 载具琥珀） ----
    const R12 = parse(await evl(`(function(){
      var G=Game, P=G.player;
      var foe = G.bots.filter(function(b){return b.team===1 && !b.bot.crew;})[0];
      foe.alive = true; foe.health = 100; foe.shield = 0; foe.spawnProtect = 0;
      var hud = document.getElementById('hud');
      var n0 = hud.querySelectorAll('.dmg-pop').length;
      G.weapons.applyDamage(foe, 27, P, foe.pos, false);
      var n1 = hud.querySelectorAll('.dmg-pop').length;
      var txt = n1 > n0 ? hud.querySelectorAll('.dmg-pop')[n1-1].textContent : null;
      G.weapons.applyDamage(foe, 20, P, foe.pos, true);
      var pops = hud.querySelectorAll('.dmg-pop');
      var crit = pops[pops.length-1] ? pops[pops.length-1].style.color : null;
      var tank = G.vehicles.filter(function(v){ return v.kind==='tank' && v.team===1; })[0];
      var n2 = hud.querySelectorAll('.dmg-pop').length;
      G.weapons.damageVehicle(tank, 100, P, 'shell');
      var n3 = hud.querySelectorAll('.dmg-pop').length;
      var vehTxt = n3 > n2 ? hud.querySelectorAll('.dmg-pop')[n3-1].textContent : null;
      return JSON.stringify({ added: n1 - n0, txt: txt, crit: crit, vehTxt: vehTxt });
    })()`));
    check('T12 伤害跳数字：准星附近显示伤害值', R12 && R12.added >= 1 && R12.txt === '+27',
      'txt=' + (R12 ? R12.txt : '?') + ' added=' + (R12 ? R12.added : '?'));
    check('T12b 爆头伤害数字金色', R12 && R12.crit === 'rgb(255, 215, 94)',
      'crit=' + (R12 ? R12.crit : '?'));
    check('T12c 载具伤害也跳数字', R12 && R12.vehTxt === '+100',
      'veh=' + (R12 ? R12.vehTxt : '?'));

    // ---- T13 v5.36 鼠标爆发位移过滤（防瞬间转一大圈） ----
    const R13 = parse(await evl(`(function(){
      var G=Game, P=G.Player;
      P.locked = true; P.dx = 0; P.dy = 0;
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: 1000, movementY: 600 }));
      var afterSpike = P.dx + P.dy;
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: -40 }));
      var normal = { dx: P.dx, dy: P.dy };
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: 180, movementY: 0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: 180, movementY: 0 }));
      var clamped = P.dx;
      P.locked = false;
      return JSON.stringify({ afterSpike: afterSpike, normal: normal, clamped: clamped });
    })()`));
    check('T13 异常大位移被过滤（不瞬转一圈）', R13 && R13.afterSpike === 0, JSON.stringify(R13));
    check('T13b 正常位移正常累计', R13 && R13.normal.dx === 100 && R13.normal.dy === -40, JSON.stringify(R13));
    check('T13c 单帧累积量钳制', R13 && R13.clamped === 220, JSON.stringify(R13));

    const pass = results.every((r) => r.ok) && exceptions.length === 0;
    console.log('\n致命异常:', exceptions.length === 0 ? '(无)' : exceptions.slice(0, 10).join('\n'));
    console.log('RESULT:', pass ? 'PASS' : 'FAIL');
    ws.close(); chrome.kill();
    process.exit(pass ? 0 : 1);
  })().catch((e) => { console.error('测试失败:', e.message); chrome.kill(); process.exit(2); });
}
main();
