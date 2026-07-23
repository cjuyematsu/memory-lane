import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { Image } from 'expo-image';

import SettingsIcon from '@/assets/icons/settings.svg';
import { frameTop } from '@/components/feed/photo-frame';
import { SettingsSheet } from '@/components/notifications/settings-sheet';
import { RecreationViewer } from '@/components/recreate/recreation-viewer';
import { CardBorder, DisplayFont, FrameMargin, Ink, Paper, PhotoPlaceholder, PhotoRatio } from '@/constants/theme';
import { recreationUri, useRecreations, type Recreation } from '@/lib/recreations';

const COLUMNS = 2;
// Same hairline gutter as the Near Me grid (grid.tsx) — the two grids should
// read as the same surface, this one just runs two-up.
const GAP = 2;

// The Recreations pane: the third tab alongside Camera Roll and Near Me. A
// 2-column grid of kept recreations (the "now" retake with a small "then"
// inset). Same FlashList conventions as the Near Me grid — no recyclingKey,
// cross-dissolve transitions (see grid.tsx for why).
//
// This is a *pane*, not an overlay: TopTabs' horizontal pager owns navigation
// to and from it, so there is no slide-up or swipe-down-to-dismiss here — you
// swipe back to Near Me. Tapping a tile opens the full-screen RecreationViewer;
// while it's open we report up via `onViewerOpenChange` so TopTabs freezes
// tab-swiping (an exact mirror of Near Me's viewer gating).
export function RecreationsGallery({
  onViewerOpenChange,
}: {
  onViewerOpenChange?: (open: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const items = useRecreations();
  const [viewingId, setViewingId] = useState<string | null>(null);
  // The app's Settings gear lives here (this is the profile/"you" tab), floating
  // at the lower-right — the only place it's reachable now.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mount is keyed on viewingId, NOT on the record still existing in the live
  // list: deleting inside the viewer removes the record first (so the grid
  // behind the fade updates immediately) while the viewer — which froze its own
  // copy of the list on open — animates out and then calls onClose. Gating the
  // mount on the live list yanked the viewer the same frame the record
  // vanished. The index only seeds startIndex at mount, where the id always
  // still exists (it was just tapped).
  const viewingIndex =
    viewingId != null && items != null ? items.findIndex((r) => r.id === viewingId) : -1;

  // Report viewer open/close up so TopTabs can gate the pager (same pattern as
  // Near Me). Derive the boolean so it only fires on open/close, not on every
  // list change while the viewer is up.
  const viewerOpen = viewingId != null && items != null;
  useEffect(() => {
    onViewerOpenChange?.(viewerOpen);
  }, [viewerOpen, onViewerOpenChange]);

  const openItem = useCallback((id: string) => setViewingId(id), []);

  const renderItem = useCallback<ListRenderItem<Recreation>>(
    ({ item }) => <GalleryTile rec={item} onPress={openItem} />,
    [openItem]
  );

  return (
    <View style={styles.root}>
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
            // Edge-to-edge like the Near Me grid (no horizontal inset).
            paddingTop: frameTop(insets.top),
            paddingBottom: insets.bottom + 24,
          }}
          showsVerticalScrollIndicator={false}
          maintainVisibleContentPosition={{ disabled: true }}
        />
      )}

      {/* Settings gear — hidden while a recreation is open full-screen (it would
          otherwise float over the viewer via zIndex). */}
      {!viewerOpen ? (
        <Pressable
          onPress={() => setSettingsOpen(true)}
          style={[styles.settingsBtn, { bottom: insets.bottom + 16, right: FrameMargin + 6 }]}
          hitSlop={12}>
          <SettingsIcon width={22} height={22} fill={Ink} />
        </Pressable>
      ) : null}

      {viewerOpen && items ? (
        <RecreationViewer
          items={items}
          startIndex={Math.max(0, viewingIndex)}
          onClose={() => setViewingId(null)}
        />
      ) : null}

      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
  // White pill with a dark gear — matches the memory-banner card so every
  // floating surface in the app reads the same way.
  settingsBtn: {
    position: 'absolute',
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
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
    backgroundColor: PhotoPlaceholder,
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
    backgroundColor: PhotoPlaceholder,
  },
});
