import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';

import { setCrashForwarder } from '@/lib/crash-log';

// Paste the DSN from sentry.io → Project Settings → Client Keys. Until it's
// set, Sentry stays fully disabled and the app behaves exactly as before.
const SENTRY_DSN = '';

// Crash reporting only, and only in release builds: dev keeps LogBox/redbox
// untouched, and the privacy posture stays "photos never leave the phone" —
// no PII, no session replay, no screenshots/view-hierarchy attachments, no
// performance tracing. What ships to Sentry is stack traces + device model.
// Root-layout HOC: touch-event breadcrumbs + native-frame context on reports.
// Wrap ONLY when Sentry is configured — wrapping without a later Sentry.init
// warns "App Start Span could not be finished" on every launch.
export function wrapRoot<C extends ComponentType<never>>(component: C): C {
  return SENTRY_DSN ? (Sentry.wrap(component as ComponentType) as unknown as C) : component;
}

export function initSentry(): void {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: !__DEV__,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
  });
  // The in-app crash log (lib/crash-log.ts) owns the Hermes rejection tracker
  // and the error-boundary hooks; forward what it sees so those reach Sentry
  // too. Fatal JS errors need no forwarding — crash-log's ErrorUtils handler
  // delegates to the previous handler, which is Sentry's (init runs first).
  setCrashForwarder((err) => {
    try {
      Sentry.captureException(err);
    } catch {
      // telemetry must never throw
    }
  });
}
