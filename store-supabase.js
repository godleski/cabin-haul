/* Data layer for the GitHub Pages build: Supabase table "items".
   Needs config.js (window.CABIN_CONFIG) and supabase-js loaded first. */
(function () {
  'use strict';
  var CFG = window.CABIN_CONFIG || {};
  var URL = String(CFG.supabaseUrl || ''), KEY = String(CFG.supabaseAnonKey || '');
  var COLS = 'id,name,note,category,party,claimed_by,added_by,adder_id,created_at';
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
      cb.onError('Couldn\'t load the list (' + ((e && e.message) || e) + '). Check config.js, and that the SQL in schema.sql was run.');
    });
  }
  var reloadTimer;
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 250); }
  function one(res) { if (res.error) throw res.error; return res.data; }

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
      setInterval(function () { if (!document.hidden) load(); }, 15000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
      load();
    },
    add: function (row) { return sb.from('items').insert(row).select(COLS).single().then(one); },
    update: function (id, patch) { return sb.from('items').update(patch).eq('id', id).select(COLS).single().then(one); },
    remove: function (id) { return sb.from('items').delete().eq('id', id).then(one); },

    // Predictions: table "predictions" (question_id, voter, pick, updated_at), primary key (question_id, voter).
    // Not in schema.sql yet; added with the one-time setup when the site goes live.
    predictions: function (onRows) {
      if (!ensure()) return;
      var read = function () {
        sb.from('predictions').select('question_id,voter,pick,updated_at').then(function (res) { onRows(res.data || []); });
      };
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
      var read = function () {
        sb.from('photos').select('id,path,uploader,size,created_at').order('created_at', { ascending: false }).then(function (res) { onRows(res.data || []); });
      };
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
      var read = function () {
        sb.from('comments').select('id,question_id,author,text,created_at').order('created_at', { ascending: true }).then(function (res) { onRows(res.data || []); });
      };
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
      var read = function () { sb.from('reactions').select('comment_id,reactor,emoji').then(function (res) { onRows(res.data || []); }); };
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
      var read = function () { sb.from('kv').select('value').eq('key', 'game-' + name).maybeSingle().then(function (res) { onDoc((res.data && res.data.value) || null); }); };
      try { sb.channel('cabin-game-' + name).on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    setGame: function (name, doc) {
      if (!ensure()) return Promise.reject(new Error('not connected'));
      return sb.from('kv').upsert({ key: 'game-' + name, value: doc }).then(one);
    },

    // Air hockey tally: one row in the "kv" table, key "hockey".
    scores: function (onScores) {
      if (!ensure()) return;
      var read = function () {
        sb.from('kv').select('value').eq('key', 'hockey').maybeSingle().then(function (res) {
          onScores((res.data && res.data.value) || { humans: 0, cpu: 0 });
        });
      };
      try { sb.channel('cabin-kv').on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, read).subscribe(); } catch (e) { /* ignore */ }
      read();
    },
    recordWin: function (winner, name) {
      if (!ensure()) return Promise.resolve();
      return sb.from('kv').select('value').eq('key', 'hockey').maybeSingle().then(function (res) {
        var sc = (res.data && res.data.value) || { humans: 0, cpu: 0 };
        if (winner === 'human') sc.humans = (sc.humans || 0) + 1;
        else sc.cpu = (sc.cpu || 0) + 1;
        return sb.from('kv').upsert({ key: 'hockey', value: sc }).then(one);
      });
    }
  };
})();
