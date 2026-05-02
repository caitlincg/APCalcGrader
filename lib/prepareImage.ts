/**
 * Downscale and re-encode images to JPEG before upload so:
 * - phone photos stay under Vercel request size limits
 * - HEIC / odd MIME types work with OpenAI vision (JPEG output)
 */

const MAX_EDGE = 2200;

async function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

export async function prepareImageForUpload(
  file: File,
  maxOutputBytes: number,
): Promise<{ file: File; note?: string }> {
  if (!file.size) {
    return { file };
  }

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return { file, note: "Could not prepare image (no canvas context)." };
      }

      let maxEdge = MAX_EDGE;
      let blob: Blob | null = null;

      for (let pass = 0; pass < 5 && (!blob || blob.size > maxOutputBytes); pass++) {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(bitmap, 0, 0, w, h);

        let q = 0.88;
        blob = await encodeJpeg(canvas, q);
        while (blob && blob.size > maxOutputBytes && q > 0.42) {
          q -= 0.07;
          blob = await encodeJpeg(canvas, q);
        }
        maxEdge = Math.round(maxEdge * 0.72);
      }

      if (!blob || blob.size === 0) {
        return { file, note: "Could not compress image; using original file." };
      }

      const base = file.name.replace(/\.[^.]+$/, "") || "page";
      const out = new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });

      if (out.size >= file.size && (file.type === "image/jpeg" || file.type === "image/jpg")) {
        return { file };
      }

      if (out.size > maxOutputBytes) {
        return {
          file: out,
          note: "Still large after shrinking — try fewer pages per request or a shorter rubric.",
        };
      }

      return { file: out };
    } finally {
      bitmap.close();
    }
  } catch {
    const looksHeic = /\.(heic|heif)$/i.test(file.name);
    return {
      file,
      note: looksHeic
        ? "This browser could not read HEIC. Export as JPEG from Photos, or try Safari."
        : undefined,
    };
  }
}

export async function prepareImagesForUpload(files: File[]): Promise<{ files: File[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: File[] = [];
  const n = Math.max(1, files.length);
  /** Keep total image payload under typical serverless limits (rubric text adds more). */
  const perFileCap = Math.max(450_000, Math.floor(3_400_000 / n));

  for (const f of files) {
    const { file, note } = await prepareImageForUpload(f, perFileCap);
    out.push(file);
    if (note) warnings.push(`${f.name}: ${note}`);
  }

  return { files: out, warnings };
}
