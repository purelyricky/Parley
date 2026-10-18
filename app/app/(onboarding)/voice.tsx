import { useRouter } from 'expo-router';
import React from 'react';
import { VoiceFlow } from '../../src/ui/VoiceFlow';

export default function Voice() {
  const router = useRouter();
  return <VoiceFlow step="Step 2 of 3" onDone={() => router.push('/ready')} onSkip={() => router.push('/ready')} />;
}
