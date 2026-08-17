#!/usr/bin/env node
/**
 * Local-only OpenAI Chat Completions adapter for a logged-in Codex App Server.
 * It intentionally uses no third-party packages so PDF engines can launch it
 * beside their own environment without sharing Codex credentials.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 8765;
const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function usage() {
  return [
    "Usage: node scripts/codex-openai-bridge.mjs [options]",
    "  --port <port>             Loopback port (default: 8765)",
    "  --model <model>           Codex model (default: gpt-5.4-mini)",
    "  --reasoning <effort>      low | medium | high | xhigh (optional)",
    "  --codex <path>            Codex executable or codex.cmd path",
    "  --codex-home <path>       Codex login/config directory (default: CODEX_HOME or ~/.codex)",
    "  --token <token>           Local bearer token (or CBR_BRIDGE_TOKEN)",
    "  --timeout-ms <ms>         Per translation timeout (default: 120000)",
    "  --allow-request-model     Permit the request JSON to choose a model",
    "  --help                    Print this help",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    model: DEFAULT_MODEL,
    reasoning: "",
    codex: process.platform === "win32" ? "codex.exe" : "codex",
    codexHome: process.env.CODEX_HOME || "",
    token: process.env.CBR_BRIDGE_TOKEN || "",
    timeoutMs: 120000,
    allowRequestModel: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") return { ...options, help: true };
    if (arg === "--allow-request-model") { options.allowRequestModel = true; continue; }
    const key = arg.replace(/^--/, "");
    const value = argv[index + 1];
    if (!arg.startsWith("--") || value === undefined) throw new Error(`Unknown or incomplete option: ${arg}`);
    index += 1;
    if (key === "port") options.port = Number(value);
    else if (key === "model") options.model = value;
    else if (key === "reasoning") options.reasoning = value;
    else if (key === "codex") options.codex = value;
    else if (key === "codex-home") options.codexHome = value;
    else if (key === "token") options.token = value;
    else if (key === "timeout-ms") options.timeoutMs = Number(value);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("--port must be an integer from 1 to 65535");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) throw new Error("--timeout-ms must be at least 1000");
  return options;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content
    .filter((part) => part && (part.type === "text" || part.type === "input_text"))
    .map((part) => String(part.text || ""))
    .join("\n");
  return "";
}

function requestText(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new Error("messages must be a non-empty array");
  return messages.map((message) => {
    const role = ["system", "developer", "assistant", "user"].includes(message?.role) ? message.role : "user";
    const text = textFromContent(message?.content);
    return `<${role}>\n${text}\n</${role}>`;
  }).join("\n");
}

function openAIError(res, status, message, type = "invalid_request_error") {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: { message, type } }));
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJSON(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (_error) { reject(new Error("request body must be valid JSON")); }
    });
  });
}

function enforceTimeout(task, timeoutMs, onTimeout) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      try { onTimeout(); } finally { reject(new Error("Codex translation timed out")); }
    }, timeoutMs);
    task.then(
      (value) => { clearTimeout(timer); resolvePromise(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

class CodexAppServer {
  constructor(options) {
    this.options = options;
    this.child = null;
    this.nextID = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.stderr = "";
  }

  async start() {
    if (this.child) return;
    const configuredHome = this.options.codexHome || resolve(process.env.USERPROFILE || process.env.HOME || ".", ".codex");
    const env = { ...process.env, CODEX_HOME: configuredHome };
    this.child = spawn(this.options.codex, ["app-server"], { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true });
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("exit", (code, signal) => this.rejectAll(new Error(`Codex App Server stopped (${code ?? "unknown"}, ${signal || "no signal"}): ${this.stderr.slice(-500)}`)));
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    let buffer = "";
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) this.acceptLine(line);
      }
    });
    this.child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-2000); });
    await this.request("initialize", {
      clientInfo: { name: "codex-openai-bridge", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    }, 20000);
    this.notify("initialized", {});
  }

  acceptLine(line) {
    let message;
    try { message = JSON.parse(line); } catch (_error) { return; }
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params, timeoutMs) {
    return new Promise((resolvePromise, reject) => {
      const id = this.nextID++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.child = null;
  }

  async translate({ prompt, model }) {
    await this.start();
    const thread = await this.request("thread/start", {
      ephemeral: true,
      serviceName: "codex_openai_bridge",
      sandbox: "read-only",
      developerInstructions: "You are a translation backend. Preserve any formula, XML/HTML tag, placeholder, citation, and rich-text marker exactly unless the request explicitly says otherwise. Return only the requested completion. Never use tools.",
      model,
    }, 20000);
    const threadId = thread?.thread?.id || thread?.id;
    if (!threadId) throw new Error("Codex App Server did not return a thread id");
    const turn = await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      model,
      ...(this.options.reasoning ? { effort: this.options.reasoning, summary: "detailed" } : {}),
    }, 20000);
    const turnId = turn?.turn?.id || turn?.id;
    if (!turnId) throw new Error("Codex App Server did not return a turn id");
    return new Promise((resolvePromise, reject) => {
      let result = "";
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); offText(); offDone();
        void this.request("thread/archive", { threadId }, 5000).catch(() => {});
        if (error) reject(error); else resolvePromise(result.trim());
      };
      const timer = setTimeout(() => finish(new Error("Codex translation timed out")), this.options.timeoutMs);
      const offText = this.on("item/agentMessage/delta", (event) => {
        if ((event.turnId || event.turn?.id) === turnId) result += event.delta || event.text || "";
      });
      const offDone = this.on("turn/completed", (event) => {
        if ((event.turnId || event.turn?.id) !== turnId) return;
        const status = event.status || event.turn?.status;
        finish(status === "completed" && result.trim() ? null : new Error(`Codex turn ended with status ${status || "unknown"}`));
      });
    });
  }

  stop() { this.child?.kill(); }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (!options.token) options.token = randomBytes(32).toString("base64url");
  const appServer = new CodexAppServer(options);
  let queue = Promise.resolve();
  let queued = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { status: "ok", queued, model: options.model, loopbackOnly: true });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      return json(res, 200, { object: "list", data: [{ id: options.model, object: "model", owned_by: "codex-local" }] });
    }
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") return openAIError(res, 404, "not found");
    if (req.headers.authorization !== `Bearer ${options.token}`) return openAIError(res, 401, "invalid local bridge bearer token", "authentication_error");
    try {
      const body = await readJSON(req);
      if (body.stream) return openAIError(res, 400, "stream=true is not supported by this local bridge");
      const model = options.allowRequestModel && typeof body.model === "string" && body.model.trim() ? body.model.trim() : options.model;
      const prompt = requestText(body.messages);
      queued += 1;
      const run = queue.then(() => enforceTimeout(
        appServer.translate({ prompt, model }),
        options.timeoutMs,
        () => appServer.stop(),
      ));
      queue = run.catch(() => {});
      const completion = await run;
      queued -= 1;
      return json(res, 200, {
        id: `chatcmpl-${randomBytes(12).toString("hex")}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: completion }, finish_reason: "stop" }],
      });
    } catch (error) {
      queued = Math.max(0, queued - 1);
      return openAIError(res, 502, error.message || String(error), "api_error");
    }
  });
  server.listen(options.port, "127.0.0.1", () => {
    console.log(JSON.stringify({
      status: "ready", host: "127.0.0.1", port: options.port, model: options.model,
      token: options.token, health: `http://127.0.0.1:${options.port}/health`,
    }));
  });
  const stop = () => { server.close(); appServer.stop(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}

export { parseArgs, requestText, textFromContent };
