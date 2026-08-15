// ============================================================
//  debug.js  ·  调试操作界面（F1 开关；参数自动保存到 localStorage，刷新不丢）
//  保持现有架构：只读/写全局 CONFIG / WEAPONS / VEHICLES / Game 命名空间
// ============================================================
(function () {
  'use strict';

  // ---------- 持久化 ----------
  const STORE_KEY = 'ashfron_cfg_v1';
  const SAVED = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; } })();
  function persist(key, val) { SAVED[key] = val; try { localStorage.setItem(STORE_KEY, JSON.stringify(SAVED)); } catch (e) {} }
  function applySaved() {
    for (const key in SAVED) {
      const v = SAVED[key], p = key.split('.');
      if (p[0] === 'weapon' && WEAPONS[p[1]]) {
        // 支持嵌套路径（如 weapon.ar.recoilDef.pitch）
        let obj = WEAPONS[p[1]];
        for (let i = 2; i < p.length - 1; i++) obj = obj[p[i]];
        obj[p[p.length - 1]] = v;
      } else if (p[0] === 'veh' && VEHICLES[p[1]]) VEHICLES[p[1]][p[2]] = v;
      else if (p[0] === 'gadget' && GADGETS[p[1]]) GADGETS[p[1]][p[2]] = v;
      else if (key in CONFIG) CONFIG[key] = v;
    }
    // 修复：反应延迟滑块只存 MIN，恢复时需同步 MAX（滑块设置 MIN=MAX 联动）
    if ('AI_REACT_MIN' in SAVED) CONFIG.AI_REACT_MAX = CONFIG.AI_REACT_MIN;
  }
  applySaved(); // 在 boot() 之前生效

  const D = { panel: null, visible: false, collapsed: false, fps: 0, fpsN: 0, fpsLast: performance.now(), lastInfo: 0 };   // v5.6 默认关闭，F1 打开
  let selWeapon = 'ar';
  let selGadget = 'rocket';
  let tpPopulated = false;
  const weaponRefreshers = [];
  const gadgetRefreshers = [];

  Game.godMode = Game.godMode || false;
  Game.infiniteAmmo = Game.infiniteAmmo || false;
  Game.timeScale = Game.timeScale || 1;

  const f0 = (v) => v.toFixed(0), f2 = (v) => v.toFixed(2), f3 = (v) => v.toFixed(3), f4 = (v) => v.toFixed(4);

  // ---------- 可调项定义 ----------
  // type: cfg → CONFIG[key]；veh → VEHICLES[vehicle.field]；weapon → 选枪 WEAPONS[sel][field]
  const SECTIONS = [
    { title: 'AI 难度', type: 'cfg', items: [
      ['aim-min', '误差下限', 'AI_AIM_ERROR_MIN', 0, 0.3, 0.01, f2],
      ['aim-max', '误差上限', 'AI_AIM_ERROR_MAX', 0, 0.4, 0.01, f2],
      ['lock', '锁定时间', 'AI_LOCK_TIME', 0.2, 3, 0.1, f2],
      ['react', '反应延迟', 'AI_REACT_MIN', 0, 1.5, 0.05, f2],
      ['fire', '开火概率', 'AI_FIRE_CHANCE', 0, 1, 0.05, f2],
      ['range', '交战距离', 'AI_ENGAGE_RANGE', 10, 150, 5, f0],
      ['grace', '开火宽限', 'AI_GRACE_TIME', 0, 3, 0.1, f2],
      ['maxshoot', '同目标上限', 'COMBAT_MAX_SHOOTERS_PER_TARGET', 1, 5, 1, f0],
    ]},
    { title: '枪械调参（选枪）', type: 'weapon', items: [
      ['w-dmg', '伤害', 'damage', 1, 120, 1, f0],
      ['w-rate', '射速(秒)', 'rate', 0.03, 1.5, 0.005, f3],
      ['w-recoil', '后坐pitch', 'recoilDef.pitch', 0, 0.15, 0.001, f3],
      ['w-recoilyaw', '后坐yaw', 'recoilDef.yaw', 0, 0.05, 0.001, f3],
      ['w-bloom', '扩散峰值°', 'spreadMax', 0, 8, 0.1, f2],
      ['w-bps', '每发扩散°', 'spreadPerShot', 0, 2, 0.01, f2],
      ['w-hip', '腰射扩散°', 'spreadHip', 0, 5, 0.05, f2],
      ['w-adsfov', '开镜FOV', 'adsFov', 10, 70, 1, f0],
      ['w-adssens', '开镜灵敏度', 'adsSens', 0.2, 2, 0.05, f2],
      ['w-dropoff', '距离衰减', 'dropoff', 0, 0.8, 0.01, f2],
      ['w-range', '射程', 'range', 20, 500, 5, f0],
      ['w-mag', '弹匣容量', 'mag', 1, 200, 1, f0],
    ]},
    { title: '玩家', type: 'cfg', items: [
      ['walk', '步行速度', 'WALK_SPEED', 1, 15, 0.1, f2],
      ['sprint', '冲刺速度', 'SPRINT_SPEED', 1, 20, 0.1, f2],
      ['jump', '跳跃力', 'JUMP_VEL', 1, 20, 0.1, f2],
      ['adssens', '开镜灵敏度', 'ADS_SENS', 0.2, 2, 0.05, f2],
    ]},
    { title: '界面', type: 'map', items: [
      ['mapsize', '小地图大小(K)', 'minimapSize', 120, 320, 10, f0],
    ]},
    { title: '生存 / 治疗', type: 'cfg', items: [
      ['shield', '突击兵护盾', 'ASSAULT_SHIELD', 0, 300, 10, f0],
      ['shielddrain', '护盾消耗率', 'SHIELD_DRAIN_RATE', 1, 4, 0.5, f2],
      ['regend', '回血延迟(秒)', 'MEDIC_REGEN_DELAY', 0, 20, 1, f0],
      ['regenr', '回血速度(HP/s)', 'MEDIC_REGEN_RATE', 0, 12, 1, f0],
    ]},
    { title: '装备（选装备）', type: 'gadget', items: [
      ['g-speed', '弹速', 'speed', 5, 200, 1, f0],
      ['g-grav', '重力', 'gravity', 0, 30, 1, f0],
      ['g-radius', '溅射半径', 'radius', 1, 20, 0.5, f2],
      ['g-dmg', '伤害', 'damage', 10, 600, 10, f0],
      ['g-reload', '装填(秒)', 'reload', 0, 30, 0.5, f2],
      ['g-min', '最小射程', 'minRange', 10, 120, 5, f0],
      ['g-max', '最大射程', 'maxRange', 60, 300, 10, f0],
      ['g-heal', '治疗量', 'healAmount', 5, 100, 5, f0],
      ['g-ammo', '备弹', 'ammo', -1, 12, 1, f0],
    ]},
    { title: '载具', type: 'veh', items: [
      ['tank-hp', '坦克血量', 'tank.hp', 200, 2500, 50, f0],
      ['tank-spd', '坦克速度', 'tank.speed', 4, 25, 1, f0],
      ['tank-dmg', '坦克炮弹伤害', 'tank.shellDamage', 50, 800, 10, f0],
      ['tank-rad', '坦克溅射半径', 'tank.shellRadius', 4, 25, 0.5, f2],
      ['tank-mgdmg', '坦克机枪伤害', 'tank.mgDamage', 5, 60, 1, f0],
      ['tank-mgspread', '坦克机枪扩散', 'tank.mgSpread', 0.005, 0.1, 0.002, f3],
      ['apc-hp', '装甲车血量', 'apc.hp', 150, 1800, 50, f0],
      ['apc-spd', '装甲车速度', 'apc.speed', 6, 30, 1, f0],
      ['apc-mgdmg', '装甲车机枪伤害', 'apc.mgDamage', 5, 80, 1, f0],
      ['aa-hp', '防空车血量', 'aa.hp', 150, 1800, 50, f0],
      ['aa-dmg', '高炮伤害', 'aa.cannonDamage', 5, 80, 1, f0],
      ['heli-hp', '直升机血量', 'heli.hp', 150, 2000, 50, f0],
      ['heli-spd', '直升机速度', 'heli.speed', 10, 50, 2, f0],
      ['heli-dmg', '直升机火箭伤害', 'heli.rocketDamage', 20, 400, 5, f0],
      ['heli-cannon', '直升机机炮伤害', 'heli.cannonDamage', 5, 80, 1, f0],
    ]},
  ];

  // ---------- 样式 ----------
  function injectStyle() {
    const css = [
      '#debug-panel{position:fixed;top:10px;right:10px;z-index:1000;width:278px;',
      'background:rgba(16,18,24,0.94);color:#d6dbe6;border:1px solid #3a4150;border-radius:8px;',
      'font:12px/1.55 system-ui,sans-serif;user-select:none;box-shadow:0 4px 20px rgba(0,0,0,0.55);}',
      '#debug-panel.hidden{display:none;}',
      '#debug-panel .dbg-head{padding:8px 11px;background:#22272f;border-radius:8px 8px 0 0;',
      'cursor:pointer;font-weight:700;display:flex;justify-content:space-between;align-items:center;}',
      '#debug-panel .dbg-head .mini{color:#77808f;font-weight:400;font-size:11px;}',
      '#debug-panel .dbg-body{padding:6px 11px 11px;max-height:calc(100vh - 56px);overflow-y:auto;}',
      '#debug-panel .dbg-body.collapsed{display:none;}',
      '#debug-panel h4{margin:11px 0 5px;color:#7ea8ff;font-size:12px;border-bottom:1px solid #333b49;padding-bottom:2px;}',
      '#debug-panel label{display:flex;align-items:center;margin:3px 0;}',
      '#debug-panel label .lb{width:88px;color:#9aa3b5;flex:none;}',
      '#debug-panel input[type=range]{flex:1;min-width:0;accent-color:#4d8dff;}',
      '#debug-panel .v{width:48px;text-align:right;color:#ffc96b;font-family:ui-monospace,monospace;font-size:11px;flex:none;}',
      '#debug-panel button{padding:3px 10px;margin:2px 3px 2px 0;background:#2e3542;color:#d6dbe6;',
      'border:1px solid #485061;border-radius:5px;cursor:pointer;font-size:12px;}',
      '#debug-panel button:hover{background:#3b4453;}',
      '#debug-panel button.on{background:#1c6b3c;border-color:#2f9d5c;}',
      '#debug-panel button.danger{background:#5c2424;border-color:#9c3b3b;}',
      '#debug-panel select{padding:2px 4px;background:#2e3542;color:#d6dbe6;border:1px solid #485061;border-radius:5px;}',
      '#debug-panel .row{margin:3px 0;}',
      '#debug-panel #dbg-info{font-family:ui-monospace,monospace;font-size:11px;color:#8fe6b0;white-space:pre-wrap;line-height:1.5;}',
      '#dbg-toast{position:fixed;right:14px;bottom:36px;z-index:1001;font:12px system-ui,sans-serif;color:#fff;',
      'background:rgba(20,80,40,0.92);padding:4px 10px;border-radius:5px;opacity:0;transition:opacity 0.3s;}',
    ].join('\n');
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------- 工具 ----------
  function $(s) { return D.panel.querySelector(s); }
  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('dbg-toast');
    if (!t) { t = document.createElement('div'); t.id = 'dbg-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1400);
  }

  function sliderRow(id, label, min, max, step) {
    return '<label><span class="lb">' + label + '</span><input id="dbg-' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '"><span class="v" id="dbg-' + id + '-v"></span></label>';
  }

  // 通用滑块（CONFIG / VEHICLES）
  function bindCfg(id, key, get, set, fmt) {
    const sl = $('#' + id), val = $('#' + id + '-v');
    const refresh = () => { const v = get(); sl.value = v; val.textContent = fmt(v); };
    sl.addEventListener('input', () => { const v = parseFloat(sl.value); set(v); val.textContent = fmt(v); });
    sl.addEventListener('change', () => { persist(key, parseFloat(sl.value)); toast('已保存 · ' + key); });
    refresh();
  }

  // 装备滑块（跟随选装备，持久化 gadget.<装备>.<字段>；字段不存在时禁用滑块）
  function bindGadget(id, field, fmt) {
    const sl = $('#' + id), val = $('#' + id + '-v');
    const get = () => GADGETS[selGadget] ? GADGETS[selGadget][field] : undefined;
    const set = (x) => { if (GADGETS[selGadget]) GADGETS[selGadget][field] = x; };
    const refresh = () => {
      const v = get();
      if (v === undefined) { sl.disabled = true; val.textContent = '—'; return; }
      sl.disabled = false; sl.value = v; val.textContent = fmt(v);
    };
    sl.addEventListener('input', () => { const v = parseFloat(sl.value); set(v); val.textContent = fmt(v); });
    sl.addEventListener('change', () => { persist('gadget.' + selGadget + '.' + field, parseFloat(sl.value)); toast('已保存 · ' + selGadget + '.' + field); });
    gadgetRefreshers.push(refresh);
    refresh();
  }

  // 武器滑块（跟随选枪，持久化 weapon.<枪>.<字段>，支持嵌套路径）
  function bindWeapon(id, field, fmt) {
    const sl = $('#' + id), val = $('#' + id + '-v');
    const get = () => { const parts = field.split('.'); let v = WEAPONS[selWeapon]; for (const p of parts) v = v[p]; return v; };
    const set = (x) => { const parts = field.split('.'); let v = WEAPONS[selWeapon]; for (let i = 0; i < parts.length - 1; i++) v = v[parts[i]]; v[parts[parts.length - 1]] = x; };
    const refresh = () => { const v = get(); sl.value = v; val.textContent = fmt(v); };
    sl.addEventListener('input', () => { const v = parseFloat(sl.value); set(v); val.textContent = fmt(v); });
    sl.addEventListener('change', () => { persist('weapon.' + selWeapon + '.' + field, parseFloat(sl.value)); toast('已保存 · ' + selWeapon + '.' + field); });
    weaponRefreshers.push(refresh);
    refresh();
  }

  function bindButton(id, onClick) { $(id).addEventListener('click', onClick); }

  // 小地图大小滑块（写 Game.hud.minimapSize + 实时重设画布尺寸）
  function bindMapSlider(id, field, fmt) {
    const sl = $('#' + id), val = $('#' + id + '-v');
    const refresh = () => { const v = (Game.hud && Game.hud[field]) || 190; sl.value = v; val.textContent = fmt(v); };
    sl.addEventListener('input', () => { const v = parseFloat(sl.value); if (Game.hud && Game.hud.setMinimapSize) Game.hud.setMinimapSize(v, true); val.textContent = fmt(v); });
    sl.addEventListener('change', () => { toast('小地图大小 ' + sl.value + 'px'); });
    refresh();
  }

  // ---------- 构建面板 ----------
  function build() {
    injectStyle();

    let html = '<div class="dbg-head"><span>调试面板</span><span class="mini">F1 开关 · 参数自动保存</span></div><div class="dbg-body">';
    for (const sec of SECTIONS) {
      html += '<h4>' + sec.title + '</h4>';
      if (sec.type === 'gadget') {
        html += '<div class="row"><select id="dbg-gadget">' +
          '<option value="grenadeLauncher">下挂榴弹</option>' +
          '<option value="rocket" selected>RPG-7 火箭筒</option>' +
          '<option value="mortar">60mm 迫击炮</option>' +
          '<option value="medkit">医疗箱</option>' +
          '<option value="ammo">弹药箱</option>' +
          '<option value="flare">侦察信号弹</option>' +
          '</select></div>';
      }
      if (sec.type === 'weapon') {
        html += '<div class="row"><select id="dbg-weapon">' +
          '<option value="ar">AR-40 步枪</option>' +
          '<option value="lmg">MG-80 重机枪</option>' +
          '<option value="smg">SMG-9 冲锋枪</option>' +
          '<option value="pistol">P-45 手枪</option>' +
          '<option value="sniper">SR-50 狙击</option>' +
          '<option value="shotgun">SG-12 霰弹枪</option>' +
          '<option value="aa12">AA-12 连喷</option>' +
          '<option value="dmr">MK-14 DMR</option>' +
          '</select></div>';
      }
      for (const it of sec.items) {
        html += sliderRow(it[0], it[1], it[3], it[4], it[5]);
      }
    }
    html += '<h4>玩家操作</h4><div class="row">' +
      '<button id="dbg-god">无敌</button><button id="dbg-ammo">无限弹药</button><button id="dbg-heal">回血</button>' +
      '</div><div class="row"><label><span class="lb">传送</span><select id="dbg-tp"><option value="">— 选择位置 —</option></select></label></div>';
    html += '<h4>世界</h4><div class="row">' +
      '<button id="dbg-spawn">复活敌方AI</button><button id="dbg-slow">慢动作</button><button id="dbg-shadow">阴影</button>' +
      '</div><div class="row"><button id="dbg-crosshair">红点准星</button></div>';
    html += '<h4>参数</h4><div class="row">' +
      '<button id="dbg-reset" class="danger">重置全部参数</button>' +
      '</div>';
    html += '<h4>信息</h4><div id="dbg-info"></div></div>';

    const div = document.createElement('div');
    div.id = 'debug-panel';
    div.innerHTML = html;
    div.classList.toggle('hidden', !D.visible);   // v5.6 默认关闭
    document.body.appendChild(div);
    D.panel = div;

    // 绑定滑块
    for (const sec of SECTIONS) {
      for (const it of sec.items) {
        const id = 'dbg-' + it[0];
        const key = it[2];
        if (sec.type === 'weapon') {
          bindWeapon(id, key, it[6]);
        } else if (sec.type === 'gadget') {
          bindGadget(id, key, it[6]);
        } else if (sec.type === 'veh') {
          const [vk, field] = key.split('.');
          bindCfg(id, 'veh.' + key, () => VEHICLES[vk][field], (v) => { VEHICLES[vk][field] = v; }, it[6]);
        } else if (sec.type === 'map') {
          bindMapSlider(id, key, it[6]);
        } else {
          // cfg；反应延迟特殊处理（同时设 MIN/MAX）
          if (key === 'AI_REACT_MIN') {
            bindCfg(id, key, () => CONFIG.AI_REACT_MIN, (v) => { CONFIG.AI_REACT_MIN = CONFIG.AI_REACT_MAX = v; }, it[6]);
          } else {
            bindCfg(id, key, () => CONFIG[key], (v) => { CONFIG[key] = v; }, it[6]);
          }
        }
      }
    }

    // 选枪 / 选装备
    $('#dbg-weapon').addEventListener('change', (e) => { selWeapon = e.target.value; weaponRefreshers.forEach((r) => r()); });
    $('#dbg-gadget').addEventListener('change', (e) => { selGadget = e.target.value; gadgetRefreshers.forEach((r) => r()); });

    // 玩家操作
    bindButton('#dbg-god', () => { Game.godMode = !Game.godMode; $('#dbg-god').classList.toggle('on', Game.godMode); toast(Game.godMode ? '无敌：开' : '无敌：关'); });
    bindButton('#dbg-ammo', () => { Game.infiniteAmmo = !Game.infiniteAmmo; $('#dbg-ammo').classList.toggle('on', Game.infiniteAmmo); toast(Game.infiniteAmmo ? '无限弹药：开' : '无限弹药：关'); });
    bindButton('#dbg-heal', () => { const p = Game.player; if (p && p.alive) { p.health = p.maxHealth; toast('已回满血'); } else toast('玩家已阵亡'); });

    // 传送（懒加载）
    const tp = $('#dbg-tp');
    tp.addEventListener('change', () => {
      const p = Game.player;
      if (!p || !p.alive) { toast('玩家未存活'); tp.value = ''; return; }
      const v = tp.value; let x, z;
      if (v[0] === 'f') { const f = Game.flags[parseInt(v.slice(1))]; x = f.x; z = f.z; }
      else if (v[0] === 'b') { const b = BASE_DEFS[parseInt(v.slice(1))]; x = b.x; z = b.z; }
      if (x !== undefined) { p.pos.x = x; p.pos.z = z; p.pos.y = Game.heightAt(x, z); p.vel = { x: 0, y: 0, z: 0 }; toast('已传送'); }
      tp.value = '';
    });

    // 世界
    bindButton('#dbg-spawn', () => { let n = 0; for (const s of Game.bots) { if (!s.alive) { Game.ai.respawn(s); n++; } } toast(n ? '已复活 ' + n + ' 个敌方 AI' : '敌方 AI 全部存活'); });
    bindButton('#dbg-slow', () => { Game.timeScale = (Game.timeScale === 1 ? 0.3 : 1); $('#dbg-slow').classList.toggle('on', Game.timeScale !== 1); toast(Game.timeScale === 1 ? '慢动作：关' : '慢动作：0.3×'); });
    bindButton('#dbg-shadow', () => { CONFIG.SHADOWS = !CONFIG.SHADOWS; if (Game.renderer) Game.renderer.shadowMap.enabled = CONFIG.SHADOWS; $('#dbg-shadow').classList.toggle('on', CONFIG.SHADOWS); toast(CONFIG.SHADOWS ? '阴影：开' : '阴影：关'); });
    bindButton('#dbg-crosshair', () => { CONFIG.CROSSHAIR = !CONFIG.CROSSHAIR; $('#dbg-crosshair').classList.toggle('on', CONFIG.CROSSHAIR); toast(CONFIG.CROSSHAIR ? '红点准星：开（测试）' : '红点准星：关'); });

    // 重置
    bindButton('#dbg-reset', () => { try { localStorage.removeItem(STORE_KEY); } catch (e) {} location.reload(); });

    // 折叠
    $('.dbg-head').addEventListener('click', () => { D.collapsed = !D.collapsed; $('.dbg-body').classList.toggle('collapsed', D.collapsed); });
  }

  // ---------- 开关 ----------
  function toggle() {
    D.visible = !D.visible;
    D.panel.classList.toggle('hidden', !D.visible);
    if (D.visible && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    // v5.10 关闭面板自动回到战斗（重新锁定鼠标，省得手动 Esc）
    else if (!D.visible && Game.running && Game.player && Game.player.alive && Game.phase === 'playing' && Game.Player && Game.Player.requestLock) {
      Game.Player.requestLock();
    }
  }

  // ---------- 信息 + 无限弹药 ----------
  function populateTeleport() {
    if (tpPopulated || !Game.flags || !Game.flags.length) return;
    const tp = document.getElementById('dbg-tp');
    if (!tp) return;
    Game.flags.forEach((f, i) => { const o = document.createElement('option'); o.value = 'f' + i; o.textContent = '占领点 ' + f.id; tp.appendChild(o); });
    BASE_DEFS.forEach((b, i) => { const o = document.createElement('option'); o.value = 'b' + i; o.textContent = (b.team === 0 ? '红' : '蓝') + '方基地'; tp.appendChild(o); });
    tpPopulated = true;
  }

  function updateInfo() {
    const p = Game.player;
    const alive = Game.soldiers.filter((s) => s.alive).length;
    const botAlive = Game.bots.filter((s) => s.alive).length;
    const flags = Game.flags.map((f) => f.id + ':' + (f.owner === 0 ? '红' : f.owner === 1 ? '蓝' : '中')).join(' ');
    const pos = p ? p.pos.x.toFixed(1) + ',' + p.pos.z.toFixed(1) : '—';
    const hp = p ? (p.alive ? p.health.toFixed(0) + '/' + p.maxHealth : '阵亡') : '—';
    const nSaved = Object.keys(SAVED).length;
    const inf = document.getElementById('dbg-info');
    if (inf) inf.textContent =
      'FPS ' + D.fps + '   慢动作 ' + (Game.timeScale === 1 ? '关' : Game.timeScale + '×') + '\n' +
      '位置 ' + pos + '   血量 ' + hp + '\n' +
      '存活 ' + alive + '/' + Game.soldiers.length + '（AI ' + botAlive + '）\n' +
      flags + '\n已保存参数 ' + nSaved + ' 项';
  }

  function loop(now) {
    requestAnimationFrame(loop);
    populateTeleport();
    D.fpsN++;
    if (now - D.fpsLast >= 1000) { D.fps = Math.round(D.fpsN * 1000 / (now - D.fpsLast)); D.fpsN = 0; D.fpsLast = now; }
    if (Game.infiniteAmmo && Game.player && Game.player.alive) {
      const p = Game.player;
      for (const k in p.slots) { const s = p.slots[k]; if (s) { s.mag = s.def.mag; s.reserve = s.def.reserve; } }
      p.gadgetAmmo = 99; p.grenades = 99;
    }
    if (now - D.lastInfo > 250) { D.lastInfo = now; if (D.visible && !D.collapsed) updateInfo(); }
  }

  // ---------- 启动 ----------
  document.addEventListener('keydown', (e) => { if (e.key === 'F1') { e.preventDefault(); toggle(); } });

  build();
  requestAnimationFrame(loop);
  Game.debug = { toggle };
  console.log('[debug] 调试面板已加载 · 已保存参数 ' + Object.keys(SAVED).length + ' 项 · F1 开关');
})();
