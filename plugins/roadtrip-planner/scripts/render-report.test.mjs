import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderRoadbook } from "./render-report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const example = JSON.parse(readFileSync(join(root, "scripts/fixtures/report-data.json"), "utf8"));
const css = readFileSync(join(root, "assets/south-line.css"), "utf8");

test("fixed report keeps overview, stop summaries, and one collapsible daily spine", () => {
  const html = renderRoadbook(example);
  const sections = [...html.matchAll(/<section\b[^>]*id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(sections, ["todo", "brief", "pace", "map-section", "stops", "days", "practical"]);
  assert.ok(html.includes(`<style>${css}</style>`));
  for (const className of ["hero-stats", "pace-day-list", "hotel-area card", "stop-card card", "day-flow", "slot-card", "map-route-legend", "day card is-collapsed", "reference-panel card"]) {
    assert.ok(html.includes(className), `${className} missing`);
  }
  assert.equal((html.match(/class="pace-day-row"/g) || []).length, example.days.length);
  assert.equal((html.match(/class="pace-metric pace-metric--play"/g) || []).length, example.days.length);
  assert.equal((html.match(/class="pace-metric pace-metric--drive"/g) || []).length, example.days.length);
  assert.match(html, /每天独占一行，上下对照游玩与驾驶/);
  const chart = html.match(/<div id="heatmap"[^>]*>(.*?)<\/section>/s)?.[1];
  assert.ok(chart);
  assert.doesNotMatch(chart, /<polyline|pace-point|pace-chart-scroll|pace-track-days|向右滑动/);
  assert.doesNotMatch(html, /class="heat-grid"/);
  assert.match(html, /id="expand-all-days"/);
  assert.match(html, /data-open-day="day-1"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /停留重点|机动 2\.0h|当天吃什么/);
  assert.doesNotMatch(html, /class="stop-plan"|每站到底怎么玩/);
  const cityList = html.match(/<ol id="map-route-legend"[^>]*>(.*?)<\/ol>/s)?.[1];
  assert.ok(cityList);
  assert.equal((cityList.match(/<li>/g) || []).length, example.mapStops.length);
  assert.doesNotMatch(cityList, /游玩|停留|同行提醒|地图 ↗|<strong>|<div>/);
  assert.match(html, /data-roadbook-template="south-line-v2"/);
  assert.doesNotMatch(html, /{{[A-Z_]+}}|securityJsCode|0106n12000rrctq3jAA64/);
});

test("report data must provide complete daily content", () => {
  assert.throws(() => renderRoadbook({ ...example, dayBalance: [] }), /dayBalance/);
  assert.throws(() => renderRoadbook({ ...example, days: [{ ...example.days[0], slots: [] }] }), /每天必须有时间块/);
  assert.throws(() => renderRoadbook({ ...example, stopSummaries: undefined }), /stopSummaries/);
  assert.throws(() => renderRoadbook({ ...example, stopSummaries: [{ city: "乙城", focus: [] }] }), /停留重点/);
});

test("final report title and hero route show places without planning-status labels", () => {
  const marked = { ...example, title: "杭州〔已选〕自驾", hero: { ...example.hero, title: "去东山岛〔必去〕", route: "杭州 → 东山岛〔必去〕 → 恩施【已选】 → 杭州" } };
  const html = renderRoadbook(marked);
  assert.match(html, /<title>杭州自驾<\/title>/);
  assert.match(html, /<h1>去东山岛<\/h1>/);
  assert.match(html, /<p class="route-string">杭州 → 东山岛 → 恩施 → 杭州<\/p>/);
});

test("missing providers suppress precise map, hotel and ticket claims", () => {
  const trip = structuredClone(example);
  trip.capabilities = { amap: false, flyai: false };
  trip.hotelAreas[0].options[0].priceRange = "¥999 / 晚";
  trip.days[0].slots[1].ticketPrice = "门票 ¥888";
  trip.days[0].slots[1].actionLink = { label: "立即预订", url: "https://example.com/book" };
  trip.dataSources.push({ name: "飞猪 FlyAI", scope: "实时酒店价格" });
  const html = renderRoadbook(trip);
  assert.match(html, /未接入高德，地图落点暂不展示/);
  assert.match(html, /未接入飞猪；具体酒店、房价与预订入口暂不展示/);
  assert.doesNotMatch(html, /¥999|¥888|立即预订|leaflet@1\.9\.4/);
  assert.doesNotMatch(html, /<h4>城区住宿<\/h4>/);
  assert.match(html, /道路耗时待核验/);
  assert.match(html, /甲城.*乙城/s);
});

test("city guides and spot posts stay beside their place and only link to safe sources", () => {
  const trip = structuredClone(example);
  trip.capabilities = { amap: false, flyai: false };
  trip.stopSummaries[0].guides.push({ type: "游记", platform: "旅行社区", title: "不安全链接", url: "javascript:alert(1)" });
  trip.days[0].slots[1].references.push({ type: "体验帖", title: "仅有标题", note: "未核到直达链接" });
  const html = renderRoadbook(trip);
  assert.match(html, /去之前看看/);
  assert.match(html, /去过的人怎么说/);
  assert.match(html, /乙城慢游参考/);
  assert.match(html, /乙城街区实走记录/);
  assert.match(html, /个人体验仅供参考，准入与价格以官方为准/);
  assert.doesNotMatch(html, /javascript:alert|不安全链接|仅有标题/);
  assert.ok(html.indexOf("乙城慢游参考") < html.indexOf('id="day-1"'));
  assert.ok(html.indexOf("乙城街区实走记录") > html.indexOf('id="day-1"'));
});
