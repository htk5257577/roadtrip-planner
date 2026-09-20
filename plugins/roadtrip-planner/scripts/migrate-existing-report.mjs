#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderRoadbook } from "./render-report.mjs";

const [, , sourceArg, outputArg, heroImageArg] = process.argv;
if (!sourceArg || !outputArg) throw new Error("用法：node migrate-existing-report.mjs <旧报告.html> <新版报告.html>");
const sourcePath = resolve(sourceArg), outputPath = resolve(outputArg);
if (sourcePath === outputPath || existsSync(outputPath)) throw new Error("输出必须是尚不存在的新文件，原报告不会被覆盖");
const html = readFileSync(sourcePath, "utf8");
const match = html.match(/<script id="trip-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) throw new Error("旧报告没有可迁移的 trip-data 数据");
const trip = JSON.parse(match[1]);
const extract = pattern => html.match(pattern)?.[1] || "";
const plain = value => String(value).replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const stats = [...extract(/<div class="hero-stats">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="hero-mark">/).matchAll(/<div class="stat"><b>([\s\S]*?)<\/b><span>([\s\S]*?)<\/span><\/div>/g)]
  .map(([, value, label]) => ({ value: plain(value), label: plain(label) }));
if (stats.length === 3) {
  const distance = String(trip.meta?.distance || "").match(/([\d,.]+)\s*km/i);
  stats[0] = { value: String(trip.days.length), label: `天 · ${plain(trip.meta?.dateRange || "")}` };
  if (distance) stats[1] = { value: `≈${Math.round(Number(distance[1].replace(/,/g, ""))).toLocaleString("zh-CN")}`, label: "公里 · 道路与排程估算" };
  const play = Number(trip.meta?.playHours);
  if (Number.isFinite(play)) stats[2] = { value: `${play}h`, label: "有效游玩时间" };
}
trip.hero = {
  eyebrow: plain(extract(/<div class="eyebrow"><span>([\s\S]*?)<\/span>/)),
  badge: plain(extract(/<div class="eyebrow">[\s\S]*?<strong>([\s\S]*?)<\/strong>/)),
  title: plain(extract(/<h1>([\s\S]*?)<\/h1>/)),
  lede: plain(extract(/<p class="hero-lede">([\s\S]*?)<\/p>/)),
  route: plain(extract(/<p class="route-string">([\s\S]*?)<\/p>/)),
  ...(stats.length === 3 ? { stats } : {}),
  ...(heroImageArg && /^https?:\/\/[^'"\s]+$/.test(heroImageArg) ? { imageUrl: heroImageArg } : {}),
  footer: plain(extract(/<footer>[\s\S]*?<div class="shell">([\s\S]*?)<\/div>/))
};
const newHtml = renderRoadbook(trip);
const dataPath = join(dirname(outputPath), `${outputPath.split("/").at(-1).replace(/\.html$/i, "")}.json`);
if (existsSync(dataPath)) throw new Error("数据文件已存在，不覆盖原内容");
writeFileSync(dataPath, JSON.stringify(trip, null, 2), { encoding: "utf8", flag: "wx" });
writeFileSync(outputPath, newHtml, { encoding: "utf8", flag: "wx" });
process.stdout.write(`已按固定南线版式生成：${outputPath}\n数据：${dataPath}\n原报告未改动。\n`);
