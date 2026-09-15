# Launch video: demo mode and shoot plan

## Why this exists

The hero feature is unfilmable by default. A memory notification only fires when
you are physically standing at a place you photographed more than ~90 days ago,
that place is not routine (home/work), and it is not inside a cooldown window.
You cannot direct that and you cannot retake it.

The way out is that **nothing about the notification has to be faked, only the
coordinate.** Every gate in `handleClusterEnter` (`src/lib/geofence-manager.ts`)
is evaluated against the *cluster's* position, not against some notion of where
you "really" are:

| Gate | Keyed on |
|---|---|
| `isAreaNotifiable(cluster, clusters)` | the cluster's own photo ages |
| `isRoutineLocation(...)` | the cluster center |
| `isClusterInCooldown(clusterId, ...)` | the cluster id |
| `isInCooldown(...)` | the cluster center |

So if the app genuinely believes it is standing at an old cluster, every
production gate passes on its own merits. The notification body, the `clusterId`
payload, the tap routing into the Near Me ClusterView, and the cooldown writes
are all real shipping code paths. One synthetic lat/lng is the entire cheat.

## Demo mode

`src/lib/demo-mode.ts`. Two guards, both unit-tested
(`src/lib/__tests__/demo-mode.test.ts`):

- **Build switch.** `DEMO_ENABLED = process.env.EXPO_PUBLIC_DEMO === '1'`. Metro
  inlines `EXPO_PUBLIC_*` at build time, so a binary built without it cannot
  carry demo mode at all: `demoCoords()` returns null unconditionally, the panel
  never renders, and a leftover `demo-mode.json` on disk is ignored. This
  replaced the old hand-flipped `DEMO_BUILD` source constant, which was one
  forgotten edit away from shipping.
- **Coordinate validation.** `parseDemoMode` collapses the whole state to off
  unless the coordinate is finite and in range. A NaN lat/lng would flow into
  `distanceMeters` and silently break every radius comparison in the app, since
  NaN comparisons are always false (nothing would ever be "nearby", nothing would
  ever be "in cooldown").

The override is applied by `getPosition` / `getLastKnownPosition`, the two
wrappers every position read in the app now goes through: `use-current-location.ts`
(Near Me and the greeter), `notification-orchestrator.tsx` (geofence
registration), and the four sites in `geofence-manager.ts`. `watchPositionAsync`
is deliberately untouched. `_layout.tsx` calls `warmDemoMode()` at boot so the
first read of a cold launch already honors the override, which the hero shot
needs because tapping the notification cold-starts the app.

### Building for the shoot

```bash
EXPO_PUBLIC_DEMO=1 npx expo run:ios --configuration Release --device
```

Release matters. The geofence and notification paths only behave like production
in a Release build on a physical device, and a dev build risks a Metro overlay in
the footage.

### The panel

Settings sheet, **long-press the privacy note**. Hidden behind a gesture because
the Settings sheet is itself on camera during the shoot.

1. **Place list.** Notifiable clusters from your own library, biggest first.
   Tapping one teleports there.
2. **Teleport toggle.** Turns the override on and off.
3. **Delay + Arm trigger.** 10 / 20 / 30 seconds, then the real notification via
   `triggerNearestMemoryHere(delayS)`. Long enough to lock the phone and settle a
   camera; the production default of 8s is not.
4. **Reset this place.** Deletes `cluster-cooldown.json`,
   `notification-cooldown.json`, and `place-presence.json`. This is what makes a
   take repeatable: the first real fire marks the cluster spent, so take two
   would be silently suppressed. The presence file matters more than it looks,
   because the greeter logs a ping at your current coords on every app open, so
   shooting across three distinct days would make the demo place "routine" and
   silence it for good.
5. **Fire in-app banner.** The foreground beat, via `previewForegroundBanner`.

Status is an inline line, never `Alert.alert`, so no system alert can appear in a
take.

### Pre-take check

**Show radii here** (`inspectRadiiHere`, already in the dev row) prints the exact
gate outcome per nearby cluster. The demo cluster must read `WOULD FIRE`. If it
reads `spent (cooldown)` or `home/work`, hit **Reset this place** and re-check.
This is the single best confidence check before rolling.

