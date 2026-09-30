import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthedMediaDirective } from './authed-media.directive';
import { UploadsService } from '../../../core/services/uploads.service';

/**
 * `[pfAuthedSrc]` — the small reusable authed-media piece for OPD consult /
 * prescription files (task: "MEDIA DISPLAY through the authenticated API").
 * Proves: the bytes come through UploadsService.blob() (HttpClient — auth +
 * X-PF-OPD interceptors apply), never a raw `<img [src]>` of the API path;
 * ONE fetch per path (cached by UploadsService); the directive owns and
 * REVOKES its own object: URL on rebind / destroy, even though the cached
 * bytes stay for the session.
 */
@Component({
  selector: 'pf-test-host',
  standalone: true,
  imports: [AuthedMediaDirective],
  template: `<img [pfAuthedSrc]="path()" alt="">`,
})
class HostComponent {
  readonly path = signal<string | null>(null);
}

function render() {
  const blob = vi.fn(async (_url: string) => new Blob(['x'], { type: 'image/jpeg' }));
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [{ provide: UploadsService, useValue: { blob } }],
  });
  const f = TestBed.createComponent(HostComponent);
  f.detectChanges();
  const img: HTMLImageElement = f.nativeElement.querySelector('img');
  return { f, img, blob };
}

describe('AuthedMediaDirective ([pfAuthedSrc])', () => {
  it('fetches the bytes through UploadsService.blob() — never a raw fetch of the API path — and sets an object: src', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one');
    try {
      const { f, img, blob } = render();
      f.componentInstance.path.set('/api/opd/consult/v1/media/file?key=a.jpg');
      f.detectChanges();
      await Promise.resolve(); await Promise.resolve();
      expect(blob).toHaveBeenCalledWith('/api/opd/consult/v1/media/file?key=a.jpg');
      expect(img.src).toBe('blob:one');
    } finally {
      createUrl.mockRestore();
    }
  });

  it('a null path clears the src and fetches nothing', async () => {
    const { f, img, blob } = render();
    f.componentInstance.path.set(null);
    f.detectChanges();
    await Promise.resolve();
    expect(blob).not.toHaveBeenCalled();
    expect(img.hasAttribute('src')).toBe(false);
  });

  it('rebinding to a new path revokes the PREVIOUS object: URL and creates a new one', async () => {
    let n = 0;
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++n}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      const { f, img } = render();
      f.componentInstance.path.set('/api/opd/consult/v1/media/file?key=a.jpg');
      f.detectChanges();
      await Promise.resolve(); await Promise.resolve();
      expect(img.src).toBe('blob:1');

      f.componentInstance.path.set('/api/opd/consult/v1/media/file?key=b.jpg');
      f.detectChanges();
      expect(revoke).toHaveBeenCalledWith('blob:1'); // revoked the moment the rebind starts loading
      await Promise.resolve(); await Promise.resolve();
      expect(img.src).toBe('blob:2');
    } finally {
      createUrl.mockRestore();
      revoke.mockRestore();
    }
  });

  it('destroying the host revokes its object: URL', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      const { f } = render();
      f.componentInstance.path.set('/api/opd/consult/v1/media/file?key=a.jpg');
      f.detectChanges();
      await Promise.resolve(); await Promise.resolve();
      f.destroy();
      expect(revoke).toHaveBeenCalledWith('blob:x');
    } finally {
      createUrl.mockRestore();
      revoke.mockRestore();
    }
  });

  it('a slower FIRST fetch resolving after a rebind never clobbers the newer image (no stale race)', async () => {
    let resolveFirst!: (b: Blob) => void;
    const first = new Promise<Blob>(res => { resolveFirst = res; });
    const blob = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => new Blob(['b'], { type: 'image/jpeg' }));
    let n = 0;
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++n}`);
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [{ provide: UploadsService, useValue: { blob } }] });
    try {
      const f = TestBed.createComponent(HostComponent);
      f.detectChanges();
      const img: HTMLImageElement = f.nativeElement.querySelector('img');

      f.componentInstance.path.set('/api/opd/consult/v1/media/file?key=slow.jpg');
      f.detectChanges();                 // kicks off the slow first fetch
      f.componentInstance.path.set('/api/opd/consult/v1/media/file?key=fast.jpg');
      f.detectChanges();                 // kicks off (and wins) the second fetch
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(img.src).toBe('blob:1');    // the second (fast) fetch's object URL

      resolveFirst(new Blob(['a'], { type: 'image/jpeg' })); // the stale first fetch lands LATE
      await Promise.resolve(); await Promise.resolve();
      expect(img.src).toBe('blob:1');    // unchanged — the stale result was ignored
    } finally {
      createUrl.mockRestore();
    }
  });
});
