import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import type { ReportStatus } from '../types';

export const colors = {
  background: '#F5F6F3',
  surface: '#FFFFFF',
  ink: '#192E2A',
  muted: '#65736D',
  primary: '#24664F',
  soft: '#E7F0E9',
  line: '#DEE5DF',
  danger: '#A53C32',
  warning: '#FFF1D6',
};
export const styles = StyleSheet.create({
  page: {
    padding: 20,
    gap: 20,
    paddingBottom: 36,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  title: { fontSize: 28, fontWeight: '700', color: colors.ink, letterSpacing: -0.7 },
  heading: { fontSize: 19, fontWeight: '700', color: colors.ink },
  body: { fontSize: 15, lineHeight: 23, color: colors.ink },
  muted: { fontSize: 13, lineHeight: 20, color: colors.muted },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  card: {
    backgroundColor: colors.surface,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    gap: 12,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 13,
    minHeight: 48,
    fontSize: 15,
    color: colors.ink,
  },
  divider: { height: 1, backgroundColor: colors.line },
});
export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  variant = 'primary',
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const primary = variant === 'primary';
  const foreground = primary ? '#FFFFFF' : variant === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 46,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 10,
          flexDirection: 'row',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: primary
            ? colors.primary
            : variant === 'secondary'
              ? colors.soft
              : 'transparent',
          opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={foreground} />}
      <Text style={{ color: foreground, fontSize: 14, fontWeight: '600', textAlign: 'center' }}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8B9790"
        {...props}
        style={[
          styles.input,
          props.multiline && { minHeight: 112, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      {hint && <Text style={[styles.muted, { marginTop: 6 }]}>{hint}</Text>}
    </View>
  );
}
export function Chips<T extends string>({
  values,
  value,
  onChange,
  label,
}: {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.row}>
        {values.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: value === item }}
            onPress={() => onChange(item)}
            style={({ pressed }) => ({
              borderRadius: 20,
              borderWidth: 1,
              borderColor: value === item ? colors.primary : colors.line,
              backgroundColor: value === item ? colors.soft : colors.surface,
              paddingVertical: 9,
              paddingHorizontal: 13,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                color: value === item ? colors.primary : colors.muted,
                fontWeight: value === item ? '600' : '400',
                fontSize: 13,
              }}
            >
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function StatusBadge({ status }: { status: ReportStatus }) {
  const palette =
    status === 'Resolved'
      ? [colors.soft, colors.primary]
      : status === 'In progress'
        ? ['#FFF1D6', '#805716']
        : ['#EBEFF4', '#526579'];
  return (
    <View
      style={{
        backgroundColor: palette[0],
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 5,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: palette[1], fontSize: 11, fontWeight: '600' }}>{status}</Text>
    </View>
  );
}
export function Notice({
  children,
  danger = false,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <View
      accessibilityRole={danger ? 'alert' : undefined}
      style={{ padding: 14, borderRadius: 10, backgroundColor: danger ? '#FCECE8' : colors.soft }}
    >
      <Text
        style={{ color: danger ? colors.danger : colors.primary, lineHeight: 21, fontSize: 13 }}
      >
        {children}
      </Text>
    </View>
  );
}
export function Empty({ title, description }: { title: string; description: string }) {
  return (
    <View style={[styles.card, { paddingVertical: 32, alignItems: 'center' }]}>
      <Text style={styles.heading}>{title}</Text>
      <Text style={[styles.muted, { textAlign: 'center' }]}>{description}</Text>
    </View>
  );
}
