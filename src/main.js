import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const $ = (id) => document.getElementById(id);
const S = 1024;

// --- paint canvas (white = no change under multiply) ---
const paint = $('paint'), pctx = paint.getContext('2d');
const guide = $('guide'), gctx = guide.getContext('2d');
const vctx = paint.getContext('2d'); // visible canvas = white + all layers + pending shape; also the 3D texture
let lid = 0;
const mkLayer = (name) => { const c = document.createElement('canvas'); c.width = c.height = S; return { id: ++lid, name: name || `Layer ${lid + 1}`, c, x: c.getContext('2d'), vis: true, op: 1 }; };
const layers = [mkLayer('Layer 1')]; // bottom -> top, transparent canvases
let act = 0, bctx = layers[0].x; // bctx = active layer's context
const tex = new THREE.CanvasTexture(paint);
tex.colorSpace = THREE.SRGBColorSpace;

let color = '#111111', tool = 'brush'; // brush | eraser | shape
let shape = 'circle', fillMode = true, pend = null, drag = null; // pend = {t,x,y,w,h,r,c,fill,lw}
const FREE = new Set(['ellipse', 'rect', 'triangle']); // others keep w == h
const SHAPES = { circle: '●', ellipse: '⬬', square: '■', rect: '▬', triangle: '▲', star: '★', heart: '♥' };
const coarse = matchMedia('(pointer:coarse)').matches; // touch: bigger handles
const ROT = coarse ? 80 : 50, HIT = coarse ? 60 : 30, KR = coarse ? 30 : 16;
let sym = false, opacity = 1; // sym = mirror strokes/shapes across the face's centre line (u = 0.5)

function shapePath(c, t) { // unit box [-1,1]
  c.beginPath();
  if (t === 'circle' || t === 'ellipse') c.arc(0, 0, 1, 0, Math.PI * 2);
  else if (t === 'square' || t === 'rect') c.rect(-1, -1, 2, 2);
  else if (t === 'triangle') { c.moveTo(0, -1); c.lineTo(1, 1); c.lineTo(-1, 1); c.closePath(); }
  else if (t === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; c[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); }
  else { for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; c[i ? 'lineTo' : 'moveTo'](Math.sin(a) ** 3, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16 - 0.23); } c.closePath(); }
}
function drawShape(c, s) {
  c.save(); c.translate(s.x, s.y); c.rotate(s.r); c.scale(s.w, s.h); shapePath(c, s.t); c.restore(); // path stays in canvas space
  c.fillStyle = c.strokeStyle = s.c;
  if (s.fill) c.fill(); else { c.lineWidth = s.lw; c.lineJoin = 'round'; c.stroke(); }
}
const mir = (s) => ({ ...s, x: S - s.x, r: -s.r });
function drawShapes(c, s) { drawShape(c, s); if (sym) drawShape(c, mir(s)); }
function render() {
  vctx.fillStyle = '#fff'; vctx.fillRect(0, 0, S, S);
  layers.forEach((L, i) => {
    if (L.vis) { vctx.globalAlpha = L.op; vctx.drawImage(L.c, 0, 0); vctx.globalAlpha = 1; }
    if (i === act && pend) drawShapes(vctx, pend); // pending shape sits inside its layer's slot
  });
  if (opacity < 1) { vctx.globalAlpha = 1 - opacity; vctx.fillStyle = '#fff'; vctx.fillRect(0, 0, S, S); vctx.globalAlpha = 1; } // fade paint toward white = less multiply
  tex.needsUpdate = true;
}
const clear = () => { pend = null; bctx.clearRect(0, 0, S, S); render(); renderLayers(); }; // clears the active layer
const lw = () => Math.max(3, +$('size').value / 3);
function commit() { if (!pend) return; snap(); drawShapes(bctx, pend); pend = null; render(); renderLayers(); drawGuide(); }
function cancel() { pend = null; render(); drawGuide(); }

