/* Pond Hockey — WebAudio synth sfx + light music. Starts on first user gesture. */
(function () {
  'use strict';
  const PH = window.PH;
  const A = (PH.audio = {});
  let ctx = null, master = null, sfxG = null, musG = null, noiseBuf = null;
  A.sound = true; A.music = true; A.muted = false; // muted = demo / paused
  let musicTimer = null, nextNoteT = 0, step = 0;

  A.unlock = function () {
    try {
      if (!ctx) {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {} // play even with the iPhone silent switch on
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
        sfxG = ctx.createGain(); sfxG.connect(master);
        musG = ctx.createGain(); musG.gain.value = 0.5; musG.connect(master);
        try { // generated impulse: ~1.4 s soft decay, a little for sfx, more for music
          const len = (ctx.sampleRate * 1.4) | 0, ir = ctx.createBuffer(2, len, ctx.sampleRate);
          for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
          const rev = ctx.createConvolver(); rev.buffer = ir; const wet = ctx.createGain(); wet.gain.value = 0.32; rev.connect(wet); wet.connect(master);
          const sS = ctx.createGain(); sS.gain.value = 0.18; sfxG.connect(sS); sS.connect(rev);
          const mS = ctx.createGain(); mS.gain.value = 0.45; musG.connect(mS); mS.connect(rev);
        } catch (e) {}
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state !== 'running') { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); }
      A.applyMusic();
    } catch (e) {}
  };
  A.suspend = function () { try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (e) {} };
  A.resume = function () { try { if (ctx && ctx.state !== 'running') { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } } catch (e) {} };

  function ok() { return ctx && A.sound && !A.muted && ctx.state !== 'closed'; }

  function osc(type, f0, f1, t0, dur, vol, dest, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const at = attack || 0.004;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfxG); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  function noise(t0, dur, vol, type, freq, q, dest, f1) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.setValueAtTime(freq, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur); f.Q.value = q || 1;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxG); s.start(t0); s.stop(t0 + dur + 0.02);
  }

  // speed01: 0..1, combo: rally count raises pitch
  // speed01: 0..1, combo: rally count raises pitch, heat 0..1 adds a hot crack on top
  A.hit = function (speed01, combo, heat) {
    if (!ok()) return; const t = ctx.currentTime, s = Math.min(1, speed01);
    const pitch = (1 + Math.min(combo || 0, 14) * 0.035);
    const f = (210 + 520 * s) * pitch;
    osc('triangle', f, f * 0.62, t, 0.09 + 0.05 * s, 0.22 + 0.4 * s);
    osc('sine', f * 2.01, f * 1.4, t, 0.05, 0.08 + 0.1 * s);
    noise(t, 0.035, 0.12 + 0.3 * s, 'highpass', 2500, 0.7);
    if (s > 0.75) { osc('sine', 120, 45, t, 0.12, 0.25 * (s - 0.5)); noise(t, 0.06, 0.18 * s, 'lowpass', 900, 0.8); } // a real smash has thump
    if (heat > 0) noise(t + 0.01, 0.12 + 0.1 * heat, 0.05 + 0.12 * heat, 'bandpass', 5200, 2.5, sfxG, 2400);
  };
  A.sizzle = function (stage) {
    if (!ok()) return; const t = ctx.currentTime;
    noise(t, 0.45, 0.16, 'bandpass', 4200, 1.8, sfxG, 7000);
    const f = stage > 1 ? 660 : 440; osc('square', f, f * 1.5, t, 0.18, 0.05); osc('square', f * 1.5, f * 2, t + 0.09, 0.2, 0.05);
  };
  A.cheer = function (amt) { // a little backyard crowd: filtered noise swell + whistles
    if (!ok()) return; const t = ctx.currentTime, a = amt || 0.7;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16 * a, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    s.connect(f); f.connect(g); g.connect(sfxG); s.start(t); s.stop(t + 1.7);
    osc('sine', 1900, 2600, t + 0.15, 0.25, 0.04 * a); osc('sine', 2200, 1700, t + 0.45, 0.3, 0.035 * a);
  };
  A.trophy = function () {
    if (!ok()) return; const t = ctx.currentTime;
    [784, 988, 1175, 1568].forEach((f, i) => { osc('triangle', f, f, t + i * 0.07, 0.35, 0.13); osc('sine', f * 2, f * 2, t + i * 0.07, 0.25, 0.04); });
  };
  A.wall = function (speed01) {
    if (!ok()) return; const t = ctx.currentTime, s = Math.min(1, speed01);
    osc('sine', 130 + 110 * s, 70, t, 0.1, 0.18 + 0.3 * s);
    noise(t, 0.05, 0.08 + 0.2 * s, 'bandpass', 900 + 900 * s, 1.2);
  };
  A.horn = function () {
    if (!ok()) return; const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(sfxG);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.03);
    g.gain.setValueAtTime(0.22, t + 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95); g.connect(lp);
    [233, 311, 466].forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = (i - 1) * 6;
      const og = ctx.createGain(); og.gain.value = i === 2 ? 0.4 : 0.8; o.connect(og); og.connect(g); o.start(t); o.stop(t + 1);
    });
  };
  A.net = function () { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.5, 0.25, 'bandpass', 3000, 0.6, sfxG, 500); osc('sine', 90, 50, t, 0.3, 0.25); };
  A.crack = function () {
    if (!ok()) return; const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) noise(t + i * 0.045 + Math.random() * 0.02, 0.03, 0.25, 'highpass', 3500 + i * 600, 1);
    osc('sine', 85, 45, t, 0.35, 0.35);
  };
  A.whoosh = function () { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.5, 0.14, 'bandpass', 600, 1.2, sfxG, 3200); osc('sine', 300, 900, t, 0.35, 0.05); };
  A.drop = function () { if (!ok()) return; const t = ctx.currentTime; osc('sine', 170, 70, t, 0.14, 0.3); noise(t, 0.04, 0.1, 'lowpass', 1500, 1); };
  A.beep = function (f, dur, vol) { if (!ok()) return; osc('square', f || 660, f || 660, ctx.currentTime, dur || 0.12, vol || 0.08); };
  A.click = function () { if (!ok()) return; const t = ctx.currentTime; osc('triangle', 520, 780, t, 0.07, 0.14); };
  A.nudge = function () { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.25, 0.1, 'bandpass', 600, 1, sfxG, 1800); };
  A.win = function () {
    if (!ok()) return; const t = ctx.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => osc('triangle', f, f, t + i * 0.11, 0.32, 0.2));
    osc('triangle', 1568, 1568, t + 0.6, 0.7, 0.18);
  };
  A.lose = function () {
    if (!ok()) return; const t = ctx.currentTime;
    [392, 370, 349, 262].forEach((f, i) => osc('triangle', f, f * 0.97, t + i * 0.2, i === 3 ? 0.7 : 0.25, 0.22));
  };
  A.pop = function (p) { if (!ok()) return; const t = ctx.currentTime, f = 600 * (p || 1); osc('triangle', f, f * 1.6, t, 0.12, 0.12); };

  // ---- music: "Lake Effect Reel", an original 16-bar folk/chiptune loop in G (A section + B section).
  // Layers by intensity: 0 = menu (bass, chords, soft lead), 1 = match (+ drums), 2 = hot rally / match point (+ 16th hats, extra kick, lead octave).
  const MEL = [
    '74 . 71 74 79 - 78 76', '74 - 71 . 67 69 71 -', '72 . 76 79 76 - 72 74', '69 - - . 66 69 74 -',
    '74 . 71 74 79 - 81 83', '81 79 76 . 79 - 76 74', '72 76 79 - 78 76 74 72', '71 - 67 - - . . .',
    '76 - 79 - 76 74 72 -', '74 - 71 - 67 - 71 74', '72 - 76 - 81 - 79 76', '78 - - 76 74 - 69 -',
    '76 79 84 - 83 81 79 -', '83 81 79 - 74 - 79 -', '76 78 79 76 78 - 74 -', '79 - - - . . 74 .',
    // C: a minor-ish bridge
    '71 - 74 - 76 - 74 71', '72 - 67 - 64 - 67 72', '71 - 74 - 79 - 78 79', '81 - 78 - 74 - . .',
    '76 79 83 - 81 79 76 -', '79 76 72 - 76 - 72 -', '74 76 78 79 81 - 78 -', '74 - - - . . 74 .'
  ].map((b) => b.split(' '));
  // chord per half bar: [root midi, third, fifth]
  const CH = { G: [43, 59, 62, 67], Em: [40, 59, 64, 67], C: [36, 60, 64, 67], D: [38, 57, 62, 66], Am: [45, 57, 60, 64] };
  const PROG = ['G G', 'Em Em', 'C C', 'D D', 'G G', 'Em Em', 'C D', 'G G', 'C C', 'G G', 'Am Am', 'D D', 'C C', 'G G', 'Em D', 'G G', 'Em Em', 'C C', 'G G', 'D D', 'Em Em', 'C C', 'D D', 'D D'].map((b) => b.split(' '));
  // song form A B A C (32 bars). Tempo per opponent: set by A.setTempo.
  const FORM = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23];
  let BPM = 112, S16 = 60 / BPM / 4;
  A.setTempo = function (bpm) { BPM = bpm; S16 = 60 / BPM / 4; };
  const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
  A.intensity = 0;
  function kick(t, v) { osc('sine', 150, 42, t, 0.16, 0.32 * v, musG); }
  function snare(t, v) { noise(t, 0.12, 0.13 * v, 'bandpass', 1800, 0.7, musG); osc('triangle', 220, 160, t, 0.06, 0.06 * v, musG); }
  function hat(t, v) { noise(t, 0.03, 0.045 * v, 'highpass', 7500, 0.8, musG); }
  function pluck(f, t, dur, vol, type) { osc(type || 'triangle', f, f, t, dur, vol, musG, 0.005); }
  function scheduleMusic() {
    if (!ctx || !A.music || !A.sound || A.muted || ctx.state !== 'running') { nextNoteT = ctx ? ctx.currentTime + 0.1 : 0; return; }
    while (nextNoteT < ctx.currentTime + 0.3) {
      const t = nextNoteT, bar = FORM[((step / 16) | 0) % FORM.length], s = step % 16, I = A.intensity;
      const chord = CH[PROG[bar][s < 8 ? 0 : 1]];
      // bass: boom-chick
      if (s === 0 || s === 8) pluck(mf(chord[0]), t, I ? S16 * 5 : S16 * 7, 0.11, 'triangle');
      if (I && (s === 6 || s === 14)) pluck(mf(chord[0] + 7), t, S16 * 2, 0.07, 'triangle');
      // chord stabs on the off-beats (the "chick")
      if (s === 4 || s === 12) for (let k = 1; k < 4; k++) pluck(mf(chord[k]), t, S16 * 2.2, 0.022, 'square');
      if (I === 0 && (s === 2 || s === 10)) for (let k = 1; k < 4; k++) pluck(mf(chord[k]), t, S16 * 1.5, 0.012, 'triangle');
      // lead melody (8th notes) — rests between phrases let the sfx breathe
      if (s % 2 === 0) {
        const tok = MEL[bar][s >> 1];
        if (tok !== '-' && tok !== '.') {
          let len = 1; for (let k = (s >> 1) + 1; k < 8 && MEL[bar][k] === '-'; k++) len++;
          const f = mf(+tok), d = S16 * 2 * len * 0.92;
          pluck(f, t, d, I === 0 ? 0.045 : 0.06, 'triangle');
          pluck(f * 2, t, d * 0.6, I === 2 ? 0.02 : 0.009, 'square');
        }
      }
      // drums
      if (I >= 1) {
        if (s === 0 || s === 8 || (I === 2 && (s === 7 || s === 10))) kick(t, 1);
        if (s === 4 || s === 12) snare(t, 1);
        if (s % 2 === 0 || I === 2) hat(t, s % 4 === 2 ? 1 : 0.6);
        if (bar % 8 === 7 && s >= 12) snare(t, 0.5 + (s - 12) * 0.15); // little fill into each section
        if (bar >= 16 && s % 4 === 2 && I === 2) hat(t + S16 * 0.5, 0.5); // the bridge gets a skippy hat
      }
      step++; nextNoteT += S16;
    }
  }
  A.applyMusic = function () {
    if (!ctx) return;
    if (A.music && A.sound && !musicTimer) { nextNoteT = ctx.currentTime + 0.1; step = 0; musicTimer = setInterval(scheduleMusic, 50); }
    if ((!A.music || !A.sound) && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  };
  A.setIntensity = function (n) { A.intensity = n; };
  A.duck = function (on) { if (musG && ctx) musG.gain.setTargetAtTime(on ? 0.14 : 0.5, ctx.currentTime, on ? 0.04 : 0.4); };
})();
