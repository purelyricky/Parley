import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { formatPhone, cleanPhone, isValidE164, suggestLanguage, matchCountry } from '../../src/lib/phone';
import { normalizeUsername, usernameProblem } from '../../src/lib/format';
import { languageName } from '../../src/lib/languages';
import { useAuth } from '../../src/state/auth';
import { useCall } from '../../src/state/call';
import { Banner, Button, Card, Chip, Field, LanguageButton, LanguageSheet, Screen } from '../../src/ui/components';
import { Keypad } from '../../src/ui/Keypad';
import { Mascot, type Mood } from '../../src/ui/Mascot';
import { colors, font, space } from '../../src/ui/theme';

type Mode = 'phone' | 'user' | 'mirror';

export default function CallTab() {
  const params = useLocalSearchParams<{ mode?: string; to?: string; lang?: string }>();
  const user = useAuth((s) => s.user);
  const phoneEnabled = useAuth((s) => s.phoneEnabled);
  const status = useCall((s) => s.status);
  const error = useCall((s) => s.error);
  const [mode, setMode] = useState<Mode>('phone');
  const [translate, setTranslate] = useState(true);

  // Prefill from "Recents" taps.
  useEffect(() => {
    if (params.mode === 'phone' || params.mode === 'user' || params.mode === 'mirror') setMode(params.mode);
  }, [params.mode, params.to]);

  const offline = status !== 'open';
  const mood: Mood = offline ? 'sleeping' : 'idle';

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingTop: space.md, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={font.title}>Hi{user ? `, ${user.username}` : ''}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status === 'open' ? colors.mint : colors.warn, marginRight: 8 }} />
              <Text style={font.small}>{status === 'open' ? 'Online, ready to call' : status === 'closed' ? 'Offline' : 'Connecting…'}</Text>
            </View>
          </View>
          <Mascot mood={mood} size={72} />
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: space.lg }}>
          <Chip label="Phone" icon="keypad" active={mode === 'phone'} onPress={() => setMode('phone')} />
          <Chip label="Username" icon="at" active={mode === 'user'} onPress={() => setMode('user')} />
          <Chip label="Test" icon="flask" active={mode === 'mirror'} onPress={() => setMode('mirror')} />
        </View>

        {error ? <View style={{ marginTop: space.md }}><Banner tone="error" icon="alert-circle">{error}</Banner></View> : null}
        {status === 'reconnecting' || status === 'closed' ? (
          <View style={{ marginTop: space.md }}>
            <Banner tone="warn" icon="cloud-offline">Can't reach your Parley server. Check that it's running and the address in You → Server is right.</Banner>
          </View>
        ) : null}

        <View style={{ marginTop: space.lg }}>
          {mode === 'phone' && <PhoneDial enabled={phoneEnabled} translate={translate} setTranslate={setTranslate} initialTo={params.to} initialLang={params.lang} disabled={offline} />}
          {mode === 'user' && <UserDial translate={translate} setTranslate={setTranslate} initialTo={params.to} disabled={offline} />}
          {mode === 'mirror' && <MirrorTest myLanguage={user?.language ?? 'en'} disabled={offline} />}
        </View>
      </ScrollView>
    </Screen>
  );
}

function TranslateRow({ value, onChange, note }: { value: boolean; onChange: (v: boolean) => void; note?: string }) {
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }}>
      <Ionicons name="language" size={22} color={colors.brandHi} style={{ marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={font.h3}>AI translation</Text>
        <Text style={font.small}>{note ?? 'Turn off if you share a language'}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.brand, false: colors.card }} thumbColor={colors.white} />
    </Card>
  );
}

function PhoneDial({ enabled, translate, setTranslate, initialTo, initialLang, disabled }: {
  enabled: boolean; translate: boolean; setTranslate(v: boolean): void; initialTo?: string; initialLang?: string; disabled: boolean;
}) {
  const router = useRouter();
  const [number, setNumber] = useState(initialTo ? cleanPhone(initialTo) : '+');
  const [lang, setLang] = useState<string | null>(initialLang ?? null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (initialTo) setNumber(cleanPhone(initialTo)); if (initialLang) setLang(initialLang); }, [initialTo, initialLang]);

  const suggested = suggestLanguage(number);
  const effective = lang ?? suggested ?? null;
  const country = matchCountry(number);
  const valid = isValidE164(number);

  if (!enabled) {
    return <Banner icon="information-circle">Phone calls aren't set up on your server yet. Add your Telnyx details to the server's .env (see the README), or try the Username and Test tabs meanwhile.</Banner>;
  }

  async function dial() {
    if (!effective) { setSheet(true); return; }
    setBusy(true);
    const ok = await useCall.getState().callPhone(number, effective, translate);
    setBusy(false);
    if (ok) router.push('/call');
  }

  return (
    <>
      <View style={{ alignItems: 'center', minHeight: 72, justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 32, fontWeight: '600', letterSpacing: 0.5 }} numberOfLines={1} adjustsFontSizeToFit>
          {number.length > 1 ? formatPhone(number) : 'Enter a number'}
        </Text>
        <Text style={font.small}>{country ? `${country.flag} ${country.country}` : 'Start with + and the country code'}</Text>
      </View>
      <Keypad onKey={(k) => setNumber((n) => (k === '+' ? (n.startsWith('+') ? n : '+' + n) : (n + k).slice(0, 16)))} onBackspace={() => setNumber((n) => (n.length > 1 ? n.slice(0, -1) : n))} onClear={() => setNumber('+')} />
      <View style={{ marginTop: space.md }}>
        <LanguageButton code={effective ?? ''} onPress={() => setSheet(true)} label="They speak" />
        {!effective && valid ? <Text style={{ color: colors.warn, fontSize: 13, marginTop: 6 }}>Pick the language they speak.</Text> : null}
      </View>
      <TranslateRow value={translate} onChange={setTranslate} />
      <Button title="Call" icon="call" variant="mint" onPress={dial} loading={busy} disabled={disabled || !valid} style={{ marginTop: space.lg }} />
      <LanguageSheet visible={sheet} selected={effective ?? undefined} title="They speak" onSelect={(c) => { setLang(c); setSheet(false); }} onClose={() => setSheet(false)} />
    </>
  );
}

