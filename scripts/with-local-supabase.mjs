import { spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("A command is required");

const pnpm = process.env.npm_execpath;
const result = pnpm
  ? spawnSync(
      process.execPath,
      [pnpm, "exec", "supabase", "status", "-o", "json"],
      {
        encoding: "utf8",
      },
    )
  : spawnSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
      encoding: "utf8",
    });
if (result.status !== 0) throw new Error("Local Supabase is not running");

const local = JSON.parse(result.stdout);
const executable = command === "pnpm" && pnpm ? process.execPath : command;
const executableArgs = command === "pnpm" && pnpm ? [pnpm, ...args] : args;
const child = spawnSync(executable, executableArgs, {
  env: {
    ...process.env,
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
    WRAPFORGE_ENVIRONMENT: "local",
    NEXT_PUBLIC_WRAPFORGE_ENVIRONMENT: "local",
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: local.SECRET_KEY,
    // Local-only convenience; hosted environments must provide a separate secret.
    DOWNLOAD_PRINCIPAL_HMAC_SECRET: local.JWT_SECRET,
    SUPABASE_JWT_SECRET: local.JWT_SECRET,
    SUPABASE_MAILPIT_URL: local.MAILPIT_URL,
  },
  stdio: "inherit",
});

process.exit(child.status ?? 1);