## Shoot

Decisions: desk-staged via the override, the real photo library curated
beforehand, a 60 to 90 second trailer, hero shot filmed with a real camera and
everything else captured over QuickTime USB.

### Curate first (this is a privacy pass)

Real photos are going on YouTube.

- Pick a demo cluster you are comfortable naming publicly. Near Me and the feed
  caption show a **reverse-geocoded place name**, so the neighborhood will be
  legible on screen. Not your home block.
- Shuffle the Memories feed ~20 times off camera and note what comes up. The feed
  is random, so knowing the pool is the only mitigation.
- Scroll the whole Near Me grid at the demo coordinate. Every tile is a candidate
  for the footage.
- Have a retake pair already saved so the Retakes tab is not empty.

### Device setup

- Notifications **off for every other app**. Do not use Do Not Disturb or a
  Focus: it would suppress the PastPic notification too, which is the shot. Clear
  Notification Center before every take.
- Network on. iCloud-offloaded photos otherwise show the blur to local-rendition
  path on camera.
- Battery above 80% so the indicator is not red, brightness max, Auto-Lock set to
  Never for the in-app segments and back to 30s for the lock screen shot.
- **True Tone and Night Shift off.** Both shift white balance and will stop the
  camera-filmed hero shot from matching the QuickTime footage in the grade.

### Segment A: hero shot, real camera

The one beat filmed physically, which is why it has no recording-indicator
problem.

1. Set the override to the chosen cluster, tap **Reset this place**.
2. Arm at 30 seconds.
3. Lock the phone, get the camera rolling.
4. Notification lands on the Lock Screen.
5. Thumb taps it. The app cold-launches into Near Me with the ClusterView open on
   exactly those photos.

Shoot 4K at 24 or 30 fps, shutter around 1/50 to 1/60 (faster shutters beat
against the OLED panel and produce rolling bands). Frame slightly off-axis to
kill moire and the lens reflection. **Reset this place** between every take.

### Segment B: in-app, QuickTime over USB

QuickTime Player, File > New Movie Recording, switch the source dropdown from the
built-in camera to the iPhone. Full-resolution, no red bar, no Control Center
swipe on camera.

Worth two minutes first: record a QuickTime clip while sending yourself any
notification and check whether the banner comes through. If it does, you get a
bonus continuous take of the notification-to-app transition. If not, nothing is
lost, because Segment A covers that beat.

Beats, each as its own clean take:

- ClusterView on the demo cluster, scroll the photos
- Memories feed: framed photo with date and place caption, shuffle two or three times
- Near Me: tap a tile, viewer opens, drag the filmstrip, swipe down to dismiss
- Retake end to end: ghost overlay alignment, distance hint, shutter, review, then/now card
- Share sheet on the then/now card (this is the funnel, hold on it)
- Settings sheet, specifically the privacy line

### Segment C: edit

| Time | Beat |
|---|---|
| 0:00-0:08 | Hero. Lock screen, banner, tap. Cut on the tap. |
| 0:08-0:18 | Match cut to QuickTime: ClusterView, photos from that exact spot. |
| 0:18-0:32 | Memories feed. Framed photo, caption, shuffle. |
| 0:32-0:44 | Near Me grid, viewer, filmstrip. |
| 0:44-1:04 | Retake: ghost align, shutter, then/now card. The payoff. |
| 1:04-1:15 | Share the then/now, privacy line, title card, TestFlight CTA. |

Grade the camera-filmed segment to match the screen capture, not the reverse.
Screen capture is the reference white.

Title cards in `ArchivoExpanded-Black` on Paper white with Ink text so the
trailer matches the app (`src/constants/theme.ts`). Monochrome except the
spectrum rule (`components/brand/spectrum-rule.tsx`), which makes a good
transition wipe. No em dashes in on-screen copy.

## After the shoot

1. Turn the override off and run **Reset this place** once more, so the demo
   coordinate is not left sitting in your real cooldown and presence history.
2. Rebuild **without** `EXPO_PUBLIC_DEMO` before any TestFlight or store build.
   That is row 34 of `docs/battle-test.md`.
