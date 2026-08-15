// ============================================================
//  audio.js  ·  程序化音效（Web Audio，零音频文件）
// ============================================================
(function () {
  'use strict';

  const A = {
    ctx: null,
    master: null,
    verb: null,        // 程序化混响（ConvolverNode）
    verbInput: null,   // 混响发送母线
    noiseBuf: null,
    inited: false,
    engines: {},   // 载具循环音 { vehicleId: {gain, filter, osc} }
  };

  // 音效事件日志（测试/调试断言时序用；headless 无音频上下文也记录）
  const SOUND_LOG = [];

  // 用户手势后初始化/恢复（浏览器自动播放策略）
  function init() {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      A.ctx = new AC();
      A.master = A.ctx.createGain();
      A.master.gain.value = 0.5;
      // v5.42 主总线压限器：24v24 密集交火不削波、响度更稳
      A.comp = A.ctx.createDynamicsCompressor();
      A.comp.threshold.value = -14;
      A.comp.knee.value = 22;
      A.comp.ratio.value = 7;
      A.comp.attack.value = 0.003;
      A.comp.release.value = 0.22;
      A.master.connect(A.comp);
      A.comp.connect(A.ctx.destination);
      // 预生成 1 秒白噪声缓冲
      const len = A.ctx.sampleRate;
      A.noiseBuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
      const data = A.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // 程序化混响：生成 1.2s 指数衰减噪声脉冲响应（狙击/尾音用）
      try {
        const irLen = Math.floor(A.ctx.sampleRate * 1.2);
        const ir = A.ctx.createBuffer(2, irLen, A.ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.2);
        }
        A.verb = A.ctx.createConvolver();
        A.verb.buffer = ir;
        A.verb.connect(A.master);
        A.verbInput = A.ctx.createGain();
        A.verbInput.gain.value = 0.35;
        A.verbInput.connect(A.verb);
      } catch (e) { /* 无 Convolver 支持则无混响 */ }
      A.inited = true;
    } catch (e) { /* 无声环境不崩溃 */ }
  }
  A.init = init;

  const ready = () => A.inited && A.ctx && A.ctx.state === 'running';

  // 噪声爆发（枪声主体）
  function noiseBurst(freq, dur, vol, type) {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type || 'lowpass';
    filt.frequency.setValueAtTime(freq, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.08), t + dur);
    filt.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(A.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // 正弦"砰"（低频冲击）
  function thump(freq, dur, vol) {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.25), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(A.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // v5.42 冲击波瞬态：极低频正弦冲量（枪/爆的"物理冲击感"）
  function shockwave(freq, dur, vol) {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(A.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // 单音（可偏移起始时间，用于组成旋律）
  function tone(freq, dur, vol, offset) {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime + (offset || 0);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.6), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(A.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // ============================================================
  //  火药枪械分层合成（参考 ironhold/Claude-of-Duty 配方结构）
  //  层：①枪口爆响 crack（高频瞬态）→ ②火药主体 body（中频带通噪声）
  //      → ③低频砰 thump → ④亚低音 sub（后坐感）→ ⑤机匣机械层 mech（双咔哒）
  //      → ⑥尾音 tail 进混响
  //  每枪 6 槽 round-robin 音色表 + 逐发 jitter；距离混音：近处 crack 主导、远处低音主导
  // ============================================================
  const PROFILES = {
    rifle: {
      crackF: 4200, crackDur: 0.022, crackVol: 0.55,     // 枪口爆响
      bodyF: 2100, bodyDur: 0.14, bodyVol: 0.8,          // 火药主体
      thumpF: 150, thumpDur: 0.16, thumpVol: 0.5,        // 低频砰
      subF0: 82, subDur: 0.18, subVol: 0.45,             // 亚低音
      mech: 1, tailDur: 0.25, tailVol: 0.2, verb: 0.3,
    },
    lmg: {
      crackF: 3800, crackDur: 0.024, crackVol: 0.6,
      bodyF: 1900, bodyDur: 0.16, bodyVol: 0.85,
      thumpF: 130, thumpDur: 0.17, thumpVol: 0.55,
      subF0: 74, subDur: 0.2, subVol: 0.6,
      mech: 1, tailDur: 0.28, tailVol: 0.22, verb: 0.32,
    },
    smg: {
      crackF: 4600, crackDur: 0.018, crackVol: 0.5,
      bodyF: 2400, bodyDur: 0.1, bodyVol: 0.65,
      thumpF: 170, thumpDur: 0.12, thumpVol: 0.4,
      subF0: 90, subDur: 0.13, subVol: 0.4,
      mech: 1, tailDur: 0.16, tailVol: 0.14, verb: 0.22,
    },
    sniper: {
      crackF: 3200, crackDur: 0.035, crackVol: 0.75,     // 大威力：双发机械
      bodyF: 1600, bodyDur: 0.3, bodyVol: 0.95,
      thumpF: 90, thumpDur: 0.4, thumpVol: 0.85,
      subF0: 60, subDur: 0.4, subVol: 0.8,
      mech: 2, tailDur: 0.7, tailVol: 0.3, verb: 0.9,    // 长尾音 + 大混响
    },
    pistol: {
      crackF: 4400, crackDur: 0.015, crackVol: 0.45,
      bodyF: 2600, bodyDur: 0.09, bodyVol: 0.55,
      thumpF: 180, thumpDur: 0.1, thumpVol: 0.35,
      subF0: 95, subDur: 0.11, subVol: 0.32,
      mech: 1, tailDur: 0.12, tailVol: 0.1, verb: 0.18,
    },
    shotgun: {
      crackF: 3000, crackDur: 0.03, crackVol: 0.85,     // 霰弹：厚重轰鸣
      bodyF: 1400, bodyDur: 0.26, bodyVol: 1.0,
      thumpF: 80, thumpDur: 0.32, thumpVol: 0.95,
      subF0: 55, subDur: 0.34, subVol: 0.9,
      mech: 2, tailDur: 0.5, tailVol: 0.28, verb: 0.5,
    },
    dmr: {
      crackF: 3600, crackDur: 0.026, crackVol: 0.68,     // DMR：比步枪更尖的爆响
      bodyF: 1800, bodyDur: 0.18, bodyVol: 0.8,
      thumpF: 110, thumpDur: 0.2, thumpVol: 0.6,
      subF0: 66, subDur: 0.22, subVol: 0.55,
      mech: 1, tailDur: 0.32, tailVol: 0.24, verb: 0.4,
    },
  };
  const SLOT_N = 6;
  let slotIdx = 0;
  const jitter = (v, amt) => v * (1 + (Math.random() * 2 - 1) * amt);

  // 高频噪声瞬态（枪口爆响 crack）
  function crack(freq, dur, vol) {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = freq; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // 机匣机械层：方波咔哒 + 噪声瞬态（开火后延迟，模拟枪机往复）
  function mech(delay, vol, twice) {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime + delay;
    const n = twice ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.045;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(jitter(1150, 0.3), tt);
      osc.frequency.exponentialRampToValueAtTime(420, tt + 0.03);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * (i === 0 ? 1 : 0.6), tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04);
      osc.connect(g); g.connect(A.master);
      osc.start(tt); osc.stop(tt + 0.05);
    }
    const src = ctx.createBufferSource();
    src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2300; f.Q.value = 2;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.4, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f); f.connect(g2); g2.connect(A.master);
    src.start(t); src.stop(t + 0.06);
    // v5.42 金属共鸣环（高 Q 带通"叮"声，枪机金属感）
    const rsrc = ctx.createBufferSource(); rsrc.buffer = A.noiseBuf; rsrc.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = jitter(3900, 0.15); rf.Q.value = 16;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(vol * 0.1, t);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    rsrc.connect(rf); rf.connect(rg); rg.connect(A.master);
    rsrc.start(t); rsrc.stop(t + 0.05);
  }

  // 分层枪声主入口（vol = 距离衰减后音量；内部再做近/远混音）
  function shot(kind, vol) {
    const name = kind || 'rifle';
    SOUND_LOG.push({ n: 'shot:' + name, t: Game.time });
    if (SOUND_LOG.length > 200) SOUND_LOG.shift();
    vol = vol === undefined ? 1 : vol;
    if (!ready()) return;
    const p = PROFILES[name] || PROFILES.rifle;
    slotIdx = (slotIdx + 1) % SLOT_N;
    const slot = 1 + (slotIdx / SLOT_N) * 0.18;         // 轮转槽位 → 音色微差
    const far = 1 - Math.min(1, 1 - vol);               // 近似：vol 越低 = 越远
    // ①枪口爆响（近处主导）
    crack(jitter(p.crackF, 0.12) * slot, p.crackDur, p.crackVol * vol * (0.35 + 0.65 * (1 - far)));
    // ②火药主体（中频带通）
    noiseBurst(jitter(p.bodyF, 0.15) * slot, p.bodyDur, p.bodyVol * vol, 'bandpass');
    // ③低频砰 + ④亚低音（远处主导 → 滚雷感）
    thump(jitter(p.thumpF, 0.08), p.thumpDur, p.thumpVol * vol);
    thump(jitter(p.subF0, 0.08), p.subDur, p.subVol * vol * (0.3 + 0.7 * far));
    // ④b v5.42 冲击波瞬态（极低频冲量 → 后坐物理感）
    shockwave(p.subF0 * 0.5, p.subDur * 0.45, p.subVol * 0.5 * vol);
    // ⑤机匣机械层
    if (p.mech) mech(0.026, jitter(0.22, 0.2) * vol, p.mech === 2);
    // ⑥尾音噪声（进混响）
    noiseBurst(jitter(1500, 0.2), p.tailDur, p.tailVol * vol, 'bandpass');
  }

  // 干火（空仓咔哒）
  function dryFire() {
    SOUND_LOG.push({ n: 'dryFire', t: Game.time });
    if (SOUND_LOG.length > 200) SOUND_LOG.shift();
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square'; osc.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    osc.connect(g); g.connect(A.master);
    osc.start(t); osc.stop(t + 0.04);
  }

  // 命中确认音（爆头更高亢，ironhold hitBeep）
  function hitBeep(head) {
    SOUND_LOG.push({ n: head ? 'hitBeep:head' : 'hitBeep', t: Game.time });
    if (!ready()) return;
    tone(head ? 1900 : 1350, 0.05, 0.28, 0);
    if (head) tone(2550, 0.06, 0.2, 0.045);
  }

  // 击杀确认（900→1350 上行）
  function killChime() {
    SOUND_LOG.push({ n: 'killChime', t: Game.time });
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(1350, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g); g.connect(A.master);
    osc.start(t); osc.stop(t + 0.18);
  }

  // 近失弹呼啸（多普勒式下扫，AI 子弹擦身而过）
  function whizz() {
    SOUND_LOG.push({ n: 'whizz', t: Game.time });
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    // v5.42 立体声横扫：近失弹从一侧扫到另一侧（多普勒式下扫）
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.setValueAtTime(-0.7, t); pan.pan.linearRampToValueAtTime(0.7, t + 0.16); }
    const src = ctx.createBufferSource();
    src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    src.connect(f); f.connect(g);
    if (pan) { g.connect(pan); pan.connect(A.master); } else g.connect(A.master);
    src.start(t); src.stop(t + 0.18);
  }

  // 弹壳落地（金属小脆响）
  function shellDrop() {
    SOUND_LOG.push({ n: 'shellDrop', t: Game.time });
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    noiseBurst(jitter(2600, 0.4), 0.04, 0.1, 'highpass');
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(g); g.connect(A.master);
    osc.start(t); osc.stop(t + 0.07);
  }

  // ============================================================
  //  换弹三阶段（ironhold 相位时序：0% 退匣 → 38% 入匣 → 78% 拉机柄）
  // ============================================================
  function reloadStart() {
    SOUND_LOG.push({ n: 'reloadStart', t: Game.time });
    if (!ready()) return;
    noiseBurst(1800, 0.06, 0.35, 'bandpass');
    thump(220, 0.05, 0.2);
  }
  function reloadMagIn() {
    SOUND_LOG.push({ n: 'reloadMagIn', t: Game.time });
    if (!ready()) return;
    noiseBurst(1300, 0.09, 0.4, 'lowpass');
    thump(300, 0.07, 0.3);
  }
  function reloadBolt() {
    SOUND_LOG.push({ n: 'reloadBolt', t: Game.time });
    if (!ready()) return;
    noiseBurst(3200, 0.05, 0.32, 'highpass');
    thump(500, 0.04, 0.22);
  }

  function explosion(big, vol) {
    if (!ready()) return;
    vol = vol === undefined ? 1 : vol;
    const v = (big ? 1.0 : 0.6) * vol;
    const ctx = A.ctx, t = ctx.currentTime;
    // ①冲击波瞬态（极低频冲量）
    shockwave(big ? 34 : 44, big ? 0.5 : 0.35, v * 1.1);
    // ②主体轰鸣（低频噪声）
    noiseBurst(700, 0.6 * (big ? 1.4 : 1), v, 'lowpass');
    // ③低频砰 + 隆隆（锯齿下扫）
    thump(big ? 55 : 70, 0.7, v * 1.2);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(big ? 40 : 55, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(g); g.connect(A.master);
    osc.start(t); osc.stop(t + 0.6);
    // ④碎片飞溅（高频噪声 crackle，随机延迟）
    const debrisN = big ? 6 : 3;
    for (let i = 0; i < debrisN; i++) {
      const dt = 0.03 + Math.random() * 0.3;
      const dsrc = ctx.createBufferSource(); dsrc.buffer = A.noiseBuf; dsrc.loop = true;
      const df = ctx.createBiquadFilter(); df.type = 'highpass'; df.frequency.value = jitter(4500, 0.3);
      const dg = ctx.createGain();
      dg.gain.setValueAtTime(v * 0.12, t + dt);
      dg.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.035);
      dsrc.connect(df); df.connect(dg); dg.connect(A.master);
      dsrc.start(t + dt); dsrc.stop(t + dt + 0.05);
    }
    // ⑤尾音隆隆（低频噪声慢衰）
    const tail = ctx.createBufferSource(); tail.buffer = A.noiseBuf; tail.loop = true;
    const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 180;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(v * 0.28, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 1.6 : 1.0));
    tail.connect(tf); tf.connect(tg); tg.connect(A.master);
    tail.start(t); tail.stop(t + (big ? 1.7 : 1.1));
  }

  function hit() { noiseBurst(1500, 0.05, 0.4, 'highpass'); thump(400, 0.05, 0.25); }
  function kill() { killChime(); noiseBurst(1200, 0.12, 0.5); thump(600, 0.1, 0.35); }

  // ============================================================
  //  打击感音效分层：血肉命中 / 爆头 / 装甲 / 受击 / 护盾 / 耳鸣
  // ============================================================
  // 血肉命中（低频"噗"：沉闷 + 短噪声）
  function hitFlesh(vol) {
    SOUND_LOG.push({ n: 'hitFlesh', t: Game.time });
    if (!ready()) return;
    const v = vol === undefined ? 1 : vol;
    noiseBurst(900, 0.06, 0.42 * v, 'lowpass');
    thump(180, 0.07, 0.4 * v);
  }
  // 爆头命中（清脆"叮"：高频短促 + 金属共振）
  function hitHead() {
    SOUND_LOG.push({ n: 'hitHead', t: Game.time });
    if (!ready()) return;
    tone(2350, 0.05, 0.34, 0);
    tone(3200, 0.04, 0.22, 0.03);
    const ctx = A.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4200; f.Q.value = 20;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t); src.stop(t + 0.08);
  }
  // 装甲/载具命中（金属"当"：带通噪声 + 低砰 + 共振尾音）
  function hitArmor() {
    SOUND_LOG.push({ n: 'hitArmor', t: Game.time });
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.34, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t); src.stop(t + 0.06);
    thump(320, 0.06, 0.3);
    const rsrc = ctx.createBufferSource(); rsrc.buffer = A.noiseBuf; rsrc.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 5200; rf.Q.value = 14;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.1, t);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    rsrc.connect(rf); rf.connect(rg); rg.connect(A.master);
    rsrc.start(t); rsrc.stop(t + 0.09);
  }
  // 受击（闷响 + 低频"闷哼"，伤害越大越重）
  function hurt(dmg) {
    SOUND_LOG.push({ n: 'hurt', t: Game.time });
    if (!ready()) return;
    const v = Math.min(1, 0.4 + (dmg || 0) / 100);
    thump(120, 0.12, 0.5 * v);
    noiseBurst(500, 0.09, 0.32 * v, 'lowpass');
    const ctx = A.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g); g.connect(A.master);
    o.start(t); o.stop(t + 0.14);
  }
  // 护盾受击（电流"滋滋"）
  function shieldHit() {
    SOUND_LOG.push({ n: 'shieldHit', t: Game.time });
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.24, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t); src.stop(t + 0.09);
    tone(1200, 0.04, 0.1, 0);
  }
  // 耳鸣（重伤高频"嗡"，短暂）
  function tinnitus(dmg) {
    SOUND_LOG.push({ n: 'tinnitus', t: Game.time });
    if (!ready()) return;
    const v = Math.min(0.22, 0.08 + (dmg || 0) / 300);
    const ctx = A.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(5600, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(A.master);
    o.start(t); o.stop(t + 0.55);
  }
  // ============================================================
  //  v5.33 专用音效（由 tools/音效工坊_soundlab.html 设计）
  // ============================================================
  // 部署音效：呼啸下落（带通扫频 1400→350Hz）+ 落地闷响（160→55Hz）+ 到达清音（660→990Hz）
  function deploy() {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(350, t + 0.7);
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.78);
    src.connect(bp); bp.connect(g1); g1.connect(A.master);
    src.start(t); src.stop(t + 0.8);
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(160, t + 0.05);
    o2.frequency.exponentialRampToValueAtTime(55, t + 0.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.8, t + 0.07);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o2.connect(lp); lp.connect(g2); g2.connect(A.master);
    o2.start(t + 0.05); o2.stop(t + 0.6);
    const o3 = ctx.createOscillator(); o3.type = 'triangle';
    o3.frequency.setValueAtTime(660, t + 0.55);
    o3.frequency.linearRampToValueAtTime(990, t + 0.8);
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.0001, t + 0.55);
    g3.gain.exponentialRampToValueAtTime(0.14, t + 0.6);
    g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o3.connect(g3); g3.connect(A.master);
    o3.start(t + 0.55); o3.stop(t + 0.95);
  }
  // 死亡低鸣：正弦 110→55Hz 长衰 + 暗噪声垫（阵亡飘升时触发）
  function deathSting() {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g); g.connect(A.master);
    o.start(t); o.stop(t + 1.9);
    const n = ctx.createBufferSource(); n.buffer = A.noiseBuf; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.1, t + 0.2);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    n.connect(lp); lp.connect(gn); gn.connect(A.master);
    n.start(t); n.stop(t + 2);
  }
  // v5.38 濒死心跳（低血量反馈；urgency 0-1 控制响度）
  function heartbeat(urgency) {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const u = urgency === undefined ? 0.5 : urgency;
    const thump = (tt, vol) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(72, tt);
      o.frequency.exponentialRampToValueAtTime(46, tt + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.22 * vol, tt + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.12);
      o.connect(g); g.connect(A.master);
      o.start(tt); o.stop(tt + 0.14);
    };
    thump(t, 0.7 * u);
    thump(t + 0.22, u);   // 第二声更重（咚-咚）
  }
  // v5.38 维修点焊轻响（工程兵修复载具）
  function repairTick(vol) {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const v = vol === undefined ? 1 : vol;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(2500, t);
    o.frequency.exponentialRampToValueAtTime(1700, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(A.master);
    o.start(t); o.stop(t + 0.06);
    const n = ctx.createBufferSource(); n.buffer = A.noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.05 * v, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    n.connect(hp); hp.connect(gn); gn.connect(A.master);
    n.start(t); n.stop(t + 0.05);
  }
  // v5.28 功绩计分轻响（高级感：短促上滑音）
  function scoreTick() {
    if (!ready()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(A.master);
    o.start(t); o.stop(t + 0.1);
  }

  // 击杀播报音效（清脆"叮"，爆头更高亢）
  function killBanner(headshot) {
    if (headshot) { tone(1320, 0.1, 0.42, 0); tone(1760, 0.15, 0.36, 0.07); }
    else { tone(880, 0.1, 0.38, 0); tone(660, 0.13, 0.3, 0.06); }
  }
  // 多杀音效（上行三音 C5-E5-G5）
  function multi() {
    tone(523, 0.1, 0.4, 0); tone(659, 0.1, 0.42, 0.09); tone(784, 0.15, 0.44, 0.18);
  }
  // 玩家阵亡音效（低沉）
  function death() {
    tone(220, 0.25, 0.38, 0); tone(165, 0.32, 0.28, 0.1);
  }

  function footstep(run) {
    if (!ready()) return;
    // v5.42 双分层脚步：鞋跟低频闷响 + 鞋面中频摩擦 + 高频沙沙
    thump(run ? 180 : 140, 0.05, run ? 0.28 : 0.19);
    noiseBurst(run ? 700 : 520, 0.045, run ? 0.15 : 0.11, 'bandpass');
    noiseBurst(run ? 2800 : 2200, 0.03, run ? 0.07 : 0.05, 'highpass');
  }

  // --- 载具循环音（引擎/旋翼/喷气） ---
  function engineStart(id, kind) {
    if (!ready() || A.engines[id]) return;
    const ctx = A.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    gain.gain.value = 0;
    if (kind === 'heli') {
      osc.type = 'sawtooth'; osc.frequency.value = 90; filt.type = 'lowpass'; filt.frequency.value = 500;
      // 旋翼"突突"用 LFO 调制
      const lfo = ctx.createOscillator(); lfo.frequency.value = 11;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
      lfo.connect(lfoG); lfoG.connect(gain.gain);
      lfo.start();
      A.engines[id] = { osc, gain, filt, lfo };
    } else {
      osc.type = 'sawtooth'; osc.frequency.value = 60; filt.type = 'lowpass'; filt.frequency.value = 400;
      A.engines[id] = { osc, gain, filt };
    }
    osc.connect(filt); filt.connect(gain); gain.connect(A.master);
    osc.start();
  }
  function engineUpdate(id, throttle) {
    const e = A.engines[id]; if (!e || !ready()) return;
    const t = A.ctx.currentTime;
    e.gain.gain.cancelScheduledValues(t);
    e.gain.gain.linearRampToValueAtTime(0.06 + throttle * 0.1, t + 0.15);
    if (e.jet) {
      e.osc.frequency.linearRampToValueAtTime(110 + throttle * 90, t + 0.2);
      e.filt.frequency.linearRampToValueAtTime(700 + throttle * 1200, t + 0.2);
    } else if (e.filt) {
      e.filt.frequency.linearRampToValueAtTime(200 + throttle * 300, t + 0.2);
    }
  }
  // 医疗箱治疗音（v5.6）
  function heal() {
    SOUND_LOG.push({ n: 'heal', t: Game.time });
    if (!ready()) return;
    tone(520, 0.12, 0.3, 0); tone(660, 0.14, 0.24, 0.09);
  }

  // ============================================================
  //  v5.8 迫击炮音效 + 战场氛围系统
  // ============================================================
  // 迫击炮出膛：管口低沉轰鸣（低频砰 + 噪声爆发）
  function mortarLaunch(vol) {
    SOUND_LOG.push({ n: 'mortarLaunch', t: Game.time });
    if (!ready()) return;
    vol = vol === undefined ? 1 : vol;
    thump(75, 0.35, 0.9 * vol);
    thump(50, 0.5, 0.7 * vol);
    noiseBurst(300, 0.25, 0.5 * vol, 'lowpass');
  }
  // 炮弹下落呼啸：高频下扫 1400→380Hz（1 秒）
  function mortarWhistle(vol) {
    SOUND_LOG.push({ n: 'mortarWhistle', t: Game.time });
    if (!ready()) return;
    vol = vol === undefined ? 1 : vol;
    const ctx = A.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 1.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    osc.connect(g); g.connect(A.master);
    osc.start(t); osc.stop(t + 1.1);
  }

  // ---- 环境氛围：循环风声（按地图强度）+ 远处随机战场音 ----
  const AMBIENT = { started: false, nodes: [], battleTimer: 0 };
  function windLevel() {
    const m = Game.mapId;
    return m === 'snow' ? 0.16 : m === 'desert' ? 0.10 : 0.05;
  }
  function ambientStart() {
    SOUND_LOG.push({ n: 'ambientStart', t: Game.time });
    if (AMBIENT.started || !ready()) return;
    AMBIENT.started = true;
    const ctx = A.ctx;
    // 风声：白噪声 → 带通 320Hz → 慢速 LFO 起伏
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 0.5;
    const wind = ctx.createGain(); wind.gain.value = windLevel();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.25 * windLevel();
    lfo.connect(lfoG); lfoG.connect(wind.gain);
    src.connect(f); f.connect(wind); wind.connect(A.master);
    src.start(); lfo.start();
    AMBIENT.nodes = [src, f, wind, lfo, lfoG];
    AMBIENT.battleTimer = 2 + Math.random() * 4;
  }
  function ambientUpdate(dt) {
    if (!AMBIENT.started || !ready()) return;
    AMBIENT.battleTimer -= dt;
    if (AMBIENT.battleTimer > 0) return;
    AMBIENT.battleTimer = 3 + Math.random() * 6;
    const ctx = A.ctx, t = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 2 - 1;   // 随机声道方向
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (Math.random() < 0.5) {
      // 远处闷响爆炸
      f.type = 'lowpass'; f.frequency.value = 220;
      const vol = 0.08 + Math.random() * 0.10;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      src.connect(f); f.connect(g);
      if (pan) { g.connect(pan); pan.connect(A.master); } else g.connect(A.master);
      src.start(t); src.stop(t + 1.3);
    } else {
      // 远处零星枪声（两声短促）
      f.type = 'highpass'; f.frequency.value = 1200;
      for (let i = 0; i < 2; i++) {
        const tt = t + i * 0.16;
        const gg = ctx.createGain();
        gg.gain.setValueAtTime(0.04 + Math.random() * 0.05, tt);
        gg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1);
        const ss = ctx.createBufferSource(); ss.buffer = A.noiseBuf; ss.loop = true;
        const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 900; ff.Q.value = 1;
        ss.connect(ff); ff.connect(gg);
        if (pan) { gg.connect(pan); pan.connect(A.master); } else gg.connect(A.master);
        ss.start(tt); ss.stop(tt + 0.12);
      }
      // 外层节点仅用于路由（源节点即时结束）
      try { src.stop(0); } catch (e) {}
    }
  }
  function ambientStop() {
    if (!AMBIENT.started) return;
    for (const n of AMBIENT.nodes) {
      try { if (n.stop) n.stop(); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
    }
    AMBIENT.nodes = [];
    AMBIENT.started = false;
    AMBIENT.battleTimer = 0;
  }

  function engineStop(id) {
    const e = A.engines[id]; if (!e) return;
    try { e.osc.stop(); if (e.lfo) e.lfo.stop(); if (e.noise) e.noise.stop(); } catch (err) {}
    e.gain.disconnect();
    delete A.engines[id];
  }

  // 距离衰减（0~1）
  function distanceVol(pos) {
    if (!Game.player || !pos) return 1;
    const d = Game.math.dist3(pos, Game.player.pos);
    return Game.math.clamp(1 - d / CONFIG.AUDIO_RANGE, 0, 1);
  }
  A.distanceVol = distanceVol;

  Game.audio = A;
  Game.sound = {
    shot, reloadStart, reloadMagIn, reloadBolt, reload: reloadStart,
    dryFire, hitBeep, killChime, whizz, shellDrop,
    explosion, hit, kill, hitFlesh, hitHead, hitArmor, hurt, shieldHit, tinnitus, killBanner, multi, death, footstep, scoreTick, deploy, deathSting, repairTick, heartbeat,
    engineStart, engineUpdate, engineStop,
    heal,
    mortarLaunch, mortarWhistle,
    ambientStart, ambientUpdate, ambientStop,
  };
  // 事件日志（测试用）
  Game.sound._log = SOUND_LOG;
  Game.sound.resetLog = () => { SOUND_LOG.length = 0; };
})();
