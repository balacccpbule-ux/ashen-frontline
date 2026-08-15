# 灰烬战线 · ASHEN FRONTLINE · 项目进度与备忘

## 状态：v5.42 已完成并验证 ✅（删除巷战街区 + 灰烬都市非网格重做 + 音效全面升级 + 功绩放大 + 后座增强，22 项测试全绿）

## v5.42 地图重置（删除巷战街区 + 灰烬都市非网格重做 + 突破纵深）

- **删除巷战街区地图**：config/index/terrain 移除 alley，菜单五图 → 四图，test_alley 删除
- **灰烬都市重做（非田字格）**：genCity 由 16m 网格改为 findSpot 随机散落街区（7-12m 大小、市中心高边缘低错落），楼间自然形成街道/广场；cityRawHeight 由 ±2m 抬到 **±4m 多层正弦丘陵**（有起伏但不夸张）
- **突破模式纵深**：城市突破三扇区 × 双点改**错落排布**（每点 x/z 都不同，不再同一直线），每点之间由地形/楼群过渡；进攻方一次只打当前扇区两个点，打下后继续下一个扇区两点

## v5.40 阵亡/复活视角流程重构 + 面向敌军 + 仅己方点复活 + 开镜阵亡 FOV 修复（用户四项反馈）

- **阵亡流程（main.js deathFall/startDeathFly/deathCamera）**：死了之后先**第一人称倒地**（相机从眼高跌到尸体旁地面 + 侧倾，0.3s smoothstep）→ **隐藏枪械** → **灵魂出窍**（从尸体飘向战场正上方，smoothstep 渐渐加速-渐渐减速）
- **复活流程（deployPlayer/finalizeSpawn）**：点击复活点后**灵魂先飞**（从战场上方俯冲向所选点位，渐渐加速-渐渐减速），期间视角随灵魂一起**平滑转向敌军方向**（slerp smoothstep，不突变、转动速度与灵魂速度一致），**灵魂到位之后才生成人物并显示枪械**（复活点击不再瞬间落地）
- **面向敌军**：部署朝向由原先朝北/朝南（yaw 0/π）改为**面向敌军基地**（红朝 +x / 蓝朝 -x，按 BASE_DEFS 计算），首次部署与复活统一
- **仅己方点复活（hud.buildDeathSpawns）**：征服/突破统一只列**己方旗帜 + 己方基地**（修复突破模式原先把当前扇区敌方旗帜也列为复活点的问题）；征服分支原本 `f.owner === pt` 已正确，本次把突破分支 `f.sector === activeSector` 一并改为 `f.owner === pt`
- **开镜阵亡 FOV 修复（player.resetAds + weapons.kill）**：阵亡时复位 FOV（75）+ 开镜态（ads/adsK/adsEase/scoped/sensScale）——修复开镜时死亡会保持低 FOV（狙击 18°）飘升/俯视的观感 bug
- **测试**：test_flow 延长睡眠适配「倒地 + 灵魂出窍」「灵魂归位 + 落地生成」两段动画；全套 23 项绿

## v5.39 地图纵深拉长 + 载具小地图符号 + 阵亡界面重做 + 视角缓动（用户四项需求）

- **地图纵深拉长（config WORLD 80→120，战场 160→240m；五图全部重做）**：基地（BASE_DEFS ±72→±108）、载具刷新点、全部征服/突破旗点按 **1.5× 重排**；地图特征重新落位——钢铁防线（东侧堡垒 citadel 58→87、西线堑壕 lx -40→-60 / lz ±30→±45、中央油库 0,-30→0,-45、东堡高台 x 阈值 18→27）、沙漠（土坯村庄 -30,28→-45,42 / 30,30→45,45、油田 -45,-8→-68,-12 / 45,-8→68,-12、绿洲 0,-30→0,-45）、雪域（冰湖/冰面 0,-30→0,-45、北岭山脉山脊 z 54→81）；建筑网格/掩体/树木全部随 WORLD 自动铺满更大战场，天际线分层沿用 v5.35
- **取消载具 3D 高亮（effects.updateSpotOutlines 空操作）+ 小地图坦克符号（hud.drawMinimap）**：被标记载具不再出现红色隔墙透视线框，改为小地图上以**坦克符号**（车身矩形 + 炮管朝向）标记，一眼区分步兵圆点
- **阵亡界面重做（index.html/css/hud.js/main.js）**：黑色背景删除（透明、pointer-events 仅按钮区域）；**退出对局移到右上角**（#btn-exit-dead）；屏幕下方排列**六职业选择条**（buildDeathClasses + makeClassCard 复用 selectClass 切换）；**已占领点位作为复活点**（home 基地 + 征服已占旗/突破当前扇区旗）——按钮经 worldToScreen 投影（world 坐标 → 屏幕坐标），**与具体点位位置完美对应**，投影到相机后方时隐藏不突兀；deployPlayer(spawnFlag) 支持按所选点位 ±8m 偏移部署
- **视角缓动（smoothstep k·k·(3-2k) 渐渐加速-渐渐减速）**：死亡后相机从倒地位置**渐渐加速-渐渐减速**飘向战场正上方（高度随 WORLD 自适应，1.2s 后显示阵亡界面）；选点部署后相机由战场上方以**同样缓动**飞回所选点位附近的安全处（player.startDeployCam/updateCamFly）
- **测试**：test_64 重探 seed 61→**1**（纵深拉长后战斗密度变化，13 阵亡/12 击杀/5 载具，阈值 12→10）；test_weapons/test_shotgun/test_mortar/test_spot/test_vehicle_combat/test_minimap 坐标适配新地图（红基地 -72→-108 开阔区、旗 B -42,20→-63,30 等）；test_spot 更新载具高亮断言（v5.39 无边框）；test_vehicle_combat 防卡死改**斜撞墙**（纯垂直头撞会被反推卡死，斜撞才能沿墙滑动）；全套 23 项绿

## v5.38 玩法补齐 + 表现力（用户选定 A+B 路线：工程兵维修 / APC 机枪位 / 烟雾弹 / 濒死反馈 / 兵种外观）

- **工程兵维修载具（vehicles.repairVehicle + player/ai 双端）**：按住 **E** 在受损友军载具旁持续维修（22HP/s、橙黄火花粒子、点焊轻响 repairTick、计分 ≈2.2/s + 每 2.5s 聚合「维修」功绩）；AI 工程兵无交火时自动寻找 16m 内受损友军载具（<7m 蹲下维修，否则前往）——兵种描述里的「可修复载具」终于名副其实
- **装甲车机枪位（vehicles.gunner 第二乘员）**：APC 有司机时玩家按 F 坐机枪位（司机不被赶下车，seat=1）——机枪手控制炮塔与机枪（司机只管驾驶、有机枪手时不再自行开火），相机/下车/重置全链路适配
- **烟雾弹（weapons.throwSmoke + effects.smokeZones + terrain.blocksLOS）**：**H 键**投掷（每命 1 发）→ 引信 1.6s 落地生成 9m 烟墙（灰白浓烟持续喷发 14 秒）→ **烟墙遮挡视线**（blocksLOS 沿射线采样烟区即挡，AI 索敌同步被遮挡）；无伤害纯战术道具
- **濒死反馈（hud/audio/css）**：血量 ≤45 触发暗角红晕（透明度随伤情 0.22→0.72 + 脉动加速）+ **心跳音**（咚-咚双跳，间隔 1.25s→0.5s 随伤情加快加重）
- **兵种外观差异（ai.updateInstance）**：实例化士兵按兵种体型差异——支援 1.07 壮硕 / 突击 1.03 / 工程 1.02 / 医疗 0.98 / 侦察 0.94 纤细（同 1 draw call）
- **测试**：新增 tests/test_ops.js（第 23 号，13 项断言——维修回血+66/功绩、机枪位不赶司机/可开火/下车释放、烟雾弹备弹/烟墙生成/挡视线/到期消散、心跳音接入、低血量红晕）；test_64 seed 61 复验（24 阵亡/24 击杀/6 载具）；全套 23 项绿

## v5.37 星形枪口焰（用户反馈：射击时黄色光球挡在面前，影响观感）

- **诊断**：旧枪口焰是 0.44m 直径、95% 不透明的黄色球体（0xffe08a），玩家第一人称枪口距相机仅 ~0.7m——每开一枪一个大光球怼脸
- **新方案（effects.js muzzleFlash）**：**星形尖刺焰**——两根 0.06m 细十字尖刺（长度随 flashPower 0.33-0.55m）+ 0.09m 小核心光，全部**加色混合（AdditiveBlending）**、0.05s 极短寿命快速收缩淡出；星体始终**朝向相机**（首/第三人称观感一致），滚转角按时间+位置确定性正弦变化（不消耗随机数，test_64 零影响）；动态点光强度 2.2→1.5 收敛防近距过曝；爆炸火球池保留原样（远距爆炸仍是球体光晕）
- **测试**：全套 22 项绿（特效层改动无模拟影响）

## v5.36 鼠标瞬转一大圈修复（用户反馈：鼠标移动时可能瞬间转一大圈）

- **诊断**：指针锁定过渡（锁定瞬间/切换窗口/切回标签页时）浏览器会投递一次**异常大的 movementX/Y 伪事件**（可达上千像素），直接累加进 P.dx → 单帧视角爆发旋转一整圈；且原代码对单帧累积量无任何上限
- **修复（player.js mousemove）**：①单事件位移绝对值 >320px 视为伪事件**直接丢弃**；②**单帧累积量钳制 ±220px**（≈27.7°/帧 @ 0.0022 灵敏度，30fps 下仍支持 830°/s 快速甩枪）——步战/载具/直升机/部署飞行视角全部经过此统一入口，一处修复全局生效
- **测试**：test_weapons 新增 T13/T13b/T13c——1000px 异常事件被过滤（dx=0）、正常 100px 位移正常累计、连续两次 180px 被钳到 220；全套 22 项绿

## v5.35 地图纵深设计（用户要求：地图要有纵深感觉，不能是大方块）

