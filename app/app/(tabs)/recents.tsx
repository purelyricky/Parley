import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { formatDuration, timeAgo } from '../../src/lib/format';
import { formatPhone } from '../../src/lib/phone';
import { useRecents, type Recent } from '../../src/state/recents';
import { Button, Screen, tap } from '../../src/ui/components';
import { Mascot } from '../../src/ui/Mascot';
import { colors, font, space } from '../../src/ui/theme';

function title(r: Recent) {
  return r.kind === 'phone' ? formatPhone(r.target) : r.kind === 'user' ? `@${r.target}` : 'Translation test';
}

export default function Recents() {
  const router = useRouter();
  const items = useRecents((s) => s.items);

  function redial(r: Recent) {
    tap();
    router.navigate({ pathname: '/', params: { mode: r.kind, to: r.kind === 'mirror' ? '' : r.target, lang: r.kind === 'phone' ? r.language : '' } });
  }

  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: space.md }}>
        <Text style={[font.title, { flex: 1 }]}>Recents</Text>
        {items.length > 0 ? <Button title="Clear" variant="ghost" small onPress={() => useRecents.getState().clear()} /> : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingTop: space.md, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 }}>
            <Mascot mood="sleeping" size={120} />
            <Text style={[font.h3, { marginTop: space.md }]}>No calls yet</Text>
            <Text style={[font.dim, { textAlign: 'center', marginTop: 4 }]}>Your calls will show up here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => redial(item)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
              <Ionicons
                name={item.kind === 'phone' ? 'call' : item.kind === 'user' ? 'at' : 'flask'}
                size={20} color={item.missed ? colors.danger : colors.brandHi}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[font.h3, item.missed && { color: colors.danger }]}>{title(item)}</Text>
              <Text style={font.small}>
                {item.missed ? 'Missed' : item.direction === 'in' ? 'Incoming' : 'Outgoing'}
                {item.seconds > 0 ? ` · ${formatDuration(item.seconds)}` : ''} · {timeAgo(item.at)}
              </Text>
            </View>
            <Ionicons name="call-outline" size={22} color={colors.textDim} />
          </Pressable>
        )}
      />
    </Screen>
  );
}
