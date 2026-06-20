import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.synchronize.app',
  appName: 'Synchronize',
  // Mobile bundle built with WEB_ASSET_BASE=/ (root-relative assets for the
  // WebView). Separate from web/dist (the daemon's /web/-based bundle).
  webDir: '../web/dist-mobile',
  android: {
    // App origin is https://localhost; cross-origin calls to the daemon rely on
    // daemon CORS (Phase 2) + Tailscale HTTPS (D5). No cleartext by default.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