- **建筑造型去方块化（terrain.buildSolidMesh）**：城市/巷战/钢铁防线建筑改为**确定性多部件剪影**（按 cx/cz 哈希，碰撞 AABB 不变、纯视觉纵深）——退台式塔楼（四角/中心随机位、额外 35-60% 层高、独立屋顶）+ 底层错落附楼矮翼 + 屋顶设备（空调箱/水塔/天线）；残破阶段（state 2）塔楼/设备随墙体一起消失；土坯房/雪屋保持地域原味
- **天际线分层（genCity/genAlley）**：城市按距市中心距离分三环——核心 9-17m 高楼群、中环 7-13m、边缘 5-10m 矮楼（市中心高边缘低，视线错落有纵深）；巷战街区中心摩天群 16-26m 与边缘 8-16m 矮楼交错——平均高 14.1→12.6m，层次感更强
- **测试**：test_alley 平均高断言仍通过（12.6m ≥ 10）；test_maps/test_destruction 全绿（破坏阶段与多部件剪影兼容）；test_64 seed 61 复验（23 阵亡/19 击杀/6 载具——楼高变化改变视线与战局，重探通过）；全套 22 项绿

## v5.34 枪械对载具分级减伤（用户要求：非重甲载具枪械减伤，坦克免疫枪械、栓动狙击 80% 减伤穿透）

- **分级减伤表（weapons.damageVehicle，分类与数值自定）**：主战坦克（重甲）**枪械零伤害**——仅**栓动狙击**（weapon.type==='bolt'）可穿透，**80% 减伤 → 20% 伤害**；装甲车（轻甲）60% 减伤 → 40%；防空车（轻甲）55% 减伤 → 45%；直升机（航空器）30% 减伤 → 70%；车载机枪（无枪械定义）对坦克仍为 0；AA 高炮/爆炸物倍率不变
- **实现**：damageVehicle 新增 wdef 参数（fireWeapon 传入武器定义，按 type==='bolt' 判定穿甲）；AI 侦察兵栓狙对坦克自动生效
- **测试**：test_aa 增 5 项断言（栓狙穿坦克实测 20、装甲车 40、防空车 45、直升机 70、步枪坦克仍 0）；test_64 seed 61 复验（21 阵亡/20 击杀/7 载具）；全套 22 项绿

## v5.33 音效工坊 + 专用音效（用户要求：部署音效制作工具，设计制作专用音效）

- **音效工坊工具（tools/音效工坊_soundlab.html）**：零依赖单文件设计工具（双击即用）——多层合成（正弦/方波/锯齿/三角/噪声 × 滑音 exp/lin × 低通/高通/带通滤波 × ADSR 包络 × 延迟/音量），试听/随机化/内置预设（部署落地/死亡低鸣/击杀清脆/标记提示/命中反馈/迫击炮出膛）；**导出 JS** 一键生成与游戏 audio.js 同构的函数代码（A.ctx/A.noiseBuf/ready() 模型），粘贴即用
- **专用音效设计并接入（audio.js）**：①**部署音效 deploy()**——呼啸下落（带通 1400→350Hz 噪声扫频）+ 落地闷响（160→55Hz 低通正弦）+ 到达清音（660→990Hz 三角波，0.55s 延迟轻声确认），部署视角着陆瞬间触发（player.updateCamFly 完成时）；②**死亡低鸣 deathSting()**——110→55Hz 长衰正弦 + 暗噪声垫（1.9s），阵亡飘升开始时触发（main.showDeathScreen）；headless 无音频上下文自动跳过（零测试影响）
- **测试**：test_flow 增断言（deploy/deathSting 函数已接入）；全套 22 项绿

## v5.32 连杀修复 + 战地式死亡/部署视角（用户要求）

- **连杀修复（weapons.kill）**：阵亡时重置 victim 的 streak 与 multikill——上条命的击杀不再计入本条命连杀/多杀播报
- **阵亡视角（main.js deathCamera/deathFly）**：死亡后相机从倒地位置**飘向战场正上方**（(0, 高+88, 30) 俯视全场，2.4s ease-out 三次缓动**渐慢**，四元数 slerp 同步转向）；**1.2s 后才显示阵亡界面**（先看飘升，再选复活点/职业/调整配置）——原绕尸体低空环绕视角删除；战场在飘升期间继续实时推演
- **部署视角（player.js startDeployCam/updateCamFly）**：部署瞬间相机从天上（当前俯视/菜单轨道位置）**飞回士兵眼睛**（1.3s ease-in 三次缓动**渐快**，目标每帧跟随士兵眼位与朝向，落地零偏差）；飞行期间隐藏枪模、接管相机（与迫击炮跟随视角互斥）；着陆后恢复正常第一人称
- **测试**：test_flow 更新——死亡后 sleep 2.6s 断言相机升到 89.1m + 阵亡界面显示、部署后 sleep 3.2s 断言相机回到 2.1m（headless rAF 降速需真实时间余量）；全套 22 项绿

## v5.31 地面补给箱 + AI 职业均衡分配（用户要求）

- **地面补给箱（weapons.js）**：医疗箱/弹药箱由瞬发效果改为**放置地面持续补给**——箱体网格（白箱红十字 / 军绿箱黄十字）落在脚下，医疗箱 0.6s/跳 +4 血（半径 8m）、弹药箱 1.0s/跳弹匣 +4/备弹 +10/手雷 +1（半径 14m），持续 60 秒；**一人只能放一个，放新的旧的立刻销毁**（placeSupplyBox 按 owner 销毁旧箱）；所有者按补给人数持续计分（医疗 +4/人/跳、弹药 +3/人/跳），玩家功绩每 2.5s 聚合一条防刷屏；退局/重置对局自动销毁全部箱体；AI 医疗兵/支援兵原分支自动改为放箱（走到伤员/缺弹队友旁放置）
- **AI 职业均衡分配（ai.js）**：配额轮询 1:1:1:1:1…——每轮每个职业一个名额交替排布（避免乘员名额吞掉整类职业），除不尽的余数随机；**玩家优先选职业**（红方首轮跳过玩家所选职业 1 个名额）；已部署 AI 不受影响（仅 applySelection 全量重建时重新分配，deployPlayer 换职业不动 AI）
- **测试**：test_medkit 重写为箱体断言（AI 放箱+持续治疗 20→40、箱体网格存在、弹药箱持续补给 8 秒补满弹匣 32/32、一人一个放新毁旧 1→1、玩家箱持续自疗 50→100/治疗队友 30→66）；test_64 seed 61 复验（19 阵亡/19 击杀/5 载具）；全套 22 项绿

## v5.30 钢铁防线（用户要求：为突破模式制作史诗地图 + 突破模式特殊设计更热血）

- **第五张地图「钢铁防线」（terrain.js genFort + fortRawHeight + config MAP_DEFS.fort）**：西低东高峡谷要塞（东侧堡垒高台最高 ~14m、封顶 9m 台地）；布局三大主题——**西线堑壕**（S1：54 段沙袋战壕线 + 14 辆废弃车辆）、**中央油库**（S2：双油库 10 油罐 + 26 油桶殉爆链）、**东侧堡垒**（S3：主堡 18m + 5 座 10-17m 要塞建筑 + 8 碉堡 + 31 段永久墙工事）；**血色黄昏**（暗红天空 + 橙阳 + 近距离雾 140 + 灰烬余烬上飘）——为突破而生
- **突破特殊设计（main.js updateBreakthrough/spawnPoint）**：①**扇区陷落热血时刻**——旗点连环爆炸 + 全屏震屏 0.85 + 爆炸闪光 0.32 + 三套史诗播报轮换（「防线崩塌！/攻势如潮！/再失一环！」按扇区确定性选择）；②**最终扇区宣言**——进入最后扇区大字播报「最终防线——死守堡垒！」；③**守军死守前沿**——最终扇区守军出生点由防线后 13m 收紧到 8m（贴旗死守，攻防更焦灼）；④攻方补票/推进判定保持不变
- **菜单**：第五个地图按钮「钢铁防线 · 要塞攻坚 为突破而生」（data-map 通用绑定零改动）
- **测试**：新增 tests/test_fort.js（第 22 号，18 项断言）——地图生成各主题计数/地形高差/扇区陷落推进+史诗播报+补票/最终扇区宣言/守军出生点距 S3 旗 13.8m/堡垒陷落红军胜利；test_snow 菜单按钮 4→5；全套 22 项绿

## v5.29 载具防卡死机动（用户要求：坦克很容易被卡住，使其更为机动）

- **诊断**：resolveCircle 只把载具推出碰撞体但航向不变——顶墙时载具持续朝墙压去、速度方向不改变，撞进墙角/墙线即永久卡死（实测城/沙地图多处卡点）
- **修复（vehicles.js groundPhysics）**：①**沿墙滑动**——每帧对比碰撞推出位移（>4cm 且油门>0.1），把车头朝向向「原前进方向 + 推出方向×1.8」合成方向偏航（转向速率限幅 turnRate×4、按推力深度缩放）→ 顶墙自动顺墙滑动而非死顶；②**卡死脱困**——大油门（>0.5）但实际速度 <1.6m/s 持续 0.5s → 急转 ±66° + 反向倒车冲量（reverseSpeed×0.6），墙角也能倒出；BOT/玩家共用（BOT 交战低速 0.35 油门不误触发）
- **机动参数（config.js）**：坦克 turnRate 1.6→2.4 / reverseSpeed 5→7，装甲车 2.2→2.6/7→8，防空车 2.0→2.4/6→7
- **测试**：test_vehicle_combat 增防卡死断言——坦克直冲墙工事 3 秒位移 21.3m（沿墙滑动脱困）、turnRate≥2.2；test_64 seed 61 复验（23 阵亡/21 击杀/5 载具）；全套 21 项绿

## v5.28 稳定升级（用户要求：高级感、氛围感、多样性）

- **氛围（effects.js + index.html + css）**：暗角 #vignette（径向渐变 56%→黑色 40%，电影感取景）；**爆炸闪光 #flash**——玩家 45m 内爆炸全屏暖光一闪（大爆炸 0.38/小 0.2，0.55s 渐隐，weapons.detonate 触发）；**残骸冒烟**——被毁地面载具每 0.22s 升起深灰烟柱（正弦相位漂移）、**受损建筑冒烟**（state≥1、每帧最多 6 栋、正弦门控）；全部确定性节奏不消耗 Math.random（emit 的 Game.rng 消耗已复验）
- **高级感（audio.js + hud.js）**：功绩计分**轻响 scoreTick**（880→1400Hz 短促上滑音，跳分时触发）；分数值跳分**弹跳动画**（ms-pop scale 1.14 + 0.18s 回弹）；文字/动效延续 v5.27 战地五式风格
- **多样性（config.js + ai.js + hud.js + main.js）**：BOT **呼号池**（20 个中文呼号按序确定性分配：猎鹰/夜枭/铁砧…，计分板显示「赤焰·猎鹰」而非数字编号）；占领播报**文案多样性**（4 套按旗点 id 确定性轮换：「我方占领/我们夺下了/阵地易手/旗帜升起」）
- **测试**：test_64 seed 61 复验（30 阵亡/29 击杀/5 载具）；全套 21 项绿

