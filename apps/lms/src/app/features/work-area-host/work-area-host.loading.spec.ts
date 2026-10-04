import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { WorkAreaHostComponent } from './work-area-host.component';
import { AuthService } from '../../core/auth/auth.service';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { PageOpenService } from '../../core/navigation/page-open.service';
import { SkeletonCardComponent } from '../../shared/primitives/skeleton-kit.component';

/**
 * /w/:menuId first open: while the area's panels resolve (lazy code) the
 * host shows its skeleton — never "No actions you can access" first.
 */
describe('WorkAreaHostComponent — first-load skeleton', () => {
  function render(actions: { type: string }[]) {
    const active = signal({
      categories: [{ id: 'm1', name: 'Front', color: '#7c3aed' }],
      actions: actions.map((a, i) => ({ ...a, categoryId: 'm1', enabled: true, order: i, label: '' })),
    });
    TestBed.configureTestingModule({
      imports: [WorkAreaHostComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ menuId: 'm1' })) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: PageOpenService, useValue: { markSource: vi.fn() } },
        { provide: AuthService, useValue: { permissions: () => ['*'], hasAnyPermission: () => true } },
        { provide: ProcessWorkflowService, useValue: { active, loadActive: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(WorkAreaHostComponent, {
      set: { imports: [SkeletonCardComponent, NgComponentOutlet], schemas: [NO_ERRORS_SCHEMA] },
    });
    const f = TestBed.createComponent(WorkAreaHostComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('first frame: skeleton, not the empty message; then the launchers', async () => {
    const { f, el } = render([{ type: 'messages' }]);
    expect(el.querySelector('pf-skeleton-card')).not.toBeNull();
    expect(el.textContent).not.toContain('No actions you can access');
    await new Promise(r => setTimeout(r, 0));             // the panels resolve
    await f.whenStable();
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-card')).toBeNull();
    expect(el.querySelector('.wah-launch')?.textContent).toContain('Open Messages');
  });

  it('an area with nothing for this user says so (after its config is in)', async () => {
    const { f, el } = render([]);
    await new Promise(r => setTimeout(r, 0));             // the panels resolve
    await f.whenStable();
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-card')).toBeNull();
    expect(el.textContent).toContain('No actions you can access in this area.');
  });
});
