import { colors, radii, spacing, typography } from '@sanad/ui-tokens';
import { useColorScheme } from 'react-native';

export function useTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { c: colors[scheme], scheme, spacing, radii, typography };
}

export type Theme = ReturnType<typeof useTheme>;
