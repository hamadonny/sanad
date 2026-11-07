/**
 * @sanad/ui-tokens — design tokens shared by mobile and admin.
 *
 * [DECISION NEEDED] Brand colours are placeholders until the brand is finalised.
 * Keep raw values here only; apps reference semantic names (e.g. `colors.light.primary`).
 */

const palette = {
  teal700: '#0F5E5A',
  teal600: '#137A74',
  teal100: '#D7EFEC',
  gold500: '#C9A227',
  red600: '#C62828',
  amber600: '#B26A00',
  green600: '#2E7D32',
  gray950: '#0E1416',
  gray800: '#2A3336',
  gray600: '#5B676B',
  gray200: '#E3E8E9',
  gray50: '#F6F8F8',
  white: '#FFFFFF',
} as const;

export const colors = {
  light: {
    background: palette.gray50,
    surface: palette.white,
    text: palette.gray950,
    textMuted: palette.gray600,
    border: palette.gray200,
    primary: palette.teal700,
    primaryPressed: palette.teal600,
    primarySoft: palette.teal100,
    onPrimary: palette.white,
    accent: palette.gold500,
    success: palette.green600,
    warning: palette.amber600,
    danger: palette.red600,
  },
  dark: {
    background: palette.gray950,
    surface: palette.gray800,
    text: palette.gray50,
    textMuted: palette.gray200,
    border: palette.gray600,
    primary: palette.teal100,
    primaryPressed: palette.teal600,
    primarySoft: palette.teal700,
    onPrimary: palette.gray950,
    accent: palette.gold500,
    success: palette.green600,
    warning: palette.amber600,
    danger: palette.red600,
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)['light'];

/** 4-pt spacing scale. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radii = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const typography = {
  /** [DECISION NEEDED] Final fonts. Both families below support Arabic + Latin. */
  fontFamily: {
    arabic: 'IBM Plex Sans Arabic',
    latin: 'Inter',
  },
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, display: 36 },
  weight: { regular: '400', medium: '500', bold: '700' },
  lineHeightMultiplier: 1.5,
} as const;
