import { Platform } from 'react-native';

export const C = {
  bg: '#05070D',
  panel: '#0A0F1A',
  panel2: '#111827',
  line: 'rgba(143,155,194,0.18)',
  text: '#FFFFFF',
  sub: '#C9D2EC',
  muted: '#8F9BC2',
  cyan: '#7FE9FE',
  green: '#2BE38B',
  red: '#FF5C66',
  amber: '#FFB547',
  violet: '#B79CFF',
  glass: 'rgba(12,17,27,0.72)',
  scrim: 'rgba(3,5,9,0.64)',
};

// one colour per kind of entry, the same as on the website (Out red, In green, Return amber)
export const TYPES = {
  OUT: { label: 'Stock Out', short: 'Out', sign: '−', color: C.red, hint: 'Every scan takes 1 out of stock' },
  IN: { label: 'Stock In', short: 'In', sign: '+', color: C.green, hint: 'Every scan puts 1 back into stock' },
  RETURN: { label: 'Return', short: 'Return', sign: '+', color: C.amber, hint: 'Every scan books 1 customer return' },
};

export const MONO = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });
