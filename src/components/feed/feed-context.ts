import { createContext } from 'react';

export type FeedCardEvents = {
  onCardReady: (assetId: string) => void;
  // User tapped "Find one on device" on a card whose photo couldn't load. The
  // feed jumps to the nearest on-device memory (probing forward when nothing is
  // known-local yet) and resolves whether it found one, so the card can say
  // "None on device" instead of silently doing nothing on a fully-offloaded
  // library. User-initiated, never automatic.
  onFindOnDevice: (assetId: string) => Promise<boolean>;
};

const noop: FeedCardEvents = {
  onCardReady: () => {},
  onFindOnDevice: async () => false,
};

export const FeedCardEventsContext = createContext<FeedCardEvents>(noop);
