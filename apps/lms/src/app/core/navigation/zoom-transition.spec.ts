import { vi } from 'vitest';
import { slideDirection } from './slide-transition';
import { SAMPLE_VT_ATTR, _resetZoomMemory, runZoom, sampleVtName, tileFor, zoomDirection } from './zoom-transition';

/** A ViewTransition stand-in whose phases we resolve by hand. */
function fakeTransition() {
  let doneUpdate!: () => void, ready!: () => void, finish!: () => void;
  const transition = {
    updateCallbackDone: new Promise<void>(r => (doneUpdate = r)),
    ready: new Promise<void>(r => (ready = r)),
    finished: new Promise<void>(r => (finish = r)),
    skipTransition: vi.fn(),
  };
  return { info: { transition } as any, doneUpdate, ready, finish };
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('zoomDirection (queue tile → result entry)', () => {
  it('My Work → /lab/sample/:id zooms IN (query strings ignored)', () => {
    expect(zoomDirection('/lab/my-work', '/lab/sample/abc')).toEqual({ dir: 'in', sampleId: 'abc' });
    expect(zoomDirection('/lab/my-work?tab=service_queue', '/lab/sample/abc?view=1')).toEqual({ dir: 'in', sampleId: 'abc' });
  });
  it('result entry → My Work zooms OUT (back, submit, save draft)', () => {
    expect(zoomDirection('/lab/sample/abc', '/lab/my-work')).toEqual({ dir: 'out', sampleId: 'abc' });
  });
  it('everything else is not a zoom (sibling tube, other screens)', () => {
    expect(zoomDirection('/lab/sample/a', '/lab/sample/b')).toBeNull();
    expect(zoomDirection('/pathologist', '/lab/sample/a')).toBeNull();
    expect(zoomDirection('/lab/sample/a', '/pathologist')).toBeNull();
    expect(zoomDirection('/frontdesk', '/lab/collect')).toBeNull();
  });
  it('the zoom and the step slide never claim the same navigation', () => {
    expect(slideDirection('/lab/my-work', '/lab/sample/abc')).toBeNull();
    expect(slideDirection('/lab/sample/abc', '/lab/my-work')).toBeNull();
  });
});

describe('sampleVtName', () => {
  it('is sample-<id>, a valid CSS ident, null without an id', () => {
    expect(sampleVtName('3f2a-9c')).toBe('sample-3f2a-9c');
    expect(sampleVtName('a b/c')).toBe('sample-a_b_c');
    expect(sampleVtName(null)).toBeNull();
    expect(sampleVtName('')).toBeNull();
  });
});

describe('runZoom', () => {
  let tile: HTMLElement;
  beforeEach(() => {
    _resetZoomMemory();
    tile = document.createElement('div');
    tile.setAttribute(SAMPLE_VT_ATTR, 's1');
    document.body.appendChild(tile);
  });
  afterEach(() => { tile.remove(); document.documentElement.className = ''; });

  it('IN: names ONLY the tapped tile for the transition, then clears it', async () => {
    const other = document.createElement('div');
    other.setAttribute(SAMPLE_VT_ATTR, 's2');
    document.body.appendChild(other);
    const { info, finish } = fakeTransition();
    expect(runZoom(info, { dir: 'in', sampleId: 's1' })).toBe(true);
    expect(tile.style.getPropertyValue('view-transition-name')).toBe('sample-s1');
    expect(other.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.classList).toContain('pf-vt-zoom-in');
    finish();
    await flush();
    expect(tile.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.classList).not.toContain('pf-vt-zoom-in');
    other.remove();
  });

  it('IN without a tile on screen declines (the caller swaps instantly)', () => {
    const { info } = fakeTransition();
    expect(runZoom(info, { dir: 'in', sampleId: 'nope' })).toBe(false);
    expect(document.documentElement.classList).not.toContain('pf-vt-zoom-in');
  });

  it('OUT: names the tile in the NEW state (after the DOM update) and reverses', async () => {
    tile.remove();
    const { info, doneUpdate, finish } = fakeTransition();
    expect(runZoom(info, { dir: 'out', sampleId: 's1' })).toBe(true);
    expect(document.documentElement.classList).toContain('pf-vt-zoom-out');
    document.body.appendChild(tile);   // My Work rendered the tile
    doneUpdate();
    await flush();
    expect(tile.style.getPropertyValue('view-transition-name')).toBe('sample-s1');
    finish();
    await flush();
    expect(tile.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.classList).not.toContain('pf-vt-zoom-out');
  });

  it('tileFor finds the marker attribute', () => {
    expect(tileFor(document, 's1')).toBe(tile);
    expect(tileFor(document, 'zzz')).toBeNull();
  });
});
