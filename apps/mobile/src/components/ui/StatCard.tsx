import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Colors, Typography, Spacing, Radius, Shadow } from '@/theme';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  iconColor?: string;
  trend?: { value: number; label?: string };
  style?: ViewStyle;
}

export function StatCard({ label, value, icon, iconColor = Colors.primary, trend, style }: StatCardProps) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        {icon ? <View style={[styles.iconBox, { backgroundColor: iconColor + '1A' }]}>
          <Icon name={icon} size={18} color={iconColor} />
        </View> : null}
      </View>
      <Text style={styles.value}>{value}</Text>
      {trend ? (
        <View style={styles.trendRow}>
          <Icon
            name={trend.value >= 0 ? 'trending-up' : 'trending-down'}
            size={14}
            color={trend.value >= 0 ? Colors.success : Colors.error}
          />
          <Text style={[styles.trendText, { color: trend.value >= 0 ? Colors.success : Colors.error }]}>
            {Math.abs(trend.value)}%{trend.label ? ` ${trend.label}` : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    ...Shadow.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.xs },
  label: { ...Typography.label, color: Colors.textSecondary, flex: 1 },
  iconBox: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  value: { ...Typography.numLg, color: Colors.text, marginBottom: Spacing.xs },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  trendText: { ...Typography.caption },
});
