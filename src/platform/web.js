// Brauzer adapteri: sql.js (WebAssembly) + IndexedDB'da saqlash.
// Butun baza bitta Uint8Array sifatida bitta kalit ostida yotadi. Yozuvlardan keyin
// ~300ms debounce bilan saqlanadi (sqljs.js), sahifa yashirilganda — darhol.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { createSqlJsAdapter } from './sqljs.js';

const IDB_NAME = 'vazifalar';
const IDB_STORE = 'sqlite';

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openIdb() {
  const req = indexedDB.open(IDB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
  return request(req);
}

async function readBytes(idb, key) {
  const value = await request(idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key));
  return value instanceof Uint8Array ? value : null;
}

function writeBytes(idb, key, bytes) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// name — IndexedDB'dagi kalit. node.js'dagi openDatabase'dan farqi: wasm yuklanishi
// asinxron, shuning uchun bu funksiya Promise qaytaradi. Adapterning o'zi bir xil.
export async function openDatabase(name = 'main') {
  const [SQL, idb] = await Promise.all([initSqlJs({ locateFile: () => wasmUrl }), openIdb()]);
  const db = createSqlJsAdapter(SQL, {
    bytes: await readBytes(idb, name),
    persist: (bytes) => writeBytes(idb, name, bytes),
  });
  // Ilova fonga o'tganda yoki yopilayotganda kutib turgan yozuvni darhol saqlaymiz.
  document.addEventListener('visibilitychange', () => { if (document.hidden) db.flush(); });
  window.addEventListener('pagehide', () => db.flush());
  return db;
}
