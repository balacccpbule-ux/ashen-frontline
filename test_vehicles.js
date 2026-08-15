/* 灰烬战线 · 机器人载具逻辑验证（手动步进模拟，绕开 headless rAF 节流） */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FILE = path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const URL = 'file:///' + FILE + '?autotest=1';
const PORT = Number(process.env.TEST_PORT) || 9230;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-veh-'));
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

    // 等游戏 boot
    for (let i = 0; i < 40; i++) {
      const r = await evl('typeof Game !== "undefined" && Game.player ? "ok" : "waiting"');
      if (r === 'ok') break;
      await sleep(300);
    }

    // 手动步进 300 帧（30ms 一帧 ≈ 10 秒），期间 AI 会登车 + 驾驶
    const STEP = `(function(){
      var G = Game;
      var crewBefore = G.bots.filter(function(b){return b.bot.crew && b.team===0;}).map(function(b){return b.bot.crew + (b.ridingVehicle ? '(车内)' : '(步行)');});
      for (var i = 0; i < 300; i++) {
        var dt = 1/30;
        G.time += dt;
        if (G.player.alive) G.Player.update(dt);
        G.ai.update(dt);
        G.Vehicles.update(dt);
        G.weapons.update(dt);
        G.effects.update(dt);
      }
      var occ = G.vehicles.filter(function(v){return v.occupant !== null;});
      var moved = G.vehicles.filter(function(v){return v.kind !== 'heli';}).map(function(v){
        return v.kind + ':' + (v.occupant ? '有驾驶员' : '空') + '@' + Math.round(v.pos.x) + ',' + Math.round(v.pos.z);
      });
      return JSON.stringify({ crewBefore: crewBefore, occupiedCount: occ.length, vehicles: moved, exceptions: 0 });
    })()`;
    const result = await evl(STEP);
    console.log('机器人载具验证:', result);
    console.log('致命异常:', exceptions.length === 0 ? '(无)' : exceptions.slice(0, 10).join('\n'));

    const ok = exceptions.length === 0 && /有驾驶员/.test(result);
    console.log('RESULT:', ok ? 'PASS' : 'FAIL');
    ws.close(); chrome.kill();
    process.exit(ok ? 0 : 1);
  })().catch((e) => { console.error('验证失败:', e.message); chrome.kill(); process.exit(2); });
}
main();
