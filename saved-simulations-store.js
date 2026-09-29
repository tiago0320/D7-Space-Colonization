/**
 * Local Saved Simulations library (IndexedDB).
 *
 * Isolated per browser/origin. Swap this module later without touching
 * the space-colonization simulator.
 */
(function (global) {
  const DB_NAME = "d7-saved-simulations";
  const DB_VERSION = 1;
  const STORE = "simulations";
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
    const key = normalizeCategory(value);
    return CATEGORY_LABELS[key] || "Lobby";
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
          store.createIndex("category", "category", { unique: false });
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
    return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function nextIterationName(records) {
    let max = 0;
    const list = Array.isArray(records) ? records : [];
    for (const rec of list) {
      const match = String(rec && rec.name ? rec.name : "")
        .trim()
        .match(/^Iteration\s+(\d+)$/i);
      if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
    }
    return `Iteration ${String(max + 1).padStart(2, "0")}`;
  }

  async function list() {
    const records = await withStore("readonly", (store) => getAllFromStore(store));
    return (records || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function get(id) {
    return withStore("readonly", (store) => requestToPromise(store.get(id)));
  }

  function put(record) {
    if (!record || !record.id) return Promise.reject(new Error("Saved simulation is missing an id."));
    const payload = {
      ...record,
      category: normalizeCategory(record.category),
      createdAt: record.createdAt || Date.now(),
    };
    return withStore("readwrite", (store) => requestToPromise(store.put(payload))).then(() => payload);
  }

  function remove(id) {
    return withStore("readwrite", (store) => requestToPromise(store.delete(id)));
  }

  global.D7SavedSimulations = {
    CATEGORIES,
    CATEGORY_LABELS,
    normalizeCategory,
    categoryLabel,
    createId,
    nextIterationName,
    list,
    get,
    put,
    remove,
  };
})(window);
