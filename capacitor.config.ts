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
  appId: 'in.prefrontal.lms',
  appName: 'Prefrontal LMS',
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
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1B3A6B',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1B3A6B'
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#2E86AB'
    }
  },
  ios: {
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
