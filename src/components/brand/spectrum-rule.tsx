import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { BrandSpectrum } from '@/constants/theme';

// A short, thin, rounded horizontal bar that runs the logo's five-band spectrum
// (purple → magenta → coral → orange → amber). This is the ONE place the full
// brand spectrum appears — a quiet, designed touch on an otherwise empty white
// screen. Drawn with react-native-svg (already linked for the .svg icons), so
// no extra native dependency.
export function SpectrumRule({
  width = 56,
  height = 3,
  rx = height / 2,
}: {
  width?: number;
  height?: number;
  // Corner radius. Defaults to a fully-rounded pill; pass 0 for a square,
  // edge-to-edge band (the persistent header signature).
  rx?: number;
}) {
  const last = BrandSpectrum.length - 1;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="brandSpectrum" x1="0" y1="0" x2="1" y2="0">
          {BrandSpectrum.map((color, i) => (
            <Stop key={color} offset={i / last} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={rx}
        ry={rx}
        fill="url(#brandSpectrum)"
      />
    </Svg>
  );
}
