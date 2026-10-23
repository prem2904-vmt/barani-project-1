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
      // Dev
      'cottlnsbjnstsgknsgzu.supabase.co',
      'med-dev.prefrontal.health',
      'med-fetch-dev.prefrontal.health',
      'localhost:5270',
      // Stage — the default native builds (cap:sync / electron:build) now
      // ship the *-stage configuration, so these are the live backends.
      'gxmbbjmcfuxqzdfczrma.supabase.co',
      'med-stg.prefrontal.health',
      'med-fetch-stg.prefrontal.health',
      // Prod — cap:sync:prod / electron:build:*:prod
      'hslcncwhgqezbqkdowyy.supabase.co',
      'med.prefrontal.health',
      'med-fetch.prefrontal.health'
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
      // Launch-only default (the dark splash is up): light text on the dark
      // splash colour. Once the web app boots, ThemeService (system-bars.ts)
      // restyles the status bar — and on Android the navigation bar — to the
      // ACTIVE theme on every change, system-scheme flip and resume.
      style: 'DARK',
      backgroundColor: '#0a0a15'
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
      // Must be a real drawable in android/app/src/main/res/drawable — a
      // missing resource falls back to the launcher icon, which renders as
      // a white square on API 26+. ic_stat_notify is the monochrome flask.
      smallIcon: 'ic_stat_notify',
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
    // 'never': WKWebView must NOT add its own safe-area content inset, because
    // our CSS already owns the inset (html.cap-native padding-top:
    // max(env(safe-area-inset-top), 50px)). With BOTH on ('always' + the CSS
    // pad) the top inset was double-counted intermittently — env() reports 0 on
    // the first paint then flips to the real value, so the gap would sometimes
    // come out ~2x and only correct itself on an app relaunch. The 50px CSS
    // floor (which didn't exist when 'never' was first tried) now prevents the
    // header from sliding under the status bar before env() reports, so 'never'
    // is safe and makes the inset deterministic — one source of truth.
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: true
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // capacitor-plugin-callkit-voip is iOS-only (CallKit) and its 2021-era
    // Android module fails the AGP manifest merge (a service with an
    // intent-filter but no android:exported, illegal on Android 12+). Exclude
    // it from the Android build; Android call alerts arrive via FCM push.
    includePlugins: [
      '@capacitor/app',
      '@capacitor/camera',
      '@capacitor/haptics',
      '@capacitor/keyboard',
      '@capacitor/local-notifications',
      '@capacitor/network',
      '@capacitor/push-notifications',
      '@capacitor/splash-screen',
      '@capacitor/status-bar'
    ]
  }
};

export default config;
