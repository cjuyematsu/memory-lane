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

import BellIcon from '@/assets/icons/bell.svg';
import { SpectrumRule } from '@/components/brand/spectrum-rule';
import { MockFeedCard, MockGrid } from '@/components/onboarding/mocks';
import { CooldownPicker } from '@/components/notifications/cooldown-picker';
import { Colors, DisplayFont, Ink, Paper, PhotoRatio } from '@/constants/theme';
import { notifyLocationChanged } from '@/hooks/use-current-location';
import { ensureMediaPermission } from '@/hooks/use-media-permission';
import {
  setNotificationsEnabled,
  setPlaceCooldownMs,
  useNotificationSettings,
} from '@/hooks/use-notification-settings';
import {
  getOnboardingState,
  saveOnboardingProgress,
  setOnboardingCompleted,
} from '@/hooks/use-onboarding';

const polaroid = require('@/assets/images/polaroid.png');
// The cropped polaroid asset's width / height. Sizing the welcome/done hero from
// this (rather than a hand-picked box) keeps it pixel-matched to the boot loader
// (loading-polaroid.tsx) and avoids any contain-fit letterboxing.
const POLAROID_ASPECT = 508 / 602;

type StepKey =
  | 'welcome'
  | 'privacy'
  | 'photos'
  | 'location'
  | 'notifications'
  | 'background'
  | 'remind'
  | 'done';
const ORDER: StepKey[] = [
  'welcome',
  'privacy',
  'photos',
  'location',
  'notifications',
  'background',
  'remind',
  'done',
];

const PRIVACY_NOTE = 'Stays on your phone, never uploaded.';

type StepContent = {
  preview: React.ReactNode;
  title: string;
  body: string;
  // The "never leaves your phone" reassurance, shown under permission CTAs.
  reassure?: boolean;
  // An optional interactive element rendered under the body copy (e.g. the
  // reminder-cadence picker). Most steps leave this undefined.
  extra?: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

// A drawn padlock for the privacy screen, sized to sit inside the glyph circle
// (no lock icon in assets/icons).
function LockGlyph({ size }: { size: number }) {
  const bodyW = size * 0.74;
  const bodyH = size * 0.58;
  const shackleW = size * 0.48;
  const shackleH = size * 0.36;
  const shackleBorder = size * 0.1;
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: shackleW,
          height: shackleH,
          borderWidth: shackleBorder,
          borderBottomWidth: 0,
          borderColor: Ink,
          borderTopLeftRadius: shackleW / 2,
          borderTopRightRadius: shackleW / 2,
          marginBottom: -shackleBorder * 0.5,
        }}
      />
      <View style={{ width: bodyW, height: bodyH, borderRadius: size * 0.12, backgroundColor: Ink }} />
    </View>
  );
}

// A drawn map pin for the background-location screen: a rounded square with one
// sharp corner, rotated -45° so that corner points straight down.
function PinGlyph({ size }: { size: number }) {
  const sq = size * 0.7; // the rotated square's diagonal ≈ size (its visual height)
  const hole = sq * 0.36;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: sq,
          height: sq,
          backgroundColor: Ink,
          borderTopLeftRadius: sq / 2,
          borderTopRightRadius: sq / 2,
          borderBottomRightRadius: sq / 2,
          borderBottomLeftRadius: sq * 0.08,
          transform: [{ rotate: '-45deg' }],
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ width: hole, height: hole, borderRadius: hole / 2, backgroundColor: Paper }} />
      </View>
    </View>
  );
}

// A drawn clock for the reminder-cadence screen: a circle outline with an hour
// and minute hand. Each hand is a center-anchored bar inside a square overlay
// that's rotated about its own center (default RN rotate origin), so no
// transform-origin gymnastics. Sized to sit inside the glyph circle.
function ClockHand({ size, length, angle }: { size: number; length: number; angle: number }) {
  const thickness = size * 0.075;
  return (
    <View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        alignItems: 'center',
        transform: [{ rotate: `${angle}deg` }],
      }}>
      {/* A bar reaching from the clock's center upward; its height ends at center. */}
      <View
        style={{
          width: thickness,
          height: length,
          backgroundColor: Ink,
          borderRadius: thickness / 2,
          marginTop: size / 2 - length,
        }}
      />
    </View>
  );
}