type Lookup = { state: 'idle' } | { state: 'loading' } | { state: 'found'; language: string; online: boolean } | { state: 'missing' } | { state: 'error'; message: string };

function UserDial({ translate, setTranslate, initialTo, disabled }: { translate: boolean; setTranslate(v: boolean): void; initialTo?: string; disabled: boolean }) {
  const router = useRouter();
  const me = useAuth((s) => s.user?.username);
  const [name, setName] = useState(initialTo ?? '');
  const [info, setInfo] = useState<Lookup>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const username = normalizeUsername(name);

  useEffect(() => { if (initialTo) setName(initialTo); }, [initialTo]);

  useEffect(() => {
    if (!username || usernameProblem(username)) { setInfo({ state: 'idle' }); return; }
    setInfo({ state: 'loading' });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await useAuth.getState().api().lookup(username);
        if (!cancelled) setInfo({ state: 'found', language: r.language, online: r.online });
      } catch (e: any) {
        if (!cancelled) setInfo(e?.status === 404 ? { state: 'missing' } : { state: 'error', message: e?.message ?? 'Lookup failed' });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [username]);

  async function dial() {
    setBusy(true);
    const ok = await useCall.getState().callUser(username, translate);
    setBusy(false);
    if (ok) router.push('/call');
  }

  const self = username === me;
  const canCall = info.state === 'found' && info.online && !self;

  return (
    <>
      <Text style={[font.dim, { marginBottom: space.md }]}>Call another Parley user over the internet. It's free, like FaceTime, but translated.</Text>
      <Field
        label="Their username" value={name} onChangeText={setName} placeholder="anna" prefix="@" autoCapitalize="none" autoCorrect={false}
        error={self ? "That's you!" : info.state === 'missing' ? 'No one with that username' : info.state === 'error' ? info.message : null}
      />
      {info.state === 'loading' ? <ActivityIndicator color={colors.textDim} /> : null}
      {info.state === 'found' && !self ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: info.online ? colors.mint : colors.textFaint, marginRight: 12 }} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>@{username}</Text>
            <Text style={font.small}>Speaks {languageName(info.language)} · {info.online ? 'online now' : 'offline: they need to open Parley'}</Text>
          </View>
        </Card>
      ) : null}
      <TranslateRow value={translate} onChange={setTranslate} />
      <Button title="Call" icon="videocam-outline" variant="mint" onPress={dial} loading={busy} disabled={disabled || !canCall} style={{ marginTop: space.lg }} />
    </>
  );
}

function MirrorTest({ myLanguage, disabled }: { myLanguage: string; disabled: boolean }) {
  const router = useRouter();
  const [lang, setLang] = useState(myLanguage === 'es' ? 'fr' : 'es');
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    const ok = await useCall.getState().callMirror(lang);
    setBusy(false);
    if (ok) router.push('/call');
  }

  return (
    <>
      <Card>
        <Text style={font.h3}>Test the translation, alone</Text>
        <Text style={[font.dim, { marginTop: 6 }]}>
          Speak in {languageName(myLanguage)} and Parley answers back in the other language, in your voice, so you can check everything works before calling a real person. Use headphones to avoid echo.
        </Text>
      </Card>
      <View style={{ marginTop: space.md }}><LanguageButton code={lang} onPress={() => setSheet(true)} label="Translate me into" /></View>
      <Button title="Start test" icon="flask" onPress={start} loading={busy} disabled={disabled} style={{ marginTop: space.lg }} />
      <LanguageSheet visible={sheet} selected={lang} title="Translate me into" onSelect={(c) => { setLang(c); setSheet(false); }} onClose={() => setSheet(false)} />
    </>
  );
}
