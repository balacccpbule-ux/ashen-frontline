'use strict';
const { launchChrome, gameUrl } = require('./lib/cdp');
(async () => {
  const { proc, cdp } = await launchChrome(gameUrl(), 9265);
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await new Promise(r => setTimeout(r, 250)); }
    const r = await cdp.eval('(function(){ var G=Game;' +
      'G.godMode=true;' +
      'var mort = G.bots.filter(function(b){ return b.team===0 && b.clsKey==="mortar" && !b.bot.crew; })[0];' +
      'var foe = G.bots.filter(function(b){ return b.team===1 && !b.bot.crew; })[0];' +
      'var out = { mortCls: mort.clsKey, foeCls: foe.clsKey, mortIdx: G.bots.indexOf(mort), foeIdx: G.bots.indexOf(foe) };' +
      'G.__pinned=[];' +
      'G.bots.forEach(function(b){ if (b===mort || b===foe) return;' +
      '  var x = b.team===0 ? -78 : 78, z = b.team===0 ? -74 : 74;' +
      '  b.pos.x=x; b.pos.z=z; b.pos.y=G.heightAt(x,z); b.vel={x:0,y:0,z:0}; b.spawnProtect=0;' +
      '  G.__pinned.push({ id: b.id, x: x, z: z }); });' +
      'mort.pos.x=-72; mort.pos.z=-8; mort.pos.y=G.heightAt(-72,-8); mort.spawnProtect=999;' +
      'foe.pos.x=-72; foe.pos.z=33; foe.pos.y=G.heightAt(-72,33); foe.spawnProtect=0; foe.deaths=0;' +
      'foe.spottedUntil = 99999;' +
      'G.__mortId=mort.id; G.__foeId=foe.id;' +
      'mort.gadgetAmmo = 6; mort.gadgetCooldown = 0; mort.bot.mortarT = undefined;' +
      'for (var i=0;i<300;i++){ var dt=1/30; G.time+=dt;' +
      '  var m=null, f=null;' +
      '  for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__mortId)m=G.soldiers[k]; if(G.soldiers[k].id===G.__foeId)f=G.soldiers[k]; }' +
      '  m.pos.x=-72; m.pos.z=-8; m.pos.y=G.heightAt(-72,-8); m.vel={x:0,y:0,z:0};' +
      '  if (f.alive){ f.pos.x=-72; f.pos.z=33; f.pos.y=G.heightAt(-72,33); f.vel={x:0,y:0,z:0}; }' +
      '  for (var p=0;p<G.__pinned.length;p++){ var pb=G.__pinned[p]; var bot=G.soldiers[pb.id];' +
      '    bot.pos.x=pb.x; bot.pos.z=pb.z; bot.pos.y=G.heightAt(pb.x,pb.z); bot.vel={x:0,y:0,z:0}; }' +
      '  if (G.player.alive) G.Player.update(dt);' +
      '  G.ai.update(dt); G.Vehicles.update(dt); G.weapons.update(dt);' +
      '  G.updateConquest(dt); G.effects.update(dt); G.terrain.update(dt); }' +
      'var f2=null, m2=null;' +
      'for (var k=0;k<G.soldiers.length;k++){ if(G.soldiers[k].id===G.__foeId)f2=G.soldiers[k]; if(G.soldiers[k].id===G.__mortId)m2=G.soldiers[k]; }' +
      'out.deaths = f2.deaths; out.state = m2.bot.state; out.mortarT = +m2.bot.mortarT.toFixed(1); out.time = +G.time.toFixed(1); out.ammo = m2.gadgetAmmo;' +
      'return JSON.stringify(out);' +
      '})()');
    console.log('DEBUG:', r);
  } finally { proc.kill(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
