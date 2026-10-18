export const colors = {
  bg: '#0B1020',
  bgSoft: '#111833',
  card: '#161E3D',
  cardHi: '#1D2750',
  border: 'rgba(255,255,255,0.08)',
  text: '#F4F6FF',
  textDim: '#A3ACCB',
  textFaint: '#6B7599',
  brand: '#5B7FE5',
  brandHi: '#7C99F2',
  mint: '#3DDBB0',
  danger: '#FF5D73',
  warn: '#FFB454',
  white: '#FFFFFF',
};

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const font = {
  title: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5, color: colors.text },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.2, color: colors.text },
  h3: { fontSize: 17, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 16, lineHeight: 23, color: colors.text },
  dim: { fontSize: 15, lineHeight: 22, color: colors.textDim },
  small: { fontSize: 13, color: colors.textDim },
  label: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const, color: colors.textFaint },
};
