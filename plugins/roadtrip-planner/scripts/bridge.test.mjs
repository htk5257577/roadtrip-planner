import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { renderRoadbook } from "./render-report.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(scriptDir, "server.mjs");
const bridgePath = join(scriptDir, "bridge-client.mjs");
const exampleDataPath = join(scriptDir, "fixtures/report-data.json");
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
    env: { ...process.env, ROADTRIP_WORKSPACE: workspace, ROADTRIP_PORT: "0", ROADTRIP_CONFIG_DIR: join(workspace, "private-config"), ROADTRIP_FLYAI_CONFIG_PATH: join(workspace, "flyai-config.json"), AMAP_MAPS_API_KEY: "", AMAP_JS_API_KEY: "", AMAP_SECURITY_JS_CODE: "", FLYAI_API_KEY: "", ...extraEnv },
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

test("selected cities and counties receive coordinates and actual AMap road geometry", async () => {
  const mock = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/v3/geocode/geo") {
      const isCounty = url.searchParams.get("address")?.includes("赤壁市");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "1", geocodes: [{ adcode: isCounty ? "421281" : "330100", location: isCounty ? "113.900385,29.725122" : "120.209903,30.246566" }] }));
      return;
    }
    if (url.pathname === "/v5/direction/driving") {
      assert.equal(url.searchParams.get("show_fields"), "cost,polyline");
      assert.equal(url.searchParams.get("key"), "test-key");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(url.searchParams.get("origin")?.startsWith("113.")
        ? { status: "1", route: { paths: [] } }
        : { status: "1", route: { paths: [{ distance: "1200000", cost: { duration: "48000" }, steps: [{ polyline: "120.209903,30.246566;119.5,30.0;113.900385,29.725122" }] }] } }));
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
    assert.equal(preview.data.legs[0].km, 1200);
    assert.ok(Math.abs(preview.data.legs[0].hours - 13.3333) < 0.001);
    assert.equal(preview.data.legs[0].source, "amap");
    assert.equal(preview.data.legs[0].path.length, 3);
    const unresolved = await json(running.base, "/api/map/preview", { places: [...places].reverse() });
    assert.equal(unresolved.data.legs[0].km, null);
    assert.equal(unresolved.data.legs[0].source, "unverified");
    assert.notEqual(preview.data.points[0].lon, preview.data.points[1].lon);
    assert.notEqual(preview.data.points[0].lat, preview.data.points[1].lat);
    assert.equal(preview.data.imageUrl, undefined);
  } finally {
    child?.kill("SIGTERM");
    mock.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("first-run credentials persist locally without appearing in setup responses", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "roadtrip-setup-test-"));
  let child;
  try {
    let running = await startServer(workspace);
    child = running.child;
    const initial = await json(running.base, "/api/setup/status");
    assert.equal(initial.data.amap.configured, false);
    assert.equal(initial.data.flyai.configured, false);
    const saved = await json(running.base, "/api/setup/credentials", { amapKey: "local-test-amap", amapJsKey: "local-test-js", amapSecurityJsCode: "local-test-security", flyaiKey: "local-test-flyai" });
    assert.equal(saved.data.amap.configured, true);
    assert.equal(saved.data.amapJs.configured, true);
    assert.equal(saved.data.flyai.configured, true);
    assert.equal(saved.data.flyai.available, saved.data.flyai.installed);
    assert.doesNotMatch(JSON.stringify(saved.data), /local-test-amap|local-test-js|local-test-security|local-test-flyai/);
    assert.deepEqual((await json(running.base, "/api/map/js-config")).data, { ok: true, key: "local-test-js", securityJsCode: "local-test-security" });
    const file = join(workspace, "private-config", "credentials.json");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
    running = await startServer(workspace);
    child = running.child;
    const restored = await json(running.base, "/api/setup/status");
    assert.equal(restored.data.amap.configured, true);
    assert.equal(restored.data.amapJs.configured, true);
    assert.equal(restored.data.flyai.configured, true);
    const cleared = await json(running.base, "/api/setup/credentials", { amapKey: null, amapJsKey: null, amapSecurityJsCode: null, flyaiKey: null });
    assert.equal(cleared.data.amap.configured, false);
    assert.equal(cleared.data.amapJs.configured, false);
    assert.equal(cleared.data.flyai.configured, false);
  } finally {
    child?.kill("SIGTERM");
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
    const setup = await json(base, "/api/setup/status");
    assert.equal(setup.data.amap.configured, false);
    assert.equal(setup.data.flyai.configured, false);
    const locationsResponse = await fetch(new URL("/locations.js", base));
    assert.equal(locationsResponse.status, 200);
    const locationsScript = await locationsResponse.text();
    assert.match(locationsScript, /赤壁市/);
    assert.match(locationsScript, /东山县/);

    const state = { route: { start: "杭州", end: "杭州", must: ["恩施"] }, answers: { departDate: "2026-10-01" }, routeOrder:["杭州","恩施","杭州"], mapPlaces:[{name:"杭州",query:"杭州"},{name:"恩施",query:"恩施"},{name:"杭州",query:"杭州"}] };
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
    assert.equal((await json(base, "/api/codex/plan", state)).status, 400);

    await bridge(base, "progress", candidateJob.id, "正在比较绕路成本");
    assert.equal((await json(base, `/api/jobs/${candidateJob.id}`)).data.job.message, "正在比较绕路成本");
    const candidate = {
      id: "sample", name: "样例", segment: "杭州 → 恩施", after: "杭州", order: 1,
      detour: 12, drive: 0.3, stay: 1, tags: ["地方美食", "历史街巷"], pet: "需核验", ev: "有补能",
      reason: "供测试", lon: 110, lat: 30, highlight: "样例体验", verdict: "可选", confidence: "中", overlap: "补充体验",
      references: [{ type:"攻略", platform:"测试来源", title:"不可公开访问", note:"应被自动剔除", url:"https://127.0.0.1/private", evidenceRole:"firstHand", publicAccess:true, checkedAt:"2026-09-23T08:00:00.000Z" }]
    };
    const candidates = { summary: "测试候选", sourceNotes: [], candidates: [1, 2, 3].map((number) => ({ ...candidate, id: `sample-${number}` })) };
    const candidateResultPath = join(workspace, "candidates.json");
    await writeFile(candidateResultPath, JSON.stringify(candidates));
    assert.equal((await bridge(base, "complete", candidateJob.id, candidateResultPath)).status, "completed");
    const completedCandidateJob=(await json(base, `/api/jobs/${candidateJob.id}`)).data.job;
    assert.equal(completedCandidateJob.status, "completed");
    assert.deepEqual(completedCandidateJob.result.candidates[0].references, []);
    assert.equal((await json(base, "/api/codex/candidates", { ...state, instruction: "   " })).status, 400);
    const waitingRevision = bridge(base, "wait");
    await waitForRunner(base);
    const revised = await json(base, "/api/codex/candidates", { ...state, instruction: "多推荐有特色的海滨城市" });
    assert.equal(revised.status, 202);
    const revisionJob = await waitingRevision;
    assert.equal(revisionJob.state.instruction, "多推荐有特色的海滨城市");
    assert.equal((await bridge(base, "complete", revisionJob.id, candidateResultPath)).status, "completed");

    const previewFixture = {
      status:"completed",summary:"路线已核对",routeOrder:state.routeOrder,
      totals:{distanceKm:1100,driveHours:14,chargeHours:2,playHours:25,pressure:"均衡",distanceSource:"测试道路数据"},
      days:[{date:"10/1",title:"沿途体验",route:"杭州 → 恩施",distanceKm:600,driveHours:7,chargeHours:1,playHours:4,activities:"山水",lodging:"恩施城区"}],
      notes:["路段需再核验"],sourceNotes:["测试资料"]
    };
    const previewResultPath=join(workspace,"preview.json");
    await writeFile(previewResultPath,JSON.stringify(previewFixture));
    const decidedState={...state,candidates:candidates.candidates.map(candidate=>({...candidate,status:"selected"}))};
    const waitingPreview = bridge(base,"wait");
    await waitForRunner(base);
    assert.equal((await json(base,"/api/codex/plan",state)).status,400);
    const previewSubmitted = await json(base,"/api/codex/preview",decidedState);
    assert.equal(previewSubmitted.status,202);
    const previewJob = await waitingPreview;
    assert.equal(previewJob.type,"preview");
    assert.deepEqual(previewJob.state.capabilities,{amap:false,amapJs:false,flyai:false});
    assert.equal((await json(base,`/api/bridge/jobs/${previewJob.id}/complete`,{result:{...previewFixture,routeOrder:["杭州","杭州"]}})).status,400);
    assert.equal((await bridge(base,"complete",previewJob.id,previewResultPath)).status,"completed");
    const sanitizedPreview=(await json(base,`/api/jobs/${previewJob.id}`)).data.job.result;
    assert.equal(sanitizedPreview.totals.distanceKm,null);
    assert.equal(sanitizedPreview.days[0].driveHours,null);
    const reviewedState={...decidedState,review:{preview:sanitizedPreview,mock:false}};

    const waitingPlan = bridge(base, "wait");
    await waitForRunner(base);
    const planSubmitted = await json(base, "/api/codex/plan", reviewedState);
    const planJob = await waitingPlan;
    assert.equal(planJob.id, planSubmitted.data.job.id);
    const reportData = JSON.parse(await readFile(exampleDataPath, "utf8"));
    reportData.capabilities=planJob.state.capabilities;
    reportData.stopSummaries.forEach(stop=>{stop.guides=[];});
    reportData.days.forEach(day=>day.slots.forEach(slot=>{slot.references=[];delete slot.openingHours;slot.productQueryStatus=slot.productRelevant?"not-configured":"not-applicable";}));
    const result = { status: "completed", title: "测试路书", summary: "已完成", route: "杭州 → 恩施 → 杭州", reportPath: planJob.reportPath, dataPath: planJob.dataPath };
    assert.equal((await json(base, `/api/bridge/jobs/${planJob.id}/complete`, { result })).status, 400);
    await writeFile(planJob.dataPath, JSON.stringify(reportData));
    await writeFile(planJob.reportPath, `<!doctype html><title>看起来相似但不是固定模板</title>${"行程".repeat(600)}`);
    assert.equal((await json(base, `/api/bridge/jobs/${planJob.id}/complete`, { result })).status, 400);
    await writeFile(planJob.dataPath, JSON.stringify({ ...reportData, sample: true }));
    await writeFile(planJob.reportPath, renderRoadbook({ ...reportData, sample: true }));
    assert.equal((await json(base, `/api/bridge/jobs/${planJob.id}/complete`, { result })).status, 400);
    await writeFile(planJob.dataPath, JSON.stringify(reportData));
    await writeFile(planJob.reportPath, renderRoadbook(reportData));
    const planResultPath = join(workspace, "plan-result.json");
    await writeFile(planResultPath, JSON.stringify(result));
    assert.equal((await bridge(base, "complete", planJob.id, planResultPath)).status, "completed");
    assert.match((await json(base, `/api/jobs/${planJob.id}`)).data.job.result.reportUrl, /^\/generated-plan\?v=/);

    const waitingRefine=bridge(base,"wait");
    await waitForRunner(base);
    assert.equal((await json(base,"/api/codex/refine",{...reviewedState,instruction:""})).status,400);
    const refineSubmitted=await json(base,"/api/codex/refine",{...reviewedState,instruction:"让行程更松弛"});
    assert.equal(refineSubmitted.status,202);
    const refineJob=await waitingRefine;
    assert.equal(refineJob.type,"refine");
    assert.ok(refineJob.revisionPath.endsWith(`revision-${refineJob.id}.html`));
    const beforeRefine=await (await fetch(new URL("/generated-plan",base))).text();
    assert.equal((await json(base,`/api/bridge/jobs/${refineJob.id}/complete`,{result:{...result,reportPath:refineJob.reportPath}})).status,400);
    assert.equal(await (await fetch(new URL("/generated-plan",base))).text(),beforeRefine);
    const refinedData={...reportData,title:"微调版",hero:{...reportData.hero,title:"微调版"}};
    await writeFile(refineJob.revisionDataPath,JSON.stringify(refinedData));
    await writeFile(refineJob.revisionPath,renderRoadbook(refinedData));
    const refineResultPath=join(workspace,"refine-result.json");
    await writeFile(refineResultPath,JSON.stringify({...result,summary:"微调完成",reportPath:refineJob.revisionPath,dataPath:refineJob.revisionDataPath}));
    assert.equal((await bridge(base,"complete",refineJob.id,refineResultPath)).status,"completed");
    assert.match(await (await fetch(new URL("/generated-plan",base))).text(),/微调版/);

    const waitingStop = bridge(base, "wait");
    await waitForRunner(base);
    assert.equal((await json(base, "/api/bridge/stop", {})).status, 202);
    assert.equal((await waitingStop).type, "stop");
  } finally {
    child.kill("SIGTERM");
    await rm(workspace, { recursive: true, force: true });
  }
});
