import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderRoadbook } from "./render-report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const example = JSON.parse(readFileSync(join(root, "scripts/fixtures/report-data.json"), "utf8"));
const css = readFileSync(join(root, "assets/south-line.css"), "utf8");

test("generated report uses the full south-line layout and reading order", () => {
  const html = renderRoadbook(example);
  const sections = [...html.matchAll(/<section\b[^>]*id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(sections, ["todo", "brief", "stops", "pace", "route", "transport", "stay", "map-section", "days", "tips", "sources-section"]);
  assert.ok(html.includes(`<style>${css}</style>`));
  for (const className of ["hero-stats", "stop-card card", "heat-grid", "route-ledger card", "hotel-area card", "day-flow", "slot-card", "map-route-legend"]) {
    assert.ok(html.includes(className), `${className} missing`);
  }
  assert.match(html, /data-roadbook-template="south-line-v1"/);
  assert.doesNotMatch(html, /{{[A-Z_]+}}|securityJsCode|0106n12000rrctq3jAA64/);
});

test("report data must provide complete daily content", () => {
  assert.throws(() => renderRoadbook({ ...example, dayBalance: [] }), /dayBalance/);
  assert.throws(() => renderRoadbook({ ...example, days: [{ ...example.days[0], slots: [] }] }), /每天必须有时间块/);
});
