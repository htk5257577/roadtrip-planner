#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(pluginRoot, "assets/roadbook-template.html"), "utf8");
const css = readFileSync(join(pluginRoot, "assets/south-line.css"), "utf8");
const reportSchema = JSON.parse(readFileSync(join(pluginRoot, "scripts/schemas/report-data.schema.json"), "utf8"));
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const text = value => esc(value).replace(/\n/g, "<br>");
const cleanHeroLabel = value => String(value ?? "").replace(/\s*[〔【（(]\s*(?:必去|已选|已选定|已加入)\s*[〕】）)]/g, "").trim();
const array = value => Array.isArray(value) ? value : [];
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const safeUrl = value => /^(https?:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(String(value ?? "")) ? String(value) : "";
const safeExternalUrl = value => /^https?:\/\//i.test(String(value ?? "")) ? String(value) : "";
const link = value => value?.url && safeUrl(value.url) ? `<a class="action-link" href="${esc(value.url)}" target="_blank" rel="noopener">${esc(value.label || "查看资料")} ↗</a>` : "";
const isXhsPost = item => { try { const url = new URL(item?.url); return url.protocol === "https:" && (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com")) && /^\/(?:explore|discovery\/item)\/[a-z0-9]+\/?$/i.test(url.pathname) && item.platform === "小红书" && item.evidenceRole === "firstHand"; } catch { return false; } };
const slotKindLabels = { travel:"在路上", charge:"充电补能", visit:"游玩", meal:"用餐", rest:"休息", hotel:"酒店", free:"自由时间", arrival:"行程结束" };

function slotRange(value) {
  const match = /^(次日)?(\d{1,2}):(\d{2})\s*[–—-]\s*(次日)?(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const toMinutes = (nextDay, hour, minute) => {
    const h = Number(hour), m = Number(minute);
    if (h > 24 || m > 59 || h === 24 && m !== 0 || nextDay && h === 24) return null;
    return (nextDay ? 1440 : 0) + h * 60 + m;
  };
  const start = toMinutes(match[1], match[2], match[3]), end = toMinutes(match[4], match[5], match[6]);
  return start !== null && end !== null && end > start && end <= 2880 ? { start, end } : null;
}

function checkDailyTimelines(days, departTime) {
  const [departureHour, departureMinute] = String(departTime).split(":").map(Number);
  const departureMinutes = departureHour * 60 + departureMinute;
  days.forEach((day, dayIndex) => {
    let previousEnd = null;
    day.slots.forEach((slot, index) => {
      const range = slotRange(slot.time);
      if (!range) throw new Error(`${day.date} 第 ${index + 1} 段时间格式无效，请使用 08:00–10:00 等明确起止时间`);
      if (!slot.location?.trim()) throw new Error(`${day.date} 第 ${index + 1} 段缺少所在地点或路段`);
      if (previousEnd !== null && range.start !== previousEnd) throw new Error(`${day.date} ${day.slots[index - 1].time} 与 ${slot.time} 之间有空档或重叠，请补齐用餐、转场、休息等时段`);
      if (index === 0 && range.start > 9 * 60 && !(dayIndex === 0 && range.start === departureMinutes)) throw new Error(`${day.date} 的时间轴没有从早晨活动开始；首日可从实际出发时间开始`);
      previousEnd = range.end;
    });
    const last = day.slots.at(-1);
    if (dayIndex < days.length - 1 && (previousEnd < 21 * 60 || !["rest", "hotel"].includes(last.kind))) throw new Error(`${day.date} 的逐日行程必须安排到睡前，并以住宿或休息收尾`);
    if (dayIndex === days.length - 1 && previousEnd < 21 * 60 && last.kind !== "arrival") throw new Error(`${day.date} 的行程在傍晚前中断；若已返抵终点，请用抵达时间块结束`);
  });
}

function validateSchema(value, schema, root = reportSchema, path = "report") {
  if (schema.$ref) return validateSchema(value, schema.$ref.split("/").slice(1).reduce((node, key) => node[key], root), root, path);
  const types = array(schema.type);
  const matches = type => type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "object" ? value && typeof value === "object" && !Array.isArray(value) : type === "number" ? typeof value === "number" && Number.isFinite(value) : type === "integer" ? Number.isInteger(value) : typeof value === type;
  if (types.length && !types.some(matches)) throw new Error(`${path} 类型不符合最终路书 schema`);
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${path} 必须为 ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} 不在允许值内`);
  if (typeof value === "string") {
    if (schema.minLength && value.length < schema.minLength) throw new Error(`${path} 不能为空`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) throw new Error(`${path} 格式不正确`);
    if (schema.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${path} 不是有效日期`);
    if (schema.format === "date-time" && !Number.isFinite(Date.parse(value))) throw new Error(`${path} 不是有效时间`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) throw new Error(`${path} 条目不足`);
    if (schema.maxItems && value.length > schema.maxItems) throw new Error(`${path} 条目过多`);
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, root, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`${path} 缺少 ${key}`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) validateSchema(value[key], child, root, `${path}.${key}`);
  }
}

function referenceBlock(items, sample, title, compact = false, showEmpty = false) {
  const references = array(items).filter(item => item && typeof item === "object" && (item.title || item.label) && isXhsPost(item));
  if (!references.length) return "";
  const cards = references.map(item => {
    const title = esc(item.title || item.label);
    const meta = [item.type, item.platform, item.publishedAt, item.publicAccess === false ? "登录后查看" : item.checkedAt ? `公开核验 ${String(item.checkedAt).slice(0,10)}` : ""].filter(Boolean).map(esc).join(" · ");
    const body = `<span class="reference-meta">${meta || (sample ? "模拟参考" : "旅行参考")}</span><strong>${title}${!sample && safeExternalUrl(item.url) ? " ↗" : ""}</strong>${item.note ? `<span class="reference-note">${text(item.note)}</span>` : ""}`;
    return !sample && safeExternalUrl(item.url) ? `<a class="reference-item" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${body}</a>` : sample ? `<div class="reference-item is-sample">${body}</div>` : "";
  }).filter(Boolean).join("");
  if (!cards) return "";
  return `<div class="reference-block${compact ? " reference-block--compact" : ""}"><div class="reference-heading"><b>${esc(title)}</b><span>${sample ? "内容示例 · 不可跳转" : "小红书实走参考；准入与价格以官方为准"}</span></div><div class="reference-items">${cards}</div></div>`;
}

function checkData(trip) {
  validateSchema(trip, reportSchema);
  if (!trip || typeof trip !== "object" || Array.isArray(trip)) throw new Error("路书数据必须是 JSON 对象");
  for (const field of ["title", "startDate", "meta", "preTrip", "routeDecision"]) {
    if (!trip[field]) throw new Error(`路书数据缺少 ${field}`);
  }
  for (const field of ["reminders", "dayBalance", "routeLegs", "hotelAreas", "mapStops", "stopSummaries", "days", "tips", "sourceLinks"]) {
    if (!Array.isArray(trip[field]) || !trip[field].length) throw new Error(`路书数据缺少 ${field}`);
  }
  if (trip.dayBalance.length !== trip.days.length) throw new Error("热力图天数必须与逐日时间轴一致");
  if (!trip.days.every(day => Array.isArray(day.slots) && day.slots.length && day.drive && day.dog)) throw new Error("每天必须有时间块、路线和同行信息");
  if (!trip.stopSummaries.every(stop => typeof stop.city === "string" && stop.city.trim() && typeof stop.stay === "string" && typeof stop.note === "string" && Array.isArray(stop.focus) && stop.focus.length)) throw new Error("停留重点缺少城市、时长或体验内容");
  if (!trip.stopSummaries.every(stop => Array.isArray(stop.tags) && stop.tags.length >= 2 && Array.isArray(stop.guides))) throw new Error("停留重点缺少规范标签或攻略数组");
  if (!trip.days.every(day => day.slots.every(slot => Array.isArray(slot.references)))) throw new Error("每个时间块都必须明确提供攻略引用数组");
  checkDailyTimelines(trip.days, trip.meta.departTime);
  if (!trip.mapStops.every(point => typeof point.name === "string" && (!(trip.sample === true || trip.verifiedRoad?.complete) || typeof point.lat === "number" && typeof point.lng === "number" && Number.isFinite(point.lat) && Number.isFinite(point.lng)))) throw new Error("地图落点缺少坐标");
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

function mapScript(points, enabled, verifiedRoad) {
  const data = JSON.stringify({ points: enabled ? points.map(point => ({ name:String(point.name), lat:finite(point.lat), lng:finite(point.lng) })) : [], paths: enabled ? array(verifiedRoad?.legs).map(leg => array(leg.path)) : [] }).replace(/</g, "\\u003c");
  return `<script>
  window.addEventListener('load',async function(){
    if(!${enabled}||location.protocol==='file:')return;
    var route=${data},host=document.getElementById('map'),fallback=host.innerHTML;
    try { var response=await fetch('/api/map/js-config',{cache:'no-store'}),config=await response.json();if(!response.ok||!config.ok)throw new Error(config.error||'未配置地图');
      window._AMapSecurityConfig={['security'+'JsCode']:config['security'+'JsCode']};
      await new Promise(function(resolve,reject){var script=document.createElement('script');script.src='https://webapi.amap.com/maps?v=2.0&key='+encodeURIComponent(config.key);script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});
      var map=new AMap.Map(host,{zoom:5,viewMode:'2D'}),bounds=[];
      route.points.forEach(function(p,i){var pos=[p.lng,p.lat];bounds.push(pos);new AMap.Marker({map:map,position:pos,label:{content:(i+1)+'. '+p.name,direction:'top'}})});
      route.paths.forEach(function(path){if(path.length){path.forEach(function(p){bounds.push(p)});new AMap.Polyline({map:map,path:path,strokeColor:'#ca3e2d',strokeWeight:5,strokeOpacity:.82})}});
      if(bounds.length)map.setFitView(null,false,[44,44,44,44]);
    } catch(error) { host.innerHTML=fallback; }
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
  const sample=trip.sample===true;
  const amap=sample||trip.capabilities?.amap===true&&trip.verifiedRoad?.complete===true, amapJs=sample||trip.capabilities?.amapJs===true, flyai=sample||trip.capabilities?.flyai===true;
  const hero = trip.hero || {}, meta = trip.meta || {}, pre = trip.preTrip || {};
  const distanceMatch = String(meta.distance || "").match(/([\d,.]+)\s*km/i);
  const distanceValue = distanceMatch ? `≈${Math.round(Number(distanceMatch[1].replace(/,/g, ""))).toLocaleString("zh-CN")}` : "待核验";
  const compactRange = String(meta.dateRange || "").replace(/\b\d{4}-(?=\d{2}-\d{2})/g, "").replace(/-(?=\d{2}\b)/g, "/");
  const stats = (array(hero.stats).length === 3 ? hero.stats : [
    { value: String(trip.days.length), label: `天 · ${compactRange}` },
    { value: distanceValue, label: "公里 · 道路与排程估算" },
    { value: `${trip.dayBalance.reduce((sum, day) => sum + finite(day.play), 0).toFixed(1)}h`, label: "有效游玩时间" }
  ]).map(stat => !amap && /公里|里程|\bkm\b/i.test(stat.label) ? { value:"待核验",label:"道路数据未接入" } : stat);
  const reminders = trip.reminders.map(item => `<li class="todo-item"><input type="checkbox" aria-label="完成：${esc(item.item)}"><span class="todo-deadline">${esc(item.deadline || `提前${item.leadDays ?? "?"}天`)}</span><span class="todo-text">${esc(item.item)}</span></li>`).join("");
  const preCards = [
    ["🌦", "天气跨度", pre.weather?.summary], ["🌀", "天气预案", pre.weather?.typhoon],
    ["🧥", "同行装备", pre.packing], ["💳", "支付", pre.payment],
    ["📱", "必备 App", array(pre.apps).join(" · ")], ["🎟", "预订顺序", pre.ticketTip]
  ].map(([icon, title, body]) => `<article class="info-card card"><div class="icon">${icon}</div><h3>${title}</h3><p>${text(body)}</p></article>`).join("");
  const paceDays = trip.dayBalance;
  const maxHours = Math.max(6, Math.ceil(Math.max(...paceDays.flatMap(day => [finite(day.play), finite(day.drive)]))));
  const totals = {
    play: paceDays.reduce((sum, day) => sum + finite(day.play), 0).toFixed(1),
    drive: paceDays.reduce((sum, day) => sum + finite(day.drive), 0).toFixed(1)
  };
  const paceRows = paceDays.map((day, index) => {
    const metric = (key, label) => {
      const hours = finite(day[key]);
      const width = Math.max(0, Math.min(100, hours / maxHours * 100));
      return `<div class="pace-metric pace-metric--${key}"><span>${label}</span><div class="pace-bar" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></div><b>${hours.toFixed(1)}h</b></div>`;
    };
    return `<a class="pace-day-row" href="#day-${index + 1}" aria-label="${esc(day.date)} ${esc(day.label)}：游玩 ${finite(day.play).toFixed(1)} 小时，驾驶 ${finite(day.drive).toFixed(1)} 小时，查看当天安排"><div class="pace-day-date"><b>${esc(day.date)}</b><span>${esc(day.label)}</span></div><div class="pace-day-bars">${metric("play", "游玩")}${metric("drive", "驾驶")}</div><span class="pace-day-open">查看当天</span></a>`;
  }).join("");
  const heatmap = `<div class="pace-chart-intro"><span>每天独占一行，上下对照游玩与驾驶</span><b>统一刻度 0–${maxHours}h</b></div><div class="pace-legend"><span class="pace-legend-play">游玩合计 ${totals.play}h</span><span class="pace-legend-drive">驾驶合计 ${totals.drive}h</span></div><div class="pace-day-list">${paceRows}</div><p class="pace-chart-note">每一行都是一天，两条线共用同一刻度；点击任意日期可跳到当天安排。</p>`;
  const ledger = trip.routeLegs.map(leg => `<div class="leg"><div class="leg-date">${esc(leg.date)}</div><div class="leg-route"><b>${esc(leg.route)}</b><span>${amap?[leg.distance, leg.duration, leg.buffer, leg.toll].filter(Boolean).map(esc).join(" · "):"道路里程与耗时待核验"}</span></div></div>`).join("");
  const transport = array(trip.transport).map(item => `<article class="transport-card card"><span class="status-chip">${esc(item.status || "需核验")}</span><h3>${esc(item.title)}</h3><p>${text(item.detail)}</p></article>`).join("") || `<article class="transport-card card"><span class="status-chip">转场</span><h3>按路线账本执行</h3><p>${text(meta.transportNote || "道路、补能和特殊交通以临行核验为准。")}</p></article>`;
  const hotels = trip.hotelAreas.map(area => { const options=array(area.options); const content=!flyai||area.queryStatus==='not-configured'?'<p class="source-pending">未接入飞猪；具体酒店、房价与预订入口暂不展示。</p>':area.queryStatus==='unavailable'||!options.length?'<p class="source-pending">飞猪本次查询未返回可核验住宿结果；仅保留住宿区域建议。</p>':options.map(option => `<div class="hotel-option"><div class="hotel-option-head"><strong>${esc(option.tier)}</strong><span>${esc(option.priceRange)}</span></div><h4>${esc(option.name)}</h4><p>${text(option.note)}</p><small>飞猪查询 · ${esc(String(option.queriedAt).slice(0,10))}</small>${link(option.actionLink)}</div>`).join(""); return `<article class="hotel-area card"><h3>${esc(area.area)}</h3><p>${text(area.reason)}</p><div class="hotel-options">${content}</div></article>`; }).join("");
  const mapLegend = trip.mapStops.map((point, index) => {
    const dayIndex = index === trip.mapStops.length - 1 ? trip.days.length - 1 : trip.days.findIndex(day => day.theme.includes(point.name) || day.drive.route.includes(point.name) || day.slots.some(slot => slot.name.includes(point.name)));
    const city = esc(point.name);
    return `<li>${dayIndex >= 0 ? `<a href="#day-${dayIndex + 1}" data-open-day="day-${dayIndex + 1}" aria-label="查看${city}的逐日行程">${city}</a>` : `<span>${city}</span>`}</li>`;
  }).join("");
  const stopOverview = trip.stopSummaries.map(stop => {
    const firstDay = trip.days.findIndex(day => day.theme.includes(stop.city) || day.drive.route.includes(stop.city) || day.slots.some(slot => slot.name.includes(stop.city)));
    const focus = stop.focus.map(item => `<li>${esc(item)}</li>`).join("");
    const guides = referenceBlock(stop.guides, sample, "去之前看看", false, true);
    return `<article class="stop-card card"><div class="stop-top"><div><h3>${esc(stop.city)}</h3><p class="stop-role">${esc(stop.stay)}</p></div><div class="stop-duration"><b>${esc(stop.playHours ?? "—")}h</b><span>建议游玩</span></div></div><ul class="stop-focus">${focus}</ul><p class="stop-note">${text(stop.note)}</p><div class="stop-foot"><small>${esc(stop.pet || "具体准入出发前核验")}</small>${firstDay >= 0 ? `<a href="#day-${firstDay + 1}" data-open-day="day-${firstDay + 1}">查看逐日安排 ↗</a>` : ""}</div>${guides}</article>`;
  }).join("");
  const timeline = trip.days.map((day, index) => {
    const flow = `<div class="day-flow"><span class="day-flow-label">当天顺序</span>${day.slots.map((slot, i) => `${i ? '<span class="day-flow-arrow">→</span>' : ''}<span class="day-flow-step"><b>${esc(slot.time)}</b>${esc(slot.name)}</span>`).join("")}</div>`;
    const slots = day.slots.map(slot => { const photo = safeUrl(slot.photo), productVerified=flyai&&slot.productQueryStatus==='verified', productNote=slot.productQueryStatus==='unavailable'?'<p class="source-pending">飞猪本次未返回可核验的景点产品；票价与预订入口不展示。</p>':slot.productQueryStatus==='not-configured'?'<p class="source-pending">未接入飞猪；景点票价与预订入口暂不展示。</p>':''; return `<article class="slot"><div class="slot-when"><span class="period">${esc(slot.period)}</span><strong>${esc(slot.time)}</strong></div><div class="slot-track" aria-hidden="true"></div><div class="slot-card${photo?"":" no-photo"}">${photo ? `<div class="slot-photo" data-name="${esc(slot.name)}"><img src="${esc(photo)}" alt="${esc(slot.name)}" loading="lazy" onerror="this.closest('.slot-card').classList.add('no-photo');this.parentElement.remove()"><small>图片：<a href="${esc(slot.photoSourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(slot.photoCredit)}</a></small></div>` : ""}<div class="slot-content"><span class="slot-location">${esc(slotKindLabels[slot.kind])} · ${esc(slot.location)}</span><h4>${esc(slot.name)}</h4><p class="slot-review">${text(slot.review)}</p><div class="slot-tags">${[slot.rating, slot.openingHours, productVerified?slot.ticketPrice:null, slot.seasonal].filter(Boolean).map(value => `<span class="slot-tag">${esc(value)}</span>`).join("")}</div>${slot.transport ? `<p class="slot-review" style="margin-top:8px"><b>接下来怎么走：</b>${[slot.transport.mode, amap?slot.transport.duration:null, slot.transport.fare].filter(Boolean).map(esc).join(" · ")}</p>` : ""}${productVerified?link(slot.actionLink):""}${productNote}${referenceBlock(slot.references, sample, "去过的人怎么说", true, true)}</div></div></article>`; }).join("");
    const dining = array(day.dining).map(meal => `<div class="meal"><strong>${esc(meal.meal)} · ${esc(meal.place)}</strong><small>${esc(meal.hours)}</small><div class="dishes">${array(meal.dishes).map(dish => `<span class="dish">${esc(dish.name)} · ${esc(dish.price)}</span>`).join("")}</div></div>`).join("");
    const balance = trip.dayBalance[index];
    const comfortLimit=Number(meta.dailyComfortDriveHours);
    const excess=amap&&Number.isFinite(day.drive.roadHours)&&comfortLimit>0?day.drive.roadHours-comfortLimit:0;
    const comfortWarning=excess>0?`<p class="day-tips" role="note" style="color:#ad4834">驾驶超出舒适目标 ${excess.toFixed(1)}h（目标 ${comfortLimit}h，不含补能）。可调整顺序或拆分转场；请查看当天建议。</p>`:'';
    const night = array(day.tips).find(tip => String(tip).startsWith("夜宿："))?.split("。")[0] || "";
    return `<article id="day-${index + 1}" class="day card is-collapsed"><div class="day-head"><div class="day-no">${String(index + 1).padStart(2, "0")}</div><div class="day-title"><small>${esc(day.date)} · ${esc(day.weekday)}</small><h3>${esc(day.theme)}</h3></div><button type="button" class="toggle-day" aria-expanded="false" aria-controls="day-${index + 1}-details">查看当天安排</button></div><div class="day-summary"><span class="day-summary-route">${esc(day.drive.route)}</span><span class="day-summary-play">游玩 ${finite(balance.play).toFixed(1)}h</span><span class="day-summary-drive">驾驶 ${finite(balance.drive).toFixed(1)}h（计划）</span><span class="day-summary-buffer">机动 ${finite(balance.buffer).toFixed(1)}h</span>${night ? `<span class="day-summary-night">${esc(night)}</span>` : ""}</div>${comfortWarning}<div id="day-${index + 1}-details" class="day-details"><div class="day-meta"><div class="meta-chip"><b>里程</b><br>${amap?esc(day.drive.distance):"待核验"}</div><div class="meta-chip"><b>交通与补能</b><br>${amap?esc(day.drive.duration):"道路耗时待核验"}</div><div class="meta-chip dog-chip"><b>🐾 ${esc(day.dog.status)}</b><br>${esc(day.dog.note)}</div></div>${flow}${array(day.tips).map(tip => String(tip).startsWith("夜宿：") ? String(tip).split("。").slice(1).join("。").trim() : tip).filter(Boolean).map(tip => `<p class="day-tips">${text(tip)}</p>`).join("")}<div class="day-body"><div class="slots">${slots}</div>${array(day.alternatives).map(item => `<div class="alternative"><b>${esc(item.label)}</b> · ${text(item.summary)}</div>`).join("")}${dining ? `<div class="day-extras-head"><b>当天吃什么</b><span>就近穿插，不额外占一段行程</span></div><div class="dining">${dining}</div>` : ""}</div></div></article>`;
  }).join("");
  const slots = {
    DOCUMENT_TITLE: esc(cleanHeroLabel(trip.title)), MAP_STYLES: amapJs?'<link rel="preconnect" href="https://webapi.amap.com">':'', SOUTH_LINE_CSS: css, HERO_STYLE: safeUrl(hero.imageUrl) ? `style="background-image:linear-gradient(180deg,rgba(5,31,30,.18),rgba(6,29,27,.95)),url('${esc(hero.imageUrl)}')"` : "",
    EYEBROW: esc(hero.eyebrow || "ROAD BOOK"), BADGE: esc(hero.badge || meta.party || "自驾路书"), HERO_TITLE: text(cleanHeroLabel(hero.title || trip.title)), HERO_LEDE: text(hero.lede || meta.pace), ROUTE: text(cleanHeroLabel(hero.route || trip.mapStops.map(point => point.name).join(" → "))),
    HERO_STATS: stats.map(stat => `<div class="stat"><b>${esc(stat.value)}</b><span>${esc(stat.label)}</span></div>`).join(""), DAY_MARK: esc(trip.days.length),
    SAMPLE_NOTICE: sample ? '<div class="sample-notice" role="note"><b>模拟样板</b><span>下方地点、时长、照片、住宿和价格均为版式示例，未调用 Codex、地图或预订服务；请勿据此出行。</span></div>' : "",
    CHECKLIST: `<ul class="pretrip-todo">${reminders}</ul>`, BRIEF_NOTE: esc(pre.note || "跨地区旅行，临行再核天气和开放信息。"), PRETRIP: preCards,
    ROUTE_DECISION: `<b>${esc(trip.routeDecision.title)}</b><p>${text(trip.routeDecision.text)}</p>`, HEATMAP: heatmap, ROUTE_LEDGER: ledger, TRANSPORT: transport, HOTELS: hotels, HOTEL_COUNT: esc(trip.hotelAreas.length), LEG_COUNT: esc(trip.routeLegs.length),
    SOURCE_STRIP: `<b>数据来源：</b>${array(trip.dataSources).filter(source => (amap || !/高德|AMap/i.test(source.name)) && (flyai || !/飞猪|FlyAI/i.test(source.name))).map(source => `${esc(source.name)}（${esc(source.scope)}）`).join("；") || "见文末核验入口"}。${!amap?'未接入高德，地图与道路精确数据不展示。':''}${!flyai?'未接入飞猪，酒店和景点实时价格不展示。':''}出发前重新核实。`,
    DISCLAIMER: text(trip.disclaimer || "行程、开放时间、价格、宠物政策和充电状态均可能变化；预订及出行前请再次核验。"), MAP: amap?mapMarkup(trip.mapStops):'<div class="map-offline"><b>未接入高德，地图落点暂不展示</b><p>下方仍保留途经城市顺序。</p></div>', MAP_LEGEND: mapLegend, STOP_OVERVIEW: stopOverview, TIMELINE: timeline,
    TIPS: trip.tips.map((tip, index) => `<article class="tip card"><b>${String(index + 1).padStart(2, "0")}</b>${text(tip)}</article>`).join(""),
    SOURCES: trip.sourceLinks.filter(source => safeUrl(source.url)).map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.label)} ↗</a>`).join(""),
    FOOTER: text(hero.footer || `这不是打卡清单，是一份可以删减的路书。\n${meta.dateRange || ""}`), MAP_SCRIPT: mapScript(trip.mapStops,amap&&amapJs,trip.verifiedRoad)
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
