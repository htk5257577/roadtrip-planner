# Roadtrip Planner for Codex

A Codex-native guided road-trip planner. The first page starts blank and collects departure, destination, ordered must-go places, dates, and departure time. Its bundled searchable location snapshot covers province, prefecture, and county-level divisions; custom scenic spots can also be entered. The webpage then collects preferences, pet and EV constraints; Codex performs the steps that genuinely require reasoning:

1. research and rank optional stops;
2. recalculate the selected route in a reviewable preview;
3. produce and refine the final single-file HTML roadbook.

No OpenAI API key is used. The local server only exchanges page state and results with the **current Codex conversation**. It never launches a second Codex process.

Real reports use the versioned HTML/CSS renderer (`south-line-v2`) and a trip-specific data model; the server rejects free-form HTML or sample data submitted as a real result. The page has no prefilled itinerary or simulated generation shortcut.

In a real report, each destination card can carry a few direct city guides or traveler posts, and a sightseeing time block can carry posts about that exact place. Codex gathers and checks those sources during final-plan generation or refinement; they are independent of FlyAI hotel/attraction listings. Unverified links are omitted, with a visible missing-source state. Personal posts are context for routes and experience, never authority for current opening, prices, or pet-entry rules.

On first launch, the page checks for a 高德 Web Service key and a FlyAI key. Missing keys open a skippable setup page. Saved keys live in the current user's private local configuration (`~/.config/roadtrip-planner/credentials.json`, mode `0600`), never in the plugin, browser storage, or exported report. Existing `AMAP_MAPS_API_KEY` / `FLYAI_API_KEY` environment variables are also recognized. A FlyAI key additionally needs the FlyAI CLI installed; Codex uses the bundled `scripts/flyai-bridge.mjs` helper to read the saved key without putting it in command arguments. Without 高德, precise map/road data stays hidden; without FlyAI, specific hotels and real-time prices stay hidden. Skipping is for the current page session, so missing keys are offered again next launch.
When the FlyAI CLI is missing, the setup page shows the optional `npm i -g @fly-ai/flyai-cli` command with copy and recheck controls. It never installs software automatically; if the tool remains unavailable after installation, restart the local server and recheck. Base trip planning does not require this CLI.

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
