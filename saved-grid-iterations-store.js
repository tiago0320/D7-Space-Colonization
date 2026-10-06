/**
 * Local Saved Grid Iterations (IndexedDB).
 * Independent of Saved Simulations, Saved Matrices, and Saved 3D Variations.
 * Each record holds a complete working snapshot: selection box, source
 * rectangular geometry, developed surfaces, edits, display mode, and camera.
 */
(function (global) {
  const DB_NAME = "d7-saved-grid-iterations";
  const DB_VERSION = 1;
  const STORE = "savedGridIterations";
  const DATA_VERSION = 2;
  const SCHEMA_VERSION = 2;

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB is not available in this browser."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function withStore(mode, fn) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          tx.oncomplete = () => db.close();
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          Promise.resolve(fn(tx.objectStore(STORE)))
            .then(resolve)
            .catch(reject);
        })
    );
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getAllFromStore(store) {
    if (typeof store.getAll === "function") return requestToPromise(store.getAll());
    return new Promise((resolve, reject) => {
      const results = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  function createId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return `iter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function nextDefaultName(records) {
    let max = 0;
    for (const rec of records || []) {
      const match = String(rec && rec.name ? rec.name : "")
        .trim()
        .match(/^Iteration\s+(\d+)$/i);
      if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
    }
    return `Iteration ${String(max + 1).padStart(2, "0")}`;
  }

  function duplicateName(name) {
    const base = String(name || "Iteration").trim() || "Iteration";
    if (/\sCopy$/i.test(base)) return base;
    return `${base} Copy`;
  }

  async function list() {
    const records = await withStore("readonly", (store) => getAllFromStore(store));
    return (records || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function get(id) {
    return withStore("readonly", (store) => requestToPromise(store.get(id)));
  }

  function put(record) {
    if (!record || !record.id) return Promise.reject(new Error("Saved iteration is missing an id."));
    const now = Date.now();
    const payload = {
      ...record,
      version: record.version || DATA_VERSION,
      schemaVersion: record.schemaVersion || (record.snapshot && record.snapshot.schemaVersion) || SCHEMA_VERSION,
      createdAt: record.createdAt || now,
      updatedAt: record.updatedAt || now,
    };
    return withStore("readwrite", (store) => requestToPromise(store.put(payload))).then(() => payload);
  }

  function remove(id) {
    return withStore("readwrite", (store) => requestToPromise(store.delete(id)));
  }

  global.D7SavedGridIterations = {
    DATA_VERSION,
    SCHEMA_VERSION,
    createId,
    nextDefaultName,
    duplicateName,
    list,
    get,
    put,
    remove,
  };
})(window);
