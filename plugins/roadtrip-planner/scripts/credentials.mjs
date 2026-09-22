import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const configDir = resolve(process.env.ROADTRIP_CONFIG_DIR || join(homedir(), ".config", "roadtrip-planner"));
const configPath = join(configDir, "credentials.json");
const flyaiConfigPath = resolve(process.env.ROADTRIP_FLYAI_CONFIG_PATH || join(homedir(), ".flyai", "config.json"));

function readJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function nonempty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function getAmapKey() {
  return nonempty(process.env.AMAP_MAPS_API_KEY) || nonempty(readJson(configPath).amapKey);
}

export function getAmapJsConfig() {
  const stored = readJson(configPath);
  return {
    key: nonempty(process.env.AMAP_JS_API_KEY) || nonempty(stored.amapJsKey),
    securityJsCode: nonempty(process.env.AMAP_SECURITY_JS_CODE) || nonempty(stored.amapSecurityJsCode)
  };
}

export function getFlyaiKey() {
  return nonempty(process.env.FLYAI_API_KEY) || nonempty(readJson(configPath).flyaiKey) || nonempty(readJson(flyaiConfigPath).FLYAI_API_KEY);
}

export function flyaiInstalled() {
  const result = spawnSync("flyai", ["--help"], { stdio: "ignore", timeout: 3_000 });
  return !result.error && result.status === 0;
}

export function credentialStatus() {
  const stored = readJson(configPath);
  const amapSource = nonempty(process.env.AMAP_MAPS_API_KEY) ? "environment" : nonempty(stored.amapKey) ? "saved" : "none";
  const jsConfig = getAmapJsConfig();
  const amapJsSource = nonempty(process.env.AMAP_JS_API_KEY) ? "environment" : nonempty(stored.amapJsKey) ? "saved" : "none";
  const amapSecuritySource = nonempty(process.env.AMAP_SECURITY_JS_CODE) ? "environment" : nonempty(stored.amapSecurityJsCode) ? "saved" : "none";
  const flyaiSource = nonempty(process.env.FLYAI_API_KEY) ? "environment" : nonempty(stored.flyaiKey) ? "saved" : nonempty(readJson(flyaiConfigPath).FLYAI_API_KEY) ? "flyai-cli" : "none";
  const installed = flyaiInstalled();
  return {
    amap: { configured: amapSource !== "none", source: amapSource },
    amapJs: { configured: Boolean(jsConfig.key && jsConfig.securityJsCode), keySource: amapJsSource, securitySource: amapSecuritySource },
    flyai: { configured: flyaiSource !== "none", source: flyaiSource, installed, available: flyaiSource !== "none" && installed }
  };
}

function validateInput(value, label) {
  if (value === null || value === undefined) return;
  if (typeof value !== "string" || value.length > 512 || /[\r\n\x00-\x1f]/.test(value)) {
    throw new Error(`${label}格式不正确`);
  }
}

export function updateCredentials(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("配置格式不正确");
  validateInput(input.amapKey, "高德 Key");
  validateInput(input.amapJsKey, "高德 JS Key");
  validateInput(input.amapSecurityJsCode, "高德 JS 安全密钥");
  validateInput(input.flyaiKey, "飞猪 Key");
  const current = readJson(configPath);
  const next = { ...current };
  for (const [field, value] of [["amapKey", input.amapKey], ["amapJsKey", input.amapJsKey], ["amapSecurityJsCode", input.amapSecurityJsCode], ["flyaiKey", input.flyaiKey]]) {
    if (value === null) delete next[field];
    else if (typeof value === "string" && value.trim()) next[field] = value.trim();
  }
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, configPath);
    chmodSync(configPath, 0o600);
  } catch (error) {
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch {}
    throw error;
  }
  return credentialStatus();
}
