import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Asset as MediaAsset } from 'expo-media-library';

import XIcon from '@/assets/icons/x.svg';
import { type CapturedPhoto } from '@/components/recreate/recreation-host';
import { ThenNowPreview } from '@/components/recreate/then-now-preview';
import { useCompositeCapture } from '@/components/recreate/use-composite-capture';
import { DisplayFont, Ink, Letterbox, Paper } from '@/constants/theme';
import { loadAssetCreationTime, loadAssetLocation } from '@/hooks/use-asset-metadata';
import { addRecreation } from '@/lib/recreations';
import { type RecreationTarget } from '@/lib/recreation-request';
import {
  requestThenNowShare,
  shareFile,
  type ThenNowPrimary,
  type ThenNowShare,
} from '@/lib/share-memory';

// What the user is producing: the two photos together (BeReal composite,
// saveable into the in-app gallery) or just the retake on its own (shared as a
// plain photo, saved straight to the camera roll).
type OutputMode = 'both' | 'today';

// Post-capture review, dark like the camera: the BeReal-style pair (tap the
// inset to swap which photo is big — what's showing is what ships) with
// explicit actions only. Retake returns to the camera, X discards, Share and
// Save follow the BOTH / JUST TODAY toggle. Sharing never implies saving.
export function RecreationReview({
  target,
  photo,
  onRetake,
  onDone,
}: {
  target: RecreationTarget;
  photo: CapturedPhoto;
  onRetake: () => void;
  onDone: () => void;
}) {
  // Caption/persistence inputs: use what the caller knew, backfill the rest
  // from the deduped metadata loaders (a no-GPS photo legitimately stays null).
  const [creationTime, setCreationTime] = useState(target.creationTime);
  const [location, setLocation] = useState(target.location);
  useEffect(() => {
    let cancelled = false;
    if (target.creationTime == null) {
      loadAssetCreationTime(target.asset)
        .then((t) => {
          if (!cancelled && t != null) setCreationTime(t);
        })
        .catch(() => {});
    }
    if (target.location == null) {
      loadAssetLocation(target.asset)
        .then((l) => {
          if (!cancelled && l) setLocation(l);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [target]);

  const [mode, setMode] = useState<OutputMode>('both');
  const [primary, setPrimary] = useState<ThenNowPrimary>('now');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const { captureComposite, captureElement } = useCompositeCapture();

  const thenNowData: ThenNowShare = {
    oldAssetId: target.asset.id,
    newPhotoUri: photo.uri,
    oldCreationTime: creationTime,
    oldLocation: location,
    primary,
    capturedDistanceM: photo.distanceM,
  };

  const handleShare = async () => {
    if (mode === 'both') {
      requestThenNowShare(thenNowData);
      return;
    }
    // Just the retake, as a plain photo — no composite, no host UI needed.
    try {
      await shareFile(photo.uri, 'image/jpeg');
    } catch {
      Alert.alert("Couldn't share", 'This photo could not be shared.');
    }
  };

  const handleSave = async () => {
    if (saveState !== 'idle') return;
    setSaveState('saving');
    try {
      if (mode === 'both') {
        // The clean composite (photo + inset + chip, no canvas) goes to the
        // camera roll — the default shareable artifact — and the pair is kept
        // in the app's gallery for later re-shares and swaps.
        const compositeUri = await captureComposite(thenNowData);
        await MediaAsset.create(compositeUri);
        await addRecreation({
          oldAssetId: target.asset.id,
          tmpPhotoUri: photo.uri,
          capturedAt: Date.now(),
          oldCreationTime: creationTime,
          oldLocation: location,
          primary,
          capturedDistanceM: photo.distanceM,
        });
      } else {
        // Straight to the camera roll; nothing kept in the app.
        await MediaAsset.create(photo.uri);
      }
      setSaveState('saved');
    } catch {
      setSaveState('idle');
      Alert.alert("Couldn't save", 'This photo could not be saved. Please try again.');
    }
  };

  // Brief "Saved" beat on the button, then close the whole flow.
  useEffect(() => {
    if (saveState !== 'saved') return;
    const t = setTimeout(onDone, 700);
    return () => clearTimeout(t);
  }, [saveState, onDone]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <Pressable style={styles.closeBtn} onPress={onDone} hitSlop={12}>
          <XIcon width={28} height={28} color={Paper} />
        </Pressable>
      </SafeAreaView>

      <SafeAreaView edges={['top', 'bottom']} style={styles.content}>
        <View style={styles.previewWrap}>
          <ThenNowPreview
            thenUri={target.asset.id}
            nowUri={photo.uri}
            thenCreationTime={creationTime}
            distanceM={photo.distanceM}
            primary={primary}
            onSwap={() => setPrimary((p) => (p === 'now' ? 'then' : 'now'))}
            showInset={mode === 'both'}
            tone="dark"
          />
        </View>

        <View style={styles.modeRow}>
          {/* Two equal segments — same width regardless of label length, so
              the highlight pill is symmetric whichever side is active. */}
          <View style={styles.modeToggle}>
            <Pressable
              style={[styles.modeOption, mode === 'both' && styles.modeOptionOn]}
              onPress={() => setMode('both')}
              hitSlop={6}>
              <Text style={[styles.modeLabel, mode === 'both' && styles.modeLabelOn]}>
                Both
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeOption, mode === 'today' && styles.modeOptionOn]}
              onPress={() => setMode('today')}
              hitSlop={6}>
              <Text style={[styles.modeLabel, mode === 'today' && styles.modeLabelOn]}>
                Today
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Three equal pills on one row — same shape and height, evenly
            spaced; only the fill marks Save as the primary. */}
        <View style={styles.actions}>
          <Pressable style={styles.pillGhost} onPress={onRetake} hitSlop={4}>
            <Text style={styles.pillGhostLabel}>Retake</Text>
          </Pressable>
          <Pressable style={styles.pillGhost} onPress={handleShare} hitSlop={4}>
            <Text style={styles.pillGhostLabel}>Share</Text>
          </Pressable>
          <Pressable
            style={[styles.pillSolid, saveState !== 'idle' && styles.pillBusy]}
            onPress={handleSave}
            disabled={saveState !== 'idle'}>
            <Text style={styles.pillSolidLabel}>
              {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Off-screen clean-composite renderer used by Save. */}
      {captureElement}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Letterbox,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  // Leave headroom for the absolute top bar's close button.
  previewWrap: {
    flex: 1,
    marginTop: 48,
    marginBottom: 4,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  // Glyph left edge lands at 20, on the same grid as the content padding.
  closeBtn: {
    marginTop: 2,
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeRow: {
    alignItems: 'center',
    marginBottom: 14,
  },
  modeToggle: {
    flexDirection: 'row',
    width: 224,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    padding: 3,
    gap: 3,
  },
  modeOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 20,
  },
  modeOptionOn: {
    backgroundColor: Paper,
  },
  modeLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  modeLabelOn: {
    color: Ink,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
  },
  // Outlined pill; border thickness folded into the padding so its height
  // is pixel-identical to the filled pill.
  pillGhost: {
    flex: 1,
    paddingVertical: 10.5,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: Paper,
    alignItems: 'center',
  },
  pillGhostLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  pillSolid: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 32,
    backgroundColor: Paper,
    alignItems: 'center',
  },
  pillBusy: {
    opacity: 0.6,
  },
  pillSolidLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textTransform: 'uppercase',
  },
});
