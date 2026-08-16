import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);

if (!existsSync(join(root, "pnpm-lock.yaml"))) {
  failures.push("pnpm-lock.yaml is missing");
}
if (packageJson.packageManager !== "pnpm@11.16.0") {
  failures.push("packageManager must remain pinned to pnpm@11.16.0");
}

const envExample = readFileSync(join(root, ".env.example"), "utf8");
for (const name of [
  "NEXT_PUBLIC_SITE_URL",
  "WRAPFORGE_ENVIRONMENT",
  "NEXT_PUBLIC_WRAPFORGE_ENVIRONMENT",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DOWNLOAD_PRINCIPAL_HMAC_SECRET",
  "CRON_SECRET",
]) {
  if (!new RegExp(`^${name}=`, "m").test(envExample)) {
    failures.push(`.env.example is missing ${name}`);
  }
}

const tracked = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    cwd: root,
    encoding: "utf8",
  },
);
if (tracked.status !== 0) failures.push("git file inventory failed");
const sourceFiles = (tracked.stdout ?? "")
  .split("\n")
  .filter(Boolean)
  .filter(
    (file) => !file.startsWith(".next/") && !file.startsWith("node_modules/"),
  );
const sourceForbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:postgres|postgresql):\/\/[^\s"']+/i,
  /^\s*(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DOWNLOAD_PRINCIPAL_HMAC_SECRET|CRON_SECRET)\s*=\s*(?:["'][A-Za-z0-9_./+=-]{12,}["']|[A-Za-z0-9_./+=-]{12,})/m,
  /\bsb_secret_[A-Za-z0-9_]{12,}\b/,
];
for (const file of sourceFiles) {
  if (
    file.endsWith(".test.ts") ||
    file.endsWith(".test.tsx") ||
    file.startsWith("supabase/tests/")
  ) {
    continue;
  }
  const path = join(root, file);
  if (!existsSync(path) || !statSync(path).isFile()) continue;
  const content = readFileSync(path, "utf8");
  const patterns =
    file.endsWith(".yml") || file.endsWith(".yaml")
      ? [
          ...sourceForbidden,
          /^\s*(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DOWNLOAD_PRINCIPAL_HMAC_SECRET|CRON_SECRET)\s*:\s*(?:["'][A-Za-z0-9_./+=-]{12,}["']|[A-Za-z0-9_./+=-]{12,})/m,
        ]
      : sourceForbidden;
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      failures.push(`forbidden secret pattern in ${relative(root, path)}`);
      break;
    }
  }
}

const bundleRoots = [
  join(root, ".next", "static"),
  join(root, ".next", "server"),
];
if (!bundleRoots.every(existsSync)) {
  failures.push(
    ".next/static and .next/server are required; run the production build before scanning",
  );
} else {
  const clientBundleForbidden = [
    /SUPABASE_SECRET_KEY/,
    /DOWNLOAD_PRINCIPAL_HMAC_SECRET/,
    /SUPABASE_SERVICE_ROLE_KEY/,
    /CRON_SECRET/,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
    /(?:postgres|postgresql):\/\//i,
    /\bsb_secret_[A-Za-z0-9_]{12,}\b/,
  ];
  const serverBundleForbidden = [
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
    /(?:postgres|postgresql):\/\//i,
    /\bsb_secret_[A-Za-z0-9_]{12,}\b/,
  ];
  for (const file of walk(bundleRoots[0])) {
    const content = readFileSync(file, "utf8");
    for (const pattern of clientBundleForbidden) {
      if (pattern.test(content)) {
        failures.push(
          `forbidden client-bundle pattern in ${relative(root, file)}`,
        );
        break;
      }
    }
  }
  for (const file of walk(bundleRoots[1])) {
    const content = readFileSync(file, "utf8");
    for (const pattern of serverBundleForbidden) {
      if (pattern.test(content)) {
        failures.push(
          `forbidden server-artifact pattern in ${relative(root, file)}`,
        );
        break;
      }
    }
  }
}

const audit = spawnSync("pnpm", ["audit", "--prod", "--audit-level", "high"], {
  cwd: root,
  stdio: "inherit",
});
if (audit.status !== 0)
  failures.push("pnpm audit reported a high/critical dependency finding");

if (failures.length > 0) {
  console.error("Security scan failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "Security scan passed: lockfile, env schema, source secrets, client bundle, and dependencies.",
  );
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
