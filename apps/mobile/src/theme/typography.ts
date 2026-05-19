import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
  android: { regular: 'Roboto', medium: 'Roboto-Medium', semibold: 'Roboto-Medium', bold: 'Roboto-Bold' },
  default: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
})!;

export const Typography = {
  // Display
  h1: { fontSize: 28, fontFamily: fontFamily.bold, fontWeight: '700' as const, lineHeight: 36 },
  h2: { fontSize: 22, fontFamily: fontFamily.bold, fontWeight: '700' as const, lineHeight: 30 },
  h3: { fontSize: 18, fontFamily: fontFamily.semibold, fontWeight: '600' as const, lineHeight: 26 },
  h4: { fontSize: 16, fontFamily: fontFamily.semibold, fontWeight: '600' as const, lineHeight: 24 },

  // Body
  bodyLg: { fontSize: 16, fontFamily: fontFamily.regular, fontWeight: '400' as const, lineHeight: 24 },
  body: { fontSize: 14, fontFamily: fontFamily.regular, fontWeight: '400' as const, lineHeight: 22 },
  bodySm: { fontSize: 13, fontFamily: fontFamily.regular, fontWeight: '400' as const, lineHeight: 20 },

  // Label
  labelLg: { fontSize: 14, fontFamily: fontFamily.medium, fontWeight: '500' as const, lineHeight: 20 },
  label: { fontSize: 13, fontFamily: fontFamily.medium, fontWeight: '500' as const, lineHeight: 18 },
  labelSm: { fontSize: 12, fontFamily: fontFamily.medium, fontWeight: '500' as const, lineHeight: 16 },

  // Caption
  caption: { fontSize: 12, fontFamily: fontFamily.regular, fontWeight: '400' as const, lineHeight: 16 },

  // Numbers (tabular)
  numLg: { fontSize: 24, fontFamily: fontFamily.bold, fontWeight: '700' as const, lineHeight: 32 },
  num: { fontSize: 20, fontFamily: fontFamily.bold, fontWeight: '700' as const, lineHeight: 28 },
  numSm: { fontSize: 16, fontFamily: fontFamily.semibold, fontWeight: '600' as const, lineHeight: 22 },
} as const;
