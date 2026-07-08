import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Asset as MediaAsset } from 'expo-media-library';

import ShareIcon from '@/assets/icons/share.svg';
import XIcon from '@/assets/icons/x.svg';
import { ThenNowPreview } from '@/components/recreate/then-now-preview';
import { useCompositeCapture } from '@/components/recreate/use-composite-capture';
import { DisplayFont, Ink, Paper } from '@/constants/theme';
import { recreationUri, removeRecreation, type Recreation } from '@/lib/recreations';
import {
  requestThenNowShare,
  type ThenNowPrimary,
  type ThenNowShare,
} from '@/lib/share-memory';

// Single-recreation view opened from the gallery grid: the then/now stack with
// re-share, an explicit save of the retaken photo to the camera roll (nothing
// was saved there automatically), and delete. Captions come from the persisted
// record, so everything here works even if the original library photo is gone
// (the then panel degrades inside ThenNowPreview).
export function RecreationViewer({
  recreation,
  onClose,
}: {
  recreation: Recreation;
  onClose: () => void;
}) {
  const nowUri = recreationUri(recreation);
  const [rollState, setRollState] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Starts on the arrangement saved with the pair; tapping the inset swaps it
  // for this viewing (and for any share/save made while it's showing).
  const [primary, setPrimary] = useState<ThenNowPrimary>(recreation.primary);
  const { captureComposite, captureElement } = useCompositeCapture();

  const thenNowData: ThenNowShare = {
    oldAssetId: recreation.oldAssetId,
    newPhotoUri: nowUri,
    oldCreationTime: recreation.oldCreationTime,
    oldLocation: recreation.oldLocation,
    primary,
    capturedDistanceM: recreation.capturedDistanceM,
  };

  const handleShare = () => {
    requestThenNowShare(thenNowData);
  };

  // Saves the CLEAN composite (photo + inset + chip) in the arrangement
  // currently showing. MediaLibraryNext asset creation; the app already holds
  // full read-write photo permission and the add-usage plist string.
  const handleSaveToRoll = async () => {
    if (rollState !== 'idle') return;
    setRollState('saving');
    try {
      const compositeUri = await captureComposite(thenNowData);
      await MediaAsset.create(compositeUri);
      setRollState('saved');
    } catch {
      setRollState('idle');
      Alert.alert("Couldn't save", 'This photo could not be saved to your camera roll.');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete recreation?',
      'This removes the retaken photo from PastPic. Your original photo is not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void removeRecreation(recreation.id);
            onClose();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <XIcon width={28} height={28} color={Ink} />
        </Pressable>
        <Pressable style={styles.shareBtn} onPress={handleShare} hitSlop={12}>
          <ShareIcon width={26} height={26} color={Ink} />
        </Pressable>
      </SafeAreaView>

      <SafeAreaView edges={['top', 'bottom']} style={styles.content}>
        <View style={styles.previewWrap}>
          <ThenNowPreview
            thenUri={recreation.oldAssetId}
            nowUri={nowUri}
            thenCreationTime={recreation.oldCreationTime}
            distanceM={recreation.capturedDistanceM}
            primary={primary}
            onSwap={() => setPrimary((p) => (p === 'now' ? 'then' : 'now'))}
            tone="light"
          />
        </View>

        {/* Same equal-pill grammar as the review screen's action row. */}
        <View style={styles.actions}>
          <Pressable
            style={[styles.pill, rollState !== 'idle' && styles.pillDim]}
            onPress={handleSaveToRoll}
            disabled={rollState !== 'idle'}
            hitSlop={4}>
            <Text style={styles.pillLabel}>
              {rollState === 'saved'
                ? 'Saved'
                : rollState === 'saving'
                  ? 'Saving'
                  : 'Save to photos'}
            </Text>
          </Pressable>
          <Pressable style={styles.pill} onPress={handleDelete} hitSlop={4}>
            <Text style={styles.pillLabel}>Delete</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Off-screen clean-composite renderer used by Save to camera roll. */}
      {captureElement}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Paper,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  closeBtn: {
    marginTop: 2,
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shareBtn: {
    marginTop: 2,
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  previewWrap: {
    flex: 1,
    marginTop: 48,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 10.5,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: Ink,
    alignItems: 'center',
  },
  pillDim: {
    opacity: 0.5,
  },
  pillLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
  },
});
