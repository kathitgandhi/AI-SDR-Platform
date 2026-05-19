import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '@/theme';
import { RecentCallsScreen } from '@/screens/activity/RecentCallsScreen';
import { TranscriptDetailScreen } from '@/screens/activity/TranscriptDetailScreen';
import { MeetingsBookedScreen } from '@/screens/activity/MeetingsBookedScreen';
import type { ActivityStackParamList } from '../types';

const Stack = createNativeStackNavigator<ActivityStackParamList>();

export function ActivityStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.headerBg },
        headerTintColor: Colors.headerText,
        headerBackTitleVisible: false,
      }}
    >
      <Stack.Screen name="RecentCalls" component={RecentCallsScreen} options={{ title: 'Recent Calls' }} />
      <Stack.Screen name="TranscriptDetail" component={TranscriptDetailScreen} options={({ route }) => ({ title: route.params.companyName })} />
      <Stack.Screen name="MeetingsBooked" component={MeetingsBookedScreen} options={{ title: 'Meetings Booked' }} />
    </Stack.Navigator>
  );
}
