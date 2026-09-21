#!/usr/bin/env node

import { spawn } from "node:child_process";
import { getFlyaiKey } from "./credentials.mjs";

const key = getFlyaiKey();
if (!key) {
  process.stderr.write("未配置飞猪 Key；不查询酒店、景点实时信息。\n");
  process.exitCode = 2;
} else {
  const child = spawn("flyai", process.argv.slice(2), {
    env: { ...process.env, FLYAI_API_KEY: key },
    stdio: "inherit",
    shell: false
  });
  child.on("error", () => {
    process.stderr.write("未找到 FlyAI 命令行工具；飞猪实时信息不可用。\n");
    process.exitCode = 2;
  });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
