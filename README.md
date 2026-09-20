# Roadtrip Planner for Codex

通过引导式网页确认必去点、日期、偏好、宠物和纯电条件；启动页面的同一段 Codex 对话持续等待，并在生成沿途候选、路线预览、完整路书和文字微调时接手处理。过程显示在 Codex 对话里，无需 OpenAI API Key。

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
- 如需在路线预览中显示真实高德底图与所选地点的图钉，启动本地服务的环境须设置 `AMAP_MAPS_API_KEY`（高德 Web 服务 Key）。这只用于地图定位与图片，不是 OpenAI API Key；缺少时规划流程仍可使用，但地图会明确提示未配置。

网页中普通的路线选择即时更新；第 3 步生成沿途候选、第 4 步生成路线预览、第 5 步生成完整路书，以及成品页的文字微调，会分别把任务交给当前 Codex 对话。第 4 步显示 Codex 核对过的全程和逐日数据，第 5 步才按南线报告的阅读顺序输出单文件 HTML。页面状态目前不会跨刷新保存。此桥接流程需要启动任务持续运行；浏览器不能唤醒已结束的 Codex 任务。

当前评审版暂时预填了杭州—东山县—柳州—恩施—赤壁及时间、同行条件，方便检查地图和交互；可在第一步点击“清空示例”，正式发布前会移除这个调试预填。

## 仓库内容

- `.agents/plugins/marketplace.json`：Codex 市场清单；
- `plugins/roadtrip-planner/.codex-plugin/plugin.json`：插件清单；
- `plugins/roadtrip-planner/skills/roadtrip-planner/`：规划流程；
- `plugins/roadtrip-planner/scripts/server.mjs`：仅监听本机的网页服务；
- `plugins/roadtrip-planner/scripts/bridge-client.mjs`：当前 Codex 会话领取任务和回传结果的本地桥接工具；
- `plugins/roadtrip-planner/assets/roadbook-template.html`：不含个人行程的通用报告结构参考。

不要提交个人 API 凭据、真实路书、临时报告或 `.env` 文件。本仓库不包含这些数据。
