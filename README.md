# 灰烬战线 · ASHEN FRONTLINE

> 纯原生 JavaScript + Three.js（自托管）打造的类《战地》24v24 大战场。**零依赖、零构建，双击 `index.html` 即玩**；`dist/灰烬战线_单文件版.html` 为单文件发行版。开局可选语言：**简体中文 / English**。

---

## 特色 Features

- **24v24 大战场**：48 名士兵同场（红军 23 BOT + 你，蓝军 24 BOT），InstancedMesh 渲染 + 空间哈希索敌 + 按距离降频，30 秒压力测试平均 tick < 1ms。
- **双模式**：征服（占旗 + 票数流血）· 突破（红攻蓝守、3 扇区线性推进、攻下补票、史诗播报）。
- **三张地图**：雪域要塞（极地雪原冰湖）· 钢铁防线（血色黄昏要塞攻坚）· 雨林沼泽（热带雨林河道渡口），每图绑定天气粒子（降雪/灰烬/降雨）。
- **六大兵种**：突击兵 · 支援兵 · 侦察兵 · 工程兵 · 迫击炮兵 · 医疗兵，各配专属主武器 + 战术装备。
- **陆空载具**：主战坦克 · 装甲运兵车（机枪位）· 防空炮车（克制直升机）×3 · 武装直升机（火箭/机炮）；完整克制环（重甲/轻甲/航空器 + 伤害类型倍率）。
- **全域破坏**：建筑三级破坏（完好→开裂→残破→倒塌），二层楼房可分级破坏（上层先塌），油桶/油罐殉爆，地形保持稳定。
- **地图生成系统**：高度场 + 实体布局管线，遵循十条铁律（见 `MAP_GEN_RULES.md`），每图独立确定性种子。
- **真实枪感**：锥角扩散 + 确定性弹簧后坐 + 距离衰减 + 部位倍率（头 ×2 / 腿 ×0.75）+ 拉栓/换弹时序。
- **功绩播报系统**：只播你的击杀/爆头/复仇/助攻/多杀/占领等功绩，底部堆叠滚动 + 分数缓动，不刷屏。
- **程序化音效**：零音频文件，枪声/爆炸/引擎/迫击炮呼啸/心跳全部实时合成。
- **阵亡/复活视角**：第一人称倒地 → 灵魂出窍俯瞰 → 选点复活，视角平滑俯冲、不突变。
- **多语言**：开局菜单一键切换简体中文 / English，UI 即时刷新。

---

## 操作 Controls

| 按键 | 作用 |
|------|------|
| WASD | 移动（直升机：前后左右） |
| 鼠标 | 瞄准 / 射击（左键开火，右键开镜） |
| Shift | 冲刺（直升机：下降） |
| 空格 | 跳跃（直升机：上升） |
| C / Ctrl | 蹲下 |
| R | 换弹 |
| 1 / 2 / 3 | 主武器 / 副武器 / 兵种装备 |
| G / H | 手雷 / 烟雾弹（工程兵） |
| Q / E | 歪头（左 / 右） |
| T | 维修载具（工程兵） |
| F | 进入/离开载具（队友驾驶中会请其下车） |
| V | 载具第三人称视角 |
| Tab | 计分板 |
| F1 | 调试面板 |
| Esc | 释放鼠标 |

---

## 运行 Run

```bash
# 直接游玩
双击 index.html

# 运行测试（需本机 Chrome）
node tests/run_all.js

# 打包单文件发行版
node build_single.js
```

---

## 目录 Structure

```
index.html        页面 + DOM 结构（含语言/模式/地图选择）
three.min.js      Three.js r128 引擎（自托管）
css/style.css     样式
js/config.js      全局调参 + 地图/兵种/武器/载具表
js/lang.js        多语言（简体中文 / English）
js/utils.js       PRNG + 数学 + 空间哈希网格
js/audio.js       程序化音效
js/terrain.js     高度场地形 + 四图生成 + 多级破坏
js/effects.js     粒子 + 曳光/火光/爆炸对象池 + 天气
js/weapons.js     hitscan 战斗 / 多弹丸 / 装备 / 克制环
js/player.js      第一人称控制器
js/ai.js          机器人 AI + 战斗导演
js/vehicles.js    陆空载具 + BOT 驾驶员
js/hud.js         HUD / 小地图 / 计分板 / 菜单
js/main.js        渲染器 / 模式逻辑 / 主循环 / 流程
tests/            CDP 无头测试（22 项）
tools/            音效工坊（零依赖音效设计工具）
dist/             单文件发行版
```

