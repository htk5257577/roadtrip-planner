#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const baseUrl = process.env.ROADTRIP_BASE_URL || `http://127.0.0.1:${process.env.ROADTRIP_PORT || 4317}`;
const sessionId = process.env.CODEX_THREAD_ID || process.env.ROADTRIP_SESSION_ID;
const [command, jobId, value] = process.argv.slice(2);

async function request(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(sessionId ? { "x-roadtrip-session": sessionId } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

try {
  if (command !== "status" && !sessionId) throw new Error("缺少 CODEX_THREAD_ID；请设置 ROADTRIP_SESSION_ID 为当前会话的固定 ID，不要使用随机 ID。");
  if (command === "connect" || command === "disconnect") {
    console.log(JSON.stringify(await request(`/api/bridge/${command}`, {})));
  } else if (command === "wait") {
    const data = await request("/api/bridge/next?timeout=25000");
    console.log(JSON.stringify(data.job));
  } else if (command === "status") {
    console.log(JSON.stringify(await request("/api/status")));
  } else if (command === "progress" && jobId && value) {
    const data = await request(`/api/bridge/jobs/${encodeURIComponent(jobId)}/progress`, { message: value });
    console.log(JSON.stringify({ id: data.job.id, status: data.job.status, message: data.job.message }));
  } else if (command === "complete" && jobId && value) {
    const result = JSON.parse(await readFile(value, "utf8"));
    const data = await request(`/api/bridge/jobs/${encodeURIComponent(jobId)}/complete`, { result });
    console.log(JSON.stringify({ id: data.job.id, status: data.job.status, message: data.job.message }));
  } else if (command === "fail" && jobId && value) {
    const data = await request(`/api/bridge/jobs/${encodeURIComponent(jobId)}/fail`, { error: value });
    console.log(JSON.stringify({ id: data.job.id, status: data.job.status, message: data.job.message }));
  } else {
    throw new Error("用法：bridge-client.mjs connect | disconnect | wait | status | progress <job-id> <说明> | complete <job-id> <结果 JSON 路径> | fail <job-id> <原因>");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
