import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import BellIcon from '@/assets/icons/bell.svg';
import { Colors, DisplayFont, Ink, Paper } from '@/constants/theme';
import { clearBanner, useBanner } from '@/lib/foreground-banner';
import { requestNearMe } from '@/lib/near-me-request';
import { setPendingCluster } from '@/lib/pending-cluster';

const VISIBLE_MS = 5000;
// Smooth, slightly slower than a snap: a long ease-out settle on the way in and
// a gentle ease-in on the way out, with opacity + a hair of scale so it dissolves
// rather than just sliding. Curves are eased-quint-ish (in) / standard (out).
const ENTER_MS = 460;
const EXIT_MS = 360;
const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);
const EXIT_EASING = Easing.bezier(0.4, 0, 0.6, 1);
const HIDDEN_OFFSET = -180;
const HIDDEN_SCALE = 0.96;

export function MemoryBanner() {
  const banner = useBanner();
  const translateY = useSharedValue(HIDDEN_OFFSET);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(HIDDEN_SCALE);

  useEffect(() => {
    if (!banner) {
      // A tap clears the banner (and navigates away) without an out-animation;
      // reset to the hidden pose so the next banner animates in cleanly.
      translateY.value = HIDDEN_OFFSET;
      opacity.value = 0;
      scale.value = HIDDEN_SCALE;
      return;
    }
    translateY.value = withTiming(0, { duration: ENTER_MS, easing: ENTER_EASING });
    scale.value = withTiming(1, { duration: ENTER_MS, easing: ENTER_EASING });
    opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) });
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) });
      scale.value = withTiming(HIDDEN_SCALE, { duration: EXIT_MS, easing: EXIT_EASING });
      translateY.value = withTiming(
        HIDDEN_OFFSET,
        { duration: EXIT_MS, easing: EXIT_EASING },
        (finished) => {
          'worklet';
          if (finished) scheduleOnRN(clearBanner);
        }
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [banner, translateY, opacity, scale]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  if (!banner) return null;

  // Two banner shapes share this one host (so they can never stack):
  // - 'cluster': one place the user entered. `count` is how many photos are
  //   there, so label the place as a single memory and put the photo count in
  //   the subtitle (saying "N memories" read as N separate places).
  // - 'nearby': the app-open greeting. Here `count` IS the number of nearby
  //   memories, so it's the headline.
  let title: string;
  let sub: string;
  let onPress: () => void;
  if (banner.kind === 'cluster') {
    const clusterId = banner.clusterId;
    title = 'Memory nearby';
    sub =
      banner.count === 1
        ? 'Tap to see 1 photo from here'
        : `Tap to see ${banner.count} photos from here`;
    onPress = () => {
      setPendingCluster(clusterId);
      clearBanner();
    };
  } else {
    title = `${banner.count} ${banner.count === 1 ? 'memory' : 'memories'} near you`;
    sub = 'Tap to look back';
    onPress = () => {
      requestNearMe();
      clearBanner();
    };
  }

  return (
    <Animated.View style={[styles.wrap, style]} pointerEvents="box-none">
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <Pressable style={styles.card} onPress={onPress}>
          <View style={styles.icon}>
            <BellIcon width={13} height={13} fill={Paper} />
          </View>
          <View style={styles.textWrap}>
            <Text
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}>
              {title}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {sub}
            </Text>
          </View>
        </Pressable>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  // Gallery look: white "paper" card, Ink hairline + soft shadow, matching the
  // Near Me pills and the Ink/Paper duotone used across the app.
  card: {
    marginHorizontal: 12,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: Paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,17,17,0.10)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  // Ink-filled badge with a Paper bell — same treatment as the app's primary
  // (Ink) buttons, so it reads as a deliberate accent on the white card. Sized
  // to hug the bell so the icon stays in scale with the (tab-sized) title.
  icon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Ink,
  },
  textWrap: {
    flex: 1,
  },
  // Match the rendered size of the CAMERA ROLL / NEAR ME tab labels (~13px) —
  // the banner pops up in the same spot, so the type should read at that size.
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  sub: {
    color: Colors.light.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
});
