/**
 * @sanad/ui-tokens — design tokens shared by mobile and admin.
 *
 * Brand palette (founder, 2026-11-08): Cream #fffcf2 · Stone #ccc5b9 · Olive #403d39 ·
 * Ink #252422 · Flame #eb5e28. Apps reference semantic names only (e.g. `colors.light.primary`).
 *
 * Contrast (WCAG AA) rules baked in:
 * - Text on Flame fills is Ink (`onPrimary`): 4.55:1. White on Flame would be 3.3:1.
 * - Orange *text* uses `primaryText` (#b8461a on light, 5.2:1; #f39a74 on dark).
 */

export const palette = {
  cream: '#FFFCF2',
  stone: '#CCC5B9',
  olive: '#403D39',
  ink: '#252422',
  flame: '#EB5E28',
  // derived for states and accessible text
  flameDeep: '#B8461A',
  flamePressed: '#D4521F',
  flameSoft: '#FBE6DA',
  flameNight: '#F39A74',
  flameNightSoft: '#4A2F22',
  muted: '#5F5A53',
  white: '#FFFFFF',
  green: '#2F6B47',
  greenNight: '#7FC89A',
  amber: '#8A5A12',
  amberNight: '#E0A84A',
  red: '#A8321F',
  redNight: '#F08A7A',
} as const;

export const colors = {
  light: {
    background: palette.cream,
    surface: palette.white,
    text: palette.ink,
    textMuted: palette.muted,
    border: palette.stone,
    primary: palette.flame,
    primaryPressed: palette.flamePressed,
    primarySoft: palette.flameSoft,
    primaryText: palette.flameDeep,
    onPrimary: palette.ink,
    accent: palette.olive,
    success: palette.green,
    warning: palette.amber,
    danger: palette.red,
    onDanger: palette.white,
  },
  dark: {
    background: palette.ink,
    surface: palette.olive,
    text: palette.cream,
    textMuted: palette.stone,
    border: palette.muted,
    primary: palette.flame,
    primaryPressed: palette.flamePressed,
    primarySoft: palette.flameNightSoft,
    primaryText: palette.flameNight,
    onPrimary: palette.ink,
    accent: palette.stone,
    success: palette.greenNight,
    warning: palette.amberNight,
    danger: palette.redNight,
    onDanger: palette.ink,
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)['light'];

/** 4-pt spacing scale. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radii = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const typography = {
  /** Readex Pro: one family drawn for Arabic + Latin together (founder pick, 2026-11-08). */
  fontFamily: {
    regular: 'ReadexPro_400Regular',
    medium: 'ReadexPro_500Medium',
    bold: 'ReadexPro_700Bold',
    /** CSS stack for web (admin). */
    web: "'Readex Pro', 'Segoe UI', Tahoma, sans-serif",
  },
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, display: 36 },
  weight: { regular: '400', medium: '500', bold: '700' },
  lineHeightMultiplier: 1.5,
} as const;
