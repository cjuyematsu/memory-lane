import { shouldDegradeNotifications } from '@/lib/notification-degrade';

describe('shouldDegradeNotifications', () => {
  it('never degrades when the feature is off', () => {
    expect(
      shouldDegradeNotifications({
        enabled: false,
        notifGranted: false,
        backgroundLocationGranted: false,
      })
    ).toBe(false);
  });

  it('degrades the restored/revoked state: enabled with both permissions confirmed missing', () => {
    expect(
      shouldDegradeNotifications({
        enabled: true,
        notifGranted: false,
        backgroundLocationGranted: false,
      })
    ).toBe(true);
  });

  it('keeps the feature on when notifications are granted (foreground-fallback mode)', () => {
    expect(
      shouldDegradeNotifications({
        enabled: true,
        notifGranted: true,
        backgroundLocationGranted: false,
      })
    ).toBe(false);
  });

  it('keeps the feature on when background location is granted', () => {
    expect(
      shouldDegradeNotifications({
        enabled: true,
        notifGranted: false,
        backgroundLocationGranted: true,
      })
    ).toBe(false);
  });

  it('treats a failed/timed-out permission read as unknown, not a denial', () => {
    expect(
      shouldDegradeNotifications({
        enabled: true,
        notifGranted: null,
        backgroundLocationGranted: false,
      })
    ).toBe(false);
    expect(
      shouldDegradeNotifications({
        enabled: true,
        notifGranted: false,
        backgroundLocationGranted: null,
      })
    ).toBe(false);
  });
});
