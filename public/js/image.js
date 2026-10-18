// Utilitários de imagem: redimensionar/comprimir fotos antes de guardar e preparar para OCR
export async function loadBitmap(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fallback */ } }
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Não foi possível ler a imagem.')); img.src = URL.createObjectURL(file); });
}
export async function resizeImage(file, max = 1600, quality = 0.82) {
  const bmp = await loadBitmap(file);
  const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', quality));
}
// Escala de cinzentos + contraste, ampliando imagens pequenas (melhora o OCR de talões)
export async function prepareForOCR(blob) {
  const bmp = await loadBitmap(blob);
  const k = Math.min(2, Math.max(1, 1600 / Math.max(bmp.width, bmp.height)));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height), px = d.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) { const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114); px[i] = px[i + 1] = px[i + 2] = g; if (g < lo) lo = g; if (g > hi) hi = g; }
  const span = Math.max(40, hi - lo);
  for (let i = 0; i < px.length; i += 4) { const v = Math.max(0, Math.min(255, ((px[i] - lo) / span) * 255)); px[i] = px[i + 1] = px[i + 2] = v; }
  ctx.putImageData(d, 0, 0);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
