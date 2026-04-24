import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { ToastService } from '../../../core/services/toast.service';
import { Order } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';

type Priority = 'Normal' | 'Urgent';

@Component({
  selector: 'pf-order-create',
  standalone: true,
  imports: [NgTemplateOutlet, CurrencyInrPipe, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <!-- Compact header -->
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="pf-head">
          <button type="button" class="pf-head__back press" (click)="back()" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            <span class="hidden sm:inline">Back</span>
          </button>

          <h1 class="pf-head__title">Build an order</h1>
          <p class="pf-head__sub">Pick tests, set priority, review cart.</p>
        </div>
      </header>

      <!-- Body: single column on everything except desktop (xl+), which gets
           the sticky cart sidebar. Tablet/phone use the cart icon toggle. -->
      <div class="pf-page__body px-4 md:px-8 lg:px-10 grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-5">

        <!-- LEFT COLUMN -->
        <div class="pf-col space-y-4">

          <!-- Patient — pick one first, then the order cart activates. -->
          @if (patient(); as p) {
            <div class="pf-patient">
              <pf-avatar [name]="p.displayName" [size]="40"></pf-avatar>
              <div class="min-w-0 flex-1">
                <p class="pf-patient__name">{{ p.displayName }}</p>
                <p class="pf-patient__meta">
                  {{ p.sex ?? '—' }} · {{ p.age ?? '—' }}y
                  @if (p.phone) { · {{ p.phone }} }
                </p>
              </div>
              <button type="button" class="pf-patient__change press" (click)="changePatient()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 20h4L20 8l-4-4L4 16v4Zm11-13 4 4"/>
                </svg>
                <span class="hidden sm:inline">Change</span>
              </button>
            </div>
          } @else {
            <!-- Canonical flow starts at Frontdesk Home: pick a patient there,
                 open their history, then tap "New order". Route here with
                 ?patientId=. If someone lands on Orders without a patient
                 selected, bounce them back to Home via this prompt. -->
            <div class="pf-no-patient">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="pf-no-patient__icon">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
              </svg>
              <div class="min-w-0 flex-1">
                <p class="pf-no-patient__title">No patient attached</p>
                <p class="pf-no-patient__sub">
                  Start at Frontdesk Home — search or register a patient, open their history, then tap <b>New order</b>.
                </p>
              </div>
              <button type="button" class="pf-no-patient__go press" (click)="goHome()">
                Go to Home
              </button>
            </div>
          }

          <!-- Search + Priority on one row (wraps on narrow) -->
          <div class="pf-search-row">
            <div class="pf-search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="pf-search__icon">
                <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
              </svg>
              <input type="text"
                     [value]="query()"
                     (input)="setQuery(asInput($event))"
                     placeholder="Search tests or packages — name, code, department…"
                     class="pf-search__input"
                     autofocus/>
              @if (query()) {
                <button type="button" class="pf-search__clear press" (click)="setQuery('')" aria-label="Clear search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 6l12 12M18 6 6 18"/>
                  </svg>
                </button>
              }
            </div>

            <div class="pf-priority__toggle" [attr.data-active]="priority()" role="radiogroup" aria-label="Priority">
              <button type="button"
                      class="pf-priority__opt press"
                      [class.pf-priority__opt--on]="priority() === 'Normal'"
                      (click)="setPriority('Normal')"
                      role="radio"
                      [attr.aria-checked]="priority() === 'Normal'">
                Normal
              </button>
              <button type="button"
                      class="pf-priority__opt press"
                      [class.pf-priority__opt--on]="priority() === 'Urgent'"
                      (click)="setPriority('Urgent')"
                      role="radio"
                      [attr.aria-checked]="priority() === 'Urgent'">
                Urgent
              </button>
            </div>
          </div>

          <!-- Quick packages -->
          @if (packages().length > 0 && !query()) {
            <div>
              <p class="pf-eyebrow mb-2 px-1">Quick packages</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                @for (pkg of packages(); track pkg.id) {
                  <button type="button" (click)="addPackage(pkg)" class="pf-pkg press">
                    <div class="min-w-0 flex-1 text-left">
                      <p class="pf-pkg__name">{{ pkg.name }}</p>
                      <p class="pf-pkg__meta">package · TAT {{ pkg.tatHours }}h</p>
                    </div>
                    <p class="pf-pkg__price">{{ pkg.price | inr }}</p>
                  </button>
                }
              </div>
            </div>
          }

          <!-- Test catalog -->
          <div>
            <div class="flex items-center justify-between mb-2 px-1">
              <p class="pf-eyebrow">Test catalog · <span class="pf-catalog-count">{{ filteredTests().length }}</span></p>
              @if (query()) {
                <span class="pf-filter-hint">filtered · "{{ query() }}"</span>
              }
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
              @for (t of filteredTests(); track t.id) {
                <button type="button"
                        (click)="toggleTest(t)"
                        class="pf-test press"
                        [class.pf-test--on]="isSelected(t.id)">
                  <span class="pf-test__badge">
                    @if (isSelected(t.id)) {
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m5 12 4 4L19 6"/>
                      </svg>
                    } @else {
                      {{ shortCode(t) }}
                    }
                  </span>
                  <div class="flex-1 min-w-0 text-left">
                    <p class="pf-test__name">{{ t.name }}</p>
                    <p class="pf-test__meta">
                      {{ t.department?.name ?? '—' }} · TAT {{ t.tatHours }}h
                    </p>
                  </div>
                  <span class="pf-test__price">{{ t.price | inr }}</span>
                </button>
              }
              @if (filteredTests().length === 0 && individualTests().length > 0) {
                <p class="col-span-full text-center py-6 text-[13px]" style="color: var(--text-tertiary);">No tests match "{{ query() }}"</p>
              }
              @if (individualTests().length === 0) {
                <p class="col-span-full text-center py-6 text-[13px]" style="color: var(--text-tertiary);">No tests configured.</p>
              }
            </div>
          </div>
        </div>

        <!-- RIGHT: sticky cart — desktop (xl+) only. Tablets + phones use the drawer. -->
        <aside class="pf-cart hidden xl:block">
          <div class="pf-cart__card">
            <ng-container *ngTemplateOutlet="cartBody"></ng-container>
          </div>
        </aside>

      </div>

      <!-- Floating cart button — bottom-right, visible on mobile + tablet + iPad.
           Hidden on desktop (xl+) where the sticky sidebar is the cart. -->
      <button type="button"
              class="pf-cart-fab press xl:hidden"
              [class.pf-cart-fab--open]="cartOpen()"
              (click)="toggleCart()"
              [attr.aria-label]="'Cart · ' + selected().length + ' tests'">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>
        </svg>
        @if (selected().length > 0) {
          <span class="pf-cart-fab__badge">{{ selected().length }}</span>
        }
      </button>

      <!-- Mobile/tablet: cart drawer + backdrop -->
      @if (cartOpen()) {
        <div class="pf-cart-backdrop xl:hidden" (click)="closeCart()"></div>
        <aside class="pf-cart-drawer xl:hidden">
          <header class="pf-cart-drawer__head">
            <span class="pf-eyebrow">Cart</span>
            <button type="button" class="pf-cart-drawer__close press" (click)="closeCart()" aria-label="Close cart">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6l12 12M18 6 6 18"/>
              </svg>
            </button>
          </header>
          <ng-container *ngTemplateOutlet="cartBody"></ng-container>
        </aside>
      }

      <!-- Cart body template shared by sidebar and drawer -->
      <ng-template #cartBody>
        <div class="flex items-center justify-between mb-3">
          <div>
            <p class="pf-eyebrow">Order summary</p>
            <p class="pf-cart-head">Cart · {{ selected().length }}</p>
          </div>
          @if (selected().length > 0) {
            <button type="button" (click)="clearCart()" class="pf-cart-clear press">Clear</button>
          }
        </div>

        <ul class="pf-cart-list">
          @if (selected().length === 0) {
            <li class="pf-cart-empty">No tests selected yet</li>
          }
          @for (id of selected(); track id) {
            @if (findTest(id); as t) {
              <li class="pf-cart-row">
                <div class="min-w-0 flex-1">
                  <p class="pf-cart-name">{{ t.name }}</p>
                  <p class="pf-cart-meta">{{ t.department?.name ?? '—' }}</p>
                </div>
                <span class="pf-cart-amount">{{ t.price | inr }}</span>
                <button type="button" (click)="removeTest(t.id)" class="pf-cart-remove press" aria-label="Remove">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 6l12 12M18 6 6 18"/>
                  </svg>
                </button>
              </li>
            }
          }
        </ul>

        <div class="pf-cart-totals">
          <div class="pf-cart-line">
            <span>Subtotal</span>
            <span class="tabular-nums">{{ subtotal() | inr }}</span>
          </div>
          <div class="pf-cart-line">
            <span>GST · 18%</span>
            <span class="tabular-nums">{{ gst() | inr }}</span>
          </div>
          <div class="pf-cart-line pf-cart-line--total">
            <span>Total</span>
            <span class="tabular-nums">{{ total() | inr }}</span>
          </div>
        </div>

        <button type="button"
                class="pf-proceed press"
                (click)="submit()"
                [disabled]="saving() || selected().length === 0 || !patient()">
          <span>Proceed to billing</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14m-5-6 6 6-6 6"/>
          </svg>
        </button>

        @if (priority() !== 'Normal') {
          <p class="pf-cart-badge pf-cart-badge--urgent">· {{ priority() }} priority ·</p>
        }
      </ng-template>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; overflow-x: hidden; }
    .pf-page { min-height: 100%; display: flex; flex-direction: column; }
    .pf-page__header { flex-shrink: 0; }
    .pf-page__body { padding-top: 8px; padding-bottom: 16px; }

    /* ── Compact page header ─────────────────────────────────── */
    .pf-head {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
      padding: 6px 0 10px;
    }
    .pf-head__back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 32px;
      padding: 0 10px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      align-self: center;
      flex-shrink: 0;
    }
    .pf-head__back:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-head__title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      line-height: 1.1;
      flex-shrink: 0;
    }
    @media (min-width: 768px) { .pf-head__title { font-size: 26px; } }
    .pf-head__sub {
      margin: 0;
      font-size: 13px;
      color: var(--text-secondary);
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Floating cart button (bottom-right, mobile + tablet + iPad) ── */
    .pf-cart-fab {
      position: fixed;
      right: 16px;
      /* Sit above the bottom-nav pill which uses the same offset pattern. */
      bottom: calc(6.5rem + env(safe-area-inset-bottom, 0px));
      z-index: 46;
      width: 60px;
      height: 60px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      border: 2px solid rgba(255, 255, 255, 0.18);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow:
        0 14px 36px rgba(124, 58, 237, 0.55),
        0 0 0 0 rgba(168, 85, 247, 0.45);
      transition:
        transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
        box-shadow 0.3s ease,
        background 0.25s ease;
      animation: pf-cart-breathe 2.6s ease-in-out infinite;
    }
    @keyframes pf-cart-breathe {
      0%, 100% {
        box-shadow:
          0 14px 36px rgba(124, 58, 237, 0.55),
          0 0 0 0 rgba(168, 85, 247, 0.45);
      }
      50% {
        box-shadow:
          0 16px 40px rgba(124, 58, 237, 0.65),
          0 0 0 12px rgba(168, 85, 247, 0);
      }
    }
    .pf-cart-fab:hover {
      box-shadow: 0 18px 42px rgba(124, 58, 237, 0.7);
      animation-play-state: paused;
    }
    .pf-cart-fab:active { transform: scale(0.93); }
    .pf-cart-fab--open {
      background: linear-gradient(135deg, #ef4444, #db2777);
      transform: rotate(45deg);
      animation: none;
    }
    .pf-cart-fab__badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      border-radius: 9999px;
      background: #ffffff;
      color: #7c3aed;
      font-size: 11.5px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
      font-variant-numeric: tabular-nums;
      border: 2px solid var(--bg-primary);
    }
    .pf-cart-fab--open .pf-cart-fab__badge {
      /* Counter-rotate so the badge number stays right-side up when FAB flips. */
      transform: rotate(-45deg);
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-cart-fab { animation: none; }
    }

    /* ── Patient row ────────────────────────────────────────── */
    .pf-patient {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-patient__name {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-patient__meta {
      margin: 2px 0 0;
      font-size: 11.5px;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-patient__change {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 32px;
      padding: 0 10px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .pf-patient__change:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-empty-patient { margin: 0; font-size: 13px; color: var(--text-tertiary); padding: 8px 4px; }

    .pf-no-patient {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px dashed rgba(168, 85, 247, 0.4);
    }
    .pf-no-patient__icon { color: #a855f7; flex-shrink: 0; }
    .pf-no-patient__title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-no-patient__sub {
      margin: 4px 0 0;
      font-size: 12.5px;
      color: var(--text-tertiary);
      line-height: 1.5;
    }
    .pf-no-patient__go {
      padding: 8px 16px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #fff;
      font-size: 12.5px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
      flex-shrink: 0;
    }
    .pf-no-patient__go:hover { box-shadow: 0 6px 18px rgba(124, 58, 237, 0.45); }

    /* Inline patient picker — shown until a patient is attached. */
    .pf-patient-picker {
      padding: 14px 16px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px dashed var(--glass-border);
    }
    .pf-patient-picker__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .pf-patient-picker__title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-patient-picker__register {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.12);
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #c4b5fd;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .pf-patient-picker__register:hover { background: rgba(168, 85, 247, 0.2); }
    .pf-patient-picker__search {
      position: relative;
      display: flex;
      align-items: center;
    }
    .pf-patient-picker__icon {
      position: absolute;
      left: 12px;
      color: var(--text-muted);
    }
    .pf-patient-picker__input {
      width: 100%;
      padding: 10px 12px 10px 36px;
      border-radius: 10px;
      background: var(--bg-card-solid);
      border: 1px solid var(--border-muted);
      color: var(--text-primary);
      font-size: 13.5px;
    }
    .pf-patient-picker__input:focus {
      outline: none;
      border-color: rgba(168, 85, 247, 0.6);
      box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.15);
    }
    .pf-patient-picker__list {
      list-style: none;
      margin: 10px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 320px;
      overflow-y: auto;
    }
    .pf-patient-picker__item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border-radius: 10px;
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      text-align: left;
      color: inherit;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .pf-patient-picker__item:hover {
      background: var(--bg-hover);
      border-color: var(--border-muted);
    }
    .pf-patient-picker__name { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
    .pf-patient-picker__meta { font-size: 12px; color: var(--text-tertiary); margin: 2px 0 0; }
    .pf-patient-picker__empty {
      margin: 10px 0 0;
      font-size: 12.5px;
      color: var(--text-tertiary);
      font-style: italic;
    }

    /* ── Search + Priority share a row ─────────────────────── */
    .pf-search-row {
      display: flex;
      align-items: stretch;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pf-search-row .pf-search {
      flex: 1;
      min-width: 260px;
    }
    .pf-search-row .pf-priority__toggle {
      flex-shrink: 0;
      height: 56px;  /* match search bar height so the row is symmetric */
      padding: 6px;
    }
    .pf-search-row .pf-priority__opt { height: 44px; }
    .pf-search-row .pf-priority__toggle[data-active='Normal']::before,
    .pf-search-row .pf-priority__toggle[data-active='Urgent']::before {
      top: 6px;
      left: 6px;
      width: calc(50% - 6px);
      height: calc(100% - 12px);
    }

    /* ── Search (hero block) ────────────────────────────────── */
    .pf-search {
      position: relative;
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.12), rgba(236, 72, 153, 0.06));
      border: 1px solid rgba(168, 85, 247, 0.3);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .pf-search:focus-within {
      border-color: rgba(168, 85, 247, 0.6);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.18), 0 12px 28px rgba(124, 58, 237, 0.25);
    }
    .pf-search__icon {
      position: absolute;
      left: 18px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-secondary);
      pointer-events: none;
    }
    .pf-search__input {
      width: 100%;
      height: 56px;
      padding: 0 48px 0 48px;
      border-radius: 18px;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 15px;
      outline: none;
    }
    .pf-search__input::placeholder { color: var(--text-muted); }
    .pf-search__clear {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .pf-search__clear:hover { background: var(--glass-bg-hover); color: var(--text-primary); }

    /* ── Priority toggle ────────────────────────────────────── */
    .pf-priority {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 2px 0;
    }
    .pf-priority__label {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .pf-priority__toggle {
      position: relative;
      display: inline-flex;
      padding: 4px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-priority__opt {
      position: relative;
      z-index: 1;
      height: 36px;
      padding: 0 18px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 600;
      border-radius: 9999px;
      cursor: pointer;
      transition: color 0.2s ease;
    }
    .pf-priority__opt:hover { color: var(--text-primary); }
    .pf-priority__opt--on { color: #ffffff; }
    /* Animated pill backdrop — slides between options */
    .pf-priority__toggle[data-active='Normal']::before,
    .pf-priority__toggle[data-active='Urgent']::before {
      content: '';
      position: absolute;
      top: 4px;
      left: 4px;
      width: calc(50% - 4px);
      height: calc(100% - 8px);
      border-radius: 9999px;
      background: var(--gradient-primary);
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.4);
      transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.25s;
    }
    .pf-priority__toggle[data-active='Urgent']::before {
      transform: translateX(100%);
      background: linear-gradient(135deg, #f59e0b, #ef4444);
      box-shadow: 0 6px 16px rgba(245, 158, 11, 0.45);
    }

    /* ── Eyebrow + counts ───────────────────────────────────── */
    .pf-eyebrow {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-catalog-count {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #ffffff;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      margin-left: 4px;
    }
    .pf-filter-hint {
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }

    /* ── Package cards ──────────────────────────────────────── */
    .pf-pkg {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.16), rgba(236, 72, 153, 0.06));
      border: 1px solid rgba(168, 85, 247, 0.28);
      color: var(--text-primary);
      cursor: pointer;
      transition: transform 0.08s, background 0.2s, border-color 0.2s, box-shadow 0.25s;
    }
    .pf-pkg:hover {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.24), rgba(236, 72, 153, 0.12));
      border-color: rgba(168, 85, 247, 0.5);
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.22);
    }
    .pf-pkg:active { transform: scale(0.98); }
    .pf-pkg__name { margin: 0; font-size: 14px; font-weight: 600; }
    .pf-pkg__meta {
      margin: 2px 0 0;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }
    .pf-pkg__price {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    /* ── Test catalog cards ─────────────────────────────────── */
    .pf-test {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.08s, box-shadow 0.25s;
    }
    .pf-test:hover { background: var(--glass-bg-hover); }
    .pf-test:active { transform: scale(0.99); }
    /* Selected state — on-theme gradient + glow (not white-on-ink) */
    .pf-test--on {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(236, 72, 153, 0.1));
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.25);
    }
    .pf-test__badge {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.06);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 700;
      color: var(--text-secondary);
      flex-shrink: 0;
      transition: background 0.2s;
    }
    .pf-test--on .pf-test__badge {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.45);
    }
    .pf-test__name { margin: 0; font-size: 13.5px; font-weight: 600; }
    .pf-test__meta {
      margin: 2px 0 0;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }
    .pf-test__price {
      font-size: 14px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    /* ── Cart (inline sidebar on lg+ / drawer on <lg) ──────── */
    .pf-cart { position: relative; }
    .pf-cart__card {
      position: sticky;
      top: 12px;
      padding: 18px;
      border-radius: 22px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
    }

    .pf-cart-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      z-index: 44;
      animation: pf-bd-in 0.2s ease both;
    }
    @keyframes pf-bd-in { from { opacity: 0 } to { opacity: 1 } }

    .pf-cart-drawer {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px));
      max-height: 75vh;
      padding: 18px;
      border-radius: 22px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      z-index: 45;
      animation: pf-drawer-up 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      overflow-y: auto;
    }
    @keyframes pf-drawer-up {
      from { transform: translateY(120%) scale(0.97); opacity: 0; }
      to   { transform: translateY(0) scale(1);      opacity: 1; }
    }
    .pf-cart-drawer__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .pf-cart-drawer__close {
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .pf-cart-head {
      margin: 2px 0 0;
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .pf-cart-clear {
      height: 28px;
      padding: 0 10px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 11.5px;
      cursor: pointer;
    }
    .pf-cart-clear:hover { background: var(--glass-bg-hover); color: var(--text-primary); }

    .pf-cart-list {
      list-style: none;
      padding: 0;
      margin: 0 0 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 320px;
      overflow-y: auto;
    }
    .pf-cart-empty {
      padding: 24px 0;
      text-align: center;
      font-size: 13px;
      color: var(--text-muted);
    }
    .pf-cart-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-cart-name { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-cart-meta {
      margin: 1px 0 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }
    .pf-cart-amount {
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .pf-cart-remove {
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.04);
      border: none;
      color: var(--text-tertiary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .pf-cart-remove:hover { background: rgba(239, 68, 68, 0.18); color: #fca5a5; }

    .pf-cart-totals {
      padding-top: 12px;
      border-top: 1px solid var(--border-muted);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-cart-line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .pf-cart-line--total {
      margin-top: 6px;
      padding-top: 10px;
      border-top: 1px solid var(--border-muted);
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .pf-proceed {
      margin-top: 16px;
      width: 100%;
      height: 52px;
      border-radius: 16px;
      background: var(--gradient-primary);
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      border: 1px solid rgba(255, 255, 255, 0.12);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 10px 24px rgba(124, 58, 237, 0.4);
      transition: transform 0.08s, box-shadow 0.25s, filter 0.08s;
    }
    .pf-proceed:hover:not(:disabled) {
      box-shadow: 0 14px 32px rgba(124, 58, 237, 0.55);
      transform: translateY(-1px);
    }
    .pf-proceed:active:not(:disabled) { transform: scale(0.98); filter: brightness(1.08); }
    .pf-proceed:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }

    .pf-cart-badge {
      margin: 8px 0 0;
      text-align: center;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.08em;
    }
    .pf-cart-badge--urgent { color: #fcd34d; }
  `]
})
export class OrderCreateComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly settings = inject(FrontdeskSettingsService);

  private readonly _patient = signal<Patient | null>(null);
  private readonly _tests = signal<Test[]>([]);
  private readonly _saving = signal(false);
  private readonly _selected = signal<string[]>([]);
  private readonly _priority = signal<Priority>('Normal');
  private readonly _query = signal<string>('');
  private readonly _cartOpen = signal<boolean>(false);

  readonly patient = this._patient.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly selected = this._selected.asReadonly();
  readonly priority = this._priority.asReadonly();
  readonly query = this._query.asReadonly();
  readonly cartOpen = this._cartOpen.asReadonly();

  readonly individualTests = computed(() => this._tests().filter(t => t.type !== 'package'));
  readonly packages = computed(() => this._tests().filter(t => t.type === 'package'));

  readonly filteredTests = computed(() => {
    const q = this._query().trim().toLowerCase();
    const list = this.individualTests();
    if (!q) return list;
    return list.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.hsnSacCode ?? '').toLowerCase().includes(q) ||
      (t.department?.name ?? '').toLowerCase().includes(q)
    );
  });

  readonly subtotal = computed(() =>
    this._selected()
      .map(id => this._tests().find(t => t.id === id)?.price ?? 0)
      .reduce((a, b) => a + b, 0)
  );
  readonly gst = computed(() => Math.round(this.subtotal() * 0.18));
  readonly total = computed(() => this.subtotal() + this.gst());

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: l => this._tests.set(l ?? []),
      error: e => this.toasts.error(`Could not load tests: ${e?.message ?? 'unknown error'}`)
    });

    // Deep-link support — if the route carries ?patientId= (e.g. coming
    // from a patient profile), pre-attach. Otherwise the inline picker
    // handles selection in-page.
    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.api.get<{ patient: Patient; history: unknown[] }>(`/api/patients/${pid}`).subscribe({
        next: res => this._patient.set(res.patient),
        error: () => this.toasts.error('Could not load patient')
      });
    }
  }

  setPriority(p: Priority) { this._priority.set(p); }
  setQuery(q: string) { this._query.set(q); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  isSelected(id: string): boolean { return this._selected().includes(id); }
  findTest(id: string): Test | undefined { return this._tests().find(t => t.id === id); }

  toggleTest(t: Test) {
    this._selected.update(cur => cur.includes(t.id) ? cur.filter(id => id !== t.id) : [...cur, t.id]);
  }
  removeTest(id: string) {
    this._selected.update(cur => cur.filter(x => x !== id));
  }
  clearCart() { this._selected.set([]); }

  addPackage(pkg: Test) {
    this._selected.update(cur => cur.includes(pkg.id) ? cur : [...cur, pkg.id]);
    this.toasts.success(`${pkg.name} added`);
  }

  toggleCart() { this._cartOpen.update(v => !v); }
  closeCart() { this._cartOpen.set(false); }

  shortCode(t: Test): string {
    if (t.hsnSacCode) return t.hsnSacCode.slice(0, 4);
    return t.name.replace(/\s+/g, '').slice(0, 4).toUpperCase();
  }

  // Canonical flow: Home → patient history → New order (lands here with
  // ?patientId=). "Change" on the attached patient tile bounces back to
  // Home so the user can pick a different one from their records.
  changePatient() { this.goHome(); }
  goHome() { this.router.navigateByUrl('/frontdesk'); }

  submit() {
    const p = this._patient();
    if (!p || this._saving() || this._selected().length === 0) return;

    this._saving.set(true);
    this.api.post<Order>('/api/orders/', {
      patientId: p.id,
      priority: this._priority(),
      source: 'walkin',
      collectionType: 'walkin',
      testIds: this._selected()
    }).subscribe({
      next: order => {
        this._saving.set(false);
        // Admin-controlled fork: if frontdesk collects payment, jump into
        // the Billing tab with the new order preselected; otherwise raise
        // a billing request and reset for the next patient/order.
        if (this.settings.collectsBilling()) {
          this.toasts.success('Order created — enter billing');
          this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: order.id } });
        } else {
          // Admin set "Frontdesk does not collect" — raise billing as a
          // separate request and return to Home for the next patient.
          this.toasts.success('Order created — billing request raised');
          this._selected.set([]);
          this._patient.set(null);
          this.router.navigateByUrl('/frontdesk');
        }
      },
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Order failed'); }
    });
  }

  back() { this.router.navigateByUrl('/frontdesk'); }
}
