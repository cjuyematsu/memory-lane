import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { DisplayFont, Ink, Paper } from '@/constants/theme';
import {
  describeCooldown,
  PLACE_COOLDOWN_OPTIONS,
  type PlaceCooldownOption,
} from '@/lib/place-cooldown';

// A small monochrome picker for the per-place reminder cooldown. The trigger is
// an outlined pill (matching the Settings "How PastPic works" button) showing
// the current choice; tapping it opens a chooser modal that mirrors the share
// sheet (components/share/share-host.tsx) — selected option filled Ink, the rest
// outlined. Pure JS (no native module / rebuild). Used in both onboarding and
// the Settings sheet so the two stay visually identical.
export function CooldownPicker({
  value,
  onChange,
  title = 'Remind me again',
}: {
  value: number | null;
  onChange: (ms: number | null) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  const select = (opt: PlaceCooldownOption) => {
    onChange(opt.ms);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Remind me again: ${describeCooldown(value)}`}>
        <Text style={styles.triggerLabel}>{describeCooldown(value)}</Text>
        <View style={styles.caret} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{title}</Text>
            {PLACE_COOLDOWN_OPTIONS.map((opt) => {
              const selected = opt.ms === value;
              return (
                <Pressable
                  key={opt.label}
                  style={[styles.option, selected ? styles.optionOn : styles.optionOff]}
                  onPress={() => select(opt)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}>
                  <Text style={selected ? styles.optionLabelOn : styles.optionLabelOff}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable style={styles.cancel} onPress={() => setOpen(false)} hitSlop={8}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Outlined pill, same language as the Settings "How PastPic works" button.
  // No alignSelf: it centers in the onboarding copy column and sits at its
  // natural width on the right of the Settings row.
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: Ink,
  },
  triggerLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  // A downward caret: a square with two adjacent borders rotated to point down.
  caret: {
    width: 7,
    height: 7,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: Ink,
    transform: [{ rotate: '45deg' }],
    marginTop: -3,
  },
  // Chooser modal — mirrors share-host.tsx.
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
    gap: 12,
  },
  title: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 18,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  option: {
    paddingVertical: 14,
    borderRadius: 32,
    alignItems: 'center',
  },
  optionOn: {
    backgroundColor: Ink,
  },
  optionOff: {
    borderWidth: 1,
    borderColor: Ink,
  },
  optionLabelOn: {
    fontFamily: DisplayFont,
    color: Paper,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  optionLabelOff: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  cancel: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  cancelLabel: {
    fontFamily: DisplayFont,
    color: Ink,
    fontSize: 13,
    textTransform: 'uppercase',
    opacity: 0.6,
  },
});
