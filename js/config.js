// ============================================================
//  灰烬战线 ASHEN FRONTLINE  ·  config.js
//  全局命名空间 + 全部调参入口
// ============================================================

// 全局共享命名空间（各模块挂载于此，经典 script 加载，无 ES module）
window.Game = {
  // --- 运行时状态（main.js 初始化） ---
  scene: null, renderer: null, camera: null, clock: null,
  running: false,      // 战斗中（进入主循环后为 true）
  started: false,      // 已点击开始
  over: false,         // 本局结束
  paused: false,
  time: 0,             // 本局累计秒数
  frame: 0,
  winner: -1,

  // --- 实体容器 ---
  player: null,        // 玩家士兵对象（与 bot 同构）
  soldiers: [],        // 全体士兵（含玩家 + 机器人）
  bots: [],
  vehicles: [],        // 载具
  flags: [],           // 占领点
  buildings: [],       // 坚固建筑（AABB，不可毁）
  destructibles: [],   // 可破坏物（油桶/沙袋/木箱/简易房）
  shells: [],          // 飞行中的炮弹/火箭/榴弹
  projectiles: [],
  spotMarks: [],       // 侦察标记

  // --- 特效 / 音频 ---
  effects: null,
  tracers: [],
  audio: null,
  killfeed: [],
  shake: 0,

  // --- 其他 ---
  rng: null,
  score: 0,
  stats: { kills: 0, deaths: 0, captures: 0, bestStreak: 0 },
  streak: 0,
  weaponView: null,    // 第一人称 viewmodel
};

