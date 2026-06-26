import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { CooldownPicker } from '@/components/notifications/cooldown-picker';
import { DisplayFont, Ink, Paper } from '@/constants/theme';
import { diagnoseAndroidMetadata } from '@/lib/android-metadata-diagnostic';
import {
  fireTestNotification,
  inspectRadiiHere,
  triggerNearestMemoryHere,
} from '@/lib/geofence-manager';
import {
  setNotificationsEnabled,
  setPlaceCooldownMs,
  useNotificationSettings,
} from '@/hooks/use-notification-settings';
import { restartOnboarding } from '@/hooks/use-onboarding';
import {
  getPermissionState,
  requestAllPermissions,
  type PermissionState,
} from '@/hooks/use-permission-flow';

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
          <Text style={styles.title}>Settings</Text>

          <View style={styles.notifBlock}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Memory notifications</Text>
              </View>
              {/* Fixed-size slot so swapping the Switch for the spinner doesn't
                  change the label column's width (which would reflow "MEMORY
                  NOTIFICATIONS" between one and two lines, flashing mid-toggle). */}
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
            {/* Full-width below the toggle row, not boxed into the left column. */}
            <Text style={styles.rowSub}>
              Get notified when you&apos;re near a place where you took photos in the past. (Needs
              location and notification permissions)
            </Text>
          </View>

          {/* Only relevant once notifications are on. */}
          {settings.enabled ? (
            <View style={styles.notifBlock}>
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

          <View style={styles.aboutBlock}>
            <Pressable
              style={styles.replayRow}
              onPress={() => {
                // Re-show the first-run tour from the top. The gate is reactive,
                // so the overlay reappears once the sheet closes.
                restartOnboarding();
                onClose();
              }}>
              <Text style={styles.replayLabel}>How PastPic works</Text>
            </Pressable>
            <Text style={styles.privacyNote}>
              Everything stays on your phone. Your photos and location never leave your device.
            </Text>
          </View>

          {__DEV__ ? (
            <View style={styles.devRow}>
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
        </Pressable>
      </Pressable>
    </Modal>
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
  notifBlock: {
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
    color: '#777',
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
  aboutBlock: {
    gap: 10,
  },
  replayRow: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: Ink,
  },
  replayLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  privacyNote: {
    color: '#777',
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