function ClockGlyph({ size }: { size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: size * 0.07,
        borderColor: Ink,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <ClockHand size={size} length={size * 0.32} angle={0} />
      <ClockHand size={size} length={size * 0.22} angle={110} />
      <View
        style={{ width: size * 0.13, height: size * 0.13, borderRadius: size * 0.065, backgroundColor: Ink }}
      />
    </View>
  );
}

// A black outline ring that holds a single glyph, giving the concept steps
// (privacy / notifications / background) a consistent container — present, but
// distinct from the polaroid, which is reserved for welcome/done.
function GlyphCircle({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: Ink,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {children}
    </View>
  );
}

export function OnboardingFlow() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const settings = useNotificationSettings();
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

  // Remember the path actually taken, not just step-1, so Back returns to the
  // screen the user really came from. Navigation isn't linear: declining
  // notifications jumps straight to the end (skipping the background + reminder
  // steps), and Back from there must land back on the notifications step, not on
  // a step that was never shown. (Empty after a resume-from-kill → linear fallback.)
  const [history, setHistory] = useState<number[]>([]);
  const goToIndex = useCallback(
    (next: number) => {
      setHistory((h) => [...h, step]);
      setStep(next);
    },
    [step]
  );
  const advance = useCallback(() => goToIndex(step + 1), [goToIndex, step]);
  const goTo = useCallback((k: StepKey) => goToIndex(ORDER.indexOf(k)), [goToIndex]);
  // Back pops the real history; the header back button is hidden on the first
  // step. Permission asks only fire on the primary button, so stepping back
  // never re-prompts.
  const goBack = useCallback(() => {
    if (history.length === 0) {
      setStep((s) => Math.max(0, s - 1));
      return;
    }
    setStep(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  }, [history]);

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
  // One fixed-height stage holds the hero on every step, and each hero is
  // bottom-aligned within it (styles.stage), so the gap from the hero down to the
  // title is identical on every step — copy and buttons never move, and a smaller
  // hero just gets more breathing room above it rather than a void before its
  // caption. Every hero is sized to roughly fill this stage so none floats as a
  // tiny mark. Capped fraction of screen height so the tallest step still clears
  // the pinned footer on the shortest supported screen (iOS 16.4 floor = 667pt).
  const stageH = Math.min(230, height * 0.28);
  const previewWidth = Math.min(width - 96, 280);
  // Welcome / done polaroid, sized from the asset aspect. This is the reference
  // footprint every other hero is sized against, so no step's visual dwarfs the
  // rest as you click through.
  const heroH = Math.min(178, stageH * 0.78);
  const heroW = heroH * POLAROID_ASPECT;
  // Concept steps (privacy / notifications / background) show their symbol in a
  // black outline circle the same height as the polaroid, so the focal mark keeps
  // the same size and position across all five non-mock steps.
  const circleD = heroH;
  const glyphSize = heroH * 0.44;
  // Feed-card mock: a 3:4 frame + caption that fills the stage height.
  const feedW = Math.min(180, (stageH - 76) * PhotoRatio);
  // Near Me grid: keep it square at the polaroid's height instead of letting it
  // sprawl wider and taller than every other hero.
  const gridW = Math.min(previewWidth, heroH);
  // Top-anchor the hero + title at a fixed offset (rather than centering the whole
  // block) so they land at the same Y on every step; only the body text below grows
  // with longer copy, and the footer stays pinned — keeps the eye from jumping.
  const contentTop = Math.min(Math.max(height * 0.08, 28), 88);

  const content: StepContent = (() => {
    switch (key) {
      case 'welcome':
        return {
          preview: (
            <Image
              source={polaroid}
              style={{ width: heroW, height: heroH }}
              resizeMode="contain"
            />
          ),
          title: 'Welcome to PastPic',
          body: "Your old photos, tied to the places you took them. Here's a quick tour.",
          primaryLabel: 'Get started',
          onPrimary: advance,
        };
      case 'privacy':
        return {
          preview: (
            <GlyphCircle size={circleD}>
              <LockGlyph size={glyphSize} />
            </GlyphCircle>
          ),
          title: 'It all stays on your phone',
          body: 'PastPic reads your photos and your location right here on your device. Nothing is uploaded. No account, no servers. Your memories never leave your phone.',
          primaryLabel: 'Got it',
          onPrimary: advance,
        };
      case 'photos':
        return {
          preview: <MockFeedCard width={feedW} />,
          title: 'Camera Roll',
          body: 'A shuffle of your old photos, each one framed with when and where you took it.',
          reassure: true,
          primaryLabel: 'Allow Photos',
          onPrimary: askPhotos,
        };
      case 'location':
        return {
          preview: <MockGrid width={gridW} />,
          title: 'Near Me',
          body: 'See the photos you took right around where you’re standing now.',
          reassure: true,
          primaryLabel: 'Allow Location',
          onPrimary: askLocation,
        };
      case 'notifications':
        return {
          preview: (
            <GlyphCircle size={circleD}>
              <BellIcon width={glyphSize} height={glyphSize} fill={Ink} />
            </GlyphCircle>
          ),
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
          preview: (
            <GlyphCircle size={circleD}>
              <PinGlyph size={glyphSize} />
            </GlyphCircle>
          ),
          title: 'Notify me on the move',
          body: 'To notice when you come back to a place, PastPic checks your location in the background, even while the app is closed. Pick "Always Allow" on the next screen.',
          reassure: true,
          primaryLabel: 'Allow background location',
          onPrimary: askBackground,
          secondaryLabel: 'Maybe later',
          onSecondary: advance,
        };
      case 'remind':
        return {
          preview: (
            <GlyphCircle size={circleD}>
              <ClockGlyph size={glyphSize} />
            </GlyphCircle>
          ),
          title: 'Remind me again',
          body: 'When you return to a place, PastPic reminds you once, then waits before reminding you there again. Pick how long, or have each place remind you just once.',
          extra: (
            <CooldownPicker
              value={settings.placeCooldownMs}
              onChange={setPlaceCooldownMs}
            />
          ),
          primaryLabel: 'Sounds good',
          onPrimary: advance,
        };
      case 'done':
      default:
        return {
          preview: (
            <Image
              source={polaroid}
              style={{ width: heroW, height: heroH }}
              resizeMode="contain"
            />
          ),
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
        {step > 0 ? (
          <Pressable
            style={styles.back}
            onPress={goBack}
            disabled={requesting}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <View style={styles.chevron} />
          </Pressable>
        ) : null}
        <Text style={styles.wordmark}>PASTPIC</Text>
      </View>
      <SpectrumRule width={width} height={3} rx={0} />

      <Animated.View key={key} entering={FadeIn.duration(240)} style={styles.body}>
        <View style={[styles.center, { paddingTop: contentTop }]}>
          <View style={[styles.stage, { height: stageH }]}>{content.preview}</View>
          <View style={styles.copy}>
            <Text style={styles.title}>{content.title}</Text>
            <Text style={styles.bodyText}>{content.body}</Text>
            {/* Always occupy the reassurance line's height so the title-to-button
                distance is constant; the text only shows on permission steps. */}
            <Text style={styles.reassure}>{content.reassure ? PRIVACY_NOTE : ' '}</Text>
            {content.extra ? <View style={styles.extra}>{content.extra}</View> : null}
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

          {/* Fixed-height slot so the primary button + dots hold their position
              whether or not a step offers a "Maybe later" action. */}
          <View style={styles.secondarySlot}>
            {content.secondaryLabel ? (
              <Pressable onPress={content.onSecondary} disabled={requesting} hitSlop={8}>
                <Text style={styles.secondaryLabel}>{content.secondaryLabel}</Text>
              </Pressable>
            ) : null}
          </View>

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
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: {
    position: 'absolute',
    left: 16,
    top: 0,
    bottom: 0,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A CSS-style chevron: a square with two adjacent borders, rotated to point left.
  chevron: {
    width: 11,
    height: 11,
    borderLeftWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: Ink,
    transform: [{ rotate: '45deg' }],
    marginLeft: 3,
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
  // Top-anchored (paddingTop set inline) so the hero + title hold a constant Y on
  // every step; the footer is pinned separately, so variable body length only
  // changes the whitespace above the button, never the focal point.
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 40,
  },
  // Fixed-height stage (height set inline). Centers the hero so every hero's
  // optical center sits at the same Y; a shorter hero just gets breathing room
  // above and below rather than moving the focal point.
  stage: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    alignItems: 'center',
    gap: 12,
  },
  extra: {
    marginTop: 4,
    alignItems: 'center',
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
    lineHeight: 16,
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
  // Reserves the secondary action's footprint on every step so the primary
  // button and dots don't shift when a step has no "Maybe later".
  secondarySlot: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
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
});
