/* 灰烬战线 · 完整流程验证（菜单/部署/阵亡/重生/结束） */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FILE = path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const URL = 'file:///' + FILE;   // 无 autotest，从菜单开始
const PORT = Number(process.env.TEST_PORT) || 9225;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-flow-'));
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

function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--enable-unsafe-swiftshader', '--disable-gpu', '--use-angle=swiftshader',
    '--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
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
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await sleep(3000);

    const results = [];
    const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '✓' : '✗') + ' ' + name + (detail ? ' · ' + detail : '')); };
    const visible = async (sel) => await evl(`(function(){var e=document.querySelector('${sel}');return e && !e.classList.contains('hidden') && e.offsetParent!==null;})()`);
    const phase = () => evl('Game.phase');

    // 1. 初始菜单
    check('初始为菜单', (await phase()) === 'menu' && (await visible('#menu')), 'phase=' + (await phase()));

    // 2. 点开始 → 选兵种
    await evl(`document.getElementById('btn-start').click()`);
    await sleep(300);
    check('开始 → 兵种选择', (await phase()) === 'class-select' && (await visible('#class-select')), 'phase=' + (await phase()));

    // 3. 选侦察兵 + 部署
    await evl(`Game.hud.selectClass('recon')`);
    await evl(`document.getElementById('btn-deploy').click()`);
    await sleep(3000);   // v5.42 开局也走俯瞰俯冲飞行视角，需更久真实时间落地
    check('部署 → 战斗', (await phase()) === 'playing' && (await evl('Game.player.clsKey')) === 'recon',
      'phase=' + (await phase()) + ' class=' + (await evl('Game.player.clsKey')));

    // 4. 强制玩家阵亡 → 视角飘向战场正上方（渐慢）→ 阵亡界面
    await evl(`(function(){var p=Game.player;p.spawnProtect=0;Game.weapons.applyDamage(p,9999,null,p.pos);})()`);
    await sleep(5500);   // v5.42 非网格城市更重、rAF 更慢，倒地+飘升需更长真实时间
    check('阵亡 → 阵亡界面', (await phase()) === 'dead' && (await visible('#death-screen')), 'phase=' + (await phase()) + ' alive=' + (await evl('Game.player.alive')));
    check('阵亡视角飘向战场正上方', (await evl('Game.camera.position.y')) > 50, 'camY=' + (await evl('+Game.camera.position.y.toFixed(1)')));

    // 5. v5.39 俯视选点复活：点复活点直接部署（无「重新部署」按钮）
    const spawnCount = await evl('document.querySelectorAll("#death-spawns .spawn-btn").length');
    check('阵亡界面含复活点按钮', spawnCount >= 1, 'spawns=' + spawnCount);
    await evl(`document.querySelector('#death-spawns .spawn-btn').click()`);
    await sleep(4000);   // v5.40 灵魂归位飞行 + 落地生成（到位后再生成人物）
    check('选点部署 → 战斗', (await phase()) === 'playing' && (await evl('Game.player.alive')) === true, 'phase=' + (await phase()));
    check('部署视角飞回所选点位（渐快渐慢）', (await evl('Game.camera.position.y')) < 15, 'camY=' + (await evl('+Game.camera.position.y.toFixed(1)')));
    check('v5.33 专用音效已接入', (await evl('typeof Game.sound.deploy === "function" && typeof Game.sound.deathSting === "function"')), '');

    // 6. 强制结束（时间到）→ 结束界面
    await evl(`(function(){Game.time = ${CONFIG_MATCH_TIME};})()`);
    await sleep(400);
    check('时间到 → 结束界面', (await phase()) === 'over' || (await visible('#end-screen')), 'phase=' + (await phase()) + ' over=' + (await evl('Game.over')));

    // 7. 再来一局 → 兵种选择
    await evl(`document.getElementById('btn-restart').click()`);
    await sleep(300);
    check('再来一局 → 兵种选择', (await phase()) === 'class-select', 'phase=' + (await phase()));

    const pass = results.every((r) => r.ok) && exceptions.length === 0;
    console.log('\n致命异常:', exceptions.length === 0 ? '(无)' : exceptions.slice(0, 10).join('\n'));
    console.log('RESULT:', pass ? 'PASS' : 'FAIL');
    ws.close(); chrome.kill();
    process.exit(pass ? 0 : 1);
  })().catch((e) => { console.error('流程测试失败:', e.message); chrome.kill(); process.exit(2); });
}
const CONFIG_MATCH_TIME = 900;
main();