// undo / redo: ImageData snapshots of the committed layer
// entries are {undo(), redo()} closures: pixel edits of one layer, or layer add/delete/move
const undoS = [], redoS = [];
function push(e) { undoS.push(e); if (undoS.length > 40) undoS.shift(); redoS.length = 0; ui(); }
function snap() { // call before editing the active layer's pixels
  const L = layers[act], before = L.x.getImageData(0, 0, S, S); let after;
  push({ undo() { after = L.x.getImageData(0, 0, S, S); L.x.putImageData(before, 0, 0); }, redo() { L.x.putImageData(after, 0, 0); } });
}
const refresh = () => { render(); renderLayers(); ui(); };
function undo() { if (pend) return cancel(); const e = undoS.pop(); if (!e) return; e.undo(); redoS.push(e); refresh(); }
function redo() { const e = redoS.pop(); if (!e) return; e.redo(); undoS.push(e); refresh(); }

// layers
function setActive(i) { act = Math.max(0, Math.min(layers.length - 1, i)); bctx = layers[act].x; }
const insertL = (i, L) => { layers.splice(i, 0, L); setActive(i); };
const removeL = (L) => { const i = layers.indexOf(L); layers.splice(i, 1); setActive(Math.min(i, layers.length - 1)); };
const swapL = (a, b) => { [layers[a], layers[b]] = [layers[b], layers[a]]; };
function addLayer(L) { const i = act + 1; insertL(i, L); push({ undo() { removeL(L); }, redo() { insertL(i, L); } }); refresh(); }
function renderLayers() {
  const box = $('layers'); box.textContent = '';
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i], row = document.createElement('div'); row.className = 'layer' + (i === act ? ' on' : '');
    const eye = document.createElement('button'); eye.className = 'eye'; eye.textContent = L.vis ? '◉' : '◌'; eye.title = 'Show/hide';
    eye.onclick = (e) => { e.stopPropagation(); L.vis = !L.vis; refresh(); };
    const t = document.createElement('canvas'); t.width = t.height = 44;
    const tc = t.getContext('2d'); tc.fillStyle = '#fff'; tc.fillRect(0, 0, 44, 44); tc.drawImage(L.c, 0, 0, 44, 44);
    const n = document.createElement('span'); n.textContent = L.name; n.title = 'Double-click to rename';
    n.ondblclick = () => { L.name = prompt('Layer name', L.name) || L.name; renderLayers(); };
    row.append(eye, t, n);
    row.onclick = () => { commit(); setActive(i); refresh(); };
    box.append(row);
  }
  $('lop').value = layers[act].op;
  $('ldel').disabled = layers.length < 2; $('lup').disabled = act === layers.length - 1; $('ldown').disabled = act === 0;
}
function flat() { // all visible layers on white
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
  for (const L of layers) if (L.vis) { x.globalAlpha = L.op; x.drawImage(L.c, 0, 0); }
  return c;
}
const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };

['#111111', '#ffffff', '#e11d48', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'].forEach((c) => {
  const d = document.createElement('button'); d.className = 'sw'; d.style.background = c; d.title = c;
  d.onclick = () => setColor(c);
  $('colors').append(d);
});
// custom picker: saturation/value square + hue slider (native <input type=color> dialog is ugly)
let hsv = [0, 0, 0.07];
const hsv2hex = (h, s, v) => '#' + [5, 3, 1].map((n) => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0'); }).join('');
const hex2hsv = (x) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx === 0 ? 0 : d / mx, mx];
};
const sv = $('sv'), sctx = sv.getContext('2d');
function drawSV() {
  const { width: w, height: h } = sv;
  sctx.fillStyle = hsv2hex(hsv[0], 1, 1); sctx.fillRect(0, 0, w, h);
  let g = sctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, '#fff0');
  sctx.fillStyle = g; sctx.fillRect(0, 0, w, h);
  g = sctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0000'); g.addColorStop(1, '#000');
  sctx.fillStyle = g; sctx.fillRect(0, 0, w, h);
  sctx.beginPath(); sctx.arc(hsv[1] * w, (1 - hsv[2]) * h, 7, 0, 7);
  sctx.lineWidth = 2; sctx.strokeStyle = '#fff'; sctx.stroke(); sctx.lineWidth = 1; sctx.strokeStyle = '#0008'; sctx.stroke();
}
const fromPicker = () => setColor(hsv2hex(...hsv), true);
const svPick = (e) => {
  const b = sv.getBoundingClientRect();
  hsv[1] = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
  hsv[2] = 1 - Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
  fromPicker();
};
let svDrag = false;
sv.onpointerdown = (e) => { svDrag = true; sv.setPointerCapture(e.pointerId); svPick(e); };
sv.onpointermove = (e) => svDrag && svPick(e);
sv.onpointerup = () => (svDrag = false);
$('hue').oninput = (e) => { hsv[0] = +e.target.value; fromPicker(); };
$('wheel').onclick = (e) => { e.stopPropagation(); $('pop').hidden = !$('pop').hidden; };
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.pw')) $('pop').hidden = true; });

