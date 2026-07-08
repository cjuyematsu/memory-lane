import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { Image } from 'expo-image';

import XIcon from '@/assets/icons/x.svg';
import { RecreationViewer } from '@/components/recreate/recreation-viewer';
import { DisplayFont, Ink, Paper, PhotoRatio } from '@/constants/theme';
import { recreationUri, useRecreations, type Recreation } from '@/lib/recreations';

const COLUMNS = 2;
const GAP = 4;

// The collection of kept recreations, opened from the top tab bar. A simple
// 2-column grid (counts stay small, so bigger tiles): each tile is the "now"
// retake with a small "then" inset. Same FlashList conventions as the Near Me
// grid — no recyclingKey, cross-dissolve transitions (see grid.tsx for why).
export function RecreationsGallery({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const items = useRecreations();
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Resolve from the live list so a delete inside the viewer can't strand a
  // stale record here.
  const viewing =
    viewingId != null ? (items?.find((r) => r.id === viewingId) ?? null) : null;

  const openItem = useCallback((id: string) => setViewingId(id), []);

  const renderItem = useCallback<ListRenderItem<Recreation>>(
    ({ item }) => <GalleryTile rec={item} onPress={openItem} />,
    [openItem]
  );

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <Text style={styles.title}>Recreations</Text>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <XIcon width={28} height={28} color={Ink} />
        </Pressable>
      </SafeAreaView>

      {items == null ? null : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            Nothing here yet. Retake an old photo to start.
          </Text>
        </View>
      ) : (
        <FlashList
          data={items}
          numColumns={COLUMNS}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingBottom: insets.bottom + 24,
          }}
          showsVerticalScrollIndicator={false}
          maintainVisibleContentPosition={{ disabled: true }}
        />
      )}

      {viewing ? (
        <RecreationViewer recreation={viewing} onClose={() => setViewingId(null)} />
      ) : null}
    </View>
  );
}

const keyExtractor = (r: Recreation) => r.id;

const GalleryTile = memo(function GalleryTile({
  rec,
  onPress,
}: {
  rec: Recreation;
  onPress: (id: string) => void;
}) {
  // Keyed to the record so a recycled cell can't inherit another item's
  // failure (the id comparison self-corrects on reassignment).
  const [thenFailedFor, setThenFailedFor] = useState<string | null>(null);
  const thenFailed = thenFailedFor === rec.id;
  return (
    <Pressable onPress={() => onPress(rec.id)} style={styles.cell}>
      <View style={styles.cellInner}>
        <Image
          source={{ uri: recreationUri(rec) }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={180}
        />
        {!thenFailed ? (
          // The "then" inset renders the library asset by id; if the original
          // was deleted the load errors and the inset quietly disappears —
          // the tile is still the (always-present) retake.
          <View style={styles.inset} pointerEvents="none">
            <Image
              source={{ uri: rec.oldAssetId }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={180}
              onError={() => setThenFailedFor(rec.id)}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingBottom: 8,
  },
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 22,
    textTransform: 'uppercase',
  },
  closeBtn: {
    marginTop: 2,
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textAlign: 'center',
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  cell: {
    width: '100%',
    aspectRatio: 1,
  },
  cellInner: {
    flex: 1,
    margin: GAP / 2,
    borderRadius: 6,
    backgroundColor: '#E9E9E9',
    overflow: 'hidden',
  },
  // Small "then" preview, bottom-left, in the app's 3:4 frame shape with a
  // hairline Paper border so it reads against the photo behind it.
  inset: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    width: '38%',
    aspectRatio: PhotoRatio,
    borderWidth: 2,
    borderColor: Paper,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#E9E9E9',
  },
});
