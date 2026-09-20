# Roadtrip Planner for Codex

通过引导式网页确认必去点、日期、偏好、宠物和纯电条件；启动页面的同一段 Codex 对话持续等待，并在生成沿途候选和最终路书时接手处理。过程显示在 Codex 对话里，无需 OpenAI API Key。

## 从 GitHub 安装

本仓库是一个 Codex 插件市场，插件位于 `plugins/roadtrip-planner/`。仓库上传到 GitHub 后：

1. 在 Codex CLI 输入 `/plugins`，选择 **Add Marketplace**，填入 GitHub 仓库地址或 `OWNER/REPO`。使用私有仓库时，安装者需要相应的 GitHub 访问权限。
2. 在新市场中找到 **Roadtrip Planner**，选择安装。
3. 开始一个新的本地 Codex 任务，说：“使用 roadtrip-planner，在当前工作目录启动引导式自驾规划器，并打开页面。”

Codex 会在本机启动 `127.0.0.1:4317` 页面，并在同一轮对话中等待页面操作。不要在网页提交任务前结束这轮对话；完成后可在网页点击“结束会话”。生成的独立 HTML 位于当前工作目录的 `roadtrip-planner-output/generated-roadtrip-plan.html`。

## 运行条件

- 已登录的本地 Codex 桌面应用或 CLI；
- 可用的 Node.js；
- 能运行本地服务并写入当前工作目录的权限。

网页中普通的路线选择即时更新，只有“生成沿途候选”和“生成完整路书”会把任务交给当前 Codex 对话。页面状态目前不会跨刷新保存。此桥接流程需要启动任务持续运行；浏览器不能唤醒已结束的 Codex 任务。

## 仓库内容

- `.agents/plugins/marketplace.json`：Codex 市场清单；
- `plugins/roadtrip-planner/.codex-plugin/plugin.json`：插件清单；
- `plugins/roadtrip-planner/skills/roadtrip-planner/`：规划流程；
- `plugins/roadtrip-planner/scripts/server.mjs`：仅监听本机的网页服务；
- `plugins/roadtrip-planner/scripts/bridge-client.mjs`：当前 Codex 会话领取任务和回传结果的本地桥接工具；
- `plugins/roadtrip-planner/assets/roadbook-template.html`：不含个人行程的通用报告结构参考。

不要提交个人 API 凭据、真实路书、临时报告或 `.env` 文件。本仓库不包含这些数据。
