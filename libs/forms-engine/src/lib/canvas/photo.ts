import { AnswerLabel, AnswerPin, AnswerStroke } from './answer';

/** One photo of a `photos` answer (API "Image kinds"): the case photo's id, a caption and its markup (fractions). */
export interface PhotoItem {
  id?: string;
  photo: string;
  description?: string;
  pins?: AnswerPin[];
  strokes?: AnswerStroke[];
  labels?: AnswerLabel[];
}

export interface PhotosValue {
  photos: PhotoItem[];
}

export const MAX_GALLERY = 20;
export const MAX_CAPTION = 500;
/** Photos are shrunk on the device before upload (the API asks for about 2048 px on the long edge). */
export const PHOTO_MAX_SIDE = 2048;

/** Read a stored photos answer safely (markup is checked by the canvas reader when a photo is opened). */
export function parsePhotos(raw: unknown): PhotoItem[] {
  const list = (raw as { photos?: unknown })?.photos;
  if (!Array.isArray(list)) return [];
  const out: PhotoItem[] = [];
  for (const p of list as Record<string, unknown>[]) {
    if (out.length >= MAX_GALLERY) break;
    if (!p || typeof p['photo'] !== 'string' || !p['photo']) continue;
    out.push({
      ...(p as unknown as PhotoItem),
      id: typeof p['id'] === 'string' ? (p['id'] as string) : (p['photo'] as string),
    });
  }
  return out;
}

/** The size a photo is shrunk to (never enlarged). */
export function shrinkSize(w: number, h: number, maxSide = PHOTO_MAX_SIDE): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/**
 * Shrink a camera photo to at most PHOTO_MAX_SIDE (JPEG 0.85), the right way up
 * (createImageBitmap honours EXIF orientation). Where the browser can't, the
 * original goes up as it is (the API checks size and type, ≤ 8 MB).
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const size = shrinkSize(bmp.width, bmp.height);
    if (size.w === bmp.width && size.h === bmp.height && file.size < 1_500_000) {
      bmp.close?.();
      return file;
    }
    const c = document.createElement('canvas');
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, size.w, size.h);
    bmp.close?.();
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return out ?? file;
  } catch {
    return file;
  }
}
