/* ============================================================
 * tests/test_vehicle_combat.js — v5.15 载具近战与弹道：
 * 1) 载具碾压击杀（驾驶者计分 + 播报「载具碾压」）
 * 2) 车载机枪扩散（tank/apc/heli 配置断言）
 * 3) AI 车载机枪短点射/长点射交替（2 秒射击数有上界）
 * 4) 玩家车载武器沿准星射出（坦克炮初速与相机轴重合、准星下敌人入落点判定）
 * ============================================================ */
'use strict';
const { launchChrome, sleep, assert, gameUrl } = require('./lib/cdp');

(async () => {
  console.log('=== test_vehicle_combat: 载具近战与弹道 ===');
  const { proc, cdp } = await launchChrome(gameUrl(), 9256);
  let failed = false;
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }

    // ---- 布置：沙漠图 + 关闭步兵 AI 开枪（隔离载具变量）+ 找一条无障碍通道 ----
    const setup = await cdp.eval('(function(){' +
      'var G=Game; G.godMode=true;' +
      'G.applySelection("conquest", "desert"); G.deployPlayer(); G.godMode=true;' +
      'G.__origFireWeapon = G.weapons.fireWeapon;' +
      'G.weapons.fireWeapon = function(){ return false; };' +   // 步兵 AI 停火（载具测试专用）
      'G.bots.forEach(function(b){ if (b.clsKey==="mortar") { b.gadgetAmmo = 0; b.bot.mortarT = undefined; } });' +
      'var foes = G.bots.filter(function(b){ return b.team===1 && !b.bot.crew; });' +
      'G.__foe1 = foes[0]; G.__foe2 = foes[1];' +
      'G.__pinned = [];' +
      'G.bots.forEach(function(b){ if (b===G.__foe1 || b===G.__foe2) return;' +
      '  var px = b.team===0 ? -78 : 78, pz = b.team===0 ? -74 : 74;' +
      '  b.pos.x=px; b.pos.z=pz; b.pos.y=G.heightAt(px,pz); b.vel={x:0,y:0,z:0}; b.spawnProtect=0;' +
      '  G.__pinned.push({ id: b.id, x: px, z: pz }); });' +
      'G.__vehPin = [];' +
      'G.vehicles.forEach(function(v){' +
      '  if (v.occupant) G.Vehicles.exit(v.occupant);' +   // 全部空车（防止敌方载具抢杀靶子）
      '  G.__vehPin.push({ id: v.id, x: v.team===0 ? -68 : 68, z: v.team===0 ? 55 : -55, y: 30 });' +
      '});' +
      'var off = null, zT = 40, zF = -20;' +
      'var lanes = [[40,-20],[30,-30],[20,-40],[20,-20],[30,-10],[40,0],[-20,-40]];' +
      'for (var k=0;k<21 && off===null;k++){' +
      '  var x = -100 + k*4;' +   // v5.44 5旗后布局变化，通道改从基地附近搜起
      '  for (var li=0;li<lanes.length && off===null;li++){' +
      '    var lzT = lanes[li][0], lzF = lanes[li][1];' +
      '    var ey = G.heightAt(x,lzT)+4.6, ty = G.heightAt(x,lzF)+1;' +
      '    if (G.terrain.blocksLOS(x, ey, lzT, x, ty, lzF)) continue;' +
      '    var minClear = 999;' +   // 弹道离地余量（防止炮弹擦过沙丘提前引爆）
      '    for (var kk=1;kk<8;kk++){' +
      '      var zz = lzT + (lzF-lzT)*kk/8;' +
      '      var lineY = ey + (ty-ey)*(kk/8) - 1.0;' +
      '      var gH = G.heightAt(x, zz);' +
      '      if (lineY - gH < minClear) minClear = lineY - gH;' +
      '    }' +
      '    if (minClear <= 0.3) continue;' +
      '    var tankClear = true;' +   // 坦克射击位 4.5m 内无实体（防止被推出瞄准线）
      '    for (var si=0;si<G.terrain.solids.length;si++){' +
      '      var s=G.terrain.solids[si];' +
      '      if (Math.abs(s.cx-x) < (s.w/2)+4.5 && Math.abs(s.cz-lzT) < (s.d/2)+4.5) { tankClear=false; break; }' +
      '    }' +
      '    if (tankClear) { off = x; zT = lzT; zF = lzF; }' +
      '  }' +
      '}' +
      'var tank = G.vehicles.filter(function(v){ return v.kind==="tank" && v.team===0; })[0];' +
      'if (tank.occupant) G.Vehicles.exit(tank.occupant);' +
      'G.Vehicles.enter(tank, G.player);' +
      'G.__tankId = tank.id; G.__off = off; G.__zT = zT; G.__zF = zF; G.__skipVehId = -1;' +
      'return JSON.stringify({ off: off, zT: zT, zF: zF, mgSpread: VEHICLES.tank.mgSpread, apcSpread: VEHICLES.apc.mgSpread, heliSpread: VEHICLES.heli.cannonSpread });' +
      '})()');
    const s = JSON.parse(setup);
    assert(s.off !== null, '找到无障碍测试通道（x=' + s.off + '）');
    assert(s.mgSpread >= 0.015 && s.apcSpread >= 0.015 && s.heliSpread >= 0.015,
      '车载机枪扩散已添加（tank ' + s.mgSpread + ' / apc ' + s.apcSpread + ' / heli ' + s.heliSpread + '）');

    // 步进助手（每帧重钉 bot/载具/靶子，保持战场隔离）
    const step = (frames) => cdp.eval('(function(){ var G=Game;' +
      'var foe1=null, foe2=null, tank=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ var ss=G.soldiers[k]; if(ss.id===G.__foe1.id)foe1=ss; if(ss.id===G.__foe2.id)foe2=ss; }' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tankId)tank=G.vehicles[j]; }' +
      'for (var i=0;i<' + frames + ';i++){ var dt=1/30; G.time+=dt;' +
      '  for (var p=0;p<G.__pinned.length;p++){ var pb=G.__pinned[p]; var bot=G.soldiers[pb.id];' +
      '    bot.pos.x=pb.x; bot.pos.z=pb.z; bot.pos.y=G.heightAt(pb.x,pb.z); bot.vel={x:0,y:0,z:0}; }' +
      '  for (var q=0;q<G.__vehPin.length;q++){ var vp=G.__vehPin[q]; var vv=null;' +
      '    for (var vk=0;vk<G.vehicles.length;vk++){ if(G.vehicles[vk].id===vp.id){ vv=G.vehicles[vk]; break; } }' +
      '    if (vv && vv!==tank && vv.id!==G.__skipVehId){ vv.pos.x=vp.x; vv.pos.z=vp.z;' +
      '      vv.pos.y = vv.kind==="heli" ? vp.y : G.heightAt(vp.x,vp.z); vv.vel={x:0,y:0,z:0}; } }' +
      '  if (foe1 && G.__foe1Pos){ foe1.pos.x=G.__foe1Pos.x; foe1.pos.z=G.__foe1Pos.z;' +
      '    foe1.pos.y=G.heightAt(G.__foe1Pos.x,G.__foe1Pos.z); foe1.vel={x:0,y:0,z:0};' +
      '    if(G.__foe1Pos.protect!==undefined) foe1.spawnProtect=G.__foe1Pos.protect; }' +
      '  if (foe2 && G.__foe2Pos){ foe2.pos.x=G.__foe2Pos.x; foe2.pos.z=G.__foe2Pos.z;' +
      '    foe2.pos.y=G.heightAt(G.__foe2Pos.x,G.__foe2Pos.z); foe2.vel={x:0,y:0,z:0};' +
      '    if(G.__foe2Pos.protect!==undefined) foe2.spawnProtect=G.__foe2Pos.protect; }' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt); }' +
      'return "ok"; })()');

    // ---- 1) 碾压击杀 ----
    await cdp.eval('(function(){ var G=Game;' +
      'var foe1=null, tank=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe1.id)foe1=G.soldiers[k]; }' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tankId)tank=G.vehicles[j]; }' +
      'foe1.spawnProtect = 0; foe1.deaths = 0;' +
      'G.__foe1Pos = { x: -92, z: 0, protect: 0 };' +   // 红方基地压平区（无墙无掩体，碾压通道干净）
      'tank.pos.x = -100; tank.pos.z = 0; tank.pos.y = G.heightAt(-100, 0);' +
      'tank.yaw = -Math.PI/2; tank.turretYaw = 0; tank.turretPitch = 0; tank.vel = {x:0,y:0,z:0};' +
      'G.player.kills = 0; G.player.score = 0; G.player.streak = 0;' +
      'G.Player.keys.add("KeyW");' +
      'return "ok"; })()');
    await step(120);   // 4 秒：坦克全速撞向靶子
    const r1 = await cdp.eval('(function(){ var G=Game;' +
      'var foe1=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe1.id)foe1=G.soldiers[k]; }' +
      'G.Player.keys.delete("KeyW");' +
      'var feed = G.killfeed.length ? G.killfeed[G.killfeed.length-1] : null;' +
      'return JSON.stringify({ deaths: foe1.deaths, kills: G.player.kills, score: G.player.score, feedWeapon: feed ? feed.weapon : null });' +
      '})()');
    const a = JSON.parse(r1);
    assert(a.deaths >= 1, '载具撞死敌人（阵亡 ' + a.deaths + ' 次）');
    assert(a.kills >= 1 && a.score >= 100, '碾压击杀计入驾驶者（击杀 ' + a.kills + ' / 得分 +' + a.score + '）');
    assert(a.feedWeapon === '载具碾压', '击杀播报显示「载具碾压」');

    // ---- 2) 坦克炮沿准星射出 + 准星下敌人入落点判定 ----
    const t2 = await cdp.eval('(function(){ var G=Game;' +
      'var foe2=null, tank=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe2.id)foe2=G.soldiers[k]; }' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tankId)tank=G.vehicles[j]; }' +
      'foe2.spawnProtect = 0; foe2.deaths = 0;' +
      'G.__foe2Pos = { x: G.__off, z: G.__zF, protect: 0 };' +
      'tank.pos.x = G.__off; tank.pos.z = G.__zT; tank.pos.y = G.heightAt(G.__off, G.__zT);' +
      'tank.yaw = 0; tank.turretYaw = 0; tank.vel = {x:0,y:0,z:0};' +
      'tank.turretPitch = Math.atan2((G.heightAt(G.__off, G.__zF) + 1 - (tank.pos.y + 4.6)), (G.__zT - G.__zF));' +
      'tank.weaponSlot = "primary";' +
      'return JSON.stringify({ pitch: +tank.turretPitch.toFixed(3) });' +
      '})()');
    await step(2);   // 相机同步到炮塔指向
    const r2 = await cdp.eval('(function(){ var G=Game;' +
      'var fwd = new THREE.Vector3(0,0,-1).applyQuaternion(G.camera.quaternion);' +
      'G.__camFwd = { x: fwd.x, y: fwd.y, z: fwd.z };' +
      'var n0 = G.projectiles.length;' +
      'G.Player.trigger = true;' +
      'var dt=1/30; G.time+=dt;' +
      'if (G.player.alive) G.Player.update(dt);' +
      'G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      'G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt);' +
      'G.Player.trigger = false;' +
      'var shell = G.projectiles.length > n0 ? G.projectiles[G.projectiles.length-1] : null;' +
      'var vl = shell ? Math.hypot(shell.vel.x, shell.vel.y, shell.vel.z) : 1;' +
      'var dot = shell ? (shell.vel.x*G.__camFwd.x + shell.vel.y*G.__camFwd.y + shell.vel.z*G.__camFwd.z)/vl : -1;' +
      'return JSON.stringify({ fired: !!shell, kind: shell ? shell.kind : null, dot: +dot.toFixed(5) });' +
      '})()');
    const b = JSON.parse(r2);
    assert(b.fired === true && b.kind === 'shell', '坦克炮开火（' + (b.kind || '无') + '）');
    assert(b.dot > 0.999, '炮弹初速沿准星射出（与相机轴夹角 cos=' + b.dot + '）');
    await step(60);   // 炮弹飞行 ~0.63s + 溅射
    const r3 = await cdp.eval('(function(){ var G=Game;' +
      'var foe2=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe2.id)foe2=G.soldiers[k]; }' +
      'return JSON.stringify({ deaths: foe2.deaths, hp: Math.round(foe2.health) });' +
      '})()');
    const c = JSON.parse(r3);
    assert(c.deaths >= 1, '准星下的敌人进入落点判定（炮弹落点击杀，阵亡 ' + c.deaths + ' 次）');

    // ---- 3) 车载机枪准星命中（零扩散锁定验证汇聚弹道 + 敌人入判定） ----
    await cdp.eval('(function(){ var G=Game;' +
      'var foe2=null, tank=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe2.id)foe2=G.soldiers[k]; }' +
      'for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tankId)tank=G.vehicles[j]; }' +
      'G.ai.respawn(foe2);' +
      'foe2.pos.x = G.__off; foe2.pos.z = G.__zF; foe2.pos.y = G.heightAt(G.__off, G.__zF); foe2.vel = {x:0,y:0,z:0};' +
      'foe2.spawnProtect = 0; foe2.lastHurtTime = -999;' +
      'G.__foe2Pos = { x: G.__off, z: G.__zF, protect: 0 };' +
      'tank.weaponSlot = "secondary";' +
      'VEHICLES.tank.mgSpread = 0;' +   // 测试专用：零扩散验证汇聚弹道
      'G.__tFire = G.time;' +
      'G.Player.trigger = true;' +
      'var dt=1/30; G.time+=dt;' +
      'if (G.player.alive) G.Player.update(dt);' +
      'G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      'G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt);' +
      'G.Player.trigger = false;' +
      'VEHICLES.tank.mgSpread = 0.02;' +   // 还原
      'return JSON.stringify({ ok: true });' +
      '})()');
    const r4 = await cdp.eval('(function(){ var G=Game; var foe2=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe2.id)foe2=G.soldiers[k]; }' +
      'return JSON.stringify({ hurt: foe2.lastHurtTime >= G.__tFire, byPlayer: !!foe2.lastHitBy && foe2.lastHitBy.id === G.player.id, hp: Math.round(foe2.health), shield: Math.round(foe2.shield || 0) });' +
      '})()');
    const e = JSON.parse(r4);
    assert(e.hurt === true, '车载机枪准星命中敌人（lastHurtTime 更新）');
    assert(e.byPlayer === true, '伤害来源为玩家（' + e.hp + ' HP / ' + e.shield + ' 护盾）');

    // ---- 4) AI 车载机枪短点射/长点射交替 ----
    await cdp.eval('(function(){ var G=Game;' +
      'var apc = G.vehicles.filter(function(v){ return v.kind==="apc" && v.team===1; })[0];' +
      'var driver = G.bots.filter(function(b){ return b.team===1 && b.bot.crew==="apc"; })[0];' +
      'if (apc.occupant) G.Vehicles.exit(apc.occupant);' +
      'G.Vehicles.enter(apc, driver);' +
      'apc.pos.x = G.__off - 40; apc.pos.z = 20; apc.pos.y = G.heightAt(G.__off-40, 20);' +
      'apc.yaw = 0; apc.vel = {x:0,y:0,z:0};' +
      'G.__skipVehId = apc.id;' +
      'var foe2=null; for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foe2.id)foe2=G.soldiers[k]; }' +
      'foe2.slots.primary.mag = 0; foe2.slots.secondary.mag = 0; foe2.grenades = 0;' +   // 靶子不还击
      'G.__foe2Pos = { x: G.__off, z: G.__zF, protect: 999 };' +   // 无敌靶（只数枪声）
      'G.__t0 = G.time;' +
      'return JSON.stringify({ apcId: apc.id, dist: 40 });' +
      '})()');
    await step(60);   // 2 秒
    const r5 = await cdp.eval('(function(){ var G=Game;' +
      'var ts = G.sound._log.filter(function(l){ return l.n==="shot:rifle" && l.t >= G.__t0 && l.t <= G.time; }).map(function(l){ return l.t; });' +
      'ts.sort(function(a,b){ return a-b; });' +
      'var maxGap = 0;' +
      'for (var k=1;k<ts.length;k++){ var g=ts[k]-ts[k-1]; if (g>maxGap) maxGap=g; }' +
      'return JSON.stringify({ shots: ts.length, maxGap: +maxGap.toFixed(2) });' +
      '})()');
    const f = JSON.parse(r5);
    assert(f.shots >= 2, 'AI 车载机枪仍会开火（2 秒 ' + f.shots + ' 发）');
    assert(f.shots <= 20, '点射总量有上界（2 秒 ' + f.shots + ' 发，连续扫射应为 ~23）');
    assert(f.maxGap >= 0.25, '点射间存在间歇（最大间隔 ' + f.maxGap + 's，连续扫射 <0.1s）');

    // ---- 5) v5.29 防卡死机动：坦克直冲墙工事 → 沿墙滑动脱困 ----
    const r6b = await cdp.eval('(function(){ var G=Game;' +
      'var tank=null; for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tankId)tank=G.vehicles[j]; }' +
      'var w = G.terrain.fortwalls[0];' +
      'var alongX = w.w > w.d;' +
      'var sx = w.cx;' +
      'var sz = alongX ? (w.cz + w.d / 2 + 3) : w.cz;' +
      'var fx0 = alongX ? 0 : -1;' +
      'var fz0 = alongX ? -1 : 0;' +
      'tank.pos.x = sx; tank.pos.z = sz; tank.pos.y = G.heightAt(sx, sz);' +
      'tank.yaw = Math.atan2(-fx0, -fz0) + 0.35;' +   // 微倾角接近墙（纯垂直头撞会被反推卡死，斜撞才能沿墙滑动）
      'tank.vel = {x:0,y:0,z:0}; tank.stuckT = 0;' +
      'G.__tankStart = { x: sx, z: sz };' +
      'G.Player.keys.add("KeyW");' +
      'return JSON.stringify({ turnRate: VEHICLES.tank.turnRate, sx: +sx.toFixed(1), sz: +sz.toFixed(1) });' +
      '})()');
    const g3 = JSON.parse(r6b);
    assert(g3.turnRate >= 2.2, '坦克转向更机动（turnRate ' + g3.turnRate + '）');
    await step(90);
    const r7b = await cdp.eval('(function(){ var G=Game;' +
      'var tank=null; for (var j=0;j<G.vehicles.length;j++){ if(G.vehicles[j].id===G.__tankId)tank=G.vehicles[j]; }' +
      'G.Player.keys.delete("KeyW");' +
      'var moved = Math.hypot(tank.pos.x - G.__tankStart.x, tank.pos.z - G.__tankStart.z);' +
      'return JSON.stringify({ moved: +moved.toFixed(1), pos: [+tank.pos.x.toFixed(1), +tank.pos.z.toFixed(1)] });' +
      '})()');
    const h3 = JSON.parse(r7b);
    assert(h3.moved > 6, '坦克顶墙自动沿墙滑动脱困（位移 ' + h3.moved + 'm）');

    const errors = cdp.errors();
    for (const err of errors) console.error('  !! ' + err);
    assert(errors.length === 0, '无运行时异常');
  } catch (e) {
    failed = true;
    console.error('TEST FAILED: ' + e.message);
  } finally { proc.kill(); }
  if (failed) process.exit(1);
  console.log('PASS test_vehicle_combat');
})();
