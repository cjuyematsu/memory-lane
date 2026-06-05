import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { MemoryBanner } from '@/components/notifications/memory-banner';
import { NotificationOrchestrator } from '@/components/notifications/notification-orchestrator';
import { configureImageCache } from '@/lib/image-cache';
import { runOnboardingPermissions } from '@/lib/onboarding-permissions';

// Bound the expo-image disk cache once, before any photo renders, so it can't
// grow without limit as the feed/shuffle decode images across the library.
configureImageCache();

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
  // Hold the content until the font is ready so the first paint already uses it
  // (otherwise the nav flashes the fallback font until something re-renders).
  // `|| fontError` so a load failure still shows the app (with the fallback).
  const ready = fontsLoaded || !!fontError;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <NotificationOrchestrator />
        {ready ? <Slot /> : null}
        <MemoryBanner />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
