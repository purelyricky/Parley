import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { VoiceRecorder } from '../audio/VoiceRecorder';
import { ensureMicPermission } from '../audio/session';
import { bytesToBase64 } from '../lib/base64';
import { MAX_SECONDS, MIN_SECONDS, TARGET_SECONDS, VOICE_PROMPTS, promptForElapsed } from '../lib/voicePrompts';
import { useAuth } from '../state/auth';
import { Banner, Button, Card, LevelMeter, ProgressRing, Screen, success } from './components';
import { Mascot, type Mood } from './Mascot';
import { colors, font, space } from './theme';

type Phase = 'intro' | 'recording' | 'review' | 'uploading';

export function VoiceFlow({ step, onDone, onSkip }: { step?: string; onDone: () => void; onSkip?: () => void }) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [consent, setConsent] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<VoiceRecorder | null>(null);

  useKeepAwake();
  useEffect(() => () => rec.current?.stop(), []);

  async function begin() {
    setError(null);
    if (!(await ensureMicPermission())) {
      setError('Parley needs the microphone to learn your voice. Enable it in Settings → Parley, then try again.');
      return;
    }
    const r = new VoiceRecorder((l) => setLevel(l));
    rec.current = r;
    r.start();
    setSeconds(0);
    setPhase('recording');
  }

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => {
      const s = rec.current?.seconds ?? 0;
      setSeconds(s);
      if (s >= MAX_SECONDS) finish();
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  function finish() {
    rec.current?.stop();
    setLevel(0);
    setPhase('review');
  }

  function again() {
    rec.current?.reset();
    setSeconds(0);
    setPhase('intro');
  }

  async function upload() {
    if (!rec.current) return;
    setPhase('uploading'); setError(null);
    try {
      const wav = rec.current.toWav();
      await useAuth.getState().api().cloneVoice(bytesToBase64(wav), true).then((r) => useAuth.getState().setUser(r.user));
      success();
      onDone();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong while cloning your voice.');
      setPhase('review');
    }
  }

  const mood: Mood = phase === 'recording' ? 'listening' : phase === 'uploading' ? 'thinking' : phase === 'review' ? 'happy' : 'curious';
  const enough = seconds >= MIN_SECONDS;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: space.lg }} showsVerticalScrollIndicator={false}>
        {step ? <Text style={font.label}>{step}</Text> : null}
        <Text style={[font.title, { marginTop: 6 }]}>Teach Parley your voice</Text>

        {phase === 'intro' && (
          <>
            <Text style={[font.dim, { marginTop: 8 }]}>
              Read a few sentences out loud for about a minute. Parley makes a copy of your voice, so the people you call hear the translation in <Text style={{ color: colors.text }}>your</Text> voice.
            </Text>
            <View style={{ alignItems: 'center', marginVertical: space.lg }}><Mascot mood={mood} size={130} float /></View>
            <Card>
              <Text style={font.h3}>Tips for a great clone</Text>
              <Text style={[font.dim, { marginTop: 6 }]}>{'• Find a quiet room\n• Hold the phone like you would on a call\n• Speak naturally, don’t whisper or shout'}</Text>
            </Card>
            <Pressable onPress={() => setConsent((c) => !c)} style={{ flexDirection: 'row', marginTop: space.lg, alignItems: 'flex-start' }} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
              <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={26} color={consent ? colors.brandHi : colors.textDim} style={{ marginRight: 12 }} />
              <Text style={[font.dim, { flex: 1, fontSize: 14 }]}>
                This is my own voice and I agree to Parley creating an AI copy of it. People I talk to are told the call is AI-translated. I can delete the copy any time in <Text style={{ color: colors.text }}>You</Text>.
              </Text>
            </Pressable>
            {error ? <View style={{ marginTop: space.md }}><Banner tone="error" icon="alert-circle">{error}</Banner></View> : null}
            <View style={{ flex: 1, minHeight: space.lg }} />
            <Button title="Start recording" icon="mic" onPress={begin} disabled={!consent} />
            {onSkip ? <Button title="Skip for now" variant="ghost" onPress={onSkip} style={{ marginTop: 4 }} /> : null}
          </>
        )}

        {phase === 'recording' && (
          <>
            <Text style={[font.dim, { marginTop: 8 }]}>Read this out loud. Keep going until the ring is full.</Text>
            <View style={{ alignItems: 'center', marginTop: space.lg }}>
              <ProgressRing size={170} progress={seconds / TARGET_SECONDS} color={enough ? colors.mint : colors.brand}>
                <Mascot mood="listening" size={104} />
              </ProgressRing>
              <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', marginTop: space.md, fontVariant: ['tabular-nums'] }}>
                {Math.floor(seconds)}s <Text style={{ color: colors.textFaint, fontSize: 16 }}>/ {TARGET_SECONDS}s</Text>
              </Text>
            </View>
            <Card style={{ marginTop: space.lg, minHeight: 130, justifyContent: 'center' }}>
              <Text style={{ color: colors.text, fontSize: 19, lineHeight: 28 }}>{VOICE_PROMPTS[promptForElapsed(seconds)]}</Text>
            </Card>
            <View style={{ marginTop: space.lg }}><LevelMeter level={level} /></View>
            <View style={{ flex: 1, minHeight: space.lg }} />
            <Button title={enough ? 'Done' : `Keep going (${Math.max(0, Math.ceil(MIN_SECONDS - seconds))}s minimum)`} variant={enough ? 'mint' : 'secondary'} disabled={!enough} onPress={finish} icon={enough ? 'checkmark' : undefined} />
          </>
        )}

        {(phase === 'review' || phase === 'uploading') && (
          <>
            <View style={{ alignItems: 'center', marginVertical: space.xl }}>
              <Mascot mood={mood} size={150} float />
              <Text style={[font.h2, { marginTop: space.md }]}>{phase === 'uploading' ? 'Learning your voice…' : 'Sounds good!'}</Text>
              <Text style={[font.dim, { marginTop: 6, textAlign: 'center' }]}>
                {phase === 'uploading' ? 'This takes a few seconds.' : `${Math.round(seconds)} seconds recorded. Ready to create your voice?`}
              </Text>
            </View>
            {error ? <Banner tone="error" icon="alert-circle">{error}</Banner> : null}
            <View style={{ flex: 1, minHeight: space.lg }} />
            <Button title="Create my voice" icon="sparkles" onPress={upload} loading={phase === 'uploading'} />
            <Button title="Record again" variant="ghost" onPress={again} disabled={phase === 'uploading'} style={{ marginTop: 4 }} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
