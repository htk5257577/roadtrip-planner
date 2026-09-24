# Planning contract

Read this reference when building, evaluating, or revising a route.

## State model

Maintain one authoritative plan state:

```text
trip
  start / end
  departure / return
  must_go[]                 initial wishes: cities, exact attractions or vague experiences
  exclusions[]              places or experience types
  travelers / vehicle / pet
  max_daily_drive / max_detour_hours / pace
  ev_highway_range_km        only for pure EVs; observed range
  interests{}               prefer | must | avoid; canonical destination tags
  candidates[]              none | selected | excluded
  route[]                   start/end plus explicitly selected concrete experiences
  days[]                    drive, charge, play, rest, lodging
  uncertainties[]           fact, freshness, impact, fallback
```

Every UI or report view must derive from this state. Do not let a map, timeline, or hotel section maintain a conflicting route order.

## Hard versus soft constraints

- Hard: confirmed stage-three experiences, fixed dates/events, start/end, explicit exclusions, vehicle limitations, border/document constraints, pet cannot-enter rules the user will not work around.
- Initial wishes are reviewable. City wishes expand into attractions and food; exact attractions remain themselves; vague wishes resolve to concrete route-compatible places. Do not put unresolved descriptions on the map.
- Stage three first reviews wish-derived options, default selected; users remove unwanted options with 不去 and explicitly confirm the baseline before discoveries appear. Discoveries default unselected; only 加入路线 opts in. No group-exclude action or requirement to explicitly reject all discoveries. Every destination requires a selected attraction or food experience; charging and rest are not tourism nodes.
- "保留已选，继续推荐" appends nonduplicate options for that group without overwriting existing options or selections. New wish options default selected and need baseline reconfirmation; new discoveries default unselected. Explain concrete non-recommendation reasons for problematic choices, without inventing reasons against suitable options.

## Minimum questions

Ask only unresolved items that change the route:

1. start/end and available dates;
2. destination wishes or desired experiences;
3. self-drive/vehicle type, daily driving tolerance, detour tolerance, and observed highway range for pure EVs;
4. travelers and whether a pet joins the trip;
5. two or three priority experiences plus explicit exclusions;
6. fixed bookings or border/document limitations.

Do not ask about preferences already established in the conversation.

## Candidate score

Wish choices define the baseline, not detours. Do not apply optional-detour warnings to them. Resolve all wish choices (selected or excluded) before calculating discovery increments; as wishes change, invalidate old increments. For discoveries, compare the current selected route with/without that candidate, including other selected discoveries. Keep baseline total travel costs separate from optional detour costs.

Additional experience tags: 主题公园 (themed amusement/experience parks, not ordinary urban parks), 动物园, 海洋馆, 温泉, 博物馆, 古迹建筑, 乡村田园. Use 主题公园 for the user's amusement-park interest; do not add synonymous 游乐场/主题乐园 tags. Assign tags based on the specific offered experience, not every facility present anywhere in its city. An aquarium and a theme park are separate interests; attach both only when both are genuinely offered.

Destination tags describe experiences available in a city/stop; each candidate has multiple relevant tags from the schema's canonical vocabulary. Pet access, charging feasibility, crowds, and physical effort are separate decision factors, not city tags. `must` interest means the whole proposed trip needs a credible experience of that kind; do not require every city to carry it. `avoid` never removes a locked must-go point.

Use a transparent directional score rather than false precision:

```text
fit = experience_match + route_fit + seasonal_fit + distinctiveness
cost = detour + fragmented_time + pet_friction + charging_friction + crowd_risk
```

Show the meaningful reasons; a numeric score is optional. Compare the incremental cost from the current route, not a misleading distance from the trip origin.

## Pace and marginal detours

Apply `state.answers.pace` throughout candidates, preview, plan and refinement:
- `relaxed`: recommend a small, distinctive set of additions rather than filling every gap; center a sightseeing day on one main experience, protect free time and prefer consecutive nights in one area when feasible.
- `balanced`: one main experience with nearby small activities or food; preserve breathing room between transfers.
- `dense`: offer more worthwhile nearby choices and combine several compatible experiences when practical. Never shorten practical minimum visit time, remove rest, or waive the driving-comfort target.
- If unset, ask for a choice instead of claiming a pace match.

