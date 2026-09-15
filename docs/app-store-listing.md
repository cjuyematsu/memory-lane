# App Store listing (v1.0)

Draft copy for App Store Connect. Character limits noted per field. Everything here is store-facing: no em dashes.

## Name (already set in ASC)

PastPic

## Subtitle (30 chars max)

> Memories where you took them

(28 chars)

## Promotional text (170 chars max, editable without review)

> Walk past a place you photographed years ago and PastPic quietly taps you on the shoulder. Your library already holds the memories. PastPic knows where they live.

(161 chars)

## Description (4,000 chars max)

> PastPic turns your camera roll into a map of your past. It notices when you're standing somewhere you took photos long ago and resurfaces them, right there, right then.
>
> HOW IT WORKS
>
> PastPic reads the location and date already saved in your photos and quietly keeps track of the places that matter. When you walk past a spot where you took photos more than a few months ago, you get a gentle notification. Tap it and you're looking at that day again, standing in the same place.
>
> It learns your routine, too. Home, work, and the gym go quiet on their own. The notifications you get are the ones worth getting: the restaurant from a birthday two years ago, the park from a day you'd half forgotten.
>
> MEMORIES
>
> A clean, gallery-style feed that shuffles through your located photos one frame at a time. No grid of ten thousand thumbnails. One photo, its place, its date.
>
> NEAR ME
>
> Open the app anywhere and see every photo and video you've ever taken nearby. Standing in your old neighborhood? There's your life from that block.
>
> RETAKES
>
> Line up an old photo as a ghost over the live camera and retake it from the same spot. Save the then-and-now pair, or share it.
>
> SHARING
>
> Share any memory as the original file or as a framed card sized for stories. Then-and-now retakes share as a clean composite.
>
> PRIVATE BY DESIGN
>
> Everything happens on your phone. Your photos and your location are processed entirely on-device and never leave your device. No account, no sign-up, no cloud, no ads, no tracking. The only thing PastPic ever sends anywhere is an anonymous crash report if the app itself fails.
>
> PastPic works best with a photo library that has location data and a bit of history in it. The more places you've photographed, the more the world starts handing your memories back.

(~1,900 chars, well under the limit)

## Keywords (100 chars max, comma-separated)

> memories,nostalgia,throwback,flashback,rewind,photo map,nearby,then and now,geofence,photo diary

(97 chars. Don't repeat "PastPic" or words already in the name/subtitle like "photos"; Apple indexes those automatically.)

## URLs

- Support URL: `https://coleuyematsu.github.io/pastpic/` (GitHub Pages; later move to uyeyu.co and update ASC, no review needed)
- Marketing URL: optional, leave blank for v1.
- Privacy Policy URL (in App Privacy section): `https://coleuyematsu.github.io/pastpic/privacy/`

## Copyright

> © 2026 Cole Uyematsu

## Version release option

Manually release this version (so launch can line up with the launch video).

## App Review Information

Sign-in required: No (there are no accounts).

Contact: Cole Uyematsu, cjuyematsu@gmail.com, plus phone number (fill in ASC).

### Notes for the reviewer (4,000 chars max)

> PastPic surfaces old photo memories by place. It reads the GPS and date metadata already stored in the user's photo library, entirely on-device, and (1) notifies the user when they physically return to a place where they took photos more than ~90 days ago, (2) shows a "Near Me" grid of photos taken around the current location, and (3) lets the user re-take an old photo from the same spot with a ghost overlay.
>
> IMPORTANT FOR TESTING: the core experience depends on the device's photo library containing photos that are months to years old and have GPS data, taken at places near the reviewer's physical location. A fresh test device with an empty or recent library will show the app's empty states instead. The attached video demonstrates the full flow on a real library: the geofence notification arriving, tapping it into the photo cluster, the Near Me grid, and a retake.
>
> To see the app populated: any library with geotagged photos will fill the MEMORIES feed immediately, and the NEAR ME tab shows photos taken within a few hundred meters of the current location. The location-triggered notification additionally requires standing near a place with photos older than ~90 days that is not a routine location, so it is best evaluated via the attached video.
>
> BACKGROUND LOCATION: the app requests "Always" location only when the user enables memory notifications (never at first launch), and uses it solely to run OS geofences around photo-cluster locations so a notification can fire when the user arrives. There is no location logging, no tracking, and no server: all location and photo processing happens on-device and no user data leaves the device. The app has no account system and no sign-in. The only network traffic the app generates is an anonymous crash report (stack trace and device model, via Sentry) if the app crashes.

### Attachment

The launch/demo video showing: notification firing at a memory location, tap into the cluster view, Near Me grid, and a retake. (Produce per docs/demo-video.md.)

## App Information section

- Primary category: Photo & Video
- Secondary category: none (or Lifestyle)
- Content rights: does not contain, show, or access third-party content
- Age rating questionnaire: all "None" (expect 4+)

## App Privacy section (questionnaire answers)

- Privacy policy URL: hosted page above
- Does this app collect data? Yes, minimal:
  - Diagnostics > Crash Data: collected, NOT linked to the user's identity, NOT used for tracking. (Sentry crash reporting, release builds only.)
- Everything else: not collected. Photos and precise location are accessed and processed on-device only and are never transmitted, so they are not "collected" under Apple's definition (data transmitted off the device).

## Pricing and Availability

- Price: Free (Add Pricing > USD 0)
- Availability: all territories

## Export compliance

Already handled at build time: app.json sets `ios.config.usesNonExemptEncryption: false` (the app uses only standard/exempt encryption, HTTPS to Sentry), so ASC does not ask when attaching a build.

## Screenshot plan (up to 10, 1284×2778 or 1242×2778 preferred)

Take on an iPhone with Display Zoom off; the demo-mode internal build (EXPO_PUBLIC_DEMO=1) can stage the location-dependent shots anywhere, per docs/demo-video.md.

1. MEMORIES feed on a great photo (hero shot)
2. Lock screen / notification: "You took photos here"
3. Near Me grid, dense area
4. Cluster view after tapping a notification
5. Retake camera with ghost overlay
6. Then-and-now pair (clean composite)
7. Onboarding privacy page ("Everything stays on your phone")
