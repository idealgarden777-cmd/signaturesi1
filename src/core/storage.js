/**
 * =========================================================
 * NEYO BETA — CORE STORAGE
 * =========================================================
 *
 * Owns:
 * - Safe localStorage access
 * - JSON serialization / parsing
 * - Namespaced keys
 * - Storage availability checks
 * - Graceful fallback when storage is blocked
 *
 * Does NOT own:
 * - Supabase persistence
 * - Conversation database storage
 * - Authentication sessions
 * - Secrets
 * - IndexedDB/file blobs
 * =========================================================
 */

import { APP } from "@core/constants.js";
import { captureError } from "@core/errors.js";

/* =========================================================
   INTERNAL MEMORY FALLBACK
   ========================================================= */

const memoryStore = new Map();

/* =========================================================
   STORAGE AVAILABILITY
   ========================================================= */

let storageAvailable = null;

const testStorage = () => {
  if (storageAvailable !== null) {
    return storageAvailable;
  }

  try {
    if (typeof window === "undefined") {
      storageAvailable = false;
      return false;
    }

    const storage = window.localStorage;
    const testKey = "__neyo_storage_test__";

    storage.setItem(testKey, "1");
    storage.removeItem(testKey);

    storageAvailable = true;
    return true;
  } catch {
    storageAvailable = false;
    return false;
  }
};

export const isStorageAvailable = () => {
  return testStorage();
};

/* =========================================================
   KEY HELPERS
   ========================================================= */

const normalizeKey = (key) => {
  if (typeof key !== "string") {
    throw new TypeError(
      "[Neyo Storage] Key must be a string."
    );
  }

  const cleanKey = key.trim();

  if (!cleanKey) {
    throw new TypeError(
      "[Neyo Storage] Key cannot be empty."
    );
  }

  return cleanKey;
};

const buildKey = (key) => {
  const normalized = normalizeKey(key);

  if (
    normalized.startsWith(
      `${APP.STORAGE_NAMESPACE}:`
    )
  ) {
    return normalized;
  }

  return `${APP.STORAGE_NAMESPACE}:${normalized}`;
};

/* =========================================================
   SERIALIZATION
   ========================================================= */

const serialize = (value) => {
  return JSON.stringify({
    version: 1,
    value
  });
};

const deserialize = (
  rawValue,
  fallback = null
) => {
  if (rawValue === null || rawValue === undefined) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (
      parsed &&
      typeof parsed === "object" &&
      Object.prototype.hasOwnProperty.call(
        parsed,
        "value"
      )
    ) {
      return parsed.value;
    }

    // Backward compatibility for older
    // values saved without the wrapper.
    return parsed;
  } catch {
    return fallback;
  }
};

/* =========================================================
   RAW STORAGE ACCESS
   ========================================================= */

const readRaw = (key) => {
  const finalKey = buildKey(key);

  if (testStorage()) {
    try {
      return window.localStorage.getItem(finalKey);
    } catch (error) {
      captureError(error, {
        source: "storage",
        operation: "read",
        key: finalKey
      });
    }
  }

  return memoryStore.get(finalKey) ?? null;
};

const writeRaw = (
  key,
  value
) => {
  const finalKey = buildKey(key);

  if (testStorage()) {
    try {
      window.localStorage.setItem(
        finalKey,
        value
      );

      return true;
    } catch (error) {
      captureError(error, {
        source: "storage",
        operation: "write",
        key: finalKey
      });
    }
  }

  memoryStore.set(finalKey, value);

  return true;
};

const removeRaw = (key) => {
  const finalKey = buildKey(key);

  if (testStorage()) {
    try {
      window.localStorage.removeItem(
        finalKey
      );
    } catch (error) {
      captureError(error, {
        source: "storage",
        operation: "remove",
        key: finalKey
      });
    }
  }

  memoryStore.delete(finalKey);

  return true;
};

/* =========================================================
   PUBLIC GET
   ========================================================= */

export const getStorageItem = (
  key,
  fallback = null
) => {
  try {
    const rawValue = readRaw(key);

    return deserialize(
      rawValue,
      fallback
    );
  } catch (error) {
    captureError(error, {
      source: "storage",
      operation: "get",
      key
    });

    return fallback;
  }
};

