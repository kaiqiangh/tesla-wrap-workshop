export type AssetObject = {
  bucket: "wrap-staging" | "wrap-originals" | "wrap-derived";
  key: string;
  bytes: Buffer;
};

type Persistence = {
  assets: AssetObject[];
  store: (asset: AssetObject) => Promise<void>;
  complete: () => Promise<"complete" | "failed" | "unknown">;
  remove: (assets: AssetObject[]) => Promise<boolean>;
  fail: (
    code: "WF-UPLOAD-STORAGE" | "WF-UPLOAD-DATABASE" | "WF-UPLOAD-CLEANUP",
  ) => Promise<boolean>;
  removeStaging: () => Promise<boolean>;
};

export async function persistAssetRevision(persistence: Persistence) {
  const uploaded: AssetObject[] = [];
  try {
    for (const asset of persistence.assets) {
      await persistence.store(asset);
      uploaded.push(asset);
    }
  } catch {
    const code = (await persistence.remove(uploaded))
      ? "WF-UPLOAD-STORAGE"
      : "WF-UPLOAD-CLEANUP";
    return (await persistence.fail(code))
      ? code
      : ("WF-UPLOAD-DATABASE-UNKNOWN" as const);
  }

  let completion: "complete" | "failed" | "unknown";
  try {
    completion = await persistence.complete();
  } catch {
    completion = "unknown";
  }
  if (completion === "unknown") {
    return "WF-UPLOAD-DATABASE-UNKNOWN" as const;
  }
  if (completion === "failed") {
    const code = (await persistence.remove(uploaded))
      ? "WF-UPLOAD-DATABASE"
      : "WF-UPLOAD-CLEANUP";
    return (await persistence.fail(code))
      ? code
      : ("WF-UPLOAD-DATABASE-UNKNOWN" as const);
  }

  return (await persistence.removeStaging())
    ? ("READY" as const)
    : ("WF-UPLOAD-CLEANUP" as const);
}
