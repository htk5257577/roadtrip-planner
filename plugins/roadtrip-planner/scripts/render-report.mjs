#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(pluginRoot, "assets/roadbook-template.html"), "utf8");
const css = readFileSync(join(pluginRoot, "assets/south-line.css"), "utf8");
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const text = value => esc(value).replace(/\n/g, "<br>");
const cleanHeroLabel = value => String(value ?? "").replace(/\s*[〔【（(]\s*(?:必去|已选|已选定|已加入)\s*[〕】）)]/g, "").trim();
const array = value => Array.isArray(value) ? value : [];
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const safeUrl = value => /^(https?:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(String(value ?? "")) ? String(value) : "";
const link = value => value?.url && safeUrl(value.url) ? `<a class="action-link" href="${esc(value.url)}" target="_blank" rel="noopener">${esc(value.label || "查看资料")} ↗</a>` : "";

function checkData(trip) {
  if (!trip || typeof trip !== "object" || Array.isArray(trip)) throw new Error("路书数据必须是 JSON 对象");
  for (const field of ["title", "startDate", "meta", "preTrip", "routeDecision"]) {
    if (!trip[field]) throw new Error(`路书数据缺少 ${field}`);
  }
  for (const field of ["reminders", "dayBalance", "routeLegs", "hotelAreas", "mapStops", "days", "tips", "sourceLinks"]) {
    if (!Array.isArray(trip[field]) || !trip[field].length) throw new Error(`路书数据缺少 ${field}`);
  }
  if (trip.dayBalance.length !== trip.days.length) throw new Error("热力图天数必须与逐日时间轴一致");
  if (!trip.days.every(day => Array.isArray(day.slots) && day.slots.length && day.drive && day.dog)) throw new Error("每天必须有时间块、路线和同行信息");
  if (!trip.mapStops.every(point => typeof point.name === "string" && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)))) throw new Error("地图落点缺少坐标");
}

function mapMarkup(points) {
  if (!points.length) return '<div class="map-offline"><b>地图落点尚未核验</b></div>';
  const width = 900, height = 430, pad = 38;
  const lats = points.map(point => finite(point.lat)), lngs = points.map(point => finite(point.lng));
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const xy = point => ({ x: pad + (finite(point.lng) - minLng) / (maxLng - minLng || 1) * (width - 2 * pad), y: height - pad - (finite(point.lat) - minLat) / (maxLat - minLat || 1) * (height - 2 * pad) });
  const path = points.map(point => { const pos = xy(point); return `${pos.x.toFixed(1)},${pos.y.toFixed(1)}`; }).join(" ");
  const markers = points.map((point, index) => { const pos = xy(point); return `<g><circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="15" fill="#ca3e2d" stroke="#fffaf0" stroke-width="3"/><text x="${pos.x.toFixed(1)}" y="${(pos.y + 3.5).toFixed(1)}" text-anchor="middle" fill="white" font-size="11" font-weight="800">${index + 1}</text></g>`; }).join("");
  return `<div class="fallback-map"><div class="fallback-map__head"><b>路线示意图</b><span>离线可看；联网后尝试加载道路底图</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="全程路线落点示意图"><polyline points="${path}" fill="none" stroke="#ca3e2d" stroke-width="5" stroke-linejoin="round" stroke-dasharray="8 9" opacity=".78"/>${markers}</svg></div>`;
}

