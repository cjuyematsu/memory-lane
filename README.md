# Mems

Mems surfaces old photo memories tied to **place**. As you move around, it geofences
clusters of spots where you took photos long ago and notifies you when you return —
then shows you those photos.

Two tabs:

- **Camera Roll** — a shuffle feed of single framed photos.
- **Near Me** — a grid of photos and videos taken within a radius of where you are now.

## Stack

Expo SDK 56 / React Native 0.85 / React 19. It uses a **custom native build** (patched
`expo-media-library`, background location, notifications), so it **cannot run in Expo Go**.

## Run it

```bash
npm install
npx expo start                                      # dev workflow, against the installed dev build
npx expo run:ios --configuration Release --device   # build & install on a connected iOS device
```

Background geofencing and notifications only behave like production on a **physical device in
Release** — not the simulator or a debug build.

See [`CLAUDE.md`](./CLAUDE.md) for architecture and contributor notes.
