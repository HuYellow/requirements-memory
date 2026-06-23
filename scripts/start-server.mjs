import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const builtServer = resolve(pluginRoot, "dist", "src", "server.js");

if (!existsSync(builtServer)) {
  console.error(
    [
      "Requirements Memory MCP server is not built.",
      `Expected: ${builtServer}`,
      "Run `npm install` and `npm run build` in the plugin directory, then retry.",
    ].join("\n"),
  );
  process.exit(1);
}

await import(pathToFileURL(builtServer).href);

