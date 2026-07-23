# Battle-test checklist

On-device scenario matrix to run before a store release. Run on the physical
iPhone (Release build for the crash-sensitive rows; the dev build is fine for
UX rows). Log anything odd, then pull diagnostics:

- In-app JS crash log: long-press the Settings sheet title (shares the log).
- Native `.ips` reports: `pymobiledevice3 crash pull <outdir> -m "PastPic"`.
- Live session: `npx expo start` (JS console) + `pymobiledevice3 syslog live -m PastPic`.

Expected behavior column = what "pass" looks like. Anything else is a finding.

## Offline / airplane mode

| # | Scenario | Expected |
|---|---|---|
| 1 | Airplane mode → cold launch → browse feed | Local photos render; iCloud-offloaded ones show blur → local rendition (never a stuck blur with no Retry) |
| 2 | Airplane mode → share (raw) an iCloud-offloaded photo | Friendly iCloud error within ~8s, never a hung spinner |
| 3 | Airplane mode → shuffle repeatedly | No error screens; warm queue pauses on failures instead of looping |
| 4 | Airplane mode → retake flow end to end (capture, save, share) | Capture + save work fully offline; share sheet opens with the local file |
| 5 | Toggle airplane mode mid-feed-scroll | Tiles that were mid-download recover on their own or via Retry |

## Permissions matrix

Reset between rows: delete app (or Settings → PastPic → toggle each permission).

| # | Scenario | Expected |
|---|---|---|
| 6 | Deny Photos at onboarding | Flow advances; app lands on the locked screen with a Grant/Settings path; no endless Polaroid |
| 7 | Photos = Limited selection | Feed/Near Me work with the subset; no crash on the picker sheet |
| 8 | Deny location, grant photos | Camera Roll works; Near Me shows its location prompt with Try again/Settings |
| 9 | Grant When-In-Use, decline "Always" | Memory notifications run in foreground-fallback mode; no throw from geofencing |
| 10 | Decline notifications, then enable Memory notifications later in Settings | Permission re-requested contextually; degraded state never wedges the toggle |
| 11 | Deny camera on first retake, grant in Settings, return to app | Camera screen unlocks by itself (AppState recheck) |
| 12 | Revoke Photos in Settings while app is open | App returns to a locked/grant state, no crash on next feed interaction |

## Kill / relaunch resilience

| # | Scenario | Expected |
|---|---|---|
| 13 | Kill app mid-onboarding (each step), relaunch | Resumes at the same step; no migration mis-fire; never skips remaining steps |
| 14 | Kill app on the retake review screen without saving | Capture discarded cleanly; no orphan rows in Retakes (orphan files acceptable) |
| 15 | Kill during a Save-to-roll composite capture | No half-written recreation row; gallery still loads |
| 16 | Background-notification tap from a killed app | Cold launch lands on Near Me → ClusterView of the right cluster |
| 17 | Force-quit during the first located-index build, relaunch | Build resumes/restarts; Near Me eventually populates; no corrupt-index crash |

## Stress / edge conditions

| # | Scenario | Expected |
|---|---|---|
| 18 | Storage nearly full (< 1 GB free) → browse + retake | Downloads fail gracefully (pause, Retry); capture still saves or alerts |
| 19 | Rapid tab swiping during cold load | No blank panes, no gesture lock-up |
| 20 | Rapid shutter mashing in the retake camera | One capture per press; shutter re-arms; never stuck busy (8s timeout worst case) |
| 21 | Open share sheet, cancel, immediately reopen ×5 | No duplicated sheets, no stuck "preparing" spinner |
| 22 | Open a dense Near Me area (100s of items), fast-scroll the grid + filmstrip | Smooth recycling, brief stale-thumb dissolves acceptable, no white flash of the whole grid |
| 23 | Video-heavy library: shuffle past videos repeatedly | No mediaserverd churn/crash (videos never probed for iCloud residency) |
| 24 | Leave the app foregrounded on the feed for 30+ min | No memory growth spiral; no spontaneous error screens |
| 25 | Take a new photo while app is open → return to Near Me | Grid does NOT reshuffle on its own; new photo appears after pull-to-refresh |

## Corrupt persisted state (simulator or dev build)

Automated equivalents live in `src/lib/__tests__/persisted-parsers-fuzz.test.ts`;
these verify the full boot path, not just the parser.

| # | Scenario | Expected |
|---|---|---|
| 26 | Truncate `located-assets.json` mid-file, relaunch | Index rebuilds the dropped entries; no crash, no permanent data loss |
| 27 | Replace `onboarding.json` with `{"completed":"yes"}` | Treated as not completed / defaults; no crash loop |
| 28 | Replace `recreations.json` with garbage | Retakes tab shows empty gallery, not a crash |
| 29 | Delete a recreation's jpg from `recreations/`, open gallery | Tile degrades ("no longer available" panel), no crash |

## Notifications end-to-end (needs walking around)

| # | Scenario | Expected |
|---|---|---|
| 30 | Enable Memory notifications, visit an old-photo spot | One notification; tap opens the right cluster |
| 31 | Re-visit the same spot within the cooldown window | Silence (per-cluster cooldown) |
| 32 | Visit home/work repeatedly for 3+ days | Those spots go quiet (routine-place suppression) |
| 33 | Foreground arrival at a memory spot | In-app banner with the Near Me count, not an OS notification |
