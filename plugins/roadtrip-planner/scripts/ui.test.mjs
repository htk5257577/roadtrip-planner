import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(pluginRoot, "skills/roadtrip-planner/assets/roadtrip-planner-demo.html"), "utf8");
const testRoute = { start: "杭州", end: "赤壁", must: ["东山县", "柳州", "恩施"] };
const testAnswers = { departDate: "2026-09-24", returnDate: "2026-10-05", departTime: "19:00", travelers: "2", maxDrive: "6", maxDetour: "2", pace: "balanced", pet: true, petWeightKg: "2", petAgeYears: "1.5", petNotes: "", ev: true, evHighwayRange: "350", exclusions: "", fixedBookings: "", borderDocs: "", lowEffort: false, lowCrowd: false };
const testCandidates = [{ id: "candidate-quanzhou", name: "泉州", segment: "杭州 → 东山", after: "杭州", order: 1, detour: 35, drive: 1.1, stay: 1, tags: ["地方美食", "历史街巷"], pet: "待核验", ev: "待核验", reason: "测试候选", lon: 118.675, lat: 24.874, highlight: "古城", verdict: "推荐", confidence: "中", overlap: "补充人文体验", references: [] }];
function seedTestState(context) {
  vm.runInContext(`state.route=${JSON.stringify(testRoute)};state.answers=${JSON.stringify(testAnswers)};applyCodexCandidates(${JSON.stringify({ summary: "候选", candidates: testCandidates })},'codex');state.ai.backendReady=true;render()`, context);
}

test("daily comfort checks exclude charging and flag overruns without removing choices", () => {
  const source=page.slice(page.indexOf('    function drivingNotices('),page.indexOf('    function previewContent('));
  const context=vm.createContext({state:{answers:{maxDrive:'4'}}});
  vm.runInContext(source,context);
  const check=days=>JSON.parse(vm.runInContext(`JSON.stringify(drivingNotices(${JSON.stringify(days)},${days.length-1}))`,context));
  assert.deepEqual(check([{driveHours:4,chargeHours:2,playHours:4}]),[]);
  assert.match(check([{driveHours:7,chargeHours:1,playHours:3}]).join(''),/超出舒适时长 3.0h/);
  assert.match(check([{driveHours:4,chargeHours:1,playHours:2},{driveHours:4,chargeHours:1,playHours:1}]).join(''),/连续两天/);
  assert.match(check([{driveHours:4,chargeHours:1,playHours:1}]).join(''),/交通挤占游玩/);
  assert.match(check([{driveHours:null,chargeHours:null,playHours:1}]).join(''),/待核验/);
});

test("pet age is unnecessary and selected travel restrictions reach planning requests", () => {
  const app={innerHTML:'',querySelector:()=>null};
  const context=vm.createContext({document:{getElementById:id=>id==='app'?app:{classList:{add(){},remove(){}}},addEventListener(){}},window:{ROADTRIP_LOCATIONS:[]},location:{protocol:'file:',href:'file:///tmp/planner.html'},URL,structuredClone,setTimeout:()=>1,clearTimeout(){}});
  const script=page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/,''),context);
  seedTestState(context);
  vm.runInContext("delete state.answers.petAgeYears;state.answers.avoidWater=true;state.answers.avoidNightDriving=true",context);
  assert.equal(vm.runInContext('planningReady()',context),true);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(plannerState().travelConstraints.map(x=>x.key))',context)),['avoidWater','avoidNightDriving']);
  assert.doesNotMatch(vm.runInContext('questions()',context),/宠物年龄/);
  vm.runInContext('state.answers.avoidWater=false',context);
  assert.equal(vm.runInContext('plannerState().travelConstraints.length',context),1);
});