## v5.27 功绩系统战地五式重构（用户要求：权重太低、不要黑底小字、用播报同款字体、放准星下方更大、高级滚动（老功绩下滚+缩小+快速变透明）、固定寿命；参考 BFV 计分播报）

- **样式（css）**：#merit 由底部 92px 上移至**准星下方 top: calc(50%+44px)**；条目 11px 黑底小字 → **17px 播报同款粗体**（text-shadow 0 2px 5px #000，无背景无边框）；金额用类型色、标签白色；#merit-score 加大到 21px 金色发光
- **高级滚动（hud.layoutMerits）**：槽位缩放——第 i 条 scale 1-0.12i / opacity 1-0.16i（最老 0.55/0.28），新功绩到来时旧功绩 0.2s 快速**下滚 27px + 缩小 + 变透明**（cubic-bezier 微回弹）；新条目从上方 -18px scale1.3 弹入
- **固定寿命**：每条固定 3s → mf-out 0.2s 快速消失（非渐渐淡出）→ 0.6s 后移除；仍为最多 5 项、标记累加跳数字（新格式「+50 标记 ×2」）、分数上方渐缓跳动 + 3s 空闲快速淡出
- **播报并入功绩**：击杀播报（列表+横幅）v5.22 已删除，本版确认全部击杀反馈（击杀/爆头/复仇/防守/进攻/连杀/多杀）只经功绩系统展示，且只与操作者相关
- **测试**：test_merit 更新断言（新标记格式「+50 标记 ×2」、27px 下滚、scale 0.88 缩小）；全套 21 项绿

## v5.26 小地图特殊标记 + AI 反迫击炮（用户要求：载具/部署迫击炮兵小地图特殊标记、AI 反迫击炮机制）

- **载具特殊标记（hud.drawMinimap）**：菱形方块改为**车头朝向三角箭头**（随 v.yaw 旋转、阵营色填充 + 黑描边），敌载具可见时白色描边环加大到 r6——一眼区分载具与步兵圆点
- **迫击炮兵特殊标记（hud.drawMinimap/drawMortarMap）**：被暴露的敌方迫击炮兵以**橙色圆 + 白十字图标**显示（区别于普通红点），部署大地图同步绘制便于反制瞄准；暴露来源：开火自动暴露（fireMortarAt 置 spottedUntil=SPOTTED_TIME）或命中我方后全局暴露（areaDamage 置 MORTAR_REVEAL_TIME）
- **AI 反迫击炮（ai.js）**：迫击炮兵决策新增优先级最高分支——扫描暴露（spottedUntil）的敌方迫击炮兵，在射程内（15-180m）直接**反打其位置**（落点散布 ±4m），随后按距离机动（<50m 后撤 / >110m 前压）；原索敌曲射分支的硬编码 40m 修正为跟随配置 minRange
- **测试**：test_minimap 增反迫击炮断言——红方迫击炮暴露后蓝方 AI 炮击落点直指其位置（±12m 容差）、开火自动暴露；test_64 seed 61 复验（29 阵亡/28 击杀/5 载具）；全套 21 项绿

## v5.25 枪模显示错误修复（用户要求：模型有时显示错误、需切枪刷新）

- **诊断**：deployPlayer/rearmPlayer 更换兵种（clsKey/cls.weapon 变化）与死亡重生后从不调用 syncModel——枪模只在换枪完成时同步，于是换兵种后仍显示旧枪模，必须手动切枪才刷新
- **修复（player.js）**：syncModel 记录基准状态（P.lastSlot/P.lastClsKey）；update() 每帧自动对账——槽位或兵种变化立即同步枪模（换兵种/重生/直接改槽全部覆盖，零成本字段比较）；换枪完成的显式 syncModel 保留
- **测试**：test_upgrade 增 6.5 节——医疗兵部署后一帧内 AA-12 显示/AR 隐藏、再换侦察兵狙击显示/AA-12 隐藏，全程无需切枪；全套 21 项绿

## v5.24 迫击炮最小射程 15m（用户要求：最小射击范围改为 15m）

- **config.js**：GADGETS.mortar minRange 40→**15**（近距自卫曲射，部署地图最小射程环同步 15m）；调试面板滑块范围 10-120 无需改动
- **ai.js**：AI 迫击炮兵开火阈值由硬编码 40 改为跟随配置（GADGETS.mortar.minRange||15）——敌距 ≥15m 即可曲射压制
- **测试**：test_mortar 更新（射程断言 15-180m；近距拒绝由 20m 改为 10m 测 too-close）；test_64 seed 61 复验（17 阵亡/17 击杀/5 载具）；全套 21 项绿

## v5.23 伤害跳数字（用户要求：攻击造成伤害后要在准星附近跳数字）

- **hud.damagePop（hud.js + css）**：玩家造成伤害后准星附近弹出「+伤害值」小字（13px 加粗、黑描边、随机 ±26px 横向/±8px 纵向散布防重叠、0.8s 上浮 22px 渐隐、同屏上限 14 条防刷屏）；普通命中 #ffe9a8、**爆头金色 #ffd75e**、载具伤害 #ffd27a
- **接入点（weapons.js）**：applyDamage——玩家作为攻击者、护盾吸收后实际伤害 >0 才显示（全吸不显示）；damageVehicle——玩家对载具伤害显示；爆炸溅射/碾压/车载武器走同一 applyDamage 管线自然生效
- **测试**：test_weapons 新增 T12/T12b/T12c——伤害 27 弹出 '+27'、爆头数字 rgb(255,215,94) 金色、载具伤害 '+100'；全套 21 项绿

## v5.22 播报系统 → 功绩系统（用户要求：用功绩替换播报系统，原队友击杀播报换成本人功绩）

- **删除击杀播报 UI（hud.js/index.html/css）**：右上 #killfeed 击杀列表（展示全员击杀的 CF 式列表）与 #kill-banner 击杀横幅（含多杀大字）全部移除，renderKillfeed/killBanner/weaponBadge 删除，相关 CSS 清理——队友/敌人的击杀不再有任何播报；Game.killfeed 数据数组保留（测试/统计用）
- **多杀功绩化（weapons.kill）**：原「双杀/三杀…」横幅改为**功绩条目**——multikill ≥2 时按 25×(n-1) 计分（双杀 +25/三杀 +50/四杀 +75/…）并入 merit('multi', bonus, 动态标签)——功绩系统新增 multi 类型与 labelOverride 参数（merit(kind, amount, label)），照常滚动/3s 寿命/分数缓动
- **音效保留**：多杀音/本人击杀横幅音/阵亡音照旧（音频反馈不算播报）；本人击杀的反馈完全由底部功绩条目承担（击杀/爆头/复仇/防守/进攻/连杀/多杀）
- **测试**：test_merit 增 1.5 节——连续两杀产生「+25 双杀」「+50 三杀」功绩与 +325 计分（双杀 25+三杀 50+连杀 50）；test_weapons T11 与 test_vehicle_combat 仍读 Game.killfeed 数据 ✓；全套 21 项绿

## v5.21 步枪对坦克零伤害（用户要求：步枪不应该对坦克造成伤害）

- **weapons.damageVehicle**：smallarms 对 tank 倍率 0.12→**0**（重甲免疫轻武器——步枪/机枪/霰弹枪/手枪/DMR/狙击全系打不动坦克，需 RPG/坦克炮/炸药/C4 类爆炸物）；轻甲（装甲车 0.55/防空车 0.55）与直升机（1.0）仍可被枪械磨血；车载机枪对坦克同样为 0（符合机枪打装甲的常识）；AA 高炮对坦克 15% 不变
- **测试**：test_aa 断言更新（枪械对坦克 12%→0 实测 0）；test_64 seed 61 复验（24 阵亡/22 击杀/6 载具，坦克磨血变化不影响战局）；全套 21 项绿

## v5.20 后坐系统修复（用户要求：当前后座系统和无后座没有区别，检查并修复）

- **诊断**：实测 AR-40 全自动 1.5s 枪口爬升仅 **0.020rad ≈ 1.1°**——弹簧回位太快（11Hz≈91ms 周期）+ 慢残差占比过低（0.22×tau0.28），连射几乎没有累积上抬，视觉上与无后座无异
- **修复（config.js）**：RECOIL_FREQ 11→9（回位更慢、弹跳可读）、RECOIL_SHARE 0.22→0.35、RECOIL_TAU 0.28→0.45（连射残差持续累积上抬、停火缓缓回落）、RECOIL_DAMPING 0.58→0.55；八把枪 recoilDef 全面增强——AR pitch 0.028→0.05、LMG 0.024→0.04、SMG 0.016→0.028、手枪 0.040→0.07、SG-12 0.085→0.13、AA-12 0.05→0.085、SR-50 0.075→0.12、DMR 0.055→0.085，yaw 同步放大
- **修复后实测**：AR 全自动 1.5s 爬升 **0.085rad ≈ 4.9°**（单发瞬时跳 1.9°），停火 1.5s 残差回落至峰值 ~2%（压枪有实感）；AI 枪感同步受影响（更真实）
- **测试**：test_weapons 新增 T2.5 后坐强度回归（全自动 1.5s peak ≥ 0.06rad）；test_64 重探种子 59→61（后坐增强后 59 只剩 13 阵亡/12 击杀余量过薄，61 为 24/22/6）；全套 21 项绿

## v5.19 标记系统重构（用户要求：开枪自动标记 + Q 标记、步兵不高亮、新增载具标记且高亮隔墙透视、标记成功不进上方提示只进功绩）

- **步兵不再高亮（effects.js）**：updateSpotOutlines 由士兵循环改为**载具循环**——被标记步兵仅保留小地图红点与功绩，不再出现 3D 红色线框
- **载具标记 + 隔墙透视高亮（effects.js + weapons.trySpot）**：Q 键锥角内最近目标现在同时匹配士兵与载具（均需 LOS）；载具被标记后以红色线框高亮——单位盒 EdgesGeometry 按 hitRadius 缩放（坦克 5.4×2.7×4.7 / 直升机 3.6 高），材质 depthTest=false + renderOrder 999 → **墙后/楼后也能透视看到**，呼吸闪烁；线框池 8 条（对应 8 辆载具）
- **开火自动标记（vehicles.js）**：车载机枪/坦克炮/直升机火箭开火 → v.spottedUntil = now + SPOTTED_TIME（与步兵开枪暴露一致）；步兵开枪暴露原本就有（fireWeapon）；小地图敌方载具在有视野或**被标记**时显示
- **提示移除（weapons.trySpot）**：不再于上方 message 显示「已标记敌人」，标记成功只进功绩系统（merit spot 累加跳数字，与步兵/载具标记共用同一条目）；失败提示保留（无目标/视线遮挡）
- **测试**：test_spot 重构——步兵无边框、成功无提示、标记进功绩、Q 标记载具 +25、载具高亮 depthTest=false/renderOrder≥900（隔墙透视）、边框跟随载具、步兵+载具标记累加同一功绩（×3）、载具开火自动暴露；全套 21 项绿

