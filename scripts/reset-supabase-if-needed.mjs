import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const markerPath = join(
  repoRoot,
  "node_modules",
  ".cache",
  "supabase-schema-fingerprint",
);

function filesUnder(dir) {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
  } catch {
    return [];
  }
}

function schemaFingerprint() {
  const hash = createHash("sha256");
  const migrationsDir = join(repoRoot, "supabase", "migrations");
  const seedPath = join(repoRoot, "supabase", "seed.sql");
  for (const file of filesUnder(migrationsDir).sort()) {
    // Hash the path relative to the repo root so relocating the checkout
    // does not force a spurious reset.
    hash.update(file.slice(repoRoot.length));
    hash.update(readFileSync(file));
  }
  try {
    hash.update(seedPath.slice(repoRoot.length));
    hash.update(readFileSync(seedPath));
  } catch {
    // no seed file; fingerprint covers migrations only
  }
  return hash.digest("hex");
}

function recordedFingerprint() {
  try {
    return readFileSync(markerPath, "utf8").trim();
  } catch {
    return null;
  }
}

const force = process.argv.includes("--force");
const requireClean = process.argv.includes("--require-clean");
const current = schemaFingerprint();
const recorded = recordedFingerprint();
const resetRequired = force || recorded !== current;

if (!resetRequired && requireClean) {
  console.error(
    `[reset-supabase] --require-clean given but schema fingerprint unchanged (${current}); ` +
      `a clean database was required, refusing to skip the reset`,
  );
  process.exit(2);
}

console.log(
  resetRequired
    ? `[reset-supabase] schema fingerprint changed (${recorded ?? "none"} -> ${current}); resetting`
    : `[reset-supabase] schema fingerprint unchanged (${current}); skipping reset`,
);

if (resetRequired) {
  const supabase = join(repoRoot, "node_modules", ".bin", "supabase");
  const result = spawnSync(supabase, ["db", "reset"], {
    stdio: "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error("[reset-supabase] supabase db reset failed");
    process.exit(result.status ?? 1);
  }
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, current);
  console.log("[reset-supabase] fingerprint recorded");
}
