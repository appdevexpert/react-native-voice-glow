// On the web, react-native-skia draws through CanvasKit (Skia compiled to
// WebAssembly), which has to load before the app renders. The .wasm file is
// served from /public (copied there by `npx setup-skia-web public`).
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { registerRootComponent } from 'expo';

LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(async () => {
  const { default: App } = await import('./App');
  registerRootComponent(App);
});
