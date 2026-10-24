/// Deploy the hosted web client to Cloudflare Workers from this machine.
///
/// This is the local equivalent of the `web` job in
/// `.github/workflows/build.yml`. It reads `.env.deploy` (gitignored), builds
/// `dist/web`, then runs `wrangler deploy` against `wrangler.json`.
///
/// Usage:
///   bun run deploy:web
///   bun run deploy:web:dry
///
/// Local settings (shell env wins over `.env.deploy`):
///   CLOUDFLARE_API_TOKEN          API token; omit to use `wrangler login`
///   CLOUDFLARE_ACCOUNT_ID         Cloudflare account ID
///   PLEXY_DEFAULT_SERVER_URL      Optional default Plexy server baked into the build
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");

async function loadEnvFile(file: string): Promise<void> {
  if (!existsSync(file)) return;

  const text = await readFile(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();

    const equals = line.indexOf("=");
    if (equals === -1) continue;

    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Shell values win over the file.
    if (!process.env[key]) process.env[key] = value;
  }
}

function run(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): void {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(join(root, "wrangler.json"))) {
  console.error("Missing wrangler.json. Run this command from the repo root.");
  process.exit(1);
}

await loadEnvFile(join(root, ".env.deploy"));

const defaultServer = process.env.PLEXY_DEFAULT_SERVER_URL?.trim() ?? "";
const env: Record<string, string | undefined> = {
  ...process.env,
  ...(defaultServer ? { VITE_API_URL: defaultServer } : {}),
};

console.log("Plexy web deploy");
console.log(`  mode: ${dryRun ? "dry run (no upload)" : "deploy"}`);
console.log(
  defaultServer
    ? `  default server baked into the build: ${defaultServer}`
    : "  default server: none (viewers enter it on first launch)",
);

if (
  defaultServer.startsWith("http://") &&
  !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(defaultServer)
) {
  console.warn(
    "  warning: an HTTPS hosted page cannot call a plain HTTP server. Use an HTTPS tunnel or leave this unset.",
  );
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.log(
    "  Cloudflare auth: no CLOUDFLARE_API_TOKEN set; wrangler will use its stored login.",
  );
  console.log("  If needed, run once: npx --yes wrangler@4 login");
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.log(
    "  Cloudflare account: no CLOUDFLARE_ACCOUNT_ID set; wrangler will use the logged-in account.",
  );
}

run("bun", ["run", "build:web"], env);

const wranglerArgs = ["--yes", "wrangler@4", "deploy"];
if (dryRun) wranglerArgs.push("--dry-run");
run("npx", wranglerArgs, env);

if (!dryRun) {
  console.log("\nDone. Wrangler prints the deployed URL above.");
  console.log(
    "If there is no workers.dev URL, enable it in Cloudflare: Workers & Pages → plexy → Settings → Domains & Routes → workers.dev.",
  );
}
