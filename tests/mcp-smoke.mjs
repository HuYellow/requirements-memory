import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "requirements-memory-mcp-"));
const child = spawn(process.execPath, ["dist/src/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    REQUIREMENTS_MEMORY_HOME: tempRoot,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const responses = [];
let buffer = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim()) {
      responses.push(JSON.parse(line));
    }
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const match = responses.find(predicate);
      if (match) {
        clearInterval(timer);
        resolve(match);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for MCP response. stderr=${stderr}`));
      }
    }, 25);
  });
}

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "requirements-memory-smoke", version: "0.1.0" },
  },
});

await waitFor((message) => message.id === 1);

send({
  jsonrpc: "2.0",
  method: "notifications/initialized",
  params: {},
});

send({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
});

const listResponse = await waitFor((message) => message.id === 2);
const names = listResponse.result.tools.map((tool) => tool.name);
if (!names.includes("create_business_space") || !names.includes("search_memories")) {
  throw new Error(`Expected tools were not registered: ${names.join(", ")}`);
}

child.kill();
console.log(`MCP smoke test passed with ${names.length} tools.`);

