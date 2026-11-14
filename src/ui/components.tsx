import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, ViewStyle, type ScrollViewInstance } from 'react-native';
import type { RunPhase } from '../state/RunnerContext';
import { colors, mono, radius, space } from './theme';

// ------------------------------------------------------------------ Button

type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }: ButtonProps) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>}
    </Pressable>
  );
}

const buttonVariants = {
  primary: { bg: colors.accent, fg: colors.accentInk, border: colors.accent },
  secondary: { bg: colors.surfaceAlt, fg: colors.text, border: colors.border },
  danger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.muted, border: 'transparent' },
};

// -------------------------------------------------------------------- Card

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// -------------------------------------------------------------------- Chip

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { borderColor: colors.accent, backgroundColor: '#0F2A20' }]}>
      <Text style={[styles.chipText, active && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------ Phase badge

const PHASES: Record<RunPhase, { label: string; color: string; busy?: boolean }> = {
  idle: { label: 'Not running', color: colors.muted },
  'installing-runtime': { label: 'Installing runtime', color: colors.warn, busy: true },
  'installing-deps': { label: 'Installing packages', color: colors.warn, busy: true },
  starting: { label: 'Starting', color: colors.info, busy: true },
  running: { label: 'Running', color: colors.accent },
  stopped: { label: 'Stopped', color: colors.muted },
  failed: { label: 'Failed', color: colors.danger },
};

export const isBusy = (p: RunPhase) => !!PHASES[p].busy || p === 'running';

export function PhaseBadge({ phase }: { phase: RunPhase }) {
  const p = PHASES[phase];
  return (
    <View style={styles.badge}>
      {p.busy ? <ActivityIndicator size="small" color={p.color} /> : <View style={[styles.dot, { backgroundColor: p.color }]} />}
      <Text style={[styles.badgeText, { color: p.color }]}>{p.label}</Text>
    </View>
  );
}

// ----------------------------------------------------------------- LogView

/** Scrolling monospace output that sticks to the bottom as text arrives. */
export function LogView({ text, placeholder, style }: { text: string; placeholder?: string; style?: ViewStyle }) {
  const ref = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    ref.current?.scrollToEnd({ animated: false });
  }, [text]);

  // Rendering huge strings is slow; the full log stays in state.
  const visible = text.length > 30_000 ? '…\n' + text.slice(-30_000) : text;

  return (
    <ScrollView ref={ref} style={[styles.log, style]} contentContainerStyle={{ padding: space(3) }}>
      <Text selectable style={styles.logText}>
        {visible || <Text style={{ color: colors.muted }}>{placeholder ?? 'No output yet.'}</Text>}
      </Text>
    </ScrollView>
  );
}

// ------------------------------------------------------------------- Label

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: space(4),
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(4),
  },
  chip: {
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 13, fontWeight: '600' },
  log: { backgroundColor: '#070A0E', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  logText: { color: '#C9D4DE', fontFamily: mono, fontSize: 12, lineHeight: 17 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
});
