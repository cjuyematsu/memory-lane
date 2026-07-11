/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

// ── Design system ──────────────────────────────────────────────────────────
// Light "gallery" look: photos framed on white, Archivo Expanded Black type.
export const Paper = '#FFFFFF'; // app canvas
export const Ink = '#111111'; // text, borders — every black EXCEPT the letterbox
export const Letterbox = '#000000'; // fill behind a contained (landscape) photo
export const DisplayFont = 'ArchivoExpanded-Black'; // see assets/fonts + _layout useFonts

// Brand accent, drawn from the logo. The gallery look stays monochrome around
// the photos; the accent only ever touches chrome / motion / empty surfaces.
// Coral is already the app's brand color in app.json (notification tint +
// Android adaptive-icon background), so reusing it is consistent, not new.
export const Accent = '#EE5D6C'; // coral — the logo's middle band
// The five logo/app-icon bands, top → bottom (the master-SVG sunset values).
// Used as a single gradient in exactly one place (the Near Me empty-state
// hairline); not for general theming.
export const BrandSpectrum = ['#6A0D83', '#CE4993', '#EE5D6C', '#FB9062', '#EEAF61'] as const;

// Every framed photo is cropped/letterboxed to this ratio (768 × 1024).
export const PhotoRatio = 768 / 1024; // width / height = 0.75
export const FrameMargin = 10; // side gutter around the single-photo frame / grid panel
// MEMORIES / NEAR ME / RETAKES bar height. Also the onboarding header height:
// both surfaces size their chrome from this so the spectrum band sits at the
// exact same Y before and after onboarding (no jump on the handoff).
export const HeaderHeight = 44;
