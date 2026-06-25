import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import { SpectrumRule } from '@/components/brand/spectrum-rule';
import { MockBanner, MockFeedCard, MockGrid } from '@/components/onboarding/mocks';
import { Colors, DisplayFont, Ink, Paper } from '@/constants/theme';
import { notifyLocationChanged } from '@/hooks/use-current-location';
import { ensureMediaPermission } from '@/hooks/use-media-permission';
import { setNotificationsEnabled } from '@/hooks/use-notification-settings';
import {
  getOnboardingState,
  saveOnboardingProgress,
  setOnboardingCompleted,
} from '@/hooks/use-onboarding';

const polaroid = require('@/assets/images/polaroid.png');

type StepKey =
  | 'welcome'
  | 'privacy'
  | 'photos'
  | 'location'
  | 'notifications'
  | 'background'
  | 'done';
const ORDER: StepKey[] = [
  'welcome',
  'privacy',
  'photos',
  'location',
  'notifications',
  'background',
  'done',
];

const PRIVACY_NOTE = 'Stays on your phone, never uploaded.';

type StepContent = {
  preview: React.ReactNode;
  title: string;
  body: string;
  // The "never leaves your phone" reassurance, shown under permission CTAs.
  reassure?: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

// A drawn padlock for the privacy screen (no lock icon in assets/icons).
function LockGlyph() {
  return (
    <View style={styles.lockWrap}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody} />
    </View>
  );
}

// A drawn map pin for the background-location screen.
function PinGlyph() {
  return (
    <View style={styles.pinWrap}>
      <View style={styles.pin}>
        <View style={styles.pinHole} />
      </View>
    </View>
  );
}

