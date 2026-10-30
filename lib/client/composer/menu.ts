export function wrapIndex(index: number, length: number, step: number): number {
  if (length <= 0) return 0;
  return ((index + step) % length + length) % length;
}

export function wrapPage(page: number, pageCount: number, step: number): number {
  if (pageCount <= 1) return 0;
  return ((page + step) % pageCount + pageCount) % pageCount;
}

export function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}
