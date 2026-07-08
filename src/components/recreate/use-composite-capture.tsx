import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ThenNowCard } from '@/components/share/then-now-card';
import { type ThenNowShare } from '@/lib/share-memory';

const CAPTURE_TIMEOUT_MS = 8000;

type Job = {
  thenNow: ThenNowShare;
  resolve: (uri: string) => void;
  reject: (e: Error) => void;
};

// Renders the CLEAN then/now composite off-screen and captures it to a tmp
// jpg, for flows that need the image itself rather than a share sheet (Save
// writes it to the camera roll). Same machinery as ShareHost's framed flow:
// mount off-screen and OPAQUE (view-shot captures blank from opacity:0),
// wait for onReady (final images only), captureRef, with a timeout bail-out.
//
// Usage: render `captureElement` somewhere in the screen's tree, then await
// `captureComposite(thenNow)`.
export function useCompositeCapture(): {
  captureComposite: (thenNow: ThenNowShare) => Promise<string>;
  captureElement: ReactNode;
} {
  const [job, setJob] = useState<Job | null>(null);
  const cardRef = useRef<View>(null);
  const done = useRef(false);

  const captureComposite = useCallback((thenNow: ThenNowShare) => {
    return new Promise<string>((resolve, reject) => {
      done.current = false;
      setJob({ thenNow, resolve, reject });
    });
  }, []);

  // Safety net: a hung then-image (dead iCloud fetch) must not hang Save.
  useEffect(() => {
    if (!job) return;
    const t = setTimeout(() => {
      if (!done.current) {
        done.current = true;
        job.reject(new Error('Composite capture timed out'));
        setJob(null);
      }
    }, CAPTURE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [job]);

  const onReady = useCallback(async () => {
    if (!job || done.current) return;
    done.current = true;
    try {
      const uri = await captureRef(cardRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      job.resolve(uri);
    } catch (e) {
      job.reject(e instanceof Error ? e : new Error(String(e)));
    }
    setJob(null);
  }, [job]);

  const captureElement: ReactNode = job ? (
    <View style={styles.offscreen} pointerEvents="none">
      <ThenNowCard
        ref={cardRef}
        thenNow={job.thenNow}
        variant="clean"
        onReady={onReady}
      />
    </View>
  ) : null;

  return { captureComposite, captureElement };
}

const styles = StyleSheet.create({
  offscreen: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
});
