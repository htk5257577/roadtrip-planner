# Roadtrip Planner for Codex

A Codex-native guided road-trip planner. The first page temporarily opens with a labeled sample route and dates for product review; click “清空示例” to start blank. It collects departure, destination, ordered must-go places, dates, and departure time. Its bundled searchable location snapshot covers province, prefecture, and county-level divisions; custom scenic spots can also be entered. The webpage then collects preferences, pet and EV constraints; Codex performs the two steps that genuinely require reasoning:

1. research and rank optional stops;
2. generate the final single-file HTML roadbook.

No OpenAI API key is used. The local server only exchanges page state and results with the **current Codex conversation**. It never launches a second Codex process.

The real AMap preview geocodes selected places and shows every located stop on a map. Set `AMAP_MAPS_API_KEY` (an AMap Web Service key) in the server environment to enable it. This is optional for planning, and the key is never bundled with the plugin or sent to the browser.

## Quick start

From the workspace where the roadbook should be written:

```text
node <this-folder>/scripts/server.mjs
```

Open `http://127.0.0.1:4317` in the Codex browser. In the same Codex turn, keep running `node <this-folder>/scripts/bridge-client.mjs wait` and handle the jobs it returns. The final file is written to:

```text
roadtrip-planner-output/generated-roadtrip-plan.html
```

Keep this whole folder intact when sharing or installing the plugin. A page request is handled only while the launching Codex conversation remains active; use the page's “结束会话” control when finished. See `skills/roadtrip-planner/INSTALL.md` for details.
