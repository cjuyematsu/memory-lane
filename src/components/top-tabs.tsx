import { useCallback, useEffect, useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import ArrowLeftIcon from '@/assets/icons/arrow-left.svg';
import { SpectrumRule } from '@/components/brand/spectrum-rule';
import { Feed } from '@/components/feed/feed';
import { NearMe } from '@/components/near-me/near-me';
import { RecreationsGallery } from '@/components/recreate/recreations-gallery';
import { DisplayFont, HeaderHeight, Ink, Paper } from '@/constants/theme';
import { subscribeNearMeRequest } from '@/lib/near-me-request';
import {
  getPendingCluster,
  subscribePendingCluster,
  usePendingCluster,
} from '@/lib/pending-cluster';
import { useRecreationTarget } from '@/lib/recreation-request';

type Tab = 'cameraRoll' | 'nearMe' | 'recreations';

// Horizontal offset of the pager for each tab (the pane row is `width * 3`
// wide, laid out cameraRoll | nearMe | recreations). Inlined inside worklets;
// this JS copy drives the tab-change animation.
function tabOffset(tab: Tab, width: number): number {
  return tab === 'cameraRoll' ? 0 : tab === 'nearMe' ? -width : -2 * width;
}

// Bar layout: once the label widths are measured, the row is positioned
// explicitly — MEMORIES anchored to the left edge, NEAR ME locked to the
// exact screen center, RETAKES anchored to the right edge, with equal
// BAR_EDGE_MARGIN on both sides. The words render at near-equal widths
// (MEMORIES / NEAR ME / RETAKES), so the two interior gaps come out balanced
// too — don't swap in a much longer/shorter word without rechecking. Until
// measured, the row falls back to space-evenly for the first frame. Inactive
// labels are dimmed and a label-width ink underline slides (and stretches)
// between measured label centers in sync with the pager (both read `tabX`).
// The internal ids stay `cameraRoll`/`recreations` regardless of the UI
// labels.
const TAB_ITEMS: { tab: Tab; label: string }[] = [
  { tab: 'cameraRoll', label: 'MEMORIES' },
  { tab: 'nearMe', label: 'NEAR ME' },
  { tab: 'recreations', label: 'RETAKES' },
];
const LABEL_DIM = 0.45;
// Outer labels' distance from the screen edges (matches the original bar's
// horizontal padding).
const BAR_EDGE_MARGIN = 14;

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
  // True while a recreation is open full-screen in the Recreations pane, so a
  // tab swipe can't tear the pager out from under it (mirrors nearMeViewerOpen).
  const [recreationsViewerOpen, setRecreationsViewerOpen] = useState(false);

  const tabX = useSharedValue(0);
  const overlayX = useSharedValue(width);
  const pendingCluster = usePendingCluster();
  // The root-mounted RecreationHost covers the screen while a recreation is in
  // flight, but RNGH gestures receive touches independent of overlay coverage
  // (see the tabPan comment below) — so the pager must be disabled explicitly.
  const recreationOpen = useRecreationTarget() != null;

  useEffect(
    () =>
      subscribePendingCluster((id) => {
        if (id) setTab('nearMe');
      }),
    []
  );

  // The app-open "N memories near you" banner switches to Near Me without
  // opening a cluster view (so the user lands on the grid, not a single place).
  useEffect(() => subscribeNearMeRequest(() => setTab('nearMe')), []);

  // Animate the pager when `tab` changes (whether by gesture or tap).
  useEffect(() => {
    tabX.value = withTiming(tabOffset(tab, width), TAB_TIMING);
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
    .enabled(
      memoryEntry == null &&
        !pendingCluster &&
        !nearMeViewerOpen &&
        !feedZooming &&
        !recreationOpen &&
        !recreationsViewerOpen
    )
    .activeOffsetX([-15, 15])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      const base = tab === 'cameraRoll' ? 0 : tab === 'nearMe' ? -width : -2 * width;
      // Clamp to the pane row so a drag past either end reveals no void.
      tabX.value = Math.max(-2 * width, Math.min(0, base + e.translationX));
    })
    .onEnd((e) => {
      const goLeft = e.translationX < -SWIPE_THRESHOLD || e.velocityX < -VELOCITY_COMMIT;
      const goRight = e.translationX > SWIPE_THRESHOLD || e.velocityX > VELOCITY_COMMIT;
      // Step one pane toward the swipe direction (cameraRoll → nearMe →
      // recreations), clamping at the ends.
      let next: Tab = tab;
      if (goLeft) {
        next = tab === 'cameraRoll' ? 'nearMe' : 'recreations';
      } else if (goRight) {
        next = tab === 'recreations' ? 'nearMe' : 'cameraRoll';
      }
      if (next !== tab) {
        scheduleOnRN(setTab, next);
      } else {
        const base = tab === 'cameraRoll' ? 0 : tab === 'nearMe' ? -width : -2 * width;
        tabX.value = withTiming(base, TAB_TIMING);
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

  // Bar-relative center + text width of each label, measured on layout
  // (space-evenly positions depend on the rendered text, so they can't be
  // derived from `width`). The underline matches the active label's width,
  // stretching as it slides; hidden until all three are measured.
  const [labelMetrics, setLabelMetrics] = useState<({ center: number; width: number } | null)[]>(
    [null, null, null]
  );
  const onLabelMeasure = useCallback((index: number, center: number, w: number) => {
    setLabelMetrics((prev) => {
      const cur = prev[index];
      if (cur && cur.center === center && cur.width === w) return prev;
      return prev.map((v, i) => (i === index ? { center, width: w } : v));
    });
  }, []);

  const indicatorStyle = useAnimatedStyle(() => {
    const [m0, m1, m2] = labelMetrics;
    if (m0 == null || m1 == null || m2 == null) {
      return { opacity: 0, width: 0, transform: [{ translateX: 0 }] };
    }
    const progress = -tabX.value / width;
    const center = interpolate(progress, [0, 1, 2], [m0.center, m1.center, m2.center]);
    const w = interpolate(progress, [0, 1, 2], [m0.width, m1.width, m2.width]);
    return { opacity: 1, width: w, transform: [{ translateX: center - w / 2 }] };
  });

  // Explicit label positions once widths are known (see the layout comment on
  // TAB_ITEMS): left-anchored / dead-centered / right-anchored. Applied as
  // marginLefts on the in-flow row; the repositioning re-fires onLayout,
  // refreshing the measured centers the underline uses.
  const [w0, w1, w2] = labelMetrics.map((m) => m?.width);
  let labelMargins: number[] | null = null;
  if (w0 != null && w1 != null && w2 != null) {
    const centerX = width / 2 - w1 / 2;
    const rightX = width - BAR_EDGE_MARGIN - w2;
    labelMargins = [
      BAR_EDGE_MARGIN,
      centerX - (BAR_EDGE_MARGIN + w0),
      rightX - (centerX + w1),
    ];
  }

  const nearMeActive = !memoryEntry && tab === 'nearMe';

  return (
    <View style={styles.root}>
      <GestureDetector gesture={tabPan}>
        <Animated.View
          style={[styles.pager, { width: width * 3 }, tabsStyle]}
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
          <View style={{ width }}>
            <RecreationsGallery onViewerOpenChange={setRecreationsViewerOpen} />
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
                  <ArrowLeftIcon width={28} height={28} color={Ink} />
                </Pressable>
              </SafeAreaView>
            </>
          ) : null}
        </Animated.View>
      </GestureDetector>

      {!memoryEntry && !pendingCluster && !nearMeViewerOpen && !recreationsViewerOpen ? (
        <SafeAreaView edges={['top']} style={styles.barWrap} pointerEvents="box-none">
          <View
            style={[styles.bar, { width }, labelMargins != null && styles.barMeasured]}
            pointerEvents="auto">
            {TAB_ITEMS.map((item, index) => (
              <TabBarLabel
                key={item.tab}
                index={index}
                label={item.label}
                tabX={tabX}
                width={width}
                marginLeft={labelMargins?.[index]}
                onPress={() => setTab(item.tab)}
                onMeasure={onLabelMeasure}
              />
            ))}
            <Animated.View style={[styles.indicator, indicatorStyle]} />
          </View>
          {/* Persistent edge-to-edge spectrum band — the always-on brand
              signature that unifies all tabs and shows the actual logo colors. */}
          <SpectrumRule width={width} height={3} rx={0} />
        </SafeAreaView>
      ) : null}
    </View>
  );
}

function TabBarLabel({
  index,
  label,
  tabX,
  width,
  marginLeft,
  onPress,
  onMeasure,
}: {
  index: number;
  label: string;
  tabX: SharedValue<number>;
  width: number;
  marginLeft: number | undefined;
  onPress: () => void;
  onMeasure: (index: number, center: number, w: number) => void;
}) {
  // Dim continuously with the pager position, so a slow drag crossfades the
  // labels instead of snapping on commit.
  const dimStyle = useAnimatedStyle(() => {
    const progress = -tabX.value / width;
    return {
      opacity: interpolate(
        progress,
        [index - 1, index, index + 1],
        [LABEL_DIM, 1, LABEL_DIM],
        Extrapolation.CLAMP
      ),
    };
  });
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={marginLeft != null ? { marginLeft } : undefined}
      onLayout={(e: LayoutChangeEvent) =>
        onMeasure(
          index,
          e.nativeEvent.layout.x + e.nativeEvent.layout.width / 2,
          e.nativeEvent.layout.width
        )
      }>
      <Animated.Text numberOfLines={1} style={[styles.label, dimStyle]}>
        {label}
      </Animated.Text>
    </Pressable>
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
    // Explicit full screen width (set inline), no horizontal padding — the
    // computed marginLefts position the labels against the full width.
    // space-evenly is only the pre-measurement first-frame fallback.
    // HeaderHeight (not padding) so the spectrum band lands at the same Y as
    // onboarding's, whose header uses the same constant.
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    height: HeaderHeight,
  },
  barMeasured: {
    justifyContent: 'flex-start',
  },
  // One fixed (small) size — no adjustsFontSizeToFit — so all three labels
  // render identically instead of the long words shrinking independently.
  label: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
  },
  indicator: {
    // Width + translateX are animated (label-width underline). bottom sits it
    // tight under the text (2pt clear) so it reads as part of the active word,
    // not a second rule floating near the spectrum band below the bar. (In the
    // 44pt bar the ~16pt text bottom sits 14 from the bar bottom; 10 + 2 height
    // + 2 clear lands the underline right under it.)
    position: 'absolute',
    left: 0,
    bottom: 10,
    height: 2,
    borderRadius: 1,
    backgroundColor: Ink,
  },
  backWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 10,
  },
  backBtn: {
    marginTop: 2,
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
