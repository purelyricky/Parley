import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';
import { colors } from '../../src/ui/theme';

const icon = (name: keyof typeof Ionicons.glyphMap, focused: keyof typeof Ionicons.glyphMap) =>
  ({ color, focused: f, size }: { color: ColorValue; focused: boolean; size: number }) => <Ionicons name={f ? focused : name} size={size} color={color as string} />;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandHi,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.bgSoft, borderTopColor: colors.border },
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Call', tabBarIcon: icon('call-outline', 'call') }} />
      <Tabs.Screen name="recents" options={{ title: 'Recents', tabBarIcon: icon('time-outline', 'time') }} />
      <Tabs.Screen name="you" options={{ title: 'You', tabBarIcon: icon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
