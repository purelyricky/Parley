import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { tap } from './components';
import { colors } from './theme';

const SUBS: Record<string, string> = { '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ', '0': '+' };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '<'];

export function Keypad({ onKey, onBackspace, onClear }: { onKey: (k: string) => void; onBackspace: () => void; onClear?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
      {KEYS.map((k) => (
        <View key={k} style={{ width: '33.33%', alignItems: 'center', paddingVertical: 5 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={k === '<' ? 'Delete' : k === '+' ? 'Plus' : k}
            onPress={() => { tap(); k === '<' ? onBackspace() : onKey(k); }}
            onLongPress={k === '<' ? onClear : k === '0' ? () => onKey('+') : undefined}
            style={({ pressed }) => ({
              width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center',
              backgroundColor: k === '<' ? 'transparent' : pressed ? colors.cardHi : colors.card,
            })}
          >
            {k === '<' ? <Ionicons name="backspace-outline" size={26} color={colors.textDim} /> : (
              <>
                <Text style={{ color: colors.text, fontSize: 28, fontWeight: '500' }}>{k}</Text>
                {SUBS[k] && k !== '+' ? <Text style={{ color: colors.textFaint, fontSize: 9, letterSpacing: 1.5, marginTop: -2 }}>{SUBS[k]}</Text> : null}
              </>
            )}
          </Pressable>
        </View>
      ))}
    </View>
  );
}