/* =========================================================
   PUBLIC SET
   ========================================================= */

export const setStorageItem = (
  key,
  value
) => {
  try {
    const serialized = serialize(value);

    return writeRaw(
      key,
      serialized
    );
  } catch (error) {
    captureError(error, {
      source: "storage",
      operation: "set",
      key
    });

    return false;
  }
};

/* =========================================================
   PUBLIC REMOVE
   ========================================================= */

export const removeStorageItem = (
  key
) => {
  try {
    return removeRaw(key);
  } catch (error) {
    captureError(error, {
      source: "storage",
      operation: "remove",
      key
    });

    return false;
  }
};

/* =========================================================
   HAS ITEM
   ========================================================= */

export const hasStorageItem = (key) => {
  return readRaw(key) !== null;
};

/* =========================================================
   UPDATE ITEM
   ========================================================= */

export const updateStorageItem = (
  key,
  updater,
  fallback = null
) => {
  if (typeof updater !== "function") {
    throw new TypeError(
      "[Neyo Storage] updater must be a function."
    );
  }

  const currentValue =
    getStorageItem(
      key,
      fallback
    );

  const nextValue =
    updater(currentValue);

  setStorageItem(
    key,
    nextValue
  );

  return nextValue;
};

/* =========================================================
   CLEAR NEYO STORAGE
   ========================================================= */

export const clearNeyoStorage = () => {
  const prefix =
    `${APP.STORAGE_NAMESPACE}:`;

  if (testStorage()) {
    try {
      const keysToRemove = [];

      for (
        let index = 0;
        index < window.localStorage.length;
        index += 1
      ) {
        const key =
          window.localStorage.key(index);

        if (
          key &&
          key.startsWith(prefix)
        ) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => {
        window.localStorage.removeItem(key);
      });
    } catch (error) {
      captureError(error, {
        source: "storage",
        operation: "clear"
      });
    }
  }

  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) {
      memoryStore.delete(key);
    }
  }

  return true;
};

/* =========================================================
   STORAGE SNAPSHOT
   ========================================================= */

export const getStorageSnapshot = () => {
  const prefix =
    `${APP.STORAGE_NAMESPACE}:`;

  const snapshot = {};

  if (testStorage()) {
    try {
      for (
        let index = 0;
        index < window.localStorage.length;
        index += 1
      ) {
        const key =
          window.localStorage.key(index);

        if (
          !key ||
          !key.startsWith(prefix)
        ) {
          continue;
        }

        const shortKey =
          key.slice(prefix.length);

        snapshot[shortKey] =
          deserialize(
            window.localStorage.getItem(key)
          );
      }

      return snapshot;
    } catch (error) {
      captureError(error, {
        source: "storage",
        operation: "snapshot"
      });
    }
  }

  for (const [key, value] of memoryStore) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    const shortKey =
      key.slice(prefix.length);

    snapshot[shortKey] =
      deserialize(value);
  }

  return snapshot;
};

/* =========================================================
   STORAGE FACTORY
   ========================================================= */

export const createStorage = (
  namespace
) => {
  const cleanNamespace =
    normalizeKey(namespace);

  const scopedKey = (key) => {
    return `${cleanNamespace}:${normalizeKey(key)}`;
  };

  return Object.freeze({
    get(
      key,
      fallback = null
    ) {
      return getStorageItem(
        scopedKey(key),
        fallback
      );
    },

    set(
      key,
      value
    ) {
      return setStorageItem(
        scopedKey(key),
        value
      );
    },

    remove(key) {
      return removeStorageItem(
        scopedKey(key)
      );
    },

    has(key) {
      return hasStorageItem(
        scopedKey(key)
      );
    },

    update(
      key,
      updater,
      fallback = null
    ) {
      return updateStorageItem(
        scopedKey(key),
        updater,
        fallback
      );
    }
  });
};

/* =========================================================
   DEFAULT EXPORT
   ========================================================= */

export const storage = Object.freeze({
  get: getStorageItem,
  set: setStorageItem,
  remove: removeStorageItem,
  has: hasStorageItem,
  update: updateStorageItem,

  clear: clearNeyoStorage,

  snapshot: getStorageSnapshot,

  create: createStorage,

  isAvailable: isStorageAvailable
});

export default storage;
