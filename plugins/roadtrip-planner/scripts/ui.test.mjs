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

test("destination tag heading is not itself an experience tag", () => {
  assert.doesNotMatch(page, /<span class="tag">城市标签<\/span>/);
  assert.match(page, /<span class="tag-label">适合体验<\/span>/);
});

test("debug flow can load mock candidates and preview a mock roadbook without a Codex request", () => {
  assert.match(page, /data-action="mock-candidates"/);
  assert.match(page, /data-action="mock-plan"/);
  assert.match(page, /applyCodexCandidates\(mockCandidateResult,'mock'\)/);
  assert.match(page, /function previewMockPlan\(\)\{[\s\S]*?state\.stage=4;/);
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
  vm.runInContext("updateCandidate('mock-quanzhou','selected'); previewMockPlan()", context);
  assert.match(app.innerHTML, /模拟路书 · 未调用 CODEX/);
  assert.match(app.innerHTML, /泉州/);
  assert.match(app.innerHTML, /待核验/);
});
