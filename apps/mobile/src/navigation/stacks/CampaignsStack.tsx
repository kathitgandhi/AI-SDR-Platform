import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '@/theme';
import { CampaignsScreen } from '@/screens/campaigns/CampaignsScreen';
import { CampaignDetailScreen } from '@/screens/campaigns/CampaignDetailScreen';
import { EditPacingScreen } from '@/screens/campaigns/EditPacingScreen';
import type { CampaignsStackParamList } from '../types';

const Stack = createNativeStackNavigator<CampaignsStackParamList>();

export function CampaignsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.headerBg },
        headerTintColor: Colors.headerText,
        headerBackTitleVisible: false,
      }}
    >
      <Stack.Screen name="CampaignsList" component={CampaignsScreen} options={{ title: 'Campaigns' }} />
      <Stack.Screen name="CampaignDetail" component={CampaignDetailScreen} options={({ route }) => ({ title: route.params.campaignName })} />
      <Stack.Screen name="EditPacing" component={EditPacingScreen} options={{ title: 'Edit Pacing' }} />
    </Stack.Navigator>
  );
}
