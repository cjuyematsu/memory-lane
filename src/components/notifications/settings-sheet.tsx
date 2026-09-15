import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { CooldownPicker } from '@/components/notifications/cooldown-picker';
import { DemoPanel } from '@/components/notifications/demo-panel';
import { PermissionsPanel } from '@/components/notifications/permissions-sheet';
import { DisplayFont, Ink, InkMuted, Paper } from '@/constants/theme';
import { diagnoseAndroidMetadata } from '@/lib/android-metadata-diagnostic';
import { getCrashLogText } from '@/lib/crash-log';
import { DEMO_ENABLED } from '@/lib/demo-mode';
import {
  fireTestNotification,
  inspectRadiiHere,
  previewForegroundBanner,
  triggerNearestMemoryHere,
} from '@/lib/geofence-manager';
import {
  setNotificationsEnabled,
  setPlaceCooldownMs,
  useNotificationSettings,
} from '@/hooks/use-notification-settings';
import {
  getPermissionState,
  requestAllPermissions,
  type PermissionState,
} from '@/hooks/use-permission-flow';

type View_ = 'main' | 'permissions' | 'demo';

// Demo scaffolding for launch videos: the dev trigger buttons below, plus the
// hidden Demo panel (long-press the privacy note). Gated on the same build-time
// env switch as the location override — see DEMO_ENABLED in lib/demo-mode.ts.
// This replaced a source constant that had to be manually flipped back before a
// store submission; a build made without EXPO_PUBLIC_DEMO=1 simply cannot carry
// any of it.
const DEMO_BUILD = DEMO_ENABLED;