function setColor(c, picked) {
  color = c.toLowerCase(); $('hex').value = color; $('hex').classList.remove('bad');
  $('wheel').style.background = color;
  if (!picked) { hsv = hex2hsv(color); $('hue').value = hsv[0]; }
  drawSV();
  if (tool === 'eraser') tool = 'brush';
  if (pend) { pend.c = color; render(); }
  ui();
}
$('hex').oninput = (e) => {
  const v = e.target.value.trim().replace(/^#?/, '#');
  if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v); else e.target.classList.add('bad');
};
function ui() {
  for (const [id, n] of [['brush', 'brush'], ['eraser', 'eraser'], ['shapes', 'shape']]) $(id).classList.toggle('on', tool === n);
  $('shapebar').hidden = tool !== 'shape';
  document.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', tool !== 'eraser' && s.title === color));
  document.querySelectorAll('.shp').forEach((s) => s.classList.toggle('on', s.dataset.t === shape));
  $('fillbtn').textContent = fillMode ? 'Filled' : 'Outline';
  $('undo').disabled = !undoS.length && !pend; $('redo').disabled = !redoS.length;
  $('sym').classList.toggle('on', sym);
}
function setTool(n) { if (n !== 'shape') commit(); tool = n; ui(); }
$('brush').onclick = () => setTool('brush');
$('eraser').onclick = () => setTool('eraser');
$('shapes').onclick = () => setTool('shape');
$('clear').onclick = () => { snap(); clear(); drawGuide(); };
$('ladd').onclick = () => { commit(); addLayer(mkLayer()); };
$('ldel').onclick = () => { commit(); const L = layers[act], i = act; removeL(L); push({ undo() { insertL(i, L); }, redo() { removeL(L); } }); refresh(); };
const moveL = (d) => { commit(); const a = act, b = act + d; swapL(a, b); setActive(b); push({ undo() { swapL(a, b); setActive(a); }, redo() { swapL(a, b); setActive(b); } }); refresh(); };
$('lup').onclick = () => moveL(1);
$('ldown').onclick = () => moveL(-1);
$('lop').oninput = (e) => { layers[act].op = +e.target.value; render(); };
$('undo').onclick = undo;
$('redo').onclick = redo;
$('sym').onclick = () => { sym = !sym; render(); drawGuide(); ui(); };
$('op').oninput = (e) => { opacity = +e.target.value; render(); };

// shape controls
Object.entries(SHAPES).forEach(([t, g]) => {
  const b = document.createElement('button'); b.className = 'shp'; b.dataset.t = t; b.title = t; b.textContent = g;
  b.onclick = () => {
    shape = t;
    if (pend) { pend.t = t; if (!FREE.has(t)) pend.w = pend.h = Math.max(pend.w, pend.h); render(); drawGuide(); }
    ui();
  };
  $('shapelist').append(b);
});
$('fillbtn').onclick = () => { fillMode = !fillMode; if (pend) { pend.fill = fillMode; render(); } ui(); };
$('rot').oninput = (e) => { if (pend) { pend.r = e.target.value * Math.PI / 180; render(); drawGuide(); } };
$('size').addEventListener('input', () => { if (pend) { pend.lw = lw(); render(); } });
$('apply').onclick = commit;
$('del').onclick = cancel;
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'hex') return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) { e.preventDefault(); (k === 'y' || e.shiftKey) ? redo() : undo(); return; }
  if (e.key === 'Enter') commit(); else if (e.key === 'Escape' || e.key === 'Delete') cancel();
});
setColor(color);

