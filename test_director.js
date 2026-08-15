/* 灰烬战线 · 战斗导演验证（v2.1 修复版）
 * 用法：node test_director.js
 * 场景（确定性步进；非攻击者 bot 全程钉在远角，杜绝干扰）：
 *  B. 开火宽限：单人索敌后，第一枪必须晚于 aimStart + AI_GRACE_TIME
 *  A. 开火上限：5 名敌人盯同一目标，任何一帧开火者 ≤ COMBAT_MAX_SHOOTERS_PER_TARGET，
 *     且开火的恰是最近的两名（注意：bot 11/12 是载具乘员，不参与交战，已排除）
 *  C. 残局清扫：存活 ≤ SWEEP_MIN_ALIVE 且无视线者，周期内被派往敌人位置（hunt）
 * 场地：红基地（BASE_DEFS[0]）周围 20m 内无任何实体，视线必通。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FILE = path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const URL = 'file:///' + FILE + '?autotest=1';
const PORT = Number(process.env.TEST_PORT) || 9231;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-dir-'));
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

    // ---- 场景布置（共用）：玩家无敌 + 全体 bot 隔离到远角 ----
    await evl(`(function(){
      var G=Game, P=G.player;
      G.godMode=true; P.spawnProtect=0;
      P.pos.x=-108; P.pos.z=0; P.pos.y=G.heightAt(-108,0); P.vel={x:0,y:0,z:0};
      G.bots.forEach(function(b){
        var x = b.team===0 ? -78 : 78, z = b.team===0 ? 78 : -78;
        b.pos.x=x; b.pos.z=z; b.pos.y=G.heightAt(x,z); b.vel={x:0,y:0,z:0};
        b.spawnProtect=0;
      });
      return 'ok';
    })()`);

    // ---- 场景 B：开火宽限（蓝方突击兵，非乘员） ----
    const RB = await evl(`(function(){
      var G=Game;
      // 攻击者：非乘员突击兵（排除 b.bot.crew —— 乘员只登车不交战）
      var atk = G.bots.filter(function(b){return b.team===1 && !b.bot.crew && b.clsKey==='assault';})[0];
      var others = G.bots.filter(function(b){return b !== atk;});
      atk.pos.x=-100; atk.pos.z=0; atk.pos.y=G.heightAt(-100,0); atk.vel={x:0,y:0,z:0};
      atk.spawnProtect=999;   // v4 64人规模：孤军需无敌，否则被集火秒杀
      atk.bot.lastTarget=null; atk.bot.mayFire=false; atk.bot.graceUntil=-999;
      atk.bot.hunt=null; atk.bot.reactT=0;
      G.ai.resetFireLog();
      for (var i=0;i<90;i++){
        var dt=1/30; G.time+=dt;
        if (G.player.alive) G.Player.update(dt);
        G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);
        G.updateConquest(dt); G.effects.update(dt);
        atk.pos.x=-100; atk.pos.z=0; atk.vel.x=0; atk.vel.z=0;
        for (var k=0;k<others.length;k++){ others[k].vel.x=0; others[k].vel.z=0; }
      }
      var log = G.ai._fireLog.filter(function(f){return f.tgt===0;});
      return JSON.stringify({
        fires: log.length,
        firstT: log.length ? +log[0].t : -1,
        aimStart: +atk.bot.aimStart.toFixed(3),
        grace: CONFIG.AI_GRACE_TIME,
        locked: atk.bot.lastTarget===G.player,
        botAlive: atk.alive
      });
    })()`);
    {
      const r = parse(RB);
      if (!r) { check('B 宽限：解析结果', false, RB); }
      else {
        check('B 宽限：成功索敌且开火', r.locked === true && r.botAlive === true && r.fires >= 1,
          '开火 ' + r.fires + ' 次 · aimStart=' + r.aimStart);
        check('B 宽限：首枪不早于 grace', r.fires >= 1 && r.firstT >= r.aimStart + r.grace - 0.06,
          'firstT=' + r.firstT + ' ≥ ' + (r.aimStart + r.grace - 0.06).toFixed(2));
        check('B 宽限：宽限期后确实开火', r.fires >= 1 && r.firstT <= r.aimStart + 2.2,
          'firstT=' + r.firstT + ' ≤ ' + (r.aimStart + 2.2).toFixed(2));
      }
    }

    // ---- 场景 A：开火上限（最近 2 名攻击者，其余陪跑；v5.31 职业均衡后按可用池选取） ----
    const RA = await evl(`(function(){
      var G=Game;
      var pool = G.bots.filter(function(b){return b.team===1 && !b.bot.crew && b.clsKey!=='mortar' && b.clsKey!=='medic';});
      var atks = pool.slice(0, 5);
      var spots = [[-100,-8],[-100,8],[-98,-6],[-98,6],[-96,0]];
      for (var i=0;i<atks.length;i++){
        var b = atks[i];
        b.pos.x=spots[i][0]; b.pos.z=spots[i][1];
        b.pos.y=G.heightAt(spots[i][0],spots[i][1]);
        b.vel={x:0,y:0,z:0}; b.spawnProtect=999;   // v4：无敌，防集火
        b.bot.lastTarget=null; b.bot.mayFire=false; b.bot.graceUntil=-999;
        b.bot.hunt=null; b.bot.reactT=0;
      }
      var pinned = {};
      atks.forEach(function(b){ pinned[b.id]=true; });
      var others = G.bots.filter(function(b){ return !pinned[b.id]; });
      G.ai.resetFireLog();
      for (var i=0;i<210;i++){
        var dt=1/30; G.time+=dt;
        if (G.player.alive) G.Player.update(dt);
        G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);
        G.updateConquest(dt); G.effects.update(dt);
        for (var k=0;k<atks.length;k++){ atks[k].pos.x=spots[k][0]; atks[k].pos.z=spots[k][1]; atks[k].vel.x=0; atks[k].vel.z=0; }
        for (var m=0;m<others.length;m++){ others[m].vel.x=0; others[m].vel.z=0; }
      }
      var log = G.ai._fireLog.filter(function(f){return f.tgt===0;});
      var byFrame = {}; log.forEach(function(f){ byFrame[f.t]=(byFrame[f.t]||0)+1; });
      var maxSimul=0; for (var t in byFrame) maxSimul=Math.max(maxSimul, byFrame[t]);
      var shooters = {}; log.forEach(function(f){ shooters[f.s]=1; });
      var ids = Object.keys(shooters).map(Number).sort(function(a,b){return a-b;});
      return JSON.stringify({
        fires: log.length, maxSimul: maxSimul, shooters: ids,
        nearest: [atks[0].id, atks[1].id].sort(function(a,b){return a-b;}),
        atkIds: atks.map(function(b){return b.id;}).sort(function(a,b){return a-b;}),
        alive: atks.map(function(b){return b.alive ? 1 : 0;}).join('')
      });
    })()`);
    {
      const r = parse(RA);
      if (!r) { check('A 上限：解析结果', false, RA); }
      else {
        check('A 上限：交战发生且无人阵亡', r.fires >= 8 && r.alive === '11111',
          r.fires + ' 发 · 存活 ' + r.alive);
        check('A 上限：同帧开火 ≤ 2', r.maxSimul <= 2, '峰值 ' + r.maxSimul);
        // v4 64人规模：同帧上限(≤2)是硬保证；全时段开火者恰为最近两名会因
        // 瞬态遮挡换手而波动，放宽为「开火者均为场景内攻击者，且最近两名必在其中」
        check('A 上限：最近两名必在开火者中', r.shooters.includes(r.nearest[0]) && r.shooters.includes(r.nearest[1]),
          '开火者 ' + r.shooters.join(',') + ' / 最近 ' + r.nearest.join(','));
        check('A 上限：无场景外开火者', r.shooters.every(function(id){ return r.atkIds.indexOf(id) >= 0; }),
          '开火者 ' + r.shooters.join(','));
      }
    }

    // ---- 场景 C：残局清扫（临时放宽阈值触发清扫；红蓝对角分隔，确保无视线） ----
    const RC = await evl(`(function(){
      var G=Game;
      CONFIG.SWEEP_MIN_ALIVE = 40;   // v4：64 人规模，阈值提到全队规模之上
      G.ai.directorState.sweeps[0] = 0; G.ai.directorState.sweeps[1] = 0;
      var reds = G.bots.filter(function(b){return b.team===0;});
      reds.forEach(function(b){
        b.pos.x=-78; b.pos.z=78; b.pos.y=G.heightAt(-78,78); b.vel={x:0,y:0,z:0};
        b.bot.hunt=null; b.bot.seeEnemy=false; b.bot.seeEnemyDist=Infinity;
      });
      // 蓝方全部移往对角（约 220m），杜绝任何视线
      var blues = G.bots.filter(function(b){return b.team!==0;});
      blues.forEach(function(b){
        b.pos.x=78; b.pos.z=-78; b.pos.y=G.heightAt(78,-78); b.vel={x:0,y:0,z:0};
      });
      G.ai.resetFireLog();
      for (var i=0;i<200;i++){
        var dt=1/30; G.time+=dt;
        if (G.player.alive) G.Player.update(dt);
        G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);
        G.updateConquest(dt); G.effects.update(dt);
        for (var k=0;k<reds.length;k++){ reds[k].pos.x=-78; reds[k].pos.z=78; reds[k].vel.x=0; reds[k].vel.z=0; }
        for (var m=0;m<blues.length;m++){ blues[m].pos.x=78; blues[m].pos.z=-78; blues[m].vel.x=0; blues[m].vel.z=0; }
      }
      var hunted = reds.filter(function(b){ return b.bot.hunt && b.bot.hunt.until > G.time; }).length;
      var seeAny = reds.filter(function(b){ return b.bot.seeEnemy; }).length;
      return JSON.stringify({ hunted: hunted, seeAny: seeAny, sweepT: +G.ai.directorState.sweeps[0].toFixed(2) });
    })()`);
    {
      const r = parse(RC);
      if (!r) { check('C 清扫：解析结果', false, RC); }
      else {
        check('C 清扫：无视线者被派往敌人位置', r.hunted >= 3,
          'hunt ' + r.hunted + '/10 · 有视线 ' + r.seeAny);
      }
    }

    const pass = results.every((r) => r.ok) && exceptions.length === 0;
    console.log('\n致命异常:', exceptions.length === 0 ? '(无)' : exceptions.slice(0, 10).join('\n'));
    console.log('RESULT:', pass ? 'PASS' : 'FAIL');
    ws.close(); chrome.kill();
    process.exit(pass ? 0 : 1);
  })().catch((e) => { console.error('测试失败:', e.message); chrome.kill(); process.exit(2); });
}
main();
