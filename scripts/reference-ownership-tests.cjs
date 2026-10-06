const assert = require("node:assert/strict");
// [child table, optional FK, parent table, fixture child prefix, parent prefix]
const relations = [
  ["weeks","profile_id","profiles","2","1"],
  ["weeks","generation_request_id","menu_generation_requests","2","6"],
  ["pantry_items","profile_id","profiles","7","1"],
  ["menu_generation_requests","profile_id","profiles","6","1"],
  ["menu_generation_requests","created_week_id","weeks","6","2"],
  ["profiles","active_week_id","weeks","1","2"],
];

function runOwnershipTests({check,outcome,id,fixtureId}) {
  for (const n of [1,2]) for (const [table,column,parent,prefix,parentPrefix] of relations) {
    const ownId = fixtureId(prefix,n), owner = id("0",n), parentId = id(parentPrefix,n);
    const otherParent = id(parentPrefix,3-n), insertedId = id("8",n);
    const where = " WHERE id='" + ownId + "'";
    const label = "user " + n + " " + table + "." + column;
    const update = value => "UPDATE public." + table + " SET " + column + "=" + value + where + ";";
    const verify = (rowId,value) => "SELECT count(*)=1 FROM public." + table +
      " WHERE id='" + rowId + "' AND user_id='" + owner + "' AND " + column +
      (value === "NULL" ? " IS NULL" : "=" + value);
    for (const [kind,value,expected] of [
      ["own","'" + parentId + "'","accepted"], ["null","NULL","accepted"],
      ["missing","'ffffffff-ffff-4fff-8fff-ffffffffffff'","constraint:23503"],
      ["foreign","'" + otherParent + "'","constraint:23503"],
    ]) {
      // Valid writes are observed before rollback (not just "no error").
      check(label + " UPDATE " + kind + " / atomic rollback", () => {
        assert.equal(outcome(n,update("NULL") + update(value),expected === "accepted" ? verify(ownId,value) : null),expected);
      });
      // Copy required fields from a synthetic row. A profile is unique per user;
      // temporarily remove it inside the probe, then recreate it. Cascades are rolled back.
      const clone = "CREATE TEMP TABLE insert_fixture AS SELECT * FROM public." + table + where + ";";
      const remove = table === "profiles" ? "DELETE FROM public.profiles" + where + ";" : "";
      const calendar = table === "weeks" ? ", 'iso_year', NULL, 'iso_week', NULL" : "";
      const insert = "INSERT INTO public." + table + " SELECT (jsonb_populate_record(NULL::public." + table +
        ",to_jsonb(r) || jsonb_build_object('id','" + insertedId + "', '" + column + "', " + value + calendar +
        "))).* FROM insert_fixture r;";
      check(label + " INSERT " + kind + " / atomic rollback", () => {
        assert.equal(outcome(n,clone + remove + insert,expected === "accepted" ? verify(insertedId,value) : null),expected);
      });
    }
    check(label + " cannot forge owner together with reference", () =>
      assert.equal(outcome(n,"UPDATE public." + table + " SET user_id='" + id("0",3-n) +
        "', " + column + "='" + otherParent + "'" + where),"rls:42501"));
    check(label + " parent owner cannot be reassigned", () =>
      assert.equal(outcome(n,update("'" + parentId + "'") + "UPDATE public." + parent +
        " SET user_id='" + id("0",3-n) + "' WHERE id='" + parentId + "';"),"rls:42501"));
    check(label + " referenced parent id cannot be changed", () =>
      assert.equal(outcome(n,update("'" + parentId + "'") + "UPDATE public." + parent +
        " SET id='" + insertedId + "' WHERE id='" + parentId + "';"),"constraint:23503"));
    check(label + " delete parent clears reference, preserves owner", () =>
      assert.equal(outcome(n,update("'" + parentId + "'") + "DELETE FROM public." + parent +
        " WHERE id='" + parentId + "';",verify(ownId,"NULL")),"accepted"));
  }
  for (const n of [1,2]) for (const [table,prefix] of [["weeks","2"],["profiles","1"],["pantry_items","7"],["menu_generation_requests","6"]]) {
    check("user " + n + " cannot erase owner of " + table, () =>
      assert.equal(outcome(n,"UPDATE public." + table + " SET user_id=NULL WHERE id='" + fixtureId(prefix,n) + "';"),"rls:42501"));
  }
  // Create the actual cyclic graph in the legitimate order: profile exists,
  // request first, week next, request completion and active week last.
  for (const n of [1,2]) {
    const owner=id("0",n), profile=id("1",n), week=id("8",n), request=id("9",n);
    const steps = "INSERT INTO public.menu_generation_requests(id,user_id,profile_id,status) VALUES ('" + request + "','" + owner + "','" + profile + "','generating');" +
      "INSERT INTO public.weeks(id,user_id,profile_id,generation_request_id,title) VALUES ('" + week + "','" + owner + "','" + profile + "','" + request + "','synthetic cycle');" +
      "UPDATE public.menu_generation_requests SET created_week_id='" + week + "',status='applied' WHERE id='" + request + "';" +
      "UPDATE public.profiles SET active_week_id='" + week + "' WHERE id='" + profile + "';";
    const verify = "SELECT count(*)=1 FROM public.weeks w JOIN public.menu_generation_requests r ON r.id=w.generation_request_id JOIN public.profiles p ON p.active_week_id=w.id WHERE w.id='" + week + "' AND r.created_week_id=w.id AND p.id=w.profile_id AND w.user_id=r.user_id AND p.user_id=w.user_id";
    check("user " + n + " creates and completes legitimate circular workflow", () => assert.equal(outcome(n,steps,verify),"accepted"));
  }
}
module.exports = { runOwnershipTests };
