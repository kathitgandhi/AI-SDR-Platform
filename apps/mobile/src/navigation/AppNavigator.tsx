import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Colors, Typography } from '@/theme';
import { LeadsStack } from './stacks/LeadsStack';
import { CampaignsStack } from './stacks/CampaignsStack';
import { ActivityStack } from './stacks/ActivityStack';
import { MoreStack } from './stacks/MoreStack';
import { DashboardScreen } from '@/screens/dashboard/DashboardScreen';
import type { BottomTabParamList } from './types';

const Tab = createBottomTabNavigator<BottomTabParamList>();

export function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.tabBar,
          borderTopColor: Colors.tabBarBorder,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: Colors.tabActive,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarLabelStyle: { ...Typography.labelSm },
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, string> = {
            DashboardTab: 'dashboard',
            LeadsTab: 'people',
            CampaignsTab: 'campaign',
            ActivityTab: 'phone-in-talk',
            MoreTab: 'more-horiz',
          };
          return <Icon name={icons[route.name] ?? 'circle'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ tabBarLabel: 'Dashboard' }} />
      <Tab.Screen name="LeadsTab" component={LeadsStack} options={{ tabBarLabel: 'Leads' }} />
      <Tab.Screen name="CampaignsTab" component={CampaignsStack} options={{ tabBarLabel: 'Campaigns' }} />
      <Tab.Screen name="ActivityTab" component={ActivityStack} options={{ tabBarLabel: 'Activity' }} />
      <Tab.Screen name="MoreTab" component={MoreStack} options={{ tabBarLabel: 'More' }} />
    </Tab.Navigator>
  );
}
