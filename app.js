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

  // ---- Bubble physics: grab, fling, collide. A quick tap picks the name. ----
  var sim = null;
  function renderRoster() {
    if (sim) sim.stop();
    var box = $('roster');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var tones = ['pine', 'plain', 'ember'];
    box.innerHTML = NAMES.map(function (n, i) {
      var size = [92, 82, 104, 92, 88][i % 5];
      return '<button type="button" class="bub ' + tones[i % 3] + '" data-me="' + esc(n) + '" style="width:' + size + 'px;height:' + size + 'px;font-size:' + (size / 88) + 'rem"><span class="in">' + esc(n) + '</span></button>';
    }).join('');
    var els = Array.prototype.slice.call(box.children);
    var W = box.clientWidth, H = box.clientHeight;
    var balls = els.map(function (el, i) {
      var r = el.offsetWidth / 2;
      var cols = 3, col = i % cols, row = Math.floor(i / cols);
      return { el: el, r: r, m: r * r,
        x: (W / (cols + 1)) * (col + 1) + (row % 2 ? 18 : -18) + (Math.random() * 10 - 5),
        y: 70 + row * 100 + (Math.random() * 10 - 5),
        vx: reduce ? 0 : Math.random() * 1.6 - 0.8, vy: reduce ? 0 : Math.random() * 1.6 - 0.8,
        ang: Math.random() * Math.PI * 2, held: false, name: el.getAttribute('data-me') };
    });
    balls.forEach(function (b) { b.x = Math.max(b.r, Math.min(W - b.r, b.x)); b.y = Math.max(b.r, Math.min(H - b.r, b.y)); });

    var running = true, last = performance.now();
    function step(now) {
      if (!running) return;
      var dt = Math.min(32, now - last) / 16.67; last = now;
      balls.forEach(function (b) {
        if (b.held) return;
        if (!reduce) {                    // every bubble wanders a little, always, so it's obvious they move
          b.ang += (Math.random() - 0.5) * 0.3 * dt;
          var speed = Math.hypot(b.vx, b.vy);
          if (speed < 1.2) { b.vx += Math.cos(b.ang) * 0.05 * dt; b.vy += Math.sin(b.ang) * 0.05 * dt; }
        }
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.vx *= Math.pow(0.992, dt); b.vy *= Math.pow(0.992, dt);
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.85; b.ang = Math.random() * Math.PI - Math.PI / 2; }
        if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.85; b.ang = Math.PI / 2 + Math.random() * Math.PI; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.85; b.ang = Math.random() * Math.PI; }
        if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.85; b.ang = Math.PI + Math.random() * Math.PI; }
      });
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < balls.length; i++) for (var j = i + 1; j < balls.length; j++) {
          var a = balls[i], c = balls[j];
          var dx = c.x - a.x, dy = c.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, min = a.r + c.r;
          if (d >= min) continue;
          var nx = dx / d, ny = dy / d, overlap = min - d;
          var wa = a.held ? 0 : (c.held ? 1 : c.m / (a.m + c.m)), wc = c.held ? 0 : (a.held ? 1 : a.m / (a.m + c.m));
          a.x -= nx * overlap * wa; a.y -= ny * overlap * wa;
          c.x += nx * overlap * wc; c.y += ny * overlap * wc;
          var rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;   // closing speed along the normal
          if (rel > 0) continue;
          var e = 0.9;
          if (a.held || c.held) {                           // held bubble has infinite mass
            var mover = a.held ? c : a, sign = a.held ? 1 : -1;
            var push = Math.max(Math.abs(rel), 1.5) * (1 + e);
            mover.vx += nx * push * sign * 0.5; mover.vy += ny * push * sign * 0.5;
          } else {
            var jimp = -(1 + e) * rel / (1 / a.m + 1 / c.m);
            a.vx -= jimp * nx / a.m; a.vy -= jimp * ny / a.m;
            c.vx += jimp * nx / c.m; c.vy += jimp * ny / c.m;
          }
        }
      }
      balls.forEach(function (b) { b.el.style.transform = 'translate(' + (b.x - b.r) + 'px,' + (b.y - b.r) + 'px)'; });
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    // Pointer handling: drag to fling, tap to pick.
    var held = null, trail = [], start = null;
    function pos(e) { var rct = box.getBoundingClientRect(); return { x: e.clientX - rct.left, y: e.clientY - rct.top, t: performance.now() }; }
    box.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('.bub'); if (!el || popping) return;
      var b = balls.filter(function (x) { return x.el === el; })[0];
      held = b; b.held = true; b.vx = 0; b.vy = 0; el.classList.add('grab');
      var p = pos(e); start = p; trail = [p]; b.gx = p.x - b.x; b.gy = p.y - b.y;
      try { box.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    box.addEventListener('pointermove', function (e) {
      if (!held) return;
      var p = pos(e);
      held.x = Math.max(held.r, Math.min(W - held.r, p.x - held.gx));
      held.y = Math.max(held.r, Math.min(H - held.r, p.y - held.gy));
      trail.push(p); if (trail.length > 6) trail.shift();
    });
    function release(e) {
      if (!held) return;
      var b = held, p = pos(e); held = null; b.held = false; b.el.classList.remove('grab');
      var moved = Math.hypot(p.x - start.x, p.y - start.y), dur = p.t - start.t;
      if (moved < 8 && dur < 400) { pick(b); return; }
      var old = trail[0], dt = Math.max(16, p.t - old.t) / 16.67;
      b.vx = Math.max(-70, Math.min(70, (p.x - old.x) / dt));
      b.vy = Math.max(-70, Math.min(70, (p.y - old.y) / dt));
    }
    box.addEventListener('pointerup', release);
    box.addEventListener('pointercancel', release);
    box.addEventListener('click', function (e) { e.preventDefault(); }); // selection happens on pointerup
    function pick(b) {
      if (popping) return;
      popping = true; b.el.classList.add('pop');
      setTimeout(function () {
        popping = false; running = false;
        me = b.name; myParty = partyOf(me); lsSet('cabin-haul-me', me);
        showScreen();
      }, 280);
    }
    sim = { stop: function () { running = false; } };
  }
  var popping = false;
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