function mapScript(points) {
  const data = JSON.stringify(points.map(point => ({ name: String(point.name), lat: finite(point.lat), lng: finite(point.lng) }))).replace(/</g, "\\u003c");
  return `<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js" defer><\/script><script>
  window.addEventListener('load',function(){
    if(!window.L)return;
    var points=${data}, host=document.getElementById('map');
    try { var map=L.map(host,{scrollWheelZoom:false}), markers=[];
      var safe=function(value){return String(value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]})};
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri · Sources: Esri, HERE, Garmin, FAO, NOAA, USGS',maxZoom:18}).addTo(map);
      points.forEach(function(p,i){var marker=L.marker([p.lat,p.lng]).addTo(map).bindPopup((i+1)+'. '+safe(p.name));markers.push(marker);});
      var coords=points.map(function(p){return[p.lat,p.lng]});
      if(coords.length>1)L.polyline(coords,{color:'#ca3e2d',dashArray:'7 9',weight:4}).addTo(map);
      map.fitBounds(coords,{padding:[34,34]});
    } catch(error) { host.innerHTML=${JSON.stringify(mapMarkup(points)).replace(/</g, "\\u003c")}; }
  });
  var setDay=function(day,expanded){day.classList.toggle('is-collapsed',!expanded);var button=day.querySelector('.toggle-day');button.textContent=expanded?'收起当天安排':'查看当天安排';button.setAttribute('aria-expanded',String(expanded));};
  document.getElementById('timeline').addEventListener('click',function(event){var button=event.target.closest('.toggle-day');if(button){var day=button.closest('.day');setDay(day,day.classList.contains('is-collapsed'));}});
  document.getElementById('expand-all-days').addEventListener('click',function(){document.querySelectorAll('.day').forEach(function(day){setDay(day,true)})});
  document.getElementById('collapse-all-days').addEventListener('click',function(){document.querySelectorAll('.day').forEach(function(day){setDay(day,false)})});
  var openTargetDay=function(){var target=document.getElementById(location.hash.slice(1));if(target&&target.classList.contains('day'))setDay(target,true)};
  document.getElementById('map-route-legend').addEventListener('click',function(event){var anchor=event.target.closest('a[data-open-day]');if(!anchor)return;var day=document.getElementById(anchor.dataset.openDay);if(day)setDay(day,true)});
  window.addEventListener('hashchange',openTargetDay);openTargetDay();
  <\/script>`;
}

