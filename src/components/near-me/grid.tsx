import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { MediaType } from 'expo-media-library';

import { Paper } from '@/constants/theme';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';

const COLUMNS = 3;
const GAP = 2; // hairline gutter between tiles, like the Photos grid

// One clean, continuous 3-column grid of everything nearby on the light gallery
// canvas, newest first — no dates, headers, or floating labels, just the
// photos/videos.
//
// Built on FlashList (view recycling): off-screen tiles are reused rather than
// unmounted, so scrolling back never blanks a tile to gray while expo-image
// re-decodes. That blank-to-image "flicker in/out" was the FlatList behavior
// this replaces. `recyclingKey` is correct here (recycling list): it resets a
// reused cell to its own image, so a recycled tile never flashes the previous
// photo for a frame.
//
// Tiles are sized explicitly to width / COLUMNS so three fill a row exactly (no
// sub-pixel slivers); the gutter is an inner margin, so the gaps show the Paper
// canvas rather than the placeholder gray.
export const Grid = memo(function Grid({
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
  const size = width / COLUMNS;

  const renderItem = useCallback<ListRenderItem<NearbyAsset>>(
    ({ item, index }) => (
      <GridCell item={item} index={index} size={size} onPress={onPressItem} />
    ),
    [size, onPressItem]
  );

  return (
    <View style={[styles.panel, { marginTop: paddingTop }]}>
      <FlashList
        data={items}
        numColumns={COLUMNS}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
});

const keyExtractor = (it: NearbyAsset) => it.asset.id;

const GridCell = memo(function GridCell({
  item,
  index,
  size,
  onPress,
}: {
  item: NearbyAsset;
  index: number;
  size: number;
  // Stable across renders (the parent passes one callback for the whole grid),
  // so this cell's memo holds and the tile doesn't re-render needlessly.
  onPress: (index: number) => void;
}) {
  const isVideo = item.mediaType === MediaType.VIDEO;
  return (
    <Pressable onPress={() => onPress(index)} style={{ width: size, height: size }}>
      <View style={styles.cellInner}>
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
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: Paper,
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
