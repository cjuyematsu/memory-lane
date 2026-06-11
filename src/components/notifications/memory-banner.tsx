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
import { Colors } from '@/constants/theme';
import { clearBanner, useBanner } from '@/lib/foreground-banner';
import { recordEngaged } from '@/lib/notification-engagement';
import { setPendingCluster } from '@/lib/pending-cluster';

const VISIBLE_MS = 5000;
const SLIDE_MS = 280;
const HIDDEN_OFFSET = -160;

export function MemoryBanner() {
  const banner = useBanner();
  const translateY = useSharedValue(HIDDEN_OFFSET);

  useEffect(() => {
    if (!banner) {
      // A tap clears the banner without the slide-out animation; snap back to
      // the hidden offset so the next banner still slides in from off-screen.
      translateY.value = HIDDEN_OFFSET;
      return;
    }
    translateY.value = withTiming(0, {
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
    });
    const timer = setTimeout(() => {
      translateY.value = withTiming(
        HIDDEN_OFFSET,
        { duration: SLIDE_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          'worklet';
          if (finished) scheduleOnRN(clearBanner);
        }
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [banner, translateY]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!banner) return null;

  // One banner = one place (cluster). `count` is how many photos are there, so
  // label the place as a single memory and put the photo count in the subtitle
  // (saying "N memories" read as N separate places, which was confusing).
  const sub =
    banner.count === 1
      ? 'Tap to see 1 photo from here'
      : `Tap to see ${banner.count} photos from here`;

  return (
    <Animated.View style={[styles.wrap, style]} pointerEvents="box-none">
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <Pressable
          style={styles.card}
          onPress={() => {
            recordEngaged(banner.clusterId);
            setPendingCluster(banner.clusterId);
            clearBanner();
          }}>
          <View style={styles.icon}>
            <BellIcon width={18} height={18} fill="#fff" />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.title}>Memory nearby</Text>
            <Text style={styles.sub}>{sub}</Text>
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
  card: {
    marginHorizontal: 12,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.dark.backgroundSelected,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '700',
  },
  sub: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
});
