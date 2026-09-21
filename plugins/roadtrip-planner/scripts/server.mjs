#!/usr/bin/env node

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderRoadbook } from "./render-report.mjs";
import { credentialStatus, getAmapKey, updateCredentials } from "./credentials.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const pagePath = join(pluginRoot, "skills", "roadtrip-planner", "assets", "roadtrip-planner-demo.html");
const locationsPath = join(pluginRoot, "skills", "roadtrip-planner", "assets", "locations.js");
const workspaceRoot = resolve(process.env.ROADTRIP_WORKSPACE || process.cwd());
const outputDir = join(workspaceRoot, "roadtrip-planner-output");
const reportPath = join(outputDir, "generated-roadtrip-plan.html");
const reportDataPath = join(outputDir, "report-data.json");
const port = Number(process.env.ROADTRIP_PORT ?? 4317);
const host = "127.0.0.1";
const amapBaseUrl = process.env.ROADTRIP_AMAP_BASE_URL || "https://restapi.amap.com";
const mapCache = new Map();
const mapImages = new Map();
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

async function amapGet(path, parameters) {
  const url = new URL(path, amapBaseUrl);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  url.searchParams.set("key", getAmapKey());
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`高德地图暂时不可用（${response.status}）`);
  return response;
}

async function locatePlace(place) {
  const cacheKey = `${place.code || ""}|${place.query}`;
  if (mapCache.has(cacheKey)) return mapCache.get(cacheKey);
  const response = await amapGet("/v3/geocode/geo", { address: place.query, output: "JSON" });
  const data = await response.json();
  if (data.status !== "1") throw new Error(`高德定位失败：${data.info || "未知错误"}`);
  const geocode = data.geocodes?.find(item => !place.code || item.adcode === place.code);
  const [lon, lat] = String(geocode?.location || "").split(",").map(Number);
  const result = Number.isFinite(lon) && Number.isFinite(lat) && lon > 70 && lat > 0
    ? { name: place.name, lon, lat, verified: Boolean(place.code) }
    : { name: place.name, error: place.code ? "行政区划未匹配" : "地点未定位" };
  mapCache.set(cacheKey, result);
  return result;
}

