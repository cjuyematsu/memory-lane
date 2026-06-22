import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { type Asset } from 'expo-media-library';

import { ShareCard } from '@/components/share/share-card';
import { DisplayFont, Ink, Paper } from '@/constants/theme';
import {
  closeShare,
  prepareRawShare,
  shareFile,
  shareOptionsFor,
  useShareTarget,
  type ShareMode,
  type ShareTarget,
} from '@/lib/share-memory';

// If the export card's photo never decodes (e.g. a hung iCloud download), don't
// leave the user staring at the spinner — bail out after this.
const CAPTURE_TIMEOUT_MS = 8000;

// Renderless global overlay (mounted once in app/_layout.tsx). Subscribes to the
// share pub/sub and drives both flows: a themed chooser, then either a raw
// file share or an off-screen ShareCard capture. Mirrors the pattern of
// MemoryBanner / NotificationOrchestrator.
export function ShareHost() {
  const target = useShareTarget();
  const [phase, setPhase] = useState<'choosing' | 'working'>('choosing');
  // The asset whose framed export is being captured (null = raw share or none).
  const [framedAsset, setFramedAsset] = useState<Asset | null>(null);
  const cardRef = useRef<View>(null);
  const captured = useRef(false);
  // Previous request, tracked in state so the reset below is a pure
  // set-state-during-render (React's supported "reset on prop change" pattern).
  const [prevTarget, setPrevTarget] = useState<ShareTarget | null>(null);

  const fail = useCallback((message: string) => {
    Alert.alert('Couldn’t share', message);
    closeShare();
  }, []);

  const shareRaw = useCallback(
    async (asset: Asset) => {
      try {
        const { uri, mimeType } = await prepareRawShare(asset);
        await shareFile(uri, mimeType);
        closeShare();
      } catch {
        fail('This item could not be prepared for sharing.');
      }
    },
    [fail]
  );

  const choose = useCallback(
    (mode: ShareMode) => {
      if (!target) return;
      captured.current = false;
      setPhase('working');
      if (mode === 'raw') {
        void shareRaw(target.asset);
      } else {
        // Mount the off-screen ShareCard; capture fires from its onReady.
        setFramedAsset(target.asset);
      }
    },
    [target, shareRaw]
  );

  const captureFramed = useCallback(async () => {
    if (captured.current) return;
    captured.current = true;
    try {
      const uri = await captureRef(cardRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      await shareFile(uri, 'image/jpeg');
      closeShare();
    } catch {
      fail('This memory could not be prepared for sharing.');
    }
  }, [fail]);

  // Safety net: if the framed card never reports ready, don't hang the spinner.
  useEffect(() => {
    if (!framedAsset) return;
    const t = setTimeout(() => {
      if (!captured.current) {
        captured.current = true;
        fail('This memory took too long to prepare. Please try again.');
      }
    }, CAPTURE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [framedAsset, fail]);

  // Reset per request (target identity changes on every requestShare). Adjusted
  // during render — React's supported "reset state when a prop changes" pattern
  // (guarded + self-terminating) — rather than a setState-in-effect, which trips
  // react-hooks/set-state-in-effect under React 19. The capture-dedupe ref is
  // reset in `choose` instead (ref writes aren't allowed during render).
  if (target !== prevTarget) {
    setPrevTarget(target);
    if (phase !== 'choosing') setPhase('choosing');
    if (framedAsset !== null) setFramedAsset(null);
  }

  if (!target) return null;

  const options = shareOptionsFor(target.isVideo);

  return (
    <>
      <Modal
        visible
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeShare}>
        {phase === 'choosing' ? (
          <Pressable style={styles.backdrop} onPress={closeShare}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.title}>Share</Text>
              {options.map((opt) => (
                <Pressable
                  key={opt.mode}
                  style={styles.option}
                  onPress={() => choose(opt.mode)}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                </Pressable>
              ))}
              <Pressable style={styles.cancel} onPress={closeShare} hitSlop={8}>
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        ) : (
          <View style={styles.workingBackdrop}>
            <View style={styles.workingCard}>
              <ActivityIndicator color={Ink} />
              <Text style={styles.workingLabel}>Preparing…</Text>
            </View>
          </View>
        )}
      </Modal>

      {/* Off-screen export view (only for the framed flow). Positioned far
          off-screen but fully laid out and OPAQUE — view-shot captures blank
          from an opacity:0 / display:none ancestor, so don't hide it that way. */}
      {framedAsset ? (
        <View style={styles.offscreen} pointerEvents="none">
          <ShareCard ref={cardRef} asset={framedAsset} onReady={captureFramed} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: Paper,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 22,
    textTransform: 'uppercase',
  },
  option: {
    paddingVertical: 14,
    borderRadius: 32,
    backgroundColor: Ink,
    alignItems: 'center',
  },
  optionLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  cancel: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  cancelLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
    opacity: 0.6,
  },
  workingBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workingCard: {
    backgroundColor: Paper,
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
  },
  workingLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  offscreen: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
});
