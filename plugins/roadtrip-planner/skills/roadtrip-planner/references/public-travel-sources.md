# Public travel source policy

Read this reference when generating candidates, previews or complete roadbooks, and when refining them.

## Candidate experience evidence

This policy applies at candidate generation, not only in the final report. Actually query and read place-specific sources during the current planning run. The same rule applies to wish-derived candidates and discoveries.

For `highlight` and `tags`, summarize only supported scenery/food/activity types. Set `highlightStatus: "verified"` only when every stated type is grounded in those sources; list the supporting direct URLs in `highlightSourceUrls` and include their full records in `references`. The reference note must identify which claim it supports. Mere URL availability, a search snippet or a configured provider is not proof. Do not copy generic city tags onto a specific attraction.

Use public official/first-hand sources and FlyAI results when available. Product information alone does not substantiate subjective scenery claims. For a FlyAI-supported claim, obtain a usable direct public source record; if unavailable, leave this summary unverified rather than fabricating a URL.

When lookup fails, content is inaccessible or evidence covers only part of a proposed summary, narrow the summary to supported content or set `highlightStatus: "unverified"`, `highlightSourceUrls: []`, `tags: []`, and explicitly say the experience is pending verification. Do not fill gaps from examples, fixtures, assumptions or memory. Recommendations and proposed stay durations are judgments and must be distinguished from sourced facts.

The bridge removes unsupported summaries/tags if their source records do not survive validation. This structural check does not prove factual entailment: the generating agent must read and cross-check actual source content. Subsequent preview, report and refinement must retain the evidence and uncertainty; never promote an unverified candidate description into a fact without a fresh successful check. Simulation is confined to the separate simulator and is not acceptable as a production result.

## Access and citation boundary

The stage-two 小红书 checkbox is one authorization. When enabled, open the site in a visible Codex in-app browser, remember that tab, and let the traveler sign in manually. Their reply that login is finished is only a readiness signal; do not request another permission or ask them to locate the tab. Do not request/export cookies or passwords. If the browser tool or login is unavailable, do not claim to have read posts.

Final-roadbook travel guides and first-hand posts come only from specific 小红书 posts actually opened during this run. A direct HTTPS post may be cited when publicly accessible, or marked `publicAccess: false` and `access: "signedInBrowser"` when it was read in the user's logged-in tab. Login-required links must be visibly labeled, not described as publicly verified. Do not cite search pages, platform home pages, deleted posts, copied snippets, or posts with no reliable direct URL. If no usable 小红书 post is found, leave guide/post references empty instead of substituting another platform. Official sources for opening hours, pet entry and other changing rules may still be recorded separately, not as travel-post recommendations.

## Source roles

- **First-hand experience:** specific 小红书 posts read in the browser. Use these for route flow, actual visit duration, seasonal appearance, crowds, queues, meals, pet experience, parking, and subjective tradeoffs. Do not insert posts from other communities into roadbook guide sections.
- **Current facts:** official attraction, transport, ferry, government, venue, hotel, or provider pages. Use these for opening hours, closures, ticket rules, pet access, reservations, road restrictions, and other facts that can change.
- **Travel products:** FlyAI, when configured, supplies hotel and attraction listings, live prices, availability, and booking links. It is not the only source of guides and must not replace first-hand accounts.
- **Maps:** 高德, when configured, supplies locations, driving geometry, mileage, and time. Traveler posts may describe a route but do not verify current road calculations.

## Selection rules

For each genuine destination, aim for one to three useful 小红书 posts rather than a long link dump. For each key attraction, aim for one or two place-specific first-hand posts when available. Zero is correct when no usable post was read.

Prefer sources that are:

1. direct article or post URLs, not search-result or platform home pages;
2. clearly tied to the exact destination or attraction;
3. first-hand and specific about what the traveler actually did;
4. recent enough for the claim, with `publishedAt` recorded when visible;
5. complementary—for example, one route/duration account and one pet, crowd, season, or parking account;
6. diverse firsthand perspectives within 小红书 when that materially reduces bias.

Avoid copying promotional language. Do not infer that a popular post is accurate. When sources disagree, summarize the disagreement in the plan and keep current rules anchored to official evidence.

## Output contract

Public official evidence and publicly accessible 小红书 posts use:

```json
{
  "type": "游记 | 攻略 | 实走记录 | 体验帖 | 官方信息",
  "platform": "小红书 | official source name",
  "title": "visible source title",
  "note": "the specific decision this source helps with",
  "url": "direct HTTPS URL",
  "evidenceRole": "firstHand | official",
  "publicAccess": true,
  "checkedAt": "ISO 8601 time when the URL was opened without login",
  "publishedAt": "visible publication date when available"
}
```

A 小红书 post read only in the logged-in Codex browser instead uses `"platform":"小红书"`, `"evidenceRole":"firstHand"`, `"publicAccess":false`, and `"access":"signedInBrowser"`; `checkedAt` is when the actual post was opened there. This state is only allowed when `xiaohongshuBrowserOptIn` is true. The URL must be a direct 小红书 post, and the roadbook labels it as login-required.

Use `stopSummaries[].guides` for destination-level understanding and `days[].slots[].references` for the exact place in that time block. Deduplicate the same URL across both. Never fabricate a title, author, publication date, quote, or link.

`publicAccess: true` asserts that the exact URL was opened without login during this planning run. It is not a promise that the platform will remain public later. Do not mark a login-required post public.

The local bridge repeats an unauthenticated accessibility check for public references. It cannot verify browser-only post content; it only accepts a direct 小红书 post URL with explicit login-required provenance under the user's opt-in. The generating Codex must have actually opened the post in the retained tab. Dead, malformed and private-network links must never be replaced with invented citations.

Travel-product results do not use this object. Hotel and ticket records separately carry `sourceProvider: "flyai"` and `queriedAt`; an installed CLI or configured key alone is not evidence that a particular query succeeded.
