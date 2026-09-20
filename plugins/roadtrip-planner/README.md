# Roadtrip Planner for Codex

A Codex-native guided road-trip planner. The webpage collects hard stops, dates, preferences, pet and EV constraints; Codex then performs the two steps that genuinely require reasoning:

1. research and rank optional stops;
2. generate the final single-file HTML roadbook.

No OpenAI API key is used. The local server invokes the Codex CLI already signed in with the user's ChatGPT account.

## Quick start

From the workspace where the roadbook should be written:

```text
node <this-folder>/scripts/server.mjs
```

Open `http://127.0.0.1:4317` in the Codex browser. The final file is written to:

```text
roadtrip-planner-output/generated-roadtrip-plan.html
```

Keep this whole folder intact when sharing or installing the plugin. See `skills/roadtrip-planner/INSTALL.md` for details.