// ============================================================
//  全局调参（游戏平衡）
// ============================================================
const CONFIG = {
  WORLD: 120,                 // v5.39 地图半径（x/z ∈ [-WORLD, WORLD]）——拉长纵深 160→240m
  TICKETS: 800,               // 征服模式双方初始兵力（v5.44 24v24 拉长战局）
  BOT_COUNT_PER_TEAM: 23,     // 24v24：红军 23 BOT + 玩家 = 24；蓝军 24 BOT → 共 48 人
  CAPTURE_SPEED: 34,          // 占领点 control 变化速率 / 秒
  BLEED_PER_FLAG: 0.55,       // 每多占 1 点，每秒消耗兵力
  BLEED_PER_DEATH: 1,         // 每次阵亡扣兵力
  MATCH_TIME_LIMIT: 900,      // 征服单局时长上限（秒），到时兵力多者胜

  // 突破模式
  BT_ATK_TICKETS: 400,        // 攻方（红）票数预算
  BT_DEF_TICKETS: 250,        // 守方（蓝）票数
  BT_SECTOR_BONUS: 120,       // 每攻下一扇区补票
  BT_TIME_LIMIT: 1200,        // 守满时间即守方胜

  // 64 人规模性能（AI 降频 + 空间哈希）
  AI_TICK_NEAR: 0.033,        // 距玩家 <30m 全频
  AI_TICK_MID: 0.066,         // 30-80m
  AI_TICK_FAR: 0.16,          // >80m
  AI_LOS_NEAR: 0.15,          // LOS 刷新间隔（近/远）
  AI_LOS_FAR: 0.5,
  GRID_CELL: 12,              // 空间哈希网格边长
  SOLDIER_CULL_DIST: 260,     // 士兵渲染剔除距离
  SOLDIER_LOD_DIST: 120,      // 士兵 LOD 切换距离：> 此距离换低模实例化网格

  GRAVITY: 30,
  FALL_DMG_THRESHOLD: 8,      // 坠落伤害阈值：下落距离超过此米数开始掉血
  FALL_DMG_PER_M: 9,          // 每超过 1 米造成的伤害
  WALK_SPEED: 6.0,
  SPRINT_SPEED: 9.2,
  CROUCH_SPEED: 3.0,
  JUMP_VEL: 8.8,
  EYE_HEIGHT: 1.68,
  CROUCH_EYE: 1.05,
  PLAYER_RADIUS: 0.42,
  SOLDIER_HEIGHT: 1.8,

  FOG_NEAR: 45,
  FOG_FAR: 150,
  SKY: 0x87a8c0,              // 灰蓝天空（灰烬氛围）
  SUN: 0xfff2d8,

  SPAWN_PROTECT: 3.0,         // 出生无敌秒数
  RESPAWN_TIME: 2.0,
  CROSSHAIR: true,             // v5.46 红点准星开关（测试用，未来取消）
  FIRE_DIST_MIN: 25,          // AI 开火距离内

  // v5.10 突击兵护盾（120 点，等效 60 血；无法补充，重生重置）
  ASSAULT_SHIELD: 120,        // 突击兵护盾点数
  SHIELD_DRAIN_RATE: 2,       // 每 1 点伤害消耗 2 点护盾（120 护盾 ≈ 60 血）
  // v5.10 医疗兵呼吸回血
  MEDIC_REGEN_DELAY: 5,       // 脱战多少秒后开始回血
  MEDIC_REGEN_RATE: 4,        // 回血速度（HP/秒）

  // 小地图 / 侦察
  MINIMAP_SIZE: 190,
  SPOTTED_TIME: 4.0,          // 开枪暴露时间
  SPOT_RADIUS: 38,            // 侦察半径
  FLARE_SPOT_TIME: 8.0,       // 侦察信号弹标记时长
  SPOT_TIME: 8.0,             // v5.12 Q 键标记持续时间
  SPOT_RANGE: 300,            // 标记最远距离
  SPOT_ANGLE: 3.5,            // 准星锥角（度，含高度差的宽容范围）
  SPOT_COOLDOWN: 1.5,         // 标记冷却
  SPOT_SCORE: 25,             // 标记得分
  MORTAR_REVEAL_TIME: 8,      // v5.16 反炮击预警：队友被敌方迫击炮命中后，小地图高亮敌方迫击炮手的时长

  // 画质 / 音频
  SHADOWS: true,              // 实时阴影
  SHADOW_SIZE: 1024,          // 阴影贴图分辨率
  AUDIO_RANGE: 140,           // 音效距离衰减范围（米）
  CAPTURE_RADIUS: 14,         // 占领点半径

  // AI 难度（v5 调优：v4 战斗烈度不足——30 秒 64 人战场仅 25 人次阵亡，交火太怂）
  AI_AIM_ERROR_MIN: 0.09,     // 瞄准误差下限（rad）
  AI_AIM_ERROR_MAX: 0.20,     // 瞄准误差上限（rad）
  AI_LOCK_TIME: 1.6,          // 索敌后误差收敛时间（秒）
  AI_FIRE_CHANCE: 0.42,       // 交火时每帧开火概率（v4 为 0.3，烈度不足）
  AI_ENGAGE_RANGE: 85,        // 索敌交战距离（v4 为 70）
  AI_REACT_MIN: 0.32,         // 首次索敌反应延迟下限（秒，v4 为 0.4）
  AI_REACT_MAX: 0.32,         // 首次索敌反应延迟上限（秒，v4 为 0.4）

  // 战斗导演（参考 ironhold combat director）：公平性/协同
  AI_GRACE_TIME: 0.65,        // 索敌后开火宽限（秒）：先机动/瞄准，不立即开火（v4 为 0.8）
  COMBAT_MAX_SHOOTERS_PER_TARGET: 2, // 同一目标最多同时开火的敌人数（其余照常机动）
  SWEEP_MIN_ALIVE: 3,         // 每方存活 AI ≤ 此数时启动残局清扫（防躲猫猫）
  SWEEP_INTERVAL: 6,          // 残局清扫周期（秒）
  SWEEP_HUNT_TIME: 9,         // 清扫时追踪敌人最后位置时长（秒）

  // 武器手感（参考 Claude-of-Duty）
  SPREAD_MODS: { crouch: 0.78, still: 0.82, walking: 1.15, sprinting: 2.2, airborne: 2.0 },
  BODY_PARTS: { head: 2.0, torso: 1.0, legs: 0.75 },   // 部位伤害倍率（高度带）
  RECOIL_FREQ: 9,             // v5.20 后坐弹簧频率（Hz）——降低：回位更慢、弹跳更可读
  RECOIL_DAMPING: 0.55,       // 后坐弹簧阻尼
  RECOIL_SHARE: 0.45,         // v5.41 慢残差占比——提高：连射枪口持续上抬（增强后座、减轻补偿）
  RECOIL_TAU: 0.45,           // v5.20 慢残差回零时间常数——放慢：停火后缓缓回落
};

