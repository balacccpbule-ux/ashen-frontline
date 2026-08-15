/* 灰烬战线 · 单文件打包脚本
 * 用法：node build_single.js
 * 产出：dist/灰烬战线_单文件版.html（css + 全部 js 内联，双击即玩）
 * 内联顺序与 index.html 的 <script src> 顺序严格一致。
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'dist');

// 与 index.html 中的加载顺序严格一致
const SCRIPTS = [
  'three.min.js',
  'js/config.js', 'js/utils.js', 'js/audio.js', 'js/terrain.js', 'js/effects.js',
  'js/weapons.js', 'js/player.js', 'js/ai.js', 'js/vehicles.js', 'js/hud.js',
  'js/main.js', 'js/debug.js',
];

const VERSION = (() => {
  try {
    const p = fs.readFileSync(path.join(ROOT, 'PROGRESS.md'), 'utf8');
    const m = p.match(/状态：v([\d.]+)/);
    return m ? 'v' + m[1] : '';
  } catch (e) { return ''; }
})();

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 内联 css
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="css/style.css">',
  '<!-- 灰烬战线 ' + (VERSION || '') + ' 单文件版：css 已内联 -->\n  <style>\n' + css + '\n  </style>');

// 内联 js（按顺序；</script> 序列做转义防提前闭合）
for (const src of SCRIPTS) {
  let js = fs.readFileSync(path.join(ROOT, src), 'utf8');
  js = js.replace(/<\/script/gi, '<\\/script');
  const tag = `<script src="${src}"></script>`;
  if (!html.includes(tag)) { console.error('!! 未找到标签:', tag); process.exit(1); }
  html = html.replace(tag, '<!-- ' + src + ' 内联 -->\n  <script>\n' + js + '\n  </script>');
}

// 残留外链检查（应只剩内联）
if (/<script src=|<link rel="stylesheet" href=/.test(html)) {
  console.error('!! 仍有未内联的外部资源');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, '灰烬战线_单文件版.html');
fs.writeFileSync(out, html);
console.log('生成:', out);
console.log('大小:', (fs.statSync(out).size / 1024).toFixed(0), 'KB');
