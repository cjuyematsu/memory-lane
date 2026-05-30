import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { MemoryBanner } from '@/components/notifications/memory-banner';
import { NotificationOrchestrator } from '@/components/notifications/notification-orchestrator';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <NotificationOrchestrator />
        <Slot />
        <MemoryBanner />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