// ============================================================
//  AI 难度预设（菜单可选：简单 / 普通 / 困难）
//  开始对局时由 main.applyDifficulty 写入 CONFIG，AI 全程实时读取
// ============================================================
const AI_PRESETS = {
  easy: {
    name: '简单', desc: 'AI 反应慢、枪法差，适合熟悉战场',
    AI_AIM_ERROR_MIN: 0.16, AI_AIM_ERROR_MAX: 0.30, AI_LOCK_TIME: 2.2,
    AI_FIRE_CHANCE: 0.25, AI_ENGAGE_RANGE: 60,
    AI_REACT_MIN: 0.55, AI_REACT_MAX: 0.55, AI_GRACE_TIME: 0.9,
  },
  normal: {
    name: '普通', desc: '均衡的 AI 反应与枪法',
    AI_AIM_ERROR_MIN: 0.09, AI_AIM_ERROR_MAX: 0.20, AI_LOCK_TIME: 1.6,
    AI_FIRE_CHANCE: 0.42, AI_ENGAGE_RANGE: 85,
    AI_REACT_MIN: 0.32, AI_REACT_MAX: 0.32, AI_GRACE_TIME: 0.65,
  },
  hard: {
    name: '困难', desc: 'AI 反应快、枪法准，老兵挑战',
    AI_AIM_ERROR_MIN: 0.05, AI_AIM_ERROR_MAX: 0.12, AI_LOCK_TIME: 1.1,
    AI_FIRE_CHANCE: 0.55, AI_ENGAGE_RANGE: 100,
    AI_REACT_MIN: 0.20, AI_REACT_MAX: 0.20, AI_GRACE_TIME: 0.45,
  },
};

// ============================================================
//  阵营
// ============================================================
const TEAMS = [
  { id: 0, name: '赤焰先锋', short: '赤焰', color: 0xe04a3e, accent: '#e04a3e' },
  { id: 1, name: '苍穹守卫', short: '苍穹', color: 0x3e7ae0, accent: '#3e7ae0' },
];
const TEAM_RED = 0, TEAM_BLUE = 1;

// ============================================================
//  兵种（4 类，各配主武器 + 战术装备）
// ============================================================
const CLASSES = {
  assault: {
    name: '突击兵', key: 'assault', weapon: 'ar',
    gadget: 'grenadeLauncher', gadgetName: '下挂榴弹', gadgetAmmo: 3, gadgetCooldown: 0,
    desc: '自动步枪 + 下挂榴弹发射器，正面突破',
  },
  support: {
    name: '支援兵', key: 'support', weapon: 'lmg',
    gadget: 'ammo', gadgetName: '弹药箱', gadgetAmmo: -1, gadgetCooldown: 22,
    desc: '重机枪火力压制，部署弹药箱补给队友',
  },
  recon: {
    name: '侦察兵', key: 'recon', weapon: 'sniper',
    gadget: 'flare', gadgetName: '侦察信号弹', gadgetAmmo: -1, gadgetCooldown: 28,
    desc: '栓动狙击远距猎杀，信号弹标记敌军',
  },
  engineer: {
    name: '工程兵', key: 'engineer', weapon: 'smg',
    gadget: 'rocket', gadgetName: '火箭筒', gadgetAmmo: 4, gadgetCooldown: 0,
    desc: '冲锋枪近战 + 火箭筒反载具，可维修载具（按住 E）+ 烟雾弹掩护（H）',
  },
  mortar: {
    name: '迫击炮兵', key: 'mortar', weapon: 'dmr',
    gadget: 'mortar', gadgetName: '迫击炮', gadgetAmmo: 6, gadgetCooldown: 0,
    desc: 'MK-14 精确射手步枪自卫 + 60mm 迫击炮曲射压制（40-180m 高抛弹道）',
  },
  medic: {
    name: '医疗兵', key: 'medic', weapon: 'aa12',
    gadget: 'medkit', gadgetName: '医疗箱', gadgetAmmo: -1, gadgetCooldown: 3,
    desc: 'AA-12 全自动霰弹枪近战自卫 + 医疗箱治疗队友 + 呼吸回血（无救援，阵亡立即重生）',
  },
};
const CLASS_ORDER = ['assault', 'support', 'recon', 'engineer', 'mortar', 'medic'];

