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
  var CATEGORIES = ['Food', 'Booze', 'Weed', 'Drinks', 'Snacks', 'Supplies', 'Gear', 'Other'];
  var CAT_ICON = { Food: '\uD83C\uDF56', Drinks: '\uD83E\uDD64', Booze: '\uD83C\uDF7A', Snacks: '\uD83C\uDF7F', Supplies: '\uD83E\uDDFB', Gear: '\uD83C\uDFBF', Weed: '\uD83C\uDF3F', Other: '\uD83D\uDCE6' };
  // the weed questionnaire
  var WEED = {
    form: { label: 'Form', opts: [['flower', '\uD83C\uDF38 Flower'], ['prerolls', '\uD83D\uDEAC Pre-rolls'], ['edibles', '\uD83C\uDF6A Edibles'], ['cart', '\uD83D\uDD0B Cart'], ['dabs', '\uD83D\uDC8E Dabs']] },
    type: { label: 'Type', opts: [['sativa', '\u2600\uFE0F Sativa'], ['indica', '\uD83C\uDF19 Indica'], ['hybrid', '\uD83C\uDF17 Hybrid']] },
    weight: { label: 'How much', opts: [['1g', '1g'], ['3.5g', '\u215B (3.5g)'], ['7g', '\u00BC (7g)'], ['14g', '\u00BD (14g)'], ['28g', 'oz (28g)']] },
    dose: { label: 'How strong', opts: [['10mg', '10mg'], ['25mg', '25mg'], ['50mg', '50mg'], ['100mg', '100mg'], ['??', 'no idea']] },
    grade: { label: 'Be honest', required: true, opts: [['gas', '\uD83D\uDD25 Gas'], ['mid', '\uD83E\uDD74 Crumbly mid']] },
    vibe: { label: 'The vibe', opts: [['couch', '\uD83D\uDECB\uFE0F Couch-lock'], ['giggles', '\uD83D\uDE02 Giggles'], ['creative', '\uD83C\uDFA8 Creative'], ['munchies', '\uD83C\uDF55 Munchies'], ['paranoid', '\uD83D\uDC40 Paranoid']] }
  };
  var BOOZE = {
    kind: { label: 'What kind', opts: [['beer', '\uD83C\uDF7A Beer'], ['seltzer', '\uD83E\uDD64 Seltzer'], ['liquor', '\uD83E\uDD43 Liquor']] },
    count: { label: 'How many', opts: [['6', '6-pack'], ['12', '12-pack'], ['18', '18-pack'], ['24', '24-pack'], ['30', '30 rack'], ['keg', 'a keg']] },
    size: { label: 'How big', opts: [['shooters', 'Shooters'], ['pint', 'Pint'], ['fifth', 'Fifth'], ['handle', 'Handle'], ['several', 'Several']] }
  };
  // which categories get a follow-up panel, and which rows show for which answers
  var PANELS = {
    Weed: { title: 'The paperwork', sub: 'so nobody gets surprised', fields: WEED, rows: function (x) { var r = ['form', 'type']; if (x.form === 'flower' || x.form === 'prerolls') r.push('weight'); if (x.form === 'edibles') r.push('dose'); return r.concat(['grade', 'vibe']); }, placeholder: 'Strain, if you know it (optional)', order: ['form', 'type', 'weight', 'dose', 'grade', 'vibe'] },
    Booze: { title: 'The run', sub: 'so we don\u2019t triple up', fields: BOOZE, rows: function (x) { var r = ['kind']; if (x.kind === 'beer' || x.kind === 'seltzer') r.push('count'); if (x.kind === 'liquor') r.push('size'); return r; }, placeholder: 'Which one? (e.g. Coors Banquet, High Noon)', order: ['kind', 'count', 'size'] }
  };
  function optLabel(cat, key, val) { var p = PANELS[cat]; var o = p ? (p.fields[key] || { opts: [] }).opts.filter(function (x) { return x[0] === val; })[0] : null; return o ? o[1] : val; }

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
  var ARENA_THEME = 'green';   // 'green', 'trunk' or 'pool'. v1 (golf balls on the green) is branch v1-golf-green.
  var BALL_STYLE = 'golf';     // 'golf' or 'pool'
  function renderRoster() {
    if (sim) sim.stop();
    $('roster').classList.toggle('trunk', ARENA_THEME === 'trunk'); $('roster').classList.toggle('pool', ARENA_THEME === 'pool');
    golfer = null; renderGolfPost(false);
    boardShown = false;
    subscribeBoards();
    renderScores();
    sim = renderArena({ box: $('roster'), names: NAMES, games: true, onPick: function (name) {
      me = name; myParty = partyOf(me); lsSet('cabin-haul-me', me);
      showScreen();
    }, onGolfDone: function (total) {
      var who = golfer; golfer = null;
      if (!who || !store || !store.recordGolf) return;
      store.recordGolf(who, total).then(function () { toast(who + ': ' + total + ' strokes, on the board.'); }).catch(function (err) { toast('Couldn\u2019t post that: ' + ((err && err.message) || err)); });
    } });
  }
  // mini golf: say who's putting before the round so the board can keep score
  var golfer = null;
  function renderGolfPost(show) {
    var el = $('golf-post'); if (!el) return;
    if (!show) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<div class="gp-title">Who\u2019s putting?</div><div class="info-sub">Three holes, par 8. Your best round goes on the board.</div>' +
      '<div class="name-grid">' + NAMES.map(function (n) { return '<button type="button" data-golfer="' + esc(n) + '" aria-pressed="false">' + esc(n) + '</button>'; }).join('') + '</div>' +
      '<div class="mafia-actions"><button type="button" class="linkbtn" id="golf-skip">Never mind</button></div>';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  // A physics arena of name balls. opts: box, names, onPick(name), games (hockey/golf easter eggs), current (ring this name).
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
      document.body.classList.toggle('playing', on);
      if (!on) document.body.classList.remove('pool-on');
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
      dimpleTile = null; layerCache = {}; scriptCache = {}; poolCache = {}; speckTile = null; carpetTile = null;
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
    var CHALK_COLS = [[64, 118, 205], [88, 140, 220], [52, 98, 180], [110, 150, 225]];   // cue chalk, for pool balls
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
      var pool = BALL_STYLE === 'pool', cols = pool ? CHALK_COLS : STAIN_COLS;
      var mud = !pool && Math.random() < 0.1, col = mud ? [112, 84, 46] : cols[Math.floor(Math.random() * cols.length)];
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
    // ---- Pool balls (experiment) ----
    var POOL_COLORS = ['#f4c419', '#1d4fb5', '#d9262b', '#5b2d85', '#ef7a18', '#1a7a3c', '#7e1f2b', '#161616'];
    function poolNum(name) { var i = NAMES.indexOf(name); return i < 0 ? 0 : i + 1; }      // 0 = cue ball
    function poolInfo(num) { if (!num) return { color: '#f6f2e8', stripe: false }; var n = num > 8 ? num - 8 : num; return { color: POOL_COLORS[n - 1], stripe: num > 8 }; }
    var poolCache = {}, speckTile = null, SPECK = 48;
    function buildSpeckTile() {
      var off = document.createElement('canvas'); off.width = Math.round(SPECK * dpr); off.height = Math.round(SPECK * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      var seed = 7; function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
      for (var i = 0; i < 28; i++) { o.fillStyle = i % 3 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.12)'; o.beginPath(); o.arc(rnd() * SPECK, rnd() * SPECK, 0.5 + rnd() * 0.9, 0, Math.PI * 2); o.fill(); }
      speckTile = ctx.createPattern(off, 'repeat');
      try { speckTile.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) { /* ignore */ }
    }
    function poolLayers(r, num) {
      var key = Math.round(r * 2) + '@' + num + '@' + dpr;
      if (poolCache[key]) return poolCache[key];
      var size = Math.ceil(r * 2 + 4), c = size / 2, info = poolInfo(num);
      function make(draw) { var off = document.createElement('canvas'); off.width = Math.round(size * dpr); off.height = Math.round(size * dpr); var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0); draw(o); return off; }
      function circ(o, x, y, rr, fill) { o.beginPath(); o.arc(x, y, rr, 0, Math.PI * 2); o.fillStyle = fill; o.fill(); }
      var under = make(function (o) {
        if (info.stripe) {
          circ(o, c, c, r, '#f6f2e8');
          o.save(); o.beginPath(); o.arc(c, c, r, 0, Math.PI * 2); o.clip();
          o.fillStyle = info.color; o.fillRect(0, c - r * 0.6, size, r * 1.2);                 // the band
          o.fillStyle = 'rgba(0,0,0,0.08)'; o.fillRect(0, c - r * 0.6, size, 1.2); o.fillRect(0, c + r * 0.6 - 1.2, size, 1.2);
          o.restore();
        } else circ(o, c, c, r, info.color);
        var tone = o.createRadialGradient(c - r * 0.25, c - r * 0.3, r * 0.1, c, c, r * 1.05);   // body shading, colour kept
        tone.addColorStop(0, 'rgba(255,255,255,0.18)'); tone.addColorStop(0.55, 'rgba(255,255,255,0)'); tone.addColorStop(0.85, 'rgba(0,0,0,0.18)'); tone.addColorStop(1, 'rgba(0,0,0,0.45)');
        circ(o, c, c, r, tone);
      });
      var over = make(function (o) {
        var hl = o.createRadialGradient(c - r * 0.42, c - r * 0.45, 0, c - r * 0.42, c - r * 0.45, r * 0.5);   // broad gloss
        hl.addColorStop(0, 'rgba(255,255,255,0.55)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.12)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
        circ(o, c - r * 0.42, c - r * 0.45, r * 0.5, hl);
        o.save(); o.translate(c - r * 0.45, c - r * 0.5); o.rotate(-0.6); o.scale(1, 0.55);           // hot specular
        var hot = o.createRadialGradient(0, 0, 0, 0, 0, r * 0.22); hot.addColorStop(0, 'rgba(255,255,255,0.95)'); hot.addColorStop(1, 'rgba(255,255,255,0)');
        circ(o, 0, 0, r * 0.22, hot); o.restore();
        o.save(); o.beginPath(); o.arc(c, c, r, 0, Math.PI * 2); o.clip();
        var bounce = o.createRadialGradient(c + r * 0.2, c + r * 1.1, r * 0.2, c + r * 0.2, c + r * 1.1, r * 1.0);   // felt bounce light
        bounce.addColorStop(0, 'rgba(200,170,120,0.25)'); bounce.addColorStop(1, 'rgba(200,170,120,0)');
        circ(o, c, c, r, bounce); o.restore();
        o.beginPath(); o.arc(c, c, r - 0.5, 0, Math.PI * 2); o.lineWidth = 1; o.strokeStyle = 'rgba(0,0,0,0.35)'; o.stroke();
      });
      var shadow = make(function (o) {
        o.save(); o.translate(c, c + r * 0.92); o.scale(1, 0.3);
        var cs = o.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.05);
        cs.addColorStop(0, 'rgba(0,0,0,0.5)'); cs.addColorStop(0.6, 'rgba(0,0,0,0.22)'); cs.addColorStop(1, 'rgba(0,0,0,0)');
        circ(o, 0, 0, r * 1.05, cs); o.restore();
      });
      poolCache[key] = { under: under, over: over, shadow: shadow, size: size, info: info };
      return poolCache[key];
    }
    function drawPoolBall(b, now) {
      var r = b.r * b.scale, num = b.pool != null ? b.pool : (b.name ? poolNum(b.name) : 0);
      if (r < 1.5) return;
      if (!speckTile) buildSpeckTile();
      var L = poolLayers(r, num), half = L.size / 2;
      ctx.globalAlpha = b.alpha;
      ctx.drawImage(L.shadow, b.x - half, b.y - half, L.size, L.size);
      ctx.drawImage(L.under, b.x - half, b.y - half, L.size, L.size);
      ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, r - 0.5, 0, Math.PI * 2); ctx.clip();   // specks and chalk roll with the surface
      var ox = (((b.ox || 0) % SPECK) + SPECK) % SPECK, oy = (((b.oy || 0) % SPECK) + SPECK) % SPECK;
      ctx.translate(b.x - r + ox, b.y - r + oy); ctx.fillStyle = speckTile; ctx.fillRect(-SPECK * 2, -SPECK * 2, r * 2 + SPECK * 4, r * 2 + SPECK * 4);
      ctx.restore();
      if (b.stain && b.stain.pat) {
        var s = b.stain, sx = (((b.ox || 0) % s.pw) + s.pw) % s.pw, sy = (((b.oy || 0) % s.ph) + s.ph) % s.ph;
        ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, r - 0.5, 0, Math.PI * 2); ctx.clip();
        ctx.translate(b.x - r + sx, b.y - r + sy); ctx.fillStyle = s.pat; ctx.fillRect(-s.pw, -s.ph, r * 2 + s.pw * 2, r * 2 + s.ph * 2);
        ctx.restore();
      }
      var k = (b.r / 40) * b.scale;
      if (num) {                                                                   // number spot and the name
        var cr = r * 0.46;
        var spot = ctx.createRadialGradient(b.x - cr * 0.3, b.y - cr * 0.3, cr * 0.1, b.x, b.y, cr);
        spot.addColorStop(0, '#ffffff'); spot.addColorStop(1, '#e6e2d6');
        ctx.beginPath(); ctx.arc(b.x, b.y - r * 0.08, cr, 0, Math.PI * 2); ctx.fillStyle = spot; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#111'; ctx.font = '800 ' + Math.max(6, Math.round(cr * 1.15)) + 'px ' + fontFamily;
        ctx.fillText(String(num), b.x, b.y - r * 0.08 + cr * 0.04);
        if (b.name && r >= 20) {
          var dark = L.info.stripe || num === 1 || num === 5 || num === 9 || num === 13;
          ctx.fillStyle = dark ? '#111' : '#fff'; ctx.font = '800 ' + Math.round(9.4 * k) + 'px ' + fontFamily;
          ctx.fillText(b.name, b.x, b.y + r * 0.7);
        }
      }
      ctx.drawImage(L.over, b.x - half, b.y - half, L.size, L.size);
      if (opts.current && opts.current === b.name) circle(b.x, b.y, r + 4, null, colors.pine[0], 3);
      if (opts.games && b.held && !game && now - holdStart >= HOLD_SHOW_MS) {
        var frac = Math.min(1, (now - holdStart - HOLD_SHOW_MS) / (HOLD_MS - HOLD_SHOW_MS));
        ctx.beginPath(); ctx.arc(b.x, b.y, r + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawBubble(b, now) {
      if (BALL_STYLE === 'pool') { drawPoolBall(b, now); return; }
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
    var GOLF_PAR = 3, GOLF_HOLES = 3;
    function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function startGolf() {
      setPlaying(true);
      var order = COURSES.slice().sort(function () { return Math.random() - 0.5; }).slice(0, GOLF_HOLES);
      golf = { hole: 0, strokes: 0, total: 0, t0: performance.now(), msg: null, done: false, courses: order };
      loadHole();
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
        if (kind === 'block') { o.w = 0.4 * s * W; o.h = 0.045 * H; o.rect = { x: x - o.w / 2, y: y - o.h / 2, w: o.w, h: o.h }; }
        else if (kind === 'slider') { o.w = 0.22 * s * W; o.h = 0.045 * H; o.travel = 0.12 * s * W; o.period = 2400 + Math.random() * 800; o.rect = { x: x - o.w / 2, y: y - o.h / 2, w: o.w, h: o.h }; o.vx = 0; }
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
        chunky(g.done ? g.total + ' strokes on a par ' + GOLF_PAR * g.courses.length + ' course' : g.strokes + (g.strokes === 1 ? ' stroke' : ' strokes') + ' · par ' + GOLF_PAR, W / 2, H / 2 + 22, 14, '#fff', 'center');
        ctx.globalAlpha = 1;
      }
      if (g.reliefFlash && now - g.reliefFlash < 1100) {
        ctx.globalAlpha = Math.min(1, (1100 - (now - g.reliefFlash)) / 400); chunky('free relief', b.x, b.y - 20, 11, '#fff', 'center'); ctx.globalAlpha = 1;
      }
      if (!g.strokes && !g.sunk && !g.aim) {
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(now / 300); chunky('pull back anywhere, let go to putt', b.x, b.y + 28, 12, '#fff', 'center'); ctx.globalAlpha = 1;
      }
    }

    // ---- Pool: break the rack, then 8-ball against Claude ----
    var pool = null;
    box.__pool = function () { return pool; };
    var RACK = [1, 9, 2, 10, 8, 3, 11, 7, 14, 4, 5, 13, 15, 6, 12];
    function startPool() {
      golf = null; setPlaying(true); document.body.classList.add('pool-on');
      var rail = 26, tw = Math.round(W * 0.92), tx0 = Math.round((W - tw) / 2), x0 = tx0 + rail, x1 = tx0 + tw - rail, cx = (x0 + x1) / 2;
      var th = Math.min(H - 40, (x1 - x0) * 1.6 + rail * 2), ty0 = Math.max(32, Math.round((H - th) / 2) + 8);   // a bar box: shorter than a real table, chunky balls
      var y0 = ty0 + rail, y1 = ty0 + th - rail;
      var R = Math.max(7, Math.min(11, (x1 - x0) * 0.034)), pr = R * 1.5;   // balls about 7% of the cloth width, pockets about two balls wide
      var g = { R: R, x0: x0, y0: y0, x1: x1, y1: y1, balls: [], turn: 'you', phase: 'aim', groups: { you: null, cpu: null },
        aim: -Math.PI / 2, power: 0, drag: null, broken: false, msg: null, msgT: 0, shot: null, winner: null, cpuT: 0, cpuPlan: null, t0: performance.now(),
        pockets: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: (y0 + y1) / 2 }, { x: x1, y: (y0 + y1) / 2 }, { x: x0, y: y1 }, { x: x1, y: y1 }].map(function (p) { p.r = pr; return p; }),
        kitchen: { x: cx, y: y0 + (y1 - y0) * 0.76 }, ty0: ty0, ty1: ty0 + th, tx0: tx0, tx1: tx0 + tw };
      var apexY = y0 + (y1 - y0) * 0.27, k = 0;
      for (var row = 0; row < 5; row++) for (var i = 0; i <= row; i++) {
        g.balls.push({ n: RACK[k++], x: cx + (i - row / 2) * (2 * R + 0.6), y: apexY - row * (2 * R * 0.875), vx: 0, vy: 0, r: R, alive: true, scale: 1, alpha: 1, ox: 0, oy: 0 });
      }
      g.cue = { n: 0, x: g.kitchen.x, y: g.kitchen.y, vx: 0, vy: 0, r: R, alive: true, scale: 1, alpha: 1, ox: 0, oy: 0 };
      g.balls.push(g.cue);
      pool = g; poolSay('Break it', 1400);
    }
    function poolSay(m, ms) { pool.msg = m; pool.msgT = performance.now() + (ms || 1400); }
    function poolAlive(g) { return g.balls.filter(function (b) { return b.alive && b.n; }); }
    function groupOf(n) { return n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe'; }
    function leftIn(g, group) { return poolAlive(g).filter(function (b) { return groupOf(b.n) === group; }).length; }
    function poolMoving(g) { return g.balls.some(function (b) { return b.alive && (Math.abs(b.vx) > 0.02 || Math.abs(b.vy) > 0.02); }); }
    function shoot(g, angle, power) {
      var v = 4 + power * 22, brk = !g.broken;
      if (brk) { v *= 2; g.broken = true; }   // the break hits twice as hard: send them everywhere
      g.cue.vx = Math.cos(angle) * v; g.cue.vy = Math.sin(angle) * v;
      g.phase = 'rolling'; g.shot = { by: g.turn, potted: [], scratch: false, firstHit: null }; g.power = 0;
      buzz(brk ? 30 : 12);
    }
    function poolPhysics(dt, now) {
      var g = pool, R = g.R;
      // sinking animation
      g.balls.forEach(function (b) { if (b.sinking) { var t = (now - b.sinking) / 260; b.scale = Math.max(0, 1 - t); b.alpha = Math.max(0, 1 - t); } });
      if (g.phase === 'rolling') {
        var maxV = 0; g.balls.forEach(function (b) { if (b.alive) maxV = Math.max(maxV, Math.hypot(b.vx, b.vy)); });
        var steps = Math.max(1, Math.ceil(maxV * dt / (R * 0.6))), sdt = dt / steps;
        for (var s = 0; s < steps; s++) poolStep(g, sdt, now);
        if (!poolMoving(g)) { g.balls.forEach(function (b) { b.vx = 0; b.vy = 0; }); resolveShot(g, now); }
      } else if (g.phase === 'cpu') {
        if (!g.cpuPlan && now - g.cpuT > 600) { g.cpuPlan = cpuPlanShot(g); g.aim = g.cpuPlan.angle; g.cpuT = now; }
        else if (g.cpuPlan) {
          var t = (now - g.cpuT) / 1100; g.power = Math.min(1, t) * g.cpuPlan.power;
          if (t >= 1.15) { shoot(g, g.cpuPlan.angle, g.cpuPlan.power); g.cpuPlan = null; }
        }
      } else if (g.phase === 'over' && now - g.msgT > 2400) { pool = null; }
    }
    function poolStep(g, dt, now) {
      var R = g.R, live = g.balls.filter(function (b) { return b.alive; });
      live.forEach(function (b) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        var sp = Math.hypot(b.vx, b.vy);
        if (sp > 0) { var fr = Math.pow(sp > 4 ? 0.992 : 0.975, dt); b.vx *= fr; b.vy *= fr; if (sp < 0.06) { b.vx = 0; b.vy = 0; } }
        if (sp > 0) rollBy(b, b.vx * dt, b.vy * dt);
        // pockets
        for (var p = 0; p < g.pockets.length; p++) {
          var pk = g.pockets[p], pd = Math.hypot(b.x - pk.x, b.y - pk.y);
          if (pd < pk.r - R * 0.15) { potBall(g, b, now); return; }
          if (pd < pk.r + R * 0.7 && sp < 2.5) { var pull = 0.09 * dt; b.vx += (pk.x - b.x) / pd * pull; b.vy += (pk.y - b.y) / pd * pull; }   // the pocket slopes: a ball hanging in the jaws drops in
        }
        // cushions, with a gap at each pocket mouth
        var nearPocketY = Math.abs(b.y - g.y0) < R * 1.9 || Math.abs(b.y - (g.y0 + g.y1) / 2) < R * 2.0 || Math.abs(b.y - g.y1) < R * 1.9;
        var nearPocketX = Math.abs(b.x - g.x0) < R * 1.9 || Math.abs(b.x - g.x1) < R * 1.9;
        if (b.x - R < g.x0 && !nearPocketY) { b.x = g.x0 + R; b.vx = Math.abs(b.vx) * 0.72; }
        if (b.x + R > g.x1 && !nearPocketY) { b.x = g.x1 - R; b.vx = -Math.abs(b.vx) * 0.72; }
        if (b.y - R < g.y0 && !nearPocketX) { b.y = g.y0 + R; b.vy = Math.abs(b.vy) * 0.72; }
        if (b.y + R > g.y1 && !nearPocketX) { b.y = g.y1 - R; b.vy = -Math.abs(b.vy) * 0.72; }
        if (b.x < g.x0 - R || b.x > g.x1 + R || b.y < g.y0 - R || b.y > g.y1 + R) potBall(g, b, now);   // fell through a pocket mouth
      });
      for (var i = 0; i < live.length; i++) for (var k = i + 1; k < live.length; k++) {
        var a = live[i], c = live[k]; if (!a.alive || !c.alive) continue;
        var dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01;
        if (d >= 2 * R) continue;
        var nx = dx / d, ny = dy / d, ov = (2 * R - d) / 2;
        a.x -= nx * ov; a.y -= ny * ov; c.x += nx * ov; c.y += ny * ov;
        var rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rel > 0) continue;
        var jimp = -(1 + 0.94) * rel / 2;
        a.vx -= jimp * nx; a.vy -= jimp * ny; c.vx += jimp * nx; c.vy += jimp * ny;
        if (g.shot && !g.shot.firstHit) g.shot.firstHit = a.n === 0 ? c.n : c.n === 0 ? a.n : null;
        if (Math.abs(rel) > 3) buzz(4);
      }
    }
    function potBall(g, b, now) {
      b.alive = false; b.sinking = now; b.vx = 0; b.vy = 0;
      if (g.shot) { if (b.n === 0) g.shot.scratch = true; else g.shot.potted.push(b.n); }
    }
    function respotCue(g) {
      var c = g.cue, R = g.R; c.alive = true; c.sinking = null; c.scale = 1; c.alpha = 1; c.x = g.kitchen.x; c.y = g.kitchen.y; c.vx = 0; c.vy = 0;
      var tries = 0;
      while (tries++ < 40 && g.balls.some(function (b) { return b !== c && b.alive && Math.hypot(b.x - c.x, b.y - c.y) < 2 * R + 1; })) c.y += (tries % 2 ? 1 : -1) * tries * R * 0.6;
    }
    function resolveShot(g, now) {
      var sh = g.shot, me = sh.by, other = me === 'you' ? 'cpu' : 'you', mine = g.groups[me];
      var hadLeft = mine ? leftIn(g, mine) + sh.potted.filter(function (n) { return groupOf(n) === mine; }).length : 99;
      var eight = sh.potted.indexOf(8) >= 0;
      if (eight) {
        var cleared = mine && hadLeft === sh.potted.filter(function (n) { return groupOf(n) === mine; }).length;
        g.winner = cleared && !sh.scratch ? me : other;
        g.phase = 'over'; poolSay(g.winner === 'you' ? 'YOU WIN' : 'CLAUDE WINS', 2400);
        if (store && store.setGame) recordPoolWin(g.winner);
        return;
      }
      var own = sh.potted.filter(function (n) { return n !== 8; });
      if (!mine && own.length) { mine = groupOf(own[0]); g.groups[me] = mine; g.groups[other] = mine === 'solid' ? 'stripe' : 'solid'; poolSay((me === 'you' ? 'You’re ' : 'Claude’s ') + mine + 's', 1500); }
      var keep = !sh.scratch && own.some(function (n) { return groupOf(n) === mine; });
      if (sh.scratch) { respotCue(g); poolSay('Scratch', 1300); }
      g.turn = keep ? me : other;
      g.phase = g.turn === 'you' ? 'aim' : 'cpu'; g.cpuT = now; g.cpuPlan = null; g.shot = null;
      if (!keep && !sh.scratch) poolSay(g.turn === 'you' ? 'Your shot' : 'Claude’s shot', 1100);
      if (g.turn === 'you' && !g.aim) g.aim = -Math.PI / 2;
    }
    function recordPoolWin(winner) {
      var doc = Object.assign({ humans: 0, cpu: 0 }, poolScores || {});
      if (winner === 'you') doc.humans++; else doc.cpu++;
      poolScores = doc; store.setGame('pool', doc).catch(function () { /* best effort */ });
    }
    // where the cue ball meets the first ball or cushion along an angle: used for the guide and for Claude
    function pathClear(g, from, to, ignore, R) {
      var dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 0.01, ux = dx / L, uy = dy / L;
      return !g.balls.some(function (b) {
        if (!b.alive || b === ignore || b.n === 0 && from === g.cue) return false;
        if (ignore && ignore.indexOf && ignore.indexOf(b) >= 0) return false;
        var t = (b.x - from.x) * ux + (b.y - from.y) * uy; if (t < 0 || t > L) return false;
        var px = from.x + ux * t, py = from.y + uy * t;
        return Math.hypot(b.x - px, b.y - py) < 2 * R - 0.5;
      });
    }
    function firstContact(g, angle) {
      var c = g.cue, R = g.R, ux = Math.cos(angle), uy = Math.sin(angle), best = null;
      g.balls.forEach(function (b) {
        if (!b.alive || b === c) return;
        var rx = b.x - c.x, ry = b.y - c.y, t = rx * ux + ry * uy; if (t < 0) return;
        var d2 = rx * rx + ry * ry - t * t, rr = (2 * R) * (2 * R); if (d2 > rr) return;
        var hit = t - Math.sqrt(rr - d2); if (hit < 0) return;
        if (!best || hit < best.t) best = { t: hit, ball: b };
      });
      var tx = ux > 0 ? (g.x1 - R - c.x) / ux : ux < 0 ? (g.x0 + R - c.x) / ux : Infinity;
      var ty = uy > 0 ? (g.y1 - R - c.y) / uy : uy < 0 ? (g.y0 + R - c.y) / uy : Infinity;
      var tw = Math.min(tx, ty);
      if (!best || tw < best.t) return { t: tw, ball: null, x: c.x + ux * tw, y: c.y + uy * tw };
      return { t: best.t, ball: best.ball, x: c.x + ux * best.t, y: c.y + uy * best.t };
    }
    function cpuPlanShot(g) {
      var R = g.R, c = g.cue, mine = g.groups.cpu, cands = [];
      var targets = poolAlive(g).filter(function (b) { return mine ? (leftIn(g, mine) ? groupOf(b.n) === mine : b.n === 8) : b.n !== 8; });
      targets.forEach(function (b) {
        g.pockets.forEach(function (pk) {
          var dx = pk.x - b.x, dy = pk.y - b.y, L = Math.hypot(dx, dy) || 0.01, ux = dx / L, uy = dy / L;
          var gx = b.x - ux * 2 * R, gy = b.y - uy * 2 * R;
          var ax = gx - c.x, ay = gy - c.y, A = Math.hypot(ax, ay) || 0.01;
          var cut = Math.acos(Math.max(-1, Math.min(1, (ax * ux + ay * uy) / A)));
          if (cut > 1.25) return;
          if (!pathClear(g, c, { x: gx, y: gy }, b, R)) return;
          if (!pathClear(g, b, pk, b, R)) return;
          var score = A + L * 0.8 + cut * 160 + (Math.abs(ux) > 0.9 || Math.abs(uy) > 0.9 ? 0 : 20);
          cands.push({ angle: Math.atan2(ay, ax), power: Math.max(0.32, Math.min(0.85, 0.22 + (A + L) / 520 + cut * 0.15)), score: score });
        });
      });
      cands.sort(function (a, b) { return a.score - b.score; });
      var pick = cands[0];
      if (!pick) {   // nothing on: nudge the nearest legal ball
        var near = targets.slice().sort(function (a, b) { return Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y); })[0] || poolAlive(g)[0];
        pick = { angle: Math.atan2(near.y - c.y, near.x - c.x), power: 0.3 };
      }
      pick.angle += (Math.random() - 0.5) * 0.02;   // Claude is good, not perfect
      return pick;
    }
    // the table never moves, so it's painted once into an offscreen canvas and blitted each frame
    function buildTableImage(g) {
      var off = document.createElement('canvas'); off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      var X0 = g.tx0, X1 = g.tx1, T0 = g.ty0, T1 = g.ty1, TW = X1 - X0, TH = T1 - T0, rail = g.x0 - X0;
      function rr(x, y, w, h, r) { o.beginPath(); o.moveTo(x + r, y); o.arcTo(x + w, y, x + w, y + h, r); o.arcTo(x + w, y + h, x, y + h, r); o.arcTo(x, y + h, x, y, r); o.arcTo(x, y, x + w, y, r); o.closePath(); }
      function circ(x, y, r, fill, stroke, lw) { o.beginPath(); o.arc(x, y, r, 0, Math.PI * 2); if (fill) { o.fillStyle = fill; o.fill(); } if (stroke) { o.lineWidth = lw || 1; o.strokeStyle = stroke; o.stroke(); } }
      // carpet
      if (!carpetTile) buildCarpetTile();
      o.fillStyle = carpetTile; o.fillRect(0, 0, W, H);
      var vig = o.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.35)');
      o.fillStyle = vig; o.fillRect(0, 0, W, H);
      // shadow, then the apron (outer, darker) and the rail top (inner, lighter) as two stepped pieces of wood
      o.fillStyle = 'rgba(0,0,0,0.38)'; rr(X0 + 4, T0 + 9, TW - 2, TH, 18); o.fill();
      var apron = o.createLinearGradient(X0, T0, X1, T1); apron.addColorStop(0, '#4a2a12'); apron.addColorStop(0.5, '#2e1808'); apron.addColorStop(1, '#3f2410');
      o.fillStyle = apron; rr(X0, T0, TW, TH, 18); o.fill();
      var top = o.createLinearGradient(X0, T0, X1, T1); top.addColorStop(0, '#8a5a30'); top.addColorStop(0.45, '#5c3717'); top.addColorStop(1, '#7a4c27');
      o.fillStyle = top; rr(X0 + 7, T0 + 7, TW - 14, TH - 14, 13); o.fill();
      // grain on the rail top
      o.save(); rr(X0 + 7, T0 + 7, TW - 14, TH - 14, 13); o.clip();
      o.strokeStyle = 'rgba(0,0,0,0.14)'; o.lineWidth = 1;
      for (var gi = 0; gi < 12; gi++) {
        var gx = X0 + 9 + gi * 1.5, gx2 = X1 - 9 - gi * 1.5, wob = Math.sin(gi * 1.7) * 3;
        o.beginPath(); o.moveTo(gx, T0); o.bezierCurveTo(gx + wob, T0 + TH * 0.35, gx - wob, T0 + TH * 0.7, gx, T1); o.stroke();
        o.beginPath(); o.moveTo(gx2, T0); o.bezierCurveTo(gx2 - wob, T0 + TH * 0.35, gx2 + wob, T0 + TH * 0.7, gx2, T1); o.stroke();
        var gy = T0 + 9 + gi * 1.5; o.beginPath(); o.moveTo(X0, gy); o.bezierCurveTo(X0 + TW * 0.3, gy + wob, X0 + TW * 0.7, gy - wob, X1, gy); o.stroke();
        gy = T1 - 9 - gi * 1.5; o.beginPath(); o.moveTo(X0, gy); o.bezierCurveTo(X0 + TW * 0.3, gy - wob, X0 + TW * 0.7, gy + wob, X1, gy); o.stroke();
      }
      // lacquer sheen across the rails
      var sheen = o.createLinearGradient(X0, T0, X1, T1); sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.35, 'rgba(255,255,255,0.12)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)'); sheen.addColorStop(0.8, 'rgba(255,255,255,0.07)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = sheen; o.fillRect(X0, T0, TW, TH);
      o.restore();
      // bevels: light edge on the apron and rail top, brass inlay line between them
      o.lineWidth = 1.5; o.strokeStyle = 'rgba(255,255,255,0.12)'; rr(X0 + 2, T0 + 2, TW - 4, TH - 4, 16); o.stroke();
      o.lineWidth = 1; o.strokeStyle = 'rgba(0,0,0,0.5)'; rr(X0 + 7, T0 + 7, TW - 14, TH - 14, 13); o.stroke();
      o.lineWidth = 1.2; o.strokeStyle = 'rgba(224,186,110,0.55)'; rr(X0 + 5, T0 + 5, TW - 10, TH - 10, 14); o.stroke();
      o.lineWidth = 1; o.strokeStyle = 'rgba(255,255,255,0.14)'; rr(X0 + 8.5, T0 + 8.5, TW - 17, TH - 17, 12); o.stroke();
      // cushion band, then the cloth
      o.fillStyle = '#8f7a55'; o.fillRect(g.x0 - 8, g.y0 - 8, g.x1 - g.x0 + 16, g.y1 - g.y0 + 16);
      o.fillStyle = 'rgba(0,0,0,0.18)'; o.fillRect(g.x0 - 8, g.y0 - 8, g.x1 - g.x0 + 16, 2); o.fillRect(g.x0 - 8, g.y0 - 8, 2, g.y1 - g.y0 + 16);
      o.fillStyle = 'rgba(255,255,255,0.10)'; o.fillRect(g.x0 - 8, g.y1 + 6, g.x1 - g.x0 + 16, 2); o.fillRect(g.x1 + 6, g.y0 - 8, 2, g.y1 - g.y0 + 16);
      o.strokeStyle = 'rgba(0,0,0,0.35)'; o.lineWidth = 1; o.strokeRect(g.x0 - 8.5, g.y0 - 8.5, g.x1 - g.x0 + 17, g.y1 - g.y0 + 17);
      var felt = o.createRadialGradient(W / 2, (g.y0 + g.y1) / 2, 20, W / 2, (g.y0 + g.y1) / 2, TH * 0.7);
      felt.addColorStop(0, '#c9a97a'); felt.addColorStop(1, '#ad8d5f');
      o.fillStyle = felt; o.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
      o.strokeStyle = 'rgba(0,0,0,0.12)'; o.lineWidth = 1; o.beginPath(); o.moveTo(g.x0, g.kitchen.y); o.lineTo(g.x1, g.kitchen.y); o.stroke();
      circ(W / 2, g.y0 + (g.y1 - g.y0) * 0.27, 1.6, 'rgba(0,0,0,0.25)');
      // pockets: leather boot, brass rim, dark hole
      g.pockets.forEach(function (pk) {
        circ(pk.x, pk.y, pk.r + 7, '#1e1208'); circ(pk.x, pk.y, pk.r + 5.5, '#3a2412');
        var brass = o.createRadialGradient(pk.x - 2, pk.y - 2, pk.r, pk.x, pk.y, pk.r + 4); brass.addColorStop(0, '#e2c27a'); brass.addColorStop(1, '#8a6a30');
        circ(pk.x, pk.y, pk.r + 3.2, brass); circ(pk.x, pk.y, pk.r, '#050505');
        var inner = o.createRadialGradient(pk.x, pk.y, pk.r * 0.3, pk.x, pk.y, pk.r); inner.addColorStop(0, 'rgba(0,0,0,0)'); inner.addColorStop(1, 'rgba(40,30,20,0.6)'); circ(pk.x, pk.y, pk.r, inner);
      });
      // mother-of-pearl diamond sights, with a tiny brass screw beside each corner
      function diamond(x, y) {
        o.save(); o.translate(x, y); o.rotate(Math.PI / 4);
        var mop = o.createLinearGradient(-3, -3, 3, 3); mop.addColorStop(0, '#fff8e6'); mop.addColorStop(0.5, '#d9c9b0'); mop.addColorStop(1, '#f6ecd8');
        o.fillStyle = mop; o.fillRect(-2.8, -2.8, 5.6, 5.6); o.strokeStyle = 'rgba(0,0,0,0.35)'; o.lineWidth = 0.6; o.strokeRect(-2.8, -2.8, 5.6, 5.6); o.restore();
      }
      var railMid = rail / 2 + 2;
      [0.125, 0.25, 0.375, 0.625, 0.75, 0.875].forEach(function (f) { diamond(X0 + railMid, g.y0 + (g.y1 - g.y0) * f); diamond(X1 - railMid, g.y0 + (g.y1 - g.y0) * f); });
      [0.25, 0.5, 0.75].forEach(function (f) { diamond(g.x0 + (g.x1 - g.x0) * f, T0 + railMid); diamond(g.x0 + (g.x1 - g.x0) * f, T1 - railMid); });
      [[X0 + 11, T0 + 11], [X1 - 11, T0 + 11], [X0 + 11, T1 - 11], [X1 - 11, T1 - 11]].forEach(function (s) { circ(s[0], s[1], 1.6, '#c9a85c', 'rgba(0,0,0,0.5)', 0.6); });
      g.tableImg = { c: off, w: W, h: H, dpr: dpr };
    }
    var carpetTile = null;
    function buildCarpetTile() {
      var size = 64, off = document.createElement('canvas'); off.width = Math.round(size * dpr); off.height = Math.round(size * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.fillStyle = '#4a2a2e'; o.fillRect(0, 0, size, size);
      var seed = 3; function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
      var cols = ['#5a3338', '#3d2124', '#6a3d42', '#2f1a1d', '#55303a'];
      for (var i = 0; i < 420; i++) { o.fillStyle = cols[Math.floor(rnd() * cols.length)]; o.globalAlpha = 0.55 + rnd() * 0.45; o.fillRect(rnd() * size, rnd() * size, 1.4, 1.4); }
      o.globalAlpha = 1;
      carpetTile = ctx.createPattern(off, 'repeat');
      try { carpetTile.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) { /* ignore */ }
    }
    function drawPool(now) {
      var g = pool, R = g.R;
      if (!g.tableImg || g.tableImg.w !== W || g.tableImg.h !== H || g.tableImg.dpr !== dpr) buildTableImage(g);
      ctx.drawImage(g.tableImg.c, 0, 0, W, H);
      // aiming guide
      var aiming = (g.phase === 'aim') || (g.phase === 'cpu' && g.cpuPlan);
      if (aiming && g.cue.alive) {
        var fc = firstContact(g, g.aim), c = g.cue;
        ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(fc.x, fc.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(fc.x, fc.y, R, 0, Math.PI * 2); ctx.stroke();
        if (fc.ball) {
          var b = fc.ball, nx = (b.x - fc.x) / (2 * R), ny = (b.y - fc.y) / (2 * R);
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + nx * 46, b.y + ny * 46); ctx.stroke();
          var ux = Math.cos(g.aim), uy = Math.sin(g.aim), dot = ux * nx + uy * ny, tx = ux - nx * dot, ty = uy - ny * dot, tl = Math.hypot(tx, ty) || 1;
          ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(fc.x, fc.y); ctx.lineTo(fc.x + tx / tl * 26, fc.y + ty / tl * 26); ctx.stroke();
        }
        ctx.restore();
      }
      // balls
      g.balls.forEach(function (b) { if (b.alpha > 0 && (b.alive || b.sinking)) drawPoolBall({ x: b.x, y: b.y, r: b.r, scale: b.scale, alpha: b.alpha, ox: b.ox, oy: b.oy, name: '', num: '', pool: b.n, stain: b.stain }, now); });
      // cue stick
      if (aiming && g.cue.alive) {
        var back = 10 + g.power * 42, ca = g.aim + Math.PI;
        ctx.save(); ctx.translate(g.cue.x + Math.cos(ca) * (R + back), g.cue.y + Math.sin(ca) * (R + back)); ctx.rotate(ca);
        var sg = ctx.createLinearGradient(0, -4, 0, 4); sg.addColorStop(0, '#e8c48a'); sg.addColorStop(0.5, '#b8814a'); sg.addColorStop(1, '#6b4423');
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(0, -2 + 3, 170, 6, 3); ctx.fill();
        ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(0, -2.2); ctx.lineTo(170, -4.5); ctx.lineTo(170, 4.5); ctx.lineTo(0, 2.2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#4a90c8'; ctx.fillRect(-3, -2.2, 3, 4.4); ctx.fillStyle = '#f1e9d8'; ctx.fillRect(0, -2.2, 8, 4.4);
        ctx.restore();
      }
      // power slider on the right rail
      if (g.phase === 'aim') {
        var sx = g.tx1 - 11, top = g.y0 + 16, bot = g.y1 - 16;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(sx - 6, top - 6, 12, bot - top + 12, 6); ctx.fill();
        var pg = ctx.createLinearGradient(0, top, 0, bot); pg.addColorStop(0, '#ffd166'); pg.addColorStop(1, '#ef476f');
        ctx.fillStyle = pg; roundRect(sx - 4, top, 8, (bot - top) * g.power, 4); ctx.fill();
        circle(sx, top + (bot - top) * g.power, 9, '#fff', 'rgba(0,0,0,0.3)', 1);
        if (g.power < 0.02 && !g.drag) { ctx.save(); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 300); ctx.fillStyle = '#fff'; ctx.font = '600 10px ' + fontFamily; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText('drag down to shoot', sx - 14, top + 4); ctx.restore(); }
      }
      // HUD
      var yl = g.groups.you ? leftIn(g, g.groups.you) + ' ' + g.groups.you + 's' : 'open', cl = g.groups.cpu ? leftIn(g, g.groups.cpu) + ' ' + g.groups.cpu + 's' : 'open';
      ctx.fillStyle = g.turn === 'you' ? colors.pine[0] : 'rgba(0,20,8,0.55)'; roundRect(8, 4, 118, 22, 8); ctx.fill();
      ctx.fillStyle = g.turn === 'cpu' ? colors.claude : 'rgba(0,20,8,0.55)'; roundRect(W - 126 - 58, 4, 118, 22, 8); ctx.fill();
      ctx.fillStyle = 'rgba(0,20,8,0.55)'; roundRect(W - 58, 4, 50, 22, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 11px ' + fontFamily; ctx.textBaseline = 'middle';
      ctx.textAlign = 'left'; ctx.fillText('You · ' + yl, 16, 15);
      ctx.textAlign = 'right'; ctx.fillText('Claude · ' + cl, W - 66, 15);
      ctx.textAlign = 'center'; ctx.fillText('quit', W - 33, 15);
      if (g.msg && now < g.msgT) {
        var kk = Math.min(1, (g.msgT - now) / 300);
        ctx.globalAlpha = kk; ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(W / 2 - 90, H / 2 - 22, 180, 44, 12); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '800 20px ' + fontFamily; ctx.textAlign = 'center'; ctx.fillText(g.msg, W / 2, H / 2); ctx.globalAlpha = 1;
      }
    }
    function poolPointerDown(p, e) {
      var g = pool;
      if (p.x > W - 58 && p.y < 30) { pool = null; return; }
      if (g.phase !== 'aim') return;
      if (p.x > g.tx1 - 26 && p.y > g.y0) { g.drag = { type: 'power', y0: p.y, p0: g.power }; }
      else { g.drag = { type: 'aim', a: Math.atan2(p.y - g.cue.y, p.x - g.cue.x) }; }
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    function poolPointerMove(p) {
      var g = pool; if (!g.drag || g.phase !== 'aim') return;
      if (g.drag.type === 'power') { var top = g.y0 + 16, bot = g.y1 - 16; g.power = Math.max(0, Math.min(1, (p.y - top) / (bot - top))); return; }
      var a = Math.atan2(p.y - g.cue.y, p.x - g.cue.x), da = Math.atan2(Math.sin(a - g.drag.a), Math.cos(a - g.drag.a));
      g.aim += da; g.drag.a = a;
    }
    function poolPointerUp() {
      var g = pool; if (!g.drag) return;
      var d = g.drag; g.drag = null;
      if (d.type === 'power' && g.phase === 'aim') { if (g.power > 0.04) shoot(g, g.aim, g.power); else g.power = 0; }
    }

    // ---- Air hockey ----
    function startGame(paddle) {
      setPlaying(true);
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
      if (playing && !pool && !golf && !game) setPlaying(false);
      var dt = Math.min(32, now - last) / 16.67; last = now;
      if (pool) {
        poolPhysics(dt, now);
        ctx.clearRect(0, 0, W, H);
        if (pool) drawPool(now); else { balls.forEach(function (b) { drawBubble(b, now); }); }
        next(); return;
      }
      if (golf) {
        golfPhysics(dt, now);
        ctx.clearRect(0, 0, W, H);
        if (golf) drawGolf(now); else { balls.forEach(function (b) { drawBubble(b, now); }); }
        next(); return;
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
      if (pool) { poolPointerDown(p, e); e.preventDefault(); return; }
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
      if (pool) { poolPointerMove(pos(e)); return; }
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
      if (pool) { poolPointerUp(); return; }
      if (golf) { if (golf.drag) golfPutt(golf, performance.now()); return; }
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
    return { stop: function () { running = false; if (ro) ro.disconnect(); setPlaying(false); }, startGolf: startGolf, startPool: startPool, setCurrent: function (n) { opts.current = n; } };
  }
  $('switch').addEventListener('click', function () { me = null; myParty = null; lsDel('cabin-haul-me'); showScreen(); });
  $('golfword').addEventListener('click', function () { if (sim && sim.startGolf && !me) renderGolfPost(true); });
  var poolScores = null;
  $('poolword').addEventListener('click', function () { if (sim && sim.startPool && !me) { renderGolfPost(false); sim.startPool(); window.scrollTo({ top: $('roster').offsetTop - 12, behavior: 'smooth' }); } });

  function showScreen() {
    var picking = !me;
    $('predict').hidden = true;
    $('pick').hidden = !picking; $('main').hidden = picking; $('nav').hidden = picking;
    document.body.classList.toggle('picking', picking);
    if (picking) { renderRoster(); window.scrollTo(0, 0); return; }
    if (!booted) boot();
    if (me !== renderedFor) refreshForUser();
    if (shouldAsk()) { askedThisVisit = true; openQuestionnaire(firstUnanswered()); return; }
    var partner = PARTIES.filter(function (p) { return p.indexOf(me) >= 0; })[0].filter(function (n) { return n !== me; })[0];
    $('me').innerHTML = 'Hey <b>' + esc(me) + '</b>' + (partner ? ' · with ' + esc(partner) : '');
    showTab(tab);
    render();
  }

  // Everything on the main screen labels the current person as "you" and keeps per-person drafts, so when
  // someone taps "Not you?" and picks another name, start those over.
  var renderedFor = null;
  function refreshForUser() {
    renderedFor = me;
    mafiaDraft = null; teamsDraft = null; teamsEdit = false; expSplit = null; expanded = null; pickerFor = null; modReveal = false;
    renderPredictions(); renderSheet(); renderWall(); updateChatBadge();
    renderMafia(); renderTeams(); renderLiv(); renderSmash(); renderRouletteStatus();
    renderHockeyBoard(); renderGolfBoard(); renderSplitGrid(); renderVenmo(); renderMoney();
  }

  // ---- Bottom tabs ----
  var TABS = ['home', 'bringing', 'cabin', 'games', 'money', 'chat'];
  var tab = 'cabin';
  function showTab(name) {
    tab = name;
    TABS.forEach(function (t) { $('page-' + t).hidden = t !== tab; });
    if (tab === 'money') { renderSplitGrid(); renderVenmo(); renderMoney(); }
    if (tab === 'chat') { renderWall(true); markWallSeen(); }
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    updateChatBadge();
    window.scrollTo(0, 0);
  }
  $('nav').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) showTab(b.getAttribute('data-tab')); });

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
  function buzz(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  function sameDoc(a, b) { return JSON.stringify(a || null) === JSON.stringify(b || null); }
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
  function teamsDefaults() { return { players: NAMES.slice(), count: 2, split: true }; }
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
      var d = teamsDraft || (teamsDraft = t ? { players: t.players.slice(), count: t.count, split: !!t.split } : teamsDefaults());
      var n = d.players.length;
      status.textContent = t ? 'Changing who’s in' : 'No teams yet';
      html += '<p class="info-sub">Pick who’s in, how many teams, and let the phone decide. Everyone sees the same teams.</p>';
      html += '<div class="name-grid">' + NAMES.map(function (nm) {
        return '<button type="button" data-player="' + esc(nm) + '" aria-pressed="' + (d.players.indexOf(nm) >= 0) + '">' + esc(nm) + '</button>';
      }).join('') + '</div>';
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
  function saveTeams(players, count, split) {
    count = Math.max(2, Math.min(count, players.length));
    if (players.length < 2) { toast('Need at least two people.'); return; }
    var doc = { status: 'set', by: me, players: players, count: count, split: !!split, teams: makeTeams(players, count, split), made_at: new Date().toISOString() };
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
    if (e.target.closest('#teams-make')) { saveTeams(d.players.slice(), d.count, d.split); return; }
    if (e.target.closest('#teams-cancel')) { teamsEdit = false; teamsDraft = null; renderTeams(); return; }
    if (e.target.closest('#teams-shuffle') && teams) { saveTeams(teams.players.slice(), teams.count, teams.split); return; }
    if (e.target.closest('#teams-edit') && teams) { teamsEdit = true; teamsDraft = null; renderTeams(); return; }
    if (e.target.closest('#teams-clear') && teams) {
      var cleared = { status: 'cleared', by: me, cleared_at: new Date().toISOString() };
      store.setGame('teams', cleared).then(function () { teams = cleared; teamsDraft = null; teamsEdit = false; renderTeams(); }).catch(function (err) { toast('Couldn’t clear: ' + ((err && err.message) || err)); });
    }
  });

  // ---- Games: Liv’s Question Gauntlet (deep question generator) ----
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
    var html = '<p class="info-sub">Liv wants to really get to know you. One question at a time, no repeats, nowhere to hide. Everyone’s phone shows the same one.</p>';
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

  // ---- Games: Mitch vs Luke Smash tally ----
  var smash = null, smashLoaded = false, smashSub = false, smashAnim = null, charge = null;
  var SMASH_P = { p1: 'Mitch', p2: 'Luke' };
  function subscribeSmash() {
    if (smashSub || !store || !store.game) return;
    smashSub = true;
    store.game('smash', function (doc) {
      var same = smashLoaded && JSON.stringify((doc && doc.log) || []) === JSON.stringify((smash && smash.log) || []);
      smash = doc; smashLoaded = true;
      if (!same) renderSmash();                       // our own write echoing back shouldn't restart the KO animation
    });
  }
  function smashCounts() {
    var log = (smash && smash.log) || [], c = { p1: 0, p2: 0 };
    log.forEach(function (e) { if (c[e.w] != null) c[e.w]++; });
    return c;
  }
  function smashStreak(side) {
    var log = (smash && smash.log) || [], n = 0;
    for (var i = log.length - 1; i >= 0 && log[i].w === side; i--) n++;
    return n;
  }
  function renderSmash() {
    var body = $('smash-body'), status = $('smash-status'); if (!body) return;
    if (!smashLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var c = smashCounts(), log = (smash && smash.log) || [];
    status.textContent = c.p1 + ' – ' + c.p2 + (c.p1 === c.p2 ? (log.length ? ' · tied' : '') : ' · ' + (c.p1 > c.p2 ? SMASH_P.p1 : SMASH_P.p2) + ' leads');
    var html = '<p class="info-sub">Every Smash match, counted. Hold the winner’s card until it fills. Anyone can log a win, so no fudging.</p>';
    html += '<div class="smash"><div class="smash-board">';
    ['p1', 'p2'].forEach(function (side) {
      var n = c[side], lead = n > c[side === 'p1' ? 'p2' : 'p1'], st = smashStreak(side);
      var rolling = smashAnim && smashAnim.side === side;
      html += '<div class="fighter ' + side + (lead ? ' lead' : '') + '" data-side="' + side + '"><div class="fname">' + esc(SMASH_P[side]) + '</div>' +
        '<div class="odo"><div class="roll' + (rolling ? ' spin' : '') + '">' + (rolling ? '<span>' + smashAnim.from + '</span>' : '') + '<span>' + n + '</span></div></div>' +
        '<div class="streak">' + (st >= 2 ? st + ' in a row' : '') + '</div>' +
        '<div class="ko-hint"><span>Hold to KO</span></div></div>';
      if (side === 'p1') html += '<div class="vs">VS</div>';
    });
    html += '</div>';
    if (smashAnim) html += '<div class="ko-flash ' + smashAnim.side + '">GAME!</div>';
    html += '</div>';
    if (log.length) {
      var last = log[log.length - 1];
      html += '<div class="history">' + log.slice(-24).map(function (e) { return '<i class="' + e.w + '" title="' + esc(SMASH_P[e.w]) + '"></i>'; }).join('') + '<span style="margin-left:6px">last: ' + esc(SMASH_P[last.w]) + ', logged by ' + esc(last.by === me ? 'you' : last.by) + ' ' + esc(agoText(last.at)) + '</span></div>';
      html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="smash-undo">Undo last</button></div>';
    }
    body.innerHTML = html;
    smashAnim = null;
  }
  function smashWin(side) {
    var log = ((smash && smash.log) || []).slice(-199);
    var before = smashCounts()[side];
    log.push({ w: side, by: me, at: new Date().toISOString() });
    var doc = { log: log, updated_at: new Date().toISOString() };
    smash = doc; smashAnim = { side: side, from: before };
    renderSmash();
    var card = $('smash-body').querySelector('.smash'); if (card) { card.classList.add('shake'); }
    try { if (navigator.vibrate) navigator.vibrate([30, 40, 60]); } catch (e) { /* ignore */ }
    store.setGame('smash', doc).catch(function (e) { toast('Couldn’t save that win: ' + ((e && e.message) || e)); });
  }
  function chargeStart(e) {
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
  }
  $('smash-body').addEventListener('pointerdown', chargeStart);
  window.addEventListener('pointerup', chargeEnd); window.addEventListener('pointercancel', chargeEnd);
  $('smash-body').addEventListener('contextmenu', function (e) { if (e.target.closest('.fighter')) e.preventDefault(); });
  $('smash-body').addEventListener('click', function (e) {
    if (e.target.closest('#smash-undo') && smash && smash.log && smash.log.length) {
      var doc = { log: smash.log.slice(0, -1), updated_at: new Date().toISOString() };
      store.setGame('smash', doc).then(function () { smash = doc; renderSmash(); }).catch(function (err) { toast('Couldn’t undo: ' + ((err && err.message) || err)); });
    }
  });

  // ---- Games: Drink Roulette ----
  var roulette = null, rouSub = false, wheelAngle = 0, wheelVel = 0, wheelRaf = 0, wheelImg = null, wheelIdx = -1, wheelDrag = null, rouResult = null;
  var WHEEL_COLORS = ['#2d6a4f', '#d2691e', '#3f7cae', '#8e44ad', '#b7950b'];
  var WHEEL = ['Joe'].concat(NAMES);   // Joe's on there twice, opposite himself, in a different color so nobody notices
  var PENALTIES = [
    ['🥃', 'Take a shot', 'Your choice of poison. Within reason.'],
    ['🍺', 'Chug a beer', 'Whole thing. No air breaks.']
  ];
  function subscribeRoulette() {
    if (rouSub || !store || !store.game) return;
    rouSub = true;
    store.game('roulette', function (doc) { roulette = doc; renderRouletteStatus(); });
  }
  function renderRouletteStatus() {
    var st = $('roulette-status'), last = $('rou-last'); if (!st) return;
    if (roulette && roulette.name) {
      var pen = PENALTIES[roulette.penalty] || PENALTIES[0];
      st.textContent = 'Last: ' + roulette.name + ' ' + pen[0];
      if (last) last.textContent = 'Last spin landed on ' + roulette.name + ' (' + pen[1].toLowerCase() + '), spun by ' + (roulette.by === me ? 'you' : roulette.by) + ' ' + agoText(roulette.at) + '.';
    } else {
      st.textContent = 'Nobody yet';
      if (last) last.textContent = '';
    }
  }
  function buildWheel() {
    var cv = $('wheel'); if (!cv) return;
    var size = 280, d = window.devicePixelRatio || 1;
    cv.width = Math.round(size * d); cv.height = Math.round(size * d);
    var off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height;
    var o = off.getContext('2d'); o.setTransform(d, 0, 0, d, 0, 0);
    var cx = size / 2, cy = size / 2, r = size / 2, n = WHEEL.length, step = Math.PI * 2 / n;
    WHEEL.forEach(function (nm, i) {
      var a0 = i * step, a1 = a0 + step;
      o.beginPath(); o.moveTo(cx, cy); o.arc(cx, cy, r, a0, a1); o.closePath();
      o.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length]; o.fill();
      o.strokeStyle = 'rgba(255,255,255,0.35)'; o.lineWidth = 1.5; o.stroke();
      o.save(); o.translate(cx, cy); o.rotate(a0 + step / 2);
      o.textAlign = 'right'; o.textBaseline = 'middle'; o.fillStyle = '#fff';
      o.font = '800 14px ' + cssVar('--display'); o.shadowColor = 'rgba(0,0,0,0.35)'; o.shadowBlur = 3;
      o.fillText(nm, r - 14, 0); o.restore();
    });
    var hub = o.createRadialGradient(cx, cy, 2, cx, cy, 24);
    hub.addColorStop(0, '#fff'); hub.addColorStop(1, '#d9ded8');
    o.beginPath(); o.arc(cx, cy, 24, 0, Math.PI * 2); o.fillStyle = hub; o.fill(); o.strokeStyle = 'rgba(0,0,0,0.15)'; o.lineWidth = 2; o.stroke();
    o.font = '20px ' + cssVar('--display'); o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillText('🍻', cx, cy + 1);
    wheelImg = off;
    drawWheel();
  }
  function wheelUnderPin() {
    var n = WHEEL.length, step = Math.PI * 2 / n;
    var local = ((-Math.PI / 2 - wheelAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(local / step);
  }
  function drawWheel() {
    var cv = $('wheel'); if (!cv || !wheelImg) return;
    var ctx2 = cv.getContext('2d'), d = window.devicePixelRatio || 1, size = 280;
    ctx2.setTransform(d, 0, 0, d, 0, 0);
    ctx2.clearRect(0, 0, size, size);
    ctx2.save(); ctx2.translate(size / 2, size / 2); ctx2.rotate(wheelAngle);
    ctx2.drawImage(wheelImg, -size / 2, -size / 2, size, size); ctx2.restore();
    var idx = wheelUnderPin();
    if (idx !== wheelIdx) {
      wheelIdx = idx;
      var pin = $('wheel-pin'); if (pin && wheelVel) { pin.classList.remove('tick'); void pin.offsetWidth; pin.classList.add('tick'); buzz(6); }
    }
  }
  var wheelLast = 0;
  function wheelFrame(now) {
    var dt = Math.min(0.05, (now - wheelLast) / 1000) || 0.016; wheelLast = now;
    wheelAngle += wheelVel * dt;
    wheelVel *= Math.exp(-0.85 * dt);
    if (Math.abs(wheelVel) < 0.12) { wheelVel = 0; drawWheel(); wheelRaf = 0; landWheel(); return; }
    drawWheel();
    wheelRaf = requestAnimationFrame(wheelFrame);
  }
  function spinWheel(v) {
    if (wheelRaf) return;
    rouResult = null; renderRouletteResult(true);
    wheelVel = v; wheelLast = performance.now(); wheelRaf = requestAnimationFrame(wheelFrame);
    buzz(20);
  }
  function landWheel() {
    var name = WHEEL[wheelUnderPin()], penalty = Math.floor(Math.random() * PENALTIES.length);
    rouResult = { name: name, penalty: penalty };
    renderRouletteResult(false);
    buzz([40, 60, 80]);
    var doc = { name: name, penalty: penalty, by: me, at: new Date().toISOString() };
    roulette = doc; renderRouletteStatus();
    store.setGame('roulette', doc).catch(function () { /* local result still shows */ });
  }
  function renderRouletteResult(spinning) {
    var el = $('rou-result'), btn = $('rou-spin'); if (!el) return;
    if (spinning) { el.innerHTML = '<div class="rou-spinning">Round and round…</div>'; if (btn) btn.disabled = true; return; }
    if (btn) btn.disabled = false;
    if (!rouResult) { el.innerHTML = ''; return; }
    var pen = PENALTIES[rouResult.penalty];
    el.innerHTML = '<div class="rou-result"><div class="nm">' + esc(rouResult.name === me ? 'You' : rouResult.name) + '</div><div class="pen">' + pen[0] + ' ' + esc(pen[1]) + '<small>' + esc(pen[2]) + '</small></div></div>';
    if (btn) btn.textContent = '🍺 Spin again';
  }
  (function () {
    var cv = $('wheel'); if (!cv) return;
    buildWheel();
    $('rou-spin').addEventListener('click', function () { spinWheel(16 + Math.random() * 12); });
    function angleAt(e) { var r = cv.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); }
    cv.addEventListener('pointerdown', function (e) {
      if (wheelRaf) return;
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      wheelDrag = { a: angleAt(e), t: performance.now(), v: 0 };
    });
    cv.addEventListener('pointermove', function (e) {
      if (!wheelDrag) return;
      var a = angleAt(e), now = performance.now(), da = Math.atan2(Math.sin(a - wheelDrag.a), Math.cos(a - wheelDrag.a)), dt = Math.max(1, now - wheelDrag.t) / 1000;
      wheelAngle += da; wheelDrag.v = wheelDrag.v * 0.5 + (da / dt) * 0.5; wheelDrag.a = a; wheelDrag.t = now;
      drawWheel();
    });
    function release() {
      if (!wheelDrag) return;
      var v = wheelDrag.v; wheelDrag = null;
      if (Math.abs(v) > 2.5) spinWheel(Math.max(-30, Math.min(30, v)));
    }
    cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
    window.addEventListener('resize', function () { buildWheel(); });
  })();

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
    body.innerHTML = '<div class="hb"><div class="hb-side' + (h > c ? ' lead' : '') + '"><span class="n">' + h + '</span><small>Humans</small></div><span class="hb-vs">vs</span><div class="hb-side claude' + (c > h ? ' lead' : '') + '"><span class="n">' + c + '</span><small>Claude</small></div></div>';
  }
  function renderGolfBoard() {
    var body = $('golfboard-body'), st = $('golfboard-status'); if (!body) return;
    var by = (golfScores && golfScores.by) || {}, par = 8;
    var rows = Object.keys(by).map(function (n) { return { name: n, best: by[n].best, rounds: by[n].rounds || 0 }; })
      .sort(function (a, b) { return a.best - b.best || b.rounds - a.rounds || a.name.localeCompare(b.name); });
    st.innerHTML = 'Par ' + par + (rows.length ? ' · <b>' + esc(rows[0].name === me ? 'you lead' : rows[0].name + ' leads') + '</b>' : ' · best round');
    if (!rows.length) { body.innerHTML = '<div class="lb-empty">Nobody yet</div>'; return; }
    body.innerHTML = '<div class="lb">' + rows.slice(0, BOARD_MAX).map(function (r, i) {
      var d = r.best - par, dtxt = d === 0 ? 'E' : d > 0 ? '+' + d : String(d);
      return '<div class="lb-row' + (r.name === me ? ' me' : '') + '"><span class="rank">' + (i + 1) + '</span><span class="nm">' + esc(r.name === me ? 'You' : r.name) + '</span><span class="stat">' + r.best + '<small>' + dtxt + '</small></span></div>';
    }).join('') + '</div>' + (rows.length > BOARD_MAX ? '<div class="lb-more">+' + (rows.length - BOARD_MAX) + ' more</div>' : '');
  }

  // ---- Money: shared expenses ----
  var expenses = [], expLoaded = false, expSub = false, expSplit = null, venmo = {}, venmoSub = false;
  function subscribeVenmo() {
    if (venmoSub || !store || !store.game) return;
    venmoSub = true;
    store.game('venmo', function (doc) { venmo = doc || {}; renderVenmo(); renderMoney(); });
  }
  function cleanHandle(v) { v = String(v || '').trim().replace(/^https?:\/\/(www\.)?venmo\.com\/(u\/)?/i, '').replace(/^@+/, ''); return v ? '@' + v : ''; }
  function venmoLink(name) { var h = venmo[name]; return h ? '<a class="vm" href="https://venmo.com/u/' + encodeURIComponent(h.replace(/^@/, '')) + '" target="_blank" rel="noopener">' + esc(h) + '</a>' : ''; }
  function renderVenmo() {
    var form = $('venmo-form'), inp = $('venmo-input'); if (!form || !me) return;
    var mine = venmo[me] || '';
    if (document.activeElement !== inp) inp.value = mine;
    form.classList.toggle('missing', !mine);
    inp.placeholder = mine ? mine : '@your-handle';
  }
  $('venmo-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var h = cleanHandle($('venmo-input').value);
    var doc = Object.assign({}, venmo); if (h) doc[me] = h; else delete doc[me];
    venmo = doc; renderVenmo(); renderMoney();
    store.setGame('venmo', doc).then(function () { toast(h ? 'Saved. People can pay ' + h + '.' : 'Venmo cleared.'); $('venmo-input').blur(); })
      .catch(function (err) { toast('Couldn’t save that: ' + ((err && err.message) || err)); });
  });
  function subscribeExpenses() {
    if (expSub || !store || !store.expenses) return;
    expSub = true;
    store.expenses(function (rows) {
      expenses = rows.slice().sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? 1 : -1; });
      expLoaded = true; renderMoney();
    }, function (e) { $('expenses').innerHTML = '<p class="empty">Couldn’t load expenses (' + esc((e && e.message) || e) + ').</p>'; });
  }
  function dollars(cents) { var n = Math.round(cents) / 100; return (n < 0 ? '−' : '') + '$' + Math.abs(n).toFixed(2); }
  function expSplitOf(e) { return e.split && e.split.length ? e.split : NAMES; }
  function balances() {
    var net = {}; NAMES.forEach(function (n) { net[n] = 0; });
    expenses.forEach(function (e) {
      var amt = +e.amount || 0, sp = expSplitOf(e);
      if (net[e.paid_by] == null) net[e.paid_by] = 0;
      net[e.paid_by] += amt;
      sp.forEach(function (n) { if (net[n] == null) net[n] = 0; net[n] -= amt / sp.length; });
    });
    return net;
  }
  function settleUp(net) {
    var debt = [], cred = [];
    Object.keys(net).forEach(function (n) { var v = Math.round(net[n]); if (v < -0.5) debt.push({ n: n, v: -v }); else if (v > 0.5) cred.push({ n: n, v: v }); });
    debt.sort(function (a, b) { return b.v - a.v; }); cred.sort(function (a, b) { return b.v - a.v; });
    var out = [], i = 0, k = 0;
    while (i < debt.length && k < cred.length) {
      var pay = Math.min(debt[i].v, cred[k].v);
      if (pay >= 1) out.push({ from: debt[i].n, to: cred[k].n, amount: pay });
      debt[i].v -= pay; cred[k].v -= pay;
      if (debt[i].v < 1) i++; if (cred[k].v < 1) k++;
    }
    return out;
  }
  function renderSplitGrid() {
    var grid = $('exp-split'); if (!grid) return;
    if (!expSplit) expSplit = NAMES.slice();
    grid.innerHTML = NAMES.map(function (n) { return '<button type="button" data-split="' + esc(n) + '" aria-pressed="' + (expSplit.indexOf(n) >= 0) + '">' + esc(n === me ? 'You' : n) + '</button>'; }).join('');
    $('exp-split-n').textContent = expSplit.length === NAMES.length ? 'everyone' : expSplit.length + (expSplit.length === 1 ? ' person' : ' people');
    renderExpPreview();
  }
  function parseAmount() { var v = parseFloat(String($('exp-amount').value).replace(/[^0-9.]/g, '')); return isNaN(v) || v <= 0 ? 0 : Math.round(v * 100); }
  function renderExpPreview() {
    var el = $('exp-preview'); if (!el) return;
    var cents = parseAmount();
    el.textContent = cents && expSplit.length ? dollars(cents / expSplit.length) + ' each' : '';
  }
  function renderMoney() {
    var list = $('expenses'), sum = $('money-summary'); if (!list || !me) return;
    if (!expLoaded) { list.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var net = balances(), mine = Math.round(net[me] || 0), total = expenses.reduce(function (a, e) { return a + (+e.amount || 0); }, 0);
    var html = '';
    if (!expenses.length) { sum.innerHTML = ''; list.innerHTML = '<p class="empty">Nothing in yet. First round of groceries goes here.</p>'; return; }
    html += '<div class="money-you' + (mine < -50 ? ' owe' : '') + '"><div class="big">' + (Math.abs(mine) < 50 ? 'You’re square' : mine > 0 ? 'You’re owed ' + dollars(mine) : 'You owe ' + dollars(-mine)) + '</div><div class="sub">' + dollars(total) + ' spent so far across ' + expenses.length + (expenses.length === 1 ? ' expense' : ' expenses') + '.</div></div>';
    var pays = settleUp(net);
    html += '<div class="settle"><h3>Settle up <small>' + (pays.length ? pays.length + (pays.length === 1 ? ' payment' : ' payments') + ' and everyone’s even' : 'all even') + '</small></h3>';
    html += pays.length ? pays.map(function (p) {
      var inv = p.from === me || p.to === me;
      return '<div class="pay' + (inv ? ' me' : '') + '"><span><b>' + esc(p.from === me ? 'You' : p.from) + '</b><span class="arrow">→</span><b>' + esc(p.to === me ? 'you' : p.to) + '</b>' + (venmoLink(p.to) || '<span class="vm">no Venmo yet</span>') + '</span><span class="amt">' + dollars(p.amount) + '</span></div>';
    }).join('') : '<div class="info-sub">Nobody owes anybody.</div>';
    html += '</div>';
    sum.innerHTML = html;
    list.innerHTML = '<div class="exp-head">Everything so far <small>' + dollars(total) + '</small></div><div class="exp-list">' + expenses.map(function (e) {
      var sp = expSplitOf(e);
      return '<div class="exp"><span class="t">' + esc(e.title) + '</span><span class="amt">' + dollars(+e.amount || 0) + '</span>' +
        '<span class="sub"><span>' + esc(e.paid_by === me ? 'You' : e.paid_by) + ' paid · split ' + (sp.length === NAMES.length ? 'with everyone' : sp.length + ' ways') + ' · ' + esc(agoText(e.created_at)) + '</span>' +
        (e.paid_by === me ? '<button type="button" class="linkbtn" data-del-exp="' + esc(e.id) + '">Remove</button>' : '') + '</span></div>';
    }).join('') + '</div>';
  }
  $('exp-split').addEventListener('click', function (e) {
    var b = e.target.closest('[data-split]'); if (!b) return;
    var n = b.getAttribute('data-split');
    if (expSplit.indexOf(n) >= 0) { if (expSplit.length > 1) expSplit = expSplit.filter(function (x) { return x !== n; }); } else expSplit.push(n);
    renderSplitGrid();
  });
  $('exp-split-all').addEventListener('click', function () { expSplit = NAMES.slice(); renderSplitGrid(); });
  $('exp-amount').addEventListener('input', renderExpPreview);
  $('money-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('exp-title').value.replace(/\s+/g, ' ').trim(), cents = parseAmount();
    if (!title) { $('exp-title').focus(); return; }
    if (!cents) { $('exp-amount').focus(); toast('How much was it?'); return; }
    var row = { title: title, amount: cents, paid_by: me, split: expSplit.slice() };
    $('exp-add').disabled = true;
    store.addExpense(row).then(function (saved) {
      $('exp-title').value = ''; $('exp-amount').value = ''; expSplit = NAMES.slice(); renderSplitGrid();
      if (!expenses.some(function (x) { return x.id === saved.id; })) { expenses.unshift(saved); renderMoney(); }
      toast('In. ' + dollars(cents) + ' for ' + title + '.');
    }).catch(function (err) { toast('Didn’t save: ' + ((err && err.message) || err)); })
      .then(function () { $('exp-add').disabled = false; });
  });
  $('expenses').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del-exp]'); if (!b) return;
    var id = b.getAttribute('data-del-exp');
    expenses = expenses.filter(function (x) { return x.id !== id; }); renderMoney();
    store.removeExpense(id).catch(function (err) { toast('Couldn’t remove it: ' + ((err && err.message) || err)); });
  });

  // ---- Games: Mafia dealer ----
  var mafia = null, mafiaLoaded = false, mafiaSub = false, mafiaDraft = null, revealHold = false, modReveal = false, mafiaDealAnim = false;
  var ROLE_ICON = { mafia: '\uD83D\uDD76\uFE0F', doctor: '\uD83E\uDE7A', detective: '\uD83D\uDD0D', villager: '\uD83C\uDF3E' };
  var ROLE_INFO = {
    mafia: { title: 'Mafia', side: 'mafia', desc: 'Each night, pick someone with the other Mafia to take out. By day, act innocent.' },
    doctor: { title: 'Doctor', side: 'town', desc: 'Each night, pick one person to protect. If the Mafia pick them, they survive. You can pick yourself.' },
    detective: { title: 'Detective', side: 'town', desc: 'Each night, point at one person. The moderator tells you whether they’re Mafia.' },
    villager: { title: 'Villager', side: 'town', desc: 'You’re a regular. Find the Mafia and vote them out by day. Trust nobody.' }
  };
  function subscribeMafia() {
    if (mafiaSub || !store || !store.game) return;
    mafiaSub = true;
    store.game('mafia', function (doc) { var same = mafiaLoaded && sameDoc(doc, mafia); mafia = doc; mafiaLoaded = true; if (!same) renderMafia(); });
  }
  function mafiaDefaults() {
    var players = NAMES.filter(function (n) { return n !== me; });
    return { players: players, mafiaCount: Math.max(1, Math.round(players.length / 4)), doctor: true, detective: true, hostPlays: false };
  }
  function renderMafia() {
    var body = $('mafia-body'), status = $('mafia-status'); if (!body) return;
    if (!mafiaLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var g = mafia && mafia.status === 'dealt' ? mafia : null;
    if (!g) {
      // lobby: set up a game
      var d = mafiaDraft || (mafiaDraft = mafiaDefaults());
      status.textContent = 'No game running';
      var n = d.players.length + (d.hostPlays ? 1 : 0);
      var html = '<p class="info-sub">You’d be the moderator. Pick who’s playing, deal, and everyone sees their own role on their own phone.</p>';
      html += '<div class="name-grid">' + NAMES.map(function (nm) {
        var inGame = nm === me ? d.hostPlays : d.players.indexOf(nm) >= 0;
        return '<button type="button" data-player="' + esc(nm) + '" aria-pressed="' + inGame + '">' + esc(nm === me ? 'You' : nm) + '</button>';
      }).join('') + '</div>';
      html += '<div class="mafia-opts">' +
        '<div class="opt-row"><span>Mafia <span class="info-sub">(' + n + ' playing)</span></span><span class="stepper"><button type="button" data-step="-1">−</button><b>' + d.mafiaCount + '</b><button type="button" data-step="1">+</button></span></div>' +
        '<div class="opt-row"><span>Doctor</span><button type="button" class="toggle" data-opt="doctor" aria-pressed="' + d.doctor + '" aria-label="Doctor"></button></div>' +
        '<div class="opt-row"><span>Detective</span><button type="button" class="toggle" data-opt="detective" aria-pressed="' + d.detective + '" aria-label="Detective"></button></div>' +
        '<div class="opt-row"><span>I’m playing too <span class="info-sub">(moderator sees all roles either way)</span></span><button type="button" class="toggle" data-opt="hostPlays" aria-pressed="' + d.hostPlays + '" aria-label="Host plays"></button></div>' +
        '</div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="mafia-deal"' + (n < 4 ? ' disabled' : '') + '>\uD83C\uDCCF Deal the cards</button></div>';
      if (mafia && mafia.status === 'ended') html += '<p class="info-sub" style="margin-top:10px">Last game ended ' + esc(agoText(mafia.ended_at)) + '.</p>';
      body.innerHTML = html;
      return;
    }
    // a game is running
    var alive = g.players.filter(function (p) { return (g.dead || []).indexOf(p) < 0; });
    var mafiaAlive = alive.filter(function (p) { return g.roles[p] === 'mafia'; }).length, townAlive = alive.length - mafiaAlive;
    status.textContent = g.players.length + ' playing · dealt by ' + (g.host === me ? 'you' : g.host) + ' ' + agoText(g.dealt_at);
    var html = '';
    var myRole = g.roles[me];
    if (myRole) {
      var info = ROLE_INFO[myRole], dead = (g.dead || []).indexOf(me) >= 0;
      var mates = myRole === 'mafia' ? g.players.filter(function (p) { return p !== me && g.roles[p] === 'mafia'; }) : [];
      html += '<div class="role-card' + (revealHold ? ' revealed' : '') + (mafiaDealAnim ? ' dealin' : '') + '" id="role-card"><div class="role-inner">' +
        '<div class="role-face back"><div class="icon">\uD83C\uDCCF</div><div class="hold">Hold to flip your card</div><div class="sub">Keep your thumb on it. Lifting hides it again.</div></div>' +
        '<div class="role-face front ' + info.side + '"><div class="icon">' + ROLE_ICON[myRole] + '</div><div class="sub">You are</div><div class="role">' + esc(info.title) + '</div><div class="desc">' + esc(info.desc) + '</div>' +
        (mates.length ? '<div class="mates">Your Mafia: ' + esc(mates.join(', ')) + '</div>' : (myRole === 'mafia' ? '<div class="mates">You’re the only Mafia.</div>' : '')) + '</div></div></div>';
      if (dead) html += '<p class="info-sub" style="margin-top:8px">You’re out. No talking, no hints, no faces.</p>';
    } else if (g.host !== me) {
      html += '<p class="info-sub">You’re not in this one. ' + esc(g.host) + ' is running it.</p>';
    }
    if (g.host === me) {
      html += '<div class="cheat"><b>Moderator</b> · ' + mafiaAlive + ' Mafia and ' + townAlive + ' town still alive' +
        (mafiaAlive === 0 ? ' · <b>Town wins.</b>' : mafiaAlive >= townAlive ? ' · <b>Mafia wins.</b>' : '') + '</div>';
      html += '<div class="mafia-actions"><button type="button" class="btn" id="mod-toggle">' + (modReveal ? 'Hide roles' : 'Show all roles') + '</button><button type="button" class="btn" id="mafia-redeal">Re-deal</button><button type="button" class="btn" id="mafia-end">End game</button></div>';
      if (modReveal) {
        html += '<div class="mod-list">' + g.players.map(function (p, i) {
          var isDead = (g.dead || []).indexOf(p) >= 0;
          return '<div class="mod-row' + (isDead ? ' dead' : '') + (modRevealAnim ? ' dealin' : '') + '"' + (modRevealAnim ? ' style="animation-delay:' + (i * 45) + 'ms"' : '') + '><span>' + esc(p) + '</span><span><span class="r ' + esc(g.roles[p]) + '">' + ROLE_ICON[g.roles[p]] + ' ' + esc(ROLE_INFO[g.roles[p]].title) + '</span> <button type="button" class="btn" data-dead="' + esc(p) + '">' + (isDead ? 'Revive' : 'Out') + '</button></span></div>';
        }).join('') + '</div>';
      }
      html += '<div class="cheat"><b>Night:</b> everyone closes eyes → Mafia open, agree on a target, close → Doctor opens, points at a save, closes → Detective opens, points at someone, you nod or shake, closes.<br><b>Day:</b> announce who didn’t make it, argue, vote someone out. Repeat until the Mafia are gone or they outnumber the town.</div>';
    } else {
      html += '<div class="cheat">' + alive.length + ' of ' + g.players.length + ' still alive' + ((g.dead || []).length ? ' · out: ' + esc((g.dead || []).join(', ')) : '') + '</div>';
      html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="mafia-takeover">Take over as moderator</button></div>';
    }
    body.innerHTML = html;
    mafiaDealAnim = false; modRevealAnim = false;
  }
  var modRevealAnim = false;
  function dealMafia() {
    var d = mafiaDraft || mafiaDefaults();
    var players = d.players.slice(); if (d.hostPlays && players.indexOf(me) < 0) players.push(me);
    var n = players.length;
    if (n < 4) { toast('Need at least four players.'); return; }
    var mafiaCount = Math.max(1, Math.min(d.mafiaCount, Math.floor((n - 1) / 2)));
    var deck = [];
    for (var i = 0; i < mafiaCount; i++) deck.push('mafia');
    if (d.doctor && deck.length < n) deck.push('doctor');
    if (d.detective && deck.length < n) deck.push('detective');
    while (deck.length < n) deck.push('villager');
    for (var j = deck.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = deck[j]; deck[j] = deck[k]; deck[k] = t; }
    var roles = {}; players.forEach(function (p, idx) { roles[p] = deck[idx]; });
    var doc = { status: 'dealt', host: me, players: players, roles: roles, dead: [], dealt_at: new Date().toISOString(), mafia_count: mafiaCount };
    mafia = doc; modReveal = false; mafiaDealAnim = true; renderMafia(); buzz([20, 50, 20, 50, 20]); toast('Dealt. Everyone can check their phone.');
    store.setGame('mafia', doc).catch(function (e) { toast('Couldn’t deal: ' + ((e && e.message) || e)); });
  }
  $('mafia-body').addEventListener('click', function (e) {
    var d = mafiaDraft || (mafiaDraft = mafiaDefaults());
    var pl = e.target.closest('[data-player]');
    if (pl) {
      var nm = pl.getAttribute('data-player');
      if (nm === me) d.hostPlays = !d.hostPlays;
      else if (d.players.indexOf(nm) >= 0) d.players = d.players.filter(function (x) { return x !== nm; }); else d.players.push(nm);
      renderMafia(); return;
    }
    var st = e.target.closest('[data-step]');
    if (st) { d.mafiaCount = Math.max(1, Math.min(6, d.mafiaCount + (+st.getAttribute('data-step')))); renderMafia(); return; }
    var op = e.target.closest('[data-opt]');
    if (op) { var key = op.getAttribute('data-opt'); d[key] = !d[key]; renderMafia(); return; }
    if (e.target.closest('#mafia-deal')) { dealMafia(); return; }
    if (e.target.closest('#mafia-redeal')) { mafiaDraft = { players: mafia.players.filter(function (p) { return p !== me; }), mafiaCount: mafia.mafia_count || 3, doctor: Object.keys(mafia.roles).some(function (p) { return mafia.roles[p] === 'doctor'; }), detective: Object.keys(mafia.roles).some(function (p) { return mafia.roles[p] === 'detective'; }), hostPlays: mafia.players.indexOf(me) >= 0 }; dealMafia(); return; }
    if (e.target.closest('#mafia-end')) {
      var ended = Object.assign({}, mafia, { status: 'ended', ended_at: new Date().toISOString() });
      store.setGame('mafia', ended).then(function () { mafia = ended; mafiaDraft = null; renderMafia(); }).catch(function (err) { toast('Couldn’t end it: ' + ((err && err.message) || err)); });
      return;
    }
    if (e.target.closest('#mod-toggle')) { modReveal = !modReveal; modRevealAnim = modReveal; renderMafia(); return; }
    if (e.target.closest('#mafia-takeover')) {
      var took = Object.assign({}, mafia, { host: me });
      store.setGame('mafia', took).then(function () { mafia = took; renderMafia(); }).catch(function (err) { toast('Couldn’t take over: ' + ((err && err.message) || err)); });
      return;
    }
    var dd = e.target.closest('[data-dead]');
    if (dd) {
      var who = dd.getAttribute('data-dead'), dead = (mafia.dead || []).slice();
      if (dead.indexOf(who) >= 0) dead = dead.filter(function (x) { return x !== who; }); else dead.push(who);
      var upd = Object.assign({}, mafia, { dead: dead });
      store.setGame('mafia', upd).then(function () { mafia = upd; renderMafia(); }).catch(function (err) { toast('Couldn’t save that: ' + ((err && err.message) || err)); });
    }
  });
  // hold-to-reveal for your own role
  function holdStart(e) {
    var card = e.target.closest('#role-card'); if (!card || revealHold) return;
    revealHold = true; card.classList.add('revealed'); buzz(15); e.preventDefault();
  }
  function holdEnd() { if (!revealHold) return; revealHold = false; var card = $('role-card'); if (card) card.classList.remove('revealed'); }
  $('mafia-body').addEventListener('pointerdown', holdStart);
  window.addEventListener('pointerup', holdEnd); window.addEventListener('pointercancel', holdEnd);
  $('mafia-body').addEventListener('contextmenu', function (e) { if (e.target.closest('#role-card')) e.preventDefault(); });

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
  var votes = [], qsim = null, qIndex = 0, predSub = false, expanded = null, comments = [], draft = '', reactions = [], pickerFor = null;
  var EMOJI = ['\uD83D\uDE02', '\uD83D\uDD25', '\uD83D\uDC80', '\uD83D\uDC40', '\uD83E\uDD21'];
  function myVotes() { var m = {}; votes.forEach(function (v) { if (v.voter === me) m[v.question_id] = v.pick; }); return m; }
  function answeredCount() { var m = myVotes(); return QUESTIONS.filter(function (q) { return !!m[q.id]; }).length; }   // ignore votes for questions that no longer exist
  function firstUnanswered() { var m = myVotes(); for (var i = 0; i < QUESTIONS.length; i++) if (!m[QUESTIONS[i].id]) return i; return 0; }
  // Only ever prompt someone who has made no picks at all, and only once their votes have actually loaded.
  // Anyone with picks (even partial) changes them from the Predictions tab instead.
  var predLoaded = false, askedThisVisit = false;
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
      renderPredictions();
      if (first && !$('main').hidden && shouldAsk()) { askedThisVisit = true; openQuestionnaire(0); }
    });
    if (store.comments) store.comments(function (rows) {
      comments = rows.slice().sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? -1 : 1; });
      renderPredictions(); renderWall(); if (tab === 'chat' && !$('main').hidden) markWallSeen(); else updateChatBadge();
    });
    if (store.reactions) store.reactions(function (rows) { reactions = rows.slice(); renderPredictions(); renderWall(); });
  }
  function openQuestionnaire(index, skipIntro) {
    qIndex = Math.max(0, Math.min(QUESTIONS.length - 1, index || 0));
    $('main').hidden = true; $('nav').hidden = true; $('pick').hidden = true; $('predict').hidden = false;
    document.body.classList.add('picking');
    window.scrollTo(0, 0);
    if (skipIntro) { $('q-intro').hidden = true; $('q-wrap').hidden = false; showQuestion(false); return; }
    $('q-wrap').hidden = true; $('q-intro').hidden = false;
    $('q-intro-sub').textContent = answeredCount() ? 'You\'ve answered ' + answeredCount() + ' of ' + QUESTIONS.length + '. Pick up where you left off.' : 'Six quick calls. Everyone sees the tally and who called what, so make them good.';
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
  function renderPredictions() {
    var el = $('pred'); if (!el || !me) return;
    if (!store || !store.predictions) { el.hidden = true; return; }
    el.hidden = false;
    var mine = myVotes(), left = QUESTIONS.length - answeredCount();
    var html = '';
    if (left) html += '<div class="pred-banner"><div><b>' + (left === QUESTIONS.length ? 'You haven’t called anything yet' : left + ' still to call') + '</b><span>Takes a minute. Then you get to talk.</span></div><button type="button" class="nudge" id="pred-open">Make my picks</button></div>';
    else html += '<div class="pred-head"><span class="pred-count">All ' + QUESTIONS.length + ' called</span><button type="button" class="linkbtn" id="pred-open">Change my picks</button></div>';
    html += '<div class="pred-list">';
    QUESTIONS.forEach(function (q, i) {
      var t = tallyFor(q), lead = t.rows[0], total = t.rows.reduce(function (a, r) { return a + r.n; }, 0);
      var cc = comments.filter(function (c) { return c.question_id === q.id; }).length;
      html += '<button type="button" class="pred-card" data-q="' + i + '">' +
        '<div class="pq">' + esc(q.text) + '</div>' +
        '<div class="lead-row"><span class="lead' + (lead ? '' : ' none') + '">' + (lead ? esc(lead.pick) : 'No calls yet') + '</span>' + (lead ? '<span class="share">' + lead.n + ' <small>of ' + total + '</small></span>' : '') + '</div>';
      if (total) {
        html += '<div class="seg">' + t.rows.map(function (r, k) { return '<span style="width:' + (100 * r.n / total) + '%;background:' + SEG_COLORS[k % SEG_COLORS.length] + '"></span>'; }).join('') + '</div>';
        html += '<div class="sub">' + t.rows.slice(1, 4).map(function (r, k) { return '<span class="k"><i class="dot" style="background:' + SEG_COLORS[(k + 1) % SEG_COLORS.length] + '"></i>' + esc(r.pick) + ' ' + r.n + '</span>'; }).join('') +
          (cc ? '<span class="k">💬 ' + cc + '</span>' : '') +
          (mine[q.id] ? '<span class="you">you: ' + esc(mine[q.id]) + '</span>' : '<span class="you no">no pick yet</span>') + '</div>';
      } else {
        html += '<div class="sub">' + t.voted + ' voted' + (mine[q.id] ? '<span class="you">you: ' + esc(mine[q.id]) + '</span>' : '<span class="you no">no pick yet</span>') + '</div>';
      }
      var thread = comments.filter(function (c) { return c.question_id === q.id; }), last2 = thread.slice(-2);
      if (!thread.length) html += '<div class="pred-chat none"><span class="line"><span class="t">No trash talk yet. Start it.</span></span></div>';
      else html += '<div class="pred-chat">' + last2.map(function (c) {
        var rx = rxSummary(c.id);
        return '<span class="line"><b>' + esc(c.author === me ? 'You' : c.author) + '</b><span class="t">' + esc(c.text) + '</span>' + (rx ? '<span class="rx">' + rx + '</span>' : '') + '</span>';
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
    var n = tab === 'chat' && !$('main').hidden ? 0 : unreadWall();
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
    if ((scroll || grew) && tab === 'chat' && !$('main').hidden) window.scrollTo({ top: document.body.scrollHeight, behavior: scroll ? 'auto' : 'smooth' });
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
  function renderSheet() {
    var wrap = $('pred-sheet'); if (!wrap) return;
    if (expanded === null) { wrap.hidden = true; return; }
    var q = QUESTIONS[expanded], t = tallyFor(q), total = t.rows.reduce(function (a, r) { return a + r.n; }, 0), mine = myVotes()[q.id];
    $('sheet-title').textContent = q.text;
    var html = '<div class="poll">';
    if (!t.rows.length) html += '<div class="poll-empty">No calls yet. Be first.</div>';
    t.rows.forEach(function (r, k) {
      html += '<div class="poll-row' + (k === 0 ? ' top' : '') + '"><div class="poll-top"><span class="poll-name">' + esc(r.pick) + '</span><span class="poll-n"><b>' + r.n + '</b> · ' + Math.round(100 * r.n / total) + '%</span></div>' +
        '<div class="poll-track"><span style="width:' + Math.round(100 * r.n / total) + '%"></span></div>' +
        '<div class="poll-who">' + r.who.map(function (n) { return '<span' + (n === me ? ' class="me"' : '') + '>' + esc(n === me ? 'you' : n) + '</span>'; }).join('') + '</div></div>';
    });
    html += '</div>';
    html += '<div class="sheet-actions"><span>' + t.voted + ' of ' + NAMES.length + ' have called it' + (mine ? ' · you said <b>' + esc(mine) + '</b>' : '') + '</span><button type="button" class="' + (mine ? 'linkbtn' : 'nudge') + '" id="pred-change" data-q="' + expanded + '">' + (mine ? 'Change mine' : 'Make my call') + '</button></div>';
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
  function openSheet(i) { expanded = i; draft = ''; pickerFor = null; renderSheet(); var body = $('sheet-body'); if (body) body.scrollTop = body.scrollHeight; }
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
    var open = e.target.closest('#pred-open'); if (open) { lsDel('cabin-haul-pred-later-' + me); openQuestionnaire(firstUnanswered(), answeredCount() >= QUESTIONS.length); return; }
    var ch = e.target.closest('#pred-change'); if (ch) { var qi = +ch.getAttribute('data-q'); closeSheet(); openQuestionnaire(qi, true); return; }
    if (e.target.closest('#pred-close') || e.target.id === 'sheet-back') { closeSheet(); return; }
    var card = e.target.closest('.pred-card'); if (card) { openSheet(+card.getAttribute('data-q')); }
  }
  $('pred').addEventListener('click', predClick);
  $('pred-sheet').addEventListener('click', predClick);

  // ---- Data ----
  var store = window.STORE, booted = false, items = [], busy = {}, live = false, itemsLoaded = false;
  var view = lsGet('cabin-haul-view') || 'items';
  var mode = 'bring';

  function boot() {
    booted = true;
    subscribePredictions();
    subscribeMafia();
    subscribeTeams();
    subscribeLiv();
    subscribeSmash();
    subscribeRoulette();
    subscribeBoards();
    subscribeExpenses();
    subscribeVenmo();
    renderSplitGrid();
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
  function metaTags(it) {
    var m = it.meta, p = PANELS[it.category]; if (!m || !p) return '';
    var tags = p.order.filter(function (k) { return m[k]; }).map(function (k) { return '<span class="tag' + (k === 'grade' ? ' ' + esc(m[k]) : '') + '">' + optLabel(it.category, k, m[k]) + '</span>'; });
    return tags.length ? '<div class="tags">' + tags.join('') + '</div>' : '';
  }
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
    if (showCat) meta += ' · ' + esc(it.category);
    var canRemove = (it.adder_id && it.adder_id === myId()) || mine;
    if (canRemove) meta += '<button type="button" class="rm" data-rm="' + esc(it.id) + '">remove</button>';
    return '<div class="' + cls + '" data-id="' + esc(it.id) + '">' +
      '<span class="ico">' + (CAT_ICON[it.category] || CAT_ICON.Other) + '</span>' +
      '<div class="title">' + esc(it.name) + (it.note ? ' <span class="note">· ' + esc(it.note) + '</span>' : '') + '</div>' +
      act + '<div class="meta">' + meta + '</div>' + metaTags(it) + '</div>';
  }
  function groupHead(icon, title, k, cls) {
    return '<section class="group' + (cls ? ' ' + cls : '') + '"><div class="group-head"><span class="gico">' + icon + '</span><h2>' + esc(title) + '</h2><span class="k">' + k + '</span></div>';
  }
  function render() {
    if (!me) return;
    $('tab-items').setAttribute('aria-selected', String(view === 'items'));
    $('tab-people').setAttribute('aria-selected', String(view === 'people'));
    var needed = items.filter(function (it) { return !it.party; });
    $('tab-items').textContent = 'By item'; $('tab-people').textContent = 'By person';
    var html = '';
    if (!items.length) {
      html = itemsLoaded ? '<div class="empty">Nothing on the list yet. Add the first thing above.</div>' : '<p class="skeleton">Loading the list\u2026</p>';
    } else if (view === 'items') {
      if (needed.length) {
        html += groupHead('\uD83D\uDEA9', 'Still needed', plural(needed.length, 'item', 'items'), 'needed') + '<div class="list">';
        needed.forEach(function (it) { html += itemRow(it, true); });
        html += '</div></section>';
      }
      var cats = CATEGORIES.slice();
      items.forEach(function (it) { if (cats.indexOf(it.category) < 0) cats.push(it.category); });
      cats.forEach(function (cat) {
        var rows = items.filter(function (it) { return it.party && it.category === cat; });
        if (!rows.length) return;
        html += groupHead(CAT_ICON[cat] || CAT_ICON.Other, cat, plural(rows.length, 'item', 'items')) + '<div class="list">';
        rows.forEach(function (it) { html += itemRow(it, false); });
        html += '</div></section>';
      });
    } else {
      var parties = PARTIES.map(function (p) { return p.join(' & '); });
      items.forEach(function (it) { if (it.party && parties.indexOf(it.party) < 0) parties.push(it.party); });
      parties.sort(function (a, b) { return (b === myParty) - (a === myParty); });
      parties.forEach(function (party) {
        var rows = items.filter(function (it) { return it.party === party; });
        html += groupHead(party === myParty ? '\uD83D\uDC4B' : '\uD83C\uDFE0', party + (party === myParty ? ' (you)' : ''), plural(rows.length, 'item', 'items'));
        if (rows.length) { html += '<div class="list">'; rows.forEach(function (it) { html += itemRow(it, true); }); html += '</div>'; }
        else html += '<div class="empty">Nothing yet</div>';
        html += '</section>';
      });
      if (needed.length) {
        html += groupHead('\uD83D\uDEA9', 'Still needed', plural(needed.length, 'item', 'items'), 'needed') + '<div class="list">';
        needed.forEach(function (it) { html += itemRow(it, true); });
        html += '</div></section>';
      }
    }
    $('groups').innerHTML = html;
    updateStatus();
  }

  function updateStatus() {
    var el = $('haul-stats'); if (!el) return;
    var needed = items.filter(function (it) { return !it.party; }).length;
    var mine = items.filter(function (it) { return it.party === myParty; }).length;
    el.innerHTML = '<div class="stat"><div class="n">' + items.length + '</div><div class="l"><span class="dot' + (live ? ' live' : '') + '"></span>on the list</div></div>' +
      '<div class="stat' + (needed ? ' need' : '') + '"><div class="n">' + needed + '</div><div class="l">still needed</div></div>' +
      '<div class="stat mine"><div class="n">' + mine + '</div><div class="l">yours</div></div>';
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
    var nameEl = $('new-name'), noteEl = $('new-note');
    var name = nameEl.value.replace(/\s+/g, ' ').trim();
    var note = noteEl.value.replace(/\s+/g, ' ').trim();
    if (!name && newCat === 'Weed') {                       // strain is optional: name it from the paperwork
      var bits = [];
      if (extra.type) bits.push(optLabel('Weed', 'type', extra.type).replace(/^\S+\s/, ''));
      bits.push(extra.form ? optLabel('Weed', 'form', extra.form).replace(/^\S+\s/, '').toLowerCase() : 'weed');
      name = bits.join(' ');
      var base = name, n = 2;
      while (items.some(function (it) { return norm(it.name) === norm(name); })) name = base + ' #' + (n++);
    }
    if (!name) { nameEl.focus(); return; }
    var meta = null, panel = PANELS[newCat];
    if (panel) {
      if (newCat === 'Weed' && !extra.grade) { toast('Gas or crumbly mid? Be honest.'); return; }
      meta = {}; panel.rows(extra).forEach(function (k) { if (extra[k]) meta[k] = extra[k]; });   // only the rows that were showing
      if (!Object.keys(meta).length) meta = null;
    }
    var dup = items.filter(function (it) { return norm(it.name) === norm(name); })[0];
    if (dup) {
      if (!dup.party && mode === 'bring') { toast('"' + dup.name + '" was already needed. It\'s yours now.'); claim(dup.id); }
      else if (dup.party) toast('"' + dup.name + '" is already covered by ' + dup.party + '.');
      else toast('"' + dup.name + '" is already on the needed list.');
      nameEl.value = ''; noteEl.value = '';
      return;
    }
    var row = { name: name, note: note || null, category: newCat, added_by: me, adder_id: myId(), meta: meta,
      party: mode === 'bring' ? myParty : null, claimed_by: mode === 'bring' ? me : null };
    $('addbtn').disabled = true;
    store.add(row).then(function (saved) {
      if (!items.some(function (it) { return it.id === saved.id; })) items.push(saved);
      nameEl.value = ''; noteEl.value = ''; extra = {}; renderExtraPanel();
      render();
      toast((mode === 'bring' ? 'On the list: ' : 'Flagged: ') + name + '.');
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
    $('addbtn').textContent = mode === 'bring' ? 'Add it' : 'Flag it';
    $('new-name').placeholder = PANELS[newCat] ? PANELS[newCat].placeholder : mode === 'bring' ? 'What are you bringing?' : 'What do we still need?';
  }
  var newCat = 'Food', extra = {};
  function renderCatRow() {
    $('cat-row').innerHTML = CATEGORIES.map(function (c) {
      return '<button type="button" data-cat="' + esc(c) + '" class="' + (c === 'Weed' ? 'weed' : c === 'Booze' ? 'booze' : '') + '" aria-pressed="' + (c === newCat) + '">' + CAT_ICON[c] + ' ' + esc(c) + '</button>';
    }).join('');
  }
  function renderExtraPanel() {
    var el = $('weed-panel'), panel = PANELS[newCat]; if (!el) return;
    if (!panel) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false; el.className = 'weed ' + newCat.toLowerCase();
    el.innerHTML = '<div class="w-title">' + esc(panel.title) + ' <small>' + esc(panel.sub) + '</small></div>' + panel.rows(extra).map(function (k) {
      var g = panel.fields[k];
      return '<div class="w-row"><div class="w-l">' + esc(g.label) + (g.required && !extra[k] ? '<em>required</em>' : '') + '</div><div class="chips">' + g.opts.map(function (o) {
        return '<button type="button" data-weed="' + k + '" data-val="' + esc(o[0]) + '" class="' + (k === 'grade' ? o[0] : '') + '" aria-pressed="' + (extra[k] === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div></div>';
    }).join('');
  }
  $('cat-row').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]'); if (!b) return;
    var was = newCat; newCat = b.getAttribute('data-cat'); if (newCat !== was) extra = {};
    renderCatRow(); renderExtraPanel(); syncMode();
    if (PANELS[newCat]) buzz(15);
  });
  $('weed-panel').addEventListener('click', function (e) {
    var b = e.target.closest('[data-weed]'); if (!b) return;
    var k = b.getAttribute('data-weed'), v = b.getAttribute('data-val');
    extra[k] = extra[k] === v ? null : v;
    renderExtraPanel();
  });
  renderCatRow(); syncMode();
  $('groups').addEventListener('click', function (e) {
    var c = e.target.closest('[data-claim]'); if (c) { claim(c.getAttribute('data-claim')); return; }
    var u = e.target.closest('[data-unclaim]'); if (u) { unclaim(u.getAttribute('data-unclaim')); return; }
    var r = e.target.closest('[data-rm]'); if (r) removeItem(r.getAttribute('data-rm'));
  });
  $('tab-items').addEventListener('click', function () { view = 'items'; lsSet('cabin-haul-view', view); render(); });
  $('tab-people').addEventListener('click', function () { view = 'people'; lsSet('cabin-haul-view', view); render(); });

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
      rows.forEach(function (it) {
        var p = PANELS[it.category], m = it.meta && p ? p.order.filter(function (k) { return it.meta[k]; }).map(function (k) { return optLabel(it.category, k, it.meta[k]); }).join(', ') : '';
        lines.push('• ' + it.name + (it.note ? ' (' + it.note + ')' : '') + ' · ' + it.category + (m ? ' · ' + m : ''));
      });
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
