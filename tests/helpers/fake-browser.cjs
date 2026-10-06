// Minimal in-memory window/localStorage/sessionStorage for storage tests. One instance = one device.
class MemoryStorage {
 constructor() { this.map = new Map(); }
 get length() { return this.map.size; }
 key(index) { return [...this.map.keys()][index] ?? null; }
 getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
 setItem(key, value) { this.map.set(key, String(value)); }
 removeItem(key) { this.map.delete(key); }
 clear() { this.map.clear(); }
 keys() { return [...this.map.keys()]; }
}

function createDevice() {
 return {localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage(), listeners: new Map()};
}

// Point the global `window` at a device; returns a restore function.
function useDevice(device) {
 const previous = global.window;
 global.window = {
  localStorage: device.localStorage,
  sessionStorage: device.sessionStorage,
  addEventListener: (type, fn) => device.listeners.set(type, fn),
  removeEventListener: type => device.listeners.delete(type),
 };
 return () => {
  if (previous === undefined) delete global.window;
  else global.window = previous;
 };
}

module.exports = {MemoryStorage, createDevice, useDevice};
