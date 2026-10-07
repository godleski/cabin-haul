/* Data layer for the claude.ai prototype: the artifact's own "db" capability.
   Same interface as store-supabase.js. */
(function () {
  'use strict';
  var db = null, cb = null, ready = null;

  function toRow(snap) { var d = Object.assign({}, snap.data() || {}); d.id = snap.id; return d; }
  function ensure() {
    if (!ready) ready = (window.claude && window.claude.use ? window.claude.use('db') : Promise.resolve(null)).then(function (ns) { db = ns; return ns; });
    return ready;
  }

  window.STORE = {
    init: function (callbacks) {
      cb = callbacks;
      ensure().then(function (ns) {
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
    remove: function (id) { return db.doc('items/' + id).delete(); },

    // Predictions: one document per voter per question (future Supabase table "predictions",
    // primary key (question_id, voter); answers and lock time will live in meta/predictions later).
    predictions: function (onRows) {
      ensure().then(function () {
        if (!db) return;
        db.collection('predictions').onSnapshot(function (qs) {
          onRows(qs.docs.filter(function (d) { return d.exists; }).map(function (d) { return Object.assign({}, d.data()); }));
        }, function () { /* ignore */ });
      });
    },
    vote: function (questionId, voter, pick) {
      return ensure().then(function () {
        if (!db) throw new Error('not signed in');
        var id = questionId + '__' + voter.replace(/[^A-Za-z0-9_-]/g, '_');
        return db.doc('predictions/' + id).set({ question_id: questionId, voter: voter, pick: pick, updated_at: new Date().toISOString() });
      });
    },

    // Photos: the artifact's asset store holds the image, a "photos" document holds who and when.
    photos: function (onRows, onError) {
      ensure().then(function () {
        if (!db) return;
        var ref = db.collection('photos');
        ref.onSnapshot(function (qs) {
          onRows(qs.docs.filter(function (d) { return d.exists; }).map(toRow));
        }, function (e) { if (onError) onError(e); });
        // belt and braces: a one-off read in case the live stream is slow to start
        setTimeout(function () { ref.get().then(function (qs) { onRows(qs.docs.filter(function (d) { return d.exists; }).map(toRow)); }).catch(function (e) { if (onError) onError(e); }); }, 2500);
      });
    },
    photoUrl: function (row) { return '/_blob/' + row.asset_id; },
    uploadPhoto: function (blob, uploader) {
      return ensure().then(function () {
        if (!db) throw new Error('not signed in');
        return window.claude.use('assets');
      }).then(function (assets) {
        if (!assets) throw new Error('this view can\'t upload (you need edit access)');
        return assets.upload(blob, { type: 'image/jpeg' });
      }).then(function (a) {
        var row = { asset_id: a.id, uploader: uploader, size: a.sizeBytes || 0, created_at: new Date().toISOString() };
        return db.collection('photos').add(row).then(function (ref) { row.id = ref.id; return row; });
      });
    },
    removePhoto: function (row) {
      return ensure().then(function () {
        if (!db) throw new Error('not signed in');
        return db.doc('photos/' + row.id).delete();
      }).then(function () { return window.claude.use('assets'); })
        .then(function (assets) { if (assets) return assets.delete(row.asset_id).catch(function () { /* already gone */ }); });
    },

    // Prediction chat: one document per message (future Supabase table "comments": id, question_id, author, text, created_at).
    comments: function (onRows, onError) {
      ensure().then(function () {
        if (!db) return;
        db.collection('comments').onSnapshot(function (qs) {
          onRows(qs.docs.filter(function (d) { return d.exists; }).map(toRow));
        }, function (e) { if (onError) onError(e); });
      });
    },
    comment: function (questionId, author, text) {
      return ensure().then(function () {
        if (!db) throw new Error('not signed in');
        return db.collection('comments').add({ question_id: questionId, author: author, text: text, created_at: new Date().toISOString() });
      });
    },

    // Shared game state (Mafia and friends): one document per game under meta/.
    game: function (name, onDoc) {
      ensure().then(function () {
        if (!db) return;
        db.doc('meta/game-' + name).onSnapshot(function (snap) { onDoc(snap.exists ? Object.assign({}, snap.data()) : null); }, function () { /* ignore */ });
      });
    },
    setGame: function (name, doc) {
      return ensure().then(function () { if (!db) throw new Error('not signed in'); return db.doc('meta/game-' + name).set(doc); });
    },

    // Air hockey tally: one shared document.
    scores: function (onScores) {
      ensure().then(function () {
        if (!db) return;
        db.doc('meta/hockey').onSnapshot(function (snap) { onScores(snap.exists ? snap.data() : { humans: 0, cpu: 0 }); }, function () { /* ignore */ });
      });
    },
    recordWin: function (winner, name) {
      return ensure().then(function () {
        if (!db) return;
        var ref = db.doc('meta/hockey');
        return ref.get().then(function (snap) {
          var sc = snap.exists ? JSON.parse(JSON.stringify(snap.data())) : { humans: 0, cpu: 0 };
            if (winner === 'human') sc.humans = (sc.humans || 0) + 1;
          else sc.cpu = (sc.cpu || 0) + 1;
          return ref.set(sc);
        });
      });
    }
  };
})();