export function SettingsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const settings = useNotificationSettings();
  const [requesting, setRequesting] = useState(false);
  const [perm, setPerm] = useState<PermissionState | null>(null);
  // The sheet is a single modal that swaps between the main list and an in-place
  // Permissions sub-view (a Modal-over-Modal doesn't reliably present on iOS).
  const [view, setView] = useState<View_>('main');

  // Reset to the main view every time the sheet (re)opens. set-state-during-
  // render on a prop change is React's supported "reset on change" pattern —
  // not a setState-in-effect (which react-hooks/set-state-in-effect forbids).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible && view !== 'main') setView('main');
  }

  // Re-read the live permission state whenever the sheet opens or the toggle
  // flips, so we can warn when the feature is on but can't actually deliver
  // background notifications (e.g. "Always" location was never granted or was
  // later revoked in system Settings).
  useEffect(() => {
    if (!visible) return;
    let active = true;
    getPermissionState().then((state) => {
      if (active) setPerm(state);
    });
    return () => {
      active = false;
    };
  }, [visible, settings.enabled]);

  const handleToggle = async (next: boolean) => {
    if (!next) {
      setNotificationsEnabled(false);
      return;
    }
    setRequesting(true);
    try {
      const result = await requestAllPermissions();
      setPerm(result.state);
      if (result.ok) {
        setNotificationsEnabled(true);
      } else {
        Alert.alert(
          'Permissions needed',
          'Memory notifications need location and notification access. Open Settings to grant them.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      }
    } finally {
      setRequesting(false);
    }
  };

  // When enabled, geofencing only fires in the background with "Always"
  // location, and the system notification needs notification permission.
  const degraded =
    settings.enabled &&
    perm != null &&
    (perm.foregroundLocation !== 'granted' ||
      perm.backgroundLocation !== 'granted' ||
      perm.notifications !== 'granted');
  const degradedReason =
    // Foreground location off (app set to "Never", or Location Services disabled
    // globally — both read as not-granted) means even the foreground
    // position-watch fallback can't run, so NOTHING surfaces. Check this first.
    perm?.foregroundLocation !== 'granted'
      ? "Location is off, turn on access to see memories near you."
      : perm?.notifications !== 'granted'
        ? "Notifications are off, so memories can't reach you."
        : // True degradation: the foreground position-watch fallback covers the
          // app-open case; background geofencing needs "Always".
          `Background location isn't set to "Always," you will not receive notifications.`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* stopPropagation: tapping inside the sheet should not dismiss it */}
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {view === 'permissions' ? (
            <PermissionsPanel onBack={() => setView('main')} />
          ) : view === 'demo' ? (
            <DemoPanel onBack={() => setView('main')} onClose={onClose} />
          ) : (
            <>
              {/* Hidden diagnostics escape hatch: long-pressing the title
                  shares the on-disk crash log, so a tester can send it without
                  any visible debug UI. */}
              <Text
                style={styles.title}
                onLongPress={() => {
                  getCrashLogText()
                    .then((text) => Share.share({ message: text }))
                    .catch(() => {});
                }}>
                Settings
              </Text>

              <View style={styles.block}>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>Memory notifications</Text>
                  </View>
                  {/* Fixed-size slot so swapping the Switch for the spinner
                      doesn't reflow the label between one and two lines. */}
                  <View style={styles.control}>
                    {requesting ? (
                      <ActivityIndicator color={Ink} />
                    ) : (
                      <Switch
                        value={settings.enabled}
                        onValueChange={handleToggle}
                        trackColor={{ true: Ink, false: '#D1D1D6' }}
                        thumbColor={Paper}
                        ios_backgroundColor="#D1D1D6"
                      />
                    )}
                  </View>
                </View>
                <Text style={styles.rowSub}>
                  Get notified when you&apos;re near a place where you took photos in the past.
                  (Needs location and notification permissions)
                </Text>
              </View>

              {/* Only relevant once notifications are on. */}
              {settings.enabled ? (
                <View style={styles.block}>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowLabel}>Remind me again</Text>
                    </View>
                    <CooldownPicker
                      value={settings.placeCooldownMs}
                      onChange={setPlaceCooldownMs}
                    />
                  </View>
                  <Text style={styles.rowSub}>
                    After a place reminds you, how long before it can notify you there again.
                  </Text>
                </View>
              ) : null}

              {degraded ? (
                <Pressable style={styles.warning} onPress={() => Linking.openSettings()}>
                  <Text style={styles.warningText}>{degradedReason}</Text>
                  <Text style={styles.warningAction}>Open Settings</Text>
                </Pressable>
              ) : null}

              {/* Grouped nav rows: a cohesive settings list, not scattered pills.
                  (Recreations moved out to their own tab in the top pager.) */}
              <View style={styles.navGroup}>
                <NavRow label="Permissions" first onPress={() => setView('permissions')} />
              </View>

              {/* Long-press opens the launch-video demo panel (location
                  override + armed trigger). Hidden behind a gesture rather than
                  a row because this sheet itself is on camera during the shoot,
                  and inert entirely unless the build carries EXPO_PUBLIC_DEMO=1. */}
              <Text
                style={styles.privacyNote}
                onLongPress={DEMO_BUILD ? () => setView('demo') : undefined}>
                Everything stays on your phone. Your photos and location never leave your device.
              </Text>

              {__DEV__ || DEMO_BUILD ? (
                <View style={styles.devRow}>
                  <Pressable
                    style={styles.devButton}
                    onPress={async () => {
                      onClose();
                      const res = await previewForegroundBanner();
                      if (!res.ok) Alert.alert('Could not preview', res.message);
                    }}>
                    <Text style={styles.devButtonLabel}>Preview memory banner (foreground)</Text>
                  </Pressable>
                  <Pressable
                    style={styles.devButton}
                    onPress={async () => {
                      const res = await triggerNearestMemoryHere();
                      Alert.alert(res.ok ? 'Memory scheduled' : 'Could not trigger', res.message);
                    }}>
                    <Text style={styles.devButtonLabel}>Trigger a memory here</Text>
                  </Pressable>
                  <Pressable
                    style={styles.devButton}
                    onPress={async () => {
                      const ok = await fireTestNotification();
                      Alert.alert(
                        ok ? 'Test scheduled' : 'Notifications off',
                        ok
                          ? 'Background the app now. A test notification will appear in ~8 seconds.'
                          : 'Turn on "Memory notifications" (or allow them in system Settings) first.'
                      );
                    }}>
                    <Text style={styles.devButtonLabel}>Send test notification</Text>
                  </Pressable>
                  <Pressable
                    style={styles.devButton}
                    onPress={async () => {
                      const res = await inspectRadiiHere();
                      Alert.alert(res.ok ? 'Radii here' : 'Could not read radii', res.message);
                    }}>
                    <Text style={styles.devButtonLabel}>Show radii here</Text>
                  </Pressable>
                  {Platform.OS === 'android' ? (
                    <Pressable
                      style={styles.devButton}
                      onPress={async () => {
                        const report = await diagnoseAndroidMetadata();
                        Alert.alert('Android metadata', report);
                      }}>
                      <Text style={styles.devButtonLabel}>Diagnose photo metadata</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function NavRow({
  label,
  first,
  onPress,
}: {
  label: string;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.navRow,
        !first && styles.navDivider,
        pressed && styles.navRowPressed,
      ]}
      onPress={onPress}>
      <Text style={styles.navLabel}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
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
    gap: 16,
  },
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 22,
    textTransform: 'uppercase',
  },
  block: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  // Reserves the Switch's footprint so the spinner swap can't reflow the label.
  control: {
    width: 51,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 15,
    textTransform: 'uppercase',
  },
  rowSub: {
    color: InkMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  warning: {
    borderWidth: 1,
    borderColor: Ink,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  warningText: {
    color: Ink,
    fontSize: 13,
    lineHeight: 18,
  },
  warningAction: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  // Outlined card grouping the settings-list nav rows.
  navGroup: {
    borderWidth: 1,
    borderColor: Ink,
    borderRadius: 12,
    overflow: 'hidden',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  navRowPressed: {
    backgroundColor: '#F2F2F2',
  },
  navDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E3E3E3',
  },
  navLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  chevron: {
    color: '#BBB',
    fontSize: 24,
    lineHeight: 24,
  },
  privacyNote: {
    color: InkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  devRow: {
    gap: 8,
  },
  devButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 32,
    backgroundColor: Ink,
  },
  devButtonLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 13,
    textTransform: 'uppercase',
  },
});
