/* Data layer for the GitHub Pages build: Supabase table "items".
   Needs config.js (window.CABIN_CONFIG) and supabase-js loaded first. */
(function () {
  'use strict';
  var CFG = window.CABIN_CONFIG || {};
  var URL = String(CFG.supabaseUrl || ''), KEY = String(CFG.supabaseAnonKey || '');
  var COLS = 'id,name,note,category,party,claimed_by,added_by,adder_id,created_at';
  var sb = null, cb = null;

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
      sb = window.supabase.createClient(URL, KEY);
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
    remove: function (id) { return sb.from('items').delete().eq('id', id).then(one); }
  };
})();
