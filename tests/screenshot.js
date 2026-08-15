/* 生成多视角实机截图（framebuffer 直读） */
'use strict';
const path = require('path');
const fs = require('fs');
const { launchChrome, sleep, gameUrl } = require('./lib/cdp');

(async () => {
  const { proc, cdp } = await launchChrome(gameUrl(), 9260);
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 80; i++) { if (await cdp.eval('typeof Game!=="undefined" && Game.player ? 1 : 0')) break; await sleep(250); }
    const dir = path.resolve(__dirname, '..', '.screens');
    fs.mkdirSync(dir, { recursive: true });

    const shots = [
      { name: '01_city_fight', setup: `
        Game.applySelection('conquest','city'); Game.deployPlayer();
        var p=Game.player; p.pos.x=0; p.pos.z=-34; p.yaw=Math.PI; p.pitch=0;
        for(var k=0;k<240;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);}` },
      { name: '02_city_street', setup: `
        var p=Game.player; p.pos.x=-16; p.pos.z=-6; p.yaw=-1.1; p.pitch=0;
        for(var k=0;k<60;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);}` },
      { name: '03_tank_view', setup: `
        var p=Game.player;
        var v=Game.vehicles.filter(function(x){return x.kind==='tank'&&x.team===0&&x.alive;})[0];
        if(v){ if(v.occupant)Game.Vehicles.exit(v.occupant); Game.Vehicles.enter(v,p); p.yaw=0.2; p.pitch=-0.1; v.yaw=0.2; v.turretYaw=0; }
        for(var k=0;k<120;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);}` },
      { name: '04_heli_view', setup: `
        var p=Game.player;
        var v=Game.vehicles.filter(function(x){return x.kind==='heli'&&x.team===0;})[0];
        if(v){ if(v.occupant)Game.Vehicles.exit(v.occupant); p.pos={x:v.pos.x,y:v.pos.y,z:v.pos.z}; Game.Vehicles.enter(v,p); v.yaw=0.4; v.pos.y=26; v.hovPitch=-0.15; }
        for(var k=0;k<150;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);}` },
      { name: '05_desert_oasis', setup: `
        Game.applySelection('conquest','desert'); Game.deployPlayer();
        var p=Game.player; p.pos.x=0; p.pos.z=-44; p.yaw=Math.PI; p.pitch=-0.12;
        for(var k=0;k<150;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);}` },
      { name: '06_desert_village', setup: `
        var p=Game.player; p.pos.x=-16; p.pos.z=22; p.yaw=-0.7; p.pitch=0;
        for(var k=0;k<150;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);}` },
      { name: '07_breakthrough_front', setup: `
        Game.applySelection('breakthrough','city'); Game.deployPlayer();
        var p=Game.player; p.pos.x=-46; p.pos.z=0; p.yaw=0.15; p.pitch=0;
        for(var k=0;k<200;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateBreakthrough(dt);Game.effects.update(dt);}` },
      { name: '08_building_destruction', setup: `
        Game.applySelection('conquest','city'); Game.deployPlayer();
        // 炮击一座楼 + 两发炮弹落地
        var b=Game.terrain.buildings.filter(function(s){return s.kind==='building'&&s.stages&&s.solid;})[0];
        Game.weapons.areaDamage({x:b.cx,y:b.baseH+b.h/2,z:b.cz},12,260,null,'shell');
        Game.weapons.areaDamage({x:b.cx+14,y:Game.heightAt(b.cx+14,b.cz),z:b.cz},12,260,null,'shell');
        for(var k=0;k<90;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);Game.terrain.update(dt);}
        var p=Game.player; p.pos.x=b.cx-20; p.pos.z=b.cz; p.yaw=Math.atan2(0,-20)?0:0; p.yaw=0; p.pitch=-0.05;` },
      { name: '09_snow_ice_lake', setup: `
        Game.applySelection('conquest','snow'); Game.deployPlayer();
        var p=Game.player; p.pos.x=0; p.pos.z=-46; p.yaw=Math.PI; p.pitch=-0.08;
        for(var k=0;k<150;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);}` },
      { name: '10_snow_aa_thirdperson', setup: `
        var p=Game.player;
        var v=Game.vehicles.filter(function(x){return x.kind==='aa'&&x.team===0;})[0];
        if(v){ if(v.occupant)Game.Vehicles.exit(v.occupant); v.pos.x=2; v.pos.z=-18; Game.Vehicles.enter(v,p); Game.Vehicles.thirdPerson=true; p.yaw=0.35; v.yaw=0.35; v.turretYaw=0.4; v.turretPitch=0.5; }
        for(var k=0;k<120;k++){var dt=1/30;Game.time+=dt;if(Game.player.alive)Game.Player.update(dt);Game.ai.update(dt);Game.Vehicles.update(dt);Game.weapons.update(dt);Game.updateConquest(dt);Game.effects.update(dt);}` },
    ];

    for (const s of shots) {
      await cdp.eval('(function(){' + s.setup + '})(); Game.renderer.render(Game.scene, Game.camera);');
      const px = await cdp.eval(`(function(){
        var c=document.createElement('canvas'); c.width=48; c.height=48;
        var ctx=c.getContext('2d'); ctx.drawImage(Game.renderer.domElement,0,0,48,48);
        var d=ctx.getImageData(0,0,48,48).data; var distinct={}; var sum=0;
        for(var i=0;i<d.length;i+=4){ sum+=d[i]+d[i+1]+d[i+2]; distinct[(d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4)]=1; }
        var url=Game.renderer.domElement.toDataURL('image/png');
        return JSON.stringify({ sum: sum/(d.length/4), colors: Object.keys(distinct).length, url: url });
      })()`);
      const info = JSON.parse(px);
      fs.writeFileSync(path.join(dir, s.name + '.png'), Buffer.from(info.url.split(',')[1], 'base64'));
      console.log(`✓ ${s.name}.png  亮度 ${info.sum.toFixed(0)} · 色块 ${info.colors}`);
    }
  } finally { proc.kill(); }
})();
