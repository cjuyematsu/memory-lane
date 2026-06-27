// Evaluate the geofence manager first: it pulls in expo-task-manager (which
// registers the Android "expo-task-manager" headless task on import) and runs
// TaskManager.defineTask in global scope. Doing this before anything else means
// the task is registered before the OS can start a background geofence launch —
// otherwise RN logs "No task registered for key expo-task-manager" on cold
// headless starts.
import '@/lib/geofence-manager';

import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { LoadingPolaroid } from '@/components/brand/loading-polaroid';
import { FeedEntryWarmHost } from '@/components/feed/feed-entry-warm-host';
import { MemoryBanner } from '@/components/notifications/memory-banner';
import { NearbyMemoriesGreeter } from '@/components/notifications/nearby-memories-greeter';
import { NotificationOrchestrator } from '@/components/notifications/notification-orchestrator';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';
import { ShareHost } from '@/components/share/share-host';
import { Paper } from '@/constants/theme';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { configureImageCache, installMemoryCacheReaper } from '@/lib/image-cache';

// Bound the expo-image disk cache once, before any photo renders, so it can't
// grow without limit as the feed/shuffle decode images across the library.
configureImageCache();

// Hold the native splash (the Polaroid, see app.json) until React paints, then
// hand it off to the in-app polaroid loader below — no auto-hide into a white
// frame between the two.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Keep the polaroid loader on screen for at least this long so it never just
// flashes — the loader reads as a deliberate beat, not a stutter.
const MIN_LOADER_MS = 1000;
const LOADER_FADE_MS = 300;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Archivo Expanded Black. The key is the family name referenced as
  // `DisplayFont` in the type system; loaded at runtime so no rebuild is needed.
  // Drop the file at assets/fonts/ArchivoExpanded-Black.ttf (see README there).
  const [fontsLoaded, fontError] = useFonts({
    'ArchivoExpanded-Black': require('@/assets/fonts/ArchivoExpanded-Black.ttf'),
  });
  // First-run permission prompts now live in the onboarding flow (rendered
  // below when `onboarding === 'active'`), which primes each permission with an
  // explanation before surfacing the OS dialog — no more rapid-fire prompts on
  // launch. The app itself (`<Slot />` + the location-using greeter) is
  // withheld until onboarding finishes: a live Near Me under the overlay would
  // otherwise re-request location on the AppState 'active' that fires when a
  // permission dialog dismisses.
  const onboarding = useOnboardingStatus();

  // Drop the decoded-image memory cache whenever the app backgrounds, so a
  // large foreground working set can't get the app jetsammed while suspended.
  useEffect(() => {
    const sub = installMemoryCacheReaper();
    return () => sub.remove();
  }, []);
  // Hold the content until the font is ready so the first paint already uses it
  // (otherwise the nav flashes the fallback font until something re-renders).
  // `|| fontError` so a load failure still shows the app (with the fallback).
  const ready = fontsLoaded || !!fontError;

  // Hand the native splash off to the in-app polaroid loader as soon as React
  // paints (the loader covers, so there's no gap) — from here the loader is one
  // continuous polaroid, now with its spinner.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // The polaroid loader stays up until BOTH the app is ready AND a minimum beat
  // has passed, then fades out and unmounts — so it never flashes by, and the
  // reveal is a soft dissolve rather than a hard cut.
  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_LOADER_MS);
    return () => clearTimeout(t);
  }, []);
  const [loaderMounted, setLoaderMounted] = useState(true);
  const loaderOpacity = useSharedValue(1);
  const loaderStyle = useAnimatedStyle(() => ({ opacity: loaderOpacity.value }));
  // Also hold the loader until the onboarding decision resolves, so we never
  // flash a blank Paper frame before either the app or the flow is chosen.
  const done = ready && minElapsed && onboarding !== 'deciding';
  useEffect(() => {
    if (!done) return;
    loaderOpacity.value = withTiming(0, {
      duration: LOADER_FADE_MS,
      easing: Easing.out(Easing.quad),
    });
    const t = setTimeout(() => setLoaderMounted(false), LOADER_FADE_MS + 40);
    return () => clearTimeout(t);
  }, [done, loaderOpacity]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Paper }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <NotificationOrchestrator />
        {/* Off-screen, decodes the photo the onboarding prewarm picked for the
            Camera Roll's first card, so the feed opens on a warm cache hit.
            Renderless on every normal launch (nothing warmed). */}
        <FeedEntryWarmHost />
        {/* Greeter touches location and can pop a banner — keep it out of the
            tree until onboarding is done, alongside the app. */}
        {onboarding === 'done' ? <NearbyMemoriesGreeter /> : null}
        {ready && onboarding === 'done' ? <Slot /> : null}
        <MemoryBanner />
        <ShareHost />
        {/* Full-screen first-run onboarding; replaces the app until finished,
            and sits below the boot loader so the Polaroid covers the
            pre-decision flash. */}
        {ready && onboarding === 'active' ? <OnboardingFlow /> : null}
        {loaderMounted ? (
          <Animated.View
            style={[styles.loaderOverlay, loaderStyle]}
            pointerEvents={done ? 'none' : 'auto'}>
            <LoadingPolaroid />
          </Animated.View>
        ) : null}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
  },
});