function stamp(x, y) {
  const r = +$('size').value / 2, soft = +$('soft').value;
  const er = tool === 'eraser', c = er ? '#000000' : color;
  bctx.globalCompositeOperation = er ? 'destination-out' : 'source-over'; // eraser makes the layer transparent
  for (const px of sym ? [x, S - x] : [x]) {
    const g = bctx.createRadialGradient(px, y, r * (1 - soft), px, y, r);
    g.addColorStop(0, c); g.addColorStop(1, c + '00');
    bctx.fillStyle = g; bctx.fillRect(px - r, y - r, r * 2, r * 2);
  }
  bctx.globalCompositeOperation = 'source-over';
}
let last = null;
const pos = (e) => { const b = paint.getBoundingClientRect(); return [(e.clientX - b.left) * S / b.width, (e.clientY - b.top) * S / b.height]; };
const toLocal = (p) => { const dx = p[0] - pend.x, dy = p[1] - pend.y, c = Math.cos(-pend.r), s = Math.sin(-pend.r); return [dx * c - dy * s, dx * s + dy * c]; };
const near = (l, x, y) => Math.hypot(l[0] - x, l[1] - y) < HIT;

function shapeDown(p) {
  if (pend) {
    const l = toLocal(p);
    if (near(l, 0, -pend.h - ROT)) return (drag = { m: 'rot' });
    if (near(l, pend.w, pend.h)) return (drag = { m: 'scale' });
    if (Math.abs(l[0]) <= pend.w && Math.abs(l[1]) <= pend.h) return (drag = { m: 'move', dx: pend.x - p[0], dy: pend.y - p[1] });
    commit();
  }
  pend = { t: shape, x: p[0], y: p[1], w: 2, h: 2, r: $('rot').value * Math.PI / 180, c: color, fill: fillMode, lw: lw() };
  drag = { m: 'scale' };
}
function shapeMove(p) {
  if (drag.m === 'move') { pend.x = p[0] + drag.dx; pend.y = p[1] + drag.dy; }
  else if (drag.m === 'rot') { pend.r = Math.atan2(p[1] - pend.y, p[0] - pend.x) + Math.PI / 2; $('rot').value = ((pend.r * 180 / Math.PI) % 360 + 360) % 360; }
  else {
    const l = toLocal(p); pend.w = Math.max(4, Math.abs(l[0])); pend.h = Math.max(4, Math.abs(l[1]));
    if (!FREE.has(pend.t)) pend.w = pend.h = Math.max(pend.w, pend.h);
  }
  render(); drawGuide();
}

paint.onpointerdown = (e) => {
  paint.setPointerCapture(e.pointerId); last = pos(e);
  if (tool === 'shape') { shapeDown(last); shapeMove(last); return; }
  snap(); stamp(...last); render();
};
paint.onpointermove = (e) => {
  if (tool === 'shape') { if (drag) shapeMove(pos(e)); return; }
  if (!last) return;
  const p = pos(e), n = Math.ceil(Math.hypot(p[0] - last[0], p[1] - last[1]) / 4) || 1;
  for (let i = 1; i <= n; i++) stamp(last[0] + (p[0] - last[0]) * i / n, last[1] + (p[1] - last[1]) * i / n);
  last = p; render();
};
paint.onpointerup = () => { if (last && tool !== 'shape') renderLayers(); last = null; drag = null; };

// --- three scene: webcam plane + face mesh multiplied on top ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
$('view').append(renderer.domElement);
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

const video = document.createElement('video');
video.playsInline = true; video.muted = true;
const vtex = new THREE.VideoTexture(video);
vtex.colorSpace = THREE.SRGBColorSpace;
const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: vtex }));
scene.add(bg);

