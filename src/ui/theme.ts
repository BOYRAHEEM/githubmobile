import { Platform } from 'react-native';

export { colors } from './palette';

export const space = (n: number) => n * 4;

export const radius = { sm: 6, md: 10, lg: 14 };

export const mono = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });
