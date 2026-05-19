export const Colors = {
  // Background
  background: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',

  // Brand
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primaryLight: '#DBEAFE',
  primaryText: '#1E40AF',

  // Semantic
  success: '#16A34A',
  successLight: '#DCFCE7',
  warning: '#D97706',
  warningLight: '#FEF3C7',
  error: '#DC2626',
  errorLight: '#FEE2E2',
  info: '#0284C7',
  infoLight: '#E0F2FE',

  // Text
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',

  // Border
  border: '#E2E8F0',
  borderLight: '#F1F5F9',

  // Navigation
  tabBar: '#FFFFFF',
  tabBarBorder: '#E2E8F0',
  tabActive: '#2563EB',
  tabInactive: '#94A3B8',

  // Header
  headerBg: '#1E293B',
  headerText: '#FFFFFF',

  // Misc
  divider: '#F1F5F9',
  overlay: 'rgba(0,0,0,0.4)',
  skeleton: '#E2E8F0',
} as const;

export type ColorKey = keyof typeof Colors;
