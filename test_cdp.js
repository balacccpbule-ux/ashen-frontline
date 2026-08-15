/* 灰烬战线 · headless Chrome CDP 验证
 * 用法：node test_cdp.js
 * 通过 file:// 加载 index.html?autotest=1，收集异常 + 读状态 + 截屏 + 非纯色校验
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
// GAME_FILE 环境变量可指定被测文件（默认 index.html；打包产物验证用）
const FILE = path.resolve(__dirname, process.env.GAME_FILE || 'index.html').replace(/\\/g, '/');
const URL = 'file:///' + FILE + '?autotest=1';
const PORT = Number(process.env.TEST_PORT) || 9224;
const WAIT_RUN = Number(process.env.WAIT || 7000);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-test-'));
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
  throw new Error('CDP 连接超时');
}

function pngHasContent(buf) {
  try {
    if (buf.slice(1, 4).toString() !== 'PNG') return false;
    let off = 8, idat = [];
    while (off < buf.length) {
      const len = buf.readUInt32BE(off), type = buf.slice(off + 4, off + 8).toString();
      if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const seen = new Set();
    for (let i = 0; i < raw.length; i += 97) seen.add(raw[i]);
    return seen.size > 8;
  } catch (e) { return false; }
}

function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--enable-unsafe-swiftshader', '--disable-gpu',
    '--use-angle=swiftshader', '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
    `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,720', `--user-data-dir=${profile}`, URL,
  ], { stdio: 'ignore' });

  (async () => {
    const ws = new WebSocket(await getPageWs());
    let id = 0; const pending = new Map();
    const exceptions = [], errlogs = [], consoleErrs = [], consoleLogs = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data.toString());
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown')
        exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Log.entryAdded') {
        const e = m.params.entry;
        if (e.level === 'error' && !/favicon|data:,/i.test(e.text)) errlogs.push(e.text);
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        const txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (m.params.type === 'error') consoleErrs.push(txt);
        else consoleLogs.push(txt);
      }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const send = (method, params = {}) => new Promise((res) => {
      const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evl = async (expr) =>
      (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await sleep(WAIT_RUN);

    const STATE = `(function(){try{var G=Game;var meshCount=0;G.scene.traverse(function(o){if(o.isMesh)meshCount++;});return JSON.stringify({running:G.running,over:G.over,phase:G.phase,time:+G.time.toFixed(1),tickets:[Math.ceil(G.ticketsRed),Math.ceil(G.ticketsBlue)],flags:G.flags.map(function(f){return f.id+':'+Math.round(f.control)+'('+f.owner+')';}),soldiers:G.soldiers.length,alive:G.soldiers.filter(function(s){return s.alive;}).length,vehicles:G.vehicles.length,vehOccupied:G.vehicles.filter(function(v){return v.occupant!==null;}).length,playerAlive:G.player.alive,kills:G.stats.kills,deaths:G.stats.deaths,botsAlive:G.bots.filter(function(b){return b.alive;}).length,sceneMeshes:meshCount,sceneChildren:G.scene.children.length,hasGround:!!G.terrain.ground,projectiles:G.projectiles.length});}catch(e){return JSON.stringify({readError:String(e)});}})()`;
    const state = await evl(STATE);
    // 确定性步进 240 帧（≈8 秒），验证战斗/载具逻辑，不受 headless rAF 节流影响
    const combat = await evl(`(function(){var G=Game;for(var i=0;i<240;i++){var dt=1/30;G.time+=dt;if(G.player.alive)G.Player.update(dt);G.ai.update(dt);G.Vehicles.update(dt);G.weapons.update(dt);G.updateConquest(dt);G.effects.update(dt);}var tk=G.soldiers.reduce(function(a,s){return a+s.kills;},0);var td=G.soldiers.reduce(function(a,s){return a+s.deaths;},0);return JSON.stringify({kills:tk,deaths:td,ticks:[Math.ceil(G.ticketsRed),Math.ceil(G.ticketsBlue)],flags:G.flags.map(function(f){return f.id+':'+Math.round(f.control)+'('+f.owner+')';}),vehOcc:G.vehicles.filter(function(v){return v.occupant!==null;}).length});})()`);
    // v4：autotest 不再跑 rAF 主循环，截图前手动渲染一帧
    await evl(`(function(){ G.renderer.render(G.scene, G.camera); })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(shot.result.data, 'base64');
    const out = path.join(__dirname, 'headless_shot.png');
    fs.writeFileSync(out, png);

    console.log('URL:  ', URL);
    console.log('状态: ', state);
    console.log('步进8秒后: ', combat);
    console.log('致命异常: ', exceptions.length === 0 ? '(无)' : exceptions.slice(0, 12).join('\n---\n'));
    console.log('Log错误:  ', errlogs.length === 0 ? '(无)' : errlogs.slice(0, 8).join('\n'));
    console.log('Console错误:', consoleErrs.length === 0 ? '(无)' : consoleErrs.slice(0, 8).join('\n'));
    console.log('页面日志: ', consoleLogs.length === 0 ? '(无)' : consoleLogs.slice(-15).join(' | '));
    console.log('截屏: ', out, png.length, 'bytes, 非纯色:', pngHasContent(png));

    let stateObj = null, combatObj = null;
    try { stateObj = JSON.parse(state); combatObj = JSON.parse(combat); } catch (e) {}
    const combatHappened = combatObj && (
      (combatObj.kills + combatObj.deaths) > 0 ||
      combatObj.vehOcc > 0 ||
      combatObj.ticks[0] < 500 || combatObj.ticks[1] < 500
    );
    const ok = !!stateObj && !stateObj.readError && stateObj.running === true &&
      exceptions.length === 0 && pngHasContent(png) && combatHappened;
    console.log('RESULT: ', ok ? 'PASS' : 'FAIL');
    ws.close(); chrome.kill();
    process.exit(ok ? 0 : 1);
  })().catch((e) => { console.error('测试失败:', e.message); chrome.kill(); process.exit(2); });
}
main();
