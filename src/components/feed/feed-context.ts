import { createContext } from 'react';

export type FeedCardEvents = {
  onCardReady: (assetId: string) => void;
  // User tapped "Find one on device" on a card whose photo couldn't load. The
  // feed jumps to the nearest on-device memory. User-initiated, never automatic.
  onFindOnDevice: (assetId: string) => void;
};

const noop: FeedCardEvents = {
  onCardReady: () => {},
  onFindOnDevice: () => {},
};

export const FeedCardEventsContext = createContext<FeedCardEvents>(noop);
