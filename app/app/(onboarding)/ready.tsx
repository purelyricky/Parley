import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PcmPlayer } from '../../src/audio/PcmPlayer';
import { activateCallAudio } from '../../src/audio/session';
import { base64ToBytes } from '../../src/lib/base64';
import { useAuth } from '../../src/state/auth';
import { Banner, Button, Card, LanguageButton, LanguageSheet, Screen, success } from '../../src/ui/components';
import { Mascot } from '../../src/ui/Mascot';
import { colors, font, space } from '../../src/ui/theme';

export default function Ready() {
  const user = useAuth((s) => s.user);
  const [target, setTarget] = useState(user?.language === 'es' ? 'fr' : 'es');
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  useKeepAwake();
  useEffect(() => () => player.current?.stop(), []);

  async function hear() {
    setBusy(true); setError(null);
    try {
      const r = await useAuth.getState().api().previewVoice(target);
      setSaid(r.text);
      await activateCallAudio();
      player.current?.stop();
      const p = new PcmPlayer();
      player.current = p;
      p.start();
      p.push(base64ToBytes(r.audioBase64));
      success();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't play the preview.");
    } finally { setBusy(false); }
  }

  const hasVoice = !!user?.hasVoice;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: space.lg }} showsVerticalScrollIndicator={false}>
        <Text style={font.label}>Step 3 of 3</Text>
        <Text style={[font.title, { marginTop: 6 }]}>{hasVoice ? 'Meet your other voice' : "You're all set"}</Text>
        <View style={{ alignItems: 'center', marginVertical: space.lg }}><Mascot mood="celebrate" size={150} float /></View>

        {hasVoice ? (
          <>
            <Text style={font.dim}>Hear yourself speaking another language, then you’re ready to make your first call.</Text>
            <View style={{ marginTop: space.md }}>
              <LanguageButton code={target} onPress={() => setSheet(true)} label="Hear me in" />
            </View>
            <Button title="Play preview" icon="play" onPress={hear} loading={busy} variant="secondary" style={{ marginTop: space.md }} />
            {said ? <Card style={{ marginTop: space.md }}><Text style={{ color: colors.text, fontSize: 16, lineHeight: 23, fontStyle: 'italic' }}>“{said}”</Text></Card> : null}
          </>
        ) : (
          <Banner icon="information-circle">
            You skipped voice cloning, so people will hear a standard voice. You can add yours any time in the You tab.
          </Banner>
        )}
        {error ? <View style={{ marginTop: space.md }}><Banner tone="error" icon="alert-circle">{error}</Banner></View> : null}

        <View style={{ flex: 1, minHeight: space.lg }} />
        <Banner icon="sparkles">Everyone you call is told, in their language, that the call is translated by AI.</Banner>
        <Button title="Start talking" icon="call" onPress={() => useAuth.getState().finishOnboarding()} style={{ marginTop: space.md }} />
      </ScrollView>
      <LanguageSheet visible={sheet} selected={target} title="Hear me in" onSelect={(c) => { setTarget(c); setSheet(false); }} onClose={() => setSheet(false)} />
    </Screen>
  );
}