// ============================================================
//  武器（主武器 / 副武器）
//  新旧双轨：旧键（spread/bloom*/recoil/recoilYaw）保留兼容 debug 滑块；
//  手感逻辑改用新键（spreadHip 系锥角扩散 / recoilDef 确定性 pattern 后坐）
// ============================================================
const WEAPONS = {
  ar: {
    name: 'AR-40 自动步枪', key: 'ar', type: 'auto', auto: true,
    damage: 27, rate: 0.095, mag: 30, reserve: 150, reload: 2.1,
    // 旧键（兼容）
    spread: 0, bloomPerShot: 0.0009, bloomMax: 0.055, recoil: 0.032, recoilYaw: 0.01,
    // 新扩散模型（度·锥角半角）
    spreadHip: 1.4, spreadAds: 0.25, spreadPerShot: 0.22, spreadMax: 3.4, spreadDecay: 3.6,
    // 新后坐模型（RecoilAxis 弹簧 + 确定性 pattern）
    recoilDef: { pitch: 0.06, yaw: 0.025, climbShape: [1.5, 1.3, 1.15, 1.05, 1.0], drift: 0.85, bias: 0.14, seed: 0x4d34a1 },   // v5.20 后坐增强
    adsFov: 42, adsTime: 0.2,
    dropoff: 0.38, falloffRange: 120,
    drawTime: 0.55, modes: ['auto', 'semi'],
    range: 120, tracer: 0xff3355, sound: 'rifle', scope: true, flashPower: 1.0,
  },
  lmg: {
    name: 'MG-80 重机枪', key: 'lmg', type: 'auto', auto: true,   // v5.11 改名：重机枪
    damage: 25, rate: 0.075, mag: 100, reserve: 200, reload: 3.4,
    spread: 0, bloomPerShot: 0.00045, bloomMax: 0.06, recoil: 0.028, recoilYaw: 0.009,
    spreadHip: 1.6, spreadAds: 0.3, spreadPerShot: 0.16, spreadMax: 3.8, spreadDecay: 3.0,
    recoilDef: { pitch: 0.05, yaw: 0.025, climbShape: [1.4, 1.25, 1.12, 1.05, 1.0], drift: 0.7, bias: -0.12, seed: 0x5a2b77 },   // v5.20 后坐增强
    adsFov: 42, adsTime: 0.22,
    dropoff: 0.35, falloffRange: 140,
    drawTime: 0.75, modes: ['auto'],
    range: 140, tracer: 0x38c8ff, sound: 'lmg', scope: true, flashPower: 1.2,
  },
  sniper: {
    name: 'SR-50 栓动狙击枪', key: 'sniper', type: 'bolt', auto: false,
    damage: 96, rate: 1.25, mag: 5, reserve: 40, reload: 2.7, boltTime: 0.9,   // v5.17 拉栓时长（读条/动画/收镜）
    spread: 0, bloomPerShot: 0.03, bloomMax: 0.12, recoil: 0.07, recoilYaw: 0.007,
    spreadHip: 0.35, spreadAds: 0.02, spreadPerShot: 2.0, spreadMax: 3.0, spreadDecay: 2.5,
    recoilDef: { pitch: 0.15, yaw: 0.015, climbShape: [1.8, 1.4, 1.2, 1.1, 1.0], drift: 0.5, bias: 0.05, seed: 0x77aa11 },   // v5.20 后坐增强
    adsFov: 18, adsTime: 0.25,
    dropoff: 0, falloffRange: 400,
    drawTime: 0.7, modes: ['auto'],
    range: 400, tracer: 0x3dff9e, sound: 'sniper', scope: true, flashPower: 1.9,
  },
  smg: {
    name: 'SMG-9 冲锋枪', key: 'smg', type: 'auto', auto: true,
    damage: 21, rate: 0.058, mag: 32, reserve: 160, reload: 1.9,
    spread: 0, bloomPerShot: 0.0002, bloomMax: 0.05, recoil: 0.02, recoilYaw: 0.008,
    spreadHip: 1.2, spreadAds: 0.2, spreadPerShot: 0.18, spreadMax: 3.0, spreadDecay: 4.2,
    recoilDef: { pitch: 0.035, yaw: 0.02, climbShape: [1.3, 1.2, 1.1, 1.05, 1.0], drift: 0.6, bias: 0.08, seed: 0x2c9a3f },   // v5.20 后坐增强
    adsFov: 45, adsTime: 0.18,
    dropoff: 0.45, falloffRange: 90,
    drawTime: 0.45, modes: ['auto'],
    range: 90, tracer: 0xffb340, sound: 'smg', scope: true, flashPower: 0.8,
  },
  pistol: {
    name: 'P-45 手枪', key: 'pistol', type: 'semi', auto: false,
    damage: 32, rate: 0.2, mag: 12, reserve: 48, reload: 1.5,
    spread: 0, bloomPerShot: 0.003, bloomMax: 0.05, recoil: 0.032, recoilYaw: 0.01,
    spreadHip: 1.0, spreadAds: 0.2, spreadPerShot: 0.35, spreadMax: 3.0, spreadDecay: 5.0,
    recoilDef: { pitch: 0.088, yaw: 0.025, climbShape: [1.4, 1.2, 1.1, 1.0], drift: 0.7, bias: 0.1, seed: 0x0f3c66 },   // v5.20 后坐增强
    adsFov: 50, adsTime: 0.15,
    dropoff: 0.5, falloffRange: 80,
    drawTime: 0.35, modes: ['auto'],
    range: 80, tracer: 0xff5fd0, sound: 'pistol', scope: true, flashPower: 0.6,
  },
  shotgun: {
    name: 'SG-12 霰弹枪', key: 'shotgun', type: 'shotgun', auto: false,
    damage: 15, rate: 0.6, mag: 6, reserve: 30, reload: 2.6,   // v5.11 射速 0.85→0.6（泵动更跟手）
    pellets: 8, pelletsSpread: 2.3,   // 每发 8 颗弹丸，散射增强（锥角 2.3°）
    spread: 0, bloomPerShot: 0.012, bloomMax: 0.09, recoil: 0.075, recoilYaw: 0.014,
    spreadHip: 2.2, spreadAds: 1.0, spreadPerShot: 2.4, spreadMax: 4.5, spreadDecay: 4.0,
    recoilDef: { pitch: 0.16, yaw: 0.025, climbShape: [1.9, 1.5, 1.2, 1.0], drift: 0.6, bias: 0.05, seed: 0x6b1f9c },   // v5.20 后坐增强
    adsFov: 50, adsTime: 0.18,
    dropoff: 0.06, falloffRange: 32,   // 近战王者：射程末端仅剩 6% 伤害（衰减极陡）
    drawTime: 0.4, modes: ['auto'],    // v5.11 掏枪更快（0.6→0.4），换枪后立刻能射
    range: 45, tracer: 0xffaa33, sound: 'shotgun', scope: true, flashPower: 1.6,
  },
  aa12: {
    name: 'AA-12 全自动霰弹枪', key: 'aa12', type: 'shotgun', auto: true,
    damage: 12, rate: 0.14, mag: 8, reserve: 40, reload: 2.8,   // 全自动连喷：7 发/秒
    pellets: 8, pelletsSpread: 2.2,
    spread: 0, bloomPerShot: 0.008, bloomMax: 0.08, recoil: 0.04, recoilYaw: 0.008,
    spreadHip: 1.9, spreadAds: 0.9, spreadPerShot: 1.1, spreadMax: 3.6, spreadDecay: 3.5,
    recoilDef: { pitch: 0.106, yaw: 0.022, climbShape: [1.5, 1.25, 1.1, 1.0], drift: 0.6, bias: 0.04, seed: 0xaa12c0 },   // v5.20 后坐增强
    adsFov: 50, adsTime: 0.18,
    dropoff: 0.12, falloffRange: 26,
    drawTime: 0.45, modes: ['auto'],
    range: 40, tracer: 0xffc040, sound: 'shotgun', scope: true, flashPower: 1.4,
  },
  dmr: {
    name: 'MK-14 精确射手步枪', key: 'dmr', type: 'semi', auto: false,
    damage: 55, rate: 0.16, mag: 15, reserve: 90, reload: 2.2,
    spread: 0, bloomPerShot: 0.004, bloomMax: 0.07, recoil: 0.05, recoilYaw: 0.009,
    spreadHip: 1.0, spreadAds: 0.08, spreadPerShot: 0.5, spreadMax: 2.6, spreadDecay: 3.2,
    recoilDef: { pitch: 0.106, yaw: 0.018, climbShape: [1.6, 1.35, 1.15, 1.0], drift: 0.6, bias: 0.06, seed: 0x3f8e5a },   // v5.20 后坐增强
    adsFov: 28, adsTime: 0.2,         // 4x 级中倍镜（无狙击镜遮罩，见 player 开镜）
    dropoff: 0.25, falloffRange: 300,
    drawTime: 0.65, modes: ['auto'],
    range: 300, tracer: 0x9ad0ff, sound: 'dmr', scope: true, flashPower: 1.3,
  },
};

