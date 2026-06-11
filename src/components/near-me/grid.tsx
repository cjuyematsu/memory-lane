import { memo, useCallback, useMemo, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { Image } from 'expo-image';
import { MediaType } from 'expo-media-library';

import { DisplayFont, Ink, Paper } from '@/constants/theme';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';

const GAP = 2; // hairline gutter between tiles, like the Photos grid
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 5;
// In single-column mode each photo gets a tall, space-filling tile rather than
// a lone small square.
const ONE_COL_ASPECT = 4 / 3;
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50 };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type IndexedAsset = { item: NearbyAsset; index: number };
type TileRow = { key: string; month: string; cells: IndexedAsset[] };

function monthLabel(creationTime: number | null): string {
  if (!creationTime) return 'Undated';
  const d = new Date(creationTime);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Photos-app-style grid on the light gallery canvas: square tiles whose top row
// lines up with the Camera Roll photo frame (so the side-swipe between tabs is
// aligned), with the month shown as a small floating label that tracks the
// top-most visible row. Pinch to change the column count (1–5); with very few
// photos it auto-uses fewer, bigger columns so a single photo fills the space.
//
// Uniform fixed-height rows + a precomputed getItemLayout keep scrolling smooth
// (no on-the-fly measurement).
export function Grid({
  items,
  onPressItem,
  paddingTop = 0,
  paddingBottom,
}: {
  items: NearbyAsset[];
  onPressItem: (index: number) => void;
  paddingTop?: number;
  paddingBottom: number;
}) {
  const { width } = useWindowDimensions();

  // Auto-fit small sets until the user pinches, then it's user-controlled.
  const autoColumns = items.length <= 1 ? 1 : items.length === 2 ? 2 : 3;
  const [userColumns, setUserColumns] = useState<number | null>(null);
  const columns = userColumns ?? autoColumns;

  const [opacity] = useState(() => new Animated.Value(1));

  // Pinch out (scale > 1) = zoom in = fewer, bigger tiles; pinch in = more.
  // Fade out, swap the column count while fully invisible (so the heavy reflow
  // frame is hidden), then fade back in — a smooth dip instead of a jerky
  // reflow. Native-driven, so the fade stays smooth while JS does the reflow.
  // The functional updater needs no render-time refs; the first pinch settles
  // relative to a 3-column baseline, then each pinch tracks the last choice.
  const applyPinch = useCallback(
    (scale: number) => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 110,
        useNativeDriver: true,
      }).start(() => {
        setUserColumns((prev) => {
          const next = Math.round((prev ?? 3) / scale);
          return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, next));
        });
        // Two frames so the new layout commits and paints while still invisible.
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            Animated.timing(opacity, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }).start()
          )
        );
      });
    },
    [opacity]
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch().onEnd((e) => {
        'worklet';
        scheduleOnRN(applyPinch, e.scale);
      }),
    [applyPinch]
  );

  const cellW = columns === 1 ? width : (width - GAP * (columns - 1)) / columns;
  const cellH = columns === 1 ? Math.round(width * ONE_COL_ASPECT) : cellW;
  const rowH = cellH + GAP;

  // Chunk each month's photos into rows of `columns` (items arrive newest-first,
  // so order is already descending). Each tile keeps its index into the original
  // `items` array so a tap opens the viewer at the right photo. No header rows —
  // the month shows as a floating label instead — so the first tiles sit at the
  // very top, aligned with the feed.
  const rows = useMemo<TileRow[]>(() => {
    const out: TileRow[] = [];
    let i = 0;
    while (i < items.length) {
      const month = monthLabel(items[i].creationTime);
      let j = i;
      while (j < items.length && monthLabel(items[j].creationTime) === month) j += 1;
      for (let k = i; k < j; k += columns) {
        const cells: IndexedAsset[] = [];
        for (let c = k; c < Math.min(k + columns, j); c += 1) {
          cells.push({ item: items[c], index: c });
        }
        out.push({ key: items[k].asset.id, month, cells });
      }
      i = j;
    }
    return out;
  }, [items, columns]);

  const [currentMonth, setCurrentMonth] = useState(() =>
    items[0] ? monthLabel(items[0].creationTime) : ''
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<TileRow>[] }) => {
      const top = viewableItems[0]?.item;
      if (top) setCurrentMonth((m) => (m === top.month ? m : top.month));
    },
    []
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<TileRow> | null | undefined, index: number) => ({
      length: rowH,
      offset: rowH * index,
      index,
    }),
    [rowH]
  );

  return (
    <GestureDetector gesture={pinch}>
      <Animated.View style={[styles.panel, { marginTop: paddingTop }, { opacity }]}>
        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={(row) => row.key}
          getItemLayout={getItemLayout}
          renderItem={({ item: row }) => (
            <View style={[styles.row, { height: rowH }]}>
              {row.cells.map((cell) => (
                <GridCell
                  key={cell.item.asset.id}
                  item={cell.item}
                  w={cellW}
                  h={cellH}
                  onPress={() => onPressItem(cell.index)}
                />
              ))}
            </View>
          )}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY_CONFIG}
          contentContainerStyle={{ paddingBottom }}
          showsVerticalScrollIndicator={false}
          windowSize={5}
          initialNumToRender={10}
          maxToRenderPerBatch={6}
          removeClippedSubviews
        />
        {currentMonth ? (
          <View style={styles.monthChip} pointerEvents="none">
            <Text style={styles.monthChipText}>{currentMonth}</Text>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const GridCell = memo(function GridCell({
  item,
  w,
  h,
  onPress,
}: {
  item: NearbyAsset;
  w: number;
  h: number;
  onPress: () => void;
}) {
  const isVideo = item.mediaType === MediaType.VIDEO;
  return (
    <Pressable onPress={onPress} style={[styles.cell, { width: w, height: h }]}>
      <Image
        source={{ uri: item.asset.id }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
        recyclingKey={item.asset.id}
      />
      {isVideo ? (
        <View style={styles.videoCenterBadge} pointerEvents="none">
          <View style={styles.playTriangle} />
        </View>
      ) : null}
      {item.isEstimated ? (
        <View style={styles.estimatedBadge} pointerEvents="none">
          <Text style={styles.estimatedLabel}>~</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: Paper,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
    alignItems: 'flex-start',
  },
  cell: {
    backgroundColor: '#E9E9E9',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: Paper,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  monthChipText: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  videoCenterBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderTopWidth: 9,
    borderBottomWidth: 9,
    borderLeftColor: '#fff',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 3,
  },
  estimatedBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  estimatedLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
