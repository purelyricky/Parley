/**
 * Strobi, the Parley mascot, from smontlouis/bible-strong-avatar-lab (AGPL-3.0-only).
 * Everything mascot-related lives in this file + assets/strobi.avatar.json so it can be swapped
 * for your own character without touching the rest of the app (see README → "Mascot & licence").
 */
import {
  advanceAvatarPlayback,
  playAvatarAnimation,
  renderAvatarFrame,
  type AvatarDefinition,
  type AvatarPlaybackState,
  type AvatarScene,
} from '@bible-strong/avatar-core';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, G, Path } from 'react-native-svg';

const definition = require('../../assets/strobi.avatar.json') as AvatarDefinition;

export type Mood =
  | 'idle' | 'listening' | 'thinking' | 'happy' | 'celebrate' | 'sleeping'
  | 'waking' | 'searching' | 'surprised' | 'sad' | 'curious' | 'confused' | 'excited' | 'playful';

const env = { random: Math.random, reduceMotion: false };
const FPS = 30;

interface Props {
  mood?: Mood;
  size?: number;
  /** Gently floats up and down. */
  float?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Mascot({ mood = 'idle', size = 160, float = false, style }: Props) {
  const stateRef = useRef<AvatarPlaybackState | null>(null);
  const [scene, setScene] = useState<AvatarScene | null>(null);
  const bob = useRef(new Animated.Value(0)).current;

  // (Re)start the animation whenever the mood changes, blending from the current frame.
  useEffect(() => {
    const now = Date.now();
    const started = playAvatarAnimation(definition, mood, now);
    if (started.ok) stateRef.current = started.value;
    else {
      const idle = playAvatarAnimation(definition, 'idle', now);
      if (idle.ok) stateRef.current = idle.value;
    }
    const tick = () => {
      const st = stateRef.current;
      if (!st) return;
      const t = Date.now();
      const next = advanceAvatarPlayback(definition, st, t, env);
      stateRef.current = next;
      setScene(renderAvatarFrame(definition, next, t, env));
    };
    tick();
    const id = setInterval(tick, 1000 / FPS);
    return () => clearInterval(id);
  }, [mood]);

  useEffect(() => {
    if (!float) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, bob]);

  const translateY = useMemo(() => bob.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.04] }), [bob, size]);
  const g = scene?.geometry;
  const colors = scene?.colors;

  return (
    <Animated.View style={[{ width: size, height: size, transform: [{ translateY }] }, style]} pointerEvents="none">
      <View style={{ flex: 1 }}>
        {g && colors ? (
          <Svg width={size} height={size} viewBox="-150 -150 300 300">
            <Defs>
              <ClipPath id="strobi-head">
                <Path d={g.headPath} />
              </ClipPath>
            </Defs>
            {g.backPaths.map((d, i) => <Path key={`b${i}`} d={d} fill={colors.body} />)}
            <Path d={g.headPath} fill={colors.body} />
            <G clipPath="url(#strobi-head)" fill={colors.eyes}>
              <Path d={g.leftPath} opacity={g.leftVisible ? 1 : 0} />
              <Path d={g.rightPath} opacity={g.rightVisible ? 1 : 0} />
            </G>
            {g.frontPaths.map((d, i) => <Path key={`f${i}`} d={d} fill={colors.body} />)}
          </Svg>
        ) : null}
      </View>
    </Animated.View>
  );
}
