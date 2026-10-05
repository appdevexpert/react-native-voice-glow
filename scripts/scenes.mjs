// Test scenes shared by the parity render (scripts/render.mjs) and the
// reference render of the original web component (scripts/reference/).
//
// Every scene holds the time-driven motion still (no flow, no hue drift, no
// breathing, no band wobble), so once the envelope has settled the frame is
// deterministic and the two renders can be compared pixel by pixel. The
// distortion scenes keep the warp on: the reference records the noise
// drift at the instant it was captured (renders/web/meta.json) and the
// native render is painted at that same instant.

const STATIC = { flow: 0, staticColors: true, idle: 0, distortion: 0, bands: false };

export const DPR = 2;
export const SETTLE_SECONDS = 4;

export const scenes = [
  { name: 'dark-default-quiet', w: 360, h: 96, radius: 20, bg: '#1d1d1d', page: '#121212', level: 0.15, props: { theme: 'dark', ...STATIC }, static: true },
  { name: 'dark-default-speaking', w: 360, h: 96, radius: 20, bg: '#1d1d1d', page: '#121212', level: 0.6, props: { theme: 'dark', ...STATIC }, static: true },
  { name: 'dark-default-loud', w: 360, h: 96, radius: 20, bg: '#1d1d1d', page: '#121212', level: 1, props: { theme: 'dark', ...STATIC }, static: true },
  { name: 'light-default-speaking', w: 360, h: 96, radius: 20, bg: '#ffffff', page: '#f0f0f0', level: 0.7, props: { theme: 'light', ...STATIC }, static: true },
  { name: 'dark-mobile-speaking', w: 390, h: 300, radius: 44, bg: '#151515', page: '#0b0b0b', level: 0.8, props: { theme: 'dark', type: 'mobile', ...STATIC }, static: true },
  { name: 'dark-pill-speaking', w: 150, h: 44, radius: 22, bg: '#202020', page: '#121212', level: 0.8, props: { theme: 'dark', type: 'pill', ...STATIC }, static: true },
  { name: 'dark-ocean-speaking', w: 360, h: 96, radius: 20, bg: '#1d1d1d', page: '#121212', level: 0.7, props: { theme: 'dark', colorVariant: 'ocean', ...STATIC }, static: true },
  // With the distortion on.
  { name: 'dark-default-distortion', w: 360, h: 96, radius: 20, bg: '#1d1d1d', page: '#121212', level: 0.8, props: { theme: 'dark', flow: 0, staticColors: true, idle: 0, bands: false }, static: true },
  { name: 'dark-mobile-distortion', w: 390, h: 300, radius: 44, bg: '#151515', page: '#0b0b0b', level: 0.8, props: { theme: 'dark', type: 'mobile', flow: 0, staticColors: true, idle: 0, bands: false }, static: true },
];
