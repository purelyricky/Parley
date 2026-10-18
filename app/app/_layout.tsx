import { useRouter, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '../src/state/auth';
import { useCall } from '../src/state/call';
import { useRecents } from '../src/state/recents';
import { colors } from '../src/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const ready = useAuth((s) => s.ready);
  const token = useAuth((s) => s.token);
  const done = useAuth((s) => s.onboardingDone);
  const serverUrl = useAuth((s) => s.serverUrl);
  const incoming = useCall((s) => s.incoming);
  const call = useCall((s) => s.call);
  const router = useRouter();
  const segments = useSegments();
  const signedIn = !!token && done;

  useEffect(() => {
    void useAuth.getState().hydrate();
    void useRecents.getState().hydrate();
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Keep the socket up while signed in.
  useEffect(() => {
    if (!ready) return;
    if (signedIn) useCall.getState().connect();
    else useCall.getState().disconnect();
    return () => useCall.getState().disconnect();
  }, [ready, signedIn, token, serverUrl]);

  const top = segments[0] as string | undefined;

  useEffect(() => {
    if (signedIn && incoming && top !== 'incoming' && top !== 'call') router.push('/incoming');
  }, [signedIn, incoming, top, router]);

  useEffect(() => {
    if (signedIn && call && call.state !== 'ended' && top !== 'call') router.push('/call');
  }, [signedIn, call, top, router]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(onboarding)" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="call" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="voice" options={{ presentation: 'modal' }} />
            <Stack.Screen name="incoming" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }} />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
