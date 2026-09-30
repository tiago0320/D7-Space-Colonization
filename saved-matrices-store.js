/**
 * Local Saved Descriptor Matrices (IndexedDB).
 * Separate from Saved Simulations — stores complete 5×5 matrix snapshots.
 */
(function (global) {
  const DB_NAME = "d7-saved-matrices";
  const DB_VERSION = 1;
  const STORE = "matrices";
  const CATEGORIES = ["lobby", "workspace", "gathering"];
  const CATEGORY_LABELS = {
    lobby: "Lobby",
    workspace: "Workspace",
    gathering: "Gathering",
  };

  function normalizeCategory(value) {
    const key = String(value || "").trim().toLowerCase();
    return CATEGORIES.includes(key) ? key : "lobby";
  }

  function categoryLabel(value) {
    return CATEGORY_LABELS[normalizeCategory(value)] || "Lobby";
  }

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
          store.createIndex("spatialType", "spatialType", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
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
    return `matrix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function nextDefaultName(spatialType, descriptorLabel, records) {
    const typeLabel = categoryLabel(spatialType);
    const desc = String(descriptorLabel || "Matrix").trim() || "Matrix";
    const stem = `${typeLabel} — ${desc} — Matrix`;
    let max = 0;
    for (const rec of records || []) {
      const name = String(rec && rec.name ? rec.name : "").trim();
      if (!name.toLowerCase().startsWith(stem.toLowerCase())) continue;
      const match = name.match(/\bMatrix\s+(\d+)\s*$/i);
      if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
    }
    return `${stem} ${String(max + 1).padStart(2, "0")}`;
  }

  async function list() {
    const records = await withStore("readonly", (store) => getAllFromStore(store));
    return (records || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function get(id) {
    return withStore("readonly", (store) => requestToPromise(store.get(id)));
  }

  function put(record) {
    if (!record || !record.id) return Promise.reject(new Error("Saved matrix is missing an id."));
    const payload = {
      ...record,
      spatialType: normalizeCategory(record.spatialType),
      createdAt: record.createdAt || Date.now(),
    };
    return withStore("readwrite", (store) => requestToPromise(store.put(payload))).then(() => payload);
  }

  function remove(id) {
    return withStore("readwrite", (store) => requestToPromise(store.delete(id)));
  }

  global.D7SavedMatrices = {
    CATEGORIES,
    CATEGORY_LABELS,
    normalizeCategory,
    categoryLabel,
    createId,
    nextDefaultName,
    list,
    get,
    put,
    remove,
  };
})(window);
