// One place for colour and spacing, matching the web app's dark/gold identity
// so a family moving between the site and the app recognises the same product.
export const theme = {
  bg: '#12100d',
  card: 'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.12)',
  text: '#f5f2ea',
  muted: '#a9a296',
  gold: '#d4af37',
  goldSoft: 'rgba(212,175,55,0.14)',
  danger: '#d98a8a',
  good: '#6bbf6b',
  radius: 10,
  space: (n: number) => n * 8,
} as const;
