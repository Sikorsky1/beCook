-- 2026-10-05 · Reconciliación de datos de PRODUCCIÓN previa a enforce_reference_ownership
-- Destino EXCLUSIVO: proyecto becook, ref wejvptpkxlllfpskyisu (verificar antes de ejecutar).
-- NO ejecutar sin: (1) backup completo descargado, (2) OK explícito de Sergio.
-- Diagnóstico 2026-10-05 (solo lectura):
--   * 18 menu_generation_requests y 12 pantry_items con profile_id de OTRO usuario
--     (consecuencia del defecto H3 de cachés mezcladas). Se conserva la fila; se anula la referencia.
--   * Datos huérfanos anteriores a Auth (mayo-junio 2026, user_id NULL, invisibles bajo RLS):
--     4 profiles, 8 weeks (+56 week_days, 45 shopping_lists, 1479 shopping_items en cascada),
--     2 menu_generation_requests, 22 pantry_items. Se eliminan (autorizado, decisión D4).
-- Copia de seguridad interna de todas las filas afectadas en el esquema backup_20261005
-- (no expuesto por la API). Se puede eliminar cuando Sergio lo decida.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE SCHEMA backup_20261005;
REVOKE ALL ON SCHEMA backup_20261005 FROM PUBLIC, anon, authenticated;

CREATE TABLE backup_20261005.mgr_crossref AS
  SELECT r.* FROM public.menu_generation_requests r JOIN public.profiles p ON p.id = r.profile_id
  WHERE p.user_id IS DISTINCT FROM r.user_id;
CREATE TABLE backup_20261005.pantry_crossref AS
  SELECT i.* FROM public.pantry_items i JOIN public.profiles p ON p.id = i.profile_id
  WHERE p.user_id IS DISTINCT FROM i.user_id;
CREATE TABLE backup_20261005.weeks_orphan AS SELECT * FROM public.weeks WHERE user_id IS NULL;
CREATE TABLE backup_20261005.week_days_orphan AS
  SELECT d.* FROM public.week_days d JOIN public.weeks w ON w.id = d.week_id WHERE w.user_id IS NULL;
CREATE TABLE backup_20261005.shopping_lists_orphan AS
  SELECT l.* FROM public.shopping_lists l JOIN public.weeks w ON w.id = l.week_id WHERE w.user_id IS NULL;
CREATE TABLE backup_20261005.shopping_items_orphan AS
  SELECT s.* FROM public.shopping_items s JOIN public.shopping_lists l ON l.id = s.shopping_list_id
  JOIN public.weeks w ON w.id = l.week_id WHERE w.user_id IS NULL;
CREATE TABLE backup_20261005.profiles_orphan AS SELECT * FROM public.profiles WHERE user_id IS NULL;
CREATE TABLE backup_20261005.mgr_orphan AS SELECT * FROM public.menu_generation_requests WHERE user_id IS NULL;
CREATE TABLE backup_20261005.pantry_orphan AS SELECT * FROM public.pantry_items WHERE user_id IS NULL;
-- Referencias que el borrado pondrá a NULL (ON DELETE SET NULL), para poder restaurarlas.
CREATE TABLE backup_20261005.refs_to_orphans AS
  SELECT 'profiles.active_week_id' AS ref, id, active_week_id AS target FROM public.profiles
    WHERE active_week_id IN (SELECT id FROM public.weeks WHERE user_id IS NULL)
  UNION ALL SELECT 'mgr.created_week_id', id, created_week_id FROM public.menu_generation_requests
    WHERE created_week_id IN (SELECT id FROM public.weeks WHERE user_id IS NULL)
  UNION ALL SELECT 'weeks.profile_id', id, profile_id FROM public.weeks
    WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id IS NULL)
  UNION ALL SELECT 'weeks.generation_request_id', id, generation_request_id FROM public.weeks
    WHERE generation_request_id IN (SELECT id FROM public.menu_generation_requests WHERE user_id IS NULL)
  UNION ALL SELECT 'mgr.profile_id', id, profile_id FROM public.menu_generation_requests
    WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id IS NULL)
  UNION ALL SELECT 'pantry.profile_id', id, profile_id FROM public.pantry_items
    WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id IS NULL);

-- 1. Referencias cruzadas entre usuarios: conservar la fila, anular la referencia.
UPDATE public.menu_generation_requests r SET profile_id = NULL
  FROM public.profiles p WHERE p.id = r.profile_id AND p.user_id IS DISTINCT FROM r.user_id;
UPDATE public.pantry_items i SET profile_id = NULL
  FROM public.profiles p WHERE p.id = i.profile_id AND p.user_id IS DISTINCT FROM i.user_id;

-- 2. Huérfanos sin propietario.
DELETE FROM public.weeks WHERE user_id IS NULL;                       -- cascada a días, listas y artículos
DELETE FROM public.menu_generation_requests WHERE user_id IS NULL;
DELETE FROM public.pantry_items WHERE user_id IS NULL;
DELETE FROM public.profiles WHERE user_id IS NULL;

-- 3. Comprobación: todo debe ser 0 o la transacción se aborta.
DO $$
DECLARE n bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM public.menu_generation_requests r JOIN public.profiles p ON p.id = r.profile_id WHERE p.user_id IS DISTINCT FROM r.user_id)
  + (SELECT count(*) FROM public.pantry_items i JOIN public.profiles p ON p.id = i.profile_id WHERE p.user_id IS DISTINCT FROM i.user_id)
  + (SELECT count(*) FROM public.menu_generation_requests r JOIN public.weeks w ON w.id = r.created_week_id WHERE w.user_id IS DISTINCT FROM r.user_id)
  + (SELECT count(*) FROM public.profiles p JOIN public.weeks w ON w.id = p.active_week_id WHERE w.user_id IS DISTINCT FROM p.user_id)
  + (SELECT count(*) FROM public.weeks w JOIN public.profiles p ON p.id = w.profile_id WHERE p.user_id IS DISTINCT FROM w.user_id)
  + (SELECT count(*) FROM public.weeks w JOIN public.menu_generation_requests r ON r.id = w.generation_request_id WHERE r.user_id IS DISTINCT FROM w.user_id)
  + (SELECT count(*) FROM public.profiles WHERE user_id IS NULL)
  + (SELECT count(*) FROM public.weeks WHERE user_id IS NULL)
  + (SELECT count(*) FROM public.menu_generation_requests WHERE user_id IS NULL)
  + (SELECT count(*) FROM public.pantry_items WHERE user_id IS NULL)
  INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'Reconciliación incompleta: % filas incompatibles', n; END IF;
END $$;

COMMIT;
