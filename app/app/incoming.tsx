import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { languageName } from '../src/lib/languages';
import { useCall } from '../src/state/call';
import { Banner, IconButton, Screen } from '../src/ui/components';
import { Mascot } from '../src/ui/Mascot';
import { colors, font, space } from '../src/ui/theme';

export default function Incoming() {
  const router = useRouter();
  const incoming = useCall((s) => s.incoming);

  // Gone (caller hung up, or we answered): close this screen. The root layout opens /call for live calls.
  useEffect(() => {
    if (!incoming) router.back();
  }, [incoming]);

  if (!incoming) return <Screen><View /></Screen>;

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Mascot mood="excited" size={190} float />
        <Text style={[font.label, { marginTop: space.lg }]}>Incoming Parley call</Text>
        <Text style={[font.title, { marginTop: 6 }]}>@{incoming.from.username}</Text>
        <Text style={[font.dim, { marginTop: 4 }]}>Speaks {languageName(incoming.from.language)}</Text>
      </View>
      <View style={{ marginBottom: space.md }}>
        <Banner icon="sparkles">Calls between different languages are translated by AI. You can turn translation off during the call.</Banner>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', paddingBottom: space.xl }}>
        <View style={{ alignItems: 'center' }}>
          <IconButton icon="call" label="Decline" bg={colors.danger} size={76} style={{ transform: [{ rotate: '135deg' }] }} onPress={() => useCall.getState().decline()} />
          <Text style={[font.small, { marginTop: 8 }]}>Decline</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <IconButton icon="call" label="Accept" bg={colors.mint} color="#04281F" size={76} onPress={() => { void useCall.getState().accept(); }} />
          <Text style={[font.small, { marginTop: 8 }]}>Accept</Text>
        </View>
      </View>
    </Screen>
  );
}