test("vague wishes stay off the map and only selected experiences become itinerary nodes", () => {
  const app={innerHTML:'',querySelector:()=>null};
  const context=vm.createContext({document:{getElementById:id=>id==='app'?app:{classList:{add(){},remove(){}}},addEventListener(){}},window:{ROADTRIP_LOCATIONS:[]},location:{protocol:'file:',href:'file:///tmp/planner.html'},URL,structuredClone,setTimeout:()=>1,clearTimeout(){}});
  const script=page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/,''),context);
  vm.runInContext(`state.route={start:'杭州',end:'杭州',must:['泉州','可以骑马的地方']}`,context);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(routeNodes().map(n=>n.name))',context)),['杭州','泉州','杭州']);
  const choices=[{...testCandidates[0],id:'temple',name:'泉州开元寺',sourceRequest:'泉州',experienceType:'景点'}, {...testCandidates[0],id:'food',name:'泉州西街小吃',sourceRequest:'泉州',experienceType:'美食'}];
  vm.runInContext(`applyCodexCandidates(${JSON.stringify({candidates:choices})});state.candidateStatus={temple:'selected',food:'selected'}`,context);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(routeNodes().map(n=>n.name))',context)),['杭州','泉州开元寺','泉州西街小吃','杭州']);
  vm.runInContext("state.candidateStatus.temple='excluded'",context);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(routeNodes().map(n=>n.name))',context)),['杭州','泉州西街小吃','杭州']);
  assert.doesNotMatch(vm.runInContext('itineraryReview()',context),/这组不去了/);
  assert.match(vm.runInContext('itineraryReview()',context),/愿望选好了/);
  assert.doesNotMatch(vm.runInContext('candidateCard(candidates[0])',context),/高德道路增量|额外驾驶|绕路上限/);
  assert.match(vm.runInContext('candidateCard(candidates[0])',context),/已移除.*撤销/);
  assert.match(vm.runInContext('candidateCard(candidates[1])',context),/class="wish-remove"/);
  assert.doesNotMatch(vm.runInContext('candidateCard(candidates[1])',context),/✓ 已加入行程|class="score"|candidate-actions|>不去</);
  vm.runInContext("candidates.push({...candidates[0],id:'discovery',sourceRequest:null});state.route.must=['泉州'];state.candidateStatus.food='none'",context);
  assert.equal(vm.runInContext('wishBaselineReady()',context),false);
  assert.match(vm.runInContext("candidateCard(candidates[2])",context),/先确认上方所有愿望/);
  assert.doesNotMatch(vm.runInContext("candidateCard(candidates[2])",context),/额外驾驶/);
  vm.runInContext("state.candidateStatus.food='selected';state.reviewPhase='discoveries'",context);
  assert.equal(vm.runInContext('wishBaselineReady()',context),true);
  assert.match(vm.runInContext("candidateCard(candidates[2])",context),/额外驾驶/);
  assert.doesNotMatch(vm.runInContext('itineraryReview()',context),/data-candidate="temple"/);
  const more={...choices[0],id:'food',name:'追加体验',sourceRequest:null};
  vm.runInContext(`applyCodexCandidates(${JSON.stringify({candidates:[more]})},'codex',true)`,context);
  assert.equal(vm.runInContext("statusOf('food')",context),'selected');
  assert.equal(vm.runInContext("statusOf('food-new')",context),'none');
  assert.equal(vm.runInContext("state.reviewPhase",context),'discoveries');
  assert.equal(vm.runInContext("candidateReviewComplete()",context),true);
  assert.equal(vm.runInContext("plannerState().candidates.find(c=>c.id==='food-new').status",context),'excluded');
  vm.runInContext("candidates.push({...candidates[0],id:'exact',name:'屏山峡谷',sourceRequest:'屏山峡谷'});state.route.must.push('屏山峡谷');state.reviewPhase='wishes'",context);
  assert.equal(vm.runInContext("canRecommendMore('屏山峡谷')",context),false);
  assert.equal(vm.runInContext("canRecommendMore('泉州')",context),true);
  assert.equal(vm.runInContext("canRecommendMore('可以骑马的地方')",context),true);
  assert.equal(vm.runInContext("canRecommendMore('沿途发现')",context),true);
  assert.doesNotMatch(vm.runInContext('itineraryReview()',context),/data-more-group="屏山峡谷"/);
});