export function OnboardingFlow() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Resume where a previous (killed) run left off. The gate has already loaded
  // the persisted state by the time this mounts, so the cache is warm.
  const [step, setStep] = useState(() =>
    Math.min(Math.max(getOnboardingState().step, 0), ORDER.length - 1)
  );
  const [requesting, setRequesting] = useState(false);

  // Persist progress on every step change (and on mount), so a kill mid-flow
  // resumes here and the user reads as mid-onboarding, not an upgrader.
  useEffect(() => {
    saveOnboardingProgress(step);
  }, [step]);

  const advance = useCallback(() => setStep((s) => s + 1), []);
  const goTo = useCallback((k: StepKey) => setStep(ORDER.indexOf(k)), []);

  // Surface one OS prompt, then navigate. `next` runs even on denial/error, so a
  // declined permission still moves the flow forward (the in-app locked screens
  // and the Settings degraded warning handle the denial later); onboarding never
  // traps the user on a step.
  const runAsk = useCallback(
    (ask: () => Promise<void>, next: () => void) => {
      if (requesting) return;
      setRequesting(true);
      void (async () => {
        try {
          await ask();
        } catch {
          // ignore, navigating anyway
        } finally {
          setRequesting(false);
          next();
        }
      })();
    },
    [requesting]
  );

  const askPhotos = useCallback(
    () => runAsk(async () => void (await ensureMediaPermission()), advance),
    [runAsk, advance]
  );
  const askLocation = useCallback(
    () =>
      runAsk(async () => {
        await Location.requestForegroundPermissionsAsync();
        notifyLocationChanged();
      }, advance),
    [runAsk, advance]
  );
  // Notifications only. If the user allows them (and foreground location was
  // granted on the previous step) we turn the feature on and continue to the
  // dedicated "Always" location page; otherwise asking for background location
  // is pointless, so skip straight to the end.
  const askNotifications = useCallback(() => {
    let toBackground = false;
    runAsk(
      async () => {
        const notif = await Notifications.requestPermissionsAsync();
        const fg = await Location.getForegroundPermissionsAsync();
        if (notif.status === 'granted' && fg.status === 'granted') {
          setNotificationsEnabled(true);
          toBackground = true;
        }
      },
      () => goTo(toBackground ? 'background' : 'done')
    );
  }, [runAsk, goTo]);
  // The "Always" location upgrade, on its own page at the end. Turns the
  // foreground-only feature into true background geofencing; declining leaves it
  // in foreground-only mode (the Settings sheet shows a degraded hint).
  const askBackground = useCallback(
    () =>
      runAsk(async () => {
        const bg = await Location.getBackgroundPermissionsAsync();
        if (bg.status !== 'granted') {
          await Location.requestBackgroundPermissionsAsync();
        }
      }, advance),
    [runAsk, advance]
  );
  const finish = useCallback(() => setOnboardingCompleted(true), []);

  const key = ORDER[step];
  const previewWidth = Math.min(width - 96, 280);

  const content: StepContent = (() => {
    switch (key) {
      case 'welcome':
        return {
          preview: <Image source={polaroid} style={styles.hero} resizeMode="contain" />,
          title: 'Welcome to PastPic',
          body: "Your old photos, tied to the places you took them. Here's a quick tour.",
          primaryLabel: 'Get started',
          onPrimary: advance,
        };
      case 'privacy':
        return {
          preview: <LockGlyph />,
          title: 'It all stays on your phone',
          body: 'PastPic reads your photos and your location right here on your device. Nothing is uploaded. No account, no servers. Your memories never leave your phone.',
          primaryLabel: 'Got it',
          onPrimary: advance,
        };
      case 'photos':
        return {
          preview: <MockFeedCard width={Math.min(previewWidth * 0.72, 188)} />,
          title: 'Camera Roll',
          body: 'A shuffle of your old photos, each one framed with when and where you took it.',
          reassure: true,
          primaryLabel: 'Allow Photos',
          onPrimary: askPhotos,
        };
      case 'location':
        return {
          preview: <MockGrid width={previewWidth} />,
          title: 'Near Me',
          body: 'See the photos you took right around where you’re standing now.',
          reassure: true,
          primaryLabel: 'Allow Location',
          onPrimary: askLocation,
        };
      case 'notifications':
        return {
          preview: <MockBanner width={previewWidth} />,
          title: 'Memory notifications',
          body: 'Walk past a place you took photos a year or more ago and PastPic quietly reminds you, then shows them.',
          reassure: true,
          primaryLabel: 'Turn on notifications',
          onPrimary: askNotifications,
          secondaryLabel: 'Maybe later',
          onSecondary: () => goTo('done'),
        };
      case 'background':
        return {
          preview: <PinGlyph />,
          title: 'Notify me on the move',
          body: 'To notice when you come back to a place, PastPic checks your location in the background, even while the app is closed. Pick "Always Allow" on the next screen.',
          reassure: true,
          primaryLabel: 'Allow background location',
          onPrimary: askBackground,
          secondaryLabel: 'Maybe later',
          onSecondary: advance,
        };
      case 'done':
      default:
        return {
          preview: <Image source={polaroid} style={styles.hero} resizeMode="contain" />,
          title: "You're all set",
          body: 'Swipe between Camera Roll and Near Me. Tune anything later from Settings.',
          primaryLabel: 'Start exploring',
          onPrimary: finish,
        };
    }
  })();

  return (
    // exiting fade so finishing onboarding dissolves into the app (the gate
    // unmounts this on completion) rather than hard-cutting.
    <Animated.View exiting={FadeOut.duration(280)} style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>PASTPIC</Text>
      </View>
      <SpectrumRule width={width} height={3} rx={0} />

      <Animated.View key={key} entering={FadeIn.duration(240)} style={styles.body}>
        <View style={styles.center}>
          <View style={styles.previewArea}>{content.preview}</View>
          <View style={styles.copy}>
            <Text style={styles.title}>{content.title}</Text>
            <Text style={styles.bodyText}>{content.body}</Text>
            {content.reassure ? <Text style={styles.reassure}>{PRIVACY_NOTE}</Text> : null}
          </View>
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            style={[styles.primary, requesting && styles.primaryDisabled]}
            onPress={content.onPrimary}
            disabled={requesting}>
            {requesting ? (
              <ActivityIndicator color={Paper} />
            ) : (
              <Text style={styles.primaryLabel}>{content.primaryLabel}</Text>
            )}
          </Pressable>

          {content.secondaryLabel ? (
            <Pressable onPress={content.onSecondary} disabled={requesting} hitSlop={8}>
              <Text style={styles.secondaryLabel}>{content.secondaryLabel}</Text>
            </Pressable>
          ) : null}

          <View style={styles.dots}>
            {ORDER.map((k, i) => (
              <View key={k} style={[styles.dot, i === step && styles.dotActive]} />
            ))}
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Paper,
    zIndex: 150,
  },
  header: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 16,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  body: {
    flex: 1,
    paddingHorizontal: 28,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  previewArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    width: 150,
    height: 178,
  },
  copy: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 26,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  bodyText: {
    color: Colors.light.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  reassure: {
    color: '#999',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  footer: {
    gap: 16,
    alignItems: 'center',
  },
  primary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 32,
    backgroundColor: Ink,
  },
  primaryDisabled: {
    opacity: 0.6,
  },
  primaryLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 15,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  secondaryLabel: {
    color: Colors.light.textSecondary,
    fontSize: 14,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#D1D1D6',
  },
  dotActive: {
    width: 18,
    backgroundColor: Ink,
  },
  lockWrap: {
    alignItems: 'center',
  },
  lockShackle: {
    width: 30,
    height: 18,
    borderWidth: 5,
    borderBottomWidth: 0,
    borderColor: Ink,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    marginBottom: -2,
  },
  lockBody: {
    width: 46,
    height: 36,
    borderRadius: 8,
    backgroundColor: Ink,
  },
  pinWrap: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Teardrop: a rounded square with one sharp corner (bottom-left), rotated -45°
  // (counter-clockwise) so that corner swings down to a point. Rotating +45°
  // instead sends the point left, laying the pin on its side.
  pin: {
    width: 44,
    height: 44,
    backgroundColor: Ink,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    borderBottomLeftRadius: 2,
    transform: [{ rotate: '-45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinHole: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Paper,
  },
});
