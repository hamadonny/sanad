/**
 * Small UI kit. Direction-aware (layout follows the root `direction`; text alignment follows
 * the language), themed from @sanad/ui-tokens, accessible (labels, roles, dynamic type).
 */
import { useIsRestoring } from '@tanstack/react-query';
import { onlineManager } from '@tanstack/react-query';
import type { ApiMoney } from '@sanad/api-client';
import type { Fils } from '@sanad/core';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney, localizeDigits } from '../lib/format';
import { useDir } from '../lib/i18n';
import { useSettings } from '../lib/settings';
import { useTheme } from '../lib/theme';

// ── formatting hooks ──

export function useFormat() {
  const { language } = useDir();
  const arabicNumerals = useSettings((s) => s.arabicNumerals);
  const hijri = useSettings((s) => s.hijri);
  return {
    money: (v: ApiMoney | Fils | string, currency = true) =>
      formatMoney(v, { language, arabicNumerals, currency }),
    date: (d: string | null | undefined) =>
      d ? formatDate(d, { language, arabicNumerals, hijri }) : '—',
    num: (n: number | string) => localizeDigits(String(n), arabicNumerals),
  };
}

// ── text ──

type Variant = 'display' | 'title' | 'h2' | 'body' | 'muted' | 'small' | 'label' | 'money';

export function T({
  children,
  variant = 'body',
  color,
  center,
  style,
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  color?: string;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
  accessibilityLabel?: string;
  numberOfLines?: number;
}) {
  const { c, typography } = useTheme();
  const { textAlign, rtl } = useDir();
  const v: Record<Variant, TextStyle> = {
    display: {
      fontSize: typography.size.display,
      fontFamily: typography.fontFamily.bold,
      color: c.primary,
    },
    title: { fontSize: typography.size.xxl, fontFamily: typography.fontFamily.bold, color: c.text },
    h2: { fontSize: typography.size.lg, fontFamily: typography.fontFamily.bold, color: c.text },
    body: {
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.md,
      color: c.text,
      lineHeight: typography.size.md * typography.lineHeightMultiplier,
    },
    muted: {
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.sm,
      color: c.textMuted,
      lineHeight: typography.size.sm * typography.lineHeightMultiplier,
    },
    small: {
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.xs,
      color: c.textMuted,
    },
    label: {
      fontSize: typography.size.sm,
      fontFamily: typography.fontFamily.medium,
      color: c.textMuted,
    },
    money: {
      fontSize: typography.size.xl,
      fontFamily: typography.fontFamily.bold,
      color: c.text,
      fontVariant: ['tabular-nums'],
    },
  };
  return (
    <Text
      style={[
        v[variant],
        {
          // Native: 'auto' = the start side of the layout direction (right in Arabic). iOS treats
          // 'left'/'right' on Text as start/end inside an RTL layout, so a physical 'right'
          // ended up on the left. Web keeps the physical side.
          textAlign: center ? 'center' : Platform.OS === 'web' ? textAlign : 'auto',
          writingDirection: rtl ? 'rtl' : 'ltr',
        },
        color ? { color } : null,
        style,
      ]}
      maxFontSizeMultiplier={1.8}
      {...rest}
    >
      {children}
    </Text>
  );
}

/** Money with an accessible label (screen readers read the full amount and currency). */
export function Money({
  value,
  variant = 'money',
  color,
  testID,
}: {
  value: ApiMoney | Fils | string;
  variant?: Variant;
  color?: string;
  testID?: string;
}) {
  const f = useFormat();
  const text = f.money(value);
  return (
    <T
      variant={variant}
      accessibilityLabel={text}
      {...(color ? { color } : {})}
      {...(testID ? { testID } : {})}
    >
      {text}
    </T>
  );
}