---

## 验证 Tests

22 项无头 Chrome CDP 确定性测试覆盖：24v24 启动/战斗/压力、全流程、载具、战斗导演、武器手感、突破、破坏、地图切换、霰弹、防空、雪域、菜单、迫击炮、医疗箱、升级、侦察、载具近战、小地图、功绩、钢铁防线、玩法补齐。

```bash
node tests/run_all.js          # 全部 22 项
node tests/run_all.js test_spot.js   # 单项
```

---

## 已知边界 Known Limits

- 单机 BOT 模拟（无网络层）。
- 阴影为全局 1024 贴图（autotest 关闭）；士兵 LOD 为近/远两档（>120m 低模）。
- 突破模式守方不能夺回已推进扇区（推过即锁）。

---

# English

> A Battlefield-like 24v24 battlefield built with vanilla JavaScript + self-hosted Three.js. **Zero dependencies, zero build — double-click `index.html` to play.** `dist/灰烬战线_单文件版.html` is the single-file release. Language can be selected at startup: **简体中文 / English**.

## Features

- **24v24**: 48 soldiers in one match (23 bots + you on Red, 24 bots on Blue). InstancedMesh rendering, spatial-hash targeting, distance-based AI tick scaling — 30s stress test averages < 1ms/tick.
- **Two modes**: Conquest (flag capture + ticket bleed) · Breakthrough (attack vs. defend, 3-sector linear push, sector bonus, epic callouts).
- **Three maps**: Operation Sandstorm · Snow Fortress · Iron Line — each with bound weather particles (sand / snow / ash).
- **Six classes**: Assault · Support · Recon · Engineer · Mortarman · Medic, each with a dedicated primary weapon and gadget.
- **Land & air vehicles**: MBT · APC (gunner seat) · Anti-Air gun (×3 vs helicopters) · Attack helicopter (rockets/cannon); full rock-paper-scissors armor model.
- **Full destruction**: buildings break in three stages (intact → cracked → ruined → collapsed); oil drums/tanks chain-explode.
- **Authentic gunplay**: cone spread + deterministic spring recoil + distance falloff + hit-zone multipliers (head ×2 / legs ×0.75) + bolt/reload timing.
- **Merit feed**: only your own kills/headshots/revenge/assists/multikills/captures feed the bottom ticker with animated score.
- **Procedural audio**: zero audio files — gunfire, explosions, engines, mortar whistle and heartbeat are all synthesized in real time.
- **Death/deploy camera**: first-person fall → soul rise to overview → pick a spawn and dive back smoothly, no camera snap.
- **Multilingual**: one-click switch between Simplified Chinese and English from the main menu, with instant UI refresh.

## Controls

| Key | Action |
|-----|--------|
| WASD | Move (helicopter: forward/back/strafe) |
| Mouse | Aim / fire (LMB fire, RMB aim) |
| Shift | Sprint (helicopter: descend) |
| Space | Jump (helicopter: ascend) |
| C / Ctrl | Crouch |
| R | Reload |
| 1 / 2 / 3 | Primary / secondary / class gadget |
| G / H | Grenade / smoke (Engineer) |
| Q / E | Lean (left / right) |
| T | Repair vehicle (engineer) |
| F | Enter/exit vehicle |
| V | Vehicle third-person view |
| Tab | Scoreboard |
| F1 | Debug panel |
| Esc | Release mouse |

## Run

```bash
# Play
double-click index.html

# Run tests (requires local Chrome)
node tests/run_all.js

# Build single-file release
node build_single.js
```

## Tests

22 headless-Chrome CDP deterministic tests cover boot/combat/stress, full flow, vehicles, combat director, weapon feel, breakthrough, destruction, map switching, shotgun, anti-air, snow, menu, mortar, medkit, upgrades, spotting, vehicle melee, minimap, merit feed, Iron Line, and gameplay polish.

## Known Limits

- Single-player bot simulation (no networking layer).
- Global 1024 shadow map (disabled in autotest); two soldier LOD tiers (>120m low-poly).
- In Breakthrough, defenders cannot recapture a sector once pushed past.
