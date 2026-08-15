// ============================================================
//  hud.js  ·  战斗 HUD + 小地图 + 界面管理
// ============================================================
(function () {
  'use strict';
  const M = Game.math;
  const H = {
    minimapBg: null,
    selectedClass: 'assault',
    selectedMode: Game.mode || 'conquest',
    selectedMap: Game.mapId || 'desert',
    selectedDiff: 'normal',
    msgTimer: null,
    save: { totalScore: 0, kills: 0, deaths: 0, wins: 0, losses: 0, bestStreak: 0 },
    visIdx: 0,                 // v5.16 敌方载具视野轮询游标
    mortarReveals: [],         // v5.16 反炮击预警：被敌方迫击炮命中后高亮的敌方迫击炮手 [{ s, until }]
    minimapRange: 100,         // v5.48 小地图缩放挡位（25/50/100/200m，N 键循环）
    minimapSize: 190,          // v5.48 小地图显示尺寸（px，K 键/调参面板调整）
    bigMapOpen: false,         // v5.48 M 键俯瞰大地图开关
  };
  const MINIMAP_RANGES = [25, 50, 100, 200];
  const MINIMAP_SIZES = [140, 190, 240];

  const $ = (id) => document.getElementById(id);
  const normAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  function init() {
    // 缓存常用元素
    H.el = {
      hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      damageFlash: $('damage-flash'), scope: $('scope-overlay'),
      healthFill: $('health-fill'), healthNum: $('health-num'),
      ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
      gadgetInfo: $('gadget-info'), reloadHint: $('reload-hint'),
      ticketRed: $('ticket-red'), ticketBlue: $('ticket-blue'),
      modeTag: $('mode-tag'), sectorBar: $('sector-bar'),
      flags: $('flags'), score: $('score'), rankMini: $('rank-mini'),
      minimap: $('minimap'), bigmap: $('bigmap'), bigmapOverlay: $('bigmap-overlay'),
      captureStatus: $('capture-status'), message: $('message'),
      spawnHint: $('spawn-hint'), vehicleHud: $('vehicle-hud'),
      vehicleName: $('vehicle-name'), vehicleHealthFill: $('vehicle-health-fill'), vehicleHint: $('vehicle-hint'),
      vehicleHeat: $('vehicle-heat'), vehicleHeatFill: $('vehicle-heat-fill'), vehicleHeatLabel: $('vehicle-heat-label'),
      vehicleReload: $('vehicle-reload'), vehicleReloadFill: $('vehicle-reload-fill'),
      pauseHint: $('pause-hint'),
      meritScore: $('merit-score'),   // v5.18 功绩分数缓动
      flash: $('flash'),               // v5.28 爆炸闪光
      menu: $('menu'), classSelect: $('class-select'), deathScreen: $('death-screen'),
      endScreen: $('end-screen'), scoreboard: $('scoreboard'),
      scoreboardBody: $('scoreboard-body'), rankDisplay: $('rank-display'),
      deathInfo: $('death-info'), endTitle: $('end-title'), endInfo: $('end-info'),
      classOptions: $('class-options'),
      hitIndicator: $('hit-indicator'), lowhp: $('lowhp'), smokeOverlay: $('smoke-overlay'), announce: $('announce'),
      objective: $('objective'), objArrow: $('obj-arrow'), objText: $('obj-text'),
      popups: $('popups'),
      mortarPanel: $('mortar-map-panel'), mortarMap: $('mortar-map'),
      shieldBar: $('shield-bar'), shieldFill: $('shield-fill'),
      reloadBar: $('reload-bar'), reloadFill: $('reload-fill'),
      scorefeed: $('scorefeed'),
    };
    initMortarMapHandlers();
    buildClassOptions();
    buildFlags();
    loadSave();
    bindMenuSelect();
    // v5.48 小地图：读取保存尺寸 + 绑定 N/M/K
    let savedSize = 190;
    try { savedSize = parseInt(localStorage.getItem('ashen_minimap_size') || '190') || 190; } catch (e) {}
    setMinimapSize(savedSize, true);
    bindMapKeys();
  }

  // ---- 菜单模式/地图选择 ----
  // 由 main.js boot() 调用：把 URL 参数/当前局模式同步到菜单选择高亮
  function syncMenuSelection(mode, mapId) {
    H.selectedMode = mode || 'conquest';
    H.selectedMap = mapId || 'desert';
    document.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('selected', x.dataset.mode === H.selectedMode));
    document.querySelectorAll('.map-btn').forEach((x) => x.classList.toggle('selected', x.dataset.map === H.selectedMap));
  }
  H.syncMenuSelection = syncMenuSelection;

  function bindMenuSelect() {
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.mode-btn').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        H.selectedMode = b.dataset.mode;
      };
    });
    document.querySelectorAll('.map-btn').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.map-btn').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        H.selectedMap = b.dataset.map;
      };
    });
    document.querySelectorAll('.diff-btn').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.diff-btn').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        H.selectedDiff = b.dataset.diff;
      };
    });
  }

  // ---- 突破模式扇区进度条 ----
  function buildSectorBar() {
    const el = H.el.sectorBar;
    if (!el) return;
    if (Game.mode !== 'breakthrough' || !Game.sectors.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '';
    Game.sectors.forEach((sec, i) => {
      const d = document.createElement('div');
      d.className = 'sector-dot';
      d.title = Game.L(sec);
      el.appendChild(d);
    });
    updateSectorBar();
  }
  function updateSectorBar() {
    if (Game.mode !== 'breakthrough' || !H.el.sectorBar) return;
    const dots = H.el.sectorBar.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].className = 'sector-dot' + (i + 1 === Game.activeSector ? ' active' : (i + 1 < Game.activeSector ? ' done' : ''));
    }
  }

  function buildClassOptions() {
    const c = H.el.classOptions;
    c.innerHTML = '';
    CLASS_ORDER.forEach((key) => {
      c.appendChild(makeClassCard(key, CLASSES[key]));
    });
  }
  function makeClassCard(key, cls) {
    const card = document.createElement('div');
    card.className = 'cls-card' + (key === H.selectedClass ? ' selected' : '');
    card.dataset.key = key;
    card.innerHTML = '<div class="cc-name">' + Game.L(cls) + '</div>' +
      '<div class="cc-weapon">' + Game.L(WEAPONS[cls.weapon]) + '</div>' +
      '<div class="cc-desc">' + Game.L(cls, 'desc') + '</div>';
    card.onclick = () => selectClass(key);
    return card;
  }
  // v5.39 阵亡界面底部职业条
  function buildDeathClasses() {
    const c = document.getElementById('death-classes');
    if (!c) return;
    c.innerHTML = '';
    CLASS_ORDER.forEach((key) => c.appendChild(makeClassCard(key, CLASSES[key])));
  }

  function buildFlags() {
    const c = H.el.flags;
    c.innerHTML = '';
    Game.flags.forEach((f) => {
      const bar = document.createElement('div');
      bar.className = 'flag-bar';
      bar.innerHTML = '<div class="flag-fill"></div><div class="flag-label">' + f.id + '</div>';
      bar.title = Game.L(f) || f.id;
      c.appendChild(bar);
      f.ui = { bar, fill: bar.querySelector('.flag-fill'), label: bar.querySelector('.flag-label') };
    });
  }

  function selectClass(key) {
    H.selectedClass = key;
    document.querySelectorAll('.cls-card').forEach((cd) => cd.classList.toggle('selected', cd.dataset.key === key));
  }

  // ============================================================
  //  v5.39 阵亡俯视选点复活：把可复活点位（已占领旗 + 基地）投影到屏幕
  // ============================================================
  const _projV = new THREE.Vector3();
  function worldToScreen(wx, wy, wz) {
    _projV.set(wx, wy, wz).project(Game.camera);
    return { x: (_projV.x + 1) / 2 * window.innerWidth, y: (1 - _projV.y) / 2 * window.innerHeight, behind: _projV.z > 1 };
  }
  function buildDeathSpawns() {
    const box = document.getElementById('death-spawns');
    if (!box) return;
    box.innerHTML = '';
    const p = Game.player, pt = p.team;
    const pts = [];
    const base = BASE_DEFS.find((b) => b.team === pt);
    if (base) pts.push({ x: base.x, z: base.z, name: Game.t('spawn.base'), home: true });
    for (const f of Game.flags) {
      // v5.40 只能复活在自己方占领点（征服/突破统一：只列己方旗帜，不再列敌方/当前扇区）
      if (f.owner === pt) pts.push({ x: f.x, z: f.z, name: Game.L(f) || f.id, home: false });
    }
    H.deathSpawnPts = pts;
    pts.forEach((sp, i) => {
      const b = document.createElement('button');
      b.className = 'spawn-btn' + (sp.home ? ' home' : '');
      b.textContent = sp.name;
      b.onclick = () => { H.deployAt(sp); };
      box.appendChild(b);
      b.dataset.idx = i;
    });
  }
  function updateDeathSpawns() {
    const box = document.getElementById('death-spawns');
    if (!box || !H.deathSpawnPts) return;
    const btns = box.children;
    H.deathSpawnPts.forEach((sp, i) => {
      const b = btns[i];
      if (!b) return;
      const s = worldToScreen(sp.x, Game.heightAt(sp.x, sp.z) + 4, sp.z);
      b.style.left = s.x.toFixed(0) + 'px';
      b.style.top = s.y.toFixed(0) + 'px';
      b.style.display = s.behind ? 'none' : '';
    });
  }
  // 点击复活点 → 部署到该点附近的安全位置
  function deployAt(sp) {
    if (!sp) return;
    if (Game.audio) Game.audio.init();
    if (Game.deployPlayer) Game.deployPlayer(sp);
  }
  H.deployAt = deployAt;

  // ---- 持久化军衔 ----
  function loadSave() {
    try {
      const raw = localStorage.getItem('ashen_save');
      if (raw) Object.assign(H.save, JSON.parse(raw));
    } catch (e) {}
    updateRankDisplay();
  }
  function saveGame() {
    try { localStorage.setItem('ashen_save', JSON.stringify(H.save)); } catch (e) {}
  }
  function rankName(total) {
    let r = RANKS[0];
    for (const x of RANKS) if (total >= x.score) r = x;
    return r;
  }
  function updateRankDisplay() {
    const total = H.save.totalScore + (Game.player ? Game.player.score : 0);
    H.el.rankDisplay.textContent = Game.t('menu.rank.line', Game.L(rankName(total)), total);
    H.el.rankMini.textContent = Game.L(rankName(total));
  }

  // ---- 预渲染地形画布（小地图 / 迫击炮地图共用） ----
  function renderTerrainCanvas(size) {
    const off = document.createElement('canvas');
    off.width = off.height = size;
    const ctx = off.getContext('2d');
    const scale = size / (CONFIG.WORLD * 2);
    const img = ctx.createImageData(size, size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const wx = px / scale - CONFIG.WORLD;
        const wz = py / scale - CONFIG.WORLD;
        const c = Game.terrain.bandColor(Game.heightAt(wx, wz));
        const i = (py * size + px) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(24,20,17,0.92)';
    for (const s of Game.terrain.solids) {
      if (s.kind === 'building' || s.kind === 'shack' || s.kind === 'rock' || s.kind === 'fortwall') {
        const x = (s.cx + CONFIG.WORLD) * scale, y = (s.cz + CONFIG.WORLD) * scale;
        ctx.fillRect(x - (s.w / 2) * scale, y - (s.d / 2) * scale, s.w * scale, s.d * scale);
      }
    }
    return off;
  }
  function initMinimap() {
    H.minimapBg = renderTerrainCanvas(256);   // v5.48 小地图地形底图（更高分辨率，放大不糊）
    H.bigMapBg = renderTerrainCanvas(640);    // v5.48 大地图地形底图
    H.mortarBg = renderTerrainCanvas(380);    // v5.7 迫击炮地图（高分辨率）
  }

  // v5.16 敌方载具视野：玩家本人或任意轮询到的队友对载具有 LOS 即视为可见
  function vehicleSeenByTeam(v) {
    const pt = Game.player.team;
    const veh = { x: v.pos.x, y: v.pos.y + v.hitRadius * 0.5, z: v.pos.z };
    const pEye = Game.weapons.getEyePos(Game.player);
    if (!Game.terrain.blocksLOS(pEye.x, pEye.y, pEye.z, veh.x, veh.y, veh.z)) return true;
    for (let k = 0; k < 3; k++) {
      H.visIdx = (H.visIdx + 1) % Math.max(1, Game.soldiers.length);
      const t = Game.soldiers[H.visIdx];
      if (!t || !t.alive || t.team !== pt || t.ridingVehicle) continue;
      const tEye = Game.weapons.getEyePos(t);
      if (!Game.terrain.blocksLOS(tEye.x, tEye.y, tEye.z, veh.x, veh.y, veh.z)) return true;
    }
    return false;
  }

  // v5.16 反炮击预警：队友被敌方迫击炮命中 → 记录敌方迫击炮手（无视视野，小地图高亮）
  function revealMortar(shooter) {
    if (!shooter) return;
    const now = Game.time;
    for (const r of H.mortarReveals) {
      if (r.s === shooter) { r.until = now + CONFIG.MORTAR_REVEAL_TIME; return; }
    }
    H.mortarReveals.push({ s: shooter, until: now + CONFIG.MORTAR_REVEAL_TIME });
    if (H.mortarReveals.length > 4) H.mortarReveals.shift();
  }

  // ---- v5.48 地图渲染：小地图/大地图共用，朝向为北实时旋转 + 缩放挡位 ----
  function mapFrame(size, range) {
    const p = Game.player;
    const scale = size / (range * 2);
    const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
    const cx = size / 2, cy = size / 2;
    const to = (wx, wz) => {
      const dx = wx - p.pos.x, dz = wz - p.pos.z;
      return { x: cx + (dx * cos - dz * sin) * scale, y: cy + (dx * sin + dz * cos) * scale };
    };
    const inRange = (wx, wz) => {
      const dx = wx - p.pos.x, dz = wz - p.pos.z;
      const rx = dx * cos - dz * sin, rz = dx * sin + dz * cos;
      return Math.abs(rx) <= range && Math.abs(rz) <= range;
    };
    return { scale, cos, sin, cx, cy, to, inRange };
  }

  function renderMap(ctx, size, range, bg) {
    const p = Game.player;
    const f = mapFrame(size, range);
    ctx.clearRect(0, 0, size, size);
    // 地形底图：旋转 + 缩放（玩家朝向 = 上）
    ctx.save();
    ctx.translate(f.cx, f.cy);
    ctx.rotate(p.yaw);
    const bgScale = bg.width / (CONFIG.WORLD * 2);
    ctx.scale(f.scale / bgScale, f.scale / bgScale);
    ctx.drawImage(bg, -(p.pos.x + CONFIG.WORLD) * bgScale, -(p.pos.z + CONFIG.WORLD) * bgScale);
    ctx.restore();
    const now = Game.time, pt = p.team;
    H.mortarReveals = H.mortarReveals.filter((r) => r.until > now && r.s && r.s.alive);
    // 占领点
    for (const flag of Game.flags) {
      if (!f.inRange(flag.x, flag.z)) continue;
      const q = f.to(flag.x, flag.z);
      const col = flag.owner === TEAM_RED ? '#ff6a5e' : flag.owner === TEAM_BLUE ? '#6aa0ff' : '#e8e8e8';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#000'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(flag.id, q.x, q.y + 3);
    }
    // 载具：己方恒显；敌方有视野才标注；按类型绘制缩小俯视图
    for (const v of Game.vehicles) {
      if (!v.alive) continue;
      if (v.team !== pt) {
        if (!(v.minimapSeenUntil > now) && (v.visCheckT || 0) <= now) {
          v.visCheckT = now + 0.4;
          if (vehicleSeenByTeam(v)) v.minimapSeenUntil = now + 1.2;
        }
        if (!(v.minimapSeenUntil > now) && !(v.spottedUntil > now)) continue;
      }
      if (!f.inRange(v.pos.x, v.pos.z)) continue;
      const q = f.to(v.pos.x, v.pos.z);
      drawVehicleSilhouette(ctx, v.kind, v.team, q.x, q.y, v.yaw - p.yaw);
      if (v.team !== pt) {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // 队友
    for (const s of Game.soldiers) {
      if (!s.alive || s.team !== pt || s === Game.player) continue;
      if (!f.inRange(s.pos.x, s.pos.z)) continue;
      const q = f.to(s.pos.x, s.pos.z);
      ctx.fillStyle = '#6ad06a'; ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }
    // 被标记的敌人
    for (const s of Game.soldiers) {
      if (!s.alive || s.team === pt) continue;
      if (s.spottedUntil > now && f.inRange(s.pos.x, s.pos.z)) {
        const q = f.to(s.pos.x, s.pos.z);
        if (s.clsKey === 'mortar') {
          ctx.fillStyle = '#ffa028';
          ctx.beginPath(); ctx.arc(q.x, q.y, 3.4, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(q.x - 4.6, q.y); ctx.lineTo(q.x + 4.6, q.y);
          ctx.moveTo(q.x, q.y - 4.6); ctx.lineTo(q.x, q.y + 4.6);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#ff5544';
          ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // 反炮击预警
    for (const r of H.mortarReveals) {
      if (!r.s || !r.s.alive || !f.inRange(r.s.pos.x, r.s.pos.z)) continue;
      const q = f.to(r.s.pos.x, r.s.pos.z);
      const pulse = 4 + Math.sin(now * 6) * 1.3;
      ctx.fillStyle = 'rgba(255,150,40,0.35)';
      ctx.beginPath(); ctx.arc(q.x, q.y, pulse + 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffa028';
      ctx.beginPath(); ctx.arc(q.x, q.y, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(q.x, q.y, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(q.x - 3, q.y); ctx.lineTo(q.x + 3, q.y);
      ctx.moveTo(q.x, q.y - 3); ctx.lineTo(q.x, q.y + 3);
      ctx.stroke();
    }
    // 玩家：中心白色箭头（朝上 = 当前朝向）
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(f.cx, f.cy - 6);
    ctx.lineTo(f.cx - 4, f.cy + 4);
    ctx.lineTo(f.cx + 4, f.cy + 4);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(f.cx, f.cy, 2.2, 0, Math.PI * 2); ctx.stroke();
  }

  // v5.48 载具缩小俯视图（按类型区分：坦克/装甲车/防空车/直升机）
  function drawVehicleSilhouette(ctx, kind, team, x, y, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = team === TEAM_RED ? '#e06a5e' : '#6a8ae0';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1;
    if (kind === 'tank') {
      ctx.fillRect(-3, -2, 6, 4); ctx.strokeRect(-3, -2, 6, 4);
      ctx.fillRect(-1.5, -1.5, 3, 3); ctx.strokeRect(-1.5, -1.5, 3, 3);
      ctx.fillRect(0, -0.8, 5, 1.6);
    } else if (kind === 'apc') {
      ctx.fillRect(-3, -1.8, 6, 3.6); ctx.strokeRect(-3, -1.8, 6, 3.6);
      ctx.fillRect(-1, -1, 2, 2); ctx.strokeRect(-1, -1, 2, 2);
      ctx.fillRect(0, -0.6, 3, 1.2);
    } else if (kind === 'aa') {
      ctx.fillRect(-2.6, -1.8, 5.2, 3.6); ctx.strokeRect(-2.6, -1.8, 5.2, 3.6);
      ctx.fillRect(-1.2, -1.2, 2.4, 2.4); ctx.strokeRect(-1.2, -1.2, 2.4, 2.4);
      ctx.fillRect(0, -0.6, 3.4, 1.2);
      ctx.fillRect(0.8, -1, 0.9, 0.9); ctx.fillRect(0.8, 0.1, 0.9, 0.9);
    } else if (kind === 'heli') {
      ctx.fillRect(-0.8, -2.4, 1.6, 4.8); ctx.strokeRect(-0.8, -2.4, 1.6, 4.8);
      ctx.fillRect(-3.2, -0.5, 6.4, 1);
      ctx.fillRect(0.4, 2, 2.4, 0.8);
    }
    ctx.restore();
  }

  function drawMinimap() {
    const c = H.el.minimap; if (!c || !H.minimapBg) return;
    renderMap(c.getContext('2d'), H.minimapSize, H.minimapRange, H.minimapBg);
  }

  function drawBigMap() {
    if (!H.bigMapOpen) return;
    const c = H.el.bigmap; if (!c || !H.bigMapBg) return;
    renderMap(c.getContext('2d'), c.width, H.minimapRange, H.bigMapBg);
  }

  // v5.48 小地图尺寸 / 缩放 / 大地图
  function setMinimapSize(size, silent) {
    H.minimapSize = size;
    const c = H.el.minimap;
    if (c) { c.width = c.height = size; c.style.width = c.style.height = size + 'px'; }
    try { localStorage.setItem('ashen_minimap_size', String(size)); } catch (e) {}
    if (!silent) H.message('小地图大小 ' + size + 'px');
  }
  function cycleMinimapRange() {
    const i = MINIMAP_RANGES.indexOf(H.minimapRange);
    H.minimapRange = MINIMAP_RANGES[(i + 1) % MINIMAP_RANGES.length];
    H.message('小地图范围 ' + H.minimapRange + 'm');
  }
  function cycleMinimapSize() {
    const i = MINIMAP_SIZES.indexOf(H.minimapSize);
    setMinimapSize(MINIMAP_SIZES[(i + 1) % MINIMAP_SIZES.length]);
  }
  function toggleBigMap() {
    H.bigMapOpen = !H.bigMapOpen;
    if (H.el.bigmapOverlay) H.el.bigmapOverlay.classList.toggle('hidden', !H.bigMapOpen);
    if (H.bigMapOpen) {
      if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    } else if (Game.running && Game.player && Game.player.alive && Game.phase === 'playing' && Game.Player && Game.Player.requestLock) {
      Game.Player.requestLock();
    }
  }
  function bindMapKeys() {
    document.addEventListener('keydown', (e) => {
      if (!Game.running) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'KeyN') { e.preventDefault(); cycleMinimapRange(); }
      else if (e.code === 'KeyM') { e.preventDefault(); toggleBigMap(); }
      else if (e.code === 'KeyK') { e.preventDefault(); cycleMinimapSize(); }
    });
  }
  H.setMinimapSize = setMinimapSize;

  // ---- 每帧更新 ----
  function update(dt) {
    const p = Game.player;
    if (!p) return;
    if (Game.over) return;

    const el = H.el;
    // 血量
    const hpPct = Math.max(0, p.health / p.maxHealth * 100);
    el.healthFill.style.width = hpPct + '%';
    el.healthFill.style.background = hpPct > 60 ? 'linear-gradient(90deg,#7ad06a,#4aa03a)'
      : hpPct > 30 ? 'linear-gradient(90deg,#e0d06a,#c09a3a)' : 'linear-gradient(90deg,#e06a5e,#b03a3a)';
    el.healthNum.textContent = Math.ceil(p.health);

    // 弹药
    const inVehicle = !!p.ridingVehicle;

    // v5.10 突击兵护盾条（无法补充）
    if (p.shield > 0 && !inVehicle) {
      el.shieldBar.classList.remove('hidden');
      el.shieldFill.style.width = Math.max(0, Math.min(100, p.shield / CONFIG.ASSAULT_SHIELD * 100)) + '%';
    } else {
      el.shieldBar.classList.add('hidden');
    }

    // v5.10/v5.11 装填读条：仅在换弹或装备装填时出现（修复此前常驻空条）
    let barPct = -1, barColor = '#7ad06a';
    if (p.reloading && !inVehicle) {
      const slot = Game.weapons.activeWeapon(p);
      if (slot) barPct = 1 - p.reloadTimer / slot.def.reload;
    } else if (p.gadgetCooldown > 0 && !inVehicle) {
      barPct = 1 - p.gadgetCooldown / (p.gadgetCdMax || 1);
      barColor = '#6aa0ff';
    } else if (!inVehicle) {
      // v5.17 拉栓读条（琥珀色，区别于换弹绿/装备蓝）
      const wb = Game.weapons.activeWeapon(p);
      if (wb && wb.def.boltTime && p.boltT > 0) {
        barPct = 1 - p.boltT / wb.def.boltTime;
        barColor = '#ffb04a';
      }
    }
    if (barPct >= 0 && barPct < 1) {
      el.reloadBar.classList.remove('hidden');
      el.reloadFill.style.width = Math.round(barPct * 100) + '%';
      el.reloadFill.style.background = barColor;
    } else {
      el.reloadBar.classList.add('hidden');
    }

    // v5.18 功绩分数：跳功绩时渐缓跳动增长；3 秒未更新 → 快速淡出（非立即消失）
    if (meritOn) {
      const diff = meritTarget - meritShown;
      if (diff > 0.5) {
        meritShown += diff * (1 - Math.exp(-8 * dt));
        if (meritTarget - meritShown < 0.5) meritShown = meritTarget;
        el.meritScore.textContent = Math.round(meritShown);
        meritIdle = 0;
      } else {
        meritShown = meritTarget;
        el.meritScore.textContent = Math.round(meritShown);
        meritIdle += dt;
        if (meritIdle >= 3) { meritOn = false; el.meritScore.classList.add('ms-out'); }
      }
      if (meritShown > meritTarget) meritShown = meritTarget;
    }
    if (!inVehicle && p.slot !== 'gadget') {
      const slot = Game.weapons.activeWeapon(p);
      if (slot) {
        el.ammoMag.textContent = slot.mag;
        el.ammoReserve.textContent = slot.reserve;
        el.weaponName.textContent = Game.L(slot.def) + (p.semiMode ? ' · ' + Game.t('weapon.semi') : '');
      }
      el.reloadHint.classList.toggle('hidden', !p.reloading);
    } else if (p.slot === 'gadget') {
      el.weaponName.textContent = Game.L(p.cls, 'gadgetName');
      el.ammoMag.textContent = p.gadgetAmmo > 0 ? p.gadgetAmmo : '—';
      el.ammoReserve.textContent = '';
    }
    const g = GADGETS[p.gadget];
    let gText = Game.L(p.cls, 'gadgetName') + '：';
    if (p.gadgetCooldown > 0) gText += Math.ceil(p.gadgetCooldown) + 's ' + Game.t('gadget.reload');
    else if (g && g.ammo > 0) gText += p.gadgetAmmo;
    else gText += Game.t('gadget.ready');
    el.gadgetInfo.textContent = gText + ' · ' + Game.t('gadget.grenades') + ' ' + p.grenades;

    // 准星：载具/狙击=十字，其他枪=红点（扩散 = 静止锥角 + 连射累积，度 → 像素）
    const isSniper = !inVehicle && p.cls.weapon === 'sniper';
    const spreadDeg = (!inVehicle && p.slot !== 'gadget') ? Game.weapons.totalSpreadDeg(p, Game.Player.adsEase || 0) : 0;
    const gap = inVehicle ? 7 : Math.min(34, 3 + spreadDeg * 9);   // v5.10 准星缩小
    el.crosshair.style.setProperty('--gap', gap + 'px');
    el.crosshair.classList.toggle('reddot', !inVehicle && !isSniper);
    // v5.46 红点准星可配置开关（测试用，未来取消）
    el.crosshair.style.display = (Game.Player.scoped || !CONFIG.CROSSHAIR) ? 'none' : '';
    // v5.47 镜枪十字线已集成在 3D 镜管上，屏幕外设十字线仅保留给无镜管的可开镜装备（RPG）
    el.scope.classList.toggle('hidden', !(Game.Player.scoped && !Game.Player.scopeLocal));

    // 兵力 + 模式标签
    el.ticketRed.textContent = Math.ceil(Game.ticketsRed);
    el.ticketBlue.textContent = Math.ceil(Game.ticketsBlue);
    if (Game.mode === 'breakthrough') {
      el.modeTag.textContent = p.team === TEAM_RED ? Game.t('mode.tag.bt.att') : Game.t('mode.tag.bt.def');
      el.modeTag.style.background = p.team === TEAM_RED ? 'rgba(224,74,62,0.8)' : 'rgba(62,122,224,0.8)';
      updateSectorBar();
    } else {
      el.modeTag.textContent = Game.t('mode.tag.conquest');
      el.modeTag.style.background = 'rgba(90,90,90,0.7)';
    }

    // 分数 + 军衔
    el.score.textContent = p.score;
    updateRankDisplay();

    // 占领点
    for (const f of Game.flags) {
      const ui = f.ui;
      ui.fill.style.left = '0'; ui.fill.style.right = 'auto';
      ui.fill.style.width = Math.abs(f.control) + '%';
      ui.fill.className = 'flag-fill ' + (f.control < 0 ? 'red' : f.control > 0 ? 'blue' : 'neutral');
      const own = f.owner;
      ui.label.textContent = f.id + (own === TEAM_RED ? ' ' + Game.t('flag.red') : own === TEAM_BLUE ? ' ' + Game.t('flag.blue') : '');
      ui.label.style.color = f.locked ? '#6a6a6a' : (own === TEAM_RED ? '#ff6a5e' : own === TEAM_BLUE ? '#6aa0ff' : '#fff');
      ui.bar.style.opacity = f.locked ? 0.4 : 1;
    }

    // v5.39 阵亡俯视选点：实时刷新复活点按钮投影（跟随相机）
    if (Game.phase === 'dead') updateDeathSpawns();

    // 小地图 / 大地图
    drawMinimap();
    drawBigMap();

    // 迫击炮部署地图（部署期间实时刷新）
    if (Game.Player.mortarDeployed) drawMortarMap();

    // 占领状态
    updateCaptureStatus();

    // 出生保护
    el.spawnHint.classList.toggle('hidden', !(p.spawnProtect > 0 && !inVehicle));

    // 载具 HUD
    if (inVehicle) {
      const v = p.ridingVehicle;
      el.vehicleHud.classList.remove('hidden');
      el.vehicleName.textContent = Game.L(v.def);
      el.vehicleHealthFill.style.width = Math.max(0, v.hp / v.maxHp * 100) + '%';
      el.vehicleHint.textContent = v.kind === 'heli'
        ? Game.t('veh.hint.heli')
        : v.kind === 'aa'
          ? Game.t('veh.hint.aa')
          : Game.t('veh.hint.ground');
      // v5.48 载具武器装填读条（炮/火箭的冷却）
      const slot = v.weaponSlot || 'primary';
      let reloadPct = 0, reloadShow = false;
      if (v.kind === 'tank' && slot === 'primary' && v.cannonTimer > 0) { reloadPct = 1 - v.cannonTimer / v.def.shellReload; reloadShow = true; }
      else if (v.kind === 'heli' && slot === 'primary' && v.rocketTimer > 0) { reloadPct = 1 - v.rocketTimer / v.def.rocketReload; reloadShow = true; }
      else if (v.kind === 'aa' && v.cannonTimer > 0) { reloadPct = 1 - v.cannonTimer / v.def.cannonRate; reloadShow = true; }
      else if (v.mgTimer > 0 && (v.kind === 'apc' || slot === 'secondary')) {
        reloadPct = 1 - v.mgTimer / (v.kind === 'heli' ? v.def.cannonRate : v.def.mgRate); reloadShow = true;
      }
      if (el.vehicleReload) {
        el.vehicleReload.classList.toggle('hidden', !reloadShow);
        if (reloadShow) el.vehicleReloadFill.style.width = Math.max(0, Math.min(100, reloadPct * 100)) + '%';
      }
      // v5.48 载具机枪过热/冷却读条（过热后 100%→30 为冷却进程）
      const heat = v.heat || 0;
      if (el.vehicleHeat) {
        const showHeat = heat > 0 || v.mgOverheated;
        el.vehicleHeat.classList.toggle('hidden', !showHeat);
        if (showHeat) {
          let pct;
          if (v.mgOverheated) {
            pct = Math.max(0, Math.min(100, (heat - 30) / 70 * 100));   // 冷却：100(热满) → 0(可再开火)
            el.vehicleHeatFill.style.background = '#e0483a';
            el.vehicleHeatFill.classList.add('cooling');
            if (el.vehicleHeatLabel) el.vehicleHeatLabel.textContent = '过热·冷却';
          } else {
            pct = Math.max(0, Math.min(100, heat));
            el.vehicleHeatFill.style.background = heat > 70 ? '#e09030' : '#e0c04a';
            el.vehicleHeatFill.classList.remove('cooling');
            if (el.vehicleHeatLabel) el.vehicleHeatLabel.textContent = heat > 70 ? '即将过热' : '';
          }
          el.vehicleHeatFill.style.width = pct + '%';
        }
      }
    } else {
      el.vehicleHud.classList.add('hidden');
    }

    // 受击方向指示
    const hi = el.hitIndicator;
    if (p.lastHitTime && Game.time - p.lastHitTime < 0.8 && p.alive) {
      hi.classList.remove('hidden');
      const rel = normAngle(p.lastHitYaw - p.yaw);
      const ang = -rel, r = 66;
      const rx = Math.sin(ang) * r, ry = -Math.cos(ang) * r;
      // v5.43 受击方向指示按伤害缩放：大伤害更亮更大
      const dmgK = M.clamp((p.lastHitDmg || 10) / 60, 0.55, 1.4);
      hi.style.transform = 'translate(-50%,-50%) translate(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px) rotate(' + (ang * 180 / Math.PI).toFixed(1) + 'deg) scale(' + dmgK.toFixed(2) + ')';
      hi.style.opacity = Math.max(0, 1 - (Game.time - p.lastHitTime) / 0.8);
    } else {
      hi.classList.add('hidden');
    }

    // v5.38 濒死反馈：低血量暗角红晕随伤情加重 + 心跳音（咚-咚，越伤越急）
    if (p.health <= 45 && p.alive && !inVehicle) {
      const k = 1 - p.health / 45;
      el.lowhp.classList.remove('hidden');
      el.lowhp.style.opacity = (0.22 + 0.5 * k + 0.12 * Math.sin(Game.time * (5 + k * 4))).toFixed(2);
      // v5.43 濒死去饱和（血量越低战场越灰）
      if (Game.renderer && Game.renderer.domElement) Game.renderer.domElement.style.filter = 'saturate(' + (1 - 0.5 * k).toFixed(3) + ')';
      H.hbT = (H.hbT || 0) - dt;
      if (H.hbT <= 0) {
        H.hbT = 1.25 - k * 0.75;
        if (Game.sound && Game.sound.heartbeat) Game.sound.heartbeat(0.4 + k * 0.6);
      }
    } else {
      el.lowhp.classList.add('hidden');
      if (Game.renderer && Game.renderer.domElement) Game.renderer.domElement.style.filter = '';
    }

    // v5.41 烟雾弹内视野极差：白色浓雾遮罩（站在烟区内几乎看不清）
    if (p.alive && !inVehicle && Game.effects && Game.effects.inSmoke && Game.effects.inSmoke(p.pos.x, p.pos.z)) {
      el.smokeOverlay.classList.remove('hidden');
      el.smokeOverlay.style.opacity = '0.85';
    } else {
      el.smokeOverlay.classList.add('hidden');
    }

    // 目标罗盘（模式目标优先：突破=当前扇区，征服=最近敌方旗）
    let obj = null, objD = Infinity, objLabel = Game.t('obj.capture');
    if (Game.modes && Game.modes.objectiveFor) {
      const o = Game.modes.objectiveFor(p);
      obj = o; objD = M.dist2(o.x, o.z, p.pos.x, p.pos.z);
      if (Game.mode === 'breakthrough') objLabel = Game.t('obj.sector', Game.activeSector) + ' · ' + (p.team === TEAM_RED ? Game.t('obj.attack') : Game.t('obj.defend'));
    }
    // v5.40 阵亡后不显示目标罗盘（扇区·进攻/防守字样只在存活时显示）
    if (obj && !inVehicle && p.alive) {
      el.objective.classList.remove('hidden');
      const oAng = -normAngle(Math.atan2(-(obj.x - p.pos.x), -(obj.z - p.pos.z)) - p.yaw);
      el.objArrow.style.transform = 'rotate(' + (oAng * 180 / Math.PI).toFixed(1) + 'deg)';
      el.objText.textContent = objLabel + ' · ' + Math.round(objD) + 'm';
      el.objArrow.style.color = Game.mode === 'breakthrough' && p.team === TEAM_RED ? '#ff6a5e' : '#e8e8e8';
    } else {
      el.objective.classList.add('hidden');
    }
  }

  function updateCaptureStatus() {
    const el = H.el.captureStatus;
    const p = Game.player;
    let flag = null, best = 16;
    for (const f of Game.flags) {
      const d = M.dist2(p.pos.x, p.pos.z, f.x, f.z);
      if (d < best) { best = d; flag = f; }
    }
    if (!flag) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    let txt;
    if (flag.owner === p.team) txt = Game.t('cap.hold', flag.id);
    else if (flag.redCount > 0 || flag.blueCount > 0) {
      const capping = (p.team === TEAM_RED && flag.redCount > 0 && flag.blueCount === 0)
        || (p.team === TEAM_BLUE && flag.blueCount > 0 && flag.redCount === 0);
      txt = capping ? Game.t('cap.capping', flag.id) : Game.t('cap.contested', flag.id);
    } else {
      txt = Game.t('cap.empty', flag.id);
    }
    el.innerHTML = txt + '<div class="cs-bar"><div class="cs-fill" style="width:' +
      Math.abs(flag.control) + '%"></div></div>';
  }

  // ---- 即时反馈 ----
  function flashDamage(dmg) {
    const el = H.el.damageFlash;
    el.classList.remove('hidden');
    // v5.43 受击红晕随伤害缩放：擦伤轻微泛红、大伤害满屏
    el.style.opacity = String(Math.min(0.9, 0.35 + (dmg || 0) / 70));
    clearTimeout(H.dmgTimer);
    H.dmgTimer = setTimeout(() => { el.style.opacity = '0'; }, Math.min(300, 120 + (dmg || 0)));
  }
  function hitmarker(kill, headshot, armor) {
    const el = H.el.hitmarker;
    el.classList.remove('hidden', 'hm-pop', 'hm-kill', 'hm-head', 'hm-armor');
    void el.offsetWidth;   // 强制 reflow 重放弹跳动画
    el.classList.add('hm-pop');
    if (kill) { el.classList.add('hm-kill'); el.style.color = '#ff2211'; el.style.textShadow = '0 0 7px #ff2211'; }
    else if (headshot) { el.classList.add('hm-head'); el.style.color = '#ffcc00'; el.style.textShadow = '0 0 7px #ffcc00'; }
    else if (armor) { el.classList.add('hm-armor'); el.style.color = '#ffb340'; el.style.textShadow = '0 0 3px #000'; }
    else { el.style.color = '#ff5544'; el.style.textShadow = '0 0 2px #000'; }
    clearTimeout(H.hmTimer);
    H.hmTimer = setTimeout(() => el.classList.add('hidden'), kill ? 300 : (headshot ? 170 : 130));
  }
  function showReload() { H.el.reloadHint.classList.remove('hidden'); }
  function hideReload() { H.el.reloadHint.classList.add('hidden'); }

  function message(text) {
    const el = H.el.message;
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.opacity = '1';
    clearTimeout(H.msgTimer);
    H.msgTimer = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.classList.add('hidden'), 500); }, 2200);
  }

  function announce(text, color) {
    const el = H.el.announce;
    el.textContent = text;
    el.style.color = color || '#ffd27a';
    el.classList.remove('hidden');
    el.style.opacity = '1';
    clearTimeout(H.annTimer);
    H.annTimer = setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.classList.add('hidden'), 600);
    }, 2600);
  }

  function popup(text, worldPos, color) {
    if (!Game.camera) return;
    const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z).project(Game.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * innerWidth;
    const y = (-v.y * 0.5 + 0.5) * innerHeight;
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.color = color || '#ffd27a';
    H.el.popups.appendChild(el);
    setTimeout(() => { el.style.transform = 'translate(-50%,-46px)'; el.style.opacity = '0'; }, 30);
    setTimeout(() => el.remove(), 1100);
  }

  // ---- 界面切换 ----
  function showScreen(id) {
    ['menu', 'class-select', 'death-screen', 'end-screen', 'scoreboard'].forEach((sid) => {
      const el = document.getElementById(sid);
      if (el) el.classList.toggle('hidden', sid !== id);
    });
    if (id === 'death-screen') {
      buildDeathClasses();
      buildDeathSpawns();
    }
  }
  function toggleScoreboard(show) {
    if (show) { H.el.scoreboard.classList.remove('hidden'); renderScoreboard(); }
    else H.el.scoreboard.classList.add('hidden');
  }
  function renderScoreboard() {
    const rows = Game.soldiers.slice().sort((a, b) => b.score - a.score).slice(0, 24);
    let html = '<div class="sb-row head"><span class="sb-c name">' + Game.t('sb.player') + '</span><span class="sb-c">' + Game.t('sb.kills') + '</span><span class="sb-c">' + Game.t('sb.deaths') + '</span><span class="sb-c">' + Game.t('sb.score') + '</span><span class="sb-c">' + Game.t('sb.class') + '</span></div>';
    for (const s of rows) {
      const isMe = s === Game.player;
      const teamCls = s.team === TEAM_RED ? 't-red' : 't-blue';
      const name = isMe ? Game.t('sb.you') : (s.team === TEAM_RED ? Game.t('sb.team.red') : Game.t('sb.team.blue')) + '·' + Game.tn(s.name || s.id);   // v5.28 呼号
      html += '<div class="sb-row ' + teamCls + (isMe ? ' me' : '') + '">' +
        '<span class="sb-c name">' + name + '</span>' +
        '<span class="sb-c">' + s.kills + '</span><span class="sb-c">' + s.deaths + '</span>' +
        '<span class="sb-c">' + s.score + '</span>' +
        '<span class="sb-c">' + Game.L(s.cls) + '</span></div>';
    }
    H.el.scoreboardBody.innerHTML = html;
  }
  function setLocked(locked) {
    // v5.13 迫击炮部署时不显示；v5.42 死亡后也不显示（阵亡界面不需要「Esc 释放」提示）
    const mortar = Game.Player && Game.Player.mortarDeployed;
    const dead = Game.phase === 'dead';
    H.el.pauseHint.classList.toggle('hidden', locked || mortar || dead);
  }

  // ============================================================
  //  v5.18 功绩播报：底部小字堆叠（3s 寿命 / 最多 5 项滚动 / 渐变消失）
  //  + 上方分数值渐缓跳动（3s 未更新快速淡出）；只播玩家的功绩，
  //  他人击杀不播（除非我有助攻）；侦察标记累加在同一条目跳数字
  // ============================================================
  const MERIT_DEFS = {
    kill: { label: '击杀', color: '#ffd27a' },
    headshot: { label: '爆头', color: '#ffd75e' },
    defense: { label: '防守击杀', color: '#7ab8ff' },
    attack: { label: '进攻击杀', color: '#ff9a6a' },
    revenge: { label: '复仇', color: '#ff6a8a' },
    streak: { label: '连杀', color: '#ffb080' },
    assist: { label: '助攻', color: '#9ad0ff' },
    suppress: { label: '火力压制', color: '#b8a0ff' },
    spot: { label: '标记', color: '#8fd0ff' },
    vehicle: { label: '载具摧毁', color: '#ffd27a' },
    vehicleAssist: { label: '载具助攻', color: '#ffcf8a' },   // v5.47
    spotAssist: { label: '侦察助攻', color: '#8fd0ff' },       // v5.47
    ammo: { label: '补给弹药', color: '#8ad0c8' },
    heal: { label: '治疗', color: '#6ad06a' },
    capture: { label: '占领', color: '#ffd27a' },
    multi: { label: '多杀', color: '#ffb080' },
    repair: { label: '维修', color: '#ffc26a' },   // v5.38 工程兵维修功绩
  };
  let meritShown = 0, meritTarget = 0, meritIdle = -1, meritOn = false;

  function layoutMerits() {
    const el = H.el.scorefeed;
    if (!el) return;
    const kids = Array.from(el.children);
    kids.forEach((k, i) => {
      // v5.27 战地五式：越老的功绩越小越透明（槽位缩放），下滚间距 33px
      const sc = Math.max(0.55, 1 - i * 0.12);
      const op = Math.max(0.28, 1 - i * 0.16);
      k.style.transform = 'translate(-50%, ' + (i * 33) + 'px) scale(' + sc.toFixed(2) + ')';
      k.style.opacity = op.toFixed(2);
    });
  }
  function meritEntryTimer(el) {
    if (el._t) clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.classList.add('mf-out');   // 固定寿命 3s → 快速消失（0.2s 过渡，非渐渐淡出）
      el._t2 = setTimeout(() => { if (el.parentNode) el.remove(); layoutMerits(); }, 600);
    }, 3000);
  }
  function meritBumpScore() {
    meritTarget = Game.player ? Game.player.score : 0;
    meritIdle = 0; meritOn = true;
    const s = H.el.meritScore;
    if (s) {
      s.classList.remove('hidden', 'ms-out');
      // v5.28 跳分弹跳 + 轻响（高级感）
      s.classList.remove('ms-pop'); void s.offsetWidth; s.classList.add('ms-pop');
      clearTimeout(H.msPopT);
      H.msPopT = setTimeout(() => { if (s) s.classList.remove('ms-pop'); }, 200);
    }
    if (Game.sound && Game.sound.scoreTick) Game.sound.scoreTick();   // v5.28 计分轻响
  }
  function merit(kind, amount, labelOverride) {
    const el = H.el.scorefeed;
    if (!el) return;
    const def = MERIT_DEFS[kind] || { label: kind, color: '#ffd27a' };
    const label = labelOverride || Game.t('merit.' + kind) || def.label;   // v5.22 动态标签（双杀/三杀/超神）
    // 侦察标记累加：已有标记条目 → 只跳数字并续命，条目照常滚动
    if (kind === 'spot') {
      const cur = el.querySelector('.mf-entry[data-kind="spot"]');
      if (cur) {
        const n = parseInt(cur.getAttribute('data-n') || '1', 10) + 1;
        const total = parseInt(cur.getAttribute('data-total') || '0', 10) + amount;
        cur.setAttribute('data-n', String(n)); cur.setAttribute('data-total', String(total));
        cur.innerHTML = '<span class="mf-amt">+' + total + '</span> <span class="mf-label">' + label + ' ×' + n + '</span>';
        meritEntryTimer(cur);
        meritBumpScore();
        return;
      }
    }
    const d = document.createElement('div');
    d.className = 'mf-entry';
    d.setAttribute('data-kind', kind);
    d.setAttribute('data-n', '1');
    d.setAttribute('data-total', String(amount));
    d.innerHTML = '<span class="mf-amt">+' + amount + '</span> <span class="mf-label">' + label + '</span>';
    d.style.color = def.color;
    d.style.transform = 'translate(-50%, -18px) scale(1.3)';
    d.style.opacity = '0';
    el.insertBefore(d, el.firstChild);
    while (el.children.length > 5) {   // 最多滚动 5 项，挤掉最老
      const old = el.lastElementChild;
      if (old._t) clearTimeout(old._t); if (old._t2) clearTimeout(old._t2);
      old.remove();
    }
    void d.offsetWidth;   // 强制 reflow → 入场/滚动过渡生效
    d.style.opacity = '';
    layoutMerits();
    meritEntryTimer(d);
    meritBumpScore();
  }
  // ============================================================
  //  v5.23 伤害跳数字：玩家造成伤害后，准星附近短促上浮渐隐的数字
  // ============================================================
  let dmgPopCount = 0;
  function damagePop(amount, color) {
    const el = H.el.hud;
    if (!el || amount <= 0) return;
    if (dmgPopCount > 14) return;   // 防刷屏上限
    const d = document.createElement('div');
    d.className = 'dmg-pop';
    d.textContent = '+' + Math.round(amount);
    const ox = (Math.random() * 2 - 1) * 26, oy = (Math.random() * 2 - 1) * 8 - 6;
    d.style.left = 'calc(50% + ' + ox.toFixed(0) + 'px)';
    d.style.top = 'calc(46% + ' + oy.toFixed(0) + 'px)';
    if (color) d.style.color = color;
    el.appendChild(d);
    dmgPopCount++;
    setTimeout(() => { if (d.parentNode) d.remove(); dmgPopCount--; }, 800);
  }
  H.damagePop = damagePop;

  // 兼容旧接口：原样文本条目（不参与分数缓动）
  function scoreFeed(text, color) {
    const el = H.el.scorefeed;
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'mf-entry';
    d.textContent = text;
    d.style.color = color || '#ffd27a';
    el.insertBefore(d, el.firstChild);
    while (el.children.length > 5) { const old = el.lastElementChild; if (old._t) clearTimeout(old._t); old.remove(); }
    layoutMerits();
    meritEntryTimer(d);
  }
  H.merit = merit;
  H.scoreFeed = scoreFeed;

  // v5.28 爆炸闪光（氛围：近距爆炸全屏暖光一闪）
  function explosionFlash(power) {
    const el = H.el.flash;
    if (!el) return;
    el.style.opacity = String(power);
    clearTimeout(H.flashT);
    H.flashT = setTimeout(() => { el.style.opacity = '0'; }, 40);
  }
  H.explosionFlash = explosionFlash;

  // ============================================================
  //  v5.7 迫击炮部署地图（右下悬空，点击选点发射）
  // ============================================================
  const MORTAR_MAP_SIZE = 380;
  H.lastMortarHit = null;
  function initMortarMapHandlers() {
    if (!H.el.mortarMap || H.el.mortarMap._bound) return;
    H.el.mortarMap._bound = true;
    H.el.mortarMap.addEventListener('click', (e) => {
      const p = Game.player;
      if (!p || !Game.Player.mortarDeployed) return;
      const w = mortarCanvasToWorld(e.clientX, e.clientY);
      const res = Game.weapons.fireMortarAt(p, w.x, w.z);
      if (res === 'ok') {
        H.lastMortarHit = w;
        H.message(Game.t('mortar.hit', Math.round(Game.math.dist2(p.pos.x, p.pos.z, w.x, w.z))));
      } else if (res === 'too-close') H.message(Game.t('mortar.tooClose'));
      else if (res === 'too-far') H.message(Game.t('mortar.tooFar'));
      else if (res === 'no-ammo') H.message(Game.t('mortar.noAmmo'));
      else if (res === 'cooling') H.message(Game.t('mortar.cooling', Math.ceil(p.gadgetCooldown)));
      drawMortarMap();
    });
    H.el.mortarMap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      Game.Player.setMortarDeployed(false);
    });
  }
  function showMortarMap(on) {
    if (!H.el.mortarPanel) return;
    H.el.mortarPanel.classList.toggle('hidden', !on);
    if (on) drawMortarMap();
  }
  H.showMortarMap = showMortarMap;
  function mortarCanvasToWorld(clientX, clientY) {
    const c = H.el.mortarMap;
    const rect = c.getBoundingClientRect();
    const scale = MORTAR_MAP_SIZE / (CONFIG.WORLD * 2);
    const px = (clientX - rect.left) * (MORTAR_MAP_SIZE / Math.max(rect.width, 1));
    const py = (clientY - rect.top) * (MORTAR_MAP_SIZE / Math.max(rect.height, 1));
    return { x: px / scale - CONFIG.WORLD, z: py / scale - CONFIG.WORLD };
  }
  H.mortarCanvasToWorld = mortarCanvasToWorld;
  function drawMortarMap() {
    const c = H.el.mortarMap;
    if (!c || !H.mortarBg) return;
    const ctx = c.getContext('2d');
    const size = MORTAR_MAP_SIZE, scale = size / (CONFIG.WORLD * 2);
    ctx.drawImage(H.mortarBg, 0, 0);
    const p = Game.player;
    const g = GADGETS.mortar;
    const mx = (p.pos.x + CONFIG.WORLD) * scale, my = (p.pos.z + CONFIG.WORLD) * scale;
    // 射程环（绿=最大 / 红=最小）
    ctx.strokeStyle = 'rgba(140,255,120,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mx, my, (g.maxRange || 180) * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,90,80,0.9)';
    ctx.beginPath(); ctx.arc(mx, my, (g.minRange || 40) * scale, 0, Math.PI * 2); ctx.stroke();
    // 旗点
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    for (const f of Game.flags) {
      const x = (f.x + CONFIG.WORLD) * scale, y = (f.z + CONFIG.WORLD) * scale;
      ctx.fillStyle = f.owner === TEAM_RED ? '#ff6a5e' : f.owner === TEAM_BLUE ? '#6aa0ff' : '#e8e8e8';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.fillText(f.id, x, y - 6);
    }
    // 被标记敌人（v5.26 敌方迫击炮兵特殊图标，便于反制炮击瞄准）
    const now = Game.time;
    for (const s of Game.soldiers) {
      if (!s.alive || s.team === p.team || s.spottedUntil <= now) continue;
      const x = (s.pos.x + CONFIG.WORLD) * scale, y = (s.pos.z + CONFIG.WORLD) * scale;
      if (s.clsKey === 'mortar') {
        ctx.fillStyle = '#ffa028';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 5.5, y); ctx.lineTo(x + 5.5, y);
        ctx.moveTo(x, y - 5.5); ctx.lineTo(x, y + 5.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ff5544';
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // v5.16 反炮击预警：敌方迫击炮手高亮（与部署图共享，方便反制炮击）
    H.mortarReveals = H.mortarReveals.filter((r) => r.until > now && r.s && r.s.alive);
    for (const r of H.mortarReveals) {
      const x = (r.s.pos.x + CONFIG.WORLD) * scale, y = (r.s.pos.z + CONFIG.WORLD) * scale;
      const pulse = 5 + Math.sin(now * 6) * 1.6;
      ctx.fillStyle = 'rgba(255,150,40,0.35)';
      ctx.beginPath(); ctx.arc(x, y, pulse + 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffa028';
      ctx.beginPath(); ctx.arc(x, y, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
      ctx.stroke();
    }
    // 迫击炮位置（绿色十字）
    ctx.strokeStyle = '#6ad06a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - 7, my); ctx.lineTo(mx + 7, my);
    ctx.moveTo(mx, my - 7); ctx.lineTo(mx, my + 7);
    ctx.stroke();
    // 上次落点
    if (H.lastMortarHit) {
      const hx = (H.lastMortarHit.x + CONFIG.WORLD) * scale, hy = (H.lastMortarHit.z + CONFIG.WORLD) * scale;
      ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx - 6, hy - 6); ctx.lineTo(hx + 6, hy + 6);
      ctx.moveTo(hx - 6, hy + 6); ctx.lineTo(hx + 6, hy - 6);
      ctx.stroke();
    }
  }

  // 语言切换后重建动态文案（兵种卡/旗点/军衔/扇区条/阵亡复活点/计分板）
  function applyLang() {
    buildClassOptions();
    buildFlags();
    buildSectorBar();
    updateRankDisplay();
    if (H.el && H.el.deathScreen && !H.el.deathScreen.classList.contains('hidden')) {
      buildDeathClasses();
      buildDeathSpawns();
    }
    if (H.el && H.el.scoreboard && !H.el.scoreboard.classList.contains('hidden')) renderScoreboard();
  }
  H.applyLang = applyLang;

  H.init = init; H.initMinimap = initMinimap; H.update = update;
  H.buildSectorBar = buildSectorBar; H.updateSectorBar = updateSectorBar;
  H.flashDamage = flashDamage; H.hitmarker = hitmarker; H.showReload = showReload; H.hideReload = hideReload;
  H.message = message; H.showScreen = showScreen; H.toggleScoreboard = toggleScoreboard;
  H.renderScoreboard = renderScoreboard; H.setLocked = setLocked;
  H.announce = announce; H.popup = popup;
  H.selectClass = selectClass; H.buildClassOptions = buildClassOptions; H.buildFlags = buildFlags;
  H.saveGame = saveGame; H.rankName = rankName;
  H.revealMortar = revealMortar;   // v5.16 反炮击预警
  Game.hud = H;
})();
