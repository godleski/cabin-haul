/* Data layer for the claude.ai prototype: the artifact's own "db" capability.
   Same interface as store-supabase.js. */
(function () {
  'use strict';
  var db = null, cb = null;

  function toRow(snap) { var d = snap.data() || {}; d.id = snap.id; return d; }

  window.STORE = {
    init: function (callbacks) {
      cb = callbacks;
      var use = window.claude && window.claude.use ? window.claude.use('db') : Promise.resolve(null);
      use.then(function (ns) {
        db = ns;
        if (!db) {
          cb.onSetup('This prototype stores its list on claude.ai, so it needs you signed in to claude.ai in this browser. Sign in and reload.');
          return;
        }
        db.collection('items').orderBy('created_at').onSnapshot(function (qs) {
          cb.onItems(qs.docs.filter(function (s) { return s.exists; }).map(toRow));
          cb.onLive(!qs.metadata.fromCache);
        }, function (e) {
          cb.onError('Lost the connection to the list (' + ((e && e.message) || e) + '). Reload to reconnect.');
        });
      });
    },
    add: function (row) {
      var body = Object.assign({}, row, { created_at: new Date().toISOString() });
      return db.collection('items').add(body).then(function (ref) { body.id = ref.id; return body; });
    },
    update: function (id, patch) {
      var ref = db.doc('items/' + id);
      return ref.update(patch).then(function () { return ref.get(); }).then(toRow);
    },
    remove: function (id) { return db.doc('items/' + id).delete(); }
  };
})();
