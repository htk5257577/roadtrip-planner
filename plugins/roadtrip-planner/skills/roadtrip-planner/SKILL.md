---
name: roadtrip-planner
description: Plan multi-stop self-drive trips from locked must-go places, preference keywords, pet/EV constraints, and reviewable optional stops; use when the user wants the Codex-native interactive planner or a detailed fixed-format HTML roadbook without an OpenAI API key.
---

# Roadtrip Planner

Turn a few non-negotiable stops into a reviewable route and a compact roadbook. Preserve the user's must-go places as hard constraints; never silently replace or remove them.

## Choose the mode

- **Codex-native interactive planner:** launch the plugin-local server at `../../scripts/server.mjs` from the user's chosen workspace, then open `http://127.0.0.1:4317` in the Codex browser. The page calls the locally installed, ChatGPT-authenticated Codex CLI at the candidate and final-report checkpoints. It never requires an OpenAI API key.
- **Direct planning:** conduct the same decision flow in conversation, then produce the fixed-format plan. Read [references/planning-contract.md](references/planning-contract.md) before researching or scheduling.
- **Existing-plan revision:** load the current plan, preserve confirmed decisions, and change only what the user asks. Do not narrate discarded earlier decisions in the finished roadbook.

## Start the interactive planner

1. Resolve the plugin root from this skill directory; the server is two levels up at `scripts/server.mjs`.
2. Start it in a persistent terminal from the workspace where the report should be written:

   ```text
   node <plugin-root>/scripts/server.mjs
   ```

3. Confirm the terminal reports both the local URL and `Codex: ready`.
4. Open `http://127.0.0.1:4317` in the Codex browser. Do not open the bundled page through `file://`; that mode intentionally cannot invoke Codex.
5. Keep the server running while the user works. The generated report is written to `roadtrip-planner-output/generated-roadtrip-plan.html` under the launch workspace.

If the server reports that Codex is unavailable, check for a signed-in Codex desktop CLI. Prefer the desktop-bundled executable on macOS when a stale `codex` executable in `PATH` is broken. Do not ask for or store an OpenAI API key.

The page runs Codex only at deliberate checkpoints:

- `让 Codex 生成沿途候选` researches and returns reviewable optional stops;
- local add/backup/exclude decisions do not start another model run;
- `让 Codex 生成完整路书` starts a new final planning run using the complete reviewed state.

## Planning contract

1. Treat start, end, dates, must-go places, vehicle, pet, and explicit exclusions as hard constraints.
2. Ask only questions whose answers can materially change the route. Resolve at most three short questions at a time.
3. Suggest optional stops between hard anchors. Show why each is worth the time, the extra distance/time, the recommended stay, and pet/charging implications.
4. Keep optional stops visibly separate as `加入`, `备选`, `排除`, or `待决定`. Obtain review before promoting them into the route.
5. Optimize for quality of time, not landmark count. Avoid several hours of driving for a brief check-in unless the user explicitly wants it.
6. Separate genuine destinations from flexible rest corridors. Do not turn an uncertain overnight break into a destination card.
7. For EV trips, include charging buffers in drive-time estimates and identify risky charging segments. For pet trips, verify access, transport, heat, boarding, and accommodation constraints rather than assuming “outdoor” means pet-friendly.
8. If current facts matter, verify them with the best available route, web, map, booking, or travel tools. State uncertainty and date-sensitive caveats. The skill must still work without any specific plugin.
9. Never embed personal API keys in a shareable skill or exported report. Live maps are optional enhancement; the bundled schematic map is the portable fallback.

## Candidate decisions

Rank candidates using the user's interests, detour cost, usable play time, novelty versus other stops, pet friction, EV friction, seasonal fit, and crowd risk. A famous place may still rank first; “not following trends” is not a rule against well-known destinations.

For each candidate, give a compact decision block:

- role in the route;
- core experience and recommended duration;
- incremental detour and driving burden;
- pet/EV notes;
- overlap with existing stops;
- verdict and confidence.

## Fixed output

Use this order unless the user asks otherwise:

1. route verdict and the one-line route;
2. bookings and decisions that must happen before departure;
3. each real destination: duration, core value, and precise activity blocks;
4. drive/play heat view;
5. full route map or portable schematic fallback;
6. daily time axis;
7. every planned accommodation area;
8. pet, EV, weather, crowd, and cancellation notes;
9. sources and freshness notes when research was used.

Keep the final plan concise, scannable, and free of planning-history chatter. Make exact versus estimated numbers visually distinct.

## Bundled interface

`assets/roadtrip-planner-demo.html` is served by the local plugin server and has three layouts switchable through `?variant=atlas`, `?variant=guide`, and `?variant=timeline`. It keeps the active page state in memory, exposes WebMCP tools when the host supports them, and sends explicit candidate/report requests to the locally authenticated Codex engine. Page-only route previews remain estimates; the final report must distinguish them from facts verified by Codex and travel tools.
