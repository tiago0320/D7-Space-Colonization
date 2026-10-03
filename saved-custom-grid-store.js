/**
 * Shared default custom 3D reference grid (IndexedDB).
 */
(function (global) {
  const DB_NAME = "d7-custom-grid";
  const DB_VERSION = 1;
  const STORE = "defaultGrid";
  const KEY = "default";
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
          db.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  global.D7SavedCustomGrid = {
    DATA_VERSION,
    async loadDefault() {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readonly");
        const record = await requestToPromise(tx.objectStore(STORE).get(KEY));
        return record || null;
      } finally {
        db.close();
      }
    },
    async saveDefault(record) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        const payload = Object.assign({ version: DATA_VERSION, updatedAt: Date.now() }, record);
        await requestToPromise(tx.objectStore(STORE).put(payload, KEY));
        return payload;
      } finally {
        db.close();
      }
    },
    async clearDefault() {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        await requestToPromise(tx.objectStore(STORE).delete(KEY));
      } finally {
        db.close();
      }
    },
  };
})(window);