// 战术装备（兵种专属）
const GADGETS = {
  grenadeLauncher: {
    name: '下挂榴弹', kind: 'projectile', speed: 42, gravity: 24, radius: 7, damage: 140,
    fuse: 0.0, ammo: 3, reload: 1.5,
  },
  rocket: {
    // v5.43 反坦克强化：飞弹更快（95m/s）、伤害更高（360）、备弹更多（5）、装填更快（2.0s）、溅射更大（6m）
    // 对载具高伤（antiVehicle ×2）、对步兵溅射小（×0.35）、可开镜（adsFov 30）
    name: 'RPG-7 火箭筒', kind: 'projectile', speed: 95, gravity: 2, radius: 6, damage: 360,
    fuse: 0.0, ammo: 5, antiVehicle: true, reload: 2.0,
    scope: true, adsFov: 30, adsTime: 0.2,
  },
  ammo: { name: '弹药箱', kind: 'instant', ammo: -1 },
  flare: { name: '侦察信号弹', kind: 'flare', ammo: -1 },
  mortar: {
    name: '60mm 迫击炮', kind: 'mortar',
    minRange: 15, maxRange: 180, radius: 12, damage: 300,   // v5.24 最小射程 40→15m（近距自卫曲射）
    ammo: 6, reload: 4.5,   // 反步兵曲射（无 antiVehicle：对步兵全额溅射）
  },
  medkit: {
    name: '医疗箱', kind: 'medic',
    healAmount: 35, healRadius: 8, ammo: -1,
  },
};

