/* Pond Hockey — physics. Rink coordinates: x 0..W (left to right), y 0..H (top = opponent goal, bottom = player goal).
   Goal pockets stick out past y<0 and y>H. */
(function () {
  'use strict';
  const PH = (window.PH = window.PH || {});
  const C = (PH.C = {
    W: 340, H: 680, R: 44, GX0: 95, GX1: 245, GD: 26, RP: 15, RM: 30, BANK: 14,
    PUCK_MAX: 1600, FRICTION: 0.3, DECEL: 28, WALL_E: 0.88, MALLET_E: 0.7, MALLET_MAX: 1300,
    STEP: 1 / 300, HEAT0: 3, HEAT_N: 8, HEAT_MAX: 0.22, HEAT_KICK: 0.45, IDLE_T: 3.5, BUMP_R: 25, BUMP_WARN: 3.6, BUMP_A: 5200
  });
  const { W, H, R, GX0, GX1, GD, RP, RM } = C;
  const PI = Math.PI;

  // ---- outline polyline (clockwise) incl. goal pockets
  const pts = [];
  function arc(cx, cy, r, a0, a1, n) {
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  }
  arc(R, R, R, PI, 1.5 * PI, 8);
  pts.push([GX0, 0], [GX0, -GD], [GX1, -GD], [GX1, 0]);
  arc(W - R, R, R, 1.5 * PI, 2 * PI, 8);
  arc(W - R, H - R, R, 0, 0.5 * PI, 8);
  pts.push([GX1, H], [GX1, H + GD], [GX0, H + GD], [GX0, H]);
  arc(R, H - R, R, 0.5 * PI, PI, 8);
  PH.outline = pts;
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (l2 < 1e-9) continue;
    segs.push({ ax: a[0], ay: a[1], dx, dy, l2 });
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  PH.clamp = clamp;

  // ---- mallets
  PH.makeMallet = function (side) {
    const bottom = side === 'bottom';
    const m = {
      side, x: W / 2, y: bottom ? H - 110 : 110, vx: 0, vy: 0, tx: W / 2, ty: bottom ? H - 110 : 110,
      maxV: C.MALLET_MAX, k: 34, resp: 55, sq: 0, sqv: 0, sqa: 0, cd: 0, touches: 0, lastHit: 0
    };
    return m;
  };

  function clampMallet(o, side) {
    const r = RM;
    let minY, maxY;
    if (side === 'bottom') { minY = H / 2 + r; maxY = H - r - 3; } else { minY = r + 3; maxY = H / 2 - r; }
    o.x = clamp(o.x, r, W - r); o.y = clamp(o.y, minY, maxY);
    const cr = R - r;
    const cy = side === 'bottom' ? H - R : R;
    if ((side === 'bottom' && o.y > cy) || (side === 'top' && o.y < cy)) {
      let cx = -1;
      if (o.x < R) cx = R; else if (o.x > W - R) cx = W - R;
      if (cx >= 0) {
        const dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy);
        if (d > cr) { o.x = cx + dx / d * cr; o.y = cy + dy / d * cr; }
      }
    }
  }
  PH.clampMallet = clampMallet;

  // ---- world
  PH.createWorld = function () {
    return {
      puck: { x: W / 2, y: H / 2, vx: 0, vy: 0, live: false, r: RP },
      mallets: [PH.makeMallet('bottom'), PH.makeMallet('top')],
      bumps: [], ev: [], goal: null, rally: 0, heat: 0, idleT: 0, time: 0, friction: 1, bumpsOn: true, lastTouch: null
    };
  };
  PH.malletBy = (w, side) => (side === 'bottom' ? w.mallets[0] : w.mallets[1]);

  PH.addBump = function (w, x, y, rnd) {
    const r = rnd || Math.random;
    const cracks = [];
    const n = 6 + ((r() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + (r() - 0.5) * 0.6;
      let len = C.BUMP_R * (0.9 + r() * 1.1);
      const pl = [[0, 0]]; let cx = 0, cy = 0, ca = a;
      const steps = 3 + ((r() * 2) | 0);
      for (let s = 1; s <= steps; s++) { ca += (r() - 0.5) * 0.7; cx += Math.cos(ca) * len / steps; cy += Math.sin(ca) * len / steps; pl.push([cx, cy]); }
      cracks.push(pl);
    }
    const b = { x, y, r: C.BUMP_R, age: 0, active: false, cracks, rot: r() * 6.28 };
    w.bumps.push(b);
    return b;
  };

  // ---- core collisions
  function wallCollide(w, p, ev) {
    let maxImpact = 0, hx = 0, hy = 0;
    const rr = RP * RP;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      let t = ((p.x - s.ax) * s.dx + (p.y - s.ay) * s.dy) / s.l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = s.ax + s.dx * t, cy = s.ay + s.dy * t;
      const dx = p.x - cx, dy = p.y - cy, d2 = dx * dx + dy * dy;
      if (d2 >= rr) continue;
      const d = Math.sqrt(d2);
      let nx, ny;
      if (d > 1e-5) { nx = dx / d; ny = dy / d; } else { const ex = W / 2 - p.x, ey = H / 2 - p.y, el = Math.hypot(ex, ey) || 1; nx = ex / el; ny = ey / el; }
      p.x = cx + nx * RP; p.y = cy + ny * RP;
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        const j = -(1 + (w.goal ? 0.1 : C.WALL_E)) * vn;
        p.vx += j * nx; p.vy += j * ny;
        // a touch of tangential drag so walls feel a little sticky
        const tx = -ny, ty = nx, vt = p.vx * tx + p.vy * ty;
        p.vx -= vt * tx * 0.02; p.vy -= vt * ty * 0.02;
        if (-vn > maxImpact) { maxImpact = -vn; hx = p.x - nx * RP; hy = p.y - ny * RP; }
      }
    }
    if (maxImpact > 90) ev.push({ t: 'wall', speed: maxImpact, x: hx, y: hy });
    return maxImpact;
  }

  function mallectCollide(w, p, m, ev) {
    const dx = p.x - m.x, dy = p.y - m.y, rr = RM + RP, d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return false;
    const d = Math.sqrt(d2);
    let nx, ny;
    if (d > 1e-4) { nx = dx / d; ny = dy / d; } else { nx = 0; ny = m.side === 'bottom' ? -1 : 1; }
    p.x = m.x + nx * rr; p.y = m.y + ny * rr;
    const rvx = p.vx - m.vx, rvy = p.vy - m.vy, vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const j = -(1 + C.MALLET_E) * vn;
      p.vx += j * nx; p.vy += j * ny;
      if (m.cd <= 0 && -vn > 60) {
        if (w.heat > 0) { const hb = 1 + C.HEAT_KICK * w.heat; p.vx *= hb; p.vy *= hb; } // a hot rally makes every real hit livelier (not grazes)
        m.cd = 0.07;
        ev.push({ t: 'mallet', m, speed: -vn, x: m.x + nx * RM, y: m.y + ny * RM, nx, ny });
        m.sqv += Math.min(1, -vn / 1400) * 7; m.sqa = Math.atan2(ny, nx);
        // rally heat: every back-and-forth exchange warms the puck; long rallies get faster until someone breaks through
        if (w.lastTouch && w.lastTouch !== m.side) { w.rally++; w.heat = clamp((w.rally - C.HEAT0) / C.HEAT_N, 0, 1); }
      }
      w.lastTouch = m.side;
    }
    return true;
  }

  // point-in-polygon on the rink outline (incl. goal pockets)
  function inside(x, y) {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
    }
    return ins;
  }
  PH.inside = inside;

  function sub(w, h) {
    const p = w.puck, ev = w.ev;
    w.time += h;
    // mallets
    for (let i = 0; i < 2; i++) {
      const m = w.mallets[i];
      const t = { x: m.tx, y: m.ty };
      clampMallet(t, m.side);
      let vx = (t.x - m.x) * m.k, vy = (t.y - m.y) * m.k;
      const sp = Math.hypot(vx, vy);
      if (sp > m.maxV) { vx *= m.maxV / sp; vy *= m.maxV / sp; }
      const a = Math.min(1, h * m.resp);
      const nvx = m.vx + (vx - m.vx) * a, nvy = m.vy + (vy - m.vy) * a;
      const ox = m.x, oy = m.y;
      m.x += nvx * h; m.y += nvy * h;
      clampMallet(m, m.side);
      m.vx = (m.x - ox) / h; m.vy = (m.y - oy) / h;
      if (m.cd > 0) m.cd -= h;
      // squash spring
      m.sqv += (-300 * m.sq - 18 * m.sqv) * h; m.sq += m.sqv * h;
    }
    // bumps (age + warning phase)
    for (let i = 0; i < w.bumps.length; i++) { const b = w.bumps[i]; b.age += h; if (!b.active && b.age > C.BUMP_WARN) { b.active = true; ev.push({ t: 'bumpActive', b }); } }

    if (!p.live) return;
    // friction
    const inPocket = p.y < 0 || p.y > H;
    const k = w.goal ? 14 : inPocket ? 5 : C.FRICTION * w.friction;
    let sp = Math.hypot(p.vx, p.vy);
    if (sp > 0) {
      let ns = sp * Math.exp(-k * h) - (inPocket ? 0 : C.DECEL * h * w.friction);
      if (ns < 0) ns = 0;
      const f = ns / sp; p.vx *= f; p.vy *= f; sp = ns;
    }
    // bump forces (only after warning phase)
    if (w.bumpsOn && !inPocket) {
      for (let i = 0; i < w.bumps.length; i++) {
        const b = w.bumps[i]; if (!b.active) continue;
        const dx = p.x - b.x, dy = p.y - b.y, reach = b.r * 1.25, d2 = dx * dx + dy * dy;
        if (d2 < reach * reach && d2 > 1) {
          const d = Math.sqrt(d2), f = (1 - d / reach);
          const a = C.BUMP_A * f * f * (0.6 + 0.4 * f);
          p.vx += dx / d * a * h; p.vy += dy / d * a * h;
        }
      }
    }
    const cap = C.PUCK_MAX * (1 + C.HEAT_MAX * w.heat);
    if (sp > cap) { const f = cap / sp; p.vx *= f; p.vy *= f; }
    const sx = p.x, sy = p.y;
    p.x += p.vx * h; p.y += p.vy * h;

    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < 2; i++) {
        const ox = p.x, oy = p.y;
        // a mallet must never shove the puck out through a wall: if it would, keep the old spot (squeeze handled below)
        if (mallectCollide(w, p, w.mallets[i], ev) && !inside(p.x, p.y)) { p.x = ox; p.y = oy; }
      }
      wallCollide(w, p, ev);
    }
    sp = Math.hypot(p.vx, p.vy);
    if (sp > cap) { const f = cap / sp; p.vx *= f; p.vy *= f; }
    // squeezed between a mallet and a wall: eject sideways along the wall
    for (let i = 0; i < 2; i++) {
      const m = w.mallets[i];
      const dx = p.x - m.x, dy = p.y - m.y, rr = RM + RP, d = Math.hypot(dx, dy);
      if (d < rr - 0.8) {
        const nx = dx / (d || 1), ny = dy / (d || 1);
        let tx = -ny, ty = nx;
        if (tx * (W / 2 - p.x) + ty * (H / 2 - p.y) < 0) { tx = -tx; ty = -ty; }
        p.vx = tx * 420 + p.vx * 0.3; p.vy = ty * 420 + p.vy * 0.3;
        wallCollide(w, p, ev);
      }
    }
    // final guard: the puck centre can never end a step outside the rink; if it would, keep the last good spot
    if (!inside(p.x, p.y)) { p.x = sx; p.y = sy; }
    // goal
    if (!w.goal) {
      if (p.y < -2) w.goal = { into: 'top', x: p.x, speed: Math.hypot(p.vx, p.vy) };
      else if (p.y > H + 2) w.goal = { into: 'bottom', x: p.x, speed: Math.hypot(p.vx, p.vy) };
      if (w.goal) { w.goal.rally = w.rally; w.goal.heat = w.heat; w.goal.lastTouch = w.lastTouch; w.rally = 0; w.heat = 0; w.lastTouch = null; }
      if (w.goal) ev.push({ t: 'goal', heat: w.goal.heat, rally: w.goal.rally, lastTouch: w.goal.lastTouch, into: w.goal.into, x: w.goal.x, speed: w.goal.speed });
    }
    // idle puck nudge
    if (!w.goal) {
      if (w.idleX === undefined || Math.hypot(p.x - w.idleX, p.y - w.idleY) > 22) { w.idleX = p.x; w.idleY = p.y; w.idleT = 0; } else w.idleT += h;
      if (w.idleT > C.IDLE_T) {
        w.idleT = 0; w.idleX = undefined;
        let dir = p.y < H / 2 ? 1 : -1, lat = (Math.random() - 0.5) * 0.8 + (W / 2 - p.x) / W;
        const edge = p.x < RP + 30 || p.x > W - RP - 30 || p.y < RP + 30 || p.y > H - RP - 30;
        if (edge) { lat = (W / 2 - p.x) / W * 2.4; dir = (H / 2 - p.y) / H * 2.4; } // pinned on a wall/corner: pop it toward the middle
        const l = Math.hypot(lat, dir) || 1;
        p.vx = lat / l * 260; p.vy = dir / l * 260;
        ev.push({ t: 'nudge', x: p.x, y: p.y });
      }
    }
  }

  PH.step = function (w, dt) {
    if (dt <= 0) return;
    const n = Math.max(1, Math.ceil(dt / C.STEP)), h = dt / n;
    for (let i = 0; i < n; i++) sub(w, h);
    const p = w.puck;
    // hard safety net: never leave the rink area (should be unreachable)
    if (p.live && (p.x < -2 || p.x > W + 2 || p.y < -GD - 4 || p.y > H + GD + 4 || !isFinite(p.x) || !isFinite(p.y))) {
      w.ev.push({ t: 'rescue' });
      p.x = W / 2; p.y = H / 2; p.vx = p.vy = 0;
    }
  };

  // Where will a free-moving puck cross y = yT (mirroring off the side walls)? null if not heading there. b = number of side-wall bounces.
  PH.predictX = function (px, py, vx, vy, yT) {
    const dy = yT - py;
    if (Math.abs(vy) < 1e-3 || dy / vy <= 0) return null;
    const t = dy / vy, minX = RP, span = W - 2 * RP;
    const u0 = px + vx * t - minX, b = u0 >= 0 ? Math.floor(u0 / span) : Math.floor(-u0 / span) + 1; // b = wall bounces on the way
    let u = u0 % (2 * span);
    if (u < 0) u += 2 * span;
    if (u > span) u = 2 * span - u;
    return { x: minX + u, t, b };
  };
})();