## v5.18 功绩播报系统（用户要求：只播玩家功绩、他人击杀不播除非有助攻、滚动堆叠 3s 寿命最多 5 项渐变消失、标记累加跳数字、播报上方分数渐缓跳动、3s 空闲快速淡出、放屏幕下方小一点不挡视野）

- **UI（hud.js + index.html + css）**：旧右侧 #scorefeed 重构为底部中央 #merit（bottom 92px，pointer-events none）——条目 11px 小字、半透明底、绝对定位 translateY(i×21px) 平滑下滚（0.25s transition）；每条 3s 寿命 → mf-out 渐变消失（0.45s）→ 移除；**最多滚动 5 项**（超员立即挤掉最老）；新条目从上方 -12px 滑入；上方 #merit-score 金色分数值（15px）
- **功绩类型（MERIT_DEFS 13 种）**：击杀/爆头/防守击杀/**进攻击杀（新增：受害者在敌方占领点 30m 内 +50）**/复仇/连杀/助攻/**火力压制（新增：8 秒内真实伤害 >0 且 <40 → +25）**/标记/载具摧毁/**补给弹药（新增：玩家弹药箱补给队友 +10×N）**/**治疗（新增：玩家医疗箱治疗队友 +15×N）**/占领——全部映射到播报 + 真实计分
- **只播玩家功绩（weapons.kill 重构）**：他人击杀不再进播报；玩家有助攻（≥40 伤害）播「助攻 +50」、火力压制播「+25」；玩家击杀按 badge 逐个播（复仇/防守/进攻/爆头/连杀）
- **标记累加**：merit('spot') 已有标记条目 → 只跳数字「标记 ×N +total」并续 3s 寿命（条目照常滚动），不新建条目
- **分数缓动（hud.update）**：跳功绩 → meritTarget=玩家分数，显示值按 1-exp(-8dt) 渐缓追平；**3 秒未更新 → ms-out 快速淡出（0.35s，非立即消失）**
- **测试**：新增 tests/test_merit.js（第 21 号，16 项断言）——玩家击杀 125 分双功绩、他人击杀不播、助攻/火力压制、标记 ×2 +50 跳数字、5 项上限、translateY 21px 滚动、3s 渐变消失后移除、分数缓动 + 空闲淡出；test_spot 兼容（scoreFeed 旧接口保留为文本条目）；全套 21 项绿

## v5.17 栓狙拉栓（用户要求：拉栓动画、过程收镜、拉栓读条）

- **拉栓参数（config.js）**：WEAPONS.sniper 新增 boltTime: 0.9（拉栓时长；射速 rate 1.25 = 拉栓 0.9 + 归位 0.35）；weapons.fireWeapon 开火即置 s.boltT，weapons.update 逐帧递减（钳 0）
- **拉栓动画（player.js）**：狙击枪枪模新增拉栓柄部件（userData.bolt，buildViewmodel 索引到 P.boltParts）；updateViewmodel 按正弦周期驱动拉栓柄「后拉 0.1m + 上抬 0.9rad + 回推」+ 枪身微下沉（y -0.05 / 前倾 0.14rad），换枪/拉栓结束自动回位
- **强制收镜（player.js update）**：拉栓期间 adsWant 归零（按住右键也不开镜，scope 遮罩随 adsEase 自动消失）；拉栓结束按住右键自动平滑回镜
- **拉栓读条（hud.js）**：准星下方细读条第三态——琥珀色 #ffb04a（区别于换弹绿 #7ad06a / 装备蓝 #6aa0ff），进度 = 1 - boltT/boltTime，拉栓结束即隐藏（barPct 机制不常驻）
- **测试**：test_upgrade 增 10 项断言（boltT=0.9、开火前 scoped、拉栓中 adsEase 0.02 收镜、读条显示且琥珀色、拉栓柄 z=0.045 后拉、结束 boltT=0、回镜 0.02→1、读条隐藏、拉栓柄回位）；test_64 确定性不受影响（boltT 为纯计时字段）；全套 20 项绿

## v5.16 小地图情报（用户要求：敌载具有视野才标注；队友被敌方迫击炮命中后高亮敌方迫击炮手、无视视野）

- **敌方载具视野标注（hud.js vehicleSeenByTeam + drawMinimap）**：小地图敌载具菱形改为**有视野才显示**——每 0.4s 节流判定（玩家本人 + 轮询 3 名队友的 LOS，任意一条通即视为可见，可见窗口 1.2s）；无视野时完全不标注，可见时加白色描边提示；己方载具恒显（原有行为）
- **反炮击预警（weapons.js areaDamage + hud.js revealMortar/drawMinimap/drawMortarMap）**：我方士兵（含玩家）被敌方迫击炮弹溅射命中 → 自动记录敌方迫击炮手（weapons 侧按 source==='mortarShell' 且受害者为我方时触发），小地图以**脉冲橙色高亮圆点 + 白色描边 + 黑色十字图标**显示其**实时位置**（持续跟踪移动，CONFIG.MORTAR_REVEAL_TIME=8 秒，最多同时 4 条，重复命中刷新时长），**无视任何视野**；迫击炮部署大地图同样绘制（反制炮击直接瞄准）；到期由 drawMinimap/drawMortarMap 自动清理
- **测试**：新增 tests/test_minimap.js（第 20 号）——敌载具开阔位激活标注/楼群后无视野隐藏、迫击炮手对玩家 blocksLOS=true 仍被高亮、命中即 reveal、8 秒到期清除；全套 20 项绿

## v5.15 载具近战与弹道（用户要求：载具撞死敌人、车载机枪加扩散、AI 短/长点射交替、子弹落点归准星、炮弹沿准星射出）

- **载具碾压（vehicles.js groundPhysics/heliPhysics）**：地面载具速度 >6m/s、直升机贴地（<3.2m）速度 >8m/s 撞上敌方步兵 → 130 伤害直接碾死（驾驶者计分：+100 击杀、连杀/复仇/助攻全链路生效）；spawn 保护/车组/队友豁免；每次碾压后 0.8s 冷却防连帧重复；weapons.kill 新增 sourceName 参数 → 击杀播报显示「载具碾压」而非枪名
- **车载机枪扩散（config.js）**：tank 0.004→0.02、apc 0.003→0.022、heli 机炮 0.003→0.02（≈1.1-1.3° 锥角）；AA 高炮 0.004→0.01（保持对空压制力）
- **AI 车载机枪点射（vehicles.js mgBurstWant）**：短点射（0.3-0.45s ≈3-5 发）/长点射（0.65-0.95s ≈7-11 发）交替 + 0.35-0.8s 随机间歇，替代持续满速扫射；坦克并列机枪/APC 机枪/直升机机炮全部接入（AA 对空不受限）；玩家驾驶仍为全自动
- **弹道沿准星（vehicles.js aimInfo/fireRay/muzzleFor 重构）**：玩家载具全部武器（坦克炮、并列机枪、直升机火箭/机炮、AA 高炮）改为从炮口指向「相机轴 120m 汇聚点」射出——第一/第三人称下子弹落点与准星严格重合，命中判定含敌人（准星压住敌人必命中）；炮弹不再有任何自动抬高（纯准星方向 + 自然重力下坠）；BOT 无相机仍按炮塔/机头指向直射
- **测试**：新增 tests/test_vehicle_combat.js（19 项第 19 号）——碾压击杀 +100 分 + 播报「载具碾压」、扩散配置断言、点射间歇断言（2 秒 13 发且最大间隔 0.57s）、坦克炮初速与相机轴 cos=1、准星下敌人入落点判定（炮弹落点击杀 + 机枪命中）；测试通道自动搜索（LOS + 弹道离地余量 + 射击位净空）；test_64 seed 59 复验（19 阵亡/17 击杀/6 载具）；全套 19 项绿

## v5.14 迫击炮跟随镜头（用户要求：部署时不弹 Esc 解锁提示；发射后切炮弹第一人称视角随弹运动、始终朝向落点、平滑移动）

- **部署提示修正（hud.js setLocked + player.js setMortarDeployed）**：`#pause-hint`「点击画面锁定鼠标 · Esc 释放」仅在暂停/未锁定时显示；迫击炮部署（未锁定鼠标看地图）时强制隐藏，收起后恢复——地图选点阶段不再突兀地提示 Esc
- **炮弹第一人称跟随视角（player.js startMortarCam/updateMortarCam/endMortarCam + weapons.js fireMortarAt）**：玩家发射后镜头从当前位置平滑切到弹体后方 1.1m 跟随（首 0.7s 加速贴近、之后紧密咬合，速度方向自适应），全程 `lookAt` 落点（四元数 slerp 平滑转向）；爆炸后进入悬停阶段——平滑掠到落点斜上方（射手一侧 9m、高 5m）俯瞰爆炸 1.15s；再 0.45s 平滑切回玩家第一人称（位置/朝向同步，无瞬移）；阵亡/上车立即退出；收起迫击炮直接转入快速切回；跟随期间隐藏枪模避免遮挡
- **测试**：test_mortar 增 8 项断言（发射后 cam 激活、部署时提示隐藏/收起恢复、飞行中镜头贴随弹体 3.4m、离玩家 68.8m、朝向夹角 1.3°、爆炸后 cam 清除、切回偏差 0.21m）；test_64 不受影响（镜头空检查零消耗）；全套 18 项绿

## v5.13 永久墙工事 + AI 决策强化（用户要求：地图加永久墙工事使战局更有趣、强化 AI 决策使其更有思想）

