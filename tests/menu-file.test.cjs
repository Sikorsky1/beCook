const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {menuFileKind, menuFileLimits, pdfItemsToText, validateMenuImages} = require("../src/lib/menuFile.ts");
const {parseMenuTextLocally} = require("../src/lib/importMenu.ts");
const {aiRequestLimits} = require("../src/lib/server/ai-limits.ts");

// «Ya tengo un menú» from a file: types, the images the AI route accepts and the PDF text layout.

test("menuFileKind: PDF and photos by type, HEIC without a type by extension", () => {
 assert.equal(menuFileKind({name: "menu.pdf", type: "application/pdf"}), "pdf");
 assert.equal(menuFileKind({name: "menu.pdf", type: ""}), "pdf");
 assert.equal(menuFileKind({name: "foto.jpg", type: "image/jpeg"}), "image");
 assert.equal(menuFileKind({name: "IMG_0001.HEIC", type: ""}), "image");
 assert.equal(menuFileKind({name: "IMG_0001.heic", type: "image/heic"}), "image");
 assert.equal(menuFileKind({name: "menu.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}), null);
 assert.equal(menuFileKind({name: "dibujo.svg", type: "image/svg+xml"}), null);
});

test("validateMenuImages: 1 to 4 JPEG or PNG data URLs under the size cap", () => {
 const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
 assert.equal(validateMenuImages([jpeg]).ok, true);
 assert.equal(validateMenuImages(["data:image/png;base64,iVBORw0KGgo="]).ok, true);
 assert.equal(validateMenuImages([]).ok, false);
 assert.equal(validateMenuImages(Array(menuFileLimits.maxPages + 1).fill(jpeg)).ok, false);
 assert.equal(validateMenuImages(["https://example.com/menu.jpg"]).ok, false);
 assert.equal(validateMenuImages(["data:image/svg+xml;base64,PHN2Zz4="]).ok, false);
 assert.equal(validateMenuImages([`data:image/jpeg;base64,${"A".repeat(menuFileLimits.maxImageDataUrlLength)}`]).ok, false);
 assert.equal(validateMenuImages("x").ok, false);
});

test("the route body cap stays under Vercel's 4.5 MB and fits four images", () => {
 assert.equal(aiRequestLimits.menuFileText.maxBytes, menuFileLimits.maxRequestBytes);
 assert.ok(menuFileLimits.maxRequestBytes < 4.5 * 1024 * 1024);
 assert.ok(menuFileLimits.maxPages * menuFileLimits.maxImageDataUrlLength < menuFileLimits.maxRequestBytes * 1.5);
});

test("pdfItemsToText: rows top to bottom, wide gaps become tabs the local parser reads", () => {
 const item = (str, x, y, width) => ({str, x, y, width, fontSize: 12, hasEOL: false});
 const text = pdfItemsToText([
  item("Martes", 72, 736, 40), item("Arroz con verduras", 180, 736, 100), item("LIBRE", 380, 736, 35),
  item("Lunes", 72, 760, 32), item("Crema de", 180, 760, 50), item("calabaza", 233, 760, 48), item("Tortilla francesa", 380, 760, 90),
  item(" ", 10, 700, 3),
 ]);
 assert.equal(text, "Lunes\tCrema de calabaza\tTortilla francesa\nMartes\tArroz con verduras\tLIBRE");
 const parsed = parseMenuTextLocally(text);
 assert.equal(parsed.kind, "parsed");
 assert.equal(parsed.days[0].lunch.dishName, "Crema de calabaza");
 assert.equal(parsed.days[1].dinner.status, "free");
});

test("a real text PDF (E2E fixture) comes out as a table the device orders without the AI", async () => {
 const {extractTextItems} = await import("unpdf");
 const data = new Uint8Array(fs.readFileSync(path.join(__dirname, "e2e/fixtures/menu-texto.pdf")));
 const {items} = await extractTextItems(data);
 const text = pdfItemsToText(items[0]);
 assert.match(text, /^Día\tComida\tCena\nLunes\tCrema de calabaza\tTortilla francesa\n/);
 const parsed = parseMenuTextLocally(text);
 assert.equal(parsed.kind, "parsed");
 assert.deepEqual(parsed.days.map(day => day.dayName), ["Lunes", "Martes", "Miércoles"]);
});
