// Offline generator only: never connects, links, resets or applies remote SQL.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/baseline/20260923103650_local_baseline.sql'), 'utf8');
function buildBootstrap() {
  let sql = source.slice(source.indexOf('set search_path'), source.indexOf('CREATE SCHEMA becook_local;'));
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.rls_auto_enable()');
  const end = sql.indexOf('CREATE OR REPLACE FUNCTION public.set_updated_at()');
  assert(start > 0 && end > start);
  sql = sql.slice(0, start) + sql.slice(end);
  sql = sql.replace('CREATE OR REPLACE FUNCTION public.set_updated_at()', 'CREATE FUNCTION public.set_updated_at()');
  sql = sql.split('\n').filter(line =>
    !line.startsWith('CREATE EVENT TRIGGER ') &&
    !line.includes('public."rls_auto_enable"') &&
    !line.startsWith('GRANT USAGE ON SCHEMA ') &&
    !/^GRANT (TRUNCATE|REFERENCES|TRIGGER) .* TO "(anon|authenticated|service_role)";/.test(line)
  ).join('\n');
  assert(!/becook_local|rls_auto_enable|ensure_rls|CREATE SCHEMA|ALTER DEFAULT PRIVILEGES/.test(sql));
  assert.equal((sql.match(/CREATE TABLE public\./g) || []).length, 7);
  assert.equal((sql.match(/CREATE POLICY /g) || []).length, 28);
  return '-- New hosted TEST project only. Approved target: qdhpdhnpcsfhmygjofqb (becook-preview).\n' +
    '-- Verify project identity and empty tables/users/migration ledger via Management API first.\n' +
    '-- Generated from immutable metadata-only baseline; no historical replay, data or platform objects.\n' +
    '-- Existing public tables cause failure; never run on an initialized project.\n' +
    'BEGIN;\nSET LOCAL lock_timeout = \'5s\';\nSET LOCAL statement_timeout = \'120s\';\n' + sql + '\nCOMMIT;\n';
}
if (require.main === module) {
  assert.equal(process.argv.length, 2, 'No destination arguments accepted');
  fs.mkdirSync(path.join(root, 'supabase/hosted'), {recursive:true});
  fs.writeFileSync(path.join(root, 'supabase/hosted/20260924000100_preview_bootstrap.sql'), buildBootstrap());
  console.log('Generated hosted bootstrap offline. No database connection.');
}
module.exports = {buildBootstrap};
