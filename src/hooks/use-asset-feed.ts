import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
  addListener,
  Asset,
  AssetField,
  MediaSubtype,
  MediaType,
  Query,
} from 'expo-media-library';

export type FeedState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; assets: Asset[] }
  | { status: 'error'; message: string };

const SCREENSHOT_BATCH = 500;
const screenshotCache = new Map<string, boolean>();

async function rejectScreenshots(assets: Asset[]): Promise<Asset[]> {
  if (Platform.OS !== 'ios') return assets;
  const kept: Asset[] = [];
  for (let i = 0; i < assets.length; i += SCREENSHOT_BATCH) {
    const slice = assets.slice(i, i + SCREENSHOT_BATCH);
    const flags = await Promise.all(
      slice.map(async (a) => {
        const cached = screenshotCache.get(a.id);
        if (cached !== undefined) return cached;
        try {
          const subtypes = await a.getMediaSubtypes();
          const isShot = subtypes.includes(MediaSubtype.SCREENSHOT);
          screenshotCache.set(a.id, isShot);
          return isShot;
        } catch {
          return false;
        }
      })
    );
    for (let j = 0; j < slice.length; j++) {
      if (!flags[j]) kept.push(slice[j]);
    }
  }
  return kept;
}

export function useAssetFeed(enabled: boolean) {
  const [state, setState] = useState<FeedState>({ status: 'idle' });
  const reqId = useRef(0);

  const reload = useCallback(async (silent = false) => {
    const myId = ++reqId.current;
    if (!silent) setState({ status: 'loading' });
    try {
      const raw = await new Query()
        .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .limit(10000)
        .exe();
      if (reqId.current !== myId) return;
      const assets = await rejectScreenshots(raw);
      if (reqId.current !== myId) return;
      setState({ status: 'ready', assets });
    } catch (e) {
      if (reqId.current !== myId) return;
      if (silent) return;
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    if (enabled && state.status === 'idle') {
      reload(false);
    }
  }, [enabled, state.status, reload]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = addListener(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        reload(true);
      }, 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [enabled, reload]);

  return { state, reload };
}
