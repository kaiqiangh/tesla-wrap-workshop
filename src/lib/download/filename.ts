export function safeDownloadFilename(title: string) {
  const base = title
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 26);
  return `${base || "wrap"}.png`;
}
