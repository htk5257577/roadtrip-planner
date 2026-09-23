#!/usr/bin/env node

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderRoadbook } from "./render-report.mjs";
import { credentialStatus, getAmapJsConfig, getAmapKey, updateCredentials } from "./credentials.mjs";

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
const pendingPlaces = new Map();
const roadCache = new Map();
const pendingRoad = new Map();
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
  if (mapCache.has(cacheKey)) return { ...mapCache.get(cacheKey), name: place.name };
  if (pendingPlaces.has(cacheKey)) return { ...await pendingPlaces.get(cacheKey), name: place.name };
  const request = (async () => {
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
  })();
  pendingPlaces.set(cacheKey, request);
  try { return await request; }
  finally { pendingPlaces.delete(cacheKey); }
}

async function drivingLeg(from, to) {
  const leg = { from: from.name, to: to.name, km: null, hours: null, source: "unverified" };
  if (![from.lon, from.lat, to.lon, to.lat].every(Number.isFinite)) return { ...leg, reason: "地点未定位" };
  const origin = `${from.lon},${from.lat}`;
  const destination = `${to.lon},${to.lat}`;
  const cacheKey = `${origin}>${destination}`;
  const cached = roadCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60_000) return { ...leg, ...cached.value };
  if (pendingRoad.has(cacheKey)) return { ...leg, ...await pendingRoad.get(cacheKey) };
  const request = (async () => {
    try {
      const response = await amapGet("/v5/direction/driving", { origin, destination, show_fields: "cost,polyline" });
      const data = await response.json();
      const path = data.route?.paths?.[0];
      const distance = Number(path?.distance);
      const duration = Number(path?.cost?.duration);
      if (data.status !== "1" || !path || !Number.isFinite(distance) || distance <= 0 ||
          !Number.isFinite(duration) || duration <= 0) throw new Error("未返回有效驾车路线");
      const coordinates = (path.steps || []).flatMap(step => String(step.polyline || "").split(";").map(pair => pair.split(",").map(Number)))
        .filter(pair => pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
      const stride = Math.max(1, Math.ceil(coordinates.length / 1600));
      const roadPath = coordinates.filter((_, index) => index % stride === 0 || index === coordinates.length - 1);
      const value = { km: distance / 1000, hours: duration / 3600, source: "amap", checkedAt: new Date().toISOString(), path: roadPath };
      roadCache.set(cacheKey, { value, at: Date.now() });
      return value;
    } catch {
      return { reason: "高德驾车路线暂不可用" };
    }
  })();
  pendingRoad.set(cacheKey, request);
  try { return { ...leg, ...await request }; }
  finally { pendingRoad.delete(cacheKey); }
}

async function roadVerification(places) {
  const located = await Promise.all(places.map(async place => {
    try { return await locatePlace(place); }
    catch { return { name: place.name, error: "地点未定位" }; }
  }));
  const legs = await Promise.all(located.slice(1).map((to, index) => drivingLeg(located[index], to)));
  const complete = legs.length > 0 && legs.every(leg => leg.source === "amap");
  return {
    source: "高德 Web Service 驾车路线 2.0",
    checkedAt: new Date().toISOString(),
    complete,
    distanceKm: complete ? legs.reduce((sum, leg) => sum + leg.km, 0) : null,
    driveHours: complete ? legs.reduce((sum, leg) => sum + leg.hours, 0) : null,
    points: located,
    legs
  };
}

const canonicalTags = new Set(["地方美食", "历史街巷", "民族文化", "沙滩", "海岛", "海岸线", "山岳", "峡谷", "湖泊", "河流", "草原", "沙漠", "风景公路"]);
const isPublicReference = reference => reference && typeof reference === "object" &&
  ["firstHand", "official"].includes(reference.evidenceRole) && reference.publicAccess === true &&
  /^https:\/\//i.test(reference.url || "") && !/\/login(?:[/?#]|$)|signin|passport/i.test(reference.url) &&
  Number.isFinite(Date.parse(reference.checkedAt));