These are soft day-design patterns, not a fixed attraction count: a full-day hike may occupy the whole day in any mode, and nearby food does not necessarily count as another main activity. Explain conflicts with the chosen pace and propose tradeoffs without silently dropping user selections. Preview notes must briefly say how the chosen pace was applied and identify exceptions; carry that rationale into the final route decision and affected day tips.

`maxDetour` is per candidate, measured against the CURRENT route without that candidate: added driving plus estimated charging, excluding visit time. It is not a whole-trip detour budget. Recompute after other selections; do not sum independent candidate deltas. Prefer options inside the target but leave over-target choices selectable with excess hours and a reason. Show unknown if roads are unverified; absence of evidence is not zero detour. Confirmed selections are not automatically removed in later scheduling because of this threshold.

## Day quality checks

The UI's `maxDrive` / `max_daily_drive` is a soft daily comfort target for driving only, excluding charging, meals and breaks. Occasional overruns are permitted with visible date, excess hours, cause and an alternative; never call the entire trip comfortable based only on its average.

For candidates, explain when inserting an experience would cause an overrun, consecutive transit-heavy days or insufficient practical activity time. Without verified roads, mark these conclusions unverified rather than guessing. During scheduling, first try reordering and flexible overnight transfer breaks. If these cannot fit, propose fewer experiences or more days for user approval; never silently remove confirmed experiences or shorten them below their practical minimum.

Check each preview and final day separately. Keep driving, charging, meals/breaks and activities separate and respect departure/return times. Include the reason and proposed adjustment in preview notes and final day tips. A warning is not a prohibition and must not automatically deselect a stop. For deterministic UI reminders, transit-heavy means driving + charging >= 4h and greater than play time; play < 2h on such a day signals squeezed activity time. These are review heuristics, not safety limits or substitutes for attraction-specific minimums.

The final chronological timeline is an account of the whole usable day, not a list of highlights. Starting with the first morning activity (or the actual first-day departure), each adjacent time range must touch until the evening lodging/rest block ends at or after 21:00. Include meals, charging, local transfers, check-in, free time and rest explicitly. The final travel day can end earlier only with a clearly timed arrival at the trip endpoint. Do not imply an unplanned 16:00–bedtime gap or add invented sightseeing to make the chart look full.

Flag a day when any applies:

- planned driving exceeds the user's tolerance;
- driving plus charging plus fixed activities leaves no useful experience block;
- a major attraction receives less than its practical minimum duration;
- two consecutive days are dominated by transit;
- the lodging area is missing for a real overnight destination;
- pet handling depends on leaving the animal unattended in a vehicle;
- a low-charge stretch lacks a verified fallback.

Use flexible rest corridors for long transfers. Keep their location approximate until the travel day unless a booking is genuinely needed.

## Pet and EV evidence

Pet access varies by gate, vehicle, ferry, beach section, trail, hotel, and season. Distinguish official policy, recent traveler reports, and inference. Provide a fallback when uncertainty can break the day.

EV timing includes charge time, queue buffer, cold/heat impact, altitude impact, and the need to arrive with reserve. Treat scenic rural stretches more conservatively than urban expressways.

## Public guide evidence

When `answers.xiaohongshuBrowserOptIn === true`, the checkbox itself authorizes reading relevant 小红书 guides and trip posts. Open a visible Codex in-app browser tab and retain its handle; the traveler signs in manually and signals completion. Do not ask them to locate that tab or authorize reading it again. Roadbook travel-post references come exclusively from specific 小红书 posts actually read during this run. If none are available, leave those arrays empty instead of substituting another platform. Label login-required links; use separate public official sources for changing rules. Follow [public-travel-sources.md](public-travel-sources.md) when building the final report.

FlyAI queries require `answers.flyaiDataConsent === true` in addition to a working key and CLI. Send the least information needed for the particular hotel/attraction query, including pet details only when they affect access or lodging. A saved key alone never authorizes transferring trip or pet information.

Keep three evidence roles separate: traveler posts describe lived experience; official pages establish changing rules; FlyAI, when configured, supplies travel products and live booking information. One role must not silently stand in for another.

## Product acceptance checks

- A user can distinguish initial wishes from confirmed experiences and remove any choice in stage three.
- Candidate stops never look confirmed before selection.
- Every selected destination has duration, purpose, day-level plan, and lodging area.
- The route line, destination list, heat view, and daily schedule agree.
- The plan explains tradeoffs without displaying the messy revision history.
- The portable version remains useful with no network, provider key, or travel plugin.
