import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderRoadbook } from "./render-report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const example = JSON.parse(readFileSync(join(root, "scripts/fixtures/report-data.json"), "utf8"));
const css = readFileSync(join(root, "assets/south-line.css"), "utf8");

test("generated report leads with four overviews and one collapsible daily spine", () => {
  const html = renderRoadbook(example);
  const sections = [...html.matchAll(/<section\b[^>]*id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(sections, ["todo", "brief", "pace", "map-section", "days", "practical"]);
  assert.ok(html.includes(`<style>${css}</style>`));
  for (const className of ["hero-stats", "pace-chart-inner", "hotel-area card", "day-flow", "slot-card", "map-route-legend", "day card is-collapsed", "reference-panel card"]) {
    assert.ok(html.includes(className), `${className} missing`);
  }
  assert.equal((html.match(/class="pace-chart-row"/g) || []).length, 2);
  assert.match(html, /游玩逐日时长曲线/);
  assert.match(html, /驾驶逐日时长曲线/);
  assert.doesNotMatch(html, /class="heat-grid"/);
  assert.match(html, /id="expand-all-days"/);
  assert.match(html, /data-open-day="day-1"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /class="stop-plan"|每站到底怎么玩/);
  const cityList = html.match(/<ol id="map-route-legend"[^>]*>(.*?)<\/ol>/s)?.[1];
  assert.ok(cityList);
  assert.equal((cityList.match(/<li>/g) || []).length, example.mapStops.length);
  assert.doesNotMatch(cityList, /游玩|停留|同行提醒|地图 ↗|<strong>|<div>/);
  assert.match(html, /data-roadbook-template="south-line-v1"/);
  assert.doesNotMatch(html, /{{[A-Z_]+}}|securityJsCode|0106n12000rrctq3jAA64/);
});

test("report data must provide complete daily content", () => {
  assert.throws(() => renderRoadbook({ ...example, dayBalance: [] }), /dayBalance/);
  assert.throws(() => renderRoadbook({ ...example, days: [{ ...example.days[0], slots: [] }] }), /每天必须有时间块/);
  assert.match(renderRoadbook({ ...example, stopSummaries: undefined }), /data-open-day="day-1"/);
});

test("final report title and hero route show places without planning-status labels", () => {
  const marked = { ...example, title: "杭州〔已选〕自驾", hero: { ...example.hero, title: "去东山岛〔必去〕", route: "杭州 → 东山岛〔必去〕 → 恩施【已选】 → 杭州" } };
  const html = renderRoadbook(marked);
  assert.match(html, /<title>杭州自驾<\/title>/);
  assert.match(html, /<h1>去东山岛<\/h1>/);
  assert.match(html, /<p class="route-string">杭州 → 东山岛 → 恩施 → 杭州<\/p>/);
});
