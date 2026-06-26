import { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config — drives both iOS and Android shells.
 *
 * webDir points at the Nx build output. `cap sync` copies that
 * folder into the native projects, so before running it you must
 * `nx build lms --configuration=capacitor` (or use the
 * cap:sync npm script which does both).
 */
const config: CapacitorConfig = {
  appId: 'health.prefrontal.app',
  appName: 'Prefrontal',
  webDir: 'dist/apps/lms/browser',
  server: {
    androidScheme: 'https',
    // Domains the WKWebView / Android WebView is allowed to navigate
    // to. Add staging / prod backends here as they come online.
    allowNavigation: [
      'cottlnsbjnstsgknsgzu.supabase.co',
      'api.prefrontal.in',
      'localhost:5270'
    ]
  },
  plugins: {
    SplashScreen: {
      // The native splash is just the static "Prefrontal" logo image
      // copied from resident-fe. Keep it brief — the Angular app's
      // LoadingLogoComponent owns the live loading state once the web
      // shell mounts. 600ms is enough for the WKWebView to start the
      // Angular bootstrap without showing a flash of the OS background.
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#05030E',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1B3A6B'
    },
    Keyboard: {
      // 'native' resizes the whole WebView to the area above the keyboard, so
      // dvh/vh layouts shrink and a bottom-anchored composer sits ABOVE the
      // keyboard. ('body' only pads <body>, which does nothing against our
      // dvh-based shell — the composer stayed hidden behind the keyboard.)
      resize: 'native',
      style: 'dark',
      resizeOnFullScreen: true
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#2E86AB'
    },
    PushNotifications: {
      // When the app is in the foreground, show the system banner +
      // play the device sound so chat messages and incoming-call
      // pushes are visible/audible without having to leave the app.
      // (Background delivery is always handled by APNs/FCM.)
      presentationOptions: ['badge', 'sound', 'banner', 'list']
    }
  },
  ios: {
    // Dark native background so the status-bar / safe-area inset region shows
    // the app's dark colour instead of a white flash/bar — the WebView
    // background defaults to white, which was what showed as the white strip
    // once the keyboard used native resize.
    backgroundColor: '#0a0a15',
    // KEEP 'always': WKWebView insets content below the notch / Dynamic Island
    // (the app is laid out for this). 'never' pushed content up under the
    // status bar. With backgroundColor set, the inset region is dark, not white.
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: true
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