// ── layout ──

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  padded?: boolean;
}) {
  const { c, spacing } = useTheme();
  const body = (
    <View
      style={{ gap: spacing.lg, padding: padded ? spacing.lg : 0, paddingBottom: spacing.xxxl }}
    >
      {children}
    </View>
  );
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.background }}
      edges={['bottom', 'left', 'right']}
    >
      <OfflineBanner />
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} />
            ) : undefined
          }
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer ? (
        <View
          style={{
            padding: spacing.lg,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            backgroundColor: c.surface,
          }}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function Row({
  children,
  gap = 8,
  justify = 'space-between',
  style,
}: {
  children: ReactNode;
  gap?: number;
  justify?: ViewStyle['justifyContent'];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: justify, gap }, style]}
    >
      {children}
    </View>
  );
}

export function Card({
  children,
  onPress,
  testID,
  accessibilityLabel,
  tone,
}: {
  children: ReactNode;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
  tone?: 'primary' | 'warning';
}) {
  const { c, spacing, radii } = useTheme();
  const style: ViewStyle = {
    backgroundColor: tone === 'primary' ? c.primarySoft : c.surface,
    borderColor: tone === 'warning' ? c.warning : c.border,
    borderWidth: tone === 'warning' ? 1.5 : StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  };
  if (!onPress)
    return (
      <View style={style} testID={testID}>
        {children}
      </View>
    );
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressable>
  );
}

