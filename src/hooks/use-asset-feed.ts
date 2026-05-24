import { useCallback, useEffect, useState } from 'react';

import { Asset, AssetField, MediaType, Query } from 'expo-media-library';

export type FeedState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; assets: Asset[] }
  | { status: 'error'; message: string };

export function useAssetFeed(enabled: boolean) {
  const [state, setState] = useState<FeedState>({ status: 'idle' });

  const reload = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const assets = await new Query()
        .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .limit(10000)
        .exe();
      setState({ status: 'ready', assets });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    if (enabled && state.status === 'idle') {
      reload();
    }
  }, [enabled, state.status, reload]);

  return { state, reload };
}
