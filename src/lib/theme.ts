import { useColorScheme } from 'react-native';

const light = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  ink: '#1A1C1A',
  muted: '#6B6F6A',
  border: '#E4E1DA',
  accent: '#1F6F5C',
  accentSoft: '#E3EFEB',
  record: '#D9472F',
  warn: '#A15C07',
  warnSoft: '#FBEFD9',
  danger: '#B42318',
};

const dark: typeof light = {
  bg: '#121412',
  surface: '#1B1E1C',
  ink: '#ECEDEA',
  muted: '#9AA09B',
  border: '#2B2F2C',
  accent: '#5FC2A6',
  accentSoft: '#1D332D',
  record: '#F0674F',
  warn: '#F2B45A',
  warnSoft: '#3A2D15',
  danger: '#F97066',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 };