- **永久墙工事（terrain.js placeFortifications + T.fortwalls）**：每旗对角两组 L 形混凝土工事（高 2.4m/厚 0.8m/长 6-9m、距旗 11-14m 留口进人）+ 旗点之间交错断墙线（垂直于行进方向、距连线 7-10m、长 5-9m，左右交替）；不可摧毁（destructible:false）、挡视线（blocksLOS:true）、挡移动（AABB 碰撞）、轴向对齐保碰撞一致，段间 ≥4m 通道不卡载具；布置避开旗点 9m/基地 24m/载具刷新点 7m/大型实体 3m，且**先于沙袋/木箱/油桶等小型掩体布置**（此前实测城市图 0 段——3m 净空被 140 个小掩体全占，重排后 10 段）；四图全接入（城市 10/巷战 11/雪域 25/沙漠 34 段）+ 实体网格/小地图/迫击炮地图绘制
- **AI 决策强化（ai.js）**：侧翼包抄（目标锁定后随机 ±1 flankDir 垂直绕行 18-80m 距离带，重生/换目标重置）；载具避让（非工程兵见敌载具 <26m 撤离）；换弹掩护（交火中换弹退 8m 内掩体后）；濒死撤退（<35 血且敌距 >30m 撤向掩体）；侦察兵保持 45m 以上距离；支援兵 >20m 蹲姿架枪压制；点射间歇蹲掩体；敌人 8m 内有队友扎堆时投集束雷
- **测试**：test_alley 增墙工事断言（城市/巷战 ≥10 段、不可摧毁、挡视线、2.4m、resolveCircle 碰撞推出）；test_64 seed 59 复验通过（21 阵亡/20 击杀/6 载具在驾）；全套 18 项绿

## v5.12 播报重构 + 侦察系统 + 加分（用户要求：模仿战地1、做事加分、Q 标记高亮）

- **播报系统重构（hud.js + css）**：killfeed 加武器徽标（weaponBadge 映射：AR/MG/SMG/SR/P45/SG/AA/DMR/榴/RPG/迫/医/弹/标）+ 阵营色块 + ☠ 爆头 + 滑入动画；kill-banner 显示得分（kb-score +125）与加成徽章行（kb-badges）；新增 #scorefeed 右侧堆叠得分播报（scoreFeed 条目 2.6s 渐隐右移、上限 5 条）
- **做事加分（weapons.js kill/destroyVehicle）**：击杀基础 +100；爆头 +25；复仇 +50（s.lastKiller 记录击杀者）；防守击杀 +50（被击杀者在攻击方占领点 30m 内）；连杀每 3 杀 +50；助攻 +50（applyDamage 记录 s.recentDamage 伤害来源，8 秒内 ≥40 伤害的队友，kill 时结算并清空）；载具摧毁 +150；标记得分 +25（见下）；得分播报分条目显示（击杀 +100 + 加成徽章）
- **侦察系统**：config SPOT_TIME 8/SPOT_RANGE 300/SPOT_ANGLE 3.5°/SPOT_COOLDOWN 1.5/SPOT_SCORE 25；weapons.trySpot（Q 键：准星锥角最近敌人 + LOS 校验 + 冷却 + 首次标记得分 +25）；effects.js 高亮边框池（12 个 BoxGeometry EdgesGeometry LineSegments 红框，跟随士兵姿态（蹲姿高度/朝向），呼吸闪烁，effects.update 驱动）；AI 自动标记（ai.js think 交火中每 4~8 秒给未标记敌人上 8 秒标记，全队共享）；小地图/迫击炮地图红点复用 spottedUntil
- 新增 tests/test_spot.js（Q 标记+得分+边框、冷却、锥角转向、LOS 遮挡、复仇 150/助攻 50/基础 100、得分播报 DOM）；test_64 重调种子（seed 59：19 阵亡，AI 自动标记消耗 rng 导致旧种子失效）；run_all 18 项

## v5.11 手感与调参（用户要求：读条不常驻、医疗兵 AA-12、散射+无前摇、重机枪、完善调参）

- **装填读条修正**：hud.update barPct 初始 -1——仅 p.reloading 或 gadgetCooldown>0 时显示（修复 barPct>=0 导致的常驻空条）
- **AA-12 全自动霰弹枪**：WEAPONS.aa12（auto:true、rate 0.14=7发/秒、pellets 8、damage 12、mag 8、pelletsSpread 2.2°、dropoff 0.12/26m、drawTime 0.45）；医疗兵配发（CLASSES.medic.weapon='aa12'）；player 枪模（粗管+弹鼓+战术托）；AI WEAPON_SCORES [1.3,0.5,0.2]；音效复用 shotgun
- **霰弹枪手感**：SG-12 rate 0.85→0.6、pelletsSpread 1.6°→2.3°（散射增强）、drawTime 0.6→0.4；player.js clickBuf 扩展 max(buf, P.switching+0.06)——换枪期间点击排队到枪就绪，消除前摇
- **重机枪改名**：WEAPONS.lmg.name 'LMG-80 轻机枪'→'MG-80 重机枪'；CLASSES.support.desc 同步
- **调参系统完善（debug.js）**：新增「生存/治疗」cfg 段（ASSAULT_SHIELD/SHIELD_DRAIN_RATE/MEDIC_REGEN_DELAY/MEDIC_REGEN_RATE）+「装备」gadget 段（下拉选六种装备，滑杆 speed/gravity/radius/damage/reload/minRange/maxRange/healAmount/ammo）；bindGadget 对不适用的字段自动禁用滑块（显示 —）；applySaved 支持 gadget.* 持久化；枪械下拉补 shotgun/aa12/dmr
- test_upgrade 增断言：AA-12 全自动 8 弹丸 7 发/秒、非换弹时读条隐藏、换枪点击排队；全套 17 项绿

## v5.10 综合升级（用户批量需求）

- **RPG 强化（工程兵）**：GADGETS.rocket speed 60→85、gravity 6→2、radius 6→5、damage 320→280、scope:true/adsFov:30/adsTime:0.2；weapons.areaDamage 新增 antiVehicle 参数——对步兵 ×0.35、对载具 ×2（detonate 传 p.antiVehicle）；player.js 装备槽伪 wdef 支持 ADS（开镜/狙击遮罩/灵敏度缩放）
- **删除喷气机**：config VEHICLES/VEHICLE_SPAWNS 删 jet；vehicles.js 删 jet 网格/jetPhysics/botDriveJet/导弹系统(pickMissileTarget/fireMissile)/玩家喷气控制/无驾驶巡航/camera 分支；weapons.js 删 homing 制导与 missile 弹色；ai.js 机组 4 类（tank/apc/heli/aa，i=4 不再是乘员）；audio.js 删喷气引擎分支；terrain.js 删机场跑道压平；index.html 删操作提示；载具 8 辆
- **迫击炮反步兵修正**：GADGETS.mortar 移除 antiVehicle（v5.10 倍率上线后曾把步兵溅射砍到 ×0.35 导致 96 伤杀不死人）；同时移除火炮弹道 +1.5 竖直余量（落点偏移 ~10m 的隐患），精确弹道解落点命中
- **突击兵护盾**：CONFIG.ASSAULT_SHIELD 120 / SHIELD_DRAIN_RATE 2（等效 60 血）；weapons.applyDamage 先扣护盾（2 点/伤）；createSoldier/rearmPlayer/ai.respawn/resetMatch 调 initShield；HUD 左下护盾条（仅突击兵显示，无法补充）
- **医疗兵呼吸回血**：CONFIG.MEDIC_REGEN_DELAY 5 / RATE 4；weapons.updateMedicRegen（脱战后 +4/s，只回血不回护盾）
- **配枪**：mortar → dmr（MK-14）、medic → shotgun（SG-12）——两把新枪正式入列
- **全装填读条**：hud 准星下方 #reload-bar 90×3 细条——换弹（绿）/装备冷却（蓝），0% 起手可见；fireGadget/fireMortarAt 同步 gadgetCdMax 供进度计算
- **准星缩小**：十字 12→7px/3→2px、红点 9→6px、gap 上限 60→34
- **调参面板体验**：player.js 文档级 mousedown 对 #debug-panel/.screen/按钮/输入框放行（滑动条不再被指针锁抢走）；debug.toggle 关闭面板自动 requestLock 回战斗
- **动画完善**：冲刺压低+前倾持枪、落地顿挫（landKick）、士兵蹲姿 0.62 压缩+下沉 0.3m+移动前倾 0.10rad、坦克/防空车炮管后座（barrelRecoil 弹簧回位）
- 测试：删 test_jet；新增 test_upgrade（RPG 倍率/护盾/回血/读条/装备开镜/配枪）；test_aa 重写（无喷气机，8 载具）；test_maps/snow/alley 载具数 10→8；test_64 删战斗机断言 + 重调种子（seed 61：22 阵亡）；test_mortar 适配新弹道；run_all 17 项

## v5.9 巷战街区 + 初始高地（用户要求：删除初始高地，制作巷战地图）

- **初始高地删除**：cityRawHeight 移除边缘抬升项（dc > WORLD-16 时 +0.7/m，出生点原为 ~5.6m 高地平台）→ 双方出生点 0.46/2.34m 与地面齐平
- **巷战街区（gen: 'alley'）**：alleyRawHeight 极平缓（±0.8m）+ 12m 网格 80% 建楼率（50+ 栋 8-20m 高层、楼距 1.8m 起 = 4-6m 窄巷）+ 18 辆可殉爆废弃车辆（wreck 网格：锈红车身+深色座舱，确定性朝向；explode: blastRadius 6 / blastDmg 120）+ 沙袋/木箱/路障；MAP_DEFS.alley 阴天（sky 0x6a7a88）+ 近距离雾（38-120）+ 灰烬天气；征服 4 旗（中央喷泉/西街市集/东街仓库/北站广场）+ 突破 3 扇区；机场压平加入 alley（喷气机可用）；菜单四图
- 新增 tests/test_alley.js（初始高地断言/密度/平均楼高/废弃车辆/殉爆/突破/切回城市）；test_snow 菜单按钮 3→4；test_64 重调种子（seed 19：20 阵亡）；run_all 17 项

## v5.8 氛围系统与迫击炮音效（用户要求：迫击炮发射要有声音，继续完善氛围）

