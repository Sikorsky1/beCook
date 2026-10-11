// In-memory account for the shopping data layer (C4): weeks (days with card links, version,
// updated_at, frozen context), lists with their rows, dish cards, and the semantics of
// save_shopping_list, set_shopping_items_checked (+ trigger shopping_items_check_state) and
// reconcile_shopping_list of supabase/migrations/20261013090000_shopping_item_origins.sql.
// D5: edit_shopping_items and the trigger shopping_items_guard_manual of
// supabase/migrations/20261014090000_shopping_manual_items.sql (manual rows, item_key 'manual|…',
// are never removed or changed by a reconciliation; only edit_shopping_items removes them).
// guardManual: false simulates the database before D5 (no trigger).
const key = (w) => `${w.isoYear}-W${w.isoWeek}`;
const factors = { kg: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000, l: 1000, litro: 1000, litros: 1000, cl: 10 };
const base = (quantity, unit) => (quantity === null ? null : quantity * (factors[String(unit ?? "").trim().toLowerCase()] ?? 1));

function createShoppingAccount() {
  const st = { weeks: new Map(), lists: [], cards: new Map(), down: false, seq: 0, forceStale: 0, calls: { fetch: 0, save: 0, setChecked: 0, reconcile: 0, edit: 0, cards: 0 }, guardManual: true, loseEditReplies: 0 };
  const isManual = (item) => typeof item.itemKey === "string" && item.itemKey.startsWith("manual|");
  const guarded = (item) => st.guardManual && isManual(item);
  const tick = () => ++st.seq;
  const current = (k) => st.lists.filter((l) => l.week === k).sort((x, y) => y.at - x.at)[0] ?? null;
  const asList = (l) => ({
    id: l.id, weekId: l.week, generatedAt: String(l.at).padStart(6, "0"), weekSignature: l.signature, ingredientBasis: l.basis ?? null,
    items: l.items.map((i) => ({ ...i, origins: i.origins ? structuredClone(i.origins) : null })),
  });
  const offline = () => { if (st.down) throw new TypeError("fetch failed"); };
  const row = (item) => ({
    id: item.id ?? "row-" + tick(), name: item.name.trim(), quantity: item.quantity, unit: item.unit.trim(), category: item.category, checked: false,
    itemKey: item.itemKey ?? item.item_key ?? null, origins: item.origins ?? null, checkedQuantity: null, needsReview: false, removedAt: null,
  });
  const remote = (_userId, isoWeek) => {
    const k = key(isoWeek);
    return {
      async fetch() {
        st.calls.fetch++; offline();
        const week = st.weeks.get(k);
        if (!week) return { week: null, list: null };
        const list = current(k);
        return { week: { days: structuredClone(week.days), version: week.version, updatedAt: String(week.updatedAt).padStart(6, "0"),
          ...(week.foodContext !== undefined ? { foodContext: week.foodContext } : {}) }, list: list && asList(list) };
      },
      async save({ signature, items, expectedWeekVersion }) {
        st.calls.save++; offline();
        const week = st.weeks.get(k);
        if (!week) return { status: "no_week" };
        if (expectedWeekVersion !== null && expectedWeekVersion !== week.version) return { status: "week_changed", weekVersion: week.version };
        const now = current(k);
        if (now && now.signature === signature) return { status: "existing", list: asList(now), weekVersion: week.version };
        const keyed = items.every((i) => i.itemKey);
        const list = { id: "list-" + tick(), week: k, at: tick(), signature, basis: keyed ? "mixed-v1" : null, items: items.map(row) };
        st.lists.push(list);
        return { status: "created", list: asList(list), weekVersion: week.version };
      },
      async setChecked(ids, checked) {
        st.calls.setChecked++; offline();
        const list = st.lists.find((l) => l.items.some((i) => ids.includes(i.id)));
        if (!list || !ids.every((id) => list.items.some((i) => i.id === id))) return { status: "missing" };
        if (current(list.week) !== list) return { status: "stale" };
        for (const item of list.items) {
          if (!ids.includes(item.id) || item.checked === checked) continue;
          item.checked = checked;
          item.needsReview = false;
          item.checkedQuantity = checked ? base(item.quantity, item.unit) : null;
        }
        return { status: "applied" };
      },
      async reconcile({ listId, fromSignature, toSignature, ops, expectedWeekVersion }) {
        st.calls.reconcile++; offline();
        // Another device updates the list first (forced, for tests): stale without writing.
        if (st.forceStale > 0) { st.forceStale--; return { status: "stale", weekVersion: st.weeks.get(k)?.version ?? null }; }
        const week = st.weeks.get(k);
        if (!week) return { status: "no_week" };
        if (expectedWeekVersion !== null && expectedWeekVersion !== week.version) return { status: "week_changed", weekVersion: week.version };
        const list = current(k);
        if (!list || list.id !== listId) return { status: "stale", weekVersion: week.version };
        if (fromSignature !== toSignature && list.signature === toSignature) return { status: "existing", list: asList(list), weekVersion: week.version };
        const ids = [...ops.update, ...ops.remove].map((op) => op.id);
        if (list.signature !== fromSignature || !ids.every((id) => list.items.some((i) => i.id === id))) return { status: "stale", weekVersion: week.version };
        const summary = { added: 0, removed: 0, keptBought: 0, changed: 0, review: 0 };
        // All or nothing, like the function's exception block (a key taken → stale).
        const snapshot = structuredClone(list.items);
        for (const { id } of ops.remove) {
          const item = list.items.find((i) => i.id === id);
          // shopping_items_guard_manual: a reconciliation never removes a manual row.
          if (guarded(item)) continue;
          if (item.checked) { if (!item.removedAt) { item.removedAt = "now"; item.needsReview = false; summary.keptBought++; } }
          else { list.items = list.items.filter((i) => i !== item); summary.removed++; }
        }
        for (const op of ops.update) {
          const item = list.items.find((i) => i.id === op.id);
          if (guarded(item)) continue;
          let review = false;
          const bought = item.checked ? item.checkedQuantity ?? base(item.quantity, item.unit) : null;
          if (item.checked) {
            review = item.needsReview;
            if (op.quantity !== null && (bought === null || base(op.quantity, op.unit) > bought)) review = true;
          }
          if (review && !item.needsReview) summary.review++;
          if (base(item.quantity, item.unit) !== base(op.quantity, op.unit) || item.name !== op.name || item.removedAt) summary.changed++;
          Object.assign(item, { name: op.name, quantity: op.quantity, unit: op.unit, category: op.category, itemKey: op.item_key, origins: op.origins, removedAt: null, needsReview: review, checkedQuantity: bought });
        }
        for (const op of ops.add) { list.items.push(row(op)); summary.added++; }
        const active = list.items.filter((i) => i.itemKey && !i.removedAt).map((i) => i.itemKey);
        if (new Set(active).size !== active.length) { list.items = snapshot; return { status: "stale", weekVersion: week.version }; }
        Object.assign(list, { signature: toSignature, basis: "mixed-v1" });
        return { status: "applied", list: asList(list), weekVersion: week.version, summary };
      },
      // edit_shopping_items: add (client id; resend → duplicate; active key → existing),
      // set_quantity (any active row; manual rows keep origins [{kind:"manual"}]; other rows keep
      // their unit), remove (manual rows only). Signature and basis never change.
      async edit({ listId, ops }) {
        st.calls.edit++; offline();
        const week = st.weeks.get(k);
        if (!week) return { status: "no_week" };
        const list = current(k);
        if (!list || list.id !== listId) return { status: "stale", currentListId: list?.id ?? null };
        const results = [];
        let wrote = false;
        for (const op of ops.add ?? []) {
          if (st.lists.some((l) => l.items.some((i) => i.id === op.id))) { results.push({ id: op.id, result: "duplicate" }); continue; }
          if (list.items.some((i) => i.itemKey === op.item_key && !i.removedAt)) { results.push({ id: op.id, result: "existing" }); continue; }
          list.items.push(row({ ...op, origins: [{ kind: "manual", quantity: op.quantity }] }));
          results.push({ id: op.id, result: "created" }); wrote = true;
        }
        for (const op of ops.set_quantity ?? []) {
          const item = list.items.find((i) => i.id === op.id && !i.removedAt);
          if (!item) { results.push({ id: op.id, result: "missing" }); continue; }
          if (isManual(item)) Object.assign(item, { quantity: op.quantity, unit: op.unit.trim(), origins: [{ kind: "manual", quantity: op.quantity }] });
          else Object.assign(item, { quantity: op.quantity, origins: op.origins });
          results.push({ id: op.id, result: "applied" }); wrote = true;
        }
        for (const op of ops.remove ?? []) {
          const item = list.items.find((i) => i.id === op.id);
          if (!item) { results.push({ id: op.id, result: "missing" }); continue; }
          if (!isManual(item)) { results.push({ id: op.id, result: "not_manual" }); continue; }
          list.items = list.items.filter((i) => i !== item);
          results.push({ id: op.id, result: "applied" }); wrote = true;
        }
        const status = wrote ? "applied" : results.some((r) => r.result === "existing") ? "existing" : "duplicate";
        if (st.loseEditReplies > 0) { st.loseEditReplies--; throw new TypeError("connection lost after the write"); }
        return { status, list: asList(list), results };
      },
    };
  };
  // A write of the week by any client: version and updated_at always move. foodContext (C1).
  const writeWeek = (isoWeek, days, foodContext) => {
    const previous = st.weeks.get(key(isoWeek));
    st.weeks.set(key(isoWeek), { days: structuredClone(days), version: (previous?.version ?? 0) + 1, updatedAt: tick(), foodContext });
  };
  const noEntity = { fetch: async () => ({ data: null, version: null }), push: async () => ({ version: null }) };
  return {
    st,
    writeWeek,
    listsOf: (w) => st.lists.filter((l) => l.week === key(w)),
    remotes: {
      profile: () => noEntity, pantry: () => noEntity, week: () => noEntity, shopping: remote,
      async recipeCards(ids) {
        st.calls.cards++; offline();
        return new Map(ids.filter((id) => st.cards.has(id)).map((id) => [id, structuredClone(st.cards.get(id))]));
      },
    },
  };
}

module.exports = { createShoppingAccount };
