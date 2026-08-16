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
  return (
    BigInt(contentLength) >
    BigInt(maxFileBytes) + BigInt(MULTIPART_OVERHEAD_BYTES)
  );
}
