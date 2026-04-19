import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LogoMarkComponent } from '../../shared/primitives/logo-mark.component';

interface NavLink { label: string; href: string; icon: string; }
interface NavSection { title: string; links: NavLink[]; }

@Component({
  selector: 'pf-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, LogoMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="hidden md:flex flex-col w-60 shrink-0 text-white"
           style="background: var(--gradient-primary);">
      <a routerLink="/admin" class="flex items-center gap-2 px-5 h-16"
         style="border-bottom: 1px solid rgba(255, 255, 255, 0.12);">
        <pf-logo-mark size="sm" variant="mono"></pf-logo-mark>
        <span class="font-semibold tracking-tight">Prefrontal · Lab Management System</span>
      </a>
      <nav class="flex-1 overflow-y-auto py-4">
        @for (section of sections; track section.title) {
          <div class="px-3 mb-4">
            <p class="text-[11px] uppercase tracking-wider text-white/40 px-3 mb-1.5">{{ section.title }}</p>
            <ul class="flex flex-col gap-0.5">
              @for (link of section.links; track link.href) {
                <li>
                  <a [routerLink]="link.href"
                     routerLinkActive="bg-white/10"
                     [routerLinkActiveOptions]="{ exact: link.href === '/admin' }"
                     class="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-white/5 transition">
                    <span class="opacity-80">{{ link.icon }}</span>
                    <span>{{ link.label }}</span>
                  </a>
                </li>
              }
            </ul>
          </div>
        }
      </nav>
      <div class="px-5 py-3 border-t border-white/10 text-[11px] text-white/40">
        v0.1.0 · mock auth
      </div>
    </aside>
  `
})
export class SidebarComponent {
  readonly sections: NavSection[] = [
    {
      title: 'Admin',
      links: [
        { label: 'Dashboard',         href: '/admin',                icon: '🏠' },
        { label: 'Users & Access',    href: '/admin/users',          icon: '👥' },
        { label: 'Tests',             href: '/admin/tests',          icon: '🧪' },
        { label: 'Branches',          href: '/admin/branches',       icon: '🏢' },
        { label: 'Billing Config',    href: '/admin/billing',        icon: '💳' },
        { label: 'Report Template',   href: '/admin/reports',        icon: '📄' },
        { label: 'Notifications',     href: '/admin/notifications',  icon: '🔔' },
        { label: 'Workflows',         href: '/admin/workflows',      icon: '🔧' }
      ]
    },
    {
      title: 'Reception',
      links: [
        { label: 'Reception',         href: '/reception',                icon: '🧑‍💼' },
        { label: 'Create Order',      href: '/reception/order-create',   icon: '➕' },
        { label: 'Billing',           href: '/reception/billing',        icon: '🧾' }
      ]
    },
    {
      title: 'Lab',
      links: [
        { label: 'My Work',           href: '/lab/my-work',   icon: '🎯' },
        { label: 'Sample Collection', href: '/lab/collect',   icon: '🧫' },
        { label: 'Receive Samples',   href: '/lab/receive',   icon: '📥' }
      ]
    },
    {
      title: 'Pathologist',
      links: [
        { label: 'Pending Validation',href: '/pathologist',       icon: '✅' }
      ]
    },
    {
      title: 'Reports',
      links: [
        { label: 'Report Queue',      href: '/reports',           icon: '📤' }
      ]
    },
    {
      title: 'Operations',
      links: [
        { label: 'TAT Dashboard',     href: '/dashboard',         icon: '📊' }
      ]
    }
  ];
}
