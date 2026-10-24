import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';
import { startWithRuntimeConfig } from './environments/runtime-config';

// Web production: pull the per-server settings (/config.json) into `environment`
// BEFORE bootstrapping. Other builds skip this (environment.runtimeConfig is false).
// On a host outside environment.fallbackHosts a failed /config.json blocks the app (message + retry)
// instead of silently talking to the baked-in DEV backend.
startWithRuntimeConfig(environment, () => bootstrapApplication(App, appConfig).catch((err) => console.error(err)));
