import { useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import ArrowLeftIcon from '@/assets/icons/arrow-left.svg';
import { DisplayFont, Ink, InkMuted, Paper } from '@/constants/theme';
import { useMediaPermission } from '@/hooks/use-media-permission';

type Status = 'granted' | 'denied' | 'undetermined' | 'unknown';

// Normalize the various expo permission strings to our three states (plus a
// pre-read 'unknown'). Anything that isn't granted/undetermined is treated as
// denied, matching hooks/use-permission-flow.ts's toStatus.
function norm(status: string | undefined | null): Status {
  if (status == null) return 'unknown';
  if (status === 'granted') return 'granted';
  if (status === 'undetermined') return 'undetermined';
  return 'denied';
}

function statusLabel(status: Status): string {
  if (status === 'granted') return 'On';
  if (status === 'undetermined' || status === 'unknown') return 'Not set';
  return 'Off';
}

type Row = { key: string; label: string; status: Status };

// The in-place Permissions sub-view of the Settings sheet (not its own Modal —
// a Modal-over-Modal doesn't reliably present on iOS). It only *informs*: each
// row shows a permission's live status, and a single "Open Settings" button
// takes the user to the one iOS/Android page where every one of them is changed
// (per-row buttons all led to the same place, so there's just one).
export function PermissionsPanel({ onBack }: { onBack: () => void }) {
  const [photos] = useMediaPermission();
  const [camera, , getCamera] = useCameraPermissions();

  // Foreground/background location + notifications have no shared reactive
  // hook, so read them here and refresh on mount + every app foreground (so a
  // change made in system Settings shows up on return).
  const [fg, setFg] = useState<Status>('unknown');
  const [bg, setBg] = useState<Status>('unknown');
  const [notif, setNotif] = useState<Status>('unknown');

  useEffect(() => {
    let active = true;
    const read = () => {
      // setState in the `.then` callback (guarded), never synchronously in the
      // effect body — react-hooks/set-state-in-effect.
      Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        Notifications.getPermissionsAsync(),
      ]).then(([f, b, n]) => {
        if (!active) return;
        setFg(norm(f.status));
        setBg(norm(b.status));
        setNotif(norm(n.status));
      });
      // Re-read camera too (its hook doesn't auto-recheck on foreground).
      getCamera();
    };
    read();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') read();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [getCamera]);

  const rows: Row[] = [
    { key: 'photos', label: 'Photos', status: norm(photos?.status) },
    { key: 'camera', label: 'Camera', status: norm(camera?.status) },
    { key: 'fg', label: 'Location: While Using', status: fg },
    { key: 'bg', label: 'Location: Always', status: bg },
    { key: 'notif', label: 'Notifications', status: notif },
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <ArrowLeftIcon width={24} height={24} color={Ink} />
        </Pressable>
        <Text style={styles.title}>Permissions</Text>
      </View>

      <View style={styles.group}>
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}>
          {rows.map((r, i) => (
            <StatusRow key={r.key} label={r.label} status={r.status} first={i === 0} />
          ))}
        </ScrollView>
      </View>

      <Text style={styles.note}>
        To turn any of these on or off, open Settings. Everything stays on your phone: photos and
        location never leave your device.
      </Text>

      <Pressable style={styles.button} onPress={() => Linking.openSettings()}>
        <Text style={styles.buttonLabel}>Open Settings</Text>
      </Pressable>
    </View>
  );
}

function StatusRow({
  label,
  status,
  first,
}: {
  label: string;
  status: Status;
  first: boolean;
}) {
  const on = status === 'granted';
  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.statusText, on && styles.statusTextOn]}>{statusLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  back: {
    marginLeft: -4,
  },
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 22,
    textTransform: 'uppercase',
  },
  group: {
    borderWidth: 1,
    borderColor: Ink,
    borderRadius: 12,
    overflow: 'hidden',
  },
  list: {
    // Cap the height so five rows never push the note/button off-screen.
    maxHeight: 320,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E3E3E3',
  },
  rowLabel: {
    flex: 1,
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  statusText: {
    color: InkMuted,
    fontSize: 13,
  },
  statusTextOn: {
    color: Ink,
  },
  note: {
    color: InkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  button: {
    paddingVertical: 12,
    borderRadius: 32,
    backgroundColor: Ink,
    alignItems: 'center',
  },
  buttonLabel: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 14,
    textTransform: 'uppercase',
  },
});
