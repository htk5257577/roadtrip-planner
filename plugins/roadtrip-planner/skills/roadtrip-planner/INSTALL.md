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

Then open `http://127.0.0.1:4317` in the Codex browser. Keep the terminal running until planning is complete.

The planner uses the ChatGPT-authenticated Codex CLI and does not need an OpenAI API key. Map, web-search, booking, or travel plugins improve live facts but are optional. Never distribute a copy containing personal map credentials.
