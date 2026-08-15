/* ============================================================
 * tests/run_all.js — 顺序运行全部测试（旧 5 项 + 新 5 项）
 * ============================================================ */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 旧测试在项目根目录，新测试在 tests/
const OLD = [
  'test_cdp.js',          // 冒烟：16v16 同场战斗
  'test_flow.js',         // 完整对局流程
  'test_vehicles.js',     // 载具（含直升机/战斗机）
  'test_director.js',     // 战斗导演
  'test_weapons.js',      // 武器手感/伤害
];
const NEW = [
  'test_64.js',           // 16v16 压力 + 性能
  'test_breakthrough.js', // 突破模式
  'test_destruction.js',  // 建筑多级破坏 + 弹坑
  'test_maps.js',         // 双地图切换
  'test_shotgun.js',      // v5 霰弹枪多弹丸
  'test_aa.js',           // v5 防空车克制环
  'test_snow.js',         // v5 雪域要塞 + 天气
  'test_menu.js',         // v5.3 AI 难度 + 退出重新选图
  'test_mortar.js',       // v5.5 迫击炮兵
  'test_medkit.js',       // v5.6 医疗箱 + AI 自动补弹
  'test_upgrade.js',      // v5.10 RPG/护盾/回血/读条/换枪/准星
  'test_spot.js',         // v5.12 侦察标记 + 战地式加分
  'test_vehicle_combat.js',// v5.15 载具碾压 / 机枪扩散 / 点射交替 / 弹道沿准星
  'test_minimap.js',      // v5.16 敌方载具有视野标注 + 反炮击预警高亮
  'test_merit.js',        // v5.18 功绩播报 + 分数缓动
  'test_fort.js',         // v5.30 钢铁防线（突破模式史诗地图）
  'test_ops.js',          // v5.38 维修/机枪位/烟雾弹/濒死反馈
];

const targets = [];
const args = process.argv.slice(2);
if (args.length) targets.push(...args.filter(t => OLD.includes(t) || NEW.includes(t)));
else targets.push(...OLD, ...NEW);

const results = [];
const t0 = Date.now();
let portIdx = 0;
for (const t of targets) {
  console.log('\n▶ ' + t);
  const inTests = fs.existsSync(path.resolve(__dirname, t));
  const script = inTests ? path.resolve(__dirname, t) : path.resolve(__dirname, '..', t);
  // 每个测试分配独立调试端口，避免上一测试的 Chrome 残留占用端口
  const env = Object.assign({}, process.env, { TEST_PORT: String(9230 + (portIdx++ % 40)) });
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit', timeout: 300000, cwd: path.resolve(__dirname, '..'), env });
  results.push({ test: t, ok: r.status === 0, status: r.status });
}
console.log('\n========== 测试汇总 ==========');
let pass = 0, fail = 0;
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.test}${r.ok ? '' : ' (exit ' + r.status + ')'}`);
  r.ok ? pass++ : fail++;
}
console.log(`\n${pass} 通过 / ${fail} 失败 · 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(fail ? 1 : 0);