function verifyRoadbookEvidence(data) {
  const references = [
    ...(data.stopSummaries || []).flatMap(stop => stop.guides || []),
    ...(data.days || []).flatMap(day => (day.slots || []).flatMap(slot => slot.references || []))
  ];
  if (references.some(reference => !isPublicReference(reference))) throw new Error("攻略引用必须是无需登录的公开直达页，并标注证据角色与核验时间");
  const photos = (data.days || []).flatMap(day => day.slots || []).filter(slot => slot.photo);
  if (photos.some(slot => !/^https:\/\//i.test(slot.photo) || !slot.photoCredit || !/^https:\/\//i.test(slot.photoSourceUrl || ""))) throw new Error("每张景点图片必须提供 HTTPS 图片、署名和来源链接");
  if (new Set(photos.map(slot => slot.photo)).size !== photos.length) throw new Error("不同景点不能重复使用同一张图片");
  if ((data.stopSummaries || []).some(stop => !Array.isArray(stop.tags) || stop.tags.length < 2 || stop.tags.some(tag => !canonicalTags.has(tag)))) throw new Error("每个停留城市必须提供至少两个规范目的地标签");
  for (const area of data.hotelAreas || []) {
    if (!["verified", "unavailable", "not-configured"].includes(area.queryStatus)) throw new Error("住宿区缺少飞猪查询状态");
    if (area.queryStatus === "verified" && (!Number.isFinite(Date.parse(area.queriedAt)) || !(area.options || []).length)) throw new Error("飞猪住宿结果缺少查询时间或选项");
    for (const option of area.options || []) if (option.sourceProvider !== "flyai" || !Number.isFinite(Date.parse(option.queriedAt)) || !option.actionLink?.url) throw new Error("住宿选项缺少飞猪来源与查询时间");
  }
  for (const slot of (data.days || []).flatMap(day => day.slots || [])) {
    if (typeof slot.productRelevant !== "boolean" || (slot.productQueryStatus === "not-applicable") !== !slot.productRelevant) throw new Error("景点时间块的飞猪产品适用状态不一致");
    if (!["verified", "unavailable", "not-configured", "not-applicable"].includes(slot.productQueryStatus)) throw new Error("景点时间块缺少飞猪查询状态");
    if (slot.productQueryStatus === "verified" && (slot.productSource?.provider !== "flyai" || !Number.isFinite(Date.parse(slot.productSource.queriedAt)))) throw new Error("景点产品缺少飞猪来源与查询时间");
    if (slot.productQueryStatus !== "verified" && (slot.ticketPrice || slot.actionLink)) throw new Error("未核验的景点产品不能展示票价或预订入口");
    if ((slot.openingHours || slot.petPolicyVerified) && !(slot.references || []).some(reference => reference.evidenceRole === "official")) throw new Error("开放时间或宠物准入等变化信息必须有官方公开来源");
  }
}

function verifyRoadbookRoad(data, expectedRoad) {
  if (!expectedRoad?.complete) return;
  if (JSON.stringify(data.verifiedRoad) !== JSON.stringify(expectedRoad)) throw new Error("最终路书没有原样使用本次高德核验道路数据");
  const points = expectedRoad.points || [];
  if (!Array.isArray(data.mapStops) || data.mapStops.length !== points.length || data.mapStops.some((stop, index) =>
    stop.name !== points[index].name || Math.abs(stop.lng - points[index].lon) > 1e-6 || Math.abs(stop.lat - points[index].lat) > 1e-6)) {
    throw new Error("最终路书地图落点与本次高德核验点位不一致");
  }
  const reportLegs = data.routeLegs || [];
  if (reportLegs.length !== expectedRoad.legs.length || reportLegs.some((leg, index) => {
    const expected = expectedRoad.legs[index];
    return leg.from !== expected.from || leg.to !== expected.to || leg.source !== "amap" || Math.abs(leg.distanceKm - expected.km) > .05 || Math.abs(leg.driveHours - expected.hours) > .01;
  })) throw new Error("最终路书逐段道路账本与高德核验结果不一致");
  const dailyRoadKm = (data.days || []).reduce((sum, day) => sum + Number(day.drive?.distanceKm || 0), 0);
  const dailyRoadHours = (data.days || []).reduce((sum, day) => sum + Number(day.drive?.roadHours || 0), 0);
  if (Math.abs(dailyRoadKm - expectedRoad.distanceKm) > 1 || Math.abs(dailyRoadHours - expectedRoad.driveHours) > .2) throw new Error("最终路书每天的道路数据与高德核验总量不一致");
  for (const day of data.days || []) {
    const legs = reportLegs.filter(leg => leg.date === day.date);
    const km = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
    const hours = legs.reduce((sum, leg) => sum + leg.driveHours, 0);
    if (Math.abs(Number(day.drive.distanceKm || 0) - km) > 1 || Math.abs(Number(day.drive.roadHours || 0) - hours) > .2) throw new Error(`${day.date} 的道路数据没有对应到当天高德路段`);
  }
  const plannedDrive = (data.dayBalance || []).reduce((sum, day) => sum + Number(day.drive || 0), 0);
  if (plannedDrive + .2 < expectedRoad.driveHours || plannedDrive > expectedRoad.driveHours + Math.max(4, expectedRoad.driveHours * .2)) throw new Error("最终路书逐日驾驶时长与高德核验总时长不一致");
}

async function filterPublicReferences(references) {
  const available = [];
  for (let offset = 0; offset < references.length; offset += 4) {
    const batch = references.slice(offset, offset + 4);
    available.push(...await Promise.all(batch.map(async reference => {
    try {
      let current = new URL(reference.url);
      let response;
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (current.protocol !== "https:" || current.port && current.port !== "443") throw new Error("仅允许标准 HTTPS 公网页面");
        const addresses = await lookup(current.hostname, { all: true, verbatim: true });
        if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("拒绝访问本机或私有网络");
        response = await requestPinnedPage(current, addresses[0]);
        if (![301,302,303,307,308].includes(response.status)) break;
        const location = response.headers.location;
        if (!location || redirects === 3) throw new Error("重定向过多");
        current = new URL(location, current);
      }
      if (!response?.ok || /\/login(?:[/?#]|$)|signin|passport/i.test(current.pathname)) throw new Error("登录墙或无法访问");
      const type = response.headers["content-type"] || "";
      if (/text\/html/i.test(type)) {
        if (/登录后(?:查看|继续)|请先登录|扫码登录|sign in to continue/i.test(response.body)) throw new Error("页面要求登录");
      }
      return true;
    } catch {
      return false;
    }
    })));
  }
  return references.filter((_, index) => available[index]);
}

function requestPinnedPage(url, address) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline;
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      handler(value);
    };
    const request = httpsRequest(url, {
      method: "GET",
      headers: { "user-agent": "RoadtripPlanner/0.1 public-source-check", accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family)
    }, response => {
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > 1_000_000) {
        response.resume();
        settle(reject, new Error("页面过大"));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        const remaining = 120_000 - size;
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        size += chunk.length;
        if (size > 120_000) {
          response.destroy();
          settle(resolve, { status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") });
        }
      });
      response.on("end", () => settle(resolve, { status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", error => settle(reject, error));
    });
    deadline = setTimeout(() => request.destroy(new Error("公开页面核验超时")), 8_000);
    request.on("error", error => settle(reject, error));
    request.end();
  });
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(normalized) === 4) {
    const [a,b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 0 || b === 168) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0;
  }
  return normalized === "::" || normalized === "::1" || /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || /^ff/.test(normalized) || /^2001:db8/.test(normalized);
}

async function mapPreview(places) {
  if (!getAmapKey()) throw new Error("未配置高德 Web 服务 Key，地点定位与精确道路信息暂不展示");
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
  const legs = await Promise.all(located.slice(1).map((to, index) => drivingLeg(located[index], to)));
  return { points: located, legs };
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

async function validateResult(job, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("任务结果必须是 JSON 对象");
  }
  if (job.type === "candidates") {
    if (!Array.isArray(result.candidates) || result.candidates.length < 3 || result.candidates.length > 8) {
      throw new Error("候选结果必须包含 3—8 个地点");
    }
    for (const candidate of result.candidates) {
      if (!["id", "name", "segment", "after", "pet", "ev", "reason", "highlight", "overlap"].every(key => typeof candidate[key] === "string") ||
          !["order", "stay"].every(key => Number.isFinite(candidate[key])) ||
          !["detour", "drive", "lon", "lat"].every(key => candidate[key] === null || Number.isFinite(candidate[key])) ||
          !Array.isArray(candidate.tags) || candidate.tags.length < 2 || candidate.tags.some(tag => !canonicalTags.has(tag)) ||
          !["推荐", "可选", "谨慎"].includes(candidate.verdict) || !["高", "中", "低"].includes(candidate.confidence) ||
          !Array.isArray(candidate.references) || candidate.references.length > 3 || candidate.references.some(reference => !isPublicReference(reference))) {
        throw new Error("候选地点缺少页面所需字段");
      }
    }
    for (const candidate of result.candidates) candidate.references = await filterPublicReferences(candidate.references);
    return result;
  }
  if (job.type === "preview") {
    const roads = job.state.roadVerification;
    if (!roads?.complete) {
      result.totals = { ...result.totals, distanceKm: null, driveHours: null, chargeHours: null, pressure: "待核验", distanceSource: job.state.capabilities?.amap ? "部分路段未核验" : "未接入高德" };
      result.days = result.days?.map(day => ({ ...day, distanceKm: null, driveHours: null, chargeHours: null }));
      result.sourceNotes = [...(result.sourceNotes || []), "道路数据未全部核验，精确里程与驾驶时长不展示"];
    } else {
      result.totals = { ...result.totals, distanceKm: roads.distanceKm, driveHours: roads.driveHours, distanceSource: `${roads.source} · ${roads.checkedAt.slice(0, 10)}` };
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
    if (roads?.complete) {
      const dayDistance = result.days.reduce((sum, day) => sum + day.distanceKm, 0);
      const dayDriving = result.days.reduce((sum, day) => sum + day.driveHours, 0);
      if (Math.abs(dayDistance - roads.distanceKm) > 1 || Math.abs(dayDriving - roads.driveHours) > .2) throw new Error("逐日里程或驾驶时长与高德全程核验结果不一致");
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
    if (data.capabilities?.amap !== job.state.capabilities?.amap || data.capabilities?.amapJs !== job.state.capabilities?.amapJs ||
        data.capabilities?.flyai !== job.state.capabilities?.flyai) {
      throw new Error("路书的数据来源状态与当前配置不一致");
    }
    if (readFileSync(destination, "utf8") !== renderRoadbook(data)) {
      throw new Error("路书不是由南线固定模板渲染，请使用 render-report.mjs 生成");
    }
    verifyRoadbookRoad(data, job.state.roadVerification);
    for (const stop of data.stopSummaries || []) stop.guides = await filterPublicReferences(stop.guides || []);
    for (const day of data.days || []) for (const slot of day.slots || []) slot.references = await filterPublicReferences(slot.references || []);
    verifyRoadbookEvidence(data);
    writeFileSync(dataDestination, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    writeFileSync(destination, renderRoadbook(data), "utf8");
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
    if (req.method === "GET" && url.pathname === "/api/map/js-config") {
      const config = getAmapJsConfig();
      sendJson(res, config.key && config.securityJsCode ? 200 : 409,
        config.key && config.securityJsCode ? { ok: true, ...config } : { ok: false, error: "未配置高德 Web 端 Key 和安全密钥" });
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
      roadCache.clear();
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
      state.capabilities = { amap: setup.amap.configured, amapJs: setup.amapJs.configured, flyai: setup.flyai.available };
      const type = url.pathname.split("/").at(-1);
      if (type === "preview" || type === "plan" || type === "refine") {
        if (!Array.isArray(state.candidates) || state.candidates.some(candidate => !["selected", "excluded"].includes(candidate.status))) {
          throw new Error("请先对每个沿途候选明确选择加入或排除");
        }
        const places = state.mapPlaces;
        if (!Array.isArray(places) || !Array.isArray(state.routeOrder) ||
            places.length !== state.routeOrder.length || places.length > 25 ||
            places.some((place, index) => place?.name !== state.routeOrder[index] ||
              typeof place.query !== "string" || place.query.length > 160 ||
              place.code !== undefined && !/^\d{6}$/.test(place.code))) {
          throw new Error("当前路线地点与已选顺序不一致");
        }
        state.roadVerification = setup.amap.configured
          ? await roadVerification(places)
          : { complete: false, distanceKm: null, driveHours: null, points: [], legs: [] };
      }
      if (type === "candidates" && state.instruction !== undefined &&
          (typeof state.instruction !== "string" || !state.instruction.trim() || state.instruction.length > 2000)) {
        throw new Error("请填写不超过 2000 字的候选调整要求");
      }
      if ((type === "plan" || type === "refine") &&
          (state.review?.preview?.status !== "completed" ||
           JSON.stringify(state.review.preview.routeOrder) !== JSON.stringify(state.routeOrder))) throw new Error("请先让 Codex 生成并确认当前路线的预览");
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
        job.result = await validateResult(job, body.result);
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
