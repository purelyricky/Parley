import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable } from 'react-native';
import { VoiceFlow } from '../src/ui/VoiceFlow';
import { colors } from '../src/ui/theme';

export default function VoiceModal() {
  const router = useRouter();
  return (
    <>
      <VoiceFlow onDone={() => router.back()} />
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" style={{ position: 'absolute', top: 56, right: 20 }}>
        <Ionicons name="close" size={28} color={colors.textDim} />
      </Pressable>
    </>
  );
}
