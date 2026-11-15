import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { PfSelectOption, SelectComponent } from '../../shared/primitives/select.component';
import { FilesAccessService } from './files-access.service';
import { filesAppForKind } from './files-registry';
import { OfficeFile, OfficeService, OfficeShare, OfficeShareList, OfficeShareTarget, toApiError } from './office.service';

/** The file's own in-app address: needs a Prefrontal sign-in AND access to the file. There are no public links. */
export const shareLink = (origin: string, f: Pick<OfficeFile, 'id' | 'kind'>): string => `${origin}/files/${filesAppForKind(f.kind)?.route ?? f.kind}/${f.id}`;

const ACCESS: PfSelectOption<string>[] = [{ value: 'view', label: 'Can view' }, { value: 'edit', label: 'Can edit' }];

/**
 * Share a file with people or roles of the SAME lab: Can view / Can edit, who has access (owner first), remove, copy link (sign-in required).
 * The server decides everything (only the owner or an admin changes access; "edit" only if the sharer may edit; never across labs); this only
 * shows it. Same in all five apps. Opened from the editor band and from a Files row.
 */
@Component({
  selector: 'pf-files-share',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (file(); as f) {
      <div class="fsh-backdrop" (click)="closed.emit()" aria-hidden="true"></div>
      <div class="fsh pf-card" role="dialog" aria-modal="true" [attr.aria-label]="'Share ' + f.name" data-testid="files-share" (keydown.escape)="closed.emit()">
        <header class="fsh-head">
          <h2 class="fsh-title">Share "{{ f.name }}"</h2>
          <button type="button" class="pf-btn pf-btn--icon" aria-label="Close" title="Close" (click)="closed.emit()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        @if (canManage()) {
          <div class="fsh-add">
            <pf-select class="fsh-who" [options]="targetOptions()" [searchable]="true" [value]="pick()" placeholder="Add people or roles in your lab" aria-label="Add people or roles"
                       (valueChange)="pick.set($event)"></pf-select>
            <pf-select class="fsh-acc" [options]="accessOptions()" [value]="level()" aria-label="Access" (valueChange)="level.set($event)"></pf-select>
            <button type="button" class="pf-btn pf-btn--primary" data-testid="files-share-add" [disabled]="!pick() || busy()" (click)="add()">Add</button>
          </div>
        }
        <p class="fsh-lbl">Who has access</p>
        @if (loading()) {
          <p class="fsh-note" role="status">Loading…</p>
        } @else if (error()) {
          <p class="fsh-err" role="alert" data-testid="files-share-error">{{ error() }}</p>
        } @else if (list(); as l) {
          <ul class="fsh-list" data-testid="files-share-list">
            <li class="fsh-row" data-testid="files-share-owner">
              <span class="fsh-av" aria-hidden="true">{{ initials(l.ownerName) }}</span>
              <span class="fsh-who-t"><span class="fsh-name">{{ l.ownerName || 'The lab' }}{{ l.isOwner ? ' (you)' : '' }}</span></span>
              <span class="fsh-fixed">Owner</span>
            </li>
            @for (s of l.shares; track s.id) {
              <li class="fsh-row" [attr.data-testid]="'files-share-row'">
                <span class="fsh-av" [class.fsh-av--role]="s.principalType === 'role'" aria-hidden="true">{{ initials(s.name) }}</span>
                <span class="fsh-who-t"><span class="fsh-name">{{ s.name }}</span>@if (s.detail) { <span class="fsh-sub">{{ s.detail }}</span> }</span>
                @if (l.canManage) {
                  <pf-select class="fsh-acc" [options]="accessOptions()" [value]="s.access" size="sm" [attr.aria-label]="'Access for ' + s.name" (valueChange)="change(s, $event)"></pf-select>
                  <button type="button" class="pf-btn pf-btn--tertiary" [attr.aria-label]="'Remove ' + s.name" data-testid="files-share-remove" (click)="remove(s)">Remove</button>
                } @else {
                  <span class="fsh-fixed">{{ s.access === 'edit' ? 'Can edit' : 'Can view' }}</span>
                }
              </li>
            }
          </ul>
        }
        <div class="fsh-link">
          <p class="fsh-note">Link works only for people in {{ lab() }} who sign in</p>
          <button type="button" class="pf-btn pf-btn--secondary" data-testid="files-share-copy" (click)="copy()">Copy link</button>
        </div>
        <p class="fsh-foot">There are no public links.{{ f.containsPhi ? ' Files with patient data can only be shared inside the lab.' : '' }}</p>
        <footer class="fsh-actions"><button type="button" class="pf-btn pf-btn--primary" data-testid="files-share-done" (click)="closed.emit()">Done</button></footer>
      </div>
    }
  `,
  styles: [`
    .fsh-backdrop { position: fixed; inset: 0; z-index: 2400; background: rgba(0,0,0,.4); }
    .fsh { position: fixed; z-index: 2401; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(520px, calc(100vw - 24px)); max-height: calc(100vh - 32px); overflow: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
    .fsh-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .fsh-title { margin: 0; font-size: 17px; font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
    .fsh-add { display: grid; grid-template-columns: minmax(0, 1fr) 130px auto; gap: 8px; align-items: center; }
    .fsh-lbl { margin: 4px 0 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
    .fsh-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .fsh-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--card-border, rgba(0,0,0,.08)); }
    .fsh-row:first-child { border-top: 0; }
    .fsh-av { flex: none; width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; background: var(--violet-500, #7c3aed); }
    .fsh-av--role { border-radius: 9px; background: color-mix(in srgb, var(--text-primary) 55%, transparent); }
    .fsh-who-t { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
    .fsh-name { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .fsh-sub { font-size: 12px; color: var(--text-tertiary); }
    .fsh-fixed { font-size: 13px; color: var(--text-tertiary); white-space: nowrap; }
    .fsh .fsh-acc { min-width: 120px; }
    .fsh-link { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--violet-500, #7c3aed) 7%, transparent); }
    .fsh-note { margin: 0; font-size: 13px; color: var(--text-secondary); }
    .fsh-err { margin: 0; font-size: 13px; color: var(--text-primary); border-left: 3px solid var(--color-danger, #dc2626); padding: 6px 10px; }
    .fsh-foot { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .fsh-actions { display: flex; justify-content: flex-end; }
    @media (max-width: 560px) { .fsh-add { grid-template-columns: 1fr; } .fsh-row { flex-wrap: wrap; } }
  `],
})
export class FilesShareDialogComponent {
  readonly file = input<OfficeFile | null>(null);
  readonly closed = output<void>();
  private readonly office = inject(OfficeService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly files = inject(FilesAccessService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly list = signal<OfficeShareList | null>(null);
  private readonly targets = signal<OfficeShareTarget[]>([]);
  protected readonly pick = signal('');
  protected readonly level = signal<string>('view');
  protected readonly busy = signal(false);
  protected readonly lab = computed(() => this.auth.user()?.tenantName || 'your lab');
  protected readonly canManage = computed(() => this.list()?.canManage ?? false);
  /** "Can edit" is offered only when the sharer can edit this app's files themselves (the server checks again). */
  protected readonly accessOptions = computed<PfSelectOption<string>[]>(() => {
    const f = this.file();
    const app = f ? filesAppForKind(f.kind) : undefined;
    const canEdit = !!app && this.files.canWrite(app);
    return ACCESS.map(a => (a.value === 'edit' && !canEdit ? { ...a, disabled: true } : a));
  });
  protected readonly targetOptions = computed<PfSelectOption<string>[]>(() => {
    const have = new Set((this.list()?.shares ?? []).map(s => `${s.principalType}:${s.principalId}`));
    return this.targets().filter(t => !have.has(`${t.type}:${t.id}`)).map(t => ({ value: `${t.type}:${t.id}`, label: t.detail ? `${t.name} · ${t.detail}` : t.name }));
  });

  constructor() {
    effect(() => { const f = this.file(); if (f) void this.load(f); else { this.list.set(null); this.pick.set(''); } });
  }

  private async load(f: OfficeFile): Promise<void> {
    this.loading.set(true); this.error.set(null);
    try {
      this.list.set(await this.office.shares(f.id));
      if (this.list()!.canManage) this.office.shareTargets().then(t => this.targets.set(t)).catch(() => undefined);
    } catch (e) { this.error.set(toApiError(e).message); }
    finally { this.loading.set(false); }
  }

  protected initials(name?: string | null): string {
    const w = (name ?? '').split(/\s+/).filter(Boolean);
    return ((w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] ?? '?').slice(0, 2))).toUpperCase();
  }

  protected async add(): Promise<void> {
    const f = this.file(); const [type, id] = this.pick().split(':');
    if (!f || !id || this.busy()) return;
    this.busy.set(true);
    try {
      await this.office.addShare(f.id, type as 'user' | 'role', id, this.level() as 'view' | 'edit');
      this.pick.set('');
      this.list.set(await this.office.shares(f.id));
      this.toast.success('Shared');
    } catch (e) { this.toast.error(toApiError(e).message); }
    finally { this.busy.set(false); }
  }

  protected async change(s: OfficeShare, access: string): Promise<void> {
    const f = this.file();
    if (!f || access === s.access) return;
    try {
      await this.office.addShare(f.id, s.principalType, s.principalId, access as 'view' | 'edit');
      this.list.set(await this.office.shares(f.id));
    } catch (e) { this.toast.error(toApiError(e).message); this.list.set(await this.office.shares(f.id).catch(() => this.list())); }
  }

  protected async remove(s: OfficeShare): Promise<void> {
    const f = this.file();
    if (!f) return;
    try { await this.office.removeShare(f.id, s.id); this.list.set(await this.office.shares(f.id)); }
    catch (e) { this.toast.error(toApiError(e).message); }
  }

  protected async copy(): Promise<void> {
    const f = this.file();
    if (!f) return;
    const url = shareLink(window.location.origin, f);
    try { await navigator.clipboard.writeText(url); this.toast.success('Link copied'); }
    catch { this.toast.info(url); }
  }
}
