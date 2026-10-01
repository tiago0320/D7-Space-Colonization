/**
 * Local Saved 3D Variations (IndexedDB).
 * Independent of Saved Simulations and Saved Matrices.
 */
(function (global) {
  const DB_NAME = "d7-saved-3d-variations";
  const DB_VERSION = 1;
  const STORE = "saved3DVariations";
  const DATA_VERSION = 1;

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
    return `3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function nextDefaultName(records) {
    let max = 0;
    for (const rec of records || []) {
      const match = String(rec && rec.name ? rec.name : "")
        .trim()
        .match(/^3D Variation\s+(\d+)$/i);
      if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
    }
    return `3D Variation ${String(max + 1).padStart(2, "0")}`;
  }

  function duplicateName(name) {
    const base = String(name || "3D Variation").trim() || "3D Variation";
    if (/\sCopy$/i.test(base)) return base;
    return `${base} Copy`;
  }

  async function list() {
    const records = await withStore("readonly", (store) => getAllFromStore(store));
    return (records || []).slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }

  function get(id) {
    return withStore("readonly", (store) => requestToPromise(store.get(id)));
  }

  function put(record) {
    if (!record || !record.id) return Promise.reject(new Error("Saved 3D variation is missing an id."));
    const now = Date.now();
    const payload = {
      ...record,
      version: record.version || DATA_VERSION,
      createdAt: record.createdAt || now,
      updatedAt: record.updatedAt || now,
    };
    return withStore("readwrite", (store) => requestToPromise(store.put(payload))).then(() => payload);
  }

  function remove(id) {
    return withStore("readwrite", (store) => requestToPromise(store.delete(id)));
  }

  global.D7Saved3DVariations = {
    DATA_VERSION,
    createId,
    nextDefaultName,
    duplicateName,
    list,
    get,
    put,
    remove,
  };
})(window);
