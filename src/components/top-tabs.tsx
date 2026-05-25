import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Feed } from '@/components/feed/feed';
import { NearMe } from '@/components/near-me/near-me';

type Tab = 'cameraRoll' | 'nearMe';

export function TopTabs() {
  const [tab, setTab] = useState<Tab>('cameraRoll');

  return (
    <View style={styles.root}>
      <View
        style={[StyleSheet.absoluteFill, tab === 'cameraRoll' ? null : styles.hidden]}>
        <Feed />
      </View>
      <View
        style={[StyleSheet.absoluteFill, tab === 'nearMe' ? null : styles.hidden]}>
        <NearMe />
      </View>

      <SafeAreaView edges={['top']} style={styles.barWrap} pointerEvents="box-none">
        <View style={styles.bar} pointerEvents="auto">
          <Pressable onPress={() => setTab('cameraRoll')} hitSlop={10}>
            <Text style={[styles.label, tab === 'cameraRoll' && styles.labelActive]}>
              CAMERA ROLL
            </Text>
          </Pressable>
          <View style={styles.sep} />
          <Pressable onPress={() => setTab('nearMe')} hitSlop={10}>
            <Text style={[styles.label, tab === 'nearMe' && styles.labelActive]}>
              NEAR ME
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  hidden: {
    display: 'none',
  },
  barWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  label: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  labelActive: {
    color: '#fff',
  },
  sep: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
