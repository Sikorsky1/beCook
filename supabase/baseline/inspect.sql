select json_build_object(
'columns',(select json_agg(x) from (select c.relname as table_name,a.attname as name,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as not_null,pg_get_expr(d.adbin,d.adrelid) as default_expr from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum)x),
'tables',(select json_agg(x) from (select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')x),
'constraints',(select json_agg(x) from (select c.conname,c.conrelid::regclass::text as table_name,pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public')x),
'indexes',(select json_agg(x) from (select tablename,indexname,indexdef from pg_indexes where schemaname='public')x),
'policies',(select json_agg(x) from (select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public')x),
'triggers',(select json_agg(x) from (select c.relname as table_name,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','auth'))x),
'functions',(select json_agg(x) from (select p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f')x),
'grants',(select json_agg(x) from (select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public')x),
'other_relations',(select json_agg(x) from (select c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind not in ('r','i'))x),
'enums',(select json_agg(x) from (select t.typname,e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public')x)
) as metadata;
