import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Uploads are private (the API refuses an unsigned /uploads/* GET), so a
 * tenant logo stored as "/uploads/…" must never be bound straight into an
 * <img src>. Every surface that shows the tenant logo resolves it through
 * brandingSrc (UploadsService: session blob: URL; data:/absolute pass through).
 * The band's rendering is covered in hero-band.component.spec.ts; the bars are
 * too dependency-heavy to mount, so this guards their sources.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), 'apps/lms/src/app', p), 'utf8');

const SURFACES: { file: string; html?: string }[] = [
  { file: 'layout/top-strip/top-strip.component.ts', html: 'layout/top-strip/top-strip.component.html' },
  { file: 'layout/bottom-nav/bottom-nav.component.ts', html: 'layout/bottom-nav/bottom-nav.component.html' },
  { file: 'shared/components/hero-band/hero-band.component.ts' },
  { file: 'features/admin/setup-wizard/setup-wizard.component.ts' },
];

describe('tenant logo surfaces — private uploads', () => {
  for (const s of SURFACES) {
    it(`${s.file}: the logo goes through brandingSrc`, () => {
      const ts = read(s.file);
      expect(ts).toMatch(/brandingSrc\(this\.injector,/);
      // No raw `logoUrl || null` fed to a template any more.
      expect(ts).not.toMatch(/tenant\(\)\?\.logoUrl \|\| null/);
      const tpl = ts + (s.html ? read(s.html) : '');
      // No <img [src]="…logoUrl…"> binding of the stored value.
      expect(tpl).not.toMatch(/\[src\]="[^"]*logoUrl[^"]*"/);
    });
  }
});
