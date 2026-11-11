/* Pond Hockey — game: layout, rendering, input, state, UI, test hooks. */
(function () {
  'use strict';
  const PH = window.PH, C = PH.C, A = PH.audio;
  const { W, H, R, GX0, GX1, GD, RP, RM, BANK } = C;
  let WIN = 7; // first to WIN (a daily twist can shorten it)
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('c'), ctx = canvas.getContext('2d');
  const clamp = PH.clamp, rnd = Math.random, TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutBack = (t) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  // Painted art can be dropped in later: set src for a key and it replaces the code-drawn version.
  // Keys match IMAGE-PROMPTS.md. Each falls back to code-drawn art until its PNG loads.
  const ASSETS = {
    puck: { src: null }, mallet_teal: { src: null }, bump: { src: null }, ice: { src: null }, bg_night: { src: null },
    mallet_classic: { src: null }, mallet_maple: { src: null }, mallet_lake: { src: null }, mallet_creemee: { src: null },
    mallet_aurora: { src: null }, mallet_cpu0: { src: null }, mallet_cpu1: { src: null }, mallet_cpu2: { src: null }, mallet_ember: { src: null }, mallet_flannel: { src: null }, mallet_gold: { src: null }
  };
  const artReady = (k) => { const a = ASSETS[k]; return a && a.img && a.img.complete && a.img.naturalWidth > 0 ? a.img : null; };
  function artOr(k, fallback) { const img = artReady(k); if (!img) return fallback; const c = document.createElement('canvas'); c.width = fallback.width; c.height = fallback.height; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c; }
  Object.keys(ASSETS).forEach((k) => { const a = ASSETS[k]; if (a.src) { a.img = new Image(); a.img.onload = () => { if (SP.puck) { buildSprites(); if (k === 'ice' || k === 'bg_night') buildBG(); } }; a.img.src = a.src; } });
  PH.ASSETS = ASSETS;

  // ------------------------------------------------------------ save
  const SAVE_KEY = 'pondhockey.v1';
  const save = { sound: true, music: true, buzz: true, choppy: true, level: 0, streak: [0, 0, 0], best: [0, 0, 0], wins: [0, 0, 0], losses: [0, 0, 0], tutDone: false, trophies: {}, skin: 'classic', dly: { last: '', streak: 0, best: 0, total: 0 } };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s) Object.assign(save, s); } catch (e) {}
  if (!save.trophies || typeof save.trophies !== 'object') save.trophies = {};
  if (!save.dly || typeof save.dly !== 'object') save.dly = { last: '', streak: 0, best: 0, total: 0 };
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
  A.sound = save.sound; A.music = save.music;

  // ------------------------------------------------------------ game state
  const G = {
    mode: 'menu', phase: 'serve', twop: false, demo: true, level: save.level | 0, w: null, ai: [],
    scores: { bottom: 0, top: 0 }, totalGoals: 0, ts: 1, now: 0, hitPause: 0, shake: 0, shx: 0, shy: 0,
    goalT: 0, dropT: 0, banner: null, toast: null, rally: 0, lastToucher: null, lastShot: null, lastMph: 0,
    stats: null, particles: [], ripples: [], trail: [], ctrlTime: 0, overT: 0, goalInfo: null, serveSide: 'bottom',
    flash: 0, flashCol: '255,220,140', scuffT: 0, kb: { l: 0, r: 0, u: 0, d: 0 }, pendingBump: false, matchTime: 0,
    banks: 0, heatStage: 0, pipPop: [], zoom: 0, zoomX: 0, zoomY: 0, puckSq: 0, puckSqA: 0, puckFlash: 0, trophyQ: [], newTrophies: [], maxDeficit: 0, series: { bottom: 0, top: 0 }, ready: { bottom: false, top: false }, rec: [], replay: null
  };
  const ctrl = { bottom: { pid: null }, top: { pid: null } };
  // Mallet feel under a real finger. k = follow stiffness, resp = velocity smoothing, maxV = speed cap,
  // lead = how far ahead (seconds) of the finger we aim to hide touch/display latency, off = mallet sits this far above the fingertip.
  const HUMAN = { k: 72, resp: 170, maxV: 3000, lead: 0.012, leadMax: 18, off: 36 };

  function newStats() {
    return { bottom: { hits: 0, shots: 0, onTarget: 0, saves: 0 }, top: { hits: 0, shots: 0, onTarget: 0, saves: 0 }, topSpeed: 0, bestRally: 0, time: 0 };
  }

  // ------------------------------------------------------------ layout
  let cw = 390, ch = 844, dpr = 1, S = 1, OX = 0, OY = 0, insets = { t: 0, r: 0, b: 0, l: 0 };
  let bg = null, scuff = null, scuffCtx = null, bulbs = [], lane = null, lastLayoutW = 0, lastLayoutH = 0;

  function readInsets() {
    const p = $('probe'), cs = getComputedStyle(p);
    insets = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }

  function layout() {
    readInsets();
    const svh = $('svh') ? $('svh').getBoundingClientRect().height : 0;
    cw = Math.max(280, window.innerWidth); ch = Math.max(360, svh > 200 ? Math.min(window.innerHeight, svh) : window.innerHeight);
    lastLayoutW = window.innerWidth; lastLayoutH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    stage.style.width = cw + 'px'; stage.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const blockW = W + 2 * BANK, blockH = H + 2 * GD + 2 * BANK;
    const availW = cw - 2 * Math.max(12, insets.l, insets.r) - 4;
    const availH = ch - insets.t - insets.b - 52;
    S = Math.min(availW / blockW, availH / blockH, 1.7);
    OX = (cw - W * S) / 2;
    const blockTop = insets.t + (ch - insets.t - insets.b - blockH * S) / 2;
    OY = blockTop + (BANK + GD) * S;
    const gapTop = clamp(blockTop - insets.t, 10, 46), gapSide = clamp(OX - BANK * S, 10, 40);
    lane = { l: -BANK - gapSide * 0.5 / S, t: -GD - BANK - gapTop * 0.5 / S };
    lane.r = W - lane.l; lane.b = H - lane.t;
    buildBulbs();
    buildBG();
    scuff = document.createElement('canvas');
    scuff.width = Math.round(W * S * dpr); scuff.height = Math.round(H * S * dpr);
    scuffCtx = scuff.getContext('2d'); scuffCtx.setTransform(S * dpr, 0, 0, S * dpr, 0, 0);
    // pause buttons: sit in corners outside the rink
    const pb = $('pauseB'), pt = $('pauseT');
    pb.style.left = Math.max(8, insets.l + 6) + 'px'; pb.style.bottom = Math.max(8, insets.b + 4) + 'px'; pb.style.right = 'auto'; pb.style.top = 'auto';
    pt.style.right = Math.max(8, insets.r + 6) + 'px'; pt.style.top = Math.max(8, insets.t + 4) + 'px'; pt.style.left = 'auto'; pt.style.bottom = 'auto';
    if (!G.twop) { pb.style.left = 'auto'; pb.style.right = Math.max(8, insets.r + 6) + 'px'; pb.style.bottom = 'auto'; pb.style.top = Math.max(8, insets.t + 4) + 'px'; }
  }
  function onResize() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const orientFlip = (window.innerWidth > window.innerHeight) !== (lastLayoutW > lastLayoutH);
    if (coarse) { if (orientFlip || Math.abs(window.innerWidth - lastLayoutW) > 8) { layout(); setTimeout(layout, 300); } }
    else { clearTimeout(onResize.t); onResize.t = setTimeout(layout, 80); }
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(layout, 350));

  // ---------------------------------------------------------- sprites
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function malletSprite(light, base, dark, deco) {
    const s = 160, c = mk(s, s), g = c.getContext('2d'), m = s / 2;
    g.translate(m, m);
    let gr = g.createRadialGradient(-18, -22, 6, 0, 0, 76);
    gr.addColorStop(0, light); gr.addColorStop(0.55, base); gr.addColorStop(1, dark);
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 74, 0, TAU); g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(12,22,44,.75)'; g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(0, 0, 68, Math.PI * 1.05, Math.PI * 1.65); g.stroke();
    gr = g.createRadialGradient(14, 16, 4, 0, 0, 50);
    gr.addColorStop(0, light); gr.addColorStop(0.5, base); gr.addColorStop(1, dark);
    g.fillStyle = dark; g.beginPath(); g.arc(0, 0, 50, 0, TAU); g.fill();
    g.fillStyle = gr; g.beginPath(); g.arc(-2, -2, 48, 0, TAU); g.fill();
    if (deco) { g.save(); g.beginPath(); g.arc(-1, -1, 48, 0, TAU); g.clip(); drawDeco(g, deco, light, base, dark); g.restore(); }
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 49, 0, TAU); g.stroke();
    gr = g.createRadialGradient(-8, -10, 2, 0, 0, 26);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, light); gr.addColorStop(1, base);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(3, 5, 25, 0, TAU); g.fill();
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 24, 0, TAU); g.fill();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(12,22,44,.55)'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(-8, -10, 6, 3.5, -0.7, 0, TAU); g.fill();
    return c;
  }
  function leafPath(g, s) { // simple five-lobed maple leaf, unit ~1
    g.beginPath();
    const P = [[0, -1], [0.22, -0.55], [0.55, -0.7], [0.45, -0.3], [0.95, -0.2], [0.55, 0.12], [0.62, 0.42], [0.18, 0.3], [0.06, 0.72], [-0.06, 0.72], [-0.18, 0.3], [-0.62, 0.42], [-0.55, 0.12], [-0.95, -0.2], [-0.45, -0.3], [-0.55, -0.7], [-0.22, -0.55]];
    P.forEach((p, i) => (i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s))); g.closePath();
  }
  function drawDeco(g, deco, light, base, dark) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (deco === 'leaf') {
      for (let i = 0; i < 6; i++) { g.save(); g.rotate(i * TAU / 6 + 0.3); g.translate(0, -37); g.rotate(0.2); g.fillStyle = i % 2 ? 'rgba(170,40,10,.75)' : 'rgba(255,236,170,.7)'; leafPath(g, 9); g.fill(); g.restore(); }
    } else if (deco === 'wave') {
      g.strokeStyle = 'rgba(220,245,255,.7)'; g.lineWidth = 2.6;
      for (let r = 31; r <= 45; r += 7) { g.beginPath(); for (let a = 0; a <= TAU + 0.01; a += 0.05) { const rr = r + Math.sin(a * 9 + r) * 1.8; a ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke(); }
    } else if (deco === 'swirl') {
      g.strokeStyle = 'rgba(232,110,160,.75)'; g.lineWidth = 5;
      for (let k = 0; k < 3; k++) { g.beginPath(); for (let a = 0; a < 5.5; a += 0.08) { const rr = 26 + a * 4, aa = a + k * TAU / 3; a ? g.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr) : g.moveTo(Math.cos(aa) * rr, Math.sin(aa) * rr); } g.stroke(); }
    } else if (deco === 'aurora') {
      [['rgba(90,255,200,.55)', 0], ['rgba(255,120,220,.45)', 2.1], ['rgba(140,200,255,.5)', 4.2]].forEach(([c, o]) => { g.strokeStyle = c; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 38, o, o + 1.7); g.stroke(); });
    } else if (deco === 'flame') {
      for (let i = 0; i < 10; i++) { g.save(); g.rotate(i * TAU / 10); g.fillStyle = i % 2 ? 'rgba(255,230,120,.8)' : 'rgba(255,140,30,.85)'; g.beginPath(); g.moveTo(-6, -27); g.quadraticCurveTo(-7, -40, 0, -50); g.quadraticCurveTo(7, -40, 6, -27); g.closePath(); g.fill(); g.restore(); }
    } else if (deco === 'plaid') {
      g.fillStyle = 'rgba(20,0,0,.42)'; for (let x = -48; x < 48; x += 16) { g.fillRect(x, -48, 7, 96); g.fillRect(-48, x, 96, 7); }
      g.fillStyle = 'rgba(255,220,200,.25)'; for (let x = -44; x < 48; x += 16) { g.fillRect(x + 9, -48, 1.5, 96); g.fillRect(-48, x + 9, 96, 1.5); }
    } else if (deco === 'star') {
      g.fillStyle = 'rgba(255,255,230,.9)';
      for (let i = 0; i < 5; i++) { g.save(); g.rotate(i * TAU / 5); g.translate(0, -37); g.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? 2 : 6, a = k * Math.PI / 4; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); g.restore(); }
    }
  }
  function puckSprite() {
    const s = 80, c = mk(s, s), g = c.getContext('2d');
    g.translate(40, 40);
    g.fillStyle = '#020306'; g.beginPath(); g.arc(0, 3, 36, 0, TAU); g.fill();
    const gr = g.createRadialGradient(-10, -12, 3, 0, 0, 38);
    gr.addColorStop(0, '#3d4a63'); gr.addColorStop(0.5, '#171d2b'); gr.addColorStop(1, '#07090f');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 36, 0, TAU); g.fill();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(170,200,235,.5)'; g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(150,180,220,.22)'; g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.arc(0, 0, 31, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
    return c;
  }
  function glowSprite(col) {
    const s = 64, c = mk(s, s), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, col + 'cc'); gr.addColorStop(0.25, col + '66'); gr.addColorStop(1, col + '00');
    g.fillStyle = gr; g.fillRect(0, 0, s, s); return c;
  }
  function shadowSprite() {
    const s = 96, c = mk(s, s), g = c.getContext('2d');
    const gr = g.createRadialGradient(48, 48, 10, 48, 48, 46);
    gr.addColorStop(0, 'rgba(10,30,70,.5)'); gr.addColorStop(0.7, 'rgba(10,30,70,.28)'); gr.addColorStop(1, 'rgba(10,30,70,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s); return c;
  }
  function lumpSprite() {
    const s = 128, c = mk(s, s), g = c.getContext('2d');
    g.translate(64, 64);
    let gr = g.createRadialGradient(8, 10, 4, 0, 0, 56);
    gr.addColorStop(0, 'rgba(60,100,150,.0)'); gr.addColorStop(0.6, 'rgba(60,100,150,.18)'); gr.addColorStop(1, 'rgba(50,90,140,.55)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(4, 6, 56, 52, 0.3, 0, TAU); g.fill();
    gr = g.createRadialGradient(-12, -14, 2, -4, -4, 46);
    gr.addColorStop(0, 'rgba(255,255,255,.98)'); gr.addColorStop(0.5, 'rgba(235,248,255,.85)'); gr.addColorStop(1, 'rgba(205,230,250,.0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(-2, -3, 50, 46, 0.3, 0, TAU); g.fill();
    return c;
  }
  const SP = {};
  function buildSprites() {
    SP.teal = artOr('mallet_teal', malletSprite('#9ff7ec', '#22bdb3', '#0a525c'));
    SP.skin = {}; SKINS.forEach((k) => (SP.skin[k.id] = artOr('mallet_' + k.id, malletSprite(k.c[0], k.c[1], k.c[2], k.deco))));
    SP.red = SP.skin.classic;
    SP.cpu = [artOr('mallet_cpu0', malletSprite('#d9ff9e', '#6cc23a', '#22560c')), artOr('mallet_cpu1', malletSprite('#e3ccff', '#8f5ae0', '#331470', 'wave')), artOr('mallet_cpu2', malletSprite('#ffffff', '#9fb6d6', '#1d2c48', 'star'))];
    SP.puck = artOr('puck', puckSprite()); SP.shadow = shadowSprite(); SP.lump = artOr('bump', lumpSprite());
    SP.glow = {}; ['#ffc857', '#ff7a59', '#ff5f9e', '#5de0d0', '#8ab6ff', '#fff2c4'].forEach((c) => (SP.glow[c] = glowSprite(c)));
  }
  const BULB_COLS = ['#ffc857', '#ff7a59', '#ff5f9e', '#5de0d0', '#8ab6ff', '#ffc857'];

  // ---------------------------------------------------------- background
  function rrPath(g, x0, y0, x1, y1, r) {
    g.beginPath(); g.moveTo(x0 + r, y0); g.lineTo(x1 - r, y0); g.arcTo(x1, y0, x1, y0 + r, r); g.lineTo(x1, y1 - r); g.arcTo(x1, y1, x1 - r, y1, r);
    g.lineTo(x0 + r, y1); g.arcTo(x0, y1, x0, y1 - r, r); g.lineTo(x0, y0 + r); g.arcTo(x0, y0, x0 + r, y0, r); g.closePath();
  }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function buildBulbs() {
    const rnd = mulberry(7);
    bulbs = [];
    const pr = 34, per = [];
    // walk perimeter of lane rounded rect
    const x0 = lane.l, y0 = lane.t, x1 = lane.r, y1 = lane.b;
    const wlen = x1 - x0 - 2 * pr, hlen = y1 - y0 - 2 * pr, arcL = Math.PI * pr / 2, total = 2 * wlen + 2 * hlen + 4 * arcL;
    const n = Math.round(total / 30);
    for (let i = 0; i < n; i++) {
      let d = (i / n) * total, x, y;
      if (d < wlen) { x = x0 + pr + d; y = y0; } else if ((d -= wlen) < arcL) { const a = -Math.PI / 2 + d / pr; x = x1 - pr + Math.cos(a) * pr; y = y0 + pr + Math.sin(a) * pr; }
      else if ((d -= arcL) < hlen) { x = x1; y = y0 + pr + d; } else if ((d -= hlen) < arcL) { const a = d / pr; x = x1 - pr + Math.cos(a) * pr; y = y1 - pr + Math.sin(a) * pr; }
      else if ((d -= arcL) < wlen) { x = x1 - pr - d; y = y1; } else if ((d -= wlen) < arcL) { const a = Math.PI / 2 + d / pr; x = x0 + pr + Math.cos(a) * pr; y = y1 - pr + Math.sin(a) * pr; }
      else if ((d -= arcL) < hlen) { x = x0; y = y1 - pr - d; } else { d -= hlen; const a = Math.PI + d / pr; x = x0 + pr + Math.cos(a) * pr; y = y0 + pr + Math.sin(a) * pr; }
      bulbs.push({ x, y, c: BULB_COLS[i % BULB_COLS.length], ph: rnd() * 6 });
    }
  }

  function buildBG() {
    const rnd = mulberry(20241);
    bg = mk(Math.round(cw * dpr), Math.round(ch * dpr));
    const g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sky
    let gr = g.createLinearGradient(0, 0, 0, ch);
    gr.addColorStop(0, '#0c1a3f'); gr.addColorStop(0.5, '#0b1736'); gr.addColorStop(1, '#091030');
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    const bgImg = artReady('bg_night'); if (bgImg) { const sc = Math.max(cw / bgImg.width, ch / bgImg.height); g.drawImage(bgImg, (cw - bgImg.width * sc) / 2, (ch - bgImg.height * sc) / 2, bgImg.width * sc, bgImg.height * sc); }
    const glow = (x, y, r, col) => { const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, col); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(x - r, y - r, 2 * r, 2 * r); };
    glow(0, ch * 0.3, ch * 0.5, 'rgba(60,200,170,.20)'); glow(cw, ch * 0.7, ch * 0.5, 'rgba(110,120,255,.20)');
    glow(cw / 2, 0, cw * 0.7, 'rgba(90,150,255,.16)'); glow(cw / 2, ch, cw * 0.7, 'rgba(255,170,110,.12)');
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.15 + rnd() * 0.55).toFixed(2) + ')'; const s = rnd() < 0.15 ? 1.8 : 1; g.fillRect(rnd() * cw, rnd() * ch, s, s); }
    // pine silhouettes at the far sides
    g.fillStyle = '#071328';
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < 9; i++) {
        const base = ch * (0.35 + rnd() * 0.6), hgt = 40 + rnd() * 70, x = side ? cw - rnd() * 20 : rnd() * 20, wd = hgt * 0.38;
        g.beginPath(); g.moveTo(x, base - hgt); g.lineTo(x + wd, base); g.lineTo(x - wd, base); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(x, base - hgt * 0.7); g.lineTo(x + wd * 1.25, base + hgt * 0.15); g.lineTo(x - wd * 1.25, base + hgt * 0.15); g.closePath(); g.fill();
      }
    }
    // world transform
    g.setTransform(dpr * S, 0, 0, dpr * S, dpr * OX, dpr * OY);
    const outline = PH.outline;
    const path = () => { g.beginPath(); outline.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
    // light wire
    g.strokeStyle = 'rgba(8,12,26,.95)'; g.lineWidth = 1.3; rrPath(g, lane.l, lane.t, lane.r, lane.b, 34); g.stroke();
    // snowbank
    g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 16 * S; g.shadowOffsetY = 4 * S;
    path(); g.lineJoin = 'round'; g.strokeStyle = '#cfe0f0'; g.lineWidth = BANK * 2; g.stroke(); g.restore();
    path(); g.strokeStyle = '#eef6ff'; g.lineWidth = BANK * 1.5; g.stroke();
    // lumpy snow along the outside
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      if (l < 1) continue;
      const nx = dy / l, ny = -dx / l, cnt = Math.max(1, Math.round(l / 9));
      for (let k = 0; k < cnt; k++) {
        const t = (k + rnd()) / cnt, r = 4.5 + rnd() * 4.5, off = BANK * 0.7 + rnd() * 2;
        const px = a[0] + dx * t + nx * off, py = a[1] + dy * t + ny * off;
        g.fillStyle = 'rgba(120,150,190,.35)'; g.beginPath(); g.arc(px + 1, py + 2, r, 0, TAU); g.fill();
        const q = g.createRadialGradient(px - r * 0.3, py - r * 0.4, 0, px, py, r);
        q.addColorStop(0, '#ffffff'); q.addColorStop(1, '#dbe9f7');
        g.fillStyle = q; g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
      }
    }
    // ice
    path(); gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#eaf7ff'); gr.addColorStop(0.5, '#d6ecfb'); gr.addColorStop(1, '#bddcf1');
    g.fillStyle = gr; g.fill();
    g.save(); path(); g.clip();
    const iceImg = artReady('ice');
    if (iceImg) { g.drawImage(iceImg, 0, 0, W, H); g.restore(); } else {
    gr = g.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.7);
    gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(70,120,180,.28)');
    g.fillStyle = gr; g.fillRect(-10, -GD - 10, W + 20, H + 2 * GD + 20);
    // warm light pools from the string lights
    bulbs.forEach((b, i) => {
      if (i % 2) return;
      const px = clamp(b.x, 0, W), py = clamp(b.y, 0, H), q = g.createRadialGradient(px, py, 0, px, py, 70);
      q.addColorStop(0, 'rgba(255,200,120,.13)'); q.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = q; g.fillRect(px - 70, py - 70, 140, 140);
    });
    // scratches
    for (let i = 0; i < 240; i++) {
      const x = rnd() * W, y = rnd() * H, a = rnd() * TAU, l = 14 + rnd() * 60, c = a + (rnd() - 0.5) * 0.9;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,' + (0.25 + rnd() * 0.3).toFixed(2) + ')' : 'rgba(110,150,190,' + (0.08 + rnd() * 0.1).toFixed(2) + ')';
      g.lineWidth = 0.5 + rnd() * 0.9; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(c) * l * 0.5, y + Math.sin(c) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 5; i++) { // long skate arcs
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1.2; g.beginPath(); g.arc(rnd() * W * 1.6 - W * 0.3, rnd() * H * 1.6 - H * 0.3, 160 + rnd() * 300, rnd() * TAU, 0, rnd() < 0.5); g.stroke();
    }
    // markings
    g.fillStyle = 'rgba(214,64,82,.78)'; g.fillRect(0, H / 2 - 3, W, 6);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(0, H / 2 - 0.8, W, 1.6);
    g.fillStyle = 'rgba(80,150,225,.16)'; g.beginPath(); g.arc(W / 2, H / 2, 56, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(52,112,200,.65)'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, 56, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(52,112,200,.55)'; g.lineWidth = 2.4; g.lineCap = 'round'; // lake waves in the centre
    for (let k = -1; k <= 1; k++) { g.beginPath(); for (let x = -30; x <= 30; x += 3) { const yy = H / 2 + k * 13 + Math.sin(x * 0.2 + k) * 4; x === -30 ? g.moveTo(W / 2 + x, yy) : g.lineTo(W / 2 + x, yy); } g.stroke(); }
    [[62, H * 0.26], [W - 62, H * 0.26], [62, H * 0.74], [W - 62, H * 0.74]].forEach((p) => {
      g.strokeStyle = 'rgba(214,64,82,.45)'; g.lineWidth = 2; g.beginPath(); g.arc(p[0], p[1], 20, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(214,64,82,.8)'; g.beginPath(); g.arc(p[0], p[1], 5, 0, TAU); g.fill();
    });
    [0, 1].forEach((bot) => {
      const gy = bot ? H : 0, cx = W / 2;
      g.fillStyle = 'rgba(80,150,225,.22)'; g.beginPath(); g.arc(cx, gy, 84, bot ? Math.PI : 0, bot ? TAU : Math.PI, !!bot ? false : false); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(52,112,200,.6)'; g.lineWidth = 2.6; g.beginPath(); g.arc(cx, gy, 84, bot ? Math.PI : 0, bot ? TAU : Math.PI); g.stroke();
    });
    // inner bevel from the bank
    path(); g.lineWidth = 9; g.strokeStyle = 'rgba(70,110,160,.38)'; g.stroke();
    path(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.65)'; g.stroke();
    g.restore(); }
    // goal pockets (dark net cavity)
    [0, 1].forEach((bot) => {
      const y0 = bot ? H : -GD;
      const q = g.createLinearGradient(0, y0, 0, y0 + GD); q.addColorStop(bot ? 0 : 1, '#16294f'); q.addColorStop(bot ? 1 : 0, '#070e22');
      g.fillStyle = q; g.fillRect(GX0, y0, GX1 - GX0, GD);
    });
  }

  // ---------------------------------------------------------- effects
  function spawn(p) { if (G.particles.length < 420) G.particles.push(p); return p; }
  function spray(x, y, nx, ny, speed, n) {
    n = n || Math.min(14, 3 + speed / 90);
    const base = Math.atan2(ny, nx);
    for (let i = 0; i < n; i++) {
      const a = base + (rnd() - 0.5) * 1.6, v = 70 + rnd() * (120 + speed * 0.18);
      spawn({ k: 'ice', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + rnd() * 0.45, t: 0, s: 1.1 + rnd() * 2.1, c: rnd() < 0.5 ? '#ffffff' : '#cfeaff' });
    }
  }
  function popup(x, y, text, col, size) { spawn({ k: 'text', x, y, vx: 0, vy: -46, life: 0.95, t: 0, text, col: col || '#fff', size: size || 15 }); }
  function ring(x, y, col, r1) { spawn({ k: 'ring', x, y, vx: 0, vy: 0, life: 0.65, t: 0, col: col || '#ffffff', r1: r1 || 70 }); }
  function confetti(x, y, n) {
    const cols = ['#ffc857', '#ff7a59', '#5de0d0', '#8ab6ff', '#ffffff', '#ff5f9e'];
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, v = 120 + rnd() * 380; spawn({ k: 'conf', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 140, life: 1.2 + rnd() * 1.2, t: 0, s: 3 + rnd() * 3, c: cols[(rnd() * cols.length) | 0], rot: rnd() * 6, vr: (rnd() - 0.5) * 14 }); }
  }
  let tapped = false;
  function buzz(ms) {
    const ua = navigator.userActivation;
    if (tapped && save.buzz && !G.demo && navigator.vibrate && (!ua || ua.hasBeenActive)) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  // ---------------------------------------------------------- trophies (1-player skill badges, saved forever)
  const TROPHIES = [
    { id: 'first', icon: '🥅', name: 'Lake Breaker', how: 'Score your first goal' },
    { id: 'bank', icon: '↗️', name: 'Bank Teller', how: 'Score off a side wall' },
    { id: 'bank2', icon: '🔀', name: 'Two-Cushion', how: 'Score off both side walls (Rec League+)' },
    { id: 'snipe', icon: '📡', name: 'Radar Gun', how: 'Score at 150+ mph (Rec League+)' },
    { id: 'hot', icon: '🔥', name: 'Red Hot', how: 'Score a red-hot rally puck (Rec League+)' },
    { id: 'rookie', icon: '🍁', name: 'Sugar Shack', how: 'Beat Sugar Maple Sam (Rookie)' },
    { id: 'rec', icon: '⛸️', name: 'Rec Champ', how: 'Beat Winooski Wendy (Rec League)' },
    { id: 'legend', icon: '🏔️', name: 'Lake Legend', how: 'Beat Old Lake Effect (Pond Legend)' },
    { id: 'shutout', icon: '🧊', name: 'Ice Wall', how: 'Win a match 7–0' },
    { id: 'comeback', icon: '🌅', name: 'Spring Thaw', how: 'Win after trailing by 3' },
    { id: 'streak', icon: '👑', name: 'Pond Royalty', how: 'Win 3 straight vs Pond Legend' }
  ];
  // ---------------------------------------------------------- mallet skins (unlocked by trophies + dailies)
  const has = (id) => !!save.trophies[id];
  const SKINS = [
    { id: 'classic', name: 'Classic Red', c: ['#ffb48c', '#ee4a2c', '#8a1a0c'], how: 'Ready to go', ok: () => true },
    { id: 'maple', name: 'Sugar Maple', c: ['#ffd98a', '#e8891c', '#7a3a06'], deco: 'leaf', how: 'Beat Rookie', ok: () => has('rookie') },
    { id: 'lake', name: 'Lake Blue', c: ['#a8dcff', '#2f7fd6', '#0d2f6e'], deco: 'wave', how: 'Score a bank goal', ok: () => has('bank') },
    { id: 'creemee', name: 'Creemee Swirl', c: ['#ffffff', '#f6d7e4', '#b98aa0'], deco: 'swirl', how: 'Finish a Daily Pond', ok: () => save.dly.total >= 1 },
    { id: 'aurora', name: 'Aurora', c: ['#c9a8ff', '#6a4fd8', '#22125e'], deco: 'aurora', how: 'Beat Rec League', ok: () => has('rec') },
    { id: 'ember', name: 'Ember', c: ['#ffe08a', '#ff6a1f', '#7a1500'], deco: 'flame', how: 'Score a red-hot goal', ok: () => has('hot') },
    { id: 'flannel', name: 'Flannel', c: ['#ff8f7a', '#c4231b', '#4a0806'], deco: 'plaid', how: '3-day Daily streak', ok: () => save.dly.best >= 3 },
    { id: 'gold', name: 'Golden Pond', c: ['#fff4b8', '#f2b81e', '#7a5100'], deco: 'star', how: 'Beat Pond Legend', ok: () => has('legend') }
  ];
  const skinOf = (id) => SKINS.find((k) => k.id === id) || SKINS[0];
  function unlockedSkins() { return SKINS.filter((k) => k.ok()).map((k) => k.id); }
  let knownSkins = unlockedSkins();
  function checkSkins() { // call after anything that can unlock a skin
    const now = unlockedSkins(), fresh = now.filter((id) => knownSkins.indexOf(id) < 0); knownSkins = now;
    fresh.forEach((id) => { const k = skinOf(id); const t = { icon: '◉', name: k.name + ' mallet', skin: id }; G.newTrophies.push(t); G.trophyQ.push({ t, age: 0, label: 'NEW MALLET' }); });
  }

  // ---------------------------------------------------------- Daily Pond (one seeded challenge per calendar day)
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  const TWISTS = [
    { id: 'none', name: 'Fresh ice', desc: 'Smooth, clean ice' },
    { id: 'glare', name: 'Glare ice', desc: 'Slick! The puck barely slows down' },
    { id: 'slush', name: 'Slushy', desc: 'Warm day: the puck drags' },
    { id: 'cracked', name: 'Frost heaves', desc: 'Three lumps on the ice from the drop' },
    { id: 'short', name: 'Thin ice', desc: 'Quick game: first to 4' }
  ];
  const GOALS = {
    win: { text: 'Win the match', check: () => true },
    banks: { text: 'Win with 2 bank goals', check: (d) => d.banks >= 2, prog: (d) => d.banks + '/2 bank goals' },
    bank1: { text: 'Win with a bank goal', check: (d) => d.banks >= 1, prog: (d) => d.banks + '/1 bank goals' },
    margin: { text: 'Win by 4 or more', check: () => G.scores.bottom - G.scores.top >= 4, prog: () => 'won by ' + (G.scores.bottom - G.scores.top) },
    clean: { text: 'Win without ever trailing', check: (d) => !d.behind, prog: () => 'you trailed' },
    snipe: { text: 'Win with a 120+ mph goal', check: (d) => d.mph >= 120, prog: (d) => 'fastest goal ' + d.mph + ' mph' }
  };
  function todaysDaily() {
    const key = dayKey(), r = mulberry(+key.replace(/-/g, '') * 7919 + 13);
    for (let i = 0; i < 4; i++) r();
    const lr = r(), level = lr < 0.3 ? 0 : lr < 0.75 ? 1 : 2;
    const twist = TWISTS[(r() * TWISTS.length) | 0];
    const pool = level === 0 ? ['banks', 'margin', 'clean', 'snipe'] : level === 1 ? ['win', 'bank1', 'clean', 'snipe'] : ['win', 'win', 'bank1'];
    const gid = pool[(r() * pool.length) | 0];
    return { key, level, twist, gid, goal: GOALS[gid] };
  }
  function yesterdayKey() { const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); }
  function dailyStreakNow() { return save.dly.last === dayKey() || save.dly.last === yesterdayKey() ? save.dly.streak : 0; }

  function trophyCount() { return TROPHIES.filter((t) => save.trophies[t.id]).length; }
  function award(id) {
    if (G.demo || G.twop || save.trophies[id]) return;
    const t = TROPHIES.find((q) => q.id === id); if (!t) return;
    save.trophies[id] = Date.now(); persist();
    G.newTrophies.push(t); G.trophyQ.push({ t, age: 0 });
    setTimeout(() => A.trophy(), 250);
    checkSkins();
  }

  // ---------------------------------------------------------- match flow
  // ---------------------------------------------------------- CPU chatter (one short line now and then)
  const LINES = [
    { start: ['Oh boy, oh boy!', 'Go easy on me, OK?', 'I had pancakes. I\'m ready!'], score: ['Did I do that?!', 'WOO! Sugar rush!', 'Beginner\'s luck!'], ouch: ['Aw, shucks.', 'Wait, where\'d it go?', 'Nice one!', 'Whoa, fast!'], hot: ['It\'s getting HOT!'], win: 'Good game! Pancakes after?', lose: 'You\'re really good at this!' },
    { start: ['Mind the boards.', 'Let\'s keep it clean.'], score: ['Off the boards!', 'Geometry, baby.', 'Bank\'s open!'], ouch: ['Lucky bounce.', 'Hm. Noted.', 'Okay, okay.'], hot: ['Now we\'re skating!'], win: 'Boards don\'t lie.', lose: 'Rematch. Now.' },
    { start: ['The lake remembers.', 'Skate fast, kid.'], score: ['Lake effect.', 'Too slow.', 'Wind\'s out of the west.'], ouch: ['...Interesting.', 'Hmph. Again.', 'Not bad, kid.'], hot: ['Feel that chill?'], win: 'Come back when the ice is thicker.', lose: 'The lake has a new legend.' }
  ];
  function say(kind) {
    if (G.demo || G.twop || !G.ai[0]) return;
    const L = LINES[G.ai[0].idx], arr = L[kind]; if (!arr) return;
    if (kind !== 'score' && G.say && G.now - G.say.at < 6) return;
    G.say = { text: Array.isArray(arr) ? arr[(rnd() * arr.length) | 0] : arr, t: G.phase === 'goal' ? -1.6 : 0, at: G.now };
  }
  function aiFor(side) { return G.ai.find((a) => a.side === side); }
  function startMatch(opts) {
    opts = opts || {};
    G.demo = !!opts.demo; G.twop = !!opts.twop; G.level = opts.level != null ? opts.level : G.level;
    G.daily = opts.daily && !G.twop && !G.demo ? todaysDaily() : null;
    if (G.daily) G.level = G.daily.level;
    G.dstat = { banks: 0, mph: 0, behind: false };
    WIN = G.daily && G.daily.twist.id === 'short' ? 4 : 7;
    G.w = PH.createWorld(); G.w.bumpsOn = G.demo ? false : save.choppy;
    if (G.daily) {
      const tw = G.daily.twist.id;
      if (tw === 'glare') G.w.friction = 0.35; else if (tw === 'slush') G.w.friction = 2.4;
      if (tw === 'cracked') { G.w.bumpsOn = true; [[90, H * 0.36], [W - 90, H * 0.5], [110, H * 0.64]].forEach((p) => { const b = PH.addBump(G.w, p[0], p[1]); b.age = C.BUMP_WARN + 1; b.active = true; }); }
    }
    G.scores = { bottom: 0, top: 0 }; G.totalGoals = 0; G.stats = newStats(); G.rally = 0; G.lastToucher = null; G.lastShot = null;
    G.particles.length = 0; G.ripples.length = 0; G.trail.length = 0; G.banner = null; G.toast = null; G.ts = 1; G.hitPause = 0; G.shake = 0;
    G.ai = [];
    if (G.demo) G.ai = [PH.makeAI('top', 1), PH.makeAI('bottom', 1)];
    else if (!G.twop) G.ai = [PH.makeAI('top', G.level)];
    G.matchTime = 0; G.ctrlTime = 0; G.firstChop = false;
    G.banks = 0; G.heatStage = 0; G.pipPop.length = 0; G.zoom = 0; G.puckSq = 0; G.puckFlash = 0; G.trophyQ.length = 0; G.newTrophies = []; G.maxDeficit = 0; G.rec = []; G.replay = null;
    ctrl.bottom.pid = null; ctrl.top.pid = null;
    // human mallets follow a finger tightly (CPU mallets keep their per-level speed caps)
    G.w.mallets.forEach((m) => { if (!G.ai.some((a) => a.side === m.side)) { m.k = HUMAN.k; m.resp = HUMAN.resp; m.maxV = HUMAN.maxV; } });
    document.body.classList.toggle('twop', G.twop);
    scuffCtx && scuffCtx.clearRect(0, 0, W, H);
    G.mode = opts.demo ? 'menu' : 'play';
    layout();
    serve(opts.firstServe || 'bottom', true);
    if (!G.demo && !G.daily) { save.level = G.level; persist(); }
    if (G.daily) G.toast = { text: G.daily.twist.name + ' · ' + G.daily.goal.text, t: -0.6 };
    G.say = null; if (!G.demo && !G.twop) setTimeout(() => { if (G.mode === 'play' && G.matchTime < 3) say('start'); }, 700);
  }
  function serve(side, first) {
    const p = G.w.puck, w = G.w;
    p.x = W / 2 + (first ? 0 : (rnd() - 0.5) * 90); p.y = side === 'bottom' ? H * 0.66 : H * 0.34;
    p.vx = p.vy = 0; p.live = false; w.goal = null; w.idleT = 0; w.idleX = undefined; G.dropT = 0.5; G.phase = 'serve'; G.serveSide = side; G.trail.length = 0;
    G.lastShot = null; G.banks = 0; G.bankL = G.bankR = 0; G.lastHit = null; G.heatStage = 0; G.rec.length = 0;
    G.ai.forEach((a) => { a.holdUntil = a.t + a.lvl.wait + 0.4; a.hist.length = 0; });
    if (!G.demo) setTimeout(() => A.drop(), 330);
  }
  function chooseBumpSpot() {
    const w = G.w;
    for (let tries = 0; tries < 40; tries++) {
      const x = 60 + rnd() * (W - 120), y = H * 0.24 + rnd() * H * 0.52;
      if (Math.abs(y - H / 2) < 34) continue;
      if (Math.hypot(x - W / 2, y - H * 0.66) < 80 || Math.hypot(x - W / 2, y - H * 0.34) < 80) continue;
      if (w.bumps.some((b) => Math.hypot(b.x - x, b.y - y) < 95)) continue;
      return { x, y };
    }
    return null;
  }
  function addBump() {
    const s = chooseBumpSpot(); if (!s) return;
    PH.addBump(G.w, s.x, s.y);
    ring(s.x, s.y, '#ffffff', 52); A.crack(); buzz(20);
    if (!G.firstChop) { G.firstChop = true; G.toast = { text: 'Choppy ice! Watch the cracks', t: 0 }; }
  }
  function onGoal(ev) {
    const scorer = ev.into === 'top' ? 'bottom' : 'top';
    G.scores[scorer]++; G.totalGoals++; G.phase = 'goal'; G.goalT = 0; G.goalInfo = { scorer, into: ev.into, speed: ev.speed };
    G.stats.bestRally = Math.max(G.stats.bestRally, G.rally);
    G.maxDeficit = Math.max(G.maxDeficit, G.scores.top - G.scores.bottom);
    if (G.scores.top > G.scores.bottom) G.dstat.behind = true;
    if (!G.demo) A.duck(true);
    const big = clamp((ev.speed - 600) / 1000, 0, 1);
    G.hitPause = G.demo ? 0 : 0.08 + 0.06 * big; G.shake = G.demo ? 0 : 7 + 5 * big; G.flash = 1;
    G.flashCol = scorer === 'bottom' ? '255,150,100' : '110,235,220';
    G.pipPop.push({ side: scorer, i: G.scores[scorer] - 1, t: 0 });
    if (!G.demo) { G.zoom = 1; G.zoomX = clamp(ev.x, GX0, GX1); G.zoomY = ev.into === 'top' ? 0 : H; }
    G.ripples.push({ into: ev.into, x: ev.x, t: 0, amp: clamp(ev.speed / 500, 0.6, 2.4) });
    G.particles = G.particles.filter((q) => q.k !== 'text');
    const gy = ev.into === 'top' ? 0 : H;
    for (let i = 0; i < 26; i++) { const a = rnd() * TAU, v = 60 + rnd() * 260; spawn({ k: 'ice', x: ev.x, y: gy, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 + (ev.into === 'top' ? 60 : -60), life: 0.5 + rnd() * 0.8, t: 0, s: 1.4 + rnd() * 2.4, c: '#ffffff' }); }
    ring(ev.x, gy, scorer === 'bottom' ? '#ffb48c' : '#9ff7ec', 120);
    if (!G.demo) {
      A.horn(); A.net(); buzz([30, 40, 70]);
      if (!G.twop && scorer === 'bottom') A.cheer(0.6 + 0.4 * big);
      if (!G.twop && scorer === 'top' && !save.tipBank && G.scores.top >= 2) { save.tipBank = 1; persist(); setTimeout(() => { if (G.mode === 'play') G.toast = { text: 'Tip: bank it off the side wall!', t: 0 }; }, 2600); }
      if (!G.twop) { if (scorer === 'top') say('score'); else if (rnd() < 0.6) { G.say = null; say('ouch'); } }
      const mph = Math.round(ev.speed * 0.08);
      // name the shot: this is what players brag about
      let call = null;
      // own = the defender really hit it in (a graze or a block that barely changed it still credits the shooter)
      const lh = G.lastHit, own = !!lh && lh.side !== scorer && lh.speed > 380;
      const cushions = G.bankL && G.bankR ? 2 : G.banks ? 1 : 0;
      // the scorer always gets the goal; a defender's touch just means no fancy callout / bank trophy
      if (own) call = null;
      else if (cushions >= 2 && ev.speed > 600) call = 'TWO-CUSHION BANK!';
      else if (cushions === 1 && ev.speed > 900) call = 'BANK SHOT!';
      else if (ev.heat >= 0.99) call = 'RED-HOT RALLY WINNER!';
      else if (mph >= 110) call = mph + ' MPH SNIPE!';
      G.banks = cushions;
      const jokes = ['Right in the maple!', 'Creemee-cold finish!', 'Lake effect snow job!', 'Nothing but net!', 'That one was chilly.', 'Top shelf, where the syrup goes!'];
      let who = scorer === 'bottom' ? (G.twop ? 'PLAYER 1' : 'YOU') : (G.twop ? 'PLAYER 2' : G.ai[0].lvl.who.toUpperCase());
      G.goalInfo.call = call; G.goalInfo.mph = mph; G.goalInfo.t = G.w.time; G.goalInfo.replayed = false;
      G.banner = { t: 0, text: 'GOAL!', sub: who + (G.twop || scorer === 'top' ? ' SCORES' : ' SCORE'), joke: call || jokes[(rnd() * jokes.length) | 0], call: !!call, scorer, mph, mp: G.scores[scorer] === WIN - 1 && G.scores.bottom !== G.scores.top };
      if (!G.twop && scorer === 'bottom') {
        confetti(ev.x, ev.into === 'top' ? 20 : H - 20, 34);
        award('first');
        if (!own) { if (G.banks >= 1) G.dstat.banks++; G.dstat.mph = Math.max(G.dstat.mph, mph); }
        if (!own) { if (G.banks >= 1) award('bank'); if (G.level >= 1) { if (G.banks >= 2) award('bank2'); if (mph >= 150) award('snipe'); if (ev.heat >= 0.99) award('hot'); } }
      }
    }
    G.rally = 0; G.lastToucher = null; G.lastShot = null; G.banks = 0; G.bankL = G.bankR = 0; G.lastHit = null;
  }
  function afterGoal() {
    const gi = G.goalInfo;
    if (!G.demo && !gi.replayed && ((gi.call && gi.call !== 'BANK SHOT!') || G.scores[gi.scorer] >= WIN) && G.rec.length > 20) { startReplay(); return; }
    if (G.demo) {
      if (G.scores[gi.scorer] >= WIN) { G.scores = { bottom: 0, top: 0 }; G.totalGoals = 0; }
      serve(gi.into, false); return;
    }
    if (G.scores[gi.scorer] >= WIN) { finishMatch(gi.scorer); return; }
    A.duck(false);
    if (G.w.bumpsOn && G.totalGoals % 2 === 0 && G.w.bumps.length < 3) addBump();
    G.banner = null;
    serve(gi.into, false);
  }
  // ---------------------------------------------------------- instant replay (named goals + match winners)
  function startReplay() {
    const gi = G.goalInfo; gi.replayed = true;
    const fr = G.rec.slice(), tEnd = fr[fr.length - 1].t, t0 = Math.max(fr[0].t, gi.t - 1.1);
    G.replay = { fr, t: t0, t0, t1: Math.min(tEnd, gi.t + 0.22), i: 0, cap: gi.call ? (!G.twop && gi.scorer === 'top' ? G.ai[0].lvl.who.toUpperCase() + ' · ' + gi.call : gi.call) : (G.twop ? (gi.scorer === 'bottom' ? 'PLAYER 1' : 'PLAYER 2') + ' WINS IT' : gi.scorer === 'bottom' ? 'THE WINNER' : 'GAME OVER'), age: 0 };
    G.phase = 'replay'; G.banner = null; G.trail.length = 0; G.particles = G.particles.filter((q) => q.k === 'conf');
    A.duck(true); A.whoosh && A.whoosh();
  }
  function stepReplay(dtReal) {
    const r = G.replay, w = G.w; r.age += dtReal;
    r.t += dtReal * (r.age < 0.25 ? 0.9 : 0.55); // drift in, then slow-mo
    const fr = r.fr; while (r.i < fr.length - 2 && fr[r.i + 1].t <= r.t) r.i++;
    const a = fr[r.i], b = fr[Math.min(fr.length - 1, r.i + 1)], k = b.t > a.t ? clamp((r.t - a.t) / (b.t - a.t), 0, 1) : 0;
    const p = w.puck; p.x = lerp(a.x, b.x, k); p.y = lerp(a.y, b.y, k); p.vx = a.vx; p.vy = a.vy; p.live = true;
    for (let j = 0; j < 2; j++) { const m = w.mallets[j]; m.x = lerp(a.m[j * 2], b.m[j * 2], k); m.y = lerp(a.m[j * 2 + 1], b.m[j * 2 + 1], k); m.vx = m.vy = 0; m.tx = m.x; m.ty = m.y; }
    w.heat = a.heat;
    if (r.t >= r.t1 || r.skip) { G.replay = null; G.phase = 'goal'; G.trail.length = 0; w.heat = 0; afterGoal(); }
  }
  function finishMatch(winner) {
    G.mode = 'over'; G.phase = 'over'; G.overT = 0; G.banner = null;
    const win = G.twop ? true : winner === 'bottom';
    G.dailyResult = null;
    if (G.daily) {
      const ok = winner === 'bottom' && G.daily.goal.check(G.dstat);
      G.dailyResult = { ok, first: false };
      if (ok && save.dly.last !== G.daily.key) {
        save.dly.streak = save.dly.last === yesterdayKey() ? save.dly.streak + 1 : 1;
        save.dly.best = Math.max(save.dly.best, save.dly.streak); save.dly.last = G.daily.key; save.dly.total++;
        G.dailyResult.first = true; persist(); checkSkins();
      }
      if (ok) { const tm = Math.round(G.matchTime); if (!save.dly.bestT || save.dly.bestT.key !== G.daily.key || tm < save.dly.bestT.t) { G.dailyResult.pb = save.dly.bestT && save.dly.bestT.key === G.daily.key; save.dly.bestT = { key: G.daily.key, t: tm }; persist(); } }
      if (winner === 'bottom') { award(['rookie', 'rec', 'legend'][G.level]); if (G.scores.top === 0 && WIN === 7) award('shutout'); if (G.maxDeficit >= 3) award('comeback'); }
    } else if (!G.twop) {
      const l = G.level;
      G.prevStreak = save.streak[l];
      if (winner === 'bottom') { save.streak[l]++; save.wins[l]++; save.best[l] = Math.max(save.best[l], save.streak[l]); } else { save.streak[l] = 0; save.losses[l]++; }
      persist();
      if (winner === 'bottom') {
        award(['rookie', 'rec', 'legend'][l]);
        if (G.scores.top === 0) award('shutout');
        if (G.maxDeficit >= 3) award('comeback');
        if (l === 2 && save.streak[2] >= 3) award('streak');
      }
    }
    G.stats.time = G.matchTime; G.winner = winner;
    if (G.twop) { G.series[winner]++; G.ready = { bottom: false, top: false }; }
    ctrl.bottom.pid = ctrl.top.pid = null;
    if (!G.twop && winner === 'bottom') { confetti(W / 2, H * 0.5, 70); A.win(); } else if (!G.twop) A.lose(); else { confetti(W / 2, winner === 'top' ? H * 0.3 : H * 0.7, 60); A.win(); }
    G.overDelay = 0.9;
  }
  function showOver2() {
    const s = G.stats, ser = G.series;
    const half = (side) => {
      const me = side, opp = side === 'bottom' ? 'top' : 'bottom', won = G.winner === me, st = s[me];
      const lead = ser[me] > ser[opp] ? 'You lead the series' : ser[me] < ser[opp] ? 'You trail the series' : 'Series tied';
      return '<div class="h2res ' + (won ? 'won' : 'lost') + '">' + (won ? 'YOU WIN!' : 'SO CLOSE!') + '</div>' +
        '<div class="h2score">' + G.scores[me] + ' – ' + G.scores[opp] + '</div>' +
        '<div class="h2series">' + lead + ' <b>' + ser[me] + '–' + ser[opp] + '</b></div>' +
        '<div class="h2stats"><div><b>' + st.shots + '</b><span>shots</span></div><div><b>' + st.saves + '</b><span>saves</span></div><div><b>' + Math.round(s.topSpeed * 0.08) + '</b><span>top mph</span></div><div><b>' + s.bestRally + '</b><span>best rally</span></div></div>' +
        '<button class="big ready" data-side="' + side + '">' + (G.ready[side] ? 'READY ✓' : 'READY') + '</button>' +
        '<div class="h2wait">' + (G.ready[side] ? 'Waiting for the other player…' : G.ready[opp] ? 'They\'re ready!' : 'Both tap READY for a rematch') + '</div>' +
        '<button class="h2menu">Menu</button>';
    };
    $('o2T').innerHTML = half('top'); $('o2B').innerHTML = half('bottom');
    $('o2T').className = 'half top' + (G.winner === 'top' ? ' won' : ''); $('o2B').className = 'half bot' + (G.winner === 'bottom' ? ' won' : '');
    const readyUp = (sd) => {
      if (G.ready[sd] || $('over2').hidden || $('over2').classList.contains('guard')) return;
      A.unlock(); A.click(); G.ready[sd] = true;
      $('over2').querySelectorAll('.ready').forEach((b) => { const me = b.dataset.side; b.textContent = G.ready[me] ? 'READY ✓' : 'READY'; b.classList.toggle('on', G.ready[me]); });
      $('over2').querySelectorAll('.h2wait').forEach((el, i) => { const me = i ? 'bottom' : 'top', op = i ? 'top' : 'bottom'; el.textContent = G.ready[me] ? 'Waiting for the other player…' : G.ready[op] ? 'They\'re ready!' : 'Both tap READY for a rematch'; });
      if (G.ready.bottom && G.ready.top) setTimeout(() => { if ($('over2').hidden) return; $('over2').hidden = true; A.pop(1.4); startMatch({ twop: true, firstServe: G.winner === 'bottom' ? 'top' : 'bottom' }); }, 350);
    };
    $('over2').querySelectorAll('.ready').forEach((b) => { b.onpointerup = (e) => { e.preventDefault(); readyUp(b.dataset.side); }; b.onclick = () => readyUp(b.dataset.side); });
    $('over2').querySelectorAll('.h2menu').forEach((b) => (b.onclick = () => { A.click(); toMenu(); }));
    if ($('over2').hidden) guard('over2', 600);
    $('over2').hidden = false;
  }
  function showOver() {
    if (G.twop) { showOver2(); return; }
    const s = G.stats, win = G.winner === 'bottom';
    let head, flip = '';
    if (G.twop) { head = G.winner === 'bottom' ? 'PLAYER 1 WINS!' : 'PLAYER 2 WINS!'; flip = head; }
    else head = win ? 'YOU WIN!' : 'TOUGH LOSS';
    $('ovHead').textContent = head; $('ovHeadFlip').textContent = flip;
    $('ovScore').textContent = G.scores.bottom + ' – ' + G.scores.top;
    const l = G.level, lv = PH.LEVELS[l];
    let sl = '';
    if (!G.twop) sl = win ? ('WIN STREAK vs ' + lv.name.toUpperCase() + ': ' + save.streak[l] + (save.streak[l] >= save.best[l] && save.streak[l] > 1 ? '  ★ BEST' : '')) : (G.prevStreak > 0 ? 'STREAK OF ' + G.prevStreak + ' ENDED · BEST ' + save.best[l] : save.best[l] ? 'BEST STREAK vs ' + lv.name.toUpperCase() + ': ' + save.best[l] : 'SHAKE IT OFF · ONE MORE?');
    if (G.daily) {
      const d = G.daily, r = G.dailyResult || {};
      const fmt = (x) => Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0');
      if (r.ok) { head = r.first ? 'DAILY DONE!' : r.pb ? 'NEW DAILY BEST!' : 'DAILY DONE AGAIN'; sl = '🔥 DAILY STREAK ' + save.dly.streak + (save.dly.streak > 1 ? ' DAYS' : ' DAY') + ' · TODAY\'S BEST ' + fmt(save.dly.bestT.t); }
      else if (win) { head = 'SO CLOSE!'; $('ovHead').textContent = head; sl = 'CHALLENGE MISSED · '; }
      if (!r.ok && win) sl += d.goal.text.toUpperCase() + (d.goal.prog ? ' (' + d.goal.prog(G.dstat) + ')' : '');
      else if (!win) sl = 'TODAY: ' + d.goal.text.toUpperCase();
      $('ovHead').textContent = head;
    }
    $('ovStreak').textContent = sl;
    A.duck(false);
    const qL = !G.twop && G.ai[0] ? LINES[G.ai[0].idx] : null;
    $('ovQuote').textContent = qL ? G.ai[0].lvl.who + ': “' + (win ? qL.lose : qL.win) + '”' : '';
    const me = s.bottom, mins = Math.floor(s.time / 60), secs = Math.floor(s.time % 60);
    const items = G.twop ? [[me.shots + '/' + s.top.shots, 'Shots P1/P2'], [me.saves + '/' + s.top.saves, 'Saves P1/P2'], [Math.round(s.topSpeed * 0.08), 'Top mph'], [s.bestRally, 'Best rally'], [me.hits + '/' + s.top.hits, 'Hits P1/P2'], [mins + ':' + (secs < 10 ? '0' : '') + secs, 'Time']]
      : [[me.onTarget + '/' + me.shots, 'On goal/shots'], [me.saves, 'Saves'], [Math.round(s.topSpeed * 0.08), 'Top speed mph'], [s.bestRally, 'Best rally'], [me.hits, 'Mallet hits'], [mins + ':' + (secs < 10 ? '0' : '') + secs, 'Time']];
    $('ovStats').innerHTML = items.map((i) => '<div><b>' + i[0] + '</b><span>' + i[1] + '</span></div>').join('');
    const nt = G.newTrophies || [], ot = $('ovTro');
    ot.hidden = !nt.length; ot.innerHTML = nt.map((t, i) => '<div style="animation-delay:' + (0.25 + i * 0.15) + 's">' + t.icon + ' ' + t.name + '</div>').join('');
    $('btnNext').hidden = !(!G.twop && !G.daily && win && l < 2);
    $('btnAgain').textContent = G.daily ? (G.dailyResult && G.dailyResult.ok ? 'PLAY AGAIN' : 'TRY AGAIN') : 'REMATCH';
    $('btnNext').textContent = 'Next: ' + ['Rookie', 'Rec', 'Legend'][Math.min(2, l + 1)];
    $('over').hidden = false; guard('over', 600);
  }
  function guard(id, ms) { const el = $(id); el.classList.add('guard'); clearTimeout(el._g); el._g = setTimeout(() => el.classList.remove('guard'), ms); }

  // ---------------------------------------------------------- simulation tick
  function setHumanTargets() {
    const w = G.w;
    const k = G.kb, dx = k.r - k.l, dy = k.d - k.u;
    if (dx || dy) {
      const m = PH.malletBy(w, 'bottom'); m.tx = m.x + dx * 24; m.ty = m.y + dy * 24; G.ctrlTime += 0.016;
      if (G.twop) { /* in 2P arrows control P1; WASD handled as P2 below */ }
    }
    if (G.twop && G.kb2) {
      const k2 = G.kb2, ddx = k2.r - k2.l, ddy = k2.d - k2.u;
      if (ddx || ddy) { const m = PH.malletBy(w, 'top'); m.tx = m.x + ddx * 24; m.ty = m.y + ddy * 24; }
    }
  }

  function sim(dtReal) {
    const w = G.w; if (!w) return;
    G.now += dtReal;
    if (G.mode === 'play') G.matchTime += dtReal;
    // time scale: slow-mo around a goal
    let target = 1;
    if (G.phase === 'goal' && G.goalT < 0.8 && !G.demo) target = 0.28;
    G.ts += (target - G.ts) * Math.min(1, dtReal * 9);
    let dt = dtReal * G.ts;
    if (G.hitPause > 0) { G.hitPause -= dtReal; dt *= 0.02; }
    if (G.phase === 'goal' && G.mode !== 'over') { G.goalT += dtReal; if (G.goalT > (G.demo ? 0.9 : 1.75)) afterGoal(); }
    if (G.phase === 'serve') { G.dropT -= dt; if (G.dropT <= 0) { w.puck.live = true; G.phase = 'play'; } }
    if (G.mode === 'play' && !G.demo) { setHumanTargets(); if (ctrl.bottom.pid != null) G.ctrlTime += dtReal; }
    if (A.setTempo) A.setTempo(G.mode === 'play' && !G.demo ? (G.twop ? 120 : [108, 116, 126][G.level]) : 100);
    if (A.setIntensity) A.setIntensity(G.mode === 'play' && !G.demo ? (w.heat > 0.5 || G.scores.bottom === WIN - 1 || G.scores.top === WIN - 1 ? 2 : 1) : 0);

    if (G.phase === 'replay') stepReplay(dtReal);
    else {
      for (let i = 0; i < G.ai.length; i++) PH.aiUpdate(G.ai[i], w, dt);
      PH.step(w, dt);
      handleEvents(w);
      // keep ~2 s of history for the instant replay (stop shortly after a goal)
      if (!G.demo && w.puck.live && (G.phase === 'play' || (G.phase === 'goal' && G.goalInfo && w.time < G.goalInfo.t + 0.3))) {
        const p0 = w.puck, m0 = w.mallets[0], m1 = w.mallets[1];
        G.rec.push({ t: w.time, x: p0.x, y: p0.y, vx: p0.vx, vy: p0.vy, heat: w.heat, m: [m0.x, m0.y, m1.x, m1.y] });
        while (G.rec.length > 4 && G.rec[0].t < w.time - 2) G.rec.shift();
      }
    }
    // trail + scuffs
    const p = w.puck, sp = Math.hypot(p.vx, p.vy);
    if (p.live) {
      G.trail.push({ x: p.x, y: p.y, t: G.now });
      if (scuffCtx && sp > 60 && G.phase !== 'replay') { const l = G.trail[G.trail.length - 2]; if (l) { scuffCtx.strokeStyle = 'rgba(120,160,200,' + Math.min(0.32, sp / 2800).toFixed(3) + ')'; scuffCtx.lineWidth = 1.1; scuffCtx.beginPath(); scuffCtx.moveTo(l.x, l.y); scuffCtx.lineTo(p.x, p.y); scuffCtx.stroke(); } }
    }
    while (G.trail.length > 18) G.trail.shift();
    if (G.trail.length && G.now - G.trail[0].t > 0.35) G.trail.shift();
    G.scuffT += dtReal;
    if (G.scuffT > 0.8 && scuffCtx) { G.scuffT = 0; scuffCtx.save(); scuffCtx.globalCompositeOperation = 'destination-out'; scuffCtx.fillStyle = 'rgba(0,0,0,.09)'; scuffCtx.fillRect(0, 0, W, H); scuffCtx.restore(); }
    // shake / banner / toast / flash
    G.shake = Math.max(0, G.shake - dtReal * 26); const a = G.shake;
    G.shx = a ? (rnd() - 0.5) * a : 0; G.shy = a ? (rnd() - 0.5) * a : 0;
    if (G.banner) G.banner.t += dtReal;
    if (G.toast) { G.toast.t += dtReal; if (G.toast.t > 2.6) G.toast = null; }
    if (G.say && G.phase !== 'replay') { G.say.t += dtReal; if (G.say.t > 2.2) G.say = null; }
    G.flash = Math.max(0, G.flash - dtReal * 2.2);
    G.zoom = Math.max(0, G.zoom - dtReal * 0.9);
    G.puckSq *= Math.exp(-dtReal * 14); G.puckFlash = Math.max(0, G.puckFlash - dtReal * 5);
    for (let i = 0; i < 2; i++) { const m = w.mallets[i]; if (m.glow) m.glow = Math.max(0, m.glow - dtReal * 3.5); }
    for (let i = G.pipPop.length - 1; i >= 0; i--) { G.pipPop[i].t += dtReal; if (G.pipPop[i].t > 0.9) G.pipPop.splice(i, 1); }
    if (G.trophyQ.length && !((G.phase === 'goal' && G.banner) || G.phase === 'replay') && G.mode !== 'over') { G.trophyQ[0].age += dtReal; if (G.trophyQ[0].age > 2.8) G.trophyQ.shift(); }
    for (let i = 0; i < G.ripples.length; i++) { G.ripples[i].t += dt; }
    G.ripples = G.ripples.filter((r) => r.t < 1.6);
    updateParticles(dt);
    if (G.mode === 'over') { if (G.overDelay > 0) { G.overDelay -= dtReal; if (G.overDelay <= 0) showOver(); } }
  }

  function handleEvents(w) {
    const evs = w.ev; if (!evs.length) return;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.t === 'mallet') {
        const m = e.m, side = m.side, p = w.puck, sp = Math.hypot(p.vx, p.vy);
        const human = !G.demo && (G.twop || side === 'bottom');
        if (!G.demo && G.phase !== 'goal') {
          if (G.lastToucher && G.lastToucher !== side) { G.rally++; }
          else if (!G.lastToucher) G.rally = Math.max(G.rally, 1);
          G.lastToucher = side; G.lastHit = { side, speed: e.speed };
          const st = G.stats[side]; st.hits++;
          G.stats.topSpeed = Math.max(G.stats.topSpeed, sp);
          if (G.lastShot && G.lastShot.by !== side && G.lastShot.onTarget) st.saves++;
          G.lastShot = null;
          const toward = side === 'bottom' ? p.vy < -280 : p.vy > 280;
          if (toward) {
            const pr = PH.predictX(p.x, p.y, p.vx, p.vy, side === 'bottom' ? 0 : H);
            const on = !!pr && pr.x > GX0 + 4 && pr.x < GX1 - 4;
            st.shots++; if (on) st.onTarget++; G.lastShot = { by: side, onTarget: on };
          }
          A.hit(e.speed / 1300, G.rally, w.heat);
          if (sp > 1100 && G.now - G.lastMph > 0.5) { G.lastMph = G.now; popup(p.x, p.y - 26, Math.round(sp * 0.08) + ' MPH', sp > 1500 ? '#ffb070' : '#ffe9a8', 15 + clamp((sp - 1100) / 60, 0, 9)); }
          // rally heat callouts (the puck warms up as a rally goes on, and speeds up)
          const stage = w.heat >= 0.99 ? 2 : w.heat > 0 ? 1 : 0;
          if (stage > G.heatStage) {
            G.heatStage = stage;
            if (stage === 1) popup(W / 2, H / 2 - 30, 'HEATING UP!', '#ffb070', 20); else { popup(W / 2, H / 2 - 30, 'RED HOT!', '#ff6a3d', 26); G.shake = Math.max(G.shake, 4); say('hot'); }
            A.sizzle(stage);
          } else if (G.rally >= 6 && G.rally % 4 === 2) popup(W / 2, H / 2 + 24, 'RALLY x' + G.rally, '#ffffff', 14 + Math.min(10, G.rally / 2));
        }
        G.banks = 0; G.bankL = G.bankR = 0;
        // impact feel scales with how hard it was hit
        const k = clamp((e.speed - 250) / 1100, 0, 1);
        G.puckSq = 0.15 + 0.35 * k; G.puckSqA = Math.atan2(e.ny, e.nx); G.puckFlash = Math.max(G.puckFlash, k);
        m.glow = Math.max(m.glow || 0, k);
        if (e.speed > 300) spray(e.x, e.y, e.nx, e.ny, e.speed);
        if (e.speed > 700) spawn({ k: 'flash', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.16 + 0.1 * k, t: 0, r: 16 + 26 * k });
        if (e.speed > 850) { G.shake = Math.max(G.shake, 1.5 + 3 * k); G.hitPause = Math.max(G.hitPause, 0.015 + 0.04 * k); }
        if (human) buzz(e.speed > 900 ? 22 : e.speed > 450 ? 14 : 8);
      } else if (e.t === 'wall') {
        if (!G.demo) A.wall(e.speed / 1100);
        if ((e.x < 2 || e.x > W - 2) && e.y > R && e.y < H - R && e.speed > 160) { // a real side-wall bank since the last mallet hit
          const left = e.x < W / 2;
          if (G.lastBankSide !== (left ? 'L' : 'R') || !G.banks) G.banks++;
          G.lastBankSide = left ? 'L' : 'R'; if (left) G.bankL = 1; else G.bankR = 1;
        }
        if (e.speed > 280) { const dx = W / 2 - e.x, dy = H / 2 - e.y, l = Math.hypot(dx, dy) || 1; spray(e.x, e.y, dx / l, dy / l, e.speed, 4 + Math.min(6, e.speed / 200)); }
        if (e.speed > 900) G.shake = Math.max(G.shake, 1.8);
      } else if (e.t === 'goal') {
        if (G.phase !== 'goal') onGoal(e);
      } else if (e.t === 'nudge') {
        if (!G.demo) A.nudge(); ring(e.x, e.y, '#ffffff', 40);
      } else if (e.t === 'bumpActive') {
        ring(e.b.x, e.b.y, '#9ad2ff', 44);
      }
    }
    evs.length = 0;
  }

  function updateParticles(dt) {
    const arr = G.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i]; p.t += dt;
      if (p.t >= p.life) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
      if (p.k === 'ice') { const d = Math.exp(-3.2 * dt); p.vx *= d; p.vy *= d; }
      else if (p.k === 'conf') { p.vy += 520 * dt; p.vx *= Math.exp(-0.8 * dt); p.rot += p.vr * dt; }
      else if (p.k === 'text') { p.vy *= Math.exp(-1.5 * dt); }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  // ---------------------------------------------------------- render
  function textAt(g, txt, x, y, rot) {
    g.save(); g.translate(x, y); if (rot) g.rotate(rot); g.fillText(txt, 0, 0); g.restore();
  }
  function drawNet(g, into) {
    const top = into === 'top', y0 = top ? -GD : H, dir = top ? 1 : -1; // dir: toward the goal line
    const rp = G.ripples.filter((r) => r.into === into);
    const cols = 12, rows = 4, cwid = (GX1 - GX0) / cols;
    const disp = (x, yy) => {
      let d = 0;
      for (let i = 0; i < rp.length; i++) { const r = rp[i], dist = Math.hypot(x - r.x, (yy - (top ? 0 : H)) * 2); d += r.amp * 4.2 * Math.exp(-r.t * 2.6) * Math.sin(dist * 0.12 - r.t * 20); }
      return d;
    };
    g.save(); g.beginPath(); g.rect(GX0, y0, GX1 - GX0, GD); g.clip();
    g.strokeStyle = 'rgba(210,235,255,.5)'; g.lineWidth = 0.9;
    for (let c = 0; c <= cols; c++) { g.beginPath(); for (let r = 0; r <= rows; r++) { const x = GX0 + c * cwid, y = y0 + (GD / rows) * r; g.lineTo(x + disp(x, y) * 0.5, y + disp(x, y)); } g.stroke(); }
    for (let r = 0; r <= rows; r++) { g.beginPath(); for (let c = 0; c <= cols; c++) { const x = GX0 + c * cwid, y = y0 + (GD / rows) * r; g.lineTo(x + disp(x, y) * 0.5, y + disp(x, y)); } g.stroke(); }
    if (G.flash > 0 && G.goalInfo && G.goalInfo.into === into) { g.fillStyle = 'rgba(255,220,140,' + (G.flash * 0.55).toFixed(2) + ')'; g.fillRect(GX0, y0, GX1 - GX0, GD); }
    g.restore();
    // posts
    [GX0, GX1].forEach((px) => {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(px + 1.2, 1.8 + (top ? 0 : H), 5.2, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(px, top ? 0 : H, 5, 0, TAU); g.fill();
      g.fillStyle = '#e0443b'; g.beginPath(); g.arc(px, top ? 0 : H, 3.2, 0, TAU); g.fill();
    });
  }

  function drawBump(g, b) {
    const warn = !b.active, k = Math.min(1, b.age / 0.7);
    g.save(); g.translate(b.x, b.y); g.rotate(b.rot);
    if (b.active) {
      const pulse = Math.min(1, (b.age - C.BUMP_WARN) / 0.5);
      g.globalAlpha = 0.55 + 0.45 * pulse;
      g.drawImage(SP.lump, -C.BUMP_R * 1.35, -C.BUMP_R * 1.35, C.BUMP_R * 2.7, C.BUMP_R * 2.7);
      g.globalAlpha = 1;
    } else {
      const pul = 0.5 + 0.5 * Math.sin(G.now * 7);
      g.strokeStyle = 'rgba(255,255,255,' + (0.4 + 0.4 * pul).toFixed(2) + ')'; g.lineWidth = 2; g.setLineDash([5, 5]);
      g.beginPath(); g.arc(0, 0, C.BUMP_R * 1.25, 0, TAU); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(200,235,255,' + (0.12 + 0.18 * pul).toFixed(2) + ')'; g.beginPath(); g.arc(0, 0, C.BUMP_R * 1.25, 0, TAU); g.fill();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    b.cracks.forEach((pl) => {
      const n = Math.max(1, Math.floor((pl.length - 1) * k + 0.999));
      const draw = () => { g.beginPath(); g.moveTo(0, 0); for (let i = 1; i <= n && i < pl.length; i++) g.lineTo(pl[i][0], pl[i][1]); g.stroke(); };
      g.strokeStyle = warn ? 'rgba(40,90,150,.8)' : 'rgba(70,120,180,.38)'; g.lineWidth = warn ? 2.6 : 2; draw();
      g.strokeStyle = warn ? 'rgba(255,255,255,.95)' : 'rgba(235,248,255,.55)'; g.lineWidth = 1.1; draw();
    });
    g.restore();
  }

  function drawMallet(g, m, sprite) {
    const sq = clamp(m.sq, -0.3, 0.4);
    g.save(); g.translate(m.x, m.y);
    g.drawImage(SP.shadow, -RM * 1.45 + 3, -RM * 1.45 + 6, RM * 2.9, RM * 2.9);
    if (m.glow > 0.05) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = m.glow * 0.8; const gs = RM * 2.4; g.drawImage(SP.glow[m.side === 'bottom' ? '#ff7a59' : '#5de0d0'], -gs, -gs, gs * 2, gs * 2); g.restore(); }
    g.rotate(m.sqa); g.scale(1 - sq, 1 + sq * 0.55); g.rotate(-m.sqa);
    g.drawImage(sprite, -RM, -RM, RM * 2, RM * 2);
    g.restore();
  }

  function drawHUDLabels(g) {
    const top = { name: G.twop ? 'PLAYER 2' : (G.ai[0] ? G.ai[0].lvl.who.toUpperCase() : ''), sc: G.scores.top };
    const bot = { name: G.twop ? 'PLAYER 1' : 'YOU', sc: G.scores.bottom };
    g.textBaseline = 'middle';
    const label = (o, y, rot, isBottom) => {
      g.save(); g.translate(W / 2, y); if (rot) g.rotate(Math.PI);
      g.font = '900 15px Nunito, system-ui, sans-serif';
      const nameRight = G.twop; // keep the name away from that player's pause button
      g.textAlign = nameRight ? 'right' : 'left'; g.fillStyle = isBottom ? '#ffd2bd' : '#c8fbf4'; g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = 'rgba(6,18,46,.9)';
      let txt = o.name, sc = 1; const mw = g.measureText(txt).width; if (mw > 96) sc = 96 / mw;
      g.save(); g.translate(nameRight ? W / 2 - 2 : -W / 2 + 2, 0); g.scale(sc, sc); g.strokeText(txt, 0, 0); g.fillText(txt, 0, 0); g.restore();
      // pips, centred
      for (let i = 0; i < WIN; i++) {
        const px = (i - (WIN - 1) / 2) * 15 + (nameRight ? -18 : 18), lit = i < o.sc;
        const pop = G.pipPop.find((q) => q.side === (isBottom ? 'bottom' : 'top') && q.i === i);
        let pr = 5.6;
        if (pop) { // the new point pops onto the scoreboard
          const f = pop.t / 0.9; pr = 5.6 * (pop.t < 0.35 ? 0.3 + 1.7 * easeOutBack(pop.t / 0.35) : 2 - Math.min(1, (pop.t - 0.35) / 0.3));
          g.strokeStyle = isBottom ? 'rgba(255,150,100,' + (1 - f).toFixed(2) + ')' : 'rgba(110,235,220,' + (1 - f).toFixed(2) + ')'; g.lineWidth = 2;
          g.beginPath(); g.arc(px, 0, 5 + f * 16, 0, TAU); g.stroke();
        }
        g.beginPath(); g.arc(px, 0, pr, 0, TAU);
        const cc = !isBottom && !G.twop && G.ai[0] ? ['#8fe05a', '#b08cff', '#d6e6ff'][G.ai[0].idx] : '#5de0d0';
        if (lit) { g.fillStyle = isBottom ? '#ff8a5c' : cc; g.shadowColor = isBottom ? '#ff6a3d' : cc; g.shadowBlur = 8; g.fill(); g.shadowBlur = 0; }
        else { g.fillStyle = 'rgba(160,200,240,.2)'; g.fill(); g.strokeStyle = 'rgba(190,225,255,.45)'; g.lineWidth = 1; g.stroke(); }
      }
      g.restore();
    };
    const rowY = GD + BANK + 15;
    label(top, -rowY, G.twop, false);
    label(bot, H + rowY, false, true);
    if (!G.twop && !G.demo && G.mode !== 'menu') {
      g.font = '900 11px Nunito, sans-serif'; g.textAlign = 'right'; g.fillStyle = 'rgba(255,200,120,.95)';
      const st = save.streak[G.level];
      if (st > 0) g.fillText('🔥' + st, W - 2, H + rowY);
    }
  }
  const mcache = {};
  function measure(g, t) { const k = g.font + t; return mcache[k] || (mcache[k] = g.measureText(t).width); }

  function render(nowMs) {
    const g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#070d1f'; g.fillRect(0, 0, cw, ch);
    // goal punch-in: the whole scene zooms a touch toward the net, then eases back (HUD stays put)
    const z = G.zoom > 0 ? 1 + 0.06 * Math.sin(Math.min(1, (1 - G.zoom) * 3) * Math.PI / 2) * G.zoom : 1;
    const zcx = OX + G.zoomX * S, zcy = OY + G.zoomY * S, zx = zcx * (1 - z), zy = zcy * (1 - z);
    g.setTransform(dpr * z, 0, 0, dpr * z, (zx + G.shx * 0.5 * z) * dpr, (zy + G.shy * 0.5 * z) * dpr);
    g.drawImage(bg, 0, 0, cw, ch);
    drawAmbient(g, nowMs / 1000);
    g.setTransform(dpr * S * z, 0, 0, dpr * S * z, (zx + (OX + G.shx) * z) * dpr, (zy + (OY + G.shy) * z) * dpr);
    const w = G.w; if (!w) return;
    const t = nowMs / 1000;
    // string lights
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < bulbs.length; i++) { const b = bulbs[i], a = 0.7 + 0.3 * Math.sin(t * 2.2 + b.ph); g.globalAlpha = a; g.drawImage(SP.glow[b.c], b.x - 17, b.y - 17, 34, 34); }
    g.restore();
    for (let i = 0; i < bulbs.length; i++) { const b = bulbs[i]; g.fillStyle = b.c; g.beginPath(); g.arc(b.x, b.y, 2.6, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(b.x - 0.7, b.y - 0.8, 1, 0, TAU); g.fill(); }

    if (scuff) g.drawImage(scuff, 0, 0, W, H);
    // bumps
    for (let i = 0; i < w.bumps.length; i++) drawBump(g, w.bumps[i]);
    drawNet(g, 'top'); drawNet(g, 'bottom');
    // score numerals on the ice
    g.save(); g.font = '400 120px "Titan One", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(40,100,180,.13)';
    textAt(g, String(G.scores.bottom), W / 2, H / 2 + 118, 0); textAt(g, String(G.scores.top), W / 2, H / 2 - 118, G.twop ? Math.PI : 0);
    g.restore();
    // serve hint ring
    const p = w.puck;
    if (G.phase === 'serve') {
      g.strokeStyle = 'rgba(52,112,200,.55)'; g.lineWidth = 2; g.setLineDash([4, 5]); g.beginPath(); g.arc(p.x, p.y, 24, 0, TAU); g.stroke(); g.setLineDash([]);
    }
    // trail
    const tr = G.trail, sp = Math.hypot(p.vx, p.vy), heat = w.heat || 0;
    if (tr.length > 2 && sp > 80) {
      g.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        const f = i / tr.length;
        g.strokeStyle = heat > 0 ? 'rgba(' + Math.round(lerp(30, 255, heat)) + ',' + Math.round(lerp(80, 110, heat)) + ',' + Math.round(lerp(160, 40, heat)) + ',' + (f * f * Math.min(0.6, sp / 1300)).toFixed(3) + ')' : 'rgba(30,80,160,' + (f * f * Math.min(0.5, sp / 1400)).toFixed(3) + ')';
        g.lineWidth = RP * 1.7 * f;
        g.beginPath(); g.moveTo(tr[i - 1].x, tr[i - 1].y); g.lineTo(tr[i].x, tr[i].y); g.stroke();
      }
    }
    // mallets + puck
    const drop = G.phase === 'serve' ? Math.max(0, G.dropT / 0.5) : 0;
    g.drawImage(SP.shadow, p.x - RP * 1.5 + 2 + drop * 6, p.y - RP * 1.5 + 4 + drop * 10, RP * 3, RP * 3);
    drawMallet(g, w.mallets[1], !G.demo && !G.twop && G.ai[0] ? SP.cpu[G.ai[0].idx] : SP.teal);
    drawMallet(g, w.mallets[0], G.demo ? SP.red : (SP.skin[save.skin] || SP.red));
    const ps = 1 + drop * 0.9, pAlpha = G.phase === 'serve' ? 1 - drop * 0.6 : 1;
    if (heat > 0 && p.live) { // rally heat glow under the puck
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 + 0.5 * heat + 0.15 * Math.sin(t * 18) * heat;
      const gs = RP * (3 + 2.2 * heat); g.drawImage(SP.glow[heat > 0.6 ? '#ff7a59' : '#ffc857'], p.x - gs, p.y - gs, gs * 2, gs * 2); g.restore();
    }
    g.save(); g.translate(p.x, p.y - drop * 10);
    const sq = G.puckSq; // squash along the hit direction, stretch across it, springs back
    if (sq > 0.01) { g.rotate(G.puckSqA); g.scale(1 - sq * 0.5, 1 + sq * 0.35); g.rotate(-G.puckSqA); }
    g.globalAlpha = pAlpha; g.drawImage(SP.puck, -RP * ps * 1.12, -RP * ps * 1.12, RP * 2.24 * ps, RP * 2.24 * ps);
    if (heat > 0.05 && p.live) { g.globalAlpha = heat * 0.55; g.fillStyle = '#ff6a3d'; g.beginPath(); g.arc(0, 0, RP * 0.62, 0, TAU); g.fill(); }
    if (G.puckFlash > 0) { g.globalAlpha = G.puckFlash * 0.8; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, RP * 1.02, 0, TAU); g.fill(); }
    g.restore(); g.globalAlpha = 1;
    // particles
    for (let i = 0; i < G.particles.length; i++) {
      const q = G.particles[i], f = q.t / q.life;
      if (q.k === 'ice') { g.globalAlpha = 1 - f; g.fillStyle = q.c; g.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s); }
      else if (q.k === 'conf') { g.globalAlpha = Math.min(1, (1 - f) * 2); g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.fillStyle = q.c; g.fillRect(-q.s, -q.s / 2, q.s * 2, q.s); g.restore(); }
      else if (q.k === 'flash') { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - f; const r = q.r * (0.6 + 0.6 * f); g.drawImage(SP.glow['#fff2c4'], q.x - r, q.y - r, r * 2, r * 2); g.restore(); }
      else if (q.k === 'ring') { g.globalAlpha = (1 - f) * 0.8; g.strokeStyle = q.col; g.lineWidth = 3 * (1 - f) + 0.5; g.beginPath(); g.arc(q.x, q.y, 6 + (q.r1 - 6) * (1 - Math.pow(1 - f, 3)), 0, TAU); g.stroke(); }
      else if (q.k === 'text') {
        g.globalAlpha = f < 0.7 ? 1 : (1 - f) / 0.3; const sc = f < 0.15 ? 0.6 + 0.4 * easeOutBack(f / 0.15) : 1;
        g.font = '900 ' + (q.size * sc).toFixed(1) + 'px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 4; g.strokeStyle = 'rgba(10,40,90,.85)'; g.lineJoin = 'round'; g.strokeText(q.text, q.x, q.y); g.fillStyle = q.col; g.fillText(q.text, q.x, q.y);
      }
    }
    g.globalAlpha = 1;
    if (G.flash > 0 && !G.demo) { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(' + G.flashCol + ',' + (G.flash * G.flash * 0.28).toFixed(3) + ')'; g.fillRect(-OX / S - 40, -OY / S - 40, cw / S + 80, ch / S + 80); g.restore(); }
    if (z !== 1) g.setTransform(dpr * S, 0, 0, dpr * S, (OX + G.shx) * dpr, (OY + G.shy) * dpr);
    if (G.phase === 'replay' && G.replay) drawReplay(g, t);
    if (!G.demo && G.phase !== 'replay') drawHUDLabels(g);
    // banner
    if (G.banner) drawBanner(g);
    if (G.toast) { const a = Math.min(1, G.toast.t * 4, (2.6 - G.toast.t) * 3); g.globalAlpha = Math.max(0, a); g.font = '900 15px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(8,22,50,.8)'; const tw = measure(g, G.toast.text) + 28; rrPath(g, W / 2 - tw / 2, H / 2 - 150, W / 2 + tw / 2, H / 2 - 124, 13); g.fill(); g.fillStyle = '#e6f4ff'; g.fillText(G.toast.text, W / 2, H / 2 - 137); g.globalAlpha = 1; }
    if (G.say && G.say.t > 0 && G.mode === 'play' && G.phase !== 'replay' && !G.banner) drawSay(g);
    if (G.trophyQ.length && G.trophyQ[0].age > 0) drawTrophyToast(g, G.trophyQ[0]);
    if (G.mode === 'play' && !G.demo && !G.twop && !save.tutDone && G.phase !== 'replay') drawGhost(g, t);
    if (G.mode === 'play' && G.twop && G.matchTime < 4 && !G.banner) drawTwoPHint(g);
  }

  function drawReplay(g, t) {
    const r = G.replay, inK = Math.min(1, r.age / 0.25), sT = insets.t / S, sB = insets.b / S, bar = 62;
    const x0 = -OX / S - 4, x1 = (cw - OX) / S + 4, y0 = -OY / S - 4, y1 = (ch - OY) / S + 4;
    const barT = (bar + sT) * inK, barB = (bar + sB) * inK;
    g.save();
    g.fillStyle = 'rgba(4,8,20,.42)'; g.fillRect(x0, y0, x1 - x0, y1 - y0); // dim everything, then the letterbox
    g.fillStyle = 'rgba(2,5,14,.94)'; g.fillRect(x0, y0, x1 - x0, barT); g.fillRect(x0, y1 - barB, x1 - x0, barB);
    g.globalAlpha = inK; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const rot = G.twop;
    const label = (y, flip) => {
      g.save(); g.translate(W / 2, y); if (flip) g.rotate(Math.PI);
      g.textAlign = 'center'; g.font = '400 22px "Titan One", system-ui, sans-serif'; g.fillStyle = '#ffffff';
      g.fillText('REPLAY', 0, -10);
      g.fillStyle = Math.sin(t * 8) > 0 ? '#ff4d4d' : 'rgba(255,77,77,.25)'; g.beginPath(); g.arc(-62, -10, 6, 0, TAU); g.fill();
      g.font = '900 13px Nunito, sans-serif'; g.fillStyle = '#ffd36b'; g.fillText(r.cap, 0, 12, 230);
      g.restore();
    };
    label(y0 + sT + bar * 0.5 + 4, rot); if (rot) label(y1 - sB - bar * 0.5 - 4, false);
    if (!rot) { g.font = '800 12px Nunito, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(200,225,255,.75)'; g.fillText('tap to skip', W / 2, y1 - sB - bar * 0.5); }
    g.restore();
  }
  const FLAKES = []; for (let i = 0; i < 46; i++) FLAKES.push({ x: Math.random(), y: Math.random(), s: 1.2 + Math.random() * 2, v: 9 + Math.random() * 16, w: Math.random() * 6.28, a: 0.25 + Math.random() * 0.45 });
  function drawAmbient(g, t) {
    // aurora ribbons that slowly breathe on the night sky at the far edges (outside the rink)
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) {
      const x = k ? cw : 0, ph = t * 0.25 + k * 2.1, a = 0.08 + 0.05 * Math.sin(ph);
      const q = g.createRadialGradient(x, ch * (0.35 + 0.2 * Math.sin(ph * 0.7)), 0, x, ch * 0.4, ch * 0.45);
      q.addColorStop(0, k ? 'rgba(150,110,255,' + a.toFixed(3) + ')' : 'rgba(70,230,190,' + a.toFixed(3) + ')'); q.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = q; g.fillRect(0, 0, cw, ch);
    }
    g.restore();
    if (G.calm) return;
    // light snow (falls the same at any frame rate; uses wall time)
    g.fillStyle = '#ffffff';
    for (let i = 0; i < FLAKES.length; i++) {
      const f = FLAKES[i], y = ((f.y * ch + t * f.v * 1.6) % (ch + 10)) - 5, x = (f.x * cw + Math.sin(t * 0.6 + f.w) * 12 + cw) % cw;
      g.globalAlpha = f.a; g.fillRect(x, y, f.s, f.s);
    }
    g.globalAlpha = 1;
  }
  function drawBanner(g) {
    const b = G.banner, t = b.t;
    const sc = t < 0.4 ? easeOutBack(t / 0.4) : 1, fade = t > 1.5 ? Math.max(0, 1 - (t - 1.5) / 0.3) : 1;
    const draw = (cy, rot, sub) => {
      g.save(); g.translate(W / 2, cy); if (rot) g.rotate(Math.PI); g.scale(sc, sc); g.globalAlpha = fade;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.font = '400 82px "Titan One", system-ui, sans-serif';
      g.lineWidth = 12; g.strokeStyle = '#0a2a5c'; g.strokeText(b.text, 0, 3);
      const gr = g.createLinearGradient(0, -34, 0, 34); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, b.scorer === 'bottom' ? '#ffb48c' : '#9ff7ec');
      g.fillStyle = gr; g.fillText(b.text, 0, 3);
      sub = sub || b.sub;
      g.font = '900 16px Nunito, sans-serif'; g.lineWidth = 5; g.strokeStyle = '#0a2a5c'; g.strokeText(sub, 0, 52); g.fillStyle = '#fff'; g.fillText(sub, 0, 52);
      if (b.mp && t > 0.5) { const k = Math.min(1, (t - 0.5) / 0.25); g.save(); g.translate(0, -58); g.scale(0.6 + 0.4 * easeOutBack(k), 0.6 + 0.4 * easeOutBack(k)); g.globalAlpha = fade * k; g.font = '400 20px "Titan One", system-ui, sans-serif'; g.lineWidth = 6; g.strokeStyle = '#3a0a0a'; g.strokeText('MATCH POINT', 0, 0); g.fillStyle = '#ff6a5c'; g.fillText('MATCH POINT', 0, 0); g.restore(); }
      if (b.call) { g.font = '900 ' + (G.twop ? 15 : 18) + 'px Nunito, sans-serif'; g.lineWidth = 5; g.strokeText(b.joke, 0, 76); g.fillStyle = '#ffd36b'; g.fillText(b.joke, 0, 76); }
      else if (!G.twop) { g.font = '800 13px Nunito, sans-serif'; g.lineWidth = 4; g.strokeText(b.joke, 0, 74); g.fillStyle = '#cfe8ff'; g.fillText(b.joke, 0, 74); }
      g.restore();
    };
    if (G.twop) {
      draw(H / 2 + 100, false, b.scorer === 'bottom' ? 'YOU SCORE!' : 'PLAYER 2 SCORES');
      draw(H / 2 - 100, true, b.scorer === 'top' ? 'YOU SCORE!' : 'PLAYER 1 SCORES');
    } else draw(H / 2 - 24, false);
  }
  function drawSay(g) {
    const q = G.say, m = G.w.mallets[1], a = Math.min(1, q.t * 6, (2.2 - q.t) * 4);
    g.save(); g.globalAlpha = Math.max(0, a) * 0.95; g.font = '900 13px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = measure(g, q.text) + 22, bx = clamp(m.x, tw / 2 + 4, W - tw / 2 - 4), by = clamp(m.y + RM + 24, 40, H / 2 - 40), pop = q.t < 0.18 ? 0.7 + 0.3 * easeOutBack(q.t / 0.18) : 1;
    g.translate(bx, by); g.scale(pop, pop);
    g.fillStyle = 'rgba(255,255,255,.96)'; rrPath(g, -tw / 2, -13, tw / 2, 13, 12); g.fill();
    const tx = clamp(m.x - bx, -tw / 2 + 14, tw / 2 - 14); g.beginPath(); g.moveTo(tx - 7, -12); g.lineTo(tx, -22); g.lineTo(tx + 7, -12); g.closePath(); g.fill();
    g.fillStyle = '#0b2a55'; g.fillText(q.text, 0, 1);
    g.restore();
  }
  function drawTrophyToast(g, q) {
    const a = q.age, inT = Math.min(1, a / 0.35), out = a > 2.4 ? Math.max(0, 1 - (a - 2.4) / 0.4) : 1;
    const y = H * 0.27 - 30 * (1 - easeOutBack(inT));
    g.save(); g.globalAlpha = Math.min(inT * 2, 1) * out; g.translate(W / 2, y);
    const w2 = 118, h2 = 25;
    g.fillStyle = 'rgba(10,26,58,.92)'; rrPath(g, -w2, -h2, w2, h2, 16); g.fill();
    g.strokeStyle = '#ffd36b'; g.lineWidth = 2; g.stroke();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '22px system-ui, sans-serif'; g.fillText(q.t.icon, -w2 + 12, 1);
    g.font = '900 10px Nunito, sans-serif'; g.fillStyle = '#ffd36b'; g.fillText(q.label || 'TROPHY UNLOCKED', -w2 + 46, -9);
    g.font = '900 16px Nunito, sans-serif'; g.fillStyle = '#ffffff'; g.fillText(q.t.name, -w2 + 46, 8);
    g.restore();
  }
  function drawGhost(g, t) {
    if (G.ctrlTime > 1.0 || G.phase === 'goal') return;
    const k = (Math.sin(t * 1.6) + 1) / 2, x = lerp(W * 0.3, W * 0.7, k), y = H - 215 + Math.sin(t * 3.2) * 6;
    g.save(); g.globalAlpha = 0.9;
    g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(x, y + 8, 28, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x, y + 8, 12, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)'; rrPath(g, x - 6, y + 8, x + 6, y + 42, 6); g.fill();
    g.font = '900 15px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 5; g.strokeStyle = 'rgba(10,40,90,.9)'; g.lineJoin = 'round';
    g.strokeText('DRAG TO SLIDE YOUR MALLET', W / 2, H - 262); g.fillStyle = '#fff'; g.fillText('DRAG TO SLIDE YOUR MALLET', W / 2, H - 262);
    g.restore();
  }
  function drawTwoPHint(g) {
    const a = Math.max(0, 1 - G.matchTime / 4);
    g.save(); g.globalAlpha = a; g.font = '900 14px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(30,80,150,.8)';
    textAt(g, 'DRAG IN YOUR HALF', W / 2, H / 2 + 36, 0); textAt(g, 'DRAG IN YOUR HALF', W / 2, H / 2 - 36, Math.PI); g.restore();
  }

  // ---------------------------------------------------------- input
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - OX) / S, y: (e.clientY - r.top - OY) / S };
  }
  function setTarget(side, pt, touch) {
    const m = PH.malletBy(G.w, side), off = touch ? HUMAN.off : 0, c = ctrl[side], now = performance.now();
    // smoothed finger velocity -> aim a hair ahead of the finger so the mallet feels glued to it
    let lx = 0, ly = 0;
    if (c.lx != null && now - c.lt < 80) {
      const dt = Math.max(4, now - c.lt) / 1000, vx = (pt.x - c.lx) / dt, vy = (pt.y - c.ly) / dt;
      c.vx = lerp(c.vx || 0, vx, 0.5); c.vy = lerp(c.vy || 0, vy, 0.5);
      lx = c.vx * HUMAN.lead; ly = c.vy * HUMAN.lead; const ll = Math.hypot(lx, ly);
      if (ll > HUMAN.leadMax) { lx *= HUMAN.leadMax / ll; ly *= HUMAN.leadMax / ll; }
    } else { c.vx = c.vy = 0; }
    c.lx = pt.x; c.ly = pt.y; c.lt = now;
    m.tx = pt.x + lx; m.ty = pt.y + ly + (side === 'bottom' ? -off : off);
    if (!save.tutDone && G.ctrlTime > 1.0) { save.tutDone = true; persist(); }
  }
  function activeInput() { return G.mode === 'play' && G.w; }
  stage.addEventListener('pointerdown', (e) => {
    A.unlock(); tapped = true;
    if (e.target.closest && e.target.closest('.ui')) return;
    if (!activeInput()) return;
    e.preventDefault();
    if (G.phase === 'replay' && G.replay && G.replay.age > 0.4) G.replay.skip = true;
    const pt = toWorld(e), side = G.twop ? (pt.y < H / 2 ? 'top' : 'bottom') : 'bottom';
    const c = ctrl[side];
    if (c.pid != null && c.pid !== e.pointerId && performance.now() - (c.t || 0) < 5000) return; // that half already has a finger: a stray thumb/palm never steals the mallet
    c.pid = e.pointerId; c.touch = e.pointerType !== 'mouse'; c.t = performance.now();
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    setTarget(side, pt, c.touch);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!activeInput()) return;
    const pt = toWorld(e);
    let used = false;
    for (const side of ['bottom', 'top']) if (ctrl[side].pid === e.pointerId) { setTarget(side, pt, ctrl[side].touch); ctrl[side].t = performance.now(); used = true; }
    if (!used && e.pointerType !== 'mouse' && !(e.target.closest && e.target.closest('.ui'))) { // adopt a finger whose pointerdown we lost (pause, cancel, system gesture)
      const side = G.twop ? (pt.y < H / 2 ? 'top' : 'bottom') : 'bottom';
      if (ctrl[side].pid == null && (e.buttons & 1 || e.pointerType === 'touch')) { ctrl[side].pid = e.pointerId; ctrl[side].touch = true; ctrl[side].t = performance.now(); setTarget(side, pt, true); used = true; }
    }
    if (!used && e.pointerType === 'mouse' && !(e.target.closest && e.target.closest('.ui'))) {
      const side = G.twop ? (pt.y < H / 2 ? 'top' : 'bottom') : 'bottom';
      if (ctrl[side].pid == null) setTarget(side, pt, false);
    }
  });
  function release(e) { for (const side of ['bottom', 'top']) if (ctrl[side].pid === e.pointerId) { ctrl[side].pid = null; ctrl[side].lx = null; } }
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release); stage.addEventListener('lostpointercapture', release);
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  const KEYS = { ArrowLeft: ['kb', 'l'], ArrowRight: ['kb', 'r'], ArrowUp: ['kb', 'u'], ArrowDown: ['kb', 'd'], a: ['kb2', 'l'], d: ['kb2', 'r'], w: ['kb2', 'u'], s: ['kb2', 'd'] };
  G.kb2 = { l: 0, r: 0, u: 0, d: 0 };
  window.addEventListener('keydown', (e) => {
    A.unlock(); tapped = true;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (G.mode === 'play') pauseGame(); else if (G.mode === 'paused') resumeGame(); return; }
    if (e.key === 'Enter') { if (G.mode === 'menu') { if (!$('trophies').hidden) $('btnTrBack').click(); else if (!$('dailyS').hidden) $('btnDlyGo').click(); else $('btnPlay').click(); } else if (G.mode === 'over' && !$('over').hidden) $('btnAgain').click(); else if (G.mode === 'over' && !$('over2').hidden) { $('over2').hidden = true; startMatch({ twop: true, firstServe: G.winner === 'bottom' ? 'top' : 'bottom' }); } else if (G.mode === 'paused') resumeGame(); return; }
    const k = KEYS[e.key]; if (!k) return;
    let tgt = G[k[0]];
    if (!G.twop && k[0] === 'kb2') tgt = G.kb; // WASD also drives the single player
    tgt[k[1]] = 1; e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYS[e.key]; if (!k) return; G[k[0]][k[1]] = 0; if (k[0] === 'kb2') G.kb[k[1]] = 0;
    if (G.w) { // stop where you are when the last key is released
      const stop = (side, o) => { if (!(o.l || o.r || o.u || o.d)) { const m = PH.malletBy(G.w, side); m.tx = m.x; m.ty = m.y; } };
      stop('bottom', G.kb); if (G.twop) stop('top', G.kb2);
    }
  });

  // ---------------------------------------------------------- UI wiring
  function forfeit() {
    // leaving a match you're not winning counts as a loss, so streaks can't be dodged
    if (G.demo || G.twop || G.daily || G.mode !== 'paused') return;
    if (G.scores.bottom + G.scores.top > 0 && G.scores.bottom <= G.scores.top) { save.streak[G.level] = 0; save.losses[G.level]++; persist(); }
  }
  function pauseGame() { if (G.mode !== 'play' || (window.__T && window.__T.noPause)) return; G.mode = 'paused'; $('pause').hidden = false; ctrl.bottom.pid = ctrl.top.pid = null; G.kb = { l: 0, r: 0, u: 0, d: 0 }; A.suspend(); syncToggles(); }
  function resumeGame() { if (G.mode !== 'paused') return; G.mode = 'play'; $('pause').hidden = true; A.resume(); }
  function toMenu() {
    $('pause').hidden = true; $('over').hidden = true; $('over2').hidden = true; $('trophies').hidden = true; $('dailyS').hidden = true; $('title').hidden = false; $('pauseB').hidden = true; $('pauseT').hidden = true;
    A.resume(); document.body.classList.remove('twop'); G.twop = false; G.level = save.level | 0;
    startMatch({ demo: true }); renderTitle();
  }
  function playMatch(twop, daily) {
    A.unlock(); A.click();
    $('title').hidden = true; $('over').hidden = true; $('over2').hidden = true; $('pause').hidden = true; $('trophies').hidden = true; $('dailyS').hidden = true;
    if (twop) G.series = { bottom: 0, top: 0 };
    document.body.classList.toggle('twop', twop);
    $('pauseB').hidden = false; $('pauseT').hidden = !twop;
    G.twop = twop;
    startMatch({ twop, level: save.level | 0, daily: !!daily }); // a daily sets its own opponent; your pick is restored on the menu
  }
  function renderTitle() {
    const chips = $('chips'); chips.innerHTML = '';
    PH.LEVELS.forEach((lv, i) => {
      const b = document.createElement('button'); b.className = 'chip' + (G.level === i ? ' sel' : '');
      const st = save.streak[i];
      b.innerHTML = '<b>' + lv.name + '</b><i>' + (save.best[i] ? 'best streak ' + save.best[i] : lv.short) + '</i><em>' + (st ? '🔥 ' + st : '') + '</em>';
      b.onclick = () => { A.unlock(); A.click(); G.level = i; save.level = i; persist(); renderTitle(); };
      chips.appendChild(b);
    });
    const lv = PH.LEVELS[G.level]; $('oppBlurb').innerHTML = '<b>' + lv.who + '</b> · ' + lv.blurb;
    renderTrophies();
    const d = todaysDaily(), done = save.dly.last === d.key, st = dailyStreakNow();
    $('btnDaily').innerHTML = (done ? '✓' : '✦') + ' DAILY <small>' + (st ? '🔥' + st : done ? 'done' : 'new!') + '</small>';
    $('btnDaily').classList.toggle('fresh', !done);
  }
  function renderDaily() {
    const d = todaysDaily(), lv = PH.LEVELS[d.level], done = save.dly.last === d.key, st = dailyStreakNow();
    $('dlyDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    $('dlyBody').innerHTML = '<div><span>Opponent</span><b>' + lv.who + '</b><i>' + lv.name + '</i></div>' +
      '<div><span>Ice</span><b>' + d.twist.name + '</b><i>' + d.twist.desc + '</i></div>' +
      '<div class="goal"><span>Goal</span><b>' + d.goal.text + '</b></div>';
    const bt = save.dly.bestT && save.dly.bestT.key === d.key ? save.dly.bestT.t : 0;
    $('dlyStreak').textContent = done ? '✓ Done · streak ' + st + (st === 1 ? ' day' : ' days') + (bt ? ' · best ' + Math.floor(bt / 60) + ':' + String(bt % 60).padStart(2, '0') + ' — beat it' : '') : st ? '🔥 Streak ' + st + ' — keep it alive today' : 'New challenge every day';
    $('btnDlyGo').textContent = done ? 'PLAY AGAIN' : 'PLAY DAILY';
  }
  function renderTrophies() {
    $('trCount').textContent = trophyCount() + '/' + TROPHIES.length;
    const sk = $('skList'); sk.innerHTML = '';
    SKINS.forEach((k) => {
      const ok = k.ok(), b = document.createElement('button');
      b.className = 'sk' + (ok ? '' : ' lock') + (save.skin === k.id ? ' sel' : '');
      const img = document.createElement('img'); img.alt = ''; img.src = SP.skin[k.id].toDataURL(); b.appendChild(img);
      const lab = document.createElement('span'); lab.textContent = ok ? k.name : '🔒'; b.appendChild(lab);
      b.onclick = () => {
        A.unlock(); A.click();
        if (ok) { save.skin = k.id; persist(); $('skHint').textContent = k.name + ' — equipped'; renderTrophies(); }
        else $('skHint').textContent = '🔒 ' + k.name + ': ' + k.how;
      };
      sk.appendChild(b);
    });
    $('trList').innerHTML = TROPHIES.map((t) => '<div class="tr' + (save.trophies[t.id] ? ' got' : '') + '"><div class="ic">' + t.icon + '</div><div><b>' + t.name + '</b><span>' + t.how + '</span></div></div>').join('');
  }
  function syncToggles() {
    ['togglesTitle', 'togglesPause'].forEach((id) => {
      const box = $(id); box.innerHTML = '';
      [['sound', '🔊', '🔇', 'Sound'], ['music', '🎵', '🎵', 'Music'], ['buzz', '📳', '📴', 'Buzz'], ['choppy', '❄️', '🧊', 'Choppy']].filter((t) => t[0] !== 'buzz' || navigator.vibrate).forEach(([k, on, off, label]) => {
        const b = document.createElement('button'); b.className = 'tg' + (save[k] ? ' on' : ''); b.textContent = (save[k] ? on : off) + ' ' + label; b.setAttribute('aria-pressed', save[k] ? 'true' : 'false'); b.title = label + (save[k] ? ': on' : ': off');
        b.onclick = () => { A.unlock(); save[k] = !save[k]; if (k === 'sound') A.sound = save.sound; if (k === 'music') A.music = save.music; if (k === 'choppy' && G.w) G.w.bumpsOn = save.choppy && !G.demo; persist(); A.applyMusic(); A.click(); if (k === 'buzz' && save.buzz && navigator.vibrate) navigator.vibrate(15); syncToggles(); };
        box.appendChild(b);
      });
    });
  }
  $('btnPlay').onclick = () => playMatch(false);
  $('btnTrophies').onclick = () => { A.unlock(); A.click(); renderTrophies(); $('trophies').hidden = false; };
  $('btnTrBack').onclick = () => { A.click(); $('trophies').hidden = true; guard('title', 350); };
  $('btn2p').onclick = () => playMatch(true);
  $('btnDaily').onclick = () => { A.unlock(); A.click(); renderDaily(); $('dailyS').hidden = false; };
  $('btnDlyGo').onclick = () => playMatch(false, true);
  $('btnDlyBack').onclick = () => { A.click(); $('dailyS').hidden = true; guard('title', 350); };
  ['pauseB', 'pauseT'].forEach((id) => {
    const b = $(id); let tm = null;
    const cancel = () => { clearTimeout(tm); tm = null; b.classList.remove('holding'); };
    b.addEventListener('pointerdown', (e) => { if (!G.twop) return; e.preventDefault(); b.classList.add('holding'); clearTimeout(tm); tm = setTimeout(() => { cancel(); pauseGame(); }, 450); });
    b.addEventListener('pointerup', cancel); b.addEventListener('pointercancel', cancel); b.addEventListener('pointerleave', cancel);
    b.onclick = () => { if (!G.twop) pauseGame(); };
  });
  $('btnResume').onclick = () => { A.click(); resumeGame(); };
  $('btnRestart').onclick = () => { A.click(); forfeit(); $('pause').hidden = true; A.resume(); startMatch({ twop: G.twop, level: G.level, daily: !!G.daily }); };
  $('btnQuit').onclick = () => { A.click(); forfeit(); toMenu(); };
  $('btnAgain').onclick = () => { A.click(); $('over').hidden = true; startMatch({ twop: G.twop, level: G.level, daily: !!G.daily }); };
  $('btnNext').onclick = () => { A.click(); $('over').hidden = true; G.level = Math.min(2, G.level + 1); startMatch({ twop: false, level: G.level }); };
  $('btnMenu').onclick = () => { A.click(); toMenu(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (G.mode === 'play') pauseGame(); A.suspend(); } else if (G.mode !== 'paused') A.resume(); });
  window.addEventListener('blur', () => { if (G.mode === 'play' && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) && !manual) pauseGame(); });

  // ---------------------------------------------------------- loop
  let last = 0, manual = false;
  function frame(ms) {
    requestAnimationFrame(frame);
    if (manual) { last = ms; return; }
    let dt = (ms - last) / 1000; last = ms;
    if (!(dt > 0)) dt = 1 / 60; if (dt > 0.05) dt = 0.05;
    if (G.mode === 'menu' || G.mode === 'play' || G.mode === 'over') sim(dt);
    render(ms);
  }

  // ---------------------------------------------------------- test hooks
  function fuzz(opts) {
    opts = opts || {}; const n = opts.shots || 300, secs = opts.secs || 4;
    const w = PH.createWorld(); w.puck.live = true; w.bumpsOn = !!opts.bumps;
    if (opts.bumps) for (let i = 0; i < 4; i++) { const b = PH.addBump(w, 70 + rnd() * 200, 200 + rnd() * 280); b.active = true; }
    const ais = [PH.makeAI('top', 2), PH.makeAI('bottom', opts.botLevel != null ? opts.botLevel : 1)];
    const rep = { shots: n, rescues: 0, outside: 0, wallPenetration: 0, maxSpeed: 0, goals: 0, stuckMax: 0, mallets: 0, walls: 0, nanCount: 0, thrash: 0 };
    const outline = PH.outline;
    const inPoly = (x, y) => { let ins = false; for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i], b = outline[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
    let slow = 0;
    for (let s = 0; s < n; s++) {
      const p = w.puck; w.goal = null;
      p.x = 40 + rnd() * (W - 80); p.y = 40 + rnd() * (H - 80);
      const a = rnd() * TAU, v = 600 + rnd() * 1800; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.live = true;
      const frames = secs * 60;
      for (let f = 0; f < frames; f++) {
        if (rnd() < 0.03) { // thrash the mallets about, including into the puck and the walls
          const m = w.mallets[(rnd() * 2) | 0]; m.tx = rnd() * W; m.ty = rnd() * H; m.maxV = C.MALLET_MAX; rep.thrash++;
        }
        if (rnd() < 0.5) { ais.forEach((ai) => PH.aiUpdate(ai, w, 1 / 60)); } else if (rnd() < 0.2) { const m = w.mallets[(rnd() * 2) | 0]; m.tx = p.x + (rnd() - 0.5) * 20; m.ty = p.y + (rnd() - 0.5) * 20; }
        PH.step(w, 1 / 60 * (rnd() < 0.05 ? 3 : 1));
        const sp = Math.hypot(p.vx, p.vy); rep.maxSpeed = Math.max(rep.maxSpeed, sp);
        if (!isFinite(p.x + p.y)) rep.nanCount++;
        if (!inPoly(p.x, p.y)) rep.outside++;
        for (const e of w.ev) { if (e.t === 'rescue') rep.rescues++; else if (e.t === 'goal') rep.goals++; else if (e.t === 'mallet') rep.mallets++; else if (e.t === 'wall') rep.walls++; }
        w.ev.length = 0;
        if (w.goal) { p.x = W / 2; p.y = H / 2; p.vx = (rnd() - 0.5) * 900; p.vy = (rnd() - 0.5) * 900; w.goal = null; }
        if (sp < 25) slow += 1 / 60; else slow = 0;
        rep.stuckMax = Math.max(rep.stuckMax, slow);
      }
    }
    return rep;
  }
  function botMatch(lvTop, lvBot, maxSecs) {
    const w = PH.createWorld(); w.puck.live = true; w.bumpsOn = false;
    const ai = [PH.makeAI('top', lvTop), PH.makeAI('bottom', lvBot)];
    const sc = { top: 0, bottom: 0 }; let t = 0;
    const reset = (into) => { const p = w.puck; p.x = W / 2; p.y = into === 'top' ? H * 0.34 : H * 0.66; p.vx = p.vy = 0; w.goal = null; ai.forEach((a) => (a.holdUntil = a.t + 0.5)); };
    reset('bottom');
    while (sc.top < WIN && sc.bottom < WIN && t < (maxSecs || 600)) {
      ai.forEach((a) => PH.aiUpdate(a, w, 1 / 60)); PH.step(w, 1 / 60); t += 1 / 60;
      for (const e of w.ev) if (e.t === 'goal') { const s = e.into === 'top' ? 'bottom' : 'top'; sc[s]++; reset(e.into); }
      w.ev.length = 0;
    }
    return { sc, t };
  }
  window.__T = {
    PH, G, save,
    start(o) { o = o || {}; $('title').hidden = true; $('over').hidden = true; $('pause').hidden = true; $('pauseB').hidden = false; $('pauseT').hidden = !o.twop; document.body.classList.toggle('twop', !!o.twop); G.twop = !!o.twop; if (o.choppy != null) save.choppy = o.choppy; startMatch({ twop: !!o.twop, level: o.level != null ? o.level : G.level }); },
    menu: toMenu, resume: resumeGame, pause: pauseGame, noPause: false,
    step(ms) { manual = true; let left = ms / 1000; while (left > 1e-6) { const d = Math.min(left, 1 / 60); if (G.mode === 'menu' || G.mode === 'play' || G.mode === 'over') sim(d); left -= d; } render(performance.now()); },
    live() { manual = false; },
    state() { const w = G.w; if (!w) return null; const p = w.puck; return { mode: G.mode, phase: G.phase, scores: G.scores, puck: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, live: p.live }, bottom: { x: w.mallets[0].x, y: w.mallets[0].y, tx: w.mallets[0].tx, ty: w.mallets[0].ty }, top: { x: w.mallets[1].x, y: w.mallets[1].y, tx: w.mallets[1].tx, ty: w.mallets[1].ty }, bumps: w.bumps.map((b) => ({ x: b.x, y: b.y, active: b.active })), stats: G.stats, rally: G.rally, layout: { S, OX, OY, cw, ch, dpr }, ctrl: { b: ctrl.bottom.pid, t: ctrl.top.pid }, twop: G.twop, level: G.level }; },
    setTarget(side, x, y) { const m = PH.malletBy(G.w, side); m.tx = x; m.ty = y; },
    setPuck(x, y, vx, vy) { const p = G.w.puck; p.x = x; p.y = y; p.vx = vx || 0; p.vy = vy || 0; p.live = true; G.phase = 'play'; G.w.goal = null; },
    goal(into) { const p = G.w.puck; p.live = true; p.x = W / 2; p.y = into === 'top' ? 40 : H - 40; p.vx = 0; p.vy = into === 'top' ? -900 : 900; G.phase = 'play'; },
    fuzz, botMatch, layout, addBump() { addBump(); }, toWorld,
    skipGoal() { if (G.phase === 'goal') G.goalT = 99; }
  };

  // ---------------------------------------------------------- boot
  buildSprites();
  layout();
  syncToggles(); renderTitle();
  startMatch({ demo: true });
  if (document.fonts && document.fonts.load) { document.fonts.load('40px "Titan One"'); document.fonts.load('900 14px Nunito'); }
  requestAnimationFrame((ms) => { last = ms; frame(ms); });
})();
