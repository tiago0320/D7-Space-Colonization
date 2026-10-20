/**
 * Local Saved Surface Builder models (IndexedDB).
 * Independent of Saved Simulations, Matrices, 3D Variations, and Grid Iterations.
 * Each record holds the exact imported branches, planar surfaces, connections,
 * boundary pairs, transforms, and camera. Load restores that geometry; it is not regenerated.
 */
(function (global) {
  const DB_NAME = "d7-saved-surface-builder";
  const DB_VERSION = 1;
  const STORE = "savedSurfaceModels";
  const DATA_VERSION = 1;
  const SCHEMA_VERSION = 1;

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
    return "surf-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function nextDefaultName(records) {
    let max = 0;
    for (let i = 0; i < (records || []).length; i++) {
      const match = String(records[i] && records[i].name ? records[i].name : "")
        .trim()
        .match(/^Surface Model\s+(\d+)$/i);
      if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
    }
    return "Surface Model " + String(max + 1).padStart(2, "0");
  }

  async function list() {
    const records = await withStore("readonly", (store) => getAllFromStore(store));
    return (records || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function get(id) {
    return withStore("readonly", (store) => requestToPromise(store.get(id)));
  }

  function put(record) {
    if (!record || !record.id) return Promise.reject(new Error("Saved surface model is missing an id."));
    const now = Date.now();
    const payload = {
      ...record,
      version: record.version || DATA_VERSION,
      schemaVersion: record.schemaVersion || SCHEMA_VERSION,
      createdAt: record.createdAt || now,
      updatedAt: now,
    };
    return withStore("readwrite", (store) => requestToPromise(store.put(payload))).then(() => payload);
  }

  function remove(id) {
    return withStore("readwrite", (store) => requestToPromise(store.delete(id)));
  }

  global.D7SavedSurfaceBuilder = {
    DATA_VERSION,
    SCHEMA_VERSION,
    createId,
    nextDefaultName,
    list,
    get,
    put,
    remove,
  };
})(window);
