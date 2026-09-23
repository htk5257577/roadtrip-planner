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
- 可在首次设置页分别填写高德 **Web 服务 Key**（地点定位、驾车道路、里程与时长）、**Web 端 JS API Key** 和对应的 **securityJsCode**（可拖拽、缩放的地图）。也可分别通过 `AMAP_MAPS_API_KEY`、`AMAP_JS_API_KEY`、`AMAP_SECURITY_JS_CODE` 环境变量提供。缺少 Web 服务 Key 时不显示未经核验的点位与道路；缺少 Web 端 Key 或安全密钥时不展示交互地图。无需 OpenAI API Key。

网页中普通的路线选择即时更新；第 3 步生成沿途候选、第 4 步生成路线预览、第 5 步生成完整路书，以及成品页的文字微调，会分别把任务交给当前 Codex 对话。第 4 步显示 Codex 核对过的全程和逐日数据；第 5 步先生成行程数据，再由固定渲染器输出与南线报告同版式的单文件 HTML，避免 AI 自由发挥造成排版漂移。非密钥的规划状态会在当前浏览器会话中自动恢复；服务密钥只保存在本机私有配置中。此桥接流程需要启动任务持续运行；浏览器不能唤醒已结束的 Codex 任务。

完整路书中的城市攻略和景点体验帖从无需登录即可打开的公开网页检索，可覆盖马蜂窝、携程游记/攻略、穷游、Tripadvisor、公开索引的社交帖子及个人游记等来源；不要求用户登录平台或连接已登录浏览器。登录墙、无法打开或无法核验的帖子会被跳过，找不到可靠来源时保留空状态，不编造链接。飞猪仍只负责已配置时的酒店、景点产品和实时价格等信息。

正式版本不预填路线、日期或旅行偏好；用户从空白基础框架开始。

## 仓库内容

- `.agents/plugins/marketplace.json`：Codex 市场清单；
- `plugins/roadtrip-planner/.codex-plugin/plugin.json`：插件清单；
- `plugins/roadtrip-planner/skills/roadtrip-planner/`：规划流程；
- `plugins/roadtrip-planner/scripts/server.mjs`：仅监听本机的网页服务；
- `plugins/roadtrip-planner/scripts/bridge-client.mjs`：当前 Codex 会话领取任务和回传结果的本地桥接工具；
- `plugins/roadtrip-planner/assets/roadbook-template.html` 与 `assets/south-line.css`：不含个人行程或密钥的固定南线版式。
- `plugins/roadtrip-planner/scripts/render-report.mjs`：把 Codex 写出的行程数据渲染为统一版式，并用于微调后的重新生成。

不要提交个人 API 凭据、真实路书、临时报告或 `.env` 文件。本仓库不包含这些数据。
