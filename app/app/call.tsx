import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { formatDuration, reasonText } from '../src/lib/format';
import { lineText, type Line } from '../src/lib/callReducer';
import { languageName } from '../src/lib/languages';
import { formatPhone } from '../src/lib/phone';
import { useCall } from '../src/state/call';
import { Banner, IconButton, Screen } from '../src/ui/components';
import { Mascot, type Mood } from '../src/ui/Mascot';
import { colors, font, radius, space } from '../src/ui/theme';

function Bubble({ line, translating }: { line: Line; translating: boolean }) {
  const mine = line.who === 'me';
  const { main, sub } = lineText(line, translating);
  if (!main) return null;
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '86%', marginBottom: 10 }}>
      <View style={{
        backgroundColor: mine ? colors.brand : colors.card, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10,
        borderBottomRightRadius: mine ? 6 : radius.lg, borderBottomLeftRadius: mine ? radius.lg : 6,
      }}>
        <Text style={{ color: colors.white, fontSize: 16, lineHeight: 22 }}>{main}</Text>
        {sub ? <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export default function CallScreen() {
  const router = useRouter();
  const call = useCall((s) => s.call);
  const pending = useCall((s) => s.pending);
  const muted = useCall((s) => s.muted);
  const level = useCall((s) => s.micLevel);
  const [now, setNow] = useState(Date.now());
  const list = useRef<FlatList<Line>>(null);
  useKeepAwake();

  const ended = call?.state === 'ended';

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Leave once the call has ended (after a moment, so the reason can be read) or if there is none.
  useEffect(() => {
    if (!call) { if (!pending) router.back(); return; }
    if (call.state !== 'ended') return;
    const t = setTimeout(() => { useCall.getState().dismissCall(); router.back(); }, 1800);
    return () => clearTimeout(t);
  }, [call?.state, call === null, pending]);

  useEffect(() => { list.current?.scrollToEnd({ animated: true }); }, [call?.lines.length, call?.partial.me, call?.partial.them]);

  if (!call) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Mascot mood="searching" size={140} />
          <Text style={[font.h3, { marginTop: space.md }]}>Connecting…</Text>
        </View>
      </Screen>
    );
  }

  const peer = call.kind === 'phone' ? formatPhone(call.peer.label) : call.kind === 'mirror' ? 'Translation test' : call.peer.label;
  const seconds = call.startedAt ? (now - call.startedAt) / 1000 : 0;
  const subtitle = ended ? reasonText(call.reason, peer)
    : call.state === 'dialing' ? 'Calling…'
    : call.state === 'ringing' ? 'Ringing…'
    : formatDuration(seconds);

  const mood: Mood = ended ? (call.reason === 'hangup' || call.reason === 'remote_hangup' ? 'happy' : 'sad')
    : call.state !== 'connected' ? 'curious'
    : level > 0.25 && !muted ? 'listening' : call.partial.them ? 'excited' : 'idle';

  const partials = [call.partial.me && { who: 'me' as const, text: call.partial.me }, call.partial.them && { who: 'them' as const, text: call.partial.them }].filter(Boolean) as { who: 'me' | 'them'; text: string }[];

  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingTop: space.md }}>
        <Mascot mood={mood} size={104} />
        <Text style={[font.h2, { marginTop: 4 }]} numberOfLines={1}>{peer}</Text>
        <Text style={{ color: ended ? colors.warn : colors.textDim, fontSize: 15, marginTop: 2, fontVariant: ['tabular-nums'] }}>{subtitle}</Text>
        {call.peer.language && call.kind !== 'mirror' ? <Text style={font.small}>Speaks {languageName(call.peer.language)}</Text> : null}
      </View>

      <View style={{ marginTop: space.md }}>
        <Banner icon={call.translationActive ? 'sparkles' : 'language'}>
          {call.translationActive
            ? 'AI is translating this call. The other person has been told.'
            : call.translate ? 'Same language on both sides, so no translation is needed.' : 'Translation is off. You hear the original audio.'}
        </Banner>
      </View>

      <FlatList
        ref={list}
        style={{ flex: 1, marginTop: space.md }}
        data={call.lines}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => <Bubble line={item} translating={call.translationActive} />}
        ListFooterComponent={
          <View>
            {partials.map((p) => (
              <View key={p.who} style={{ alignSelf: p.who === 'me' ? 'flex-end' : 'flex-start', maxWidth: '86%', marginBottom: 8, opacity: 0.6 }}>
                <Text style={{ color: colors.textDim, fontSize: 15, fontStyle: 'italic' }}>{p.text}…</Text>
              </View>
            ))}
            {call.notices.map((n, i) => <Text key={i} style={[font.small, { textAlign: 'center', marginVertical: 4 }]}>{n}</Text>)}
          </View>
        }
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={call.state === 'connected' ? <Text style={[font.dim, { textAlign: 'center', marginTop: space.lg }]}>Say something, captions will appear here.</Text> : undefined}
      />

      <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingVertical: space.lg }}>
        <View style={{ alignItems: 'center' }}>
          <IconButton icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} active={muted} onPress={() => useCall.getState().toggleMute()} size={64} />
          <Text style={[font.small, { marginTop: 6 }]}>{muted ? 'Unmute' : 'Mute'}</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <IconButton icon="call" label="End call" bg={colors.danger} size={76} onPress={() => (ended ? router.back() : useCall.getState().hangup())} style={{ transform: [{ rotate: '135deg' }] }} />
          <Text style={[font.small, { marginTop: 6 }]}>End</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <IconButton icon="language" label={call.translate ? 'Turn translation off' : 'Turn translation on'} active={call.translate} onPress={() => useCall.getState().setTranslate(!call.translate)} size={64} />
          <Text style={[font.small, { marginTop: 6 }]}>{call.translate ? 'Translate on' : 'Translate off'}</Text>
        </View>
      </View>
    </Screen>
  );
}
