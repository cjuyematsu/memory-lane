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
import { MemoryBanner } from '@/components/notifications/memory-banner';
import { NearbyMemoriesGreeter } from '@/components/notifications/nearby-memories-greeter';
import { NotificationOrchestrator } from '@/components/notifications/notification-orchestrator';
import { ShareHost } from '@/components/share/share-host';
import { Paper } from '@/constants/theme';
import { configureImageCache, installMemoryCacheReaper } from '@/lib/image-cache';
import { runOnboardingPermissions } from '@/lib/onboarding-permissions';

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
  // Surface the first-run permission prompts in order (photos -> location ->
  // notifications) once per launch. Idempotent, so re-mounts are harmless.
  useEffect(() => {
    runOnboardingPermissions();
  }, []);
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
  const done = ready && minElapsed;
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
        <NearbyMemoriesGreeter />
        {ready ? <Slot /> : null}
        <MemoryBanner />
        <ShareHost />
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
