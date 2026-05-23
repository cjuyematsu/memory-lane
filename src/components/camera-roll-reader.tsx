import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Asset,
  AssetField,
  MediaType,
  Query,
  usePermissions,
} from 'expo-media-library';

import { Colors, Spacing } from '@/constants/theme';

const BATCH_SIZE = 200;

const palette = Colors.dark;

type AssetRow = {
  id: string;
  filename: string;
  creationTime: number | null;
  latitude: number | null;
  longitude: number | null;
};

async function hydrateAsset(asset: Asset): Promise<AssetRow> {
  const [info, location] = await Promise.all([
    asset.getInfo(),
    asset.getLocation().catch(() => null),
  ]);
  return {
    id: info.id,
    filename: info.filename,
    creationTime: info.creationTime,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  };
}

function formatDate(ts: number | null): string {
  if (!ts) return 'unknown date';
  return new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
}

function formatCoords(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return 'no GPS';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function CameraRollReader() {
  const [permission, requestPermission] = usePermissions();
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withGps, setWithGps] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRows([]);
    setWithGps(0);
    try {
      const assets = await new Query()
        .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .limit(BATCH_SIZE)
        .exe();

      const hydrated = await Promise.all(assets.map(hydrateAsset));
      setRows(hydrated);
      setWithGps(hydrated.filter((r) => r.latitude != null).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permission?.granted) {
      load();
    }
  }, [permission?.granted, load]);

  if (!permission) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={palette.text} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={[styles.title, styles.textCentered]}>Mems</Text>
        <Text style={[styles.body, styles.textCentered, styles.muted]}>
          We need access to your photos to surface memories.
        </Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonLabel}>Grant access</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.subtitle}>Camera roll</Text>
        <Text style={[styles.small, styles.muted]}>
          {loading ? 'loading…' : `${rows.length} photos · ${withGps} with GPS`}
        </Text>
        <Pressable onPress={load} style={styles.reload} disabled={loading}>
          <Text style={styles.link}>reload</Text>
        </Pressable>
      </View>

      {error && <Text style={[styles.small, styles.muted]}>Error: {error}</Text>}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowFilename} numberOfLines={1}>
              {item.filename}
            </Text>
            <Text style={[styles.small, styles.muted]}>
              {formatDate(item.creationTime)}
            </Text>
            <Text style={item.latitude != null ? styles.small : [styles.small, styles.muted]}>
              {formatCoords(item.latitude, item.longitude)}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={palette.text} style={styles.loader} />
          ) : (
            <Text style={[styles.body, styles.textCentered, styles.muted]}>
              No photos found.
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    backgroundColor: palette.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    backgroundColor: palette.background,
  },
  title: {
    color: palette.text,
    fontSize: 48,
    fontWeight: '600',
    lineHeight: 52,
  },
  subtitle: {
    color: palette.text,
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 36,
  },
  body: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 24,
  },
  small: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 18,
  },
  muted: {
    color: palette.textSecondary,
  },
  textCentered: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  link: {
    color: '#3c87f7',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    backgroundColor: palette.backgroundElement,
  },
  buttonLabel: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.half,
  },
  reload: {
    position: 'absolute',
    right: 0,
    top: Spacing.three,
  },
  list: {
    paddingBottom: Spacing.six,
  },
  row: {
    paddingVertical: Spacing.two,
    borderBottomColor: palette.backgroundElement,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.half,
  },
  rowFilename: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  loader: {
    marginTop: Spacing.five,
  },
});
