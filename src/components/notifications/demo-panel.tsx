import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ArrowLeftIcon from '@/assets/icons/arrow-left.svg';
import { DisplayFont, Ink, InkMuted, Paper } from '@/constants/theme';
import {
  getClusters,
  isAreaNotifiable,
  loadClustersFromDisk,
  type PhotoCluster,
} from '@/hooks/use-photo-clusters';
import {
  resetDemoGates,
  setDemoEnabled,
  setDemoPlace,
  useDemoMode,
} from '@/lib/demo-mode';
import { previewForegroundBanner, triggerNearestMemoryHere } from '@/lib/geofence-manager';
import { formatTimeAgo } from '@/utils/time-ago';

// Delay options for the armed trigger. The production default (8s) is too tight
// to lock the phone and get a camera settled, which is the whole point here.
const DELAYS = [10, 20, 30];

/**
 * The in-place Demo sub-view of the Settings sheet, for shooting the launch
 * video. Not its own Modal — a Modal-over-Modal doesn't reliably present on iOS
 * (same constraint as PermissionsPanel).
 *
 * Reached only by long-pressing the privacy note, and only in a build made with
 * EXPO_PUBLIC_DEMO=1, so no demo chrome is ever visible on camera or in a store
 * build. Everything here drives the REAL notification pipeline; the only
 * synthetic input in the whole flow is the coordinate (see lib/demo-mode.ts).
 */
export function DemoPanel({
  onBack,
  onClose,
}: {
  onBack: () => void;
  // Dismisses the whole Settings sheet. The in-app banner is a plain root
  // overlay and this sheet is a Modal (its own window, above everything), so
  // the banner has to be fired after the sheet is gone or it plays unseen.
  onClose: () => void;
}) {
  const demo = useDemoMode();
  const [clusters, setClusters] = useState<PhotoCluster[] | null>(null);
  const [delayS, setDelayS] = useState(DELAYS[DELAYS.length - 1]);
  // A quiet inline status line instead of Alert.alert — a system alert popping
  // up mid-take would land in the footage.
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const found = getClusters() ?? (await loadClustersFromDisk());
      if (!active) return;
      // Only clusters the REAL gate accepts are listed (isAreaNotifiable: old
      // photos AND nothing recent in the 150m neighborhood — the same check
      // handleClusterEnter and "Show radii here" run), so a picked place can't
      // read "recent media nearby" at the pre-take check. Biggest first: more
      // photos reads better on screen.
      const all = found ?? [];
      setClusters(
        all
          .filter((c) => isAreaNotifiable(c, all))
          .sort((a, b) => b.assetIds.length - a.assetIds.length)
      );
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const pick = useCallback((c: PhotoCluster) => {
    setDemoPlace(
      { latitude: c.centerLat, longitude: c.centerLng },
      `${c.assetIds.length} photo${c.assetIds.length === 1 ? '' : 's'} · ${formatTimeAgo(c.oldestCreationTime)}`
    );
    setStatus('Teleported. Near Me and the geofence evaluation now read this spot.');
  }, []);

  const reset = useCallback(async () => {
    await resetDemoGates();
    setStatus('Cooldowns and presence cleared. This place can fire again.');
  }, []);

  const arm = useCallback(async () => {
    const res = await triggerNearestMemoryHere(delayS);
    setStatus(
      res.ok ? `Armed. Lock the phone now — it fires in ~${delayS}s.` : res.message
    );
  }, [delayS]);

  const banner = useCallback(async () => {
    // Close the sheet first (same as the dev row): the banner renders under a
    // Modal. The panel unmounts with the sheet, so there is no status to set.
    onClose();
    await previewForegroundBanner();
  }, [onClose]);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <ArrowLeftIcon width={24} height={24} color={Ink} />
        </Pressable>
        <Text style={styles.title}>Demo</Text>
      </View>

      <View style={styles.block}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Teleport</Text>
          <Pressable
            style={[styles.toggle, demo.enabled && styles.toggleOn]}
            onPress={() => setDemoEnabled(!demo.enabled)}>
            <Text style={[styles.toggleLabel, demo.enabled && styles.toggleLabelOn]}>
              {demo.enabled ? 'On' : 'Off'}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.rowSub}>
          {demo.coords
            ? `${demo.label ?? 'Place'} (${demo.coords.latitude.toFixed(4)}, ${demo.coords.longitude.toFixed(4)})`
            : 'Pick a place below first.'}
        </Text>
      </View>

      <View style={styles.group}>
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}>
          {clusters == null ? (
            <Text style={styles.empty}>Reading places…</Text>
          ) : clusters.length === 0 ? (
            <Text style={styles.empty}>
              No notifiable places yet. Open Near Me once to build the index.
            </Text>
          ) : (
            clusters.map((c, i) => {
              const active = demo.coords?.latitude === c.centerLat &&
                demo.coords?.longitude === c.centerLng;
              return (
                <Pressable
                  key={c.id}
                  style={[styles.row, i > 0 && styles.rowDivider]}
                  onPress={() => pick(c)}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {c.assetIds.length} photo{c.assetIds.length === 1 ? '' : 's'}
                  </Text>
                  <Text style={[styles.rowMeta, active && styles.rowMetaActive]}>
                    {active ? '● ' : ''}
                    {formatTimeAgo(c.oldestCreationTime)}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>

      <View style={styles.delayRow}>
        {DELAYS.map((s) => (
          <Pressable
            key={s}
            style={[styles.delay, s === delayS && styles.delayOn]}
            onPress={() => setDelayS(s)}>
            <Text style={[styles.delayLabel, s === delayS && styles.delayLabelOn]}>{s}s</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.button} onPress={arm}>
        <Text style={styles.buttonLabel}>Arm trigger</Text>
      </Pressable>
      <Pressable style={styles.buttonAlt} onPress={reset}>
        <Text style={styles.buttonAltLabel}>Reset this place</Text>
      </Pressable>
      <Pressable style={styles.buttonAlt} onPress={banner}>
        <Text style={styles.buttonAltLabel}>Fire in-app banner</Text>
      </Pressable>

      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 14,
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
  block: {
    gap: 4,
  },
  group: {
    borderWidth: 1,
    borderColor: Ink,
    borderRadius: 12,
    overflow: 'hidden',
  },
  list: {
    maxHeight: 220,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 12,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E3E3E3',
  },
  rowLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  rowSub: {
    color: InkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  rowMeta: {
    color: InkMuted,
    fontSize: 13,
  },
  rowMetaActive: {
    color: Ink,
  },
  empty: {
    color: InkMuted,
    fontSize: 13,
    paddingVertical: 14,
  },
  toggle: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: Ink,
  },
  toggleOn: {
    backgroundColor: Ink,
  },
  toggleLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  toggleLabelOn: {
    color: Paper,
  },
  delayRow: {
    flexDirection: 'row',
    gap: 8,
  },
  delay: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: Ink,
    alignItems: 'center',
  },
  delayOn: {
    backgroundColor: Ink,
  },
  delayLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
  },
  delayLabelOn: {
    color: Paper,
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
  buttonAlt: {
    paddingVertical: 12,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: Ink,
    alignItems: 'center',
  },
  buttonAltLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  status: {
    color: InkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
});
