import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { normalizeUsername, usernameProblem } from '../../src/lib/format';
import { isSupportedLanguage } from '../../src/lib/languages';
import { useAuth } from '../../src/state/auth';
import { Banner, Button, Field, LanguageButton, LanguageSheet, Screen } from '../../src/ui/components';
import { Mascot } from '../../src/ui/Mascot';
import { colors, font, space } from '../../src/ui/theme';

function deviceLanguage(): string {
  try {
    const code = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2).toLowerCase();
    return isSupportedLanguage(code) ? code : 'en';
  } catch { return 'en'; }
}

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'bad'; message: string };

export default function Profile() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState(deviceLanguage());
  const [sheet, setSheet] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const username = normalizeUsername(name);

  useEffect(() => {
    if (!username) { setCheck({ state: 'idle' }); return; }
    const problem = usernameProblem(username);
    if (problem) { setCheck({ state: 'bad', message: problem }); return; }
    setCheck({ state: 'checking' });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await useAuth.getState().api().usernameAvailable(username);
        if (!cancelled) setCheck(r.available ? { state: 'ok' } : { state: 'bad', message: 'That username is taken' });
      } catch (e: any) {
        if (!cancelled) setCheck({ state: 'bad', message: e?.message ?? "Couldn't check that username" });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [username]);

  async function next() {
    setBusy(true); setError(null);
    try {
      await useAuth.getState().register(username, language);
      router.push('/voice');
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally { setBusy(false); }
  }

  const right = check.state === 'checking' ? <ActivityIndicator color={colors.textDim} />
    : check.state === 'ok' ? <Ionicons name="checkmark-circle" size={22} color={colors.mint} /> : null;

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingTop: space.lg }} showsVerticalScrollIndicator={false}>
          <Text style={font.label}>Step 1 of 3</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={font.title}>Who are you?</Text>
              <Text style={[font.dim, { marginTop: 6 }]}>Pick a username (friends use it to call you in the app) and the language you speak.</Text>
            </View>
            <Mascot mood="curious" size={84} />
          </View>

          <View style={{ marginTop: space.lg }}>
            <Field
              label="Username" value={name} onChangeText={setName} placeholder="erick" prefix="@" right={right}
              autoCapitalize="none" autoCorrect={false} maxLength={21}
              error={check.state === 'bad' ? check.message : null}
              hint={check.state === 'ok' ? 'Nice, that one is yours.' : '3–20 letters, numbers or _'}
            />
            <LanguageButton code={language} onPress={() => setSheet(true)} label="I speak" />
          </View>

          <View style={{ flex: 1 }} />
          {error ? <View style={{ marginBottom: space.md }}><Banner tone="error" icon="alert-circle">{error}</Banner></View> : null}
          <Button title="Continue" onPress={next} loading={busy} disabled={check.state !== 'ok'} icon="arrow-forward" style={{ marginTop: space.lg }} />
        </ScrollView>
      </KeyboardAvoidingView>
      <LanguageSheet visible={sheet} selected={language} title="I speak" onSelect={(c) => { setLanguage(c); setSheet(false); }} onClose={() => setSheet(false)} />
    </Screen>
  );
}
