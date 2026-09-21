# Install Roadtrip Planner

The guided webpage depends on files outside the skill folder, so install or share the **whole plugin package**. Keep these folders together:

- `.codex-plugin/`
- `assets/`
- `scripts/`
- `skills/`

After installing the plugin in Codex, invoke `$roadtrip-planner` or ask to start the interactive road-trip planner. Codex should launch the local server from the workspace where the resulting report should be saved.

For a local test without installing, run this from the desired workspace:

```text
node <plugin-folder>/scripts/server.mjs
```

Then open `http://127.0.0.1:4317` in the Codex browser. Keep the terminal **and the launching Codex turn** running. In that turn, repeatedly run `node <plugin-folder>/scripts/bridge-client.mjs wait` and handle page jobs until the user clicks “结束会话”. A standalone terminal server without an active Codex conversation cannot generate candidates or a report.

The planner uses the current Codex conversation and does not need an OpenAI API key or a second Codex process. Map, web-search, booking, or travel plugins improve live facts but are optional. Never distribute a copy containing personal map credentials.

At first launch, the page checks for 高德 Web Service and FlyAI keys. Enter one or both in the local setup page, or skip; skipped services show explicit unavailable states rather than invented precise results. Saved keys are per-user on this device and are not included in the plugin package. You can reopen “服务设置” later. FlyAI real-time queries also require its CLI; if unavailable, the page identifies that separately. Setting an environment variable before starting the server (`AMAP_MAPS_API_KEY` or `FLYAI_API_KEY`) remains supported.
If FlyAI CLI is absent, the setup page provides a copyable `npm i -g @fly-ai/flyai-cli` command and a recheck button. Installation is optional and must be done by the user in their terminal; the plugin does not install it automatically. Restart the local server if recheck still cannot find the command after installation.
