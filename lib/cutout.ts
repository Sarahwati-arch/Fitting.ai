// Garment cutout, fully client-side.
//
// LICENSE WARNING (spike only): @imgly/background-removal is AGPL-3.0 with a separate
// commercial license. Fine for evaluating quality; decide before shipping to production.

const MAX_SIDE = 1024;
const ALPHA_THRESHOLD = 16;

export async function cutoutGarment(
  file: File,
  opts: { skipRemoval?: boolean } = {},
): Promise<ImageBitmap> {
  let blob: Blob = file;
  if (!opts.skipRemoval) {
    const { removeBackground } = await import("@imgly/background-removal");
    blob = await removeBackground(file);
  }
  const bmp = await createImageBitmap(blob);
  return cropToAlphaBounds(bmp);
}

function cropToAlphaBounds(bmp: ImageBitmap): Promise<ImageBitmap> {
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return createImageBitmap(canvas); // fully transparent: return as is
  return createImageBitmap(canvas, minX, minY, maxX - minX + 1, maxY - minY + 1);
}
