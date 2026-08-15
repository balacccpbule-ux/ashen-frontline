/* ============================================================
 * tests/lib/cdp.js — 无头 Chrome CDP 测试驱动（共享）
 * ============================================================ */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor() { this.id = 0; this.pending = new Map(); this.events = []; this.ws = null; }
  async connect(port) {
    const targets = await getJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find(t => t.type === 'page');
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      } else if (m.method === 'Runtime.exceptionThrown' || m.method === 'Runtime.consoleAPICalled') {
        this.events.push(m);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : JSON.stringify(r.exceptionDetails)));
    return r.result.value;
  }
  errors() {
    return this.events
      .filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
      .map(e => e.method === 'Runtime.exceptionThrown'
        ? 'EXCEPTION: ' + (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '')
        : 'CONSOLE.ERROR: ' + e.params.args.map(a => a.value || a.description || '').join(' '));
  }
}

function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

async function launchChrome(url, port) {
  const args = [
    '--headless=new', '--enable-unsafe-swiftshader', '--disable-gpu', '--use-angle=swiftshader',
    '--remote-debugging-port=' + port, '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1280,720', '--mute-audio',
    '--user-data-dir=' + require('os').tmpdir() + '\\ashen-test-' + port,
    url,
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const cdp = new CDP();
      await cdp.connect(port);
      return { proc, cdp };
    } catch (e) { /* retry */ }
  }
  proc.kill();
  throw new Error('chrome 启动失败');
}

const gameUrl = (params = 'autotest=1') =>
  'file:///' + path.resolve(__dirname, '..', '..', 'index.html').replace(/\\/g, '/') + '?' + params;

function assert(cond, msg) {
  if (!cond) { console.error('ASSERT FAIL: ' + msg); process.exit(1); }
  console.log('  ✓ ' + msg);
}

module.exports = { launchChrome, sleep, assert, gameUrl };
