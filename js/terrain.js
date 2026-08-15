// ============================================================
//  terrain.js  ·  高度场缓冲地形 + 三地图（沙漠/雪域/钢铁防线）
//  可破坏建筑（三级状态）/ 弹坑雕刻 / 碰撞 / 视线
//  v4 爆改：地形真相改为 1m 高度场缓冲，弹坑直接雕刻缓冲，
//           人与载具统一采样，物理天然一致。
// ============================================================
(function () {
  'use strict';
  const M = Game.math;
  const { clamp, lerp, dist2 } = M;

  const T = {
    solids: [],        // 全部实体（建筑 + 可破坏物 + 岩石），含 3D AABB 与 2D 足迹
    buildings: [],     // 建筑（含可毁棚屋）
    destructibles: [], // 可破坏物
    fortwalls: [],     // v5.13 永久墙工事（不可摧毁）
    trees: [],
    flattenZones: [],
    roadPaths: [],
    mapId: 'desert',
  };

  // ============================================================
  //  高度场缓冲（1m 网格，弹坑与压平都写进缓冲）
  // ============================================================
  T.cell = 1;
  T.N = 0;              // 每边格数 = WORLD*2/cell
  T.hf = null;          // Float32Array (N+1)^2
  T.hIdx = function (i, j) { return i * (T.N + 1) + j; };

  function heightAt(x, z) {
    const W = CONFIG.WORLD;
    x = clamp(x, -W, W); z = clamp(z, -W, W);
    const fx = (x + W) / T.cell, fz = (z + W) / T.cell;
    let i0 = Math.floor(fx), j0 = Math.floor(fz);
    const i1 = Math.min(i0 + 1, T.N), j1 = Math.min(j0 + 1, T.N);
    if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
    if (i0 > T.N) i0 = T.N; if (j0 > T.N) j0 = T.N;
    const tx = fx - i0, tz = fz - j0;
    const h00 = T.hf[T.hIdx(i0, j0)], h10 = T.hf[T.hIdx(i1, j0)];
    const h01 = T.hf[T.hIdx(i0, j1)], h11 = T.hf[T.hIdx(i1, j1)];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
  T.heightAt = heightAt;

  // ============================================================
  //  地图原始高度函数
  // ============================================================
  function desertRawHeight(x, z) {
    // 沙丘：多层正弦叠加，起伏明显
    let h = 6.5 * Math.sin(x * 0.038 + 0.6) * Math.sin(z * 0.05 + 1.2);
    h += 3.2 * Math.sin(x * 0.085 + 2.4) * Math.sin(z * 0.115 + 0.4);
    h += 4.0 * Math.sin(x * 0.028 + z * 0.045 + 0.8);
    h += 1.2 * Math.sin(x * 0.2 + z * 0.16);
    return h - 0.8;
  }
  // v5 第三张地图：雪域要塞（丘陵 + 北侧山脉 + 冰湖）
  function snowRawHeight(x, z) {
    let h = 4.0 * Math.sin(x * 0.03 + 0.5) * Math.sin(z * 0.042 + 0.9);
    h += 2.4 * Math.sin(x * 0.07 + 1.8) * Math.sin(z * 0.09 + 2.2);
    h += 3.2 * Math.sin(x * 0.022 + z * 0.05 + 0.4);
    // 北侧山脉（雷达站后方高地）
    const ridge = Math.exp(-Math.pow((z - 81) / 45, 2)) * 13 * (0.6 + 0.4 * Math.sin(x * 0.05));
    h += ridge;
    return h + 3;
  }
  // v5.30 第五张地图：钢铁防线（峡谷要塞——西低东高，东侧堡垒高台，中央谷地通道）
  function fortRawHeight(x, z) {
    let h = Math.sin(x * 0.045) * 2.2 + Math.cos(z * 0.06) * 1.8 + Math.sin((x + z) * 0.03) * 2.5;
    const ridge = Math.max(0, (x - 27) / 68);
    h += Math.min(9, ridge * ridge * 14);          // 东侧堡垒高台（封顶 9m）
    h += Math.sin(z * 0.11) * 1.6 * Math.max(0, (x - 12) / 90);   // 高台起伏
    return h;
  }
  function rawHeight(x, z) {
    if (T.mapId === 'snow') return snowRawHeight(x, z);
    if (T.mapId === 'fort') return fortRawHeight(x, z);
    return desertRawHeight(x, z);
  }

  // ---- 高度 → 地表颜色（双图配色） ----
  function bandColor(y) {
    let c;
    if (T.mapId === 'desert') {
      if (y < -2) c = [0xb8, 0x96, 0x5e];
      else if (y < 2) c = [0xc2, 0xa3, 0x6b];
      else if (y < 7) c = [0xcb, 0xaa, 0x6e];
      else if (y < 14) c = [0xd4, 0xb2, 0x73];
      else c = [0xdc, 0xbc, 0x7c];
    } else if (T.mapId === 'snow') {
      if (y < 2.4) c = [0x9f, 0xb8, 0xc8];       // 冰面蓝
      else if (y < 8) c = [0xe9, 0xef, 0xf3];     // 雪
      else if (y < 18) c = [0xc9, 0xd4, 0xdd];    // 深雪
      else c = [0x8f, 0x9f, 0xad];                // 裸岩
    } else {
      if (y < -1) c = [0x5d, 0x54, 0x40];        // 泥
      else if (y < 4) c = [0x55, 0x66, 0x4a];    // 荒草
      else if (y < 14) c = [0x6e, 0x63, 0x50];   // 土
      else if (y < 24) c = [0x78, 0x72, 0x6a];   // 岩
      else c = [0xbd, 0xba, 0xb0];               // 灰雪
    }
    return c;
  }
  T.bandColor = bandColor;

  // ============================================================
  //  压平区（写缓冲）
  // ============================================================
  function applyFlattens() {
    for (const f of T.flattenZones) {
      const m = f.margin || 3;
      const i0 = Math.max(0, Math.floor((f.cx - f.w / 2 - m + CONFIG.WORLD) / T.cell));
      const i1 = Math.min(T.N, Math.ceil((f.cx + f.w / 2 + m + CONFIG.WORLD) / T.cell));
      const j0 = Math.max(0, Math.floor((f.cz - f.d / 2 - m + CONFIG.WORLD) / T.cell));
      const j1 = Math.min(T.N, Math.ceil((f.cz + f.d / 2 + m + CONFIG.WORLD) / T.cell));
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const x = -CONFIG.WORLD + i * T.cell, z = -CONFIG.WORLD + j * T.cell;
          const dx = Math.abs(x - f.cx), dz = Math.abs(z - f.cz);
          const inX = dx < f.w / 2 + m, inZ = dz < f.d / 2 + m;
          if (!inX || !inZ) continue;
          let t = 1;
          if (dx > f.w / 2) t *= 1 - (dx - f.w / 2) / m;
          if (dz > f.d / 2) t *= 1 - (dz - f.d / 2) / m;
          const k = T.hIdx(i, j);
          T.hf[k] = lerp(T.hf[k], f.baseH, clamp(t, 0, 1));
        }
      }
    }
  }

  // ============================================================
  //  弹坑系统：已按用户要求移除
  //  不再雕刻地形、不再重绘地块颜色 —— 地形网格生成后保持不变，
  //  地面与贴图/小地图完全一致，无透明空洞、无深色矩形色斑
  // ============================================================
  T.craters = 0;
  function addCrater(x, z, radius, depth) { /* 无操作：弹坑已移除 */ }
  T.addCrater = addCrater;
  function update(dt) { /* 无操作：地形无需冲刷 */ }
  T.update = update;

  // ============================================================
  //  生成主入口（支持切换地图）
  // ============================================================
  function generate(scene, mapId) {
    T.mapId = mapId || 'desert';
    T.clear(scene);
    // 地图用独立确定性随机源（与战斗 rng 隔离，切图布局恒定）
    const rng = Game.newRng((T.mapId === 'desert' ? 0x5a5a11 : T.mapId === 'fort' ? 0x7a2d2d : 0x4a11aa) >>> 0);
    const W = CONFIG.WORLD;
    T.N = Math.round((W * 2) / T.cell);
    T.hf = new Float32Array((T.N + 1) * (T.N + 1));
    T.flattenZones = [];
    T.roadPaths = [];
    T.dirtyRect = null; T.craters = 0;

    // 1) 高度场填充
    for (let i = 0; i <= T.N; i++) {
      for (let j = 0; j <= T.N; j++) {
        T.hf[T.hIdx(i, j)] = rawHeight(-W + i * T.cell, -W + j * T.cell);
      }
    }

    // 2) 基地/旗点/跑道压平
    const flagPos = allFlagPositions(T.mapId);
    // 建筑避让：征服旗大半径清场，突破旗小半径（街区保留）
    T.flagClear = MAP_DEFS[T.mapId].flags.conquest.map((f) => ({ x: f.x, z: f.z, r: 18 }));
    for (const sec of MAP_DEFS[T.mapId].flags.breakthrough) {
      for (const f of sec.flags) T.flagClear.push({ x: f.x, z: f.z, r: 11 });
    }
    for (const b of BASE_DEFS) {
      T.flattenZones.push({ cx: b.x, cz: b.z, w: 36, d: 30, baseH: rawHeight(b.x, b.z), margin: 6 });
    }
    for (const f of flagPos) {
      T.flattenZones.push({ cx: f.x, cz: f.z, w: 16, d: 16, baseH: rawHeight(f.x, f.z), margin: 4 });
    }
    applyFlattens();

    // 3) 布局
    if (T.mapId === 'snow') genSnow(rng, W, flagPos);
    else if (T.mapId === 'fort') genFort(rng, W, flagPos);   // v5.30 钢铁防线
    else genDesert(rng, W, flagPos);

    // 4) 地形网格
    buildTerrainMesh(scene, W);

    // 4.5) 建筑/掩体地基压平：addSolid 登记的压平区此前从未应用 → 建筑在坡地上悬空/下陷；
    //     现在在网格生成前统一应用，地形与建筑严丝合缝
    applyFlattens();

    // 5) 实体网格 + 树木
    for (const s of T.solids) buildSolidMesh(scene, s);
    for (const t of T.trees) buildTreeMesh(scene, t);
    buildIce(scene);   // v5：雪地图冰湖冰面

    Game.buildings = T.buildings;
    Game.destructibles = T.destructibles;
    console.log('[terrain] 地图「' + (MAP_DEFS[T.mapId] || {}).name + '」生成完成: 建筑', T.buildings.length,
      '可破坏物', T.destructibles.length, '树', T.trees.length, '实体总数', T.solids.length);
    return T.solids.length;
  }
  T.generate = generate;

  // ---- 清理旧地图（重建/切换地图时调用） ----
  function clear(scene) {
    if (T.ground) {
      scene.remove(T.ground);
      T.ground.geometry.dispose(); T.ground.material.dispose();
      T.ground = null;
    }
    for (const s of T.solids) {
      if (s.mesh) {
        scene.remove(s.mesh);
        if (s.mesh.traverse) s.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
        else { if (s.mesh.geometry) s.mesh.geometry.dispose(); if (s.mesh.material) s.mesh.material.dispose(); }
      }
    }
    for (const t of T.trees) {
      if (t.mesh) { scene.remove(t.mesh); t.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    }
    if (T.roadMeshes) for (const m of T.roadMeshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    if (T.iceMesh) { scene.remove(T.iceMesh); T.iceMesh.geometry.dispose(); T.iceMesh.material.dispose(); T.iceMesh = null; }
    T.solids = []; T.buildings = []; T.destructibles = []; T.fortwalls = []; T.trees = [];
    T.roadMeshes = [];
  }
  T.clear = clear;

  // ============================================================
  //  雪地地图布局 — 雪域要塞（v5）
  // ============================================================
  function genSnow(rng, W, flags) {
    // 冰湖（旗 A 附近）：压平 + 冰面
    T.flattenZones.push({ cx: 0, cz: -45, w: 34, d: 34, baseH: 1.1, margin: 10 });
    applyFlattens();
    // 混凝土碉堡（不可毁，挡视线，要塞骨架）
    for (let i = 0; i < 14; i++) {
      const spot = findSpot(rng, 4, 6, 4, 6, 14, 30, flags);
      if (!spot) continue;
      addSolid(T.destructibles, 'bunker', spot.x, spot.z, spot.w, spot.d, 3.2,
        { destructible: false, blocksLOS: true, bunker: true });
    }
    // 林间木屋（可毁，塌成瓦砾）
    for (let i = 0; i < 10; i++) {
      const spot = findSpot(rng, 5, 7, 5, 7, 16, 26, flags);
      if (!spot) continue;
      addSolid(T.buildings, 'shack', spot.x, spot.z, spot.w, spot.d, M.randRange(rng, 3.2, 4.4),
        { destructible: true, hp: 7600, blocksLOS: true, collapse: true, rubble: true, snowCabin: true });
    }
    placeFortifications(rng, W, flags);   // v5.13 永久墙工事（先于小型掩体，保证墙体净空）
    placeDestructibles(rng, W, flags);
    placeFlagCover(rng, flags);
    // 松林（密集雪松 + 少量裸岩）
    for (let i = 0; i < 70; i++) {
      const x = M.randRange(rng, -W + 12, W - 12);
      const z = M.randRange(rng, -W + 12, W - 12);
      let ok = true;
      for (const s of T.solids) {
        if (dist2(x, z, s.cx, s.cz) < (s.w + 1.5) / 2) { ok = false; break; }
      }
      if (!ok) continue;
      for (const f of flags) if (dist2(x, z, f.x, f.z) < 9) { ok = false; break; }
      if (!ok) continue;
      T.trees.push({ x, z, h: M.randRange(rng, 3.4, 7.5), s: M.randRange(rng, 0.8, 1.5), kind: 'pine' });
    }
    for (let i = 0; i < 12; i++) {
      const spot = findSpot(rng, 1.5, 3.5, 1.5, 3.5, 8, 20, flags);
      if (!spot) continue;
      addSolid(T.solids, 'rock', spot.x, spot.z, spot.w, spot.d, M.randRange(rng, 1.2, 2.8),
        { destructible: false, blocksLOS: true, isRock: true });
    }
    placeMilitary(rng, W, flags);   // v5.45 军事设施
  }

  // ============================================================
  //  通用布局助手（随机落点，避让旗点/基地/已有实体）
  // ============================================================
  function findSpot(rng, minW, maxW, minD, maxD, minFlagDist, minBaseDist, flags) {
    for (let i = 0; i < 80; i++) {
      const w = M.randRange(rng, minW, maxW);
      const d = M.randRange(rng, minD, maxD);
      const x = M.randRange(rng, -CONFIG.WORLD + 30, CONFIG.WORLD - 30);
      const z = M.randRange(rng, -CONFIG.WORLD + 30, CONFIG.WORLD - 30);
      let ok = true;
      for (const f of flags) if (dist2(x, z, f.x, f.z) < minFlagDist) { ok = false; break; }
      if (!ok) continue;
      for (const b of BASE_DEFS) if (dist2(x, z, b.x, b.z) < minBaseDist) { ok = false; break; }
      if (!ok) continue;
      for (const s of T.solids) {
        if (Math.abs(x - s.cx) < (w + s.w) / 2 + 3 && Math.abs(z - s.cz) < (d + s.d) / 2 + 3) { ok = false; break; }
      }
      if (ok) return { x, z, w, d };
    }
    return null;
  }

  // ============================================================
  //  v5.30 钢铁防线布局 — 突破模式史诗地图（西线堑壕 → 中央油库 → 东侧堡垒）
  // ============================================================
  function genFort(rng, W, flags) {
    // 1) 东侧堡垒（最终防线的制高点）：大型要塞建筑 + 碉堡 + 墙阵
    const citadel = { x: 87, z: 0 };
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + rng() * 0.4;
      const d = 14 + rng() * 8;
      const x = citadel.x + Math.sin(ang) * d, z = citadel.z + Math.cos(ang) * d;
      const bw = M.randRange(rng, 7, 10), bd = M.randRange(rng, 7, 10);
      addSolid(T.buildings, 'building', x, z, bw, bd, M.randRange(rng, 10, 17),
        { destructible: true, hp: 18000, blocksLOS: true, stages: true, rubble: true });
    }
    addSolid(T.buildings, 'building', citadel.x, citadel.z, 12, 12, 18,
      { destructible: true, hp: 22000, blocksLOS: true, stages: true, rubble: true });   // 主堡
    for (let i = 0; i < 8; i++) {
      const spot = findSpot(rng, 4, 6, 4, 6, 16, 26, flags);
      if (!spot) continue;
      addSolid(T.destructibles, 'bunker', spot.x, spot.z, spot.w, spot.d, 3.2,
        { destructible: false, blocksLOS: true, bunker: true });
    }
    // 2) 永久墙工事（先于小型掩体布置，保证墙体净空——每扇区防线交错断墙）
    placeFortifications(rng, W, flags);
    // 3) 中央油库（S2 燃料库：殉爆链=史诗场面）
    oilfield(rng, 0, -45, 0.6, flags);
    oilfield(rng, 0, 9, 0.2, flags);
    for (let i = 0; i < 26; i++) {
      const spot = findSpot(rng, 0.8, 0.9, 0.8, 0.9, 8, 22, flags);
      if (!spot) continue;
      addSolid(T.destructibles, 'barrel', spot.x, spot.z, spot.w, spot.d, 1.1,
        { destructible: true, hp: 24, blocksLOS: false, explode: true });
    }
    // 4) 西线堑壕（S1 前线：沙袋战壕线 + 废弃车辆；避让已有实体）
    for (let lx = -60; lx <= -51; lx += 6) {
      for (let lz = -45; lz <= 45; lz += 5) {
        if (rng() < 0.22) continue;   // 留出击通道
        const w = 2.6 + rng() * 2, d = 0.9;
        const tx = lx + (rng() - 0.5) * 2;
        let ok = true;
        for (const s of T.solids) {
          if (Math.abs(tx - s.cx) < (w + s.w) / 2 + 2.5 && Math.abs(lz - s.cz) < (d + s.d) / 2 + 2.5) { ok = false; break; }
        }
        if (!ok) continue;
        addSolid(T.destructibles, 'sandbag', tx, lz, w, d, 1.0,
          { destructible: true, hp: 160, blocksLOS: true });
      }
    }
    for (let i = 0; i < 14; i++) {
      const spot = findSpot(rng, 2.0, 2.2, 4.0, 4.4, 8, 18, flags);
      if (!spot) continue;
      addSolid(T.destructibles, 'wreck', spot.x, spot.z, spot.w, spot.d, 1.4,
        { destructible: true, hp: 350, blocksLOS: true, explode: true, blastRadius: 6, blastDmg: 120 });
    }
    // 5) 通用：掩体/旗点工事/岩群（东侧高台加岩）
    placeDestructibles(rng, W, flags);
    placeFlagCover(rng, flags);
    for (let i = 0; i < 10; i++) {
      const spot = findSpot(rng, 1.5, 3.5, 1.5, 3.5, 10, 20, flags);
      if (!spot) continue;
      addSolid(T.solids, 'rock', spot.x, spot.z, spot.w, spot.d, M.randRange(rng, 1.2, 2.8),
        { destructible: false, blocksLOS: true, isRock: true });
    }
    placeScenery(rng, W, flags, false);
    placeMilitary(rng, W, flags);   // v5.45 军事设施
  }

  // ============================================================
  //  沙漠地图布局 — 沙暴行动
  // ============================================================
  function genDesert(rng, W, flags) {
    // 土坯村庄（可破坏建筑 + 院墙）
    adobeVillage(rng, -45, 42, 0.9, flags);
    adobeVillage(rng, 45, 45, 0.2, flags);
    // 油田（油罐可殉爆）
    oilfield(rng, -68, -12, 0.6, flags);
    oilfield(rng, 68, -12, 0.1, flags);
    // 绿洲（旗点 A 附近棕榈林）
    oasis(rng, 0, -45, flags);
    placeFortifications(rng, W, flags);   // v5.13 永久墙工事（先于小型掩体，保证墙体净空）
    // 掩体 + 补给
    placeDestructibles(rng, W, flags);
    placeFlagCover(rng, flags);
    // 岩群 + 棕榈/枯树
    placeScenery(rng, W, flags, true);
    placeMilitary(rng, W, flags);   // v5.45 军事设施
  }

  function adobeVillage(rng, cx, cz, seed, flags) {
    for (let i = 0; i < 8; i++) {
      const ang = rng() * Math.PI * 2, dist = 6 + rng() * 20;
      const x = cx + Math.sin(ang) * dist, z = cz + Math.cos(ang) * dist;
      let nearFlag = false;
      for (const f of flags) if (dist2(x, z, f.x, f.z) < 14) nearFlag = true;
      if (nearFlag || Math.abs(x) > CONFIG.WORLD - 20 || Math.abs(z) > CONFIG.WORLD - 20) continue;
      const w = 7 + rng() * 6, d = 7 + rng() * 6, h = 3.6 + rng() * 2.4;
      addSolid(T.buildings, 'building', x, z, w, d, h,
        { destructible: true, hp: 12400, blocksLOS: true, stages: true, rubble: true, adobe: true });
    }
    // 院墙（长条低墙，可破坏）
    for (let i = 0; i < 5; i++) {
      const ang = rng() * Math.PI * 2, dist = 10 + rng() * 16;
      const x = cx + Math.sin(ang) * dist, z = cz + Math.cos(ang) * dist;
      let nearFlag = false;
      for (const f of flags) if (dist2(x, z, f.x, f.z) < 12) nearFlag = true;
      if (nearFlag) continue;
      const len = 8 + rng() * 8;
      addSolid(T.destructibles, 'wall', x, z, len, 0.7, 2.1,
        { destructible: true, hp: 240, blocksLOS: true });
    }
  }

  function oilfield(rng, cx, cz, seed, flags) {
    for (let i = 0; i < 5; i++) {
      const ang = rng() * Math.PI * 2, dist = 4 + rng() * 14;
      const x = cx + Math.sin(ang) * dist, z = cz + Math.cos(ang) * dist;
      addSolid(T.destructibles, 'oilTank', x, z, 5, 5, 6,
        { destructible: true, hp: 300, blocksLOS: true, explode: true, blastRadius: 10, blastDmg: 140 });
    }
    // 泵机（装饰）
    for (let i = 0; i < 3; i++) {
      const ang = rng() * Math.PI * 2, dist = 6 + rng() * 12;
      const x = cx + Math.sin(ang) * dist, z = cz + Math.cos(ang) * dist;
      T.trees.push({ x, z, h: 2.6, s: 0.5, kind: 'pump' });
    }
  }

  function oasis(rng, cx, cz, flags) {
    T.flattenZones.push({ cx, cz, w: 22, d: 22, baseH: rawHeight(cx, cz) - 0.5, margin: 6 });
    applyFlattens();
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2 + 0.3;
      const x = cx + Math.sin(ang) * 10, z = cz + Math.cos(ang) * 10;
      T.trees.push({ x, z, h: 5.2, s: 1.1, kind: 'palm' });
    }
  }

  // ============================================================
  //  v5.13 永久墙工事：不可摧毁混凝土墙阵（趣味性掩体/咽喉）
  //  - 每旗一组 L 形射击工事；旗点之间交错布置断墙线
  //  - 避开旗点/基地/载具刷新点，段间留 ≥4m 通道
  // ============================================================
  function placeFortifications(rng, W, flags) {
    // 轴向对齐墙段（alongZ=true 沿 z 延伸，否则沿 x）
    const wallSeg = (x, z, len, alongZ) => {
      const w = alongZ ? 0.8 : len, d = alongZ ? len : 0.8;
      for (const f of flags) if (dist2(x, z, f.x, f.z) < 9) return;
      for (const b of BASE_DEFS) if (dist2(x, z, b.x, b.z) < 24) return;
      for (const sp of VEHICLE_SPAWNS) if (dist2(x, z, sp.x, sp.z) < 7) return;
      for (const s of T.solids) {
        if (Math.abs(x - s.cx) < (w + s.w) / 2 + 3 && Math.abs(z - s.cz) < (d + s.d) / 2 + 3) return;
      }
      addSolid(T.fortwalls, 'fortwall', x, z, w, d, 2.4,
        { destructible: false, blocksLOS: true, fortwall: true });
    };
    // 1) 旗点射击工事：L 形两段（留口进人）
    for (const f of flags) {
      const len = 6 + rng() * 3;
      const off = 11 + rng() * 3;
      for (const dir of [[1, 1], [-1, -1]]) {   // 对角两个方向各一组 L，保证墙体数量
        const hx = dir[0], hz = dir[1];
        wallSeg(f.x + hx * off, f.z + hz * (len / 2 + 2), len, false);   // 沿 x 段
        wallSeg(f.x + hx * (len / 2 + 2) * (hz < 0 ? -1 : 1), f.z + hz * off, len, true);   // 沿 z 段
      }
    }
    // 2) 旗点之间：交错断墙线（每对旗 2 段，左右交替）
    for (let i = 0; i < flags.length; i++) {
      for (let j = i + 1; j < flags.length; j++) {
        const a = flags[i], b = flags[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1;
        if (L > 110) continue;
        const alongZ = Math.abs(dx) > Math.abs(dz);   // 墙垂直于主要行进方向
        const nx = -dz / L, nz = dx / L;
        for (let k = 1; k <= 2; k++) {
          const f = k / 3;
          const mx = a.x + dx * f, mz = a.z + dz * f;
          const side = (k % 2 === 0 ? 1 : -1);
          const off = 7 + rng() * 3;
          const segLen = 5 + rng() * 4;
          wallSeg(mx + nx * side * off, mz + nz * side * off, segLen, alongZ);
        }
      }
    }
  }

  function placeDestructibles(rng, W, flags) {
    // 沙袋掩体
    for (let i = 0; i < 56; i++) {
      const spot = findSpot(rng, 2.5, 5, 0.7, 1.0, 10, 30, flags);
      if (!spot) continue;
      addSolid(T.destructibles, 'sandbag', spot.x, spot.z, spot.w, spot.d, 1.0,
        { destructible: true, hp: 160, blocksLOS: true });
    }
    // 木箱
    for (let i = 0; i < 40; i++) {
      const spot = findSpot(rng, 1.1, 1.4, 1.1, 1.4, 8, 25, flags);
      if (!spot) continue;
      addSolid(T.destructibles, 'crate', spot.x, spot.z, spot.w, spot.d, 1.3,
        { destructible: true, hp: 70, blocksLOS: false });
    }
    // 油桶（爆炸）
    for (let i = 0; i < 44; i++) {
      const spot = findSpot(rng, 0.8, 0.9, 0.8, 0.9, 7, 22, flags);
      if (!spot) continue;
      addSolid(T.destructibles, 'barrel', spot.x, spot.z, spot.w, spot.d, 1.1,
        { destructible: true, hp: 24, blocksLOS: false, explode: true });
    }
  }

  function freeSpot(x, z, w, d, minFlagDist, flags) {
    if (Math.abs(x) > CONFIG.WORLD - 15 || Math.abs(z) > CONFIG.WORLD - 15) return false;
    for (const s of T.solids) {
      if (Math.abs(x - s.cx) < (w + s.w) / 2 + 3 && Math.abs(z - s.cz) < (d + s.d) / 2 + 3) return false;
    }
    for (const f of flags) if (dist2(x, z, f.x, f.z) < minFlagDist) return false;
    return true;
  }

  function placeFlagCover(rng, flags) {
    for (let i = 0; i < flags.length; i++) {
      for (let j = i + 1; j < flags.length; j++) {
        const a = flags[i], b = flags[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1;
        if (L > 100) continue;
        const nx = -dz / L, nz = dx / L;
        for (let k = 0; k < 6; k++) {
          const f = (k + 1) / 7;
          const off = [-8, 5, -3, 3, -5, 8][k];
          const cx = a.x + dx * f + nx * off, cz = a.z + dz * f + nz * off;
          if (!freeSpot(cx, cz, 7, 6, 9, flags)) continue;
          addSolid(T.buildings, 'shack', cx, cz, 7, 6, M.randRange(rng, 4.5, 6),
            { destructible: true, hp: 7200, blocksLOS: true, collapse: true, rubble: true });
        }
      }
    }
  }

  function placeScenery(rng, W, flags, desert) {
    // 岩石（挡视线）
    for (let i = 0; i < (desert ? 26 : 12); i++) {
      const spot = findSpot(rng, 1.5, 3.5, 1.5, 3.5, 8, 20, flags);
      if (!spot) continue;
      const h = M.randRange(rng, 1.2, desert ? 3.4 : 2.8);
      addSolid(T.solids, 'rock', spot.x, spot.z, spot.w, spot.d, h,
        { destructible: false, blocksLOS: true, isRock: true, desert });
    }
    // 树（棕榈/枯树/绿树，装饰）
    for (let i = 0; i < (desert ? 26 : 14); i++) {
      const x = M.randRange(rng, -CONFIG.WORLD + 12, CONFIG.WORLD - 12);
      const z = M.randRange(rng, -CONFIG.WORLD + 12, CONFIG.WORLD - 12);
      let ok = true;
      for (const s of T.solids) {
        if (dist2(x, z, s.cx, s.cz) < (s.w + 1.5) / 2) { ok = false; break; }
      }
      if (!ok) continue;
      T.trees.push({
        x, z, h: M.randRange(rng, 3, 6), s: M.randRange(rng, 0.7, 1.3),
        kind: desert ? (rng() < 0.6 ? 'palm' : 'dead') : 'green',
      });
    }
  }

  // v5.45 军事设施与掩体工事（瞭望塔/雷达/帐篷/弹药箱）
  function placeMilitary(rng, W, flags) {
    // 瞭望塔（2 座）
    for (let i = 0; i < 2; i++) {
      const spot = findSpot(rng, 2.6, 2.6, 2.6, 2.6, 16, 30, flags);
      if (spot) addSolid(T.solids, 'watchtower', spot.x, spot.z, 2.6, 2.6, 8.5,
        { destructible: false, blocksLOS: true });
    }
    // 雷达站（1 座）
    const rspot = findSpot(rng, 2.0, 2.0, 2.0, 2.0, 14, 28, flags);
    if (rspot) addSolid(T.solids, 'radar', rspot.x, rspot.z, 1.7, 1.7, 2.6,
      { destructible: false, blocksLOS: false });
    // 帐篷（3 顶）
    for (let i = 0; i < 3; i++) {
      const spot = findSpot(rng, 2.4, 3.2, 2.4, 3.2, 14, 26, flags);
      if (spot) addSolid(T.destructibles, 'tent', spot.x, spot.z, spot.w, spot.d, 1.7,
        { destructible: true, hp: 500, blocksLOS: true, collapse: true });
    }
    // 弹药箱（8 个，可殉爆）
    for (let i = 0; i < 8; i++) {
      const spot = findSpot(rng, 1.0, 1.2, 1.0, 1.2, 7, 20, flags);
      if (spot) addSolid(T.destructibles, 'crate', spot.x, spot.z, spot.w, spot.d, 1.1,
        { destructible: true, hp: 200, blocksLOS: false, explode: true, blastRadius: 5, blastDmg: 90 });
    }
  }

  // ---- 登记实体（压平 + 碰撞盒） ----
  function addSolid(list, kind, x, z, w, d, h, opts) {
    // v5.45 修复悬空：取足迹内最低高度为地基（向上填土），避免建筑悬空在坡地上
    let baseH = rawHeight(x, z);
    for (let sx = -2; sx <= 2; sx++) {
      for (let sz = -2; sz <= 2; sz++) {
        const px = x + (sx / 2) * (w / 2), pz = z + (sz / 2) * (d / 2);
        baseH = Math.min(baseH, rawHeight(px, pz));
      }
    }
    T.flattenZones.push({ cx: x, cz: z, w: w, d: d, baseH: baseH, margin: 3.5 });
    const s = {
      kind, list, cx: x, cz: z, w, d, h,
      baseH,
      min: { x: x - w / 2, y: baseH, z: z - d / 2 },
      max: { x: x + w / 2, y: baseH + h, z: z + d / 2 },
      solid: true, blocksLOS: !!opts.blocksLOS,
      destructible: !!opts.destructible, hp: opts.hp || Infinity, maxHp: opts.hp || Infinity,
      explode: !!opts.explode, collapse: !!opts.collapse, isRock: !!opts.isRock,
      blastRadius: opts.blastRadius || 7, blastDmg: opts.blastDmg || 160,
      stages: !!opts.stages, state: 0, rubble: !!opts.rubble, adobe: !!opts.adobe,
      snowCabin: !!opts.snowCabin, bunker: !!opts.bunker,
      desert: !!opts.desert,
      mesh: null, parts: null,
    };
    list.push(s);
    T.solids.push(s);
    return s;
  }

  // ---- 地形网格（顶点与高度场严格对齐） ----
  // 修复：PlaneGeometry 顶点序为 iy*行 + ix，旋转后世界坐标 x=-W+ix、z=W-iy；
  // 旧代码用 hIdx(i,j) 直取顶点索引 → 高度场被转置+镜像（实测 76% 顶点偏差、
  // 最大 7.15m），导致建筑/道路悬空下沉、贴图与建模不匹配、小地图对不上。
  // 现在按顶点的真实世界坐标反查高度场索引。
  function buildTerrainMesh(scene, W) {
    const seg = T.N;
    const geo = new THREE.PlaneGeometry(W * 2, W * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let iy = 0; iy <= T.N; iy++) {
      for (let ix = 0; ix <= T.N; ix++) {
        const k = iy * (T.N + 1) + ix;      // PlaneGeometry 顶点索引
        const hk = T.hIdx(ix, iy);          // 该顶点世界坐标 (x=-W+ix, z=-W+iy) 对应的高度场（转置索引）
        pos.setY(k, T.hf[hk]);
        const c = bandColor(T.hf[hk]);
        colors[k * 3] = c[0] / 255; colors[k * 3 + 1] = c[1] / 255; colors[k * 3 + 2] = c[2] / 255;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    T.ground = mesh;
  }

  // ---- 建筑立面纹理（窗户；开裂变体） ----
  const _facadeTex = {};
  function facadeTexture(cracked) {
    const key = cracked ? 'cracked' : 'base';
    if (_facadeTex[key]) return _facadeTex[key];
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#b5b0a6'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#39404a';
    for (let r = 0; r < 4; r++) for (let col = 0; col < 3; col++) ctx.fillRect(18 + col * 38, 14 + r * 30, 20, 16);
    ctx.fillStyle = '#8a857b'; ctx.fillRect(0, 112, 128, 16);
    if (cracked) {
      // 弹痕裂纹 + 熏黑
      ctx.strokeStyle = 'rgba(35,30,25,0.9)'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        let x = Math.random() * 128, y = Math.random() * 40;
        ctx.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 46; y += 12 + Math.random() * 22; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,26,22,0.4)';
      for (let i = 0; i < 5; i++) ctx.fillRect(Math.random() * 128, Math.random() * 128, 10 + Math.random() * 16, 14 + Math.random() * 18);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    _facadeTex[key] = tex;
    return tex;
  }

  // ---- 道路：已按用户要求移除（无厚度无实体长方形贴图的来源之一） ----
  function buildRoads(scene) { /* 无操作 */ }

  // ---- 冰湖冰面（雪地图） ----
  function buildIce(scene) {
    if (T.mapId !== 'snow') return;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 34),
      new THREE.MeshStandardMaterial({ color: 0xa8c8d8, roughness: 0.2, metalness: 0.1 })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, 1.32, -45);
    g.receiveShadow = true;
    scene.add(g);
    T.iceMesh = g;
  }

  // ---- 实体网格 ----
  function buildSolidMesh(scene, s) {
    let mesh;
    if (s.kind === 'barrel') {
      const g = new THREE.CylinderGeometry(0.45, 0.45, s.h, 12);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb03a2a, roughness: 0.5, metalness: 0.4 }));
      mesh.position.set(s.cx, s.baseH + s.h / 2, s.cz);
    } else if (s.kind === 'oilTank') {
      const g = new THREE.CylinderGeometry(2.5, 2.5, s.h, 14);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.4, metalness: 0.5 }));
      mesh.position.set(s.cx, s.baseH + s.h / 2, s.cz);
    } else if (s.kind === 'sandbag') {
      const g = new THREE.BoxGeometry(s.w, s.h, s.d);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: s.desert ? 0xa89878 : 0x7d7055, roughness: 0.95 }));
      mesh.position.set(s.cx, s.baseH + s.h / 2, s.cz);
    } else if (s.kind === 'wall') {
      const g = new THREE.BoxGeometry(s.w, s.h, s.d);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9a8664, roughness: 0.9 }));
      mesh.position.set(s.cx, s.baseH + s.h / 2, s.cz);
    } else if (s.kind === 'crate') {
      const g = new THREE.BoxGeometry(s.w, s.h, s.d);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8a6f3f, roughness: 0.9 }));
      mesh.position.set(s.cx, s.baseH + s.h / 2, s.cz);
    } else if (s.kind === 'rock') {
      const g = new THREE.IcosahedronGeometry(Math.max(s.w, s.d) / 2, 1);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: s.desert ? 0x8a7a5e : (T.mapId === 'snow' ? 0x8a9198 : 0x6f6a63), roughness: 0.9, flatShading: true }));
      mesh.position.set(s.cx, s.baseH + s.h * 0.3, s.cz);
      mesh.scale.y = s.h / Math.max(s.w, s.d);
    } else if (s.kind === 'bunker') {
      // 混凝土碉堡（不可毁）：带观察射击缝
      const g = new THREE.BoxGeometry(s.w, s.h, s.d);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.9 }));
      mesh.position.set(s.cx, s.baseH + s.h / 2, s.cz);
      mesh.castShadow = true;
      const slit = new THREE.Mesh(
        new THREE.BoxGeometry(s.w * 0.7, 0.45, 0.25),
        new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 })
      );
      slit.position.set(0, 0.4, s.d / 2 + 0.06);
      mesh.add(slit);
    } else if (s.kind === 'fortwall') {
      // v5.13 永久墙工事：混凝土墙身 + 顶部压条（不可摧毁）
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(s.w, s.h, s.d),
        new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.9 })
      );
      body.position.set(0, s.h / 2, 0);
      body.castShadow = true;
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(s.w + 0.06, 0.16, s.d + 0.06),
        new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.85 })
      );
      cap.position.set(0, s.h - 0.08, 0);
      g.add(body, cap);
      g.position.set(s.cx, s.baseH, s.cz);
      mesh = g;
    } else if (s.kind === 'wreck') {
      // 废弃车辆：锈红车身 + 深色座舱（可殉爆掩体）
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(s.w, s.h * 0.6, s.d),
        new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: 0.85, metalness: 0.2 })
      );
      body.position.set(0, s.h * 0.3, 0);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(s.w * 0.9, s.h * 0.42, s.d * 0.45),
        new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.4 })
      );
      cabin.position.set(0, s.h * 0.75, -s.d * 0.15);
      g.add(body, cabin);
      g.position.set(s.cx, s.baseH, s.cz);
      g.rotation.y = ((s.cx * 7 + s.cz * 13) % 314) / 100;   // 确定性朝向
      mesh = g;
    } else if (s.kind === 'watchtower') {
      // v5.45 瞭望塔：四脚 + 平台 + 顶棚
      const g = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: 0x6b5438, roughness: 0.9 });
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, s.h, 0.28), wood);
        leg.position.set((i % 2 ? 1.0 : -1.0), s.h / 2, (i < 2 ? 1.0 : -1.0));
        g.add(leg);
      }
      const plat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 2.6), new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.9 }));
      plat.position.set(0, s.h, 0);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.22, 3.0), wood);
      roof.position.set(0, s.h + 1.15, 0);
      g.add(plat, roof);
      g.position.set(s.cx, s.baseH, s.cz);
      mesh = g;
    } else if (s.kind === 'radar') {
      // v5.45 雷达站：基座 + 旋转抛物面
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, s.h, 1.7), new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.85 }));
      base.position.set(0, s.h / 2, 0);
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 }));
      dish.rotation.x = 0.8; dish.position.set(0, s.h + 0.3, -0.25);
      g.add(base, dish);
      g.position.set(s.cx, s.baseH, s.cz);
      g.rotation.y = ((s.cx * 5 + s.cz * 11) % 314) / 100;
      mesh = g;
      s.radarDish = dish;
    } else if (s.kind === 'tent') {
      // v5.45 帐篷：帐篷体 + 脊线
      const g = new THREE.Group();
      const cloth = new THREE.MeshStandardMaterial({ color: 0x6a7a58, roughness: 0.95 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), cloth);
      body.position.set(0, s.h / 2, 0);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(s.w * 1.05, 0.14, s.d * 1.05), new THREE.MeshStandardMaterial({ color: 0x58674a, roughness: 0.95 }));
      ridge.position.set(0, s.h + 0.05, 0);
      g.add(body, ridge);
      g.position.set(s.cx, s.baseH, s.cz);
      mesh = g;
    } else {
      // building / shack（v5.35 纵深造型：退台式塔楼 + 附楼 + 屋顶设备 + 天线，告别大方块）
      const isShack = s.kind === 'shack';
      const baseColor = s.adobe ? 0x9a8664 : (isShack ? (s.snowCabin ? 0x7a5a3e : 0x8a7a5c) : 0x9a968c);
      const wallMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85 });
      let crackedMat = null;
      if (s.stages) {
        const t = facadeTexture(true).clone(); t.needsUpdate = true;
        t.repeat.set(Math.max(1, Math.round(s.w / 6)), Math.max(1, Math.round(s.h / 4)));
        crackedMat = new THREE.MeshStandardMaterial({ map: t, color: baseColor, roughness: 0.85 });
      } else if (!isShack) {
        const t = facadeTexture(false).clone(); t.needsUpdate = true;
        t.repeat.set(Math.max(1, Math.round(s.w / 6)), Math.max(1, Math.round(s.h / 4)));
        wallMat.map = t;
      }
      const group = new THREE.Group();
      group.position.set(s.cx, s.baseH, s.cz);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), wallMat);
      wall.position.set(0, s.h / 2, 0);
      wall.castShadow = true;
      group.add(wall);
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(s.w + 0.8, 0.5, s.d + 0.8),
        new THREE.MeshStandardMaterial({ color: s.adobe ? 0x6a5a42 : (s.snowCabin ? 0xe8eef2 : 0x4a4742), roughness: 0.9 })
      );
      roof.position.set(0, s.h + 0.25, 0);
      roof.castShadow = true;
      group.add(roof);
      const extras = [];
      if (!isShack && !s.adobe) {
        // 确定性造型 hash（碰撞 AABB 不变，纯视觉纵深）
        const hsh = ((Math.round(s.cx * 31) + Math.round(s.cz * 17)) % 997) / 997;
        const towerM = new THREE.MeshStandardMaterial({ color: 0x8f8a82, roughness: 0.85 });
        const darkM = new THREE.MeshStandardMaterial({ color: 0x3f3d39, roughness: 0.9 });
        const grayM = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.7, metalness: 0.3 });
        const metalM = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.6 });
        // 退台式塔楼（四角/中心，高 35-60% 额外层）
        const towerH = s.h * (0.35 + hsh * 0.25);
        const tw = s.w * (0.5 + hsh * 0.22), td = s.d * (0.5 + hsh * 0.22);
        const posIdx = Math.floor(hsh * 5) % 5;
        const tx = posIdx === 4 ? 0 : (s.w * 0.3) * (posIdx % 2 === 0 ? 1 : -1);
        const tz = posIdx === 4 ? 0 : (s.d * 0.3) * (posIdx < 2 ? 1 : -1);
        const tower = new THREE.Mesh(new THREE.BoxGeometry(tw, towerH, td), towerM);
        tower.position.set(tx, s.h + towerH / 2, tz);
        tower.castShadow = true;
        const troof = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.5, 0.4, td + 0.5), darkM);
        troof.position.set(tx, s.h + towerH + 0.2, tz);
        // 屋顶设备：空调箱 + 水塔 + 天线
        const ac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.1), grayM);
        ac.position.set((hsh - 0.5) * s.w * 0.4, s.h + 0.6, (hsh * 1.3 - 0.65) * s.d * 0.4);
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 8),
          new THREE.MeshStandardMaterial({ color: 0x8a6f4a, roughness: 0.8 }));
        tank.position.set((0.4 - hsh) * s.w * 0.4, s.h + 0.9, (hsh - 0.2) * s.d * 0.4);
        const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.09, 3 + hsh * 3, 0.09), metalM);
        antenna.position.set(tx, s.h + towerH + 1.6 + hsh * 1.5, tz);
        // 底层附楼（矮翼，错落纵深）
        const annex = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.32, s.h * (0.4 + hsh * 0.3), s.d * 0.4), towerM);
        annex.position.set(-s.w * 0.28, s.h * (0.2 + hsh * 0.15), s.d * (hsh * 0.4 - 0.2));
        annex.castShadow = true;
        group.add(tower, troof, ac, tank, antenna, annex);
        extras.push(tower, troof, ac, tank, antenna, annex);
      }
      let door = null;
      if (!s.adobe) {
        door = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 2.2, 0.3),
          new THREE.MeshStandardMaterial({ color: 0x3a352e })
        );
        door.position.set(0, 1.1, s.d / 2 + 0.1);
        group.add(door);
      }
      s.parts = { wall, roof, door, mat: wallMat, crackedMat, extras };
      mesh = group;
    }
    s.mesh = mesh;
    scene.add(mesh);
  }

  function buildTreeMesh(scene, t) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16 * t.s, 0.26 * t.s, t.h * 0.5, 6),
      new THREE.MeshStandardMaterial({ color: t.kind === 'palm' ? 0x8a7a52 : 0x4a3b2a, roughness: 0.9 })
    );
    trunk.position.y = t.h * 0.25;
    trunk.castShadow = true;
    if (t.kind === 'pump') {
      trunk.scale.set(0.8, 1, 0.8);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x6a5a42 }));
      arm.position.set(0.3, t.h * 0.5, 0);
      arm.rotation.z = 0.5;
      g.add(trunk, arm);
    } else if (t.kind === 'palm') {
      g.add(trunk);
      for (let k = 0; k < 6; k++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.24, 2.6, 4), new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: 0.9 }));
        frond.position.y = t.h * 0.95;
        frond.rotation.z = 0.9;
        frond.rotation.y = (k / 6) * Math.PI * 2;
        frond.position.x = Math.sin((k / 6) * Math.PI * 2) * 0.7;
        frond.position.z = Math.cos((k / 6) * Math.PI * 2) * 0.7;
        frond.castShadow = true;
        g.add(frond);
      }
    } else if (t.kind === 'dead') {
      g.add(trunk);
    } else if (t.kind === 'pine') {
      // 雪松：棕干 + 双层深绿锥 + 雪顶
      g.add(trunk);
      const c1 = new THREE.Mesh(
        new THREE.ConeGeometry(t.h * 0.3 * t.s, t.h * 0.5, 7),
        new THREE.MeshStandardMaterial({ color: 0x2f4a33, roughness: 0.9 })
      );
      c1.position.y = t.h * 0.45;
      const c2 = new THREE.Mesh(
        new THREE.ConeGeometry(t.h * 0.22 * t.s, t.h * 0.38, 7),
        new THREE.MeshStandardMaterial({ color: 0x3a5c3f, roughness: 0.9 })
      );
      c2.position.y = t.h * 0.72;
      const snowTip = new THREE.Mesh(
        new THREE.ConeGeometry(t.h * 0.1 * t.s, t.h * 0.16, 7),
        new THREE.MeshStandardMaterial({ color: 0xeef3f6, roughness: 0.8 })
      );
      snowTip.position.y = t.h * 0.98;
      c1.castShadow = c2.castShadow = true;
      g.add(c1, c2, snowTip);
    } else {
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(t.h * 0.34 * t.s, t.h * 0.7, 7),
        new THREE.MeshStandardMaterial({ color: 0x4d5c3c, roughness: 0.9 })
      );
      crown.position.y = t.h * 0.72;
      crown.castShadow = true;
      g.add(trunk, crown);
    }
    g.position.set(t.x, heightAt(t.x, t.z), t.z);
    t.mesh = g;
    scene.add(g);
  }

  // ---- 圆形碰撞体 vs 实体足迹 ----
  function resolveCircle(pos, r) {
    for (const s of T.solids) {
      if (!s.solid) continue;
      const hx = s.w / 2, hz = s.d / 2;
      const cx = pos.x - s.cx, cz = pos.z - s.cz;
      const px = clamp(cx, -hx, hx), pz = clamp(cz, -hz, hz);
      const dx = cx - px, dz = cz - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
          pos.x = s.cx + px + nx * r;
          pos.z = s.cz + pz + nz * r;
        } else {
          const left = cx + hx, right = hx - cx, top = cz + hz, bottom = hz - cz;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = s.cx - hx - r;
          else if (m === right) pos.x = s.cx + hx + r;
          else if (m === top) pos.z = s.cz - hz - r;
          else pos.z = s.cz + hz + r;
        }
      }
    }
  }
  T.resolveCircle = resolveCircle;

  // ---- 视线遮挡（实体 AABB + 地形起伏） ----
  function blocksLOS(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return false;
    const d = { x: dx / len, y: dy / len, z: dz / len };
    const o = { x: ax, y: ay, z: az };
    for (const s of T.solids) {
      if (!s.solid || !s.blocksLOS) continue;
      const t = Game.ray.rayAABB(o, d, s.min, s.max);
      if (t !== null && t >= 0.1 && t <= len - 0.1) return true;
    }
    // 地形起伏
    const steps = Math.max(4, Math.ceil(len / 1.6));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const x = ax + dx * f, y = ay + dy * f, z = az + dz * f;
      if (heightAt(x, z) > y) return true;
    }
    // v5.38 烟墙遮挡视线（沿射线采样，命中烟区即挡）
    if (Game.effects && Game.effects.smokeZones && Game.effects.smokeZones.length) {
      const ss = Math.max(3, Math.ceil(len / 6));
      for (let i = 1; i < ss; i++) {
        const f = i / ss;
        const x = ax + dx * f, z = az + dz * f;
        for (const zz of Game.effects.smokeZones) {
          const ddx = x - zz.x, ddz = z - zz.z;
          if (ddx * ddx + ddz * ddz < zz.r * zz.r) return true;
        }
      }
    }
    return false;
  }
  T.blocksLOS = blocksLOS;

  // ---- 子弹命中实体（返回最近命中） ----
  function raySolid(o, d, maxDist) {
    let best = null, bestT = maxDist;
    for (const s of T.solids) {
      if (!s.solid) continue;
      const t = Game.ray.rayAABB(o, d, s.min, s.max);
      if (t !== null && t >= 0 && t < bestT) { bestT = t; best = s; }
    }
    if (!best) return null;
    return {
      type: 'solid', solid: best, t: bestT,
      point: { x: o.x + d.x * bestT, y: o.y + d.y * bestT, z: o.z + d.z * bestT },
    };
  }
  T.raySolid = raySolid;

  // ---- 对可破坏物/建筑造成伤害（多级状态） ----
  function damageSolid(s, dmg) {
    if (!s || !s.destructible || !s.solid) return;
    s.hp -= dmg;
    const ratio = s.hp / s.maxHp;
    if (s.stages && s.state === 0 && ratio < 0.66) setStage(s, 1);
    else if (s.stages && s.state === 1 && ratio < 0.33) setStage(s, 2);
    if (s.hp <= 0) destroy(s);
  }
  T.damageSolid = damageSolid;

  function setStage(s, st) {
    s.state = st;
    if (st === 1) {
      // 开裂：弹痕贴图 + 尘土
      if (s.parts && s.parts.crackedMat && s.parts.wall) s.parts.wall.material = s.parts.crackedMat;
      if (Game.effects) Game.effects.emit(s.cx, s.baseH + s.h / 2, s.cz, 0x999999, 10, 3, 0.6, 0.2, 12, 1);
    } else if (st === 2) {
      // 残破：墙体塌成矮墙（碰撞同步）
      if (s.parts && s.parts.wall) { s.parts.wall.scale.y = 1.2 / s.h; s.parts.wall.position.y = 0.6; }
      if (s.parts) {
        if (s.parts.roof) s.parts.roof.visible = false;
        if (s.parts.door) s.parts.door.visible = false;
        if (s.parts.extras) for (const ex of s.parts.extras) ex.visible = false;   // v5.35 塔楼/设备随残破消失
      }
      s.h = 1.2;
      s.max.y = s.baseH + 1.2;
      if (Game.effects) Game.effects.emit(s.cx, s.baseH + 1, s.cz, 0x8a7a5c, 14, 4, 0.7, 0.25, 14, 1);
    }
  }

  function destroy(s) {
    s.solid = false;
    s.blocksLOS = false;
    if (s.mesh) { s.mesh.visible = false; }
    // 特效（爆炸/倒塌碎片）
    if (Game.effects) {
      Game.effects.destroyBurst(s, s.explode ? 'explode' : (s.collapse ? 'collapse' : 'debris'));
    }
    const dv = Game.audio.distanceVol({ x: s.cx, y: s.baseH + 1, z: s.cz });
    if (s.explode) {
      // 油桶/油罐殉爆 → 范围伤害
      Game.weapons.areaDamage(
        { x: s.cx, y: s.baseH + 0.5, z: s.cz }, s.blastRadius || 7, s.blastDmg || 160, null, s.kind
      );
      Game.sound.explosion(s.blastDmg > 100, dv);
    } else if (s.collapse) {
      Game.sound.explosion(true, dv);
    } else {
      Game.sound.explosion(false, dv);
    }
    // 倒塌建筑 → 瓦砾堆（低掩体，遮挡蹲姿视线）
    if (s.rubble) {
      const rb = {
        kind: 'rubble', list: T.buildings, cx: s.cx, cz: s.cz,
        w: s.w * 0.9, d: s.d * 0.9, h: 0.6, baseH: s.baseH,
        min: { x: s.cx - s.w * 0.45, y: s.baseH, z: s.cz - s.d * 0.45 },
        max: { x: s.cx + s.w * 0.45, y: s.baseH + 0.6, z: s.cz + s.d * 0.45 },
        solid: true, blocksLOS: false, destructible: false,
        hp: Infinity, maxHp: Infinity, state: 2, mesh: null, parts: null,
      };
      const g = new THREE.Group();
      const rubM = new THREE.MeshStandardMaterial({ color: s.adobe ? 0x9a8664 : 0x6a6458, roughness: 1 });
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(s.w * M.randRange(Game.rng, 0.3, 0.55), M.randRange(Game.rng, 0.35, 0.8), s.d * M.randRange(Game.rng, 0.3, 0.55)),
          rubM
        );
        b.position.set(M.randRange(Game.rng, -s.w, s.w) * 0.3, M.randRange(Game.rng, 0.2, 0.5), M.randRange(Game.rng, -s.d, s.d) * 0.3);
        b.rotation.y = M.randRange(Game.rng, 0, Math.PI);
        g.add(b);
      }
      g.position.set(s.cx, s.baseH, s.cz);
      T.buildings.push(rb);
      T.solids.push(rb);
      rb.mesh = g;
      Game.scene.add(g);
    }
  }

  T.generate = generate;
  Game.terrain = T;
  Game.heightAt = heightAt;
})();
