# Planning contract

Read this reference when building, evaluating, or revising a route.

## State model

Maintain one authoritative plan state:

```text
trip
  start / end
  departure / return
  must_go[]                 locked, ordered hard anchors
  exclusions[]              places or experience types
  travelers / vehicle / pet
  max_daily_drive / max_detour_hours / pace
  ev_highway_range_km        only for pure EVs; observed range
  interests{}               prefer | must | avoid; canonical destination tags
  candidates[]              none | selected | excluded
  route[]                   hard anchors plus selected candidates
  days[]                    drive, charge, play, rest, lodging
  uncertainties[]           fact, freshness, impact, fallback
```

Every UI or report view must derive from this state. Do not let a map, timeline, or hotel section maintain a conflicting route order.

## Hard versus soft constraints

- Hard: must-go points, fixed dates/events, start/end, explicit exclusions, vehicle limitations, border/document constraints, pet cannot-enter rules the user will not work around.
- Soft: themes, pace, preferred scenery, crowd tolerance, lodging style, budget. The user's detour tolerance is a candidate-screening constraint, not a reason to remove a locked must-go place.
- A candidate cannot displace a hard anchor. If hard constraints make the trip infeasible, show the conflict and the smallest changes that would resolve it.

## Minimum questions

Ask only unresolved items that change the route:

1. start/end and available dates;
2. ordered or unordered must-go points;
3. self-drive/vehicle type, daily driving tolerance, detour tolerance, and observed highway range for pure EVs;
4. travelers and whether a pet joins the trip;
5. two or three priority experiences plus explicit exclusions;
6. fixed bookings or border/document limitations.

Do not ask about preferences already established in the conversation.

## Candidate score

Destination tags describe experiences available in a city/stop; each candidate has multiple relevant tags from the schema's canonical vocabulary. Pet access, charging feasibility, crowds, and physical effort are separate decision factors, not city tags. `must` interest means the whole proposed trip needs a credible experience of that kind; do not require every city to carry it. `avoid` never removes a locked must-go point.

Use a transparent directional score rather than false precision:

```text
fit = experience_match + route_fit + seasonal_fit + distinctiveness
cost = detour + fragmented_time + pet_friction + charging_friction + crowd_risk
```

Show the meaningful reasons; a numeric score is optional. Compare the incremental cost from the current route, not a misleading distance from the trip origin.

## Day quality checks

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

## Product acceptance checks

- A user can identify locked must-go points at a glance.
- Candidate stops never look confirmed before selection.
- Every selected destination has duration, purpose, day-level plan, and lodging area.
- The route line, destination list, heat view, and daily schedule agree.
- The plan explains tradeoffs without displaying the messy revision history.
- The portable version remains useful with no network, provider key, or travel plugin.
