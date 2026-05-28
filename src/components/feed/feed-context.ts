import { createContext } from 'react';

export type FeedCardEvents = {
  onCardReady: (assetId: string) => void;
};

const noop: FeedCardEvents = {
  onCardReady: () => {},
};

export const FeedCardEventsContext = createContext<FeedCardEvents>(noop);
