import { memo } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Image } from 'expo-image';
import { MediaType } from 'expo-media-library';

import { useAssetMetadata } from '@/hooks/use-asset-metadata';
import type { NearbyAsset } from '@/hooks/use-nearby-assets';

const COLUMNS = 3;
const GAP = 2;

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
  const cellSize = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <FlatList
      data={items}
      keyExtractor={(it) => it.asset.id}
      numColumns={COLUMNS}
      columnWrapperStyle={styles.row}
      contentContainerStyle={[styles.content, { paddingTop, paddingBottom }]}
      renderItem={({ item, index }) => (
        <Pressable onPress={() => onPressItem(index)} style={styles.cellWrapper}>
          <GridCell item={item} size={cellSize} />
        </Pressable>
      )}
      windowSize={5}
      initialNumToRender={COLUMNS * 6}
      maxToRenderPerBatch={COLUMNS * 4}
    />
  );
}

const GridCell = memo(function GridCell({
  item,
  size,
}: {
  item: NearbyAsset;
  size: number;
}) {
  const isVideo = item.mediaType === MediaType.VIDEO;
  const meta = useAssetMetadata(Platform.OS === 'ios' ? null : item.asset);
  const thumbnailUri = Platform.OS === 'ios' ? item.asset.id : meta?.uri;

  return (
    <View style={[styles.cell, { width: size, height: size }]}>
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          recyclingKey={item.asset.id}
        />
      ) : null}
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
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    gap: GAP,
  },
  content: {
    gap: GAP,
  },
  cellWrapper: {
    backgroundColor: '#111',
  },
  cell: {
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
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
