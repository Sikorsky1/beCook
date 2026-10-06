// Test-only SECURITY INVOKER functions, scoped to one psql session.
// Snapshots are hashes; no row content is returned or logged.
const publicTables = ["profiles", "weeks", "week_days", "shopping_lists", "shopping_items", "pantry_items", "menu_generation_requests"];
const fingerprintSql = "SELECT md5(jsonb_build_object(" + publicTables.map(t =>
  "'" + t + "', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id), '[]'::jsonb) FROM public." + t + " r)"
).join(",") + ")::text)";
const probeSql = `
CREATE FUNCTION pg_temp.fixture_fingerprint() RETURNS text LANGUAGE sql SECURITY INVOKER
AS $fingerprint$ ${fingerprintSql} $fingerprint$;
CREATE FUNCTION pg_temp.probe(statement text, verification text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  before_state text := pg_temp.fixture_fingerprint();
  result text;
  valid boolean;
BEGIN
  BEGIN
    EXECUTE statement;
    IF verification IS NOT NULL THEN
      EXECUTE verification INTO valid;
      IF valid IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='Z0002', MESSAGE='Expected persisted test state not observed';
      END IF;
    END IF;
    result := 'accepted';
    RAISE EXCEPTION USING ERRCODE='Z0001', MESSAGE='Rollback successful probe';
  EXCEPTION
    WHEN SQLSTATE 'Z0001' THEN NULL;
    WHEN insufficient_privilege THEN
      result := CASE WHEN SQLERRM LIKE '%row-level security%' THEN 'rls:42501' ELSE 'permission:42501' END;
    WHEN integrity_constraint_violation THEN result := 'constraint:' || SQLSTATE;
  END;
  RETURN jsonb_build_object('outcome',result,'unchanged',before_state=pg_temp.fixture_fingerprint());
END $$;
`;
module.exports = { fingerprintSql, probeSql };