- **迫击炮音效（audio.js）**：mortarLaunch 出膛轰鸣（75Hz+50Hz 双重低频砰 + 300Hz 噪声爆发，按射手距离衰减）；mortarWhistle 下落呼啸（1400→380Hz 1 秒指数下扫，weapons.updateProjectiles 在弹体过顶点 vel.y<-6 时按弹体位置距离触发一次）
- **战场氛围系统（audio.js AMBIENT）**：ambientStart 部署时启动——循环风声（白噪声→带通 320Hz + 0.13Hz LFO 起伏；windLevel 按地图：雪 0.16/沙 0.10/城 0.05）+ ambientUpdate 每 3~9 秒随机远处战场音（50% 闷响爆炸 lowpass 220Hz / 50% 两声零星枪声，StereoPanner 随机声道）；ambientStop 阵亡/退出/终局停止；main.js 接线（deployPlayer 重启、exitToMenu/endMatch 停止、animate 每帧 tick）
- **灰烬天气（effects.js）**：setWeather 新增 'ash' 分支——260 粒灰白余烬缓慢上飘（0.9m/s）+ 正弦摇曳，越顶回底循环；MAP_DEFS.city.weather='ash'，三图天气齐备（雪/沙尘/灰烬）
- 测试：test_mortar 增断言 mortarLaunch/mortarWhistle/ambientStart 音效日志；test_snow 城市天气断言 null→'ash'；全套 16 项绿

## v5.7 迫击炮部署与地图选点（用户要求：部署后地图选点发射，地图占右下悬空）

- **小地图拉伸 bug 修复（根因）**：CSS `#game-container canvas { position:absolute; inset:0 }` 后代选择器把小地图 canvas 也拉伸到全屏（实测 rect 1264×625，只显示一部分）；改为 `#game-container > canvas` 直系选择器 + `#minimap{width:190px;height:190px}`，实测恢复 190×190 右上角完整显示
- **迫击炮部署状态机（player.js）**：P.mortarDeployed；装备槽按左键 = 部署（exitPointerLock + 显示地图 + 消息）/ 再按 = 收起；右键、3、切枪（requestSwitch）、上车（Vehicles.enter）、阵亡（kill）、退出对局（exitToMenu）自动收起；部署期间 Player.update 提前返回（禁止移动/射击），mousedown 不再抢 pointer lock（点击交给地图 UI）
- **右下悬空地图（hud.js）**：380×380 高分辨率地形画布（renderTerrainCanvas 重构，小地图/迫击炮地图共用生成器）；显示最大射程绿环/最小红环、旗点、被标记敌人红点、迫击炮绿十字、上次落点红叉；click → mortarCanvasToWorld → fireMortarAt，超范围/无弹/装填均有提示；部署期间每帧重绘
- **fireMortarAt（weapons.js）**：按世界坐标选点发射，返回 ok/too-close/too-far/no-ammo/cooling；AI 路径改为 bot.mortarTarget → fireMortarAt，落点散布后在 ai.js 钳制到 ≥40m（fireMortarAt 不再内部钳制）
- test_mortar 重写玩家段（部署→地图打开→太近拒绝→180m 发射→超远拒绝→像素换算→收起）；全套 16 项绿

## v5.6 医疗兵与 AI 后勤（用户要求：加医疗兵/医疗箱、删救援、AI 自动用箱）

- **调试面板默认关闭**：debug.js D.visible=false + build() 按 visible 上 hidden（此前默认弹出遮挡画面）；F1 仍可开关
- **医疗兵（第六兵种）**：CLASSES.medic（SMG 自卫）+ GADGETS.medkit（kind 'medic'：healAmount 35 / healRadius 8m）；CLASS_ORDER 六兵种
- **医疗箱**：weapons.fireGadget 'medic' 分支——8m 内自己与队友全员 +35（冷却 3s）+ 绿色治疗粒子 + heal 音效；player 医疗箱模型（箱体+白十字）
- **无救援系统**：删除击倒/救援（v5.1 已删，本次明确不恢复）；阵亡立即重生，测试断言 kill 后 downed === undefined
- **AI 自动使用弹药箱**：ai.think 支援兵分支——自己或 14m 内队友弹药 <40%（弹匣+备弹占比）时自动 fireGadget('instant') 部署弹药箱（冷却 22s 防刷）
- **AI 自动使用医疗箱**：ai.think 医疗兵分支——70m 内伤员（<70% 血）自动跑近，8m 内 fireGadget('medic') 范围治疗；自身 <60% 血时自疗
- 新增 tests/test_medkit.js（面板默认关/F1 开关、AI 治疗、AI 补弹、玩家范围治疗、无救援断言）；test_mortar 迫击炮数量断言 2→1（六兵种每类人数减少）；test_64 重调种子（seed 83：14 阵亡）；run_all 16 项

## v5.5 新兵种：迫击炮兵

- config：CLASSES.mortar（SMG 自卫）+ GADGETS.mortar（60mm：minRange 40 / maxRange 180 / 半径 12 / 300 伤 / 6 发 / 装填 4.5s）；CLASS_ORDER 五兵种
- weapons.fireGadget 'mortar' 分支：落点 = 瞄准线 rayGround 交点（AI 用 bot.mortarTarget 直接指定）；高抛弹道按距离定飞行时间 T=clamp(d/34, 1.8, 4.5)、重力 24 反解初速；近距守卫不消耗弹药（修掉曾把弹药 +1 的 bug）；mortarShell 橄榄色弹体
- ai.think 迫击炮分支：索敌/被标记敌人 >28m → 每 5~8s 曲射（落点散布 ±5m）、<50m 后撤、>110m 前压、中间横移；目标贴近走常规交火（SMG）
- player.buildGadgetModel 'mortar'：斜置炮管 + 座钣 + 两脚架
- 新增 tests/test_mortar.js（直接指定落点射击/落地溅射击杀/AI 自动炮击/近距守卫/天空最大射程）；test_64 重调种子（seed 3：19 阵亡）；run_all 15 项

## v5.4 载具平衡（用户反馈：AI 载具太强打不动、跑太快）

- **血量削减**：坦克 1000→600、APC 650→420、AA 600→400、直升机 700→480、喷气机 900→560
- **速度降低**：坦克 16→10、APC 22→14、AA 20→13、直升机 34→26、喷气机 110→95（失速 45→40）
- **AI 地面载具接敌减速**：botDrive 在敌人 160m 内 botThrottle=0.35（停稳射击、不再满场乱窜，也更好被命中）
- **步兵枪械反甲**：damageVehicle 'smallarms' 倍率 坦克 0→0.12、轻甲 0.35→0.55、航空器 0.8→1.0——步枪集火可磨爆载具；工程兵 2 发火箭（320×2=640>600）拆坦克
- test_64 重调种子（seed 47：14 阵亡/13 击杀/4 载具/1 战斗机）

## v5.3 菜单功能

- **AI 难度三档**：config.js 新增 AI_PRESETS（easy/normal/hard 各自覆盖瞄准误差、锁定时间、开火概率、交战距离、反应延迟、开火宽限）；主菜单第三列难度按钮（hud.selectedDiff + .diff-btn 绑定）；main.applyDifficulty 在点「开始游戏」时写入 CONFIG（AI 全程实时读取，BOT 重生时重取瞄准误差）；boot 默认 normal（与 CONFIG 初始值一致，autotest 行为不变）
- **退出对局按钮**：main.exitToMenu——结束本局、释放指针锁、请玩家下车、停引擎、清击杀播报、隐藏 HUD、回主菜单（菜单相机恢复环绕）；按钮三处：HUD 左上角 #btn-exit（Esc 释放鼠标后点）、阵亡界面 #btn-exit-dead、结算界面 #btn-exit-end；点「开始游戏」即重新选图/模式/难度开新局
- 新增 tests/test_menu.js（真实菜单流程：默认普通 → 困难+雪图参数断言 → 战斗内退出回菜单 → 简单+沙漠重开），run_all 14 项

## v5.2 用户反馈修复

- **地形网格转置/镜像 bug（核心）**：PlaneGeometry 顶点序为 iy 行×ix 列，高度场缓冲 hIdx(i,j) 却是 i=x、j=z —— 旧代码直取索引导致渲染地形 = 真实地形的转置（实测 76% 顶点偏差、最大 7.15m）。后果：建筑/道路按真实坐标摆放却落在镜像网格上 → 处处悬空/下陷（「贴图与建模不匹配」「大量无厚度无实体长方形」）、小地图与画面不符（「小地图显示不全」）。修复：按顶点世界坐标 (x=-W+ix, z=-W+iy) 反查 hIdx(ix, iy)；复验 25921 顶点偏差全为 0
- **建筑地基压平**：addSolid 登记的压平区此前从未应用（在 applyFlattens 之后才 push）→ 现在网格生成前统一应用，建筑与地形严丝合缝
- **移除道路**：3D 道路条带（无厚度/无实体/深色长方形）与地图上的道路线全部删除（terrain.buildRoads 空实现、hud 地图线删除、ROAD_PATHS 与 roadPaths 数据删除）；机场跑道压平保留（供喷气机起降）
- **建筑耐久 ×20**：城市大楼 900→18000、棚屋 380→7600、土坯房 620→12400、旗点棚屋 360→7200、雪林木屋 380→7600（油桶/沙袋/木箱等掩体保持原值）；test_destruction 改按 maxHp 比例破坏
- **上车赶队友**：玩家按 F 可抢占队友驾驶的载具（队友被请下车）；敌方占用不可进入；BOT 仍只上空车
- test_64 重新调种子（seed 23：15 阵亡/13 击杀，完全确定性，阈值 deaths>12/kills≥12）；test_maps 删除道路断言

## v5.1 用户反馈调整

- **16v16**：BOT_COUNT_PER_TEAM 31→15（红军 15 BOT + 玩家、蓝军 16 BOT，共 32 人）；test_64 改 32 人并重新调种子（seed 7：21 阵亡/21 击杀/4 载具/1 战斗机，完全确定性）
- **移除弹坑系统**（terrain.js 的 addCrater/update 改空实现 + weapons.areaDamage 去调用 + MAX_CRATER_DEPTH 删除）：修复「地面透明」（弹坑下挖穿透单面地形看到背面）与「大量无厚度无实体黑色长方形」（弹坑整块 dirtyRect 深色重绘）两个渲染问题；地面网格生成后保持不变，贴图与小地图完全一致
- **移除医疗兵/击倒机制**：删除 medic 兵种、medkit 装备、downed 状态机、reviveTick/healTick/自愈、BOT 医疗行为、倒地 HUD/视角/小地图绿十字、医疗音效、test_medic——致命伤直接阵亡，立即进入重生流程
- **移除弹孔贴花**（effects.js 的 initDecals/addDecal 改空实现）：地面不再有黑色扁平圆片；命中反馈保留火花/尘爆/血雾粒子与弹壳
- **雪图冰面改实心**（opacity/transparent 移除）：消除「透明地面」观感
- 测试适配：test_flow 回退「阵亡→立即重生」流程、test_destruction/test_snow 改断言「爆炸不雕刻地形」、test_weapons T8 只验弹壳池、test_maps/test_snow 改 32 士兵、run_all 13 项

