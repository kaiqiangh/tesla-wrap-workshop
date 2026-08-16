import { spawn, spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("A command is required");

const supabase = new URL("../node_modules/.bin/supabase", import.meta.url)
  .pathname;
const result = spawnSync(supabase, ["status", "-o", "json"], {
  encoding: "utf8",
});
if (result.status !== 0 || !result.stdout.trimStart().startsWith("{")) {
  throw new Error("Local Supabase is not running");
}

const local = JSON.parse(result.stdout);
const executable =
  command === "pnpm" ? (process.env.npm_execpath ?? "pnpm") : command;
const executableArgs = args;
const child = spawn(executable, executableArgs, {
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
  },
  stdio: "inherit",
});

const signalHandlers = new Map(
  ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [
    signal,
    () => child.kill(signal),
  ]),
);
for (const [signal, handler] of signalHandlers) {
  process.once(signal, handler);
}

const childResult = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});

for (const [signal, handler] of signalHandlers) {
  process.removeListener(signal, handler);
}

if (childResult.signal) {
  process.kill(process.pid, childResult.signal);
}
process.exit(childResult.code ?? 1);
