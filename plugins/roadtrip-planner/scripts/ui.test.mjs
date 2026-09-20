import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(pluginRoot, "skills/roadtrip-planner/assets/roadtrip-planner-demo.html"), "utf8");

test("candidate navigation stays visible on narrow screens", () => {
  assert.match(page, /data-action="focus-prev"/);
  assert.match(page, /data-action="focus-next"/);
  assert.doesNotMatch(page, /\.focus-arrow\{display:none\}/);
});

test("candidate generation buttons use the plain product label", () => {
  assert.match(page, /state\.stage<3\?'生成沿途候选'/);
  assert.match(page, /'生成沿途候选 →'/);
  assert.doesNotMatch(page, /让 Codex 推荐|让 Codex 生成沿途候选/);
});

test("destination tag heading is not itself an experience tag", () => {
  assert.doesNotMatch(page, /<span class="tag">城市标签<\/span>/);
  assert.match(page, /<span class="tag-label">适合体验<\/span>/);
});

test("debug flow separates mock preview from mock full roadbook without a Codex request", () => {
  assert.match(page, /data-action="mock-candidates"/);
  assert.match(page, /data-action="mock-preview"/);
  assert.match(page, /data-action="mock-final"/);
  assert.match(page, /applyCodexCandidates\(mockCandidateResult,'mock'\)/);
  assert.match(page, /function previewMockPlan\(\)\{[\s\S]*?state\.stage=4;/);
  assert.match(page, /function mockFinalPlan\(\)\{[\s\S]*?state\.stage=5;/);
  assert.match(page, /模拟预览 · 未调用 Codex/);
  assert.match(page, /模拟路书 · 未调用 CODEX/);
  assert.match(page, /模拟绕路数据/);
});

test("mock candidates and final preview render without invoking the backend", () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(script);
  const app = { innerHTML: "", querySelector: () => null };
  const toast = { textContent: "", classList: { add() {}, remove() {} } };
  const context = vm.createContext({
    document: { getElementById: id => id === "app" ? app : id === "toast" ? toast : { scrollIntoView() {} }, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [] },
    location: { protocol: "file:", href: "file:///tmp/roadtrip-planner-demo.html" },
    URL,
    structuredClone,
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: () => { throw new Error("mock flow must not fetch"); },
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  vm.runInContext("loadMockCandidates()", context);
  assert.match(app.innerHTML, /固定模拟数据/);
  assert.match(app.innerHTML, /上一个/);
  assert.match(app.innerHTML, /下一个/);
  assert.doesNotMatch(app.innerHTML, /放入备选|data-status-choice="backup"/);
  vm.runInContext("updateCandidate('mock-quanzhou','excluded')", context);
  assert.equal(vm.runInContext("plannerState().candidates.find(c=>c.id==='mock-quanzhou').status", context), "excluded");
  assert.doesNotMatch(vm.runInContext("plannerState().routeOrder.join(' → ')", context), /泉州/);
  vm.runInContext("updateCandidate('mock-quanzhou','selected'); previewMockPlan()", context);
  assert.equal(vm.runInContext("plannerState().candidates.find(c=>c.id==='mock-quanzhou').status", context), "selected");
  assert.match(app.innerHTML, /模拟预览 · 未调用 Codex/);
  assert.match(app.innerHTML, /泉州/);
  assert.match(app.innerHTML, /待核验/);
  vm.runInContext("mockFinalPlan()", context);
  assert.match(app.innerHTML, /模拟路书 · 未调用 CODEX/);
  assert.equal(vm.runInContext("state.stage", context), 5);
  vm.runInContext("updateCandidate('mock-quanzhou','excluded')", context);
  assert.equal(vm.runInContext("state.ai.preview", context), null);
  assert.equal(vm.runInContext("state.stage", context), 3);
});

test("Codex preview, full report, and text refinement are three separate page jobs", async () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const app = { innerHTML: "", querySelector: () => null };
  const toast = { textContent: "", classList: { add() {}, remove() {} } };
  const calls = [];
  const preview = {
    status: "completed", summary: "路线预览已核验", routeOrder: ["杭州", "东山县", "柳州", "恩施", "赤壁"],
    totals: { distanceKm: 3800, driveHours: 48, chargeHours: 7, playHours: 42, pressure: "偏赶", distanceSource: "道路核验" },
    days: [{ date: "9/24", title: "出发", route: "杭州 → 东山", distanceKm: 700, driveHours: 9, chargeHours: 1, playHours: 2, activities: "海边", lodging: "沿途" }],
    notes: ["注意节假日"], sourceNotes: ["道路数据"]
  };
  const response = data => ({ ok: true, json: async () => data });
  const context = vm.createContext({
    document: { getElementById: id => id === "app" ? app : id === "toast" ? toast : id === "refineText" ? { value: "把恩施留久一点" } : { scrollIntoView() {} }, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [] },
    location: { protocol: "http:", href: "http://127.0.0.1:4317/" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      if (url.startsWith("/api/codex/")) {
        calls.push({ url, state: JSON.parse(options.body) });
        return response({ ok: true, job: { id: String(calls.length) } });
      }
      const id = url.split("/").at(-1);
      return response({ ok: true, job: { status: "completed", result: id === "1" ? preview : { summary: id === "3" ? "微调完成" : "完整计划完成", reportUrl: `/generated-plan?v=${id}` } } });
    }
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  vm.runInContext("state.route=structuredClone(debugExample.route);state.answers={...debugExample.answers};state.prefs={...debugExample.prefs};applyCodexCandidates(mockCandidateResult,'codex');state.ai.backendReady=true;render()", context);
  await vm.runInContext("requestCodexPreview()", context);
  assert.equal(calls[0].url, "/api/codex/preview");
  assert.equal(vm.runInContext("state.stage", context), 4);
  assert.ok(app.innerHTML.includes("路线预览已核验"));
  await vm.runInContext("requestCodexPlan()", context);
  assert.equal(calls[1].url, "/api/codex/plan");
  assert.equal(calls[1].state.review.preview.summary, "路线预览已核验");
  assert.equal(vm.runInContext("state.stage", context), 5);
  assert.ok(app.innerHTML.includes('data-action="refine-open"'));
  await vm.runInContext("requestCodexRefine()", context);
  assert.equal(calls[2].url, "/api/codex/refine");
  assert.equal(calls[2].state.instruction, "把恩施留久一点");
  assert.equal(vm.runInContext("state.ai.reportUrl", context), "/generated-plan?v=3");
});
