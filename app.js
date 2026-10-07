/* Cabin Haul UI. Talks to the data layer through window.STORE, which is
   provided by store-supabase.js (GitHub Pages build) or store-artifact.js
   (claude.ai prototype). Both expose the same four calls plus init(). */
(function () {
  'use strict';

  // ---- Who's coming. Edit here; the first name in a pair is just display order. ----
  var PARTIES = [
    ['Joe', 'Katelyn'],
    ['Mitch', 'Jess'],
    ['Luke', 'Liv'],
    ['Kyle', 'Kelly'],
    ['Justin', 'Gabby'],
    ['Terry', 'Kyrsten'],
    ['Drew']
  ];
  var CATEGORIES = ['Food', 'Drinks', 'Booze', 'Snacks', 'Supplies', 'Gear', 'Other'];

  function partyOf(name) {
    for (var i = 0; i < PARTIES.length; i++) if (PARTIES[i].indexOf(name) >= 0) return PARTIES[i].join(' & ');
    return null;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(s) { return String(s).trim().replace(/\s+/g, ' ').toLowerCase(); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function $(id) { return document.getElementById(id); }

  var toastEl = $('toast'), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }
  function copyText(text, okMsg) {
    var ok = function () { toast(okMsg); };
    var no = function () { toast('Copy didn\'t work on this browser.'); };
    try { navigator.clipboard.writeText(text).then(ok, no); } catch (e) { no(); }
  }

  // ---- Identity ----
  var me = lsGet('cabin-haul-me');
  if (me && !partyOf(me)) me = null;           // roster changed; ask again
  var myParty = me ? partyOf(me) : null;

  // Everyone as individuals, in a fixed shuffled order so couples aren't side by side.
  var NAMES = ['Mitch', 'Katelyn', 'Drew', 'Luke', 'Kelly', 'Gabby', 'Joe', 'Liv', 'Terry', 'Jess', 'Kyle', 'Kyrsten', 'Justin'];
  PARTIES.forEach(function (p) { p.forEach(function (n) { if (NAMES.indexOf(n) < 0) NAMES.push(n); }); });

  // ---- Bubble physics on a canvas: grab, fling, collide. A quick tap picks the name.
  //      Hold one for 5 seconds and it turns into air hockey against the CPU. ----
  var sim = null, scores = null, scoresSub = false, boardShown = false;
  var HOLD_MS = 5000, HOLD_SHOW_MS = 3000;
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function renderScores() {
    var el = $('scores'); if (!el) return;
    if (!scores || !boardShown) { el.hidden = true; return; }
    var names = Object.keys(scores.byName || {}).sort(function (a, b) { return scores.byName[b] - scores.byName[a]; }).slice(0, 3);
    var h = scores.humans || 0, c = scores.cpu || 0;
    el.hidden = false;
    el.innerHTML = '<div class="side' + (h > c ? ' lead' : '') + '"><span class="num">' + h + '</span><span class="lbl">Humans</span></div>' +
      '<div class="vs">vs</div>' +
      '<div class="side' + (c > h ? ' lead' : '') + '"><span class="num">' + c + '</span><span class="lbl">Claude</span></div>' +
      (names.length ? '<div class="top">' + esc(names.map(function (n) { return n + ' ' + scores.byName[n]; }).join(' · ')) + '</div>' : '');
  }
  function renderRoster() {
    if (sim) sim.stop();
    if (store && store.scores && !scoresSub) { scoresSub = true; store.scores(function (sc) { scores = sc; renderScores(); }); }
    renderScores();
    var box = $('roster');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.innerHTML = '<canvas id="arena" aria-hidden="true"></canvas><div class="sr-list">' +
      NAMES.map(function (n) { return '<button type="button" data-me="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>';
    var cv = $('arena'), ctx = cv.getContext('2d');
    var W = 0, H = 0, dpr = 1;
    function resize() {
      dpr = Math.min(3, window.devicePixelRatio || 1);
      W = box.clientWidth; H = box.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    var tones = ['pine', 'plain', 'ember'], colors = {};
    function readColors() {
      colors = { pine: [cssVar('--pine'), cssVar('--pine-ink')], plain: [cssVar('--surface'), cssVar('--fg')], ember: [cssVar('--ember'), '#ffffff'],
        line: cssVar('--line'), fg: cssVar('--fg'), bg: cssVar('--bg'), muted: cssVar('--muted'), shadow: 'rgba(27,42,34,0.14)' };
    }
    readColors();
    var fontFamily = cssVar('--display'), font = '700 16px ' + fontFamily;
    if (document.fonts && document.fonts.load) document.fonts.load(font).catch(function () { /* fallback font is fine */ });

    var balls = NAMES.map(function (n, i) {
      var r = [46, 41, 52, 46, 44][i % 5];
      var cols = 3, col = i % cols, row = Math.floor(i / cols);
      return { name: n, tone: tones[i % 3], r: r, m: r * r, scale: 1, alpha: 1,
        x: (W / (cols + 1)) * (col + 1) + (row % 2 ? 18 : -18) + (Math.random() * 10 - 5),
        y: 70 + row * 100 + (Math.random() * 10 - 5),
        vx: 0, vy: 0, held: false,
        w1: 0.7 + Math.random() * 0.35, w2: 0.45 + Math.random() * 0.25,
        p1: Math.random() * 6.28, p2: Math.random() * 6.28, p3: Math.random() * 6.28 };
    });
    balls.forEach(function (b) { b.x = Math.max(b.r, Math.min(W - b.r, b.x)); b.y = Math.max(b.r, Math.min(H - b.r, b.y)); b.hx = b.x; b.hy = b.y; });
    box.__balls = balls;   // for tests

    var running = true, last = performance.now(), held = null, popping = null, holdStart = 0;
    var game = null;       // air hockey state once it starts
    box.__game = function () { return game; };

    function physics(dt, now) {
      var t = now / 1000;
      balls.forEach(function (b) {
        if (b.held) {
          var tx = Math.max(b.r, Math.min(W - b.r, b.tx)), ty = Math.max(b.r, Math.min(H - b.r, b.ty));
          b.vx = (tx - b.x) * 0.55; b.vy = (ty - b.y) * 0.55;
          b.x += b.vx * dt; b.y += b.vy * dt;
          b.hx = b.x; b.hy = b.y;
          return;
        }
        var speed = Math.hypot(b.vx, b.vy);
        if (speed > 4) {
          b.hx = b.x; b.hy = b.y;
          b.vx *= Math.pow(0.992, dt); b.vy *= Math.pow(0.992, dt);
        } else if (!reduce) {
          var tx2 = b.hx + 42 * Math.sin(t * b.w1 + b.p1) + 20 * Math.sin(t * b.w2 + b.p2);
          var ty2 = b.hy + 42 * Math.cos(t * b.w2 + b.p1) + 20 * Math.sin(t * b.w1 + b.p3);
          tx2 = Math.max(b.r, Math.min(W - b.r, tx2)); ty2 = Math.max(b.r, Math.min(H - b.r, ty2));
          var blend = 1 - speed / 4;
          b.vx += (tx2 - b.x) * 0.006 * blend * dt; b.vy += (ty2 - b.y) * 0.006 * blend * dt;
          b.vx *= Math.pow(0.98, dt); b.vy *= Math.pow(0.98, dt);
        } else {
          b.vx *= Math.pow(0.975, dt); b.vy *= Math.pow(0.975, dt);
        }
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.85; }
        if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.85; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.85; }
        if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.85; }
      });
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < balls.length; i++) for (var j = i + 1; j < balls.length; j++) {
          var a = balls[i], c = balls[j];
          var dx = c.x - a.x, dy = c.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, min = a.r + c.r;
          if (d >= min) continue;
          var nx = dx / d, ny = dy / d, overlap = (min - d) * 0.35;
          if (overlap < 0.15) continue;
          var wa = a.held ? 0 : (c.held ? 1 : c.m / (a.m + c.m)), wc = c.held ? 0 : (a.held ? 1 : a.m / (a.m + c.m));
          a.x -= nx * overlap * wa; a.y -= ny * overlap * wa;
          c.x += nx * overlap * wc; c.y += ny * overlap * wc;
          var rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rel > 0) continue;
          var e = 0.9;
          if (a.held || c.held) {
            var mover = a.held ? c : a, sign = a.held ? 1 : -1;
            var push = Math.max(Math.abs(rel), 1.0) * (1 + e);
            mover.vx += nx * push * sign; mover.vy += ny * push * sign;
          } else {
            var jimp = -(1 + e) * rel / (1 / a.m + 1 / c.m);
            a.vx -= jimp * nx / a.m; a.vy -= jimp * ny / a.m;
            c.vx += jimp * nx / c.m; c.vy += jimp * ny / c.m;
          }
        }
      }
    }
    function circle(x, y, r, fill, stroke, lw) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.lineWidth = lw || 2; ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function drawBubble(b, now) {
      var r = b.r * b.scale, col = colors[b.tone];
      ctx.globalAlpha = b.alpha;
      circle(b.x, b.y + 3, r, colors.shadow);
      circle(b.x, b.y, r, col[0], b.tone === 'plain' ? colors.line : null, 2);
      if (b.held && !game && now - holdStart >= HOLD_SHOW_MS) {   // ring appears late, fills over the last stretch
        var frac = Math.min(1, (now - holdStart - HOLD_SHOW_MS) / (HOLD_MS - HOLD_SHOW_MS));
        ctx.beginPath(); ctx.arc(b.x, b.y, r + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = colors.ember[0]; ctx.stroke();
      }
      ctx.fillStyle = col[1];
      ctx.font = '700 ' + Math.round(16 * (b.r / 46) * b.scale) + 'px ' + fontFamily;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.name, b.x, b.y + 1);
      ctx.globalAlpha = 1;
    }
    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      if (game) { drawGame(now); return; }
      balls.forEach(function (b) { drawBubble(b, now); });
    }

    // ---- Air hockey ----
    function startGame(paddle) {
      var gw = Math.round(W * 0.42);
      game = { me: paddle, t0: performance.now(), over: null,
        goal: { x1: (W - gw) / 2, x2: (W + gw) / 2 },
        cpu: { x: W / 2, y: 56, vx: 0, vy: 0, r: 28 },
        puck: { x: W / 2, y: H / 2, vx: (Math.random() - 0.5) * 3, vy: (Math.random() < 0.5 ? -1 : 1) * 2.5, r: 12 } };
      paddle.held = true; paddle.tx = paddle.x; paddle.ty = Math.max(H / 2 + paddle.r, paddle.y);
      paddle.targetR = 28; paddle.bubbleR = paddle.r;
      balls.forEach(function (b) { if (b !== paddle) b.fade = true; });
      boardShown = true; renderScores();
    }
    function gamePhysics(dt, now) {
      var g = game, me = g.me, p = g.puck, c = g.cpu;
      if (me.r > me.targetR + 0.2) me.r += (me.targetR - me.r) * Math.min(1, 0.18 * dt); else me.r = me.targetR;
      if (g.over) return;
      // player paddle follows finger, bottom half only
      var tx = Math.max(me.r, Math.min(W - me.r, me.tx)), ty = Math.max(H / 2 + me.r, Math.min(H - me.r, me.ty));
      me.vx = (tx - me.x) * 0.55; me.vy = (ty - me.y) * 0.55;
      me.x += me.vx * dt; me.y += me.vy * dt;
      // cpu paddle: chase the puck in its half, otherwise hover in front of its goal
      var cx, cy;
      if (p.y < H / 2 && p.y > c.y - 6) { cx = p.x; cy = p.y - 10; }           // puck in front: go hit it
      else if (p.y < H / 2) { cx = W / 2; cy = Math.min(H / 2 - c.r, p.y + c.r + p.r + 30); }   // puck behind: back away so it can roll out
      else { cx = W / 2 + (p.x - W / 2) * 0.4; cy = 56; }
      cx = Math.max(c.r, Math.min(W - c.r, cx)); cy = Math.max(c.r, Math.min(H / 2 - c.r, cy));
      var maxv = 7.5;
      var nvx = (cx - c.x) * 0.12, nvy = (cy - c.y) * 0.12, nv = Math.hypot(nvx, nvy);
      if (nv > maxv) { nvx *= maxv / nv; nvy *= maxv / nv; }
      c.vx = nvx; c.vy = nvy; c.x += c.vx * dt; c.y += c.vy * dt;
      // puck; if it gets pinned or dies in a corner, re-serve it from center
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(0.996, dt); p.vy *= Math.pow(0.996, dt);
      var ps = Math.hypot(p.vx, p.vy);
      g.stuck = ps < 0.6 ? (g.stuck || 0) + dt : 0;
      if (g.stuck > 75) {                                       // ~1.25 s without moving
        p.x = W / 2; p.y = H / 2; g.stuck = 0;
        var dir = Math.random() < 0.5 ? -1 : 1;
        p.vx = (Math.random() - 0.5) * 4; p.vy = dir * 3.5; g.serveFlash = now;
      }
      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * 0.9; }
      if (p.x > W - p.r) { p.x = W - p.r; p.vx = -Math.abs(p.vx) * 0.9; }
      var inGoal = p.x > g.goal.x1 && p.x < g.goal.x2;
      if (p.y < p.r && !inGoal) { p.y = p.r; p.vy = Math.abs(p.vy) * 0.9; }
      if (p.y > H - p.r && !inGoal) { p.y = H - p.r; p.vy = -Math.abs(p.vy) * 0.9; }
      if (p.y < -p.r) endGame('human');
      if (p.y > H + p.r) endGame('cpu');
      [me, c].forEach(function (pad) {
        var dx = p.x - pad.x, dy = p.y - pad.y, d = Math.hypot(dx, dy) || 0.01, min = p.r + pad.r;
        if (d >= min) return;
        var nx = dx / d, ny = dy / d;
        p.x = pad.x + nx * min; p.y = pad.y + ny * min;
        var rvx = p.vx - pad.vx, rvy = p.vy - pad.vy, rel = rvx * nx + rvy * ny;
        if (rel < 0) { rvx -= (1 + 0.9) * rel * nx; rvy -= (1 + 0.9) * rel * ny; }
        p.vx = rvx + pad.vx * 1.1; p.vy = rvy + pad.vy * 1.1;
        var sp = Math.hypot(p.vx, p.vy), cap = 16;
        if (sp > cap) { p.vx *= cap / sp; p.vy *= cap / sp; }
        if (sp < 2) { p.vx += nx * 2; p.vy += ny * 2; }
        if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) + 1; }
        if (p.x > W - p.r) { p.x = W - p.r; p.vx = -Math.abs(p.vx) - 1; }
        var inG = p.x > g.goal.x1 && p.x < g.goal.x2;
        if (p.y < p.r && !inG) { p.y = p.r; p.vy = Math.abs(p.vy) + 1; }
        if (p.y > H - p.r && !inG) { p.y = H - p.r; p.vy = -Math.abs(p.vy) - 1; }
      });
    }
    function endGame(winner) {
      game.over = { winner: winner, t: performance.now() };
      if (store && store.recordWin) store.recordWin(winner, game.me.name).catch(function () { /* tally is best-effort */ });
    }
    function mallet(x, y, r, color, label) {
      circle(x, y + 3, r, colors.shadow);
      circle(x, y, r, color, 'rgba(0,0,0,0.22)', 3);                       // base disc with a rim
      circle(x, y, r * 0.66, color, 'rgba(0,0,0,0.28)', 2);                // raised handle
      circle(x, y, r * 0.42, 'rgba(255,255,255,0.22)');                    // knob top
      ctx.beginPath(); ctx.arc(x - r * 0.12, y - r * 0.12, r * 0.3, Math.PI * 1.05, Math.PI * 1.65);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();   // highlight
      if (label) { ctx.fillStyle = colors.muted; ctx.font = '600 11px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y + r + 12); }
    }
    function drawGame(now) {
      var g = game, p = g.puck, c = g.cpu, me = g.me;
      var fade = Math.min(1, (now - g.t0) / 500);
      // rink
      ctx.globalAlpha = fade;
      ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); ctx.setLineDash([]);
      circle(W / 2, H / 2, 46, null, colors.line, 2);
      ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.strokeStyle = colors.ember[0]; ctx.beginPath(); ctx.moveTo(g.goal.x1, 3); ctx.lineTo(g.goal.x2, 3); ctx.stroke();
      ctx.strokeStyle = colors.pine[0]; ctx.beginPath(); ctx.moveTo(g.goal.x1, H - 3); ctx.lineTo(g.goal.x2, H - 3); ctx.stroke();
      ctx.font = '600 11px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = colors.muted;
      ctx.fillText('SHOOT HERE', W / 2, 18); ctx.fillText('DEFEND', W / 2, H - 18);
      ctx.globalAlpha = 1;
      // fading bubbles
      balls.forEach(function (b) { if (b.fade) { b.alpha = Math.max(0, 1 - fade); if (b.alpha > 0) drawBubble(b, now); } });
      // cpu mallet
      mallet(c.x, c.y, c.r, colors.ember[0], 'Claude');
      // puck
      if (g.serveFlash && now - g.serveFlash < 900) {
        ctx.globalAlpha = 1 - (now - g.serveFlash) / 900; ctx.fillStyle = colors.muted; ctx.font = '600 13px ' + fontFamily;
        ctx.fillText('re-serve', W / 2, H / 2 + 64); ctx.globalAlpha = 1;
      }
      circle(p.x, p.y + 2, p.r, colors.shadow); circle(p.x, p.y, p.r, colors.fg); circle(p.x, p.y, p.r * 0.5, null, colors.bg, 1.5);
      // player mallet (the bubble shrinks into it)
      var k2 = Math.min(1, (now - g.t0) / 450);
      if (k2 < 1) { me.alpha = 1; drawBubble(me, now); }
      ctx.globalAlpha = k2; mallet(me.x, me.y, me.r, colors[me.tone][0], me.name); ctx.globalAlpha = 1;
      if (g.over) {
        var k = Math.min(1, (now - g.over.t) / 300);
        ctx.globalAlpha = 0.85 * k; ctx.fillStyle = colors.bg; ctx.fillRect(0, H / 2 - 60, W, 120); ctx.globalAlpha = k;
        ctx.fillStyle = g.over.winner === 'human' ? colors.pine[0] : colors.ember[0];
        ctx.font = '800 34px ' + fontFamily; ctx.fillText(g.over.winner === 'human' ? 'GOAL!' : 'CLAUDE SCORES', W / 2, H / 2 - 14);
        ctx.fillStyle = colors.fg; ctx.font = '600 15px ' + fontFamily;
        ctx.fillText(g.over.winner === 'human' ? me.name + ' beats Claude' : 'Nice try, ' + me.name, W / 2, H / 2 + 22);
        ctx.globalAlpha = 1;
      }
    }

    function step(now) {
      if (!running) return;
      var dt = Math.min(32, now - last) / 16.67; last = now;
      if (game) {
        gamePhysics(dt, now);
        if (game.over && now - game.over.t > 2400) { running = false; renderRoster(); return; }   // back to the bubbles
      } else {
        physics(dt, now);
        if (held && now - holdStart >= HOLD_MS && !popping) startGame(held);
      }
      if (popping) {
        var t = (now - popping.t0) / 280;
        popping.b.scale = 1 + 0.5 * Math.min(1, t); popping.b.alpha = Math.max(0, 1 - t);
        if (t >= 1) { running = false; popping = null; draw(now); finishPick(); return; }
      }
      draw(now);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { resize(); }); ro.observe(box); }
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', readColors);

    // Pointer handling: drag to fling, tap to pick, hold for hockey. In a game, any touch steers the paddle.
    var trail = [], start = null, pendingPick = null;
    function pos(e) { var rct = cv.getBoundingClientRect(); return { x: e.clientX - rct.left, y: e.clientY - rct.top, t: performance.now() }; }
    function hit(p) {
      for (var i = balls.length - 1; i >= 0; i--) { var b = balls[i]; if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r + 4) return b; }
      return null;
    }
    cv.addEventListener('pointerdown', function (e) {
      if (popping) return;
      var p = pos(e);
      if (game) {
        var me = game.me; me.gx = p.x - me.x; me.gy = p.y - me.y;
        if (Math.hypot(me.gx, me.gy) > me.r + 24) { me.gx = 0; me.gy = 0; }   // tapped far away: paddle jumps to finger
        held = me; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault(); return;
      }
      var b = hit(p); if (!b) return;
      held = b; b.held = true; b.vx = 0; b.vy = 0; b.tx = b.x; b.ty = b.y; holdStart = p.t;
      start = p; trail = [p]; b.gx = p.x - b.x; b.gy = p.y - b.y;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!held) return;
      var p = pos(e);
      held.tx = p.x - held.gx; held.ty = p.y - held.gy;
      trail.push(p); if (trail.length > 6) trail.shift();
    });
    function release(e) {
      if (!held) return;
      if (game) { held = null; return; }               // paddle stays where you left it
      var b = held, p = pos(e); held = null; b.held = false;
      var moved = Math.hypot(p.x - start.x, p.y - start.y), dur = p.t - start.t;
      if (moved < 8 && dur < 400) { pick(b); return; }
      var old = trail[0], dt = Math.max(16, p.t - old.t) / 16.67;
      b.vx = Math.max(-70, Math.min(70, (p.x - old.x) / dt));
      b.vy = Math.max(-70, Math.min(70, (p.y - old.y) / dt));
    }
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
    box.addEventListener('click', function (e) {
      var k = e.target.closest('.sr-list [data-me]'); if (!k) return;
      var b = balls.filter(function (x) { return x.name === k.getAttribute('data-me'); })[0];
      if (b) pick(b);
    });
    function pick(b) {
      if (popping) return;
      pendingPick = b.name;
      if (reduce) { running = false; finishPick(); return; }
      popping = { b: b, t0: performance.now() };
    }
    function finishPick() {
      me = pendingPick; myParty = partyOf(me); lsSet('cabin-haul-me', me);
      showScreen();
    }
    sim = { stop: function () { running = false; if (ro) ro.disconnect(); } };
  }
  $('switch').addEventListener('click', function () { me = null; myParty = null; lsDel('cabin-haul-me'); showScreen(); });

  function showScreen() {
    var picking = !me;
    $('pick').hidden = !picking; $('main').hidden = picking; $('bar').hidden = picking;
    document.body.classList.toggle('picking', picking);
    if (picking) { renderRoster(); window.scrollTo(0, 0); return; }
    var partner = PARTIES.filter(function (p) { return p.indexOf(me) >= 0; })[0].filter(function (n) { return n !== me; })[0];
    $('me').innerHTML = 'Hey <b>' + esc(me) + '</b>' + (partner ? ' · with ' + esc(partner) : '');
    if (!booted) boot(); else render();
  }

  // ---- Data ----
  var store = window.STORE, booted = false, items = [], busy = {}, live = false;
  var view = lsGet('cabin-haul-view') || 'items';
  var mode = 'bring';

  function boot() {
    booted = true;
    if (!store) { showSetup('No data layer loaded. The page is missing its store script.'); return; }
    store.init({
      onItems: function (rows) { items = rows.slice(); render(); },
      onLive: function (on) { live = on; updateStatus(); },
      onError: function (msg) { $('groups').innerHTML = '<p class="skeleton">' + esc(msg) + '</p>'; },
      onSetup: showSetup
    });
  }
  function showSetup(html) { $('setup').hidden = false; $('setup').innerHTML = html; $('groups').innerHTML = ''; }

  // ---- Render ----
  function itemRow(it, showCat) {
    var mine = it.party && it.party === myParty;
    var cls = 'item' + (!it.party ? ' need' : '') + (mine ? ' mine' : '');
    var meta, act = '';
    if (!it.party) {
      meta = '<span class="nobody">Nobody yet</span>' + (it.added_by ? ' · flagged by ' + esc(it.added_by) : '');
      act = '<button type="button" class="act claim" data-claim="' + esc(it.id) + '">I\'ll bring it</button>';
    } else {
      meta = '<span class="by">' + esc(it.party) + '</span>' + (mine ? ' (you)' : '');
      if (mine) act = '<button type="button" class="act unclaim" data-unclaim="' + esc(it.id) + '">Not bringing</button>';
    }
    var canRemove = (it.adder_id && it.adder_id === myId()) || mine;
    if (canRemove) meta += '<button type="button" class="rm" data-rm="' + esc(it.id) + '">remove</button>';
    return '<div class="' + cls + '" data-id="' + esc(it.id) + '">' +
      '<div class="title">' + esc(it.name) + (it.note ? ' <span class="note">· ' + esc(it.note) + '</span>' : '') + (showCat ? '<span class="cat">' + esc(it.category) + '</span>' : '') + '</div>' +
      act + '<div class="meta">' + meta + '</div></div>';
  }

  function render() {
    if (!me) return;
    $('tab-items').setAttribute('aria-selected', String(view === 'items'));
    $('tab-people').setAttribute('aria-selected', String(view === 'people'));
    var needed = items.filter(function (it) { return !it.party; });
    $('tab-items').innerHTML = 'By item<span class="k">' + items.length + '</span>';
    $('tab-people').innerHTML = 'By person' + (needed.length ? '<span class="k">' + needed.length + ' needed</span>' : '');
    var html = '';
    if (!items.length) {
      html = '<div class="empty">Nothing on the list yet. Add the first thing above.</div>';
    } else if (view === 'items') {
      if (needed.length) {
        html += '<section class="group needed"><div class="group-head"><h2>Still needed</h2><span class="k">' + plural(needed.length, 'item', 'items') + '</span></div><div class="list">';
        needed.forEach(function (it) { html += itemRow(it, true); });
        html += '</div></section>';
      }
      var cats = CATEGORIES.slice();
      items.forEach(function (it) { if (cats.indexOf(it.category) < 0) cats.push(it.category); });
      cats.forEach(function (cat) {
        var rows = items.filter(function (it) { return it.party && it.category === cat; });
        if (!rows.length) return;
        html += '<section class="group"><div class="group-head"><h2>' + esc(cat) + '</h2><span class="k">' + plural(rows.length, 'item', 'items') + '</span></div><div class="list">';
        rows.forEach(function (it) { html += itemRow(it, false); });
        html += '</div></section>';
      });
    } else {
      var parties = PARTIES.map(function (p) { return p.join(' & '); });
      items.forEach(function (it) { if (it.party && parties.indexOf(it.party) < 0) parties.push(it.party); });
      parties.sort(function (a, b) { return (b === myParty) - (a === myParty); });
      parties.forEach(function (party) {
        var rows = items.filter(function (it) { return it.party === party; });
        html += '<section class="group"><div class="group-head"><h2>' + esc(party) + (party === myParty ? ' <span class="k">(you)</span>' : '') + '</h2><span class="k">' + plural(rows.length, 'item', 'items') + '</span></div>';
        if (rows.length) { html += '<div class="list">'; rows.forEach(function (it) { html += itemRow(it, true); }); html += '</div>'; }
        else html += '<div class="empty">Nothing yet</div>';
        html += '</section>';
      });
      if (needed.length) {
        html += '<section class="group needed"><div class="group-head"><h2>Still needed</h2><span class="k">' + plural(needed.length, 'item', 'items') + '</span></div><div class="list">';
        needed.forEach(function (it) { html += itemRow(it, true); });
        html += '</div></section>';
      }
    }
    $('groups').innerHTML = html;
    updateStatus();
  }

  function updateStatus() {
    var needed = items.filter(function (it) { return !it.party; }).length;
    var mine = items.filter(function (it) { return it.party === myParty; }).length;
    var s = '<span class="dot' + (live ? ' live' : '') + '" id="dot"></span><b>' + plural(items.length, 'item', 'items') + '</b>';
    if (myParty) s += ' · you\'ve got ' + mine;
    if (needed) s += ' · <span class="warn">' + needed + ' still needed</span>';
    $('status').innerHTML = s;
  }

  // ---- Actions ----
  function myId() {
    var id = lsGet('cabin-haul-voter-id');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      lsSet('cabin-haul-voter-id', id);
    }
    return id;
  }
  function setBusy(id, on) {
    busy[id] = on;
    var el = document.querySelector('.item[data-id="' + id + '"] .act');
    if (el) el.disabled = on;
  }
  function fail(prefix) { return function (e) { toast(prefix + ': ' + ((e && e.message) || e)); }; }
  function patchLocal(row) { items = items.map(function (it) { return it.id === row.id ? row : it; }); render(); }

  function addItem() {
    var nameEl = $('new-name'), noteEl = $('new-note'), catEl = $('new-cat');
    var name = nameEl.value.replace(/\s+/g, ' ').trim();
    var note = noteEl.value.replace(/\s+/g, ' ').trim();
    if (!name) { nameEl.focus(); return; }
    var dup = items.filter(function (it) { return norm(it.name) === norm(name); })[0];
    if (dup) {
      if (!dup.party && mode === 'bring') { toast('"' + dup.name + '" was already needed. It\'s yours now.'); claim(dup.id); }
      else if (dup.party) toast('"' + dup.name + '" is already covered by ' + dup.party + '.');
      else toast('"' + dup.name + '" is already on the needed list.');
      nameEl.value = ''; noteEl.value = '';
      return;
    }
    var row = { name: name, note: note || null, category: catEl.value, added_by: me, adder_id: myId(),
      party: mode === 'bring' ? myParty : null, claimed_by: mode === 'bring' ? me : null };
    $('addbtn').disabled = true;
    store.add(row).then(function (saved) {
      if (!items.some(function (it) { return it.id === saved.id; })) items.push(saved);
      nameEl.value = ''; noteEl.value = '';
      render();
      nameEl.focus();
    }).catch(fail('Couldn\'t add that')).then(function () { $('addbtn').disabled = false; });
  }

  function claim(id) {
    if (busy[id]) return;
    setBusy(id, true);
    store.update(id, { party: myParty, claimed_by: me }).then(patchLocal)
      .catch(fail('Couldn\'t claim that')).then(function () { setBusy(id, false); });
  }
  function unclaim(id) {
    if (busy[id]) return;
    setBusy(id, true);
    store.update(id, { party: null, claimed_by: null }).then(function (row) {
      patchLocal(row); toast('Moved to "Still needed" so someone else can grab it.');
    }).catch(fail('Couldn\'t update that')).then(function () { setBusy(id, false); });
  }
  function removeItem(id) {
    var it = items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    store.remove(id).then(function () {
      items = items.filter(function (x) { return x.id !== id; });
      render();
      toast('Removed "' + it.name + '".');
    }).catch(fail('Couldn\'t remove that'));
  }

  $('adder').addEventListener('submit', function (e) { e.preventDefault(); addItem(); });
  $('mode-bring').addEventListener('click', function () { mode = 'bring'; syncMode(); });
  $('mode-need').addEventListener('click', function () { mode = 'need'; syncMode(); });
  function syncMode() {
    $('mode-bring').setAttribute('aria-pressed', String(mode === 'bring'));
    $('mode-need').setAttribute('aria-pressed', String(mode === 'need'));
    $('addbtn').textContent = mode === 'bring' ? 'Add' : 'Flag it';
    $('new-name').placeholder = mode === 'bring' ? 'What are you bringing?' : 'What do we still need?';
  }
  $('groups').addEventListener('click', function (e) {
    var c = e.target.closest('[data-claim]'); if (c) { claim(c.getAttribute('data-claim')); return; }
    var u = e.target.closest('[data-unclaim]'); if (u) { unclaim(u.getAttribute('data-unclaim')); return; }
    var r = e.target.closest('[data-rm]'); if (r) removeItem(r.getAttribute('data-rm'));
  });
  $('tab-items').addEventListener('click', function () { view = 'items'; lsSet('cabin-haul-view', view); render(); });
  $('tab-people').addEventListener('click', function () { view = 'people'; lsSet('cabin-haul-view', view); render(); });
  $('copylink').addEventListener('click', function () { copyText(location.href.split('#')[0], 'Link copied. Paste it into the group chat.'); });

  function listText() {
    var lines = ['Cabin haul · ' + new Date().toLocaleDateString()];
    var needed = items.filter(function (it) { return !it.party; });
    if (needed.length) {
      lines.push('', 'STILL NEEDED');
      needed.forEach(function (it) { lines.push('☐ ' + it.name + (it.note ? ' (' + it.note + ')' : '') + ' · ' + it.category); });
    }
    PARTIES.map(function (p) { return p.join(' & '); }).forEach(function (party) {
      var rows = items.filter(function (it) { return it.party === party; });
      if (!rows.length) return;
      lines.push('', party.toUpperCase());
      rows.forEach(function (it) { lines.push('• ' + it.name + (it.note ? ' (' + it.note + ')' : '') + ' · ' + it.category); });
    });
    return lines.join('\n');
  }
  $('copylist').addEventListener('click', function () {
    if (!items.length) { toast('Nothing to copy yet.'); return; }
    copyText(listText(), 'List copied: who\'s bringing what, plus what\'s still needed.');
  });

  syncMode();
  showScreen();
})();