// canonical UVs + triangles from MediaPipe's canonical_face_model.obj
const obj = (await (await fetch('/canonical.obj')).text()).split('\n');
const vt = obj.filter((l) => l.startsWith('vt ')).map((l) => l.split(' ').slice(1, 3).map(Number));
const idx = [], uv = new Float32Array(468 * 2);
for (const l of obj) if (l.startsWith('f ')) {
  for (const t of l.trim().split(' ').slice(1)) {
    const [v, u] = t.split('/').map((n) => +n - 1);
    idx.push(v); uv.set(vt[u], v * 2);
  }
}
// drop triangles inside the mouth opening so paint doesn't stretch over teeth/tongue when mouth opens
const INNER_LIP = new Set([78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]);
for (let i = idx.length - 3; i >= 0; i -= 3) if (INNER_LIP.has(idx[i]) && INNER_LIP.has(idx[i + 1]) && INNER_LIP.has(idx[i + 2])) idx.splice(i, 3);
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(468 * 3), 3));
geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
geo.setIndex(idx);
const face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, blending: THREE.MultiplyBlending, premultipliedAlpha: true, side: THREE.DoubleSide, transparent: true, depthTest: false }));
face.visible = false; face.renderOrder = 1;
scene.add(face);

// guide overlay: UV wireframe over the paint canvas
function drawGuide() {
  gctx.clearRect(0, 0, S, S);
  if ($('mesh').classList.contains('on')) {
    gctx.strokeStyle = 'rgba(0,0,0,.18)'; gctx.lineWidth = 1; gctx.beginPath();
    for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = idx[i + k], b = idx[i + (k + 1) % 3];
      gctx.moveTo(uv[a * 2] * S, (1 - uv[a * 2 + 1]) * S); gctx.lineTo(uv[b * 2] * S, (1 - uv[b * 2 + 1]) * S);
    }
    gctx.stroke();
  }
  if (sym) { gctx.strokeStyle = 'rgba(255,255,255,.7)'; gctx.lineWidth = 2; gctx.setLineDash([12, 10]); gctx.beginPath(); gctx.moveTo(S / 2, 0); gctx.lineTo(S / 2, S); gctx.stroke(); gctx.setLineDash([]); }
  if (pend) { // selection box, rotate knob (top), scale knob (corner)
    const s = pend;
    gctx.save(); gctx.translate(s.x, s.y); gctx.rotate(s.r);
    gctx.strokeStyle = '#3b82f6'; gctx.lineWidth = 3; gctx.setLineDash([10, 8]); gctx.strokeRect(-s.w, -s.h, 2 * s.w, 2 * s.h);
    gctx.setLineDash([]); gctx.beginPath(); gctx.moveTo(0, -s.h); gctx.lineTo(0, -s.h - ROT); gctx.stroke();
    for (const [x, y] of [[0, -s.h - ROT], [s.w, s.h]]) { gctx.beginPath(); gctx.arc(x, y, KR, 0, 7); gctx.fillStyle = '#fff'; gctx.fill(); gctx.stroke(); }
    gctx.restore();
  }
}
$('mesh').onclick = () => { $('mesh').classList.toggle('on'); drawGuide(); };

// save photo: re-render then read the canvas in the same tick (no preserveDrawingBuffer needed)
$('save').onclick = () => {
  commit();
  renderer.render(scene, cam);
  renderer.domElement.toBlob((b) => dl(b, `paint-him-${Date.now()}.png`), 'image/png');
};

// export / import the face map (PNG, white = no paint)
$('export').onclick = () => { commit(); flat().toBlob((b) => dl(b, `paint-him-map-${Date.now()}.png`), 'image/png'); };
$('import').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  commit(); const L = mkLayer('Import'); L.x.drawImage(await createImageBitmap(f), 0, 0, S, S); addLayer(L);
};