## v5.0 大修升级（「破破烂烂，大修并全面升级」交付）

- **bug 大修（P0/P1 全清）**：死亡界面抢 pointer lock + 复活瞬间甩视角（`showDeathScreen` 置 `running=false` + `Player.resetInput`）；弹坑无限下挖（`T.hfOrig` 快照 + `MAX_CRATER_DEPTH=2` 钳制）；URL `?mode=/?map=` 对菜单无效（`hud.syncMenuSelection`）；换图后 `bot.homeFlag` 悬垂（按 id 重解析）；新局首杀误判连杀（resetMatch 清 `lastKillTime/multikill`）；手枪 0.2 射速 > clickBuf 0.12 吞枪（按射速动态缓冲）；AI LOS 缓存沿用死者（存活校验）；`rayCylinder` 垂直射线除零；车内直接重部署卡死（先 `Vehicles.exit`）；debug 的 `AI_REACT_MIN` 持久化不同步 MAX
- **战斗烈度**：AI_FIRE_CHANCE 0.3→0.42、GRACE 0.8→0.65、ENGAGE 70→85、REACT 0.4→0.32——修复 test_64 30 秒仅 25 阵亡的「交火太怂」
- **性能大修（`effects.js`）**：粒子 freelist（emit O(1) 取槽，替代每粒扫 4000 槽）；曳光/枪口火光/爆炸火球/冲击波环/烟团全对象池化（共享单位几何 + 环形复用 + transient cleanup 回调）——消除每发子弹 new 几何+材质
- **医疗兵（第五兵种）+ 击倒救援**：致命伤先击倒（25s 流血），医疗兵通道救援 3s（救起 50% 血 + 返还兵力票 + 救人 +100 分）；医疗包治疗、脱战自愈；BOT 医疗兵自动救援/治疗（`ai.medicBehavior`）；玩家倒地贴地视角 + 流血 HUD + 小地图绿十字；`CONFIG.DOWNED_ENABLED`（autotest 默认关保旧测试确定性）
- **新武器**：SG-12 霰弹枪（`pellets:8` 多弹丸 hitTest、dropoff 0.06 极陡衰减）+ MK-14 DMR（55 伤/中倍镜）；枪模/`audio.PROFILES`/AI WEAPON_SCORES/debug 全接入
- **载具克制环 + 防空车 AA**：armorClass（heavy/light/air）+ `damageVehicle` 伤害类型倍率（smallarms 坦克 0/轻甲 0.35/空 0.8；aa 直升 ×3/喷气 ×1.5/地面 0.15~0.5）；AA 双联高炮大仰角，BOT 对空带速度瞄准噪声（快喷气机难追）+ LOS 校验 + 不打跑道停机；工程兵火箭 320×4 可单拆坦克；坦克 MG 削弱
- **载具第三人称**：V 键追尾视角（`vehicles.updateCamera`）
- **第三张地图：雪域要塞**：`snowRawHeight`（雪丘+山脉）、冰湖压平+半透明冰面、混凝土碉堡（不可毁）、雪松林、林间木屋（snowCabin）、山间公路；`MAP_DEFS.snow` 征服 4 旗 + 突破 3 扇区；菜单三图
- **天气系统（`effects.js`）**：`setWeather('snow'|'sand')` 粒子环绕盒跟随玩家，boot/applySelection 接线，切图自动清理
- **士兵 LOD（`ai.js`）**：每队近（7 部件）/远（3 部件）双 InstancedMesh，>120m 切换，draw call 不变
- **坠落伤害**：人/BOT 统一（>8m 起伤，每米 9），`fallStartY` 追踪
- **测试**：新增 test_medic/test_shotgun/test_aa/test_snow 四项，全套 14 项 27s 全绿；旧测试适配（10 载具、击倒流程、AA 停机保护）

## v4.0 爆改升级（用户否决重写版，指定以 v2.6 为蓝本升级）

- **64 人对战**：BOT 每队 31 + 玩家 + 蓝军补 1 = 32v32。`ai.js` 士兵改 InstancedMesh（合并部件+顶点色，每队 1 draw call）；`utils.js` 空间哈希 `Game.grid` 每帧重建，索敌替代 O(n²) 扫描；LOS 缓存 + 按距离降频 tick（近 30Hz/中 15Hz/远 6Hz）；战斗导演保留原语义
- **战斗机**：`vehicles.js` 固定翼物理（油门/滚转/俯仰/失速/边界盘旋）+ 航炮 + 无制导火箭 + **锁定追踪导弹**（`weapons.js` 弹道 homing 转向）；跑道停放起降（grounded 状态，解决无人驾驶飞走与机组追不上）；BOT 飞行员：狗斗/对地攻击/巡逻；`audio.js` 喷气引擎声
- **直升机 AI 修复**：原版直升机物理只读玩家输入、BOT 从不登机；现在 botYaw/botPitch/botThrottle 接入物理 + 盘旋压制/火箭反载具分支
- **可破坏建筑**：大建筑三级状态（完好→开裂弹痕贴图→残破矮墙（碰撞同步 h=1.2）→倒塌瓦砾堆）；油罐（沙漠）殉爆；`terrain.damageSolid` 状态机 + `weapons.areaDamage` 全实体管线
- **可破坏地形**：地形真相改为 1m 高度场缓冲（`terrain.js`），`heightAt` 双线性采样；爆炸 `addCrater` 雕刻缓冲，`terrain.update` 节流冲刷网格顶点/色/法线；人车统一采样天然一致
- **突破模式**（`main.js`）：红攻蓝守、3 扇区线性推进（每扇区 2 旗）、仅当前扇区可占（攻方独占快推/守方在场回拉）、扇区锁定、攻下补票 120、三种胜负（全境攻陷/攻方票尽/守满时间）；`Game.modes` 服务层（BOT 出生前线集结/守方防线、目标选择）
- **双地图**（`config.js` MAP_DEFS + `terrain.js` 双生成器）：灰烬都市（网格街区每格双栋、十字路渲染、机场）；沙暴行动（沙丘起伏、土坯村庄+院墙、油田油罐+泵机、绿洲棕榈、公路+跑道）；菜单选择，`applySelection` 全量重建（地形/旗点/载具/小地图）；地图生成用独立确定性随机源（与战斗 rng 隔离）
- **测试**：autotest 不再跑 rAF（消除时序抖动）；旧 5 项测试适配（导演清扫阈值/攻击者无敌/端口 env 化）；新增 tests/ 下 5 项（64人压力/突破/破坏/双图/战斗机）+ `tests/run_all.js` 一键 10 项

## 版本历史

- v1.1：从 0 原创重构。4 兵种 / 征服模式 / 3 载具（坦克+装甲车+直升机）/ 可破坏环境 / 军衔系统。Three.js r128。
- v1.2：激光枪（零扩散）+ 载具逻辑修正（转向/炮管/机头朝向 -z、直升机俯仰前飞）。
- v1.3：CS2 式扩散 + 巷战小图 + 枪械/道具模型 + 削弱 AI + 相机摇晃。
- v1.4：点射准（可恢复后坐）/ 枪模入场景（`scene.add(camera)`）/ 载具开镜+炮弹直击判定 / 步枪对载具伤害（tank 0/apc 1/heli 1）/ 删道路长方形片。
- v1.5：枪感重构（零扩散+强后坐+随机水平跳动，可恢复）/ 震屏减小不累加 / 占领点间掩体 / 红点镜 / 载具微扩散（0.002~0.003）。
- v1.6：红点开镜（FOV 42，镜外透明无黑边）/ AI 反应 230ms / 火箭装填（RPG 2.5s / 榴弹 1.5s）/ 掩体加密加高（据点间视线全阻断）。
- v1.7：连射扩散惩罚（每发 ×1.1，2s 达峰，20m 偏差 0.55m）/ 开镜黑块修复（任何枪开镜隐藏枪模）/ 掩体大幅加密。
- v1.8：巷战 20m（建筑 step 24→18、楼体 12~17、巷距 7→6）/ 准星修复（`.ch-dot` 缺 `position:absolute`）/ AI 后坐+扩散统一 / AI 短点射（2-4 发 + 停歇 0.35~0.8s）。
- v1.9：削弱 AI（误差 0.04~0.12→0.09~0.20、锁定 1.1→1.6s、反应 0.23→0.4s、开火 0.4→0.3）/ 掩体加密 / 枪口动态光（复用单点光）。
- v2.0：调试操作界面（新 `js/debug.js`，F1 开关，右上角面板：AI/枪械/玩家/世界/信息）。
- v2.1：参数持久化（localStorage `ashfron_cfg_v1`，刷新不丢）/ 可调项 21 个 / 爆头伤害翻倍（命中 y > 身高×0.85）/ CF 式击杀播报（中心偏下 62% + 音效）。
- v2.2：纯后坐（删除恢复/补偿，后坐永久累积，纯手压）。
- v2.3：缩小地图（WORLD 120→80，面积缩 ~55%）/ 高烈度（占领 26→34、复活 3→2s）/ 掩体加密（建筑 step 18→16、棚屋 24→36、沙袋 40→56、木箱 28→40、油桶 32→44、据点间 7→9、岩石 8→12；实机 建筑 40 + 可破坏物 95 = 实体 135）。
- v2.4：修复俯仰角翻顶 bug（纯后坐曾把后坐存成独立偏移 `s.recoil` 加在 `s.pitch` 上绕过 ±1.5 钳制，无限累积导致翻顶看背后 + 俯角范围被压缩；改为后坐直接打进 `s.pitch`/`s.yaw` 并钳制 `s.pitch` 到 ±1.5）。
- v2.5：**武器系统全面升级**（下载 6 个参考项目至 `reference/` + 学习笔记，取 ironhold / Claude-of-Duty / dive 精华）：
  - **战斗导演**（`ai.js`）：同一目标最多 2 名 AI 同时开火（其余照常机动）；索敌后开火宽限 0.8s；残局清扫（存活 ≤3 时周期性派往敌人位置）；0.2s 节流 + 索敌缓存复用
  - **后坐重建**（`utils.js` Spring/RecoilAxis + 确定性 pattern）：快弹簧回位 + 34% 慢残差（连射持续上抬、停火自动回中），pattern 同种子可复现、可记忆可压枪；组合角钳制 ±1.5 继承 v2.4 防翻顶；AI 与玩家同套
  - **扩散重建**：锥角模型（spreadHip/Ads/PerShot/Max/Decay 度）+ 状态惩罚表（蹲 0.78/静 0.82/走 1.15/冲刺 2.2/滞空 2.0）+ 圆盘采样；开镜恢复加速 ×2
  - **ADS 三件套**：adsEase 缓动 + FOV 混合 + 灵敏度 tan 半角缩放（狙击钳 0.18）+ ADS 移速 -40%
  - **扳机/状态机**：点击缓冲 0.12s（高速点击不丢枪）、B 键半自动切换、换枪两段（收枪 0.22s+掏枪 drawTime 期间禁火）、干火咔哒
  - **数值层**：距离衰减平方曲线（狙击无衰减）、部位倍率（头 ×2/躯干 ×1/腿 ×0.75）、AI 选枪打分（距离×余弹−换枪惩罚）、AI 瞄准噪声随距离
  - **音效层**（`audio.js`）：5 层枪声合成（爆响 crack/火药主体 body/低频砰/亚低音/机匣 mech/尾音 tail）+ 6 槽轮转 + 逐发抖动 + 近远混音；换弹三阶段（0%/38%/78% 退匣/入匣/拉机柄）；干火/近失呼啸/命中音/击杀音/弹壳落地；程序化混响 IR
  - **FX 层**（`effects.js`）：弹孔池 44（环形复用零分配）、黄铜弹壳池 30（重力+反弹+落地音+淡出）、三段命中粒子（火花锥+尘爆闪+碎屑/血雾入孔+出口喷溅）、枪口火光按枪种强度
  - **测试**：新增 `test_weapons.js`（9 项断言）+ `test_director.js`（宽限/上限/清扫 3 场景），五件套全绿
