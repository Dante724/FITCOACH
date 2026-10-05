// Shrink photos on the phone before upload: a 4 MB camera photo becomes ~150–300 KB with no visible loss on screen.
// Keeps storage costs down and makes uploads work on slow mobile data. Respects the photo's rotation (EXIF).

export function fitWithin(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall back */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function compressImage(file, { maxSide = 1600, quality = 0.82 } = {}) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file; // GIFs (animation) and unknown types go as they are
  try {
    const img = await decode(file);
    const { width, height } = fitWithin(img.width, img.height, maxSide);
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    img.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // already small
    return new File([blob], (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
