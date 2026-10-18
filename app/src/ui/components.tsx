import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { LANGUAGES, type Language } from '../lib/languages';
import { colors, font, radius, space } from './theme';

export const tap = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); };
export const success = () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); };

/** Full-screen dark gradient with safe areas. */
export function Screen({ children, style, edges = ['top', 'bottom'] }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; edges?: ('top' | 'bottom')[];
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={['#141C42', colors.bg, colors.bg]} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={edges} style={[{ flex: 1, paddingHorizontal: space.lg }, style]}>{children}</SafeAreaView>
    </View>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint';

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, small }: {
  title: string; onPress?: () => void; variant?: BtnVariant; icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const off = disabled || loading;
  const bg = { primary: colors.brand, secondary: colors.card, ghost: 'transparent', danger: colors.danger, mint: colors.mint }[variant];
  const fg = variant === 'mint' ? '#04281F' : variant === 'ghost' ? colors.brandHi : colors.white;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={off}
      onPress={() => { tap(); onPress?.(); }}
      style={({ pressed }) => [
        styles.btn, small && { height: 44 },
        { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={20} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, icon, active, onPress, style }: {
  label: string; icon?: keyof typeof Ionicons.glyphMap; active?: boolean; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress ? () => { tap(); onPress(); } : undefined}
      style={[styles.chip, active && { backgroundColor: 'rgba(91,127,229,0.22)', borderColor: colors.brand }, style]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? colors.brandHi : colors.textDim} style={{ marginRight: 6 }} /> : null}
      <Text style={{ color: active ? colors.text : colors.textDim, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function SectionLabel({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[font.label, { marginBottom: space.sm, marginTop: space.lg }, style]}>{children}</Text>;
}

export function Field({ label, value, onChangeText, placeholder, prefix, error, hint, right, ...rest }: {
  label?: string; value: string; onChangeText: (s: string) => void; placeholder?: string; prefix?: string;
  error?: string | null; hint?: string | null; right?: React.ReactNode;
} & Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText' | 'placeholder'>) {
  return (
    <View style={{ marginBottom: space.md }}>
      {label ? <Text style={[font.label, { marginBottom: 6 }]}>{label}</Text> : null}
      <View style={[styles.field, error ? { borderColor: colors.danger } : null]}>
        {prefix ? <Text style={{ color: colors.textFaint, fontSize: 17, marginRight: 2 }}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.brand}
          style={{ flex: 1, color: colors.text, fontSize: 17, paddingVertical: 14 }}
          {...rest}
        />
        {right}
      </View>
      {error ? <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>{error}</Text>
        : hint ? <Text style={{ color: colors.textFaint, fontSize: 13, marginTop: 6 }}>{hint}</Text> : null}
    </View>
  );
}

export function LanguageButton({ code, onPress, label }: { code: string; onPress: () => void; label?: string }) {
  const l = LANGUAGES.find((x) => x.code === code);
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={styles.langBtn} accessibilityRole="button" accessibilityLabel={`Language: ${l?.name ?? code}`}>
      <Text style={{ fontSize: 26, marginRight: 12 }}>{l?.flag ?? '🌐'}</Text>
      <View style={{ flex: 1 }}>
        {label ? <Text style={font.label}>{label}</Text> : null}
        <Text style={font.h3}>{l?.name ?? 'Choose a language'}</Text>
        {l ? <Text style={font.small}>{l.native}</Text> : null}
      </View>
      <Ionicons name="chevron-down" size={20} color={colors.textDim} />
    </Pressable>
  );
}

export function LanguageSheet({ visible, selected, onSelect, onClose, title = 'Choose a language' }: {
  visible: boolean; selected?: string; onSelect: (code: string) => void; onClose: () => void; title?: string;
}) {
  const [q, setQ] = useState('');
  const insets = useSafeAreaInsets();
  const data = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? LANGUAGES.filter((l) => l.name.toLowerCase().includes(s) || l.native.toLowerCase().includes(s)) : [...LANGUAGES];
  }, [q]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.grabber} />
        <Text style={[font.h2, { marginBottom: space.md }]}>{title}</Text>
        <TextInput
          value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={colors.textFaint}
          style={styles.search} autoCorrect={false} selectionColor={colors.brand}
        />
        <FlatList
          data={data}
          keyExtractor={(l) => l.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }: { item: Language }) => (
            <Pressable
              onPress={() => { tap(); setQ(''); onSelect(item.code); }}
              style={[styles.langRow, item.code === selected && { backgroundColor: 'rgba(91,127,229,0.18)' }]}
            >
              <Text style={{ fontSize: 24, marginRight: 14 }}>{item.flag}</Text>
              <View style={{ flex: 1 }}>
                <Text style={font.h3}>{item.name}</Text>
                <Text style={font.small}>{item.native}</Text>
              </View>
              {item.code === selected ? <Ionicons name="checkmark-circle" size={22} color={colors.brandHi} /> : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

/** Round progress ring (for the recording timer). */
export function ProgressRing({ size, progress, stroke = 8, color = colors.mint, children }: {
  size: number; progress: number; stroke?: number; color?: string; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

/** Row of bars that follows a 0..1 level. */
export function LevelMeter({ level, bars = 21, height = 40, color = colors.mint }: { level: number; bars?: number; height?: number; color?: string }) {
  const mid = (bars - 1) / 2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height, gap: 4 }}>
      {Array.from({ length: bars }, (_, i) => {
        const shape = 1 - Math.abs(i - mid) / (mid + 1);
        const h = Math.max(4, height * Math.min(1, level * (0.35 + shape)));
        return <View key={i} style={{ width: 4, height: h, borderRadius: 2, backgroundColor: color, opacity: 0.35 + 0.65 * Math.min(1, level * 1.5) }} />;
      })}
    </View>
  );
}

export function Banner({ icon = 'sparkles', children, tone = 'info' }: {
  icon?: keyof typeof Ionicons.glyphMap; children: React.ReactNode; tone?: 'info' | 'error' | 'warn';
}) {
  const c = tone === 'error' ? colors.danger : tone === 'warn' ? colors.warn : colors.brandHi;
  return (
    <View style={[styles.banner, { borderColor: c + '55', backgroundColor: c + '1A' }]}>
      <Ionicons name={icon} size={18} color={c} style={{ marginRight: 10, marginTop: 1 }} />
      <Text style={{ flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function IconButton({ icon, onPress, label, size = 56, active, bg, color = colors.white, style }: {
  icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string; size?: number; active?: boolean;
  bg?: string; color?: string; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [{
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: bg ?? (active ? colors.white : 'rgba(255,255,255,0.12)'), opacity: pressed ? 0.8 : 1,
      }, style]}
    >
      <Ionicons name={icon} size={size * 0.45} color={active && !bg ? colors.bg : color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { height: 56, borderRadius: radius.pill, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 17, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border },
  chip: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  field: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16,
  },
  langBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: 14,
  },
  sheet: {
    backgroundColor: colors.bgSoft, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space.lg,
    paddingTop: 10, maxHeight: '80%', minHeight: '60%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 14 },
  search: { backgroundColor: colors.card, borderRadius: radius.md, color: colors.text, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, marginBottom: 8 },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.md },
  banner: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, borderRadius: radius.md, borderWidth: 1 },
});