export function renderRoadbook(trip) {
  checkData(trip);
  const hero = trip.hero || {}, meta = trip.meta || {}, pre = trip.preTrip || {};
  const distanceMatch = String(meta.distance || "").match(/([\d,.]+)\s*km/i);
  const distanceValue = distanceMatch ? `≈${Math.round(Number(distanceMatch[1].replace(/,/g, ""))).toLocaleString("zh-CN")}` : "待核验";
  const compactRange = String(meta.dateRange || "").replace(/\b\d{4}-(?=\d{2}-\d{2})/g, "").replace(/-(?=\d{2}\b)/g, "/");
  const stats = array(hero.stats).length === 3 ? hero.stats : [
    { value: String(trip.days.length), label: `天 · ${compactRange}` },
    { value: distanceValue, label: "公里 · 道路与排程估算" },
    { value: `${trip.dayBalance.reduce((sum, day) => sum + finite(day.play), 0).toFixed(1)}h`, label: "有效游玩时间" }
  ];
  const reminders = trip.reminders.map(item => `<li class="todo-item"><input type="checkbox" aria-label="完成：${esc(item.item)}"><span class="todo-deadline">${esc(item.deadline || `提前${item.leadDays ?? "?"}天`)}</span><span class="todo-text">${esc(item.item)}</span></li>`).join("");
  const preCards = [
    ["🌦", "天气跨度", pre.weather?.summary], ["🌀", "天气预案", pre.weather?.typhoon],
    ["🧥", "同行装备", pre.packing], ["💳", "支付", pre.payment],
    ["📱", "必备 App", array(pre.apps).join(" · ")], ["🎟", "预订顺序", pre.ticketTip]
  ].map(([icon, title, body]) => `<article class="info-card card"><div class="icon">${icon}</div><h3>${title}</h3><p>${text(body)}</p></article>`).join("");
  const paceDays = trip.dayBalance;
  const chartWidth = Math.max(780, paceDays.length * 58);
  const maxHours = Math.max(6, Math.ceil(Math.max(...paceDays.flatMap(day => [finite(day.play), finite(day.drive)]))));
  const chartX = index => paceDays.length === 1 ? chartWidth / 2 : 27 + index * (chartWidth - 54) / (paceDays.length - 1);
  const chartY = value => 76 - finite(value) / maxHours * 56;
  const paceSeries = (key, label, color) => {
    const total = paceDays.reduce((sum, day) => sum + finite(day[key]), 0).toFixed(1);
    const line = paceDays.map((day, index) => `${chartX(index).toFixed(1)},${chartY(day[key]).toFixed(1)}`).join(" ");
    const points = paceDays.map((day, index) => {
      const x = chartX(index).toFixed(1), y = chartY(day[key]).toFixed(1), value = finite(day[key]).toFixed(1);
      return `<g class="pace-point"><title>${esc(day.date)} · ${esc(day.label)} · ${label} ${value} 小时</title><circle cx="${x}" cy="${y}" r="4.5" fill="${color}" stroke="#fffaf0" stroke-width="2"/><text x="${x}" y="${(Number(y) - 10).toFixed(1)}" text-anchor="middle">${value}</text></g>`;
    }).join("");
    return `<div class="pace-chart-row"><div class="pace-chart-label"><i style="background:${color}"></i><strong>${label}</strong><span>合计 ${total}h</span></div><svg viewBox="0 0 ${chartWidth} 88" role="img" aria-label="${label}逐日时长曲线，合计 ${total} 小时"><line class="pace-baseline" x1="27" y1="76" x2="${chartWidth - 27}" y2="76"/><line class="pace-guide" x1="27" y1="48" x2="${chartWidth - 27}" y2="48"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${points}</svg></div>`;
  };
  const dateLabels = paceDays.map((day, index) => `<text x="${chartX(index).toFixed(1)}" y="18" text-anchor="middle">${esc(day.date)}</text>`).join("");
  const heatmap = `<div class="pace-chart-intro"><span>每天同一位置，上下对照</span><b>统一刻度 0–${maxHours}h</b></div><span class="pace-swipe-hint">向右滑动，查看后续日期 →</span><div class="pace-chart-scroll"><div class="pace-chart-inner" style="min-width:${chartWidth + 86}px">${paceSeries("play", "游玩", "#377e74")}${paceSeries("drive", "驾驶", "#ca3e2d")}<div class="pace-chart-dates"><span>日期</span><svg viewBox="0 0 ${chartWidth} 28" aria-hidden="true">${dateLabels}</svg></div></div></div><p class="pace-chart-note">线上的数字是当天小时数；充电、用餐和休息已留在逐日安排中，不计入这两条线。</p>`;
  const ledger = trip.routeLegs.map(leg => `<div class="leg"><div class="leg-date">${esc(leg.date)}</div><div class="leg-route"><b>${esc(leg.route)}</b><span>${[leg.distance, leg.duration, leg.buffer, leg.toll].filter(Boolean).map(esc).join(" · ")}</span></div></div>`).join("");
  const transport = array(trip.transport).map(item => `<article class="transport-card card"><span class="status-chip">${esc(item.status || "需核验")}</span><h3>${esc(item.title)}</h3><p>${text(item.detail)}</p></article>`).join("") || `<article class="transport-card card"><span class="status-chip">转场</span><h3>按路线账本执行</h3><p>${text(meta.transportNote || "道路、补能和特殊交通以临行核验为准。")}</p></article>`;
  const hotels = trip.hotelAreas.map(area => `<article class="hotel-area card"><h3>${esc(area.area)}</h3><p>${text(area.reason)}</p><div class="hotel-options">${array(area.options).map(option => `<div class="hotel-option"><div class="hotel-option-head"><strong>${esc(option.tier)}</strong><span>${esc(option.priceRange)}</span></div><h4>${esc(option.name)}</h4><p>${text(option.note)}</p>${link(option.actionLink)}</div>`).join("")}</div></article>`).join("");
  const mapLegend = trip.mapStops.map((point, index) => {
    const dayIndex = index === trip.mapStops.length - 1 ? trip.days.length - 1 : trip.days.findIndex(day => day.theme.includes(point.name) || day.drive.route.includes(point.name) || day.slots.some(slot => slot.name.includes(point.name)));
    const city = esc(point.name);
    return `<li>${dayIndex >= 0 ? `<a href="#day-${dayIndex + 1}" data-open-day="day-${dayIndex + 1}" aria-label="查看${city}的逐日行程">${city}</a>` : `<span>${city}</span>`}</li>`;
  }).join("");
  const timeline = trip.days.map((day, index) => {
    const flow = `<div class="day-flow"><span class="day-flow-label">当天顺序</span>${day.slots.map((slot, i) => `${i ? '<span class="day-flow-arrow">→</span>' : ''}<span class="day-flow-step"><b>${esc(slot.time)}</b>${esc(slot.name)}</span>`).join("")}</div>`;
    const slots = day.slots.map(slot => { const photo = safeUrl(trip.photoLibrary?.[slot.name] || slot.photo); return `<article class="slot"><div class="slot-when"><span class="period">${esc(slot.period)}</span><strong>${esc(slot.time)}</strong></div><div class="slot-track" aria-hidden="true"></div><div class="slot-card"><div class="slot-photo" data-name="${esc(slot.name)}">${photo ? `<img src="${esc(photo)}" alt="${esc(slot.name)}" loading="lazy" onerror="this.style.display='none'">` : ""}</div><div class="slot-content"><span class="slot-location">此刻所在 / 安排</span><h4>${esc(slot.name)}</h4><p class="slot-review">${text(slot.review)}</p><div class="slot-tags">${[slot.rating, slot.openingHours, slot.ticketPrice, slot.seasonal].filter(Boolean).map(value => `<span class="slot-tag">${esc(value)}</span>`).join("")}</div>${slot.transport ? `<p class="slot-review" style="margin-top:8px"><b>接下来怎么走：</b>${[slot.transport.mode, slot.transport.duration, slot.transport.fare].filter(Boolean).map(esc).join(" · ")}</p>` : ""}${link(slot.actionLink)}</div></div></article>`; }).join("");
    const dining = array(day.dining).map(meal => `<div class="meal"><strong>${esc(meal.meal)} · ${esc(meal.place)}</strong><small>${esc(meal.hours)}</small><div class="dishes">${array(meal.dishes).map(dish => `<span class="dish">${esc(dish.name)} · ${esc(dish.price)}</span>`).join("")}</div></div>`).join("");
    const balance = trip.dayBalance[index];
    const night = array(day.tips).find(tip => String(tip).startsWith("夜宿："))?.split("。")[0] || "";
    return `<article id="day-${index + 1}" class="day card is-collapsed"><div class="day-head"><div class="day-no">${String(index + 1).padStart(2, "0")}</div><div class="day-title"><small>${esc(day.date)} · ${esc(day.weekday)}</small><h3>${esc(day.theme)}</h3></div><button type="button" class="toggle-day" aria-expanded="false" aria-controls="day-${index + 1}-details">查看当天安排</button></div><div class="day-summary"><span class="day-summary-route">${esc(day.drive.route)}</span><span class="day-summary-play">游玩 ${finite(balance.play).toFixed(1)}h</span><span class="day-summary-drive">驾驶 ${finite(balance.drive).toFixed(1)}h</span>${night ? `<span class="day-summary-night">${esc(night)}</span>` : ""}</div><div id="day-${index + 1}-details" class="day-details"><div class="day-meta"><div class="meta-chip"><b>里程</b><br>${esc(day.drive.distance)}</div><div class="meta-chip"><b>交通与补能</b><br>${esc(day.drive.duration)}</div><div class="meta-chip dog-chip"><b>🐾 ${esc(day.dog.status)}</b><br>${esc(day.dog.note)}</div></div>${flow}${array(day.tips).map(tip => String(tip).startsWith("夜宿：") ? String(tip).split("。").slice(1).join("。").trim() : tip).filter(Boolean).map(tip => `<p class="day-tips">${text(tip)}</p>`).join("")}<div class="day-body"><div class="slots">${slots}</div>${array(day.alternatives).map(item => `<div class="alternative"><b>${esc(item.label)}</b> · ${text(item.summary)}</div>`).join("")}${dining ? `<div class="day-extras-head"><b>当天吃什么</b><span>就近穿插，不额外占一段行程</span></div><div class="dining">${dining}</div>` : ""}</div></div></article>`;
  }).join("");
  const slots = {
    DOCUMENT_TITLE: esc(cleanHeroLabel(trip.title)), SOUTH_LINE_CSS: css, HERO_STYLE: safeUrl(hero.imageUrl) ? `style="background-image:linear-gradient(180deg,rgba(5,31,30,.18),rgba(6,29,27,.95)),url('${esc(hero.imageUrl)}')"` : "",
    EYEBROW: esc(hero.eyebrow || "ROAD BOOK"), BADGE: esc(hero.badge || meta.party || "自驾路书"), HERO_TITLE: text(cleanHeroLabel(hero.title || trip.title)), HERO_LEDE: text(hero.lede || meta.pace), ROUTE: text(cleanHeroLabel(hero.route || trip.mapStops.map(point => point.name).join(" → "))),
    HERO_STATS: stats.map(stat => `<div class="stat"><b>${esc(stat.value)}</b><span>${esc(stat.label)}</span></div>`).join(""), DAY_MARK: esc(trip.days.length),
    CHECKLIST: `<ul class="pretrip-todo">${reminders}</ul>`, BRIEF_NOTE: esc(pre.note || "跨地区旅行，临行再核天气和开放信息。"), PRETRIP: preCards,
    ROUTE_DECISION: `<b>${esc(trip.routeDecision.title)}</b><p>${text(trip.routeDecision.text)}</p>`, HEATMAP: heatmap, ROUTE_LEDGER: ledger, TRANSPORT: transport, HOTELS: hotels, HOTEL_COUNT: esc(trip.hotelAreas.length), LEG_COUNT: esc(trip.routeLegs.length),
    SOURCE_STRIP: `<b>数据来源：</b>${array(trip.dataSources).map(source => `${esc(source.name)}（${esc(source.scope)}）`).join("；") || "见文末核验入口"}。路线与价格为快照或估算，出发前重新核实。`,
    DISCLAIMER: text(trip.disclaimer || "行程、开放时间、价格、宠物政策和充电状态均可能变化；预订及出行前请再次核验。"), MAP: mapMarkup(trip.mapStops), MAP_LEGEND: mapLegend, TIMELINE: timeline,
    TIPS: trip.tips.map((tip, index) => `<article class="tip card"><b>${String(index + 1).padStart(2, "0")}</b>${text(tip)}</article>`).join(""),
    SOURCES: trip.sourceLinks.filter(source => safeUrl(source.url)).map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.label)} ↗</a>`).join(""),
    FOOTER: text(hero.footer || `这不是打卡清单，是一份可以删减的路书。\n${meta.dateRange || ""}`), MAP_SCRIPT: mapScript(trip.mapStops)
  };
  const rendered = template.replace(/{{([A-Z_]+)}}/g, (_, name) => {
    if (!(name in slots)) throw new Error(`模板占位符 ${name} 未填充`);
    return slots[name];
  });
  if (/{{[A-Z_]+}}/.test(rendered)) throw new Error("路书模板仍有空占位符");
  return rendered;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) throw new Error("用法：node render-report.mjs <report-data.json> <report.html>");
  writeFileSync(outputPath, renderRoadbook(JSON.parse(readFileSync(inputPath, "utf8"))), "utf8");
  process.stdout.write(`已生成南线同款版式：${outputPath}\n`);
}