test("first step starts empty and has no simulated generation entry", () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const app = { innerHTML: "", querySelector: () => null };
  const context = vm.createContext({
    document: { getElementById: id => id === "app" ? app : { classList: { add() {}, remove() {} } }, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [] }, location: { protocol: "file:", href: "file:///tmp/roadtrip-planner-demo.html" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify({route:state.route,answers:state.answers,prefs:state.prefs})", context)).route, { start: "", end: "", must: [] });
  assert.equal(vm.runInContext("state.answers.departDate", context), "");
  assert.equal(vm.runInContext("state.answers.returnDate", context), "");
  assert.equal(vm.runInContext("state.answers.departTime", context), "");
  assert.ok(Object.values(JSON.parse(vm.runInContext("JSON.stringify(state.prefs)", context))).every(value => value === "off"));
  vm.runInContext("state.setup.loading=false;render()", context);
  assert.doesNotMatch(app.innerHTML, /调试示例|模拟候选|载入模拟|mock-candidates|toggle-debug/);
  assert.doesNotMatch(page, /\/api\/mock-report|data-action="mock-(?:candidates|preview|final)"/);
});

test("itinerary review groups selectable experiences by wish", () => {
  assert.match(page, /function itineraryReview\(/);
  assert.match(page, /data-more-group=/);
  assert.match(page, /g\.items\.map\(c=>candidateCard\(c\)\)/);
  assert.doesNotMatch(page, /ONE DECISION AT A TIME/);
});

test("candidate generation buttons use the plain product label", () => {
  assert.match(page, /'生成沿途候选 →'/);
  assert.doesNotMatch(page, /让 Codex 推荐|让 Codex 生成沿途候选/);
});

test("travel-source permissions are explicit and opt-in", () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const context = vm.createContext({
    document: { getElementById() { return null; }, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [] },
    location: { protocol: "file:", href: "file:///tmp/roadtrip-planner-demo.html" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  vm.runInContext("state.setup.flyai=true", context);
  assert.equal(vm.runInContext("state.answers.flyaiDataConsent", context), false);
  assert.equal(vm.runInContext("state.answers.xiaohongshuBrowserOptIn", context), false);
  const html = vm.runInContext("questions()", context);
  assert.match(html, /允许用行程与必要的宠物信息查询飞猪/);
  assert.match(html, /允许用小红书查攻略和游记/);
  assert.match(html, /内置浏览器打开小红书/);
  assert.match(html, /未勾选就不调用 FlyAI/);
  assert.equal(vm.runInContext("plannerState().capabilities.flyai", context), false);
  vm.runInContext("state.answers.flyaiDataConsent=true", context);
  assert.equal(vm.runInContext("plannerState().capabilities.flyai", context), true);
});

test("top bar keeps session and settings controls without duplicate generation actions", () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(script);
  const context = vm.createContext({
    document: { getElementById() { return null; }, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [] },
    location: { protocol: "file:", href: "file:///tmp/roadtrip-planner-demo.html" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  for (let stage = 1; stage <= 5; stage += 1) {
    const html = vm.runInContext(`state.stage=${stage};state.ai.reportUrl='/generated-plan';header()`, context);
    const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1];
    assert.ok(topbar);
    assert.doesNotMatch(topbar, /data-action="(?:ai-candidates|ai-preview|ai-plan|open-report|show-state)"/);
    assert.match(topbar, /data-action="end-session"/);
    assert.match(topbar, /data-action="setup-open"/);
    assert.doesNotMatch(topbar, /data-action="refine-open"/);
  }
});

test("first launch offers skippable key setup and hides unverified road data", async () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const app = { innerHTML: "", querySelector: () => null };
  const toast = { textContent: "", classList: { add() {}, remove() {} } };
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: id => id === "app" ? app : id === "toast" ? toast : id === "amapSetupKey" ? { value: "amap-secret" } : id === "amapJsSetupKey" ? { value: "amap-js-secret" } : id === "amapSecuritySetupCode" ? { value: "amap-security-secret" } : id === "flyaiSetupKey" ? { value: "flyai-secret" } : null, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [] },
    location: { protocol: "http:", href: "http://127.0.0.1:4317/" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {},
    fetch: async (path, options) => {
      calls.push({ path, body: options?.body ? JSON.parse(options.body) : null });
      if (path === "/api/setup/status") return { ok: true, json: async () => ({ ok: true, amap: { configured: false, source: "none" }, flyai: { configured: false, installed: true, available: false, source: "none" } }) };
      if (path === "/api/setup/credentials") return { ok: true, json: async () => ({ ok: true, amap: { configured: true, source: "saved" }, amapJs: { configured: true, keySource: "saved", securitySource: "saved" }, flyai: { configured: true, installed: true, available: true, source: "saved" } }) };
      if (path === "/api/map/preview") return { ok: true, json: async () => ({ ok: true, points: [], imageUrl: "" }) };
      throw new Error(`unexpected ${path}`);
    }
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  vm.runInContext("render()", context);
  assert.match(app.innerHTML, /正在检查旅行数据服务/);
  await vm.runInContext("loadSetupStatus()", context);
  assert.match(app.innerHTML, /高德地图/);
  assert.match(app.innerHTML, /同一条 Web 端（JS API）Key/);
  assert.match(app.innerHTML, /for="amapJsSetupKey"/);
  assert.match(app.innerHTML, /for="amapSecuritySetupCode"/);
  assert.match(app.innerHTML, /飞猪 FlyAI/);
  assert.match(app.innerHTML, /data-action="setup-skip"/);
  vm.runInContext("state.setup.open=false;render()", context);
  assert.doesNotMatch(app.innerHTML, /class="guide-side"/);
  vm.runInContext("state.stage=2;render()", context);
  assert.doesNotMatch(app.innerHTML, /class="guide-side"/);
  assert.match(app.innerHTML, /guide-body--form/);
  vm.runInContext("state.stage=3;render()", context);
  assert.match(app.innerHTML, /class="guide-side"/);
  assert.match(app.innerHTML, /地图暂不展示/);
  assert.doesNotMatch(app.innerHTML, /高德道路快照 · km/);
  await vm.runInContext("saveSetup()", context);
  assert.deepEqual(calls.find(call => call.path === "/api/setup/credentials").body, { amapKey: "amap-secret", amapJsKey: "amap-js-secret", amapSecurityJsCode: "amap-security-secret", flyaiKey: "flyai-secret" });
  assert.equal(vm.runInContext("state.setup.open", context), false);
  assert.equal(vm.runInContext("state.setup.amap", context), true);
  assert.doesNotMatch(app.innerHTML, /amap-secret|amap-js-secret|amap-security-secret|flyai-secret/);
});

test("LAN setup page keeps provider key entry on the host computer", () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const app = { innerHTML: "", querySelector: () => null };
  const context = vm.createContext({
    document: { getElementById: id => id === "app" ? app : null, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [] },
    location: { protocol: "http:", href: "http://192.168.2.63:4317/" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  vm.runInContext("state.setup.loading=false;state.setup.open=true;render()", context);
  assert.match(app.innerHTML, /在电脑上配置服务密钥/);
  assert.match(app.innerHTML, /data-action="setup-skip"/);
  assert.doesNotMatch(app.innerHTML, /amapSetupKey|flyaiSetupKey|data-action="setup-save"/);
});

test("interactive map draws verified road paths and keeps the viewport on unchanged data", async () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const host = {};
  let fitCount = 0, added = [];
  class MapView {
    add(items) { added = items; }
    remove() {}
    setFitView() { fitCount += 1; }
    resize() {}
  }
  class Polyline { constructor(options) { this.options = options; } }
  class Marker { constructor(options) { this.options = options; } }
  class Pixel { constructor() {} }
  const context = vm.createContext({
    document: { getElementById: id => id === "amapInteractive" ? host : null, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [], AMap: { Map: MapView, Polyline, Marker, Pixel } },
    location: { protocol: "http:", href: "http://127.0.0.1:4317/" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  vm.runInContext(`state.setup.amapJs=true;state.setup.amap=true;state.route={start:'杭州',end:'赤壁',must:[]};mapPreviews.set(JSON.stringify(mapPlaces()),{points:[{name:'杭州',lon:120,lat:30},{name:'赤壁',lon:113,lat:29}],legs:[{source:'amap',path:[[120,30],[118,30],[113,29]]}]})`, context);
  await vm.runInContext("syncAmapMap()", context);
  assert.equal(added.length, 3);
  assert.equal(added[0].options.path.length, 3);
  assert.equal(fitCount, 1);
  await vm.runInContext("syncAmapMap()", context);
  assert.equal(fitCount, 1);
});

test("missing FlyAI CLI gives a copyable install step and can be rechecked without losing typed keys", async () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const app = { innerHTML: "" };
  const toast = { textContent: "", classList: { add() {}, remove() {} } };
  const amapInput = { value: "amap-draft" }, flyaiInput = { value: "flyai-draft" };
  let copied = "", installed = false;
  const context = vm.createContext({
    document: { getElementById: id => ({ app, toast, amapSetupKey: amapInput, flyaiSetupKey: flyaiInput })[id] || null, addEventListener() {} },
    navigator: { clipboard: { writeText: async value => { copied = value; } } },
    window: { ROADTRIP_LOCATIONS: [] },
    location: { protocol: "http:", href: "http://127.0.0.1:4317/" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {},
    fetch: async path => {
      assert.equal(path, "/api/setup/status");
      return { ok: true, json: async () => ({ ok: true, amap: { configured: false, source: "none" }, flyai: { configured: true, installed, available: installed, source: "saved" } }) };
    }
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  vm.runInContext("state.setup.loading=false;state.setup.open=true;state.setup.flyaiSource='saved';render()", context);
  assert.match(app.innerHTML, /npm i -g @fly-ai\/flyai-cli/);
  assert.match(app.innerHTML, /data-action="flyai-copy-install"/);
  assert.match(app.innerHTML, /data-action="flyai-recheck"/);
  assert.match(app.innerHTML, /data-action="setup-skip"/);
  await vm.runInContext("copyFlyaiInstallCommand()", context);
  assert.equal(copied, "npm i -g @fly-ai/flyai-cli");
  installed = true;
  await vm.runInContext("recheckFlyaiTool()", context);
  assert.equal(vm.runInContext("state.setup.flyaiInstalled", context), true);
  assert.doesNotMatch(app.innerHTML, /data-action="flyai-copy-install"/);
  assert.equal(amapInput.value, "amap-draft");
  assert.equal(flyaiInput.value, "flyai-draft");
});

test("destination tag heading is not itself an experience tag", () => {
  assert.doesNotMatch(page, /<span class="tag">城市标签<\/span>/);
  assert.match(page, /<span class="tag-label">适合体验<\/span>/);
});

test("required framework includes travelers, detailed pet facts, exclusions and fixed constraints", () => {
  assert.match(page, /data-answer="travelers"/);
  assert.match(page, /data-answer="petWeightKg"/);
  assert.doesNotMatch(page, /data-answer="petAgeYears"/);
  assert.match(page, /data-answer="exclusions"/);
  assert.match(page, /data-answer="fixedBookings"/);
  assert.match(page, /data-answer="borderDocs"/);
  assert.doesNotMatch(page, /可短时寄养/);
});

test("candidate UI uses explainable verdicts and persists only planning state", () => {
  assert.doesNotMatch(page, /<small>\/100<\/small>/);
  assert.match(page, /candidateReviewComplete/);
  assert.match(page, /sessionStorage\.setItem\(STORAGE_KEY/);
  assert.doesNotMatch(page, /sessionStorage\.setItem\([^\n]*(?:amapSetupKey|flyaiSetupKey|securityJsCode)/);
});

test("step three asks for explicit instructions before regenerating candidates", async () => {
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(script);
  const app = { innerHTML: "", querySelector: () => null };
  const toast = { textContent: "", classList: { add() {}, remove() {} } };
  const instruction = { value: "", focus() {} };
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: id => id === "app" ? app : id === "toast" ? toast : id === "candidateInstruction" ? instruction : { scrollIntoView() {}, focus() {} }, addEventListener() {} },
    window: { ROADTRIP_LOCATIONS: [] },
    location: { protocol: "http:", href: "http://127.0.0.1:4317/" },
    URL, structuredClone, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      if (url === "/api/codex/candidates") {
        calls.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ ok: true, job: { id: "1" } }) };
      }
      assert.equal(url, "/api/jobs/1");
      return { ok: true, json: async () => ({ ok: true, job: { status: "completed", result: { summary: "更新后的候选", candidates: testCandidates } } }) };
    }
  });
  vm.runInContext(script.replace(/\n    render\(\);\s*checkCodexStatus\(\);[\s\S]*?registerPlannerTools\(\)\.catch\(\(\)=>\{\}\);/, ""), context);
  vm.runInContext("state.setup.loading=false", context);
  seedTestState(context);
  vm.runInContext("openCandidateRevision()", context);
  assert.match(app.innerHTML, /id="candidateInstruction"/);
  assert.equal(calls.length, 0);
  await vm.runInContext("submitCandidateRevision()", context);
  assert.equal(calls.length, 0);
  instruction.value = "避开古城，优先找能带狗散步的海滨城市";
  await vm.runInContext("submitCandidateRevision()", context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].instruction, instruction.value);
  assert.equal(vm.runInContext("state.ai.summary", context), "更新后的候选");
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
  vm.runInContext("state.setup.loading=false", context);
  seedTestState(context);
  vm.runInContext("state.candidateStatus['candidate-quanzhou']='selected';state.route.must=['泉州'];candidates[0].sourceRequest='泉州';state.reviewPhase='discoveries'", context);
  await vm.runInContext("requestCodexPreview()", context);
  assert.equal(calls[0].url, "/api/codex/preview");
  assert.equal(vm.runInContext("state.stage", context), 4);
  assert.ok(app.innerHTML.includes("路线预览已核验"));
  await vm.runInContext("requestCodexPlan()", context);
  assert.equal(calls[1].url, "/api/codex/plan");
  assert.equal(calls[1].state.review.preview.summary, "路线预览已核验");
  assert.equal(vm.runInContext("state.stage", context), 5);
  assert.match(app.innerHTML, /<button[^>]+data-stage="3"[^>]*>重新计划<\/button>/);
  assert.match(app.innerHTML, /<button[^>]+data-action="refine-open"[^>]*>调整计划<\/button>/);
  assert.match(app.innerHTML, /<a[^>]+download="自驾旅行计划\.html"[^>]*>下载计划<\/a>/);
  assert.doesNotMatch(app.innerHTML, /返回预览|单独打开|data-action="ai-plan">重新生成/);
  assert.ok(app.innerHTML.includes('class="completed-report"'));
  assert.ok(!app.innerHTML.includes('class="guide-body"'));
  await vm.runInContext("requestCodexRefine()", context);
  assert.equal(calls[2].url, "/api/codex/refine");
  assert.equal(calls[2].state.instruction, "把恩施留久一点");
  assert.equal(vm.runInContext("state.ai.reportUrl", context), "/generated-plan?v=3");
});
