import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { MediaType } from 'expo-media-library';

import RefreshIcon from '@/assets/icons/refresh.svg';
import { Ink, Paper, PhotoPlaceholder } from '@/constants/theme';
import { useIcloudImageLoad } from '@/hooks/use-icloud-image-load';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';
import { setAssetRatio } from '@/lib/asset-ratio-cache';
import { isStaleLoadEvent } from '@/lib/image-load-event';

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
  isActive = true,
}: {
  items: NearbyAsset[];
  onPressItem: (index: number) => void;
  paddingTop?: number;
  paddingBottom: number;
  // Pull-to-refresh: the grid is a frozen snapshot, so this is how the user asks
  // for fresh nearby photos. Forwarded straight to FlashList's RefreshControl.
  onRefresh?: () => void;
  refreshing?: boolean;
  // Whether the Near Me pane is the one on screen. Both TopTabs panes stay
  // mounted, so this gates the tiles' stall-recovery timers: while the user
  // sits on Camera Roll the grid's fetches are deprioritized behind the visible
  // feed, and an ungated 12s zero-progress deadline would mass-mark background
  // tiles unreachable (dropping their images) before the user ever looks.
  isActive?: boolean;
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
    ({ item, index }) => (
      <GridCell item={item} index={index} onPress={onPressItem} isActive={isActive} />
    ),
    [onPressItem, isActive]
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
  isActive,
}: {
  item: NearbyAsset;
  index: number;
  // Stable across renders (the parent passes one callback for the whole grid),
  // so this cell's memo holds and the tile doesn't re-render needlessly.
  onPress: (index: number) => void;
  isActive: boolean;
}) {
  const isVideo = item.mediaType === MediaType.VIDEO;
  // Bounded load so a stalled iCloud thumbnail can't leave the tile black forever
  // (and keep its native fetch pinned). On `unreachable` we drop the <Image> and
  // show a tap-to-retry instead. No spinner while loading — a per-tile spinner
  // would be noisy in a 3-up grid; the gray placeholder is enough. Timers run
  // only while the pane is on screen (same rule as the feed card / viewer page:
  // the deadline measures the user's wait, not background time); the load
  // callbacks always work.
  const load = useIcloudImageLoad(item.asset.id, { enabled: isActive });
  return (
    <Pressable onPress={() => onPress(index)} style={styles.cell}>
      <View style={styles.cellInner}>
        {!(load.unreachable && !load.preview) ? (
          <>
            <Image
              // Nonce-ONLY key (never the asset id): bumping it remounts the
              // image so Retry re-issues a stalled fetch even while the blurred
              // preview keeps it mounted. The id must stay out of the key — this
              // is a recycling list, and an id-keyed element would remount (and
              // blank) every reassigned cell, undoing the cross-dissolve the
              // no-recyclingKey design exists for.
              key={String(load.reloadNonce)}
              source={{ uri: item.asset.id }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={180}
              // Record the poster's intrinsic ratio (reported regardless of
              // contentFit) so the viewer can open this asset at its true shape with
              // no resize snap. Free — the tile decodes the poster anyway.
              onLoad={(e) => {
                // A recycled cell can receive the previous source's late onLoad;
                // crediting it to this asset would disarm its recovery timers
                // and record the wrong ratio.
                if (isStaleLoadEvent(e, item.asset.id)) return;
                const { width: w, height: h } = e.source ?? {};
                if (w && h) setAssetRatio(item.asset.id, w / h);
                load.onLoad(e);
              }}
              onError={load.onError}
              // No visible progress UI in a 3-up grid, but the ticks feed the
              // stall detector so a slow tile isn't falsely declared dead.
              onProgress={load.onProgress}
            />
            {load.unreachable ? (
              // Stalled with the blurred preview still showing: keep the photo and
              // offer a quiet corner retry instead of replacing the tile. The live
              // request can still complete and clear this on its own.
              <Pressable onPress={load.retry} style={styles.retryBadge} hitSlop={8}>
                <RefreshIcon width={12} height={12} fill={Paper} />
              </Pressable>
            ) : null}
          </>
        ) : (
          // Stalled fetch with nothing showing, image dropped: a quiet retry glyph
          // on the placeholder tile. Its own Pressable wins the touch over the
          // cell-open Pressable, and tapping re-mounts the <Image> above for a
          // fresh attempt.
          <Pressable onPress={load.retry} style={styles.retryTile} hitSlop={6}>
            <RefreshIcon width={20} height={20} fill={Ink} />
          </Pressable>
        )}
        {isVideo ? (
          // Subtle corner cue: a small white play triangle with a soft dark
          // underlay (legible over bright photos) instead of a big centered
          // circle. Mirrors the tiny play glyph on the viewer filmstrip thumbs.
          <View style={styles.videoBadge} pointerEvents="none">
            <View style={styles.playTriangleShadow} />
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
    // Softly rounded tiles — gentler than the tight Apple-Photos grid. The
    // gutter already shows the Paper canvas between tiles, so the rounding reads
    // cleanly against white.
    borderRadius: 6,
    backgroundColor: PhotoPlaceholder,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fills the tile when a stalled load is dropped: a centered retry glyph on the
  // placeholder gray.
  retryTile: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Corner retry over a still-showing blurred preview (bottom-right; the video
  // badge owns bottom-left). Dark scrim circle so the glyph reads on any photo.
  retryBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bottom-left corner, inset off the tile edge.
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 12,
    height: 16,
  },
  // White right-pointing triangle, sitting over a slightly larger dark triangle
  // that reads as a ~1px outline/shadow so the cue stays visible on any photo.
  playTriangle: {
    position: 'absolute',
    left: 1,
    top: 2,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: '#fff',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  playTriangleShadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: 'rgba(0,0,0,0.75)',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
});
