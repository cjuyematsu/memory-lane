import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

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

// Drag-down far enough (or fling) to dismiss; a horizontal swipe steps to the
// neighboring recreation. Both need ~16px of travel to activate, so the taps
// inside (pills, the inset swap, the top-bar buttons) are untouched.
const CLOSE_DRAG_PX = 90;
const CLOSE_FLING_VELOCITY = 900;
const STEP_SWIPE_PX = 56;
const STEP_FLING_VELOCITY = 700;

// Single-recreation view opened from the gallery grid: the then/now stack with
// re-share, an explicit save of the retaken photo to the camera roll (nothing
// was saved there automatically), and delete. Captions come from the persisted
// record, so everything here works even if the original library photo is gone
// (the then panel degrades inside ThenNowPreview).
export function RecreationViewer({
  recreation,
  onClose,
  onStep,
}: {
  recreation: Recreation;
  onClose: () => void;
  // Swipe left = next (+1), swipe right = previous (-1); the gallery resolves
  // the neighbor (or no-ops at the ends).
  onStep: (dir: 1 | -1) => void;
}) {
  const nowUri = recreationUri(recreation);
  const [rollState, setRollState] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Starts on the arrangement saved with the pair; tapping the inset swaps it
  // for this viewing (and for any share/save made while it's showing).
  const [primary, setPrimary] = useState<ThenNowPrimary>(recreation.primary);
  // A horizontal step swaps the record under this mounted component, so the
  // per-recreation state must reset — set-state-during-render "reset on prop
  // change" pattern (same as the settings sheet), not a setState-in-effect.
  const [forId, setForId] = useState(recreation.id);
  if (forId !== recreation.id) {
    setForId(recreation.id);
    setPrimary(recreation.primary);
    setRollState('idle');
  }
  const { captureComposite, captureElement } = useCompositeCapture();

  // Vertical drag follows the finger (downward only) so the dismiss reads as
  // dragging the sheet away; released below the threshold it springs back.
  const dragY = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));
  const pan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .activeOffsetY([-16, 16])
    .onUpdate((e) => {
      'worklet';
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
        dragY.value = withTiming(0, { duration: 160 });
        if (
          Math.abs(e.translationX) > STEP_SWIPE_PX ||
          Math.abs(e.velocityX) > STEP_FLING_VELOCITY
        ) {
          scheduleOnRN(onStep, e.translationX < 0 ? 1 : -1);
        }
        return;
      }
      if (e.translationY > CLOSE_DRAG_PX || e.velocityY > CLOSE_FLING_VELOCITY) {
        scheduleOnRN(onClose);
        return;
      }
      dragY.value = withTiming(0, { duration: 160 });
    });

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
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.root, dragStyle]}>
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
      </Animated.View>
    </GestureDetector>
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
