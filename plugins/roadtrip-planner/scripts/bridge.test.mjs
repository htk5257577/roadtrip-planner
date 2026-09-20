import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
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

async function startServer(workspace, extraEnv = {}) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ROADTRIP_WORKSPACE: workspace, ROADTRIP_PORT: "0", ...extraEnv },
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

test("selected cities and counties receive distinct positions on an AMap image", async () => {
  const mock = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/v3/geocode/geo") {
      const isCounty = url.searchParams.get("address")?.includes("赤壁市");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "1", geocodes: [{ adcode: isCounty ? "421281" : "330100", location: isCounty ? "113.900385,29.725122" : "120.209903,30.246566" }] }));
      return;
    }
    if (url.pathname === "/v3/staticmap") {
      assert.equal(url.searchParams.get("size"), "760*600");
      // AMap static images use 512px world tiles: zoom 6 is the viewport that
      // contains both fixture cities while matching the overlay's pixel scale.
      assert.equal(url.searchParams.get("zoom"), "6");
      assert.equal(url.searchParams.get("key"), "test-key");
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from("89504e470d0a1a0a", "hex"));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
  const workspace = await mkdtemp(join(tmpdir(), "roadtrip-map-test-"));
  let child;
  try {
    const running = await startServer(workspace, {
      AMAP_MAPS_API_KEY: "test-key",
      ROADTRIP_AMAP_BASE_URL: `http://127.0.0.1:${mock.address().port}`
    });
    child = running.child;
    const places = [
      { name: "杭州市 · 浙江省", code: "330100", query: "浙江省 杭州市" },
      { name: "赤壁市 · 咸宁市 · 湖北省", code: "421281", query: "湖北省 咸宁市 赤壁市" }
    ];
    const preview = await json(running.base, "/api/map/preview", { places });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.points.length, 2);
    assert.equal(preview.data.points[0].verified, true);
    assert.equal(preview.data.points[1].verified, true);
    assert.notEqual(preview.data.points[0].x, preview.data.points[1].x);
    assert.notEqual(preview.data.points[0].y, preview.data.points[1].y);
    assert.ok(preview.data.points.every(point => point.x > 0 && point.x < 760 && point.y > 0 && point.y < 600));
    const image = await fetch(new URL(preview.data.imageUrl, running.base));
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /image\/png/);
  } finally {
    child?.kill("SIGTERM");
    mock.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("page jobs are handled by the waiting conversation bridge", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "roadtrip-bridge-test-"));
  const { child, base } = await startServer(workspace);
  try {
    const initial = await json(base, "/api/status");
    assert.equal(initial.data.mode, "current-codex-thread");
    assert.equal(initial.data.runnerConnected, false);
    const locationsResponse = await fetch(new URL("/locations.js", base));
    assert.equal(locationsResponse.status, 200);
    const locationsScript = await locationsResponse.text();
    assert.match(locationsScript, /赤壁市/);
    assert.match(locationsScript, /东山县/);

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
