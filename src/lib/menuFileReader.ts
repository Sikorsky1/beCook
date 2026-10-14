"use client";

import {
  countLetters,
  isHeicFile,
  menuFileKind,
  menuFileLimits,
  pdfItemsToText,
  type MenuFileErrorReason,
} from "@/lib/menuFile";

// Browser side of «Ya tengo un menú» from a file (see @/lib/menuFile). Nothing here sends anything:
// a PDF with text comes back as text; a photo or a scanned PDF comes back as downscaled JPEG data
// URLs, which only the AI route can turn into text.
export type MenuFileReadResult =
  | { kind: "text"; text: string }
  | { kind: "images"; images: string[] }
  | { kind: "error"; reason: MenuFileErrorReason };

function fail(reason: MenuFileErrorReason): MenuFileReadResult {
  return { kind: "error", reason };
}

function scaledSize(width: number, height: number) {
  const scale = Math.min(1, menuFileLimits.maxImageSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/jpeg", menuFileLimits.imageQuality);
}

// A white background first: transparent PNG areas would otherwise turn black in the JPEG.
function drawableCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

async function decodeImage(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Some Safari versions decode HEIC through <img> only.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readImage(file: File): Promise<MenuFileReadResult> {
  let source: Awaited<ReturnType<typeof decodeImage>>;
  try {
    source = await decodeImage(file);
  } catch {
    return fail(isHeicFile(file) ? "heic_unsupported" : "unreadable");
  }
  const { width, height } = scaledSize(source.width, source.height);
  const target = drawableCanvas(width, height);
  if (!target) return fail("unreadable");
  target.context.drawImage(source, 0, 0, width, height);
  if ("close" in source && typeof source.close === "function") source.close();
  const image = canvasToJpeg(target.canvas);
  if (image.length > menuFileLimits.maxImageDataUrlLength) return fail("too_large");
  return { kind: "images", images: [image] };
}

async function readPdf(file: File): Promise<MenuFileReadResult> {
  let pdf: Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;
  try {
    const { getDocumentProxy } = await import("unpdf");
    pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return fail("unreadable");
  }

  try {
    if (pdf.numPages > menuFileLimits.maxTextPdfPages) return fail("too_many_pages");

    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) =>
        "str" in item
          ? [{
              str: item.str,
              x: item.transform[4],
              y: item.transform[5],
              width: item.width,
              fontSize: Math.hypot(item.transform[2], item.transform[3]),
              hasEOL: item.hasEOL,
            }]
          : [],
      );
      pages.push(pdfItemsToText(items));
    }

    const text = pages.filter(Boolean).join("\n\n");
    if (countLetters(text) >= menuFileLimits.minPdfTextLetters) return { kind: "text", text };

    // Scanned: each page as an image for the AI, which takes fewer pages.
    if (pdf.numPages > menuFileLimits.maxPages) return fail("too_many_pages");
    const images: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const { width } = scaledSize(base.width, base.height);
      const viewport = page.getViewport({ scale: width / base.width });
      const target = drawableCanvas(Math.round(viewport.width), Math.round(viewport.height));
      if (!target) return fail("unreadable");
      await page.render({ canvas: target.canvas, canvasContext: target.context, viewport }).promise;
      const image = canvasToJpeg(target.canvas);
      if (image.length > menuFileLimits.maxImageDataUrlLength) return fail("too_large");
      images.push(image);
    }
    return { kind: "images", images };
  } catch {
    return fail("unreadable");
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

export async function readMenuFile(file: File): Promise<MenuFileReadResult> {
  const kind = menuFileKind(file);
  if (!kind) return fail("unsupported_type");
  if (file.size > menuFileLimits.maxFileBytes) return fail("too_large");
  return kind === "pdf" ? readPdf(file) : readImage(file);
}
