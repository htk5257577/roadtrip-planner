# Install Roadtrip Planner

The guided webpage depends on files outside the skill folder, so install or share the **whole plugin package**. Keep these folders together:

- `.codex-plugin/`
- `assets/`
- `scripts/`
- `skills/`

After installing the plugin in Codex, invoke `$roadtrip-planner` or ask to start the interactive road-trip planner. Codex should launch the local server from the workspace where the resulting report should be saved.

For a local test without installing, run this from the desired workspace:

```text
node <plugin-folder>/scripts/start.mjs
```

Then open `http://127.0.0.1:4317` in the Codex browser. Keep the terminal **and the launching Codex turn** running. In that turn, repeatedly run `node <plugin-folder>/scripts/bridge-client.mjs wait` and handle page jobs until the user clicks “结束会话”. A standalone terminal server without an active Codex conversation cannot generate candidates or a report.

For a trusted LAN device, start with `ROADTRIP_LAN=1 node <plugin-folder>/scripts/start.mjs`. Give the user the returned `lanUrl` and `lanAccessCode`; the browser login is username `roadtrip` and password equal to that code. Keep bridge commands on `127.0.0.1`. Set `ROADTRIP_LAN_IP` only if you need to select among local private IPv4 interfaces. The access code changes when the service restarts. LAN access uses HTTP, so never forward this port to the public internet. Provider keys can only be changed from the host computer. If a local-only service already exists, end it in its original Codex conversation before starting LAN mode.

The planner uses the current Codex conversation and does not need an OpenAI API key or a second Codex process. Map, web-search, booking, or travel plugins improve live facts but are optional. Never distribute a copy containing personal map credentials.

At first launch, the page checks four independent local capabilities: 高德 Web Service Key for geocoding and driving routes, 高德 Web JS API Key plus its matching `securityJsCode` for draggable maps, and FlyAI Key/CLI for travel products. Enter any available values or skip; skipped services show explicit unavailable states rather than invented precision. Saved secrets stay per-user on this device and are never included in the plugin or report. “服务设置” can reopen this page later. Environment variables `AMAP_MAPS_API_KEY`, `AMAP_JS_API_KEY`, `AMAP_SECURITY_JS_CODE`, and `FLYAI_API_KEY` remain supported.
If FlyAI CLI is absent, the setup page provides a copyable `npm i -g @fly-ai/flyai-cli` command and a recheck button. Installation is optional and must be done by the user in their terminal; the plugin does not install it automatically. Restart the local server if recheck still cannot find the command after installation.

### Service ownership

Startup reuses the existing service and preserves its workspace and report. It creates a service only when the configured port is unused; it never searches for another port. `CODEX_THREAD_ID` identifies the conversation on every bridge command (or explicitly set `ROADTRIP_SESSION_ID` to the current conversation's stable ID). A different connected conversation is rejected with HTTP 409. Same-conversation reconnects are allowed. Page stop or an idle `bridge-client.mjs disconnect` releases ownership. An idle connection expires after 45 seconds without bridge activity; queued/running work retains ownership until its owner finishes or fails it. Old services without ownership support must be ended in their original conversation before restarting with this version.