export function KeyValue({
  label,
  value,
  strong,
  testID,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
  testID?: string;
}) {
  return (
    <Row>
      <T variant="muted" style={{ flexShrink: 1 }}>
        {label}
      </T>
      {typeof value === 'string' ? (
        <T variant={strong ? 'h2' : 'body'} {...(testID ? { testID } : {})}>
          {value}
        </T>
      ) : (
        value
      )}
    </Row>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

// ── controls ──

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  testID,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
}) {
  const { c, spacing, radii, typography } = useTheme();
  const bg = {
    primary: c.primary,
    secondary: c.primarySoft,
    danger: c.danger,
    ghost: 'transparent',
  }[variant];
  const fg = {
    primary: c.onPrimary,
    secondary: c.primaryText,
    danger: c.onDanger,
    ghost: c.primaryText,
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      testID={testID}
      style={({ pressed }) => ({
        backgroundColor: bg,
        opacity: off ? 0.5 : pressed ? 0.85 : 1,
        borderRadius: radii.md,
        paddingVertical: spacing.md + 2,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
        minHeight: 48,
        justifyContent: 'center',
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text
          style={{
            color: fg,
            fontSize: typography.size.md,
            fontFamily: typography.fontFamily.bold,
          }}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  style,
  ...props
}: TextInputProps & { label: string; error?: string | undefined }) {
  const { c, spacing, radii, typography } = useTheme();
  const { textAlign, rtl } = useDir();
  return (
    <View style={{ gap: spacing.xs }}>
      <T variant="label">{label}</T>
      <TextInput
        placeholderTextColor={c.textMuted}
        accessibilityLabel={label}
        style={[
          {
            borderWidth: 1,
            borderColor: error ? c.danger : c.border,
            backgroundColor: c.surface,
            borderRadius: radii.md,
            padding: spacing.md,
            fontSize: typography.size.md,
            fontFamily: typography.fontFamily.regular,
            color: c.text,
            textAlign,
            writingDirection: rtl ? 'rtl' : 'ltr',
            minHeight: 48,
          },
          style,
        ]}
        {...props}
      />
      {error ? (
        <T variant="small" color={c.danger}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  const { c, spacing, radii } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      testID={testID}
    >
      <Row>
        <T style={{ flexShrink: 1 }}>{label}</T>
        <View
          style={{
            width: 48,
            height: 28,
            borderRadius: radii.pill,
            backgroundColor: value ? c.primary : c.border,
            padding: 3,
            alignItems: value ? 'flex-end' : 'flex-start',
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: c.surface,
              marginHorizontal: spacing.xs / 4,
            }}
          />
        </View>
      </Row>
    </Pressable>
  );
}

export function Choice({
  title,
  body,
  selected,
  onPress,
  disabled,
  testID,
}: {
  title: string;
  body?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { c, spacing, radii } = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      testID={testID}
      style={{
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.primary : c.border,
        borderRadius: radii.lg,
        padding: spacing.lg,
        gap: spacing.xs,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: c.surface,
      }}
    >
      <T variant="h2">{title}</T>
      {body ? <T variant="muted">{body}</T> : null}
    </Pressable>
  );
}

// ── status ──

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'primary';
}) {
  const { c, radii, spacing } = useTheme();
  const { rtl } = useDir();
  const colorFor = {
    neutral: c.textMuted,
    good: c.success,
    warn: c.warning,
    bad: c.danger,
    primary: c.primary,
  }[tone];
  return (
    <View
      style={{
        borderColor: colorFor,
        borderWidth: 1,
        borderRadius: radii.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color: colorFor,
          fontSize: 12,
          fontFamily: 'ReadexPro_500Medium',
          writingDirection: rtl ? 'rtl' : 'ltr',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Banner({
  title,
  body,
  tone = 'primary',
  testID,
}: {
  title: string;
  body?: string;
  tone?: 'primary' | 'warning' | 'danger';
  testID?: string;
}) {
  const { c, spacing, radii } = useTheme();
  const bg = tone === 'primary' ? c.primary : tone === 'warning' ? c.warning : c.danger;
  const fg = tone === 'primary' ? c.onPrimary : c.onDanger;
  return (
    <View
      style={{ backgroundColor: bg, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.xs }}
      accessibilityRole="summary"
      {...(testID ? { testID } : {})}
    >
      <T variant="h2" color={fg}>
        {title}
      </T>
      {body ? <T color={fg}>{body}</T> : null}
    </View>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const { c, radii } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      {...(label ? { accessibilityLabel: label } : {})}
    >
      <View
        style={{
          height: 8,
          borderRadius: radii.pill,
          backgroundColor: c.border,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: c.primary }} />
      </View>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <T color={c.danger} accessibilityLabel={typeof children === 'string' ? children : undefined}>
      {children}
    </T>
  );
}

export function LoadingView() {
  const { t } = useTranslation();
  const { c } = useTheme();
  return (
    <View
      style={{ padding: 48, alignItems: 'center', gap: 12 }}
      accessibilityLabel={t('common.loading')}
    >
      <ActivityIndicator color={c.primary} />
      <T variant="muted">{t('common.loading')}</T>
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <T variant="h2">{errorMessage(t, error)}</T>
      {onRetry ? <Button title={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

export function EmptyView({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Card>
      <T variant="muted" center>
        {title}
      </T>
      {action && onAction ? <Button title={action} onPress={onAction} /> : null}
    </Card>
  );
}

function OfflineBanner() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [online, setOnline] = useState(onlineManager.isOnline());
  const restoring = useIsRestoring();
  useEffect(() => onlineManager.subscribe(setOnline), []);
  if (online || restoring) return null;
  return (
    <View style={{ backgroundColor: c.warning, padding: 8 }} accessibilityLiveRegion="polite">
      <Text
        style={{
          color: c.onDanger,
          textAlign: 'center',
          fontSize: 13,
          fontFamily: 'ReadexPro_500Medium',
        }}
      >
        {t('common.offline')}
      </Text>
    </View>
  );
}

// ── sheet ──

export function Sheet({
  visible,
  onClose,
  title,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { c, spacing, radii } = useTheme();
  const { dir } = useDir();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />
      <View
        style={{
          direction: dir,
          backgroundColor: c.surface,
          borderTopLeftRadius: radii.lg,
          borderTopRightRadius: radii.lg,
          padding: spacing.xl,
          gap: spacing.lg,
          paddingBottom: spacing.xxxl,
        }}
        accessibilityViewIsModal
        {...(testID ? { testID } : {})}
      >
        <T variant="h2">{title}</T>
        {children}
      </View>
    </Modal>
  );
}