async function mapPreview(places) {
  if (!getAmapKey()) throw new Error("未配置高德 Web 服务 Key，地图与精确道路信息暂不展示");
  if (!Array.isArray(places) || places.length > 25 || places.some(place =>
    typeof place?.name !== "string" || typeof place?.query !== "string" ||
    place.name.length > 80 || place.query.length > 160 ||
    (place.code !== undefined && !/^\d{6}$/.test(place.code)))) {
    throw new Error("地点列表格式不正确，最多支持 25 个地点");
  }
  const located = await Promise.all(places.map(async place => {
    try { return await locatePlace(place); }
    catch { return { name: place.name, error: "定位服务暂时不可用" }; }
  }));
  const points = located.filter(item => Number.isFinite(item.lon));
  if (!points.length) return { points: located, imageUrl: "" };
  const mercator = point => {
    const sine = Math.sin(point.lat * Math.PI / 180);
    return { x: (point.lon + 180) / 360, y: .5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI) };
  };
  const projected = points.map(mercator);
  const xs = projected.map(point => point.x), ys = projected.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  // AMap static maps advance in 512px world tiles per zoom level. Using the
  // usual 256px slippy-map scale puts every overlay point too near the center.
  const span = Math.max((maxX - minX) * 512 / 660, (maxY - minY) * 512 / 500);
  const zoom = points.length === 1 ? 8 : Math.max(3, Math.min(14, Math.floor(Math.log2(1 / Math.max(span, 1e-9)))));
  const centerLon = centerX * 360 - 180;
  const centerLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * centerY))) * 180 / Math.PI;
  const scale = 512 * 2 ** zoom;
  let pointIndex = 0;
  const plotted = located.map(point => {
    if (!Number.isFinite(point.lon)) return point;
    const position = projected[pointIndex++];
    return { ...point, x: Math.round(380 + (position.x - centerX) * scale), y: Math.round(300 + (position.y - centerY) * scale) };
  });
  const parameters = { size: "760*600", scale: "1", location: `${centerLon.toFixed(6)},${centerLat.toFixed(6)}`, zoom };
  const response = await amapGet("/v3/staticmap", parameters);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error("高德没有返回地图图片");
  const imageId = randomUUID();
  mapImages.set(imageId, Buffer.from(await response.arrayBuffer()));
  if (mapImages.size > 80) mapImages.delete(mapImages.keys().next().value);
  return { points: plotted, imageUrl: `/api/map/image/${imageId}` };
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
    reportPath,
    dataPath: reportDataPath,
    ...(job.type === "refine" ? { revisionPath: job.revisionPath, revisionDataPath: job.revisionDataPath } : {})
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
    reportBaseline: existsSync(reportPath) ? statSync(reportPath).mtimeMs : -1,
    dataBaseline: existsSync(reportDataPath) ? statSync(reportDataPath).mtimeMs : -1
  };
  if (type === "refine") {
    job.revisionPath = join(outputDir, `revision-${job.id}.html`);
    job.revisionDataPath = join(outputDir, `revision-${job.id}.json`);
  }
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
  if (job.type === "preview") {
    if (!job.state.capabilities?.amap) {
      result.totals = { ...result.totals, distanceKm: null, driveHours: null, chargeHours: null, pressure: "待核验", distanceSource: "未接入高德" };
      result.days = result.days?.map(day => ({ ...day, distanceKm: null, driveHours: null, chargeHours: null }));
      result.sourceNotes = [...(result.sourceNotes || []), "未接入高德，精确道路信息不展示"];
    }
    const totals = result.totals;
    const expected = job.state.routeOrder;
    const nonnegativeOrUnknown = value => value === null || Number.isFinite(value) && value >= 0;
    if (result.status !== "completed" || typeof result.summary !== "string" ||
        !Array.isArray(result.routeOrder) || !Array.isArray(expected) ||
        JSON.stringify(result.routeOrder) !== JSON.stringify(expected) ||
        !totals || !["distanceKm", "driveHours", "chargeHours", "playHours"].every(key => nonnegativeOrUnknown(totals[key])) ||
        typeof totals.pressure !== "string" || typeof totals.distanceSource !== "string" ||
        !Array.isArray(result.days) || !result.days.length ||
        result.days.some(day => !["date", "title", "route", "activities", "lodging"].every(key => typeof day[key] === "string") ||
          !["distanceKm", "driveHours", "chargeHours", "playHours"].every(key => nonnegativeOrUnknown(day[key]))) ||
        !Array.isArray(result.notes) || !result.notes.every(note => typeof note === "string") ||
        !Array.isArray(result.sourceNotes) || !result.sourceNotes.every(note => typeof note === "string")) {
      throw new Error("预览数据不完整，或路线与已选地点不一致");
    }
    return result;
  }
  if (job.type === "plan" || job.type === "refine") {
    const destination = job.type === "refine" ? job.revisionPath : reportPath;
    const dataDestination = job.type === "refine" ? job.revisionDataPath : reportDataPath;
    if (result.status !== "completed" || result.reportPath !== destination || result.dataPath !== dataDestination ||
        !existsSync(destination) || !existsSync(dataDestination) ||
        (job.type === "plan" && (statSync(destination).mtimeMs <= job.reportBaseline || statSync(dataDestination).mtimeMs <= job.dataBaseline))) {
      throw new Error(job.type === "refine" ? "微调后的数据与路书尚未写入指定文件" : "最终路书数据与 HTML 尚未写入指定文件");
    }
    const data = JSON.parse(readFileSync(dataDestination, "utf8"));
    if (data.sample === true) throw new Error("模拟样板不能作为正式计划提交");
    if (data.capabilities?.amap !== job.state.capabilities?.amap ||
        data.capabilities?.flyai !== job.state.capabilities?.flyai) {
      throw new Error("路书的数据来源状态与当前配置不一致");
    }
    if (readFileSync(destination, "utf8") !== renderRoadbook(data)) {
      throw new Error("路书不是由南线固定模板渲染，请使用 render-report.mjs 生成");
    }
    if (job.type === "refine") {
      renameSync(destination, reportPath);
      renameSync(dataDestination, reportDataPath);
    }
    return { ...result, reportPath, dataPath: reportDataPath, reportUrl: `/generated-plan?v=${job.id}` };
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
    if (req.method === "POST" && url.pathname === "/api/map/preview") {
      const body = await readJsonBody(req);
      const preview = await mapPreview(body.places);
      sendJson(res, 200, { ok: true, ...preview });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/map/image/")) {
      const image = mapImages.get(url.pathname.slice("/api/map/image/".length));
      if (!image) { sendJson(res, 404, { ok: false, error: "地图已过期，请刷新页面" }); return; }
      res.writeHead(200, { "content-type": "image/png", "content-length": image.length, "cache-control": "private, max-age=600" });
      res.end(image);
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
    if (req.method === "GET" && url.pathname === "/api/setup/status") {
      sendJson(res, 200, { ok: true, ...credentialStatus() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/setup/credentials") {
      const status = updateCredentials(await readJsonBody(req));
      mapCache.clear();
      mapImages.clear();
      sendJson(res, 200, { ok: true, ...status });
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
    if (req.method === "POST" && ["/api/codex/candidates", "/api/codex/preview", "/api/codex/plan", "/api/codex/refine"].includes(url.pathname)) {
      if (!runnerConnected()) {
        sendJson(res, 503, { ok: false, error: "当前 Codex 会话尚未进入等待状态，请回到 Codex 对话。" });
        return;
      }
      const state = await readJsonBody(req);
      if (!state?.route || !state?.answers) throw new Error("页面条件不完整");
      const setup = credentialStatus();
      state.capabilities = { amap: setup.amap.configured, flyai: setup.flyai.available };
      const type = url.pathname.split("/").at(-1);
      if (type === "candidates" && state.instruction !== undefined &&
          (typeof state.instruction !== "string" || !state.instruction.trim() || state.instruction.length > 2000)) {
        throw new Error("请填写不超过 2000 字的候选调整要求");
      }
      if ((type === "plan" || type === "refine") &&
          (state.review?.preview?.status !== "completed" ||
           JSON.stringify(state.review.preview.routeOrder) !== JSON.stringify(state.routeOrder) ||
           state.review.mock === true)) throw new Error("请先让 Codex 生成并确认当前路线的预览");
      if (type === "refine" && (!existsSync(reportPath) || !existsSync(reportDataPath) ||
          typeof state.instruction !== "string" || !state.instruction.trim() || state.instruction.length > 2000)) {
        throw new Error("请先生成完整报告，并填写不超过 2000 字的微调要求");
      }
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
        job.message = ({ plan:"完整路书已生成。", preview:"路线预览已生成。", refine:"路书微调已完成。", candidates:"沿途候选已生成。" })[job.type];
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
