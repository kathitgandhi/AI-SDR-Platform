import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '@/theme';
import { HotLeadsScreen } from '@/screens/leads/HotLeadsScreen';
import { LeadDetailScreen } from '@/screens/leads/LeadDetailScreen';
import { CallTranscriptScreen } from '@/screens/leads/CallTranscriptScreen';
import type { LeadsStackParamList } from '../types';

const Stack = createNativeStackNavigator<LeadsStackParamList>();

export function LeadsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.headerBg },
        headerTintColor: Colors.headerText,
        headerBackTitleVisible: false,
      }}
    >
      <Stack.Screen name="HotLeads" component={HotLeadsScreen} options={{ title: 'Hot Leads' }} />
      <Stack.Screen name="LeadDetail" component={LeadDetailScreen} options={({ route }) => ({ title: route.params.companyName })} />
      <Stack.Screen name="CallTranscript" component={CallTranscriptScreen} options={{ title: 'Call Transcript' }} />
    </Stack.Navigator>
  );
}
