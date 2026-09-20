import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