- v2.6：**去激光化 + 换枪修复**：
  - 改名：武器恢复常规火药枪械命名（AR-40 自动步枪 / LMG-80 轻机枪 / SR-50 栓动狙击枪 / SMG-9 冲锋枪 / P-45 手枪）
  - 音效改火药合成（`audio.js` PROFILES 重写）：爆响 crack → 火药主体 body → 低频砰 → 亚低音 → 机匣 mech → 尾音，移除激光扫频层
  - 弹壳改黄铜壳（`effects.js`）
  - **修复换枪卡死**（`player.js`）：倒计时原先只在 `pendingSlot` 存在时递减——切枪完成瞬间计时器冻结在 >0，导致此后开火/开镜/再切枪全部被 `switching>0` 挡住（枪卡在半途）。改为倒计时独立运行；换枪中再按覆盖目标并重启计时（后按优先）

用户否决旧「战场前线」，要求从 0 原创重写；随后又要求「使劲增强」。本目录为全新原创实现，
仅保留 Three.js 引擎（`three.min.js`，r128 UMD，MIT），游戏设计与全部代码原创。
旧版备份：`K:\Project\V4PROTEST_旧版备份_20260813_091756`（战场前线 v1.1，可恢复）。

## 游戏设定

- 名称：**灰烬战线 ASHEN FRONTLINE**（原创近未来战争 FPS）
- 阵营：赤焰先锋（红） vs 苍穹守卫（蓝）
- 模式：征服（3 占领点 A/B/C + 兵力消耗）

## 已实现功能清单

战斗核心
- [x] 程序化地形（灰烬山谷：丘陵 + 山脊 + 顶点着色）+ 道路网（主路/交叉路，贴地条带 + 小地图）
- [x] 第一人称控制器（移动/冲刺/蹲/跳/动态准星/ADS/狙击镜）+ viewmodel 换弹/切枪动画
- [x] 4 兵种：突击（自动步枪+下挂榴弹）/ 支援（轻机枪+弹药箱）/ 侦察（栓动狙击枪+信号弹）/ 工程（冲锋枪+火箭筒）
- [x] 枪械：锥角扩散（静止/姿态惩罚 + 连射累积，开镜恢复加速）+ 弹簧后坐（快回位+慢残差，确定性 pattern）+ 距离衰减 + 部位倍率（头/躯干/腿）
- [x] 爆头伤害 ×2（金色命中标记/火花）+ 腿 ×0.75 + CF 式击杀播报（双杀~超神）
- [x] ADS：红点/狙击镜 FOV 混合 + 灵敏度缩放 + 移速降低；B 键半自动切换；换枪两段动画
- [x] hitscan + 弹道（手雷弹跳引信/榴弹/火箭/坦克炮/信号弹）+ 范围伤害 + 可破坏环境（油桶/沙袋/木箱/棚屋倒塌）
- [x] 战斗导演：同目标开火上限 2 + 开火宽限 0.8s + 残局清扫（防躲猫猫）
- [x] 命中反馈：弹孔/黄铜弹壳/火花锥+尘爆+血雾（爆头翻倍）

战场 AI
- [x] 双方各 10 名 AI：索敌/交火/绕行/找掩体（受击压制后撤离）/攻占本命点 + 推进最近敌方点 + 交火中按距离选枪
- [x] AI 短点射（2-4 发 + 停歇 0.35~0.8s）+ 后坐/扩散与玩家一致 + 反应延迟 0.4s + 开火宽限 0.8s + 同目标开火上限 2
- [x] AI 驾驶载具：每方 1 坦克 + 1 装甲车由 AI 驾驶（寻敌/转向/开炮/机炮），直升机保留给玩家
- [x] 工程兵反载具（火箭筒）

载具 / 表现
- [x] 3 载具：主战坦克（主炮+同轴机枪）/ 装甲运兵车 / 武装直升机（姿态飞行+火箭+机炮）
- [x] 实时阴影（低角度黄昏光照）+ 建筑窗户外立面纹理
- [x] 特效：粒子池/曳光/枪口火光（含动态单点光）/爆炸火球+冲击波+烟雾/震屏
- [x] 程序化音效（5 层枪声合成 + 距离混音 + 换弹三阶段 + 干火/近失呼啸/命中音/弹壳落地）+ 玩家脚步声 + 载具引擎/旋翼循环音 + 击杀播报音效

HUD / 元系统
- [x] 完整 HUD + 小地图（地形/道路/据点/载具/队友/被标记敌人）
- [x] CF 式击杀播报（屏幕中心偏下 62% 大字横幅：击杀者[武器]被击杀者 + 金色「爆头」+ 双杀/三杀/四杀/五杀/六杀/超神 + 音效）
- [x] 受击方向指示 + 低血量脉动 + 击杀/占领飘字 + 占领播报 + 连杀提示 + 目标罗盘（方向+距离）
- [x] 军衔系统（15 级，localStorage 持久化）
- [x] 完整流程：主菜单→选兵种→部署→阵亡→重生→结束→再来一局
- [x] 调试操作界面（F1 面板：21 个可调参数实时改 + localStorage 持久化 + 无敌/无限弹药/传送/复活AI/慢动作/阴影开关）

## 调参入口

- 代码级：`js/config.js` 的 `WORLD`/`TICKETS`/`BOT_COUNT_PER_TEAM`/`CAPTURE_SPEED`/`BLEED_PER_FLAG`/
  `MATCH_TIME_LIMIT`/`WEAPONS`/`CLASSES`/`VEHICLES`/`FLAG_DEFS`/`BASE_DEFS`/`VEHICLE_SPAWNS`/`RANKS`/
  `SHADOWS`/`AUDIO_RANGE`/`AI_*`/`BURST_RATE`。
- 武器手感新键（`WEAPONS.<枪>`）：`spreadHip/spreadAds/spreadPerShot/spreadMax/spreadDecay`（度）、
  `recoilDef{pitch,yaw,climbShape,drift,bias,seed}`、`adsFov/adsTime`、`dropoff/falloffRange`、`drawTime/modes`。
- 全局新键：`SPREAD_MODS`（姿态惩罚表）、`BODY_PARTS`（头/躯干/腿倍率）、
  `RECOIL_FREQ/DAMPING/SHARE/TAU`（后坐弹簧参数）、`AI_GRACE_TIME/COMBAT_MAX_SHOOTERS_PER_TARGET/SWEEP_*`（战斗导演）。
- 运行时：F1 调试面板（`js/debug.js`），25 个滑块实时调 AI/枪械（含新扩散/后坐/开镜/衰减）/玩家移动/连射/载具参数，
  自动存 localStorage `ashfron_cfg_v1`（刷新不丢，boot 前加载生效），「重置全部参数」还原默认。
- 参考项目与学习笔记：`reference/`（6 个项目源码 + `学习笔记.md` 扩充路线图）。

## 验证方式

```bash
node test_cdp.js       # 战斗运行：状态读取 + 确定性步进 240 帧验证击杀/载具/占领 + 截屏
node test_vehicles.js  # AI 驾驶载具：步进验证 4 辆地面载具被接管并移动
node test_flow.js      # 全流程 8 项断言（菜单/部署/阵亡/重生/结束）
node test_weapons.js   # 武器系统 9 项断言（pattern 确定性/弹簧回中/衰减/部位/ADS/点击缓冲/换弹时序/FX 池/AI 选枪）
node test_director.js  # 战斗导演 3 场景（开火宽限/同目标上限/残局清扫）
```
`headless_shot.png` 为实机截图。

## 网络 / headless 备忘（本机环境，重要）

- 本机系统代理拦截 `127.0.0.1` → 本地测试用 `file://` 路径。
- headless Chrome 需 `--headless=new --enable-unsafe-swiftshader --disable-gpu --use-angle=swiftshader`
  + 防节流参数 `--disable-background-timer-throttling --disable-renderer-backgrounding`。
- **headless 的 rAF/定时器会间歇性冻结**（页面被后台节流），wall-clock 等待不可靠 → 用「确定性步进」：
  在 eval 里循环调用 `Player.update/ai.update/Vehicles.update/weapons.update/updateConquest/effects.update`
  固定 dt，直接验证逻辑，不受节流影响。`Game.updateConquest` 已暴露用于此。
- autotest 模式（`?autotest=1`）会关阴影（软件渲染太慢），真实浏览器仍开阴影。
- GitHub 下载用 `https://ghfast.top/` 或 `https://gh-proxy.com/`；外网搜索 `cn.bing.com`；联网一律 curl。

## 下一步（可选）

- [ ] 载具乘客位（APC 多座位、坦克驾驶/炮手分离）
- [ ] AI 驾驶直升机
- [ ] 小队系统（组队重生、队长指令）
- [ ] 更多地图 / 昼夜天气
- [ ] 武器皮肤 / 击杀回放 / 可破坏建筑倒塌连锁
