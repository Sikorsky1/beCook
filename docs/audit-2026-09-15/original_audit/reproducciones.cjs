// Auditoría solamente: no red, no escritura de datos. Ejecutar desde la raíz:
// node --require ./scripts/register-typescript.cjs docs/audit-2026-09-15/reproducciones.cjs
const assert = require('node:assert/strict');
const {readMenuProfile} = require('../../src/lib/menu-generation/prompt.ts');
const {selectionToMenu, visibleFoodConflict} = require('../../src/lib/menu-generation/validation.ts');
const {importedMenuToWeekDays} = require('../../src/lib/importMenu.ts');
const {withWeekDates} = require('../../src/lib/weekStorage.ts');
const {getWeekSignature} = require('../../src/lib/shoppingListStorage.ts');
const {parseIsoWeek, getIsoWeekFromDate, getIsoWeekStartDate} = require('../../src/lib/isoWeek.ts');
const selection = {
  lunches: ['Pollo asado con batata','Lentejas estofadas','Arroz meloso de sepia','Espaguetis con setas','Garbanzos con espinacas','Merluza al horno','Paella de pollo'],
  dinners: ['Tortilla de patata','Ensalada de tomate y queso fresco','Salmón a la plancha','Crema de calabaza','Revuelto de champiñones','Bacalao al pilpil','Tosta de aguacate'],
};
for (const dish of ['Merluza en salsa verde','Pollo con salsa especial','Pavo con salsa casera','Bacalao con salsa mediterránea']) {
  assert.doesNotThrow(() => selectionToMenu({...selection, lunches:[dish,...selection.lunches.slice(1)]}, readMenuProfile(null)));
  console.log('Defecto reproducido: acepta',dish);
}
assert.equal(visibleFoodConflict('Ensalada de sésamo', readMenuProfile({allergies:['other'],otherAllergies:'sésamo'})),false);
console.log('Límite confirmado: otherAllergies no tiene detección determinista.');
const menu = selectionToMenu(selection, readMenuProfile(null));
const preview = importedMenuToWeekDays(menu.days);
const dated = withWeekDates(preview,{isoYear:2026,isoWeek:38});
assert.notEqual(getWeekSignature(preview),getWeekSignature(dated));
console.log('Defecto reproducido: mismos platos cambian firma tras fechar la semana.');
const partial = withWeekDates(preview.slice(2,3),{isoYear:2026,isoWeek:38})[0];
assert.equal(partial.day,'Miércoles');
assert.ok(partial.date.startsWith('14 '));
console.log('Defecto reproducido: miércoles aislado recibe fecha de lunes:',partial.date);
const invalid = parseIsoWeek({isoYear:2025,isoWeek:53});
assert.deepEqual(getIsoWeekFromDate(getIsoWeekStartDate(invalid)),{isoYear:2026,isoWeek:1});
console.log('Defecto reproducido: 2025-W53 aceptada equivale a 2026-W01.');
