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
  // The sportsbook look on Predictions is a lot. These people get the plain version of the page and the picks.
  var PLAIN_PICKS = ['Katelyn', 'Jess', 'Liv', 'Kelly', 'Gabby', 'Kyrsten'];
  function plainPicks() { return PLAIN_PICKS.indexOf(me) >= 0; }
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
  // Bump RESET_STAMP to send every phone back to the name screen once (used for clean-slate testing and before go-live).
  var RESET_STAMP = '2026-10-20-fresh';
  if (lsGet('cabin-haul-reset') !== RESET_STAMP) {
    lsDel('cabin-haul-me');
    try { Object.keys(localStorage).filter(function (k) { return k.indexOf('cabin-haul-pred-later-') === 0; }).forEach(lsDel); } catch (e) { /* ignore */ }
    lsSet('cabin-haul-reset', RESET_STAMP);
  }
  var me = lsGet('cabin-haul-me');
  if (me && !partyOf(me)) me = null;           // roster changed; ask again
  var myParty = me ? partyOf(me) : null;

  // Everyone as individuals, in a fixed shuffled order so couples aren't side by side.
  var NAMES = ['Mitch', 'Katelyn', 'Drew', 'Luke', 'Kelly', 'Gabby', 'Joe', 'Liv', 'Terry', 'Jess', 'Kyle', 'Kyrsten', 'Justin'];
  PARTIES.forEach(function (p) { p.forEach(function (n) { if (NAMES.indexOf(n) < 0) NAMES.push(n); }); });

  // ---- Bubble physics on a canvas: grab, fling, collide. A quick tap picks the name.
  //      Air hockey is played from the Games tab; mini golf is the one hidden game (the word "putt"). ----
  var sim = null, scores = null, scoresSub = false, boardShown = false;
  // Air hockey is always open from the Games tab. Mini golf is hidden on the name screen; once this phone has found it,
  // its board on the Games tab becomes a play button too.
  function foundGame(k) { return k === 'hockey' || lsGet('cabin-haul-found-' + k) === '1'; }
  function markFound(k) { if (foundGame(k)) return; lsSet('cabin-haul-found-' + k, '1'); renderArcadeCues(); }
  var arcadeFrom = null;   // the tab that launched a replay, so the game can hand back to it when it ends
  function playAgain(kind) {
    if (!me || !foundGame(kind) || arcadeFrom) return;
    arcadeFrom = tab; closeChat();
    $('main').hidden = true; $('nav').hidden = true; $('chat-fab').hidden = true; $('pick').hidden = false;
    renderRoster();
    if (kind === 'golf') { golfer = me; sim.startGolf(); } else sim.startHockey(me);
    buzz(6);
  }
  function arcadeExit() {   // a replay ended: back to the tab it came from
    var back = arcadeFrom; arcadeFrom = null;
    if (sim) sim.stop(); sim = null;
    if (!me) { showScreen(); return; }
    $('pick').hidden = true; tab = back || 'games'; showScreen();
  }
  function golfToPar(strokes, par) { var d = strokes - par; return d === 0 ? 'E' : d > 0 ? '+' + d : String(d); }
  var HOLD_MS = 5000, HOLD_SHOW_MS = 3000;
  // Claude's air hockey brain. speed/gain: how fast the mallet moves (px per frame, follow gain); react: ms between decisions
  // (its reaction time); wobble: aim noise in px; line: how far from its goal it blocks. Raise speed/gain or lower react/wobble to make it meaner.
  var HOCKEY_AI = { speed: 9, gain: 0.15, react: 90, wobble: 10, line: 64 };
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
  var ARENA_THEME = 'green';   // 'green' or 'trunk'. v1 (golf balls on the green) is branch v1-golf-green.
  function renderRoster() {
    if (sim) sim.stop();
    $('roster').classList.toggle('trunk', ARENA_THEME === 'trunk');
    golfer = null; renderGolfPost(false);
    boardShown = false;
    subscribeBoards();
    renderScores();
    sim = renderArena({ box: $('roster'), names: NAMES, games: false, replay: !!arcadeFrom, onExit: arcadeExit, onPick: function (name) {
      me = name; myParty = partyOf(me); lsSet('cabin-haul-me', me);
      showScreen();
    }, onGolfDone: function (total) {
      var who = golfer; golfer = null;
      if (!who || !store || !store.recordGolf) return;
      var par = 27, d = golfToPar(total, par);
      store.recordGolf(who, total).then(function () { toast(who + ' finished ' + (d === 'E' ? 'even' : d) + '. On the board.'); }).catch(function (err) { toast('Couldn\u2019t post that: ' + ((err && err.message) || err)); });
    } });
  }
  // mini golf: say who's putting before the round so the board can keep score
  var golfer = null;
  function renderGolfPost(show) {
    var el = $('golf-post'); if (!el) return;
    if (!show) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<div class="gp-card"><div class="gp-title">Who\u2019s putting?</div><div class="info-sub">Nine holes, par 27. Your best round goes on the board.</div>' +
      (foundGame('golf') ? '<div class="gp-hint">\u26F3 You\u2019ve found this one already. Pick your name, and the Mini golf board on the Games tab starts a round. No hunting.</div>' : '') +
      '<div class="name-grid">' + NAMES.map(function (n) { return '<button type="button" data-golfer="' + esc(n) + '" aria-pressed="false">' + esc(n) + '</button>'; }).join('') + '</div>' +
      '<div class="mafia-actions"><button type="button" class="linkbtn" id="golf-skip">Never mind</button></div></div>';
    $('roster').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('golf-post').addEventListener('click', function (e) {
    var b = e.target.closest('[data-golfer]');
    if (b) {
      golfer = b.getAttribute('data-golfer'); renderGolfPost(false);
      if (sim && sim.startGolf) { sim.startGolf(); window.scrollTo({ top: $('roster').offsetTop - 12, behavior: 'smooth' }); toast(golfer + ' is on the tee.'); }
      return;
    }
    if (e.target.closest('#golf-skip')) renderGolfPost(false);
  });
  // A physics arena of name balls. opts: box, names, onPick(name), games (hold a ball to start hockey; off, hockey starts from the Games tab), current (ring this name).
  function renderArena(opts) {
    var box = opts.box, names = opts.names;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.innerHTML = '<canvas class="arena" aria-hidden="true"></canvas><div class="sr-list">' +
      names.map(function (n) { return '<button type="button" data-me="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>';
    var cv = box.querySelector('canvas'), ctx = cv.getContext('2d');
    var W = 0, H = 0, dpr = 1;
    var playing = false;
    function setPlaying(on) {
      if (playing === on) return;
      playing = on;
      if (!on) box.classList.remove('hockey');
      document.body.classList.toggle('playing', on);
      if (on) window.scrollTo(0, 0);
      void box.offsetHeight;   // force layout so the new size is read now
      resize();
    }
    function resize() {
      dpr = Math.min(3, window.devicePixelRatio || 1);
      W = box.clientWidth; H = box.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimpleTile = null; layerCache = {}; scriptCache = {}; tableCache = null;
    }
    resize();
    var colors = {};
    function readColors() {
      colors = { pine: [cssVar('--pine'), cssVar('--pine-ink')], ball: ['#fbfbf7', '#1b2a22'],
        claude: cssVar('--claude') || '#d97757', cream: '#f5efe6',
        line: cssVar('--line'), fg: cssVar('--fg'), bg: cssVar('--bg'), muted: cssVar('--muted'), shadow: 'rgba(10,40,20,0.28)' };
    }
    readColors();
    var fontFamily = cssVar('--display'), font = '700 16px ' + fontFamily, scriptFamily = cssVar('--script') || 'cursive';
    if (document.fonts && document.fonts.load) { document.fonts.load(font).catch(function () { /* fallback font is fine */ }); document.fonts.load('400 20px ' + scriptFamily).then(function () { scriptCache = {}; }).catch(function () { /* fallback font is fine */ }); }

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

    function rollBy(b, dx, dy) {
      var d = Math.hypot(dx, dy); if (d < 0.01) return;
      var dir = Math.atan2(dy, dx);
      if (b.rollDir == null) b.rollDir = dir;
      var diff = Math.atan2(Math.sin(dir - b.rollDir), Math.cos(dir - b.rollDir));
      b.rollDir += diff * Math.min(1, 0.25 + d * 0.05);     // steer the spin axis toward the new heading
      b.roll = (b.roll || 0) + d / b.r;
      b.ox = (b.ox || 0) + dx; b.oy = (b.oy || 0) + dy;
      // the further it rolls, the more grass it picks up
      if (b.name) {
        b.dirt = (b.dirt || 0) + d / (b.r * 2 * Math.PI);
        if (b.nextStain == null) b.nextStain = 0.5;
        while (b.dirt >= b.nextStain && (!b.stain || b.stain.n < 60)) { stampStain(b); b.nextStain += 0.9 + Math.random() * 0.8; }
      }
    }
    function physics(dt, now) {
      var t = now / 1000;
      balls.forEach(function (b) {
        if (b.held) {
          var tx = Math.max(b.r, Math.min(W - b.r, b.tx)), ty = Math.max(b.r, Math.min(H - b.r, b.ty));
          b.vx = (tx - b.x) * 0.55; b.vy = (ty - b.y) * 0.55;
          b.x += b.vx * dt; b.y += b.vy * dt;
          rollBy(b, b.vx * dt, b.vy * dt);
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
        rollBy(b, b.vx * dt, b.vy * dt);
        if (b.x < b.r) { b.x = b.r; knock(b, b.vx, now); b.vx = Math.abs(b.vx) * 0.6; }
        if (b.x > W - b.r) { b.x = W - b.r; knock(b, b.vx, now); b.vx = -Math.abs(b.vx) * 0.6; }
        if (b.y < b.r) { b.y = b.r; knock(b, b.vy, now); b.vy = Math.abs(b.vy) * 0.6; }
        if (b.y > H - b.r) { b.y = H - b.r; knock(b, b.vy, now); b.vy = -Math.abs(b.vy) * 0.6; }
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
          knock(a, rel, now); knock(c, rel, now);
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
    // Dimple tile: concave dimples (shadow on the far wall, highlight on the near wall), tiled under the middle of each ball.
    var dimpleTile = null, dimpleSp = 0, dimpleRowH = 0;
    function dimpleAt(o, x, y, dr, alpha) {
      o.globalAlpha = alpha == null ? 1 : alpha;
      o.beginPath(); o.arc(x - 0.7, y - 0.7, dr, 0, Math.PI * 2); o.fillStyle = 'rgba(90,100,95,0.24)'; o.fill();     // shaded wall (top-left)
      o.beginPath(); o.arc(x + 0.7, y + 0.7, dr, 0, Math.PI * 2); o.fillStyle = 'rgba(255,255,255,1)'; o.fill();      // lit wall (bottom-right)
      o.beginPath(); o.arc(x, y, dr - 0.5, 0, Math.PI * 2); o.fillStyle = 'rgba(247,248,246,1)'; o.fill();           // dimple floor
      o.globalAlpha = 1;
    }
    function buildDimpleTile() {
      var sp = 8.6, rowH = sp * 0.866, dr = 2.75;
      var tw = sp, th = rowH * 2;
      var off = document.createElement('canvas'); off.width = Math.round(tw * dpr); off.height = Math.round(th * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      [[0, 0], [sp, 0], [sp / 2, rowH], [-sp / 2, rowH], [0, th], [sp, th], [sp / 2, -rowH]].forEach(function (c) { dimpleAt(o, c[0], c[1], dr); });
      dimpleTile = ctx.createPattern(off, 'repeat');
      try { dimpleTile.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) { /* older browsers: slightly soft dimples */ }
      dimpleSp = sp; dimpleRowH = rowH;
    }
    // Everything that doesn't move is pre-rendered once per ball size: the body under the rolling dimples, and the
    // limb dimples + shading + highlights over them. Per frame a ball is two image draws and one pattern fill.
    var layerCache = {};
    function ballLayers(r) {
      var key = Math.round(r * 2) + '@' + dpr;
      if (layerCache[key]) return layerCache[key];
      var size = Math.ceil(r * 2 + 4), c = size / 2;
      function make(draw) {
        var off = document.createElement('canvas'); off.width = Math.round(size * dpr); off.height = Math.round(size * dpr);
        var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0); draw(o); return off;
      }
      function circ(o, x, y, rr, fill) { o.beginPath(); o.arc(x, y, rr, 0, Math.PI * 2); o.fillStyle = fill; o.fill(); }
      var under = make(function (o) {
        var grad = o.createRadialGradient(c - r * 0.3, c - r * 0.3, r * 0.2, c, c, r * 1.05);
        grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.65, '#fdfdfc'); grad.addColorStop(1, '#d3d7d4');
        circ(o, c, c, r, grad);
      });
      var over = make(function (o) {
        var sh = o.createRadialGradient(c - r * 0.28, c - r * 0.32, r * 0.3, c, c, r);
        sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.6, 'rgba(40,50,45,0.03)'); sh.addColorStop(0.88, 'rgba(25,35,30,0.2)'); sh.addColorStop(1, 'rgba(15,25,20,0.4)');
        circ(o, c, c, r, sh);
        o.save(); o.beginPath(); o.arc(c, c, r, 0, Math.PI * 2); o.clip();
        var bounce = o.createRadialGradient(c + r * 0.1, c + r * 1.05, r * 0.2, c + r * 0.1, c + r * 1.05, r * 1.1);
        var bc = box.classList.contains('trunk') ? '60,62,64' : '70,150,85';
        bounce.addColorStop(0, 'rgba(' + bc + ',0.28)'); bounce.addColorStop(1, 'rgba(' + bc + ',0)');
        circ(o, c, c, r, bounce);
        o.restore();
        var hl = o.createRadialGradient(c - r * 0.4, c - r * 0.42, 0, c - r * 0.4, c - r * 0.42, r * 0.55);
        hl.addColorStop(0, 'rgba(255,255,255,0.75)'); hl.addColorStop(0.45, 'rgba(255,255,255,0.18)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
        circ(o, c - r * 0.4, c - r * 0.42, r * 0.55, hl);
        var hot = o.createRadialGradient(c - r * 0.45, c - r * 0.5, 0, c - r * 0.45, c - r * 0.5, r * 0.16);
        hot.addColorStop(0, 'rgba(255,255,255,1)'); hot.addColorStop(1, 'rgba(255,255,255,0)');
        circ(o, c - r * 0.45, c - r * 0.5, r * 0.16, hot);
        o.beginPath(); o.arc(c, c, r - 0.5, 0, Math.PI * 2); o.lineWidth = 1; o.strokeStyle = 'rgba(60,80,65,0.25)'; o.stroke();
      });
      var shadow = make(function (o) {
        o.save(); o.translate(c, c + r * 0.92); o.scale(1, 0.3);
        var cs = o.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.05);
        var sc = box.classList.contains('trunk') ? '0,0,0' : '5,30,12';
        cs.addColorStop(0, 'rgba(' + sc + ',0.55)'); cs.addColorStop(0.6, 'rgba(' + sc + ',0.25)'); cs.addColorStop(1, 'rgba(' + sc + ',0)');
        circ(o, 0, 0, r * 1.05, cs); o.restore();
      });
      layerCache[key] = { under: under, over: over, shadow: shadow, size: size };
      return layerCache[key];
    }
    // Grass stains: each ball keeps its own repeating stain tile, on the same lattice as the dimples so the two roll
    // together and the stain pools in the dimples the way it does on a real ball. A new smear is stamped every rotation or so.
    var STAIN_COLS = [[104, 146, 58], [122, 158, 62], [88, 128, 52], [140, 160, 70], [96, 138, 48]];
    // a hard knock against the rail or another ball leaves a scuff: a few fine scratches and a dull patch
    function knock(b, v, now) {
      if (!b.name || Math.abs(v) < 7.5 || (b.lastScuff && now - b.lastScuff < 1500)) return;
      var s = stainLayer(b); if (s.scuffs >= 10) return;
      b.lastScuff = now; stampScuff(b, Math.min(1, (Math.abs(v) - 7.5) / 8));
    }
    function stampScuff(b, hard) {
      var s = stainLayer(b), o = s.o;
      var x = Math.random() * s.pw, y = Math.random() * s.ph;
      var ang = (b.rollDir || 0) + Math.PI / 2 + (Math.random() - 0.5) * 0.8;   // scratches run across the roll
      var wraps = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      var a = 0.1 + hard * 0.12, n = 3 + Math.floor(Math.random() * 3 + hard * 2), len = 5 + Math.random() * 5 + hard * 4;
      wraps.forEach(function (w) {
        o.save(); o.translate(x + w[0] * s.pw, y + w[1] * s.ph); o.rotate(ang);
        var g = o.createRadialGradient(0, 0, 0, 0, 0, len * 0.9);                  // dull patch where the cover got roughed up
        g.addColorStop(0, 'rgba(70,76,72,' + (a * 0.5).toFixed(3) + ')'); g.addColorStop(1, 'rgba(70,76,72,0)');
        o.fillStyle = g; o.beginPath(); o.ellipse(0, 0, len * 0.9, len * 0.55, 0, 0, Math.PI * 2); o.fill();
        o.lineCap = 'round';
        for (var i = 0; i < n; i++) {                                              // the scratches
          var off = (i - (n - 1) / 2) * (1.6 + Math.random()), l = len * (0.5 + Math.random() * 0.6), tilt = (Math.random() - 0.5) * 0.25;
          var sx = (Math.random() - 0.5) * 3;
          o.beginPath(); o.moveTo(sx - l / 2 * Math.cos(tilt), off - l / 2 * Math.sin(tilt)); o.lineTo(sx + l / 2 * Math.cos(tilt), off + l / 2 * Math.sin(tilt));
          o.lineWidth = 0.6 + Math.random() * 0.5; o.strokeStyle = 'rgba(55,60,58,' + (a * (0.8 + Math.random() * 0.6)).toFixed(3) + ')'; o.stroke();
        }
        if (Math.random() < 0.5) { o.fillStyle = 'rgba(50,54,52,' + (a * 1.3).toFixed(3) + ')'; o.beginPath(); o.arc((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 0.9, 0, Math.PI * 2); o.fill(); }  // a nick
        o.restore();
      });
      s.scuffs = (s.scuffs || 0) + 1;
      s.pat = ctx.createPattern(s.c, 'repeat');
      try { s.pat.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) { /* ignore */ }
    }
    function stainLayer(b) {
      if (b.stain) return b.stain;
      if (!dimpleTile) buildDimpleTile();
      var pw = dimpleSp * 12, ph = dimpleRowH * 12;
      var off = document.createElement('canvas'); off.width = Math.round(pw * dpr); off.height = Math.round(ph * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.stain = { c: off, o: o, pat: null, pw: pw, ph: ph, n: 0, scuffs: 0 };
      return b.stain;
    }
    function stampStain(b) {
      var s = stainLayer(b), o = s.o, sp = dimpleSp, rowH = dimpleRowH;
      var x = Math.random() * s.pw, y = Math.random() * s.ph;
      var ang = (b.rollDir || 0) + (Math.random() - 0.5) * 0.7;
      var len = sp * (1.3 + Math.random() * 2.2), wid = sp * (0.55 + Math.random() * 0.6);
      var mud = Math.random() < 0.1, col = mud ? [112, 84, 46] : STAIN_COLS[Math.floor(Math.random() * STAIN_COLS.length)];
      var a = (mud ? 0.16 : 0.2) + Math.random() * 0.16;
      var rgba = function (k) { return 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + k.toFixed(3) + ')'; };
      var wraps = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      // the smear itself: a soft streak along the direction it was rolling
      wraps.forEach(function (w) {
        o.save(); o.translate(x + w[0] * s.pw, y + w[1] * s.ph); o.rotate(ang); o.scale(len, wid);
        var g = o.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, rgba(a)); g.addColorStop(0.55, rgba(a * 0.55)); g.addColorStop(1, rgba(0));
        o.fillStyle = g; o.beginPath(); o.arc(0, 0, 1, 0, Math.PI * 2); o.fill(); o.restore();
      });
      // and the darker bits that stay in the dimples
      var ca = Math.cos(ang), sa = Math.sin(ang), reach = len + sp;
      for (var j = Math.floor((y - reach) / rowH); j <= Math.ceil((y + reach) / rowH); j++) {
        var py = j * rowH, shift = (j & 1) ? sp / 2 : 0;
        for (var i = Math.floor((x - reach - shift) / sp); i <= Math.ceil((x + reach - shift) / sp); i++) {
          var px = i * sp + shift, u = (px - x) * ca + (py - y) * sa, v = -(px - x) * sa + (py - y) * ca;
          var dist = Math.hypot(u / len, v / wid); if (dist >= 1 || Math.random() < 0.38) continue;   // not every dimple takes it
          var da = a * 1.7 * Math.pow(1 - dist, 1.3) * (0.7 + Math.random() * 0.5);
          var qx = ((px % s.pw) + s.pw) % s.pw, qy = ((py % s.ph) + s.ph) % s.ph;
          o.fillStyle = rgba(Math.min(0.5, da));
          var dr = 1.7 + Math.random() * 0.6;
          wraps.forEach(function (w) { o.beginPath(); o.arc(qx + w[0] * s.pw, qy + w[1] * s.ph, dr, 0, Math.PI * 2); o.fill(); });
        }
      }
      s.n++;
      s.pat = ctx.createPattern(s.c, 'repeat');
      try { s.pat.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) { /* older browsers: slightly soft stains */ }
    }
    var scriptCache = {};
    function scriptSprite(text, px) {
      var key = text + '@' + Math.round(px * 4) + '@' + dpr;
      if (scriptCache[key]) return scriptCache[key];
      var w = Math.ceil(px * text.length * 0.75 + px), h = Math.ceil(px * 1.8);
      function layer() {
        var c = document.createElement('canvas'); c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        var o = c.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
        o.font = '400 ' + px + 'px ' + scriptFamily; o.textAlign = 'center'; o.textBaseline = 'middle';
        return { c: c, o: o };
      }
      // core: the brush glyphs with a hair shaved off every edge, so the strokes read as pen weight
      var core = layer();
      core.o.fillStyle = '#121212'; core.o.fillText(text, w / 2, h / 2);
      core.o.globalCompositeOperation = 'destination-out';
      core.o.lineWidth = Math.max(0.35, px * 0.03); core.o.lineJoin = 'round'; core.o.strokeStyle = '#000'; core.o.strokeText(text, w / 2, h / 2);
      // halo: the untouched glyphs, faint, underneath — keeps hairlines continuous where the shave bites through
      var out = layer();
      out.o.fillStyle = 'rgba(18,18,18,0.42)'; out.o.fillText(text, w / 2, h / 2);
      out.o.drawImage(core.c, 0, 0, w, h);
      scriptCache[key] = { canvas: out.c, w: w, h: h };
      return scriptCache[key];
    }
    function drawScript(text, x, y, px) {
      var sp = scriptSprite(text, px);
      ctx.drawImage(sp.canvas, x - sp.w / 2, y - sp.h / 2, sp.w, sp.h);
    }
    function drawBubble(b, now) {
      var r = b.r * b.scale, col = colors.ball;
      if (r < 1.5) return;
      if (!dimpleTile) buildDimpleTile();
      var L = ballLayers(r), half = L.size / 2;
      ctx.globalAlpha = b.alpha;
      ctx.drawImage(L.shadow, b.x - half, b.y - half, L.size, L.size);
      ctx.drawImage(L.under, b.x - half, b.y - half, L.size, L.size);
      // rolling dimples across the middle
      ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, r - 0.5, 0, Math.PI * 2); ctx.clip();
      var ox = ((b.ox % dimpleSp) + dimpleSp) % dimpleSp, oy = ((b.oy % (dimpleRowH * 2)) + dimpleRowH * 2) % (dimpleRowH * 2);
      ctx.translate(b.x - r + ox, b.y - r + oy); ctx.fillStyle = dimpleTile; ctx.fillRect(-dimpleSp * 2, -dimpleRowH * 4, r * 2 + dimpleSp * 4, r * 2 + dimpleRowH * 8);
      ctx.restore();
      if (b.stain && b.stain.pat) {                                                 // grass stains ride on the same lattice
        var s = b.stain, sx = (((b.ox || 0) % s.pw) + s.pw) % s.pw, sy = (((b.oy || 0) % s.ph) + s.ph) % s.ph;
        ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, r - 0.5, 0, Math.PI * 2); ctx.clip();
        ctx.translate(b.x - r + sx, b.y - r + sy); ctx.fillStyle = s.pat; ctx.fillRect(-s.pw, -s.ph, r * 2 + s.pw * 2, r * 2 + s.ph * 2);
        ctx.restore();
      }
      ctx.drawImage(L.over, b.x - half, b.y - half, L.size, L.size);
      if (opts.current && opts.current === b.name) circle(b.x, b.y, r + 4, null, colors.pine[0], 3);   // your current pick
      if (opts.games && b.held && !game && now - holdStart >= HOLD_SHOW_MS) {   // ring appears late, fills over the last stretch
        var frac = Math.min(1, (now - holdStart - HOLD_SHOW_MS) / (HOLD_MS - HOLD_SHOW_MS));
        ctx.beginPath(); ctx.arc(b.x, b.y, r + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = colors.pine[0]; ctx.stroke();
      }
      var k = (b.r / 40) * b.scale;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // the logo: brush script, thinned by eroding the glyph edges (cached per name and size)
      if (b.name.indexOf(' & ') >= 0) {
        var pair = b.name.split(' & ');
        drawScript(pair[0] + ' &', b.x, b.y - 12 * k, 15 * k); drawScript(pair[1], b.x, b.y + 2 * k, 15 * k);
      } else drawScript(b.name, b.x, b.y - 5 * k, 17 * k);
      ctx.fillStyle = '#d63a1f';                                                    // play number, in red
      ctx.font = '700 ' + Math.round(11 * k) + 'px ' + fontFamily;
      var couple = b.name.indexOf(' & ') >= 0;
      ctx.fillText(String(b.num), b.x, b.y + (couple ? 17 : 9) * k);
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
    var WALL_R = 7;   // half the thickness of the orange walls
    var OCT = [[0.2, 0.05], [0.8, 0.05], [0.93, 0.14], [0.93, 0.9], [0.8, 0.97], [0.2, 0.97], [0.07, 0.9], [0.07, 0.14]];
    // Courses in fractions of the arena. Every round picks three at random and fills each slot with a random obstacle.
    var COURSES = [
      { name: 'Straightaway', poly: OCT, walls: [], tee: [0.5, 0.87], cup: [0.5, 0.16],
        slots: [{ x: 0.5, y: 0.52, kinds: ['block', 'windmill', 'sand', 'water', 'slider'] }, { x: 0.5, y: 0.3, kinds: ['boost', 'sand', null], dir: [0, -1] }] },
      { name: 'Dogleg', poly: [[0.14, 0.05], [0.86, 0.05], [0.94, 0.13], [0.94, 0.36], [0.86, 0.44], [0.44, 0.44], [0.44, 0.9], [0.36, 0.97], [0.14, 0.97], [0.06, 0.9], [0.06, 0.13]], walls: [], tee: [0.25, 0.87], cup: [0.84, 0.24],
        slots: [{ x: 0.25, y: 0.62, kinds: ['sand', 'slider', 'water', 'block'], s: 0.7 }, { x: 0.62, y: 0.24, kinds: ['boost', 'windmill', 'sand'], dir: [1, 0], s: 0.8 }] },
      { name: 'The Split', poly: OCT, walls: [[[0.5, 0.3], [0.5, 0.7]]], tee: [0.5, 0.87], cup: [0.5, 0.16],
        slots: [{ x: 0.27, y: 0.5, kinds: ['sand', 'water', 'boost'], dir: [0, -1], s: 0.7 }, { x: 0.73, y: 0.5, kinds: ['boost', 'sand', 'slider'], dir: [0, -1], s: 0.65 }] },
      { name: 'Zigzag', poly: OCT, walls: [[[0.07, 0.4], [0.62, 0.4]], [[0.93, 0.66], [0.38, 0.66]]], tee: [0.5, 0.88], cup: [0.5, 0.16],
        slots: [{ x: 0.78, y: 0.53, kinds: ['sand', 'boost', 'water', null], dir: [0, -1], s: 0.6 }, { x: 0.24, y: 0.26, kinds: ['windmill', 'block', 'sand'], s: 0.6 }] },
      { name: 'Hourglass', poly: [[0.08, 0.05], [0.92, 0.05], [0.92, 0.36], [0.62, 0.5], [0.92, 0.64], [0.92, 0.97], [0.08, 0.97], [0.08, 0.64], [0.38, 0.5], [0.08, 0.36]], walls: [], tee: [0.5, 0.87], cup: [0.3, 0.19],
        slots: [{ x: 0.5, y: 0.5, kinds: ['windmill', 'slider', null], s: 0.55 }, { x: 0.7, y: 0.22, kinds: ['sand', 'water', 'block'], s: 0.6 }] }
    ];
    COURSES.push(
      { name: 'Switchback', poly: OCT, walls: [[[0.07, 0.3], [0.65, 0.3]], [[0.93, 0.52], [0.35, 0.52]], [[0.07, 0.74], [0.65, 0.74]]], tee: [0.3, 0.9], cup: [0.5, 0.14],
        slots: [{ x: 0.8, y: 0.41, kinds: ['sand', 'boost', null], dir: [0, -1], s: 0.55 }, { x: 0.2, y: 0.63, kinds: ['sand', 'water', null], s: 0.55 }] },
      { name: 'Island', poly: OCT, walls: [], tee: [0.5, 0.88], cup: [0.5, 0.14],
        slots: [{ x: 0.5, y: 0.5, kinds: ['water'], s: 1.1 }, { x: 0.5, y: 0.29, kinds: ['sand', 'slider', null], s: 0.6 }] },
      { name: 'Funnel', poly: [[0.38, 0.05], [0.62, 0.05], [0.62, 0.42], [0.94, 0.6], [0.94, 0.9], [0.86, 0.97], [0.14, 0.97], [0.06, 0.9], [0.06, 0.6], [0.38, 0.42]], walls: [], tee: [0.5, 0.88], cup: [0.5, 0.12],
        slots: [{ x: 0.5, y: 0.75, kinds: ['sand', 'block', 'windmill', null], s: 0.6 }, { x: 0.5, y: 0.3, kinds: ['boost', 'sand', null], dir: [0, -1], s: 0.5 }] },
      { name: 'The Hook', poly: [[0.06, 0.05], [0.54, 0.05], [0.62, 0.13], [0.62, 0.55], [0.94, 0.55], [0.94, 0.9], [0.86, 0.97], [0.52, 0.97], [0.44, 0.9], [0.44, 0.68], [0.14, 0.68], [0.06, 0.6]], walls: [], tee: [0.72, 0.9], cup: [0.2, 0.15],
        slots: [{ x: 0.32, y: 0.3, kinds: ['sand', 'windmill', null], s: 0.6 }, { x: 0.3, y: 0.6, kinds: ['boost', 'sand', null], dir: [-1, 0], s: 0.5 }] }
    );
    var GOLF_PAR = 3, GOLF_HOLES = 9;   // every layout once, par 27
    function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function startGolf() {
      markFound('golf');
      setPlaying(true);
      var order = COURSES.slice().sort(function () { return Math.random() - 0.5; }).slice(0, GOLF_HOLES);
      golf = { hole: 0, strokes: 0, total: 0, t0: performance.now(), msg: null, done: false, courses: order };
      loadHole();
    }
    // how far a bar centred at (x, y) can reach before the lane beside it closes: the distance from x to the farther of the two
    // playable edges (outer rail or inner wall) on that row, minus the rail's thickness
    function laneRoom(g, x, y) {
      var xs = [];
      g.segs.forEach(function (sg) {
        var a = sg[0], c = sg[1]; if ((a[1] > y) === (c[1] > y)) return;
        xs.push(a[0] + (y - a[1]) * (c[0] - a[0]) / (c[1] - a[1]));
      });
      xs.sort(function (p, q) { return p - q; });
      var left = -Infinity, right = Infinity;
      xs.forEach(function (v) { if (v <= x && v > left) left = v; if (v > x && v < right) right = v; });
      if (left === -Infinity) left = 0; if (right === Infinity) right = W;
      return Math.max(x - left, right - x) - WALL_R;
    }
    function inPoly(poly, x, y) {
      var inside = false;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    function segDist(x, y, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
    }
    function loadHole() {
      var g = golf, def = g.courses[g.hole];
      g.def = def; g.strokes = 0; g.sunk = null; g.msg = null; g.aim = null; g.drag = null; g.relief = null; g.splash = null; g.note = null;
      g.ball = { x: def.tee[0] * W, y: def.tee[1] * H, vx: 0, vy: 0, r: 9, ox: 0, oy: 0, scale: 1, alpha: 1 };
      g.lastPos = { x: g.ball.x, y: g.ball.y };
      g.cup = { x: def.cup[0] * W, y: def.cup[1] * H, r: 13 };
      g.poly = def.poly.map(function (p) { return [p[0] * W, p[1] * H]; });
      g.segs = [];
      for (var i = 0; i < g.poly.length; i++) g.segs.push([g.poly[i], g.poly[(i + 1) % g.poly.length]]);
      g.innerWalls = def.walls.map(function (w) { return w.map(function (p) { return [p[0] * W, p[1] * H]; }); });
      g.innerWalls.forEach(function (w) { for (var k = 0; k + 1 < w.length; k++) g.segs.push([w[k], w[k + 1]]); });
      // random obstacle per slot
      g.obs = [];
      def.slots.forEach(function (sl) {
        var kind = pickOne(sl.kinds); if (!kind) return;
        var s = sl.s || 1, x = sl.x * W, y = sl.y * H, o = { kind: kind, x: x, y: y };
        // a bar can never seal the hole: it has to leave a lane at least a ball-and-a-half wide to the nearer-open rail
        var room = kind === 'block' || kind === 'slider' ? laneRoom(g, x, y) : 0, LANE = 30;
        if (kind === 'block') { o.w = Math.min(0.4 * s * W, 2 * (room - LANE)); if (o.w < 24) return; o.h = 0.045 * H; o.rect = { x: x - o.w / 2, y: y - o.h / 2, w: o.w, h: o.h }; }
        else if (kind === 'slider') { o.w = Math.min(0.22 * s * W, 2 * (room - LANE)); if (o.w < 24) return; o.h = 0.045 * H; o.travel = Math.max(0, Math.min(0.12 * s * W, room - LANE - o.w / 2)); o.period = 2400 + Math.random() * 800; o.rect = { x: x - o.w / 2, y: y - o.h / 2, w: o.w, h: o.h }; o.vx = 0; }
        else if (kind === 'sand') { o.rx = 0.17 * s * W; o.ry = 0.085 * s * W; }
        else if (kind === 'water') { o.w = 0.3 * s * W; o.h = 0.12 * s * H; o.rect = { x: x - o.w / 2, y: y - o.h / 2, w: o.w, h: o.h }; }
        else if (kind === 'boost') { var d = sl.dir || [0, -1], along = 0.18 * H * s, across = 0.12 * W * s; o.dir = d; o.w = d[0] ? along : across; o.h = d[0] ? across : along; o.rect = { x: x - o.w / 2, y: y - o.h / 2, w: o.w, h: o.h }; }
        else if (kind === 'windmill') { o.arm = 0.13 * s * W; o.hub = 9; o.period = 2800 + Math.random() * 1200; o.spin = Math.random() < 0.5 ? 1 : -1; o.ang = 0; }
        g.obs.push(o);
      });
      // trees and flowers in the rough
      g.trees = []; g.flowers = [];
      var tries = 0;
      while (g.trees.length < 7 && tries++ < 80) {
        var tx = Math.random() * W, ty = 48 + Math.random() * (H - 48), tr = 16 + Math.random() * 8;   // never under the HUD
        if (inPoly(g.poly, tx, ty)) continue;
        if (g.segs.some(function (sg) { return segDist(tx, ty, sg[0], sg[1]) < tr + WALL_R + 4; })) continue;
        if (g.trees.some(function (t) { return Math.hypot(t.x - tx, t.y - ty) < (t.r + tr) * 1.1; })) continue;
        g.trees.push({ x: tx, y: ty, r: tr });
      }
      tries = 0;
      while (g.flowers.length < 9 && tries++ < 80) {
        var fx = Math.random() * W, fy = 46 + Math.random() * (H - 46);
        if (inPoly(g.poly, fx, fy)) continue;
        if (g.segs.some(function (sg) { return segDist(fx, fy, sg[0], sg[1]) < 12; })) continue;
        if (g.trees.some(function (t) { return Math.hypot(t.x - fx, t.y - fy) < t.r + 10; })) continue;
        g.flowers.push({ x: fx, y: fy, c: pickOne(['#ff6fae', '#ffd23f', '#7ec8ff', '#ffffff']) });
      }
      g.courseImg = null;
    }
    function golfPhysics(dt, now) {
      var g = golf, b = g.ball;
      // obstacle motion
      g.obs.forEach(function (o) {
        if (o.kind === 'slider') { var ph = (now - g.t0) / o.period * Math.PI * 2, nx = o.x + Math.sin(ph) * o.travel - o.w / 2; o.vx = (nx - o.rect.x) / Math.max(0.5, dt); o.rect.x = nx; }
        else if (o.kind === 'windmill') { o.ang = (now - g.t0) / o.period * Math.PI * 2 * o.spin; }
      });
      if (g.sunk) {
        var t = (now - g.sunk) / 500;
        b.scale = Math.max(0, 1 - t * 0.9); b.alpha = Math.max(0, 1 - t);
        if (now - g.sunk > 1700) {
          if (g.hole + 1 < g.courses.length) { g.hole++; loadHole(); }
          else if (!g.done) { g.done = now; if (opts.onGolfDone) opts.onGolfDone(g.total); }
        }
        if (g.done && now - g.done > 2600) { golf = null; }
        return;
      }
      if (g.splash) {   // in the drink: sink, then back to where the putt was played from, one stroke penalty
        var st = (now - g.splash.t0) / 600;
        b.alpha = Math.max(0, 1 - st * 1.6); b.scale = Math.max(0.2, 1 - st * 0.8);
        if (st >= 1) { b.x = g.lastPos.x; b.y = g.lastPos.y; b.vx = 0; b.vy = 0; b.alpha = 1; b.scale = 1; g.strokes++; g.splash = null; g.note = { text: 'SPLASH! +1', t0: now }; }
        return;
      }
      if (g.relief) {   // free relief: ease the ball clear of whatever it stopped against
        var rt = Math.min(1, (now - g.relief.t0) / 320), re = 1 - Math.pow(1 - rt, 3);
        b.x = g.relief.x0 + (g.relief.x - g.relief.x0) * re; b.y = g.relief.y0 + (g.relief.y - g.relief.y0) * re;
        if (rt >= 1) g.relief = null;
        return;
      }
      var speed = Math.hypot(b.vx, b.vy);
      var fr = speed > 6 ? 0.991 : 0.978;
      b.vx *= Math.pow(fr, dt); b.vy *= Math.pow(fr, dt);
      if (speed < 0.3) { b.vx = 0; b.vy = 0; if (speed > 0) golfRelief(g, now); }
      // sub-step so fast putts can't tunnel through walls
      var steps = Math.max(1, Math.ceil(speed * dt / 4)), sdt = dt / steps;
      for (var si = 0; si < steps; si++) {
        b.x += b.vx * sdt; b.y += b.vy * sdt;
        rollBy(b, b.vx * sdt, b.vy * sdt);
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.7; }
        if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.7; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.7; }
        if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.7; }
        for (var k = 0; k < g.segs.length; k++) capsuleHit(b, g.segs[k][0], g.segs[k][1], WALL_R, 0.7, 0, 0);
        for (var oi = 0; oi < g.obs.length; oi++) {
          var o = g.obs[oi];
          if (o.kind === 'block') rectHit(b, o.rect, 0.7, 0);
          else if (o.kind === 'slider') rectHit(b, o.rect, 0.7, o.vx);
          else if (o.kind === 'windmill') {
            var om = Math.PI * 2 / o.period * 16.67 * o.spin;   // radians per frame
            for (var a = 0; a < 2; a++) {
              var th = o.ang + a * Math.PI / 2, ex = Math.cos(th) * o.arm, ey = Math.sin(th) * o.arm;
              if (capsuleHit(b, [o.x - ex, o.y - ey], [o.x + ex, o.y + ey], 5, 0.6, 0, 0)) { b.vx += -om * (b.y - o.y) * 0.8; b.vy += om * (b.x - o.x) * 0.8; }
            }
            circleHit(b, o.x, o.y, o.hub, 0.7);
          }
          else if (o.kind === 'sand') { var ddx = (b.x - o.x) / o.rx, ddy = (b.y - o.y) / o.ry; if (ddx * ddx + ddy * ddy < 1) { var sf = Math.pow(0.94, sdt); b.vx *= sf; b.vy *= sf; } }
          else if (o.kind === 'water') { if (b.x > o.rect.x && b.x < o.rect.x + o.rect.w && b.y > o.rect.y && b.y < o.rect.y + o.rect.h) { g.splash = { x: b.x, y: b.y, t0: now }; b.vx = 0; b.vy = 0; buzz([10, 40, 10]); return; } }
          else if (o.kind === 'boost') {
            if (b.x > o.rect.x && b.x < o.rect.x + o.rect.w && b.y > o.rect.y && b.y < o.rect.y + o.rect.h) {
              b.vx += o.dir[0] * 0.7 * sdt; b.vy += o.dir[1] * 0.7 * sdt;
              var bs = Math.hypot(b.vx, b.vy); if (bs > 20) { b.vx *= 20 / bs; b.vy *= 20 / bs; }
            }
          }
        }
        // the cup: the ball drops when its centre gets over the hole, and the faster it's going the closer to
        // dead centre it has to be. Anything whose line misses that zone catches the rim and kicks out.
        var cd = Math.hypot(b.x - g.cup.x, b.y - g.cup.y);
        var capR = speed < 3 ? g.cup.r - 2 : speed < 7 ? g.cup.r - 4 : speed < 11 ? g.cup.r * 0.4 : -1;
        if (cd < g.cup.r && cd > 0 && speed < 2.5) { var pull = 0.3 * sdt; b.vx += (g.cup.x - b.x) / cd * pull; b.vy += (g.cup.y - b.y) / cd * pull; }   // teetering on the edge: it topples in
        if (cd >= capR && cd < g.cup.r + b.r * 0.7 && speed >= 2.5 && now - (g.lipT || 0) > 250) {
          var perp = Math.abs((g.cup.x - b.x) * b.vy - (g.cup.y - b.y) * b.vx) / speed;   // how close the line of the putt passes to the centre
          if (perp >= capR) {   // lip-out: the rim throws it sideways and takes some pace
            g.lipT = now; g.lipFlash = now;
            var ax = (b.x - g.cup.x) / cd, ay = (b.y - g.cup.y) / cd, kick = speed * 0.45;
            b.vx = b.vx * 0.75 + ax * kick; b.vy = b.vy * 0.75 + ay * kick;
          }
        }
        if (cd < capR) {
          b.x = g.cup.x; b.y = g.cup.y; b.vx = 0; b.vy = 0;
          g.sunk = now; g.total += g.strokes;
          var diff = g.strokes - GOLF_PAR;
          g.msg = g.strokes === 1 ? 'HOLE IN ONE!' : diff <= -2 ? 'EAGLE!' : diff === -1 ? 'BIRDIE!' : diff === 0 ? 'PAR' : diff === 1 ? 'BOGEY' : diff === 2 ? 'DOUBLE BOGEY' : 'IN THE HOLE';
          buzz([8, 30, 8]);
          return;
        }
      }
    }
    function capsuleHit(b, a, c, rad, rest, svx, svy) {
      var dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((b.x - a[0]) * dx + (b.y - a[1]) * dy) / l2)) : 0;
      var cx = a[0] + dx * t, cy = a[1] + dy * t, ex = b.x - cx, ey = b.y - cy, d = Math.hypot(ex, ey), min = rad + b.r;
      if (d >= min) return false;
      if (d < 0.001) { ex = -dy; ey = dx; d = Math.hypot(ex, ey) || 1; }
      var nx = ex / d, ny = ey / d;
      b.x = cx + nx * min; b.y = cy + ny * min;
      var rel = (b.vx - svx) * nx + (b.vy - svy) * ny;
      if (rel < 0) { b.vx -= (1 + rest) * rel * nx; b.vy -= (1 + rest) * rel * ny; }
      return true;
    }
    function rectHit(b, rc, rest, svx) {
      var cx = Math.max(rc.x, Math.min(rc.x + rc.w, b.x)), cy = Math.max(rc.y, Math.min(rc.y + rc.h, b.y));
      var dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
      if (d >= b.r) return false;
      if (d < 0.001) { dx = b.vx ? -Math.sign(b.vx) : 0; dy = b.vy ? -Math.sign(b.vy) : 1; d = Math.hypot(dx, dy) || 1; }
      var nx = dx / d, ny = dy / d;
      b.x = cx + nx * b.r; b.y = cy + ny * b.r;
      var rel = (b.vx - (svx || 0)) * nx + b.vy * ny;
      if (rel < 0) { b.vx -= (1 + rest) * rel * nx; b.vy -= (1 + rest) * rel * ny; }
      return true;
    }
    function circleHit(b, x, y, r, rest) {
      var dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy) || 0.01, min = b.r + r;
      if (d >= min) return false;
      var nx = dx / d, ny = dy / d;
      b.x = x + nx * min; b.y = y + ny * min;
      var rel = b.vx * nx + b.vy * ny;
      if (rel < 0) { b.vx -= (1 + rest) * rel * nx; b.vy -= (1 + rest) * rel * ny; }
      return true;
    }
    function golfRelief(g, now) {   // nudge a stopped ball clear of walls and blocks so there's room to swing
      var b = g.ball, gap = b.r + 18, x = b.x, y = b.y;
      for (var it = 0; it < 3; it++) {
        g.segs.forEach(function (sg) {
          var a = sg[0], c = sg[1], dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
          var cx = a[0] + dx * t, cy = a[1] + dy * t, ex = x - cx, ey = y - cy, d = Math.hypot(ex, ey), min = WALL_R + gap;
          if (d >= min || d < 0.001) return;
          x = cx + ex / d * min; y = cy + ey / d * min;
        });
        g.obs.forEach(function (o) {
          if (o.kind === 'block' || o.kind === 'slider') {
            var rc = o.rect, cx = Math.max(rc.x, Math.min(rc.x + rc.w, x)), cy = Math.max(rc.y, Math.min(rc.y + rc.h, y));
            var dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
            if (d >= gap) return;
            if (d < 0.001) { dx = 0; dy = y < rc.y + rc.h / 2 ? -1 : 1; d = 1; }
            x = cx + dx / d * gap; y = cy + dy / d * gap;
          } else if (o.kind === 'windmill') {
            var ddx = x - o.x, ddy = y - o.y, dd = Math.hypot(ddx, ddy) || 0.01, mn = o.hub + gap;
            if (dd < mn) { x = o.x + ddx / dd * mn; y = o.y + ddy / dd * mn; }
          }
        });
      }
      if (Math.hypot(x - b.x, y - b.y) < 1) return;
      g.relief = { x0: b.x, y0: b.y, x: x, y: y, t0: now }; g.reliefFlash = now;
    }
    function golfCanPutt(g) { return g && !g.sunk && !g.relief && !g.splash && Math.hypot(g.ball.vx, g.ball.vy) < 1; }
    function golfAim(g, p) {   // pull back from where the finger landed; the ball goes the other way
      var dx = p.x - g.drag.x, dy = p.y - g.drag.y, d = Math.hypot(dx, dy);
      if (d < 6) { g.aim = null; return; }
      g.aim = { angle: Math.atan2(-dy, -dx), power: Math.min(1, (d - 6) / 130) };
    }
    function golfPutt(g, now) {
      var a = g.aim, b = g.ball; g.aim = null; g.drag = null;
      if (!a || a.power < 0.04 || !golfCanPutt(g)) return;
      var v = 3 + a.power * 21;
      g.lastPos = { x: b.x, y: b.y };
      b.vx = Math.cos(a.angle) * v; b.vy = Math.sin(a.angle) * v;
      g.strokes++; g.hitFlash = now;
      buzz(8);
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    // ---- course art: flat, bright, chunky. Painted once per hole into an image; the frame just blits it ----
    var grassTiles = {};
    function grassTile(base, dark, light) {
      var key = base + dark + light;
      if (grassTiles[key]) return grassTiles[key];
      var t = document.createElement('canvas'), ts = 48; t.width = ts * 2; t.height = ts * 2;
      var o = t.getContext('2d'); o.setTransform(2, 0, 0, 2, 0, 0);
      o.fillStyle = base; o.fillRect(0, 0, ts, ts);
      for (var i = 0; i < 90; i++) {
        o.fillStyle = i % 3 ? dark : light; o.globalAlpha = 0.28 + Math.random() * 0.25;
        o.beginPath(); o.arc(Math.random() * ts, Math.random() * ts, 0.6 + Math.random() * 1.1, 0, Math.PI * 2); o.fill();
      }
      grassTiles[key] = t; return t;
    }
    function orangeStroke(o, pathFn, width) {   // a chunky wall with a dark base and a lit top edge
      o.lineJoin = 'round'; o.lineCap = 'round';
      o.save(); o.translate(0, 5); o.strokeStyle = '#a63b0a'; o.lineWidth = width; pathFn(); o.stroke(); o.restore();
      o.strokeStyle = '#ee6a22'; o.lineWidth = width; pathFn(); o.stroke();
      o.save(); o.translate(0, -2); o.strokeStyle = '#ff9448'; o.lineWidth = Math.max(2, width - 7); pathFn(); o.stroke(); o.restore();
    }
    function orangeBlock(o, rc) {
      function rr(x, y, w, h, r) { o.beginPath(); o.moveTo(x + r, y); o.arcTo(x + w, y, x + w, y + h, r); o.arcTo(x + w, y + h, x, y + h, r); o.arcTo(x, y + h, x, y, r); o.arcTo(x, y, x + w, y, r); o.closePath(); }
      o.fillStyle = 'rgba(0,40,0,0.25)'; rr(rc.x + 3, rc.y + 8, rc.w, rc.h, 6); o.fill();
      o.fillStyle = '#a63b0a'; rr(rc.x, rc.y + 5, rc.w, rc.h, 6); o.fill();
      o.fillStyle = '#ee6a22'; rr(rc.x, rc.y, rc.w, rc.h, 6); o.fill();
      o.fillStyle = '#ff9448'; rr(rc.x + 4, rc.y + 3, rc.w - 8, Math.max(3, rc.h * 0.3), 3); o.fill();
    }
    function drawTree(o, x, y, r) {
      o.fillStyle = 'rgba(0,40,0,0.28)'; o.beginPath(); o.ellipse(x + r * 0.45, y + r * 0.5, r * 1.1, r * 0.55, 0, 0, Math.PI * 2); o.fill();
      var layers = [[0, 1], [-0.55, 0.8], [-1.0, 0.58]];
      layers.forEach(function (L) {
        var ly = y + L[0] * r, lr = L[1] * r;
        o.fillStyle = '#2b9a2a'; o.beginPath(); o.arc(x, ly + 4, lr, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#45cf3c'; o.beginPath(); o.arc(x, ly, lr, 0, Math.PI * 2); o.fill();
        o.fillStyle = 'rgba(255,255,255,0.22)'; o.beginPath(); o.arc(x - lr * 0.3, ly - lr * 0.35, lr * 0.35, 0, Math.PI * 2); o.fill();
      });
    }
    function drawFlower(o, x, y, c) {
      for (var i = 0; i < 5; i++) { var a = i / 5 * Math.PI * 2; o.fillStyle = c; o.beginPath(); o.arc(x + Math.cos(a) * 3.6, y + Math.sin(a) * 3.6, 2.6, 0, Math.PI * 2); o.fill(); }
      o.fillStyle = c === '#ffd23f' ? '#fff' : '#ffd23f'; o.beginPath(); o.arc(x, y, 2.2, 0, Math.PI * 2); o.fill();
    }
    function buildCourseImage(g) {
      var off = document.createElement('canvas'); off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      function rr(x, y, w, h, r) { o.beginPath(); o.moveTo(x + r, y); o.arcTo(x + w, y, x + w, y + h, r); o.arcTo(x + w, y + h, x, y + h, r); o.arcTo(x, y + h, x, y, r); o.arcTo(x, y, x + w, y, r); o.closePath(); }
      function polyPath(pts, close) { o.beginPath(); pts.forEach(function (p, i) { if (i) o.lineTo(p[0], p[1]); else o.moveTo(p[0], p[1]); }); if (close) o.closePath(); }
      // rough, then the fairway
      var rough = o.createPattern(grassTile('#3f9238', '#347d2e', '#4aa442'), 'repeat'); o.fillStyle = rough; o.fillRect(0, 0, W, H);
      var fair = o.createPattern(grassTile('#5fbd4b', '#52ab40', '#6fcb5a'), 'repeat');
      polyPath(g.poly, true); o.fillStyle = fair; o.fill();
      // static obstacles
      g.obs.forEach(function (ob) {
        if (ob.kind === 'sand') {
          o.fillStyle = 'rgba(0,40,0,0.18)'; o.beginPath(); o.ellipse(ob.x + 2, ob.y + 4, ob.rx, ob.ry, 0, 0, Math.PI * 2); o.fill();
          o.fillStyle = '#ecd49f'; o.beginPath(); o.ellipse(ob.x, ob.y, ob.rx, ob.ry, 0, 0, Math.PI * 2); o.fill();
          o.strokeStyle = '#cdb074'; o.lineWidth = 3; o.stroke();
          o.fillStyle = '#d9bd83';
          for (var i = 0; i < 26; i++) { var a = Math.random() * Math.PI * 2, rd = Math.sqrt(Math.random()) * 0.85; o.beginPath(); o.arc(ob.x + Math.cos(a) * rd * ob.rx, ob.y + Math.sin(a) * rd * ob.ry, 1.3, 0, Math.PI * 2); o.fill(); }
        } else if (ob.kind === 'water') {
          var rc = ob.rect;
          o.fillStyle = '#2a7fb0'; rr(rc.x, rc.y + 4, rc.w, rc.h, 12); o.fill();
          o.fillStyle = '#3dbcec'; rr(rc.x, rc.y, rc.w, rc.h, 12); o.fill();
          o.strokeStyle = '#8fe4ff'; o.lineWidth = 2.5; o.lineCap = 'round';
          for (var wv = 0; wv < 4; wv++) {
            var wx = rc.x + 14 + Math.random() * (rc.w - 50), wy = rc.y + 12 + Math.random() * (rc.h - 24);
            o.beginPath(); o.moveTo(wx, wy); o.quadraticCurveTo(wx + 9, wy - 5, wx + 18, wy); o.quadraticCurveTo(wx + 27, wy + 5, wx + 36, wy); o.stroke();
          }
        } else if (ob.kind === 'boost') {
          o.fillStyle = 'rgba(255,255,255,0.16)'; rr(ob.rect.x, ob.rect.y, ob.rect.w, ob.rect.h, 6); o.fill();
          o.strokeStyle = 'rgba(255,255,255,0.3)'; o.lineWidth = 2; o.stroke();
        } else if (ob.kind === 'block') orangeBlock(o, ob.rect);
      });
      // walls
      orangeStroke(o, function () { polyPath(g.poly, true); }, WALL_R * 2);
      g.innerWalls.forEach(function (w) { orangeStroke(o, function () { polyPath(w, false); }, WALL_R * 2); });
      // cup and flag
      o.fillStyle = '#2f6b2a'; o.beginPath(); o.arc(g.cup.x, g.cup.y, g.cup.r + 4, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#0f2a12'; o.beginPath(); o.arc(g.cup.x, g.cup.y, g.cup.r, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#061508'; o.beginPath(); o.arc(g.cup.x, g.cup.y - 2, g.cup.r - 3, 0, Math.PI * 2); o.fill();
      o.strokeStyle = '#f7f7f0'; o.lineWidth = 3; o.lineCap = 'round'; o.beginPath(); o.moveTo(g.cup.x, g.cup.y); o.lineTo(g.cup.x, g.cup.y - 50); o.stroke();
      o.fillStyle = '#e8403a'; o.beginPath(); o.moveTo(g.cup.x + 1, g.cup.y - 50); o.lineTo(g.cup.x + 30, g.cup.y - 41); o.lineTo(g.cup.x + 1, g.cup.y - 32); o.closePath(); o.fill();
      o.fillStyle = '#fff'; o.font = '800 10px ' + fontFamily; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillText(String(g.hole + 1), g.cup.x + 12, g.cup.y - 41);
      // tee marker
      o.fillStyle = 'rgba(255,255,255,0.45)'; o.beginPath(); o.arc(g.def.tee[0] * W, g.def.tee[1] * H, 3.5, 0, Math.PI * 2); o.fill();
      // the rough's furniture
      g.flowers.forEach(function (f) { drawFlower(o, f.x, f.y, f.c); });
      g.trees.sort(function (a, b) { return a.y - b.y; }).forEach(function (t) { drawTree(o, t.x, t.y, t.r); });
      g.courseImg = { c: off, w: W, h: H, dpr: dpr };
    }
    function chunky(text, x, y, size, fill, align) {
      ctx.font = '800 ' + size + 'px ' + fontFamily; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.3); ctx.strokeStyle = '#1c3d18'; ctx.strokeText(text, x, y);
      ctx.fillStyle = fill; ctx.fillText(text, x, y);
    }
    function drawGolf(now) {
      var g = golf, b = g.ball;
      if (!g.courseImg || g.courseImg.w !== W || g.courseImg.h !== H || g.courseImg.dpr !== dpr) buildCourseImage(g);
      ctx.drawImage(g.courseImg.c, 0, 0, W, H);
      // live obstacles
      g.obs.forEach(function (o) {
        if (o.kind === 'boost') {
          var rc = o.rect, d = o.dir, gap = 20, off = ((now / 45) % gap), n = Math.ceil((d[0] ? rc.w : rc.h) / gap) + 1;
          ctx.save(); roundRect(rc.x, rc.y, rc.w, rc.h, 6); ctx.clip();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          for (var i = -1; i < n; i++) {
            var s = i * gap + off, cx = d[0] ? (d[0] > 0 ? rc.x + s : rc.x + rc.w - s) : rc.x + rc.w / 2, cy = d[1] ? (d[1] > 0 ? rc.y + s : rc.y + rc.h - s) : rc.y + rc.h / 2;
            ctx.beginPath();
            if (d[1]) { ctx.moveTo(cx - 9, cy - d[1] * 6); ctx.lineTo(cx, cy); ctx.lineTo(cx + 9, cy - d[1] * 6); }
            else { ctx.moveTo(cx - d[0] * 6, cy - 9); ctx.lineTo(cx, cy); ctx.lineTo(cx - d[0] * 6, cy + 9); }
            ctx.stroke();
          }
          ctx.restore();
        } else if (o.kind === 'slider') orangeBlock(ctx, o.rect);
        else if (o.kind === 'windmill') {
          ctx.save(); ctx.translate(o.x, o.y);
          ctx.fillStyle = 'rgba(0,40,0,0.28)'; ctx.beginPath(); ctx.ellipse(4, 7, o.arm * 0.9, o.arm * 0.45, 0, 0, Math.PI * 2); ctx.fill();
          ctx.rotate(o.ang); ctx.lineCap = 'round';
          [['#a63b0a', 5], ['#ee6a22', 0], ['#ff9448', -2]].forEach(function (L, li) {
            ctx.save(); ctx.rotate(-o.ang); ctx.translate(0, L[1]); ctx.rotate(o.ang);
            ctx.strokeStyle = L[0]; ctx.lineWidth = li === 2 ? 4 : 10;
            ctx.beginPath(); ctx.moveTo(-o.arm, 0); ctx.lineTo(o.arm, 0); ctx.moveTo(0, -o.arm); ctx.lineTo(0, o.arm); ctx.stroke();
            ctx.restore();
          });
          ctx.restore();
          circle(o.x, o.y + 3, o.hub, '#4a2a16'); circle(o.x, o.y, o.hub, '#6b3e22'); circle(o.x, o.y - 1, o.hub * 0.45, '#ffd23f');
        }
      });
      if (g.splash) {   // ripples
        var sp = (now - g.splash.t0) / 600;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * (1 - sp)) + ')'; ctx.lineWidth = 2.5;
        for (var rp = 0; rp < 2; rp++) { ctx.beginPath(); ctx.ellipse(g.splash.x, g.splash.y, 6 + sp * 26 + rp * 8, 3 + sp * 12 + rp * 4, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
      if (g.aim && !g.sunk) {   // sparkle under the ball while aiming
        var pz = 1 + 0.25 * Math.sin(now / 90);
        ctx.save(); ctx.translate(b.x, b.y); ctx.scale(pz, pz); ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); for (var si = 0; si < 8; si++) { var ra = si % 2 ? 4 : 17, an = si / 8 * Math.PI * 2 + Math.PI / 8; ctx.lineTo(Math.cos(an) * ra, Math.sin(an) * ra); } ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // ball
      if (b.alpha > 0) drawBubble({ x: b.x, y: b.y, r: b.r, scale: b.scale, alpha: b.alpha, ox: b.ox || 0, oy: b.oy || 0, name: '', num: '' }, now);
      // aim: a yellow line with a dot at the end, and a sparkle on the ball
      if (g.aim && !g.sunk) {
        var A = g.aim, ux = Math.cos(A.angle), uy = Math.sin(A.angle), len = 30 + A.power * 160;
        ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.moveTo(b.x + ux * (b.r + 3) + 1, b.y + uy * (b.r + 3) + 3); ctx.lineTo(b.x + ux * len + 1, b.y + uy * len + 3); ctx.stroke();
        ctx.lineWidth = 3.5; ctx.strokeStyle = '#ffe23a';
        ctx.beginPath(); ctx.moveTo(b.x + ux * (b.r + 3), b.y + uy * (b.r + 3)); ctx.lineTo(b.x + ux * len, b.y + uy * len); ctx.stroke();
        ctx.restore();
        var tipCol = A.power > 0.8 ? '#ff5a3c' : A.power > 0.45 ? '#ffae2a' : '#ffe23a';
        circle(b.x + ux * len + 1, b.y + uy * len + 3, 6, 'rgba(0,0,0,0.25)'); circle(b.x + ux * len, b.y + uy * len, 6, tipCol, '#7a4a00', 1.5);
      }
      // HUD
      chunky('HOLE ' + (g.hole + 1) + '/' + g.courses.length, 12, 21, 15, '#fff');
      chunky('PAR ' + GOLF_PAR, 92, 21, 15, '#ffd23f');
      chunky('STROKES', W - 128, 21, 12, '#fff', 'right'); chunky(String(g.strokes), W - 108, 21, 18, '#ffd23f', 'center');
      ctx.fillStyle = 'rgba(0,20,8,0.55)'; roundRect(W - 58, 8, 50, 26, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 12px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('quit', W - 33, 21);
      chunky(g.def.name.toUpperCase(), W / 2, H - 16, 11, 'rgba(255,255,255,0.85)', 'center');
      if (g.note && now - g.note.t0 < 1400) {
        var nk = Math.min(1, (1400 - (now - g.note.t0)) / 300);
        ctx.globalAlpha = nk; chunky(g.note.text, b.x, b.y - 26 - (1 - nk) * 10, 16, '#7ee0ff', 'center'); ctx.globalAlpha = 1;
      }
      if (g.msg) {
        var k = Math.min(1, (now - g.sunk) / 300);
        ctx.globalAlpha = 0.4 * k; ctx.fillStyle = '#0d2a10'; ctx.fillRect(0, H / 2 - 56, W, 112); ctx.globalAlpha = k;
        chunky(g.done ? 'ROUND OVER' : g.msg, W / 2, H / 2 - 14, 34, '#ffd23f', 'center');
        var rp = golfToPar(g.total, GOLF_PAR * g.courses.length);
        chunky(g.done ? (rp === 'E' ? 'EVEN PAR' : rp) + ' FOR THE ROUND' : g.strokes + (g.strokes === 1 ? ' stroke' : ' strokes') + ' · par ' + GOLF_PAR, W / 2, H / 2 + 22, 14, '#fff', 'center');
        ctx.globalAlpha = 1;
      }
      if (g.reliefFlash && now - g.reliefFlash < 1100) {
        ctx.globalAlpha = Math.min(1, (1100 - (now - g.reliefFlash)) / 400); chunky('free relief', b.x, b.y - 20, 11, '#fff', 'center'); ctx.globalAlpha = 1;
      }
      if (!g.strokes && !g.sunk && !g.aim) {
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(now / 300); chunky('pull back anywhere, let go to putt', b.x, b.y + 28, 12, '#fff', 'center'); ctx.globalAlpha = 1;
      }
    }

    // ---- Air hockey ----
    function startGame(paddle) {
      markFound('hockey');
      setPlaying(true);
      var gw = Math.round(W * 0.42);
      game = { me: paddle, t0: performance.now(), over: null,
        goal: { x1: (W - gw) / 2, x2: (W + gw) / 2 },
        cpu: { x: W / 2, y: 56, vx: 0, vy: 0, r: 28 },
        puck: { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 12 }, kickoff: true, humanHits: 0, cpuHits: 0 };
      paddle.held = true; paddle.tx = paddle.x; paddle.ty = Math.max(H / 2 + paddle.r, paddle.y);
      paddle.targetR = 28; paddle.bubbleR = paddle.r;
      box.classList.add('hockey');
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
      // Claude's mallet: reads where the puck is heading, blocks on a line in front of its goal, and when the puck sits in
      // its half it swings through it toward whichever side of your goal you've left open. Reaction time and a little
      // aim wobble (HOCKEY_AI) keep it beatable.
      var plan = cpuPlan(g, now), cx = plan.x, cy = plan.y;
      cx = Math.max(c.r, Math.min(W - c.r, cx)); cy = Math.max(c.r, Math.min(H / 2 - c.r, cy));
      var maxv = HOCKEY_AI.speed * (plan.mode === 'swing' ? 1.4 : 1);   // the swing is the one time it really moves
      var nvx = (cx - c.x) * HOCKEY_AI.gain, nvy = (cy - c.y) * HOCKEY_AI.gain, nv = Math.hypot(nvx, nvy);
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
    // where the puck's x will be when it reaches y, folding in wall bounces (friction ignored: it's a short look-ahead)
    function puckXAt(p, y) {
      if (Math.abs(p.vy) < 0.05) return p.x;
      var t = (y - p.y) / p.vy; if (t < 0) return p.x;
      var w = W - 2 * p.r, x = p.x - p.r + p.vx * t, k = Math.floor(x / w); x -= k * w; if (k % 2) x = w - x;
      return x + p.r;
    }
    function cpuPlan(g, now) {
      var p = g.puck, c = g.cpu, me = g.me, last = g.plan, R = c.r + p.r;
      if (last && now - last.t < (last.mode === 'swing' ? 30 : HOCKEY_AI.react)) return last;   // reaction time: it sticks with its last read for a beat (a swing tracks faster)
      var wob = (Math.random() - 0.5) * 2 * HOCKEY_AI.wobble, x, y, mode, t0 = now;
      var dist = Math.hypot(p.x - c.x, p.y - c.y), speed = Math.hypot(p.vx, p.vy), incoming = p.vy < -0.3;
      // where it wants to put the puck: the side of your goal you're not covering, or off the wall if you're covering it
      var aimX = me.x < W / 2 ? g.goal.x2 - 18 : g.goal.x1 + 18;
      if (Math.abs(me.x - aimX) < 46) aimX = aimX < W / 2 ? -aimX : 2 * W - aimX;
      var dx = p.x - aimX, dy = p.y - H, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;   // unit vector from that target up through the puck
      if (g.kickoff) { x = W / 2; y = 56; mode = 'wait'; }   // nothing moves until you hit the puck
      else if (last && last.mode === 'swing' && now - last.t0 < 420) { x = p.x - ux * 220; y = p.y - uy * 220; mode = 'swing'; t0 = last.t0; }   // follow through
      else if (p.y < c.y - 4 && p.y < HOCKEY_AI.line + 10) {   // the puck is between it and its goal: slide beside and below it so it can roll out
        x = p.x + (p.x < W / 2 ? 1 : -1) * (R + 6); y = Math.min(H / 2 - c.r, p.y + R + 26); mode = 'recover';
      }
      else if (incoming && p.y > HOCKEY_AI.line + 30) {   // coming its way: meet it where it'll cross the line, and step into it as it arrives
        x = puckXAt(p, HOCKEY_AI.line) + wob; y = HOCKEY_AI.line + (dist < R * 1.8 ? 34 : 0); mode = 'block';
      }
      else if (dist < R * 2.4 && p.y > c.y - 4 && p.y < H / 2 + 10 && (speed < 4 || p.vy > 0)) { x = p.x - ux * 220 + wob; y = p.y - uy * 220; mode = 'swing'; }   // a loose puck in reach: drive through it at the target
      else if (p.y < H / 2 + 10) {   // puck in its half but not in reach yet: get behind it on the line to the target
        if (c.y > p.y - 6 && Math.abs(c.x - p.x) < R + 8) { x = p.x + (c.x < p.x ? -1 : 1) * (R + 18); y = c.y; mode = 'around'; }   // it's in the way: step round it
        else { x = p.x + ux * R * 1.25 + wob; y = p.y + uy * R * 1.25; mode = 'windup'; }
      }
      else { x = W / 2 + (p.x - W / 2) * 0.35; y = 56; mode = 'hover'; }   // puck's down your end: shade toward it and wait
      g.plan = { x: x, y: y, mode: mode, t: now, t0: t0 };
      return g.plan;
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
    // The table: an arcade air hockey table, pre-rendered once per size. Black rail with corner bolts, white playfield with
    // the air-hole grid and a sheen, red centre line, circle and goal creases, and lit goal mouths (Claude's orange, yours green).
    var tableCache = null;
    var TABLE = { rail: 10, field: '#f4f4ef', red: '#d9382f', railCol: '#15161a' };
    function tableLayer(g) {
      if (tableCache && tableCache.w === W && tableCache.h === H && tableCache.dpr === dpr) return tableCache.c;
      var off = document.createElement('canvas'); off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      var r = TABLE.rail, fx = r, fy = r, fw = W - 2 * r, fh = H - 2 * r;
      function rr(x, y, w, h, rad) { o.beginPath(); o.moveTo(x + rad, y); o.arcTo(x + w, y, x + w, y + h, rad); o.arcTo(x + w, y + h, x, y + h, rad); o.arcTo(x, y + h, x, y, rad); o.arcTo(x, y, x + w, y, rad); o.closePath(); }
      // rail
      var rg = o.createLinearGradient(0, 0, W, H); rg.addColorStop(0, '#24262c'); rg.addColorStop(0.5, TABLE.railCol); rg.addColorStop(1, '#1d1f24');
      o.fillStyle = rg; o.fillRect(0, 0, W, H);
      rr(fx - 2, fy - 2, fw + 4, fh + 4, 12); o.strokeStyle = 'rgba(255,255,255,0.10)'; o.lineWidth = 2; o.stroke();   // bevel highlight
      // playfield with a soft sheen
      rr(fx, fy, fw, fh, 10); o.save(); o.clip();
      var fg = o.createLinearGradient(0, fy, 0, fy + fh); fg.addColorStop(0, '#f8f8f3'); fg.addColorStop(0.5, TABLE.field); fg.addColorStop(1, '#ecece6');
      o.fillStyle = fg; o.fillRect(fx, fy, fw, fh);
      // air holes
      o.fillStyle = 'rgba(70,80,92,0.20)';
      for (var y = fy + 12; y < fy + fh - 6; y += 14) for (var x = fx + 12 + ((Math.round((y - fy) / 14) % 2) ? 7 : 0); x < fx + fw - 6; x += 14) { o.beginPath(); o.arc(x, y, 1.1, 0, Math.PI * 2); o.fill(); }
      // markings
      o.strokeStyle = TABLE.red; o.lineWidth = 3; o.lineCap = 'butt';
      o.beginPath(); o.moveTo(fx, H / 2); o.lineTo(fx + fw, H / 2); o.stroke();
      o.beginPath(); o.arc(W / 2, H / 2, 46, 0, Math.PI * 2); o.stroke();
      o.beginPath(); o.arc(W / 2, H / 2, 5, 0, Math.PI * 2); o.fillStyle = TABLE.red; o.fill();
      var gw = g.goal.x2 - g.goal.x1, cr = gw / 2 + 14;
      o.lineWidth = 2.5; o.beginPath(); o.arc(W / 2, fy, cr, 0, Math.PI); o.stroke();                 // goal creases
      o.beginPath(); o.arc(W / 2, fy + fh, cr, Math.PI, Math.PI * 2); o.stroke();
      o.beginPath(); o.arc(W / 2, fy + 54, 3.5, 0, Math.PI * 2); o.fill(); o.beginPath(); o.arc(W / 2, fy + fh - 54, 3.5, 0, Math.PI * 2); o.fill();   // face-off dots
      var sheen = o.createLinearGradient(fx, fy, fx + fw, fy + fh * 0.6); sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.45, 'rgba(255,255,255,0.22)'); sheen.addColorStop(0.55, 'rgba(255,255,255,0)');
      o.fillStyle = sheen; o.fillRect(fx, fy, fw, fh);
      var vig = o.createRadialGradient(W / 2, H / 2, W * 0.4, W / 2, H / 2, W * 1.3); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.10)');
      o.fillStyle = vig; o.fillRect(fx, fy, fw, fh);
      o.restore();
      // goal mouths: a dark slot in the rail, lit in each side's colour
      [[fy - r, colors.claude], [fy + fh, colors.pine[0]]].forEach(function (gl) {
        o.fillStyle = '#07080a'; o.fillRect(g.goal.x1, gl[0], gw, r);
        o.save(); o.shadowColor = gl[1]; o.shadowBlur = 14; o.fillStyle = gl[1];
        o.fillRect(g.goal.x1, gl[0] === fy - r ? fy - 3 : fy + fh, gw, 3); o.restore();
      });
      // bolts
      o.fillStyle = '#3a3d45'; [[6, 6], [W - 6, 6], [6, H - 6], [W - 6, H - 6]].forEach(function (b) { o.beginPath(); o.arc(b[0], b[1], 2.6, 0, Math.PI * 2); o.fill(); o.fillStyle = '#5b5f69'; o.beginPath(); o.arc(b[0] - 0.7, b[1] - 0.7, 1.1, 0, Math.PI * 2); o.fill(); o.fillStyle = '#3a3d45'; });
      tableCache = { w: W, h: H, dpr: dpr, c: off };
      return off;
    }
    function drawGame(now) {
      var g = game, p = g.puck, c = g.cpu, me = g.me;
      var fade = Math.min(1, (now - g.t0) / 500);
      ctx.globalAlpha = fade; ctx.drawImage(tableLayer(g), 0, 0, W, H);
      ctx.font = '700 10px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('S H O O T', W / 2, 5.5); ctx.fillText('D E F E N D', W / 2, H - 5);   // on the rails
      ctx.globalAlpha = 1;
      // fading bubbles
      balls.forEach(function (b) { if (b.fade) { b.alpha = Math.max(0, 1 - fade); if (b.alpha > 0) drawBubble(b, now); } });
      // cpu mallet
      mallet(c.x, c.y, c.r, colors.claude, 'Claude', true);
      // puck
      if (g.kickoff && !g.over) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 300); ctx.fillStyle = '#5b6168'; ctx.font = '600 13px ' + fontFamily;
        ctx.fillText('hit the puck to start', W / 2, H / 2 + 64); ctx.globalAlpha = 1;
      }
      if (g.serveFlash && now - g.serveFlash < 900) {
        ctx.globalAlpha = 1 - (now - g.serveFlash) / 900; ctx.fillStyle = '#5b6168'; ctx.font = '600 13px ' + fontFamily;
        ctx.fillText('re-serve', W / 2, H / 2 + 64); ctx.globalAlpha = 1;
      }
      circle(p.x + 1, p.y + 3, p.r, 'rgba(0,0,0,0.28)'); circle(p.x, p.y, p.r, '#1c1d22'); circle(p.x, p.y, p.r - 2.5, null, TABLE.red, 2);
      circle(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.28, 'rgba(255,255,255,0.35)');
      // player mallet (the bubble shrinks into it)
      var k2 = Math.min(1, (now - g.t0) / 450);
      if (k2 < 1) { me.alpha = 1; drawBubble(me, now); }
      ctx.globalAlpha = k2; mallet(me.x, me.y, me.r, colors.pine[0], me.name); ctx.globalAlpha = 1;
      if (g.over) {
        var k = Math.min(1, (now - g.over.t) / 300);
        ctx.globalAlpha = 0.9 * k; ctx.fillStyle = '#15161a'; ctx.fillRect(0, H / 2 - 60, W, 120); ctx.globalAlpha = k;
        ctx.fillStyle = g.over.winner === 'human' ? colors.pine[0] : colors.claude;
        ctx.font = '800 34px ' + fontFamily; ctx.fillText(g.over.winner === 'human' ? 'GOAL!' : 'CLAUDE SCORES', W / 2, H / 2 - 14);
        ctx.fillStyle = '#f4f4ef'; ctx.font = '600 15px ' + fontFamily;
        ctx.fillText(g.over.winner === 'human' ? me.name + ' beats Claude' : 'Nice try, ' + me.name, W / 2, H / 2 + 22);
        ctx.globalAlpha = 1;
      }
    }

    // Safari runs requestAnimationFrame at 30fps inside a cross-origin iframe (the claude.ai preview) until the frame
    // gets a real tap. If we're embedded and the cadence looks halved, drive frames off a timer until that tap.
    // The live site is top-level, so none of this applies there.
    var frameGaps = [], useTimer = false, embedded = window.top !== window.self;
    function checkWake(now) {
      if (!embedded || useTimer) return;
      frameGaps.push(now - last);
      if (frameGaps.length < 60) return;
      var sorted = frameGaps.slice().sort(function (a, b) { return a - b; }), median = sorted[30];
      frameGaps = [];
      if (median > 26 && !document.hidden) useTimer = true;
    }
    if (embedded) document.addEventListener('click', function () { useTimer = false; }, true);
    function next() { if (useTimer) setTimeout(function () { step(performance.now()); }, 16); else requestAnimationFrame(step); }
    function step(now) {
      if (!running) return;
      checkWake(now);
      if (playing && !golf && !game) setPlaying(false);
      if (opts.replay && !golf && !game) { running = false; opts.onExit(); return; }   // launched from the Games tab: hand back when the game ends
      var dt = Math.min(32, now - last) / 16.67; last = now;
      if (golf) {
        golfPhysics(dt, now);
        ctx.clearRect(0, 0, W, H);
        if (golf) drawGolf(now); else { balls.forEach(function (b) { drawBubble(b, now); }); }
        next(); return;
      }
      if (game) {
        gamePhysics(dt, now);
        if (game.over && now - game.over.t > 2400) {   // back to the bubbles, or back to the Games tab for a replay
          if (opts.replay) { game = null; setPlaying(false); running = false; opts.onExit(); return; }
          running = false; renderRoster(); return;
        }
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
      next();
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
        if (golfCanPutt(golf)) { golf.drag = { x: p.x, y: p.y }; golf.aim = null; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
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
        if (golf.drag) golfAim(golf, pos(e));
        return;
      }
      if (!held) return;
      var p = pos(e);
      held.tx = p.x - held.gx; held.ty = p.y - held.gy;
      trail.push(p); if (trail.length > 6) trail.shift();
    });
    function release(e) {
      if (golf) { if (golf.drag) golfPutt(golf, performance.now()); return; }
      if (!held) return;
      if (game) { held = null; return; }               // paddle stays where you left it
      if (!start) { held = null; return; }             // a game that ended under the finger: nothing to fling
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
    function startHockey(name) {
      var b = balls.filter(function (x) { return x.name === name; })[0]; if (!b || game || golf) return;
      setPlaying(true);                                  // full-screen first, so W/H are the rink's
      b.x = W / 2; b.y = H - 90; b.vx = 0; b.vy = 0;     // sit in front of your own goal; nothing moves until you touch the puck
      startGame(b);
    }
    return { stop: function () { running = false; held = null; if (ro) ro.disconnect(); setPlaying(false); }, startGolf: startGolf, startHockey: startHockey, setCurrent: function (n) { opts.current = n; } };
  }
  $('switch').addEventListener('click', function () { me = null; myParty = null; tab = 'cabin'; lsDel('cabin-haul-me'); showScreen(); });
  $('golfword').addEventListener('click', function () { if (sim && sim.startGolf && !me) renderGolfPost(true); });

  function showScreen() {
    var picking = !me;
    $('predict').hidden = true;
    $('pick').hidden = !picking; $('main').hidden = picking; $('nav').hidden = picking; $('chat-fab').hidden = picking;
    if (picking) closeChat();
    document.body.classList.toggle('picking', picking);
    if (picking) { renderRoster(); window.scrollTo(0, 0); return; }
    if (!booted) boot();
    if (me !== renderedFor) refreshForUser();
    if (shouldAsk()) { askedThisVisit = true; qAuto = true; openQuestionnaire(firstUnanswered()); return; }   // predictions first
    if (shouldAskDinner()) { askedDinnerThisVisit = true; openDinner(); return; }                              // then the dinner vote, which lands on the FAQ
    $('me').innerHTML = 'Hey <b>' + esc(me) + '</b>';
    showTab(tab);
    render();
  }

  // Everything on the main screen labels the current person as "you" and keeps per-person drafts, so when
  // someone taps "Not you?" and picks another name, start those over.
  var renderedFor = null;
  function refreshForUser() {
    renderedFor = me;
    askedDinnerThisVisit = false; askedThisVisit = false; qAuto = false; qSingle = false;   // a new name on this phone gets its own prompts
    ['new-name', 'need-name', 'wall-input', 'exp-title'].forEach(function (id) { var el = $(id); if (el) el.value = ''; });   // no typed drafts carry over
    document.body.classList.toggle('plain-picks', plainPicks());
    mafiaDraft = null; teamsDraft = null; teamsEdit = false; expanded = null; pickerFor = null; modReveal = false;
    renderPredictions(); renderSheet(); renderWall(); updateChatBadge();
    renderMafia(); renderTeams(); renderLiv(); renderSmash();
    renderHockeyBoard(); renderGolfBoard(); renderArcadeCues(); smashResetPair(); hibDraft = null; renderHibachi(); renderDinnerTally(); updatePredBadge();
  }

  // ---- Bottom dock ----
  var TABS = ['home', 'bringing', 'cabin', 'games', 'hibachi'];
  var tab = 'cabin', indPlaced = false;
  function showTab(name) {
    var changed = name !== tab;
    tab = name;
    TABS.forEach(function (t) { $('page-' + t).hidden = t !== tab; });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.setAttribute('aria-selected', String(on));
      b.classList.remove('bump'); if (on && changed) { void b.offsetWidth; b.classList.add('bump'); }
    });
    document.body.classList.toggle('tab-home', tab === 'home');
    document.body.setAttribute('data-tab', tab);   // the dock tints its pill to the page
    if (tab === 'games') { golfScrollCue(); golfCycle(); renderArcadeCues(); if (smashResetPair()) renderSmash(); } else { clearTimeout(cycleTimer); }   // the page was hidden until now, so the measurements were zero; Smash opens on the main event
    moveNavInd();
    updateChatBadge();
    window.scrollTo(0, 0); lastY = 0; setNavAway(false);
  }
  // the highlight pill slides under whichever tab is on
  function moveNavInd() {
    var ind = document.querySelector('.nav-ind'), b = document.querySelector('.nav-btn[aria-selected="true"]');
    if (!ind || !b || $('nav').hidden) return;
    if (!indPlaced) ind.classList.add('noanim');
    ind.style.width = b.offsetWidth + 'px'; ind.style.transform = 'translateX(' + b.offsetLeft + 'px)';
    if (!indPlaced) { indPlaced = true; void ind.offsetWidth; requestAnimationFrame(function () { ind.classList.remove('noanim'); }); }
  }
  window.addEventListener('resize', moveNavInd);
  $('nav').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (!b) return;
    buzz(6);
    if (b.getAttribute('data-tab') === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }   // tapping the tab you're on jumps back to the top
    showTab(b.getAttribute('data-tab'));
  });
  // the dock ducks out of the way while you scroll down and comes back as soon as you scroll up
  var lastY = 0, navAway = false;
  function setNavAway(away) { if (away === navAway) return; navAway = away; $('nav').classList.toggle('away', away); }
  function onPageScroll() {
    var y = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight, dy = y - lastY;
    if (max < 160 || $('main').hidden) setNavAway(false);
    else if (y < 24 || y > max - 24) setNavAway(false);
    else if (dy > 8) setNavAway(true);
    else if (dy < -8) setNavAway(false);
    lastY = y;
  }
  window.addEventListener('scroll', onPageScroll, { passive: true });

  // ---- Games: collapsible cards ----
  function setCardOpen(head, open) {
    var body = $(head.getAttribute('aria-controls'));
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (body) body.hidden = !open;
    lsSet('cabin-haul-card-' + head.getAttribute('aria-controls'), open ? '1' : '0');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.game-head'), function (head) {
    setCardOpen(head, lsGet('cabin-haul-card-' + head.getAttribute('aria-controls')) === '1');
    head.addEventListener('click', function () { setCardOpen(head, head.getAttribute('aria-expanded') !== 'true'); });
    head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); } });
  });

  // ---- Games: little helpers ----
  // Haptics. Android has navigator.vibrate. iPhones don't, but Safari 18 plays the system tick whenever a
  // native switch control flips, even from a programmatic click, so a hidden switch stands in for the motor.
  var hapticLabel = null, hapticOK = (function () { try { return 'switch' in document.createElement('input'); } catch (e) { return false; } })();
  function hapticTick() {
    if (!hapticLabel) {
      var wrap = document.createElement('div'); wrap.className = 'haptic'; wrap.setAttribute('aria-hidden', 'true');
      wrap.innerHTML = '<input type="checkbox" id="haptic-sw" switch tabindex="-1"><label for="haptic-sw"></label>';
      document.body.appendChild(wrap); hapticLabel = wrap.querySelector('label');
    }
    var had = document.activeElement;
    hapticLabel.click();
    var sw = $('haptic-sw');
    if (document.activeElement === sw) { try { if (had && had !== document.body && had.focus) had.focus({ preventScroll: true }); else sw.blur(); } catch (e) { /* ignore */ } }
  }
  function buzz(pattern) {
    try {
      if (navigator.vibrate) { navigator.vibrate(pattern); return; }
      if (!hapticOK) return;
      var pulses = Array.isArray(pattern) ? pattern : [pattern], t = 0;
      for (var i = 0; i < pulses.length; i += 2) { if (i === 0) hapticTick(); else setTimeout(hapticTick, t); t += (pulses[i] || 0) + (pulses[i + 1] || 0); }
    } catch (e) { /* ignore */ }
  }
  // Drop-ins: anyone not on the roster can be added to a game by name. They live only in that game's
  // draft and doc, never in NAMES, so the rest of the app doesn't know they exist.
  function guestsOf(d) { return d.guests || []; }
  function addGuest(d, raw) {
    var nm = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!nm) return null;
    var taken = NAMES.concat(guestsOf(d)).some(function (x) { return x.toLowerCase() === nm.toLowerCase(); });
    if (taken) { toast(nm + ' is already in.'); return null; }
    d.guests = guestsOf(d).concat([nm]); d.players.push(nm); return nm;
  }
  function dropGuest(d, nm) { d.guests = guestsOf(d).filter(function (x) { return x !== nm; }); d.players = d.players.filter(function (x) { return x !== nm; }); }
  function guestRowHtml(d, id) {
    return '<div class="guests">' + guestsOf(d).map(function (g) {
      return '<span class="guest">' + esc(g) + '<button type="button" data-drop-guest="' + esc(g) + '" aria-label="Remove ' + esc(g) + '">\u00d7</button></span>';
    }).join('') + '<form class="guest-add" id="' + id + '"><input type="text" maxlength="20" placeholder="Add someone who\u2019s stopping by" autocomplete="off" autocapitalize="words"><button type="submit" class="btn">Add</button></form></div>';
  }
  // Postgres stores JSON with its keys re-ordered, so a doc that comes back from Supabase never matches our own copy
  // byte for byte. Compare by content, with keys sorted, or every poll looks like a change and re-renders the card.
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function sameDoc(a, b) { return canon(a || null) === canon(b || null); }
  // slot-machine a name into an element: cycles through the pool, slows down, lands on the real one
  function spinName(el, pool, final, done) {
    if (!el) { if (done) done(); return; }
    var steps = [50, 50, 55, 60, 70, 85, 100, 125, 160, 210, 280], i = 0;
    el.classList.add('spinning');
    var tick = function () {
      if (!el.isConnected) return;
      if (i >= steps.length) { el.textContent = final; el.classList.remove('spinning'); el.classList.add('pop'); buzz(20); if (done) done(); return; }
      var pick = pool[Math.floor(Math.random() * pool.length)]; if (pick === el.textContent) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      el.textContent = pick;
      setTimeout(tick, steps[i++]);
    };
    tick();
  }

  // ---- Games: random team picker ----
  var teams = null, teamsLoaded = false, teamsSub = false, teamsDraft = null, teamsEdit = false, teamsScramble = null, teamsReveal = false;
  var TEAM_NAMES = ['Moose', 'Bear', 'Wolf', 'Trout', 'Hawk', 'Fox'];
  var TEAM_EMOJI = ['\uD83E\uDD8C', '\uD83D\uDC3B', '\uD83D\uDC3A', '\uD83D\uDC1F', '\uD83E\uDD85', '\uD83E\uDD8A'];
  var TEAM_COLORS = ['#2d6a4f', '#d2691e', '#3f7cae', '#8e44ad', '#c0392b', '#b7950b'];
  function subscribeTeams() {
    if (teamsSub || !store || !store.game) return;
    teamsSub = true;
    store.game('teams', function (doc) { var same = teamsLoaded && sameDoc(doc, teams); teams = doc; teamsLoaded = true; if (!same) renderTeams(); });
  }
  function teamsDefaults() { return { players: NAMES.slice(), count: 2, split: true, guests: [] }; }
  function partnerOf(name) {
    var p = PARTIES.filter(function (x) { return x.indexOf(name) >= 0; })[0];
    return p ? (p.filter(function (n) { return n !== name; })[0] || null) : null;
  }
  function shuffled(a) { a = a.slice(); for (var j = a.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = a[j]; a[j] = a[k]; a[k] = t; } return a; }
  function teamSizes(n, count) { var out = []; for (var i = 0; i < count; i++) out.push(Math.floor(n / count) + (i < n % count ? 1 : 0)); return out; }
  function makeTeams(players, count, split) {
    var order;
    if (split) {
      // couples go in as consecutive pairs, so round-robin dealing always puts them on different teams
      var used = {}, pairs = [], singles = [];
      shuffled(players).forEach(function (p) {
        if (used[p]) return;
        var q = partnerOf(p);
        if (q && players.indexOf(q) >= 0 && !used[q]) { used[p] = used[q] = true; pairs.push(Math.random() < 0.5 ? [p, q] : [q, p]); }
        else { used[p] = true; singles.push(p); }
      });
      order = [];
      pairs.forEach(function (pr) { order.push(pr[0], pr[1]); });
      order = order.concat(singles);
    } else order = shuffled(players);
    var out = []; for (var i = 0; i < count; i++) out.push([]);
    order.forEach(function (p, i) { out[i % count].push(p); });
    return shuffled(out).map(function (t) { return shuffled(t); });
  }
  function renderTeams() {
    var body = $('teams-body'), status = $('teams-status'); if (!body) return;
    if (!teamsLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var t = teams && teams.status === 'set' ? teams : null;
    var html = '';
    if (teamsScramble) {                                                        // names tumbling before they land
      status.textContent = 'Shuffling…';
      body.innerHTML = '<div class="team-list scramble">' + teamsScramble.preview.map(function (members, i) {
        return '<div class="team" style="--tc:' + TEAM_COLORS[i % TEAM_COLORS.length] + '"><div class="tname"><span class="mascot">' + TEAM_EMOJI[i % TEAM_EMOJI.length] + '</span>Team ' + TEAM_NAMES[i % TEAM_NAMES.length] + '<small>' + members.length + '</small></div><div class="tmem">' +
          members.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div></div>';
      }).join('') + '</div><div class="mafia-actions"><button type="button" class="big-btn" disabled>Shuffling…</button></div>';
      return;
    }
    if (!t || teamsEdit) {
      var d = teamsDraft || (teamsDraft = t ? { players: t.players.slice(), count: t.count, split: !!t.split, guests: (t.guests || []).slice() } : teamsDefaults());
      var n = d.players.length;
      status.textContent = t ? 'Changing who’s in' : 'No teams yet';
      html += '<p class="info-sub">Pick who’s in, how many teams, and let the phone decide. Everyone sees the same teams.</p>';
      html += '<div class="name-grid">' + NAMES.concat(guestsOf(d)).map(function (nm) {
        return '<button type="button" data-player="' + esc(nm) + '" aria-pressed="' + (d.players.indexOf(nm) >= 0) + '"' + (guestsOf(d).indexOf(nm) >= 0 ? ' class="is-guest"' : '') + '>' + esc(nm) + '</button>';
      }).join('') + '</div>';
      html += guestRowHtml(d, 'teams-guest');
      var cnt = Math.min(d.count, Math.max(2, n)), sizes = n >= cnt ? teamSizes(n, cnt).join(' / ') : '';
      html += '<div class="mafia-opts">' +
        '<div class="opt-row"><span>Teams <span class="info-sub">(' + n + ' in' + (sizes ? ' → ' + sizes : '') + ')</span></span><span class="stepper"><button type="button" data-step="-1">−</button><b>' + d.count + '</b><button type="button" data-step="1">+</button></span></div>' +
        '<div class="opt-row"><span>Split up couples</span><button type="button" class="toggle" data-opt="split" aria-pressed="' + d.split + '" aria-label="Split up couples"></button></div>' +
        '</div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="teams-make"' + (n < 2 || n < d.count ? ' disabled' : '') + '>\uD83C\uDFB2 Roll the teams</button>' + (t ? '<button type="button" class="linkbtn" id="teams-cancel">Cancel</button>' : '') + '</div>';
      body.innerHTML = html;
      return;
    }
    status.textContent = t.players.length + ' in · by ' + (t.by === me ? 'you' : t.by) + ' ' + agoText(t.made_at);
    var reveal = teamsReveal, k = 0; teamsReveal = false;
    html += '<div class="team-list">' + t.teams.map(function (members, i) {
      return '<div class="team' + (reveal ? ' dealin' : '') + '" style="--tc:' + TEAM_COLORS[i % TEAM_COLORS.length] + (reveal ? ';animation-delay:' + (i * 90) + 'ms' : '') + '"><div class="tname"><span class="mascot">' + TEAM_EMOJI[i % TEAM_EMOJI.length] + '</span>Team ' + TEAM_NAMES[i % TEAM_NAMES.length] + '<small>' + members.length + '</small></div><div class="tmem">' +
        members.map(function (m) { k++; return '<span class="' + (m === me ? 'me' : '') + (reveal ? ' pop' : '') + '"' + (reveal ? ' style="animation-delay:' + (120 + k * 55) + 'ms"' : '') + '>' + esc(m) + '</span>'; }).join('') + '</div></div>';
    }).join('') + '</div>';
    if (t.split) html += '<p class="info-sub" style="margin-top:8px">Couples split up.</p>';
    html += '<div class="mafia-actions"><button type="button" class="big-btn" id="teams-shuffle">\uD83C\uDFB2 Roll again</button><button type="button" class="btn" id="teams-edit">Change who’s in</button><button type="button" class="btn" id="teams-clear">Clear</button></div>';
    body.innerHTML = html;
  }
  function saveTeams(players, count, split, guests) {
    count = Math.max(2, Math.min(count, players.length));
    if (players.length < 2) { toast('Need at least two people.'); return; }
    var doc = { status: 'set', by: me, players: players, count: count, split: !!split, guests: guests || [], teams: makeTeams(players, count, split), made_at: new Date().toISOString() };
    if (teamsScramble) return;
    teamsDraft = null; teamsEdit = false;
    var t0 = performance.now();
    teamsScramble = { preview: makeTeams(players, count, false) };
    buzz([15, 60, 15, 60, 15]);
    var tick = function () {
      if (!teamsScramble) return;
      if (performance.now() - t0 < 950) { teamsScramble.preview = makeTeams(players, count, false); renderTeams(); setTimeout(tick, 75); return; }
      teamsScramble = null; teams = doc; teamsReveal = true; renderTeams(); buzz(40);
      store.setGame('teams', doc).catch(function (e) { toast('Couldn’t save the teams: ' + ((e && e.message) || e)); });
    };
    tick();
  }
  $('teams-body').addEventListener('submit', function (e) {
    if (e.target.id !== 'teams-guest') return;
    e.preventDefault();
    var d = teamsDraft || (teamsDraft = teamsDefaults()), inp = e.target.querySelector('input');
    if (addGuest(d, inp.value)) { renderTeams(); var again = document.querySelector('#teams-guest input'); if (again) again.focus(); buzz(6); }
  });
  $('teams-body').addEventListener('click', function (e) {
    var d = teamsDraft || (teamsDraft = teamsDefaults());
    var pl = e.target.closest('[data-player]');
    if (pl) {
      var nm = pl.getAttribute('data-player');
      if (d.players.indexOf(nm) >= 0) d.players = d.players.filter(function (x) { return x !== nm; }); else d.players.push(nm);
      renderTeams(); return;
    }
    var st = e.target.closest('[data-step]');
    if (st) { d.count = Math.max(2, Math.min(6, d.count + (+st.getAttribute('data-step')))); renderTeams(); return; }
    var op = e.target.closest('[data-opt]');
    if (op) { var key = op.getAttribute('data-opt'); d[key] = !d[key]; renderTeams(); return; }
    var dg = e.target.closest('[data-drop-guest]'); if (dg) { dropGuest(d, dg.getAttribute('data-drop-guest')); renderTeams(); return; }
    if (e.target.closest('#teams-make')) { saveTeams(d.players.slice(), d.count, d.split, guestsOf(d)); return; }
    if (e.target.closest('#teams-cancel')) { teamsEdit = false; teamsDraft = null; renderTeams(); return; }
    if (e.target.closest('#teams-shuffle') && teams) { saveTeams(teams.players.slice(), teams.count, teams.split, teams.guests || []); return; }
    if (e.target.closest('#teams-edit') && teams) { teamsEdit = true; teamsDraft = null; renderTeams(); return; }
    if (e.target.closest('#teams-clear') && teams) {
      var cleared = { status: 'cleared', by: me, cleared_at: new Date().toISOString() };
      store.setGame('teams', cleared).then(function () { teams = cleared; teamsDraft = null; teamsEdit = false; renderTeams(); }).catch(function (err) { toast('Couldn’t clear: ' + ((err && err.message) || err)); });
    }
  });

  // ---- Games: Liv’s eyes only (deep question generator; only Liv and Mitch see the questions) ----
  // heat 1 = deep, 2 = uncomfortable, 3 = no mercy
  var LIV_Q = [
    [1, 'What’s something you believed about yourself at 18 that turned out to be completely wrong?'],
    [1, 'Who in this room knows you best, and what do they still not know?'],
    [1, 'What’s the kindest thing anyone has ever done for you that they probably don’t remember?'],
    [1, 'What do you want people to say about you at your funeral, and are you living like that?'],
    [1, 'When was the last time you cried, and what was it actually about?'],
    [1, 'What’s a compliment you got once that you still think about?'],
    [1, 'What are you most afraid of becoming?'],
    [1, 'What’s something you’re proud of that you’ve never said out loud?'],
    [1, 'If you could re-live one ordinary day from your life, which one?'],
    [1, 'What did your parents get right that you only appreciated later?'],
    [1, 'What’s the hardest thing you’ve ever had to forgive?'],
    [1, 'What would you do with your life if money truly didn’t matter?'],
    [1, 'What’s a small thing that makes you feel loved?'],
    [1, 'What’s the best decision you ever made, and did it feel like one at the time?'],
    [1, 'What do you think about when you can’t sleep?'],
    [1, 'Who do you miss?'],
    [1, 'What’s something you’ve changed your mind about in the last five years?'],
    [1, 'What’s a hill you’ll die on that nobody else in this room agrees with?'],
    [1, 'What’s the most alive you’ve ever felt?'],
    [1, 'What do you need more of in your life right now?'],
    [2, 'What’s a lie you’ve told someone in this room?'],
    [2, 'What’s the pettiest grudge you’re still holding, and against whom?'],
    [2, 'What’s something about your relationship that you’ve never admitted to your partner?'],
    [2, 'Who in this room would you call if you needed to hide a body, and who would you absolutely not call?'],
    [2, 'What’s the most embarrassing thing in your search history this week?'],
    [2, 'What’s the last thing you were jealous of?'],
    [2, 'Which of your friends’ life choices do you secretly judge?'],
    [2, 'What’s something you do when you’re alone that you’d be mortified for us to see?'],
    [2, 'What’s a secret you’ve kept for someone that you’ve been dying to tell?'],
    [2, 'What was the real reason your last relationship ended?'],
    [2, 'What’s something your partner does that you’ve never told them annoys you?'],
    [2, 'Who in this room do you think is the most full of shit, and about what?'],
    [2, 'When was the last time you faked being happy for someone?'],
    [2, 'What’s the worst thing you’ve ever said about someone here behind their back?'],
    [2, 'What’s a text you sent that you immediately wished you could unsend?'],
    [2, 'What’s the most you’ve ever spent on something you hid from your partner?'],
    [2, 'What do you think your biggest flaw is? Now everyone else say what they think it actually is.'],
    [2, 'Which couple here do you think argues the most, and about what?'],
    [2, 'What’s the thing you’re most insecure about that you overcompensate for?'],
    [2, 'What’s something you’ve done that your parents still don’t know about?'],
    [2, 'What’s a time you were a genuinely bad friend?'],
    [2, 'Who in this group has changed the most since you met them, and is it for the better?'],
    [3, 'Rank the three people to your left by how much you trust them. Explain.'],
    [3, 'What’s the thing you’d least want your partner to find on your phone right now?'],
    [3, 'What’s the closest you’ve come to cheating, emotionally or otherwise?'],
    [3, 'What’s something you’ve never forgiven your partner for?'],
    [3, 'If you had to cut one person in this room out of your life, who, and why them?'],
    [3, 'What’s the most selfish thing you’ve ever done and gotten away with?'],
    [3, 'What’s a moment you’re genuinely ashamed of?'],
    [3, 'Who in this room do you think is settling?'],
    [3, 'What’s something you resent about your own family?'],
    [3, 'What’s the thing you most want but are too scared to go after?'],
    [3, 'When did you last feel truly lonely, even though you weren’t alone?'],
    [3, 'What’s a belief you hold that would make people here think less of you?'],
    [3, 'Have you ever pretended to like one of the partners in this room? Which one?'],
    [3, 'What’s the biggest thing you’ve lied to yourself about this year?'],
    [3, 'Who was the one that got away, and does your partner know about them?'],
    [3, 'What’s something you did in your twenties that you’d be horrified if your kids did?'],
    [3, 'What do you think happens when we die, and are you okay with it?'],
    [3, 'If your partner died tomorrow, how long before you’d date again? Honestly.'],
    [1, 'What’s a piece of advice you ignored that you wish you’d taken?'],
    [1, 'What’s something you loved as a kid that you quietly gave up on?'],
    [1, 'When did you last surprise yourself?'],
    [1, 'Who was the first person who made you feel truly seen?'],
    [1, 'What’s a version of your life you think about more than you should?'],
    [1, 'What’s something you’d tell your 16-year-old self that they wouldn’t believe?'],
    [1, 'What are you still waiting for permission to do?'],
    [1, 'What’s a habit you have that you know comes straight from a parent?'],
    [1, 'What would you want to be remembered for by the people in this room specifically?'],
    [1, 'What’s the most important thing a friend ever told you that you didn’t want to hear?'],
    [1, 'What does a perfect Sunday look like for you, honestly, not the Instagram version?'],
    [1, 'When was the last time you felt completely out of your depth?'],
    [1, 'What’s a goal you quietly gave up on this year?'],
    [1, 'What’s something nobody here has ever asked you about that you wish they would?'],
    [2, 'Who in this room do you text the least, and why is that?'],
    [2, 'What’s a conversation you’ve been avoiding with someone in this cabin?'],
    [2, 'What’s a habit of your partner’s that you’ve complained about to someone else here?'],
    [2, 'What’s the most you’ve exaggerated a story that people here still believe?'],
    [2, 'Which of us would you trust to babysit your kid, and who would you never leave alone with a plant?'],
    [2, 'What do you think your partner would say is the worst thing about dating you?'],
    [2, 'Who here has seen you at your absolute worst? Describe it.'],
    [2, 'What’s a time you ghosted someone, and did they deserve it?'],
    [2, 'What’s something you’ve been pretending to understand this whole trip?'],
    [2, 'Which of these couples did you think wouldn’t last? Be honest, it’s been long enough.'],
    [2, 'What’s a purchase you’re still defending to your partner?'],
    [2, 'What’s the last thing you lied about at work?'],
    [2, 'Who in this room do you think talks about you when you leave?'],
    [2, 'What do you only say to your partner when you’re drunk?'],
    [2, 'What’s a thing you do to look busy when you’re not?'],
    [3, 'Who in this room do you think would be the worst partner, and what makes you say that?'],
    [3, 'What’s the most hurtful thing you’ve ever said to your partner, and did you mean it?'],
    [3, 'What’s something you’re hiding from the person sitting next to you?'],
    [3, 'Of everyone here, whose life would you least want to trade for? Say it to their face.'],
    [3, 'What’s a time you chose yourself over someone who really needed you?'],
    [3, 'What do you think your partner is settling for by being with you?'],
    [3, 'Who in this room have you fantasized about? Nobody leaves until you answer.'],
    [3, 'What’s the thing you’d change about your partner if they’d never find out you did it?'],
    [3, 'Which friendship in this room do you think is already over and nobody’s said it?'],
    [3, 'What would your ex say is the real reason it ended, and are they right?'],
    [3, 'What’s the biggest thing you’ve never told anyone, and are you going to tell us tonight?']
  ];
  var liv = null, livLoaded = false, livSub = false, livAnim = null;
  var HEAT = { 1: 'Deep', 2: 'Uncomfortable', 3: 'No mercy' };
  var LIV_KEEPERS = ['Liv', 'Mitch'];
  function livAllowed() { return LIV_KEEPERS.indexOf(me) >= 0; }
  function subscribeLiv() {
    if (livSub || !store || !store.game) return;
    livSub = true;
    store.game('liv', function (doc) { var same = livLoaded && sameDoc(doc, liv); liv = doc; livLoaded = true; if (!same) renderLiv(); });
  }
  function livPickVictim(exclude) {
    var pool = NAMES.filter(function (n) { return n !== exclude; });
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function livNext(keepVictim) {
    if (!livAllowed()) return;
    var seen = (liv && liv.seen) || [];
    var left = LIV_Q.map(function (_, i) { return i; }).filter(function (i) { return seen.indexOf(i) < 0; });
    if (!left.length) { seen = []; left = LIV_Q.map(function (_, i) { return i; }); }
    var idx = left[Math.floor(Math.random() * left.length)];
    var doc = { q: idx, victim: keepVictim && liv ? liv.victim : livPickVictim(liv && liv.victim), by: me, seen: seen.concat([idx]), at: new Date().toISOString() };
    liv = doc; livAnim = { flip: true, spin: true }; renderLiv(); buzz(25);
    store.setGame('liv', doc).catch(function (e) { toast('Couldn’t draw one: ' + ((e && e.message) || e)); });
  }
  function renderLiv() {
    var body = $('liv-body'), status = $('liv-status'); if (!body) return;
    if (!livLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var seen = (liv && liv.seen) || [];
    var cur = liv && typeof liv.q === 'number' ? LIV_Q[liv.q] : null;
    status.textContent = seen.length ? seen.length + ' of ' + LIV_Q.length + ' asked' : LIV_Q.length + ' questions';
    if (!livAllowed()) {
      body.innerHTML = '<div class="liv-locked"><div class="lock">\uD83D\uDD12</div><b>Liv’s eyes only.</b></div>';
      return;
    }
    var html = me === 'Liv'
      ? '<p class="info-sub"><b>Hey Liv.</b> Mitch made this for you: 100 deep, uncomfortable questions to ask people, one at a time, no repeats. Only you and Mitch can see them. Use responsibly.</p>'
      : '<p class="info-sub">Liv\u2019s stash of deep, uncomfortable questions. One at a time, no repeats, nowhere to hide. Only Liv and Mitch can read these; the rest just get asked.</p>';
    html += '<div class="legend"><span class="h1"><i></i>Deep · gets you thinking</span><span class="h2"><i></i>Uncomfortable · gets you sweating</span><span class="h3"><i></i>No mercy · gets you divorced</span></div>';
    if (cur) {
      var an = livAnim || {}; livAnim = null;
      html += '<div class="liv-q h' + cur[0] + (an.flip ? ' flip' : '') + '"><span class="heat h' + cur[0] + '">' + HEAT[cur[0]] + '</span><div class="qt">' + esc(cur[1]) + '</div>' +
        '<div class="who"><span>Ask <b id="liv-victim-name">' + esc(liv.victim === me ? 'you' : liv.victim) + '</b></span><button type="button" class="linkbtn" id="liv-victim">Someone else</button></div></div>';
      if (an.spin) setTimeout(function () { spinName($('liv-victim-name'), NAMES, liv.victim === me ? 'you' : liv.victim); }, an.flip ? 250 : 0);
    } else {
      html += '<div class="liv-empty">Tap below and Liv will take it from there.</div>';
    }
    html += '<div class="mafia-actions"><button type="button" class="big-btn" id="liv-next">\uD83D\uDD25 ' + (cur ? 'Draw the next one' : 'Draw a question') + '</button>' + (seen.length ? '<button type="button" class="linkbtn" id="liv-reset">Start over</button>' : '') + '</div>';
    body.innerHTML = html;
  }
  $('liv-body').addEventListener('click', function (e) {
    if (!livAllowed()) return;
    if (e.target.closest('#liv-next')) { livNext(false); return; }
    if (e.target.closest('#liv-victim') && liv) {
      var doc = Object.assign({}, liv, { victim: livPickVictim(liv.victim) });
      liv = doc; livAnim = { spin: true }; renderLiv();
      store.setGame('liv', doc).catch(function () { /* ignore */ });
      return;
    }
    if (e.target.closest('#liv-reset')) {
      var cleared = { seen: [], by: me, at: new Date().toISOString() };
      store.setGame('liv', cleared).then(function () { liv = cleared; renderLiv(); }).catch(function (err) { toast('Couldn’t reset: ' + ((err && err.message) || err)); });
    }
  });

  // ---- Games: Smash tally. The main event is Mitch vs Luke; Drew and Joe can be swapped into either seat. ----
  // One shared doc: { log: [{ p: [left, right], w: winnerName, by, at }], updated_at }. Older entries { w: 'p1'|'p2' } are Mitch vs Luke.
  var smash = null, smashLoaded = false, smashSub = false, smashAnim = null, charge = null, smashDirty = false, smashInflight = 0;
  var SMASH_MAIN = ['Mitch', 'Luke'];
  var SMASH_COLOR = { Mitch: '#d63a1f', Luke: '#2e9e44', Drew: '#6d4de0', Joe: '#1a8fd6' };
  var SMASH_NAMES = Object.keys(SMASH_COLOR);
  var smashPair = SMASH_MAIN.slice(), smashSwap = null;   // the two seats on this phone's screen (back to the main event whenever the tab opens), and which seat is picking a replacement
  function smashEntry(e) {   // one shape for old and new log entries
    if (e.p) return { p: e.p, w: e.w, by: e.by, at: e.at };
    return { p: SMASH_MAIN.slice(), w: e.w === 'p2' ? SMASH_MAIN[1] : SMASH_MAIN[0], by: e.by, at: e.at };
  }
  function smashLog() { return ((smash && smash.log) || []).map(smashEntry); }
  function samePair(a, b) { return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]); }
  function smashPairLog(pair) { return smashLog().filter(function (e) { return samePair(e.p, pair); }); }
  function smashCounts(pair) { var c = {}; c[pair[0]] = 0; c[pair[1]] = 0; smashPairLog(pair).forEach(function (e) { if (c[e.w] != null) c[e.w]++; }); return c; }
  function smashStreak(pair, name) { var log = smashPairLog(pair), n = 0; for (var i = log.length - 1; i >= 0 && log[i].w === name; i--) n++; return n; }
  function smashRecord(name) { var w = 0, l = 0; smashLog().forEach(function (e) { if (e.p.indexOf(name) < 0) return; if (e.w === name) w++; else l++; }); return { w: w, l: l }; }
  function smashResetPair() { if (charge) return; var was = smashPair; smashPair = SMASH_MAIN.slice(); smashSwap = null; return !samePair(was, SMASH_MAIN); }
  function subscribeSmash() {
    if (smashSub || !store || !store.game) return;
    smashSub = true;
    store.game('smash', function (doc) {
      var incoming = (doc && doc.log) || [];
      var same = smashLoaded && sameDoc(incoming, (smash && smash.log) || []);
      if (smashInflight > 0 && !same) return;   // our own write is still landing and will overwrite whatever this read saw; its echo brings the truth
      smash = doc; smashLoaded = true;
      if (!same) renderSmash();                       // our own write echoing back shouldn't restart the KO animation
    });
  }
  function renderSmash() {
    var body = $('smash-body'), status = $('smash-status'); if (!body) return;
    if (!smashLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    if (charge) { smashDirty = true; return; }   // never swap the card out from under a finger mid-hold; redraw when the hold ends
    var main = smashCounts(SMASH_MAIN), log = smashLog();
    status.textContent = SMASH_MAIN[0] + ' ' + main[SMASH_MAIN[0]] + ' – ' + main[SMASH_MAIN[1]] + ' ' + SMASH_MAIN[1];   // the header always shows the main event
    var pair = smashPair, c = smashCounts(pair), isMain = samePair(pair, SMASH_MAIN);
    var html = '<p class="info-sub">Every Smash match, counted. Hold the winner’s card until it fills. Anyone can log a win, so no fudging. Tap <b>Swap</b> to put someone else in a seat.</p>';
    html += '<div class="smash"><div class="smash-eyebrow">' + (isMain ? 'Main event' : 'Side match') + '</div><div class="smash-board">';
    ['p1', 'p2'].forEach(function (side, i) {
      var name = pair[i], n = c[name], lead = n > c[pair[1 - i]], st = smashStreak(pair, name), col = SMASH_COLOR[name];
      var rolling = smashAnim && smashAnim.side === side;
      html += '<div class="fighter ' + side + (lead ? ' lead' : '') + '" data-side="' + side + '" data-name="' + esc(name) + '" style="--pc:' + col + '"><div class="fname">' + esc(name) + '</div>' +
        '<div class="odo"><div class="roll' + (rolling ? ' spin' : '') + '">' + (rolling ? '<span>' + smashAnim.from + '</span>' : '') + '<span>' + n + '</span></div></div>' +
        '<div class="streak">' + (st >= 2 ? st + ' in a row' : '') + '</div>' +
        '<div class="ko-hint"><span>Hold to KO</span></div></div>';
      if (side === 'p1') html += '<div class="vs">VS</div>';
    });
    html += '</div>';
    // swapping lives in its own row under the board, so it can never be confused with a hold
    if (smashSwap) {
      var seatName = pair[smashSwap === 'p1' ? 0 : 1], others = SMASH_NAMES.filter(function (x) { return pair.indexOf(x) < 0; });
      html += '<div class="swap-row picking"><span class="swap-sub">Put in for ' + esc(seatName) + ':</span>' +
        others.map(function (x) { return '<button type="button" class="swap-opt" data-swap="' + esc(x) + '" style="--pc:' + SMASH_COLOR[x] + '">' + esc(x) + '</button>'; }).join('') +
        '<button type="button" class="linkbtn" data-swap-cancel="1">Cancel</button></div>';
    } else {
      html += '<div class="swap-row seats"><button type="button" class="swap-btn" data-swap-seat="p1">⇄ Swap ' + esc(pair[0]) + '</button><span class="vs-gap" aria-hidden="true">VS</span><button type="button" class="swap-btn" data-swap-seat="p2">⇄ Swap ' + esc(pair[1]) + '</button></div>';   // one under each card
    }
    if (smashAnim) html += '<div class="ko-flash ' + smashAnim.side + '" style="--pc:' + SMASH_COLOR[pair[smashAnim.side === 'p1' ? 0 : 1]] + '">GAME!</div>';
    html += '</div>';
    if (!isMain) html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="smash-main">Back to ' + esc(SMASH_MAIN[0]) + ' vs ' + esc(SMASH_MAIN[1]) + '</button></div>';
    // overall records across every pairing; the two regulars always show, the others once they've played
    var played = SMASH_NAMES.filter(function (nm) { var r = smashRecord(nm); return SMASH_MAIN.indexOf(nm) >= 0 || r.w + r.l > 0; });
    html += '<div class="standings">' + played.map(function (nm) { var r = smashRecord(nm); return '<span style="--pc:' + SMASH_COLOR[nm] + '"><i></i>' + esc(nm) + ' <b>' + r.w + '–' + r.l + '</b></span>'; }).join('') + '</div>';
    if (log.length) {
      var last = log[log.length - 1], loser = last.p[0] === last.w ? last.p[1] : last.p[0];
      var hist = smashPairLog(pair).slice(-24);   // this pairing's recent results, newest on the right
      html += '<div class="history">' + hist.map(function (e) { return '<i style="background:' + SMASH_COLOR[e.w] + '" title="' + esc(e.w) + '"></i>'; }).join('') + '<span style="margin-left:6px">last: ' + esc(last.w) + ' beat ' + esc(loser) + ', logged by ' + esc(last.by === me ? 'you' : last.by) + ' ' + esc(agoText(last.at)) + '</span></div>';
      html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="smash-undo">Undo last</button></div>';
    }
    body.innerHTML = html;
    smashAnim = null;
  }
  function smashWin(side) {
    var pair = smashPair.slice(), winner = pair[side === 'p1' ? 0 : 1];
    var log = ((smash && smash.log) || []).slice(-199), prevDoc = smash;
    var before = { n: smashCounts(pair)[winner] };
    log.push({ p: pair, w: winner, by: me, at: new Date().toISOString() });
    var doc = { log: log, updated_at: new Date().toISOString() };
    smash = doc; smashAnim = { side: side, from: before.n };
    renderSmash();
    var card = $('smash-body').querySelector('.smash'); if (card) { card.classList.add('shake'); }
    try { if (navigator.vibrate) navigator.vibrate([30, 40, 60]); } catch (e) { /* ignore */ }
    smashWrite(doc, prevDoc).catch(function (e) { toast('Couldn’t save that win: ' + ((e && e.message) || e)); });
  }
  function smashWrite(doc, prevDoc) {   // optimistic: the card already shows doc; count the write as in flight, and put prevDoc back if it fails
    smashInflight++;
    return store.setGame('smash', doc).then(function () { smashInflight--; }, function (e) {
      smashInflight--;
      if (smash === doc) { smash = prevDoc; renderSmash(); }
      throw e;
    });
  }
  function chargeStart(e) {
    if (e.target.closest('.swap-btn')) return;   // the Swap pill is a tap, not a hold
    var btn = e.target.closest('.fighter[data-side]'); if (!btn || charge) return;
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    charge = { btn: btn, side: btn.getAttribute('data-side'), t0: performance.now(), raf: 0 };
    btn.classList.add('charging');
    var tick = function (now) {
      if (!charge) return;
      var k = Math.min(1, (now - charge.t0) / 700);
      charge.btn.style.setProperty('--charge', k);
      if (k >= 1) { var side = charge.side; chargeEnd(); smashWin(side); return; }
      charge.raf = requestAnimationFrame(tick);
    };
    charge.raf = requestAnimationFrame(tick);
  }
  function chargeEnd() {
    if (!charge) return;
    cancelAnimationFrame(charge.raf);
    charge.btn.classList.remove('charging'); charge.btn.style.setProperty('--charge', 0);
    charge = null;
    if (smashDirty) { smashDirty = false; renderSmash(); }
  }
  $('smash-body').addEventListener('pointerdown', chargeStart);
  window.addEventListener('pointerup', chargeEnd); window.addEventListener('pointercancel', chargeEnd);
  $('smash-body').addEventListener('contextmenu', function (e) { if (e.target.closest('.fighter')) e.preventDefault(); });
  $('smash-body').addEventListener('click', function (e) {
    var seat = e.target.closest('[data-swap-seat]');
    if (seat) { smashSwap = seat.getAttribute('data-swap-seat'); buzz(6); renderSmash(); return; }
    var pick = e.target.closest('[data-swap]');
    if (pick && smashSwap) { smashPair[smashSwap === 'p1' ? 0 : 1] = pick.getAttribute('data-swap'); smashSwap = null; buzz(6); renderSmash(); return; }
    if (e.target.closest('[data-swap-cancel]')) { smashSwap = null; renderSmash(); return; }
    if (e.target.closest('#smash-main')) { smashResetPair(); buzz(6); renderSmash(); return; }
    if (e.target.closest('#smash-undo') && smash && smash.log && smash.log.length) {
      var doc = { log: smash.log.slice(0, -1), updated_at: new Date().toISOString() }, prev = smash;
      smash = doc; renderSmash();
      smashWrite(doc, prev).catch(function (err) { toast('Couldn’t undo: ' + ((err && err.message) || err)); });
    }
  });

  // ---- Games: leaderboards (air hockey vs Claude, mini golf) ----
  var golfScores = null, golfSub = false;
  function subscribeBoards() {
    if (store && store.scores && !scoresSub) { scoresSub = true; store.scores(function (sc) { scores = sc; renderScores(); renderHockeyBoard(); }); }
    if (store && store.golfScores && !golfSub) { golfSub = true; store.golfScores(function (doc) { golfScores = doc; renderGolfBoard(); }); }
  }
  var BOARD_MAX = 5;
  function renderHockeyBoard() {
    var body = $('hockeyboard-body'), st = $('hockeyboard-status'); if (!body) return;
    var sc = scores || { humans: 0, cpu: 0 }, h = sc.humans || 0, c = sc.cpu || 0;
    st.textContent = h === c ? (h ? 'Dead even' : 'No matches yet') : h > c ? 'Humans lead' : 'Claude leads';
    var by = sc.by || {}, rows = Object.keys(by).map(function (n) { return { name: n, w: by[n].w || 0, l: by[n].l || 0 }; })
      .sort(function (a, b) { return b.w - a.w || a.l - b.l || a.name.localeCompare(b.name); });
    body.innerHTML = '<div class="hb"><div class="hb-side' + (h > c ? ' lead' : '') + '"><span class="n">' + h + '</span><small>Humans</small></div><span class="hb-vs">vs</span><div class="hb-side claude' + (c > h ? ' lead' : '') + '"><span class="n">' + c + '</span><small>Claude</small></div></div>' +
      (rows.length ? '<div class="hb-rec"><div class="hb-rec-h">Records \u00b7 wins\u2013losses</div><div class="hb-rec-list">' + rows.map(function (r) {
        return '<span><span class="nm' + (r.name === me ? ' me' : '') + '">' + esc(r.name === me ? 'You' : r.name) + '</span><b><span class="w">' + r.w + '</span>\u2013<span class="l">' + r.l + '</span></b></span>';
      }).join('') + '</div></div>' : '');
  }
  function renderGolfBoard() {
    var body = $('golfboard-body'), st = $('golfboard-status'); if (!body) return;
    var by = (golfScores && golfScores.by) || {}, par = 27;   // nine holes, all par 3
    var rows = Object.keys(by).map(function (n) { return { name: n, best: by[n].best, rounds: by[n].rounds || 0 }; })
      .sort(function (a, b) { return a.best - b.best || b.rounds - a.rounds || a.name.localeCompare(b.name); });
    // the card is half the screen wide, so the status is one short phrase: the leader once there is one, the course until then
    st.innerHTML = rows.length ? '<b>' + esc(rows[0].name === me ? 'you lead' : rows[0].name + ' leads') + '</b>' : '9 holes \u00b7 par ' + par;
    if (!rows.length) { body.innerHTML = '<div class="lb-empty">Nobody yet</div>'; golfScrollCue(); golfCycle(); return; }
    body.innerHTML = '<div class="lb">' + rows.map(function (r, i) {
      var dtxt = golfToPar(r.best, par);
      return '<div class="lb-row' + (r.name === me ? ' me' : '') + '"><span class="rank">' + (i + 1) + '</span><span class="nm">' + esc(r.name === me ? 'You' : r.name) + '</span><span class="stat' + (dtxt.charAt(0) === '-' ? ' under' : dtxt === 'E' ? ' even' : '') + '">' + dtxt + '</span></div>';
    }).join('') + '</div>';
    golfScrollCue(); golfCycle();
  }
  // Left alone, the board idles through its rows a row at a time, rests at the bottom and starts over, so the
  // half-height list shows everyone without a scroll. A finger on the list pauses it for a while, and it only runs
  // while the Games tab is showing, the list actually overflows, and nobody is mid-game.
  var cycleTimer = null, cyclePauseUntil = 0;
  function golfCycle() {
    clearTimeout(cycleTimer);
    var body = $('golfboard-body'), card = $('golfboard'); if (!body || !card) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function live() { return tab === 'games' && !document.hidden && !$('main').hidden && !document.body.classList.contains('playing') && card.classList.contains('scrolls'); }
    function step() {
      if (!live()) return;
      if (Date.now() < cyclePauseUntil) { cycleTimer = setTimeout(step, 800); return; }
      var rows = body.querySelectorAll('.lb-row'), max = body.scrollHeight - body.clientHeight;
      var rowH = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : body.clientHeight;
      var atEnd = body.scrollTop >= max - 1;
      body.scrollTo({ top: atEnd ? 0 : Math.min(max, body.scrollTop + rowH), behavior: reduce ? 'auto' : 'smooth' });
      cycleTimer = setTimeout(step, atEnd ? 2600 : 2200);
    }
    if (live()) cycleTimer = setTimeout(step, 2600);
  }
  ['pointerdown', 'touchstart', 'wheel'].forEach(function (ev) { $('golfboard-body').addEventListener(ev, function () { cyclePauseUntil = Date.now() + 8000; }, { passive: true }); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) golfCycle(); });
  // the golf card is pinned to the air hockey card's height, so the list scrolls inside it: say how many rows are below the fold
  function golfScrollCue() {
    var body = $('golfboard-body'), card = $('golfboard'), cue = $('golfboard-more'); if (!body || !cue) return;
    var rows = body.querySelectorAll('.lb-row'), hidden = 0, bottom = body.scrollTop + body.clientHeight;
    for (var i = 0; i < rows.length; i++) if (rows[i].offsetTop + rows[i].offsetHeight > bottom + 6) hidden++;
    var scrolls = body.clientHeight > 0 && body.scrollHeight > body.clientHeight + 2;
    card.classList.toggle('scrolls', scrolls);
    card.classList.toggle('at-end', scrolls && !hidden);
    cue.hidden = !scrolls || !hidden;
    cue.textContent = '\u25BC ' + hidden + ' more';
  }
  $('golfboard-body').addEventListener('scroll', golfScrollCue, { passive: true });
  // once a game has been found on the name screen, its board doubles as a replay button
  function renderArcadeCues() {
    var h = foundGame('hockey'), g = foundGame('golf'), hb = $('hockeyboard'), gb = $('golfboard'), lede = $('arcade-lede');
    if (!hb || !gb) return;
    [[hb, h, 'Play air hockey again'], [gb, g, 'Play mini golf again']].forEach(function (x) {
      x[0].classList.toggle('replay', x[1]);
      if (x[1]) { x[0].setAttribute('role', 'button'); x[0].setAttribute('tabindex', '0'); x[0].setAttribute('aria-label', x[2]); }
      else { x[0].removeAttribute('role'); x[0].removeAttribute('tabindex'); x[0].removeAttribute('aria-label'); }
    });
    if (lede) lede.innerHTML = g ? 'Tap a board to <b>play</b>. You found the hidden one too.'
      : 'Tap the air hockey board to <b>play</b>. Mini golf is hidden on the name screen. Tap <b>Not you?</b> and poke around.';
  }
  [['hockeyboard', 'hockey'], ['golfboard', 'golf']].forEach(function (x) {
    var el = $(x[0]);
    el.addEventListener('click', function () { playAgain(x[1]); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playAgain(x[1]); } });
  });
  window.addEventListener('resize', golfScrollCue);

  // ---- Games: Mafia dealer ----
  var mafia = null, mafiaLoaded = false, mafiaSub = false, mafiaDraft = null, revealHold = false, modReveal = false, mafiaDealAnim = false;
  var MAFIA_MOD = 'Drew';   // Drew always runs the game; nobody else gets the controls
  function isMod() { return me === MAFIA_MOD; }
  // Drew's role sheet. Deal order: the Mafia seats (the Godfather takes one of them), then the toggled roles top to bottom
  // while seats last (Lovers take two), and whoever is left is a plain Villager.
  var ROLES = {
    villager:  { title: 'Villager', side: 'town', icon: '🌾', desc: 'A basic Town member with no special powers. Participates in daytime discussion, deduction, and voting.', night: '' },
    medic:     { title: 'Medic', side: 'town', icon: '🩹', short: 'Protects one player a night', desc: 'A Town protector who can prevent another player from being killed. May protect themselves, but cannot protect the same player, including themselves, on two consecutive nights.', night: 'Choose one player to protect. If that player would be killed that night, they survive.' },
    cop:       { title: 'Cop', side: 'town', icon: '🔍', short: 'Learns if a player is Town or Mafia', desc: 'A Town investigator who can determine whether another player is Town or Mafia.', night: 'Choose one player to investigate. Drew signals V for Villager/Town or M for Mafia.' },
    mayor:     { title: 'Mayor', side: 'town', icon: '🎩', short: 'Vote secretly counts as two', desc: 'A Town member whose vote secretly counts as two. The Mayor is not automatically revealed, but vote totals can indirectly give clues about who the Mayor is.', night: 'No night action. Your double vote is a passive ability used during daytime voting.' },
    vigilante: { title: 'Vigilante', side: 'town', icon: '🎯', short: 'May shoot one player a night', desc: 'A Town member who may attempt to kill another player at night. Killing Mafia has no penalty, but killing a Town player causes the Vigilante to die as well.', night: 'May choose one player to kill, or choose not to shoot. If the target is Mafia, only the target dies and you remain hidden. If the target is Town, both the target and you die.' },
    jester:    { title: 'Jester', side: 'town', icon: '🃏', short: 'Wins by getting voted out', desc: 'The Town clown. Has no traditional power, but has a unique personal objective: convincing the Town to vote them out.', night: '' },
    lover:     { title: 'Lover', side: 'town', icon: '💞', short: 'Two seats, soulbound', desc: 'Two Town players who are soulbound. If either Lover dies, the other dies as well.', night: 'No night action. You already know who your Lover is.' },
    watcher:   { title: 'Watcher', side: 'town', icon: '👀', short: 'Learns who visited a player', desc: 'A Town information role that watches one player and learns who interacted with that player during the night.', night: 'Choose one player to watch. Drew identifies every player who visited or interacted with that target that night, such as someone attempting to kill, protect, investigate, block, or otherwise target them.' },
    tracker:   { title: 'Tracker', side: 'town', icon: '🐾', short: 'Learns who a player visited', desc: 'A Town information role that follows one player and learns who that player interacted with during the night.', night: 'Choose one player to track. Drew identifies the player that the selected target visited or interacted with. If they did not target anyone, Drew indicates no action.' },
    judge:     { title: 'Judge', side: 'town', icon: '⚖️', short: 'Cancels one elimination per game', desc: 'A Town member who can cancel a daytime elimination once per game. Using the ability publicly reveals the Judge.', night: 'No night action. Once per game during the day, you may overrule a vote to eliminate a player. The elimination is canceled, you are revealed, and the game immediately proceeds to the next night.' },
    mafia:     { title: 'Mafia', side: 'mafia', icon: '🕶️', desc: 'A standard Mafia member who participates in selecting a player for the Mafia to kill each night. The kill can be prevented by protection.', night: 'Participate in selecting one player for the Mafia to kill.' },
    godfather: { title: 'Godfather', side: 'mafia', icon: '👑', short: 'Leads the Mafia, reads as Town to the Cop', desc: 'The leader of the Mafia. Appears innocent when investigated by the Cop and has final authority over the Mafia’s night kill.', night: 'Participate in the Mafia kill and make the final decision on which player is targeted.' }
  };
  var SPECIAL_ROLES = ['medic', 'cop', 'mayor', 'vigilante', 'jester', 'lover', 'watcher', 'tracker', 'judge'];   // sheet order = deal priority
  var TOGGLE_ROLES = ['godfather'].concat(SPECIAL_ROLES);
  function seatsFor(role) { return role === 'lover' ? 2 : 1; }
  function isMafiaRole(r) { return r === 'mafia' || r === 'godfather'; }
  function subscribeMafia() {
    if (mafiaSub || !store || !store.game) return;
    mafiaSub = true;
    store.game('mafia', function (doc) { var same = mafiaLoaded && sameDoc(doc, mafia); mafia = doc; mafiaLoaded = true; if (!same) renderMafia(); });
  }
  function mafiaDefaults() {
    var players = NAMES.filter(function (n) { return n !== me; }), roles = {};
    TOGGLE_ROLES.forEach(function (r) { roles[r] = true; });
    return { players: players, mafiaCount: Math.max(1, Math.round(players.length / 4)), roles: roles, hostPlays: false, guests: [] };
  }
  // What the draft would deal, in order: Mafia seats, then each toggled role while seats last, then Villagers.
  function mafiaPlan(d) {
    var players = d.players.slice(); if (d.hostPlays && players.indexOf(me) < 0) players.push(me);
    var n = players.length, mafiaCount = Math.max(1, Math.min(d.mafiaCount, Math.max(1, Math.floor((n - 1) / 2))));
    var deck = [], skipped = [];
    for (var i = 0; i < mafiaCount; i++) deck.push(i === 0 && d.roles.godfather ? 'godfather' : 'mafia');
    SPECIAL_ROLES.forEach(function (r) {
      if (!d.roles[r]) return;
      var seats = seatsFor(r);
      if (deck.length + seats <= n) { for (var k = 0; k < seats; k++) deck.push(r); } else skipped.push(r);
    });
    var villagers = Math.max(0, n - deck.length);
    while (deck.length < n) deck.push('villager');
    return { players: players, n: n, mafiaCount: mafiaCount, deck: deck, skipped: skipped, villagers: villagers };
  }
  function roleTitles(list) { return list.map(function (r) { return ROLES[r].title; }).join(', '); }
  function renderMafia() {
    var body = $('mafia-body'), status = $('mafia-status'); if (!body) return;
    if (!mafiaLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var g = mafia && mafia.status === 'dealt' ? mafia : null;
    if (!g) {
      status.textContent = 'No game running';
      if (!isMod()) {
        body.innerHTML = '<div class="liv-locked"><div class="lock">🕵️</div><b>' + esc(MAFIA_MOD) + ' runs Mafia.</b><span>Your card shows up here the moment he deals.</span></div>' +
          (mafia && mafia.status === 'ended' ? '<p class="info-sub" style="margin-top:10px">Last game ended ' + esc(agoText(mafia.ended_at)) + '.</p>' : '');
        return;
      }
      // lobby: set up a game
      var d = mafiaDraft || (mafiaDraft = mafiaDefaults()), plan = mafiaPlan(d), n = plan.n;
      var html = '<p class="info-sub">You’re the moderator, always. Pick who’s playing, turn roles on or off, deal, and everyone sees their own card on their own phone.</p>';
      html += '<div class="name-grid">' + NAMES.concat(guestsOf(d)).map(function (nm) {
        var inGame = nm === me ? d.hostPlays : d.players.indexOf(nm) >= 0;
        return '<button type="button" data-player="' + esc(nm) + '" aria-pressed="' + inGame + '"' + (guestsOf(d).indexOf(nm) >= 0 ? ' class="is-guest"' : '') + '>' + esc(nm === me ? 'You' : nm) + '</button>';
      }).join('') + '</div>';
      html += guestRowHtml(d, 'mafia-guest');
      html += '<div class="mafia-opts">' +
        '<div class="opt-row"><span>Mafia <span class="info-sub">(' + n + ' playing)</span></span><span class="stepper"><button type="button" data-step="-1">−</button><b>' + plan.mafiaCount + '</b><button type="button" data-step="1">+</button></span></div>' +
        '<div class="opt-row"><span>I’m playing too <span class="info-sub">(moderator sees all roles either way)</span></span><button type="button" class="toggle" data-opt="hostPlays" aria-pressed="' + d.hostPlays + '" aria-label="Host plays"></button></div>' +
        '</div>';
      html += '<div class="role-list"><div class="rl-head">Roles <span class="info-sub">dealt top to bottom after the Mafia</span></div>' + TOGGLE_ROLES.map(function (r) {
        var info = ROLES[r], out = plan.skipped.indexOf(r) >= 0;
        return '<div class="opt-row' + (out ? ' out' : '') + '"><span><span class="ri">' + info.icon + '</span><span><span class="rt">' + esc(info.title) + (r === 'godfather' ? ' <small>(one of the Mafia seats)</small>' : r === 'lover' ? ' <small>(2 seats)</small>' : '') + '</span><span class="rs">' + esc(out ? 'No seat left, sits out' : info.short) + '</span></span></span><button type="button" class="toggle" data-role="' + r + '" aria-pressed="' + !!d.roles[r] + '" aria-label="' + esc(info.title) + '"></button></div>';
      }).join('') + '</div>';
      var specials = plan.deck.filter(function (r) { return !isMafiaRole(r) && r !== 'villager'; }).length;
      html += '<div class="deal-sum' + (plan.skipped.length ? ' over' : '') + '">' + n + ' playing: ' + plan.mafiaCount + ' Mafia' + (d.roles.godfather ? ' (one is the Godfather)' : '') + ', ' + specials + ' with a role, ' + plan.villagers + ' plain ' + (plan.villagers === 1 ? 'Villager' : 'Villagers') + '.' +
        (plan.skipped.length ? ' <b>No seat left for ' + esc(roleTitles(plan.skipped)) + '.</b> Turn something off or add a player to bring them in.' : '') + '</div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="mafia-deal"' + (n < 4 ? ' disabled' : '') + '>🃏 Deal the cards</button></div>';
      if (mafia && mafia.status === 'ended') html += '<p class="info-sub" style="margin-top:10px">Last game ended ' + esc(agoText(mafia.ended_at)) + '.</p>';
      body.innerHTML = html;
      return;
    }
    // a game is running
    var alive = g.players.filter(function (p) { return (g.dead || []).indexOf(p) < 0; });
    var mafiaAlive = alive.filter(function (p) { return isMafiaRole(g.roles[p]); }).length, townAlive = alive.length - mafiaAlive;
    status.textContent = g.players.length + ' playing · dealt ' + agoText(g.dealt_at);
    var html = '';
    var myRole = g.roles[me];
    if (myRole) {
      var info = ROLES[myRole] || ROLES.villager, dead = (g.dead || []).indexOf(me) >= 0;
      var mates = isMafiaRole(myRole) ? g.players.filter(function (p) { return p !== me && isMafiaRole(g.roles[p]); }) : [];
      var partner = myRole === 'lover' ? g.players.filter(function (p) { return p !== me && g.roles[p] === 'lover'; })[0] : null;
      html += '<div class="role-card' + (revealHold && revealWhere === 'mafia' ? ' revealed' : '') + (mafiaDealAnim ? ' dealin' : '') + '" id="role-card"><div class="role-inner">' +
        '<div class="role-face back"><div class="icon">🃏</div><div class="hold">Hold to flip your card</div><div class="sub">Keep your thumb on it. Lifting hides it again.</div></div>' +
        '<div class="role-face front ' + info.side + '"><div class="icon">' + info.icon + '</div><div class="sub">You are</div><div class="role">' + esc(info.title) + '</div><div class="desc">' + esc(info.desc) + '</div>' +
        (info.night ? '<div class="night"><b>At night:</b> ' + esc(info.night) + '</div>' : '') +
        (mates.length ? '<div class="mates">Your Mafia: ' + esc(mates.map(function (p) { return p + (g.roles[p] === 'godfather' ? ' (Godfather)' : ''); }).join(', ')) + '</div>' : (isMafiaRole(myRole) ? '<div class="mates">You’re the only Mafia.</div>' : '')) +
        (partner ? '<div class="mates">Your Lover is ' + esc(partner) + '. If either of you dies, the other goes too.</div>' : '') +
        '</div></div></div>';
      if (dead) html += '<p class="info-sub" style="margin-top:8px">You’re out. No talking, no hints, no faces.</p>';
    } else if (!isMod()) {
      html += '<p class="info-sub">You’re not in this one. ' + esc(MAFIA_MOD) + ' is running it.</p>';
    }
    if (isMod()) {
      html += '<div class="cheat"><b>Moderator</b> · ' + mafiaAlive + ' Mafia and ' + townAlive + ' Town still alive' +
        (mafiaAlive === 0 ? ' · <b>Town wins.</b>' : mafiaAlive >= townAlive ? ' · <b>Mafia wins.</b>' : '') + '</div>';
      html += '<div class="mafia-actions"><button type="button" class="btn" id="mod-toggle">' + (modReveal ? 'Hide roles' : 'Show all roles') + '</button><button type="button" class="btn" id="mafia-redeal">Re-deal</button><button type="button" class="btn" id="mafia-end">End game</button></div>';
      if (modReveal) {
        html += '<div class="mod-list">' + g.players.map(function (p, i) {
          var isDead = (g.dead || []).indexOf(p) >= 0, r = g.roles[p], ri = ROLES[r] || ROLES.villager;
          return '<div class="mod-row' + (isDead ? ' dead' : '') + (modRevealAnim ? ' dealin' : '') + '"' + (modRevealAnim ? ' style="animation-delay:' + (i * 45) + 'ms"' : '') + '><span>' + esc(p) + '</span><span><span class="r ' + esc(r) + '">' + ri.icon + ' ' + esc(ri.title) + '</span> <button type="button" class="btn" data-dead="' + esc(p) + '">' + (isDead ? 'Revive' : 'Out') + '</button></span></div>';
        }).join('') + '</div>';
      }
      html += mafiaCheatSheet(g);
    } else {
      html += '<div class="cheat">' + alive.length + ' of ' + g.players.length + ' still alive' + ((g.dead || []).length ? ' · out: ' + esc((g.dead || []).join(', ')) : '') + ' · ' + esc(MAFIA_MOD) + ' is moderating</div>';
    }
    body.innerHTML = html;
    mafiaDealAnim = false; modRevealAnim = false;
  }
  // the narrator's script, built from the roles actually dealt so Drew never calls a role that isn't in play
  function mafiaCheatSheet(g) {
    var has = {}; Object.keys(g.roles).forEach(function (p) { has[g.roles[p]] = true; });
    var night = ['Everyone closes their eyes.', 'Mafia open, agree on a kill' + (has.godfather ? ' (the Godfather has the final say)' : '') + ', close.'];
    if (has.medic) night.push('Medic opens, points at who to protect (not the same person two nights running), closes.');
    if (has.cop) night.push('Cop opens, points at someone; you signal V or M' + (has.godfather ? ' (the Godfather reads as V)' : '') + '. Closes.');
    if (has.vigilante) night.push('Vigilante opens, may point at someone to shoot, or pass. Closes.');
    if (has.watcher) night.push('Watcher opens, points at someone to watch; you show them everyone who visited that person tonight. Closes.');
    if (has.tracker) night.push('Tracker opens, points at someone to follow; you show them who that person visited, or nobody. Closes.');
    var deaths = []; if (has.vigilante) deaths.push('a Vigilante who shot Town dies too'); if (has.lover) deaths.push('if a Lover dies, the other goes with them');
    var day = ['Announce who didn’t make it' + (deaths.length ? ' (' + deaths.join('; ') + ')' : '') + '.', 'Argue, then vote someone out' + (has.mayor ? '; the Mayor’s vote quietly counts twice' : '') + '.'];
    if (has.judge) day.push('The Judge may cancel one elimination per game. They’re revealed, and it goes straight to night.');
    if (has.jester) day.push('If the Town votes out the Jester, the Jester wins.');
    day.push('Repeat until the Mafia are gone or they outnumber the Town.');
    return '<div class="cheat"><b>Night</b><ol class="script">' + night.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol><b>Day</b><ol class="script">' + day.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      (has.lover ? '<span class="info-sub">The Lovers already see each other on their cards.</span>' : '') + '</div>';
  }
  var modRevealAnim = false;
  function dealMafia() {
    if (!isMod()) return;
    var d = mafiaDraft || mafiaDefaults(), plan = mafiaPlan(d);
    if (plan.n < 4) { toast('Need at least four players.'); return; }
    var deck = plan.deck.slice();
    for (var j = deck.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = deck[j]; deck[j] = deck[k]; deck[k] = t; }
    var roles = {}; plan.players.forEach(function (p, idx) { roles[p] = deck[idx]; });
    var doc = { status: 'dealt', host: me, players: plan.players, roles: roles, dead: [], dealt_at: new Date().toISOString(), mafia_count: plan.mafiaCount, guests: guestsOf(d), toggles: Object.assign({}, d.roles) };
    mafia = doc; modReveal = false; mafiaDealAnim = true; renderMafia(); buzz([20, 50, 20, 50, 20]);
    toast('Dealt. Everyone can check their phone.' + (plan.skipped.length ? ' ' + roleTitles(plan.skipped) + ' sat out.' : ''));
    store.setGame('mafia', doc).catch(function (e) { toast('Couldn’t deal: ' + ((e && e.message) || e)); });
  }
  $('mafia-body').addEventListener('submit', function (e) {
    if (e.target.id !== 'mafia-guest' || !isMod()) return;
    e.preventDefault();
    var d = mafiaDraft || (mafiaDraft = mafiaDefaults()), inp = e.target.querySelector('input');
    if (addGuest(d, inp.value)) { renderMafia(); var again = document.querySelector('#mafia-guest input'); if (again) again.focus(); buzz(6); }
  });
  $('mafia-body').addEventListener('click', function (e) {
    if (!isMod()) return;   // only the moderator's taps do anything here; everyone else just holds their card
    var d = mafiaDraft || (mafiaDraft = mafiaDefaults());
    var dg = e.target.closest('[data-drop-guest]'); if (dg) { dropGuest(d, dg.getAttribute('data-drop-guest')); renderMafia(); return; }
    var pl = e.target.closest('[data-player]');
    if (pl) {
      var nm = pl.getAttribute('data-player');
      if (nm === me) d.hostPlays = !d.hostPlays;
      else if (d.players.indexOf(nm) >= 0) d.players = d.players.filter(function (x) { return x !== nm; }); else d.players.push(nm);
      renderMafia(); return;
    }
    var st = e.target.closest('[data-step]');
    if (st) { d.mafiaCount = Math.max(1, Math.min(6, d.mafiaCount + (+st.getAttribute('data-step')))); renderMafia(); return; }
    var rt = e.target.closest('[data-role]');
    if (rt) { var rk = rt.getAttribute('data-role'); d.roles[rk] = !d.roles[rk]; buzz(6); renderMafia(); return; }
    var op = e.target.closest('[data-opt]');
    if (op) { var key = op.getAttribute('data-opt'); d[key] = !d[key]; renderMafia(); return; }
    if (e.target.closest('#mafia-deal')) { dealMafia(); return; }
    if (e.target.closest('#mafia-redeal')) {
      var toggles = mafia.toggles;
      if (!toggles) { toggles = {}; TOGGLE_ROLES.forEach(function (r) { toggles[r] = Object.keys(mafia.roles).some(function (p) { return mafia.roles[p] === r; }); }); }
      mafiaDraft = { guests: (mafia.guests || []).slice(), players: mafia.players.filter(function (p) { return p !== me; }), mafiaCount: mafia.mafia_count || 3, roles: toggles, hostPlays: mafia.players.indexOf(me) >= 0 };
      dealMafia(); return;
    }
    if (e.target.closest('#mafia-end')) {
      var ended = Object.assign({}, mafia, { status: 'ended', ended_at: new Date().toISOString() });
      store.setGame('mafia', ended).then(function () { mafia = ended; mafiaDraft = null; renderMafia(); }).catch(function (err) { toast('Couldn’t end it: ' + ((err && err.message) || err)); });
      return;
    }
    if (e.target.closest('#mod-toggle')) { modReveal = !modReveal; modRevealAnim = modReveal; renderMafia(); return; }
    var dd = e.target.closest('[data-dead]');
    if (dd) {
      var who = dd.getAttribute('data-dead'), dead = (mafia.dead || []).slice();
      if (dead.indexOf(who) >= 0) dead = dead.filter(function (x) { return x !== who; }); else dead.push(who);
      var upd = Object.assign({}, mafia, { dead: dead });
      store.setGame('mafia', upd).then(function () { mafia = upd; renderMafia(); }).catch(function (err) { toast('Couldn’t save that: ' + ((err && err.message) || err)); });
    }
  });
  // hold-to-reveal for your own role
  var revealWhere = null;   // which card is being held: 'mafia' or 'spyfall'
  function holdStart(e) {
    var card = e.target.closest('.role-card'); if (!card || revealHold) return;
    revealHold = true; revealWhere = card.closest('#spyfall-body') ? 'spyfall' : 'mafia'; card.classList.add('revealed'); buzz(15); e.preventDefault();
  }
  function holdEnd() { if (!revealHold) return; revealHold = false; revealWhere = null; Array.prototype.forEach.call(document.querySelectorAll('.role-card.revealed'), function (c) { c.classList.remove('revealed'); }); }
  $('mafia-body').addEventListener('pointerdown', holdStart);
  window.addEventListener('pointerup', holdEnd); window.addEventListener('pointercancel', holdEnd);
  $('mafia-body').addEventListener('contextmenu', function (e) { if (e.target.closest('#role-card')) e.preventDefault(); });

  // ---- Spyfall, cabin edition ----
  // Everyone gets the same place and a job there, except the spy, who gets nothing and has to bluff through the
  // questions. Any phone deals; each player holds their own card to see it, like Mafia. A countdown runs from the
  // deal. When it's up, the table votes, then someone taps Reveal. Never the same place twice running.
  var SPY_PLACES = [
    { k: 'hottub', name: 'The hot tub', icon: '🛁', roles: ['Towel runner', 'Temperature critic', 'Cannonballer', 'The one who won’t get in', 'Drink holder', 'Jet hog'] },
    { k: 'lift', name: 'The ski lift', icon: '🚡', roles: ['Lift operator', 'Snowboarder with one strap', 'Safety-bar enforcer', 'Dropped a pole', 'First-timer', 'Line cutter'] },
    { k: 'hibachi', name: 'The hibachi grill', icon: '🍤', roles: ['Chef', 'Onion-volcano fan', 'Shrimp catcher', 'Sake bomber', 'Birthday liar', 'Bill splitter'] },
    { k: 'liquor', name: 'The liquor store run', icon: '🍾', roles: ['Driver', 'Cart pusher', 'ID checker', 'Forgot the mixers', 'Budget keeper', 'Box-wine advocate'] },
    { k: 'i70', name: 'The drive up I-70', icon: '🚗', roles: ['Driver', 'DJ', 'Snack dispenser', 'Asleep in the back', 'Navigator', 'Carsick one'] },
    { k: 'deck', name: 'The deck at sunrise', icon: '☕', roles: ['Coffee maker', 'Blanket thief', 'Photographer', 'Hungover', 'Bird spotter', 'Up way too early'] },
    { k: 'sled', name: 'The sledding hill', icon: '🛷', roles: ['Tube pilot', 'Hill climber', 'Crash victim', 'Starter', 'Judge', 'Cocoa runner'] },
    { k: 'bunk', name: 'The bunk room', icon: '🛏️', roles: ['Top bunk', 'Snorer', 'Phone-light reader', 'Blanket hog', 'Earplug dealer', 'Night talker'] },
    { k: 'fire', name: 'The fire pit', icon: '🔥', roles: ['Fire starter', 'Marshmallow burner', 'Storyteller', 'Smoke dodger', 'Log hauler', 'Guitar guy'] },
    { k: 'kitchen', name: 'The kitchen at breakfast', icon: '🍳', roles: ['Pancake flipper', 'Bacon guard', 'Dish avoider', 'Coffee refiller', 'Orange-juice police', 'Taste tester'] },
    { k: 'rental', name: 'The ski rental shop', icon: '🎿', roles: ['Boot fitter', 'Lied about their height', 'Helmet refuser', 'Waiver signer', 'Line waiter', 'Wrong-size skis'] },
    { k: 'brewery', name: 'The brewery in town', icon: '🍺', roles: ['Flight sharer', 'Designated driver', 'Pretzel orderer', 'Trivia captain', 'Bartender', 'IPA snob'] },
    { k: 'gondola', name: 'The gondola', icon: '🚠', roles: ['Window fogger', 'Hates heights', 'Selfie taker', 'Door holder', 'Tourist', 'Operator'] },
    { k: 'mafia', name: 'Mafia night', icon: '🕵️', roles: ['Moderator', 'Dead on night one', 'Loud accuser', 'Quiet mafia', 'Medic who saves themselves', 'Rules lawyer'] },
    { k: 'grocery', name: 'The grocery run', icon: '🛒', roles: ['List keeper', 'Cart driver', 'Impulse buyer', 'Coupon finder', 'Bag carrier', 'Snack-aisle lurker'] },
    { k: 'checkin', name: 'Check-in at the house', icon: '🔑', roles: ['Door-code enterer', 'Room claimer', 'Bag hauler', 'Thermostat setter', 'Wi-Fi finder', 'Tour guide'] },
    { k: 'trail', name: 'The trailhead', icon: '🥾', roles: ['Pace setter', 'Water carrier', 'Bear-bell wearer', 'Photo stopper', 'Shortcut suggester', 'Dog walker'] },
    { k: 'pong', name: 'The beer pong table', icon: '🏓', roles: ['Rack straightener', 'Bounce-shot artist', 'Elbow referee', 'Cup refiller', 'Heckler', 'Rookie'] },
    { k: 'springs', name: 'The hot springs', icon: '♨️', roles: ['Towel guard', 'Pool hopper', 'Sulfur complainer', 'Lifeguard', 'Lost the locker key', 'Floater'] },
    { k: 'movie', name: 'Movie night on the couch', icon: '🍿', roles: ['Remote holder', 'Plot explainer', 'Popcorn maker', 'Asleep by the credits', 'Phone scroller', 'Volume adjuster'] }
  ];
  var spy = null, spyLoaded = false, spySub = false, spyDraft = null, spyBuzzed = null, spyDealAnim = false;
  function subscribeSpyfall() {
    if (spySub || !store || !store.game) return;
    spySub = true;
    store.game('spyfall', function (doc) { var same = spyLoaded && sameDoc(doc, spy); spy = doc; spyLoaded = true; if (!same) renderSpyfall(); });
  }
  function spyDefaults() { return { players: NAMES.slice(), spies: 1, mins: 8, guests: [] }; }
  function spyPlace(g) { return SPY_PLACES.filter(function (p) { return p.k === g.place; })[0] || SPY_PLACES[0]; }
  function spyLeft(g) { return Math.max(0, new Date(g.dealt_at).getTime() + g.mins * 60000 - Date.now()); }
  function mmss(ms) { var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function renderSpyfall() {
    var body = $('spyfall-body'), status = $('spyfall-status'); if (!body) return;
    if (!spyLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var g = spy && spy.status === 'dealt' ? spy : null, html = '';
    if (!g) {
      var d = spyDraft || (spyDraft = spyDefaults()), n = d.players.length, maxSpies = n >= 7 ? 2 : 1, spies = Math.min(d.spies, maxSpies);
      status.textContent = 'No round running';
      html += '<p class="info-sub">Everyone gets the same place and a job there, except the spy, who gets nothing and has to bluff. Take turns asking each other questions about the place. Don’t give it away, and don’t get caught. Anyone can deal.</p>';
      html += '<div class="name-grid">' + NAMES.concat(guestsOf(d)).map(function (nm) {
        return '<button type="button" data-player="' + esc(nm) + '" aria-pressed="' + (d.players.indexOf(nm) >= 0) + '"' + (guestsOf(d).indexOf(nm) >= 0 ? ' class="is-guest"' : '') + '>' + esc(nm === me ? 'You' : nm) + '</button>';
      }).join('') + '</div>';
      html += guestRowHtml(d, 'spyfall-guest');
      html += '<div class="mafia-opts">' +
        '<div class="opt-row"><span>Spies <span class="info-sub">(' + n + ' playing' + (maxSpies === 1 ? ' · two needs 7+' : '') + ')</span></span><span class="stepper"><button type="button" data-step="-1">−</button><b>' + spies + '</b><button type="button" data-step="1">+</button></span></div>' +
        '<div class="opt-row"><span>Minutes on the clock</span><span class="stepper"><button type="button" data-mins="-1">−</button><b>' + d.mins + '</b><button type="button" data-mins="1">+</button></span></div></div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="spy-deal"' + (n < 3 ? ' disabled' : '') + '>🔍 Deal the round</button></div>';
      if (spy && spy.status === 'ended') html += '<p class="info-sub" style="margin-top:10px">Last round ' + esc(agoText(spy.ended_at)) + ': ' + esc(spyPlace(spy).name) + ', spy ' + esc((spy.spies || []).join(' and ')) + '.</p>';
      body.innerHTML = html; return;
    }
    var place = spyPlace(g), left = spyLeft(g), inRound = g.players.indexOf(me) >= 0, isSpy = g.spies.indexOf(me) >= 0, revealed = g.revealed || left <= 0;   // the spy can come clean early; otherwise the clock reveals them
    status.textContent = g.players.length + ' playing · ' + (revealed ? 'revealed' : mmss(left) + ' left');
    html += '<div class="spy-clock' + (revealed ? ' up' : '') + '">' + (g.revealed ? 'The spy came clean' : left > 0 ? '<span data-spy-clock>' + mmss(left) + '</span>' : 'Time’s up') + '</div>';
    if (revealed) {
      html += '<div class="spy-reveal"><div class="icon">' + place.icon + '</div><div class="sub">The place was</div><div class="role">' + esc(place.name) + '</div><div class="mates">' + esc(g.spies.length > 1 ? 'The spies were ' + g.spies.join(' and ') : 'The spy was ' + g.spies[0]) + '</div></div>';
    } else if (inRound) {
      html += '<div class="role-card' + (revealHold && revealWhere === 'spyfall' ? ' revealed' : '') + (spyDealAnim ? ' dealin' : '') + '"><div class="role-inner">' +
        '<div class="role-face back"><div class="icon">🔍</div><div class="hold">Hold to see your card</div><div class="sub">Keep your thumb on it. Lifting hides it again.</div></div>' +
        (isSpy
          ? '<div class="role-face front mafia"><div class="icon">🕵️</div><div class="sub">You are</div><div class="role">The spy</div><div class="desc">You don’t know where everyone is. Listen, bluff, and work out the place before the clock runs out. Sure of it? Reveal yourself and call it.</div>' + (g.spies.length > 1 ? '<div class="mates">Your fellow spy: ' + esc(g.spies.filter(function (p) { return p !== me; }).join(', ')) + '</div>' : '') + '</div>'
          : '<div class="role-face front town"><div class="icon">' + place.icon + '</div><div class="sub">You’re at</div><div class="role">' + esc(place.name) + '</div><div class="desc">Your job: <b>' + esc(g.roles[me]) + '</b>. Answer like you’re there, but don’t make it easy for the spy.</div></div>') +
        '</div></div>';
    } else html += '<p class="info-sub">You’re not in this round. ' + esc(g.by === me ? 'You' : g.by) + ' dealt it.</p>';
    html += '<details class="spy-places"><summary>All ' + SPY_PLACES.length + ' places</summary><div class="spy-grid">' + SPY_PLACES.map(function (p) { return '<span' + (revealed && p.k === g.place ? ' class="hit"' : '') + '>' + p.icon + ' ' + esc(p.name) + '</span>'; }).join('') + '</div></details>';
    html += '<div class="mafia-actions">' + (revealed
      ? '<button type="button" class="big-btn" id="spy-again">🔍 Deal another</button><button type="button" class="btn" id="spy-end">Done</button>'
      : (isSpy ? '<button type="button" class="btn" id="spy-reveal">I’m the spy: reveal me</button>' : '') + '<button type="button" class="btn" id="spy-again">Re-deal</button>') + '</div>';
    html += '<div class="cheat">Dealt by ' + esc(g.by === me ? 'you' : g.by) + ' ' + esc(agoText(g.dealt_at)) + '. Go round the room asking questions about the place. Accuse whoever sounds lost before the clock runs out: when it does, every phone shows the place and the spy. Only the spy can reveal early, to call the place and claim the win.</div>';
    body.innerHTML = html; spyDealAnim = false;
  }
  function dealSpyfall(d) {
    var n = d.players.length; if (n < 3) { toast('Need at least three players.'); return; }
    var spies = Math.min(d.spies, n >= 7 ? 2 : 1);
    var choices = SPY_PLACES.filter(function (p) { return !spy || p.k !== spy.place; }), place = choices[Math.floor(Math.random() * choices.length)];
    var order = shuffled(d.players), spyList = order.slice(0, spies), roles = {}, jobs = shuffled(place.roles);
    order.slice(spies).forEach(function (p, i) { roles[p] = jobs[i % jobs.length]; });
    var doc = { status: 'dealt', by: me, players: d.players.slice(), guests: guestsOf(d).slice(), spies: spyList, place: place.k, roles: roles, mins: d.mins, dealt_at: new Date().toISOString(), revealed: false };
    spy = doc; spyDealAnim = true; spyBuzzed = null; renderSpyfall(); buzz([20, 50, 20, 50, 20]);
    toast('Dealt. Everyone, hold your card.');
    store.setGame('spyfall', doc).catch(function (e) { toast('Couldn’t deal: ' + ((e && e.message) || e)); });
  }
  function spyTick() {
    var g = spy && spy.status === 'dealt' ? spy : null; if (!g || g.revealed) return;
    var left = spyLeft(g), el = document.querySelector('[data-spy-clock]'), st = $('spyfall-status');
    if (left > 0) { if (el) el.textContent = mmss(left); if (st) st.textContent = g.players.length + ' playing · ' + mmss(left) + ' left'; return; }
    if (spyBuzzed === g.dealt_at) return;
    spyBuzzed = g.dealt_at; renderSpyfall();
    if (g.players.indexOf(me) >= 0) { buzz([60, 40, 60, 40, 120]); toast('Spyfall: time’s up. ' + (g.spies.length > 1 ? 'The spies were ' + g.spies.join(' and ') : 'The spy was ' + g.spies[0]) + '.'); }
  }
  $('spyfall-body').addEventListener('submit', function (e) {
    if (e.target.id !== 'spyfall-guest') return;
    e.preventDefault();
    var d = spyDraft || (spyDraft = spyDefaults()), inp = e.target.querySelector('input');
    if (addGuest(d, inp.value)) { renderSpyfall(); var again = document.querySelector('#spyfall-guest input'); if (again) again.focus(); buzz(6); }
  });
  $('spyfall-body').addEventListener('click', function (e) {
    var d = spyDraft || (spyDraft = spyDefaults());
    var dg = e.target.closest('[data-drop-guest]'); if (dg) { dropGuest(d, dg.getAttribute('data-drop-guest')); renderSpyfall(); return; }
    var pl = e.target.closest('[data-player]');
    if (pl) { var nm = pl.getAttribute('data-player'); if (d.players.indexOf(nm) >= 0) d.players = d.players.filter(function (x) { return x !== nm; }); else d.players.push(nm); renderSpyfall(); return; }
    var st = e.target.closest('[data-step]'); if (st) { d.spies = Math.max(1, Math.min(2, d.spies + (+st.getAttribute('data-step')))); renderSpyfall(); return; }
    var mn = e.target.closest('[data-mins]'); if (mn) { d.mins = Math.max(3, Math.min(15, d.mins + (+mn.getAttribute('data-mins')))); renderSpyfall(); return; }
    if (e.target.closest('#spy-deal')) { dealSpyfall(d); return; }
    if (e.target.closest('#spy-again') && spy) { spyDraft = { players: spy.players.slice(), guests: (spy.guests || []).slice(), spies: (spy.spies || []).length || 1, mins: spy.mins || 8 }; dealSpyfall(spyDraft); return; }
    if (e.target.closest('#spy-reveal') && spy && spy.spies.indexOf(me) >= 0) {   // only the spy's own tap reveals
      var rv = Object.assign({}, spy, { revealed: true });
      store.setGame('spyfall', rv).then(function () { spy = rv; renderSpyfall(); buzz([30, 40, 30]); }).catch(function (err) { toast('Couldn’t reveal: ' + ((err && err.message) || err)); });
      return;
    }
    if (e.target.closest('#spy-end') && spy) {
      var ended = Object.assign({}, spy, { status: 'ended', ended_at: new Date().toISOString() });
      store.setGame('spyfall', ended).then(function () { spy = ended; spyDraft = null; renderSpyfall(); }).catch(function (err) { toast('Couldn’t end it: ' + ((err && err.message) || err)); });
    }
  });
  $('spyfall-body').addEventListener('pointerdown', holdStart);
  $('spyfall-body').addEventListener('contextmenu', function (e) { if (e.target.closest('.role-card')) e.preventDefault(); });

  // ---- Fishbowl ----
  // Everyone drops three things in the bowl from their own phone. Two teams, three rounds on the same words: describe
  // it, one word, act it out. Turns are a minute. The phone that starts a turn runs it: it shows the card and takes
  // Got it or Skip; every other phone shows the score and the clock. Words live in one document per person
  // (game-fb-<name>), so thirteen people typing at once never overwrite each other; the game itself is one document.
  var FB_WORDS = 3, FB_TURN = 60, FB_ROUNDS = [
    { name: 'Describe it', rule: 'Say anything except the words on the card. No rhymes-with, no spelling it out.' },
    { name: 'One word', rule: 'One word, then silence. Choose it well.' },
    { name: 'Act it out', rule: 'No words, no sounds. Charades.' }
  ];
  var fb = null, fbLoaded = false, fbSub = false, fbWords = {}, fbWordsLoaded = false, fbPreview = null, fbExpiredFor = null;
  function subscribeFishbowl() {
    if (fbSub || !store || !store.game) return;
    fbSub = true;
    store.game('fishbowl', function (doc) { var same = fbLoaded && sameDoc(doc, fb); fb = doc; fbLoaded = true; if (!same) renderFishbowl(); });
    if (!store.games) { fbWordsLoaded = true; return; }
    store.games('fb-', function (rows) {
      var next = {}; rows.forEach(function (r) { if (r.doc && r.doc.by) next[r.doc.by] = r.doc; });
      var same = fbWordsLoaded && sameDoc(next, fbWords); fbWords = next; fbWordsLoaded = true; if (!same) renderFishbowl();
    });
  }
  function fbSession() { return (fb && fb.session) || 'first'; }
  function fbMine() { var d = fbWords[me]; return d && d.session === fbSession() ? (d.words || []) : []; }
  function fbPool() {   // who has words in this bowl, and the words themselves
    var s = fbSession(), out = { people: [], words: [] };
    NAMES.forEach(function (n) {
      var d = fbWords[n]; if (!d || d.session !== s || !d.words || !d.words.length) return;
      out.people.push(n); d.words.forEach(function (w, i) { out.words.push({ id: n + ':' + i, t: w, by: n }); });
    });
    return out;
  }
  function fbTeamName(g, i) { return TEAM_EMOJI[g.ti[i]] + ' ' + TEAM_NAMES[g.ti[i]]; }
  function fbWinner(g) { return g.score[0] === g.score[1] ? -1 : g.score[0] > g.score[1] ? 0 : 1; }
  function fbWinnerText(g) { var w = fbWinner(g); return w < 0 ? 'A tie, ' + g.score[0] + ' all.' : fbTeamName(g, w) + ' won ' + g.score[w] + '–' + g.score[1 - w] + '.'; }
  function fbLeft(g) { return Math.max(0, new Date(g.turn.started_at).getTime() + FB_TURN * 1000 - Date.now()); }
  function teamHtml(members, ti) {
    return '<div class="team" style="--tc:' + TEAM_COLORS[ti] + '"><div class="tname"><span class="mascot">' + TEAM_EMOJI[ti] + '</span>Team ' + TEAM_NAMES[ti] + '<small>' + members.length + '</small></div><div class="tmem">' +
      members.map(function (m) { return '<span class="' + (m === me ? 'me' : '') + '">' + esc(m) + '</span>'; }).join('') + '</div></div>';
  }
  function renderFishbowl() {
    var body = $('fishbowl-body'), status = $('fishbowl-status'); if (!body) return;
    if (!fbLoaded || !fbWordsLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var g = fb && (fb.status === 'play' || fb.status === 'over') ? fb : null, html = '';
    if (!g) {   // filling the bowl
      var pool = fbPool(), mine = fbMine(), can = pool.people.length >= 4;
      status.textContent = pool.words.length ? pool.words.length + ' in the bowl' : 'Bowl’s empty';
      html += '<p class="info-sub">Everyone drops ' + FB_WORDS + ' things in the bowl from their own phone: people, places, movies, inside jokes. Two teams, three rounds on the same words: describe it, one word, act it out. A minute a turn.</p>';
      html += '<div class="fb-mine"><div class="rl-head">Your ' + FB_WORDS + ' <span class="info-sub">(' + mine.length + ' in)</span></div>' +
        mine.map(function (w, i) { return '<span class="guest">' + esc(w) + '<button type="button" data-fb-drop="' + i + '" aria-label="Take out ' + esc(w) + '">×</button></span>'; }).join('') +
        (mine.length < FB_WORDS ? '<form class="guest-add" id="fb-add"><input type="text" maxlength="40" placeholder="Something to guess" autocomplete="off" autocapitalize="words"><button type="submit" class="btn">Drop in</button></form>' : '<span class="info-sub">You’re in. Sit tight.</span>') + '</div>';
      html += '<div class="fb-pool">' + (pool.people.length ? pool.people.map(function (n) { var c = fbWords[n].words.length; return '<span class="guest' + (c >= FB_WORDS ? ' full' : '') + '">' + esc(n === me ? 'You' : n) + ' <b>' + c + '</b></span>'; }).join('') : '<span class="info-sub">Nobody’s dropped anything in yet.</span>') + '</div>';
      if (fbPreview && !sameDoc(fbPreview.people, pool.people)) fbPreview = null;   // someone joined or left: roll again
      if (fbPreview) {
        html += '<div class="team-list">' + fbPreview.teams.map(function (members, i) { return teamHtml(members, fbPreview.ti[i]); }).join('') + '</div>';
        html += '<div class="mafia-actions"><button type="button" class="big-btn" id="fb-start">🐟 Start the game</button><button type="button" class="btn" id="fb-teams">Roll again</button></div>';
      } else {
        html += '<div class="mafia-actions"><button type="button" class="big-btn" id="fb-teams"' + (can ? '' : ' disabled') + '>🎲 Make the teams</button></div>';
        if (!can) html += '<div class="deal-sum">Needs four people with something in the bowl.</div>';
      }
      if (fb && fb.status === 'over') html += '<p class="info-sub" style="margin-top:10px">Last game: ' + esc(fbWinnerText(fb)) + '</p>';
      if (pool.words.length) html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="fb-new">Empty the bowl</button></div>';
      body.innerHTML = html; return;
    }
    var t = g.turn, running = !!t.started_at, left = running ? fbLeft(g) : 0, meRunner = running && t.runner === myId(), over = g.status === 'over';
    status.textContent = over ? (fbWinner(g) < 0 ? 'Tie, ' + g.score[0] + ' all' : TEAM_NAMES[g.ti[fbWinner(g)]] + ' won ' + g.score[fbWinner(g)] + '\u2013' + g.score[1 - fbWinner(g)]) : 'Round ' + g.round + ' \u00b7 ' + g.score[0] + '\u2013' + g.score[1];
    html += '<div class="fb-score">' + [0, 1].map(function (i) {
      return '<div class="fb-team' + (!over && t.team === i ? ' up' : '') + (over && fbWinner(g) === i ? ' won' : '') + '" style="--tc:' + TEAM_COLORS[g.ti[i]] + '"><span class="n">' + g.score[i] + '</span><small>' + fbTeamName(g, i) + '</small><span class="names">' + esc(g.teams[i].join(', ')) + '</span></div>';
    }).join('') + '</div>';
    if (over) {
      html += '<div class="fb-round"><b>Game over.</b> ' + esc(fbWinnerText(g)) + '</div>';
      html += '<div class="fb-rounds">' + FB_ROUNDS.map(function (rr, i) { return '<span>' + esc(rr.name) + ' <b>' + g.rounds[i][0] + '–' + g.rounds[i][1] + '</b></span>'; }).join('') + '</div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="fb-again">🐟 Same words, play again</button><button type="button" class="btn" id="fb-new">New bowl</button></div>';
      body.innerHTML = html; return;
    }
    var r = FB_ROUNDS[g.round - 1], teamName = fbTeamName(g, t.team);
    html += '<div class="fb-round"><b>Round ' + g.round + ' of 3: ' + esc(r.name) + '.</b> ' + esc(r.rule) + ' <span class="info-sub">' + g.left.length + ' of ' + g.entries.length + ' left in the bowl.</span></div>';
    if (!running) {
      html += '<div class="fb-up"><span class="sub">Up next for ' + teamName + '</span><span class="who">' + esc(t.giver === me ? 'You' : t.giver) + '</span></div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="fb-go">▶ ' + (t.giver === me ? 'Start my turn' : 'Start ' + esc(t.giver) + '’s turn on this phone') + '</button><button type="button" class="btn" id="fb-pass">Skip to the next person</button></div>';
    } else if (meRunner) {
      var cur = g.entries.filter(function (e) { return e.id === t.cur; })[0];
      html += '<div class="fb-clock' + (left <= 10000 ? ' low' : '') + '" id="fb-clock"><span data-fb-clock>' + mmss(left) + '</span></div>';
      html += '<div class="fb-card"><div class="w">' + esc(cur ? cur.t : '…') + '</div><div class="sub">' + (cur ? 'from ' + esc(cur.by) : '') + '</div></div>';
      html += '<div class="fb-btns"><button type="button" class="big-btn got" id="fb-got">✓ Got it</button><button type="button" class="btn skip" id="fb-skip"' + (g.left.length < 2 ? ' disabled' : '') + '>Skip</button></div>';
      html += '<div class="info-sub" style="margin-top:8px;text-align:center">' + t.got + ' this turn</div>';
    } else {
      html += '<div class="fb-up live"><span class="sub">' + teamName + ' · ' + esc(t.giver === me ? 'your turn is running on another phone' : t.giver + ' is up') + '</span><span class="who" data-fb-clock>' + mmss(left) + '</span><span class="sub">' + t.got + ' so far this turn</span></div>';
      if (left <= 0) html += '<div class="mafia-actions"><button type="button" class="btn" id="fb-timeout">That phone went quiet. Next turn.</button></div>';
    }
    html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="fb-end">End the game</button></div>';
    body.innerHTML = html;
  }
  function fbWrite(doc, what) {
    fb = doc; renderFishbowl();
    return store.setGame('fishbowl', doc).catch(function (e) { toast((what || 'Couldn’t save that') + ': ' + ((e && e.message) || e)); });
  }
  function fbSaveMine(words) {
    var doc = { by: me, session: fbSession(), words: words, at: new Date().toISOString() };
    fbWords = Object.assign({}, fbWords); fbWords[me] = doc; renderFishbowl();
    store.setGame('fb-' + me, doc).catch(function (e) { toast('Couldn’t save that: ' + ((e && e.message) || e)); });
  }
  function fbNextGiver(g, team) { var list = g.teams[team], i = g.next[team] % list.length; g.next[team] = i + 1; return list[i]; }
  function fbPick(g, not) { var ids = g.left.filter(function (id) { return id !== not; }); if (!ids.length) ids = g.left; return ids[Math.floor(Math.random() * ids.length)] || null; }
  function fbEndTurn(g) { var team = 1 - g.turn.team; g.turn = { team: team, giver: fbNextGiver(g, team), started_at: null, runner: null, cur: null, got: 0 }; return g; }
  function fbFresh(base) {   // a new game on the same teams and words
    var g = Object.assign({}, base, { status: 'play', at: new Date().toISOString(), round: 1, left: base.entries.map(function (e) { return e.id; }), score: [0, 0], rounds: [[0, 0], [0, 0], [0, 0]], next: [0, 0], turn: { team: Math.random() < 0.5 ? 0 : 1, giver: null, started_at: null, runner: null, cur: null, got: 0 } });
    delete g.over_at; g.turn.giver = fbNextGiver(g, g.turn.team); return g;
  }
  function fbStart() {
    var pool = fbPool(); if (!fbPreview || pool.people.length < 4) return;
    var doc = fbFresh({ session: fbSession(), by: me, teams: fbPreview.teams, ti: fbPreview.ti, entries: shuffled(pool.words) });
    fbPreview = null; buzz([20, 50, 20]); fbWrite(doc, 'Couldn’t start');
  }
  function fbGo() {
    var g = JSON.parse(JSON.stringify(fb)); if (g.turn.started_at) return;
    g.turn.started_at = new Date().toISOString(); g.turn.runner = myId(); g.turn.cur = fbPick(g, null); g.turn.got = 0;
    buzz([15, 40, 15]); fbWrite(g, 'Couldn’t start the turn');
  }
  function fbGot() {
    var g = JSON.parse(JSON.stringify(fb)), t = g.turn; if (!t.started_at || t.runner !== myId() || !t.cur) return;
    g.left = g.left.filter(function (id) { return id !== t.cur; }); g.score[t.team]++; g.rounds[g.round - 1][t.team]++; t.got++;
    buzz(12);
    if (g.left.length) t.cur = fbPick(g, t.cur);
    else if (g.round >= 3) { g.status = 'over'; g.over_at = new Date().toISOString(); buzz([40, 40, 40, 40, 120]); }
    else { g.round++; g.left = g.entries.map(function (e) { return e.id; }); fbEndTurn(g); toast('Bowl’s empty. Round ' + g.round + ': ' + FB_ROUNDS[g.round - 1].name + '.'); }
    fbWrite(g, 'Couldn’t score that');
  }
  function fbSkip() { var g = JSON.parse(JSON.stringify(fb)), t = g.turn; if (!t.started_at || t.runner !== myId() || g.left.length < 2) return; t.cur = fbPick(g, t.cur); buzz(6); fbWrite(g); }
  function fbTimeUp() {
    var g = JSON.parse(JSON.stringify(fb)); if (!g.turn.started_at) return;
    fbEndTurn(g); buzz([60, 40, 60, 40, 120]); toast('Time! ' + g.turn.giver + ' is up for ' + fbTeamName(g, g.turn.team) + '.'); fbWrite(g);
  }
  function fbTick() {
    var g = fb && fb.status === 'play' ? fb : null; if (!g || !g.turn.started_at) return;
    var left = fbLeft(g);
    Array.prototype.forEach.call(document.querySelectorAll('[data-fb-clock]'), function (el) { el.textContent = mmss(left); });
    var clock = $('fb-clock'); if (clock) clock.classList.toggle('low', left <= 10000);
    if (left > 0) return;
    if (g.turn.runner === myId()) fbTimeUp();
    else if (fbExpiredFor !== g.turn.started_at) { fbExpiredFor = g.turn.started_at; renderFishbowl(); }   // show the "went quiet" button once
  }
  $('fishbowl-body').addEventListener('submit', function (e) {
    if (e.target.id !== 'fb-add') return;
    e.preventDefault();
    var inp = e.target.querySelector('input'), w = String(inp.value || '').replace(/\s+/g, ' ').trim().slice(0, 40), mine = fbMine();
    if (!w) return;
    if (mine.some(function (x) { return x.toLowerCase() === w.toLowerCase(); })) { toast('That one’s already in.'); return; }
    if (mine.length >= FB_WORDS) return;
    fbSaveMine(mine.concat([w])); buzz(6);
    var again = document.querySelector('#fb-add input'); if (again) again.focus();
  });
  $('fishbowl-body').addEventListener('click', function (e) {
    var dr = e.target.closest('[data-fb-drop]'); if (dr) { var i = +dr.getAttribute('data-fb-drop'); fbSaveMine(fbMine().filter(function (x, k) { return k !== i; })); return; }
    if (e.target.closest('#fb-teams')) {
      var pool = fbPool(); if (pool.people.length < 4) return;
      var ti = shuffled([0, 1, 2, 3, 4, 5]).slice(0, 2);
      fbPreview = { people: pool.people.slice(), teams: makeTeams(pool.people, 2, true), ti: ti }; buzz([15, 60, 15]); renderFishbowl(); return;
    }
    if (e.target.closest('#fb-start')) { fbStart(); return; }
    if (!fb) return;
    if (e.target.closest('#fb-go')) { fbGo(); return; }
    if (e.target.closest('#fb-got')) { fbGot(); return; }
    if (e.target.closest('#fb-skip')) { fbSkip(); return; }
    if (e.target.closest('#fb-timeout')) { fbTimeUp(); return; }
    if (e.target.closest('#fb-pass')) { var g = JSON.parse(JSON.stringify(fb)); if (g.turn.started_at) return; g.turn.giver = fbNextGiver(g, g.turn.team); fbWrite(g); return; }
    if (e.target.closest('#fb-end')) { if (!window.confirm('End the game for everyone?')) return; var ge = JSON.parse(JSON.stringify(fb)); ge.status = 'over'; ge.over_at = new Date().toISOString(); fbWrite(ge, 'Couldn’t end it'); return; }
    if (e.target.closest('#fb-again')) { fbWrite(fbFresh(fb), 'Couldn’t restart'); return; }
    if (e.target.closest('#fb-new')) {
      var sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      fbPreview = null; fbWrite({ status: 'bowl', session: sid, by: me, at: new Date().toISOString() }, 'Couldn’t empty it');
    }
  });
  setInterval(function () { spyTick(); fbTick(); otTick(); }, 1000);

  // ---- Off Topic ----
  // An expansion pack for the box Mitch owns: fifty-six fresh cards, eight lines each like the real ones, most with a line
  // about someone on the trip. Deal one and every
  // phone shows the same card. A letter off the same twenty the die has and a two-minute clock are each optional, so
  // the table can use the real die or the sand timer instead. Answers go on the real pads. Dealt cards are marked
  // used so the deck doesn't repeat until it's shuffled back.
  var OT_CARDS = [
    ['Things you’d find in a glovebox', 'Reasons to leave a party early', 'Bad names for a dog', 'Things that are better cold', 'Something you’d yell from a ski lift', 'Excuses for a hangover', 'Things in a hot tub', 'Celebrities you’d trust to babysit'],
    ['Pizza toppings nobody orders', 'Things you lie to your dentist about', 'Things that smell worse wet', 'Reasons to call in sick', 'Bad names for a boat', 'Things Mitch would never admit', 'Something you’d steal from a hotel', 'Things that are overrated'],
    ['Words that sound dirty but aren’t', 'Things in a junk drawer', 'Reasons to break up with someone', 'Things you shouldn’t microwave', 'Bands that should reunite', 'Things you’d pack for a cabin weekend', 'Excuses for losing at beer pong', 'Things that are sticky'],
    ['Reasons the Wi-Fi is down', 'Something you’d name a racehorse', 'I can’t believe it’s not ______', 'Presents for Mitch', 'Things people brag about', 'Things in a bachelor’s fridge', 'Movies that made you cry', 'Reasons to get out of the hot tub'],
    ['Things you can’t say at a funeral', 'Ski injuries', 'Things you’d do for twenty dollars', 'Bad gifts for a wedding', 'Things that go in a cooler', 'Reasons to hate winter', 'Something a bartender hears too much', 'Things in a dive bar bathroom'],
    ['Famous rivalries', 'Things Katelyn is always right about', 'Things that are cheaper in bulk', 'Words you can’t spell without thinking', 'Things you’d find in a cabin closet', 'Reasons you missed the turn', 'Bad superhero names', 'Things that are free'],
    ['Something you’d hear on a group text', 'Foods that look like other foods', 'Things in a ski lodge', 'Reasons to lock the door', 'Jobs that sound fake', 'Things you shouldn’t google at work', 'Never trust a man with ______', 'Words to describe Katelyn'],
    ['Things that happen at 2 a.m.', 'Bad names for a strip club', 'Things in a bowl of chili', 'Reasons to skip the gym', 'Something you’d find under a couch cushion', 'Famous people you’d share a bunk with', 'Things that squeak', 'Reasons for a speeding ticket'],
    ['Things you order at a gas station', 'Ways to annoy the driver', 'Things you need two of', 'Reasons the dog is barking', 'Bad tattoo ideas', 'Things Drew keeps in his pockets', 'Things found on a mountain', 'Something you’d say to a cop'],
    ['Snacks you hide from roommates', 'Things in a tackle box', 'Reasons to leave a group chat', 'Things that are louder than they should be', 'Bad places for a first date', 'Things you’d bring to a desert island', 'Reasons you’re not drinking tonight', 'Bad names for a cocktail'],
    ['Things in a Winter Park gift shop', 'Something you regret buying', 'The cabin rule is no ______', 'Nicknames for Drew', 'Things you can do with one hand', 'Reasons to turn the car around', 'Things that are orange', 'Songs for a road trip'],
    ['Things you shouldn’t touch in a hotel', 'Things in a hibachi restaurant', 'Reasons to fake an injury', 'Bad names for a baby', 'Things you can put cheese on', 'Something you’d hear at a ski rental counter', 'Things that take too long', 'Items in a lost and found'],
    ['Reasons to stay up late', 'Reasons Luke is laughing', 'Things that are striped', 'Excuses for not texting back', 'Things you’d find in a tent', 'Reasons to be kicked out of a bar', 'Bad names for a band', 'Things that melt'],
    ['Something you shouldn’t say to your boss', 'Things in a kid’s backpack', 'Movies with a dog in them', 'Reasons to miss a flight', 'Things you can’t bring on a plane', 'Things that are blue', 'You can’t spell party without ______', 'Things Luke would eat on a dare'],
    ['Things in a mountain town', 'Reasons to leave the hot springs', 'Bad names for a yacht', 'Things that need batteries', 'Something you’d win at a carnival', 'Things people fake', 'Items on a bar tab', 'Reasons to cancel plans'],
    ['Things that are fuzzy', 'Words that end in -ing', 'Things you’d do on a snow day', 'Reasons the fire won’t start', 'Bad names for a race car', 'Kelly’s ideal Saturday involves ______', 'Things that come in a six-pack', 'Something you’d hear from the back seat'],
    ['Things in a medicine cabinet', 'Famous duos', 'Reasons to sleep in the car', 'Things that are slippery', 'Things you’d name a cabin', 'Things that are always in the way', 'Reasons for a black eye', 'Bad things to put on a résumé'],
    ['Things that float', 'Something you’d find at the bottom of a purse', 'Winter Park is famous for ______', 'Kelly’s walk-up song', 'Things you say to a dog', 'Items in a glove compartment of a rental', 'Reasons to go back inside', 'Things that are inflatable'],
    ['Foods you eat with your hands', 'Things at a tailgate', 'Reasons to wear sunglasses inside', 'Bad names for a pub', 'Things that are heavier than they look', 'Something you’d hear at a bachelor party', 'Things in a sauna', 'Reasons to whisper'],
    ['Things that are purple', 'Things Gabby can’t live without', 'Famous bridges, buildings or landmarks', 'Things you’d find in a dad’s truck', 'Things you do when nobody’s watching', 'Reasons to take the stairs', 'Bad names for a goldfish', 'Things that are chewy'],
    ['Something you’d find in a ski jacket pocket', 'Things that are impossible to fold', 'Items in a first aid kit', 'Reasons to hide in the bathroom', 'Things that glow', 'Words that mean drunk', 'Sorry I’m late, I was ______', 'Gabby’s next tattoo'],
    ['Things in a pancake house', 'Reasons to be late to breakfast', 'Bad names for a ski run', 'Things you buy at a liquor store', 'Something you shouldn’t say at a wedding', 'Things you can’t return', 'Items in a gym bag', 'Reasons to skip the hot tub'],
    ['Things that are crunchy', 'Animals you wouldn’t want in the cabin', 'Things you forget to pack', 'Reasons to pull over', 'Bad names for a wrestler', 'Joe’s nickname should be ______', 'Things that are hard to pronounce', 'Something you’d find on a gondola floor'],
    ['Things that come in pairs', 'Items at a yard sale', 'Reasons to move to Colorado', 'Things that are spicy', 'Famous Mikes', 'Things in a bunk room', 'Reasons to apologise to a neighbour', 'Bad names for a bakery'],
    ['Things you can set on fire', 'Something you’d hear at a hot tub party', 'The hot tub is no place for ______', 'Things Joe would do for a free beer', 'Things that are impossible to find when you need them', 'Candy you never finish', 'Reasons to sit by the window', 'Things that are salty'],
    ['Things you’d name a snowman', 'Things you find in the snow in spring', 'Reasons to change your name', 'Bad names for a coffee shop', 'Things you can juggle', 'Something you’d yell at the TV', 'Things people collect', 'Items in a camper van'],
    ['Reasons to call your mom', 'Things Liv would bring to a desert island', 'Things that are round', 'Famous Jacks', 'Things you’d do with a snow day off', 'Reasons to not answer the door', 'Bad names for a cruise ship', 'Things that are bumpy'],
    ['Something you’d find in a ski patrol hut', 'Things that are instantly regretted', 'Breakfast foods', 'Reasons for a group photo retake', 'Things that are see-through', 'Things you can order at a drive-through', 'Real men eat ______', 'Liv’s hidden talent'],
    ['Things in a Denver airport', 'Reasons to take a nap', 'Bad names for a hair salon', 'Things you can’t do in ski boots', 'Something you’d hear at a mountain bar', 'Things that come in a can', 'Items in a camping store', 'Reasons to get a tattoo'],
    ['Things that are checkered', 'Famous Chrises', 'Things in a hot chocolate', 'Reasons to be mad at a roommate', 'Bad names for a sports team', 'Terry’s autobiography title', 'Things that are bendy', 'Something you’d find in a mountain lodge lobby'],
    ['Things that stain', 'Items you can rent', 'Reasons to leave early on Sunday', 'Things that are soggy', 'Words with a silent letter', 'Things you need a permit for', 'Reasons to ditch a blind date', 'Bad names for a ski resort'],
    ['Things that are good with ranch', 'Something you’d hear in a sled line', '______ ruins a road trip', 'Things that make Terry mad', 'Things you have too many of', 'Items in a hotel minibar', 'Reasons to switch seats', 'Things that are wrinkled'],
    ['Things you’d name a hot tub', 'Things at a bonfire', 'Reasons your card got declined', 'Bad names for a theme park', 'Things that are shiny', 'Something you’d say to a bear', 'Things you inherit', 'Items in a lifeguard chair'],
    ['Reasons to drink water', 'Things Jess says in the group chat', 'Things that are magnetic', 'Famous dogs', 'Things in a kitchen at 7 a.m.', 'Reasons to miss the last lift', 'Bad names for a plumber', 'Things you can do in a hot tub'],
    ['Something you shouldn’t say on a first date', 'Things you’d find in a ski town bar', 'Items in a diaper bag', 'Reasons to make a toast', 'Things that are tiny', 'Words that rhyme with snow', 'Put ______ on the grocery list', 'Jess’s superpower'],
    ['Things on a cabin porch', 'Reasons to leave the slopes early', 'Bad names for a cat', 'Things that are good fried', 'Something you’d hear in a tube line', 'Things that get stuck in your teeth', 'Items in a tool box', 'Reasons to turn the music down'],
    ['Things that are pointy', 'Famous Daves', 'Things in a trunk', 'Reasons to carry cash', 'Bad names for a dentist', 'Kyle’s secret talent is ______', 'Things you can’t buy on Sunday', 'Something you’d find in a hunting lodge'],
    ['Things people hoard', 'Items on a camping checklist', 'Reasons to cry at a movie', 'Things that are neon', 'Things you’d name a moose', 'Things you do while waiting for pizza', 'Reasons to leave the cabin door unlocked', 'Bad names for a kid’s toy'],
    ['Things that are good on a stick', 'Something you’d hear from a ski instructor', 'Never ski with ______', 'Kyle’s guilty pleasure', 'Things that come in a box', 'Items in a glove', 'Reasons to pretend you’re asleep', 'Things that are squishy'],
    ['Famous Lisas', 'Things in a mountain cabin bathroom', 'Reasons to go to bed early', 'Bad names for a brewery', 'Things that are best on a Friday', 'Something you’d hear in a casino', 'Things that come in rolls', 'Items in an emergency kit'],
    ['Reasons for a group hug', 'Kyrsten’s dream job', 'Things that are hairy', 'Words that start with snow', 'Things you leave in the car overnight', 'Reasons to go outside in your socks', 'Bad names for a restaurant', 'Things that are dangerous when wet'],
    ['Something you’d hear at a ski swap', 'Things you forget on purpose', 'Items in a bachelorette bag', 'Reasons to turn your phone off', 'Things that are lumpy', 'Famous Toms', 'The worst roommate has ______', 'Kyrsten’s catchphrase'],
    ['Things in a mountain lake', 'Reasons to never go back to a bar', 'Bad names for an airline', 'Things that are good with ketchup', 'Something you’d say at a bachelor party', 'Things you’d find in a lift line', 'Items you lose on vacation', 'Reasons to send a group text at 3 a.m.'],
    ['Things that are dusty', 'Things you’d name a fire pit', 'Things at a snowball fight', 'Reasons to leave a tip', 'Bad names for a hotel', 'Justin’s pre-game ritual involves ______', 'Things that are good on toast', 'Something you’d hear from a parent on the phone'],
    ['Things that come in flavours', 'Items in a ski bag', 'Reasons to move the couch', 'Things that are striped or spotted', 'Famous Sams', 'Things you’d find in a cabin freezer', 'Reasons to take the long way', 'Bad names for a gym'],
    ['Things that are good in a sandwich', 'Something a lift operator says', 'I only drink ______ on weekends', 'Justin’s first words at the cabin', 'Things that are impossible to carry', 'Items in a hunting cabin', 'Reasons to trade bunks', 'Things that are gooey'],
    ['Things you shout when you win', 'Things that happen at check-out', 'Reasons to lose your phone', 'Bad names for a nail salon', 'Things that are good with butter', 'Something you’d hear on a snowmobile', 'Things that come in a jar', 'Items in a mechanic’s shop'],
    ['Reasons to walk home', 'Things said in this group chat', 'Things that are curly', 'Famous Kellys', 'Things in the back of a pickup', 'Reasons to sleep on the couch', 'Bad names for a pizza place', 'Things you can’t eat with a fork'],
    ['Something you’d say to a snowplow driver', 'Things that get lost in the wash', 'Items in a hunter’s pocket', 'Reasons to cancel the hibachi', 'Things that are speckled', 'Words that sound made up', 'The couch smells like ______', 'Reasons we’re late to hibachi'],
    ['Things you buy at midnight', 'Reasons to hide the remote', 'Bad names for a boat rental', 'Things that are good cold the next day', 'Something you’d find in a ski boot', 'Things that scream', 'Items in a gondola', 'Reasons to leave the fire burning'],
    ['Things that are rubbery', 'Famous Joes', 'Things in a mountain weather forecast', 'Reasons to keep your boots on', 'Bad names for a tattoo parlour', 'Things that will happen at Winter Park', 'Things that are good with hot sauce', 'Something you’d hear at a hot tub at midnight'],
    ['Things that come with a warning', 'Items in a sled', 'Reasons for a redo', 'Things that are foggy', 'Things you’d name a ski run', 'Things that end a party', 'Reasons to eat in the car', 'Bad names for a wine'],
    ['Things that are good with a fried egg on top', 'Something you’d hear at a mountain wedding', 'Nobody warned me about ______', 'Nicknames for this cabin', 'Things you can’t un-see', 'Items in a snow globe', 'Reasons to leave the group chat on mute', 'Things that are icy'],
    ['Famous Drews', 'Things on a cabin fridge door', 'Reasons to start a fight', 'Bad names for a cologne', 'Things that are good with peanut butter', 'Something a hot tub repair guy says', 'Things you’d do with a free afternoon', 'Items on a ski map'],
    ['Reasons to check the oven', 'Things to blame Mitch for', 'Things that are bouncy', 'Words that mean cold', 'Things in a Colorado dispensary', 'Reasons to miss the group photo', 'Bad names for a kids’ show', 'Things that are good drenched in syrup'],
    ['Something you’d hear at a tubing hill', 'Things that break at the worst time', 'Items in a lunch box', 'Reasons to start a group chat', 'Things that are lopsided', 'Famous Lukes', 'First rule of Mafia: ______', 'Reasons Drew is moderating again']
  ];
  var OT_LETTERS = 'ABCDEFGHIJKLMNOPRSTW', OT_SECS = 120;
  var ot = null, otLoaded = false, otSub = false, otBuzzed = null, otOpts = null;
  function subscribeOffTopic() {
    if (otSub || !store || !store.game) return;
    otSub = true;
    store.game('offtopic', function (doc) { var same = otLoaded && sameDoc(doc, ot); ot = doc; otLoaded = true; if (!same) renderOffTopic(); });
  }
  function otOptions() { if (!otOpts) otOpts = Object.assign({ letter: true, clock: true }, (ot && ot.opts) || {}); return otOpts; }
  function otLeft(g) { return g.started_at ? Math.max(0, new Date(g.started_at).getTime() + OT_SECS * 1000 - Date.now()) : 0; }
  function otLetter(not) { var pool = OT_LETTERS.split('').filter(function (l) { return l !== not; }); return pool[Math.floor(Math.random() * pool.length)]; }
  function otUsed() { return (ot && ot.used) || []; }
  function otChip(g) {
    var bits = ['Card ' + (101 + g.card)];
    if (g.letter) bits.push(g.letter);
    if (g.started_at) { var left = otLeft(g); bits.push(left > 0 ? mmss(left) : 'pencils down'); }
    return bits.join(' · ');
  }
  function renderOffTopic() {
    var body = $('offtopic-body'), status = $('offtopic-status'); if (!body) return;
    if (!otLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var g = ot && ot.status === 'card' ? ot : null, used = otUsed(), html = '';
    if (!g) {
      var o = otOptions();
      status.textContent = 'No card out';
      html += '<p class="info-sub">' + OT_CARDS.length + ' new cards to go with the box, with the thirteen of us worked in. Deal one and every phone shows the same card. Pads and pencils as usual: one answer per line, starting with the letter. Matches cross out, unique answers score.</p>';
      html += '<div class="mafia-opts">' +
        '<div class="opt-row"><span>Roll a letter <span class="info-sub">(off if you’re using the die)</span></span><button type="button" class="toggle" data-ot-opt="letter" aria-pressed="' + !!o.letter + '" aria-label="Roll a letter"></button></div>' +
        '<div class="opt-row"><span>Run the two-minute clock <span class="info-sub">(off if you’re using the timer)</span></span><button type="button" class="toggle" data-ot-opt="clock" aria-pressed="' + !!o.clock + '" aria-label="Run the clock"></button></div></div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="ot-deal">📝 Deal a card</button></div>';
      html += '<div class="deal-sum">' + used.length + ' of ' + OT_CARDS.length + ' cards used' + (used.length ? ' · <button type="button" class="linkbtn" id="ot-shuffle">Shuffle them back in</button>' : '') + '</div>';
      body.innerHTML = html; return;
    }
    var left = otLeft(g), card = OT_CARDS[g.card] || OT_CARDS[0], num = 101 + g.card;
    status.textContent = otChip(g);
    if (g.letter || g.started_at) {
      html += '<div class="ot-top">' + (g.letter ? '<div class="ot-letter" id="ot-letter-badge">' + g.letter + '</div>' : '<div class="ot-note">Roll the die</div>') +
        (g.started_at ? '<div class="ot-clock' + (left > 0 && left <= 10000 ? ' low' : '') + '" id="ot-clock">' + (left > 0 ? '<span data-ot-clock>' + mmss(left) + '</span>' : '<span class="pd">Pencils down</span>') + '</div>' : '<div class="ot-note right">Flip the timer</div>') + '</div>';
    }
    html += '<div class="ot-card"><div class="ot-num">' + num + '</div><ol>' + card.map(function (c, i) { return '<li><span class="n">' + (i + 1) + '.</span><span>' + esc(c) + '</span></li>'; }).join('') + '</ol>' +
      '<div class="ot-logo"><span class="big">Off Topic</span><small>Expansion pack</small></div></div>';
    html += '<div class="mafia-actions"><button type="button" class="big-btn" id="ot-next">📝 Next card</button>' +
      (g.letter ? '<button type="button" class="btn" id="ot-reroll">Roll the letter again</button>' : '') +
      (g.started_at ? '<button type="button" class="btn" id="ot-restart">Restart the clock</button>' : '') +
      '<button type="button" class="linkbtn" id="ot-away">Put it away</button></div>';
    html += '<div class="info-sub" style="margin-top:10px">Dealt by ' + esc(g.by === me ? 'you' : g.by) + ' ' + esc(agoText(g.dealt_at)) + ' · ' + used.length + ' of ' + OT_CARDS.length + ' cards used</div>';
    body.innerHTML = html;
  }
  function otWrite(doc, what) { ot = doc; renderOffTopic(); return store.setGame('offtopic', doc).catch(function (e) { toast((what || 'Couldn’t save that') + ': ' + ((e && e.message) || e)); }); }
  function otDeal() {
    var o = ot && ot.status === 'card' ? Object.assign({ letter: true, clock: true }, ot.opts || {}) : otOptions();   // next card keeps the dealt card's settings
    var used = otUsed().slice(), fresh = [];
    for (var i = 0; i < OT_CARDS.length; i++) if (used.indexOf(i) < 0) fresh.push(i);
    if (!fresh.length) { used = []; for (var k = 0; k < OT_CARDS.length; k++) fresh.push(k); toast('That was the whole deck. Shuffled back in.'); }
    var idx = fresh[Math.floor(Math.random() * fresh.length)];
    used.push(idx);
    var now = new Date().toISOString();
    var doc = { status: 'card', card: idx, letter: o.letter ? otLetter(ot && ot.letter) : null, started_at: o.clock ? now : null, opts: { letter: !!o.letter, clock: !!o.clock }, used: used, by: me, dealt_at: now };
    otBuzzed = null; buzz([15, 40, 15]); otWrite(doc, 'Couldn’t deal');
  }
  function otTick() {
    var g = ot && ot.status === 'card' && ot.started_at ? ot : null; if (!g) return;
    var left = otLeft(g), el = document.querySelector('[data-ot-clock]'), st = $('offtopic-status'), clock = $('ot-clock');
    if (left > 0) { if (el) el.textContent = mmss(left); if (clock) clock.classList.toggle('low', left <= 10000); if (st) st.textContent = otChip(g); return; }
    if (otBuzzed === g.started_at) return;
    otBuzzed = g.started_at; renderOffTopic();
    if (!$('offtopic-body').hidden) { buzz([80, 40, 80, 40, 160]); toast('Off Topic: pencils down!'); }
  }
  $('offtopic-body').addEventListener('click', function (e) {
    var op = e.target.closest('[data-ot-opt]'); if (op) { var o = otOptions(), key = op.getAttribute('data-ot-opt'); o[key] = !o[key]; buzz(6); renderOffTopic(); return; }
    if (e.target.closest('#ot-deal') || e.target.closest('#ot-next')) { otDeal(); return; }
    if (!ot) return;
    if (e.target.closest('#ot-shuffle')) { otWrite(Object.assign({}, ot, { used: [] })); return; }
    if (e.target.closest('#ot-reroll')) { otBuzzed = null; buzz(8); otWrite(Object.assign({}, ot, { letter: otLetter(ot.letter) }, ot.started_at ? { started_at: new Date().toISOString() } : {})); return; }
    if (e.target.closest('#ot-restart')) { otBuzzed = null; buzz(8); otWrite(Object.assign({}, ot, { started_at: new Date().toISOString() })); return; }
    if (e.target.closest('#ot-away')) { otOpts = Object.assign({ letter: true, clock: true }, ot.opts || {}); otWrite(Object.assign({}, ot, { status: 'ended', ended_at: new Date().toISOString() }), 'Couldn’t put it away'); }
  });

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
    $('cabin-countdown').textContent = days > 1 ? 'Winter Park \u00b7 ' + days + ' days out' : days === 1 ? 'Winter Park \u00b7 tomorrow' : days === 0 ? 'Winter Park \u00b7 today' : 'Winter Park, Colorado';
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
  // The door codes live in secrets.js as ciphertext. The trip password (shared in the group text, never in
  // the repo) unlocks them in the browser via PBKDF2 + AES-GCM; the derived key is kept on this phone after that.
  var secrets = null;
  function b64bytes(b) { var bin = atob(b), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function bytes64(u) { var bin = ''; for (var i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]); return btoa(bin); }
  function secretsReady() { return !!(window.SECRETS && window.crypto && crypto.subtle); }
  function deriveSecretKey(pass) {
    var S = window.SECRETS, enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC').trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64bytes(S.salt), iterations: S.rounds || 300000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
  }
  function openSecrets(key) {
    var S = window.SECRETS;
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64bytes(S.iv) }, key, b64bytes(S.data)).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
  }
  function renderSecrets() {
    var codes = $('codes'), form = $('unlock'); if (!codes) return;
    codes.classList.toggle('locked', !secrets);
    if (form) form.hidden = !!secrets || !secretsReady();
    Array.prototype.forEach.call(codes.querySelectorAll('.code'), function (c) {
      var v = secrets ? secrets[c.getAttribute('data-key')] : null;
      c.querySelector('.val').textContent = v || (secrets ? '—' : '••••');
    });
    var ws = $('wifi-sub'); if (ws) ws.textContent = secrets ? (secrets.wifiPass ? 'password: ' + secrets.wifiPass : 'no password') : '';
    var rn = $('res-no'); if (rn) rn.textContent = secrets ? (secrets.reservation || '—') : '•••••';
  }
  function unlockCore(pass) {   // derive the key, open the codes, remember the key on this phone
    return deriveSecretKey(pass).then(function (key) {
      return openSecrets(key).then(function (data) {
        secrets = data;
        return crypto.subtle.exportKey('raw', key).then(function (raw) { lsSet('cabin-haul-key', bytes64(new Uint8Array(raw))); });
      });
    }).then(renderSecrets);
  }
  function unlockWith(pass) {
    var form = $('unlock'), msg = $('unlock-msg');
    form.classList.add('busy'); msg.textContent = '';
    return unlockCore(pass).then(function () { buzz([8, 30, 8]); toast('Unlocked. Codes stay on this phone.'); })
      .catch(function () { msg.textContent = 'Not it. Check the group text.'; buzz(20); })
      .then(function () { form.classList.remove('busy'); });
  }
  // The link in the group text carries the trip password after a #, e.g. ...#k=word-word-word-00. The fragment never
  // leaves the phone (browsers don't send it to the server) and isn't in the repo, so nobody has to type anything.
  function passFromLink() {
    var m = /(?:^#|[#&])k=([^&]+)/.exec(location.hash || '');
    if (!m) return window.TRIP_LINK_KEY || null;   // the artifact build stamps the password in, since it can't be opened from the link
    // the #k= stays in the address bar on purpose: a home-screen shortcut made from this page then carries it and opens unlocked
    try { return decodeURIComponent(m[1]).trim(); } catch (e) { return m[1].trim(); }
  }
  (function () {
    renderSecrets();
    if (!secretsReady()) return;
    var linkPass = passFromLink(), saved = lsGet('cabin-haul-key');
    if (linkPass) {   // opened from the group-text link: unlock quietly, the form stays as the fallback if the link was stale
      unlockCore(linkPass).catch(function () { /* wrong or old password in the link; the form below still works */ });
    } else if (saved) {   // unlocked on this phone before: re-open with the stored key, no password needed
      crypto.subtle.importKey('raw', b64bytes(saved), { name: 'AES-GCM' }, false, ['decrypt']).then(openSecrets)
        .then(function (data) { secrets = data; renderSecrets(); })
        .catch(function () { lsDel('cabin-haul-key'); renderSecrets(); });   // secrets were re-sealed with a new password
    }
    var form = $('unlock'); if (!form) return;
    form.addEventListener('submit', function (e) { e.preventDefault(); var v = $('trip-code').value.trim(); if (v) unlockWith(v); });
  })();
  $('page-cabin').addEventListener('click', function (e) {
    var c = e.target.closest('.code'); if (!c) return;
    if (!secrets) { var inp = $('trip-code'); if (inp) { inp.focus(); } buzz(10); return; }
    var v = secrets[c.getAttribute('data-key')]; if (!v) return;
    copyText(v, c.getAttribute('data-what') + ' copied.'); buzz(6);
    c.classList.add('copied'); setTimeout(function () { c.classList.remove('copied'); }, 900);
  });
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
  var votes = [], qsim = null, qIndex = 0, predSub = false, expanded = null, comments = [], draft = '', reactions = [], pickerFor = null;
  var EMOJI = ['\uD83D\uDE02', '\uD83D\uDD25', '\uD83D\uDC80', '\uD83D\uDC40', '\uD83E\uDD21'];
  function myVotes() { var m = {}; votes.forEach(function (v) { if (v.voter === me) m[v.question_id] = v.pick; }); return m; }
  function answeredCount() { var m = myVotes(); return QUESTIONS.filter(function (q) { return !!m[q.id]; }).length; }   // ignore votes for questions that no longer exist
  function firstUnanswered() { var m = myVotes(); for (var i = 0; i < QUESTIONS.length; i++) if (!m[QUESTIONS[i].id]) return i; return 0; }
  // Only ever prompt someone who has made no picks at all, and only once their votes have actually loaded.
  // Anyone with picks (even partial) changes them from the Predictions tab instead.
  // Saturday dinner: one tap per person, asked before the predictions. The vote is keyed by the name on the phone (like
  // the predictions), so Safari and the home-screen icon count as the same person, and the tally on the FAQ shows who
  // picked what. The first version keyed it by a random id per browser instead, which is how 13 people cast 15 votes;
  // those old rows (voter "dev-...") are ignored rather than counted.
  var DINNER_Q = 'dinner', askedDinnerThisVisit = false, dinnerBusy = false;
  function dinnerVoter() { return me; }
  function dinnerVotes() { return votes.filter(function (v) { return v.question_id === DINNER_Q && NAMES.indexOf(v.voter) >= 0; }); }
  function myDinner() { var id = dinnerVoter(), v = dinnerVotes().filter(function (x) { return x.voter === id; })[0]; return v ? v.pick : null; }
  function shouldAskDinner() { return !!(me && store && store.predictions && predLoaded && !askedDinnerThisVisit && !myDinner()); }
  function openDinner() {
    closeChat();
    $('main').hidden = true; $('nav').hidden = true; $('chat-fab').hidden = true; $('pick').hidden = true; $('predict').hidden = false;
    document.body.classList.add('picking');
    window.scrollTo(0, 0);
    $('q-intro').hidden = true; $('q-wrap').hidden = true; $('dinner').hidden = false; $('predict').classList.add('dinner-open');
    Array.prototype.forEach.call(document.querySelectorAll('.dinner-opt'), function (b) { b.setAttribute('aria-pressed', 'false'); });
  }
  function renderDinnerTally() {
    var el = $('dinner-tally'); if (!el) return;
    var who = { pasta: [], tacos: [] };
    dinnerVotes().forEach(function (v) { if (who[v.pick]) who[v.pick].push(v.voter); });
    var p = who.pasta.length, t = who.tacos.length, total = p + t;
    var names = function (list) { list = list.sort(); if (list.indexOf(me) > 0) list.splice(0, 0, list.splice(list.indexOf(me), 1)[0]); return list.map(function (n) { return n === me ? '<b>you</b>' : esc(n); }).join(', '); };   // you first, then A to Z
    $('dt-pasta').querySelector('b').textContent = p; $('dt-tacos').querySelector('b').textContent = t;
    $('dt-pasta').classList.toggle('lead', p > t); $('dt-tacos').classList.toggle('lead', t > p);
    $('dt-bar-p').style.width = total ? (100 * p / total) + '%' : '0'; $('dt-bar-t').style.width = total ? (100 * t / total) + '%' : '0';
    $('dt-who-p').innerHTML = names(who.pasta); $('dt-who-t').innerHTML = names(who.tacos);
    $('dt-who').hidden = !total;
    $('dt-sub').textContent = total ? total + ' of ' + NAMES.length + ' have voted \u00b7 ' + (p === t ? 'dead heat' : p > t ? 'pasta leads' : 'tacos lead') : 'Everyone gets asked once.';
  }
  $('dinner').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dinner]'); if (!b || dinnerBusy) return;
    dinnerBusy = true;
    var pick = b.getAttribute('data-dinner'), id = dinnerVoter();
    Array.prototype.forEach.call(document.querySelectorAll('.dinner-opt'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    buzz([8, 30, 8]);
    votes = votes.filter(function (v) { return !(v.question_id === DINNER_Q && v.voter === id); });
    votes.push({ question_id: DINNER_Q, voter: id, pick: pick, updated_at: new Date().toISOString() });
    store.vote(DINNER_Q, id, pick).catch(function (err) { toast('That didn\'t save: ' + ((err && err.message) || err)); });
    renderDinnerTally();
    toast(pick === 'pasta' ? 'Pasta. Counted.' : 'Tacos. Counted.');
    setTimeout(function () { dinnerBusy = false; $('dinner').hidden = true; $('predict').classList.remove('dinner-open'); tab = 'cabin'; showScreen(); }, 480);   // the vote always lands on the FAQ
  });
  var predLoaded = false, askedThisVisit = false, qAuto = false, qSingle = false;   // qSingle: opened from a card's sheet for one question only   // qAuto: the questionnaire opened itself on first visit, so finishing it lands on the FAQ
  function shouldAsk() {
    if (!me || !store || !store.predictions || !predLoaded || askedThisVisit) return false;
    if (answeredCount() > 0) return false;
    return lsGet('cabin-haul-pred-later-' + me) !== '1';
  }
  function subscribePredictions() {
    if (predSub || !store || !store.predictions) return;
    predSub = true;
    store.predictions(function (rows) {
      votes = rows.slice();
      var first = !predLoaded; predLoaded = true;
      renderPredictions(); renderHibachi(); renderDinnerTally();
      if (first && !$('main').hidden && shouldAsk()) { askedThisVisit = true; qAuto = true; openQuestionnaire(0); }
      else if (first && !$('main').hidden && shouldAskDinner()) { askedDinnerThisVisit = true; openDinner(); }
    });
    if (store.comments) store.comments(function (rows) {
      comments = rows.slice().sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? -1 : 1; });
      if (expanded !== null) markQSeen(QUESTIONS[expanded].id);
      renderPredictions(); renderWall(); if (chatOpen) markWallSeen(); else updateChatBadge();
    });
    if (store.reactions) store.reactions(function (rows) { reactions = rows.slice(); renderPredictions(); renderWall(); });
  }
  function openQuestionnaire(index, skipIntro) {
    qIndex = Math.max(0, Math.min(QUESTIONS.length - 1, index || 0));
    closeChat();
    $('main').hidden = true; $('nav').hidden = true; $('chat-fab').hidden = true; $('pick').hidden = true; $('predict').hidden = false; $('dinner').hidden = true; $('predict').classList.remove('dinner-open');
    document.body.classList.add('picking');
    window.scrollTo(0, 0);
    if (skipIntro) { $('q-intro').hidden = true; $('q-wrap').hidden = false; showQuestion(false); return; }
    $('q-wrap').hidden = true; $('q-intro').hidden = false;
    var subText = plainPicks()
      ? (answeredCount() ? 'You\'ve answered ' + answeredCount() + ' of ' + QUESTIONS.length + '. Pick up where you left off.' : 'Six quick calls. Everyone sees the tally and who picked who, so make them good.')
      : (answeredCount() ? 'You\'ve got ' + answeredCount() + ' of ' + QUESTIONS.length + ' on your slip. Pick up where you left off.' : 'Six quick calls, no stake. Everyone sees the board and who bet what, so make them good.');
    var qsub = $('q-intro-sub'); if (qsub) qsub.textContent = subText;
    var ps = $('q-intro-plain'); if (ps) ps.textContent = subText;
    var qs = $('q-start'); if (qs) qs.textContent = plainPicks() ? 'Make my picks' : 'Build my slip';
    var slip0 = $('q-slip'); if (slip0) slip0.textContent = answeredCount() + '/' + QUESTIONS.length;
    var il = $('q-intro-list'); if (il) il.innerHTML = QUESTIONS.map(function (qq) {   // each market with the current favourite's price
      var t = tallyFor(qq), total = t.rows.reduce(function (a, r) { return a + r.n; }, 0), lead = t.rows[0];
      if (plainPicks()) return '<li><span>' + esc(qq.text) + '</span></li>';
      return '<li><span>' + esc(qq.text) + (lead ? '<small>' + esc(lead.pick) + ' favoured</small>' : '<small>No action yet</small>') + '</span><b>' + oddsForQ(qq, lead ? lead.n : 0) + '</b></li>';
    }).join('');
  }
  $('q-start').addEventListener('click', function () { $('q-intro').hidden = true; $('q-wrap').hidden = false; showQuestion(true); });
  $('q-intro-later').addEventListener('click', function () { lsSet('cabin-haul-pred-later-' + me, '1'); qAuto = false; qSingle = false; showScreen(); });
  var picking = false;
  function showQuestion(animate) {
    var q = QUESTIONS[qIndex], mine = myVotes()[q.id] || null;
    var plain = plainPicks();
    $('q-progress').textContent = (plain ? 'Question ' : 'Market ') + (qIndex + 1) + ' of ' + QUESTIONS.length;
    $('q-text').textContent = q.text;
    $('q-current').textContent = plain
      ? (mine ? 'Your pick: ' + mine + '. Tap another to change it.' : (q.type === 'couple' ? 'Tap a couple.' : 'Tap a name. Yes, you can pick yourself.'))
      : (mine ? 'On your slip: ' + mine + '. Tap another to swap it.' : (q.type === 'couple' ? 'Tap a couple to add them to your slip.' : 'Tap a name to add them to your slip. Yes, you can bet on yourself.'));
    var bar = $('q-progress-bar'); if (bar) bar.innerHTML = QUESTIONS.map(function (qq, k) { return '<i class="' + (k < qIndex ? 'done' : k === qIndex ? 'now' : '') + '"></i>'; }).join('');
    var slip = $('q-slip'); if (slip) slip.textContent = answeredCount() + '/' + QUESTIONS.length;
    var t = tallyFor(q), total = t.rows.reduce(function (a, r) { return a + r.n; }, 0), byPick = {};
    t.rows.forEach(function (r) { byPick[r.pick] = r.n; });
    var wrap = $('q-wrap');
    if (animate) { wrap.classList.remove('slide'); void wrap.offsetWidth; wrap.classList.add('slide'); }
    var names = q.type === 'couple' ? COUPLES : NAMES.slice().sort();
    $('q-grid').innerHTML = names.map(function (n) {
      return '<button type="button" class="pickbtn" data-pick="' + esc(n) + '" aria-pressed="' + (mine === n) + '"><span class="nm">' + esc(n) + '</span>' + (plain ? '' : '<span class="odds">' + oddsForQ(q, byPick[n] || 0) + '</span>') + (mine === n ? '<span class="tick">\u2713' + (plain ? ' Your pick' : ' On slip') + '</span>' : '') + '</button>';
    }).join('');
    picking = false;
  }
  $('q-grid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]'); if (!b || picking) return;
    picking = true;
    var q = QUESTIONS[qIndex], pick = b.getAttribute('data-pick');
    Array.prototype.forEach.call($('q-grid').children, function (el) {
      el.setAttribute('aria-pressed', String(el === b));
      var tk = el.querySelector('.tick'); if (tk) tk.remove();
    });
    b.insertAdjacentHTML('beforeend', '<span class="tick">\u2713' + (plainPicks() ? ' Your pick' : ' On slip') + '</span>'); buzz(6);
    store.vote(q.id, me, pick).catch(function (e2) { toast('That pick didn\'t save: ' + ((e2 && e2.message) || e2)); });
    votes = votes.filter(function (v) { return !(v.voter === me && v.question_id === q.id); });
    votes.push({ question_id: q.id, voter: me, pick: pick, updated_at: new Date().toISOString() });
    var slipNow = $('q-slip'); if (slipNow) slipNow.textContent = answeredCount() + '/' + QUESTIONS.length;
    setTimeout(function () {
      if (qSingle) { qSingle = false; tab = 'home'; showScreen(); toast(plainPicks() ? 'Changed.' : 'Bet changed.'); return; }   // one question from the sheet, then back to the board
      if (qIndex + 1 < QUESTIONS.length) { qIndex++; showQuestion(true); }
      else {
        toast(plainPicks() ? 'Picks are in. Change them any time on the Predictions tab.' : 'Slip placed. Change a bet any time on the Predictions tab.');
        tab = qAuto ? 'cabin' : 'home'; qAuto = false; showScreen();   // first time through lands on the FAQ; edits go back to the board
      }
    }, 260);
  });
  $('q-later').addEventListener('click', function () { lsSet('cabin-haul-pred-later-' + me, '1'); qAuto = false; qSingle = false; showScreen(); });
  $('q-back').addEventListener('click', function () { if (qIndex > 0) { qIndex--; showQuestion(true); } else if (!qSingle) { openQuestionnaire(0); } });

  function tallyFor(q) {
    var counts = {}, voters = {}, who = {};
    votes.forEach(function (v) { if (v.question_id !== q.id) return; counts[v.pick] = (counts[v.pick] || 0) + 1; voters[v.voter] = true; (who[v.pick] = who[v.pick] || []).push(v.voter); });
    var rows = Object.keys(counts).map(function (k) { return { pick: k, n: counts[k], who: who[k].sort() }; }).sort(function (a, b) { return b.n - a.n || a.pick.localeCompare(b.pick); });
    return { rows: rows, voted: Object.keys(voters).length };
  }
  // Fake book odds from the votes, American style. Shares are sharpened (power 1.8) so the runner with the most
  // bets prices like a real favourite (negative) while the rest of the field stays plus-money.
  function oddsFor(n, rows, k) {
    var w = function (c) { return Math.pow(c + 0.3, 1.8); };
    var denom = rows.reduce(function (a, r) { return a + w(r.n); }, 0) + Math.max(0, k - rows.length) * w(0);
    var p = w(n) / denom;
    p = Math.min(0.85, Math.max(0.03, p));
    var a = p >= 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
    a = Math.round(a / 5) * 5;
    return (a > 0 ? '+' : '') + a;
  }
  function oddsForQ(q, n) { var t = tallyFor(q); return oddsFor(n, t.rows, q.type === 'couple' ? COUPLES.length : NAMES.length); }
  function reactionsFor(cid) {
    var out = {}; if (!cid) return out;
    reactions.forEach(function (r) { if (r.comment_id === cid) (out[r.emoji] = out[r.emoji] || []).push(r.reactor); });
    return out;
  }
  function rxSummary(cid) {
    var g = reactionsFor(cid);
    return Object.keys(g).sort(function (a, b) { return g[b].length - g[a].length; }).map(function (e) { return e + (g[e].length > 1 ? g[e].length : ''); }).join(' ');
  }
  var SEG_COLORS = ['#d2691e', '#2d6a4f', '#3f7cae', '#8e44ad', '#b7950b', '#c0392b', '#7f8c8d'];
  var PLAIN_SEG = ['#7b3fe4', '#f5b942', '#3bb2e0', '#ff6b9a', '#38c7a0', '#ff8c42'];   // the plain page: violet first, so the leader matches the name above
  function segColor(k) { var c = plainPicks() ? PLAIN_SEG : SEG_COLORS; return c[k % c.length]; }
  function qSeen(qid) { return lsGet('cabin-haul-q-seen-' + qid + '-' + me) || ''; }
  function qThread(qid) { return comments.filter(function (c) { return c.question_id === qid; }); }
  function qUnread(qid) { var seen = qSeen(qid); return qThread(qid).filter(function (c) { return c.author !== me && (c.created_at || '') > seen; }).length; }
  function markQSeen(qid) {
    if (!me) return;
    var latest = qThread(qid).reduce(function (a, c) { return (c.created_at || '') > a ? c.created_at : a; }, '');
    if (latest && latest !== qSeen(qid)) { lsSet('cabin-haul-q-seen-' + qid + '-' + me, latest); updatePredBadge(); }
  }
  // the Predictions tab wears a badge for comments you haven't seen yet
  function updatePredBadge() {
    var el = $('pred-badge'); if (!el) return;
    var n = me ? QUESTIONS.reduce(function (a, q) { return a + qUnread(q.id); }, 0) : 0;
    el.hidden = !n; el.textContent = n > 9 ? '9+' : String(n);
  }
  function renderPredictions() {
    var el = $('pred'); if (!el || !me) return;
    updatePredBadge();
    if (!store || !store.predictions) { el.hidden = true; return; }
    el.hidden = false;
    var mine = myVotes(), left = QUESTIONS.length - answeredCount();
    var html = '';
    var slip = $('dk-slip'); if (slip) slip.textContent = (QUESTIONS.length - left) + '/' + QUESTIONS.length;
    if (left && plainPicks()) html += '<div class="pred-banner"><div><b>' + (left === QUESTIONS.length ? 'You haven\u2019t picked yet' : left + ' still to pick') + '</b><span>Six quick questions. Takes a minute.</span></div><button type="button" class="btn primary" id="pred-open">Make my picks</button></div>';
    else if (left) html += '<div class="pred-banner"><div><b>' + (left === QUESTIONS.length ? 'Your bet slip is empty' : left + ' open ' + (left === 1 ? 'market' : 'markets') + ' on your slip') + '</b><span>Six markets, no stake, pure trash talk.</span></div><button type="button" class="nudge" id="pred-open">Make my picks</button></div>';
    else if (plainPicks()) html += '<div class="pred-head"><span class="pred-count">\u2713 All ' + QUESTIONS.length + ' picked</span><button type="button" class="linkbtn" id="pred-open">Change my picks</button></div>';
    else html += '<div class="pred-head"><span class="pred-count">\u2713 Slip placed \u00b7 ' + QUESTIONS.length + ' of ' + QUESTIONS.length + '</span><button type="button" class="linkbtn" id="pred-open">Edit my slip</button></div>';
    html += '<div class="pred-list">';
    QUESTIONS.forEach(function (q, i) {
      var t = tallyFor(q), total = t.rows.reduce(function (a, r) { return a + r.n; }, 0);
      var cc = qThread(q.id).length, my = mine[q.id], nu = qUnread(q.id);
      if (plainPicks()) {   // the simple card: question, who's winning, a bar, your pick
        var lead = t.rows[0];
        html += '<button type="button" class="pred-card plain' + (nu ? ' has-new' : '') + '" data-q="' + i + '">' +
          '<div class="pq">' + esc(q.text) + '</div>' +
          '<div class="lead-row"><span class="lead' + (lead ? '' : ' none') + '">' + (lead ? esc(lead.pick) : 'No picks yet') + '</span>' + (lead ? '<span class="share">' + lead.n + ' <small>of ' + total + '</small></span>' : '') + '</div>' +
          (total ? '<div class="seg">' + t.rows.map(function (r, k) { return '<span style="width:' + (100 * r.n / total) + '%;background:' + segColor(k) + '"></span>'; }).join('') + '</div>' : '') +
          '<div class="sub"><span>' + t.voted + ' of ' + NAMES.length + ' have picked</span>' + (cc ? '<span class="k' + (nu ? ' new' : '') + '">\uD83D\uDCAC ' + cc + (nu ? ' \u00b7 ' + nu + ' new' : '') + '</span>' : '') + (my ? '<span class="you">You picked ' + esc(my) + '</span>' : '<span class="you no">You haven\u2019t picked</span>') + '</div>';
        var th = qThread(q.id), l2 = th.slice(-2), seenAt = qSeen(q.id);
        if (!th.length) html += '<div class="pred-chat none"><span class="line"><span class="t">No comments yet. Tap to add one.</span></span></div>';
        else html += '<div class="pred-chat' + (nu ? ' has-new' : '') + '">' + l2.map(function (c) { var rx = rxSummary(c.id), fresh = c.author !== me && (c.created_at || '') > seenAt; return '<span class="line' + (fresh ? ' unread' : '') + '"><b>' + esc(c.author === me ? 'You' : c.author) + '</b><span class="t">' + esc(c.text) + '</span>' + (rx ? '<span class="rx">' + rx + '</span>' : '') + '</span>'; }).join('') + (th.length > 2 ? '<span class="more">+' + (th.length - 2) + ' more</span>' : '') + '</div>';
        html += '</button>';
        return;
      }
      var rows = t.rows.slice(0, 3);
      if (!rows.length) rows = NAMES.filter(function (n) { return n !== me; }).slice(0, 3).map(function (n) { return { pick: n, n: 0 }; });
      if (my && !rows.some(function (r) { return r.pick === my; })) rows.push({ pick: my, n: (t.rows.filter(function (r) { return r.pick === my; })[0] || { n: 0 }).n });
      var hot = cc >= 2, top = t.rows.length ? t.rows[0].n : 0;
      html += '<button type="button" class="pred-card dk' + (nu ? ' has-new' : '') + '" data-q="' + i + '">' +
        '<div class="dk-top">' + (total ? '<span class="live"><i></i>Live</span>' : '<span class="soon">Opens</span>') + '<span class="mk">' + esc(q.text) + '</span>' + (hot ? '<span class="boost">\u26A1 Boosted</span>' : '<span class="sgp">SGP</span>') + '</div>' +
        '<div class="dk-rows">' + rows.map(function (r) {
          var fav = top > 0 && r.n === top, picked = r.pick === my;
          return '<div class="dk-row' + (fav ? ' fav' : '') + (picked ? ' picked' : '') + '"><span class="rn">' + esc(r.pick) + '<small>' + (r.n ? r.n + (r.n === 1 ? ' bet' : ' bets') : 'no action') + '</small>' + (fav ? '<em class="tag fav">Fav</em>' : '') + (picked ? '<em class="tag you">\u2713 Your bet</em>' : '') + '</span><span class="odds">' + oddsForQ(q, r.n) + '</span></div>';
        }).join('') + (function () { var hidden = t.rows.filter(function (r) { return !rows.some(function (x) { return x.pick === r.pick; }); }).length; return hidden ? '<div class="dk-more">+' + hidden + ' more ' + (hidden === 1 ? 'wager' : 'wagers') + '</div>' : ''; })() + '</div>' +
        '<div class="dk-foot"><span>' + t.voted + ' of ' + NAMES.length + ' bets in</span>' + (cc ? '<span class="k' + (nu ? ' new' : '') + '">\uD83D\uDCAC ' + cc + (nu ? ' \u00b7 ' + nu + ' new' : '') + '</span>' : '') + (my ? '<span class="you">\u2713 Your bet: ' + esc(my) + '</span>' : '<span class="you no">No bet placed</span>') + '</div>';
      var thread = qThread(q.id), last2 = thread.slice(-2), seenDk = qSeen(q.id);
      if (!thread.length) html += '<div class="pred-chat none"><span class="line"><span class="t">No trash talk yet. Start it.</span></span></div>';
      else html += '<div class="pred-chat' + (nu ? ' has-new' : '') + '">' + last2.map(function (c) {
        var rx = rxSummary(c.id), fresh = c.author !== me && (c.created_at || '') > seenDk;
        return '<span class="line' + (fresh ? ' unread' : '') + '"><b>' + esc(c.author === me ? 'You' : c.author) + '</b><span class="t">' + esc(c.text) + '</span>' + (rx ? '<span class="rx">' + rx + '</span>' : '') + '</span>';
      }).join('') + (thread.length > 2 ? '<span class="more">+' + (thread.length - 2) + ' more</span>' : '') + '</div>';
      html += '</button>';
    });
    html += '</div>';
    el.innerHTML = html;
    if (expanded !== null) renderSheet();
  }
  function msgHtml(c) {
    var g = reactionsFor(c.id), keys = Object.keys(g).sort(function (a, b) { return g[b].length - g[a].length; });
    var rx = '';
    if (c.id) {
      rx += '<div class="rxs">' + keys.map(function (e) {
        var mine = g[e].indexOf(me) >= 0;
        return '<button type="button" class="rx-chip' + (mine ? ' mine' : '') + '" data-react="' + esc(e) + '" data-cid="' + esc(c.id) + '" title="' + esc(g[e].join(', ')) + '">' + e + ' ' + g[e].length + '</button>';
      }).join('') + '<button type="button" class="rx-add" data-picker="' + esc(c.id) + '" aria-label="React">' + (pickerFor === c.id ? '\u00d7' : '+\uD83D\uDE42') + '</button></div>';
      if (pickerFor === c.id) rx += '<div class="rx-picker">' + EMOJI.map(function (e) { return '<button type="button" data-react="' + e + '" data-cid="' + esc(c.id) + '"' + (g[e] && g[e].indexOf(me) >= 0 ? ' class="mine"' : '') + '>' + e + '</button>'; }).join('') + '</div>';
    }
    return '<div class="msg' + (c.author === me ? ' mine' : '') + '"><span class="who">' + esc(c.author === me ? 'You' : c.author) + '</span><span class="when">' + esc(ago(c.created_at)) + '</span><div class="txt">' + esc(c.text) + '</div>' + rx + '</div>';
  }
  // ---- Hibachi night: everyone's order, locked in one at a time ----
  // One row per person in the predictions table (question_id 'hibachi', voter = name, pick = the order as JSON),
  // so nobody's order can overwrite anyone else's. Edit HIBACHI_MENU to match the chef's menu.
  var HIBACHI_Q = 'hibachi';
  var HIBACHI_MENU = [
    { id: 'plate', title: 'Your plate', hint: 'Pick one. Every plate comes with fried rice, saut\u00e9ed vegetables and yum-yum and ginger sauce.', pick: 1, options: [
      { sec: 'Meat choice' },
      { id: 's-lob2', name: '2 Lobster Tails', price: 60 },
      { id: 's-filet', name: 'Filet Mignon', price: 50 },
      { id: 's-ny', name: 'New York Strip Steak', price: 45 },
      { id: 's-salmon', name: 'Salmon', price: 40 },
      { id: 's-scallops', name: 'Scallops', price: 40 },
      { id: 's-shrimp', name: 'Shrimp', price: 40 },
      { id: 's-chicken', name: 'Chicken', price: 35 },
      { id: 's-tofu', name: 'Tofu', price: 30 },
      { sec: 'Combination plates' },
      { id: 'c-lss', name: 'Lobster, Scallops & Shrimp', price: 65 },
      { id: 'c-fl', name: 'Filet Mignon & Lobster', price: 65 },
      { id: 'c-fsc', name: 'Filet Mignon & Scallops', price: 60 },
      { id: 'c-fsh', name: 'Filet Mignon & Shrimp', price: 60 },
      { id: 'c-fc', name: 'Filet Mignon & Chicken', price: 60 },
      { id: 'c-nsc', name: 'NY Strip, Chicken & Shrimp', price: 60 },
      { id: 'c-nsh', name: 'NY Strip & Shrimp', price: 50 },
      { id: 'c-nc', name: 'NY Strip & Chicken', price: 50 },
      { id: 'c-csh', name: 'Chicken & Shrimp', price: 45 }
    ] },
    { id: 'sides', title: 'Extra sides', hint: 'Optional, and most people won\u2019t need them.', warn: 'Your plate already comes with fried rice and saut\u00e9ed vegetables. These are second helpings on top of that, for an extra charge.', pick: 0, options: [
      { id: 'side-rice', name: 'Fried Rice', sub: 'a second helping', price: 8 },
      { id: 'side-veg', name: 'Saut\u00e9 Vegetables', sub: 'a second helping', price: 6 },
      { id: 'side-udon', name: 'Udon Noodles', sub: 'not included with the plate', price: 6 }
    ] }
  ];
  var HIBACHI_PAYEE = { name: 'Jess', handle: 'Craftyj627' };   // fronts the chef; everyone Venmos her their plate
  var HIBACHI_HOST = 'Mitch';   // the host eats free: his plate and tip are split evenly across everyone else
  var HIBACHI_GUESTS = ['Jessie', 'Conner'];   // hibachi only: not on the roster and not in the app; Mitch collects for them
  var HIB_NAMES = NAMES.concat(HIBACHI_GUESTS);
  var HIBACHI_PRESETS = {   // orders that are in from the start: the host's (he can change it) and the guests' (fixed, marked paid)
    Mitch: { picks: { plate: ['s-filet'] }, note: '', locked: true, preset: true },
    Jessie: { picks: { plate: ['c-fsh'] }, note: '', locked: true, paid: true, preset: true },
    Conner: { picks: { plate: ['c-nc'] }, note: '', locked: true, paid: true, preset: true }
  };
  var hibJustLocked = false;
  function hibPayUrl(amount, note) {   // Venmo's pay link: opens the app on a phone with recipient, amount and note filled in
    return 'https://venmo.com/' + encodeURIComponent(HIBACHI_PAYEE.handle) + '?txn=pay&amount=' + encodeURIComponent(Number(amount).toFixed(2)) + '&note=' + encodeURIComponent(note);
  }
  var hibDraft = null;   // the order being built on this phone before it's locked; null until you touch something
  function hibBaseDraft() { var my = hibOrders()[me]; return my ? { picks: JSON.parse(JSON.stringify(my.picks)), note: my.note || '' } : { picks: {}, note: '' }; }
  function hibOrders() {
    var out = {};
    votes.forEach(function (v) { if (v.question_id !== HIBACHI_Q) return; try { var o = JSON.parse(v.pick); if (o && o.picks) out[v.voter] = o; } catch (e) { /* ignore */ } });
    Object.keys(HIBACHI_PRESETS).forEach(function (n) { if (!out[n]) out[n] = JSON.parse(JSON.stringify(HIBACHI_PRESETS[n])); });
    return out;
  }
  function hibOption(gid, oid) { var g = HIBACHI_MENU.filter(function (x) { return x.id === gid; })[0]; return g && g.options.filter(function (o) { return o.id && o.id === oid; })[0]; }
  function hibLines(order) {   // ['Steak', 'Noodles', ...] in menu order
    var lines = [];
    HIBACHI_MENU.forEach(function (g) { (order.picks[g.id] || []).forEach(function (oid) { var o = hibOption(g.id, oid); if (o) lines.push(o.name); }); });
    return lines;
  }
  function hibChefLines(order) {   // like hibLines, but says which column of the menu each thing came from
    var lines = [];
    HIBACHI_MENU.forEach(function (g) {
      (order.picks[g.id] || []).forEach(function (oid) {
        var o = hibOption(g.id, oid); if (!o) return;
        lines.push(g.id === 'plate' ? o.name + ' plate' : o.name + ' (side)');
      });
    });
    return lines;
  }
  function hibPrice(order) {
    var t = 0;
    HIBACHI_MENU.forEach(function (g) { (order.picks[g.id] || []).forEach(function (oid) { var o = hibOption(g.id, oid); if (o) t += o.price; }); });
    return t;
  }
  var HIBACHI_TIP = 0.2;   // everyone tips the chef 20% on their own plate; it rides along with the Venmo
  function hibTip(order) { return Math.round(hibPrice(order) * HIBACHI_TIP * 100) / 100; }
  function hibTotal(order) { return Math.round((hibPrice(order) + hibTip(order)) * 100) / 100; }
  // the host's plate + tip, split evenly across everyone else and added to each of their Venmos
  function hibSplitWays() { return HIB_NAMES.length - 1; }
  function hibShare() { return Math.round(hibTotal(hibOrders()[HIBACHI_HOST]) / hibSplitWays() * 100) / 100; }
  function hibShareOf(n) { return n === HIBACHI_HOST ? 0 : hibShare(); }
  function hibOwed(n, order) { return n === HIBACHI_HOST ? 0 : Math.round((hibTotal(order) + hibShare()) * 100) / 100; }
  // 'I’ve paid' records the amount sent. If the host's plate changes afterwards, the share moves; say so instead of rewriting history.
  function hibDrift(order, owed) { return order.paid && order.paid_amt != null ? Math.round((owed - order.paid_amt) * 100) / 100 : 0; }
  function hibDriftNote(order, owed) {
    var d = hibDrift(order, owed); if (!d) return '';
    return d > 0 ? ' <b>Since then ' + HIBACHI_HOST + ' changed his plate, so it’s ' + money(owed) + ' now. Send ' + esc(HIBACHI_PAYEE.name) + ' another ' + money(d) + '.</b>'
      : ' Since then ' + HIBACHI_HOST + ' changed his plate, so it’s ' + money(owed) + ' now. ' + esc(HIBACHI_PAYEE.name) + ' owes you ' + money(-d) + ' back.';
  }
  function hibComplete(order) { return HIBACHI_MENU.every(function (g) { return !g.pick || (order.picks[g.id] || []).length >= g.pick; }); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0); }
  function renderHibachi() {
    var mine = $('hib-mine'); if (!mine || !me) return;
    var orders = hibOrders(), locked = HIB_NAMES.filter(function (n) { return orders[n] && orders[n].locked; }), waiting = HIB_NAMES.filter(function (n) { return locked.indexOf(n) < 0; });
    var done = waiting.length === 0;
    $('hib-light').classList.toggle('on', done);
    var st = $('hib-status'); st.classList.toggle('done', done);
    st.innerHTML = done ? '<span class="st-ico">🔥</span><span><b>Grill’s hot.</b> All ' + HIB_NAMES.length + ' orders are in. Jess, send the ticket.</span>' : '<span class="st-ico">🥢</span><span><b>' + locked.length + ' of ' + HIB_NAMES.length + '</b> at the table. Still need ' + waiting.map(function (n) { return n === me ? 'you' : esc(n); }).join(', ') + '.</span>';
    // my order
    var my = orders[me], editing = hibDraft || !(my && my.locked);
    if (!editing) {
      var plate = hibPrice(my), tip = hibTip(my), price = hibTotal(my), share = hibShare(), owed = hibOwed(me, my), host = me === HIBACHI_HOST;
      var payNote = 'Hibachi: ' + hibLines(my).join(', ') + ' + 20% tip + ' + money(share) + ' of ' + HIBACHI_HOST + '’s plate';
      var tipline = host ? money(plate) + ' plate + ' + money(tip) + ' tip · on the group, ' + money(share) + ' each' : money(plate) + ' plate + ' + money(tip) + ' tip + ' + money(share) + ' for ' + HIBACHI_HOST + '’s';
      mine.innerHTML = '<div class="hib-mine-locked' + (hibJustLocked ? ' sizzle' : '') + '"><span>🔒</span><div class="what"><b>' + (host && my.preset ? 'You’re in by default' : 'Your order is locked in') + '</b>' + esc(hibLines(my).join(', ')) + (my.note ? ' · ' + esc(my.note) : '') + '<small class="tipline">' + tipline + '</small></div><span class="amt">' + money(host ? price : owed) + '</span><button type="button" class="linkbtn" id="hib-edit">Change</button></div>' +
        (me === HIBACHI_PAYEE.name ? '' : host ? '<div class="hib-pay host"><div class="pt"><b>Nothing to pay.</b> Your ' + money(price) + ' is split ' + hibSplitWays() + ' ways across everyone else, ' + money(share) + ' apiece, and rides along with their Venmos to ' + esc(HIBACHI_PAYEE.name) + '.</div></div>' :
          '<div class="hib-pay' + (hibJustLocked ? ' pop' : '') + (my.paid ? ' paid' : '') + '">' +
            (my.paid
              ? '<div class="pt">✅ You paid ' + esc(HIBACHI_PAYEE.name) + ' ' + money(my.paid_amt != null ? my.paid_amt : owed) + '.' + hibDriftNote(my, owed) + '</div><button type="button" class="linkbtn" id="hib-unpaid">Actually, not yet</button>'
              : '<div class="pt"><b>Now Venmo ' + esc(HIBACHI_PAYEE.name) + ' ' + money(owed) + '.</b> That’s your ' + money(plate) + ' plate, a ' + money(tip) + ' tip for the chef and ' + money(share) + ' toward ' + HIBACHI_HOST + '’s plate (his ' + money(hibTotal(hibOrders()[HIBACHI_HOST])) + ' is split ' + hibSplitWays() + ' ways). She’s fronting it all, so pay her as you order.</div>' +
                '<div class="hib-pay-actions"><a class="btn primary" id="hib-venmo" href="' + hibPayUrl(owed, payNote) + '" target="_blank" rel="noopener">Pay ' + esc(HIBACHI_PAYEE.name) + ' ' + money(owed) + ' on Venmo</a><button type="button" class="btn" id="hib-paid">I’ve paid</button></div>' +
                '<div class="fine">Opens Venmo with @' + esc(HIBACHI_PAYEE.handle) + ', the amount and a note filled in. You still hit Pay in the app.</div>') +
          '</div>');
      hibJustLocked = false;
    } else {
      var d = hibDraft || hibBaseDraft();
      var html = '';
      HIBACHI_MENU.forEach(function (g) {
        var sel = d.picks[g.id] || [];
        html += '<div class="hib-group"><div class="gt">' + esc(g.title) + '</div><div class="gh">' + esc(g.hint) + '</div>' + (g.warn ? '<div class="hib-warn">\u26A0\uFE0F ' + esc(g.warn) + '</div>' : '') + '<div class="opts" role="' + (g.pick === 1 ? 'radiogroup' : 'group') + '">';
        // once something is picked, the other sections of the same group go gray (still tappable to switch)
        var secOf = {}, cur = null; g.options.forEach(function (o) { if (o.sec) cur = o.sec; else secOf[o.id] = cur; });
        var pickedSec = g.pick === 1 && sel.length ? secOf[sel[0]] : null, sec = null;
        g.options.forEach(function (o) {
          if (o.sec) { sec = o.sec; html += '<div class="opt-sec' + (pickedSec && pickedSec !== sec ? ' dim' : '') + '">' + esc(o.sec) + '</div>'; return; }
          var on = sel.indexOf(o.id) >= 0;
          html += '<button type="button" class="opt' + (g.pick === 1 ? '' : ' multi') + (pickedSec && pickedSec !== sec ? ' dim' : '') + '" role="' + (g.pick === 1 ? 'radio' : 'checkbox') + '" aria-checked="' + on + '" data-g="' + g.id + '" data-o="' + o.id + '"><span class="box">' + (on ? '✓' : '') + '</span><span class="nm">' + esc(o.name) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span><span class="pr">' + money(o.price) + '</span></button>';
        });
        html += '</div></div>';
      });
      html += '<input type="text" class="hib-note" id="hib-note" maxlength="120" placeholder="Allergies, no onions, extra spicy…" value="' + esc(d.note) + '">';
      var ok = hibComplete(d);
      var isHost = me === HIBACHI_HOST, dShare = isHost ? hibShare() : hibShareOf(me);
      html += '<p class="fine hib-tipnote">' + (isHost ? 'A 20% tip for the chef gets added on top. Your plate’s on everyone else, split ' + hibSplitWays() + ' ways.' : 'A 20% tip for the chef gets added on top of your plate, plus ' + money(dShare) + ' toward ' + HIBACHI_HOST + '’s plate (his ' + money(hibTotal(hibOrders()[HIBACHI_HOST])) + ', split ' + hibSplitWays() + ' ways).') + '</p>';
      html += '<div class="hib-foot"><div class="tot">' + money(isHost ? hibTotal(d) : hibOwed(me, d)) + '<small>' + money(hibPrice(d)) + ' plate + ' + money(hibTip(d)) + ' tip' + (isHost ? ' · on the group' : ' + ' + money(dShare) + ' for ' + HIBACHI_HOST + '’s') + '</small></div><button type="button" class="btn primary hib-lockbtn" id="hib-lock"' + (ok ? '' : ' disabled') + '>' + (my && my.locked ? '🔥 Lock in the change' : '🔥 Lock it in') + '</button></div>';
      mine.innerHTML = html;
    }
    // everyone, for Jess
    var all = $('hib-all'), rows = '', counts = {}, plates = 0, tips = 0;
    HIB_NAMES.forEach(function (n) {
      var o = orders[n];
      if (o && o.locked) {
        var isH = n === HIBACHI_HOST, p = isH ? hibTotal(o) : hibOwed(n, o); plates += hibPrice(o); tips += hibTip(o);
        hibChefLines(o).forEach(function (l) { counts[l] = (counts[l] || 0) + 1; });
        rows += '<div class="hib-row' + (n === me ? ' me' : '') + (o.paid && !isH ? ' paid' : '') + '"><span class="who">' + esc(n) + (isH ? ' <span class="pd treat">covered</span>' : o.paid ? ' <span class="pd">paid</span>' : n === HIBACHI_PAYEE.name ? '' : ' <span class="pd owes">owes</span>') + '</span><span class="amt">' + money(o.paid && !isH && o.paid_amt != null ? o.paid_amt : p) + '</span><span class="det">' + esc(hibChefLines(o).join(', ')) + (o.note ? ' · “' + esc(o.note) + '”' : '') + (isH ? ' · split ' + hibSplitWays() + ' ways, ' + money(hibShare()) + ' each' : '') + (function () { var d = isH ? 0 : hibDrift(o, p); return d > 0 ? ' · <b>now ' + money(p) + ', owes ' + money(d) + ' more</b>' : d < 0 ? ' · now ' + money(p) + ', ' + money(-d) + ' back' : ''; })() + '</span></div>';
      } else {
        rows += '<div class="hib-row waiting"><span class="who">' + esc(n) + '</span><span class="amt">—</span><span class="det">not in yet</span></div>';
      }
    });
    var tally = Object.keys(counts).map(function (k) { return counts[k] + '× ' + k; });
    all.innerHTML = '<div class="hib-all ticket"><div class="ah"><b>Order ticket</b><span class="tk-sub">' + locked.length + ' of ' + HIB_NAMES.length + ' plates</span>' + (me === HIBACHI_PAYEE.name ? '<button type="button" class="btn" id="hib-copy"' + (locked.length ? '' : ' disabled') + '>Copy the order</button>' : '') + '</div><div class="hib-rows">' + rows + '</div>' +
      (tally.length ? '<div class="hib-totals">' + esc(tally.join(' · ')) + '</div>' : '') +
      '<div class="hib-sub"><span>Plates</span><span>' + money(plates) + '</span></div><div class="hib-sub"><span>Tip (20%)</span><span>' + money(tips) + '</span></div>' +
      '<div class="hib-sub split"><span>' + esc(HIBACHI_HOST) + '’s ' + money(hibTotal(orders[HIBACHI_HOST])) + ', in everyone else’s amount</span><span>' + money(hibShare()) + ' × ' + hibSplitWays() + '</span></div>' +
      '<div class="hib-grand"><span>Total' + (done ? '' : ' so far') + '</span><span>' + money(Math.round((plates + tips) * 100) / 100) + '</span></div></div>';
  }
  function hibCopyText() {   // just the menu items and how many of each, in menu order, for Jess to hand to the company
    var orders = hibOrders(), counts = {};
    HIB_NAMES.forEach(function (nm) {
      var o = orders[nm]; if (!o || !o.locked) return;
      HIBACHI_MENU.forEach(function (g) { (o.picks[g.id] || []).forEach(function (oid) { counts[g.id + '/' + oid] = (counts[g.id + '/' + oid] || 0) + 1; }); });
    });
    var lines = [];
    HIBACHI_MENU.forEach(function (g) { g.options.forEach(function (o) { var n = o.id && counts[g.id + '/' + o.id]; if (n) lines.push(n + 'x ' + o.name); }); });
    return lines.join('\n');
  }
  $('hibachi').addEventListener('click', function (e) {
    var opt = e.target.closest('.opt');
    if (opt) {
      if (!hibDraft) hibDraft = hibBaseDraft();
      var g = HIBACHI_MENU.filter(function (x) { return x.id === opt.getAttribute('data-g'); })[0], oid = opt.getAttribute('data-o');
      var sel = (hibDraft.picks[g.id] || []).slice(), i = sel.indexOf(oid);
      if (g.pick === 1) sel = i >= 0 ? [] : [oid]; else if (i >= 0) sel.splice(i, 1); else sel.push(oid);
      hibDraft.picks[g.id] = sel; buzz(6); renderHibachi(); return;
    }
    if (e.target.closest('#hib-edit')) { hibDraft = hibBaseDraft(); renderHibachi(); return; }
    if (e.target.closest('#hib-lock')) {
      if (!hibDraft) hibDraft = hibBaseDraft();
      var prev = hibOrders()[me];
      var keepPaid = !!(prev && prev.paid && hibPrice(prev) === hibPrice({ picks: hibDraft.picks }));
      var order = { picks: hibDraft.picks, note: (hibDraft.note || '').trim(), locked: true, at: new Date().toISOString(), paid: keepPaid };
      if (keepPaid && prev.paid_amt != null) order.paid_amt = prev.paid_amt;
      if (!hibComplete(order)) return;
      hibJustLocked = true;
      var json = JSON.stringify(order);
      store.vote(HIBACHI_Q, me, json).catch(function (err) { toast('That didn’t save: ' + ((err && err.message) || err)); });
      votes = votes.filter(function (v) { return !(v.voter === me && v.question_id === HIBACHI_Q); });
      votes.push({ question_id: HIBACHI_Q, voter: me, pick: json });
      hibDraft = null; buzz([8, 30, 8]); renderHibachi();
      // the form collapses into the locked card, so bring the pay prompt (or the card, for Jess) into view
      var focusEl = document.querySelector('#hibachi .hib-mine-locked');
      if (focusEl) { var top = focusEl.getBoundingClientRect().top + window.scrollY - 90; window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
      var left = HIB_NAMES.filter(function (nm) { var o = hibOrders()[nm]; return !(o && o.locked); }).length;
      var paidAlready = HIB_NAMES.filter(function (nm) { var o = hibOrders()[nm]; return nm !== HIBACHI_HOST && o && o.locked && o.paid; }).length;
      toast(me === HIBACHI_PAYEE.name ? (left ? 'Locked in. ' + left + ' to go.' : 'Locked in. That’s everyone!') : me === HIBACHI_HOST ? (paidAlready && prev && hibTotal(prev) !== hibTotal(order) ? 'Locked in. ' + paidAlready + ' already paid at the old split; they’ll see the difference.' : 'Locked in. The group’s got your plate.') : 'Locked in. Now Venmo ' + HIBACHI_PAYEE.name + ' ' + money(hibOwed(me, order)) + ' (plate, tip and ' + money(hibShare()) + ' for ' + HIBACHI_HOST + '’s).');
      return;
    }
    if (e.target.closest('#hib-copy')) { copyText(hibCopyText(), 'Copied. Paste it to the hibachi company.'); buzz(6); return; }
    if (e.target.closest('#hib-venmo')) { buzz(6); return; }   // the link itself opens Venmo
    if (e.target.closest('#hib-paid') || e.target.closest('#hib-unpaid')) {
      var cur = hibOrders()[me]; if (!cur) return;
      var paying = !!e.target.closest('#hib-paid');
      var upd = Object.assign({}, cur, { paid: paying, at: new Date().toISOString() });
      if (paying) upd.paid_amt = hibOwed(me, cur); else delete upd.paid_amt;   // what was actually sent, so a later share change can't rewrite it
      var js = JSON.stringify(upd);
      store.vote(HIBACHI_Q, me, js).catch(function (err) { toast('That didn’t save: ' + ((err && err.message) || err)); });
      votes = votes.filter(function (v) { return !(v.voter === me && v.question_id === HIBACHI_Q); });
      votes.push({ question_id: HIBACHI_Q, voter: me, pick: js });
      buzz(upd.paid ? [8, 30, 8] : 6); renderHibachi();
      if (upd.paid) toast('Marked paid. ' + HIBACHI_PAYEE.name + ' can see it.');
    }
  });
  $('hibachi').addEventListener('input', function (e) { if (e.target.id === 'hib-note') { if (!hibDraft) hibDraft = hibBaseDraft(); hibDraft.note = e.target.value; } });

  // ---- The wall: one shared thread, stored as comments on question 'wall' ----
  var WALL = 'wall', wallRendered = 0, wallDraft = '';
  function wallMsgs() { return comments.filter(function (c) { return c.question_id === WALL; }); }
  function unreadWall() {
    var seen = lsGet('cabin-haul-wall-seen-' + me) || '';
    return wallMsgs().filter(function (c) { return c.author !== me && (c.created_at || '') > seen; }).length;
  }
  function markWallSeen() {
    var msgs = wallMsgs(); if (!me) return;
    var latest = msgs.reduce(function (a, c) { return (c.created_at || '') > a ? c.created_at : a; }, '');
    if (latest) lsSet('cabin-haul-wall-seen-' + me, latest);
    updateChatBadge();
  }
  function updateChatBadge() {
    var el = $('chat-badge'); if (!el || !me) return;
    var n = chatOpen ? 0 : unreadWall();
    el.hidden = !n; el.textContent = n > 9 ? '9+' : String(n);
  }
  function dayLabel(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function renderWall(scroll) {
    var el = $('wall'); if (!el || !me) return;
    var msgs = wallMsgs();
    if (!msgs.length) { el.innerHTML = '<div class="empty">Nothing on the wall yet. Say something.</div>'; return; }
    var html = '', lastDay = '';
    msgs.forEach(function (c) { var d = dayLabel(c.created_at); if (d && d !== lastDay) { html += '<div class="day">' + esc(d) + '</div>'; lastDay = d; } html += msgHtml(c); });
    var grew = msgs.length > wallRendered; wallRendered = msgs.length;
    el.innerHTML = html;
    if ((scroll || grew) && chatOpen) { var wb = $('wall-body'); wb.scrollTo({ top: wb.scrollHeight, behavior: scroll ? 'auto' : 'smooth' }); }
  }
  $('wall-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('wall-input'), text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    input.value = '';
    store.comment(WALL, me, text).catch(function (err) { toast('That didn\'t post: ' + ((err && err.message) || err)); });
    comments.push({ question_id: WALL, author: me, text: text, created_at: new Date().toISOString() });
    renderWall(true); markWallSeen(); input.focus();
  });
  $('wall').addEventListener('click', function (e) { predClick(e); });
  // the wall opens as a sheet from the floating button
  var chatOpen = false;
  function openChat() {
    if (chatOpen || !me) return;
    chatOpen = true; $('chat-sheet').hidden = false; document.body.classList.add('chat-open');
    renderWall(true); markWallSeen(); buzz(6);
  }
  function closeChat() {
    if (!chatOpen) return;
    chatOpen = false; $('chat-sheet').hidden = true; document.body.classList.remove('chat-open');
    updateChatBadge();
  }
  $('chat-fab').addEventListener('click', openChat);
  $('chat-sheet').addEventListener('click', function (e) { if (e.target.closest('#chat-close') || e.target.id === 'chat-back') closeChat(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && chatOpen) closeChat(); });
  function renderSheet() {
    var wrap = $('pred-sheet'); if (!wrap) return;
    if (expanded === null) { wrap.hidden = true; return; }
    var q = QUESTIONS[expanded], t = tallyFor(q), total = t.rows.reduce(function (a, r) { return a + r.n; }, 0), mine = myVotes()[q.id];
    $('sheet-title').textContent = q.text;
    var html = '<div class="poll">';
    if (!t.rows.length) html += '<div class="poll-empty">' + (plainPicks() ? 'No calls yet. Be first.' : 'No bets yet. Be first.') + '</div>';
    t.rows.forEach(function (r, k) {
      html += '<div class="poll-row' + (k === 0 ? ' top' : '') + '"><div class="poll-top"><span class="poll-name">' + esc(r.pick) + '</span><span class="poll-n"><b>' + r.n + '</b> · ' + Math.round(100 * r.n / total) + '% <span class="odds">' + oddsForQ(q, r.n) + '</span></span></div>' +
        '<div class="poll-track"><span style="width:' + Math.round(100 * r.n / total) + '%"></span></div>' +
        '<div class="poll-who">' + r.who.map(function (n) { return '<span' + (n === me ? ' class="me"' : '') + '>' + esc(n === me ? 'you' : n) + '</span>'; }).join('') + '</div></div>';
    });
    html += '</div>';
    html += '<div class="sheet-actions"><span>' + t.voted + ' of ' + NAMES.length + (plainPicks() ? ' have called it' : ' bets in') + (mine ? (plainPicks() ? ' · you said <b>' : ' · your bet <b>') + esc(mine) + '</b>' : '') + '</span><button type="button" class="' + (mine ? 'linkbtn' : 'nudge') + '" id="pred-change" data-q="' + expanded + '">' + (mine ? (plainPicks() ? 'Change mine' : 'Change my bet') : (plainPicks() ? 'Make my call' : 'Place a bet')) + '</button></div>';
    var thread = comments.filter(function (c) { return c.question_id === q.id; });
    html += '<div class="chat"><div class="chat-head">Trash talk' + (thread.length ? ' <span class="k">' + thread.length + '</span>' : '') + '</div>';
    if (!thread.length) html += '<div class="chat-empty">Nobody’s said anything yet. Stir the pot.</div>';
    html += '<div class="chat-list" id="chat-list">' + thread.map(msgHtml).join('') + '</div></div>';
    var body = $('sheet-body'), atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40 || wrap.hidden;
    body.innerHTML = html;
    var inp = $('chat-input'); if (inp && inp.value !== draft) inp.value = draft;
    wrap.hidden = false;
    if (atBottom) body.scrollTop = body.scrollHeight;
  }
  function openSheet(i) { expanded = i; draft = ''; pickerFor = null; markQSeen(QUESTIONS[i].id); renderPredictions(); renderSheet(); var body = $('sheet-body'); if (body) body.scrollTop = 0; }
  function closeSheet() { expanded = null; draft = ''; $('pred-sheet').hidden = true; }
  function agoText(iso) { var a = ago(iso); return !a || a === 'just now' ? a : a + ' ago'; }
  function ago(iso) {
    var t = Date.parse(iso || ''); if (!t) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm'; var h = Math.round(m / 60); if (h < 24) return h + 'h';
    return Math.round(h / 24) + 'd';
  }
  $('pred-sheet').addEventListener('input', function (e) { if (e.target.id === 'chat-input') draft = e.target.value; });
  $('pred-sheet').addEventListener('submit', function (e) {
    if (e.target.id !== 'chat-form') return;
    e.preventDefault();
    var input = $('chat-input'), text = input.value.replace(/\s+/g, ' ').trim();
    if (!text || expanded === null) return;
    var q = QUESTIONS[expanded];
    input.value = ''; draft = '';
    store.comment(q.id, me, text).catch(function (err) { toast('That didn\'t post: ' + ((err && err.message) || err)); });
    comments.push({ question_id: q.id, author: me, text: text, created_at: new Date().toISOString() });
    renderPredictions();
    var body = $('sheet-body'); if (body) body.scrollTop = body.scrollHeight;
    input.focus();
  });
  function toggleReaction(cid, emoji) {
    var on = !reactions.some(function (r) { return r.comment_id === cid && r.reactor === me && r.emoji === emoji; });
    reactions = reactions.filter(function (r) { return !(r.comment_id === cid && r.reactor === me && r.emoji === emoji); });
    if (on) reactions.push({ comment_id: cid, reactor: me, emoji: emoji });
    pickerFor = null;
    renderPredictions(); renderWall();
    if (on) buzz(12);
    store.react(cid, me, emoji, on).catch(function (err) { toast('That reaction didn’t stick: ' + ((err && err.message) || err)); });
  }
  function predClick(e) {
    var rx = e.target.closest('[data-react]'); if (rx) { toggleReaction(rx.getAttribute('data-cid'), rx.getAttribute('data-react')); return; }
    var pk = e.target.closest('[data-picker]'); if (pk) { var cid = pk.getAttribute('data-picker'); pickerFor = pickerFor === cid ? null : cid; renderSheet(); renderWall(); return; }
    var open = e.target.closest('#pred-open, #dk-open'); if (open) { lsDel('cabin-haul-pred-later-' + me); qAuto = false; openQuestionnaire(firstUnanswered(), answeredCount() >= QUESTIONS.length); return; }
    var ch = e.target.closest('#pred-change'); if (ch) { var qi = +ch.getAttribute('data-q'); closeSheet(); qAuto = false; qSingle = true; lsDel('cabin-haul-pred-later-' + me); openQuestionnaire(qi, true); return; }
    if (e.target.closest('#pred-close') || e.target.id === 'sheet-back') { closeSheet(); return; }
    var card = e.target.closest('.pred-card'); if (card) { openSheet(+card.getAttribute('data-q')); }
  }
  $('pred').addEventListener('click', predClick);
  $('pred-sheet').addEventListener('click', predClick);
  $('dk-open').addEventListener('click', predClick);

  // ---- Data ----
  var store = window.STORE, booted = false, items = [], busy = {}, live = false, itemsLoaded = false;

  function boot() {
    booted = true;
    subscribePredictions();
    subscribeMafia();
    subscribeSpyfall();
    subscribeFishbowl();
    subscribeOffTopic();
    subscribeTeams();
    subscribeLiv();
    subscribeSmash();
    subscribeBoards();
    if (!store) { showSetup('No data layer loaded. The page is missing its store script.'); return; }
    store.init({
      onItems: function (rows) { items = rows.slice(); itemsLoaded = true; render(); },
      onLive: function (on) { live = on; updateStatus(); },
      onError: function (msg) { $('br-who').innerHTML = '<p class="skeleton">' + esc(msg) + '</p>'; },
      onSetup: showSetup
    });
  }
  function showSetup(html) { $('setup').hidden = false; $('setup').innerHTML = html; $('br-who').innerHTML = ''; }

  // ---- Render ----
  // Three things on the page: what you're bringing, what nobody has grabbed yet, and what everyone else has.
  function partyNames() {
    var out = PARTIES.map(function (p) { return p.join(' & '); });
    items.forEach(function (it) { if (it.party && out.indexOf(it.party) < 0) out.push(it.party); });
    return out;
  }
  function render() {
    if (!me) return;
    var needed = items.filter(function (it) { return !it.party; }), mine = items.filter(function (it) { return it.party === myParty; });
    $('br-you').innerHTML = mine.length
      ? '<span class="lbl">You\u2019re bringing</span>' + mine.map(function (it) { return '<span class="chip">' + esc(it.name) + '<button type="button" data-x="' + esc(it.id) + '" aria-label="Remove ' + esc(it.name) + '">\u00d7</button></span>'; }).join('')
      : '<span class="lbl none">' + (itemsLoaded ? 'Nothing from you yet.' : 'Loading\u2026') + '</span>';
    $('br-needs-k').textContent = needed.length ? plural(needed.length, 'thing', 'things') : '';
    $('br-needs').innerHTML = needed.length ? needed.map(function (it) {
      var own = (it.adder_id && it.adder_id === myId()) || it.added_by === me;
      return '<div class="need" data-id="' + esc(it.id) + '"><span class="nm">' + esc(it.name) + (it.added_by ? '<small>' + (own ? 'you asked' : esc(it.added_by) + ' asked') + '</small>' : '') + '</span>' +
        (own ? '<button type="button" class="rm" data-rm="' + esc(it.id) + '" aria-label="Remove ' + esc(it.name) + '">\u00d7</button>' : '') +
        '<button type="button" class="btn primary" data-claim="' + esc(it.id) + '">I got it</button></div>';
    }).join('') : '<div class="br-empty">' + (itemsLoaded ? 'Nothing missing right now.' : 'Loading\u2026') + '</div>';
    var others = partyNames().filter(function (p) { return p !== myParty; }), got = 0;
    $('br-who').innerHTML = others.map(function (party) {
      var rows = items.filter(function (it) { return it.party === party; });
      if (rows.length) got++;
      return '<div class="br-row"><div class="nm">' + esc(party) + '</div><div class="items' + (rows.length ? '' : ' none') + '">' + (rows.length ? rows.map(function (r) { return esc(r.name); }).join(', ') : 'nothing yet') + '</div></div>';
    }).join('');
    $('br-who-k').textContent = itemsLoaded ? got + ' of ' + others.length + ' have added something' : '';
  }
  function updateStatus() { /* the live dot went away with the old page; kept so the store can still call it */ }

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
    var el = document.querySelector('[data-claim="' + id + '"], [data-x="' + id + '"]');
    if (el) el.disabled = on;
  }
  function fail(prefix) { return function (e) { toast(prefix + ': ' + ((e && e.message) || e)); }; }
  function patchLocal(row) { items = items.map(function (it) { return it.id === row.id ? row : it; }); render(); }
  function findDup(name) { return items.filter(function (it) { return norm(it.name) === norm(name); })[0]; }

  function addMine(name) {
    var dup = findDup(name);
    if (dup && !dup.party) { claim(dup.id, name + ' was on the list. It\u2019s yours.'); return; }   // typing something we needed just claims it
    var row = { name: name, note: null, category: 'Other', added_by: me, adder_id: myId(), meta: { mine: true }, party: myParty, claimed_by: me };   // meta.mine: added as "I'm bringing", not as a need
    $('addbtn').disabled = true;
    store.add(row).then(function (saved) {
      if (!items.some(function (it) { return it.id === saved.id; })) items.push(saved);
      render(); buzz(6);
      toast(dup && dup.party !== myParty ? 'Added. Heads up: ' + dup.party + ' ' + (dup.party.indexOf('&') >= 0 ? 'have' : 'has') + ' that too.' : 'Added: ' + name + '.');
    }).catch(fail('Couldn\'t add that')).then(function () { $('addbtn').disabled = false; });
  }
  function addNeed(name) {
    var dup = findDup(name);
    if (dup) { toast(dup.party ? dup.party + ' already ' + (dup.party.indexOf('&') >= 0 ? 'have' : 'has') + ' ' + dup.name + '.' : dup.name + ' is already on the list.'); return; }
    var row = { name: name, note: null, category: 'Other', added_by: me, adder_id: myId(), meta: null, party: null, claimed_by: null };
    store.add(row).then(function (saved) {
      if (!items.some(function (it) { return it.id === saved.id; })) items.push(saved);
      render(); toast('On the list: ' + name + '. Someone grab it.');
    }).catch(fail('Couldn\'t add that'));
  }
  function claim(id, msg) {
    if (busy[id]) return;
    var it = items.filter(function (x) { return x.id === id; })[0];
    setBusy(id, true); buzz([8, 30, 8]);
    store.update(id, { party: myParty, claimed_by: me }).then(function (row) { patchLocal(row); toast(msg || ((it ? it.name : 'That') + ' is yours.')); })
      .catch(fail('Couldn\'t grab that')).then(function () { setBusy(id, false); });
  }
  function unclaim(id) {
    if (busy[id]) return;
    setBusy(id, true);
    store.update(id, { party: null, claimed_by: null }).then(function (row) { patchLocal(row); toast('Back on the still-needed list.'); })
      .catch(fail('Couldn\'t update that')).then(function () { setBusy(id, false); });
  }
  function removeItem(id) {
    var it = items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    store.remove(id).then(function () {
      items = items.filter(function (x) { return x.id !== id; });
      render(); toast('Removed ' + it.name + '.');
    }).catch(fail('Couldn\'t remove that'));
  }

  $('adder').addEventListener('submit', function (e) {
    e.preventDefault();
    var el = $('new-name'), name = el.value.replace(/\s+/g, ' ').trim();
    if (!name) { el.focus(); return; }
    el.value = ''; addMine(name); el.focus();
  });
  $('need-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var el = $('need-name'), name = el.value.replace(/\s+/g, ' ').trim();
    if (!name) { el.focus(); return; }
    el.value = ''; addNeed(name); el.blur();
  });
  $('br-you').addEventListener('click', function (e) {
    var b = e.target.closest('[data-x]'); if (!b) return;
    var id = b.getAttribute('data-x'), it = items.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    // your own idea from this phone just goes away; anything that was ever a need (seeded or asked for) goes back on the list
    var ownIdea = !!(it.meta && it.meta.mine && it.adder_id && it.adder_id === myId());
    if (ownIdea) removeItem(id); else unclaim(id);
  });
  $('br-needs').addEventListener('click', function (e) {
    var c = e.target.closest('[data-claim]'); if (c) { claim(c.getAttribute('data-claim')); return; }
    var r = e.target.closest('[data-rm]'); if (r) removeItem(r.getAttribute('data-rm'));
  });

  function listText() {
    var lines = ['Cabin haul \u00b7 ' + new Date().toLocaleDateString()];
    var needed = items.filter(function (it) { return !it.party; });
    if (needed.length) { lines.push('', 'STILL NEEDED'); needed.forEach(function (it) { lines.push('\u2610 ' + it.name); }); }
    partyNames().forEach(function (party) {
      var rows = items.filter(function (it) { return it.party === party; });
      lines.push('', party.toUpperCase() + (rows.length ? '' : ' \u00b7 nothing yet'));
      rows.forEach(function (it) { lines.push('\u2022 ' + it.name); });
    });
    return lines.join('\n');
  }
  $('copylist').addEventListener('click', function () {
    if (!items.length) { toast('Nothing to copy yet.'); return; }
    copyText(listText(), 'List copied. Paste it in the group text.');
  });

  // ---- Quiet self-update ----
  // The live site is static files, so a copy that's already open (Safari, or the home-screen icon) keeps running
  // whatever it loaded until it reloads. This watches app.js with a tiny conditional request (a 304 when nothing has
  // changed) each time the app comes back to the foreground and every few minutes while it's showing. When a new
  // build is up it reloads, but only at a quiet moment: no game, no finger down, no sheet or chat open, no half-built
  // hibachi order, no questionnaire, nothing being typed, and nothing touched for a few seconds. The tab comes back
  // after the reload; the name and the link password are in storage anyway. Not wired up in the artifact
  // prototype, which bundles everything into one file, so there's no app.js to watch.
  (function () {
    var tag = document.querySelector('script[src$="app.js"]'), src = tag && tag.getAttribute('src');
    if (!src || !/^https?:$/.test(location.protocol) || !window.fetch || !window.sessionStorage) return;
    var known = null, pending = null, lastTouch = Date.now(), lastCheck = 0, down = false, reloading = false;
    var ssGet = function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
    var ssSet = function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } };
    // pick up where the page left off when it reloaded itself a moment ago
    try {
      var r = JSON.parse(ssGet('cabin-haul-resume') || 'null'); sessionStorage.removeItem('cabin-haul-resume');
      if (r && Date.now() - r.at < 60000 && TABS.indexOf(r.tab) >= 0 && me) tab = r.tab;
    } catch (e) { /* ignore */ }
    window.addEventListener('pointerdown', function () { down = true; lastTouch = Date.now(); }, { capture: true, passive: true });
    ['pointerup', 'pointercancel'].forEach(function (ev) { window.addEventListener(ev, function () { down = false; lastTouch = Date.now(); }, { capture: true, passive: true }); });
    ['keydown', 'scroll', 'touchmove'].forEach(function (ev) { window.addEventListener(ev, function () { lastTouch = Date.now(); }, { capture: true, passive: true }); });
    function stamp(res) { return (res.headers.get('ETag') || '').replace(/^W\//, '') || res.headers.get('Last-Modified') || ''; }
    function quiet() {
      var a = document.activeElement;
      if (down || reloading || document.body.classList.contains('playing') || chatOpen || expanded !== null || hibDraft || !$('predict').hidden) return false;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return false;
      return Date.now() - lastTouch > 6000;
    }
    function check(force) {
      if (reloading || document.visibilityState !== 'visible') return;
      var gap = Date.now() - lastCheck;
      if (gap < (force ? 45000 : 240000)) return;   // on return to the foreground, at most every 45s; otherwise every four minutes
      lastCheck = Date.now();
      // the first look uses whatever the browser already has (no revalidation): that is the copy that's running now
      var opts = known ? { cache: 'no-store', headers: known.charAt(0) === '"' ? { 'If-None-Match': known } : { 'If-Modified-Since': known } } : { cache: 'force-cache' };
      fetch(src, opts).then(function (res) {
        if (res.status === 304 || !res.ok) return;
        var t = stamp(res); if (!t) return;
        if (!known) { known = t; return; }
        if (t !== known && ssGet('cabin-haul-updated-for') !== t) { pending = t; settle(); }
      }).catch(function () { /* offline or blocked: look again later */ });
    }
    function settle() {
      if (!pending || !quiet()) return;
      var t = pending; pending = null; reloading = true;
      ssSet('cabin-haul-updated-for', t);   // one reload per build, so a bad ETag can never loop the page
      ssSet('cabin-haul-resume', JSON.stringify({ tab: tab, at: Date.now() }));
      // refresh the browser's copies first so the reload runs the new files, not the cached ones
      var files = [location.href.split('#')[0]];
      Array.prototype.forEach.call(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'), function (el) {
        var u = el.getAttribute('src') || el.getAttribute('href'); if (u && !/^(https?:)?\/\//.test(u)) files.push(u);
      });
      Promise.all(files.map(function (f) { return fetch(f, { cache: 'reload' }).catch(function () { /* ignore */ }); }))
        .then(function () { location.reload(); });
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { if (pending) settle(); else check(true); } });
    setInterval(function () { if (pending) settle(); else check(false); }, 15000);
    setTimeout(function () { check(true); }, 4000);
    window.__cabinUpdate = { check: function () { lastCheck = 0; check(true); }, state: function () { return { known: known, pending: pending, reloading: reloading, quiet: quiet() }; } };
  })();

  showScreen();
})();
