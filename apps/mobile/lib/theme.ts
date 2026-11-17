// The web design tokens (packages/ui/src/styles.css), for React Native. Calm and light: white
// panels with hairline borders, navy only for the main action and the active item.
export const color = {
  navy950: '#04266d',
  navy900: '#0b3586',
  navy700: '#2a4a8c',
  navy50: '#f1f5fc',
  paper: '#f6f8fb',
  surface: '#ffffff',
  ink: '#0e1b33',
  inkMuted: '#56637a',
  inkFaint: '#8a95a8',
  line: '#e4e9f0',
  lineStrong: '#cfd7e3',
  go: '#0b8a5a',
  goInk: '#0a6b46',
  goTint: '#e8f5ef',
  warn: '#c27803',
  warnInk: '#8a5300',
  warnTint: '#fdf4e3',
  stop: '#c4314b',
  stopInk: '#a3283e',
  stopTint: '#fcebee',
  white: '#ffffff',
} as const;

export const text = {
  caption: { fontSize: 13, lineHeight: 20 },
  body: { fontSize: 15, lineHeight: 24 },
  lead: { fontSize: 18, lineHeight: 26 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
};

export const radius = { sm: 6, md: 8, lg: 12 };
