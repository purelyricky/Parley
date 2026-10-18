import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { normalizeServerUrl } from '../../src/lib/format';
import { languageName } from '../../src/lib/languages';
import { useAuth } from '../../src/state/auth';
import { useCall } from '../../src/state/call';
import { Banner, Button, Card, Field, LanguageButton, LanguageSheet, Screen, SectionLabel } from '../../src/ui/components';
import { Mascot } from '../../src/ui/Mascot';
import { colors, font, space } from '../../src/ui/theme';

export default function You() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const serverUrl = useAuth((s) => s.serverUrl);
  const phoneEnabled = useAuth((s) => s.phoneEnabled);
  const status = useCall((s) => s.status);
  const [sheet, setSheet] = useState(false);
  const [server, setServer] = useState(serverUrl);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>, ok?: string) {
    setBusy(key); setMsg(null);
    try { const r = await fn(); if (ok) setMsg({ tone: 'info', text: ok }); return r; }
    catch (e: any) { setMsg({ tone: 'error', text: e?.message ?? 'Something went wrong.' }); }
    finally { setBusy(null); }
  }

  const changeLanguage = (code: string) => {
    setSheet(false);
    void run('lang', async () => useAuth.getState().setUser((await useAuth.getState().api().setLanguage(code)).user));
  };

  const deleteVoice = () => Alert.alert('Delete your voice?', 'The AI copy of your voice is removed from Parley. People will hear a standard voice until you record again.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => void run('voice', async () => useAuth.getState().setUser((await useAuth.getState().api().deleteVoice()).user), 'Voice deleted.') },
  ]);

  const deleteAccount = () => Alert.alert('Delete account?', 'Your username and your cloned voice are permanently deleted.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete everything', style: 'destructive', onPress: () => void run('acct', async () => { await useAuth.getState().api().deleteAccount(); await useAuth.getState().signOut(); }) },
  ]);

  const saveServer = () => run('server', async () => {
    const url = normalizeServerUrl(server);
    await useAuth.getState().setServerUrl(url);
    setServer(url);
    useCall.getState().connect();
  }, 'Server address saved.');

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingTop: space.md, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={font.title}>You</Text>

        <Card style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }}>
          <Mascot mood="happy" size={72} />
          <View style={{ marginLeft: space.md, flex: 1 }}>
            <Text style={font.h2}>@{user?.username}</Text>
            <Text style={font.small}>Speaks {languageName(user?.language ?? 'en')}</Text>
          </View>
        </Card>

        {msg ? <View style={{ marginTop: space.md }}><Banner tone={msg.tone === 'error' ? 'error' : 'info'} icon={msg.tone === 'error' ? 'alert-circle' : 'checkmark-circle'}>{msg.text}</Banner></View> : null}

        <SectionLabel>My language</SectionLabel>
        <LanguageButton code={user?.language ?? 'en'} onPress={() => setSheet(true)} />

        <SectionLabel>My voice</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={user?.hasVoice ? 'checkmark-circle' : 'mic-off'} size={22} color={user?.hasVoice ? colors.mint : colors.warn} style={{ marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={font.h3}>{user?.hasVoice ? 'Your voice is ready' : 'No voice yet'}</Text>
              <Text style={font.small}>{user?.hasVoice ? 'Translations are spoken in your voice.' : 'People currently hear a standard voice.'}</Text>
            </View>
          </View>
          <Button title={user?.hasVoice ? 'Record again' : 'Record my voice'} icon="mic" variant="secondary" small onPress={() => router.push('/voice')} style={{ marginTop: space.md }} />
          {user?.hasVoice ? <Button title="Delete my voice" variant="ghost" small onPress={deleteVoice} loading={busy === 'voice'} /> : null}
        </Card>

        <SectionLabel>Server</SectionLabel>
        <Field value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…"
          hint={`${status === 'open' ? 'Connected' : status === 'closed' ? 'Not connected' : 'Connecting…'} · phone calls ${phoneEnabled ? 'enabled' : 'not set up'}`} />
        <Button title="Save address" variant="secondary" small onPress={saveServer} loading={busy === 'server'} disabled={normalizeServerUrl(server) === serverUrl} />

        <SectionLabel>About</SectionLabel>
        <Card>
          <Text style={font.h3}>AI translation, always disclosed</Text>
          <Text style={[font.dim, { marginTop: 6 }]}>
            Whoever you call hears a short spoken notice, in their language, that the call is translated by AI using a copy of your voice. Your voice sample is only used to make that copy.
          </Text>
          <Text style={[font.small, { marginTop: space.md }]}>Mascot: Strobi, from smontlouis/bible-strong-avatar-lab (AGPL-3.0).</Text>
        </Card>

        <Button title="Delete account" variant="ghost" onPress={deleteAccount} loading={busy === 'acct'} style={{ marginTop: space.lg }} />
      </ScrollView>
      <LanguageSheet visible={sheet} selected={user?.language} title="I speak" onSelect={changeLanguage} onClose={() => setSheet(false)} />
    </Screen>
  );
}