// 手雷
const GRENADE = {
  name: 'M67 破片手雷', kind: 'projectile', speed: 22, gravity: 24, radius: 9, damage: 150,
  fuse: 2.6, ammo: 2,
};
// v5.38 烟雾弹（H 键投掷；烟墙遮挡视线/AI 索敌，战术纵深）
const SMOKE = {
  name: 'M18 烟雾弹', speed: 18, gravity: 20, fuse: 1.6, ammo: 1,
  radius: 9, duration: 14,
};

// ============================================================
//  载具
// ============================================================
// v5 载具克制环：armorClass（heavy 重甲 / light 轻甲 / air 航空器）+ 伤害类型倍率
// 克制关系：工程兵火箭→重甲 · 坦克炮→一切地面 · 防空车 AA→航空器（×3）·
//           航空器→地面（火箭压制）· 步兵枪械→直升机/战斗机可微伤
// v5.3 载具全面削弱（用户反馈：AI 载具太强打不动、跑太快）：
// 血量 ~40% 削减 + 地面速度大幅降低 + 步兵枪械伤害倍率提升（见 weapons.damageVehicle）
const VEHICLES = {
  tank: {
    name: '主战坦克', key: 'tank', seats: 1, hitRadius: 3.6, hp: 900, armorClass: 'heavy',
    speed: 11, reverseSpeed: 7, turnRate: 2.6, camHeight: 4.6,   // v5.43 加强：更厚血 + 更强炮 + 更机动
    shellDamage: 320, shellRadius: 13, shellSpeed: 110, shellReload: 1.8, shellSpread: 0.002,
    mgDamage: 18, mgRate: 0.1, mgSpread: 0.02,   // v5.14 车载机枪扩散（≈1.1° 锥角）
  },
  apc: {
    name: '装甲运兵车', key: 'apc', seats: 3, hitRadius: 3.2, hp: 560, armorClass: 'light',
    speed: 15, reverseSpeed: 8, turnRate: 2.6, camHeight: 3.6,   // v5.43 加强
    mgDamage: 26, mgRate: 0.085, mgSpread: 0.022,   // v5.14 车载机枪扩散
  },
  aa: {
    name: '防空炮车', key: 'aa', seats: 1, hitRadius: 3.2, hp: 520, armorClass: 'light',
    speed: 14, reverseSpeed: 7, turnRate: 2.4, camHeight: 3.4,   // v5.43 加强
    cannonDamage: 24, cannonRate: 0.08, cannonSpread: 0.01,   // v5.14 扩散微增（保持对空压制力）
    antiAir: true, range: 400,   // 对空（直升机 ×3 / 喷气机 ×1.5）/ 对地极弱
  },
  heli: {
    name: '武装直升机', key: 'heli', seats: 1, hitRadius: 3.4, hp: 620, armorClass: 'air',
    speed: 28, turnRate: 1.2, camHeight: 2.6,
    rocketDamage: 120, rocketRadius: 6, rocketSpeed: 75, rocketReload: 0.15, rocketSpread: 0.002,
    cannonDamage: 20, cannonRate: 0.07, cannonSpread: 0.02,   // v5.43 加强
  },
  // v5.10 喷气战斗机已删除（用户要求）
};

