/* Pond Hockey — CPU opponents. Thinks in "local" coordinates where its own goal is at y=0 (flips for the bottom side).
   banks = how many side-wall bounces it can read on defence (bank shots past that fool it until the puck comes off the wall).
   atkSp = it steps up and strikes a puck in its half slower than this, instead of just blocking. */
(function () {
  'use strict';
  const PH = window.PH;
  const { W, H, RP, RM, GX0, GX1 } = PH.C;
  const clamp = PH.clamp;

  PH.LEVELS = [
    // Sam is an eager puck-chaser: he lunges at almost everything, so he leaves his net open.
    { name: 'Rookie', who: 'Sugar Maple Sam', short: 'easy', blurb: 'Eager puck-chaser. Leaves the net open.', style: 'chaser',
      maxV: 400, power: 0.48, react: 0.4, err: 48, slip: 0.4, bank: 0, smart: 0, homeY: 78, wait: 0.55, banks: 0, atkSp: 620, fake: 0 },
    // Wendy is a stay-at-home defender who loves the boards: most of her shots are banks.
    { name: 'Rec League', who: 'Winooski Wendy', short: 'tricky', blurb: 'Steady defender. Loves bank shots.', style: 'banker',
      maxV: 700, power: 0.8, react: 0.16, err: 18, slip: 0.12, bank: 0.72, smart: 0.4, homeY: 74, wait: 0.28, banks: 0, atkSp: 430, fake: 0 },
    // Old Lake Effect is patient and sneaky: fakes one way and shoots the other, aims where you aren't.
    { name: 'Pond Legend', who: 'Old Lake Effect', short: 'brutal', blurb: 'Patient sniper. Fakes, then fires.', style: 'sniper',
      maxV: 845, power: 0.95, react: 0.16, err: 21, slip: 0.08, bank: 0.5, smart: 1, homeY: 88, wait: 0.16, banks: 1, atkSp: 610, fake: 0.25 }
  ];

  PH.makeAI = function (side, lvlIdx) {
    return { side, idx: lvlIdx, lvl: PH.LEVELS[lvlIdx], hist: [], t: 0, mode: 'defend', aim: null, noiseX: 0, noiseT: 0, holdUntil: 0, atkT: 0, striking: false, lastPuckVy: 0 };
  };

  const rnd = () => Math.random();
  function gauss() { return (rnd() + rnd() + rnd() - 1.5) / 0.75; }

  PH.aiUpdate = function (ai, w, dt) {
    ai.t += dt;
    const lv = ai.lvl, p = w.puck, m = PH.malletBy(w, ai.side), opp = PH.malletBy(w, ai.side === 'top' ? 'bottom' : 'top');
    const flip = ai.side === 'bottom';
    const fy = (y) => (flip ? H - y : y);
    const hist = ai.hist;
    hist.push({ t: ai.t, x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    while (hist.length > 2 && hist[1].t < ai.t - lv.react - 0.05) hist.shift();
    let d = hist[0];
    for (let i = 0; i < hist.length; i++) { if (hist[i].t <= ai.t - lv.react) d = hist[i]; else break; }
    const P = { x: d.x, y: fy(d.y) }, V = { x: d.vx, y: flip ? -d.vy : d.vy };
    const M = { x: m.x, y: fy(m.y) };
    const sp = Math.hypot(V.x, V.y);
    let tx, ty;
    m.maxV = lv.maxV;

    if (ai.t > ai.noiseT) { ai.noiseT = ai.t + 0.5; ai.noiseX = gauss() * lv.err * 0.9; }

    if (!p.live || w.goal) {
      tx = W / 2; ty = lv.homeY; ai.mode = 'defend';
    } else {
      const inHalf = P.y < H / 2 - 2;
      let attack = inHalf && (sp < lv.atkSp || V.y > -40) && ai.t > ai.holdUntil;
      if (ai.mode === 'attack' && inHalf && V.y > -260 && ai.t > ai.holdUntil) attack = true;
      if (attack) {
        if (ai.mode !== 'attack') { ai.mode = 'attack'; ai.atkT = 0; chooseAim(ai, P, opp, flip); }
        ai.atkT += dt;
        if (ai.atkT > 2.2) { ai.atkT = 0; chooseAim(ai, P, opp, flip); } // re-plan if it is taking too long
        const dist = Math.hypot(M.x - P.x, M.y - P.y);
        const tEst = Math.min(0.3, dist / (lv.maxV * 0.8));
        const Px = clamp(P.x + V.x * tEst * 0.7, RP, W - RP), Py = clamp(P.y + V.y * tEst * 0.7, RP, H - RP);
        let ux = ai.aim.x - Px, uy = ai.aim.y - Py; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
        const reach = RM + RP;
        const rx = M.x - Px, ry = M.y - Py;
        const behind = rx * ux + ry * uy, lat = -rx * uy + ry * ux;
        if (ai.fake && dist < reach + 46) { ai.fake = false; ai.aim.x = W - ai.aim.x; ai.atkT = 0; } // the fake: late switch to the other side
        if (behind < -reach * 0.55 && Math.abs(lat) < 20 + (1 - lv.smart) * 6) {
          tx = Px + ux * 46; ty = Py + uy * 46; m.maxV = lv.maxV * lv.power; ai.striking = true;
        } else if (behind < -reach * 0.15) {
          tx = Px - ux * (reach + 24); ty = Py - uy * (reach + 24); ai.striking = false;
          if (lv.style === 'chaser') m.maxV = lv.maxV * 1.5; // Sam lunges at the puck... and leaves the net wide open
        } else {
          const sd = Math.abs(lat) < 6 ? (P.x < W / 2 ? 1 : -1) : (lat >= 0 ? 1 : -1);
          const px = -uy * sd, py = ux * sd;
          tx = Px + px * (reach + 30) - ux * reach * 0.8; ty = Py + py * (reach + 30) - uy * reach * 0.8; ai.striking = false;
        }
      } else {
        ai.mode = 'defend'; ai.striking = false;
        const defY = lv.homeY;
        let pr = V.y < -30 ? PH.predictX(P.x, P.y, V.x, V.y, defY) : null;
        if (pr && pr.b > lv.banks) pr = null; // can't read that many banks: shadow the puck until it comes off the wall
        if (pr) { tx = pr.x + ai.noiseX; ty = defY; if (lv.smart > 0.6 && pr.t > 0.35 && sp < 700) ty = defY + 28; }
        else {
          tx = W / 2 + (P.x - W / 2) * (0.35 + 0.15 * lv.smart) + ai.noiseX * 0.3;
          ty = defY + (P.y > H * 0.6 ? 0 : 14 * lv.smart);
        }
      }
    }
    m.tx = clamp(tx, RM, W - RM);
    const lty = clamp(ty, RM + 3, H / 2 - 14);
    m.ty = fy(lty);
  };

  function chooseAim(ai, P, opp, flip) {
    const lv = ai.lvl;
    const oppX = opp.x;
    let ax = W / 2 + (rnd() - 0.5) * 70, ay = H + 12;
    if (rnd() < lv.smart) ax = oppX < W / 2 ? GX1 - 20 : GX0 + 20; // aim for the side the defender is not covering
    ax += gauss() * lv.err;
    if (rnd() < lv.bank && P.x > 80 && P.x < W - 80) {
      const goalX = W / 2 + (rnd() - 0.5) * 50;
      const left = rnd() < 0.5;
      const tx = left ? RP - (goalX - RP) : (W - RP) + ((W - RP) - goalX);
      const wallX = left ? RP : W - RP;
      const t = (wallX - P.x) / (tx - P.x);
      const yh = P.y + t * (H + 12 - P.y);
      if (t > 0 && t < 1 && yh > P.y + 70 && yh < H - 60) { ax = tx + gauss() * lv.err * 0.5; ay = H + 12; }
    }
    ai.aim = { x: ax, y: ay };
    ai.fake = rnd() < (lv.fake || 0);
    if (ai.fake) ai.aim.x = W - ai.aim.x; // line up the decoy first
    if (rnd() < lv.slip) { // human-ish mistakes
      const kind = rnd();
      if (kind < 0.4) ai.holdUntil = ai.t + 0.35 + rnd() * 0.5;           // zoned out for a moment
      else if (kind < 0.8) ai.aim.x += (rnd() < 0.5 ? -1 : 1) * (60 + rnd() * 50); // shanked it wide
      else { ai.aim.y = P.y + 6; ai.aim.x = P.x + (P.x < W / 2 ? 1 : -1) * 200; } // wild sideways swipe
    }
  }
})();
