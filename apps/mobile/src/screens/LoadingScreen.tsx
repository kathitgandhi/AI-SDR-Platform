import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '@/theme';
import { LoadingSpinner } from '@/components/ui';

export function LoadingScreen() {
  return (
    <View style={styles.container}>
      <LoadingSpinner size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
});
