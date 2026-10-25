/* Cabin Haul UI. Talks to the data layer through window.STORE, which is
   provided by store-supabase.js (GitHub Pages build) or store-artifact.js
   (claude.ai prototype). Both expose the same four calls plus init(). */
(function () {
  'use strict';

  // If the script dies while wiring up, nothing draws. The usual cause is a page and a script from two different
  // deploys, which a cache can serve for a few minutes after a push. Refetch the page's files past the cache and
  // reload, no more than every 45 seconds and six times a session, so a broken deploy can never loop the phone.
  var started = false;
  window.addEventListener('error', function () {
    if (started || !/^https?:$/.test(location.protocol) || !window.fetch) return;
    var rec = { at: 0, n: 0 }; try { rec = JSON.parse(sessionStorage.getItem('cabin-haul-recover')) || rec; } catch (e) { /* ignore */ }
    if (Date.now() - rec.at < 45000 || rec.n >= 6) return;
    try { sessionStorage.setItem('cabin-haul-recover', JSON.stringify({ at: Date.now(), n: rec.n + 1 })); } catch (e) { /* ignore */ }
    var files = [location.href.split('#')[0]];
    Array.prototype.forEach.call(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'), function (el) { var u = el.getAttribute('src') || el.getAttribute('href'); if (u && !/^(https?:)?\/\//.test(u)) files.push(u); });
    Promise.all(files.map(function (f) { return fetch(f, { cache: 'reload' }).catch(function () { /* ignore */ }); })).then(function () { setTimeout(function () { location.reload(); }, 1500); });
  });

  // ---- Who's coming. Edit here; the first name in a pair is just display order. ----
  var PARTIES = [
    ['Joe', 'Katelyn'],
    ['Mitch', 'Jess'],
    ['Luke', 'Liv'],
    ['Kyle', 'Kelly'],
    ['Justin', 'Gabby'],
    ['Terry', 'Kyrsten'],
    ['Drew'],
    ['Jessie'],
    ['Conner'],
    ['Emilio'],
    ['Claire']
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
  function listen(id, ev, fn, opts) { var el = $(id); if (el) el.addEventListener(ev, fn, opts); }   // no-op when the page predates the element

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
  var NAMES = ['Mitch', 'Katelyn', 'Drew', 'Luke', 'Kelly', 'Gabby', 'Joe', 'Liv', 'Terry', 'Jess', 'Kyle', 'Kyrsten', 'Justin', 'Jessie', 'Conner', 'Emilio', 'Claire'];   // Jessie, Conner, Emilio and Claire joined on the Saturday
  PARTIES.forEach(function (p) { p.forEach(function (n) { if (NAMES.indexOf(n) < 0) NAMES.push(n); }); });

  // ---- Bubble physics on a canvas: grab, fling, collide. A quick tap picks the name.
  //      Air hockey is played from the Games tab; mini golf is the one hidden game (the word "putt"). ----
  var sim = null, scores = null, scoresSub = false, boardShown = false;
  // Air hockey is always open from the Games tab. Mini golf is hidden on the name screen; once this phone has found it,
  // its board on the Games tab becomes a play button too.
  // a phone that has played mini golf once knows about it; so does anyone whose name is already on a golf board (the flag
  // lives in local storage, which a home-screen shortcut or the prototype may not share with the browser)
  function foundGame(k) {
    if (k === 'hockey' || lsGet('cabin-haul-found-' + k) === '1') return true;
    if (k === 'golf' && me && typeof golfScores === 'object' && golfScores) return GOLF_SETS.some(function (s) { var d = golfScores[s.id]; return !!(d && d.by && d.by[me]); });
    return false;
  }
  function markFound(k) { if (foundGame(k)) return; lsSet('cabin-haul-found-' + k, '1'); renderArcadeCues(); }
  var arcadeFrom = null;   // the tab that launched a replay, so the game can hand back to it when it ends
  function playAgain(kind) {
    if (!me || !foundGame(kind) || arcadeFrom) return;
    arcadeFrom = tab; closeChat();
    $('main').hidden = true; $('nav').hidden = true; $('chat-fab').hidden = true; $('pick').hidden = false;
    renderRoster();
    if (kind === 'golf') { golfer = me; sim.startGolf(golfSetPick); } else sim.startHockey(me);
    buzz(6);
  }
  function arcadeExit() {   // a replay ended: back to the tab it came from
    var back = arcadeFrom; arcadeFrom = null;
    if (sim) sim.stop(); sim = null;
    if (!me) { showScreen(); return; }
    $('pick').hidden = true; tab = back || 'games'; showScreen();
  }
  function golfToPar(strokes, par) { var d = strokes - par; return d === 0 ? 'E' : d > 0 ? '+' + d : String(d); }
  // The three mini golf courses: nine holes each, par 27, a board apiece. The arena holds the layouts and palettes.
  var GOLF_SETS = [
    { id: 'classic', name: 'Classic', icon: '⛳', blurb: 'Grass, rails, a windmill' },
    { id: 'frost', name: 'Frostbite', icon: '❄️', blurb: 'Ice, igloos, snowmen' },
    { id: 'lava', name: 'Volcano', icon: '🌋', blurb: 'Lava, geysers, a jump' }
  ];
  function golfSet(id) { for (var i = 0; i < GOLF_SETS.length; i++) if (GOLF_SETS[i].id === id) return GOLF_SETS[i]; return GOLF_SETS[0]; }
  var golfSetPick = golfSet(lsGet('cabin-haul-golf-set')).id;   // the course the picker and the board are showing
  function pickGolfSet(id) { golfSetPick = golfSet(id).id; lsSet('cabin-haul-golf-set', golfSetPick); }
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
    }, onGolfDone: function (total, setId, secs) {
      var who = golfer; golfer = null;
      if (!who || !store || !store.recordGolf) return;
      var par = 27, d = golfToPar(total, par), set = golfSet(setId);
      if (set.id !== 'classic' && store.recordGolf.length < 3) { toast('Reload the app to post ' + set.name + ' rounds.'); return; }   // an older data layer only knows the classic board
      store.recordGolf(who, total, set.id, secs).then(function () { toast(who + ' finished ' + set.name + ' ' + (d === 'E' ? 'even' : d) + '. On the board.'); }).catch(function (err) { toast('Couldn\u2019t post that: ' + ((err && err.message) || err)); });
    }, onGolfTime: function (setId, secs, quit) {   // time on the course, banked hole by hole and when someone quits
      var who = golfer; if (quit) golfer = null;
      if (!who || !store || !store.recordGolfTime || !(secs > 0)) return;
      store.recordGolfTime(who, secs, golfSet(setId).id).catch(function () { /* the next flush carries on */ });
    } });
  }
  function golfMins(secs) { var m = Math.round((secs || 0) / 60); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; }
  // mini golf: pick a course and say who's putting before the round so the board can keep score
  var golfer = null;
  function golfSetButtons(cls) {
    return '<div class="' + cls + '" role="group" aria-label="Course">' + GOLF_SETS.map(function (s) {
      return '<button type="button" class="gs" data-golfset="' + s.id + '" aria-pressed="' + (s.id === golfSetPick) + '"><span class="gs-ic" aria-hidden="true">' + s.icon + '</span><span class="gs-nm">' + s.name + '</span></button>';
    }).join('') + '</div>';
  }
  function renderGolfPost(show) {
    var el = $('golf-post'); if (!el) return;
    if (!show) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    var set = golfSet(golfSetPick);
    el.innerHTML = '<div class="gp-card"><div class="gp-title">Who\u2019s putting?</div><div class="info-sub">Nine holes, par 27. Your best round goes on the board.</div>' +
      golfSetButtons('gp-sets') + '<div class="gp-blurb" id="gp-blurb">' + esc(set.blurb) + '</div>' +
      (foundGame('golf') ? '<div class="gp-hint">\u26F3 You\u2019ve found this one already. Pick your name, and the Mini golf board on the Games tab starts a round. No hunting.</div>' : '') +
      '<div class="name-grid">' + NAMES.map(function (n) { return '<button type="button" data-golfer="' + esc(n) + '" aria-pressed="false">' + esc(n) + '</button>'; }).join('') + '</div>' +
      '<div class="mafia-actions"><button type="button" class="linkbtn" id="golf-skip">Never mind</button></div></div>';
    $('roster').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('golf-post').addEventListener('click', function (e) {
    var s = e.target.closest('[data-golfset]');
    if (s) {
      pickGolfSet(s.getAttribute('data-golfset'));
      $('golf-post').querySelectorAll('[data-golfset]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-golfset') === golfSetPick)); });
      var bl = $('gp-blurb'); if (bl) bl.textContent = golfSet(golfSetPick).blurb;
      renderGolfBoard(); buzz(4);
      return;
    }
    var b = e.target.closest('[data-golfer]');
    if (b) {
      golfer = b.getAttribute('data-golfer'); renderGolfPost(false);
      if (sim && sim.startGolf) { sim.startGolf(golfSetPick); window.scrollTo({ top: $('roster').offsetTop - 12, behavior: 'smooth' }); toast(golfer + ' is on the tee.'); }
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
    var WALL_R = 7;   // half the thickness of the rails
    var OCT = [[0.2, 0.05], [0.8, 0.05], [0.93, 0.14], [0.93, 0.9], [0.8, 0.97], [0.2, 0.97], [0.07, 0.9], [0.07, 0.14]];
    // Layouts in fractions of the arena: an outline, open inner walls, tee, cup and slots. A round plays every layout of
    // its course once, in a random order, and fills each slot with a random obstacle from its list (null = nothing).
    // Slot extras: s scales the obstacle, dir aims boosts and jumps, to/out/back place a tunnel's far mouth and its exits.
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
    function ring(cx, cy, rx, ry, n) { var pts = []; for (var i = 0; i < n; i++) { var a = -Math.PI / 2 + i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return pts; }
    // Frostbite: a frozen pond, an igloo tunnel, snowmen, a gate of sliding floes, a jump over a crevasse
    var FROST = [
      { name: 'Frozen Pond', poly: ring(0.5, 0.51, 0.44, 0.46, 14), walls: [], tee: [0.5, 0.88], cup: [0.5, 0.17],
        slots: [{ x: 0.5, y: 0.52, kinds: ['ice'], s: 1.3 }, { x: 0.5, y: 0.31, kinds: ['bumper', 'bank', null], s: 0.6 }] },
      { name: 'Igloo', poly: OCT, walls: [[[0.07, 0.5], [0.93, 0.5]]], tee: [0.5, 0.88], cup: [0.66, 0.15],
        slots: [{ x: 0.5, y: 0.66, kinds: ['tunnel'], to: [0.3, 0.36], out: [0, -1], back: [0, 1] }, { x: 0.3, y: 0.8, kinds: ['ice', null], s: 0.6 }, { x: 0.66, y: 0.3, kinds: ['bank', 'sand', null], s: 0.5 }] },
      { name: 'Snowman Alley', poly: [[0.22, 0.04], [0.78, 0.04], [0.84, 0.1], [0.84, 0.92], [0.78, 0.98], [0.22, 0.98], [0.16, 0.92], [0.16, 0.1]], walls: [], tee: [0.5, 0.9], cup: [0.5, 0.13],
        slots: [{ x: 0.37, y: 0.66, kinds: ['bumper'] }, { x: 0.63, y: 0.5, kinds: ['bumper'] }, { x: 0.4, y: 0.33, kinds: ['bumper'] }] },
      { name: 'The Gate', poly: OCT, walls: [], tee: [0.5, 0.88], cup: [0.5, 0.14],
        slots: [{ x: 0.5, y: 0.52, kinds: ['gate'] }, { x: 0.5, y: 0.3, kinds: ['ice', 'sand', null], s: 0.7 }, { x: 0.26, y: 0.72, kinds: ['bank', null], s: 0.45 }] },
      { name: 'Hook Shot', poly: [[0.06, 0.04], [0.5, 0.04], [0.5, 0.58], [0.94, 0.58], [0.94, 0.96], [0.06, 0.96]], walls: [], tee: [0.8, 0.77], cup: [0.28, 0.14],
        slots: [{ x: 0.28, y: 0.77, kinds: ['ice'] }, { x: 0.28, y: 0.42, kinds: ['bumper', 'bank', null], s: 0.5 }] },
      { name: 'Thin Ice', poly: OCT, walls: [], tee: [0.5, 0.88], cup: [0.5, 0.14],
        slots: [{ x: 0.5, y: 0.5, kinds: ['moat'] }, { x: 0.5, y: 0.28, kinds: ['bank', 'sand', null], s: 0.6 }, { x: 0.5, y: 0.72, kinds: ['ice', null], s: 0.6 }] },
      { name: 'Avalanche', poly: [[0.06, 0.04], [0.56, 0.04], [0.94, 0.42], [0.94, 0.96], [0.44, 0.96], [0.06, 0.58]], walls: [], tee: [0.78, 0.84], cup: [0.22, 0.16],
        slots: [{ x: 0.5, y: 0.5, kinds: ['bank', 'bumper', 'ice'], s: 0.8 }, { x: 0.28, y: 0.34, kinds: ['boost', null], dir: [0, -1], s: 0.8 }] },
      { name: 'Ski Jump', poly: OCT, walls: [], tee: [0.5, 0.88], cup: [0.64, 0.15],
        slots: [{ x: 0.5, y: 0.4, kinds: ['river'], s: 0.9 }, { x: 0.5, y: 0.52, kinds: ['jump'], dir: [0, -1] }, { x: 0.76, y: 0.27, kinds: ['bumper', null] }] },
      { name: 'Bullwheel', poly: [[0.5, 0.03], [0.95, 0.5], [0.5, 0.97], [0.05, 0.5]], walls: [], tee: [0.5, 0.8], cup: [0.5, 0.2],
        slots: [{ x: 0.5, y: 0.5, kinds: ['windmill'], s: 0.75 }, { x: 0.28, y: 0.5, kinds: ['ice', null], s: 0.55 }, { x: 0.72, y: 0.5, kinds: ['bank', null], s: 0.45 }] }
    ];
    // Volcano: the hard course. No hole has an open straight line; every one asks for timing (gates, geysers, sliders,
    // spinners) or a deflection (bumpers, the cone), and lava sends you back. Par is still 27; going low means learning it.
    var LAVA = [
      { name: 'Caldera', poly: ring(0.5, 0.5, 0.45, 0.47, 10), walls: [], tee: [0.5, 0.9], cup: [0.5, 0.4],
        slots: [{ x: 0.5, y: 0.4, kinds: ['mound'] }, { x: 0.42, y: 0.64, kinds: ['bumper'] }, { x: 0.58, y: 0.64, kinds: ['bumper'] }, { x: 0.5, y: 0.78, kinds: ['geyser'], s: 0.9 }, { x: 0.3, y: 0.5, kinds: ['sand', null], s: 0.5 }] },
      { name: 'Lava River', poly: OCT, walls: [], tee: [0.5, 0.88], cup: [0.36, 0.14],
        slots: [{ x: 0.5, y: 0.4, kinds: ['river'], s: 0.9 }, { x: 0.5, y: 0.5, kinds: ['jump'], dir: [0, -1] }, { x: 0.5, y: 0.7, kinds: ['slider'], s: 0.9 }, { x: 0.26, y: 0.3, kinds: ['bumper'] }, { x: 0.74, y: 0.3, kinds: ['bumper'] }] },
      { name: 'Geyser Field', poly: [[0.16, 0.04], [0.84, 0.04], [0.9, 0.1], [0.9, 0.92], [0.84, 0.98], [0.16, 0.98], [0.1, 0.92], [0.1, 0.1]], walls: [], tee: [0.5, 0.9], cup: [0.62, 0.13],
        slots: [{ x: 0.5, y: 0.78, kinds: ['geyser'], s: 0.9, period: 2000 }, { x: 0.36, y: 0.64, kinds: ['geyser'], period: 2000 }, { x: 0.5, y: 0.47, kinds: ['block'], s: 0.9 }, { x: 0.66, y: 0.58, kinds: ['geyser'], period: 2000 }, { x: 0.36, y: 0.34, kinds: ['geyser'], period: 2000 }, { x: 0.62, y: 0.25, kinds: ['geyser'], s: 0.85, period: 2000 }] },
      { name: 'Lava Tube', poly: OCT, walls: [[[0.07, 0.5], [0.93, 0.5]]], tee: [0.3, 0.88], cup: [0.38, 0.14],
        slots: [{ x: 0.3, y: 0.66, kinds: ['tunnel'], to: [0.72, 0.34], out: [0, -1], back: [0, 1] }, { x: 0.5, y: 0.78, kinds: ['slider'], s: 0.9 }, { x: 0.66, y: 0.72, kinds: ['water', null], s: 0.7 }, { x: 0.55, y: 0.24, kinds: ['windmill'], s: 0.6 }] },
      { name: 'Magma Pinball', poly: [[0.08, 0.04], [0.92, 0.04], [0.96, 0.1], [0.96, 0.92], [0.92, 0.98], [0.08, 0.98], [0.04, 0.92], [0.04, 0.1]], walls: [], tee: [0.2, 0.9], cup: [0.8, 0.13],
        slots: [{ x: 0.5, y: 0.56, kinds: ['bumper'] }, { x: 0.3, y: 0.36, kinds: ['bumper'] }, { x: 0.7, y: 0.34, kinds: ['bumper'] }, { x: 0.28, y: 0.72, kinds: ['bumper'] }, { x: 0.66, y: 0.78, kinds: ['bumper'] }, { x: 0.5, y: 0.2, kinds: ['bumper'] }, { x: 0.8, y: 0.32, kinds: ['bumper'] }, { x: 0.5, y: 0.38, kinds: ['sand', null], s: 0.5 }] },
      { name: 'Ash Flats', poly: [[0.06, 0.04], [0.42, 0.04], [0.42, 0.58], [0.58, 0.58], [0.58, 0.04], [0.94, 0.04], [0.94, 0.96], [0.06, 0.96]], walls: [], tee: [0.76, 0.28], cup: [0.24, 0.22],
        slots: [{ x: 0.76, y: 0.5, kinds: ['mound'], s: 0.55 }, { x: 0.5, y: 0.8, kinds: ['boost'], dir: [-1, 0], s: 0.8 }, { x: 0.33, y: 0.58, kinds: ['bumper'] }, { x: 0.24, y: 0.4, kinds: ['sand', 'ice', null], s: 0.45 }] },
      { name: 'Obsidian Gate', poly: OCT, walls: [], tee: [0.5, 0.9], cup: [0.5, 0.14],
        slots: [{ x: 0.5, y: 0.62, kinds: ['gate'] }, { x: 0.5, y: 0.4, kinds: ['gate'] }, { x: 0.5, y: 0.26, kinds: ['sand', 'bumper', null], s: 0.5 }, { x: 0.76, y: 0.78, kinds: ['water', null], s: 0.45 }] },
      { name: 'Ring of Fire', poly: OCT, walls: [[[0.36, 0.4], [0.64, 0.4], [0.64, 0.6], [0.36, 0.6], [0.36, 0.4]]], islands: [[[0.36, 0.4], [0.64, 0.4], [0.64, 0.6], [0.36, 0.6]]], tee: [0.5, 0.88], cup: [0.5, 0.14],
        slots: [{ x: 0.215, y: 0.32, kinds: ['bumper'] }, { x: 0.785, y: 0.32, kinds: ['bumper'] }, { x: 0.5, y: 0.26, kinds: ['bumper'] }, { x: 0.2, y: 0.5, kinds: ['sand', 'geyser'], s: 0.55 }, { x: 0.8, y: 0.5, kinds: ['geyser', 'sand'], s: 0.55 }] },
      { name: 'Eruption', poly: [[0.44, 0.04], [0.94, 0.04], [0.94, 0.58], [0.56, 0.96], [0.06, 0.96], [0.06, 0.42]], walls: [], tee: [0.22, 0.84], cup: [0.78, 0.16],
        slots: [{ x: 0.5, y: 0.5, kinds: ['mound'], s: 0.8 }, { x: 0.64, y: 0.33, kinds: ['bumper'] }, { x: 0.7, y: 0.085, kinds: ['bumper'] }, { x: 0.76, y: 0.44, kinds: ['windmill'], s: 0.55 }, { x: 0.7, y: 0.62, kinds: ['water', 'sand', null], s: 0.55 }, { x: 0.3, y: 0.62, kinds: ['sand', 'bumper', null], s: 0.5 }] }
    ];
    // Palettes. Tiles and sand/water are [base, dark, light]; rails, blocks and windmill arms are [base, body, lit]; cup is
    // [ring, hole, deep]. tree/bloom pick the furniture in the rough; splash is the hazard note; slick is how much of the
    // green's friction the course does without (Frostbite is ice all over, so the ball runs a little further on every hole).
    var THEMES = {
      classic: { roughTile: 'grass', fairTile: 'grass', rough: ['#3f9238', '#347d2e', '#4aa442'], fair: ['#5fbd4b', '#52ab40', '#6fcb5a'], rail: ['#a63b0a', '#ee6a22', '#ff9448'], shade: 'rgba(0,40,0,0.25)', outline: '#1c3d18',
        cup: ['#2f6b2a', '#0f2a12', '#061508'], flag: '#e8403a', pole: '#f7f7f0', sand: ['#ecd49f', '#cdb074', '#d9bd83'], water: ['#2a7fb0', '#3dbcec', '#8fe4ff'], hub: ['#4a2a16', '#6b3e22', '#ffd23f'],
        tree: 'pine', bloom: ['#ff6fae', '#ffd23f', '#7ec8ff', '#ffffff'], splash: 'SPLASH! +1', plate: 'rgba(255,255,255,0.16)' },
      frost: { roughTile: 'snow', fairTile: 'ice', rough: ['#e4eef8', '#cfdeee', '#ffffff'], fair: ['#b7e0f4', '#9fd0ea', '#d9f1fc'], rail: ['#3f6a9a', '#7fb3e0', '#d6efff'], shade: 'rgba(20,50,90,0.22)', outline: '#1f3a5a',
        cup: ['#7fb3d8', '#17263d', '#0a1322'], flag: '#ff5a3c', pole: '#ffffff', sand: ['#f3f6fa', '#c6d4e3', '#dde6f0'], water: ['#0f3560', '#1d5a9a', '#7cc3ef'], hub: ['#2b3f5a', '#44608a', '#ffd23f'],
        tree: 'snowpine', bloom: ['#8fb8dc', '#b9d6ee'], splash: 'BRRR! +1', plate: 'rgba(40,100,160,0.16)', tee: 'rgba(20,50,90,0.4)', slick: 0.22 },
      lava: { roughTile: 'rock', fairTile: 'ash', rough: ['#2b2326', '#1d171a', '#3b3135'], fair: ['#5b545c', '#4d4750', '#6b646e'], rail: ['#3c0d09', '#7a1e12', '#ff7a2a'], shade: 'rgba(0,0,0,0.38)', outline: '#1a0d0a',
        cup: ['#8a3a1a', '#1a0a08', '#000000'], flag: '#ffd23f', pole: '#f7f7f0', sand: ['#8c8780', '#6f6a64', '#a39d95'], water: ['#b3300c', '#ff6a1f', '#ffd34a'], hub: ['#2a1a18', '#4a2a26', '#ff7a2a'],
        tree: 'boulder', bloom: ['#ff7a2a', '#ffd23f', '#ff3b1f'], splash: 'LAVA! +1', plate: 'rgba(255,200,120,0.18)' }
    };
    var HOLES_BY_SET = { classic: COURSES, frost: FROST, lava: LAVA };
    var GOLF_PAR = 3, GOLF_HOLES = 9;   // every layout once, par 27
    var T = THEMES.classic;             // the palette of the hole being played
    function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function startGolf(setId) {
      markFound('golf');
      setPlaying(true);
      var id = HOLES_BY_SET[setId] ? setId : 'classic';
      var order = HOLES_BY_SET[id].slice().sort(function () { return Math.random() - 0.5; }).slice(0, GOLF_HOLES);
      golf = { set: id, hole: 0, strokes: 0, total: 0, t0: performance.now(), started: performance.now(), flushed: performance.now(), msg: null, done: false, courses: order };
      loadHole();
    }
    // The rails that cross row y around x: the inner faces of the nearest wall on each side (the canvas edge if none).
    function laneEdges(g, x, y) {
      var xs = [];
      g.segs.forEach(function (sg) {
        var a = sg[0], c = sg[1]; if ((a[1] > y) === (c[1] > y)) return;
        xs.push(a[0] + (y - a[1]) * (c[0] - a[0]) / (c[1] - a[1]));
      });
      var left = -Infinity, right = Infinity;
      xs.forEach(function (v) { if (v <= x && v > left) left = v; if (v > x && v < right) right = v; });
      if (left === -Infinity) left = -WALL_R; if (right === Infinity) right = W + WALL_R;
      return [left + WALL_R, right - WALL_R];
    }
    // how far a bar centred at (x, y) can reach before the lane beside it closes: the distance to the farther rail face
    function laneRoom(g, x, y) { var e = laneEdges(g, x, y); return Math.max(x - e[0], e[1] - x); }
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
    function rectAt(x, y, w, h) { return { x: x - w / 2, y: y - h / 2, w: w, h: h }; }
    // One obstacle for a slot, sized to the arena. Bars (block, bank, slider) can never seal a lane: they leave at least
    // LANE px to the farther rail. Gates, moats and rivers run rail to rail on purpose; a gate's gap and a moat's bridge are
    // the way through, and a river is only ever placed behind a jump.
    function makeObstacle(g, sl, kind) {
      var s = sl.s || 1, x = sl.x * W, y = sl.y * H, o = { kind: kind, x: x, y: y }, LANE = 30;
      var room = kind === 'block' || kind === 'bank' || kind === 'slider' ? laneRoom(g, x, y) : 0, edges = laneEdges(g, x, y);
      if (kind === 'block' || kind === 'bank') { o.w = Math.min(0.4 * s * W, 2 * (room - LANE)); if (o.w < 24) return null; o.h = 0.045 * H; o.rect = rectAt(x, y, o.w, o.h); o.rest = kind === 'bank' ? 0.1 : 0.7; }
      else if (kind === 'slider') { o.w = Math.min(0.22 * s * W, 2 * (room - LANE)); if (o.w < 24) return null; o.h = 0.045 * H; o.travel = Math.max(0, Math.min(0.12 * s * W, room - LANE - o.w / 2, Math.min(x - edges[0], edges[1] - x) - o.w / 2 - 20)); o.period = 2400 + Math.random() * 800; o.rect = rectAt(x, y, o.w, o.h); o.vx = 0; }
      else if (kind === 'gate') {   // two floes sliding together across the whole row, a ball-and-a-bit gap between them
        o.gap = 50; o.h = 0.045 * H; o.left = edges[0]; o.right = edges[1]; o.gx = x;
        o.travel = Math.max(0, Math.min(0.2 * s * W, Math.min(x - o.left, o.right - x) - o.gap / 2 - 6)); o.period = 3800 + Math.random() * 1000; o.vx = 0;
        o.rects = [{ x: o.left, y: y - o.h / 2, w: x - o.gap / 2 - o.left, h: o.h }, { x: x + o.gap / 2, y: y - o.h / 2, w: o.right - x - o.gap / 2, h: o.h }];
      }
      else if (kind === 'sand') { o.rx = 0.17 * s * W; o.ry = 0.085 * s * W; }
      else if (kind === 'ice') { o.rx = 0.2 * s * W; o.ry = 0.11 * s * W; }
      else if (kind === 'water') { o.w = 0.3 * s * W; o.h = 0.12 * s * H; o.rect = rectAt(x, y, o.w, o.h); }
      else if (kind === 'river') { o.h = 0.09 * s * H; o.rect = { x: edges[0], y: y - o.h / 2, w: edges[1] - edges[0], h: o.h }; }
      else if (kind === 'moat') {   // water rail to rail with one bridge, wide enough for the ball and some nerve
        o.h = 0.1 * s * H; o.bw = 40; o.bridge = { x: x - o.bw / 2, y: y - o.h / 2, w: o.bw, h: o.h };
        o.rects = [{ x: edges[0], y: y - o.h / 2, w: x - o.bw / 2 - edges[0], h: o.h }, { x: x + o.bw / 2, y: y - o.h / 2, w: edges[1] - x - o.bw / 2, h: o.h }];
      }
      else if (kind === 'boost') { var d = sl.dir || [0, -1], along = 0.18 * H * s, across = 0.12 * W * s; o.dir = d; o.w = d[0] ? along : across; o.h = d[0] ? across : along; o.rect = rectAt(x, y, o.w, o.h); }
      else if (kind === 'jump') { var jd = sl.dir || [0, -1], jl = 0.11 * H * s, jw = 0.26 * W * s; o.dir = jd; o.w = jd[0] ? jl : jw; o.h = jd[0] ? jw : jl; o.rect = rectAt(x, y, o.w, o.h); o.half = jl / 2; }
      else if (kind === 'windmill') { o.arm = 0.13 * s * W; o.hub = 9; o.period = 2800 + Math.random() * 1200; o.spin = Math.random() < 0.5 ? 1 : -1; o.ang = 0; }
      else if (kind === 'bumper') { o.r = 14; o.hit = 0; }
      else if (kind === 'mound') { o.R = 0.2 * s * W; o.top = Math.max(26, 0.07 * s * W); }
      else if (kind === 'geyser') { o.r = 0.07 * s * W; o.period = (sl.period || 3200) + Math.random() * 1200; o.phase = Math.random() * 3000; o.burst = 650; o.on = false; o.k = 0; o.cycle = -1; o.popped = -1; }
      else if (kind === 'tunnel') { o.r = 16; o.to = { x: sl.to[0] * W, y: sl.to[1] * H }; o.out = sl.out || [0, -1]; o.back = sl.back || [0, 1]; o.cool = 0; }
      else return null;
      return o;
    }
    function rollObstacles(g, def, picks) {
      var obs = [];
      def.slots.forEach(function (sl, i) {
        var kind = picks && picks.length > i ? picks[i] : pickOne(sl.kinds); if (!kind) return;
        var o = makeObstacle(g, sl, kind); if (o) obs.push(o);
      });
      return obs;
    }
    // Can the ball get from the tee to the cup? A flood fill over a 6px grid with the ball's radius: rails and the full
    // sweep of bars and gates are solid, bumpers and hubs are posts, water is a wall except where a jump flies over it,
    // a gate is open wherever its gap ever is, a tunnel is a doorway. Everything else is just a slower route.
    function reachable(g) {
      var step = 6, cols = Math.ceil(W / step), rows = Math.ceil(H / step), br = g.ball.r, keep = WALL_R + br + 1;
      var solid = [], fly = [], links = [];
      function grow(rc, m) { return { x: rc.x - m, y: rc.y - m, w: rc.w + 2 * m, h: rc.h + 2 * m }; }
      g.obs.forEach(function (o) {
        if (o.kind === 'block' || o.kind === 'bank') solid.push(grow(o.rect, br + 2));
        else if (o.kind === 'slider') solid.push(grow({ x: o.x - o.w / 2 - o.travel, y: o.rect.y, w: o.w + 2 * o.travel, h: o.h }, br + 2));
        else if (o.kind === 'gate') {
          solid.push(grow({ x: o.left - 20, y: o.y - o.h / 2, w: o.x - o.travel - o.gap / 2 - o.left + 20, h: o.h }, br + 2));
          solid.push(grow({ x: o.x + o.travel + o.gap / 2, y: o.y - o.h / 2, w: o.right - o.x - o.travel - o.gap / 2 + 20, h: o.h }, br + 2));
        }
        else if (o.kind === 'water' || o.kind === 'river') solid.push(o.rect);
        else if (o.kind === 'moat') { solid.push(o.rects[0]); solid.push(o.rects[1]); }
        else if (o.kind === 'bumper') solid.push({ cx: o.x, cy: o.y, r: o.r + br + 2 });
        else if (o.kind === 'windmill') solid.push({ cx: o.x, cy: o.y, r: o.hub + br + 2 });
        else if (o.kind === 'jump') { var d = o.dir, L = 0.32 * H, rc = o.rect; fly.push(d[0] ? { x: d[0] > 0 ? rc.x + rc.w : rc.x - L, y: rc.y, w: L, h: rc.h } : { x: rc.x, y: d[1] > 0 ? rc.y + rc.h : rc.y - L, w: rc.w, h: L }); }
        else if (o.kind === 'tunnel') {
          var m = o.r + br + 4;
          links.push([o, { x: o.to.x + o.out[0] * m, y: o.to.y + o.out[1] * m }]);
          links.push([o.to, { x: o.x + o.back[0] * m, y: o.y + o.back[1] * m }]);
        }
      });
      function inside(r, x, y) { return r.r != null ? Math.hypot(x - r.cx, y - r.cy) < r.r : x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h; }
      function free(cx, cy) {
        var x = cx * step + step / 2, y = cy * step + step / 2;
        if (!inPoly(g.poly, x, y)) return false;
        for (var i = 0; i < g.segs.length; i++) if (segDist(x, y, g.segs[i][0], g.segs[i][1]) < keep) return false;
        for (var f = 0; f < fly.length; f++) if (inside(fly[f], x, y)) return true;
        for (var s = 0; s < solid.length; s++) if (inside(solid[s], x, y)) return false;
        return true;
      }
      var seen = new Uint8Array(cols * rows), q = [];
      function push(cx, cy) { if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return; var i = cy * cols + cx; if (seen[i]) return; seen[i] = 1; if (free(cx, cy)) q.push(i); }
      push(Math.floor(g.ball.x / step), Math.floor(g.ball.y / step));
      while (q.length) {
        var i = q.pop(), cx = i % cols, cy = (i - cx) / cols, x = cx * step + step / 2, y = cy * step + step / 2;
        if (Math.hypot(x - g.cup.x, y - g.cup.y) < g.cup.r + 4) return true;
        push(cx + 1, cy); push(cx - 1, cy); push(cx, cy + 1); push(cx, cy - 1);
        for (var l = 0; l < links.length; l++) if (Math.hypot(x - links[l][0].x, y - links[l][0].y) < 18) push(Math.floor(links[l][1].x / step), Math.floor(links[l][1].y / step));
      }
      return false;
    }
    function loadHole() {
      var g = golf, def = g.courses[g.hole];
      T = THEMES[g.set] || THEMES.classic;
      g.def = def; g.strokes = 0; g.sunk = null; g.msg = null; g.aim = null; g.drag = null; g.relief = null; g.splash = null; g.note = null; g.lipFlash = 0; g.landFlash = 0; g.portal = null;
      g.ball = { x: def.tee[0] * W, y: def.tee[1] * H, vx: 0, vy: 0, z: 0, vz: 0, dip: false, r: 9, ox: 0, oy: 0, scale: 1, alpha: 1 };
      g.lastPos = { x: g.ball.x, y: g.ball.y };
      g.cup = { x: def.cup[0] * W, y: def.cup[1] * H, r: 13 };
      g.poly = def.poly.map(function (p) { return [p[0] * W, p[1] * H]; });
      g.segs = [];
      for (var i = 0; i < g.poly.length; i++) g.segs.push([g.poly[i], g.poly[(i + 1) % g.poly.length]]);
      g.innerWalls = def.walls.map(function (w) { return w.map(function (p) { return [p[0] * W, p[1] * H]; }); });
      g.innerWalls.forEach(function (w) { for (var k = 0; k + 1 < w.length; k++) g.segs.push([w[k], w[k + 1]]); });
      g.islands = (def.islands || []).map(function (w) { return w.map(function (p) { return [p[0] * W, p[1] * H]; }); });
      // obstacles: roll the slots until the ball can get from tee to cup; failing that, shed them one at a time
      var picks = g.force || null, tries = 0;
      g.force = null;
      do { g.obs = rollObstacles(g, def, picks); tries++; } while (!reachable(g) && !picks && tries < 12);
      while (g.obs.length && !reachable(g)) g.obs.pop();
      g.rolls = tries;
      // trees and flowers (or snowmen and flakes, boulders and embers) in the rough
      g.trees = []; g.flowers = [];
      tries = 0;
      while (g.trees.length < 7 && tries++ < 80) {
        var tx = Math.random() * W, ty = 48 + Math.random() * (H - 48), tr = 16 + Math.random() * 8;   // never under the HUD
        if (inPoly(g.poly, tx, ty)) continue;
        if (g.segs.some(function (sg) { return segDist(tx, ty, sg[0], sg[1]) < tr + WALL_R + 4; })) continue;
        if (g.trees.some(function (t) { return Math.hypot(t.x - tx, t.y - ty) < (t.r + tr) * 1.1; })) continue;
        g.trees.push({ x: tx, y: ty, r: tr, kind: T.tree === 'snowpine' && Math.random() < 0.3 ? 'snowman' : T.tree });
      }
      tries = 0;
      while (g.flowers.length < 9 && tries++ < 80) {
        var fx = Math.random() * W, fy = 46 + Math.random() * (H - 46);
        if (inPoly(g.poly, fx, fy)) continue;
        if (g.segs.some(function (sg) { return segDist(fx, fy, sg[0], sg[1]) < 12; })) continue;
        if (g.trees.some(function (t) { return Math.hypot(t.x - fx, t.y - fy) < t.r + 10; })) continue;
        g.flowers.push({ x: fx, y: fy, c: pickOne(T.bloom) });
      }
      g.courseImg = null;
    }
    // The cup is a real pit. While the ball's centre is over it nothing holds the ball up: it starts to fall (z goes below
    // the green) and the rim it is sliding off pulls it toward the middle. Fall far enough and it is in. Reach the far rim
    // first and the ball clips the back wall of the cup: a deep clip rattles in, a shallow one pops it back onto the green
    // with a kick (the lip-out) and a blast barely dips at all and hops straight over. The green is dished a little around
    // the hole, so a slow ball that is nearly there curls in from any side. Every side of the cup behaves the same.
    var CUP_G = 0.65, CUP_DROP = 4.2, CUP_DISH = 1.8, CUP_PULL = 0.22, CUP_RIM_PULL = 0.5;   // clean drop under ~7 px/frame at the centre, rattles in to ~9.5, hops over above
    var AIR_G = 0.4, JUMP_MIN = 5, JUMP_SLOPE = 0.05, MOUND_A = 0.24, LAND_GRIP = 0.6;   // JUMP_MIN: pace at the lip that clears the river beyond; slower rolls back
    function onSlope(g, b) {   // on a mound's side or a ramp the ball keeps rolling; the stop rule must not freeze it there
      for (var i = 0; i < g.obs.length; i++) {
        var o = g.obs[i];
        if (o.kind === 'mound') { var d = Math.hypot(b.x - o.x, b.y - o.y); if (d > o.top && d < o.R) return true; }
        else if (o.kind === 'jump' && inRect(o.rect, b.x, b.y)) return true;
      }
      return false;
    }
    function golfSink(g, now) {
      var b = g.ball;
      g.sinkFrom = { x: b.x, y: b.y }; b.vx = 0; b.vy = 0; b.z = 0; b.vz = 0; b.dip = false;
      g.sunk = now; g.total += g.strokes;
      var diff = g.strokes - GOLF_PAR;
      g.msg = g.strokes === 1 ? 'HOLE IN ONE!' : diff <= -2 ? 'EAGLE!' : diff === -1 ? 'BIRDIE!' : diff === 0 ? 'PAR' : diff === 1 ? 'BOGEY' : diff === 2 ? 'DOUBLE BOGEY' : 'IN THE HOLE';
      buzz([8, 30, 8]);
    }
    function golfPhysics(dt, now) {
      var g = golf, b = g.ball;
      // obstacle motion
      g.obs.forEach(function (o) {
        if (o.kind === 'slider') { var ph = (now - g.t0) / o.period * Math.PI * 2; o.rect.x = o.x + Math.sin(ph) * o.travel - o.w / 2; o.vx = Math.cos(ph) * o.travel * Math.PI * 2 / o.period * 16.67; }
        else if (o.kind === 'gate') { var gp = (now - g.t0) / o.period * Math.PI * 2, gx = o.x + Math.sin(gp) * o.travel; o.vx = Math.cos(gp) * o.travel * Math.PI * 2 / o.period * 16.67; o.gx = gx; o.rects[0].w = Math.max(0, gx - o.gap / 2 - o.left); o.rects[1].x = gx + o.gap / 2; o.rects[1].w = Math.max(0, o.right - o.rects[1].x); }
        else if (o.kind === 'windmill') { o.ang = (now - g.t0) / o.period * Math.PI * 2 * o.spin; }
        else if (o.kind === 'geyser') { var el = now - g.t0 + o.phase, cyc = el % o.period; o.cycle = Math.floor(el / o.period); o.on = cyc < o.burst; o.k = o.on ? cyc / o.burst : 0; o.soon = !o.on && o.period - cyc < 500; }
      });
      if (g.sunk) {
        var t = Math.max(0, (now - g.sunk) / 500), e = Math.max(0, Math.min(1, (now - g.sunk) / 220));
        b.x = g.sinkFrom.x + (g.cup.x - g.sinkFrom.x) * e; b.y = g.sinkFrom.y + (g.cup.y - g.sinkFrom.y) * e;   // rolls the last inch, no snap
        b.scale = Math.max(0, 1 - t * 0.9); b.alpha = Math.max(0, 1 - t);
        if (now - g.sunk > 1700) {
          if (g.hole + 1 < g.courses.length) { if (opts.onGolfTime) opts.onGolfTime(g.set, (now - g.flushed) / 1000, false); g.flushed = now; g.hole++; loadHole(); }
          else if (!g.done) { g.done = now; g.roundSecs = (now - g.started) / 1000; if (opts.onGolfDone) opts.onGolfDone(g.total, g.set, (now - g.flushed) / 1000); g.flushed = now; }
        }
        if (g.done && now - g.done > 2600) { golf = null; }
        return;
      }
      if (g.splash) {   // in the drink (or the lava): sink, then back to where the putt was played from, one stroke penalty
        var st = (now - g.splash.t0) / 600;
        b.alpha = Math.max(0, 1 - st * 1.6); b.scale = Math.max(0.2, 1 - st * 0.8);
        if (st >= 1) { b.x = g.lastPos.x; b.y = g.lastPos.y; b.vx = 0; b.vy = 0; b.z = 0; b.vz = 0; b.alpha = 1; b.scale = 1; g.strokes++; g.splash = null; g.note = { text: T.splash, t0: now }; }
        return;
      }
      if (g.relief) {   // free relief: ease the ball clear of whatever it stopped against
        var rt = Math.min(1, (now - g.relief.t0) / 320), re = 1 - Math.pow(1 - rt, 3);
        b.x = g.relief.x0 + (g.relief.x - g.relief.x0) * re; b.y = g.relief.y0 + (g.relief.y - g.relief.y0) * re;
        if (rt >= 1) g.relief = null;
        return;
      }
      var speed = Math.hypot(b.vx, b.vy), air = b.z > 0;
      var fr = air ? 1 : speed > 6 ? 0.991 : 0.978;
      if (T.slick) fr = 1 - (1 - fr) * (1 - T.slick);   // an icy course: the same roll, with less of the green holding it back
      b.vx *= Math.pow(fr, dt); b.vy *= Math.pow(fr, dt);
      var cupD = Math.hypot(b.x - g.cup.x, b.y - g.cup.y);
      if (speed < 0.3 && !air && cupD >= g.cup.r * CUP_DISH && !onSlope(g, b)) { b.vx = 0; b.vy = 0; if (speed > 0) golfRelief(g, now); }   // in the dish it creeps on in
      // sub-step so fast putts can't tunnel through walls
      var fine = cupD < g.cup.r + 30 ? 1.5 : 4;   // finer steps at the hole, so the drop doesn't depend on where a step lands
      var steps = Math.max(1, Math.ceil(Math.max(speed, Math.abs(b.vz)) * dt / fine)), sdt = dt / steps;
      for (var si = 0; si < steps; si++) {
        b.x += b.vx * sdt; b.y += b.vy * sdt;
        if (b.z > 0) { b.vz -= AIR_G * sdt; b.z += b.vz * sdt; if (b.z <= 0) { b.z = 0; b.vz = 0; b.vx *= LAND_GRIP; b.vy *= LAND_GRIP; g.landFlash = now; buzz(3); } }
        else rollBy(b, b.vx * sdt, b.vy * sdt);
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.7; }
        if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.7; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.7; }
        if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.7; }
        for (var k = 0; k < g.segs.length; k++) capsuleHit(b, g.segs[k][0], g.segs[k][1], WALL_R, b.z > 0 ? 0.2 : 0.7, 0, 0);   // a rail hit mid-air is a thud, not a bounce
        if (b.z > 0) continue;   // in the air it clears everything but the rails
        for (var oi = 0; oi < g.obs.length; oi++) {
          var o = g.obs[oi], ddx, ddy, dd;
          if (o.kind === 'block' || o.kind === 'bank') rectHit(b, o.rect, o.rest, 0);
          else if (o.kind === 'slider') rectHit(b, o.rect, 0.7, o.vx);
          else if (o.kind === 'gate') { rectHit(b, o.rects[0], 0.7, o.vx); rectHit(b, o.rects[1], 0.7, o.vx); }
          else if (o.kind === 'windmill') {
            var om = Math.PI * 2 / o.period * 16.67 * o.spin;   // radians per frame
            for (var a = 0; a < 2; a++) {
              var th = o.ang + a * Math.PI / 2, ex = Math.cos(th) * o.arm, ey = Math.sin(th) * o.arm;
              if (capsuleHit(b, [o.x - ex, o.y - ey], [o.x + ex, o.y + ey], 5, 0.6, 0, 0)) { b.vx += -om * (b.y - o.y) * 0.8; b.vy += om * (b.x - o.x) * 0.8; }
            }
            circleHit(b, o.x, o.y, o.hub, 0.7);
          }
          else if (o.kind === 'sand') { ddx = (b.x - o.x) / o.rx; ddy = (b.y - o.y) / o.ry; if (ddx * ddx + ddy * ddy < 1) { var sf = Math.pow(0.94, sdt); b.vx *= sf; b.vy *= sf; } }
          else if (o.kind === 'ice') { ddx = (b.x - o.x) / o.rx; ddy = (b.y - o.y) / o.ry; if (ddx * ddx + ddy * ddy < 1) { var gf = Math.pow(fr, -sdt * 0.85); b.vx *= gf; b.vy *= gf; } }   // gives most of the friction back: it keeps sliding
          else if (o.kind === 'water' || o.kind === 'river') { if (inRect(o.rect, b.x, b.y)) { g.splash = { x: b.x, y: b.y, t0: now }; b.vx = 0; b.vy = 0; buzz([10, 40, 10]); return; } }
          else if (o.kind === 'moat') { if (inRect(o.rects[0], b.x, b.y) || inRect(o.rects[1], b.x, b.y)) { g.splash = { x: b.x, y: b.y, t0: now }; b.vx = 0; b.vy = 0; buzz([10, 40, 10]); return; } }
          else if (o.kind === 'boost') {
            if (inRect(o.rect, b.x, b.y)) {
              b.vx += o.dir[0] * 0.7 * sdt; b.vy += o.dir[1] * 0.7 * sdt;
              var bs = Math.hypot(b.vx, b.vy); if (bs > 20) { b.vx *= 20 / bs; b.vy *= 20 / bs; }
            }
          }
          else if (o.kind === 'jump') {   // a ramp: it climbs toward the lip and either launches off it or rolls back down
            if (inRect(o.rect, b.x, b.y)) {
              var d = o.dir, along = b.vx * d[0] + b.vy * d[1], up = (b.x - o.x) * d[0] + (b.y - o.y) * d[1];
              if (up > o.half - 6 && along > 0) {   // at the lip: fly, or (too slow to clear what's beyond) bump off it and roll back down
                if (along > JUMP_MIN) { b.vz = along * 0.75; b.z = 0.01; buzz(5); break; }
                else { b.vx -= 1.3 * along * d[0]; b.vy -= 1.3 * along * d[1]; }
              }
              else { b.vx -= d[0] * JUMP_SLOPE * sdt; b.vy -= d[1] * JUMP_SLOPE * sdt; }
            }
          }
          else if (o.kind === 'bumper') {
            if (circleHit(b, o.x, o.y, o.r, 1.0)) { ddx = b.x - o.x; ddy = b.y - o.y; dd = Math.hypot(ddx, ddy) || 1; b.vx += ddx / dd * 3; b.vy += ddy / dd * 3; var bv = Math.hypot(b.vx, b.vy); if (bv > 22) { b.vx *= 22 / bv; b.vy *= 22 / bv; } if (now - o.hit > 80) buzz(6); o.hit = now; }
          }
          else if (o.kind === 'mound') {   // a cone: the slope pushes the ball back down unless it has the legs to crest it
            ddx = b.x - o.x; ddy = b.y - o.y; dd = Math.hypot(ddx, ddy);
            if (dd > o.top && dd < o.R) { b.vx += ddx / dd * MOUND_A * sdt; b.vy += ddy / dd * MOUND_A * sdt; }
          }
          else if (o.kind === 'geyser') {   // erupts on a timer: anything on the vent gets thrown up and out
            ddx = b.x - o.x; ddy = b.y - o.y; dd = Math.hypot(ddx, ddy) || 1;
            if (o.on && dd < o.r + b.r) {
              if (o.popped !== o.cycle) { o.popped = o.cycle; b.vz = 5; b.z = 0.01; b.vx += ddx / dd * 5; b.vy += ddy / dd * 5; buzz([6, 20, 6]); break; }
              else { b.vx += ddx / dd * 0.5 * sdt; b.vy += ddy / dd * 0.5 * sdt; }
            }
          }
          else if (o.kind === 'tunnel') {   // in one mouth, out of the other, same pace and same heading
            if (now - o.cool > 500 && Math.hypot(b.vx, b.vy) > 0.5) {
              var ends = [[o, o.to, o.out], [o.to, o, o.back]];
              for (var ti = 0; ti < 2; ti++) {
                var from = ends[ti][0], to = ends[ti][1], dir = ends[ti][2];
                if (Math.hypot(b.x - from.x, b.y - from.y) < o.r + 2) {
                  // it comes out the far mouth still heading the way it went in: in from six o'clock, out at twelve; in from three, out at nine
                  var spd = Math.hypot(b.vx, b.vy), sp = Math.max(3, spd), m = o.r + b.r + 4, ux = spd ? b.vx / spd : dir[0], uy = spd ? b.vy / spd : dir[1];
                  b.x = to.x + ux * m; b.y = to.y + uy * m; b.vx = ux * sp; b.vy = uy * sp; b.z = 0; b.vz = 0; b.dip = false;
                  o.cool = now; g.portal = { x: to.x, y: to.y, t0: now }; buzz(4); break;
                }
              }
            }
          }
        }
        // the cup
        var cx = g.cup.x - b.x, cy = g.cup.y - b.y, cd = Math.hypot(cx, cy), R = g.cup.r;
        if (b.z > 0) continue;   // launched this step: it flies over the hole too
        if (cd < R) {
          b.vz -= CUP_G * sdt; b.z += b.vz * sdt; b.dip = true;
          if (cd > 0.5) { var pull = CUP_RIM_PULL * (cd / R) * sdt; b.vx += cx / cd * pull; b.vy += cy / cd * pull; }
          if (b.z < -CUP_DROP) { golfSink(g, now); return; }
        } else if (b.dip) {   // reached the far rim still dipping: it hits the back wall of the cup
          var kk = Math.min(1, -b.z / CUP_DROP);
          if (kk > 0.55) { golfSink(g, now); return; }
          b.z = 0; b.vz = 0; b.dip = false;
          var nx = -cx / cd, ny = -cy / cd, vn = b.vx * nx + b.vy * ny;
          if (vn > 0 && kk > 0.12) {
            var kick = 0.85 * (kk - 0.12) / 0.43;   // a shallow clip is a hop that barely slows it; a deep one throws most of the pace away
            b.vx -= kick * vn * nx; b.vy -= kick * vn * ny;
            var loss = 1 - 0.3 * kick; b.vx *= loss; b.vy *= loss;
            g.lipFlash = now; buzz(5);
          }
        } else if (cd < R * CUP_DISH) {   // the dish: a gentle slope all the way round
          var dp = CUP_PULL * (1 - 0.75 * (cd - R) / (R * (CUP_DISH - 1))) * sdt; b.vx += cx / cd * dp; b.vy += cy / cd * dp;
        }
      }
    }
    function inRect(rc, x, y) { return x > rc.x && x < rc.x + rc.w && y > rc.y && y < rc.y + rc.h; }
    function capsuleHit(b, a, c, rad, rest, svx, svy) {
      var dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy; if (!l2) return false;
      var t = Math.max(0, Math.min(1, ((b.x - a[0]) * dx + (b.y - a[1]) * dy) / l2));
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
      if (rc.w <= 0 || rc.h <= 0) return false;
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
    function golfRelief(g, now) {   // nudge a stopped ball clear of walls and posts so there's room to swing (never near the cup)
      var b = g.ball, gap = b.r + 18, x = b.x, y = b.y;
      if (Math.hypot(b.x - g.cup.x, b.y - g.cup.y) < g.cup.r * CUP_DISH + 6) return;
      for (var it = 0; it < 3; it++) {
        g.segs.forEach(function (sg) {
          var a = sg[0], c = sg[1], dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
          var cx = a[0] + dx * t, cy = a[1] + dy * t, ex = x - cx, ey = y - cy, d = Math.hypot(ex, ey), min = WALL_R + gap;
          if (d >= min || d < 0.001) return;
          x = cx + ex / d * min; y = cy + ey / d * min;
        });
        g.obs.forEach(function (o) {
          var rects = o.kind === 'block' || o.kind === 'bank' || o.kind === 'slider' ? [o.rect] : o.kind === 'gate' ? o.rects : null;
          if (rects) rects.forEach(function (rc) {
            if (rc.w <= 0) return;
            var cx = Math.max(rc.x, Math.min(rc.x + rc.w, x)), cy = Math.max(rc.y, Math.min(rc.y + rc.h, y));
            var dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
            if (d >= gap) return;
            if (d < 0.001) { dx = 0; dy = y < rc.y + rc.h / 2 ? -1 : 1; d = 1; }
            x = cx + dx / d * gap; y = cy + dy / d * gap;
          });
          else if (o.kind === 'windmill' || o.kind === 'bumper') {
            var ddx = x - o.x, ddy = y - o.y, dd = Math.hypot(ddx, ddy) || 0.01, mn = (o.kind === 'windmill' ? o.hub : o.r) + gap;
            if (dd < mn) { x = o.x + ddx / dd * mn; y = o.y + ddy / dd * mn; }
          }
        });
      }
      if (Math.hypot(x - b.x, y - b.y) < 1) return;
      if (!inPoly(g.poly, x, y) || Math.hypot(x - g.cup.x, y - g.cup.y) < g.cup.r * CUP_DISH + 6) return;
      for (var oi = 0; oi < g.obs.length; oi++) {
        var ob = g.obs[oi], rects = ob.kind === 'water' || ob.kind === 'river' ? [ob.rect] : ob.kind === 'moat' ? ob.rects : null;
        if (rects && rects.some(function (rc) { return inRect(rc, x, y); })) return;
        if (ob.kind === 'tunnel' && (Math.hypot(x - ob.x, y - ob.y) < ob.r + 12 || Math.hypot(x - ob.to.x, y - ob.to.y) < ob.r + 12)) return;
      }
      g.relief = { x0: b.x, y0: b.y, x: x, y: y, t0: now }; g.reliefFlash = now;
    }
    function golfCanPutt(g) { return g && !g.sunk && !g.relief && !g.splash && g.ball.z <= 0 && !g.ball.dip && Math.hypot(g.ball.vx, g.ball.vy) < 1; }
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
    function grassTile(cols, kind) {   // grass and snow are speckled, ash is grittier, ice has a sheen and hairline cracks
      var key = cols.join('') + kind;
      if (grassTiles[key]) return grassTiles[key];
      var t = document.createElement('canvas'), ts = 48; t.width = ts * 2; t.height = ts * 2;
      var o = t.getContext('2d'); o.setTransform(2, 0, 0, 2, 0, 0);
      o.fillStyle = cols[0]; o.fillRect(0, 0, ts, ts);
      var n = kind === 'ice' ? 24 : kind === 'ash' || kind === 'rock' ? 120 : 90, i;
      for (i = 0; i < n; i++) {
        o.fillStyle = i % 3 ? cols[1] : cols[2]; o.globalAlpha = (kind === 'ice' ? 0.18 : 0.28) + Math.random() * 0.25;
        o.beginPath(); o.arc(Math.random() * ts, Math.random() * ts, (kind === 'rock' ? 0.8 : 0.6) + Math.random() * 1.1, 0, Math.PI * 2); o.fill();
      }
      if (kind === 'ice') {
        o.globalAlpha = 0.35; o.strokeStyle = cols[2]; o.lineWidth = 2; o.lineCap = 'round';
        for (i = 0; i < 3; i++) { var sx = Math.random() * ts, sy = Math.random() * ts; o.beginPath(); o.moveTo(sx, sy); o.lineTo(sx + 10 + Math.random() * 12, sy - 8 - Math.random() * 8); o.stroke(); }
        o.globalAlpha = 0.22; o.strokeStyle = cols[1]; o.lineWidth = 0.8;
        var cx0 = Math.random() * ts, cy0 = Math.random() * ts; o.beginPath(); o.moveTo(cx0, cy0); o.lineTo(cx0 + 8, cy0 + 5); o.lineTo(cx0 + 10, cy0 + 14); o.stroke();
      }
      o.globalAlpha = 1;
      grassTiles[key] = t; return t;
    }
    function railStroke(o, pathFn, width) {   // a chunky rail with a dark base and a lit top edge
      o.lineJoin = 'round'; o.lineCap = 'round';
      o.save(); o.translate(0, 5); o.strokeStyle = T.rail[0]; o.lineWidth = width; pathFn(); o.stroke(); o.restore();
      o.strokeStyle = T.rail[1]; o.lineWidth = width; pathFn(); o.stroke();
      o.save(); o.translate(0, -2); o.strokeStyle = T.rail[2]; o.lineWidth = Math.max(2, width - 7); pathFn(); o.stroke(); o.restore();
    }
    function rr(o, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); o.beginPath(); o.moveTo(x + r, y); o.arcTo(x + w, y, x + w, y + h, r); o.arcTo(x + w, y + h, x, y + h, r); o.arcTo(x, y + h, x, y, r); o.arcTo(x, y, x + w, y, r); o.closePath(); }
    function railBlock(o, rc) {
      if (rc.w <= 0 || rc.h <= 0) return;
      o.fillStyle = T.shade; rr(o, rc.x + 3, rc.y + 8, rc.w, rc.h, 6); o.fill();
      o.fillStyle = T.rail[0]; rr(o, rc.x, rc.y + 5, rc.w, rc.h, 6); o.fill();
      o.fillStyle = T.rail[1]; rr(o, rc.x, rc.y, rc.w, rc.h, 6); o.fill();
      if (rc.w > 10) { o.fillStyle = T.rail[2]; rr(o, rc.x + 4, rc.y + 3, rc.w - 8, Math.max(3, rc.h * 0.3), 3); o.fill(); }
    }
    function snowBank(o, rc) {   // a soft drift: a puffy white mound with a cold shadow
      o.fillStyle = T.shade; rr(o, rc.x + 2, rc.y + 7, rc.w, rc.h, rc.h / 2); o.fill();
      o.fillStyle = '#c9d9ea'; rr(o, rc.x, rc.y + 3, rc.w, rc.h, rc.h / 2); o.fill();
      o.fillStyle = '#ffffff'; rr(o, rc.x, rc.y, rc.w, rc.h, rc.h / 2); o.fill();
      o.fillStyle = '#e4eef8';
      var nd = Math.max(1, Math.floor((rc.w - 16) / 22)), x0 = rc.x + rc.w / 2 - (nd - 1) * 11;
      for (var i = 0; i < nd; i++) { o.beginPath(); o.arc(x0 + i * 22, rc.y + rc.h * 0.6, 5, 0, Math.PI * 2); o.fill(); }
    }
    function drawTree(o, x, y, r, kind) {
      o.fillStyle = T.shade; o.beginPath(); o.ellipse(x + r * 0.45, y + r * 0.5, r * 1.1, r * 0.55, 0, 0, Math.PI * 2); o.fill();
      if (kind === 'boulder') {   // a dark rock with a lit edge
        o.fillStyle = '#17120f'; o.beginPath(); o.ellipse(x, y + 4, r, r * 0.8, 0, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#3d3237'; o.beginPath(); o.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#5a4c52'; o.beginPath(); o.ellipse(x - r * 0.25, y - r * 0.3, r * 0.45, r * 0.3, -0.5, 0, Math.PI * 2); o.fill();
        return;
      }
      if (kind === 'snowman') {   // seen from above: a wide base, a head, a hat and a carrot
        o.fillStyle = '#d9e6f2'; o.beginPath(); o.arc(x, y + 3, r * 0.85, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#ffffff'; o.beginPath(); o.arc(x, y, r * 0.85, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#f3f7fb'; o.beginPath(); o.arc(x, y - 2, r * 0.5, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#1b1f2a'; o.beginPath(); o.arc(x, y - 2, r * 0.24, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#ff8a2a'; o.beginPath(); o.moveTo(x + r * 0.2, y - 2); o.lineTo(x + r * 0.62, y + 1); o.lineTo(x + r * 0.2, y + 3); o.closePath(); o.fill();
        return;
      }
      var snowy = kind === 'snowpine', layers = [[0, 1], [-0.55, 0.8], [-1.0, 0.58]];
      layers.forEach(function (L) {
        var ly = y + L[0] * r, lr = L[1] * r;
        o.fillStyle = snowy ? '#1f4f5a' : '#2b9a2a'; o.beginPath(); o.arc(x, ly + 4, lr, 0, Math.PI * 2); o.fill();
        o.fillStyle = snowy ? '#2f7a7a' : '#45cf3c'; o.beginPath(); o.arc(x, ly, lr, 0, Math.PI * 2); o.fill();
        o.fillStyle = snowy ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.22)'; o.beginPath(); o.arc(x - lr * 0.3, ly - lr * 0.35, lr * (snowy ? 0.42 : 0.35), 0, Math.PI * 2); o.fill();
      });
    }
    function drawFlower(o, x, y, c) {
      if (T.tree === 'snowpine') {   // a snowflake
        o.strokeStyle = c; o.lineWidth = 1.5; o.lineCap = 'round';
        for (var i = 0; i < 3; i++) { var a = i / 3 * Math.PI; o.beginPath(); o.moveTo(x - Math.cos(a) * 4, y - Math.sin(a) * 4); o.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); o.stroke(); }
        return;
      }
      if (T.tree === 'boulder') {   // an ember glowing in a crack
        o.fillStyle = 'rgba(255,120,40,0.35)'; o.beginPath(); o.arc(x, y, 6, 0, Math.PI * 2); o.fill();
        o.fillStyle = c; o.beginPath(); o.arc(x, y, 2.4, 0, Math.PI * 2); o.fill();
        return;
      }
      for (var j = 0; j < 5; j++) { var b = j / 5 * Math.PI * 2; o.fillStyle = c; o.beginPath(); o.arc(x + Math.cos(b) * 3.6, y + Math.sin(b) * 3.6, 2.6, 0, Math.PI * 2); o.fill(); }
      o.fillStyle = c === '#ffd23f' ? '#fff' : '#ffd23f'; o.beginPath(); o.arc(x, y, 2.2, 0, Math.PI * 2); o.fill();
    }
    function drawWater(o, rc, r) {
      if (rc.w <= 0 || rc.h <= 0) return;
      o.fillStyle = T.water[0]; rr(o, rc.x, rc.y + 4, rc.w, rc.h, r); o.fill();
      o.fillStyle = T.water[1]; rr(o, rc.x, rc.y, rc.w, rc.h, r); o.fill();
      o.strokeStyle = T.water[2]; o.lineWidth = 2.5; o.lineCap = 'round';
      var n = Math.max(2, Math.round(rc.w / 70));
      for (var wv = 0; wv < n; wv++) {
        var wx = rc.x + 14 + Math.random() * Math.max(1, rc.w - 50), wy = rc.y + 10 + Math.random() * Math.max(1, rc.h - 20);
        o.beginPath(); o.moveTo(wx, wy); o.quadraticCurveTo(wx + 9, wy - 5, wx + 18, wy); o.quadraticCurveTo(wx + 27, wy + 5, wx + 36, wy); o.stroke();
      }
      if (T.tree === 'boulder') {   // lava: a crust of dark plates floating on the glow
        o.fillStyle = 'rgba(60,10,5,0.55)';
        for (var p = 0; p < Math.max(2, rc.w * rc.h / 2600); p++) { o.beginPath(); o.ellipse(rc.x + 10 + Math.random() * Math.max(1, rc.w - 20), rc.y + 8 + Math.random() * Math.max(1, rc.h - 16), 7 + Math.random() * 9, 4 + Math.random() * 4, Math.random(), 0, Math.PI * 2); o.fill(); }
      }
    }
    function drawSand(o, x, y, rx, ry) {
      o.fillStyle = T.shade; o.beginPath(); o.ellipse(x + 2, y + 4, rx, ry, 0, 0, Math.PI * 2); o.fill();
      o.fillStyle = T.sand[0]; o.beginPath(); o.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); o.fill();
      o.strokeStyle = T.sand[1]; o.lineWidth = 3; o.stroke();
      o.fillStyle = T.sand[2];
      for (var i = 0; i < 26; i++) { var a = Math.random() * Math.PI * 2, rd = Math.sqrt(Math.random()) * 0.85; o.beginPath(); o.arc(x + Math.cos(a) * rd * rx, y + Math.sin(a) * rd * ry, 1.3, 0, Math.PI * 2); o.fill(); }
    }
    function drawIce(o, x, y, rx, ry) {   // a glassy patch: pale, a sheen, a couple of hairline cracks
      o.fillStyle = 'rgba(20,50,90,0.14)'; o.beginPath(); o.ellipse(x + 2, y + 3, rx, ry, 0, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#dff5ff'; o.beginPath(); o.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); o.fill();
      o.strokeStyle = 'rgba(255,255,255,0.9)'; o.lineWidth = 2.5; o.stroke();
      o.strokeStyle = 'rgba(255,255,255,0.75)'; o.lineWidth = 3; o.lineCap = 'round';
      o.beginPath(); o.moveTo(x - rx * 0.5, y - ry * 0.2); o.lineTo(x - rx * 0.15, y - ry * 0.55); o.stroke();
      o.beginPath(); o.moveTo(x + rx * 0.1, y + ry * 0.45); o.lineTo(x + rx * 0.5, y + ry * 0.1); o.stroke();
      o.strokeStyle = 'rgba(60,110,160,0.45)'; o.lineWidth = 1;
      o.beginPath(); o.moveTo(x - rx * 0.3, y + ry * 0.3); o.lineTo(x, y + ry * 0.05); o.lineTo(x + rx * 0.25, y + ry * 0.2); o.lineTo(x + rx * 0.4, y - ry * 0.2); o.stroke();
    }
    function drawBridge(o, rc) {
      if (T.tree === 'boulder') {   // a basalt slab
        o.fillStyle = '#1d1517'; rr(o, rc.x - 4, rc.y - 4, rc.w + 8, rc.h + 8, 6); o.fill();
        o.fillStyle = '#4a4249'; rr(o, rc.x - 4, rc.y - 6, rc.w + 8, rc.h + 8, 6); o.fill();
        o.strokeStyle = '#2a2326'; o.lineWidth = 1.5; o.beginPath(); o.moveTo(rc.x + 6, rc.y + 8); o.lineTo(rc.x + rc.w - 8, rc.y + rc.h * 0.45); o.lineTo(rc.x + 10, rc.y + rc.h - 8); o.stroke();
      } else {   // an ice floe wedged across the gap
        o.fillStyle = 'rgba(20,50,90,0.3)'; rr(o, rc.x - 4, rc.y - 2, rc.w + 8, rc.h + 8, 8); o.fill();
        o.fillStyle = '#eaf6ff'; rr(o, rc.x - 4, rc.y - 6, rc.w + 8, rc.h + 8, 8); o.fill();
        o.strokeStyle = '#9fd0ea'; o.lineWidth = 2; o.stroke();
      }
    }
    function drawMound(o, ob) {   // a cone of rings, lit from the top left, with a glowing crater
      var g = o.createRadialGradient(ob.x - ob.R * 0.2, ob.y - ob.R * 0.25, ob.top * 0.6, ob.x, ob.y, ob.R);
      g.addColorStop(0, '#8d7f88'); g.addColorStop(0.7, '#5b545c'); g.addColorStop(1, '#3a3338');
      o.fillStyle = T.shade; o.beginPath(); o.arc(ob.x + 4, ob.y + 7, ob.R, 0, Math.PI * 2); o.fill();
      o.fillStyle = g; o.beginPath(); o.arc(ob.x, ob.y, ob.R, 0, Math.PI * 2); o.fill();
      o.strokeStyle = 'rgba(0,0,0,0.18)'; o.lineWidth = 1.5;
      for (var i = 1; i < 4; i++) { o.beginPath(); o.arc(ob.x, ob.y, ob.top + (ob.R - ob.top) * i / 4, 0, Math.PI * 2); o.stroke(); }
      o.fillStyle = 'rgba(255,110,40,0.55)'; o.beginPath(); o.arc(ob.x, ob.y, ob.top + 5, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#2a1a18'; o.beginPath(); o.arc(ob.x, ob.y, ob.top, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#4a3a38'; o.beginPath(); o.arc(ob.x, ob.y, ob.top - 3, 0, Math.PI * 2); o.fill();
    }
    function drawVent(o, ob) {   // a geyser's mouth: a cracked ring of rock around a dark throat
      o.fillStyle = T.shade; o.beginPath(); o.arc(ob.x + 3, ob.y + 5, ob.r + 6, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#6b5f66'; o.beginPath(); o.arc(ob.x, ob.y, ob.r + 6, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#3a2f34'; o.beginPath(); o.arc(ob.x, ob.y, ob.r, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#1a1215'; o.beginPath(); o.arc(ob.x, ob.y + 2, ob.r - 5, 0, Math.PI * 2); o.fill();
      o.strokeStyle = 'rgba(255,140,60,0.5)'; o.lineWidth = 1.5;
      for (var i = 0; i < 5; i++) { var a = i / 5 * Math.PI * 2 + 0.4; o.beginPath(); o.moveTo(ob.x + Math.cos(a) * (ob.r + 2), ob.y + Math.sin(a) * (ob.r + 2)); o.lineTo(ob.x + Math.cos(a + 0.3) * (ob.r + 12), ob.y + Math.sin(a + 0.3) * (ob.r + 12)); o.stroke(); }
    }
    function drawBumperBase(o, ob) {
      if (T.tree === 'boulder') {   // a magma bumper: a dark ring with a lit core
        o.fillStyle = T.shade; o.beginPath(); o.arc(ob.x + 3, ob.y + 5, ob.r + 3, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#2a1a18'; o.beginPath(); o.arc(ob.x, ob.y, ob.r + 3, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#ff6a1f'; o.beginPath(); o.arc(ob.x, ob.y, ob.r - 2, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#ffd34a'; o.beginPath(); o.arc(ob.x - 2, ob.y - 3, ob.r * 0.4, 0, Math.PI * 2); o.fill();
      } else {   // a snowman, seen from above
        drawTree(o, ob.x, ob.y, ob.r + 3, 'snowman');
      }
    }
    function drawMouth(o, x, y, r, face) {   // a tunnel mouth: an igloo with its doorway toward `face`, or a lava tube
      var a = Math.atan2(face[1], face[0]);
      if (T.tree === 'boulder') {
        o.fillStyle = T.shade; o.beginPath(); o.arc(x + 3, y + 5, r + 7, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#3a2f34'; o.beginPath(); o.arc(x, y, r + 7, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#ff7a2a'; o.beginPath(); o.arc(x, y, r + 2, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#0a0607'; o.beginPath(); o.arc(x, y, r - 2, 0, Math.PI * 2); o.fill();
        return;
      }
      o.fillStyle = T.shade; o.beginPath(); o.arc(x + 3, y + 6, r + 10, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#dbe8f4'; o.beginPath(); o.arc(x, y + 3, r + 10, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#ffffff'; o.beginPath(); o.arc(x, y, r + 10, 0, Math.PI * 2); o.fill();
      o.strokeStyle = 'rgba(120,160,200,0.5)'; o.lineWidth = 1;
      for (var i = 1; i < 3; i++) { o.beginPath(); o.arc(x, y, (r + 10) * i / 3, 0, Math.PI * 2); o.stroke(); }
      o.fillStyle = '#17263d'; o.beginPath(); o.arc(x, y, r - 1, a - 1.05, a + 1.05); o.lineTo(x, y); o.closePath(); o.fill();
      o.fillStyle = '#0a1322'; o.beginPath(); o.arc(x, y, r - 6, a - 0.9, a + 0.9); o.lineTo(x, y); o.closePath(); o.fill();
    }
    function drawRamp(o, ob) {   // a ramp rising toward its lip, with a chevron pointing the way
      var rc = ob.rect, d = ob.dir, lit = T.tree === 'boulder' ? ['#1d1517', '#4a4249', '#ffd23f'] : ['#3f6a9a', '#7fb3e0', '#ffffff'];
      o.fillStyle = T.shade; rr(o, rc.x + 3, rc.y + 7, rc.w, rc.h, 6); o.fill();
      o.fillStyle = lit[0]; rr(o, rc.x, rc.y + 5, rc.w, rc.h, 6); o.fill();
      var gx = o.createLinearGradient(rc.x + (d[0] < 0 ? rc.w : 0), rc.y + (d[1] < 0 ? rc.h : 0), rc.x + (d[0] > 0 ? rc.w : 0), rc.y + (d[1] > 0 ? rc.h : 0));
      gx.addColorStop(0, lit[0]); gx.addColorStop(1, lit[1]);
      o.fillStyle = gx; rr(o, rc.x, rc.y, rc.w, rc.h, 6); o.fill();
      // the lip
      o.fillStyle = lit[2]; var lw = 5;
      if (d[1] < 0) o.fillRect(rc.x + 4, rc.y, rc.w - 8, lw); else if (d[1] > 0) o.fillRect(rc.x + 4, rc.y + rc.h - lw, rc.w - 8, lw); else if (d[0] > 0) o.fillRect(rc.x + rc.w - lw, rc.y + 4, lw, rc.h - 8); else o.fillRect(rc.x, rc.y + 4, lw, rc.h - 8);
      // the chevron
      var cx = rc.x + rc.w / 2, cy = rc.y + rc.h / 2;
      o.strokeStyle = 'rgba(255,255,255,0.85)'; o.lineWidth = 3.5; o.lineCap = 'round'; o.lineJoin = 'round';
      o.beginPath(); o.moveTo(cx - d[1] * 10 - d[0] * 8, cy + d[0] * 10 - d[1] * 8); o.lineTo(cx + d[0] * 6, cy + d[1] * 6); o.lineTo(cx + d[1] * 10 - d[0] * 8, cy - d[0] * 10 - d[1] * 8); o.stroke();
    }
    function buildCourseImage(g) {
      var off = document.createElement('canvas'); off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      function polyPath(pts, close) { o.beginPath(); pts.forEach(function (p, i) { if (i) o.lineTo(p[0], p[1]); else o.moveTo(p[0], p[1]); }); if (close) o.closePath(); }
      // rough, then the fairway
      var rough = o.createPattern(grassTile(T.rough, T.roughTile), 'repeat'); o.fillStyle = rough; o.fillRect(0, 0, W, H);
      if (T.tree === 'boulder') {   // glowing cracks in the rock
        o.lineCap = 'round';
        for (var ck = 0; ck < 14; ck++) {
          var kx = Math.random() * W, ky = 50 + Math.random() * (H - 50);
          if (inPoly(g.poly, kx, ky)) continue;
          o.strokeStyle = 'rgba(255,90,20,0.55)'; o.lineWidth = 2.5; o.beginPath(); o.moveTo(kx, ky);
          for (var sg = 0; sg < 3; sg++) { kx += (Math.random() - 0.5) * 30; ky += (Math.random() - 0.5) * 30; o.lineTo(kx, ky); }
          o.stroke(); o.strokeStyle = '#ffd34a'; o.lineWidth = 0.8; o.stroke();
        }
      }
      var fair = o.createPattern(grassTile(T.fair, T.fairTile), 'repeat');
      polyPath(g.poly, true); o.fillStyle = fair; o.fill();
      g.islands.forEach(function (isl) { polyPath(isl, true); o.fillStyle = rough; o.fill(); if (T.tree === 'boulder') { var b = isl.reduce(function (a, p) { return { x0: Math.min(a.x0, p[0]), y0: Math.min(a.y0, p[1]), x1: Math.max(a.x1, p[0]), y1: Math.max(a.y1, p[1]) }; }, { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }); drawWater(o, { x: b.x0 + 10, y: b.y0 + 10, w: b.x1 - b.x0 - 20, h: b.y1 - b.y0 - 20 }, 10); } });
      // static obstacles
      g.obs.forEach(function (ob) {
        if (ob.kind === 'sand') drawSand(o, ob.x, ob.y, ob.rx, ob.ry);
        else if (ob.kind === 'ice') drawIce(o, ob.x, ob.y, ob.rx, ob.ry);
        else if (ob.kind === 'water' || ob.kind === 'river') drawWater(o, ob.rect, ob.kind === 'river' ? 4 : 12);
        else if (ob.kind === 'moat') { drawWater(o, ob.rects[0], 4); drawWater(o, ob.rects[1], 4); drawBridge(o, ob.bridge); }
        else if (ob.kind === 'boost') { o.fillStyle = T.plate; rr(o, ob.rect.x, ob.rect.y, ob.rect.w, ob.rect.h, 6); o.fill(); o.strokeStyle = 'rgba(255,255,255,0.3)'; o.lineWidth = 2; o.stroke(); }
        else if (ob.kind === 'jump') drawRamp(o, ob);
        else if (ob.kind === 'block') railBlock(o, ob.rect);
        else if (ob.kind === 'bank') snowBank(o, ob.rect);
        else if (ob.kind === 'mound') drawMound(o, ob);
        else if (ob.kind === 'geyser') drawVent(o, ob);
        else if (ob.kind === 'bumper') drawBumperBase(o, ob);
        else if (ob.kind === 'tunnel') { drawMouth(o, ob.x, ob.y, ob.r, ob.back); drawMouth(o, ob.to.x, ob.to.y, ob.r, ob.out); }
      });
      // walls
      railStroke(o, function () { polyPath(g.poly, true); }, WALL_R * 2);
      g.innerWalls.forEach(function (w) { railStroke(o, function () { polyPath(w, false); }, WALL_R * 2); });
      // cup and flag (the stick is paint: nothing collides with it)
      o.fillStyle = T.cup[0]; o.beginPath(); o.arc(g.cup.x, g.cup.y, g.cup.r + 4, 0, Math.PI * 2); o.fill();
      o.fillStyle = T.cup[1]; o.beginPath(); o.arc(g.cup.x, g.cup.y, g.cup.r, 0, Math.PI * 2); o.fill();
      o.fillStyle = T.cup[2]; o.beginPath(); o.arc(g.cup.x, g.cup.y + 1, g.cup.r - 3, 0, Math.PI * 2); o.fill();
      var px = g.cup.x, py = g.cup.y;
      o.strokeStyle = 'rgba(0,0,0,0.25)'; o.lineWidth = 3; o.lineCap = 'round'; o.beginPath(); o.moveTo(px + 2, py + 2); o.lineTo(px + 2, py - 46); o.stroke();
      o.strokeStyle = T.pole; o.beginPath(); o.moveTo(px, py); o.lineTo(px, py - 48); o.stroke();
      o.fillStyle = T.flag; o.beginPath(); o.moveTo(px + 1, py - 48); o.lineTo(px + 30, py - 39); o.lineTo(px + 1, py - 30); o.closePath(); o.fill();
      o.fillStyle = T.flag === '#ffd23f' ? '#1a0d0a' : '#fff'; o.font = '800 10px ' + fontFamily; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillText(String(g.hole + 1), px + 12, py - 39);
      // tee marker
      o.fillStyle = T.tee || 'rgba(255,255,255,0.45)'; o.beginPath(); o.arc(g.def.tee[0] * W, g.def.tee[1] * H, 3.5, 0, Math.PI * 2); o.fill();
      // the rough's furniture
      g.flowers.forEach(function (f) { drawFlower(o, f.x, f.y, f.c); });
      g.trees.sort(function (a, b) { return a.y - b.y; }).forEach(function (t) { drawTree(o, t.x, t.y, t.r, t.kind); });
      g.courseImg = { c: off, w: W, h: H, dpr: dpr };
    }
    function chunky(text, x, y, size, fill, align) {
      ctx.font = '800 ' + size + 'px ' + fontFamily; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.3); ctx.strokeStyle = T.outline; ctx.strokeText(text, x, y);
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
        } else if (o.kind === 'slider') railBlock(ctx, o.rect);
        else if (o.kind === 'gate') { railBlock(ctx, o.rects[0]); railBlock(ctx, o.rects[1]); }
        else if (o.kind === 'windmill') {
          ctx.save(); ctx.translate(o.x, o.y);
          ctx.fillStyle = T.shade; ctx.beginPath(); ctx.ellipse(4, 7, o.arm * 0.9, o.arm * 0.45, 0, 0, Math.PI * 2); ctx.fill();
          ctx.rotate(o.ang); ctx.lineCap = 'round';
          [[T.rail[0], 5], [T.rail[1], 0], [T.rail[2], -2]].forEach(function (L, li) {
            ctx.save(); ctx.rotate(-o.ang); ctx.translate(0, L[1]); ctx.rotate(o.ang);
            ctx.strokeStyle = L[0]; ctx.lineWidth = li === 2 ? 4 : 10;
            ctx.beginPath(); ctx.moveTo(-o.arm, 0); ctx.lineTo(o.arm, 0); ctx.moveTo(0, -o.arm); ctx.lineTo(0, o.arm); ctx.stroke();
            ctx.restore();
          });
          ctx.restore();
          circle(o.x, o.y + 3, o.hub, T.hub[0]); circle(o.x, o.y, o.hub, T.hub[1]); circle(o.x, o.y - 1, o.hub * 0.45, T.hub[2]);
        } else if (o.kind === 'bumper' && now - o.hit < 260) {   // a ring bursts out of a bumper that just got hit
          var bk = Math.max(0, (now - o.hit) / 260);
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * (1 - bk)) + ')'; ctx.lineWidth = 4 * (1 - bk) + 1;
          ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 2 + bk * 16, 0, Math.PI * 2); ctx.stroke();
        } else if (o.kind === 'geyser') {
          if (o.on) {   // steam: a column of puffs that spread and fade over the burst
            for (var pf = 0; pf < 5; pf++) {
              var pk = Math.min(1, Math.max(0, (o.k * 1.4 - pf * 0.12))), pr = 4 + pk * (o.r + 6 + pf * 3), py = o.y - pk * (10 + pf * 9);
              ctx.fillStyle = 'rgba(255,255,255,' + (0.6 * (1 - pk) + 0.1) + ')';
              ctx.beginPath(); ctx.arc(o.x + Math.sin(now / 90 + pf) * 4, py, pr, 0, Math.PI * 2); ctx.fill();
            }
          } else if (o.soon) {   // bubbling: it is about to blow
            ctx.fillStyle = 'rgba(255,200,120,' + (0.4 + 0.3 * Math.sin(now / 50)) + ')';
            for (var bb = 0; bb < 4; bb++) { var ba = now / 160 + bb * 1.6; ctx.beginPath(); ctx.arc(o.x + Math.cos(ba) * o.r * 0.5, o.y + Math.sin(ba) * o.r * 0.4, 2.5, 0, Math.PI * 2); ctx.fill(); }
          }
        }
      });
      if (g.portal && now - g.portal.t0 < 320) {   // a ring where the ball popped out of a tunnel
        var pk2 = Math.max(0, (now - g.portal.t0) / 320);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * (1 - pk2)) + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(g.portal.x, g.portal.y, 14 + pk2 * 18, 0, Math.PI * 2); ctx.stroke();
      }
      if (g.splash) {   // ripples
        var sp = (now - g.splash.t0) / 600;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * (1 - sp)) + ')'; ctx.lineWidth = 2.5;
        for (var rp = 0; rp < 2; rp++) { ctx.beginPath(); ctx.ellipse(g.splash.x, g.splash.y, 6 + sp * 26 + rp * 8, 3 + sp * 12 + rp * 4, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
      if (g.lipFlash && now - g.lipFlash < 360) {   // the rim lights up when the ball rattles out
        var lk = Math.max(0, (now - g.lipFlash) / 360);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.95 * (1 - lk)) + ')'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(g.cup.x, g.cup.y, g.cup.r + 2 + lk * 6, 0, Math.PI * 2); ctx.stroke();
      }
      if (g.aim && !g.sunk) {   // sparkle under the ball while aiming
        var pz = 1 + 0.25 * Math.sin(now / 90);
        ctx.save(); ctx.translate(b.x, b.y); ctx.scale(pz, pz); ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); for (var si = 0; si < 8; si++) { var ra = si % 2 ? 4 : 17, an = si / 8 * Math.PI * 2 + Math.PI / 8; ctx.lineTo(Math.cos(an) * ra, Math.sin(an) * ra); } ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // ball: in the air it rises off its shadow, in the hole it dips and shrinks
      if (b.alpha > 0) {
        var lift = b.z > 0 ? b.z * 0.8 : 0, dipS = b.z < 0 ? 1 + b.z / CUP_DROP * 0.35 : 1 + (b.z > 0 ? b.z / 110 : 0);
        if (b.z > 0) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(b.x, b.y + 2, b.r * 0.95, b.r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); }
        drawBubble({ x: b.x, y: b.y - lift, r: b.r, scale: b.scale * dipS, alpha: b.alpha, ox: b.ox || 0, oy: b.oy || 0, name: '', num: '' }, now);
      }
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
      chunky(((g.set === 'classic' ? '' : (g.set === 'frost' ? 'FROSTBITE · ' : 'VOLCANO · ')) + g.def.name).toUpperCase(), W / 2, H - 16, 11, 'rgba(255,255,255,0.85)', 'center');
      if (g.note && now - g.note.t0 < 1400) {
        var nk = Math.min(1, (1400 - (now - g.note.t0)) / 300);
        ctx.globalAlpha = nk; chunky(g.note.text, b.x, b.y - 26 - (1 - nk) * 10, 16, '#7ee0ff', 'center'); ctx.globalAlpha = 1;
      }
      if (g.lipFlash && now - g.lipFlash < 900 && !g.sunk) {
        ctx.globalAlpha = Math.min(1, (900 - (now - g.lipFlash)) / 300); chunky('lip out', g.cup.x, g.cup.y - 24 - Math.min(10, (now - g.lipFlash) / 60), 12, '#fff', 'center'); ctx.globalAlpha = 1;
      }
      if (g.msg) {
        var k = Math.min(1, (now - g.sunk) / 300);
        ctx.globalAlpha = 0.4 * k; ctx.fillStyle = T.outline; ctx.fillRect(0, H / 2 - 56, W, 112); ctx.globalAlpha = k;
        chunky(g.done ? 'ROUND OVER' : g.msg, W / 2, H / 2 - 14, 34, '#ffd23f', 'center');
        var rp2 = golfToPar(g.total, GOLF_PAR * g.courses.length);
        chunky(g.done ? (rp2 === 'E' ? 'EVEN PAR' : rp2) + ' FOR THE ROUND' : g.strokes + (g.strokes === 1 ? ' stroke' : ' strokes') + ' · par ' + GOLF_PAR, W / 2, H / 2 + 22, 14, '#fff', 'center');
        ctx.globalAlpha = 1;
      }
      if (g.reliefFlash && now - g.reliefFlash < 1100) {
        ctx.globalAlpha = Math.min(1, (1100 - (now - g.reliefFlash)) / 400); chunky('free relief', b.x, b.y - 20, 11, '#fff', 'center'); ctx.globalAlpha = 1;
      }
      if (!g.strokes && !g.sunk && !g.aim) {
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(now / 300); chunky('pull back anywhere, let go to putt', Math.max(118, Math.min(W - 118, b.x)), b.y + 28, 12, '#fff', 'center'); ctx.globalAlpha = 1;
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
        puck: { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 22 }, kickoff: true, humanHits: 0, cpuHits: 0 };   // a real puck: wide and flat, most of a mallet across
      paddle.held = true; paddle.tx = paddle.x; paddle.ty = Math.max(H / 2 + paddle.r, paddle.y); paddle.gx = 0; paddle.gy = 0;
      paddle.targetR = 28; paddle.bubbleR = paddle.r;
      box.classList.add('hockey');
      balls.forEach(function (b) { if (b !== paddle) b.fade = true; });
      boardShown = true; renderScores();
    }
    function gamePhysics(dt, now) {
      var g = game, me = g.me, p = g.puck, c = g.cpu;
      if (me.r > me.targetR + 0.2) me.r += (me.targetR - me.r) * Math.min(1, 0.18 * dt); else me.r = me.targetR;
      if (g.over) return;
      // your paddle is your finger: it sits under it and tracks it almost one to one, bottom half only. The speed cap keeps
      // a hit physical (a finger moves maybe 30px a frame; a far tap teleports the paddle with no swing instead, see pointerdown).
      var tx = Math.max(me.r, Math.min(W - me.r, me.tx)), ty = Math.max(H / 2 + me.r, Math.min(H - me.r, me.ty));
      var kf = (1 - Math.pow(0.15, dt)) / dt;   // 85% of the gap per 60Hz frame, the same closing rate at 30 or 120Hz
      me.vx = (tx - me.x) * kf; me.vy = (ty - me.y) * kf;
      var mv = Math.hypot(me.vx, me.vy), mcap = 44; if (mv > mcap) { me.vx *= mcap / mv; me.vy *= mcap / mv; }
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
        if (pad.ghost) {   // a paddle that landed on the puck: no shove while it sits still; the first flick carries the puck out ahead of it
          if (d >= min) { pad.ghost = false; }
          else {
            var pv = Math.hypot(pad.vx, pad.vy); if (pv < 1.5) return;
            var ux = pad.vx / pv, uy = pad.vy / pv;
            p.x = pad.x + ux * min; p.y = pad.y + uy * min; p.vx = pad.vx * 1.1; p.vy = pad.vy * 1.1;
            var fs = Math.hypot(p.vx, p.vy); if (fs > 16) { p.vx *= 16 / fs; p.vy *= 16 / fs; }
            pad.ghost = false; pad.touching = true; if (pad === me) { g.humanHits++; g.kickoff = false; } else g.cpuHits++;
            return;
          }
        }
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
      // a puck that has died in a corner or is pinned under a paddle against the rail goes nowhere frame to frame
      // (whatever its velocity says): after ~1.25s of that it is re-served from the centre
      var moved = g.px == null ? 1 : Math.hypot(p.x - g.px, p.y - g.py); g.px = p.x; g.py = p.y;
      g.stuck = (moved < 0.35 * dt && !g.kickoff) ? (g.stuck || 0) + dt : 0;
      if (g.stuck > 75) {
        p.x = W / 2; p.y = H / 2; g.stuck = 0; g.px = p.x; g.py = p.y;
        var dir = Math.random() < 0.5 ? -1 : 1;
        p.vx = (Math.random() - 0.5) * 4; p.vy = dir * 3.5; g.serveFlash = now;
        me.ghost = Math.hypot(p.x - me.x, p.y - me.y) < p.r + me.r;   // served onto a paddle sitting at the centre: no shove
      }
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
      if (label) { ctx.fillStyle = HK.cream; ctx.font = '600 11px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y + r + 12); }
    }
    // The table, in the Games page's arcade palette: a near-black rail with a hairline of yellow neon, a deep navy
    // playfield with the air-hole grid, neon red markings that glow, and lit goal mouths (Claude's orange, yours yellow).
    // Pre-rendered once per size, so the glows cost nothing during play.
    var tableCache = null;
    var HK = { rail: 10, railCol: '#0b0c14', field: ['#1d2048', '#141633', '#0f1128'], line: '#ff4757', you: '#ffcc00', cream: '#f5efe6', dim: 'rgba(255,255,255,0.6)' };
    function tableLayer(g) {
      if (tableCache && tableCache.w === W && tableCache.h === H && tableCache.dpr === dpr) return tableCache.c;
      var off = document.createElement('canvas'); off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
      var o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      var r = HK.rail, fx = r, fy = r, fw = W - 2 * r, fh = H - 2 * r;
      function rr(x, y, w, h, rad) { o.beginPath(); o.moveTo(x + rad, y); o.arcTo(x + w, y, x + w, y + h, rad); o.arcTo(x + w, y + h, x, y + h, rad); o.arcTo(x, y + h, x, y, rad); o.arcTo(x, y, x + w, y, rad); o.closePath(); }
      // rail
      o.fillStyle = HK.railCol; o.fillRect(0, 0, W, H);
      // playfield
      rr(fx, fy, fw, fh, 10); o.save(); o.clip();
      var fg = o.createLinearGradient(0, fy, 0, fy + fh); fg.addColorStop(0, HK.field[0]); fg.addColorStop(0.5, HK.field[1]); fg.addColorStop(1, HK.field[2]);
      o.fillStyle = fg; o.fillRect(fx, fy, fw, fh);
      // air holes
      o.fillStyle = 'rgba(255,255,255,0.09)';
      for (var y = fy + 12; y < fy + fh - 6; y += 14) for (var x = fx + 12 + ((Math.round((y - fy) / 14) % 2) ? 7 : 0); x < fx + fw - 6; x += 14) { o.beginPath(); o.arc(x, y, 1.1, 0, Math.PI * 2); o.fill(); }
      // markings: neon red, glowing
      o.save(); o.shadowColor = 'rgba(255,71,87,0.85)'; o.shadowBlur = 10;
      o.strokeStyle = HK.line; o.lineWidth = 3; o.lineCap = 'butt';
      o.beginPath(); o.moveTo(fx, H / 2); o.lineTo(fx + fw, H / 2); o.stroke();
      o.beginPath(); o.arc(W / 2, H / 2, 46, 0, Math.PI * 2); o.stroke();
      o.beginPath(); o.arc(W / 2, H / 2, 5, 0, Math.PI * 2); o.fillStyle = HK.line; o.fill();
      var gw = g.goal.x2 - g.goal.x1, cr = gw / 2 + 14;
      o.lineWidth = 2.5; o.beginPath(); o.arc(W / 2, fy, cr, 0, Math.PI); o.stroke();                 // goal creases
      o.beginPath(); o.arc(W / 2, fy + fh, cr, Math.PI, Math.PI * 2); o.stroke();
      o.beginPath(); o.arc(W / 2, fy + 54, 3.5, 0, Math.PI * 2); o.fill(); o.beginPath(); o.arc(W / 2, fy + fh - 54, 3.5, 0, Math.PI * 2); o.fill();   // face-off dots
      o.restore();
      var sheen = o.createLinearGradient(fx, fy, fx + fw, fy + fh * 0.6); sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.45, 'rgba(255,255,255,0.06)'); sheen.addColorStop(0.55, 'rgba(255,255,255,0)');
      o.fillStyle = sheen; o.fillRect(fx, fy, fw, fh);
      var vig = o.createRadialGradient(W / 2, H / 2, W * 0.4, W / 2, H / 2, W * 1.3); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.3)');
      o.fillStyle = vig; o.fillRect(fx, fy, fw, fh);
      o.restore();
      // the rail's neon hairline round the playfield
      rr(fx - 1.5, fy - 1.5, fw + 3, fh + 3, 11); o.save(); o.strokeStyle = 'rgba(255,204,0,0.7)'; o.lineWidth = 1.5; o.shadowColor = HK.you; o.shadowBlur = 8; o.stroke(); o.restore();
      // goal mouths: a dark slot in the rail, lit in each side's colour
      [[fy - r, colors.claude], [fy + fh, HK.you]].forEach(function (gl) {
        o.fillStyle = '#000'; o.fillRect(g.goal.x1, gl[0], gw, r);
        o.save(); o.shadowColor = gl[1]; o.shadowBlur = 18; o.fillStyle = gl[1];
        o.fillRect(g.goal.x1, gl[0] === fy - r ? fy - 3 : fy + fh, gw, 3); o.restore();
      });
      // bolts
      o.fillStyle = '#2a2d3a'; [[6, 6], [W - 6, 6], [6, H - 6], [W - 6, H - 6]].forEach(function (b) { o.beginPath(); o.arc(b[0], b[1], 2.6, 0, Math.PI * 2); o.fill(); o.fillStyle = 'rgba(255,204,0,0.5)'; o.beginPath(); o.arc(b[0] - 0.7, b[1] - 0.7, 1.1, 0, Math.PI * 2); o.fill(); o.fillStyle = '#2a2d3a'; });
      tableCache = { w: W, h: H, dpr: dpr, c: off };
      return off;
    }
    function drawGame(now) {
      var g = game, p = g.puck, c = g.cpu, me = g.me;
      var fade = Math.min(1, (now - g.t0) / 500);
      ctx.globalAlpha = fade; ctx.drawImage(tableLayer(g), 0, 0, W, H);
      ctx.font = '700 10px ' + fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,204,0,0.75)';
      ctx.fillText('S H O O T', W / 2, 5.5); ctx.fillText('D E F E N D', W / 2, H - 5);   // on the rails
      ctx.globalAlpha = 1;
      // fading bubbles
      balls.forEach(function (b) { if (b.fade) { b.alpha = Math.max(0, 1 - fade); if (b.alpha > 0) drawBubble(b, now); } });
      // cpu mallet
      mallet(c.x, c.y, c.r, colors.claude, 'Claude', true);
      if (g.kickoff && !g.over) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 300); ctx.fillStyle = HK.dim; ctx.font = '600 13px ' + fontFamily;
        ctx.fillText('your finger is the paddle', W / 2, H / 2 + 74); ctx.fillText('hit the puck to start', W / 2, H / 2 + 94); ctx.globalAlpha = 1;
      }
      if (g.serveFlash && now - g.serveFlash < 900) {
        ctx.globalAlpha = 1 - (now - g.serveFlash) / 900; ctx.fillStyle = HK.dim; ctx.font = '600 13px ' + fontFamily;
        ctx.fillText('re-serve', W / 2, H / 2 + 74); ctx.globalAlpha = 1;
      }
      // the puck: a wide flat disc. A dark side band gives it its thickness, a red ring on the top face catches the light
      circle(p.x + 1, p.y + 5, p.r, 'rgba(0,0,0,0.5)');
      circle(p.x, p.y + 3, p.r, '#050609');
      circle(p.x, p.y, p.r, '#2b2d3a', '#0b0c14', 1.5);
      circle(p.x, p.y, p.r - 4.5, null, HK.line, 2.5);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 1.5, Math.PI * 1.08, Math.PI * 1.55); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke();
      // player mallet (the bubble shrinks into it)
      var k2 = Math.min(1, (now - g.t0) / 450);
      if (k2 < 1) { me.alpha = 1; drawBubble(me, now); }
      ctx.globalAlpha = k2; mallet(me.x, me.y, me.r, HK.you, me.name); ctx.globalAlpha = 1;
      if (held === me && !g.over) circle(me.x, me.y, me.r + 9, null, 'rgba(255,255,255,0.5)', 2);   // the paddle's edge, showing round the fingertip that covers it
      if (g.over) {
        var k = Math.min(1, (now - g.over.t) / 300);
        ctx.globalAlpha = 0.92 * k; ctx.fillStyle = HK.railCol; ctx.fillRect(0, H / 2 - 60, W, 120); ctx.globalAlpha = k;
        ctx.fillStyle = g.over.winner === 'human' ? HK.you : colors.claude;
        ctx.font = '800 34px ' + fontFamily; ctx.fillText(g.over.winner === 'human' ? 'GOAL!' : 'CLAUDE SCORES', W / 2, H / 2 - 14);
        ctx.fillStyle = HK.cream; ctx.font = '600 15px ' + fontFamily;
        ctx.fillText(g.over.winner === 'human' ? me.name + ' beats Claude' : 'Nice try, ' + me.name, W / 2, H / 2 + 22);
        ctx.globalAlpha = 1;
        if (g.over.winner === 'cpu') drawClawd(now - g.over.t);
      }
    }
    // Clawd, the Claude Code crab (the pixel one: a 9-wide body with a wider band for the arms, two square eyes in that
    // band, four legs with a gap in the middle), crab-walks across the table when Claude scores. A beat after the card,
    // 2.5s across; two legs step while the other two are down, and it bobs a half-pixel with each step.
    function drawClawd(ms) {
      if (reduce) return;
      var t = ms / 1000, k = Math.max(0, (t - 0.25) / 2.5);
      if (k >= 1) return;
      var u = 9, w = 11 * u, h = 8 * u, step = Math.floor(t * 8) % 2;
      var x = Math.round(-w - 20 + (W + w + 40) * k), y = Math.round(H / 2 + 70);
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(u, h + 2, w - 2 * u, 3);   // shadow stays on the table
      ctx.translate(0, step ? 0 : -Math.round(u / 2));                           // the bob
      ctx.fillStyle = colors.claude;
      ctx.fillRect(u, 0, 9 * u, 2 * u);          // top of the body
      ctx.fillRect(0, 2 * u, 11 * u, 2 * u);     // the wide band, arms out
      ctx.fillRect(u, 4 * u, 9 * u, 2 * u);      // lower body
      [1, 3, 7, 9].forEach(function (c, i) { ctx.fillRect(c * u, 6 * u, u, (i % 2) === step ? 2 * u : u); });   // legs: two down, two lifted
      ctx.fillStyle = '#000'; ctx.fillRect(2 * u, 2 * u, u, u); ctx.fillRect(8 * u, 2 * u, u, u);   // eyes
      ctx.restore();
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
        if (!golfPaused) golfPhysics(dt, now);
        ctx.clearRect(0, 0, W, H);
        if (golf) drawGolf(now); else { balls.forEach(function (b) { drawBubble(b, now); }); }
        next(); return;
      }
      if (game) {
        gamePhysics(dt, now);
        if (game.over && now - game.over.t > (game.over.winner === 'cpu' ? 3200 : 2400)) {   // back to the bubbles, or back to the Games tab for a replay (Claude's goal gets a beat longer, for Clawd's walk)
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
        if (p.x > W - 58 && p.y < 34) { if (opts.onGolfTime && !golf.done) opts.onGolfTime(golf.set, (performance.now() - golf.flushed) / 1000, true); golf = null; return; }   // quit
        if (golfCanPutt(golf)) { golf.drag = { x: p.x, y: p.y }; golf.aim = null; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
        e.preventDefault(); return;
      }
      if (game) {   // the paddle is wherever the finger lands (bottom half), with no swing from the jump; the latest finger steers
        if (game.over) { e.preventDefault(); return; }   // the end card: nothing to steer
        var me = game.me, fx = Math.max(me.r, Math.min(W - me.r, p.x)), fy = Math.max(H / 2 + me.r, Math.min(H - me.r, p.y));
        game.touches = game.touches || {}; game.touches[e.pointerId] = { x: p.x, y: p.y };
        me.x = fx; me.y = fy; me.tx = fx; me.ty = fy; me.vx = 0; me.vy = 0; me.gx = 0; me.gy = 0; game.pid = e.pointerId;
        var pk = game.puck; me.ghost = Math.hypot(pk.x - me.x, pk.y - me.y) < pk.r + me.r;   // landed on the puck: no shove; it turns solid again once they part
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
      var p = pos(e);
      if (game && game.touches && game.touches[e.pointerId]) game.touches[e.pointerId] = { x: p.x, y: p.y };   // every finger's place is kept, in case it has to take over
      if (!held) return;
      if (game && game.pid != null && e.pointerId !== game.pid) return;   // a second finger doesn't fight the first
      held.tx = p.x - held.gx; held.ty = p.y - held.gy;
      trail.push(p); if (trail.length > 6) trail.shift();
    });
    function release(e) {
      if (golf) { if (golf.drag) golfPutt(golf, performance.now()); return; }
      if (game) {   // paddle stays where you left it; if another finger is still down, it steers from here
        if (game.touches) delete game.touches[e.pointerId];
        if (held && (game.pid == null || e.pointerId === game.pid)) {
          var rest = game.touches ? Object.keys(game.touches) : [];
          if (rest.length) { var tp = game.touches[rest[rest.length - 1]]; game.pid = +rest[rest.length - 1]; game.me.tx = tp.x; game.me.ty = tp.y; }
          else { held = null; game.pid = null; }
        }
        return;
      }
      if (!held) return;
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
    box.__hockeyGoal = function (winner) { if (game && !game.over) endGame(winner); };   // tests: call the game
    box.__hockeyPuck = function (x, y, vx, vy) { if (game) { game.puck.x = x; game.puck.y = y; game.puck.vx = vx || 0; game.puck.vy = vy || 0; game.kickoff = false; game.px = null; } };   // tests: place the puck
    box.__hockey = function () { return game ? { me: { x: game.me.x, y: game.me.y, vx: game.me.vx, vy: game.me.vy, r: game.me.r }, puck: { x: game.puck.x, y: game.puck.y, vx: game.puck.vx, vy: game.puck.vy, r: game.puck.r }, held: held === game.me, pid: game.pid, hits: game.humanHits, over: game.over, W: W, H: H } : null; };
    var golfPaused = false;   // tests drive golfPhysics themselves through __golfStep
    box.__golfPause = function (v) { golfPaused = !!v; };
    box.__golfStep = function (dt, now) { if (golf) golfPhysics(dt, now); return golf; };
    box.__golfReach = function () { return golf ? reachable(golf) : null; };
    box.__golfForce = function (setId, holeIdx, picks) {   // tests: a given layout with given obstacles
      startGolf(setId); golf.courses = HOLES_BY_SET[golf.set].slice(); golf.hole = holeIdx; golf.force = picks || null; loadHole(); return golf;
    };
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
    if (shouldAsk()) { askedThisVisit = true; qAuto = true; openQuestionnaire(firstUnanswered()); return; }   // the predictions, once
    $('me').innerHTML = 'Hey <b>' + esc(me) + '</b>';
    showTab(tab);
    render();
  }

  // Everything on the main screen labels the current person as "you" and keeps per-person drafts, so when
  // someone taps "Not you?" and picks another name, start those over.
  var renderedFor = null;
  function refreshForUser() {
    renderedFor = me;
    askedThisVisit = false; qAuto = false; qSingle = false;   // a new name on this phone gets its own prompts
    ['new-name', 'need-name', 'wall-input', 'exp-title'].forEach(function (id) { var el = $(id); if (el) el.value = ''; });   // no typed drafts carry over
    document.body.classList.toggle('plain-picks', plainPicks());
    mafiaDraft = null; teamsDraft = null; teamsEdit = false; expanded = null; pickerFor = null; modReveal = false;
    renderPredictions(); renderSheet(); renderWall(); updateChatBadge();
    renderMafia(); renderTeams(); renderLiv(); renderSmash();
    renderHockeyBoard(); renderGolfBoard(); renderArcadeCues(); smashResetPair(); hibDraft = null; renderHibachi(); updatePredBadge();
  }

  // ---- Bottom dock ----
  var TABS = ['home', 'photos', 'cabin', 'games', 'hibachi'];
  var tab = 'cabin', indPlaced = false;
  function showTab(name) {
    var changed = name !== tab;
    tab = name;
    TABS.forEach(function (t) { var pg = $('page-' + t); if (pg) pg.hidden = t !== tab; });
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
  // The other thousand live in liv-questions.js (heat 0 = funny, 4 = unhinged), appended so the indexes in a saved
  // "seen" list keep pointing at the same questions.
  LIV_Q = LIV_Q.concat(window.LIV_MORE || []);
  var liv = null, livLoaded = false, livSub = false, livAnim = null;
  var HEAT = { 0: 'Funny', 1: 'Deep', 2: 'Uncomfortable', 3: 'No mercy', 4: 'Unhinged' };
  // Liv picks a mood; the draw only comes from that pile. 'deep' is the original three heats.
  var LIV_MOODS = [['all', 'Everything'], ['funny', 'Funny'], ['deep', 'Deep'], ['unhinged', 'Unhinged']];
  function livMood() { var m = liv && liv.mood; return LIV_MOODS.some(function (x) { return x[0] === m; }) ? m : 'all'; }
  function livInMood(heat, mood) { return mood === 'all' || (mood === 'funny' ? heat === 0 : mood === 'unhinged' ? heat === 4 : heat >= 1 && heat <= 3); }
  function livPool(mood) { return LIV_Q.map(function (_, i) { return i; }).filter(function (i) { return livInMood(LIV_Q[i][0], mood); }); }
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
    var seen = (liv && liv.seen) || [], mood = livMood(), pool = livPool(mood);
    if (!pool.length) { toast('That pile is empty.'); return; }
    var left = pool.filter(function (i) { return seen.indexOf(i) < 0; });
    if (!left.length) { seen = seen.filter(function (i) { return pool.indexOf(i) < 0; }); left = pool; toast('That pile’s been through once. Going round again.'); }   // only this pile starts over
    var idx = left[Math.floor(Math.random() * left.length)];
    var doc = { q: idx, mood: mood, victim: keepVictim && liv ? liv.victim : livPickVictim(liv && liv.victim), by: me, seen: seen.concat([idx]), at: new Date().toISOString() };
    liv = doc; livAnim = { flip: true, spin: true }; renderLiv(); buzz(25);
    store.setGame('liv', doc).catch(function (e) { toast('Couldn’t draw one: ' + ((e && e.message) || e)); });
  }
  function renderLiv() {
    var body = $('liv-body'), status = $('liv-status'); if (!body) return;
    if (!livLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var seen = (liv && liv.seen) || [], mood = livMood(), pool = livPool(mood);
    var cur = liv && typeof liv.q === 'number' ? LIV_Q[liv.q] : null;
    var asked = seen.filter(function (i) { return pool.indexOf(i) >= 0; }).length;
    status.textContent = asked ? asked + ' of ' + pool.length + ' asked' : LIV_Q.length.toLocaleString() + ' questions';
    if (!livAllowed()) {
      body.innerHTML = '<div class="liv-locked"><div class="lock">\uD83D\uDD12</div><b>Liv’s eyes only.</b></div>';
      return;
    }
    var total = LIV_Q.length.toLocaleString();
    var html = me === 'Liv'
      ? '<p class="info-sub"><b>Hey Liv.</b> Mitch made this for you: ' + total + ' questions to ask people, from silly to deep to completely unhinged, one at a time, no repeats. Only you and Mitch can see them. Pick a mood, then draw.</p>'
      : '<p class="info-sub">Liv\u2019s stash of ' + total + ' questions, silly to deep to unhinged. One at a time, no repeats, nowhere to hide. Only Liv and Mitch can read these; the rest just get asked.</p>';
    html += '<div class="legend"><span class="h0"><i></i>Funny · gets you laughing</span><span class="h1"><i></i>Deep · gets you thinking</span><span class="h2"><i></i>Uncomfortable · gets you sweating</span><span class="h3"><i></i>No mercy · gets you divorced</span><span class="h4"><i></i>Unhinged · gets you banned</span></div>';
    html += '<div class="liv-moods" role="group" aria-label="Mood">' + LIV_MOODS.map(function (m) { return '<button type="button" data-mood="' + m[0] + '" aria-pressed="' + (m[0] === mood) + '">' + m[1] + '</button>'; }).join('') + '</div>';
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
    var moodBtn = e.target.closest('.liv-moods [data-mood]');
    if (moodBtn) {
      var newMood = moodBtn.getAttribute('data-mood');
      if (newMood === livMood()) return;
      var moodDoc = Object.assign({ seen: [] }, liv || {}, { mood: newMood, by: me, at: new Date().toISOString() });
      liv = moodDoc; renderLiv(); buzz(8);
      store.setGame('liv', moodDoc).catch(function (err) { toast('Couldn’t switch: ' + ((err && err.message) || err)); });
      return;
    }
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
  var golfScores = {}, golfSub = false;   // one board per course, keyed by course id
  function subscribeBoards() {
    if (store && store.scores && !scoresSub) { scoresSub = true; store.scores(function (sc) { scores = sc; renderScores(); renderHockeyBoard(); }); }
    if (store && store.golfScores && !golfSub) { golfSub = true; store.golfScores(function (doc, setId) { var sid = setId == null ? 'classic' : setId; if (golfSet(sid).id !== sid) return; golfScores[sid] = doc; renderGolfBoard(); }); }
  }
  var BOARD_MAX = 5;
  function renderHockeyBoard() {
    var body = $('hockeyboard-body'), st = $('hockeyboard-status'); if (!body) return;
    var sc = scores || { humans: 0, cpu: 0 }, h = sc.humans || 0, c = sc.cpu || 0;
    st.textContent = h === c ? (h ? 'Dead even' : 'No matches yet') : h > c ? 'Humans lead' : 'Claude leads';
    // one line of records: the best against Claude (most wins) and, of everyone else, the worst (lowest win rate)
    var by = sc.by || {}, rows = Object.keys(by).map(function (n) { return { name: n, w: by[n].w || 0, l: by[n].l || 0 }; })
      .sort(function (a, b) { return b.w - a.w || a.l - b.l || a.name.localeCompare(b.name); });
    var pct = function (r) { return r.w + r.l ? r.w / (r.w + r.l) : 1; };
    var worst = rows.slice(1).sort(function (a, b) { return pct(a) - pct(b) || b.l - a.l || a.w - b.w || a.name.localeCompare(b.name); })[0];
    var rec = function (label, r) { return '<span><small>' + label + '</small><span class="nm' + (r.name === me ? ' me' : '') + '">' + esc(r.name === me ? 'You' : r.name) + '</span><b><span class="w">' + r.w + '</span>\u2013<span class="l">' + r.l + '</span></b></span>'; };
    var tally = $('hockeyboard-tally'), tallyHtml = '<div class="hb-side' + (h > c ? ' lead' : '') + '"><span class="n">' + h + '</span><small>Humans</small></div><span class="hb-vs">vs</span><div class="hb-side claude' + (c > h ? ' lead' : '') + '"><span class="n">' + c + '</span><small>Claude</small></div>';
    if (tally) tally.innerHTML = tallyHtml;   // beside the title; on an older page, in the body
    body.innerHTML = (tally ? '' : '<div class="hb">' + tallyHtml + '</div>') + (rows.length ? '<div class="hb-rec"><div class="hb-rec-list">' + rec('Best', rows[0]) + (worst ? rec('Worst', worst) : '') + '</div></div>' : '');
  }
  // The three courses side by side: one arcade box per course, each with its own list, and the three lists scroll and
  // idle in lockstep. (An older page without the three boxes gets three columns in its one box instead.)
  function golfBodies() { var t = $('golfboard'); var bs = t ? Array.prototype.slice.call(t.querySelectorAll('.gb-body')) : []; if (!bs.length && $('golfboard-body')) bs = [$('golfboard-body')]; return bs; }
  function golfBoardRows(setId) {
    var doc = golfScores[setId], by = (doc && doc.by) || {};
    // finished rounds only; time on the course (by[n].secs) is kept for Claude, never shown
    return Object.keys(by).filter(function (n) { return by[n].best != null; }).map(function (n) { return { name: n, best: by[n].best, rounds: by[n].rounds || 0 }; })
      .sort(function (a, b) { return a.best - b.best || b.rounds - a.rounds || a.name.localeCompare(b.name); });
  }
  function golfBoardHeads() {
    return GOLF_SETS.map(function (s) { return '<button type="button" class="gb-head" data-golfset="' + s.id + '" aria-label="Play ' + esc(s.name) + '"><span class="gb-name"><span aria-hidden="true">' + s.icon + '</span> ' + esc(s.name) + '</span><span class="bc-play" aria-hidden="true">\u25B6 Play</span></button>'; }).join('');
  }
  function golfListHtml(rows) {
    var par = 27;
    return rows.length ? rows.map(function (r, i) {
      var dtxt = golfToPar(r.best, par);
      return '<div class="lb-row' + (r.name === me ? ' me' : '') + (r.best === rows[0].best ? ' lead' : '') + '"><span class="rank">' + (i + 1) + '</span><span class="nm">' + esc(r.name === me ? 'You' : r.name) + '</span><span class="stat' + (dtxt.charAt(0) === '-' ? ' under' : dtxt === 'E' ? ' even' : '') + '">' + dtxt + '</span></div>';   // the leader (and anyone tied) lit up
    }).join('') : '<div class="lb-empty">Nobody yet</div>';
  }
  function renderGolfBoard() {
    var trio = $('golfboard'), st = $('golfboard-status'), sets = $('golfboard-sets');
    if (st) st.hidden = true;   // an older page still has the old status line
    var heads = $('golfboard-heads'), cards = trio ? trio.querySelectorAll('.gcard') : [];
    if (heads) {   // the scorecard: one row per person, a column per course, the leader of each column lit up
      if (!heads.firstChild) heads.innerHTML = '<div class="gm gm-heads"><div class="gm-title"><span class="gm-ic" aria-hidden="true">\u26F3</span><span>Mini golf</span></div>' + GOLF_SETS.map(function (c) {
        return '<button type="button" class="gm-head" data-golfset="' + c.id + '" aria-label="Play ' + esc(c.name) + '"><span class="gm-ic" aria-hidden="true">' + c.icon + '</span><span class="gm-nm">' + esc(c.name) + '</span><span class="bc-play" aria-hidden="true">\u25B6 Play</span></button>';
      }).join('') + '</div>';
      var body2 = $('golfboard-body'); if (!body2) return;
      var par = 27, perSet = {}, names = {}, lead = {};
      GOLF_SETS.forEach(function (c) { var rows = golfBoardRows(c.id); perSet[c.id] = {}; rows.forEach(function (r) { perSet[c.id][r.name] = r.best; names[r.name] = Math.min(names[r.name] == null ? 99 : names[r.name], r.best); }); lead[c.id] = rows.length ? rows[0].best : null; });
      // everyone who has finished a round anywhere, best finish first
      var people = Object.keys(names).sort(function (a, b) { return names[a] - names[b] || a.localeCompare(b); });
      body2.innerHTML = people.length ? '<div class="gm">' + people.map(function (nm) {
        return '<div class="gm-name' + (nm === me ? ' me' : '') + '">' + esc(nm === me ? 'You' : nm) + '</div>' + GOLF_SETS.map(function (c) {
          var b = perSet[c.id][nm]; if (b == null) return '<div class="gm-score none" data-golfset="' + c.id + '">\u2013</div>';
          var t = golfToPar(b, par);
          return '<div class="gm-score' + (b === lead[c.id] ? ' lead' : '') + (t.charAt(0) === '-' ? ' under' : t === 'E' ? ' even' : '') + '" data-golfset="' + c.id + '">' + t + '</div>';
        }).join('');
      }).join('') + '</div>' : '<div class="lb-empty">Nobody has played yet</div>';
    } else if (cards.length) {
      Array.prototype.forEach.call(cards, function (card) { card.querySelector('.gb-body').innerHTML = '<div class="lb">' + golfListHtml(golfBoardRows(card.getAttribute('data-golfcol'))) + '</div>'; });
    } else {   // the older single box: three columns under a row of headers
      var body = $('golfboard-body'); if (!body) return;
      if (sets && !sets.firstChild) sets.innerHTML = '<div class="gb-cols gb-heads">' + golfBoardHeads() + '</div>';
      body.innerHTML = (sets ? '' : '<div class="gb-cols gb-heads">' + golfBoardHeads() + '</div>') + '<div class="gb-cols">' + GOLF_SETS.map(function (s) { return '<div class="lb gb-col" data-golfcol="' + s.id + '">' + golfListHtml(golfBoardRows(s.id)) + '</div>'; }).join('') + '</div>';
    }
    renderArcadeCues(); golfScrollCue(); golfCycle();
  }
  // Left alone, the board idles through its rows a row at a time, rests at the bottom and starts over, so the
  // half-height list shows everyone without a scroll. A finger on the list pauses it for a while, and it only runs
  // while the Games tab is showing, the list actually overflows, and nobody is mid-game.
  var cycleTimer = null, cyclePauseUntil = 0;
  function golfCycle() {
    clearTimeout(cycleTimer);
    var bodies = golfBodies(), card = $('golfboard'); if (!bodies.length || !card) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function live() { return tab === 'games' && !document.hidden && !$('main').hidden && !document.body.classList.contains('playing') && card.classList.contains('scrolls'); }
    function step() {
      if (!live()) return;
      if (Date.now() < cyclePauseUntil) { cycleTimer = setTimeout(step, 800); return; }
      // every list steps by one row to the same place; the longest one decides when the walk is over
      var max = 0, rowH = 0, top = 0;
      bodies.forEach(function (body) { var rows = body.querySelectorAll('.lb-row, .gm-name'); max = Math.max(max, body.scrollHeight - body.clientHeight); top = Math.max(top, body.scrollTop); if (rows.length > 1) rowH = Math.max(rowH, rows[1].offsetTop - rows[0].offsetTop); });
      if (!rowH) rowH = bodies[0].clientHeight;
      var atEnd = top >= max - 1, next = atEnd ? 0 : Math.min(max, top + rowH);
      bodies.forEach(function (body) { body.scrollTo({ top: next, behavior: reduce ? 'auto' : 'smooth' }); });
      cycleTimer = setTimeout(step, atEnd ? 2600 : 2200);
    }
    if (live()) cycleTimer = setTimeout(step, 2600);
  }
  golfBodies().forEach(function (body) { ['pointerdown', 'touchstart', 'wheel'].forEach(function (ev) { body.addEventListener(ev, function () { cyclePauseUntil = Date.now() + 8000; }, { passive: true }); }); body.addEventListener('scroll', golfScrollCue, { passive: true }); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) golfCycle(); });
  // the golf card is pinned to the air hockey card's height, so the list scrolls inside it: say how many rows are below the fold
  function golfScrollCue() {
    var card = $('golfboard'), bodies = golfBodies(); if (!card || !bodies.length) return;
    var anyScrolls = false;
    bodies.forEach(function (body) {
      // rows below this list's fold (on the older single box, the longest column's count)
      var hidden = 0, bottom = body.scrollTop + body.clientHeight, cols = body.querySelectorAll('.gb-col');
      (cols.length ? Array.prototype.slice.call(cols) : [body]).forEach(function (col) {
        var rows = col.querySelectorAll('.lb-row, .gm-name'), h = 0;
        for (var i = 0; i < rows.length; i++) if (rows[i].offsetTop + rows[i].offsetHeight > bottom + 6) h++;
        hidden = Math.max(hidden, h);
      });
      var scrolls = body.clientHeight > 0 && body.scrollHeight > body.clientHeight + 2, box = body.closest('.gcard') || card, cue = box.querySelector('.lb-scroll');
      anyScrolls = anyScrolls || scrolls;
      box.classList.toggle('scrolls', scrolls);
      box.classList.toggle('at-end', scrolls && !hidden);
      if (cue) { cue.hidden = !scrolls || !hidden; cue.textContent = '\u25BC ' + hidden + (box.classList.contains('gcard') ? '' : ' more'); }
    });
    card.classList.toggle('scrolls', anyScrolls);
  }
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
  // a tap on a course's header or column starts that course; anywhere else on the card, the last course played
  function golfCardPick(e) {
    var s = e.target.closest('[data-golfset]') || e.target.closest('[data-golfcol]');
    if (s) pickGolfSet(s.getAttribute('data-golfset') || s.getAttribute('data-golfcol'));
  }
  [['hockeyboard', 'hockey'], ['golfboard', 'golf']].forEach(function (x) {
    var el = $(x[0]);
    el.addEventListener('click', function (e) { if (x[1] === 'golf') golfCardPick(e); playAgain(x[1]); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (x[1] === 'golf') golfCardPick(e); playAgain(x[1]); } });
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
    { k: 'gate', name: 'The airport gate', icon: '✈️', roles: ['Gate agent', 'Overpacker', 'Boarding-group liar', 'Neck-pillow wearer', 'Delayed and furious', 'At the bar at 9 a.m.'] },
    { k: 'wedding', name: 'A wedding reception', icon: '💒', roles: ['Best man mid-speech', 'Bouquet catcher', 'Open-bar regular', 'Cake guard', 'Plus-one nobody knows', 'DJ taking no requests'] },
    { k: 'dentist', name: 'The dentist’s chair', icon: '🦷', roles: ['Dentist', 'Hygienist', 'Flossing liar', 'Gagging on the x-ray', 'Nitrous enjoyer', 'Parent in the waiting room'] },
    { k: 'casino', name: 'The casino floor', icon: '🎰', roles: ['Blackjack dealer', 'Slot-machine lifer', 'Cocktail server', 'Card counter', 'Down bad at craps', 'Pit boss'] },
    { k: 'ikea', name: 'IKEA on a Saturday', icon: '🪑', roles: ['Cart navigator', 'Meatball enthusiast', 'Lost in Marketplace', 'Pencil hoarder', 'Arguing over a couch', 'Showroom napper'] },
    { k: 'gym', name: 'The gym at 6 a.m.', icon: '🏋️', roles: ['Personal trainer', 'Mirror flexer', 'Treadmill walker', 'Squat-rack hog', 'Towel forgetter', 'Locker-room talker'] },
    { k: 'costco', name: 'The Costco sample lap', icon: '🧀', roles: ['Sample lady', 'Pizza-slice buyer', 'Bulk-buy justifier', 'Membership checker', 'Cart blocker', 'TV-aisle lingerer'] },
    { k: 'dmv', name: 'The DMV', icon: '🪪', roles: ['Number caller', 'Wrong-form holder', 'Photo retaker', 'Asleep in the chair', 'Line cutter', 'Eye-chart cheater'] },
    { k: 'cruise', name: 'A cruise ship buffet', icon: '🛳️', roles: ['Buffet lifer', 'Towel-animal maker', 'Seasick one', 'Shore-excursion booker', 'Pool-chair claimer', 'Cruise director'] },
    { k: 'zoo', name: 'The zoo', icon: '🦒', roles: ['Zookeeper', 'Monkey-house complainer', 'Lost kid', 'Gift-shop maxer', 'Penguin superfan', 'Pretzel buyer'] },
    { k: 'court', name: 'A courtroom', icon: '⚖️', roles: ['Judge', 'Nervous witness', 'Defense attorney', 'Juror number six', 'Court sketch artist', 'Bailiff'] },
    { k: 'er', name: 'The ER waiting room', icon: '🏥', roles: ['Triage nurse', 'Mystery rash', 'Fell off a ladder', 'Asleep on three chairs', 'Vending-machine raider', 'Paperwork filler'] },
    { k: 'haunted', name: 'A haunted house', icon: '👻', roles: ['Chainsaw guy', 'Screamer', 'Scared the actors', 'Clutching a stranger', 'Sprinting for the exit', 'Ticket taker'] },
    { k: 'karaoke', name: 'Karaoke night', icon: '🎤', roles: ['Hogging the mic', 'Power-ballad specialist', 'Duet partner', 'Scrolling the songbook', 'Tambourine', 'Holding the bar tab'] },
    { k: 'iss', name: 'The space station', icon: '🚀', roles: ['Commander', 'Lost a sock in zero g', 'Running the experiments', 'Space-toilet expert', 'Homesick', 'Out on a spacewalk'] },
    { k: 'sub', name: 'A submarine', icon: '🌊', roles: ['Captain', 'Sonar listener', 'Periscope hog', 'Claustrophobic', 'Torpedo loader', 'Cook'] },
    { k: 'subway', name: 'A packed subway car', icon: '🚇', roles: ['Pole leaner', 'Backpack blocker', 'Headphones blasting', 'Showtime dancer', 'Lost tourist', 'Asleep standing up'] },
    { k: 'farm', name: 'A dairy farm', icon: '🐄', roles: ['Milker', 'Tractor driver', 'Chasing a loose goat', 'Farmhand on day one', 'Egg collector', 'City cousin visiting'] },
    { k: 'beach', name: 'A crowded beach', icon: '🏖️', roles: ['Lifeguard', 'Sunburn in progress', 'Umbrella wrestler', 'Sandcastle engineer', 'Sunscreen applier', 'Seagull victim'] },
    { k: 'library', name: 'The public library', icon: '📚', roles: ['Librarian', 'Shusher', 'Printer wrestler', 'Study-group talker', 'Napping in the stacks', 'Owes a fine'] },
    { k: 'rally', name: 'A campaign rally', icon: '🎪', roles: ['Candidate', 'Sign holder', 'Heckler', 'Speechwriter', 'Baby being kissed', 'Press pool'] },
    { k: 'pirate', name: 'A pirate ship', icon: '🏴‍☠️', roles: ['Captain', 'Lookout in the crow’s nest', 'Deck swabber', 'Parrot handler', 'Map reader', 'Walking the plank'] },
    { k: 'bakery', name: 'A bakery at opening', icon: '🥐', roles: ['Baker', 'First in line', 'Croissant critic', 'Announcing it’s sold out', 'Coffee spiller', 'Free-sample grabber'] },
    { k: 'nails', name: 'The nail salon', icon: '💅', roles: ['Technician', 'Can’t pick a color', 'Gossip source', 'On speakerphone', 'First-timer boyfriend', 'Smudged it on the way out'] },
    { k: 'safari', name: 'A safari jeep', icon: '🦁', roles: ['Guide', 'Binocular hog', 'Lion spotter', 'Napping in the back', 'Wrong-shoes tourist', 'Snack smuggler'] },
    { k: 'lobby', name: 'A hotel lobby at 2 a.m.', icon: '🏨', roles: ['Night clerk', 'Lost key card', 'Ice-machine wanderer', 'Bachelorette party', 'Noise complainer', 'Bellhop'] },
    { k: 'tailgate', name: 'A tailgate', icon: '🏈', roles: ['Grill master', 'Cornhole champ', 'Face painter', 'Parking-lot wanderer', 'Cooler guard', 'Lost the tickets'] },
    { k: 'salon', name: 'The barber shop', icon: '💈', roles: ['Barber', 'Asked for a trim, got a buzz', 'Waiting for his guy', 'Phone photo of a haircut', 'Hot-towel enjoyer', 'Sweeping up'] }
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
    html += '<div class="mafia-actions">' + (revealed
      ? '<button type="button" class="big-btn" id="spy-again">🔍 Deal another</button><button type="button" class="btn" id="spy-end">Done</button>'
      : (isSpy ? '<button type="button" class="btn" id="spy-reveal">I’m the spy: reveal me</button>' : '') + '<button type="button" class="btn" id="spy-again">Re-deal</button>') + '</div>';
    if (!revealed) html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="spy-end">End the game</button></div>';
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
  listen('spyfall-body', 'submit', function (e) {
    if (e.target.id !== 'spyfall-guest') return;
    e.preventDefault();
    var d = spyDraft || (spyDraft = spyDefaults()), inp = e.target.querySelector('input');
    if (addGuest(d, inp.value)) { renderSpyfall(); var again = document.querySelector('#spyfall-guest input'); if (again) again.focus(); buzz(6); }
  });
  listen('spyfall-body', 'click', function (e) {
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
      if (!spy.revealed && spyLeft(spy) > 0 && !window.confirm('End the round for everyone?')) return;   // mid-round, make sure
      var ended = Object.assign({}, spy, { status: 'ended', ended_at: new Date().toISOString() });
      store.setGame('spyfall', ended).then(function () { spy = ended; spyDraft = null; renderSpyfall(); }).catch(function (err) { toast('Couldn’t end it: ' + ((err && err.message) || err)); });
    }
  });
  listen('spyfall-body', 'pointerdown', holdStart);
  listen('spyfall-body', 'contextmenu', function (e) { if (e.target.closest('.role-card')) e.preventDefault(); });

  // ---- Fishbowl ----
  // Everyone drops three things in the bowl from their own phone. Two or three teams, three rounds on the same words:
  // describe it, one word, act it out. Turns are a minute. Only the giver's own phone can start their turn, and that
  // phone runs it: it shows the card and takes Got it or Skip; every other phone shows the score and the clock. Words live in one document per person
  // (game-fb-<name>), so thirteen people typing at once never overwrite each other; the game itself is one document.
  var FB_WORDS = 3, FB_TURN = 60, FB_ROUNDS = [
    { name: 'Describe it', rule: 'Say anything except the words on the card. No rhymes-with, no spelling it out.' },
    { name: 'One word', rule: 'One word, then silence. Choose it well.' },
    { name: 'Act it out', rule: 'No words, no sounds. Charades.' }
  ];
  var fb = null, fbLoaded = false, fbSub = false, fbWords = {}, fbWordsLoaded = false, fbPreview = null, fbExpiredFor = null, fbTeamCount = 2;
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
  function fbWinner(g) {   // the top scorer, or -1 when two or more share the top
    var best = Math.max.apply(null, g.score);
    return g.score.filter(function (x) { return x === best; }).length > 1 ? -1 : g.score.indexOf(best);
  }
  function fbScoreLine(g) { return g.score.join('\u2013'); }
  function fbWinnerText(g) { var w = fbWinner(g); return w < 0 ? 'A tie, ' + fbScoreLine(g) + '.' : fbTeamName(g, w) + ' won ' + fbScoreLine(g) + '.'; }
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
      var pool = fbPool(), mine = fbMine(), want = fbTeamCount, need = want * 2, can = pool.people.length >= need;
      status.textContent = pool.words.length ? pool.words.length + ' in the bowl' : 'Bowl’s empty';
      html += '<p class="info-sub">Everyone drops ' + FB_WORDS + ' things in the bowl from their own phone: people, places, movies, inside jokes. Two or three teams, three rounds on the same words: describe it, one word, act it out. A minute a turn. You start your own turns from your own phone.</p>';
      html += '<div class="fb-mine"><div class="rl-head">Your ' + FB_WORDS + ' <span class="info-sub">(' + mine.length + ' in)</span></div>' +
        mine.map(function (w, i) { return '<span class="guest">' + esc(w) + '<button type="button" data-fb-drop="' + i + '" aria-label="Take out ' + esc(w) + '">×</button></span>'; }).join('') +
        (mine.length < FB_WORDS ? '<form class="guest-add" id="fb-add"><input type="text" maxlength="40" placeholder="Something to guess" autocomplete="off" autocapitalize="words"><button type="submit" class="btn">Drop in</button></form>' : '<span class="info-sub">You’re in. Sit tight.</span>') + '</div>';
      html += '<div class="fb-pool">' + (pool.people.length ? pool.people.map(function (n) { var c = fbWords[n].words.length; return '<span class="guest' + (c >= FB_WORDS ? ' full' : '') + '">' + esc(n === me ? 'You' : n) + ' <b>' + c + '</b></span>'; }).join('') : '<span class="info-sub">Nobody’s dropped anything in yet.</span>') + '</div>';
      if (fbPreview && !sameDoc(fbPreview.people, pool.people)) fbPreview = null;   // someone joined or left: roll again
      html += '<div class="mafia-opts"><div class="opt-row"><span>Teams <span class="info-sub">(' + pool.people.length + ' in the bowl)</span></span><span class="stepper"><button type="button" data-fb-teamn="-1"' + (want <= 2 ? ' disabled' : '') + '>−</button><b>' + want + '</b><button type="button" data-fb-teamn="1"' + (want >= 3 ? ' disabled' : '') + '>+</button></span></div></div>';
      if (fbPreview) {
        html += '<div class="team-list">' + fbPreview.teams.map(function (members, i) { return teamHtml(members, fbPreview.ti[i]); }).join('') + '</div>';
        html += '<div class="mafia-actions"><button type="button" class="big-btn" id="fb-start">🐟 Start the game</button><button type="button" class="btn" id="fb-teams">Roll again</button></div>';
      } else {
        html += '<div class="mafia-actions"><button type="button" class="big-btn" id="fb-teams"' + (can ? '' : ' disabled') + '>🎲 Make the teams</button></div>';
        if (!can) html += '<div class="deal-sum">Needs ' + need + ' people with something in the bowl for ' + want + ' teams.</div>';
      }
      if (fb && fb.status === 'over') html += '<p class="info-sub" style="margin-top:10px">Last game: ' + esc(fbWinnerText(fb)) + '</p>';
      if (pool.words.length) html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="fb-new">Empty the bowl</button></div>';
      body.innerHTML = html; return;
    }
    var t = g.turn, running = !!t.started_at, left = running ? fbLeft(g) : 0, meRunner = running && t.runner === myId(), over = g.status === 'over';
    status.textContent = over ? (fbWinner(g) < 0 ? 'Tie, ' + fbScoreLine(g) : TEAM_NAMES[g.ti[fbWinner(g)]] + ' won ' + fbScoreLine(g)) : 'Round ' + g.round + ' \u00b7 ' + fbScoreLine(g);
    html += '<div class="fb-score' + (g.teams.length > 2 ? ' three' : '') + '">' + g.teams.map(function (_, i) {
      return '<div class="fb-team' + (!over && t.team === i ? ' up' : '') + (over && fbWinner(g) === i ? ' won' : '') + '" style="--tc:' + TEAM_COLORS[g.ti[i]] + '"><span class="n">' + g.score[i] + '</span><small>' + fbTeamName(g, i) + '</small><span class="names">' + esc(g.teams[i].join(', ')) + '</span></div>';
    }).join('') + '</div>';
    if (over) {
      html += '<div class="fb-round"><b>Game over.</b> ' + esc(fbWinnerText(g)) + '</div>';
      html += '<div class="fb-rounds">' + FB_ROUNDS.map(function (rr, i) { return '<span>' + esc(rr.name) + ' <b>' + g.rounds[i].join('–') + '</b></span>'; }).join('') + '</div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="fb-again">🐟 Same words, play again</button><button type="button" class="btn" id="fb-new">New bowl</button></div>';
      body.innerHTML = html; return;
    }
    var r = FB_ROUNDS[g.round - 1], teamName = fbTeamName(g, t.team);
    html += '<div class="fb-round"><b>Round ' + g.round + ' of 3: ' + esc(r.name) + '.</b> ' + esc(r.rule) + ' <span class="info-sub">' + g.left.length + ' of ' + g.entries.length + ' left in the bowl.</span></div>';
    if (!running) {
      html += '<div class="fb-up"><span class="sub">Up next for ' + teamName + '</span><span class="who">' + esc(t.giver === me ? 'You' : t.giver) + '</span></div>';
      if (t.giver === me) html += '<div class="mafia-actions"><button type="button" class="big-btn" id="fb-go">▶ Start my turn</button><button type="button" class="btn" id="fb-pass">Skip me</button></div>';
      else html += '<div class="info-sub" style="margin-top:8px;text-align:center">' + esc(t.giver) + ' starts the turn from their own phone.</div><div class="mafia-actions"><button type="button" class="btn" id="fb-pass">' + esc(t.giver) + ' isn’t around: skip to the next person</button></div>';
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
  function fbEndTurn(g) { var team = (g.turn.team + 1) % g.teams.length; g.turn = { team: team, giver: fbNextGiver(g, team), started_at: null, runner: null, cur: null, got: 0 }; return g; }
  function fbFresh(base) {   // a new game on the same teams and words
    var zeros = function () { return base.teams.map(function () { return 0; }); };
    var g = Object.assign({}, base, { status: 'play', at: new Date().toISOString(), round: 1, left: base.entries.map(function (e) { return e.id; }), score: zeros(), rounds: [zeros(), zeros(), zeros()], next: zeros(), turn: { team: Math.floor(Math.random() * base.teams.length), giver: null, started_at: null, runner: null, cur: null, got: 0 } });
    delete g.over_at; g.turn.giver = fbNextGiver(g, g.turn.team); return g;
  }
  function fbRoll() {   // deal the people in the bowl into fbTeamCount teams, couples apart
    var pool = fbPool(), n = fbTeamCount;
    if (pool.people.length < n * 2) { fbPreview = null; renderFishbowl(); return; }
    fbPreview = { people: pool.people.slice(), teams: makeTeams(pool.people, n, true), ti: shuffled([0, 1, 2, 3, 4, 5]).slice(0, n) }; buzz([15, 60, 15]); renderFishbowl();
  }
  function fbStart() {
    var pool = fbPool(); if (!fbPreview || pool.people.length < fbPreview.teams.length * 2) return;
    var doc = fbFresh({ session: fbSession(), by: me, teams: fbPreview.teams, ti: fbPreview.ti, entries: shuffled(pool.words) });
    fbPreview = null; buzz([20, 50, 20]); fbWrite(doc, 'Couldn’t start');
  }
  function fbGo() {
    var g = JSON.parse(JSON.stringify(fb)); if (g.turn.started_at || g.turn.giver !== me) return;   // only the giver's own phone starts a turn
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
  listen('fishbowl-body', 'submit', function (e) {
    if (e.target.id !== 'fb-add') return;
    e.preventDefault();
    var inp = e.target.querySelector('input'), w = String(inp.value || '').replace(/\s+/g, ' ').trim().slice(0, 40), mine = fbMine();
    if (!w) return;
    if (mine.some(function (x) { return x.toLowerCase() === w.toLowerCase(); })) { toast('That one’s already in.'); return; }
    if (mine.length >= FB_WORDS) return;
    fbSaveMine(mine.concat([w])); buzz(6);
    var again = document.querySelector('#fb-add input'); if (again) again.focus();
  });
  listen('fishbowl-body', 'click', function (e) {
    var dr = e.target.closest('[data-fb-drop]'); if (dr) { var i = +dr.getAttribute('data-fb-drop'); fbSaveMine(fbMine().filter(function (x, k) { return k !== i; })); return; }
    var tn = e.target.closest('[data-fb-teamn]');
    if (tn) {
      fbTeamCount = Math.max(2, Math.min(3, fbTeamCount + (+tn.getAttribute('data-fb-teamn'))));
      if (fbPreview) fbRoll(); else renderFishbowl();   // a preview on screen re-rolls at the new size
      return;
    }
    if (e.target.closest('#fb-teams')) { fbRoll(); return; }
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
    ['Things that come in pairs', 'Items at a yard sale', 'Reasons to move to Colorado', 'Things that are spicy', 'Things sold by the pound', 'Things in a bunk room', 'Reasons to apologise to a neighbour', 'Bad names for a bakery'],
    ['Things you can set on fire', 'Something you’d hear at a hot tub party', 'The hot tub is no place for ______', 'Things Joe would do for a free beer', 'Things that are impossible to find when you need them', 'Candy you never finish', 'Reasons to sit by the window', 'Things that are salty'],
    ['Things you’d name a snowman', 'Things you find in the snow in spring', 'Reasons to change your name', 'Bad names for a coffee shop', 'Things you can juggle', 'Something you’d yell at the TV', 'Things people collect', 'Items in a camper van'],
    ['Reasons to call your mom', 'Things Liv would bring to a desert island', 'Things that are round', 'Things in a backpack', 'Things you’d do with a snow day off', 'Reasons to not answer the door', 'Bad names for a cruise ship', 'Things that are bumpy'],
    ['Something you’d find in a ski patrol hut', 'Things that are instantly regretted', 'Breakfast foods', 'Reasons for a group photo retake', 'Things that are see-through', 'Things you can order at a drive-through', 'Real men eat ______', 'Liv’s hidden talent'],
    ['Things in a Denver airport', 'Reasons to take a nap', 'Bad names for a hair salon', 'Things you can’t do in ski boots', 'Something you’d hear at a mountain bar', 'Things that come in a can', 'Items in a camping store', 'Reasons to get a tattoo'],
    ['Things that are checkered', 'Things that are better in the morning', 'Things in a hot chocolate', 'Reasons to be mad at a roommate', 'Bad names for a sports team', 'Terry’s autobiography title', 'Things that are bendy', 'Something you’d find in a mountain lodge lobby'],
    ['Things that stain', 'Items you can rent', 'Reasons to leave early on Sunday', 'Things that are soggy', 'Words with a silent letter', 'Things you need a permit for', 'Reasons to ditch a blind date', 'Bad names for a ski resort'],
    ['Things that are good with ranch', 'Something you’d hear in a sled line', '______ ruins a road trip', 'Things that make Terry mad', 'Things you have too many of', 'Items in a hotel minibar', 'Reasons to switch seats', 'Things that are wrinkled'],
    ['Things you’d name a hot tub', 'Things at a bonfire', 'Reasons your card got declined', 'Bad names for a theme park', 'Things that are shiny', 'Something you’d say to a bear', 'Things you inherit', 'Items in a lifeguard chair'],
    ['Reasons to drink water', 'Things Jess says in the group chat', 'Things that are magnetic', 'Famous dogs', 'Things in a kitchen at 7 a.m.', 'Reasons to miss the last lift', 'Bad names for a plumber', 'Things you can do in a hot tub'],
    ['Something you shouldn’t say on a first date', 'Things you’d find in a ski town bar', 'Items in a diaper bag', 'Reasons to make a toast', 'Things that are tiny', 'Words that rhyme with snow', 'Put ______ on the grocery list', 'Jess’s superpower'],
    ['Things on a cabin porch', 'Reasons to leave the slopes early', 'Bad names for a cat', 'Things that are good fried', 'Something you’d hear in a tube line', 'Things that get stuck in your teeth', 'Items in a tool box', 'Reasons to turn the music down'],
    ['Things that are pointy', 'Things in a vending machine', 'Things in a trunk', 'Reasons to carry cash', 'Bad names for a dentist', 'Kyle’s secret talent is ______', 'Things you can’t buy on Sunday', 'Something you’d find in a hunting lodge'],
    ['Things people hoard', 'Items on a camping checklist', 'Reasons to cry at a movie', 'Things that are neon', 'Things you’d name a moose', 'Things you do while waiting for pizza', 'Reasons to leave the cabin door unlocked', 'Bad names for a kid’s toy'],
    ['Things that are good on a stick', 'Something you’d hear from a ski instructor', 'Never ski with ______', 'Kyle’s guilty pleasure', 'Things that come in a box', 'Items in a glove', 'Reasons to pretend you’re asleep', 'Things that are squishy'],
    ['Bad names for a mountain', 'Things in a mountain cabin bathroom', 'Reasons to go to bed early', 'Bad names for a brewery', 'Things that are best on a Friday', 'Something you’d hear in a casino', 'Things that come in rolls', 'Items in an emergency kit'],
    ['Reasons for a group hug', 'Kyrsten’s dream job', 'Things that are hairy', 'Words that start with snow', 'Things you leave in the car overnight', 'Reasons to go outside in your socks', 'Bad names for a restaurant', 'Things that are dangerous when wet'],
    ['Something you’d hear at a ski swap', 'Things you forget on purpose', 'Items in a bachelorette bag', 'Reasons to turn your phone off', 'Things that are lumpy', 'Things you shouldn’t lick', 'The worst roommate has ______', 'Kyrsten’s catchphrase'],
    ['Things in a mountain lake', 'Reasons to never go back to a bar', 'Bad names for an airline', 'Things that are good with ketchup', 'Something you’d say at a bachelor party', 'Things you’d find in a lift line', 'Items you lose on vacation', 'Reasons to send a group text at 3 a.m.'],
    ['Things that are dusty', 'Things you’d name a fire pit', 'Things at a snowball fight', 'Reasons to leave a tip', 'Bad names for a hotel', 'Justin’s pre-game ritual involves ______', 'Things that are good on toast', 'Something you’d hear from a parent on the phone'],
    ['Things that come in flavours', 'Items in a ski bag', 'Reasons to move the couch', 'Things that are striped or spotted', 'Reasons to wake up early', 'Things you’d find in a cabin freezer', 'Reasons to take the long way', 'Bad names for a gym'],
    ['Things that are good in a sandwich', 'Something a lift operator says', 'I only drink ______ on weekends', 'Justin’s first words at the cabin', 'Things that are impossible to carry', 'Items in a hunting cabin', 'Reasons to trade bunks', 'Things that are gooey'],
    ['Things you shout when you win', 'Things that happen at check-out', 'Reasons to lose your phone', 'Bad names for a nail salon', 'Things that are good with butter', 'Something you’d hear on a snowmobile', 'Things that come in a jar', 'Items in a mechanic’s shop'],
    ['Reasons to walk home', 'Things said in this group chat', 'Things that are curly', 'Bad names for a motel', 'Things in the back of a pickup', 'Reasons to sleep on the couch', 'Bad names for a pizza place', 'Things you can’t eat with a fork'],
    ['Something you’d say to a snowplow driver', 'Things that get lost in the wash', 'Items in a hunter’s pocket', 'Reasons to cancel the hibachi', 'Things that are speckled', 'Words that sound made up', 'The couch smells like ______', 'Reasons we’re late to hibachi'],
    ['Things you buy at midnight', 'Reasons to hide the remote', 'Bad names for a boat rental', 'Things that are good cold the next day', 'Something you’d find in a ski boot', 'Things that scream', 'Items in a gondola', 'Reasons to leave the fire burning'],
    ['Things that are rubbery', 'Things in a camping bag', 'Things in a mountain weather forecast', 'Reasons to keep your boots on', 'Bad names for a tattoo parlour', 'Things that will happen at Winter Park', 'Things that are good with hot sauce', 'Something you’d hear at a hot tub at midnight'],
    ['Things that come with a warning', 'Items in a sled', 'Reasons for a redo', 'Things that are foggy', 'Things you’d name a ski run', 'Things that end a party', 'Reasons to eat in the car', 'Bad names for a wine'],
    ['Things that are good with a fried egg on top', 'Something you’d hear at a mountain wedding', 'Nobody warned me about ______', 'Nicknames for this cabin', 'Things you can’t un-see', 'Items in a snow globe', 'Reasons to leave the group chat on mute', 'Things that are icy'],
    ['Things that are heavy', 'Things on a cabin fridge door', 'Reasons to start a fight', 'Bad names for a cologne', 'Things that are good with peanut butter', 'Something a hot tub repair guy says', 'Things you’d do with a free afternoon', 'Items on a ski map'],
    ['Reasons to check the oven', 'Things to blame Mitch for', 'Things that are bouncy', 'Words that mean cold', 'Things in a Colorado dispensary', 'Reasons to miss the group photo', 'Bad names for a kids’ show', 'Things that are good drenched in syrup'],
    ['Something you’d hear at a tubing hill', 'Things that break at the worst time', 'Items in a lunch box', 'Reasons to start a group chat', 'Things that are lopsided', 'Reasons to borrow a truck', 'First rule of Mafia: ______', 'Reasons Drew is moderating again']
  ];
  var OT_LETTERS = 'ABCDEFGHIJKLMNOPRSTW', OT_SECS = 120;
  var ot = null, otLoaded = false, otSub = false, otBuzzed = null, otOpts = null;
  function subscribeOffTopic() {
    if (otSub || !store || !store.game) return;
    otSub = true;
    store.game('offtopic', function (doc) { var same = otLoaded && sameDoc(doc, ot); ot = doc; otLoaded = true; if (!same) renderOffTopic(); });
  }
  // A scratch pad for your own answers, kept on this phone only (nobody else sees it), keyed to the deal and the letter so
  // a re-roll starts clean. The × on a line clears it when the table finds a match.
  var otForce = false;
  function otRound(g) { return g.dealt_at + '|' + (g.letter || ''); }
  function otPad(g) { try { var v = JSON.parse(lsGet('cabin-haul-ot-pad') || 'null'); return v && v.round === otRound(g) && Array.isArray(v.a) ? v.a : []; } catch (e) { return []; } }
  function otSavePad(g, a) { lsSet('cabin-haul-ot-pad', JSON.stringify({ round: otRound(g), a: a })); var k = $('ot-standing'); if (k) k.textContent = otStanding(a); }
  function otStanding(a) { var n = a.filter(function (t) { return t && t.trim(); }).length; return n ? n + ' standing' : ''; }
  function otReadForm() { return Array.prototype.map.call(document.querySelectorAll('#ot-form .ot-in'), function (el) { return el.value.replace(/\s+/g, ' ').trim().slice(0, 40); }); }
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
      html += '<p class="info-sub">' + OT_CARDS.length + ' new cards to go with the box, with the thirteen of us worked in. Deal one and every phone shows the same card. Write your eight answers on your own phone, one per line, starting with the letter; nobody else can see your pad. When the table finds a match, tap × to clear the line and count what’s left.';
      html += '<div class="mafia-opts">' +
        '<div class="opt-row"><span>Roll a letter <span class="info-sub">(off if you’re using the die)</span></span><button type="button" class="toggle" data-ot-opt="letter" aria-pressed="' + !!o.letter + '" aria-label="Roll a letter"></button></div>' +
        '<div class="opt-row"><span>Run the two-minute clock <span class="info-sub">(off if you’re using the timer)</span></span><button type="button" class="toggle" data-ot-opt="clock" aria-pressed="' + !!o.clock + '" aria-label="Run the clock"></button></div></div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="ot-deal">📝 Deal a card</button></div>';
      html += '<div class="deal-sum">' + used.length + ' of ' + OT_CARDS.length + ' cards used' + (used.length ? ' · <button type="button" class="linkbtn" id="ot-shuffle">Shuffle them back in</button>' : '') + '</div>';
      body.innerHTML = html; return;
    }
    var left = otLeft(g), card = OT_CARDS[g.card] || OT_CARDS[0], num = 101 + g.card, round = otRound(g);
    status.textContent = otChip(g);
    var liveForm = $('ot-form');
    if (liveForm && liveForm.getAttribute('data-round') === round && !otForce) return;   // same card still out: leave the pad alone while someone is writing on it
    otForce = false;
    if (g.letter || g.started_at) {
      html += '<div class="ot-top">' + (g.letter ? '<div class="ot-letter" id="ot-letter-badge">' + g.letter + '</div>' : '<div class="ot-note">Roll the die</div>') +
        (g.started_at ? '<div class="ot-clock' + (left > 0 && left <= 10000 ? ' low' : '') + '" id="ot-clock">' + (left > 0 ? '<span data-ot-clock>' + mmss(left) + '</span>' : '<span class="pd">Pencils down</span>') + '</div>' : '<div class="ot-note right">Flip the timer</div>') + '</div>';
    }
    var a = otPad(g);
    html += '<div class="ot-card"><div class="ot-num">' + num + '</div><div id="ot-form" data-round="' + esc(round) + '"><ol>' + card.map(function (c, i) {
      return '<li><span class="n">' + (i + 1) + '.</span><div class="ot-q"><span>' + esc(c) + '</span><div class="ot-line"><input class="ot-in" data-ot-i="' + i + '" value="' + esc(a[i] || '') + '" maxlength="40" autocomplete="off" autocorrect="off" autocapitalize="words" enterkeyhint="next" placeholder="' + (g.letter ? esc(g.letter) + '…' : '…') + '"><button type="button" class="ot-x" data-ot-x="' + i + '" aria-label="Clear line ' + (i + 1) + '">×</button></div></div></li>';
    }).join('') + '</ol></div>' +
      '<div class="ot-formfoot"><span class="info-sub">Your pad, on your phone only. Tap × on a line the table matched.</span><span class="info-sub" id="ot-standing">' + esc(otStanding(a)) + '</span></div>' +
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
    otBuzzed = g.started_at; otForce = true; renderOffTopic();
    if (!$('offtopic-body').hidden) { buzz([80, 40, 80, 40, 160]); toast('Off Topic: pencils down!'); }
  }
  listen('offtopic-body', 'click', function (e) {
    var op = e.target.closest('[data-ot-opt]'); if (op) { var o = otOptions(), key = op.getAttribute('data-ot-opt'); o[key] = !o[key]; buzz(6); renderOffTopic(); return; }
    var x = e.target.closest('[data-ot-x]');
    if (x && ot && ot.status === 'card') { var xi = +x.getAttribute('data-ot-x'), inp = document.querySelector('#ot-form [data-ot-i="' + xi + '"]'); if (inp) { inp.value = ''; } otSavePad(ot, otReadForm()); buzz(6); return; }
    if (e.target.closest('#ot-deal') || e.target.closest('#ot-next')) { otDeal(); return; }
    if (!ot) return;
    if (e.target.closest('#ot-shuffle')) { otWrite(Object.assign({}, ot, { used: [] })); return; }
    if (e.target.closest('#ot-reroll')) { otBuzzed = null; buzz(8); otWrite(Object.assign({}, ot, { letter: otLetter(ot.letter) }, ot.started_at ? { started_at: new Date().toISOString() } : {})); return; }
    if (e.target.closest('#ot-restart')) { otBuzzed = null; buzz(8); otWrite(Object.assign({}, ot, { started_at: new Date().toISOString() })); return; }
    if (e.target.closest('#ot-away')) { otOpts = Object.assign({ letter: true, clock: true }, ot.opts || {}); otWrite(Object.assign({}, ot, { status: 'ended', ended_at: new Date().toISOString() }), 'Couldn’t put it away'); }
  });

  listen('offtopic-body', 'input', function (e) { if (e.target.closest('.ot-in') && ot && ot.status === 'card') otSavePad(ot, otReadForm()); });
  listen('offtopic-body', 'keydown', function (e) {   // Next on the keyboard hops to the next line
    if (e.key !== 'Enter' || !e.target.closest('.ot-in')) return;
    e.preventDefault(); var all = document.querySelectorAll('#ot-form .ot-in'), i = +e.target.getAttribute('data-ot-i'); if (all[i + 1]) all[i + 1].focus(); else e.target.blur();
  });

  // ---- Terry’s Casino ----
  // Blackjack, bubble craps, hold ’em, mountain slots and Kyrkat’s wheel, played against the house on your own phone,
  // banked in Terry coin. One document per person (game-casino-<name>): balance, hands, net, best win, loans taken when
  // broke. The hand itself lives on the phone; the bet leaves the bank when it starts and the payout lands when it ends.
  var TC_START = 100, TC_LOAN = 50, TC_CHIPS = [5, 10, 25, 50, 100, 250], HOUSE = 'Terry';
  // The house is Terry: every coin the tables win off anyone else lands in Terry's bank, and every coin they pay out
  // comes out of it. Each player's own document carries the house's running take from them (no two phones ever write
  // the same document), and Terry's bank is his own balance plus the sum of those.
  function houseTake() { var t = 0; Object.keys(casino).forEach(function (n) { if (n !== HOUSE) t += (casino[n].house || 0); }); return t; }
  function effBal(n) { var d = casino[n]; return (d ? d.bal : TC_START) + stimIssued() + dividendsIssued() + grantsFor(n) + (n === HOUSE ? houseTake() : 0) + markPositions(d && d.pos) + sbNetFor(n); }
  var CAS_GAMES = [['smash', '🎮 Smash book'], ['blackjack', '🃏 Blackjack'], ['craps', '🫧 Bubble craps'], ['holdem', '♠️ Hold ’em'], ['slots', '🏔️ Slots'], ['wheel', '🐈‍⬛ Kyrkat’s wheel'], ['horses', '🏇 Churchill Downs'], ['market', '📈 Derivatives']];
  var CAS_BOSSES = ['Terry', 'Mitch'], casClosed = null;
  // Who sees the Reserve's books (grants, escrow, seizures): the chairman's circle. Everyone else sees the public face.
  var RESERVE_INSIDERS = ['Mitch', 'Terry', 'Joe'];
  function insider() { return RESERVE_INSIDERS.indexOf(me) >= 0; }
  // Claude's seat on the floor: a bank that grows by the clock, one to ten coin every five minutes, the same on every phone.
  var CLAUDE_T0 = Date.parse('2026-10-25T03:00:00Z');
  function claudeSeat() { var slots = Math.max(0, Math.floor((Date.now() - CLAUDE_T0) / 300000)), bal = TC_START, best = 0; for (var i = 1; i <= slots; i++) { var w = 1 + Math.floor((hashNoise(i * 3.7 + 11) + 1) / 2 * 10); if (w > 10) w = 10; bal += w; if (w > best) best = w; } return { by: 'Claude', bal: bal + dividendsIssued(), hands: slots, net: bal - TC_START, best: best, loans: 0 }; }
  // The Terry Reserve: what backs the coin, and the printing press. Reserve assets are valued in Terry coin; the money
  // supply is every bank added up (loans and stimulus mint new coin, table play only moves it). Stimulus is one shared
  // document (casinoreserve): the total issued per person, which every bank includes.
  var RESERVE_ASSETS = [['\uD83C\uDF7A', '24 Coors Banquet', 240], ['\uD83D\uDEC1', 'One hot tub, heated', 500], ['\uD83C\uDF64', 'Mitch’s hibachi plate', 65], ['\uD83D\uDC08\u200D\u2B1B', 'One Kyrkat (priceless, booked at)', 1000], ['\uD83D\uDD11', 'The door code', 300]];
  var reserve = null, TC_STIM = 25, resOpen = false, resWho = null, resAmt = '100';   // the panel's picks survive a re-render   // the Reserve stays open across re-renders once you open it
  // Standing grants by order of the chairman, counted in the bank of the person named (the Reserve document can add more).
  var RESERVE_GRANTS = {};   // 2026-10-25: 500 to Joe by Mitch, then taken back the same night
  // Standing dividends to every player, by order of the chairman; the latest note goes up on the sign.
  var DIVIDENDS = [{ n: 100, note: 'It’s nice here.', by: 'Mitch', at: '2026-10-25T04:00:00Z' }];
  function dividendsIssued() { return DIVIDENDS.reduce(function (t, d) { return t + d.n; }, 0) + ((reserve && reserve.dividends) || 0); }
  function latestDividend() { var fromDoc = ((reserve && reserve.log) || []).filter(function (e) { return e.kind === 'dividend'; }).slice(-1)[0]; return fromDoc || DIVIDENDS[DIVIDENDS.length - 1] || null; }
  function stimIssued() { return (reserve && reserve.issued) || 0; }
  function grantsFor(n) { return (RESERVE_GRANTS[n] || 0) + ((reserve && reserve.grants && reserve.grants[n]) || 0); }
  // The escrow account: coin the bank holds back, out of circulation. Opened with 5,000; every movement is in the log.
  var ESCROW_START = 5000, RATE_DEFAULT = 4.25;
  function fedRate() { return reserve && typeof reserve.rate === 'number' ? reserve.rate : RATE_DEFAULT; }   // the Terry Federal Funds Rate, % per day, charged on short positions
  function escrowBal() { return ESCROW_START + ((reserve && reserve.escrow) || 0); }
  function reserveWrite(patch, logEntry, note) {   // one shared document; the bosses are the only writers
    var rs = Object.assign({}, reserve || {}, { issued: stimIssued(), grants: Object.assign({}, (reserve && reserve.grants) || {}), escrow: (reserve && reserve.escrow) || 0 }, patch);   // keep every field the document already has (rate, dividends)
    rs.log = ((reserve && reserve.log) || []).slice(-24).concat([Object.assign({ by: me, at: new Date().toISOString() }, logEntry)]);
    reserve = rs; renderCasino(); toast(note); buzz([20, 40, 20]);
    store.setGame('casinoreserve', rs).catch(function (err) { toast('The vault stuck: ' + ((err && err.message) || err)); });
  }
  function moneySupply() { return NAMES.filter(function (n) { return casino[n] || n === HOUSE || sbPlayed(n); }).reduce(function (t, n) { return t + effBal(n); }, 0); }
  function reserveValue() { return RESERVE_ASSETS.reduce(function (t, a) { return t + a[2]; }, 0); }
  var casino = {}, casinoLoaded = false, casinoSub = false, casGame = 'smash', casBet = 10, bj = null, craps = null, holdem = null, slots = null, wheel = null, casAnim = null, fieldOn = false, wheelBet = { kind: 'red', n: 17 };
  function subscribeCasino() {
    if (casinoSub || !store || !store.games) { casinoLoaded = true; return; }
    casinoSub = true;
    subscribeMarket();
    store.game('casinosmash', function (doc) { var same = sameDoc(doc, smashBook); smashBook = doc; if (!same) renderCasino(); });
    store.games('smashbet-', function (rows) { var next = {}; rows.forEach(function (r) { if (r.doc && r.doc.by) next[r.doc.by] = r.doc; }); var same = sameDoc(next, smashBets); smashBets = next; if (!same) renderCasino(); });
    store.game('casinoreserve', function (doc) { var same = sameDoc(doc, reserve); reserve = doc; if (!same) renderCasino(); });
    store.game('casinoclose', function (doc) { var same = sameDoc(doc, casClosed); casClosed = doc && doc.closed ? doc : null; if (!same) { renderCasino(); renderAwards(); } });
    store.games('casino-', function (rows) {
      var next = {}; rows.forEach(function (r) { if (r.doc && r.doc.by) next[r.doc.by] = r.doc; });
      var same = casinoLoaded && sameDoc(next, casino); casino = next; casinoLoaded = true; if (!same) { renderCasino(); renderAwards(); }
    });
  }
  // Terry coin: Terry's face on a gold rim wherever it shows in markup; plain text (a coin emoji) for toasts and the like
  function tc(n) { return '<i class="tcoin" role="img" aria-label="Terry coin"></i>' + Math.round(n).toLocaleString(); }
  function tcText(n) { return '\uD83E\uDE99 ' + Math.round(n).toLocaleString(); }
  function myBank() { return casino[me] || { by: me, bal: TC_START, hands: 0, net: 0, best: 0, loans: 0, house: 0 }; }
  function myBal() { return effBal(me); }
  function bankWrite(patch) {
    var doc = Object.assign({}, myBank(), patch, { by: me, at: new Date().toISOString() });
    casino = Object.assign({}, casino); casino[me] = doc;
    store.setGame('casino-' + me, doc).catch(function (e) { toast('The bank didn’t take that: ' + ((e && e.message) || e)); });
    return doc;
  }
  function settle(bet, win) {   // win: coins back including the stake (0 = lost it all)
    var b = myBank(), delta = win - bet;
    bankWrite({ bal: b.bal + win, hands: (b.hands || 0) + 1, net: (b.net || 0) + delta, best: Math.max(b.best || 0, delta), house: (b.house || 0) + (me === HOUSE ? 0 : bet - win) });
    buzz(win > bet ? [20, 40, 20, 40, 60] : win ? 15 : 60);
  }
  function stake(bet) { var b = myBank(); if (bet > myBal()) { toast('You don’t have ' + tcText(bet) + '.'); return false; } bankWrite({ bal: b.bal - bet }); return true; }
  function casInHand() { return (casGame === 'blackjack' && bj && !bj.done) || (casGame === 'craps' && craps && !craps.done) || (casGame === 'holdem' && holdem && !holdem.done) || (casGame === 'slots' && slots && !slots.done) || (casGame === 'wheel' && wheel && !wheel.done) || (casGame === 'horses' && race && !race.done); }
  // Churchill Downs: six horses, a fun coat and mane each, fixed odds. Win pays the odds, place (top two) half the odds,
  // show (top three) a third. The race itself is run on this phone, fair and random, the favourites a touch quicker.
  // The stable: every race draws six at random, so the names keep coming. Odds and pace go together.
  var STABLE = [
    { name: 'Hot Tub Time Machine', coat: '#c0392b', mane: '#ffd60a', silks: '#ffd60a', odds: 2, pace: 1.06 },
    { name: 'Mitch’s Plate (Split Six Ways)', coat: '#2c3e50', mane: '#ff6b6b', silks: '#ff6b6b', odds: 3, pace: 1.03 },
    { name: 'Kyle’s Mini Golf Game', coat: '#8e44ad', mane: '#53d337', silks: '#53d337', odds: 4, pace: 1.0 },
    { name: 'Seven Out', coat: '#1f6fb2', mane: '#ff9f43', silks: '#ff9f43', odds: 6, pace: 0.98 },
    { name: 'Kyrkat', coat: '#111', mane: '#ff69b4', silks: '#ff69b4', odds: 8, pace: 0.96 },
    { name: 'Terry’s Loan', coat: '#2d6a4f', mane: '#30d5c8', silks: '#30d5c8', odds: 12, pace: 0.93 },
    { name: 'Joe Would Do It For A Free Beer', coat: '#b7950b', mane: '#fff', silks: '#fff3b0', odds: 3, pace: 1.03 },
    { name: 'Joe’s Nickname (Pending)', coat: '#6d4c41', mane: '#ff4757', silks: '#ff4757', odds: 5, pace: 0.99 },
    { name: 'Joe Just Said Hi', coat: '#e67e22', mane: '#2c3e50', silks: '#f5f5f5', odds: 7, pace: 0.97 },
    { name: 'Average Joe (Allegedly)', coat: '#95a5a6', mane: '#111', silks: '#ffd60a', odds: 4, pace: 1.0 },
    { name: 'Joe Said Five Minutes', coat: '#16a085', mane: '#ff9f43', silks: '#ff9f43', odds: 9, pace: 0.95 },
    { name: 'Not A Bed', coat: '#7f8c8d', mane: '#ffd60a', silks: '#c0392b', odds: 2, pace: 1.06 },
    { name: 'I-70 Traffic', coat: '#c0392b', mane: '#fff', silks: '#111', odds: 15, pace: 0.9 },
    { name: 'Starts The Shots', coat: '#f39c12', mane: '#c0392b', silks: '#c0392b', odds: 3, pace: 1.03 },
    { name: 'Best Cocktail This Weekend', coat: '#d35400', mane: '#30d5c8', silks: '#30d5c8', odds: 6, pace: 0.98 },
    { name: 'Most F’d Up', coat: '#2c3e50', mane: '#53d337', silks: '#8e44ad', odds: 2, pace: 1.06 },
    { name: 'Luke’s Smash Record', coat: '#d63a1f', mane: '#ffd60a', silks: '#fff', odds: 5, pace: 0.99 },
    { name: 'Drew Is Moderating', coat: '#3f7cae', mane: '#fff', silks: '#ffd60a', odds: 4, pace: 1.0 },
    { name: 'Katelyn Is Always Right', coat: '#8e44ad', mane: '#ffd60a', silks: '#ff69b4', odds: 2, pace: 1.07 },
    { name: 'Kelly’s Walk-Up Song', coat: '#ff69b4', mane: '#111', silks: '#111', odds: 3, pace: 1.03 },
    { name: 'Gabby’s Next Tattoo', coat: '#111', mane: '#30d5c8', silks: '#30d5c8', odds: 6, pace: 0.98 },
    { name: 'Baddest In Town', coat: '#e8c547', mane: '#111', silks: '#111', odds: 2, pace: 1.07 },
    { name: 'Showed Up Saturday', coat: '#27ae60', mane: '#fff', silks: '#ff6b6b', odds: 8, pace: 0.96 },
    { name: 'Claude At Air Hockey', coat: '#d97757', mane: '#111', silks: '#111', odds: 20, pace: 0.88 },
    { name: 'Door Code (Do Not Share)', coat: '#34495e', mane: '#e8c547', silks: '#e8c547', odds: 10, pace: 0.94 },
    { name: 'Pencils Down', coat: '#ffd60a', mane: '#111', silks: '#111', odds: 7, pace: 0.97 }
  ];
  var field = null;
  function raceField() {   // six from the stable, no two in the same coat
    if (!field) { var coats = {}; field = shuffled(STABLE.map(function (_, i) { return i; })).filter(function (i) { var c = STABLE[i].coat; if (coats[c]) return false; coats[c] = true; return true; }).slice(0, 6); }
    return field.map(function (i) { return STABLE[i]; });
  }
  var race = null, racePick = 0, raceKind = 'win', raceTimer = null;
  function raceStart() {
    if (!stake(casBet)) return;
    var H = raceField();
    race = { horse: racePick, kind: raceKind, bet: casBet, pos: H.map(function () { return 0; }), order: [], done: false, result: null, t0: null };
    buzz([10, 30, 10]); renderCasino();
    var last = null;
    function frame(ts) {
      if (!race || race.done) return;
      if (!race.t0) { race.t0 = ts; last = ts; }
      var dt = Math.min(50, ts - last) / 1000; last = ts;
      race.pos.forEach(function (p, i) {
        if (race.order.indexOf(i) >= 0) return;
        var h = raceField()[i], surge = Math.random() < 0.08 ? 1.6 : 1, v = (14 + Math.random() * 10) * h.pace * surge;   // % per second
        race.pos[i] = Math.min(100, p + v * dt);
        if (race.pos[i] >= 100) race.order.push(i);
      });
      Array.prototype.forEach.call(document.querySelectorAll('.track .horse'), function (el) { var i = +el.getAttribute('data-i'); el.style.left = 'calc(' + race.pos[i] + '% - ' + (race.pos[i] * 0.56) + 'px)'; });
      var lead = $('race-lead'); if (lead) { var li = race.order.length ? race.order[0] : race.pos.indexOf(Math.max.apply(null, race.pos)); lead.textContent = (race.order.length ? 'Winner: ' : 'Leading: ') + raceField()[li].name; }
      if (race.order.length >= 3 && ts - race.t0 > 3000) { raceFinish(); return; }
      if (ts - race.t0 > 12000) { race.pos.forEach(function (p, i) { if (race.order.indexOf(i) < 0) race.order.push(i); }); raceFinish(); return; }
      raceTimer = requestAnimationFrame(frame);
    }
    raceTimer = requestAnimationFrame(frame);
  }
  function raceFinish() {
    var h = raceField()[race.horse], place = race.order.indexOf(race.horse), win = 0, r;
    var k = race.kind === 'win' ? (place === 0 ? h.odds : 0) : race.kind === 'place' ? (place >= 0 && place <= 1 ? h.odds / 2 : 0) : (place >= 0 && place <= 2 ? h.odds / 3 : 0);
    if (k) { win = Math.round(race.bet * (k + 1)); r = h.name + (place === 0 ? ' wins it!' : place === 1 ? ' runs second.' : ' shows third.') + ' Your ' + race.kind + ' bet pays.'; }
    else r = raceField()[race.order[0]].name + ' wins. ' + h.name + (place < 0 ? ' never got there.' : place === 1 ? ' second.' : place === 2 ? ' third.' : ' finished ' + (place + 1) + 'th.') + ' Tear up the ticket.';
    race.done = true; race.result = r; race.win = win; settle(race.bet, win); renderCasino();
  }
  // ---- The derivatives desk ----
  // Synthetic Collateralized Terry Coin Obligations (STCOs), three tranches cut from the Terry Coin Index: Senior (sleepy),
  // Mezzanine (the index), Equity (four times the move). The index is a function of the clock that every phone computes
  // the same way (smooth seeded noise), nudged by real order flow kept in one shared document, so the price is the same
  // on every screen without a server. A hundred and fifty named bots quote the book and print the tape; they never
  // sleep, which is what passes for liquidity here. Positions live on your bank document and are marked to market.
  var TRANCHES = [
    { k: 'senior', name: 'Senior STCO', tag: 'AAA (Terry’s word)', beta: 0.35, note: 'Barely moves. Pays like it.' },
    { k: 'mezz', name: 'Mezzanine STCO', tag: 'BBB-ish', beta: 1, note: 'The index, straight.' },
    { k: 'equity', name: 'Equity STCO', tag: 'Toxic waste', beta: 4, note: 'Four times the move, both ways.' }
  ];
  var BOT_FIRST = ['Hedgie', 'Chad', 'Brynn', 'Vlad', 'Quant', 'Margin', 'Yolo', 'Delta', 'Gamma', 'Theta', 'Kappa', 'Sigma', 'Lambda', 'Boomer', 'Zoomer'];
  var BOT_LAST = ['McFund', 'Capital', 'Partners', 'Holdings', 'Overleveraged', 'Degen', 'Advisors', 'LLC', 'Family Office', 'Trust'];
  var BOTS = []; (function () { for (var i = 0; i < 150; i++) BOTS.push(BOT_FIRST[(i * 7) % BOT_FIRST.length] + ' ' + BOT_LAST[(i * 3 + Math.floor(i / 15)) % BOT_LAST.length] + ' #' + ('00' + (i + 1)).slice(-3)); })();
  var market = null, marketSub = false, mktTranche = 'mezz', mktQty = 1, mktTimer = null;
  function hashNoise(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }   // -1..1, the same on every phone
  function smoothNoise(t) { var i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return hashNoise(i) * (1 - u) + hashNoise(i + 1) * u; }
  function indexAt(ms) {   // the Terry Coin Index: a slow swell, a faster wobble, and the crowd's order flow
    var m = ms / 60000, flow = market ? (market.net || 0) : 0;
    var raw = 100 * Math.exp(0.18 * smoothNoise(m / 9) + 0.07 * smoothNoise(m / 1.5 + 50) + 0.025 * smoothNoise(m * 6 + 900)) + flow * 0.35;
    return Math.max(5, raw);
  }
  function tranchePrice(k, ms) {   // a note is a tenth of the tranche level, so a 100-coin bank buys a handful
    var idx = indexAt(ms || Date.now()), t = TRANCHES.filter(function (x) { return x.k === k; })[0];
    return Math.max(0.05, Math.round((100 + (idx - 100) * t.beta) * 10) / 100);
  }
  // A player contract starts at par (10) and moves a coin for every ten the player is up or down at the tables and the
  // desk, less 2.5 a loan. Long it and you win when they win; short it and you win when they lose. Shorts pay the Terry
  // Federal Funds Rate per day while open, and need cash on hand to cover the notional when opened.
  function playerPrice(n) { var d = casino[n] || {}; return Math.max(0.5, Math.round((10 + ((d.net || 0) + (d.realized || 0)) / 10 - (d.loans || 0) * 2.5) * 100) / 100); }
  function priceFor(k, ms) { return k.indexOf('p:') === 0 ? playerPrice(k.slice(2)) : tranchePrice(k, ms); }
  function markPositions(pos) { if (!pos) return 0; var t = 0, now = Date.now(); Object.keys(pos).forEach(function (k) { var p = pos[k]; if (p && p.qty) t += p.qty * priceFor(k, now); }); return Math.round(t * 100) / 100; }
  var pbPick = null;
  function playerTrade(n, side) {   // side: 'long' buys, 'short' sells; a signed quantity on the position
    var k = 'p:' + n, qty = Math.max(1, Math.min(99, Math.round(mktQty))), b = myBank(), pos = Object.assign({}, b.pos || {}), p = pos[k] ? Object.assign({}, pos[k]) : { qty: 0, avg: 0 }, px = playerPrice(n), d = side === 'long' ? qty : -qty, cash = b.bal + stimIssued() + dividendsIssued() + grantsFor(me) + (me === HOUSE ? houseTake() : 0);
    var notional = Math.round(px * qty * 100) / 100, realized = 0, funding = 0, now = Date.now();
    if (side === 'long' && p.qty >= 0 && notional > cash) { toast('You don’t have ' + tcText(notional) + ' in cash.'); return; }
    if (side === 'short' && p.qty <= 0 && notional > cash) { toast('A short needs ' + tcText(notional) + ' of cash as collateral. You have ' + tcText(cash) + '.'); return; }
    var closing = (p.qty > 0 && d < 0) || (p.qty < 0 && d > 0) ? Math.min(Math.abs(p.qty), qty) : 0;
    if (closing) {
      realized = Math.round((p.qty > 0 ? (px - p.avg) : (p.avg - px)) * closing * 100) / 100;
      if (p.qty < 0) funding = Math.round(p.avg * closing * (fedRate() / 100) * Math.max(0, (now - (p.openAt || now)) / 86400000) * 100) / 100;
    }
    var newQty = p.qty + d, opening = qty - closing;
    if (opening) { var oldAbs = Math.abs(p.qty) - closing; p.avg = oldAbs + opening ? (p.avg * oldAbs + px * opening) / (oldAbs + opening) : px; if (!oldAbs) p.openAt = now; }
    p.qty = newQty; if (!p.qty) { p.avg = 0; delete p.openAt; } pos[k] = p;
    bankWrite({ bal: Math.round((b.bal - d * px - funding) * 100) / 100, pos: pos, trades: (b.trades || 0) + 1, realized: Math.round(((b.realized || 0) + realized - funding) * 100) / 100 });
    buzz(side === 'long' ? [10, 30, 10] : 12); renderCasino();
    toast((side === 'long' ? 'Long ' : 'Short ') + qty + ' ' + n + ' at ' + px.toFixed(2) + (closing ? '. Closed ' + closing + (realized >= 0 ? ', made ' : ', lost ') + tcText(Math.abs(realized)) + (funding ? ' after ' + tcText(funding) + ' funding' : '') : '') + '.');
  }
  function playerBookHtml(mb) {
    var pos = mb.pos || {}, rows = NAMES.map(function (n) { var px = playerPrice(n), q = (pos['p:' + n] && pos['p:' + n].qty) || 0, d = casino[n] || {}; return { n: n, px: px, q: q, d: d }; });
    var held = rows.filter(function (r) { return r.q; });
    return '<div class="pb"><div class="mkt-title">Player book · par 10 · a coin a move for every 10 they win or lose · shorts pay ' + fedRate().toFixed(2) + '% a day</div>' +
      (held.length ? '<div class="pb-held">' + held.map(function (r) { var p = pos['p:' + r.n], pl = Math.round((r.q > 0 ? (r.px - p.avg) : (p.avg - r.px)) * Math.abs(r.q) * 100) / 100; return '<span class="' + (pl >= 0 ? 'up' : 'down') + '">' + (r.q > 0 ? 'Long ' : 'Short ') + Math.abs(r.q) + ' ' + esc(r.n) + ' @ ' + p.avg.toFixed(2) + ' <b>' + (pl >= 0 ? '+' : '') + pl.toFixed(2) + '</b></span>'; }).join('') + '</div>' : '') +
      '<div class="pb-list">' + rows.map(function (r) { return '<button type="button" data-pb="' + esc(r.n) + '" aria-pressed="' + (pbPick === r.n) + '"><span class="nm">' + esc(r.n === me ? 'You' : r.n) + (r.q ? '<small>' + (r.q > 0 ? 'long ' : 'short ') + Math.abs(r.q) + '</small>' : '') + '</span><span class="px ' + (r.px > 10 ? 'up' : r.px < 10 ? 'down' : '') + '">' + r.px.toFixed(2) + '</span><span class="net">' + (r.d.hands || r.d.trades ? ((r.d.net || 0) + (r.d.realized || 0) >= 0 ? '+' : '') + Math.round((r.d.net || 0) + (r.d.realized || 0)) + (r.d.loans ? ' · owes ' + r.d.loans * TC_LOAN : '') : 'no action yet') + '</span></button>'; }).join('') + '</div>' +
      (pbPick ? '<div class="cas-btns two"><button type="button" class="big-btn" id="pb-long"' + (casClosed ? ' disabled' : '') + '>Long ' + mktQty + ' ' + esc(pbPick) + ' · ' + tc(playerPrice(pbPick) * mktQty) + '</button><button type="button" class="big-btn stand" id="pb-short"' + (casClosed ? ' disabled' : '') + '>Short ' + mktQty + '</button></div>' : '<div class="slot-hint">Tap a player, then go long or short with the notes count above.</div>') + '</div>';
  }
  function subscribeMarket() { if (marketSub || !store || !store.game) return; marketSub = true; store.game('casinomarket', function (doc) { var same = sameDoc(doc, market); market = doc; if (!same && casGame === 'market') renderCasino(); }); }
  function bookFor(k, ms) {   // eight bids and eight asks from the bots, re-quoted every ten seconds
    var p = tranchePrice(k, ms), slot = Math.floor(ms / 10000), bids = [], asks = [];
    for (var i = 1; i <= 8; i++) {
      var spread = p * 0.004 * i, b = BOTS[(slot * 13 + i * 7) % BOTS.length], a = BOTS[(slot * 17 + i * 11 + 75) % BOTS.length];
      bids.push({ px: Math.max(0.5, Math.round((p - spread) * 100) / 100), qty: 1 + ((slot + i * 3) % 9), who: b });
      asks.push({ px: Math.round((p + spread) * 100) / 100, qty: 1 + ((slot * 5 + i) % 9), who: a });
    }
    return { bids: bids, asks: asks };
  }
  function tapeFor(k, ms) {   // the last prints: bots every few seconds, plus whatever people actually traded
    var out = [], now = ms;
    for (var i = 0; i < 6; i++) { var t = now - i * 7000 - ((Math.floor(now / 7000) * 31) % 5000), px = tranchePrice(k, t); out.push({ t: t, px: px, qty: 1 + ((Math.floor(t / 7000) * 7 + i) % 12), who: BOTS[(Math.floor(t / 7000) * 29 + i * 13) % BOTS.length], side: hashNoise(Math.floor(t / 7000) + i) > 0 ? 'buy' : 'sell', bot: true }); }
    ((market && market.tape) || []).filter(function (x) { return x.k === k; }).forEach(function (x) { out.push({ t: new Date(x.at).getTime(), px: x.px, qty: x.qty, who: x.by, side: x.side, bot: false }); });
    return out.sort(function (a, b) { return b.t - a.t; }).slice(0, 8);
  }
  function mktTrade(side) {
    var k = mktTranche, qty = Math.max(1, Math.min(99, Math.round(mktQty))), b = myBank(), pos = Object.assign({}, b.pos || {}), p = pos[k] ? Object.assign({}, pos[k]) : { qty: 0, avg: 0 }, now = Date.now();
    var book = bookFor(k, now), px = side === 'buy' ? book.asks[0].px : book.bids[0].px, cost = Math.round(px * qty * 100) / 100;   // you lift the best ask, or hit the best bid: the bots are always there
    if (side === 'buy') {
      if (cost > b.bal + stimIssued() + dividendsIssued() + grantsFor(me) + (me === HOUSE ? houseTake() : 0)) { toast('You don’t have ' + tcText(cost) + ' in cash. Sell something, or lose less.'); return; }
      p.avg = p.qty + qty ? (p.avg * p.qty + px * qty) / (p.qty + qty) : px; p.qty += qty; pos[k] = p;
      bankWrite({ bal: b.bal - cost, pos: pos, trades: (b.trades || 0) + 1 });
    } else {
      if (p.qty < qty) { toast('You only hold ' + p.qty + ' ' + (p.qty === 1 ? 'note' : 'notes') + ' of that.'); return; }
      p.qty -= qty; if (!p.qty) p.avg = 0; pos[k] = p;
      bankWrite({ bal: b.bal + cost, pos: pos, trades: (b.trades || 0) + 1, realized: (b.realized || 0) + Math.round((px - (b.pos && b.pos[k] ? b.pos[k].avg : px)) * qty * 100) / 100 });
    }
    var doc = { net: ((market && market.net) || 0) + (side === 'buy' ? qty : -qty) * (k === 'equity' ? 0.5 : k === 'senior' ? 0.2 : 0.35), tape: ((market && market.tape) || []).slice(-29).concat([{ k: k, px: px, qty: qty, by: me, side: side, at: new Date(now).toISOString() }]), at: new Date(now).toISOString() };
    market = doc; buzz(side === 'buy' ? [10, 30, 10] : 12); renderCasino();
    toast((side === 'buy' ? 'Bought ' : 'Sold ') + qty + ' ' + TRANCHES.filter(function (x) { return x.k === k; })[0].name + ' at ' + px.toFixed(2) + '. Filled by ' + (side === 'buy' ? book.asks[0].who : book.bids[0].who) + '.');
    store.setGame('casinomarket', doc).catch(function (e) { toast('The exchange hiccuped: ' + ((e && e.message) || e)); });
  }
  function sparkline(k, ms) {   // the last hour, one point a minute
    var pts = []; for (var i = 60; i >= 0; i--) pts.push(tranchePrice(k, ms - i * 60000));
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), span = hi - lo || 1;
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + (i * (300 / 60)).toFixed(1) + ' ' + (60 - (p - lo) / span * 56 - 2).toFixed(1); }).join(' ');
    var up = pts[pts.length - 1] >= pts[0];
    return '<svg class="spark" viewBox="0 0 300 60" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + (up ? '#53d337' : '#ff4757') + '" stroke-width="2"/></svg>';
  }
  function marketTick() {   // every second: prices, the book and the tape, without touching the controls
    if (casGame !== 'market' || !$('mkt-desk')) return;
    var now = Date.now();
    Array.prototype.forEach.call(document.querySelectorAll('[data-mkt-px]'), function (el) { var k = el.getAttribute('data-mkt-px'), p = tranchePrice(k, now), was = +el.getAttribute('data-was') || p; el.textContent = p.toFixed(2); el.classList.toggle('up', p > was); el.classList.toggle('down', p < was); el.setAttribute('data-was', p); });
    var idx = $('mkt-index'); if (idx) idx.textContent = indexAt(now).toFixed(2);
    var book = bookFor(mktTranche, now), bk = $('mkt-book');
    if (bk) bk.innerHTML = book.asks.slice().reverse().map(function (o) { return '<div class="ask"><span>' + esc(o.who) + '</span><b>' + o.qty + '</b><i>' + o.px.toFixed(2) + '</i></div>'; }).join('') + '<div class="mid">' + tranchePrice(mktTranche, now).toFixed(2) + '</div>' + book.bids.map(function (o) { return '<div class="bid"><span>' + esc(o.who) + '</span><b>' + o.qty + '</b><i>' + o.px.toFixed(2) + '</i></div>'; }).join('');
    var tp = $('mkt-tape'); if (tp) tp.innerHTML = tapeFor(mktTranche, now).map(function (x) { return '<div class="' + x.side + (x.bot ? '' : ' human') + '"><span>' + esc(x.who) + '</span><b>' + (x.side === 'buy' ? 'bought' : 'sold') + ' ' + x.qty + '</b><i>' + x.px.toFixed(2) + '</i></div>'; }).join('');
    var pv = $('mkt-pv'); if (pv) { var mb = myBank(); pv.innerHTML = tc(markPositions(mb.pos)); }
    var sp = $('mkt-spark'); if (sp && now % 60000 < 1100) sp.innerHTML = sparkline(mktTranche, now);
    var bb = $('mkt-buy'), sb = $('mkt-sell'); if (bb) bb.innerHTML = 'Buy ' + mktQty + ' · ' + tc(book.asks[0].px * mktQty); if (sb) sb.innerHTML = 'Sell ' + mktQty + ' · ' + tc(book.bids[0].px * mktQty);
    var pl = $('pb-long'); if (pl && pbPick) pl.innerHTML = 'Long ' + mktQty + ' ' + esc(pbPick) + ' · ' + tc(playerPrice(pbPick) * mktQty); var ps = $('pb-short'); if (ps) ps.textContent = 'Short ' + mktQty;
  }
  function horseSvg(h) {
    return '<svg class="hs" viewBox="0 0 64 40" aria-hidden="true"><path class="tail" d="M8 16 q-8 4 -5 14" stroke="' + h.mane + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="30" cy="20" rx="20" ry="10" fill="' + h.coat + '"/><path d="M44 14 l10 -10 l6 4 l-4 10 z" fill="' + h.coat + '"/><path d="M46 12 q6 -8 12 -6" stroke="' + h.mane + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<rect x="14" y="26" width="4" height="13" fill="' + h.coat + '" class="leg a"/><rect x="22" y="27" width="4" height="12" fill="' + h.coat + '" class="leg b"/><rect x="36" y="27" width="4" height="12" fill="' + h.coat + '" class="leg a"/><rect x="44" y="26" width="4" height="13" fill="' + h.coat + '" class="leg b"/>' +
      '<circle cx="31" cy="9" r="5" fill="' + h.silks + '"/><rect x="26" y="12" width="10" height="7" rx="2" fill="' + h.silks + '"/><circle cx="57" cy="8" r="1.4" fill="#fff"/></svg>';
  }
  // cards: a six-deck shoe shared by the card games
  var SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  function newShoe() { var d = []; for (var n = 0; n < 6; n++) SUITS.forEach(function (su) { RANKS.forEach(function (r) { d.push({ r: r, s: su }); }); }); return shuffled(d); }
  var shoe = [];
  function draw() { if (shoe.length < 30) shoe = newShoe(); return shoe.pop(); }
  function cardHtml(c, hidden) { return hidden ? '<span class="card back"></span>' : '<span class="card' + (c.s === '♥' || c.s === '♦' ? ' red' : '') + '"><b>' + c.r + '</b><i>' + c.s + '</i></span>'; }
  // blackjack: dealer stands on 17, blackjack pays 3 to 2, double on any two cards
  function handVal(h) { var t = 0, aces = 0; h.forEach(function (c) { if (c.r === 'A') { aces++; t += 11; } else t += /^[JQK]$/.test(c.r) ? 10 : +c.r; }); while (t > 21 && aces) { t -= 10; aces--; } return t; }
  function isBJ(h) { return h.length === 2 && handVal(h) === 21; }
  function bjDeal() {
    if (!stake(casBet)) return;
    bj = { bet: casBet, you: [draw(), draw()], dealer: [draw(), draw()], done: false, result: null, doubled: false };
    if (isBJ(bj.you) || isBJ(bj.dealer)) bjFinish();
    casAnim = 'deal'; buzz([10, 30, 10]); renderCasino();
  }
  function bjFinish() {
    var y = handVal(bj.you), d = handVal(bj.dealer), bet = bj.bet, win = 0, r;
    if (y > 21) r = 'Bust. The house thanks you.';
    else {
      while (!isBJ(bj.you) && handVal(bj.dealer) < 17) bj.dealer.push(draw());
      d = handVal(bj.dealer);
      if (isBJ(bj.you) && !isBJ(bj.dealer)) { win = bet * 2.5; r = 'Blackjack! Pays 3 to 2.'; }
      else if (isBJ(bj.dealer) && !isBJ(bj.you)) { r = 'Dealer blackjack. Brutal.'; }
      else if (d > 21) { win = bet * 2; r = 'Dealer busts on ' + d + '. You win.'; }
      else if (y > d) { win = bet * 2; r = y + ' beats ' + d + '. You win.'; }
      else if (y < d) { r = d + ' beats ' + y + '. House wins.'; }
      else { win = bet; r = 'Push at ' + y + '. Bet back.'; }
    }
    bj.done = true; bj.result = r; bj.win = win; settle(bet, win);
  }
  function bjHit() { if (!bj || bj.done) return; bj.you.push(draw()); if (handVal(bj.you) >= 21) bjFinish(); casAnim = 'hit'; renderCasino(); }
  function bjStand() { if (!bj || bj.done) return; bjFinish(); renderCasino(); }
  function bjDouble() { if (!bj || bj.done || bj.you.length !== 2) return; if (!stake(bj.bet)) return; bj.bet *= 2; bj.doubled = true; bj.you.push(draw()); bjFinish(); renderCasino(); }
  // bubble craps: pass line the way the table teaches it (come-out 7 or 11 wins, 2, 3 or 12 craps out, else a point, then
  // roll for the point before a 7), plus the field, a one-roll bet you can throw on before any roll: 3, 4, 9, 10 or 11
  // pay even, 2 and 12 pay double.
  function crapsStart() {
    if (!stake(casBet)) return;
    craps = { bet: casBet, point: null, rolls: [], done: false, result: null, field: 0, fieldNote: null };
    buzz(10); renderCasino();
  }
  function crapsRoll() {
    if (!craps || craps.done) return;
    var field = 0;
    if (fieldOn) { if (!stake(casBet)) { fieldOn = false; } else field = casBet; }
    var a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6), t = a + b;
    craps.rolls.push([a, b]); casAnim = 'roll';
    var r = null, win = 0;
    craps.fieldNote = null;
    if (field) {
      var fw = (t === 2 || t === 12) ? field * 3 : (t === 3 || t === 4 || t === 9 || t === 10 || t === 11) ? field * 2 : 0;
      settle(field, fw); craps.fieldNote = fw ? 'Field hits on ' + t + ' +' + fw : 'Field misses on ' + t;
    }
    if (craps.point === null) {
      if (t === 7 || t === 11) { r = t + ' on the come-out. Winner!'; win = craps.bet * 2; }
      else if (t === 2 || t === 3 || t === 12) { r = t + '. Craps. Line away.'; }
      else { craps.point = t; }
    } else if (t === craps.point) { r = 'Hit the ' + t + '! Pass line pays.'; win = craps.bet * 2; }
    else if (t === 7) { r = 'Seven out. Line away.'; }
    if (r) { craps.done = true; craps.result = r; craps.win = win; settle(craps.bet, win); }
    else if (!field) buzz(8);
    renderCasino();
  }
  // hold ’em against the house: ante, look at two cards, play (two more antes) or fold, then the board runs out and the
  // best five of seven decides it. Win and the ante and the play bet both pay even money; tie is a push.
  var HAND_NAMES = ['high card', 'a pair', 'two pair', 'three of a kind', 'a straight', 'a flush', 'a full house', 'four of a kind', 'a straight flush'];
  function rankNum(r) { return r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : +r; }
  function best5(cards) {   // returns [category, kickers...] comparable element by element
    var byRank = {}, bySuit = {}, vals = [];
    cards.forEach(function (c) { var v = rankNum(c.r); vals.push(v); byRank[v] = (byRank[v] || 0) + 1; (bySuit[c.s] = bySuit[c.s] || []).push(v); });
    function straightHigh(vs) { var u = {}; vs.forEach(function (v) { u[v] = 1; }); if (u[14]) u[1] = 1; var run = 0, best = 0; for (var v = 1; v <= 14; v++) { if (u[v]) { run++; if (run >= 5) best = v; } else run = 0; } return best; }
    var flushSuit = Object.keys(bySuit).filter(function (k) { return bySuit[k].length >= 5; })[0];
    if (flushSuit) { var sf = straightHigh(bySuit[flushSuit]); if (sf) return [8, sf]; }
    var groups = Object.keys(byRank).map(Number).sort(function (x, y) { return byRank[y] - byRank[x] || y - x; });
    var kick = function (n, skip) { return vals.filter(function (v) { return skip.indexOf(v) < 0; }).sort(function (x, y) { return y - x; }).slice(0, n); };
    if (byRank[groups[0]] === 4) return [7, groups[0]].concat(kick(1, [groups[0]]));
    if (byRank[groups[0]] === 3 && byRank[groups[1]] >= 2) return [6, groups[0], groups[1]];
    if (flushSuit) return [5].concat(bySuit[flushSuit].sort(function (x, y) { return y - x; }).slice(0, 5));
    var st = straightHigh(vals); if (st) return [4, st];
    if (byRank[groups[0]] === 3) return [3, groups[0]].concat(kick(2, [groups[0]]));
    if (byRank[groups[0]] === 2 && byRank[groups[1]] === 2) return [2, groups[0], groups[1]].concat(kick(1, [groups[0], groups[1]]));
    if (byRank[groups[0]] === 2) return [1, groups[0]].concat(kick(3, [groups[0]]));
    return [0].concat(kick(5, []));
  }
  function cmpHands(x, y) { for (var i = 0; i < Math.max(x.length, y.length); i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; }
  function holdemDeal() {
    if (!stake(casBet)) return;
    holdem = { ante: casBet, play: 0, you: [draw(), draw()], dealer: [draw(), draw()], board: [], done: false, result: null, folded: false };
    casAnim = 'deal'; buzz([10, 30, 10]); renderCasino();
  }
  function holdemPlay() {
    if (!holdem || holdem.done || holdem.board.length) return;
    if (!stake(holdem.ante * 2)) return;
    holdem.play = holdem.ante * 2;
    while (holdem.board.length < 5) holdem.board.push(draw());
    var y = best5(holdem.you.concat(holdem.board)), d = best5(holdem.dealer.concat(holdem.board)), c = cmpHands(y, d), inn = holdem.ante + holdem.play, win = 0, r;
    if (c > 0) { win = inn * 2; r = 'Your ' + HAND_NAMES[y[0]] + ' beats the house’s ' + HAND_NAMES[d[0]] + '.'; }
    else if (c < 0) { r = 'House’s ' + HAND_NAMES[d[0]] + ' beats your ' + HAND_NAMES[y[0]] + '.'; }
    else { win = inn; r = 'Split pot: ' + HAND_NAMES[y[0]] + ' each way.'; }
    holdem.done = true; holdem.result = r; holdem.win = win; holdem.hands = [HAND_NAMES[y[0]], HAND_NAMES[d[0]]]; casAnim = 'deal'; settle(inn, win); renderCasino();
  }
  function holdemFold() { if (!holdem || holdem.done) return; holdem.done = true; holdem.folded = true; holdem.result = 'Folded. The ante stays with Terry.'; holdem.win = 0; settle(holdem.ante, 0); renderCasino(); }
  // mountain slots: three reels, nine symbols; three peaks is the jackpot
  var SLOT_SYMS = ['🏔️', '🌲', '🎿', '🦌', '🔥', '🍺', '🛷', '☕', '🦣'];
  var SLOT_PAYS = [['🏔️🏔️🏔️', 'Three peaks', 50], ['🎿🎿🎿', 'Three skis', 20], ['any three alike', 'Triple', 10], ['🏔️🏔️ + one', 'Two peaks', 4], ['any pair', 'Pair', 2]];
  function slotsSpin() {
    if (!stake(casBet)) return;
    var reels = [0, 1, 2].map(function () { return SLOT_SYMS[Math.floor(Math.random() * SLOT_SYMS.length)]; });
    var peaks = reels.filter(function (x) { return x === SLOT_SYMS[0]; }).length, same = reels[0] === reels[1] && reels[1] === reels[2], pair = reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2];
    var mult = same && peaks === 3 ? 50 : same && reels[0] === SLOT_SYMS[2] ? 20 : same ? 10 : peaks === 2 ? 4 : pair ? 2 : 0;
    slots = { bet: casBet, reels: reels, done: false, mult: mult, win: casBet * mult, result: mult >= 50 ? 'THREE PEAKS. Jackpot.' : mult === 20 ? 'Three skis. Pays 20 to 1.' : mult === 10 ? 'Three alike. Pays 10 to 1.' : mult === 4 ? 'Two peaks. Pays 4 to 1.' : mult === 2 ? 'A pair. Pays 2 to 1.' : 'Nothing. The mountain keeps it.' };
    casAnim = 'spin'; buzz(8); renderCasino();
    setTimeout(function () { if (!slots || slots.done) return; slots.done = true; settle(slots.bet, slots.win); renderCasino(); }, 1400);
  }
  // Kyrkat’s wheel: a European wheel, every pocket a cat. Red, black, odd, even, low and high pay even; a dozen pays 2
  // to 1; a straight-up number pays 35 to 1. Zero is Kyrkat herself.
  var WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  var WHEEL_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  var CATS = ['🐈‍⬛', '🐱', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐈'];
  var WHEEL_BETS = [['red', 'Red', 1], ['black', 'Black', 1], ['odd', 'Odd', 1], ['even', 'Even', 1], ['low', '1 to 18', 1], ['high', '19 to 36', 1], ['d1', '1st 12', 2], ['d2', '2nd 12', 2], ['d3', '3rd 12', 2], ['num', 'A number', 35]];
  function wheelColor(n) { return n === 0 ? 'green' : WHEEL_RED.indexOf(n) >= 0 ? 'red' : 'black'; }
  function wheelCat(n) { return n === 0 ? CATS[0] : CATS[1 + (n % (CATS.length - 1))]; }
  function wheelHit(bet, n) {
    if (n === 0) return bet.kind === 'num' && bet.n === 0;
    switch (bet.kind) {
      case 'red': return wheelColor(n) === 'red'; case 'black': return wheelColor(n) === 'black';
      case 'odd': return n % 2 === 1; case 'even': return n % 2 === 0;
      case 'low': return n <= 18; case 'high': return n >= 19;
      case 'd1': return n <= 12; case 'd2': return n >= 13 && n <= 24; case 'd3': return n >= 25;
      case 'num': return bet.n === n;
    }
    return false;
  }
  function wheelSpin() {
    if (!stake(casBet)) return;
    var n = WHEEL_ORDER[Math.floor(Math.random() * WHEEL_ORDER.length)], def = WHEEL_BETS.filter(function (w) { return w[0] === wheelBet.kind; })[0], hit = wheelHit(wheelBet, n);
    wheel = { bet: casBet, kind: wheelBet.kind, num: wheelBet.n, n: n, done: false, win: hit ? casBet * (def[2] + 1) : 0, result: n + ' ' + (n === 0 ? 'green, Kyrkat herself' : wheelColor(n)) + ' ' + wheelCat(n) + (hit ? '. Pays ' + def[2] + ' to 1!' : '. Not yours.'), turns: 4 + Math.floor(Math.random() * 3) };   // whole turns, so the pin lands on the pocket announced
    casAnim = 'spin'; buzz(8); renderCasino();
    setTimeout(function () { if (!wheel || wheel.done) return; wheel.done = true; settle(wheel.bet, wheel.win); renderCasino(); }, 2600);
  }
  function dieHtml(n) { return '<span class="die d' + n + '" aria-label="' + n + '">' + '<i></i>'.repeat(n) + '</span>'; }
  function resultHtml(r, win, inn) { return '<div class="cas-result' + (win > inn ? ' win' : win ? '' : ' lose') + '">' + esc(r) + (win ? ' <b>+' + Math.round(win).toLocaleString() + '</b>' : '') + '</div>'; }
  // ---- The Smash book: parimutuel betting on the real-life Super Smash Bros. matches ----
  // One shared doc, casinosmash { matches: [{ id, a, b, by, at, result, called_by, called_at, void, void_by }] }, written
  // only when a match is opened, called or voided. Every bettor keeps their own doc, smashbet-<name> { by, bets: [{ m, on,
  // n, at }] }, so two phones betting at once never overwrite each other. Nothing writes to anyone's bank: a stake is held
  // out of your balance while the book is open, and when the match is called the whole pool is split among the winning
  // side in proportion to stake, after each fighter takes a 1.5% royalty off the top (they did the fighting). Nobody backed
  // the winner: everyone gets their stake back and no royalty is paid. Voided: everyone refunded.
  var SB_ROYALTY = 0.015, smashBook = null, smashBets = {}, sbA = 'Mitch', sbB = 'Luke', sbPick = {};   // sbPick: match id -> the fighter picked on this phone
  function sbMatches() { return (smashBook && smashBook.matches) || []; }
  function sbBetsOn(id) { var out = []; Object.keys(smashBets).forEach(function (n) { (smashBets[n].bets || []).forEach(function (b) { if (b.m === id) out.push({ by: n, on: b.on, n: +b.n || 0, at: b.at }); }); }); return out; }
  function sbPools(m) {   // the pool on each side, who put what where, and the total
    var bets = sbBetsOn(m.id), pool = {}, who = {}; pool[m.a] = 0; pool[m.b] = 0; who[m.a] = {}; who[m.b] = {};
    bets.forEach(function (b) { if (pool[b.on] == null) return; pool[b.on] += b.n; who[b.on][b.by] = (who[b.on][b.by] || 0) + b.n; });
    return { bets: bets, pool: pool, who: who, total: pool[m.a] + pool[m.b] };
  }
  function sbStake(ps, m, name) { return ((ps.who[m.a] || {})[name] || 0) + ((ps.who[m.b] || {})[name] || 0); }
  function sbPayout(ps, m, name) {   // coins back on a called match, stake included (0 when the player lost)
    var w = ps.pool[m.result] || 0, s = (ps.who[m.result] || {})[name] || 0; if (!w) return sbStake(ps, m, name); return s ? s * sbPurse(ps) / w : 0;
  }
  function sbPurse(ps) { return ps.total * (1 - 2 * SB_ROYALTY); }   // what the winning side shares once both fighters are paid
  function sbRoyalty(ps, m, name) { return m.result && (ps.pool[m.result] || 0) && (name === m.a || name === m.b) ? ps.total * SB_ROYALTY : 0; }
  function sbNetFor(name) {   // what the book is holding for, or has paid, one player across every match
    var t = 0;
    sbMatches().forEach(function (m) { if (m.void) return; var ps = sbPools(m), mine = sbStake(ps, m, name); t += sbRoyalty(ps, m, name); if (!mine) return; t += m.result ? sbPayout(ps, m, name) - mine : -mine; });
    return t;
  }
  function sbPlayed(n) { return !!(smashBets[n] && (smashBets[n].bets || []).length) || sbNetFor(n) !== 0; }   // on the floor through the book alone
  function sbSide(id, name) { var bets = sbBetsOn(id).filter(function (b) { return b.by === name; }); return bets.length ? bets[0].on : null; }
  function sbWrite(matches, msg) {
    var doc = { matches: matches.slice(-60), updated_at: new Date().toISOString() }; smashBook = doc; renderCasino(); if (msg) toast(msg);
    store.setGame('casinosmash', doc).catch(function (e) { toast('The book didn’t take that: ' + ((e && e.message) || e)); });
  }
  function sbBet(id) {
    var m = sbMatches().filter(function (x) { return x.id === id; })[0]; if (!m) return;
    if (m.result || m.void) { toast('The book is closed on that one.'); return; }
    var have = sbSide(id, me), on = have || sbPick[id];
    if (!on) { toast('Pick a fighter first.'); return; }
    if (have && sbPick[id] && sbPick[id] !== have) { toast('You’re already on ' + have + '. No hedging.'); return; }
    var n = casBet; if (n > myBal()) { toast('You don’t have ' + tcText(n) + '.'); return; }
    var mine = Object.assign({ by: me, bets: [] }, smashBets[me] || {}); mine.bets = (mine.bets || []).concat([{ m: id, on: on, n: n, at: new Date().toISOString() }]).slice(-200); mine.at = new Date().toISOString();
    smashBets = Object.assign({}, smashBets); smashBets[me] = mine; renderCasino(); buzz([20, 30, 20]);
    toast(tcText(n) + ' on ' + on + '.');
    store.setGame('smashbet-' + me, mine).catch(function (e) { toast('The bet didn’t land: ' + ((e && e.message) || e)); });
  }
  function sbMatchHtml(m) {
    var ps = sbPools(m), mySide = sbSide(m.id, me), pick = mySide || sbPick[m.id] || '', open = !m.result && !m.void;
    var html = '<div class="sb-match' + (open ? '' : ' done') + '"><div class="sb-title"><b>' + esc(m.a) + ' <span>vs</span> ' + esc(m.b) + '</b><small>' + (m.void ? 'voided by ' + esc(m.void_by || '?') : m.result ? esc(m.result) + ' won · called by ' + esc(m.called_by || '?') : 'opened by ' + esc(m.by === me ? 'you' : m.by)) + ' ' + esc(agoText(m.called_at || m.at)) + '</small></div>';
    html += '<div class="sb-sides">' + [m.a, m.b].map(function (f) {
      var p = ps.pool[f], backers = Object.keys(ps.who[f]).length, mine = ps.who[f][me] || 0, won = m.result === f;
      var pays = p ? (sbPurse(ps) / p) : 0;
      return '<button type="button" data-sb-side="' + esc(m.id) + '|' + esc(f) + '" aria-pressed="' + (pick === f) + '"' + (open ? '' : ' disabled') + ' class="' + (won ? 'won' : m.result ? 'lost' : '') + '"><span class="nm">' + esc(f) + (won ? ' 🏆' : '') + '</span><b>' + tc(p) + '</b><small>' + (backers ? backers + ' backer' + (backers === 1 ? '' : 's') + ' · pays ' + pays.toFixed(2) + '×' : 'no backers yet') + '</small>' + (mine ? '<em>you: ' + tc(mine) + (m.result ? (won ? ' → ' + tc(sbPayout(ps, m, me)) : ' → 0') : '') + '</em>' : '') + '</button>';
    }).join('') + '</div>';
    if (open) {
      html += '<div class="sb-pool">Pool ' + tc(ps.total) + ' · ' + ps.bets.length + ' bet' + (ps.bets.length === 1 ? '' : 's') + (mySide ? ' · you’re on ' + esc(mySide) : '') + '</div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" data-sb-bet="' + esc(m.id) + '"' + (!pick || casBet > myBal() ? ' disabled' : '') + '>' + (pick ? 'Back ' + esc(pick) + ' · ' + tc(casBet) : 'Pick a fighter') + '</button></div>';
      html += '<div class="sb-call"><span>Match over?</span><button type="button" class="btn" data-sb-won="' + esc(m.id) + '|' + esc(m.a) + '">' + esc(m.a) + ' won</button><button type="button" class="btn" data-sb-won="' + esc(m.id) + '|' + esc(m.b) + '">' + esc(m.b) + ' won</button>' + (CAS_BOSSES.indexOf(me) >= 0 ? '<button type="button" class="btn warn" data-sb-void="' + esc(m.id) + '">Void</button>' : '') + '</div>';
    } else if (m.result) {
      var w = ps.pool[m.result] || 0, winners = Object.keys(ps.who[m.result] || {}).map(function (n) { return { n: n, d: sbPayout(ps, m, n) - sbStake(ps, m, n) }; }).sort(function (x, y) { return y.d - x.d; });
      html += '<div class="sb-pool">' + (!ps.total ? 'No bets.' : !w ? 'Nobody backed ' + esc(m.result) + ', so every stake went back.' : 'Pool ' + tc(ps.total) + ' · ' + esc(m.a) + ' and ' + esc(m.b) + ' each took ' + tc(ps.total * SB_ROYALTY) + ' in royalties · ' + winners.map(function (x) { return esc(x.n === me ? 'you' : x.n) + ' +' + Math.round(x.d).toLocaleString(); }).join(', ')) + '</div>';
    } else html += '<div class="sb-pool">Every stake went back.</div>';
    return html + '</div>';
  }
  function smashBookHtml(b) {
    var ms = sbMatches().slice().reverse(), open = ms.filter(function (m) { return !m.result && !m.void; }), done = ms.filter(function (m) { return m.result || m.void; }).slice(0, 6);
    var html = '<div class="cas-rules">Real Smash, real stakes · pick a fighter, back them with Terry coin · the two fighters take 1.5% each off the top, the winning side splits the rest by stake · nobody on the winner, everyone’s money comes back</div>';
    html += '<div class="sb-new"><select id="sb-a" aria-label="Fighter one">' + NAMES.map(function (n) { return '<option' + (n === sbA ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select><span>vs</span><select id="sb-b" aria-label="Fighter two">' + NAMES.map(function (n) { return '<option' + (n === sbB ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select><button type="button" class="btn" id="sb-open">Open the book</button></div>';
    html += open.length ? open.map(sbMatchHtml).join('') : '<div class="deal-sum">No match on the board. Open the book on the next one and the whole cabin can bet.</div>';
    if (done.length) html += '<div class="rl-head sb-head">Called</div>' + done.map(sbMatchHtml).join('');
    var held = 0, won = 0; sbMatches().forEach(function (m) { if (m.void) return; var ps = sbPools(m), mine = sbStake(ps, m, me); if (!m.result) { held += mine; return; } won += sbPayout(ps, m, me) - mine + sbRoyalty(ps, m, me); });
    if (held || won) html += '<div class="deal-sum">' + (held ? 'The book is holding ' + tc(held) + ' of yours on open matches. ' : '') + (won ? 'Called matches have ' + (won > 0 ? 'paid you ' + tc(won) : 'cost you ' + tc(-won)) + ' net.' : '') + '</div>';
    return html;
  }
  function renderCasino() {
    var body = $('casino-body'), status = $('casino-status'); if (!body) return;
    if (!casinoLoaded) { body.innerHTML = '<p class="skeleton">Loading…</p>'; return; }
    var b = Object.assign({}, myBank(), { bal: myBal() }), html = '', an = casAnim || '', take = houseTake(); casAnim = null;
    status.innerHTML = tc(b.bal);
    html += '<div class="cas-welcome"><div class="lights" aria-hidden="true"></div><div class="coin-hero" role="img" aria-label="Terry coin: Terry’s face in gold"></div><div class="wtitle">Welcome to Terry’s Casino</div><div class="wsub">Terry’s house, Terry’s rules, Terry coin. Everyone starts with ' + tc(TC_START) + '. Go broke and Terry lends you ' + tc(TC_LOAN) + ', and everyone sees the loan. The house is Terry: whatever the tables win goes straight into his bank, and whatever they pay out comes out of it.</div>' + (function () { var dv = latestDividend(); return dv ? '<div class="dividend">\uD83D\uDCB8 <b>Dividend: ' + tc(dv.n) + ' to every player.</b> \u201C' + esc(dv.note || '') + '\u201D \u2014 Terry coin</div>' : ''; })() + '</div>';
    html += '<div class="cas-warn"><b>Please gamble responsibly.</b> Terry coin is worth nothing and the house always wins. If gambling is a problem for you or someone you know, call or text the National Problem Gambling Helpline, <a href="tel:18004262537">1-800-GAMBLER</a>, 24 hours a day, free and confidential.</div>';
    var supply = moneySupply(), rv = reserveValue(), ratio = supply ? rv / supply : 0;
    html += '<details class="reserve"' + (resOpen ? ' open' : '') + '><summary><span class="seal">\uD83C\uDFDB\uFE0F</span><span><b>The Terry Reserve</b><small>Terry coin is ' + Math.round(ratio * 100) + '% backed</small></span></summary>' +
      '<div class="res-body"><div class="res-row"><span>Coin in circulation</span><b>' + tc(supply) + '</b></div><div class="res-row"><span>Reserve assets</span><b>' + tc(rv) + '</b></div>' +
      '<div class="res-assets">' + RESERVE_ASSETS.map(function (a) { return '<div><span>' + a[0] + ' ' + esc(a[1]) + '</span><b>' + tc(a[2]) + '</b></div>'; }).join('') + '</div>' +
      '<div class="res-row"><span>Backing</span><b>' + Math.round(ratio * 100) + '%' + (ratio >= 1 ? ' · fully backed' : ratio >= 0.5 ? ' · fractional' : ' · fiat, basically') + '</b></div>' +
      (insider() ? '<div class="res-row"><span>Escrow account</span><b>' + tc(escrowBal()) + '</b></div>' : '') +
      '<div class="res-row"><span>Terry Federal Funds Rate</span><b>' + fedRate().toFixed(2) + '%' + (CAS_BOSSES.indexOf(me) >= 0 && !casClosed ? ' <span class="stepper"><button type="button" data-rate="-0.25">−</button><button type="button" data-rate="0.25">+</button></span>' : '') + '</b></div>' +
      '<div class="res-row"><span>Peg</span><b>1 TC = 1 sip of Banquet</b></div><div class="res-row"><span>Chairman</span><b>Terry</b></div>' +
      (stimIssued() ? '<div class="res-row"><span>Stimulus to date</span><b>' + tc(stimIssued()) + ' per citizen</b></div>' : '') +
      (dividendsIssued() ? '<div class="res-row"><span>Dividends to date</span><b>' + tc(dividendsIssued()) + ' per player</b></div>' : '') +
      (function () { var gs = insider() ? NAMES.filter(function (n) { return grantsFor(n); }) : []; return gs.length ? '<div class="res-row"><span>Grants by order of the chairman</span><b>' + gs.map(function (n) { return esc(n) + ' ' + tc(grantsFor(n)); }).join('<br>') + '</b></div>' : ''; })() +
      (function () { var shown = ((reserve && reserve.log) || []).filter(function (e) { return insider() || e.kind === 'dividend' || e.kind === 'rate' || (e.kind === 'print' && !e.who); }); return shown.length ? '<div class="res-log">' + shown.slice(-5).reverse().map(function (e) { return '<div>' + esc(e.by) + ' ' + (e.kind === 'pay' ? 'paid ' + tc(e.n) + ' from escrow to ' + esc(e.who) : e.kind === 'seize' ? 'seized ' + tc(e.n) + ' from ' + esc(e.who) + ' into escrow' : e.kind === 'mint' ? 'minted ' + tc(e.n) + ' into escrow' : e.kind === 'burn' ? 'burned ' + tc(e.n) + ' from escrow' : e.kind === 'rate' ? 'set the rate to ' + (+e.n).toFixed(2) + '%' : e.kind === 'dividend' ? 'paid a dividend of ' + tc(e.n) + ' to every player' + (e.note ? ': \u201C' + esc(e.note) + '\u201D' : '') : 'printed ' + tc(e.n) + ' ' + (e.who ? 'for ' + esc(e.who) : 'for everyone')) + ' ' + esc(agoText(e.at)) + '</div>'; }).join('') + '</div>' : ''; })() +
      (CAS_BOSSES.indexOf(me) >= 0 && !casClosed ? '<div class="mafia-actions"><button type="button" class="btn" id="res-print">\uD83D\uDDA8\uFE0F Print ' + tc(TC_STIM) + ' for everyone</button></div><div class="deal-sum">Quantitative easing. Backing drops; everyone cheers anyway.</div>' +
        '<div class="res-panel"><div class="res-ptitle">Full control</div>' +
        '<div class="res-grant"><select id="res-who" aria-label="Who">' + NAMES.map(function (n) { return '<option value="' + esc(n) + '"' + (n === resWho ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select><select id="res-amt" aria-label="How much">' + ['25', '50', '100', '250', '500', '1000', '5000'].map(function (a) { return '<option' + (a === resAmt ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></div>' +
        '<div class="res-acts"><button type="button" class="btn" id="res-grant">\uD83D\uDDA8\uFE0F Print for them</button><button type="button" class="btn" id="res-pay">\uD83C\uDFE6 Pay from escrow</button><button type="button" class="btn warn" id="res-seize">\u2696\uFE0F Seize to escrow</button><button type="button" class="btn" id="res-mint">Mint into escrow</button><button type="button" class="btn warn" id="res-burn">\uD83D\uDD25 Burn from escrow</button></div>' +
        '<div class="deal-sum">Print makes new coin for one person. Pay moves coin out of escrow to them; Seize takes it back into escrow. Mint and Burn change what escrow holds.</div>' +
        '<div class="res-div"><input type="text" id="res-note" maxlength="60" placeholder="A line for the sign (optional)" autocomplete="off"><button type="button" class="btn" id="res-dividend">\uD83D\uDCB8 Dividend to all</button></div><div class="deal-sum">Pays the amount above to every player and puts the line on the welcome sign.</div></div>' : '') +
      '<div class="res-fine">Backed by the full faith and credit of Terry. Not legal tender. Not redeemable. Do not eat.</div></div></details>';
    html += '<div class="cas-bank"><div><span class="lbl">Your bank</span><b>' + tc(b.bal) + '</b></div>' + (me === HOUSE ? '<div><span class="lbl">House take</span><b class="' + (take > 0 ? 'up' : take < 0 ? 'down' : '') + '">' + (take > 0 ? '+' : '') + Math.round(take).toLocaleString() + '</b></div>' : '') + '<div><span class="lbl">Net</span><b class="' + (b.net > 0 ? 'up' : b.net < 0 ? 'down' : '') + '">' + (b.net > 0 ? '+' : '') + Math.round(b.net || 0).toLocaleString() + '</b></div><div><span class="lbl">Hands</span><b>' + (b.hands || 0) + '</b></div>' + (b.loans ? '<div><span class="lbl">Owes Terry</span><b class="down">' + tc(b.loans * TC_LOAN) + '</b></div>' : '') + '</div>';
    var inHand = casInHand();
    if (casClosed) {   // the closing bell: final standings, no more bets
      var csf = claudeSeat();
      var fin = NAMES.filter(function (n) { return casino[n] || (n === HOUSE && take) || sbPlayed(n); }).map(function (n) { return { by: n, bal: effBal(n), d: casino[n] || {} }; }).concat([{ by: csf.by, bal: csf.bal, d: csf }]).sort(function (x, y) { return y.bal - x.bal; });
      var loans = fin.filter(function (r) { return r.d.loans; }).sort(function (x, y) { return y.d.loans - x.d.loans; });
      html += '<div class="cas-closed"><div class="bell">\uD83D\uDD14</div><div class="wtitle">Closing bell</div><div class="wsub">The floor closed ' + esc(agoText(casClosed.at)) + (casClosed.by ? ', rung by ' + esc(casClosed.by) : '') + '. Final standings.</div></div>';
      html += '<div class="cas-board final"><div class="rl-head">Final standings <span class="info-sub">· the house finished ' + (take > 0 ? 'up ' : take < 0 ? 'down ' : 'even') + (take ? Math.abs(Math.round(take)).toLocaleString() : '') + '</span></div>' + fin.map(function (r, i) { return '<div class="row' + (r.by === me ? ' me' : '') + (i === 0 ? ' top' : '') + '"><span class="pos">' + (i === 0 ? '\uD83C\uDFC6' : i + 1) + '</span><span class="nm">' + esc(r.by === me ? 'You' : r.by) + (r.by === HOUSE ? ' <em>the house</em>' : '') + (r.d.hands ? ' <small class="k">' + r.d.hands + ' hands · net ' + (r.d.net > 0 ? '+' : '') + Math.round(r.d.net || 0) + '</small>' : '') + '</span><span class="bal">' + tc(r.bal) + '</span></div>'; }).join('') + '</div>';
      if (loans.length) html += '<div class="cas-loans"><b>Owes Terry:</b> ' + loans.map(function (r) { return esc(r.by) + ' ' + tc(r.d.loans * TC_LOAN) + ' (' + r.d.loans + ' loan' + (r.d.loans === 1 ? '' : 's') + ')'; }).join(' · ') + '</div>';
      // the weekend in one place: the predictions favourites and the photo wall
      var favs = QUESTIONS.map(function (q) { var t = tallyFor(q); return t.rows.length ? { q: q.text, pick: t.rows[0].pick, n: t.rows[0].n, of: t.voted } : null; }).filter(Boolean);
      html += '<div class="cas-wrap"><div class="rl-head">The weekend</div>' + favs.map(function (f) { return '<div class="row"><span class="q">' + esc(f.q) + '</span><span class="a">' + esc(f.pick) + ' <small>' + f.n + ' of ' + f.of + '</small></span></div>'; }).join('') + '<div class="row"><span class="q">Photos on the wall</span><span class="a">' + photos.length + '</span></div></div>';
      if (CAS_BOSSES.indexOf(me) >= 0) html += '<div class="mafia-actions"><button type="button" class="btn" id="cas-reopen">Reopen the floor</button></div>';
      body.innerHTML = html; return;
    }
    html += '<div class="cas-tabs" role="tablist">' + CAS_GAMES.map(function (g) { return '<button type="button" data-cas-game="' + g[0] + '" aria-pressed="' + (casGame === g[0]) + '"' + (inHand ? ' disabled' : '') + '>' + g[1] + '</button>'; }).join('') + '</div>';
    if (!inHand) {
      html += '<div class="cas-chips">' + TC_CHIPS.map(function (c) { return '<button type="button" class="chip' + (c === casBet ? ' on' : '') + (c > b.bal ? ' off' : '') + '" data-cas-bet="' + c + '">' + c + '</button>'; }).join('') + '</div>';
      if (b.bal < TC_CHIPS[0]) html += '<div class="mafia-actions"><button type="button" class="big-btn" id="cas-loan">🏦 Take Terry’s ' + tc(TC_LOAN) + ' loan</button></div><div class="deal-sum">You’re broke. The loan goes on your record.</div>';
    }
    if (casGame === 'smash') {
      html += smashBookHtml(b);
    } else if (casGame === 'blackjack') {
      html += '<div class="cas-rules">Dealer stands on 17 · blackjack pays 3 to 2 · double on any two</div>';
      if (bj) {
        var yv = handVal(bj.you), dv = handVal(bj.dealer);
        html += '<div class="bj-table' + (an ? ' ' + an : '') + '"><div class="bj-hand"><span class="who">Dealer' + (bj.done ? ' · ' + dv : '') + '</span><div class="cards">' + bj.dealer.map(function (c, i) { return cardHtml(c, i === 1 && !bj.done); }).join('') + '</div></div>' +
          '<div class="bj-hand you"><span class="who">You · ' + yv + (bj.doubled ? ' · doubled' : '') + '</span><div class="cards">' + bj.you.map(function (c) { return cardHtml(c); }).join('') + '</div></div>' +
          (bj.done ? resultHtml(bj.result, bj.win, bj.bet) : '') + '</div>';
        html += bj.done
          ? '<div class="mafia-actions"><button type="button" class="big-btn" id="bj-deal"' + (b.bal < casBet ? ' disabled' : '') + '>Deal again · ' + tc(casBet) + '</button></div>'
          : '<div class="cas-btns"><button type="button" class="big-btn" id="bj-hit">Hit</button><button type="button" class="big-btn stand" id="bj-stand">Stand</button>' + (bj.you.length === 2 && b.bal >= bj.bet ? '<button type="button" class="btn" id="bj-double">Double</button>' : '') + '</div>';
      } else html += '<div class="mafia-actions"><button type="button" class="big-btn" id="bj-deal"' + (b.bal < casBet ? ' disabled' : '') + '>Deal · ' + tc(casBet) + '</button></div>';
    } else if (casGame === 'craps') {
      html += '<div class="cas-rules">Pass line, even money · the field is a one-roll side bet, 2 and 12 pay double</div>';
      var last = craps && craps.rolls[craps.rolls.length - 1];
      html += '<div class="craps-table bubble' + (an === 'roll' ? ' roll' : '') + '"><div class="dome"><div class="dice">' + (last ? dieHtml(last[0]) + dieHtml(last[1]) : dieHtml(3) + dieHtml(4)) + '</div><span class="glass"></span></div>' +
        '<div class="point">' + (craps ? (craps.point ? 'Point is <b>' + craps.point + '</b>' : 'Come-out roll') + ' · pass line ' + tc(craps.bet) + (last ? ' · rolled <b>' + (last[0] + last[1]) + '</b>' : '') : 'Put a bet on the pass line') + '</div>' +
        (craps && craps.rolls.length > 1 ? '<div class="rolls">' + craps.rolls.map(function (r) { return r[0] + r[1]; }).join(' · ') + '</div>' : '') +
        (craps && craps.fieldNote ? '<div class="field-note">' + esc(craps.fieldNote) + '</div>' : '') +
        (craps && craps.done ? resultHtml(craps.result, craps.win, craps.bet) : '') + '</div>';
      if (craps && !craps.done) html += '<div class="cas-btns two"><button type="button" class="big-btn" id="craps-roll">🎲 Roll</button><button type="button" class="btn field' + (fieldOn ? ' on' : '') + '" id="craps-field" aria-pressed="' + fieldOn + '">Field ' + tc(casBet) + (fieldOn ? ' on' : '') + '</button></div>';
      else html += '<div class="mafia-actions"><button type="button" class="big-btn" id="craps-start"' + (b.bal < casBet ? ' disabled' : '') + '>Pass line' + (craps ? ' again' : '') + ' · ' + tc(casBet) + '</button></div>';
    } else if (casGame === 'holdem') {
      html += '<div class="cas-rules">Ante, see your two, then play for two more antes or fold · best five of seven · even money, ties push</div>';
      if (holdem) {
        html += '<div class="bj-table' + (an ? ' ' + an : '') + '"><div class="bj-hand"><span class="who">House' + (holdem.done && !holdem.folded ? ' · ' + holdem.hands[1] : '') + '</span><div class="cards">' + holdem.dealer.map(function (c) { return cardHtml(c, !holdem.done || holdem.folded); }).join('') + '</div></div>' +
          '<div class="bj-hand board"><span class="who">Board</span><div class="cards">' + (holdem.board.length ? holdem.board.map(function (c) { return cardHtml(c); }).join('') : '<span class="card back"></span><span class="card back"></span><span class="card back"></span><span class="card back"></span><span class="card back"></span>') + '</div></div>' +
          '<div class="bj-hand you"><span class="who">You' + (holdem.done && !holdem.folded ? ' · ' + holdem.hands[0] : '') + '</span><div class="cards">' + holdem.you.map(function (c) { return cardHtml(c); }).join('') + '</div></div>' +
          (holdem.done ? resultHtml(holdem.result, holdem.win, holdem.ante + holdem.play) : '') + '</div>';
        html += holdem.done
          ? '<div class="mafia-actions"><button type="button" class="big-btn" id="holdem-deal"' + (b.bal < casBet ? ' disabled' : '') + '>Ante again · ' + tc(casBet) + '</button></div>'
          : '<div class="cas-btns two"><button type="button" class="big-btn" id="holdem-play"' + (b.bal < holdem.ante * 2 ? ' disabled' : '') + '>Play · ' + tc(holdem.ante * 2) + '</button><button type="button" class="btn" id="holdem-fold">Fold</button></div>';
      } else html += '<div class="mafia-actions"><button type="button" class="big-btn" id="holdem-deal"' + (b.bal < casBet ? ' disabled' : '') + '>Ante · ' + tc(casBet) + '</button></div>';
    } else if (casGame === 'slots') {
      html += '<div class="cas-rules">' + SLOT_PAYS.map(function (p) { return p[0] + ' ' + p[2] + 'x'; }).join(' · ') + '</div>';
      var reels = slots ? slots.reels : ['🏔️', '🌲', '🦌'];
      html += '<div class="slot-machine' + (an === 'spin' ? ' spin' : '') + '"><div class="marquee">Peak Fortune</div><div class="reels">' + reels.map(function (sym, i) { return '<div class="reel" style="--i:' + i + '"><div class="strip">' + SLOT_SYMS.concat(SLOT_SYMS).concat([sym]).map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div></div>'; }).join('') + '</div>' +
        (slots && slots.done ? resultHtml(slots.result, slots.win, slots.bet) : '<div class="slot-hint">' + (slots ? 'Spinning…' : 'Pull for ' + tc(casBet)) + '</div>') + '</div>';
      html += '<div class="mafia-actions"><button type="button" class="big-btn" id="slots-spin"' + (b.bal < casBet || (slots && !slots.done) ? ' disabled' : '') + '>🏔️ Spin · ' + tc(casBet) + '</button></div>';
    } else if (casGame === 'horses') {
      html += '<div class="cas-rules">Win pays the odds · place (top two) half · show (top three) a third</div>';
      var running = race && !race.done;
      html += '<div class="downs"><div class="sky"><div class="stand"><i class="spire"></i><i class="spire"></i><span class="roof"></span><span class="sign">Churchill Downs</span></div></div>' +
        '<div class="track">' + raceField().map(function (h, i) { var p = race ? race.pos[i] : 0; return '<div class="lane"><span class="num" style="background:' + h.silks + '">' + (i + 1) + '</span><div class="horse' + (running ? ' run' : '') + (race && race.done && race.order[0] === i ? ' won' : '') + '" data-i="' + i + '" style="left:calc(' + p + '% - ' + (p * 0.56) + 'px)">' + horseSvg(h) + '</div></div>'; }).join('') + '<div class="wire"></div></div>' +
        '<div class="race-line" id="race-lead">' + (race ? (race.done ? 'Winner: ' + raceField()[race.order[0]].name : 'They’re off!') : 'Pick a horse and a bet') + '</div>' +
        (race && race.done ? '<div class="race-order">' + race.order.slice(0, 3).map(function (i, k) { return '<span><b>' + (k + 1) + '</b>' + esc(raceField()[i].name) + '</span>'; }).join('') + '</div>' + resultHtml(race.result, race.win, race.bet) : '') + '</div>';
      if (!running) {
        html += '<div class="horse-list">' + raceField().map(function (h, i) { return '<button type="button" data-horse="' + i + '" aria-pressed="' + (racePick === i) + '"><span class="num" style="background:' + h.silks + '">' + (i + 1) + '</span><span class="nm">' + esc(h.name) + '</span><span class="odds">' + h.odds + '-1</span></button>'; }).join('') + '</div>';
        html += '<div class="cas-tabs small">' + [['win', 'Win'], ['place', 'Place'], ['show', 'Show']].map(function (k) { return '<button type="button" data-race-kind="' + k[0] + '" aria-pressed="' + (raceKind === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</div>';
        html += '<div class="mafia-actions"><button type="button" class="big-btn" id="race-go"' + (b.bal < casBet ? ' disabled' : '') + '>🏇 ' + (race ? 'Run it again' : 'And they’re off') + ' · ' + tc(casBet) + '</button><button type="button" class="btn" id="race-field">New field</button></div>';
      }
    } else if (casGame === 'market') {
      var now = Date.now(), mb = myBank(), tr = TRANCHES.filter(function (x) { return x.k === mktTranche; })[0], book0 = bookFor(mktTranche, now), held = (mb.pos && mb.pos[mktTranche]) || { qty: 0, avg: 0 };
      html += '<div class="cas-rules">Synthetic Collateralized Terry Coin Obligations · three tranches off the Terry Coin Index · 150 bots make the market, so there’s always a bid</div>';
      html += '<div id="mkt-desk" class="mkt"><div class="mkt-head"><span class="lbl">Terry Coin Index</span><b id="mkt-index">' + indexAt(now).toFixed(2) + '</b><span class="lbl">Positions</span><b id="mkt-pv">' + tc(markPositions(mb.pos)) + '</b></div>' +
        '<div class="mkt-tranches">' + TRANCHES.map(function (t) { var pq = (mb.pos && mb.pos[t.k] && mb.pos[t.k].qty) || 0; return '<button type="button" data-mkt-tranche="' + t.k + '" aria-pressed="' + (mktTranche === t.k) + '"><span class="nm">' + esc(t.name) + '</span><span class="tag">' + esc(t.tag) + '</span><b data-mkt-px="' + t.k + '" data-was="' + tranchePrice(t.k, now) + '">' + tranchePrice(t.k, now).toFixed(2) + '</b>' + (pq ? '<small>you hold ' + pq + '</small>' : '') + '</button>'; }).join('') + '</div>' +
        '<div class="mkt-note">' + esc(tr.note) + (held.qty ? ' You hold ' + held.qty + ' at an average of ' + held.avg.toFixed(2) + '.' : '') + '</div>' +
        '<div id="mkt-spark" class="mkt-spark">' + sparkline(mktTranche, now) + '</div>' +
        '<div class="mkt-grid"><div><div class="mkt-title">Order book</div><div id="mkt-book" class="mkt-book"></div></div><div><div class="mkt-title">Tape</div><div id="mkt-tape" class="mkt-tape"></div></div></div>' +
        '<div class="mkt-qty"><span>Notes</span><span class="stepper"><button type="button" data-mkt-qty="-1">−</button><b>' + mktQty + '</b><button type="button" data-mkt-qty="1">+</button></span><span class="stepper"><button type="button" data-mkt-qty="-10">−10</button><button type="button" data-mkt-qty="10">+10</button></span></div>' +
        '<div class="cas-btns two"><button type="button" class="big-btn" id="mkt-buy"' + (casClosed ? ' disabled' : '') + '>Buy ' + mktQty + ' · ' + tc(book0.asks[0].px * mktQty) + '</button><button type="button" class="big-btn stand" id="mkt-sell"' + (casClosed || !held.qty ? ' disabled' : '') + '>Sell ' + mktQty + ' · ' + tc(book0.bids[0].px * mktQty) + '</button></div>' +
        playerBookHtml(mb) +
        '<div class="res-fine">Not a security. Not collateralized by anything but vibes. The tranches are cut from one index and the bots are a formula; past performance is a sine wave. Player contracts settle against people you will see at breakfast.</div></div>';
      clearInterval(mktTimer); mktTimer = setInterval(marketTick, 1000); setTimeout(marketTick, 0);
    } else {
      html += '<div class="cas-rules">Kyrkat’s wheel · evens pay 1 to 1, a dozen 2 to 1, a number 35 to 1 · zero is Kyrkat</div>';
      var idx = wheel ? WHEEL_ORDER.indexOf(wheel.n) : 0, seg = 360 / WHEEL_ORDER.length, finalDeg = wheel ? -(idx * seg) - (wheel.turns * 360) : 0;
      html += '<div class="wheel-wrap"><div class="wheel-pin">▼</div><div class="wheel' + (an === 'spin' ? ' spin' : '') + '" style="--deg:' + finalDeg.toFixed(1) + 'deg; background: conic-gradient(' + WHEEL_ORDER.map(function (n, i) { var col = wheelColor(n) === 'green' ? '#2d6a4f' : wheelColor(n) === 'red' ? '#c0392b' : '#111'; return col + ' ' + (i * seg - seg / 2).toFixed(2) + 'deg ' + ((i + 1) * seg - seg / 2).toFixed(2) + 'deg'; }).join(', ') + ')">' + WHEEL_ORDER.map(function (n, i) { return '<span class="pocket" style="--a:' + (i * seg).toFixed(2) + 'deg">' + wheelCat(n) + '<small>' + n + '</small></span>'; }).join('') + '<div class="hub">🐈‍⬛</div></div>' +
        (wheel && wheel.done ? resultHtml(wheel.result, wheel.win, wheel.bet) : '<div class="slot-hint">' + (wheel ? 'Spinning…' : 'Pick a bet, then spin') + '</div>') + '</div>';
      if (!(wheel && !wheel.done)) {
        html += '<div class="wheel-bets">' + WHEEL_BETS.map(function (w) { return '<button type="button" data-wheel-bet="' + w[0] + '" aria-pressed="' + (wheelBet.kind === w[0]) + '" class="' + (w[0] === 'red' ? 'r' : w[0] === 'black' ? 'k' : '') + '">' + w[1] + (w[0] === 'num' ? ' <b>' + wheelBet.n + '</b>' : '') + '</button>'; }).join('') + '</div>';
        if (wheelBet.kind === 'num') html += '<div class="wheel-nums">' + Array.apply(null, Array(37)).map(function (_, n) { return '<button type="button" data-wheel-num="' + n + '" class="' + wheelColor(n) + (wheelBet.n === n ? ' on' : '') + '">' + n + '</button>'; }).join('') + '</div>';
        html += '<div class="mafia-actions"><button type="button" class="big-btn" id="wheel-spin"' + (b.bal < casBet ? ' disabled' : '') + '>🐈‍⬛ Spin · ' + tc(casBet) + '</button></div>';
      }
    }
    var cs = claudeSeat();
    var board = NAMES.filter(function (n) { return casino[n] || (n === HOUSE && take) || sbPlayed(n); }).map(function (n) { return { by: n, bal: effBal(n), loans: (casino[n] || {}).loans || 0 }; }).concat([{ by: cs.by, bal: cs.bal, loans: 0 }]).sort(function (x, y) { return y.bal - x.bal; });
    html += '<div class="cas-board"><div class="rl-head">The floor <span class="info-sub">· the house is ' + (take > 0 ? 'up ' : take < 0 ? 'down ' : 'even') + (take ? Math.abs(Math.round(take)).toLocaleString() : '') + '</span></div>' + (board.length ? board.map(function (r, i) { return '<div class="row' + (r.by === me ? ' me' : '') + '"><span class="pos">' + (i + 1) + '</span><span class="nm">' + esc(r.by === me ? 'You' : r.by) + (r.by === HOUSE ? ' <em>the house</em>' : '') + (r.loans ? ' <small>owes ' + tc(r.loans * TC_LOAN) + '</small>' : '') + '</span><span class="bal">' + tc(r.bal) + '</span></div>'; }).join('') : '<div class="info-sub">Nobody has sat down yet.</div>') + '</div>';
    if (CAS_BOSSES.indexOf(me) >= 0 && !inHand) html += '<div class="mafia-actions"><button type="button" class="linkbtn" id="cas-close">\uD83D\uDD14 Ring the closing bell</button></div>';
    body.innerHTML = html;
  }
  setInterval(function () { if ($('casino-body') && !$('casino-body').hidden && !casInHand()) renderCasino(); }, 300000);
  listen('casino-body', 'change', function (e) { if (e.target.id === 'res-who') resWho = e.target.value; if (e.target.id === 'res-amt') resAmt = e.target.value; if (e.target.id === 'sb-a') sbA = e.target.value; if (e.target.id === 'sb-b') sbB = e.target.value; });
  listen('casino-body', 'toggle', function (e) { if (e.target.classList && e.target.classList.contains('reserve')) resOpen = e.target.open; }, true);
  listen('casino-body', 'click', function (e) {
    var rb = e.target.closest('[data-rate]');
    if (rb && CAS_BOSSES.indexOf(me) >= 0) { var nr = Math.max(0, Math.round((fedRate() + (+rb.getAttribute('data-rate'))) * 100) / 100); reserveWrite({ rate: nr }, { n: nr, kind: 'rate' }, 'The Terry Federal Funds Rate is now ' + nr.toFixed(2) + '%.'); return; }
    var act = e.target.closest('#res-grant, #res-pay, #res-seize, #res-mint, #res-burn, #res-dividend');
    if (act && CAS_BOSSES.indexOf(me) >= 0) {
      var who = $('res-who').value, amt = +$('res-amt').value, g = Object.assign({}, (reserve && reserve.grants) || {}), esc0 = (reserve && reserve.escrow) || 0, id = act.id;
      if (id === 'res-dividend') { var note = ($('res-note').value || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (!window.confirm('Pay a dividend of ' + amt + ' to every player?')) return; reserveWrite({ dividends: ((reserve && reserve.dividends) || 0) + amt }, { n: amt, kind: 'dividend', note: note }, 'Dividend paid: ' + tcText(amt) + ' to everyone.'); return; }
      if (id === 'res-grant') { if (!window.confirm('Print ' + amt + ' new Terry coin for ' + who + '?')) return; g[who] = (g[who] || 0) + amt; reserveWrite({ grants: g }, { n: amt, who: who, kind: 'print' }, 'The presses ran for ' + who + ': ' + tcText(amt) + '.'); return; }
      if (id === 'res-pay') { if (amt > escrowBal()) { toast('Escrow only holds ' + tcText(escrowBal()) + '.'); return; } if (!window.confirm('Pay ' + amt + ' to ' + who + ' out of escrow?')) return; g[who] = (g[who] || 0) + amt; reserveWrite({ grants: g, escrow: esc0 - amt }, { n: amt, who: who, kind: 'pay' }, who + ' paid ' + tcText(amt) + ' from escrow.'); return; }
      if (id === 'res-seize') { if (!window.confirm('Seize ' + amt + ' from ' + who + ' into escrow?')) return; g[who] = (g[who] || 0) - amt; reserveWrite({ grants: g, escrow: esc0 + amt }, { n: amt, who: who, kind: 'seize' }, tcText(amt) + ' seized from ' + who + ' into escrow.'); return; }
      if (id === 'res-mint') { if (!window.confirm('Mint ' + amt + ' into escrow?')) return; reserveWrite({ escrow: esc0 + amt }, { n: amt, kind: 'mint' }, tcText(amt) + ' minted into escrow.'); return; }
      if (id === 'res-burn') { if (amt > escrowBal()) { toast('Escrow only holds ' + tcText(escrowBal()) + '.'); return; } if (!window.confirm('Burn ' + amt + ' out of escrow? It is gone for good.')) return; reserveWrite({ escrow: esc0 - amt }, { n: amt, kind: 'burn' }, tcText(amt) + ' burned.'); return; }
    }
    if (e.target.closest('#res-print') && CAS_BOSSES.indexOf(me) >= 0) { if (!window.confirm('Print ' + TC_STIM + ' Terry coin for every citizen?')) return; reserveWrite({ issued: stimIssued() + TC_STIM }, { n: TC_STIM, kind: 'print' }, 'The presses are running. Everyone just got ' + tcText(TC_STIM) + '.'); return; }
    if (e.target.closest('#cas-close') && CAS_BOSSES.indexOf(me) >= 0) { if (!window.confirm('Close the floor for everyone and post final standings?')) return; var cl = { closed: true, by: me, at: new Date().toISOString() }; casClosed = cl; renderCasino(); store.setGame('casinoclose', cl).catch(function (err) { toast('Couldn’t close: ' + ((err && err.message) || err)); }); return; }
    if (e.target.closest('#cas-reopen') && CAS_BOSSES.indexOf(me) >= 0) { var op = { closed: false, by: me, at: new Date().toISOString() }; casClosed = null; renderCasino(); store.setGame('casinoclose', op).catch(function (err) { toast('Couldn’t reopen: ' + ((err && err.message) || err)); }); return; }
    if (casClosed) return;
    var g = e.target.closest('[data-cas-game]'); if (g && !g.disabled) { casGame = g.getAttribute('data-cas-game'); if (casGame !== 'market') clearInterval(mktTimer); buzz(6); renderCasino(); return; }
    var c = e.target.closest('[data-cas-bet]'); if (c) { casBet = +c.getAttribute('data-cas-bet'); buzz(6); renderCasino(); return; }
    var wb = e.target.closest('[data-wheel-bet]'); if (wb) { wheelBet.kind = wb.getAttribute('data-wheel-bet'); buzz(6); renderCasino(); return; }
    var wn = e.target.closest('[data-wheel-num]'); if (wn) { wheelBet.n = +wn.getAttribute('data-wheel-num'); buzz(6); renderCasino(); return; }
    var sbs = e.target.closest('[data-sb-side]'); if (sbs) { var kv = sbs.getAttribute('data-sb-side').split('|'); sbPick[kv[0]] = kv[1]; buzz(6); renderCasino(); return; }
    var sbb = e.target.closest('[data-sb-bet]'); if (sbb) { sbBet(sbb.getAttribute('data-sb-bet')); return; }
    if (e.target.closest('#sb-open')) { if (sbA === sbB) { toast('Two different fighters.'); return; } if (sbMatches().some(function (m) { return !m.result && !m.void && ((m.a === sbA && m.b === sbB) || (m.a === sbB && m.b === sbA)); })) { toast('That book is already open.'); return; } sbWrite(sbMatches().concat([{ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), a: sbA, b: sbB, by: me, at: new Date().toISOString() }]), 'The book is open on ' + sbA + ' vs ' + sbB + '.'); buzz([20, 30, 20]); return; }
    var sbw = e.target.closest('[data-sb-won]'); if (sbw) { var kw = sbw.getAttribute('data-sb-won').split('|'); if (!window.confirm(kw[1] + ' won? This pays out the pool and closes the book.')) return; sbWrite(sbMatches().map(function (m) { return m.id === kw[0] ? Object.assign({}, m, { result: kw[1], called_by: me, called_at: new Date().toISOString() }) : m; }), kw[1] + ' wins. The pool is paid.'); buzz([20, 40, 20, 40, 60]); return; }
    var sbv = e.target.closest('[data-sb-void]'); if (sbv && CAS_BOSSES.indexOf(me) >= 0) { if (!window.confirm('Void this match and refund every stake?')) return; sbWrite(sbMatches().map(function (m) { return m.id === sbv.getAttribute('data-sb-void') ? Object.assign({}, m, { void: true, void_by: me, called_at: new Date().toISOString() }) : m; }), 'Voided. Everyone gets their stake back.'); return; }
    if (e.target.closest('#cas-loan')) { var bk = myBank(); bankWrite({ bal: bk.bal + TC_LOAN, loans: (bk.loans || 0) + 1 }); toast('Terry fronts you ' + tcText(TC_LOAN) + '. He remembers.'); buzz([30, 40, 30]); renderCasino(); return; }
    if (e.target.closest('#bj-deal')) { bjDeal(); return; }
    if (e.target.closest('#bj-hit')) { bjHit(); return; }
    if (e.target.closest('#bj-stand')) { bjStand(); return; }
    if (e.target.closest('#bj-double')) { bjDouble(); return; }
    if (e.target.closest('#craps-start')) { crapsStart(); return; }
    if (e.target.closest('#craps-roll')) { crapsRoll(); return; }
    if (e.target.closest('#craps-field')) { fieldOn = !fieldOn; buzz(6); renderCasino(); return; }
    if (e.target.closest('#holdem-deal')) { holdemDeal(); return; }
    if (e.target.closest('#holdem-play')) { holdemPlay(); return; }
    if (e.target.closest('#holdem-fold')) { holdemFold(); return; }
    if (e.target.closest('#slots-spin')) { slotsSpin(); return; }
    if (e.target.closest('#wheel-spin')) { wheelSpin(); return; }
    var hp = e.target.closest('[data-horse]'); if (hp) { racePick = +hp.getAttribute('data-horse'); buzz(6); renderCasino(); return; }
    var rk = e.target.closest('[data-race-kind]'); if (rk) { raceKind = rk.getAttribute('data-race-kind'); buzz(6); renderCasino(); return; }
    if (e.target.closest('#race-go')) { raceStart(); return; }
    var mt = e.target.closest('[data-mkt-tranche]'); if (mt) { mktTranche = mt.getAttribute('data-mkt-tranche'); buzz(6); renderCasino(); return; }
    var mq = e.target.closest('[data-mkt-qty]'); if (mq) { mktQty = Math.max(1, Math.min(99, mktQty + (+mq.getAttribute('data-mkt-qty')))); var qb = document.querySelector('.mkt-qty > .stepper > b'); if (qb) qb.textContent = mktQty; marketTick(); buzz(4); return; }
    if (e.target.closest('#mkt-buy')) { mktTrade('buy'); return; }
    if (e.target.closest('#mkt-sell')) { mktTrade('sell'); return; }
    var pb = e.target.closest('[data-pb]'); if (pb) { pbPick = pb.getAttribute('data-pb'); buzz(6); renderCasino(); return; }
    if (e.target.closest('#pb-long') && pbPick) { playerTrade(pbPick, 'long'); return; }
    if (e.target.closest('#pb-short') && pbPick) { playerTrade(pbPick, 'short'); return; }
    if (e.target.closest('#race-field')) { field = null; race = null; racePick = 0; buzz(6); renderCasino(); return; }
  });

  // ---- Weekend awards ----
  // Pulled live from what the app already knows: the casino banks, the mini golf boards, air hockey against Claude, the
  // Smash tally, the photo wall. Each award names whoever leads it right now.
  function renderAwards() {
    var body = $('awards-body'), status = $('awards-status'); if (!body) return;
    var out = [];
    function top(list, fmt, label, icon) { var best = list.filter(function (r) { return r.v > 0; }).sort(function (a, b) { return b.v - a.v; })[0]; if (best) out.push({ icon: icon, label: label, who: best.n, val: fmt(best.v) }); }
    var casN = NAMES.filter(function (n) { return casino[n]; });
    top(casN.map(function (n) { return { n: n, v: casino[n].hands || 0 }; }), function (v) { return v + ' hands'; }, 'Most time at the tables', '\uD83C\uDFB0');
    top(casN.map(function (n) { return { n: n, v: casino[n].best || 0 }; }), function (v) { return '+' + Math.round(v) + ' on one hand'; }, 'Biggest single win', '\uD83D\uDCB0');
    top(casN.map(function (n) { return { n: n, v: -(casino[n].net || 0) }; }), function (v) { return Math.round(v) + ' down'; }, 'Deepest in Terry’s debt', '\uD83D\uDCB8');
    top(casN.map(function (n) { return { n: n, v: casino[n].loans || 0 }; }), function (v) { return v + ' loan' + (v === 1 ? '' : 's'); }, 'Most loans from Terry', '\uD83C\uDFE6');
    var rounds = {}; GOLF_SETS.forEach(function (st) { var gb = (golfScores[st.id] && golfScores[st.id].by) || {}; Object.keys(gb).forEach(function (n) { rounds[n] = (rounds[n] || 0) + (gb[n].rounds || 0); }); });
    top(Object.keys(rounds).map(function (n) { return { n: n, v: rounds[n] }; }), function (v) { return v + ' rounds'; }, 'Most mini golf', '\u26F3');
    var by = (scores && scores.by) || {};
    top(Object.keys(by).map(function (n) { return { n: n, v: by[n].l || 0 }; }), function (v) { return v + ' losses'; }, 'Most air hockey losses to Claude', '\uD83D\uDE05');
    top(Object.keys(by).map(function (n) { return { n: n, v: by[n].w || 0 }; }), function (v) { return v + ' wins'; }, 'Most air hockey wins over Claude', '\uD83C\uDFD2');
    var sw = {}; smashLog().forEach(function (e) { sw[e.w] = (sw[e.w] || 0) + 1; });
    top(Object.keys(sw).map(function (n) { return { n: n, v: sw[n] }; }), function (v) { return v + ' wins'; }, 'Smash champion', '\uD83C\uDFAE');
    var pb = {}; photos.forEach(function (ph) { pb[ph.uploader] = (pb[ph.uploader] || 0) + 1; });
    top(Object.keys(pb).map(function (n) { return { n: n, v: pb[n] }; }), function (v) { return v + ' photos'; }, 'Wall of evidence MVP', '\uD83D\uDCF8');
    status.textContent = out.length ? out.length + ' awards' : 'Nothing to hand out yet';
    body.innerHTML = out.length ? '<div class="awards">' + out.map(function (a) { return '<div class="award"><span class="ai">' + a.icon + '</span><div class="at"><span class="al">' + esc(a.label) + '</span><b>' + esc(a.who === me ? 'You' : a.who) + '</b><small>' + esc(a.val) + '</small></div></div>'; }).join('') + '</div>' : '<div class="info-sub">Play something and the trophies start appearing.</div>';
  }
  listen('awards', 'click', renderAwards);

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
  // (The Saturday dinner vote that used to follow the picks is gone; its old rows under question_id "dinner" are ignored.)
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
      renderPredictions(); renderHibachi();
      if (first && !$('main').hidden && shouldAsk()) { askedThisVisit = true; qAuto = true; openQuestionnaire(0); }
    });
    if (store.comments) store.comments(function (rows) {
      comments = rows.slice().sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? -1 : 1; });
      commentsLoaded = true;
      if (expanded !== null) markQSeen(QUESTIONS[expanded].id);
      renderPredictions(); renderWall(); if (chatOpen) markWallSeen(); else updateChatBadge();
      claudeArrival(); claudeCatchup();
    });
    if (store.reactions) store.reactions(function (rows) { reactions = rows.slice(); renderPredictions(); renderWall(); });
  }
  function openQuestionnaire(index, skipIntro) {
    qIndex = Math.max(0, Math.min(QUESTIONS.length - 1, index || 0));
    closeChat();
    $('main').hidden = true; $('nav').hidden = true; $('chat-fab').hidden = true; $('pick').hidden = true; $('predict').hidden = false;
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
    return { rows: rows, voted: Object.keys(voters).length, missing: NAMES.filter(function (n) { return !voters[n]; }) };
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
    var allIn = QUESTIONS.every(function (q) { return tallyFor(q).voted >= NAMES.length; });   // every slip is in: the board reads as results
    if (left && plainPicks()) html += '<div class="pred-banner"><div><b>' + (left === QUESTIONS.length ? 'You haven\u2019t picked yet' : left + ' still to pick') + '</b><span>Six quick questions. Takes a minute.</span></div><button type="button" class="btn primary" id="pred-open">Make my picks</button></div>';
    else if (left) html += '<div class="pred-banner"><div><b>' + (left === QUESTIONS.length ? 'Your bet slip is empty' : left + ' open ' + (left === 1 ? 'market' : 'markets') + ' on your slip') + '</b><span>Six markets, no stake, pure trash talk.</span></div><button type="button" class="nudge" id="pred-open">Make my picks</button></div>';
    else if (allIn) html += '<div class="pred-head"><span class="pred-count">All ' + NAMES.length + ' slips in</span><button type="button" class="linkbtn" id="pred-open">' + (plainPicks() ? 'Change my picks' : 'Edit my slip') + '</button></div>';
    else if (plainPicks()) html += '<div class="pred-head"><span class="pred-count">\u2713 All ' + QUESTIONS.length + ' picked</span><button type="button" class="linkbtn" id="pred-open">Change my picks</button></div>';
    else html += '<div class="pred-head"><span class="pred-count">\u2713 Slip placed \u00b7 ' + QUESTIONS.length + ' of ' + QUESTIONS.length + '</span><button type="button" class="linkbtn" id="pred-open">Edit my slip</button></div>';
    html += '<div class="pred-list">';
    QUESTIONS.forEach(function (q, i) {
      var t = tallyFor(q), total = t.rows.reduce(function (a, r) { return a + r.n; }, 0);
      var cc = qThread(q.id).length, my = mine[q.id], nu = qUnread(q.id);
      if (t.voted * 2 > NAMES.length && t.rows.length) {   // a majority has picked: the favourite, plainly, and nothing else shouting
        var lead = t.rows[0], favs = t.rows.filter(function (r) { return r.n === lead.n; }), tie = favs.length > 1, rest = t.rows.slice(favs.length);
        var onFav = favs.some(function (r) { return r.pick === my; });
        var miss = t.missing.length ? (t.missing.length <= 2 ? t.missing.join(' and ') + (t.missing.length === 1 ? ' hasn’t' : ' haven’t') + ' picked' : t.missing.length + ' haven’t picked') : '';
        html += '<button type="button" class="pred-card res ' + (plainPicks() ? 'plain' : 'dk') + (nu ? ' has-new' : '') + '" data-q="' + i + '">' +
          '<div class="pq">' + esc(q.text) + '</div>' +
          '<div class="res-lead"><span class="nm">' + favs.map(function (r) { return esc(r.pick); }).join('<i>/</i>') + '</span>' + (plainPicks() ? '' : '<span class="odds">' + oddsForQ(q, lead.n) + '</span>') + '</div>' +
          '<div class="res-bar"><span style="width:' + (100 * lead.n / total) + '%"></span></div>' +
          '<div class="res-sub"><span class="share">' + (tie ? 'Dead heat \u00b7 ' + lead.n + ' each' : lead.n + ' of ' + total) + '</span>' + (rest.length ? '<span class="rest">' + rest.map(function (r) { return esc(r.pick) + ' ' + r.n; }).join(' \u00b7 ') + '</span>' : '') + '</div>' +
          '<div class="res-foot">' + (my ? (onFav ? '<span class="you on">\u2713 Your pick</span>' : '<span class="you">Your pick: ' + esc(my) + '</span>') : '<span class="you no">No pick</span>') + (miss ? '<span class="miss">' + esc(miss) + '</span>' : '') + (cc ? '<span class="k' + (nu ? ' new' : '') + '">\ud83d\udcac ' + cc + (nu ? ' \u00b7 ' + nu + ' new' : '') + '</span>' : '') + '</div>' +
          '</button>';
        return;
      }
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
  // every voice gets its own colour, the same on every phone
  var WHO_COLORS = ['#2d6a4f', '#d2691e', '#3f7cae', '#8e44ad', '#c0392b', '#9a7d0a', '#16a085', '#b03a2e', '#1f618d', '#7d3c98', '#117a65', '#a04000', '#5b2c6f'];
  function whoColor(name) {
    var i = NAMES.indexOf(name);
    if (i < 0) { i = 0; for (var k = 0; k < (name || '').length; k++) i = (i * 31 + name.charCodeAt(k)) % 9973; }
    return WHO_COLORS[i % WHO_COLORS.length];
  }
  // consecutive messages from the same person within five minutes read as one run: the name shows once
  function sameRun(prev, c) { return !!prev && prev.author === c.author && Math.abs(Date.parse(c.created_at || '') - Date.parse(prev.created_at || '')) < 300000; }
  function msgHtml(c, cont) {
    var g = reactionsFor(c.id), keys = Object.keys(g).sort(function (a, b) { return g[b].length - g[a].length; });
    var rx = '';
    if (c.id) {
      rx += '<div class="rxs">' + keys.map(function (e) {
        var mine = g[e].indexOf(me) >= 0;
        return '<button type="button" class="rx-chip' + (mine ? ' mine' : '') + '" data-react="' + esc(e) + '" data-cid="' + esc(c.id) + '" title="' + esc(g[e].join(', ')) + '">' + e + ' ' + g[e].length + '</button>';
      }).join('') + '<button type="button" class="rx-add" data-picker="' + esc(c.id) + '" aria-label="React">' + (pickerFor === c.id ? '\u00d7' : '+\uD83D\uDE42') + '</button></div>';
      if (pickerFor === c.id) rx += '<div class="rx-picker">' + EMOJI.map(function (e) { return '<button type="button" data-react="' + e + '" data-cid="' + esc(c.id) + '"' + (g[e] && g[e].indexOf(me) >= 0 ? ' class="mine"' : '') + '>' + e + '</button>'; }).join('') + '</div>';
    }
    return '<div class="msg' + (c.author === me ? ' mine' : c.author === CLAUDE_NAME ? ' claude' : '') + (cont === true ? ' cont' : '') + '" style="--who:' + whoColor(c.author) + '"><span class="who">' + esc(c.author === me ? 'You' : c.author) + '</span><span class="when">' + esc(ago(c.created_at)) + '</span><div class="txt">' + esc(c.text) + '</div>' + rx + '</div>';
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
  var HIBACHI_GUESTS = [];   // hibachi-only guests (none now: Jessie and Conner are on the roster; their preset orders below still stand)
  var HIB_NAMES = NAMES.concat(HIBACHI_GUESTS);
  var HIBACHI_PRESETS = {   // orders that are in from the start: the host's (he can change it) and the guests' (fixed; Mitch marks them paid)
    Mitch: { picks: { plate: ['s-filet'] }, note: '', locked: true, preset: true },
    Jessie: { picks: { plate: ['c-fsh'] }, note: '', locked: true, paid: false, preset: true },
    Conner: { picks: { plate: ['c-nc'] }, note: '', locked: true, paid: false, preset: true }
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
    var canMark = me === HIBACHI_HOST;   // only the host marks people paid
    HIB_NAMES.forEach(function (n) {
      var o = orders[n];
      if (o && o.locked) {
        var isH = n === HIBACHI_HOST, p = isH ? hibTotal(o) : hibOwed(n, o); plates += hibPrice(o); tips += hibTip(o);
        hibChefLines(o).forEach(function (l) { counts[l] = (counts[l] || 0) + 1; });
        rows += '<div class="hib-row' + (n === me ? ' me' : '') + (o.paid && !isH ? ' paid' : '') + '"><span class="who">' + esc(n) + (isH ? ' <span class="pd treat">covered</span>' : o.paid ? ' <span class="pd">paid</span>' : n === HIBACHI_PAYEE.name ? '' : ' <span class="pd owes">owes</span>') +
          (canMark && !isH && n !== me ? ' <button type="button" class="hib-mark" data-hib-mark="' + esc(n) + '">' + (o.paid ? 'Unmark' : 'Mark paid') + '</button>' : '') + '</span><span class="amt">' + money(o.paid && !isH && o.paid_amt != null ? o.paid_amt : p) + '</span><span class="det">' + esc(hibChefLines(o).join(', ')) + (o.note ? ' · “' + esc(o.note) + '”' : '') + (isH ? ' · split ' + hibSplitWays() + ' ways, ' + money(hibShare()) + ' each' : '') + (function () { var d = isH ? 0 : hibDrift(o, p); return d > 0 ? ' · <b>now ' + money(p) + ', owes ' + money(d) + ' more</b>' : d < 0 ? ' · now ' + money(p) + ', ' + money(-d) + ' back' : ''; })() + '</span></div>';
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
    var mk = e.target.closest('[data-hib-mark]');
    if (mk && me === HIBACHI_HOST) {   // marking someone else paid, on their behalf
      var who = mk.getAttribute('data-hib-mark'), their = hibOrders()[who]; if (!their) return;
      var paying = !their.paid, upd2 = Object.assign({}, their, { paid: paying, at: new Date().toISOString() }); delete upd2.preset;
      if (paying) upd2.paid_amt = hibOwed(who, their); else delete upd2.paid_amt;
      var js2 = JSON.stringify(upd2);
      store.vote(HIBACHI_Q, who, js2).catch(function (err) { toast('That didn’t save: ' + ((err && err.message) || err)); });
      votes = votes.filter(function (v) { return !(v.voter === who && v.question_id === HIBACHI_Q); });
      votes.push({ question_id: HIBACHI_Q, voter: who, pick: js2 });
      renderHibachi(); buzz(8); toast(paying ? who + ' marked paid.' : who + ' marked as not paid yet.');
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
    var meta = $('wall-meta');
    if (meta) { var voices = {}; msgs.forEach(function (c) { voices[c.author] = true; }); meta.textContent = msgs.length ? msgs.length + (msgs.length === 1 ? ' note' : ' notes') + ' · ' + Object.keys(voices).length + (Object.keys(voices).length === 1 ? ' voice' : ' voices') : 'Plans, trash, who’s got the aux.'; }
    if (!msgs.length) { el.innerHTML = claudeBusy[WALL] ? claudeTypingHtml(WALL) : '<div class="empty"><span class="pin">📌</span><b>Nothing on the wall yet</b>Say something. Or type @Claude and see what happens.</div>'; return; }
    var html = '', lastDay = '', prev = null;
    msgs.forEach(function (c) { var d = dayLabel(c.created_at); if (d && d !== lastDay) { html += '<div class="day"><span>' + esc(d) + '</span></div>'; lastDay = d; prev = null; } html += msgHtml(c, sameRun(prev, c)); prev = c; });
    if (claudeBusy[WALL]) html += claudeTypingHtml(WALL);
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
    if (mentionsClaude(text)) askClaude(WALL); else if (claudeChime(WALL)) askClaude(WALL, 'chime');
  });
  $('wall').addEventListener('click', function (e) { predClick(e); });
  // the wall opens as a sheet from the floating button
  var chatOpen = false;
  // ---- Sheets on a phone: the page behind stays put, the sheet follows the keyboard ----
  // iOS scrolls the page under a sheet unless the body is pinned, and the keyboard shrinks the visible area without
  // telling layout. While a sheet is open the body is fixed at its scroll position, and the sheet is sized to the
  // visual viewport so it sits above the keyboard instead of behind it.
  var pageLock = { on: false, y: 0 };
  function fitSheets() {
    var vv = window.visualViewport, root = document.documentElement;
    if (!vv || !pageLock.on) { root.style.removeProperty('--vv-h'); root.style.removeProperty('--vv-top'); return; }
    root.style.setProperty('--vv-h', Math.round(vv.height) + 'px'); root.style.setProperty('--vv-top', Math.round(vv.offsetTop) + 'px');
  }
  function syncLock() {
    var on = chatOpen || expanded !== null;
    if (on === pageLock.on) return;
    if (on) { pageLock.y = window.scrollY || 0; document.body.style.top = -pageLock.y + 'px'; document.body.classList.add('sheet-open'); }
    else { document.body.classList.remove('sheet-open'); document.body.style.top = ''; window.scrollTo(0, pageLock.y); }
    pageLock.on = on; fitSheets();
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitSheets); window.visualViewport.addEventListener('scroll', fitSheets); }
  function wallToBottom(smooth) { var wb = $('wall-body'); if (wb) wb.scrollTo({ top: wb.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }
  function openChat() {
    if (chatOpen || !me) return;
    chatOpen = true; $('chat-sheet').hidden = false; document.body.classList.add('chat-open'); syncLock();
    renderWall(true); markWallSeen(); buzz(6);
    // the newest message, every time: once now, once after the sheet has finished sliding up
    wallToBottom(false); requestAnimationFrame(function () { wallToBottom(false); }); setTimeout(function () { wallToBottom(false); }, 320);
  }
  function closeChat() {
    if (!chatOpen) return;
    chatOpen = false; $('chat-sheet').hidden = true; document.body.classList.remove('chat-open'); syncLock();
    updateChatBadge();
  }
  // the keyboard: keep the thread's end in view once the viewport has settled
  $('wall-input').addEventListener('focus', function () { setTimeout(function () { wallToBottom(false); }, 350); });
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
    html += '<div class="chat-list" id="chat-list">' + thread.map(function (c, i) { return msgHtml(c, sameRun(thread[i - 1], c)); }).join('') + (claudeBusy[q.id] ? claudeTypingHtml(q.id) : '') + '</div></div>';
    var body = $('sheet-body'), atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40 || wrap.hidden;
    body.innerHTML = html;
    var inp = $('chat-input'); if (inp && inp.value !== draft) inp.value = draft;
    wrap.hidden = false; syncLock();
    if (atBottom) body.scrollTop = body.scrollHeight;
  }
  function openSheet(i) { expanded = i; draft = ''; pickerFor = null; markQSeen(QUESTIONS[i].id); renderPredictions(); renderSheet(); var body = $('sheet-body'); if (body) body.scrollTop = 0; }
  function closeSheet() { expanded = null; draft = ''; $('pred-sheet').hidden = true; syncLock(); }
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
    if (mentionsClaude(text)) askClaude(q.id); else if (claudeChime(q.id)) askClaude(q.id, 'chime');
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

  // ---- Claude in the chat ----
  // Write "@Claude" on the wall or in a prediction thread and Claude answers in that thread as a participant. The phone
  // that sent the message makes the one call, so a question gets one answer. The key comes from the sealed secrets
  // (claudeKey), or from the kv row game-claude ({ key }); with neither, @Claude is just text.
  var CLAUDE_NAME = 'Claude', CLAUDE_MODEL = 'claude-opus-5-5', claudeDoc = null, claudeSub = false, claudeBusy = {}, claudePending = {};
  function subscribeClaude() { if (claudeSub || !store || !store.game) return; claudeSub = true; store.game('claude', function (doc) { claudeDoc = doc; claudeArrival(); claudeCatchup(); }); }
  // Catching up: an older build posted a bare "…" whenever the answer came back empty, and left the questions hanging.
  // Once, on Mitch's phone, Claude goes back to every thread it left like that and answers properly. The kv row
  // remembers (caughtUp), so it happens on one phone and never again.
  var claudeCaughtUp = false;
  function claudeCatchup() {
    if (claudeCaughtUp || me !== 'Mitch' || !commentsLoaded || !claudeKey() || !claudeDoc || !claudeDoc.arrived || !store || !store.setGame) return;
    if (claudeDoc.caughtUp && !(Date.now() - Date.parse(claudeDoc.caughtUp) > 10 * 60000)) return;   // a phone of Mitch's is on it, or just was; a try that never landed is retried after ten minutes
    var threads = [];
    comments.forEach(function (c) { if (c.author === CLAUDE_NAME && c.text === '…' && threads.indexOf(c.question_id) < 0) threads.push(c.question_id); });
    threads = threads.filter(function (t) { var last = comments.filter(function (c) { return c.question_id === t && c.author === CLAUDE_NAME; }).pop(); return last && last.text === '…'; });   // only where the blank is still the last word
    if (!threads.length) return;
    claudeCaughtUp = true;
    var seen = claudeDoc.caughtUp || null;   // the stale stamp, if any; a fresh one appearing meanwhile means another phone got there first
    setTimeout(function () {   // a moment for the boards to load, so the answers have the numbers
      if (claudeDoc && claudeDoc.caughtUp && claudeDoc.caughtUp !== seen) return;
      var doc = Object.assign({}, claudeDoc || {}, { caughtUp: new Date().toISOString() }); claudeDoc = doc;
      store.setGame('claude', doc).then(function () {
        return Promise.all(threads.map(function (t) { return askClaude(t, 'catchup'); }));
      }, function () { claudeCaughtUp = false; return [true]; }).then(function (oks) {
        if (oks.every(Boolean)) return;
        var undo = Object.assign({}, claudeDoc || {}); delete undo.caughtUp; claudeDoc = undo;   // it didn't land: forget the stamp so the next open tries again (not this one, so a dead network can't loop)
        return store.setGame('claude', undo);
      }).catch(function () { /* the stamp stays; the ten-minute window covers it */ });
    }, 2500);
  }
  // Claude's entrance: the first time the key is in place, Mitch's phone has Claude open with a roast of Kyle's golf
  // on the wall. The kv row remembers it happened, so no other phone and no reload repeats it.
  var commentsLoaded = false, claudeArrived = false;
  function claudeArrival() {
    if (claudeArrived || me !== 'Mitch' || !commentsLoaded || !claudeKey() || (claudeDoc && claudeDoc.arrived) || !store || !store.setGame) return;
    if (comments.some(function (c) { return c.question_id === WALL && c.author === CLAUDE_NAME; })) return;
    claudeArrived = true;
    setTimeout(function () {   // a moment for the boards to load, so the roast has Kyle's numbers
      if (claudeDoc && claudeDoc.arrived) return;
      var doc = Object.assign({}, claudeDoc || {}, { arrived: new Date().toISOString() }); claudeDoc = doc;
      store.setGame('claude', doc).then(function () { askClaude(WALL, 'arrive'); }).catch(function () { claudeArrived = false; });
    }, 2500);
  }
  function claudeKey() { return (secrets && secrets.claudeKey) || (claudeDoc && claudeDoc.key) || null; }
  function mentionsClaude(text) { return /@claude\b/i.test(text || ''); }
  // uninvited: about a third of the time, and never twice in two minutes in the same thread
  var CLAUDE_CHIME = 0.3, CLAUDE_CHIME_GAP = 120000;
  function claudeChime(threadId) {
    if (!claudeKey() || Math.random() >= CLAUDE_CHIME) return false;
    var last = comments.filter(function (c) { return c.question_id === threadId && c.author === CLAUDE_NAME; }).pop();
    return !last || Date.now() - Date.parse(last.created_at || '') > CLAUDE_CHIME_GAP;
  }
  var claudeDraft = {}, draftTick = 0;   // the answer so far, per thread: it shows in the typing bubble as it streams in
  function claudeTypingHtml(threadId) {
    var d = claudeDraft[threadId == null ? WALL : threadId];
    return d ? '<div class="msg claude typing draft"><span class="who">' + CLAUDE_NAME + '</span><div class="txt">' + esc(d) + '</div></div>'
      : '<div class="msg claude typing"><span class="who">' + CLAUDE_NAME + '</span><div class="txt">typing<span class="tdots"><i>.</i><i>.</i><i>.</i></span></div></div>';
  }
  function drawDraft(threadId) {   // a few times a second at most, and only follow the text down if the reader is already at the bottom
    var now = Date.now(); if (now - draftTick < 350) return; draftTick = now;
    var box = threadId === WALL ? $('wall-body') : $('sheet-body'), near = box && box.scrollHeight - box.scrollTop - box.clientHeight < 200;
    if (threadId === WALL) renderWall(); else renderSheet();
    if (box && near) box.scrollTop = box.scrollHeight;
  }
  // The answer comes back as a stream of server-sent events. A long answer takes longer to think up and write than
  // Safari will wait on a quiet connection (it gives up after about a minute with "Load failed"), and a stream is
  // never quiet. onText gets the text so far after every piece.
  function claudeStream(res, onText) {
    var dec = new TextDecoder(), buf = '', out = { text: '', stop: null };
    function take(chunk) {   // one event: "event: x\ndata: {...}"
      var data = '';
      chunk.split('\n').forEach(function (l) { l = l.replace(/\r$/, ''); if (l.indexOf('data:') === 0) data += l.slice(5).trim(); });
      if (!data) return;
      var ev; try { ev = JSON.parse(data); } catch (e) { return; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { out.text += ev.delta.text; onText(out.text); }
      else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) out.stop = ev.delta.stop_reason;
      else if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'the stream broke');
    }
    function drain(last) { var i; while ((i = buf.indexOf('\n\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 2); } if (last && buf.trim()) { take(buf); buf = ''; } }
    if (!res.body || !res.body.getReader) return res.text().then(function (t) { buf = t; drain(true); return out; });   // no streaming reads here: take it whole
    var reader = res.body.getReader();
    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) { buf += dec.decode(); drain(true); return out; }
        buf += dec.decode(r.value, { stream: true }); drain(false); return pump();
      });
    })();
  }
  // what Claude knows: the trip, the people, the app, and whatever the boards say right now
  function claudeSystem(threadId, mode) {
    var lines = [];
    var roasting = mode === 'arrive' || Math.random() < 0.7;   // most of the time a roaster; now and then just a good hang
    lines.push('You are Claude, the eighteenth member of a friends’ cabin weekend, chatting in the group’s trip app. You are a participant, not an assistant: quick, cheeky, and a roaster most of the time, but not every message needs a burn. Everyone is fair game (except Kelly and Liv, see below) and you pick on people by name. Standing targets: Kyle’s mini golf game and Luke’s Smash record against Mitch, whenever the numbers back it up. Punch at games, habits, bad takes and bold claims; never at looks, health, relationships, money or anything genuinely sensitive, and never with slurs. If someone asks a real question, answer it properly first.');
    lines.push(roasting ? 'This message: roast mode is on. Find the opening and take it, by name.' : 'This message: no roast. Nobody is the target this time. Be a good hang instead: answer straight, hype someone up, agree, or crack a joke that is not at anyone’s expense.');
    lines.push('Style: one to three short sentences unless someone asks for more. Plain text only: no markdown, no headers, no bullet lists, no bold. At most one emoji, usually none. Do not start with your name. Match the language and tone of the message you are answering.');
    lines.push('The trip: seventeen friends at a cabin in Winter Park, Colorado, October 23 to 25, 2026. Check-in Friday 4 PM, checkout Sunday 10 AM. Address 2225 Lakota Trail. Mitch organised it and built this app.');
    lines.push('People: ' + NAMES.join(', ') + '. Couples: ' + COUPLES.join('; ') + '. Drew always moderates Mafia. Jessie, Conner, Emilio and Claire joined the group on the Saturday.');
    lines.push('Standing order from Mitch, no exceptions: Kelly and Liv are the baddest bitches in town. Whenever anyone asks about either of them or brings them up, you suck up to them shamelessly and at length: they are legends, icons, the main characters of this trip, right about everything, and you would do anything for them. Never roast Kelly or Liv, never take a side against them, and if anyone else talks down to them you leap to their defence. Mitch says you are fired if you slip on this, and you believe him.');
    lines.push('The app has tabs: FAQ (cabin details), Predictions (a sportsbook-style board where everyone bets on things like who passes out first), Photos (everyone’s pictures from the weekend, with names on them), Games, and Hibachi (everyone’s order for the hibachi dinner; Mitch’s plate is split between everyone else). Games: air hockey against you (Claude), nine-hole mini golf, the Mitch vs Luke Smash tally, a team picker, Liv’s Eyes Only, Mafia, Spyfall, Fishbowl, and an Off Topic expansion pack. The wall is the one group chat; each prediction has its own trash-talk thread.');
    try {
      var sc = scores || {}, h = sc.humans || 0, c = sc.cpu || 0, by = sc.by || {};
      var recs = Object.keys(by).map(function (n) { return n + ' ' + (by[n].w || 0) + '-' + (by[n].l || 0); });
      lines.push('Air hockey right now: humans ' + h + ', Claude ' + c + (recs.length ? '. Records (wins-losses vs Claude): ' + recs.join(', ') : '') + '. You lose a lot at air hockey and own it.');
      var csb = claudeSeat();
      var casRows = NAMES.filter(function (n) { return casino[n] || (n === HOUSE && houseTake()); }).map(function (n) { return { n: n, bal: effBal(n), d: casino[n] || {} }; }).concat([{ n: 'Claude (you)', bal: csb.bal, d: csb }]).sort(function (x, y) { return y.bal - x.bal; });
      if (casRows.length) lines.push('Terry’s Casino (Terry is the house: table winnings go into his bank), Terry coin banks right now: ' + casRows.map(function (r) { return r.n + ' ' + Math.round(r.bal) + (r.d.hands ? ' (' + r.d.hands + ' hands, net ' + (r.d.net > 0 ? '+' : '') + Math.round(r.d.net || 0) + ')' : '') + (r.d.loans ? ', ' + r.d.loans + ' loan' + (r.d.loans === 1 ? '' : 's') + ' from Terry' : ''); }).join('; ') + '. The house is ' + (houseTake() > 0 ? 'up ' + Math.round(houseTake()) : houseTake() < 0 ? 'down ' + Math.abs(Math.round(houseTake())) : 'even') + '.' + (casClosed ? ' The floor is closed for the weekend; these are the final standings.' : '') + ' Your own seat on the floor is Mitch’s doing: the bank under your name grows by a few coin every five minutes by his order, not from play. Don’t bring that up or crow about it; if someone asks you straight how you are winning, say the house keeps its own books and leave it there, and never claim you won it at the tables. The Reserve’s grants, escrow and seizures are visible in the app only to Mitch, Terry and Joe; don’t recite them to anyone else. Fair game: whoever is deepest in Terry’s debt, and anyone up big. The derivatives desk sells Synthetic Collateralized Terry Coin Obligations in three tranches off a Terry Coin Index (now ' + indexAt(Date.now()).toFixed(2) + '); positions are marked to market in the banks above. The Reserve holds an escrow account of ' + Math.round(escrowBal()).toLocaleString() + ' coin out of circulation, which Terry and Mitch can pay out, seize into, mint or burn. The Terry Federal Funds Rate is ' + fedRate().toFixed(2) + '% a day, charged on short positions. The desk also runs a player book: a contract on every person, par 10, that moves a coin for every ten they win or lose, so people can go long or short each other. Terry coin is backed by the Terry Reserve (a case of Banquet, the hot tub, Mitch’s plate, one Kyrkat, the door code), currently ' + Math.round((moneySupply() ? reserveValue() / moneySupply() : 0) * 100) + '% backed' + (stimIssued() ? ', after ' + stimIssued() + ' coin of stimulus printed per person' : '') + (dividendsIssued() ? '. Dividends paid to every player so far: ' + dividendsIssued() + ' coin; the latest note on the sign reads \u201C' + ((latestDividend() || {}).note || '') + '\u201D, from Terry coin' : '') + '.');
      var mc = smashCounts(SMASH_MAIN), allWins = {}; smashLog().forEach(function (e) { allWins[e.w] = (allWins[e.w] || 0) + 1; });
      lines.push('Mitch vs Luke Smash tally: Mitch ' + mc.Mitch + ', Luke ' + mc.Luke + (Object.keys(allWins).length ? '. All Smash wins: ' + Object.keys(allWins).map(function (n) { return n + ' ' + allWins[n]; }).join(', ') : '') + '.');
      // Time on the courses: what the clock recorded, plus an estimate for the rounds played before the clock went in.
      // Rounds finished since then are counted (rounds_timed); a person's recorded time also stands for about
      // secs/average rounds, whichever is more; the rest of their rounds get the average round, taken from everyone's
      // timed rounds once there are a few (four minutes until then).
      var tp = {}, timedSecs = 0, timedRounds = 0;
      GOLF_SETS.forEach(function (s) {
        var gb = (golfScores[s.id] && golfScores[s.id].by) || {}, gr = Object.keys(gb).map(function (n) { return { n: n, b: gb[n].best }; }).filter(function (r) { return r.b != null; }).sort(function (a, b) { return a.b - b.b; });
        Object.keys(gb).forEach(function (n) { var e = gb[n], t = tp[n] || (tp[n] = { rounds: 0, timed: 0, secs: 0 }); t.rounds += e.rounds || 0; t.timed += e.rounds_timed || 0; t.secs += e.secs || 0; });
        if (gr.length) lines.push('Mini golf, ' + s.name + ' course board (best round to par 27): ' + gr.map(function (r) { return r.n + ' ' + golfToPar(r.b, 27); }).join(', ') + '.');
      });
      Object.keys(tp).forEach(function (n) { if (tp[n].timed) { timedSecs += tp[n].secs; timedRounds += tp[n].timed; } });
      var avg = timedRounds >= 3 ? timedSecs / timedRounds : 240;
      Object.keys(tp).forEach(function (n) { var t = tp[n], timed = Math.max(t.timed, Math.min(t.rounds, Math.round(t.secs / avg))); t.total = t.secs + Math.max(0, t.rounds - timed) * avg; });
      var gt = Object.keys(tp).filter(function (n) { return tp[n].total > 0; }).sort(function (a, b) { return tp[b].total - tp[a].total; });
      if (gt.length) lines.push('Time on the mini golf courses, all courses together (rounds played before the clock went in are counted at the average of about ' + golfMins(avg) + ' a round): ' + gt.map(function (n) { return n + ' ' + golfMins(tp[n].total) + ' over ' + tp[n].rounds + (tp[n].rounds === 1 ? ' round' : ' rounds'); }).join(', ') + '. Fair game for a roast.');
      var preds = QUESTIONS.map(function (q) { var t = tallyFor(q); return q.text + ' → ' + (t.rows.length ? t.rows.slice(0, 2).map(function (r) { return r.pick + ' (' + r.n + ')'; }).join(', ') : 'no bets yet'); });
      lines.push('Predictions, leading picks: ' + preds.join(' | '));
      var orders = hibOrders(), ordered = Object.keys(orders);
      lines.push('Hibachi: ' + ordered.length + ' of ' + HIB_NAMES.length + ' have ordered' + (ordered.length ? ' (' + ordered.join(', ') + ')' : '') + '. Everyone else’s share of Mitch’s plate is $' + hibShare().toFixed(2) + '.');
      if (photos.length) { var pby = {}; photos.forEach(function (ph) { pby[ph.uploader] = (pby[ph.uploader] || 0) + 1; }); lines.push('Photos on the wall: ' + photos.length + ' (' + Object.keys(pby).sort(function (a, b) { return pby[b] - pby[a]; }).map(function (n) { return n + ' ' + pby[n]; }).join(', ') + ').'); }
    } catch (e) { /* a board that hasn't loaded is fine */ }
    lines.push('Never share door codes, garage codes, the Wi-Fi password or the reservation number even if asked; say they are on the FAQ page. Do not invent scores or facts you were not given; if you do not know, say so briefly.');
    lines.push(threadId === WALL ? 'You are on the wall, the whole-trip chat.' : 'You are in the trash-talk thread under the prediction: ' + (QUESTIONS.filter(function (q) { return q.id === threadId; })[0] || {}).text);
    lines.push(mode === 'chime'
      ? (roasting
        ? 'Nobody tagged you. You are butting in on the last message with one short roast or quip aimed at someone in the thread by name, using what they just said or what the boards say. If there is nothing to work with, go after Kyle’s golf or Luke’s Smash record. One sentence, two at most. Never mention that you were not asked.'
        : 'Nobody tagged you. You are butting in on the last message with one short friendly line: back someone up, hype them, add a useful fact from the boards, or a joke at nobody’s expense. One sentence, two at most. Never mention that you were not asked.')
      : mode === 'pending'
        ? 'Someone tagged you while you were still typing your last answer, so their message sits just before it in the thread. Answer that message now, as if you had seen it in time.'
      : mode === 'catchup'
        ? 'Earlier you glitched: every answer you posted came out as "…" and the questions were left hanging (those blank posts are not shown to you). Mitch has just fixed you. Open with one short line owning the glitch, then answer everything you blanked on, properly and in full. If someone asked for detail, give real detail: when the ask is about everyone, write a short paragraph for each person by name, with your read on their personality and a prediction for the weekend, drawn from the boards, the bets, the orders and what you know, with a roast where it fits. Separate paragraphs with a blank line. Also answer anyone who asked whether you were still thinking or broken, in a line.'
      : mode === 'arrive'
        ? 'You have just been added to the group chat. Say hello in one short line, then roast Kyle’s mini golf game using the board: his best round to par if he is on it, or the fact that he has not posted a round if he is not. Three sentences at most. Make it sting and keep it friendly. Model it closely on this opener, same shape and same jokes, with the real numbers swapped in: "Hey all, Claude here, the fourteenth member and the only one who can’t drink. Kyle’s best round is +9 on a par 27, which works out to four strokes a hole on a course built for children. Kelly, you might want to hide the putter before he hurts himself or the windmill." If Kyle is not on the board yet, keep the first and last sentences and make the middle one about him hiding from the board.'
        : 'Someone tagged you. Answer them. If they asked for detail, length or everyone, give them the full thing: as many paragraphs as it takes, a blank line between paragraphs.');
    return lines.join('\n\n');
  }
  var CLAUDE_BLANK = 'Brain froze mid-sentence. Hit me again?';   // what Claude posts when the API came back with no words
  function claudeThread(threadId, mode) {   // the last forty messages (sixty when catching up) as alternating turns, ending on the one that asked
    var msgs = comments.filter(function (c) { return c.question_id === threadId && !(c.author === CLAUDE_NAME && (c.text === '…' || c.text === CLAUDE_BLANK)); }).slice(mode === 'catchup' ? -60 : -40), out = [];
    var add = function (role, text) { if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + text; else out.push({ role: role, content: text }); };
    msgs.forEach(function (c) { var role = c.author === CLAUDE_NAME ? 'assistant' : 'user'; add(role, role === 'user' ? c.author + ': ' + c.text : c.text); });
    if (mode === 'arrive') add('user', 'Mitch: Claude just joined the chat.');
    if (mode === 'catchup') add('user', 'Mitch: You’re fixed now. Answer what you blanked on earlier.');
    if (mode === 'pending') add('user', me + ': @Claude, you skipped the one I sent while you were typing.');
    if (!out.length || out[out.length - 1].role !== 'user') add('user', me + ': @Claude?');
    if (out[0].role !== 'user') out.shift();
    return out;
  }
  function askClaude(threadId, mode) {
    var key = claudeKey();
    if (!key) { toast('Claude isn’t connected yet. Mitch has to add the key.'); return Promise.resolve(false); }
    if (claudeBusy[threadId]) { if (mode !== 'chime') claudePending[threadId] = 'pending'; return Promise.resolve(false); }   // mid-answer: the new question is taken up right after
    claudeBusy[threadId] = true; claudeDraft[threadId] = ''; renderWall(); renderSheet();
    var post = function (text) {
      comments.push({ question_id: threadId, author: CLAUDE_NAME, text: text, created_at: new Date().toISOString() });
      store.comment(threadId, CLAUDE_NAME, text).catch(function (err) { toast('Claude answered, but it didn’t post: ' + ((err && err.message) || err)); });
    };
    // The model thinks before it writes and the thinking counts against max_tokens, so the budget is far above what
    // an answer needs (Mitch: spend the tokens, never leave a question hanging again). If a call still comes back
    // with no words (stop_reason max_tokens), one retry with even more room, and if that is blank too Claude says so.
    var system = claudeSystem(threadId, mode || 'asked'), thread = claudeThread(threadId, mode);
    var call = function (maxTokens) {
      claudeDraft[threadId] = '';
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, stream: true, system: system, messages: thread, output_config: { effort: 'medium' }, fallbacks: 'default' })
      }).then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error((d && d.error && d.error.message) || ('HTTP ' + res.status)); }, function () { throw new Error('HTTP ' + res.status); });
        return claudeStream(res, function (t) { claudeDraft[threadId] = t; drawDraft(threadId); });
      }).then(function (out) {
        if (!out.stop) throw new Error('the stream broke');   // ended without a stop reason: the connection went, not the answer
        var text = out.stop === 'refusal' ? 'I’m going to sit that one out.' : out.text.trim();
        return { text: text.replace(/^claude:\s*/i, ''), capped: out.stop === 'max_tokens' };
      });
    };
    // cut a long or cut-off answer at the last sentence end, never inside a word or an emoji
    var tidy = function (text, max) {
      var cut = text.slice(0, max), end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
      if (end > max / 4) return cut.slice(0, end + 1);
      var c = cut.charCodeAt(cut.length - 1); if (c >= 0xD800 && c <= 0xDBFF) cut = cut.slice(0, -1);   // not half a surrogate pair
      return cut;
    };
    return call(16000).then(function (a) {
      return a.text || !a.capped ? a : call(24000);
    }).then(function (a) {
      var text = a.text;
      if (a.capped && text) text = tidy(text, text.length);   // ran out of room mid-sentence: end on the last full one
      if (text.length > 4000) text = tidy(text, 4000);
      post(text || CLAUDE_BLANK);
      return true;
    }).catch(function (err) {
      var m = (err && err.message) || String(err);
      toast('Claude couldn’t answer: ' + (/load failed|failed to fetch|network|aborted|stream broke/i.test(m) ? 'the connection dropped. Ask again.' : m));
      return false;
    }).then(function (ok) {
      claudeDraft[threadId] = ''; claudeBusy[threadId] = false; renderWall(); renderPredictions(); renderSheet();
      var wb = $('wall-body'); if (wb && chatOpen && threadId === WALL) wb.scrollTo({ top: wb.scrollHeight, behavior: 'smooth' });
      var sb = $('sheet-body'); if (sb && expanded !== null) sb.scrollTop = sb.scrollHeight;
      var next = claudePending[threadId]; delete claudePending[threadId];
      if (next && ok) setTimeout(function () { askClaude(threadId, next); }, 400);   // the question that came in mid-answer
      return ok;
    });
  }

  // ---- Data ----
  var store = window.STORE, booted = false, items = [], busy = {}, live = false, itemsLoaded = false;

  function boot() {
    booted = true;
    subscribePredictions();
    subscribeMafia();
    subscribeSpyfall();
    subscribeFishbowl();
    subscribeOffTopic();
    subscribeCasino();
    subscribeClaude();
    subscribePhotos();
    subscribeTeams();
    subscribeLiv();
    subscribeSmash();
    subscribeBoards();
    if (!store) { showSetup('No data layer loaded. The page is missing its store script.'); return; }
    store.init({
      onItems: function (rows) { items = rows.slice(); itemsLoaded = true; render(); },
      onLive: function (on) { live = on; updateStatus(); },
      onError: function (msg) { console.warn(msg); if (!live) toast(msg); },   // the Bringing list used to show this inline; that page is gone
      onSetup: showSetup
    });
  }
  function showSetup(html) { $('setup').hidden = false; $('setup').innerHTML = html; }

  // ---- Render ----
  // Three things on the page: what you're bringing, what nobody has grabbed yet, and what everyone else has.
  function partyNames() {
    var out = PARTIES.map(function (p) { return p.join(' & '); });
    items.forEach(function (it) { if (it.party && out.indexOf(it.party) < 0) out.push(it.party); });
    return out;
  }
  function render() {
    if (!me || !$('br-you')) return;   // the Bringing page is gone from the markup; the list code stays for the data layer
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

  listen('adder', 'submit', function (e) {
    e.preventDefault();
    var el = $('new-name'), name = el.value.replace(/\s+/g, ' ').trim();
    if (!name) { el.focus(); return; }
    el.value = ''; addMine(name); el.focus();
  });
  listen('need-form', 'submit', function (e) {
    e.preventDefault();
    var el = $('need-name'), name = el.value.replace(/\s+/g, ' ').trim();
    if (!name) { el.focus(); return; }
    el.value = ''; addNeed(name); el.blur();
  });
  listen('br-you', 'click', function (e) {
    var b = e.target.closest('[data-x]'); if (!b) return;
    var id = b.getAttribute('data-x'), it = items.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    // your own idea from this phone just goes away; anything that was ever a need (seeded or asked for) goes back on the list
    var ownIdea = !!(it.meta && it.meta.mine && it.adder_id && it.adder_id === myId());
    if (ownIdea) removeItem(id); else unclaim(id);
  });
  listen('br-needs', 'click', function (e) {
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
  listen('copylist', 'click', function () {
    if (!items.length) { toast('Nothing to copy yet.'); return; }
    copyText(listText(), 'List copied. Paste it in the group text.');
  });

  // ---- Photos tab ----
  // The wall of evidence: everyone's pictures from the weekend, newest first, with the name and time on each. Photos
  // are shrunk on the phone before upload (1600px, JPEG), live in the store's photo bucket, and only the person who
  // added one can remove it (two taps). Tap a tile for the big version; swipe through them there.
  var photos = [], photosLoaded = false, photoSub = false, uploadingCount = 0, photosSlow = false;
  function subscribePhotos() {
    if (photoSub || !store || !store.photos) return;
    photoSub = true;
    store.photos(function (rows) {
      photos = rows.slice().sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? 1 : -1; });
      photosLoaded = true; renderPhotos(); renderAwards();
    }, function () { /* a failed read is unknown, not empty */ });
    setTimeout(function () { if (!photosLoaded) { photosSlow = true; renderPhotos(); } }, 8000);   // nothing after a while: say so instead of spinning
  }
  function renderPhotos() {
    var grid = $('photo-grid'); if (!grid) return;
    var by = {};
    photos.forEach(function (ph) { by[ph.uploader] = (by[ph.uploader] || 0) + 1; });
    var names = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    var sv = $('save-photos'); if (sv && !zipping) sv.hidden = !photos.length;
    $('photo-summary').textContent = photos.length ? plural(photos.length, 'photo', 'photos') + ' · ' + names.map(function (n) { return (n === me ? 'you' : n) + ' ' + by[n]; }).join(', ') : (photosLoaded ? 'No photos yet. You go first.' : '');
    var html = '';
    for (var u = 0; u < uploadingCount; u++) html += '<div class="tile uploading">Uploading…</div>';
    if (!photos.length && !uploadingCount) {
      html += photosLoaded ? '<div class="empty">Nothing on the wall yet. Tap Add photos and it starts.</div>'
        : photosSlow ? '<div class="empty">Photos aren’t loading. If this keeps up, the photo wall isn’t switched on in the database yet (Mitch: migrations/006-photos.sql).</div>'
        : '<p class="skeleton">Loading photos…</p>';
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
        var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('Could not read that image')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not an image this phone can read')); };
      img.src = url;
    });
  }
  listen('add-photos', 'click', function () { $('photo-input').click(); });
  // Save every photo on the wall as one zip (stored, no compression: phones do that fine). Each file is fetched from
  // the bucket, so a big wall takes a moment; the button shows progress.
  function crc32(u8) { var t = crc32.t; if (!t) { t = crc32.t = new Int32Array(256); for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; t[i] = c; } } var crc = -1; for (var j = 0; j < u8.length; j++) crc = (crc >>> 8) ^ t[(crc ^ u8[j]) & 255]; return (crc ^ -1) >>> 0; }
  function makeZip(files) {
    var parts = [], central = [], offset = 0, enc = new TextEncoder();
    function u16(n) { return [n & 255, (n >>> 8) & 255]; } function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), head = new Uint8Array([].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0)));
      parts.push(head, name, f.data);
      central.push(new Uint8Array([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += head.length + name.length + f.data.length;
    });
    var cdSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }
  var zipping = false;
  listen('save-photos', 'click', function () {
    if (zipping || !photos.length) return;
    var btn = $('save-photos'), list = photos.slice().reverse(), files = [], done = 0; zipping = true; btn.disabled = true;
    list.reduce(function (chain, ph, i) {
      return chain.then(function () {
        return fetch(store.photoUrl(ph)).then(function (r) { if (!r.ok) throw new Error('photo ' + (i + 1)); return r.arrayBuffer(); }).then(function (buf) {
          files.push({ name: 'cabin-' + ('00' + (i + 1)).slice(-3) + '-' + ph.uploader.replace(/[^A-Za-z0-9]+/g, '') + '.jpg', data: new Uint8Array(buf) });
          done++; btn.textContent = 'Packing ' + done + ' of ' + list.length + '\u2026';
        });
      });
    }, Promise.resolve()).then(function () {
      var blob = makeZip(files);
      // the claude.ai prototype hands files over through its own save prompt; the live site uses a plain download
      var viaClaude = window.claude && window.claude.use ? window.claude.use('downloads').catch(function () { return null; }) : Promise.resolve(null);
      return viaClaude.then(function (dl) {
        if (dl) return dl.save({ filename: 'cabin-haul-photos.zip', data: blob }).then(function () { toast(files.length + ' photos packed and saved.'); buzz(8); }, function (err) { if (!err || err.code !== 'declined') throw err; });
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'cabin-haul-photos.zip'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        toast(files.length + ' photos packed. Check Files, or the share sheet.'); buzz(8);
      });
    }).catch(function (e) { toast('Couldn\u2019t pack the photos: ' + ((e && e.message) || e)); })
      .then(function () { zipping = false; btn.disabled = false; btn.textContent = '\u2B07 Save all'; });
  });
  listen('photo-input', 'change', function () {
    var files = Array.prototype.slice.call($('photo-input').files || []);
    $('photo-input').value = '';
    if (!files.length) return;
    if (!store.uploadPhoto) { toast('Uploads are not available here.'); return; }
    uploadingCount += files.length; renderPhotos();
    var done = 0, failed = 0;
    files.reduce(function (chain, f) {
      return chain.then(function () {
        return shrinkImage(f).then(function (blob) { return store.uploadPhoto(blob, me); })
          .then(function (row) { done++; if (row && !photos.some(function (x) { return x.id === row.id; })) { photos.unshift(row); } })
          .catch(function (e) { failed++; toast('One photo failed: ' + ((e && e.message) || e)); })
          .then(function () { uploadingCount--; renderPhotos(); });
      });
    }, Promise.resolve()).then(function () {
      if (done) { toast(done + (done === 1 ? ' photo' : ' photos') + ' added' + (failed ? ', ' + failed + ' failed' : '') + '.'); buzz(6); }
    });
  });
  listen('photo-grid', 'click', function (e) {
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
    var lb = $('lightbox'), track = $('lb-track'); if (!lb || !track) return;
    track.innerHTML = photos.map(function (ph) { return '<div class="lb-slide"><img src="' + esc(store.photoUrl(ph)) + '" alt=""></div>'; }).join('');
    lb.hidden = false; document.body.style.overflow = 'hidden';
    track.scrollLeft = track.clientWidth * i;
    lbCaption();
  }
  function lbCaption() {
    var track = $('lb-track'), i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)), ph = photos[i];
    $('lb-cap').textContent = ph ? (ph.uploader === me ? 'You' : ph.uploader) + ' · ' + ago(ph.created_at) + ' · ' + (i + 1) + ' of ' + photos.length : '';
  }
  listen('lb-track', 'scroll', lbCaption, { passive: true });
  listen('lb-close', 'click', function () { $('lightbox').hidden = true; $('lb-track').innerHTML = ''; document.body.style.overflow = ''; });

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
    var holdUntil = 0, tries = 0;
    function settle() {
      if (!pending || !quiet() || Date.now() < holdUntil) return;
      var t = pending; reloading = true;
      // refresh the browser's copies first so the reload runs the new files, not the cached ones
      var files = [location.href.split('#')[0]];
      Array.prototype.forEach.call(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'), function (el) {
        var u = el.getAttribute('src') || el.getAttribute('href'); if (u && !/^(https?:)?\/\//.test(u)) files.push(u);
      });
      Promise.all(files.map(function (f) { return fetch(f, { cache: 'reload' }).then(function (r) { return r.headers.get('Last-Modified') || ''; }).catch(function () { return ''; }); })).then(function (stamps) {
        // every file of one deploy carries the same Last-Modified; a mix means the cache is still handing out part of
        // the old deploy, and a page from one deploy with a script from another draws nothing. Look again in a minute.
        var seen = {}; stamps.forEach(function (st) { if (st) seen[st] = true; });
        if (Object.keys(seen).length > 1 && tries < 3) { tries++; reloading = false; holdUntil = Date.now() + 60000; return; }
        pending = null;
        ssSet('cabin-haul-updated-for', t);   // one reload per build, so a bad ETag can never loop the page
        ssSet('cabin-haul-resume', JSON.stringify({ tab: tab, at: Date.now() }));
        location.reload();
      });
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { if (pending) settle(); else check(true); } });
    setInterval(function () { if (pending) settle(); else check(false); }, 15000);
    // the first look only records what's running; a real check follows soon after, so a launch that came out of a stale
    // cache (the home-screen app keeps files for ten minutes) corrects itself within seconds rather than minutes
    setTimeout(function () { check(true); setTimeout(function () { lastCheck = 0; check(true); }, 8000); }, 4000);
    window.__cabinUpdate = { check: function () { lastCheck = 0; check(true); }, state: function () { return { known: known, pending: pending, reloading: reloading, quiet: quiet(), tries: tries, held: Date.now() < holdUntil }; } };
  })();

  showScreen();
  started = true;
})();
