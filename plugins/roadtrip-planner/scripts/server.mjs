#!/usr/bin/env node

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const pagePath = join(pluginRoot, "skills", "roadtrip-planner", "assets", "roadtrip-planner-demo.html");
const locationsPath = join(pluginRoot, "skills", "roadtrip-planner", "assets", "locations.js");
const workspaceRoot = resolve(process.env.ROADTRIP_WORKSPACE || process.cwd());
const outputDir = join(workspaceRoot, "roadtrip-planner-output");
const reportPath = join(outputDir, "generated-roadtrip-plan.html");
const port = Number(process.env.ROADTRIP_PORT ?? 4317);
const host = "127.0.0.1";
const jobs = new Map();
const pending = [];
const waiters = new Set();
let runnerSeenAt = 0;

mkdirSync(outputDir, { recursive: true });

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(value));
}

function contentType(pathname) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  })[extname(pathname).toLowerCase()] || "application/octet-stream";
}

function serveFile(res, pathname, noStore = false) {
  try {
    const stat = statSync(pathname);
    if (!stat.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "content-type": contentType(pathname),
      "content-length": stat.size,
      "cache-control": noStore ? "no-store" : "public, max-age=60"
    });
    res.end(readFileSync(pathname));
  } catch {
    sendJson(res, 404, { ok: false, error: "文件不存在" });
  }
}

async function readJsonBody(req) {
  if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new Error("只接受 JSON 请求");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function runnerConnected() {
  return Date.now() - runnerSeenAt < 45_000;
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === "completed" ? { result: job.result } : {}),
    ...(job.status === "failed" ? { error: job.error } : {})
  };
}

function nextJob() {
  const job = pending.shift();
  if (!job) return null;
  job.status = job.type === "stop" ? "completed" : "running";
  job.message = job.type === "stop"
    ? "规划会话已结束。"
    : "当前 Codex 会话已接手；请在 Codex 对话中查看过程。";
  job.updatedAt = new Date().toISOString();
  console.log(`[${job.updatedAt}] ${job.type} ${job.id} ${job.status}`);
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    workspaceRoot,
    outputDir,
    reportPath
  };
}

function enqueue(type, state = null) {
  if ([...jobs.values()].some(job => job.status === "queued" || job.status === "running")) {
    throw new Error("已有任务正在等待或执行，请先完成它。");
  }
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(), type, state, status: "queued",
    message: "已提交，等待当前 Codex 会话领取。",
    createdAt: now, updatedAt: now, result: null, error: null,
    reportBaseline: existsSync(reportPath) ? statSync(reportPath).mtimeMs : -1
  };
  jobs.set(job.id, job);
  pending.push(job);
  for (const wake of waiters) wake();
  return job;
}

function validateResult(job, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("任务结果必须是 JSON 对象");
  }
  if (job.type === "candidates") {
    if (!Array.isArray(result.candidates) || result.candidates.length < 3 || result.candidates.length > 8) {
      throw new Error("候选结果必须包含 3—8 个地点");
    }
    for (const candidate of result.candidates) {
      if (!["id", "name", "segment", "after", "pet", "ev", "reason", "highlight"].every(key => typeof candidate[key] === "string") ||
          !["order", "detour", "drive", "stay", "lon", "lat"].every(key => Number.isFinite(candidate[key])) ||
          !Array.isArray(candidate.tags)) {
        throw new Error("候选地点缺少页面所需字段");
      }
    }
    return result;
  }
  if (job.type === "plan") {
    if (result.status !== "completed" || result.reportPath !== reportPath || !existsSync(reportPath) ||
        statSync(reportPath).mtimeMs <= job.reportBaseline || statSync(reportPath).size < 1000) {
      throw new Error("最终路书尚未写入指定 HTML 文件");
    }
    return { ...result, reportUrl: "/generated-plan" };
  }
  throw new Error("无法完成该任务");
}

