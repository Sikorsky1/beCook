// «Ya tengo un menú» from a file: a PDF or a photo of the menu becomes text in the paste box, where
// the user checks it before «Procesar menú». A PDF with text is read on the device, without the
// AI; a photo or a scanned PDF is sent as images to /api/menu-file-text. The file itself is never
// stored or uploaded: only the page images, downscaled in the browser, and only for the AI.
// Shared by the browser and the route, so it must not import server code.

export const menuFileLimits = {
  // The file is opened in the browser; only the downscaled images travel.
  maxFileBytes: 15 * 1024 * 1024,
  // One week of menu: a page or two. Also the most images sent to the AI at once.
  maxPages: 4,
  // Long side of each image sent to the AI, and its JPEG quality.
  maxImageSide: 1600,
  imageQuality: 0.82,
  // Characters of one image as a data URL (a 1600 px JPEG is ~300-600 KB).
  maxImageDataUrlLength: 1_400_000,
  // Under Vercel's 4.5 MB request body limit.
  maxRequestBytes: 4 * 1024 * 1024,
  // A text PDF with fewer letters than this is treated as scanned.
  minPdfTextLetters: 30,
  maxCompletionTokens: 2500,
} as const;

export const menuFileAccept =
  "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/heic,.heic,image/heif,.heif";

export type MenuFileKind = "pdf" | "image";

export type MenuFileErrorReason =
  | "unsupported_type"
  | "too_large"
  | "too_many_pages"
  | "unreadable"
  | "heic_unsupported"
  | "no_text_found";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const imageExtensions = /\.(jpe?g|png|webp|heic|heif)$/i;

// Some browsers give HEIC files an empty type: the extension decides then.
export function menuFileKind(file: { name: string; type: string }): MenuFileKind | null {
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || (!type && /\.pdf$/i.test(file.name))) return "pdf";
  if (imageTypes.has(type) || ((!type || type === "application/octet-stream") && imageExtensions.test(file.name))) {
    return "image";
  }
  return null;
}

export function isHeicFile(file: { name: string; type: string }) {
  return /^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export function menuFileErrorMessage(reason: unknown) {
  switch (reason) {
    case "unsupported_type":
      return "Sube un PDF o una foto (JPG, PNG o HEIC).";
    case "too_large":
      return `El archivo es demasiado grande (máximo ${menuFileLimits.maxFileBytes / 1024 / 1024} MB).`;
    case "too_many_pages":
      return `El PDF tiene demasiadas páginas (máximo ${menuFileLimits.maxPages}). Sube solo la semana.`;
    case "heic_unsupported":
      return "Este navegador no puede abrir fotos HEIC. Haz una captura de la foto o guárdala como JPG y súbela de nuevo.";
    case "no_text_found":
      return "No hemos encontrado un menú en el archivo. Prueba con una foto más nítida o pega el texto.";
    default:
      return "No hemos podido leer el archivo. Prueba con otro o pega el texto.";
  }
}

const dataUrlPattern = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

// What the route accepts: 1 to maxPages JPEG or PNG data URLs, each under the size cap.
export function validateMenuImages(value: unknown): { ok: true; images: string[] } | { ok: false } {
  if (!Array.isArray(value) || value.length === 0 || value.length > menuFileLimits.maxPages) return { ok: false };
  for (const image of value) {
    if (typeof image !== "string" || image.length > menuFileLimits.maxImageDataUrlLength || !dataUrlPattern.test(image)) {
      return { ok: false };
    }
  }
  return { ok: true, images: value as string[] };
}

export type PdfTextItem = { str: string; x: number; y: number; width: number; fontSize: number; hasEOL: boolean };

// Rebuilds the lines of a PDF page from its text items: items on the same baseline form a line
// (top to bottom, left to right) and a wide gap between two items becomes a tab, so a table keeps
// its columns for the local parser (day, lunch, dinner).
export function pdfItemsToText(items: PdfTextItem[]) {
  const lines: { y: number; size: number; items: PdfTextItem[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const size = item.fontSize || 10;
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(candidate.size, size) * 0.5);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, size, items: [item] });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const sorted = line.items.sort((a, b) => a.x - b.x);
      let text = "";
      let end: number | null = null;
      for (const item of sorted) {
        const gap = end === null ? 0 : item.x - end;
        const size = item.fontSize || 10;
        if (end !== null) text += gap > size * 1.5 ? "\t" : gap > size * 0.1 ? " " : "";
        text += item.str;
        end = item.x + item.width;
      }
      return text.replace(/ {2,}/g, " ").trim();
    })
    .filter(Boolean)
    .join("\n");
}

export function countLetters(text: string) {
  return (text.match(/\p{L}/gu) ?? []).length;
}
