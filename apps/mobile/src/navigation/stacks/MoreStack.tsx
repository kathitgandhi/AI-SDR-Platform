import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '@/theme';
import { MoreScreen } from '@/screens/more/MoreScreen';
import { QueueMonitorScreen } from '@/screens/more/QueueMonitorScreen';
import { ProfileScreen } from '@/screens/more/ProfileScreen';
import type { MoreStackParamList } from '../types';

const Stack = createNativeStackNavigator<MoreStackParamList>();

export function MoreStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.headerBg },
        headerTintColor: Colors.headerText,
        headerBackTitleVisible: false,
      }}
    >
      <Stack.Screen name="MoreMenu" component={MoreScreen} options={{ title: 'More' }} />
      <Stack.Screen name="QueueMonitor" component={QueueMonitorScreen} options={{ title: 'Queue Monitor' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Stack.Navigator>
  );
}
