import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { UsersAccessComponent } from './users-access/users-access.component';
import { WebrtcService } from '../../core/services/webrtc.service';
import { SignalingService } from '../../core/services/signaling.service';
import { PresenceService } from '../../core/services/presence.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';

/**
 * Group A of "band pill everywhere": Users & Access and Test Master. Search,
 * the view/tab switch and the page buttons live in the band; the page header
 * is classic-only; the grid fills the band body.
 */

const users = [
  { id: 'u1', firstName: 'Asha', lastName: 'Kumar', username: 'asha', email: 'asha@lab.in', isActive: true, roles: [] },
  { id: 'u2', firstName: 'Ravi', lastName: 'Shankar', username: 'ravi', email: 'ravi@lab.in', isActive: true, roles: [] },
];
const roles = [
  { id: 'r1', name: 'Reception', description: '', permissions: [], isPreSeeded: true },
];

function renderUsers() {
  return renderBandPage(UsersAccessComponent, {
    getFor: (url) => (url.startsWith('/api/users') ? users : url.startsWith('/api/roles') ? roles : []),
    providers: [
      { provide: WebrtcService, useValue: { startCall: vi.fn() } },
      { provide: SignalingService, useValue: { onlineUserIds: signal(new Set<string>()) } },
      { provide: PresenceService, useValue: { seedFromUsers: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
    ],
  });
}

describe('Admin band — Users & Access', () => {
  it('band + fill body; header and the old toolbar are classic-only', () => {
    const p = renderUsers();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.body()?.classList.contains('pf-band-body--fill')).toBe(true);
    expect(p.body()?.querySelector('ag-grid-angular')).not.toBeNull();
  });

  it('Users tab: "Create user" in the band actions; the pill search filters users', () => {
    const p = renderUsers();
    expect(p.actions().map((b) => b.textContent?.trim())).toEqual(['Create user']);
    expect(p.cmp.filteredUsers().length).toBe(2);
    p.type('ravi');
    expect(p.cmp.search()).toBe('ravi');
    expect(p.cmp.filteredUsers().map((u: any) => u.id)).toEqual(['u2']);
  });

  it('the Users / Roles switch rides in the pill and swaps the band action', () => {
    const p = renderUsers();
    const seg = p.tools()!.querySelectorAll<HTMLButtonElement>('pf-segmented button');
    expect(Array.from(seg).map((b) => b.textContent?.trim())).toEqual(['Users', 'Roles & Permissions']);
    seg[1].click();
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('roles');
    expect(p.actions().map((b) => b.textContent?.trim())).toEqual(['Create role']);
    expect(p.bandInput()!.placeholder).toContain('roles');
  });
});