// templates placed from canonical landmark UVs
const uvPt = (i) => [uv[i * 2] * S, (1 - uv[i * 2 + 1]) * S];
const mid = (a, b) => { const p = uvPt(a), q = uvPt(b); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
function blob([x, y], rx, ry, rot, c) { // soft ellipse
  bctx.save(); bctx.translate(x, y); bctx.rotate(rot); bctx.scale(rx, ry);
  const g = bctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, c); g.addColorStop(0.65, c); g.addColorStop(1, c + '00');
  bctx.fillStyle = g; bctx.fillRect(-1, -1, 2, 2); bctx.restore();
}
const TPL = {
  panda() { blob(mid(33, 133), 80, 95, 0.45, '#111111'); blob(mid(362, 263), 80, 95, -0.45, '#111111'); blob(uvPt(1), 34, 26, 0, '#111111'); },
  clown() { blob(uvPt(1), 46, 46, 0, '#e11d48'); blob(uvPt(50), 60, 60, 0, '#ff8aa8'); blob(uvPt(280), 60, 60, 0, '#ff8aa8'); },
  blush() { blob(uvPt(50), 75, 60, 0, '#ff9ec0'); blob(uvPt(280), 75, 60, 0, '#ff9ec0'); },
  cat() {
    blob(uvPt(1), 30, 22, 0, '#111111');
    bctx.strokeStyle = '#111'; bctx.lineWidth = 7; bctx.lineCap = 'round';
    for (const [i, s] of [[50, -1], [280, 1]]) for (const dy of [-40, 0, 40]) { const [x, y] = uvPt(i); bctx.beginPath(); bctx.moveTo(x, y); bctx.lineTo(x + s * 150, y + dy); bctx.stroke(); }
  },
};
$('tpl').onchange = (e) => { const t = TPL[e.target.value]; e.target.value = ''; if (!t) return; commit(); snap(); t(); render(); renderLayers(); };

// record the painted view as webm
let rec = null;
$('rec').onclick = () => {
  if (rec) return rec.stop();
  const chunks = [], mt = ['video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  rec = new MediaRecorder(renderer.domElement.captureStream(30), { mimeType: mt });
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => { dl(new Blob(chunks, { type: 'video/webm' }), `paint-him-${Date.now()}.webm`); rec = null; $('rec').textContent = 'Record'; $('rec').classList.remove('on'); };
  rec.start(); $('rec').textContent = 'Stop'; $('rec').classList.add('on');
};

// --- mediapipe ---
const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
const lm = await FaceLandmarker.createFromOptions(files, {
  baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'GPU' },
  runningMode: 'VIDEO', numFaces: 1,
});
let W = 1280, H = 720, camOn = false;
function setSize() {
  renderer.setSize(W, H, false); $('view').style.aspectRatio = W / H;
  bg.scale.set(-W, H, 1); // negative x = mirror
  Object.assign(cam, { left: -W / 2, right: W / 2, top: H / 2, bottom: -H / 2 }); cam.updateProjectionMatrix();
}
function camOff(msg) {
  camOn = false; face.visible = false;
  $('camoff').hidden = false;
  $('cammsg').textContent = msg || 'Yüzüne çizim yapabilmek için kamerayı açmak ister misin?';
}
async function startCam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = stream; await video.play();
    stream.getVideoTracks()[0].onended = () => camOff('Kamera bağlantısı koptu. Tekrar açmak ister misin?');
  } catch (e) {
    camOff(e.name === 'NotAllowedError' ? 'Kamera izni verilmedi. Adres çubuğundaki kilit simgesinden izin verip tekrar dene.' : 'Kamera açılamadı (başka bir uygulama kullanıyor olabilir). Tekrar denemek ister misin?');
    return;
  }
  W = video.videoWidth; H = video.videoHeight; setSize();
  $('camoff').hidden = true; camOn = true;
}
$('camon').onclick = startCam;
setSize(); clear(); drawGuide(); $('status').className = 'ok';
startCam();
const p = geo.attributes.position;
const sx = new Float32Array(468), sy = new Float32Array(468);
let sInit = false, lastT = -1;
renderer.setAnimationLoop(() => {
  if (camOn && video.currentTime !== lastT) {
    lastT = video.currentTime;
    const pts = lm.detectForVideo(video, performance.now()).faceLandmarks[0];
    face.visible = !!pts;
    if (pts) {
      for (let i = 0; i < 468; i++) {
        const x = (0.5 - pts[i].x) * W, y = (0.5 - pts[i].y) * H; // x mirrored like bg
        if (!sInit) { sx[i] = x; sy[i] = y; }
        else { const a = Math.min(1, 0.25 + Math.hypot(x - sx[i], y - sy[i]) / 10); sx[i] += (x - sx[i]) * a; sy[i] += (y - sy[i]) * a; } // adaptive EMA: calm when still, snappy when moving
        p.setXYZ(i, sx[i], sy[i], 1);
      }
      sInit = true; p.needsUpdate = true;
    } else sInit = false;
  }
  renderer.render(scene, cam);
});
