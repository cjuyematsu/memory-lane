# PastPic 1.0 App Store release tracker

Living checklist for the 1.0 submission. Owner: **me** = Claude (doable from the terminal), **you** = Cole (sign-ins, device, commits). Update statuses in place as steps complete.

Source docs: `docs/app-store-listing.md` (copy + shot list), `docs/privacy-policy.md`, `docs/battle-test.md` (row 34 gates this release), `docs/demo-video.md` (review-attachment footage), `store.config.json` (EAS Metadata).

## 1. Repo hygiene

- [x] `coverage/` gitignored (me, 2026-08-13)
- [x] Stale docs fixed: CLAUDE.md DSN note, listing-doc export-compliance section + concrete URLs (me, 2026-08-13)
- [ ] **You:** commit the pending demo-mode + share-fix work (12 modified + new files, plus these release files). The production build must come from committed state.

## 2. Privacy policy + support page (Apple hard requirement)

- [ ] **You:** `gh auth login` (type `! gh auth login` in the Claude session)
- [ ] Create public repo `ColeUyematsu/pastpic`, push site, enable Pages (me; site staged at `~/UYEYU/pastpic-site/`: `index.html` support page + `privacy/index.html` from docs/privacy-policy.md)
- [ ] Verify 200s: `https://coleuyematsu.github.io/pastpic/` and `.../pastpic/privacy/` (me)
- [ ] Post-launch: point uyeyu.co at the site and update the ASC privacy URL (editable anytime, no review)

## 3. Sentry source maps

- [ ] **You:** create an auth token at sentry.io (org `uyeyu`): Settings > Auth Tokens, scopes `project:releases` + `org:read`; paste it in the session
- [ ] Set as EAS secret for production builds (me): `eas env:create` (name `SENTRY_AUTH_TOKEN`, secret visibility)
- [ ] Verify in the production build logs: sentry source-map/dSYM upload step succeeded

## 4. Store metadata (EAS Metadata)

- [x] `store.config.json` created from docs/app-store-listing.md (me, 2026-08-13)
- [ ] **You:** provide a phone number for App Review contact (required before Submit for Review; goes in `store.config.json` `review.phone`)
- [ ] `eas metadata:push` after the Pages URLs are live (me)
- [ ] `eas metadata:pull` to confirm ASC matches (me)
- Not covered by EAS Metadata, done by hand in ASC (step 7): screenshots, App Privacy questionnaire, pricing.

## 5. Store-candidate build

- [ ] `eas build --platform ios --profile production` (me; after the commit in step 1). Production profile sets no `env`, so `EXPO_PUBLIC_DEMO` is absent: this IS the battle-test row 34 candidate.
- [ ] `eas submit --platform ios --profile production` to TestFlight (me + **you** for any interactive Apple auth)
- [ ] **You:** device smoke from TestFlight: row 34 (long-press Settings privacy note, expect NO demo panel), cold launch, one greeter/geofence banner, raw + framed share, one retake. Focus = the delta since the soaked build (demo mode, share fixes).

## 6. Screenshots (up to 10; 6.7-inch: 1290x2796 or 1284x2778)

- [ ] **You:** capture the 7 shots per the plan in docs/app-store-listing.md (Display Zoom off; demo-mode internal build can stage location-dependent shots)
- [ ] Verify sizes/count, rename ordered, stage for upload (me; `sips -g pixelWidth -g pixelHeight`)

## 7. ASC finalization (App Store Connect, app 6784006220)

- [ ] 1.0 version exists with pushed metadata; attach the smoke-tested build
- [ ] Upload screenshots
- [ ] App Privacy questionnaire: privacy URL; collects Diagnostics > Crash Data only, NOT linked to identity, NOT tracking; everything else "not collected" (on-device processing is not "collected" under Apple's definition)
- [ ] Pricing: Free, all territories
- [ ] App Review info: contact + phone, no sign-in, attach demo video (footage per docs/demo-video.md)
- [ ] Content rights: no third-party content. Age rating: all None (4+)
- [ ] Release option: MANUAL release (launch lines up with the launch video)
- [ ] **Submit for Review**

## 8. Review + release

- [ ] Track review status (typically 24-48h). Likely questions: background location (reviewer notes pre-empt), photo-library scope. Log any rejection + response here.
- [ ] On approval: **you** press Release when the launch video is ready
- [ ] Post-launch: watch Sentry for the first cohort; uyeyu.co DNS move

## Pre-submit gate (all must be checked before "Submit for Review")

1. Privacy + support URLs return 200 publicly
2. `git status` clean before the production build
3. `eas metadata:pull` matches `store.config.json`
4. Row 34 + smoke pass green on the store candidate
5. Sentry upload visible in build logs
