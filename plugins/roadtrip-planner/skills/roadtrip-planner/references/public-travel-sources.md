# Public travel source policy

Read this reference when generating or refining the complete roadbook.

## Scope

Use only pages that can be opened without signing in. Do not ask the user to log in, attach an authenticated browser tab, export cookies, or authorize social accounts. If a result leads to a login wall, inaccessible app-only page, deleted post, or generic search page with no usable article, skip it.

The planner still works when no suitable public post is available. Empty source arrays are preferable to invented links or weak filler.

## Source roles

- **First-hand experience:** publicly accessible traveler posts and trip reports from travel communities such as 马蜂窝、携程游记/攻略、穷游 and Tripadvisor; publicly indexed social posts; independent personal travel blogs. Use these for route flow, actual visit duration, seasonal appearance, crowds, queues, meals, pet experience, parking, and subjective tradeoffs.
- **Current facts:** official attraction, transport, ferry, government, venue, hotel, or provider pages. Use these for opening hours, closures, ticket rules, pet access, reservations, road restrictions, and other facts that can change.
- **Travel products:** FlyAI, when configured, supplies hotel and attraction listings, live prices, availability, and booking links. It is not the only source of guides and must not replace first-hand accounts.
- **Maps:** 高德, when configured, supplies locations, driving geometry, mileage, and time. Traveler posts may describe a route but do not verify current road calculations.

## Selection rules

For each genuine destination, aim for one to three useful public references rather than a long link dump. For each key attraction, aim for one or two place-specific first-hand posts when available.

Prefer sources that are:

1. direct article or post URLs, not search-result or platform home pages;
2. clearly tied to the exact destination or attraction;
3. first-hand and specific about what the traveler actually did;
4. recent enough for the claim, with `publishedAt` recorded when visible;
5. complementary—for example, one route/duration account and one pet, crowd, season, or parking account;
6. drawn from more than one platform when that materially reduces platform bias.

Avoid copying promotional language. Do not infer that a popular post is accurate. When sources disagree, summarize the disagreement in the plan and keep current rules anchored to official evidence.

## Output contract

Each source object remains:

```json
{
  "type": "游记 | 攻略 | 实走记录 | 体验帖 | 官方信息",
  "platform": "source name",
  "title": "visible source title",
  "note": "the specific decision this source helps with",
  "url": "direct publicly openable URL",
  "evidenceRole": "firstHand | official",
  "publicAccess": true,
  "checkedAt": "ISO 8601 time when the URL was opened without login",
  "publishedAt": "visible publication date when available"
}
```

Use `stopSummaries[].guides` for destination-level understanding and `days[].slots[].references` for the exact place in that time block. Deduplicate the same URL across both. Never fabricate a title, author, publication date, quote, or link.

`publicAccess: true` asserts that the exact URL was opened without login during this planning run. It is not a promise that the platform will remain public later. If that check cannot be made, omit the reference.

The local bridge repeats an unauthenticated accessibility check before publishing. Dead links, login walls, private-network addresses and redirect traps are omitted automatically; they must never be replaced with invented citations.

Travel-product results do not use this object. Hotel and ticket records separately carry `sourceProvider: "flyai"` and `queriedAt`; an installed CLI or configured key alone is not evidence that a particular query succeeded.
