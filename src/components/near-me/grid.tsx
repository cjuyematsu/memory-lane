import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { MediaType } from 'expo-media-library';

import { Ink, Paper } from '@/constants/theme';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';

const COLUMNS = 3;
const GAP = 2; // hairline gutter between tiles, like the Photos grid
// How far above the content top to scroll when a refresh begins, so the
// RefreshControl spinner (which lives at a negative offset, just out of view at
// the top) becomes fully visible. iOS clamps this to the refresh control's inset;
// Android clamps to 0 and shows its own drop-down overlay spinner.
const REFRESH_REVEAL_OFFSET = 90;

// One clean, continuous 3-column grid of everything nearby on the light gallery
// canvas, newest first — no dates, headers, or floating labels, just the
// photos/videos.
//
// Built on FlashList (view recycling): off-screen tiles are reused rather than
// unmounted. Smooth updates are the priority here over crisp scroll, so the
// tiles deliberately DO NOT set expo-image's `recyclingKey` and instead
// cross-dissolve (`transition`). Why: the list is newest-first, so a new photo
// inserts at index 0 and shifts every item down a slot; the recycler then hands
// each visible cell a different `item`. With `recyclingKey` set, every shifted
// cell would reset to blank/gray before reloading — the whole grid "flashes
// white" on a single add/delete (and every time items cross the radius as you
// walk). Without it, a reassigned cell keeps its current frame and dissolves to
// the new source, so only the changed tile visibly fades. The tradeoff: on a
// FAST scroll a recycled tile can briefly show its previous thumbnail before the
// dissolve catches up (like the Photos app) — accepted on purpose; don't
// re-add `recyclingKey` to "fix" it without re-introducing the flash.
// `maintainVisibleContentPosition` (on by default in FlashList v2) is disabled so
// a new index-0 tile lands at the top of the viewport instead of being anchored
// above it.
//
// Each tile fills its FlashList-enforced column slot (`width: '100%'` + a square
// `aspectRatio`) rather than a hand-computed `useWindowDimensions().width /
// COLUMNS` pixel size. FlashList already wraps every cell in a View it sizes to
// its own measured width / COLUMNS; on Android that measured width and the window
// width don't always agree (display cutouts, insets, rounding), so a fixed
// per-cell pixel width left some columns visibly narrower than their slot. Filling
// the slot keeps all three columns identical on both platforms (pixel-identical on
// iOS, where the two widths already match). The gutter is an inner margin, so the
// gaps show the Paper canvas rather than the placeholder gray.
export const Grid = memo(function Grid({
  items,
  onPressItem,
  paddingTop = 0,
  paddingBottom,
  onRefresh,
  refreshing,
}: {
  items: NearbyAsset[];
  onPressItem: (index: number) => void;
  paddingTop?: number;
  paddingBottom: number;
  // Pull-to-refresh: the grid is a frozen snapshot, so this is how the user asks
  // for fresh nearby photos. Forwarded straight to FlashList's RefreshControl.
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const listRef = useRef<FlashListRef<NearbyAsset>>(null);
  const wasRefreshing = useRef(false);

  // When a refresh begins, reveal the spinner: scroll above the content top so
  // it's visible even if the user was scrolled to the bottom (the side refresh
  // pill triggers `refreshing` without any scroll). A pull-to-refresh is already
  // pinned at this position, so the scroll is a no-op there. Deferred a beat so
  // the RefreshControl's inset is applied before we scroll into it — otherwise
  // iOS clamps the negative offset straight back to the top.
  // When it ends, settle back to the top: iOS's automatic inset retraction is
  // racy and occasionally leaves the content stranded at the revealed negative
  // offset (a white band above row 1), so force the scroll back to 0.
  useEffect(() => {
    const started = !!refreshing && !wasRefreshing.current;
    const ended = !refreshing && wasRefreshing.current;
    wasRefreshing.current = !!refreshing;
    if (started) {
      const t = setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: -REFRESH_REVEAL_OFFSET, animated: true });
      }, 50);
      return () => clearTimeout(t);
    }
    if (ended) {
      // Immediate (no defer): unlike the reveal, this isn't scrolling into an
      // inset, so there's nothing to wait for.
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [refreshing]);

  const renderItem = useCallback<ListRenderItem<NearbyAsset>>(
    ({ item, index }) => <GridCell item={item} index={index} onPress={onPressItem} />,
    [onPressItem]
  );

  return (
    <View style={[styles.panel, { marginTop: paddingTop }]}>
      <FlashList
        ref={listRef}
        data={items}
        numColumns={COLUMNS}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom }}
        showsVerticalScrollIndicator={false}
        maintainVisibleContentPosition={{ disabled: true }}
        refreshControl={
          onRefresh ? (
            // Custom control so the spinner is Ink (black), not the light platform
            // default that washes out against the white canvas. tintColor = iOS,
            // colors = Android.
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              tintColor={Ink}
              colors={[Ink]}
            />
          ) : undefined
        }
      />
    </View>
  );
});

const keyExtractor = (it: NearbyAsset) => it.asset.id;

const GridCell = memo(function GridCell({
  item,
  index,
  onPress,
}: {
  item: NearbyAsset;
  index: number;
  // Stable across renders (the parent passes one callback for the whole grid),
  // so this cell's memo holds and the tile doesn't re-render needlessly.
  onPress: (index: number) => void;
}) {
  const isVideo = item.mediaType === MediaType.VIDEO;
  return (
    <Pressable onPress={() => onPress(index)} style={styles.cell}>
      <View style={styles.cellInner}>
        <Image
          source={{ uri: item.asset.id }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={180}
        />
        {isVideo ? (
          <View style={styles.videoCenterBadge} pointerEvents="none">
            <View style={styles.playTriangle} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: Paper,
  },
  // Fill the column slot FlashList lays out for this cell (its ViewHolder is
  // sized to measuredWidth / COLUMNS) and stay square — so every tile is exactly
  // one slot wide on both platforms, with no fixed pixel width to disagree with
  // the slot on Android.
  cell: {
    width: '100%',
    aspectRatio: 1,
  },
  cellInner: {
    flex: 1,
    margin: GAP / 2,
    backgroundColor: '#E9E9E9',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
});
