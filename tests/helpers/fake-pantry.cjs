// In-memory account pantry with the semantics of add_pantry_items, set_pantry_items_active and
// delete_pantry_items (B7). One backend = one account store; several devices can talk to it.
const key = (category, name) =>
 category + ":" + name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const copy = row => ({id: row.id, name: row.name, category: row.category, active: row.active, version: row.version});

function createPantryBackend() {
 let clock = 0;
 // down: every request fails · loseReplies: the next N writes are applied but their answer is lost.
 const state = {pantries: new Map(), down: false, loseReplies: 0, calls: {fetch: 0, add: 0, setActive: 0, remove: 0}};
 const rowsOf = userId => {
  if (!state.pantries.has(userId)) state.pantries.set(userId, []);
  return state.pantries.get(userId);
 };
 const request = name => {
  state.calls[name]++;
  if (state.down) throw new Error("offline");
 };
 const reply = value => {
  if (state.loseReplies > 0) {
   state.loseReplies--;
   throw new Error("connection lost after the write");
  }
  return value;
 };
 const remote = userId => ({
  async fetch() {
   request("fetch");
   const rows = rowsOf(userId);
   return {rows: rows.map(copy), version: rows.length ? "t" + Math.max(...rows.map(row => row.touched)) : null};
  },
  async add(items) {
   request("add");
   const results = items.map(item => {
    const rows = rowsOf(userId);
    let row = rows.find(r => r.id === item.id);
    if (row) return {id: item.id, result: "duplicate", row: copy(row)};
    row = rows.find(r => key(r.category, r.name) === key(item.category, item.name));
    if (row) return {id: item.id, result: "existing", row: copy(row)};
    row = {id: item.id, name: item.name.trim().replace(/\s+/g, " "), category: item.category, active: item.active, version: 1, touched: ++clock};
    rows.push(row);
    return {id: item.id, result: "created", row: copy(row)};
   });
   return reply(results);
  },
  async setActive(refs, active) {
   request("setActive");
   const found = refs.map(ref => rowsOf(userId).find(row => row.id === ref.id));
   if (found.some(row => !row)) return reply({status: "missing", rows: []});
   if (!found.every(row => row.active === active)) {
    if (found.some((row, i) => row.version !== refs[i].version)) return reply({status: "conflict", rows: found.map(copy)});
    for (const row of found) if (row.active !== active) Object.assign(row, {active, version: row.version + 1, touched: ++clock});
   }
   return reply({status: "applied", rows: found.map(copy)});
  },
  async remove(refs) {
   request("remove");
   const rows = rowsOf(userId);
   const found = refs.map(ref => [ref, rows.find(row => row.id === ref.id)]).filter(([, row]) => row);
   if (found.some(([ref, row]) => row.version !== ref.version)) return reply({status: "conflict", rows: found.map(([, row]) => copy(row))});
   state.pantries.set(userId, rows.filter(row => !refs.some(ref => ref.id === row.id)));
   return reply({status: "applied", rows: []});
  },
 });
 // Another device or the previous client writing directly.
 const elsewhere = userId => ({
  rows: () => rowsOf(userId).map(copy),
  insert: (name, category, active = true) => {
   const row = {id: crypto.randomUUID(), name, category, active, version: 1, touched: ++clock};
   rowsOf(userId).push(row);
   return row.id;
  },
  setActive: (name, active) => {
   for (const row of rowsOf(userId)) if (row.name === name) Object.assign(row, {active, version: row.version + 1, touched: ++clock});
  },
  remove: name => state.pantries.set(userId, rowsOf(userId).filter(row => row.name !== name)),
 });
 return {state, remote, elsewhere};
}

module.exports = {createPantryBackend};