const server = createServer(async (req, res) => {
  const address = server.address();
  const actualPort = typeof address === "object" ? address.port : port;
  const url = new URL(req.url || "/", `http://${host}:${actualPort}`);
  if (req.headers.origin && req.headers.origin !== `http://${host}:${actualPort}`) {
    sendJson(res, 403, { ok: false, error: "只接受本地页面的请求" });
    return;
  }

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/app")) {
      serveFile(res, pagePath, true);
      return;
    }
    if (req.method === "GET" && url.pathname === "/locations.js") {
      serveFile(res, locationsPath);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, {
        ok: true,
        mode: "current-codex-thread",
        runnerConnected: runnerConnected(),
        workspaceRoot,
        reportReady: existsSync(reportPath)
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/generated-plan") {
      serveFile(res, reportPath, true);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const id = url.pathname.slice("/api/jobs/".length);
      const job = jobs.get(id);
      sendJson(res, job ? 200 : 404, job ? { ok: true, job: publicJob(job) } : { ok: false, error: "任务不存在" });
      return;
    }
    if (req.method === "POST" && ["/api/codex/candidates", "/api/codex/plan"].includes(url.pathname)) {
      if (!runnerConnected()) {
        sendJson(res, 503, { ok: false, error: "当前 Codex 会话尚未进入等待状态，请回到 Codex 对话。" });
        return;
      }
      const state = await readJsonBody(req);
      if (!state?.route || !state?.answers) throw new Error("页面条件不完整");
      const type = url.pathname.endsWith("candidates") ? "candidates" : "plan";
      const job = enqueue(type, state);
      sendJson(res, 202, { ok: true, job: publicJob(job) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/bridge/stop") {
      const job = enqueue("stop");
      sendJson(res, 202, { ok: true, job: publicJob(job) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/bridge/next") {
      runnerSeenAt = Date.now();
      const ready = nextJob();
      if (ready) {
        sendJson(res, 200, { ok: true, job: ready });
        return;
      }
      const timeoutMs = Math.min(25_000, Math.max(1_000, Number(url.searchParams.get("timeout")) || 25_000));
      let timer;
      const wake = () => {
        const job = nextJob();
        if (!job) return;
        clearTimeout(timer);
        waiters.delete(wake);
        sendJson(res, 200, { ok: true, job });
      };
      waiters.add(wake);
      timer = setTimeout(() => {
        waiters.delete(wake);
        if (!res.writableEnded) sendJson(res, 200, { ok: true, job: null });
      }, timeoutMs);
      res.on("close", () => {
        clearTimeout(timer);
        waiters.delete(wake);
      });
      return;
    }
    const match = url.pathname.match(/^\/api\/bridge\/jobs\/([0-9a-f-]+)\/(progress|complete|fail)$/);
    if (req.method === "POST" && match) {
      const job = jobs.get(match[1]);
      if (!job || job.status !== "running") {
        sendJson(res, 409, { ok: false, error: "任务不存在或已结束" });
        return;
      }
      const body = await readJsonBody(req);
      runnerSeenAt = Date.now();
      if (match[2] === "progress") {
        job.message = String(body.message || "Codex 正在处理…").slice(0, 240);
      } else if (match[2] === "complete") {
        job.result = validateResult(job, body.result);
        job.status = "completed";
        job.message = job.type === "plan" ? "完整路书已生成。" : "沿途候选已生成。";
      } else {
        job.status = "failed";
        job.error = String(body.error || "Codex 未能完成任务").slice(0, 1000);
        job.message = "本次任务失败。";
      }
      job.updatedAt = new Date().toISOString();
      console.log(`[${job.updatedAt}] ${job.type} ${job.id} ${job.status}: ${job.message}`);
      sendJson(res, 200, { ok: true, job: publicJob(job) });
      return;
    }
    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    const status = error.message === "已有任务正在等待或执行，请先完成它。" ? 409 : 400;
    sendJson(res, status, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(`Roadtrip Planner: http://${host}:${address.port}`);
  console.log("Mode: current Codex conversation; waiting for the runner to connect");
  console.log(`Workspace: ${workspaceRoot}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
