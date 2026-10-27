// Firebase Realtime Database backend (free Spark plan). Anonymous auth gives every browser a uid.
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getDatabase, ref, get, set, update, remove, onValue, runTransaction, onDisconnect,
} from 'firebase/database';

export class FirebaseBackend {
  constructor(config) {
    this.kind = 'firebase';
    this.app = initializeApp(config);
    this.auth = getAuth(this.app);
    this.db = getDatabase(this.app);
    this.offset = 0;
  }

  async init() {
    const user = await new Promise((resolve, reject) => {
      const stop = onAuthStateChanged(this.auth, (u) => {
        if (u) { stop(); resolve(u); }
      }, reject);
      signInAnonymously(this.auth).catch(reject);
    });
    this.uid = user.uid;
    onValue(ref(this.db, '.info/serverTimeOffset'), (s) => { this.offset = s.val() || 0; });
    return this.uid;
  }

  now() { return Date.now() + this.offset; }
  async get(path) { return (await get(ref(this.db, path))).val(); }
  set(path, value) { return set(ref(this.db, path), value); }
  update(path, value) { return update(ref(this.db, path), value); }
  remove(path) { return remove(ref(this.db, path)); }
  subscribe(path, cb) { return onValue(ref(this.db, path), (s) => cb(s.val())); }
  async transaction(path, fn) {
    const res = await runTransaction(ref(this.db, path), fn);
    return { committed: res.committed, value: res.snapshot.val() };
  }
  onDisconnectRemove(path) { return onDisconnect(ref(this.db, path)).remove(); }
}
