import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { DEMO } from '../../src/demo/demo';
import { makeDemoFetch } from '../../src/demo/demoFetch';
import { Api } from '../../src/lib/api';
import { normalizeServerUrl } from '../../src/lib/format';
import { useAuth } from '../../src/state/auth';
import { Banner, Button, Field, Screen } from '../../src/ui/components';
import { Mascot } from '../../src/ui/Mascot';
import { colors, font, space } from '../../src/ui/theme';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'call', title: 'Call anyone', body: 'Dial a normal phone number. They don’t need the app.' },
  { icon: 'mic', title: 'In your own voice', body: 'Your voice is cloned, so the translation sounds like you.' },
  { icon: 'language', title: 'Each in their language', body: 'You speak yours, they hear theirs, and the other way round.' },
];

export default function Welcome() {
  const router = useRouter();
  const serverUrl = useAuth((s) => s.serverUrl);
  const [showServer, setShowServer] = useState(!serverUrl);
  const [url, setUrl] = useState(serverUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next() {
    const normalized = normalizeServerUrl(url);
    if (!normalized) { setShowServer(true); setError('Enter the address of your Parley server first.'); return; }
    setBusy(true); setError(null);
    try {
      await new Api(normalized, null, DEMO ? makeDemoFetch(() => null) : undefined).health();
      await useAuth.getState().setServerUrl(normalized);
      router.push('/profile');
    } catch (e: any) {
      setShowServer(true);
      setError(e?.message ?? "Can't reach the server.");
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: space.lg }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginTop: space.md }}>
          <Mascot mood="waking" size={170} float />
          <Text style={[font.title, { marginTop: space.md, textAlign: 'center' }]}>Parley</Text>
          <Text style={[font.dim, { textAlign: 'center', marginTop: 6, maxWidth: 300 }]}>
            Talk to anyone, in any language, as if you shared one.
          </Text>
        </View>

        <View style={{ marginTop: space.xl, gap: space.md }}>
          {POINTS.map((p) => (
            <View key={p.title} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                <Ionicons name={p.icon} size={22} color={colors.brandHi} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={font.h3}>{p.title}</Text>
                <Text style={font.small}>{p.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ flex: 1, minHeight: space.lg }} />

        {showServer ? (
          <View style={{ marginTop: space.lg }}>
            <Field
              label="Server address" value={url} onChangeText={setUrl} placeholder="https://your-name.ngrok-free.app"
              autoCapitalize="none" autoCorrect={false} keyboardType="url"
              hint="The address of the Parley server you started (see the README)."
            />
          </View>
        ) : null}
        {error ? <View style={{ marginBottom: space.md }}><Banner tone="error" icon="alert-circle">{error}</Banner></View> : null}

        <Button title="Get started" onPress={next} loading={busy} icon="arrow-forward" />
        <Pressable onPress={() => setShowServer((v) => !v)} style={{ alignSelf: 'center', padding: space.md }}>
          <Text style={{ color: colors.textFaint, fontSize: 13 }}>{showServer ? 'Hide server settings' : 'Server settings'}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
