import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { BuilderStatusService } from './builder-status.service';
import { fakeApi, openBuilder } from './builder-testing';

afterEach(() => TestBed.resetTestingModule());

describe('Builder status gate', () => {
  it('flag off: nothing is asked and nothing is available', async () => {
    const { api, status } = await openBuilder({ flag: false });
    expect(api.status).not.toHaveBeenCalled();
    expect(status.available()).toBe(false);
    expect(status.cortex()).toBe(false);
    expect(status.canChangeSwitch()).toBe(false);
  });

  it('flag on and the server answers: available; cortex follows status.cortex', async () => {
    const { status } = await openBuilder({ status: { cortex: false, connector: true, connectorSwitch: true, canChangeSwitch: false } });
    expect(status.available()).toBe(true);
    expect(status.cortex()).toBe(false);
    expect(status.canChangeSwitch()).toBe(false);
  });

  it('flag on but the status call fails (404 / offline): hidden', async () => {
    const { status } = await openBuilder({ status: null });
    expect(status.available()).toBe(false);
  });

  it('asks only once', async () => {
    const { api, status } = await openBuilder();
    await status.load();
    await status.load();
    expect(api.status).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(BuilderStatusService)).toBe(status);
    void fakeApi;
  });
});
