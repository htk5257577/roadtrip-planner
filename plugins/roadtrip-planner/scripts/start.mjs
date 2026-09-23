#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const sessionId = process.env.CODEX_THREAD_ID || process.env.ROADTRIP_SESSION_ID;
const port = Number(process.env.ROADTRIP_PORT || 4317);
const lanRequested = process.env.ROADTRIP_LAN === "1";
const base = `http://127.0.0.1:${port}`;

async function status() {
  let response;
  try {
    response = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(2000) });
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return null;
    throw new Error("无法检查本地服务，请检查连接权限；不会另开端口。", { cause: error });
  }
  let data;
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || data?.mode !== "current-codex-thread") {
    throw new Error("规划端口被其他服务占用；不会另开端口。请先解决端口冲突。");
  }
  if (data.bridgeProtocol !== 2) {
    throw new Error("已有旧版 Roadtrip Planner 服务，无法安全判断会话归属。请在原会话结束服务后重启；不会抢占或另开端口。");
  }
  return data;
}

try {
  if (!sessionId || !sessionId.trim() || sessionId.length > 200) {
    throw new Error("缺少有效的 CODEX_THREAD_ID；请设置 ROADTRIP_SESSION_ID 为当前会话的固定 ID。");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("无效的规划端口。");
  let existing = await status();
  const reused = Boolean(existing);
  if (lanRequested && existing && !existing.lanEnabled) {
    throw new Error("已有服务未开启局域网访问；请先结束现有服务，再以 ROADTRIP_LAN=1 启动。");
  }
  let serverPid;
  if (!existing) {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
      cwd: process.cwd(), env: { ...process.env, ROADTRIP_PORT: String(port), ROADTRIP_INITIAL_SESSION_ID: sessionId },
      detached: true, stdio: "ignore"
    });
    serverPid = child.pid;
    let launchError;
    child.on("error", error => { launchError = error; });
    child.unref();
    for (let attempt = 0; attempt < 50 && !existing; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (launchError) throw launchError;
      existing = await status();
    }
    if (!existing) throw new Error("本地规划服务启动失败；不会另开端口。");
  }
  if (lanRequested && !existing.lanEnabled) throw new Error("局域网服务启动失败，请检查 ROADTRIP_LAN_IP。");
  // The server makes the ownership decision atomically, including simultaneous launches.
  const response = await fetch(`${base}/api/bridge/connect`, {
    method: "POST", headers: { "content-type": "application/json", "x-roadtrip-session": sessionId },
    body: "{}", signal: AbortSignal.timeout(5000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "连接失败");
  console.log(JSON.stringify({ ok: true, reused, ...result, ...(serverPid ? { serverPid } : {}) }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
