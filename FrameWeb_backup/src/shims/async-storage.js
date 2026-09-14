/**
 * AsyncStorage do React Native, com a mesma API, em cima do localStorage.
 *
 * Existe pra que os arquivos de src/services/sync/ — copiados do app sem
 * alteracao — rodem no navegador. O alias esta no vite.config.js.
 *
 * localStorage e sincrono; a API e async de proposito, pra bater com a do app.
 */

const mem = new Map(); // fallback: aba anonima / storage bloqueado

function readRaw(key) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? (mem.has(key) ? mem.get(key) : null) : v;
  } catch (e) {
    return mem.has(key) ? mem.get(key) : null;
  }
}

function writeRaw(key, value) {
  mem.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    // QuotaExceeded (biblioteca grande do Letterboxd) ou storage bloqueado:
    // segue so em memoria, o Supabase continua sendo a fonte de verdade.
    console.warn('[storage] nao consegui gravar', key, e && e.name);
  }
}

const AsyncStorage = {
  async getItem(key) {
    return readRaw(key);
  },
  async setItem(key, value) {
    writeRaw(key, String(value));
  },
  async removeItem(key) {
    mem.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch (e) {}
  },
  async multiGet(keys) {
    return keys.map((k) => [k, readRaw(k)]);
  },
  async multiSet(pairs) {
    pairs.forEach(([k, v]) => writeRaw(k, String(v)));
  },
  async getAllKeys() {
    try {
      return Object.keys(window.localStorage);
    } catch (e) {
      return [...mem.keys()];
    }
  },
  async clear() {
    mem.clear();
    try {
      window.localStorage.clear();
    } catch (e) {}
  },
};

export default AsyncStorage;
