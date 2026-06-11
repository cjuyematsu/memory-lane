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

import { DisplayFont, Ink, Paper } from '@/constants/theme';
import { diagnoseAndroidMetadata } from '@/lib/android-metadata-diagnostic';
import { fireTestNotification, triggerNearestMemoryHere } from '@/lib/geofence-manager';
import {
  setNotificationsEnabled,
  useNotificationSettings,
} from '@/hooks/use-notification-settings';
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
    (perm.backgroundLocation !== 'granted' || perm.notifications !== 'granted');
  const degradedReason =
    perm?.notifications !== 'granted'
      ? 'Notifications are off, so memories can’t reach you.'
      : // True degradation: the foreground position-watch fallback covers the
        // app-open case; background geofencing needs "Always".
        'Background location isn’t set to “Always,” so memories only appear while the app is open.';

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

          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Memory notifications</Text>
              <Text style={styles.rowSub}>
                Get notified when you&apos;re near a place where you took photos in the past. (Needs location and notification permissions)
              </Text>
            </View>
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

          {degraded ? (
            <Pressable style={styles.warning} onPress={() => Linking.openSettings()}>
              <Text style={styles.warningText}>{degradedReason}</Text>
              <Text style={styles.warningAction}>Open Settings</Text>
            </Pressable>
          ) : null}

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
                      ? 'Background the app now — a test notification will appear in ~8 seconds.'
                      : 'Turn on “Memory notifications” (or allow them in system Settings) first.'
                  );
                }}>
                <Text style={styles.devButtonLabel}>Send test notification</Text>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  rowText: {
    flex: 1,
    gap: 4,
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
