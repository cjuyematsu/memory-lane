import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Feed } from '@/components/feed/feed';
import { NearMe } from '@/components/near-me/near-me';
import { DisplayFont, Ink, Paper } from '@/constants/theme';
import {
  getPendingCluster,
  subscribePendingCluster,
  usePendingCluster,
} from '@/lib/pending-cluster';

type Tab = 'cameraRoll' | 'nearMe';

const SWIPE_THRESHOLD = 80;
// Memory-feed close is intentionally a bit harder to commit than a tab swipe
// so vertical "next photo" swipes win on diagonal motion without making the
// close feel laggy.
const OVERLAY_SWIPE_THRESHOLD = 100;
const VELOCITY_COMMIT = 500;
const TAB_EASING = Easing.out(Easing.cubic);
const TAB_TIMING = { duration: 220, easing: TAB_EASING };
const OVERLAY_TIMING = { duration: 220, easing: TAB_EASING };

export function TopTabs() {
  const { width } = useWindowDimensions();
  // A tapped notification routes to the Near Me tab to show that location:
  // start there if a cluster is already pending (cold-start tap), and follow
  // later taps via the store subscription (not an effect-watched value).
  const [tab, setTab] = useState<Tab>(() =>
    getPendingCluster() ? 'nearMe' : 'cameraRoll'
  );
  const [memoryEntry, setMemoryEntry] = useState<string | null>(null);
  const [nearMeViewerOpen, setNearMeViewerOpen] = useState(false);
  // True while a feed card (main pager or memory overlay) is being pinch-zoomed,
  // so a two-finger zoom can't also swipe between tabs or close the overlay.
  const [feedZooming, setFeedZooming] = useState(false);

  const tabX = useSharedValue(0);
  const overlayX = useSharedValue(width);
  const pendingCluster = usePendingCluster();

  useEffect(
    () =>
      subscribePendingCluster((id) => {
        if (id) setTab('nearMe');
      }),
    []
  );

  // Animate the pager when `tab` changes (whether by gesture or tap).
  useEffect(() => {
    tabX.value = withTiming(tab === 'cameraRoll' ? 0 : -width, TAB_TIMING);
  }, [tab, width, tabX]);

  // Slide the overlay in when memoryEntry becomes non-null.
  useEffect(() => {
    if (memoryEntry) {
      overlayX.value = width;
      overlayX.value = withTiming(0, OVERLAY_TIMING);
    }
  }, [memoryEntry, width, overlayX]);

  const closeOverlay = () => {
    overlayX.value = withTiming(width, OVERLAY_TIMING, (finished) => {
      'worklet';
      if (finished) scheduleOnRN(setMemoryEntry, null);
    });
  };

  const tabPan = Gesture.Pan()
    // The pager sits underneath the memory-feed overlay and uses
    // pointerEvents="none" while the overlay is open, but on Android RNGH
    // gestures can still receive touches independent of pointerEvents, so
    // a horizontal swipe inside the memory feed was leaking through and
    // switching tabs. Disable the gesture entirely while the overlay is up.
    // Disabled while a memory feed or the notification cluster view is open,
    // so you can't swipe between tabs to escape memories — you must back out
    // of the memory view first (and out of any open photo before that).
    .enabled(memoryEntry == null && !pendingCluster && !nearMeViewerOpen && !feedZooming)
    .activeOffsetX([-15, 15])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      const base = tab === 'cameraRoll' ? 0 : -width;
      tabX.value = base + e.translationX;
    })
    .onEnd((e) => {
      const goLeft = e.translationX < -SWIPE_THRESHOLD || e.velocityX < -VELOCITY_COMMIT;
      const goRight = e.translationX > SWIPE_THRESHOLD || e.velocityX > VELOCITY_COMMIT;
      if (goLeft && tab === 'cameraRoll') {
        scheduleOnRN(setTab, 'nearMe');
      } else if (goRight && tab === 'nearMe') {
        scheduleOnRN(setTab, 'cameraRoll');
      } else {
        tabX.value = withTiming(tab === 'cameraRoll' ? 0 : -width, TAB_TIMING);
      }
    });

  const overlayPan = Gesture.Pan()
    // Mirror image of the tabPan disable: the overlay gesture should only
    // be live when the memory feed is actually open.
    .enabled(memoryEntry != null && !feedZooming)
    // `activeOffsetX(30)` (single positive number) means the gesture only
    // activates after 30px of *rightward* travel. The previous array form
    // `[30, 9999]` is malformed per RNGH's spec (first value must be ≤ 0)
    // and on Android was being interpreted as "activate on x < 30" — which
    // made leftward and vertical-drift swipes incorrectly trigger close.
    .activeOffsetX(30)
    .failOffsetY([-6, 6])
    .onUpdate((e) => {
      overlayX.value = Math.max(0, e.translationX);
    })
    .onEnd((e) => {
      if (e.translationX > OVERLAY_SWIPE_THRESHOLD || e.velocityX > VELOCITY_COMMIT) {
        overlayX.value = withTiming(width, OVERLAY_TIMING, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(setMemoryEntry, null);
        });
      } else {
        overlayX.value = withTiming(0, OVERLAY_TIMING);
      }
    });

  const tabsStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tabX.value }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: overlayX.value }],
  }));

  const nearMeActive = !memoryEntry && tab === 'nearMe';

  return (
    <View style={styles.root}>
      <GestureDetector gesture={tabPan}>
        <Animated.View
          style={[styles.pager, { width: width * 2 }, tabsStyle]}
          pointerEvents={memoryEntry ? 'none' : 'auto'}>
          <View style={{ width }}>
            <Feed
              isActive={tab === 'cameraRoll' && !memoryEntry}
              onZoomChange={setFeedZooming}
            />
          </View>
          <View style={{ width }}>
            <NearMe
              isActive={nearMeActive}
              onOpenMemoryFeed={(assetId) => setMemoryEntry(assetId)}
              onViewerOpenChange={setNearMeViewerOpen}
            />
          </View>
        </Animated.View>
      </GestureDetector>

      <GestureDetector gesture={overlayPan}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
          pointerEvents={memoryEntry ? 'auto' : 'none'}>
          {memoryEntry ? (
            <>
              <Feed
                startAssetId={memoryEntry}
                rememberLastPosition={false}
                showShuffle={false}
                onZoomChange={setFeedZooming}
              />
              <SafeAreaView style={styles.backWrap} pointerEvents="box-none">
                <Pressable onPress={closeOverlay} style={styles.backBtn} hitSlop={12}>
                  <Text style={styles.backLabel}>←</Text>
                </Pressable>
              </SafeAreaView>
            </>
          ) : null}
        </Animated.View>
      </GestureDetector>

      {!memoryEntry && !pendingCluster && !nearMeViewerOpen ? (
        <SafeAreaView edges={['top']} style={styles.barWrap} pointerEvents="box-none">
          <View style={[styles.bar, { width }]} pointerEvents="auto">
            <Pressable style={styles.tabLeft} onPress={() => setTab('cameraRoll')} hitSlop={10}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.label, tab === 'cameraRoll' && styles.labelActive]}>
                CAMERA ROLL
              </Text>
            </Pressable>
            <Pressable style={styles.tabRight} onPress={() => setTab('nearMe')} hitSlop={10}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.label, styles.labelRight, tab === 'nearMe' && styles.labelActive]}>
                NEAR ME
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Paper,
    overflow: 'hidden',
  },
  pager: {
    flex: 1,
    flexDirection: 'row',
  },
  overlay: {
    zIndex: 5,
    backgroundColor: Paper,
  },
  barWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'stretch',
    zIndex: 10,
  },
  bar: {
    // Explicit full screen width (set inline) so the labels measure against the
    // real width and the space-between gap is real.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  // Each label fills its box (adjustsFontSizeToFit). The box widths are the
  // size dial: smaller % → smaller labels + bigger center gap. The 18px below
  // is just the ceiling — the labels render at whatever fills the box.
  tabLeft: {
    width: '32%',
  },
  tabRight: {
    width: '20%',
  },
  label: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 18,
  },
  labelRight: {
    textAlign: 'right',
  },
  labelActive: {
    textDecorationLine: 'underline',
  },
  backWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 10,
  },
  backBtn: {
    marginTop: 0,
    marginLeft: 10,
    paddingHorizontal: 12,
    paddingVertical: 1,
  },
  backLabel: {
    color: Ink,
    fontSize: 30,
    fontWeight: '600',
  },
});
