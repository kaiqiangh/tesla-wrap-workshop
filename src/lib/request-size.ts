export const MULTIPART_OVERHEAD_BYTES = 65_536;

export function requestContentLengthExceedsLimit(
  contentLength: string | null,
  maxFileBytes: number,
) {
  if (
    !Number.isSafeInteger(maxFileBytes) ||
    maxFileBytes <= 0 ||
    !contentLength ||
    !/^[0-9]+$/.test(contentLength)
  ) {
    return false;
  }
  const length = Number(contentLength);
  return (
    Number.isSafeInteger(length) &&
    length > maxFileBytes + MULTIPART_OVERHEAD_BYTES
  );
}