// ============================================================
//  地图（三图：沙漠 / 雪域 / 钢铁防线）
//  每图 × 每模式一套占领点布局；突破模式为线性扇区链
// ============================================================
const MAP_DEFS = {
  desert: {
    name: '沙暴行动', gen: 'desert', sky: 0xd9b98a, sun: 0xffe0b0, sunPos: [110, 100, 60],
    fogNear: 60, fogFar: 180, weather: 'sand',
    flags: {
      conquest: [
        { id: 'A', name: '绿洲水站', x: 0, z: -45 },
        { id: 'B', name: '西侧油田', x: -68, z: -12 },
        { id: 'C', name: '东侧油井', x: 68, z: -12 },
        { id: 'D', name: '山脊观察站', x: 0, z: 48 },
        { id: 'E', name: '中央集市', x: 0, z: 0 },
      ],
      breakthrough: [
        { sector: 1, name: '沙丘前线', flags: [{ id: 'S1A', x: -54, z: -33 }, { id: 'S1B', x: -54, z: 33 }] },
        { sector: 2, name: '油田腹地', flags: [{ id: 'S2A', x: 0, z: -33 }, { id: 'S2B', x: 0, z: 33 }] },
        { sector: 3, name: '绿洲要塞', flags: [{ id: 'S3A', x: 54, z: -24 }, { id: 'S3B', x: 54, z: 24 }] },
      ],
    },
  },
  fort: {
    name: '钢铁防线', gen: 'fort', sky: 0x7a3020, sun: 0xff8a50, sunPos: [90, 38, 70],   // v5.30 血色黄昏
    fogNear: 35, fogFar: 140, weather: 'ash',   // 灰烬余烬上飘（烽火连天）
    flags: {
      conquest: [
        { id: 'A', name: '西线堑壕', x: -60, z: -27 },
        { id: 'B', name: '中央油库', x: 0, z: -21 },
        { id: 'C', name: '东侧堡垒', x: 60, z: -21 },
        { id: 'D', name: '北岭哨塔', x: 0, z: 39 },
        { id: 'E', name: '谷地哨站', x: -30, z: 12 },
      ],
      breakthrough: [
        { sector: 1, name: '西线堑壕', flags: [{ id: 'S1A', x: -57, z: -24 }, { id: 'S1B', x: -57, z: 27 }] },
        { sector: 2, name: '中央油库', flags: [{ id: 'S2A', x: 0, z: -21 }, { id: 'S2B', x: 0, z: 27 }] },
        { sector: 3, name: '钢铁堡垒', flags: [{ id: 'S3A', x: 57, z: -21 }, { id: 'S3B', x: 57, z: 27 }] },
      ],
    },
  },
  snow: {
    name: '雪域要塞', gen: 'snow', sky: 0x9fb8c8, sun: 0xeaf2ff, sunPos: [140, 85, 95],
    fogNear: 55, fogFar: 175, weather: 'snow',
    flags: {
      conquest: [
        { id: 'A', name: '冰湖哨站', x: 0, z: -45 },
        { id: 'B', name: '西线碉堡', x: -63, z: 21 },
        { id: 'C', name: '东线碉堡', x: 63, z: 21 },
        { id: 'D', name: '山地雷达站', x: 0, z: 54 },
        { id: 'E', name: '冰原枢纽', x: 0, z: 0 },
      ],
      breakthrough: [
        { sector: 1, name: '冰川前线', flags: [{ id: 'S1A', x: -54, z: -39 }, { id: 'S1B', x: -54, z: 33 }] },
        { sector: 2, name: '雪林腹地', flags: [{ id: 'S2A', x: 0, z: -39 }, { id: 'S2B', x: 0, z: 33 }] },
        { sector: 3, name: '要塞大门', flags: [{ id: 'S3A', x: 54, z: -36 }, { id: 'S3B', x: 54, z: 30 }] },
      ],
    },
  },
};

