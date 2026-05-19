import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '@/theme';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  success: { bg: Colors.successLight, text: Colors.success, dot: Colors.success },
  warning: { bg: Colors.warningLight, text: Colors.warning, dot: Colors.warning },
  error: { bg: Colors.errorLight, text: Colors.error, dot: Colors.error },
  info: { bg: Colors.infoLight, text: Colors.info, dot: Colors.info },
  neutral: { bg: Colors.borderLight, text: Colors.textSecondary, dot: Colors.textMuted },
  primary: { bg: Colors.primaryLight, text: Colors.primary, dot: Colors.primary },
};

export function Badge({ label, variant = 'neutral', dot = false }: BadgeProps) {
  const vs = variantStyles[variant];
  return (
    <View style={[styles.badge, { backgroundColor: vs.bg }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: vs.dot }]} /> : null}
      <Text style={[styles.label, { color: vs.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xs - 1,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...Typography.labelSm },
});
