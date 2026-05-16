#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "opencrab";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2025-03-26";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadEnvFiles() {
  const bridgeDir = path.dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  const homeConfig = path.join(os.homedir(), ".opencrab", "opencrab.env");

  for (const filePath of [
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    path.join(bridgeDir, "opencrab_mcp.env"),
    homeConfig,
  ]) {
    loadEnvFile(filePath);
  }
}

function mcpUrl() {
  const value = (process.env.OPENCRAB_MCP_URL || "").trim();
  if (!value) {
    throw new Error("OPENCRAB_MCP_URL is not configured.");
  }
  return value;
}

function mcpHeaders() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const token = (process.env.OPENCRAB_MCP_API_KEY || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function forward(request) {
  const response = await fetch(mcpUrl(), {
    method: "POST",
    headers: mcpHeaders(),
    body: JSON.stringify(request),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Remote OpenCrab MCP returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : { jsonrpc: "2.0", id: request.id, result: {} };
}

async function handle(request) {
  if (!request || typeof request !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(request, "id")) return;

  if (request.method === "initialize") {
    ok(request.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
    return;
  }

  if (request.method === "tools/list" || request.method === "tools/call") {
    send(await forward(request));
    return;
  }

  if (request.method === "prompts/list") {
    ok(request.id, { prompts: [] });
    return;
  }

  if (request.method === "resources/list") {
    ok(request.id, { resources: [] });
    return;
  }

  fail(request.id, -32601, `Unsupported method: ${request.method}`);
}

loadEnvFiles();

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    fail(null, -32700, error instanceof Error ? error.message : String(error));
    return;
  }

  handle(request).catch((error) => {
    fail(request?.id ?? null, -32000, error instanceof Error ? error.message : String(error));
  });
});