// 地图上全部旗点位置（布局避让用，跨模式合并）
function allFlagPositions(mapId) {
  const m = MAP_DEFS[mapId] || MAP_DEFS.desert;
  const out = [];
  for (const f of m.flags.conquest) out.push({ x: f.x, z: f.z });
  for (const s of m.flags.breakthrough) for (const f of s.flags) out.push({ x: f.x, z: f.z });
  return out;
}

const BASE_DEFS = [
  { team: TEAM_RED,  x: -108, z: 0 },
  { team: TEAM_BLUE, x: 108,  z: 0 },
];

// ============================================================
//  军衔（按分数晋升，持久化）
// ============================================================
const RANKS = [
  { score: 0,     name: '列兵' }, { score: 500,   name: '上等兵' },
  { score: 1200,  name: '下士' }, { score: 2200,  name: '中士' },
  { score: 3600,  name: '上士' }, { score: 5600,  name: '少尉' },
  { score: 8200,  name: '中尉' }, { score: 11500, name: '上尉' },
  { score: 15500, name: '少校' }, { score: 20500, name: '中校' },
  { score: 26500, name: '上校' }, { score: 34000, name: '少将' },
  { score: 43000, name: '中将' }, { score: 54000, name: '上将' },
  { score: 68000, name: '元帅' },
];

// v5.28 士兵呼号池（多样性：BOT 生成时按序确定性分配）
const BOT_NAMES = ['猎鹰', '夜枭', '铁砧', '霜刃', '灰狼', '渡鸦', '山魈', '火狐',
  '磐石', '利齿', '白鼬', '黑豹', '疾风', '惊雷', '毒蛇', '孤星', '破晓', '凛冬', '赤狐', '苍鹭'];

// 载具刷新点（每方基地附近 + 机场跑道）
const VEHICLE_SPAWNS = [
  { team: TEAM_RED,  kind: 'tank', x: -93, z: -18 },
  { team: TEAM_RED,  kind: 'apc',  x: -93, z: 18 },
  { team: TEAM_RED,  kind: 'aa',   x: -96, z: -39 },
  { team: TEAM_RED,  kind: 'heli', x: -81, z: -36 },
  { team: TEAM_RED,  kind: 'heli', x: -81, z: 36 },   // v5.44 第二架直升机
  { team: TEAM_BLUE, kind: 'tank', x: 93,  z: 18 },
  { team: TEAM_BLUE, kind: 'apc',  x: 93,  z: -18 },
  { team: TEAM_BLUE, kind: 'aa',   x: 96,  z: 39 },
  { team: TEAM_BLUE, kind: 'heli', x: 81,  z: 36 },
  { team: TEAM_BLUE, kind: 'heli', x: 81,  z: -36 },  // v5.44 第二架直升机
];
