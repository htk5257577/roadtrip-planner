import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(scriptDir, "server.mjs");
const bridgePath = join(scriptDir, "bridge-client.mjs");
const execFileAsync = promisify(execFile);

async function bridge(base, ...args) {
  const { stdout } = await execFileAsync(process.execPath, [bridgePath, ...args], {
    env: { ...process.env, ROADTRIP_BASE_URL: base }
  });
  return JSON.parse(stdout);
}

async function waitForRunner(base) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await json(base, "/api/status")).data.runnerConnected) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error("bridge runner did not connect");
}

async function json(base, path, body) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

async function startServer(workspace) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ROADTRIP_WORKSPACE: workspace, ROADTRIP_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 5000);
    child.stdout.on("data", chunk => {
      output += chunk;
      const url = output.match(/Roadtrip Planner: (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (url) { clearTimeout(timer); resolve(url); }
    });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  return { child, base };
}

test("page jobs are handled by the waiting conversation bridge", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "roadtrip-bridge-test-"));
  const { child, base } = await startServer(workspace);
  try {
    const initial = await json(base, "/api/status");
    assert.equal(initial.data.mode, "current-codex-thread");
    assert.equal(initial.data.runnerConnected, false);

    const state = { route: { start: "杭州", end: "杭州", must: ["恩施"] }, answers: { departDate: "2026-10-01" } };
    assert.equal((await json(base, "/api/codex/candidates", state)).status, 503);

    const waiting = bridge(base, "wait");
    await waitForRunner(base);
    assert.equal((await json(base, "/api/status")).data.runnerConnected, true);
    const submitted = await json(base, "/api/codex/candidates", state);
    assert.equal(submitted.status, 202);
    const candidateJob = await waiting;
    assert.equal(candidateJob.id, submitted.data.job.id);
    assert.equal(candidateJob.type, "candidates");
    assert.deepEqual(candidateJob.state.route.must, ["恩施"]);
    assert.equal((await json(base, "/api/codex/plan", state)).status, 409);

    await bridge(base, "progress", candidateJob.id, "正在比较绕路成本");
    assert.equal((await json(base, `/api/jobs/${candidateJob.id}`)).data.job.message, "正在比较绕路成本");
    const candidate = {
      id: "sample", name: "样例", segment: "杭州 → 恩施", after: "杭州", order: 1,
      detour: 12, drive: 0.3, stay: 1, tags: ["美食"], pet: "需核验", ev: "有补能",
      reason: "供测试", lon: 110, lat: 30, highlight: "样例体验"
    };
    const candidates = { summary: "测试候选", sourceNotes: [], candidates: [1, 2, 3].map((number) => ({ ...candidate, id: `sample-${number}` })) };
    const candidateResultPath = join(workspace, "candidates.json");
    await writeFile(candidateResultPath, JSON.stringify(candidates));
    assert.equal((await bridge(base, "complete", candidateJob.id, candidateResultPath)).status, "completed");
    assert.equal((await json(base, `/api/jobs/${candidateJob.id}`)).data.job.status, "completed");

    const waitingPlan = bridge(base, "wait");
    await waitForRunner(base);
    const planSubmitted = await json(base, "/api/codex/plan", state);
    const planJob = await waitingPlan;
    assert.equal(planJob.id, planSubmitted.data.job.id);
    const result = { status: "completed", title: "测试路书", summary: "已完成", route: "杭州 → 恩施 → 杭州", reportPath: planJob.reportPath };
    assert.equal((await json(base, `/api/bridge/jobs/${planJob.id}/complete`, { result })).status, 400);
    await writeFile(planJob.reportPath, `<!doctype html><title>测试路书</title>${"行程".repeat(600)}`);
    const planResultPath = join(workspace, "plan-result.json");
    await writeFile(planResultPath, JSON.stringify(result));
    assert.equal((await bridge(base, "complete", planJob.id, planResultPath)).status, "completed");
    assert.equal((await json(base, `/api/jobs/${planJob.id}`)).data.job.result.reportUrl, "/generated-plan");

    const waitingStop = bridge(base, "wait");
    await waitForRunner(base);
    assert.equal((await json(base, "/api/bridge/stop", {})).status, 202);
    assert.equal((await waitingStop).type, "stop");
  } finally {
    child.kill("SIGTERM");
    await rm(workspace, { recursive: true, force: true });
  }
});
