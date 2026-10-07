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
    var h = scores.humans || 0, c = scores.cpu || 0;
    el.hidden = false;
    el.innerHTML = '<div class="side' + (h > c ? ' lead' : '') + '"><span class="num">' + h + '</span><span class="lbl">Humans</span></div>' +
      '<div class="vs">vs</div>' +
      '<div class="side' + (c > h ? ' lead' : '') + '"><span class="num">' + c + '</span><span class="lbl">Claude</span></div>';
  }
  function renderRoster() {
    if (sim) sim.stop();
    boardShown = false;
    if (store && store.scores && !scoresSub) { scoresSub = true; store.scores(function (sc) { scores = sc; renderScores(); }); }
    renderScores();
    sim = renderArena({ box: $('roster'), names: NAMES, games: true, onPick: function (name) {
      me = name; myParty = partyOf(me); lsSet('cabin-haul-me', me);
      showScreen();
    } });
  }
  // A physics arena of name balls. opts: box, names, onPick(name), games (hockey/golf easter eggs), current (ring this name).
  function renderArena(opts) {
    var box = opts.box, names = opts.names;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.innerHTML = '<canvas class="arena" aria-hidden="true"></canvas><div class="sr-list">' +
      names.map(function (n) { return '<button type="button" data-me="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>';
    var cv = box.querySelector('canvas'), ctx = cv.getContext('2d');
    var W = 0, H = 0, dpr = 1;
    function resize() {
      dpr = Math.min(3, window.devicePixelRatio || 1);
      W = box.clientWidth; H = box.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimpleTile = null;
    }
    resize();
    var colors = {};
    function readColors() {
      colors = { pine: [cssVar('--pine'), cssVar('--pine-ink')], ball: ['#fbfbf7', '#1b2a22'],
        claude: cssVar('--claude') || '#d97757', cream: '#f5efe6',
        line: cssVar('--line'), fg: cssVar('--fg'), bg: cssVar('--bg'), muted: cssVar('--muted'), shadow: 'rgba(10,40,20,0.28)' };
    }
    readColors();
    var fontFamily = cssVar('--display'), font = '700 16px ' + fontFamily;
    if (document.fonts && document.fonts.load) document.fonts.load(font).catch(function () { /* fallback font is fine */ });

    var balls = names.map(function (n, i) {
      var r = n.indexOf(' & ') >= 0 ? 54 : 40;
      var cols = 3, col = i % cols, row = Math.floor(i / cols);
      return { name: n, tone: 'pine', r: r, m: r * r, scale: 1, alpha: 1,
        x: (W / (cols + 1)) * (col + 1) + (row % 2 ? 22 : -22) + (Math.random() * 10 - 5),
        y: 64 + row * 92 + (Math.random() * 10 - 5),
        vx: 0, vy: 0, held: false, ox: Math.random() * 12, oy: Math.random() * 12, num: (i % 4) + 1 };
    });
    balls.forEach(function (b) { b.x = Math.max(b.r, Math.min(W - b.r, b.x)); b.y = Math.max(b.r, Math.min(H - b.r, b.y)); });
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
          b.ox += b.vx * dt; b.oy += b.vy * dt;
          return;
        }
        if (!reduce) {                   // the green has a gentle break that slowly shifts, so balls creep and settle
          var kx = 2 * Math.PI / 260, ky = 2 * Math.PI / 220;
          var gx = -0.035 * Math.cos(b.x * kx + t * 0.25) * Math.cos(b.y * ky - t * 0.18);
          var gy = 0.035 * Math.sin(b.x * kx + t * 0.25) * Math.sin(b.y * ky - t * 0.18);
          b.vx += gx * dt; b.vy += gy * dt;
        }
        var speed = Math.hypot(b.vx, b.vy);
        var fr = speed > 6 ? 0.992 : 0.982;   // rolling friction bites harder as the ball slows
        b.vx *= Math.pow(fr, dt); b.vy *= Math.pow(fr, dt);
        if (speed < 0.05) { b.vx = 0; b.vy = 0; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.ox += b.vx * dt; b.oy += b.vy * dt;   // dimple texture rolls with the ball
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.6; }
        if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.6; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.6; }
        if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.6; }
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
          var e = 0.82;
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
    // Dimple tile: concave dimples (shadow on the lit side's far wall, highlight on the near wall), tiled under each ball.
    var dimpleTile = null, dimpleSp = 0, dimpleRowH = 0;
    function buildDimpleTile() {
      var sp = 8.6, rowH = sp * 0.866, dr = 2.75;
      var tw = sp, th = rowH * 2;
      var off = document.createElement('canvas'); off.width = Math.round(tw * dpr); off.height = Math.round(th * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      function dimple(x, y) {
        o.beginPath(); o.arc(x - 0.7, y - 0.7, dr, 0, Math.PI * 2); o.fillStyle = 'rgba(90,100,95,0.30)'; o.fill();     // shaded wall (top-left)
        o.beginPath(); o.arc(x + 0.7, y + 0.7, dr, 0, Math.PI * 2); o.fillStyle = 'rgba(255,255,255,1)'; o.fill();      // lit wall (bottom-right)
        o.beginPath(); o.arc(x, y, dr - 0.5, 0, Math.PI * 2); o.fillStyle = 'rgba(241,243,240,1)'; o.fill();           // dimple floor
      }
      // hex arrangement: centers at (0,0),(sp,0) row 0; (sp/2,rowH) row 1; wrap neighbours so the tile is seamless
      [[0, 0], [sp, 0], [sp / 2, rowH], [-sp / 2, rowH], [0, th], [sp, th], [sp / 2, -rowH]].forEach(function (c) { dimple(c[0], c[1]); });
      dimpleTile = ctx.createPattern(off, 'repeat');
      try { dimpleTile.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) { /* older browsers: slightly soft dimples */ }
      dimpleSp = sp; dimpleRowH = rowH;
    }
    function drawBubble(b, now) {
      var r = b.r * b.scale, col = colors.ball;
      if (!dimpleTile) buildDimpleTile();
      ctx.globalAlpha = b.alpha;
      // contact shadow on the grass
      ctx.save(); ctx.translate(b.x, b.y + r * 0.92); ctx.scale(1, 0.32); circle(0, 0, r * 0.95, colors.shadow); ctx.restore();
      // ball body: white with soft darkening toward the lower-right limb
      var grad = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, r * 0.2, b.x, b.y, r * 1.05);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.65, '#fafbf9'); grad.addColorStop(1, '#c4c9c6');
      circle(b.x, b.y, r, grad);
      // dimples, rolling with the ball
      ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, r - 0.5, 0, Math.PI * 2); ctx.clip();
      var ox = ((b.ox % dimpleSp) + dimpleSp) % dimpleSp, oy = ((b.oy % (dimpleRowH * 2)) + dimpleRowH * 2) % (dimpleRowH * 2);
      ctx.translate(b.x - r + ox, b.y - r + oy); ctx.fillStyle = dimpleTile; ctx.fillRect(-dimpleSp * 2, -dimpleRowH * 4, r * 2 + dimpleSp * 4, r * 2 + dimpleRowH * 8);
      ctx.restore();
      // sphere shading over the dimples: darker limb, plus a soft specular highlight
      var sh = ctx.createRadialGradient(b.x - r * 0.25, b.y - r * 0.3, r * 0.35, b.x, b.y, r);
      sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.72, 'rgba(40,50,45,0.05)'); sh.addColorStop(1, 'rgba(20,30,28,0.42)');
      circle(b.x, b.y, r, sh);
      var hl = ctx.createRadialGradient(b.x - r * 0.42, b.y - r * 0.45, 0, b.x - r * 0.42, b.y - r * 0.45, r * 0.5);
      hl.addColorStop(0, 'rgba(255,255,255,0.9)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.25)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      circle(b.x - r * 0.42, b.y - r * 0.45, r * 0.5, hl);
      // thin rim so the ball separates from the grass
      circle(b.x, b.y, r - 0.5, null, 'rgba(60,80,65,0.25)', 1);
      if (opts.current && opts.current === b.name) circle(b.x, b.y, r + 4, null, colors.pine[0], 3);   // your current pick
      if (opts.games && b.held && !game && now - holdStart >= HOLD_SHOW_MS) {   // ring appears late, fills over the last stretch
        var frac = Math.min(1, (now - holdStart - HOLD_SHOW_MS) / (HOLD_MS - HOLD_SHOW_MS));
        ctx.beginPath(); ctx.arc(b.x, b.y, r + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = colors.pine[0]; ctx.stroke();
      }
      var k = (b.r / 40) * b.scale;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111';
      ctx.font = '800 ' + Math.round(15 * k) + 'px ' + fontFamily;                 // the logo
      if (b.name.indexOf(' & ') >= 0) {                                             // couples: two lines
        var pair = b.name.split(' & ');
        ctx.font = '800 ' + Math.round(14 * k) + 'px ' + fontFamily;
        ctx.fillText(pair[0] + ' &', b.x, b.y - 12 * k); ctx.fillText(pair[1], b.x, b.y + 2 * k);
      } else ctx.fillText(b.name, b.x, b.y - 5 * k);
      ctx.font = '700 ' + Math.round(11 * k) + 'px ' + fontFamily;                 // play number
      var couple = b.name.indexOf(' & ') >= 0;
      ctx.fillText(String(b.num), b.x, b.y + (couple ? 17 : 10) * k);
      if (k > 0.8) {                                                                // sidestamp with alignment arrows
        ctx.fillStyle = 'rgba(17,17,17,0.85)'; ctx.font = '600 ' + Math.round(5.2 * k) + 'px ' + fontFamily;
        ctx.fillText('\u25C0  PRO G1  \u25B6', b.x, b.y + (couple ? 27 : 21) * k);
      }
      ctx.globalAlpha = 1;
    }
    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      if (game) { drawGame(now); return; }
      balls.forEach(function (b) { drawBubble(b, now); });
    }

    // ---- Mini golf ----
    var golf = null;
    var HOLES = [   // fractions of the arena; rects are bumpers, circles are rocks
      { par: 2, tee: [0.5, 0.88], cup: [0.5, 0.18], rects: [[0.12, 0.47, 0.58, 0.05]], circles: [] },
      { par: 3, tee: [0.16, 0.88], cup: [0.82, 0.18], rects: [[0.47, 0.0, 0.06, 0.58], [0.68, 0.72, 0.32, 0.05]], circles: [] },
      { par: 3, tee: [0.5, 0.9], cup: [0.18, 0.18], rects: [[0.0, 0.3, 0.42, 0.05], [0.58, 0.58, 0.42, 0.05]], circles: [[0.56, 0.42, 0.06]] }
    ];
    function startGolf() {
      golf = { hole: 0, strokes: 0, total: 0, t0: performance.now(), msg: null, done: false };
      loadHole();
    }
    function loadHole() {
      var def = HOLES[golf.hole], g = golf;
      g.def = def; g.strokes = 0; g.sunk = null; g.msg = null;
      g.ball = { x: def.tee[0] * W, y: def.tee[1] * H, vx: 0, vy: 0, r: 9, ox: 0, oy: 0, scale: 1, alpha: 1 };
      g.cup = { x: def.cup[0] * W, y: def.cup[1] * H, r: 13 };
      g.rects = def.rects.map(function (r) { return { x: r[0] * W, y: r[1] * H, w: r[2] * W, h: r[3] * H }; });
      g.circles = def.circles.map(function (c) { return { x: c[0] * W, y: c[1] * H, r: c[2] * W }; });
      g.putter = null; g.struck = false;
    }
    function golfPhysics(dt, now) {
      var g = golf, b = g.ball;
      if (g.sunk) {
        var t = (now - g.sunk) / 500;
        b.scale = Math.max(0, 1 - t * 0.9); b.alpha = Math.max(0, 1 - t);
        if (now - g.sunk > 1700) {
          if (g.hole + 1 < HOLES.length) { g.hole++; loadHole(); }
          else { g.done = g.done || now; }
        }
        if (g.done && now - g.done > 2600) { golf = null; }
        return;
      }
      var speed = Math.hypot(b.vx, b.vy);
      var fr = speed > 6 ? 0.991 : 0.978;
      b.vx *= Math.pow(fr, dt); b.vy *= Math.pow(fr, dt);
      if (speed < 0.06) { b.vx = 0; b.vy = 0; }
      // sub-step so fast putts can't tunnel through bumpers
      var steps = Math.max(1, Math.ceil(speed * dt / 4));
      for (var si = 0; si < steps; si++) {
        b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
        b.ox += b.vx * dt / steps; b.oy += b.vy * dt / steps;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.7; }
        if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.7; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.7; }
        if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.7; }
        g.rects.forEach(function (rc) {
          var cx = Math.max(rc.x, Math.min(rc.x + rc.w, b.x)), cy = Math.max(rc.y, Math.min(rc.y + rc.h, b.y));
          var dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
          if (d >= b.r) return;
          if (d < 0.001) { dx = b.vx ? -Math.sign(b.vx) : 0; dy = b.vy ? -Math.sign(b.vy) : 1; d = Math.hypot(dx, dy) || 1; }
          var nx = dx / d, ny = dy / d;
          b.x = cx + nx * b.r; b.y = cy + ny * b.r;
          var rel = b.vx * nx + b.vy * ny;
          if (rel < 0) { b.vx -= (1 + 0.7) * rel * nx; b.vy -= (1 + 0.7) * rel * ny; }
        });
        g.circles.forEach(function (c) {
          var dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy) || 0.01, min = b.r + c.r;
          if (d >= min) return;
          var nx = dx / d, ny = dy / d;
          b.x = c.x + nx * min; b.y = c.y + ny * min;
          var rel = b.vx * nx + b.vy * ny;
          if (rel < 0) { b.vx -= (1 + 0.7) * rel * nx; b.vy -= (1 + 0.7) * rel * ny; }
        });
        // the cup: drop in when over it and not too hot, otherwise it skips across the lip
        var cd = Math.hypot(b.x - g.cup.x, b.y - g.cup.y);
        if (cd < g.cup.r - 3 && speed < 6.5) {
          b.x = g.cup.x; b.y = g.cup.y; b.vx = 0; b.vy = 0;
          g.sunk = now; g.total += g.strokes;
          var diff = g.strokes - g.def.par;
          g.msg = g.strokes === 1 ? 'HOLE IN ONE!' : diff <= -2 ? 'EAGLE!' : diff === -1 ? 'BIRDIE!' : diff === 0 ? 'PAR' : diff === 1 ? 'BOGEY' : diff === 2 ? 'DOUBLE BOGEY' : 'IN THE HOLE';
          return;
        }
      }
      if (Math.hypot(b.x - g.cup.x, b.y - g.cup.y) < g.cup.r + 2 && speed >= 6.5) { b.vx *= 0.97; b.vy *= 0.97; g.lipFlash = now; }   // rattled the lip
    }
    function golfStrike(p, vel) {
      var g = golf, b = g.ball;
      if (!g || g.sunk || g.struck) return;
      if (Math.hypot(b.vx, b.vy) > 0.4) return;                      // wait for the ball to stop
      var sp = Math.hypot(vel.x, vel.y);
      if (sp < 1.5) return;
      if (Math.hypot(p.x - b.x, p.y - b.y) > b.r + 14) return;         // putter has to pass through the ball
      var cap = 24, k = Math.min(1, cap / sp);
      b.vx = vel.x * k * 0.95; b.vy = vel.y * k * 0.95;
      g.strokes++; g.struck = true; g.hitFlash = performance.now();
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function drawGolf(now) {
      var g = golf, b = g.ball;
      // bumpers (wood) and rocks
      g.rects.forEach(function (rc) {
        ctx.fillStyle = 'rgba(0,30,10,0.25)'; roundRect(rc.x + 2, rc.y + 4, rc.w, rc.h, 4); ctx.fill();
        var wood = ctx.createLinearGradient(0, rc.y, 0, rc.y + rc.h); wood.addColorStop(0, '#a9794a'); wood.addColorStop(1, '#6e4a28');
        ctx.fillStyle = wood; roundRect(rc.x, rc.y, rc.w, rc.h, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      });
      g.circles.forEach(function (c) {
        ctx.save(); ctx.translate(c.x, c.y + c.r * 0.5); ctx.scale(1, 0.4); circle(0, 0, c.r * 1.05, 'rgba(0,30,10,0.3)'); ctx.restore();
        var rock = ctx.createRadialGradient(c.x - c.r * 0.3, c.y - c.r * 0.35, c.r * 0.1, c.x, c.y, c.r);
        rock.addColorStop(0, '#9aa39b'); rock.addColorStop(1, '#4f5a52'); circle(c.x, c.y, c.r, rock, 'rgba(0,0,0,0.3)', 1);
      });
      // cup with flag
      circle(g.cup.x, g.cup.y, g.cup.r + 2, 'rgba(255,255,255,0.35)');
      circle(g.cup.x, g.cup.y, g.cup.r, '#10261a');
      circle(g.cup.x, g.cup.y - 2, g.cup.r - 3, '#06130c');
      ctx.strokeStyle = '#f2f2ea'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(g.cup.x, g.cup.y); ctx.lineTo(g.cup.x, g.cup.y - 46); ctx.stroke();
      ctx.fillStyle = '#e8403a'; ctx.beginPath(); ctx.moveTo(g.cup.x + 1, g.cup.y - 46); ctx.lineTo(g.cup.x + 26, g.cup.y - 38); ctx.lineTo(g.cup.x + 1, g.cup.y - 30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 9px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(g.hole + 1), g.cup.x + 11, g.cup.y - 38);
      // tee marker
      circle(g.def.tee[0] * W, g.def.tee[1] * H, 3, 'rgba(255,255,255,0.5)');
      // ball
      if (b.alpha > 0) drawBubble({ x: b.x, y: b.y, r: b.r, scale: b.scale, alpha: b.alpha, ox: b.ox, oy: b.oy, name: '', num: '' }, now);
      // putter following the finger
      if (g.putter && !g.sunk) {
        var pt = g.putter, ang = Math.atan2(pt.vy, pt.vx);
        ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate(ang + Math.PI / 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(-16, -4 + 3, 32, 9, 3); ctx.fill();
        var steel = ctx.createLinearGradient(0, -5, 0, 5); steel.addColorStop(0, '#e6e9ec'); steel.addColorStop(1, '#8e969e');
        ctx.fillStyle = steel; roundRect(-16, -5, 32, 9, 3); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, -42); ctx.stroke();   // shaft
        ctx.restore();
      }
      // HUD
      ctx.fillStyle = 'rgba(0,20,8,0.55)'; roundRect(8, 8, 150, 26, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 12px ' + fontFamily; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('Hole ' + (g.hole + 1) + '/' + HOLES.length + ' · Par ' + g.def.par + ' · Strokes ' + g.strokes, 16, 21);
      ctx.fillStyle = 'rgba(0,20,8,0.55)'; roundRect(W - 58, 8, 50, 26, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('quit', W - 33, 21);
      if (g.hitFlash && now - g.hitFlash < 500 && Math.hypot(b.vx, b.vy) > 0) { /* could add a sound later */ }
      if (g.msg) {
        var k = Math.min(1, (now - g.sunk) / 300);
        ctx.globalAlpha = 0.85 * k; ctx.fillStyle = colors.bg; ctx.fillRect(0, H / 2 - 56, W, 112); ctx.globalAlpha = k;
        ctx.fillStyle = colors.pine[0]; ctx.font = '800 30px ' + fontFamily; ctx.textAlign = 'center';
        ctx.fillText(g.done ? 'ROUND OVER' : g.msg, W / 2, H / 2 - 14);
        ctx.fillStyle = colors.fg; ctx.font = '600 14px ' + fontFamily;
        var par = HOLES.reduce(function (a, h) { return a + h.par; }, 0);
        ctx.fillText(g.done ? g.total + ' strokes on a par ' + par + ' course' : g.strokes + (g.strokes === 1 ? ' stroke' : ' strokes') + ' · par ' + g.def.par, W / 2, H / 2 + 20);
        ctx.globalAlpha = 1;
      }
      if (!g.strokes && !g.sunk && !g.putter) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 300); ctx.fillStyle = '#fff'; ctx.font = '600 12px ' + fontFamily; ctx.textAlign = 'center';
        ctx.fillText('swipe through the ball to putt', b.x, b.y + 26); ctx.globalAlpha = 1;
      }
    }

    // ---- Air hockey ----
    function startGame(paddle) {
      var gw = Math.round(W * 0.42);
      game = { me: paddle, t0: performance.now(), over: null,
        goal: { x1: (W - gw) / 2, x2: (W + gw) / 2 },
        cpu: { x: W / 2, y: 56, vx: 0, vy: 0, r: 28 },
        puck: { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 12 }, kickoff: true, humanHits: 0, cpuHits: 0 };
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
      if (g.kickoff) { cx = W / 2; cy = 56; }                                   // waiting for the human to start
      else if (p.y < H / 2 && p.y > c.y - 6) { cx = p.x; cy = p.y - 10; }      // puck in front: go hit it
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
      g.stuck = (ps < 0.6 && !g.kickoff) ? (g.stuck || 0) + dt : 0;
      if (g.stuck > 75) {                                       // ~1.25 s without moving
        p.x = W / 2; p.y = H / 2; g.stuck = 0;
        var dir = Math.random() < 0.5 ? -1 : 1;
        p.vx = (Math.random() - 0.5) * 4; p.vy = dir * 3.5; g.serveFlash = now;
      }
      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * 0.9; }
      if (p.x > W - p.r) { p.x = W - p.r; p.vx = -Math.abs(p.vx) * 0.9; }
      var inGoal = p.x > g.goal.x1 && p.x < g.goal.x2;
      var topOpen = g.cpuHits > 0 || g.humanHits > 1;        // first human hit can never be a goal
      if (p.y < p.r && (!inGoal || !topOpen)) { p.y = p.r; p.vy = Math.abs(p.vy) * 0.9; }
      if (p.y > H - p.r && !inGoal) { p.y = H - p.r; p.vy = -Math.abs(p.vy) * 0.9; }
      if (p.y < -p.r) endGame('human');
      if (p.y > H + p.r) endGame('cpu');
      [me, c].forEach(function (pad) {
        var dx = p.x - pad.x, dy = p.y - pad.y, d = Math.hypot(dx, dy) || 0.01, min = p.r + pad.r;
        if (d >= min) { pad.touching = false; return; }
        if (!pad.touching) { pad.touching = true; if (pad === me) { g.humanHits++; g.kickoff = false; } else g.cpuHits++; }
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
        var inG = p.x > g.goal.x1 && p.x < g.goal.x2, open2 = g.cpuHits > 0 || g.humanHits > 1;
        if (p.y < p.r && (!inG || !open2)) { p.y = p.r; p.vy = Math.abs(p.vy) + 1; }
        if (p.y > H - p.r && !inG) { p.y = H - p.r; p.vy = -Math.abs(p.vy) - 1; }
      });
    }
    function endGame(winner) {
      game.over = { winner: winner, t: performance.now() };
      if (store && store.recordWin) store.recordWin(winner, game.me.name).catch(function () { /* tally is best-effort */ });
    }
    function spark(x, y, size, color) {                                   // Claude's starburst mark
      ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2, size * 0.16);
      var rays = 12;
      for (var i = 0; i < rays; i++) {
        var a = (i / rays) * Math.PI * 2 - Math.PI / 2, len = size * (i % 3 === 0 ? 1 : (i % 3 === 1 ? 0.72 : 0.86));
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * size * 0.18, Math.sin(a) * size * 0.18); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke();
      }
      ctx.restore();
    }
    function mallet(x, y, r, color, label, isClaude) {
      circle(x, y + 3, r, colors.shadow);
      circle(x, y, r, color, 'rgba(0,0,0,0.22)', 3);                       // base disc with a rim
      circle(x, y, r * 0.66, color, 'rgba(0,0,0,0.28)', 2);                // raised handle
      if (isClaude) {
        circle(x, y, r * 0.56, colors.claude);
        spark(x, y, r * 0.46, colors.cream);
      } else {
        circle(x, y, r * 0.42, 'rgba(255,255,255,0.22)');                  // knob top
        ctx.beginPath(); ctx.arc(x - r * 0.12, y - r * 0.12, r * 0.3, Math.PI * 1.05, Math.PI * 1.65);
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();   // highlight
      }
      if (label) { ctx.fillStyle = colors.muted; ctx.font = '600 11px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y + r + 12); }
    }
    function drawGame(now) {
      var g = game, p = g.puck, c = g.cpu, me = g.me;
      var fade = Math.min(1, (now - g.t0) / 500);
      // rink: lay ice over the green
      ctx.globalAlpha = fade * 0.92; ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); ctx.setLineDash([]);
      circle(W / 2, H / 2, 46, null, colors.line, 2);
      ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.strokeStyle = colors.claude; ctx.beginPath(); ctx.moveTo(g.goal.x1, 3); ctx.lineTo(g.goal.x2, 3); ctx.stroke();
      ctx.strokeStyle = colors.pine[0]; ctx.beginPath(); ctx.moveTo(g.goal.x1, H - 3); ctx.lineTo(g.goal.x2, H - 3); ctx.stroke();
      ctx.font = '600 11px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = colors.muted;
      ctx.fillText('SHOOT HERE', W / 2, 18); ctx.fillText('DEFEND', W / 2, H - 18);
      ctx.globalAlpha = 1;
      // fading bubbles
      balls.forEach(function (b) { if (b.fade) { b.alpha = Math.max(0, 1 - fade); if (b.alpha > 0) drawBubble(b, now); } });
      // cpu mallet
      mallet(c.x, c.y, c.r, colors.claude, 'Claude', true);
      // puck
      if (g.kickoff && !g.over) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 300); ctx.fillStyle = colors.muted; ctx.font = '600 13px ' + fontFamily;
        ctx.fillText('hit the puck to start', W / 2, H / 2 + 64); ctx.globalAlpha = 1;
      }
      if (g.serveFlash && now - g.serveFlash < 900) {
        ctx.globalAlpha = 1 - (now - g.serveFlash) / 900; ctx.fillStyle = colors.muted; ctx.font = '600 13px ' + fontFamily;
        ctx.fillText('re-serve', W / 2, H / 2 + 64); ctx.globalAlpha = 1;
      }
      circle(p.x, p.y + 2, p.r, colors.shadow); circle(p.x, p.y, p.r, colors.fg); circle(p.x, p.y, p.r * 0.5, null, colors.bg, 1.5);
      // player mallet (the bubble shrinks into it)
      var k2 = Math.min(1, (now - g.t0) / 450);
      if (k2 < 1) { me.alpha = 1; drawBubble(me, now); }
      ctx.globalAlpha = k2; mallet(me.x, me.y, me.r, colors.pine[0], me.name); ctx.globalAlpha = 1;
      if (g.over) {
        var k = Math.min(1, (now - g.over.t) / 300);
        ctx.globalAlpha = 0.85 * k; ctx.fillStyle = colors.bg; ctx.fillRect(0, H / 2 - 60, W, 120); ctx.globalAlpha = k;
        ctx.fillStyle = g.over.winner === 'human' ? colors.pine[0] : colors.claude;
        ctx.font = '800 34px ' + fontFamily; ctx.fillText(g.over.winner === 'human' ? 'GOAL!' : 'CLAUDE SCORES', W / 2, H / 2 - 14);
        ctx.fillStyle = colors.fg; ctx.font = '600 15px ' + fontFamily;
        ctx.fillText(g.over.winner === 'human' ? me.name + ' beats Claude' : 'Nice try, ' + me.name, W / 2, H / 2 + 22);
        ctx.globalAlpha = 1;
      }
    }

    function step(now) {
      if (!running) return;
      var dt = Math.min(32, now - last) / 16.67; last = now;
      if (golf) {
        golfPhysics(dt, now);
        ctx.clearRect(0, 0, W, H);
        if (golf) drawGolf(now); else { balls.forEach(function (b) { drawBubble(b, now); }); }
        requestAnimationFrame(step); return;
      }
      if (game) {
        gamePhysics(dt, now);
        if (game.over && now - game.over.t > 2400) { running = false; renderRoster(); return; }   // back to the bubbles
      } else {
        physics(dt, now);
        if (opts.games && held && now - holdStart >= HOLD_MS && !popping) startGame(held);
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
      if (golf) {
        if (p.x > W - 58 && p.y < 34) { golf = null; return; }                 // quit
        golf.putter = { x: p.x, y: p.y, vx: 0, vy: 0 }; golf.struck = false; trail = [p];
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault(); return;
      }
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
      if (golf) {
        if (!golf.putter) return;
        var q = pos(e), old = trail[trail.length - 1];
        var dtm = Math.max(8, q.t - old.t) / 16.67;
        var vx = (q.x - old.x) / dtm, vy = (q.y - old.y) / dtm;
        golf.putter.x = q.x; golf.putter.y = q.y;
        if (Math.hypot(vx, vy) > 0.5) { golf.putter.vx = vx; golf.putter.vy = vy; }
        trail.push(q); if (trail.length > 6) trail.shift();
        golfStrike(q, { x: vx, y: vy });
        return;
      }
      if (!held) return;
      var p = pos(e);
      held.tx = p.x - held.gx; held.ty = p.y - held.gy;
      trail.push(p); if (trail.length > 6) trail.shift();
    });
    function release(e) {
      if (golf) { golf.putter = null; return; }
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
    function finishPick() { opts.onPick(pendingPick); }
    box.__golf = function () { return golf; };
    return { stop: function () { running = false; if (ro) ro.disconnect(); }, startGolf: startGolf, setCurrent: function (n) { opts.current = n; } };
  }
  $('switch').addEventListener('click', function () { me = null; myParty = null; lsDel('cabin-haul-me'); showScreen(); });
  $('golfword').addEventListener('click', function () { if (sim && sim.startGolf && !me) { sim.startGolf(); window.scrollTo({ top: $('roster').offsetTop - 12, behavior: 'smooth' }); } });

  function showScreen() {
    var picking = !me;
    $('predict').hidden = true;
    $('pick').hidden = !picking; $('main').hidden = picking; $('nav').hidden = picking;
    document.body.classList.toggle('picking', picking);
    if (picking) { renderRoster(); window.scrollTo(0, 0); return; }
    if (!booted) boot();
    if (shouldAsk()) { openQuestionnaire(firstUnanswered()); return; }
    var partner = PARTIES.filter(function (p) { return p.indexOf(me) >= 0; })[0].filter(function (n) { return n !== me; })[0];
    $('me').innerHTML = 'Hey <b>' + esc(me) + '</b>' + (partner ? ' · with ' + esc(partner) : '');
    showTab(tab);
    render();
  }

  // ---- Bottom tabs ----
  var TABS = ['home', 'bringing', 'cabin', 'photos'];
  var tab = 'cabin';
  function showTab(name) {
    tab = name;
    TABS.forEach(function (t) { $('page-' + t).hidden = t !== tab; });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    window.scrollTo(0, 0);
  }
  $('nav').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) showTab(b.getAttribute('data-tab')); });

  // ---- Photos tab ----
  var photos = [], photosLoaded = false, photoSub = false, uploadingCount = 0;
  function subscribePhotos() {
    if (photoSub || !store || !store.photos) return;
    photoSub = true;
    store.photos(function (rows) {
      photos = rows.slice().sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? 1 : -1; });
      photosLoaded = true; renderPhotos();
    }, function (e) {
      var grid = $('photo-grid'); if (grid && !photosLoaded) grid.innerHTML = '<div class="empty">Couldn\u2019t load the photos (' + esc((e && e.message) || e) + '). Pull down to refresh.</div>';
    });
  }
  function renderPhotos() {
    var grid = $('photo-grid'); if (!grid) return;
    var by = {};
    photos.forEach(function (ph) { by[ph.uploader] = (by[ph.uploader] || 0) + 1; });
    var names = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    $('photo-summary').textContent = photos.length ? plural(photos.length, 'photo', 'photos') + ' · ' + names.map(function (n) { return n + ' ' + by[n]; }).join(', ') : (photosLoaded ? 'No photos yet. You go first.' : '');
    var html = '';
    for (var u = 0; u < uploadingCount; u++) html += '<div class="tile uploading">Uploading…</div>';
    if (!photos.length && !uploadingCount) {
      html += photosLoaded ? '<div class="empty">Nothing here yet. Tap Add photos and the wall starts.</div>' : '<p class="skeleton">Loading photos…</p>';
    }
    photos.forEach(function (ph, i) {
      html += '<button type="button" class="tile" data-i="' + i + '"><img src="' + esc(store.photoUrl(ph)) + '" alt="Photo by ' + esc(ph.uploader) + '" loading="lazy">' +
        '<div class="who"><b>' + esc(ph.uploader === me ? 'you' : ph.uploader) + '</b> · ' + esc(ago(ph.created_at)) + '</div>' +
        (ph.uploader === me ? '<span class="rm" data-rm="' + esc(ph.id) + '" role="button" aria-label="Remove">×</span>' : '') + '</button>';
    });
    grid.innerHTML = html;
  }
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('Could not read that image')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not an image this phone can read')); };
      img.src = url;
    });
  }
  $('add-photos').addEventListener('click', function () { $('photo-input').click(); });
  $('photo-input').addEventListener('change', function () {
    var files = Array.prototype.slice.call($('photo-input').files || []);
    $('photo-input').value = '';
    if (!files.length) return;
    if (!store.uploadPhoto) { toast('Uploads are not available here.'); return; }
    uploadingCount += files.length; renderPhotos();
    var done = 0, failed = 0;
    files.reduce(function (chain, f) {
      return chain.then(function () {
        return shrinkImage(f).then(function (blob) { return store.uploadPhoto(blob, me); })
          .then(function (row) {
            done++;
            if (row && !photos.some(function (x) { return x.id === row.id; })) { photos.unshift(row); photosLoaded = true; }
          }).catch(function (e) { failed++; toast('One photo failed: ' + ((e && e.message) || e)); })
          .then(function () { uploadingCount--; renderPhotos(); });
      });
    }, Promise.resolve()).then(function () {
      if (done) toast(done + (done === 1 ? ' photo' : ' photos') + ' added' + (failed ? ', ' + failed + ' failed' : '') + '.');
    });
  });
  $('photo-grid').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-rm]');
    if (rm) {
      e.stopPropagation();
      var id = rm.getAttribute('data-rm'), ph = photos.filter(function (x) { return x.id === id; })[0];
      if (!ph) return;
      if (rm.getAttribute('data-armed') !== '1') { rm.setAttribute('data-armed', '1'); rm.textContent = '?'; toast('Tap again to remove your photo.'); setTimeout(function () { rm.removeAttribute('data-armed'); rm.textContent = '×'; }, 2500); return; }
      store.removePhoto(ph).then(function () { photos = photos.filter(function (x) { return x.id !== id; }); renderPhotos(); toast('Removed.'); })
        .catch(function (err) { toast('Couldn’t remove that: ' + ((err && err.message) || err)); });
      return;
    }
    var tile = e.target.closest('.tile[data-i]'); if (tile) openLightbox(+tile.getAttribute('data-i'));
  });
  function openLightbox(i) {
    var lb = $('lightbox'), track = $('lb-track');
    track.innerHTML = photos.map(function (ph) { return '<div class="lb-slide"><img src="' + esc(store.photoUrl(ph)) + '" alt=""></div>'; }).join('');
    lb.hidden = false; document.body.style.overflow = 'hidden';
    track.scrollLeft = track.clientWidth * i;
    lbCaption();
  }
  function lbCaption() {
    var track = $('lb-track'), i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)), ph = photos[i];
    $('lb-cap').textContent = ph ? (ph.uploader === me ? 'You' : ph.uploader) + ' · ' + ago(ph.created_at) + ' · ' + (i + 1) + ' of ' + photos.length : '';
  }
  $('lb-track').addEventListener('scroll', lbCaption, { passive: true });
  $('lb-close').addEventListener('click', function () { $('lightbox').hidden = true; $('lb-track').innerHTML = ''; document.body.style.overflow = ''; });

  // ---- Cabin tab ----
  var CABIN_PHOTOS = [    // published alongside the page
    { src: 'photos/cabin-01.jpg', cap: 'The house at dusk' },
    { src: 'photos/cabin-05.jpg', cap: 'Deck with the ski hill view' },
    { src: 'photos/cabin-04.jpg', cap: 'Patio, fire pit, and the hot tub' },
    { src: 'photos/cabin-02.jpg', cap: 'Great room' },
    { src: 'photos/cabin-09.jpg', cap: 'Fireplace' },
    { src: 'photos/cabin-03.jpg', cap: 'Kitchen island' },
    { src: 'photos/cabin-07.jpg', cap: 'Kitchen' },
    { src: 'photos/cabin-08.jpg', cap: 'Kitchen, the business end' },
    { src: 'photos/cabin-10.jpg', cap: 'Island seating for five' },
    { src: 'photos/cabin-06.jpg', cap: 'Dining room' },
    { src: 'photos/cabin-11.jpg', cap: 'Dining bar and wine fridge' },
    { src: 'photos/cabin-12.jpg', cap: 'Sitting nook' },
    { src: 'photos/cabin-13.jpg', cap: 'Bedroom' },
    { src: 'photos/cabin-14.jpg', cap: 'Bedroom' },
    { src: 'photos/cabin-15.jpg', cap: 'Bedroom with desk' },
    { src: 'photos/cabin-16.jpg', cap: 'Entry' }
  ];
  var CHECK_IN = new Date(2026, 9, 23, 16, 0, 0);
  function renderCabin() {
    var days = Math.ceil((CHECK_IN - Date.now()) / 86400000);
    $('cabin-countdown').textContent = days > 1 ? 'Winter Park, Colorado \u00b7 ' + days + ' days out' : days === 1 ? 'Winter Park, Colorado \u00b7 tomorrow' : days === 0 ? 'Winter Park, Colorado \u00b7 today' : 'Winter Park, Colorado';
    var car = $('carousel');
    if (!CABIN_PHOTOS.length) {
      car.innerHTML = '<div class="slide placeholder">Listing photos go here. Swipe through them once they\'re in.</div>';
      $('dots').innerHTML = ''; return;
    }
    car.innerHTML = CABIN_PHOTOS.map(function (ph, i) {
      return '<div class="slide"><img src="' + esc(ph.src) + '" alt="' + esc(ph.cap || 'Cabin photo ' + (i + 1)) + '" loading="' + (i ? 'lazy' : 'eager') + '"></div>';
    }).join('');
    $('dots').innerHTML = CABIN_PHOTOS.map(function (_, i) { return '<span' + (i === 0 ? ' class="on"' : '') + '></span>'; }).join('');
  }
  $('carousel').addEventListener('scroll', function () {
    var car = $('carousel'), i = Math.round(car.scrollLeft / (car.clientWidth + 10));
    Array.prototype.forEach.call($('dots').children, function (d, k) { d.classList.toggle('on', k === i); });
  }, { passive: true });
  $('copy-address').addEventListener('click', function () { copyText($('cabin-address').textContent, 'Address copied.'); });
  renderCabin();

  // ---- Predictions ----
  var QUESTIONS = [
    { id: 'passout', text: 'Who passes out somewhere that isn\'t a bed?', type: 'person' },
    { id: 'wrecked', text: 'Most fucked up', type: 'person' },
    { id: 'traffic', text: 'Who gets stuck in I-70 traffic the longest?', type: 'person' },
    { id: 'hottub', text: 'First into the hot tub', type: 'person' },
    { id: 'shots', text: 'Who\'s most likely to start shots?', type: 'person' },
    { id: 'cocktail', text: 'Who will make the best cocktail this weekend?', type: 'person' }
  ];
  var COUPLES = PARTIES.filter(function (p) { return p.length === 2; }).map(function (p) { return p.join(' & '); });
  var votes = [], qsim = null, qIndex = 0, predSub = false, expanded = null, comments = [], draft = '';
  function myVotes() { var m = {}; votes.forEach(function (v) { if (v.voter === me) m[v.question_id] = v.pick; }); return m; }
  function answeredCount() { return Object.keys(myVotes()).length; }
  function firstUnanswered() { var m = myVotes(); for (var i = 0; i < QUESTIONS.length; i++) if (!m[QUESTIONS[i].id]) return i; return 0; }
  function shouldAsk() {
    if (!me || !store || !store.predictions) return false;
    if (answeredCount() >= QUESTIONS.length) return false;
    return lsGet('cabin-haul-pred-later-' + me) !== '1';
  }
  function subscribePredictions() {
    if (predSub || !store || !store.predictions) return;
    predSub = true;
    store.predictions(function (rows) {
      votes = rows.slice();
      renderPredictions();
    });
    if (store.comments) store.comments(function (rows) {
      comments = rows.slice().sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? -1 : 1; });
      renderPredictions();
    });
  }
  function openQuestionnaire(index, skipIntro) {
    qIndex = Math.max(0, Math.min(QUESTIONS.length - 1, index || 0));
    $('main').hidden = true; $('nav').hidden = true; $('pick').hidden = true; $('predict').hidden = false;
    document.body.classList.add('picking');
    window.scrollTo(0, 0);
    if (skipIntro) { $('q-intro').hidden = true; $('q-wrap').hidden = false; showQuestion(false); return; }
    $('q-wrap').hidden = true; $('q-intro').hidden = false;
    $('q-intro-sub').textContent = answeredCount() ? 'You\'ve answered ' + answeredCount() + ' of ' + QUESTIONS.length + '. Pick up where you left off.' : 'Six quick calls. Everyone sees the running tally, nobody sees who picked whom.';
  }
  $('q-start').addEventListener('click', function () { $('q-intro').hidden = true; $('q-wrap').hidden = false; showQuestion(true); });
  $('q-intro-later').addEventListener('click', function () { lsSet('cabin-haul-pred-later-' + me, '1'); showScreen(); });
  var picking = false;
  function showQuestion(animate) {
    var q = QUESTIONS[qIndex], mine = myVotes()[q.id] || null;
    $('q-progress').textContent = 'Prediction ' + (qIndex + 1) + ' of ' + QUESTIONS.length;
    $('q-text').textContent = q.text;
    $('q-current').textContent = mine ? 'Your pick: ' + mine + '. Tap another to change it.' : (q.type === 'couple' ? 'Tap a couple.' : 'Tap a name. Yes, you can pick yourself.');
    var wrap = $('q-wrap');
    if (animate) { wrap.classList.remove('slide'); void wrap.offsetWidth; wrap.classList.add('slide'); }
    var names = q.type === 'couple' ? COUPLES : NAMES.slice().sort();
    $('q-grid').innerHTML = names.map(function (n) {
      return '<button type="button" class="pickbtn" data-pick="' + esc(n) + '" aria-pressed="' + (mine === n) + '">' + esc(n) + (mine === n ? '<span class="tick">\u2713</span>' : '') + '</button>';
    }).join('');
    picking = false;
  }
  $('q-grid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]'); if (!b || picking) return;
    picking = true;
    var q = QUESTIONS[qIndex], pick = b.getAttribute('data-pick');
    Array.prototype.forEach.call($('q-grid').children, function (el) { el.setAttribute('aria-pressed', String(el === b)); });
    store.vote(q.id, me, pick).catch(function (e2) { toast('That pick didn\'t save: ' + ((e2 && e2.message) || e2)); });
    votes = votes.filter(function (v) { return !(v.voter === me && v.question_id === q.id); });
    votes.push({ question_id: q.id, voter: me, pick: pick, updated_at: new Date().toISOString() });
    setTimeout(function () {
      if (qIndex + 1 < QUESTIONS.length) { qIndex++; showQuestion(true); }
      else { toast('Picks are in. You can change them any time from here.'); tab = 'home'; showScreen(); }
    }, 260);
  });
  $('q-later').addEventListener('click', function () { lsSet('cabin-haul-pred-later-' + me, '1'); showScreen(); });
  $('q-back').addEventListener('click', function () { if (qIndex > 0) { qIndex--; showQuestion(true); } });

  function tallyFor(q) {
    var counts = {}, voters = {}, who = {};
    votes.forEach(function (v) { if (v.question_id !== q.id) return; counts[v.pick] = (counts[v.pick] || 0) + 1; voters[v.voter] = true; (who[v.pick] = who[v.pick] || []).push(v.voter); });
    var rows = Object.keys(counts).map(function (k) { return { pick: k, n: counts[k], who: who[k].sort() }; }).sort(function (a, b) { return b.n - a.n || a.pick.localeCompare(b.pick); });
    return { rows: rows, voted: Object.keys(voters).length };
  }
  function renderPredictions() {
    var el = $('pred'); if (!el || !me) return;
    if (!store || !store.predictions) { el.hidden = true; return; }
    el.hidden = false;
    var left = QUESTIONS.length - answeredCount();
    var html = '<div class="pred-head"><span class="pred-count">' + (QUESTIONS.length - left) + ' of ' + QUESTIONS.length + ' answered</span>' +
      (left ? '<button type="button" class="nudge" id="pred-open">Make your picks (' + left + ' left)</button>' : '<button type="button" class="linkbtn" id="pred-open">Change my picks</button>') + '</div>';
    html += '<div class="pred-list">';
    QUESTIONS.forEach(function (q, i) {
      var t = tallyFor(q), lead = t.rows[0], second = t.rows[1];
      var cc = comments.filter(function (c) { return c.question_id === q.id; }).length;
      html += '<button type="button" class="pred-card' + (expanded === i ? ' open' : '') + '" data-q="' + i + '">' +
        '<div class="pq">' + esc(q.text) + '</div>' +
        '<div class="lead-row"><span class="lead">' + (lead ? esc(lead.pick) : '\u2014') + '</span>' + (second ? '<span class="then">then ' + esc(second.pick) + '</span>' : '') + '</div>' +
        '<div class="sub">' + t.voted + ' of ' + NAMES.length + ' voted' + (cc ? ' \u00b7 ' + cc + ' \uD83D\uDCAC' : '') + '<span class="chev">' + (expanded === i ? '\u25B2' : '\u25BC') + '</span></div></button>';
      if (expanded === i) html += detailFor(i);
    });
    html += '</div>';
    var hadFocus = document.activeElement && document.activeElement.id === 'chat-input';
    el.innerHTML = html;
    if (hadFocus) { var inp = $('chat-input'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
  }
  function detailFor(idx) {
    var html = '';
    var expandedIdx = idx;
    {
      var q = QUESTIONS[expandedIdx], t = tallyFor(q), max = t.rows.length ? t.rows[0].n : 1;
      html += '<div class="pred-detail">';
      if (!t.rows.length) html += '<div class="empty">No picks yet.</div>';
      t.rows.forEach(function (r) {
        html += '<div class="bar-row"><span class="bar-name">' + esc(r.pick) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + Math.round(100 * r.n / max) + '%"></span></span><span class="bar-n">' + r.n + '</span>' +
          '<span class="bar-who">' + esc(r.who.map(function (n) { return n === me ? 'you' : n; }).join(', ')) + '</span></div>';
      });
      html += '<div class="pred-actions"><button type="button" class="linkbtn" id="pred-change" data-q="' + expandedIdx + '">Change my pick</button><button type="button" class="linkbtn" id="pred-close">Close</button></div>';
      // the chat
      var thread = comments.filter(function (c) { return c.question_id === q.id; });
      html += '<div class="chat"><div class="chat-head">Talk it out' + (thread.length ? ' <span class="k">' + thread.length + '</span>' : '') + '</div>';
      if (!thread.length) html += '<div class="chat-empty">Nobody\'s said anything yet. Be the first to stir the pot.</div>';
      html += '<div class="chat-list" id="chat-list">' + thread.map(function (c) {
        return '<div class="msg' + (c.author === me ? ' mine' : '') + '"><span class="who">' + esc(c.author) + '</span> <span class="when">' + esc(ago(c.created_at)) + '</span><div class="txt">' + esc(c.text) + '</div></div>';
      }).join('') + '</div>';
      html += '<form class="chat-form" id="chat-form"><input type="text" id="chat-input" maxlength="240" placeholder="Say something\u2026" autocomplete="off" value="' + esc(draft) + '"><button type="submit" class="btn primary">Send</button></form></div></div>';
    }
    return html;
  }
  function ago(iso) {
    var t = Date.parse(iso || ''); if (!t) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm'; var h = Math.round(m / 60); if (h < 24) return h + 'h';
    return Math.round(h / 24) + 'd';
  }
  $('pred').addEventListener('input', function (e) { if (e.target.id === 'chat-input') draft = e.target.value; });
  $('pred').addEventListener('submit', function (e) {
    if (e.target.id !== 'chat-form') return;
    e.preventDefault();
    var input = $('chat-input'), text = input.value.replace(/\s+/g, ' ').trim();
    if (!text || expanded === null) return;
    var q = QUESTIONS[expanded];
    input.value = ''; draft = '';
    store.comment(q.id, me, text).catch(function (err) { toast('That didn\'t post: ' + ((err && err.message) || err)); });
    comments.push({ question_id: q.id, author: me, text: text, created_at: new Date().toISOString() });
    renderPredictions();
    var list = $('chat-list'); if (list) list.scrollTop = list.scrollHeight;
    var again = $('chat-input'); if (again) again.focus();
  });
  $('pred').addEventListener('click', function (e) {
    var open = e.target.closest('#pred-open'); if (open) { lsDel('cabin-haul-pred-later-' + me); openQuestionnaire(firstUnanswered(), answeredCount() >= QUESTIONS.length); return; }
    var ch = e.target.closest('#pred-change'); if (ch) { openQuestionnaire(+ch.getAttribute('data-q'), true); return; }
    if (e.target.closest('#pred-close')) { expanded = null; renderPredictions(); return; }
    var card = e.target.closest('.pred-card'); if (card) { var i = +card.getAttribute('data-q'); expanded = expanded === i ? null : i; draft = ''; renderPredictions(); var list = $('chat-list'); if (list) list.scrollTop = list.scrollHeight; }
  });

  // ---- Data ----
  var store = window.STORE, booted = false, items = [], busy = {}, live = false, itemsLoaded = false;
  var view = lsGet('cabin-haul-view') || 'items';
  var mode = 'bring';

  function boot() {
    booted = true;
    subscribePredictions();
    subscribePhotos();
    if (!store) { showSetup('No data layer loaded. The page is missing its store script.'); return; }
    store.init({
      onItems: function (rows) { items = rows.slice(); itemsLoaded = true; render(); },
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
      html = itemsLoaded ? '<div class="empty">Nothing on the list yet. Add the first thing above.</div>' : '<p class="skeleton">Loading the list\u2026</p>';
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
