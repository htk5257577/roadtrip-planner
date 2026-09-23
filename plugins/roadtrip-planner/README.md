# Roadtrip Planner for Codex

A Codex-native guided road-trip planner. The first page starts blank and collects departure, destination, ordered must-go places, dates, and departure time. Its bundled searchable location snapshot covers province, prefecture, and county-level divisions; custom scenic spots can also be entered. The webpage then collects preferences, pet and EV constraints; Codex performs the steps that genuinely require reasoning:

1. research and rank optional stops;
2. recalculate the selected route in a reviewable preview;
3. produce and refine the final single-file HTML roadbook.

No OpenAI API key is used. The local server only exchanges page state and results with the **current Codex conversation**. It never launches a second Codex process.

Real reports use the versioned HTML/CSS renderer (`south-line-v2`) and a trip-specific data model; the server rejects free-form HTML or sample data submitted as a real result. The page has no prefilled itinerary or simulated generation shortcut.

In a real report, each destination card can carry a few direct city guides or traveler posts, and a sightseeing time block can carry posts about that exact place. Codex gathers them from publicly accessible pages across travel communities, publicly indexed social posts, and first-hand travel blogs; the planner does not ask for or operate a logged-in browser session. These references are independent of FlyAI hotel/attraction listings. Login-walled and unverified links are omitted, with a visible missing-source state. Personal posts are context for routes and experience, never authority for current opening, prices, or pet-entry rules.

On first launch, the page checks for a 高德 Web Service key, a separate Web JS API key plus securityJsCode, and a FlyAI key. Missing keys open a skippable setup page. Saved keys live in the current user's private local configuration (`~/.config/roadtrip-planner/credentials.json`, mode `0600`), never in the plugin, browser storage, or exported report. `AMAP_MAPS_API_KEY`, `AMAP_JS_API_KEY`, `AMAP_SECURITY_JS_CODE`, and `FLYAI_API_KEY` environment variables are also recognized. The Web Service key supplies verified locations, road paths, distance and time; the JS key plus security code load the draggable and zoomable map. A FlyAI key additionally needs the FlyAI CLI installed; Codex uses the bundled `scripts/flyai-bridge.mjs` helper to read the saved key without putting it in command arguments. Missing providers suppress their respective unverified information. Skipping is for the current page session, so missing keys are offered again next launch.

高德 **Web Service** Key 在服务端用于地理编码和驾车路线 2.0；另需一条 **Web 端 JS API Key** 及其 `securityJsCode` 才能在规划页和最终报告中显示可拖拽、缩放的高德地图。路线里程与驾驶时长只采用 Web Service 道路结果，不使用直线距离或内置快照；任一路段未核验时，全程精确值保持“待核验”。该耗时是查询当时的路网估计，不是对未来节假日拥堵的预测，电车补能另行估算。
When the FlyAI CLI is missing, the setup page shows the optional `npm i -g @fly-ai/flyai-cli` command with copy and recheck controls. It never installs software automatically; if the tool remains unavailable after installation, restart the local server and recheck. Base trip planning does not require this CLI.

## Quick start

From the workspace where the roadbook should be written:

```text
node <this-folder>/scripts/start.mjs
```

Open `http://127.0.0.1:4317` in the Codex browser. In the same Codex turn, keep running `node <this-folder>/scripts/bridge-client.mjs wait` and handle the jobs it returns. The final file is written to:

```text
roadtrip-planner-output/generated-roadtrip-plan.html
```

Keep this whole folder intact when sharing or installing the plugin. A page request is handled only while the launching Codex conversation remains active; use the page's “结束会话” control when finished. See `skills/roadtrip-planner/INSTALL.md` for details.

### Service ownership

Startup reuses the existing service and preserves its workspace and report. It creates a service only when the configured port is unused; it never searches for another port. `CODEX_THREAD_ID` identifies the conversation on every bridge command (or explicitly set `ROADTRIP_SESSION_ID` to the current conversation's stable ID). A different connected conversation is rejected with HTTP 409. Same-conversation reconnects are allowed. Page stop or an idle `bridge-client.mjs disconnect` releases ownership. An idle connection expires after 45 seconds without bridge activity; queued/running work retains ownership until its owner finishes or fails it. Old services without ownership support must be ended in their original conversation before restarting with this version.
