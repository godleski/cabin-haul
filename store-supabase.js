/* Data layer for the GitHub Pages build: Supabase table "items".
   Needs config.js (window.CABIN_CONFIG) and supabase-js loaded first. */
(function () {
  'use strict';
  var CFG = window.CABIN_CONFIG || {};
  var URL = String(CFG.supabaseUrl || ''), KEY = String(CFG.supabaseAnonKey || '');
  var COLS = 'id,name,note,category,party,claimed_by,added_by,adder_id,meta,created_at';
  var sb = null, cb = null;
  function ensure() {
    if (sb) return sb;
    if (!URL || !KEY || URL.indexOf('PASTE') >= 0 || !window.supabase) return null;
    sb = window.supabase.createClient(URL, KEY);
    return sb;
  }

  function load() {
    return sb.from('items').select(COLS).order('created_at', { ascending: true }).then(function (res) {
      if (res.error) throw res.error;
      cb.onItems(res.data || []);
    }).catch(function (e) {
      console.warn('items load failed', e);
      cb.onError('Couldn\'t load the list. Check your signal; it retries every 15 seconds.');
    });
  }
  var reloadTimer;
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 250); }
  function one(res) { if (res.error) throw res.error; return res.data; }
  // Every live subscription registers its read here. iPhones drop the realtime socket when the screen locks, so all reads
  // also re-run every 15 s and whenever the page comes back to the foreground. A failed read is "unknown", never "empty":
  // telling the app someone has no picks would re-open the first-visit prompts.
  var readers = [];
  function refreshAll() { readers.forEach(function (r) { try { r(); } catch (e) { /* ignore */ } }); }
  function reader(fn) { var read = function () { try { fn(); } catch (e) { /* ignore */ } }; readers.push(read); return read; }
  function ok(res, what) { if (res.error) { console.warn(what + ' read failed', res.error); return false; } return true; }
  var GOLF_COURSES = ['classic', 'frost', 'lava'];
  function golfKey(course) { return !course || course === 'classic' ? 'golf9' : 'golf9-' + course; }

  window.STORE = {
    init: function (callbacks) {
      cb = callbacks;
      if (!URL || !KEY || URL.indexOf('PASTE') >= 0) {
        cb.onSetup('This copy isn\'t connected to a database yet. Copy <code>config.example.js</code> to <code>config.js</code> and paste in your Supabase URL and key. See README.md.');
        return;
      }
      if (!window.supabase) { cb.onSetup('The database library didn\'t load. Check your internet connection and reload.'); return; }
      ensure();
      try {
        sb.channel('cabin-haul')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, scheduleReload)
          .subscribe(function (status) { cb.onLive(status === 'SUBSCRIBED'); });
      } catch (e) { /* polling covers it */ }
      setInterval(function () { if (!document.hidden) { load(); refreshAll(); } }, 15000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) { load(); refreshAll(); } });
      load();
    },
    add: function (row) { return sb.from('items').insert(row).select(COLS).single().then(one); },
    update: function (id, patch) {
      return sb.from('items').update(patch).eq('id', id).select(COLS).maybeSingle().then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) { scheduleReload(); throw new Error('that one just came off the list'); }   // someone else removed it a moment ago
        return res.data;
      });
    },
    remove: function (id) { return sb.from('items').delete().eq('id', id).then(one); },

    // Predictions: table "predictions" (question_id, voter, pick, updated_at), primary key (question_id, voter).
    // Not in schema.sql yet; added with the one-time setup when the site goes live.
    predictions: function (onRows) {
      if (!ensure()) return;
      var read = reader(function () {
        sb.from('predictions').select('question_id,voter,pick,updated_at').then(function (res) { if (ok(res, 'predictions')) onRows(res.data || []); });
      });
      try { sb.channel('cabin-pred').on('postgres_changes', { event: '*', schema: 'public', table: 'predictions' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    vote: function (questionId, voter, pick) {
      if (!ensure()) return Promise.reject(new Error('not connected'));
      return sb.from('predictions').upsert({ question_id: questionId, voter: voter, pick: pick, updated_at: new Date().toISOString() }).then(one);
    },

    // Photos: Supabase Storage bucket "photos" (public) plus table "photos" (id, path, uploader, size, created_at).
    // Both are created at go-live with the one-time setup.
    photos: function (onRows) {
      if (!ensure()) return;
      var read = reader(function () {
        sb.from('photos').select('id,path,uploader,size,created_at').order('created_at', { ascending: false }).then(function (res) { if (ok(res, 'photos')) onRows(res.data || []); });
      });
      try { sb.channel('cabin-photos').on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    photoUrl: function (row) { return URL.replace(/\/$/, '') + '/storage/v1/object/public/photos/' + row.path; },
    uploadPhoto: function (blob, uploader) {
      if (!ensure()) return Promise.reject(new Error('not connected'));
      var path = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
      return sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' }).then(function (res) {
        if (res.error) throw res.error;
        return sb.from('photos').insert({ path: path, uploader: uploader, size: blob.size }).select().single().then(one);
      });
    },
    removePhoto: function (row) {
      if (!ensure()) return Promise.reject(new Error('not connected'));
      return sb.from('photos').delete().eq('id', row.id).then(one).then(function () { return sb.storage.from('photos').remove([row.path]); });
    },

    // Prediction chat: table "comments" (id, question_id, author, text, created_at). Added at go-live with the one-time setup.
    comments: function (onRows) {
      if (!ensure()) return;
      var read = reader(function () {   // newest 500, handed over oldest-first (the app sorts by created_at anyway)
        sb.from('comments').select('id,question_id,author,text,created_at').order('created_at', { ascending: false }).limit(500).then(function (res) { if (ok(res, 'comments')) onRows((res.data || []).slice().reverse()); });
      });
      try { sb.channel('cabin-comments').on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    comment: function (questionId, author, text) {
      if (!ensure()) return Promise.reject(new Error('not connected'));
      return sb.from('comments').insert({ question_id: questionId, author: author, text: text }).then(one);
    },

    // Reactions: table "reactions" (comment_id, reactor, emoji, created_at), primary key (comment_id, reactor, emoji). Added at go-live.
    reactions: function (onRows) {
      if (!ensure()) return;
      var read = reader(function () { sb.from('reactions').select('comment_id,reactor,emoji').then(function (res) { if (ok(res, 'reactions')) onRows(res.data || []); }); });
      try { sb.channel('cabin-reactions').on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    react: function (commentId, reactor, emoji, on) {
      if (!ensure()) return Promise.reject(new Error('not connected'));
      return on ? sb.from('reactions').upsert({ comment_id: commentId, reactor: reactor, emoji: emoji }).then(one)
        : sb.from('reactions').delete().match({ comment_id: commentId, reactor: reactor, emoji: emoji }).then(one);
    },

    // Shared game state: a row in "kv" per game.
    game: function (name, onDoc) {
      if (!ensure()) return;
      var read = reader(function () { sb.from('kv').select('value').eq('key', 'game-' + name).maybeSingle().then(function (res) { if (ok(res, 'game-' + name)) onDoc((res.data && res.data.value) || null); }); });
      try { sb.channel('cabin-game-' + name).on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    setGame: function (name, doc) {
      if (!ensure()) return Promise.reject(new Error('not connected'));
      return sb.from('kv').upsert({ key: 'game-' + name, value: doc }).then(one);
    },
    // Every game doc whose name starts with a prefix (Fishbowl keeps one doc of words per person: game-fb-<name>).
    games: function (prefix, onRows) {
      if (!ensure()) return;
      var read = reader(function () {
        sb.from('kv').select('key,value').like('key', 'game-' + prefix + '%').then(function (res) {
          if (ok(res, 'game-' + prefix + '*')) onRows((res.data || []).map(function (r) { return { name: r.key.slice(5), doc: r.value }; }));
        });
      });
      try { sb.channel('cabin-games-' + prefix).on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },

    // Air hockey tally: one row in the "kv" table, key "hockey".
    scores: function (onScores) {
      if (!ensure()) return;
      var read = reader(function () {
        sb.from('kv').select('value').eq('key', 'hockey').maybeSingle().then(function (res) {
          if (ok(res, 'hockey')) onScores((res.data && res.data.value) || { humans: 0, cpu: 0 });
        });
      });
      try { sb.channel('cabin-kv').on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    recordWin: function (winner, name) {
      if (!ensure()) return Promise.resolve();
      return sb.from('kv').select('value').eq('key', 'hockey').maybeSingle().then(function (res) {
        var sc = (res.data && res.data.value) || { humans: 0, cpu: 0 };
        if (winner === 'human') sc.humans = (sc.humans || 0) + 1;
        else sc.cpu = (sc.cpu || 0) + 1;
        if (name) {
          sc.by = sc.by || {};
          var p = sc.by[name] || { w: 0, l: 0 };
          if (winner === 'human') p.w++; else p.l++;
          p.last = new Date().toISOString(); sc.by[name] = p;
        }
        return sb.from('kv').upsert({ key: 'hockey', value: sc }).then(one);
      });
    },

    // Mini golf: one board per course. The classic nine keep the kv key "golf9"; the other courses use "golf9-<course>".
    // onDoc(doc, course) fires once per course on every read; an older app that ignores the second argument sees classic.
    golfScores: function (onDoc) {
      if (!ensure()) return;
      var keys = GOLF_COURSES.map(golfKey);
      var read = reader(function () {
        sb.from('kv').select('key,value').in('key', keys).then(function (res) {
          if (!ok(res, 'golf')) return;
          var byKey = {}; (res.data || []).forEach(function (r) { byKey[r.key] = r.value; });
          GOLF_COURSES.forEach(function (c) { onDoc(byKey[golfKey(c)] || { by: {} }, c); });
        });
      });
      try { sb.channel('cabin-golf').on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    recordGolf: function (name, strokes, course) {
      if (!ensure()) return Promise.reject(new Error('not connected'));
      var key = golfKey(course);
      return sb.from('kv').select('value').eq('key', key).maybeSingle().then(function (res) {
        var sc = (res.data && res.data.value) || { by: {} };
        sc.by = sc.by || {};
        var p = sc.by[name] || { best: null, rounds: 0 };
        p.rounds++; p.last = strokes; p.last_at = new Date().toISOString();
        if (p.best == null || strokes < p.best) p.best = strokes;
        sc.by[name] = p;
        return sb.from('kv').upsert({ key: key, value: sc }).then(one);
      });
    }
  };
})();
