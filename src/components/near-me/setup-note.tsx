import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DisplayFont, Ink, InkFaint, InkMuted } from '@/constants/theme';
import { getBuildProgress, subscribeBuildProgress } from '@/hooks/use-located-assets';
import { SETUP_NOTE_HINT, SETUP_NOTE_TITLE, setupNoteSubtitle } from '@/lib/setup-note';

// Shown under the loading polaroid while the one-time located-index build runs,
// so a large (often iCloud-offloaded) library reads as "setting up", not stuck.
// Self-contained subscription: only THIS note re-renders as the count ticks, not
// the whole Near Me screen.
export function SetupNote() {
  const [progress, setProgress] = useState(getBuildProgress);
  useEffect(() => subscribeBuildProgress(() => setProgress(getBuildProgress())), []);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Text style={styles.title}>{SETUP_NOTE_TITLE}</Text>
      <Text style={styles.sub}>{setupNoteSubtitle(progress)}</Text>
      <Text style={styles.hint}>{SETUP_NOTE_HINT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 36,
    gap: 6,
  },
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 16,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  sub: {
    color: InkMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  hint: {
    color: InkFaint,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 6,
  },
});
