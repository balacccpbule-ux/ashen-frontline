// ============================================================
//  灰烬战线 · lang.js  —  多语言（简体中文 / English）
//  加载于 config.js 之后、其余模块之前
// ============================================================
(function () {
  'use strict';
  const G = window.Game;

  // 读取已保存语言（默认简体中文）
  let saved = 'zh';
  try { saved = localStorage.getItem('ashen_lang') || 'zh'; } catch (e) {}
  G.lang = (saved === 'en' || saved === 'zh') ? saved : 'zh';

  // ---- 界面文案字典（key → 简中 / English）----
  const STR = {
    zh: {
      'menu.title': '灰烬战线',
      'menu.subtitle': 'ASHEN FRONTLINE',
      'menu.desc': '16v16 大战场 · 双模式 · 三地图 · 六兵种 · 陆空载具 · 全域破坏',
      'menu.mode': '游戏模式',
      'menu.map': '战场地图',
      'menu.diff': 'AI 难度',
      'mode.conquest': '征服模式',
      'mode.conquest.desc': '占领旗帜 · 消耗敌军兵力',
      'mode.breakthrough': '突破模式',
      'mode.breakthrough.desc': '扇区推进 · 攻防拉锯',
      'map.name.desert': '沙暴行动',
      'map.name.snow': '雪域要塞',
      'map.name.fort': '钢铁防线',
      'map.desert.desc': '中东沙漠 · 油田',
      'map.snow.desc': '极地雪原 · 冰湖碉堡',
      'map.fort.desc': '要塞攻坚 · 为突破而生',
      'diff.easy': '简单',
      'diff.easy.desc': 'AI 反应慢 · 枪法差',
      'diff.normal': '普通',
      'diff.normal.desc': '均衡的反应与枪法',
      'diff.hard': '困难',
      'diff.hard.desc': 'AI 反应快 · 枪法准',
      'menu.start': '开始游戏',
      'menu.rank': '军衔',
      'menu.rank.points': '累计 {0} 分',
      'menu.rank.line': '军衔：{0}（累计 {1} 分）',
      'menu.controls.1': 'WASD 移动 · Shift 冲刺 · C 蹲 · 空格跳跃 · 鼠标射击',
      'menu.controls.2': 'R 换弹 · 1/2/3 切换武器 · G 手雷 · Q 标记敌人 · F 上下车 · Tab 计分板',
      'class.title': '选择兵种',
      'class.deploy': '部署',
      'hud.exit': '退出对局',
      'hud.exit.title': '退出对局，回主菜单重新选图',
      'hud.mortarHint': '点击地图选择落点 · 右键或 3 收起',
      'hud.reload': '换弹中…',
      'hud.spawnHint': '出生保护',
      'hud.pauseHint': '点击画面锁定鼠标 · Esc 释放 · Tab 计分板',
      'death.exit': '退出对局',
      'death.killer': '击杀者：{0}',
      'death.stats': '本局击杀 {0} · 阵亡 {1} · 分数 {2}',
      'end.victory': '胜 利',
      'end.defeat': '战 败',
      'end.score': '你的分数：{0}',
      'end.stats': '击杀 {0} · 阵亡 {1} · 最高连杀 {2}',
      'end.restart': '再来一局',
      'end.exit': '退出对局',
      'sb.title': '计分板',
      'sb.player': '玩家',
      'sb.kills': '击杀',
      'sb.deaths': '死亡',
      'sb.score': '分数',
      'sb.class': '兵种',
      'sb.you': '你',
      'sb.team.red': '赤焰',
      'sb.team.blue': '苍穹',
      'mode.tag.conquest': '征服',
      'mode.tag.bt.att': '突破·攻',
      'mode.tag.bt.def': '突破·守',
      'obj.capture': '占领点',
      'obj.sector': '扇区 {0}',
      'obj.attack': '进攻',
      'obj.defend': '防守',
      'cap.hold': '驻守占领点 {0}',
      'cap.capping': '正在占领 {0}',
      'cap.contested': '占领点 {0} · 争夺中',
      'cap.empty': '占领点 {0} · 空置',
      'spawn.base': '基地',
      'gadget.reload': '装填',
      'gadget.ready': '就绪',
      'gadget.grenades': '手雷',
      'weapon.semi': '单发',
      'veh.hint.heli': '空格 上升 · Shift 下降 · WASD 前后左右 · 鼠标转向 · 左键开火 · 右键开镜 · 1/2 切换武器 · V 视角 · F 下车',
      'veh.hint.aa': 'WASD 移动 · 鼠标瞄准（大仰角对空）· 左键高炮 · V 视角 · F 下车',
      'veh.hint.ground': 'WASD 移动 · 鼠标瞄准 · 左键开火 · 右键开镜 · 1/2 切换武器 · V 视角 · F 下车',
      'msg.deploy.conquest': '部署成功 · 征服模式 · 占领旗帜！',
      'msg.deploy.bt.att': '部署成功 · 突破模式 · 你是攻方——夺取扇区！',
      'msg.deploy.bt.def': '部署成功 · 突破模式 · 你是守方——守住防线！',
      'mortar.hit': '落点标定 · 炮弹飞行中（{0}m）',
      'mortar.tooClose': '超出最小射程 40m',
      'mortar.tooFar': '超出最大射程 180m',
      'mortar.noAmmo': '迫击炮弹药耗尽',
      'mortar.cooling': '装填中 {0}s',
      'merit.kill': '击杀',
      'merit.headshot': '爆头',
      'merit.defense': '防守击杀',
      'merit.attack': '进攻击杀',
      'merit.revenge': '复仇',
      'merit.streak': '连杀',
      'merit.assist': '助攻',
      'merit.suppress': '火力压制',
      'merit.spot': '标记',
      'merit.vehicle': '载具摧毁',
      'merit.ammo': '补给弹药',
      'merit.heal': '治疗',
      'merit.capture': '占领',
      'merit.multi': '多杀',
      'merit.repair': '维修',
      'flag.red': '赤',
      'flag.blue': '蓝',
      'epic.finalSector': '红军突破最后扇区！',
      'epic.break1': '红军突破「{0}」——防线崩塌！',
      'epic.break2': '「{0}」陷落！攻势如潮！',
      'epic.break3': '钢铁防线再失一环：「{0}」失守！',
      'epic.finalStand': '最终防线——死守堡垒！',
      'cap.ours.1': '我方占领 ',
      'cap.ours.2': '我们夺下了 ',
      'cap.ours.3': '阵地易手：我方控制 ',
      'cap.ours.4': '旗帜升起：我方占领 ',
      'cap.enemy': '敌方占领 {0}',
      'cap.neutral': '{0} 被夺回为中立',
      'death.battlefield': '战场',
      'streak.msg': '连杀 x{0}！',
      'multi.2': '双杀',
      'multi.3': '三杀',
      'multi.4': '四杀',
      'multi.5': '五杀',
      'multi.6': '六杀',
      'multi.7': '超神',
      'msg.vehicleDestroyed': '载具被摧毁！',
      'msg.smokeThrown': '烟雾弹投出',
      'msg.grenadeThrown': '手雷投出',
      'msg.gadgetEmpty': '装备弹药耗尽',
      'msg.ammoDeployed': '弹药箱已部署（持续补给，60 秒）',
      'msg.medkitDeployed': '医疗箱已部署（持续治疗，60 秒）',
      'msg.noTarget': '准星附近没有目标',
      'msg.spotBlocked': '视线被遮挡，无法标记',
      'msg.spotted': '敌军已被标记',
      'veh.kickTeammate': '已请队友下车',
      'veh.noVehicle': '附近没有可用的载具',
      'veh.enter': '进入 {0}（F 退出）',
      'veh.gunner': '坐上机枪位（鼠标开火 · F 下车）',
      'player.semiMode': '切换单发模式',
      'player.autoMode': '切换全自动',
      'player.thirdPerson': '第三人称视角',
      'player.firstPerson': '第一人称视角',
      'player.mortarDeploy': '迫击炮已部署 · 点击右下地图选择落点',
    },
    en: {
      'menu.title': 'ASHEN FRONTLINE',
      'menu.subtitle': 'ASHEN FRONTLINE',
      'menu.desc': '16v16 battlefield · 2 modes · 3 maps · 6 classes · land & air vehicles · full destruction',
      'menu.mode': 'GAME MODE',
      'menu.map': 'BATTLEFIELD MAP',
      'menu.diff': 'AI DIFFICULTY',
      'mode.conquest': 'Conquest',
      'mode.conquest.desc': 'Capture flags · drain enemy tickets',
      'mode.breakthrough': 'Breakthrough',
      'mode.breakthrough.desc': 'Sector push · attack & defend',
      'map.name.desert': 'Operation Sandstorm',
      'map.name.snow': 'Snow Fortress',
      'map.name.fort': 'Iron Line',
      'map.desert.desc': 'Middle-East desert · oil fields',
      'map.snow.desc': 'Polar tundra · frozen-lake bunkers',
      'map.fort.desc': 'Fortress assault · built for breakthrough',
      'diff.easy': 'Easy',
      'diff.easy.desc': 'Slow reactions · poor aim',
      'diff.normal': 'Normal',
      'diff.normal.desc': 'Balanced reactions and aim',
      'diff.hard': 'Hard',
      'diff.hard.desc': 'Fast reactions · sharp aim',
      'menu.start': 'START GAME',
      'menu.rank': 'RANK',
      'menu.rank.points': '{0} points total',
      'menu.rank.line': 'RANK: {0} ({1} pts)',
      'menu.controls.1': 'WASD move · Shift sprint · C crouch · Space jump · mouse to shoot',
      'menu.controls.2': 'R reload · 1/2/3 switch weapon · G grenade · Q spot enemy · F enter/exit · Tab scoreboard',
      'class.title': 'CHOOSE CLASS',
      'class.deploy': 'DEPLOY',
      'hud.exit': 'LEAVE MATCH',
      'hud.exit.title': 'Leave match, return to menu',
      'hud.mortarHint': 'Click map to aim · RMB or 3 to stow',
      'hud.reload': 'RELOADING…',
      'hud.spawnHint': 'SPAWN PROTECTION',
      'hud.pauseHint': 'Click to lock mouse · Esc to release · Tab scoreboard',
      'death.exit': 'LEAVE MATCH',
      'death.killer': 'Killed by: {0}',
      'death.stats': 'Kills {0} · Deaths {1} · Score {2}',
      'end.victory': 'VICTORY',
      'end.defeat': 'DEFEAT',
      'end.restart': 'PLAY AGAIN',
      'end.exit': 'LEAVE MATCH',
      'sb.title': 'SCOREBOARD',
      'sb.player': 'PLAYER',
      'sb.kills': 'KILLS',
      'sb.deaths': 'DEATHS',
      'sb.score': 'SCORE',
      'sb.class': 'CLASS',
      'sb.you': 'You',
      'sb.team.red': 'Crimson',
      'sb.team.blue': 'Azure',
      'mode.tag.conquest': 'CONQUEST',
      'mode.tag.bt.att': 'BREAKTHROUGH · ATK',
      'mode.tag.bt.def': 'BREAKTHROUGH · DEF',
      'obj.capture': 'OBJECTIVE',
      'obj.sector': 'SECTOR {0}',
      'obj.attack': 'ATTACK',
      'obj.defend': 'DEFEND',
      'cap.hold': 'Holding {0}',
      'cap.capping': 'Capturing {0}',
      'cap.contested': '{0} · contested',
      'cap.empty': '{0} · neutral',
      'spawn.base': 'Base',
      'gadget.reload': 'arming',
      'gadget.ready': 'ready',
      'gadget.grenades': 'grenades',
      'weapon.semi': 'semi',
      'veh.hint.heli': 'Space ascend · Shift descend · WASD move · mouse steer · LMB fire · RMB scope · 1/2 weapon · V view · F exit',
      'veh.hint.aa': 'WASD move · mouse aim (high angle vs air) · LMB cannon · V view · F exit',
      'veh.hint.ground': 'WASD move · mouse aim · LMB fire · RMB scope · 1/2 weapon · V view · F exit',
      'msg.deploy.conquest': 'Deployed · Conquest · Capture the flags!',
      'msg.deploy.bt.att': 'Deployed · Breakthrough · You are the ATTACKER — take the sectors!',
      'msg.deploy.bt.def': 'Deployed · Breakthrough · You are the DEFENDER — hold the line!',
      'mortar.hit': 'Round away · in flight ({0}m)',
      'mortar.tooClose': 'Below minimum range (40m)',
      'mortar.tooFar': 'Beyond maximum range (180m)',
      'mortar.noAmmo': 'Mortar out of ammo',
      'mortar.cooling': 'Arming {0}s',
      'merit.kill': 'Kill',
      'merit.headshot': 'Headshot',
      'merit.defense': 'Defense kill',
      'merit.attack': 'Attack kill',
      'merit.revenge': 'Revenge',
      'merit.streak': 'Streak',
      'merit.assist': 'Assist',
      'merit.suppress': 'Suppression',
      'merit.spot': 'Spot',
      'merit.vehicle': 'Vehicle destroyed',
      'merit.ammo': 'Ammo resupplied',
      'merit.heal': 'Heal',
      'merit.capture': 'Capture',
      'merit.multi': 'Multikill',
      'merit.repair': 'Repair',
      'flag.red': 'R',
      'flag.blue': 'B',
      'epic.finalSector': 'RED ARMY BREAKS THE FINAL SECTOR!',
      'epic.break1': 'Red Army breaks "{0}" — the line collapses!',
      'epic.break2': '"{0}" has fallen! The assault surges!',
      'epic.break3': 'The Iron Line loses another link: "{0}" is lost!',
      'epic.finalStand': 'FINAL DEFENSE — HOLD THE FORTRESS!',
      'cap.ours.1': 'We captured ',
      'cap.ours.2': 'We took ',
      'cap.ours.3': 'Position taken: we hold ',
      'cap.ours.4': 'Flag raised: we hold ',
      'cap.enemy': 'Enemy captured {0}',
      'cap.neutral': '{0} neutralized',
      'death.battlefield': 'Battlefield',
      'streak.msg': '{0}-kill streak!',
      'multi.2': 'Double Kill',
      'multi.3': 'Triple Kill',
      'multi.4': 'Quad Kill',
      'multi.5': 'Penta Kill',
      'multi.6': 'Hexa Kill',
      'multi.7': 'Legendary',
      'msg.vehicleDestroyed': 'Vehicle destroyed!',
      'msg.smokeThrown': 'Smoke thrown',
      'msg.grenadeThrown': 'Grenade thrown',
      'msg.gadgetEmpty': 'Gadget out of ammo',
      'msg.ammoDeployed': 'Ammo crate deployed (resupply, 60s)',
      'msg.medkitDeployed': 'Medkit deployed (healing, 60s)',
      'msg.noTarget': 'No target near crosshair',
      'msg.spotBlocked': 'Line of sight blocked, cannot spot',
      'msg.spotted': 'Enemy spotted',
      'veh.kickTeammate': 'Teammate asked to exit',
      'veh.noVehicle': 'No vehicle nearby',
      'veh.enter': 'Entered {0} (F to exit)',
      'veh.gunner': 'On the gunner seat (fire · F to exit)',
      'player.semiMode': 'Switched to semi-auto',
      'player.autoMode': 'Switched to full-auto',
      'player.thirdPerson': 'Third-person view',
      'player.firstPerson': 'First-person view',
      'player.mortarDeploy': 'Mortar deployed · click the map to aim',
    },
  };

  // ---- 名称翻译（config 对象 name/short/gadgetName/desc）----
  const EN = {
    name: {
      '赤焰先锋': 'Crimson Vanguard', '苍穹守卫': 'Azure Guard',
      '赤焰': 'Crimson', '苍穹': 'Azure',
      '突击兵': 'Assault', '支援兵': 'Support', '侦察兵': 'Recon',
      '工程兵': 'Engineer', '迫击炮兵': 'Mortarman', '医疗兵': 'Medic',
      '下挂榴弹': 'Underbarrel GL', '弹药箱': 'Ammo Crate', '侦察信号弹': 'Spotting Flare',
      '火箭筒': 'Rocket Launcher', '迫击炮': 'Mortar', '医疗箱': 'Medkit',
      'AR-40 自动步枪': 'AR-40 Rifle', 'MG-80 重机枪': 'MG-80 LMG',
      'SR-50 栓动狙击枪': 'SR-50 Sniper', 'SMG-9 冲锋枪': 'SMG-9',
      'P-45 手枪': 'P-45 Pistol', 'SG-12 霰弹枪': 'SG-12 Shotgun',
      'AA-12 全自动霰弹枪': 'AA-12 Shotgun', 'MK-14 精确射手步枪': 'MK-14 DMR',
      'RPG-7 火箭筒': 'RPG-7', '60mm 迫击炮': '60mm Mortar',
      'M67 破片手雷': 'M67 Frag Grenade', 'M18 烟雾弹': 'M18 Smoke Grenade',
      '主战坦克': 'Main Battle Tank', '装甲运兵车': 'APC',
      '防空炮车': 'Anti-Air Gun', '武装直升机': 'Attack Helicopter',
      '沙暴行动': 'Operation Sandstorm',
      '钢铁防线': 'Iron Line', '雪域要塞': 'Snow Fortress',
      '中央广场': 'Central Plaza', '西区车站': 'West Station', '东区码头': 'East Docks',
      '绿洲水站': 'Oasis Station', '西侧油田': 'West Oil Field', '东侧油井': 'East Oil Well',
      '山脊观察站': 'Ridge Outpost', '西线堑壕': 'West Trenches', '中央油库': 'Central Oil Depot',
      '东侧堡垒': 'East Fort', '北岭哨塔': 'North Ridge Tower',
      '冰湖哨站': 'Ice Lake Outpost', '西线碉堡': 'West Bunker', '东线碉堡': 'East Bunker',
      '山地雷达站': 'Mountain Radar', '钢铁堡垒': 'Steel Fortress', '要塞大门': 'Fortress Gate',
      '西郊哨站': 'West Outpost', '中央街区': 'Central District', '东岸指挥所': 'East Bank HQ',
      '沙丘前线': 'Dune Front', '油田腹地': 'Oilfield Heartland', '绿洲要塞': 'Oasis Fortress',
      '冰川前线': 'Glacier Front', '雪林腹地': 'Snowwood Heartland',
      '列兵': 'Private', '上等兵': 'PFC', '下士': 'Corporal', '中士': 'Sergeant',
      '上士': 'Staff Sgt', '少尉': '2nd Lt', '中尉': '1st Lt', '上尉': 'Captain',
      '少校': 'Major', '中校': 'Lt Col', '上校': 'Colonel', '少将': 'Maj Gen',
      '中将': 'Lt Gen', '上将': 'General', '元帅': 'Marshal',
      '简单': 'Easy', '普通': 'Normal', '困难': 'Hard',
      '猎鹰': 'Falcon', '夜枭': 'Night Owl', '铁砧': 'Anvil', '霜刃': 'Frostblade',
      '灰狼': 'Grey Wolf', '渡鸦': 'Raven', '山魈': 'Macaque', '火狐': 'Firefox',
      '磐石': 'Boulder', '利齿': 'Fang', '白鼬': 'Stoat', '黑豹': 'Panther',
      '疾风': 'Gale', '惊雷': 'Thunder', '毒蛇': 'Viper', '孤星': 'Lone Star',
      '破晓': 'Dawn', '凛冬': 'Winter', '赤狐': 'Red Fox', '苍鹭': 'Heron',
    },
    desc: {
      '自动步枪 + 下挂榴弹发射器，正面突破': 'Assault rifle + underbarrel grenade launcher, frontal breakthrough',
      '重机枪火力压制，部署弹药箱补给队友': 'LMG suppression, deploys ammo crates for teammates',
      '栓动狙击远距猎杀，信号弹标记敌军': 'Bolt-action sniper for long-range kills, flare to spot enemies',
      '冲锋枪近战 + 火箭筒反载具，可维修载具（按住 E）+ 烟雾弹掩护（H）': 'SMG + rocket launcher vs vehicles, repairs vehicles (hold E) + smoke cover (H)',
      'MK-14 精确射手步枪自卫 + 60mm 迫击炮曲射压制（40-180m 高抛弹道）': 'MK-14 DMR for self-defense + 60mm mortar for indirect fire (40-180m)',
      'AA-12 全自动霰弹枪近战自卫 + 医疗箱治疗队友 + 呼吸回血（无救援，阵亡立即重生）': 'AA-12 auto shotgun + medkit to heal teammates + passive regen',
      'AI 反应慢、枪法差，适合熟悉战场': 'Slow reactions and poor aim — good for learning',
      '均衡的 AI 反应与枪法': 'Balanced AI reactions and aim',
      'AI 反应快、枪法准，老兵挑战': 'Fast reactions and sharp aim — a veteran challenge',
    },
  };

  G.STR = STR;
  G.EN = EN;

  // 取文案
  G.t = function (key) {
    let s = (STR[G.lang] && STR[G.lang][key]);
    if (s == null) s = STR.zh[key];
    if (s == null) return key;
    for (let i = 1; i < arguments.length; i++) {
      s = s.split('{' + (i - 1) + '}').join(String(arguments[i]));
    }
    return s;
  };

  // 翻译一个裸中文字符串（bot 呼号等）
  G.tn = function (zh) {
    if (G.lang === 'en' && EN.name[zh] != null) return EN.name[zh];
    return zh;
  };

  // 取 config 对象本地化字段（name / desc / short / gadgetName）
  G.L = function (obj, field) {
    if (!obj) return '';
    field = field || 'name';
    const v = obj[field];
    if (G.lang === 'en' && v != null) {
      const map = EN[field === 'desc' ? 'desc' : 'name'];
      if (map && map[v] != null) return map[v];
    }
    return v == null ? '' : v;
  };

  // 切换语言
  G.setLang = function (code) {
    if (code !== 'zh' && code !== 'en') return;
    G.lang = code;
    try { localStorage.setItem('ashen_lang', code); } catch (e) {}
    G.applyLang();
  };

  // 应用语言到静态 DOM + 高亮语言按钮 + 让 HUD 重建动态文案
  G.applyLang = function () {
    document.documentElement.lang = (G.lang === 'en') ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = G.t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.title = G.t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.classList.toggle('selected', b.getAttribute('data-lang') === G.lang);
    });
    if (G.hud && G.hud.applyLang) G.hud.applyLang();
  };
})();
