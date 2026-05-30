import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { Colors } from '@/constants/theme';
import { fireTestNotification } from '@/lib/geofence-manager';
import {
  setNotificationsEnabled,
  useNotificationSettings,
} from '@/hooks/use-notification-settings';
import { requestAllPermissions } from '@/hooks/use-permission-flow';

export function SettingsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const settings = useNotificationSettings();
  const [requesting, setRequesting] = useState(false);

  const handleToggle = async (next: boolean) => {
    if (!next) {
      setNotificationsEnabled(false);
      return;
    }
    setRequesting(true);
    try {
      const result = await requestAllPermissions();
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
                Get a heads-up when you're near a place where you took photos
                over 90 days ago.
              </Text>
            </View>
            {requesting ? (
              <ActivityIndicator color={Colors.dark.text} />
            ) : (
              <Switch value={settings.enabled} onValueChange={handleToggle} />
            )}
          </View>

          {__DEV__ ? (
            <Pressable
              style={styles.testButton}
              onPress={() => {
                fireTestNotification();
                Alert.alert(
                  'Test scheduled',
                  'Background the app now — a test notification will appear in ~4 seconds.'
                );
              }}>
              <Text style={styles.testButtonLabel}>Send test notification</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: Colors.dark.backgroundElement,
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  title: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: '700',
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
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '600',
  },
  rowSub: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  testButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.dark.backgroundSelected,
  },
  testButtonLabel: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
