import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';
import { loadRuntimeConfig } from './environments/runtime-config';

// Web production: pull the per-server settings (/config.json) into `environment`
// BEFORE bootstrapping. Other builds skip this (environment.runtimeConfig is false).
loadRuntimeConfig(environment)
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
