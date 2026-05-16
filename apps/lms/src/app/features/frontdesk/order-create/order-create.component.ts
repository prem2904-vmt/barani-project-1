import { Location, NgTemplateOutlet } from '@angular/common';
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

/** Slimmed view of the patient-history row used for repeat-order seeding.
 *  Mirrors the enriched shape returned by GET /api/patients/{id}. */
interface HistoryRow {
  id: string;
  createdAt: string;
  samples?: Array<{ tests?: Array<{ testId?: string; test?: { id?: string } }> }>;
}

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

          <!-- Ref doctor (optional) — typeahead from past orders' RefDoctorName.
               Stored as RefDoctorName on the order; backend auto-suggests
               doctors seen on prior orders within the tenant. -->
          <div class="pf-refdoc">
            <label class="pf-eyebrow mb-1 px-1 block">Referring doctor <span class="pf-refdoc__opt">(optional)</span></label>
            <div class="pf-refdoc__field">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="pf-refdoc__icon">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <input type="text" class="pf-refdoc__input"
                     [value]="refDoctorName()"
                     (input)="onRefDoctorInput(asInput($event))"
                     (focus)="onRefDoctorFocus()"
                     (blur)="onRefDoctorBlur()"
                     placeholder="Type a doctor's name — suggestions from past orders" />
              @if (refDoctorName()) {
                <button type="button" class="pf-refdoc__clear press"
                        (mousedown)="pickRefDoctor('')" aria-label="Clear">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              }
            </div>
            @if (refDoctorOpen() && refDoctorSuggestions().length > 0) {
              <div class="pf-refdoc__pop">
                @for (name of refDoctorSuggestions(); track name) {
                  <button type="button" class="pf-refdoc__pop-item press"
                          (mousedown)="pickRefDoctor(name)">{{ name }}</button>
                }
              </div>
            }
          </div>

          <!-- Categorized test picker. Tabs swap the rail content; rail
               itself is one horizontal scroll-snap row. Star = toggle
               favourite (per-user). 'all' falls back to the dept-grouped
               grid for full catalogue browsing. -->
          <div>
            <div class="pf-tabs pf-no-print" role="tablist" aria-label="Test categories">
              @for (tab of [
                { id: 'recent',     label: 'Recent',     count: recentTests().length    },
                { id: 'favourites', label: 'Favourites', count: favouriteTests().length },
                { id: 'packages',   label: 'Packages',   count: packages().length       },
                { id: 'all',        label: 'All tests',  count: individualTests().length }
              ]; track tab.id) {
                <button type="button" class="pf-tabs__btn"
                        [class.pf-tabs__btn--on]="categoryTab() === tab.id"
                        (click)="setCategoryTab($any(tab.id))"
                        role="tab" [attr.aria-selected]="categoryTab() === tab.id">
                  <span>{{ tab.label }}</span>
                  @if (tab.count > 0) {
                    <span class="pf-tabs__count">{{ tab.count }}</span>
                  }
                </button>
              }
            </div>

            @if (categoryTab() === 'recent') {
              @if (recentTests().length === 0) {
                <p class="pf-empty-line">No recent tests yet — they appear here once you create your first order.</p>
              } @else {
                <div class="pf-rail" role="list">
                  @for (t of recentTests(); track t.id) {
                    <button type="button" class="pf-rail-card press"
                            [class.pf-rail-card--on]="isSelected(t.id)"
                            (click)="toggleTest(t)" role="listitem">
                      <button type="button" class="pf-rail-card__star"
                              [class.pf-rail-card__star--on]="isFavourite(t.id)"
                              (click)="toggleFavourite(t.id, $event)"
                              [attr.aria-label]="isFavourite(t.id) ? 'Unpin' : 'Pin to favourites'">
                        <svg width="14" height="14" viewBox="0 0 24 24" [attr.fill]="isFavourite(t.id) ? 'currentColor' : 'none'"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      </button>
                      <span class="pf-rail-card__code">{{ shortCode(t) }}</span>
                      <p class="pf-rail-card__name">{{ t.name }}</p>
                      <p class="pf-rail-card__meta">TAT {{ t.tatHours }}h</p>
                      <p class="pf-rail-card__price">{{ t.price | inr }}</p>
                      @if (isSelected(t.id)) {
                        <span class="pf-rail-card__on-tag">✓ Added</span>
                      }
                    </button>
                  }
                </div>
              }
            }

            @if (categoryTab() === 'favourites') {
              @if (favouriteTests().length === 0) {
                <p class="pf-empty-line">No favourites yet — click the ☆ on any test to pin it here.</p>
              } @else {
                <div class="pf-rail" role="list">
                  @for (t of favouriteTests(); track t.id) {
                    <button type="button" class="pf-rail-card press"
                            [class.pf-rail-card--on]="isSelected(t.id)"
                            (click)="toggleTest(t)" role="listitem">
                      <button type="button" class="pf-rail-card__star pf-rail-card__star--on"
                              (click)="toggleFavourite(t.id, $event)" aria-label="Unpin">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      </button>
                      <span class="pf-rail-card__code">{{ shortCode(t) }}</span>
                      <p class="pf-rail-card__name">{{ t.name }}</p>
                      <p class="pf-rail-card__meta">TAT {{ t.tatHours }}h</p>
                      <p class="pf-rail-card__price">{{ t.price | inr }}</p>
                      @if (isSelected(t.id)) {
                        <span class="pf-rail-card__on-tag">✓ Added</span>
                      }
                    </button>
                  }
                </div>
              }
            }

            @if (categoryTab() === 'packages') {
              @if (packages().length === 0) {
                <p class="pf-empty-line">No packages configured.</p>
              } @else {
                <div class="pf-rail" role="list">
                  @for (pkg of packages(); track pkg.id) {
                    <button type="button" class="pf-rail-card pf-rail-card--pkg press"
                            [class.pf-rail-card--on]="isSelected(pkg.id)"
                            (click)="togglePackage(pkg)" role="listitem">
                      <span class="pf-rail-card__tag">PACKAGE</span>
                      <p class="pf-rail-card__name">{{ pkg.name }}</p>
                      <p class="pf-rail-card__meta">TAT {{ pkg.tatHours }}h</p>
                      <p class="pf-rail-card__price">{{ pkg.price | inr }}</p>
                      @if (isSelected(pkg.id)) {
                        <span class="pf-rail-card__on-tag">✓ Added</span>
                      }
                    </button>
                  }
                </div>
              }
            }

            @if (categoryTab() === 'all') {
              @if (filteredTests().length === 0 && individualTests().length > 0) {
                <p class="pf-empty-line">No tests match "{{ query() }}"</p>
              } @else if (individualTests().length === 0) {
                <p class="pf-empty-line">No tests configured.</p>
              } @else {
                <div class="flex flex-col gap-5">
                  @for (group of filteredTestsByDept(); track group.department) {
                    <div>
                      <div class="pf-dept-hdr">
                        <span class="pf-dept-hdr__name">{{ group.department }}</span>
                        <span class="pf-dept-hdr__count">{{ group.tests.length }}</span>
                      </div>
                      <div class="pf-rail" role="list">
                        @for (t of group.tests; track t.id) {
                          <button type="button" class="pf-rail-card press"
                                  [class.pf-rail-card--on]="isSelected(t.id)"
                                  (click)="toggleTest(t)" role="listitem">
                            <button type="button" class="pf-rail-card__star"
                                    [class.pf-rail-card__star--on]="isFavourite(t.id)"
                                    (click)="toggleFavourite(t.id, $event)"
                                    [attr.aria-label]="isFavourite(t.id) ? 'Unpin' : 'Pin to favourites'">
                              <svg width="14" height="14" viewBox="0 0 24 24" [attr.fill]="isFavourite(t.id) ? 'currentColor' : 'none'"
                                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                              </svg>
                            </button>
                            <span class="pf-rail-card__code">{{ shortCode(t) }}</span>
                            <p class="pf-rail-card__name">{{ t.name }}</p>
                            <p class="pf-rail-card__meta">TAT {{ t.tatHours }}h</p>
                            <p class="pf-rail-card__price">{{ t.price | inr }}</p>
                            @if (isSelected(t.id)) {
                              <span class="pf-rail-card__on-tag">✓ Added</span>
                            }
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            }
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
                  @if (t.department?.name) {
                    <p class="pf-cart-meta">{{ t.department?.name }}</p>
                  }
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

        @if (packageSuggestions().length > 0) {
          <div class="pf-pkg-suggest">
            <header class="pf-pkg-suggest__hdr">
              <span class="pf-pkg-suggest__icon" aria-hidden="true">★</span>
              <span>Save with a package</span>
            </header>
            <p class="pf-pkg-suggest__sub">
              These bundles include everything in your cart at a lower price.
            </p>
            <ul class="pf-pkg-suggest__list">
              @for (s of packageSuggestions(); track s.package.id) {
                <li class="pf-pkg-suggest__row">
                  <div class="min-w-0 flex-1">
                    <p class="pf-pkg-suggest__name">{{ s.package.name }}</p>
                    <p class="pf-pkg-suggest__meta">
                      Includes {{ s.memberCount }} test{{ s.memberCount === 1 ? '' : 's' }}
                      <span class="pf-pkg-suggest__sep">·</span>
                      <span class="pf-pkg-suggest__strike">{{ s.individualSum | inr }}</span>
                      <span class="pf-pkg-suggest__price">{{ s.package.price | inr }}</span>
                    </p>
                  </div>
                  @if (s.savings > 0) {
                    <span class="pf-pkg-suggest__save">Save {{ s.savings | inr }}</span>
                  }
                  <button type="button" class="pf-pkg-suggest__apply press" (click)="applyPackage(s)">
                    Apply
                  </button>
                </li>
              }
            </ul>
          </div>
        }

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

        @if (tatLabel()) {
          <p class="pf-cart-tat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
            </svg>
            <span>{{ tatLabel() }}</span>
          </p>
        }

        <button type="button"
                class="pf-proceed press"
                (click)="submit()"
                [disabled]="saving() || selected().length === 0 || !patient()">
          <span>Proceed to billing</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14m-5-6 6 6-6 6"/>
          </svg>
        </button>

        <div class="pf-cart-draftrow">
          <button type="button"
                  class="pf-cart-draft press"
                  (click)="saveDraft()"
                  [disabled]="!patient() || selected().length === 0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8"/>
            </svg>
            Save as draft
          </button>
          @if (hasDraft()) {
            <button type="button" class="pf-cart-draft pf-cart-draft--ghost press" (click)="discardDraft()">
              Discard draft
            </button>
          }
        </div>

        @if (priority() !== 'Normal') {
          <div class="pf-cart-badge-wrap">
            <span class="pf-cart-badge pf-cart-badge--urgent">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 2L2 22h20L12 2zM12 9v5M12 18h.01"/>
              </svg>
              {{ priority() }} priority
            </span>
          </div>
        }
      </ng-template>
    </section>
  `,
  styles: [`
    /* ── Ref doctor autocomplete ────────────────────────────── */
    .pf-refdoc { position: relative; }
    .pf-refdoc__opt { font-weight: 400; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
    .pf-refdoc__field {
      position: relative;
      display: flex; align-items: center;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      padding: 0 10px 0 36px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .pf-refdoc__field:focus-within {
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 247, 0.18);
    }
    .pf-refdoc__icon {
      position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
      color: var(--text-tertiary);
    }
    .pf-refdoc__input {
      flex: 1; min-width: 0; height: 40px;
      background: transparent; border: none; outline: none;
      color: var(--text-primary); font-size: 13.5px;
    }
    .pf-refdoc__input::placeholder { color: var(--text-muted); }
    .pf-refdoc__clear {
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--glass-bg-hover);
      border: none; color: var(--text-secondary); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      margin-left: 4px;
    }
    .pf-refdoc__pop {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30;
      background: var(--bg-card-solid, #14142a);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      padding: 6px;
      max-height: 240px; overflow-y: auto;
    }
    .pf-refdoc__pop-item {
      display: block; width: 100%; padding: 8px 10px;
      background: transparent; border: none; text-align: left;
      color: var(--text-primary); font-size: 13px; cursor: pointer;
      border-radius: 8px;
    }
    .pf-refdoc__pop-item:hover { background: var(--glass-bg-hover); }

    /* ── Category tabs (Recent / Favourites / Packages / All) ── */
    .pf-tabs {
      display: flex; align-items: center; gap: 6px;
      padding: 6px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      margin-bottom: 12px;
      overflow-x: auto;
    }
    .pf-tabs__btn {
      flex: 1 1 auto; min-width: max-content;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 7px 14px;
      background: transparent; border: 1px solid transparent;
      border-radius: 8px;
      color: var(--text-tertiary); font-size: 12.5px; font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .pf-tabs__btn:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-tabs__btn--on {
      background: color-mix(in srgb, #a78bfa 14%, transparent);
      box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.55);
      color: var(--text-primary); font-weight: 600;
    }
    .pf-tabs__count {
      min-width: 18px; padding: 1px 6px;
      border-radius: 999px;
      background: rgba(168, 85, 247, 0.18);
      color: #c4b5fd;
      font-size: 10.5px; font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    /* ── Horizontal rail of test cards ───────────────────────── */
    .pf-rail {
      display: flex; gap: 10px;
      overflow-x: auto;
      padding: 4px 4px 12px;
      scroll-snap-type: x proximity;
      scrollbar-width: thin;
    }
    .pf-rail::-webkit-scrollbar { height: 6px; }
    .pf-rail::-webkit-scrollbar-thumb {
      background: rgba(168, 85, 247, 0.32); border-radius: 999px;
    }

    .pf-rail-card {
      position: relative;
      flex: 0 0 220px;
      scroll-snap-align: start;
      display: flex; flex-direction: column; gap: 4px;
      padding: 14px 14px 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.08s;
    }
    .pf-rail-card:hover { background: var(--glass-bg-hover); border-color: rgba(168, 85, 247, 0.40); }
    .pf-rail-card:active { transform: scale(0.98); }
    .pf-rail-card--on {
      background: color-mix(in srgb, #10b981 14%, transparent);
      border-color: rgba(16, 185, 129, 0.45);
    }
    .pf-rail-card--pkg {
      background: color-mix(in srgb, #f59e0b 10%, var(--glass-bg));
      border-color: rgba(245, 158, 11, 0.32);
    }
    .pf-rail-card--pkg.pf-rail-card--on {
      background: color-mix(in srgb, #10b981 14%, transparent);
      border-color: rgba(16, 185, 129, 0.45);
    }
    .pf-rail-card__star {
      position: absolute; top: 8px; right: 8px;
      width: 24px; height: 24px; border-radius: 50%;
      background: transparent; border: none;
      color: var(--text-muted);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: color 0.15s, background 0.15s;
    }
    .pf-rail-card__star:hover { background: var(--glass-bg-hover); color: #fbbf24; }
    .pf-rail-card__star--on { color: #fbbf24; }
    .pf-rail-card__code {
      align-self: flex-start;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(168, 85, 247, 0.18);
      color: #c4b5fd;
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      margin-bottom: 4px;
    }
    .pf-rail-card__tag {
      align-self: flex-start;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(245, 158, 11, 0.22);
      color: #fbbf24;
      font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      margin-bottom: 4px;
    }
    .pf-rail-card__name {
      margin: 0;
      font-size: 13.5px; font-weight: 600;
      color: var(--text-primary);
      line-height: 1.3;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .pf-rail-card__meta {
      margin: 0;
      font-size: 11px; color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-rail-card__price {
      margin: 4px 0 0;
      font-size: 14px; font-weight: 700;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
    }
    .pf-rail-card__on-tag {
      position: absolute; bottom: 8px; right: 10px;
      font-size: 10.5px; font-weight: 700;
      color: #10b981;
    }

    .pf-empty-line {
      text-align: center; padding: 18px 8px;
      color: var(--text-tertiary); font-size: 13px;
    }

    /* ── Dept header above each catalog group ───────────────── */
    .pf-dept-hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 4px 8px;
      border-bottom: 1px dashed var(--glass-border);
      margin-bottom: 8px;
    }
    .pf-dept-hdr__name {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }
    .pf-dept-hdr__count {
      padding: 1px 8px;
      font-size: 10.5px;
      font-weight: 700;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.16);
      color: #c4b5fd;
    }

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
    @media (min-width: 1280px) {
      .pf-cart-fab { display: none; }
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
      flex: 1 1 auto;
      min-width: 0;
    }
    @media (min-width: 480px) {
      .pf-search-row .pf-search { min-width: 260px; }
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
    .pf-pkg--on {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.42), rgba(236, 72, 153, 0.22));
      border-color: rgba(168, 85, 247, 0.85);
      box-shadow: 0 10px 28px rgba(124, 58, 237, 0.3);
    }
    .pf-pkg__check {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.45);
    }
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

    /* ── Package suggestion banner ─────────────────────────── */
    .pf-pkg-suggest {
      margin-top: 12px;
      padding: 12px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.14), rgba(236, 72, 153, 0.10));
      border: 1px solid rgba(168, 85, 247, 0.40);
    }
    .pf-pkg-suggest__hdr {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #c4b5fd;
    }
    .pf-pkg-suggest__icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white; border-radius: 50%; font-size: 11px;
    }
    .pf-pkg-suggest__sub {
      margin: 4px 0 10px;
      font-size: 11.5px;
      color: var(--text-secondary);
    }
    .pf-pkg-suggest__list {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 6px;
    }
    .pf-pkg-suggest__row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
    }
    .pf-pkg-suggest__name {
      margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-pkg-suggest__meta {
      margin: 2px 0 0; font-size: 11px; color: var(--text-secondary);
      display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    }
    .pf-pkg-suggest__sep { opacity: 0.6; }
    .pf-pkg-suggest__strike {
      text-decoration: line-through; opacity: 0.7;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-pkg-suggest__price {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700; color: var(--text-primary);
    }
    .pf-pkg-suggest__save {
      flex: 0 0 auto;
      padding: 2px 8px;
      background: rgba(16, 185, 129, 0.18);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.45);
      border-radius: 9999px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
    }
    .pf-pkg-suggest__apply {
      flex: 0 0 auto;
      padding: 6px 12px;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white;
      border: 0; border-radius: 9999px;
      font-size: 11.5px; font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 10px rgba(124, 58, 237, 0.32);
    }
    .pf-pkg-suggest__apply:hover { filter: brightness(1.08); }

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
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 10px auto 0;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.1em;
      font-weight: 600;
    }
    .pf-cart-badge-wrap { display: flex; justify-content: center; }
    .pf-cart-badge--urgent {
      color: #f97316;
      background: rgba(249, 115, 22, 0.14);
      border: 1px solid rgba(249, 115, 22, 0.4);
    }

    /* Estimated time-to-report next to the cart total */
    .pf-cart-tat {
      display: inline-flex; align-items: center; gap: 6px;
      margin-top: 10px;
      padding: 6px 10px;
      background: rgba(59, 130, 246, 0.10);
      border: 1px solid rgba(59, 130, 246, 0.35);
      border-radius: 9999px;
      color: #93c5fd;
      font-size: 11.5px; font-weight: 600;
    }

    /* Save / discard draft action row */
    .pf-cart-draftrow {
      display: flex; gap: 8px; margin-top: 8px;
    }
    .pf-cart-draft {
      flex: 1;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 8px 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      color: var(--text-primary);
      font-size: 12px; font-weight: 600;
      cursor: pointer;
    }
    .pf-cart-draft:hover:not([disabled]) { background: var(--bg-hover); }
    .pf-cart-draft[disabled] { opacity: 0.45; cursor: not-allowed; }
    .pf-cart-draft--ghost { flex: 0 0 auto; color: var(--text-secondary); }
  `]
})
export class OrderCreateComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly locationSvc = inject(Location);
  private readonly settings = inject(FrontdeskSettingsService);

  private readonly _patient = signal<Patient | null>(null);
  private readonly _tests = signal<Test[]>([]);
  private readonly _saving = signal(false);
  private readonly _selected = signal<string[]>([]);
  private readonly _priority = signal<Priority>('Normal');
  private readonly _query = signal<string>('');
  private readonly _cartOpen = signal<boolean>(false);

  // ── Categorized test picker state ─────────────────────────────────
  /** Active category tab. 'all' falls back to the existing dept-grouped grid. */
  readonly categoryTab = signal<'recent' | 'favourites' | 'packages' | 'all'>('all');
  /** Per-user pinned test ids, fetched from /api/test-picker/favorites. */
  readonly favouriteIds = signal<Set<string>>(new Set());
  /** Per-user recent test ids, fetched from /api/test-picker/recent. */
  readonly recentIds = signal<string[]>([]);

  // ── Ref-doctor field state ────────────────────────────────────────
  readonly refDoctorName = signal<string>('');
  readonly refDoctorOpen = signal(false);
  readonly refDoctorSuggestions = signal<string[]>([]);
  private refDoctorDebounce: ReturnType<typeof setTimeout> | null = null;

  /** Per-patient localStorage key for draft order carts. We keep one
   *  draft per patient so reception can resume any half-built order
   *  on the same browser. Drafts older than 7 days are dropped on
   *  restore. */
  private readonly DRAFT_KEY_PREFIX = 'pf:order-draft:';
  private readonly DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  /** UI signal for "draft was just saved" — drives the toast badge. */
  private readonly _hasDraft = signal<boolean>(false);
  readonly hasDraft = this._hasDraft.asReadonly();

  readonly patient = this._patient.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly selected = this._selected.asReadonly();
  readonly priority = this._priority.asReadonly();
  readonly query = this._query.asReadonly();
  readonly cartOpen = this._cartOpen.asReadonly();

  readonly individualTests = computed(() => this._tests().filter(t => t.type !== 'package'));
  readonly packages = computed(() => this._tests().filter(t => t.type === 'package'));

  // ── Category-aware test lists ────────────────────────────────────

  /** Tests pinned by the current user, in pin order. Filtered to active. */
  readonly favouriteTests = computed<Test[]>(() => {
    const ids = this.favouriteIds();
    if (ids.size === 0) return [];
    const byId = new Map(this._tests().map(t => [t.id, t]));
    return Array.from(ids).map(id => byId.get(id)).filter((t): t is Test => !!t && t.isActive);
  });

  /** Tests this user has ordered in the past, most-recent first. */
  readonly recentTests = computed<Test[]>(() => {
    const ids = this.recentIds();
    if (ids.length === 0) return [];
    const byId = new Map(this._tests().map(t => [t.id, t]));
    return ids.map(id => byId.get(id)).filter((t): t is Test => !!t && t.isActive);
  });

  /** True when the test id is in the user's favourites. */
  isFavourite(testId: string): boolean { return this.favouriteIds().has(testId); }

  readonly filteredTests = computed(() => {
    const q = this._query().trim().toLowerCase();
    const list = this.individualTests();
    if (!q) return list;
    // Common spelling divergences. US "hematology" wouldn't match the
    // British "haematology" stored in the dept catalogue otherwise; same
    // for paediatric / pediatric, anaesthesia / anesthesia. Expand the
    // query into all known variants and match if ANY hit.
    const variants = this.spellingVariants(q);
    return list.filter(t => {
      const hay = [
        t.name,
        t.hsnSacCode ?? '',
        t.department?.name ?? ''
      ].join(' ').toLowerCase();
      return variants.some(v => hay.includes(v));
    });
  });

  /** Generate US/UK spelling variants of a search string so the catalogue
   *  matches regardless of which spelling the lab catalogue or the user
   *  typed. Cheap substring substitution; not a full medical thesaurus. */
  private spellingVariants(q: string): string[] {
    const swaps: Array<[string, string]> = [
      ['hema',   'haema'],   // hematology ↔ haematology
      ['pedia',  'paedia'],  // pediatric ↔ paediatric
      ['anesth', 'anaesth'], // anesthesia ↔ anaesthesia
      ['fetal',  'foetal'],  // fetal ↔ foetal
      ['leuk',   'leuc'],    // leukocyte ↔ leucocyte
    ];
    const out = new Set<string>([q]);
    for (const [us, uk] of swaps) {
      if (q.includes(us)) out.add(q.replace(us, uk));
      if (q.includes(uk)) out.add(q.replace(uk, us));
    }
    return Array.from(out);
  }

  /** Tests grouped by department, sorted by dept name. "(No department)"
   *  is a catch-all bucket so unclassified tests still render. Used by the
   *  catalog grid so admins can scan by dept rather than a flat list. */
  readonly filteredTestsByDept = computed<Array<{ department: string; tests: Test[] }>>(() => {
    const groups = new Map<string, Test[]>();
    for (const t of this.filteredTests()) {
      const key = t.department?.name?.trim() || '(No department)';
      const arr = groups.get(key);
      if (arr) arr.push(t); else groups.set(key, [t]);
    }
    return Array.from(groups.entries())
      .map(([department, tests]) => ({
        department,
        tests: tests.slice().sort((a, b) => a.name.localeCompare(b.name))
      }))
      .sort((a, b) => a.department.localeCompare(b.department));
  });

  readonly subtotal = computed(() =>
    this._selected()
      .map(id => this._tests().find(t => t.id === id)?.price ?? 0)
      .reduce((a, b) => a + b, 0)
  );
  readonly gst = computed(() => Math.round(this.subtotal() * 0.18));
  readonly total = computed(() => this.subtotal() + this.gst());

  /** Slowest test in the cart drives the report ETA. Packages count as
   *  the max of their member tests' tatHours. */
  readonly tatHours = computed<number>(() => {
    const all = this._tests();
    const sel = this._selected();
    let max = 0;
    for (const id of sel) {
      const t = all.find(x => x.id === id);
      if (!t) continue;
      if (t.type === 'package') {
        const memberIds = parsePackageMembers(t.parameters);
        for (const mid of memberIds) {
          const mt = all.find(x => x.id === mid);
          if (mt && Number.isFinite(mt.tatHours) && mt.tatHours > max) max = mt.tatHours;
        }
      } else if (Number.isFinite(t.tatHours) && t.tatHours > max) {
        max = t.tatHours;
      }
    }
    return max;
  });
  readonly tatLabel = computed<string>(() => {
    const h = this.tatHours();
    if (h <= 0) return '';
    if (h < 24) return `Report ready in ≈ ${h}h`;
    const d = Math.round(h / 24);
    return `Report ready in ≈ ${d} day${d === 1 ? '' : 's'}`;
  });

  /**
   * Package suggestions — when the cart contains individual tests that
   * are also bundled inside one or more packages, suggest the package(s)
   * that COVER ALL the picked individual tests so the patient saves
   * money. Sorted by package price ascending (cheapest deal first).
   *
   * Implementation: each package stores its member test ids inside the
   * `Parameters` JSON as { items: [{ testId: '...' }] } — same shape the
   * backend's OrderService.ParsePackageChildIds reads.
   */
  readonly packageSuggestions = computed<PackageSuggestion[]>(() => {
    const sel = new Set(this._selected());
    if (sel.size === 0) return [];
    const all = this._tests();
    const out: PackageSuggestion[] = [];
    for (const pkg of all) {
      if (pkg.type !== 'package' || !pkg.isActive) continue;
      // Skip if the package is already in the cart.
      if (sel.has(pkg.id)) continue;
      const memberIds = parsePackageMembers(pkg.parameters);
      if (memberIds.length === 0) continue;
      const memberSet = new Set(memberIds);
      // Only suggest if EVERY selected individual test is inside this
      // package. Filter out package-typed selections (rare edge case).
      const covered = [...sel].filter(id => {
        const t = all.find(x => x.id === id);
        return t && t.type !== 'package';
      });
      if (covered.length === 0) continue;
      const allCovered = covered.every(id => memberSet.has(id));
      if (!allCovered) continue;
      const individualSum = covered
        .map(id => all.find(t => t.id === id)?.price ?? 0)
        .reduce((a, b) => a + b, 0);
      const savings = Math.max(0, individualSum - pkg.price);
      out.push({
        package: pkg,
        coveredIds: covered,
        memberCount: memberIds.length,
        individualSum,
        savings
      });
    }
    // Cheapest-first per the user's preference: low value → high value.
    return out.sort((a, b) => a.package.price - b.package.price);
  });

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: l => this._tests.set(l ?? []),
      error: e => this.toasts.error(`Could not load tests: ${e?.message ?? 'unknown error'}`)
    });

    // Per-user pinned tests + recent test history. Both endpoints are
    // best-effort — if they fail the picker still works (tabs fall back to
    // "All"). Fire in parallel; either response order is fine.
    this.api.get<string[]>('/api/test-picker/favorites').subscribe({
      next: ids => this.favouriteIds.set(new Set(ids ?? [])),
      error: () => { /* silent: empty favourites list */ }
    });
    this.api.get<string[]>('/api/test-picker/recent').subscribe({
      next: ids => this.recentIds.set(ids ?? []),
      error: () => { /* silent: empty recent list */ }
    });

    // Deep-link support — if the route carries ?patientId= (e.g. coming
    // from a patient profile), pre-attach. Otherwise the inline picker
    // handles selection in-page.
    const pid = this.route.snapshot.queryParamMap.get('patientId');
    const fromOrderId = this.route.snapshot.queryParamMap.get('fromOrderId');
    const appointmentId = this.route.snapshot.queryParamMap.get('appointmentId');
    if (pid) {
      this.api.get<{ patient: Patient; history: HistoryRow[] }>(`/api/patients/${pid}`).subscribe({
        next: res => {
          this._patient.set(res.patient);
          // Preselection priority:
          //   1) localStorage draft for this patient
          //   2) ?fromOrderId=… (Repeat flow from a prior order)
          //   3) ?appointmentId=… → fetch the appointment's draft TestIds
          //      and pre-load them into the cart (reception just clicks Create)
          const restored = this.restoreDraftFor(pid);
          if (restored) return;
          if (fromOrderId) {
            const prior = (res.history ?? []).find(h => h.id === fromOrderId);
            if (prior) { this.preselectFromOrder(prior); return; }
          }
          if (appointmentId) this.preselectFromAppointment(appointmentId);
        },
        error: () => this.toasts.error('Could not load patient')
      });
    }
  }

  /** Hydrate the cart from an appointment's draft TestIds (CSV stored on
   *  AppointmentEntity.TestIds during booking). */
  private preselectFromAppointment(appointmentId: string) {
    this.api.get<{ id: string; testIds?: string | null } | null>(`/api/appointments/${appointmentId}`).subscribe({
      next: appt => {
        const csv = appt?.testIds ?? '';
        const ids = csv.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (ids.length === 0) return;
        this._selected.set(ids);
        this.toasts.info(`Pre-filled ${ids.length} test${ids.length === 1 ? '' : 's'} from the appointment`);
      },
      error: () => { /* soft-fail */ }
    });
  }

  /** Save the current cart to localStorage under the patient's id.
   *  No-op when there's no patient or nothing in the cart. */
  saveDraft() {
    const p = this._patient();
    if (!p) { this.toasts.warning('Pick a patient first'); return; }
    if (this._selected().length === 0) { this.toasts.info('Cart is empty — nothing to save'); return; }
    try {
      localStorage.setItem(this.DRAFT_KEY_PREFIX + p.id, JSON.stringify({
        savedAt: Date.now(),
        priority: this._priority(),
        testIds: this._selected()
      }));
      this._hasDraft.set(true);
      this.toasts.success('Saved as draft');
      // After saving there's nothing left to do here — return to FD so
      // reception can pick up the next patient. The draft survives in
      // localStorage and the next /frontdesk/order visit for the same
      // patient restores it automatically.
      this.router.navigateByUrl('/frontdesk');
    } catch {
      this.toasts.error('Could not save draft (storage full?)');
    }
  }

  /** Discard a saved draft for the current patient. */
  discardDraft() {
    const p = this._patient();
    if (!p) return;
    try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + p.id); } catch { /* ignore */ }
    this._hasDraft.set(false);
    this.toasts.info('Draft discarded');
  }

  /** Restore the saved draft (if any) for the supplied patient id.
   *  Returns true if a non-stale draft was applied. */
  private restoreDraftFor(patientId: string): boolean {
    let raw: string | null = null;
    try { raw = localStorage.getItem(this.DRAFT_KEY_PREFIX + patientId); } catch { return false; }
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { savedAt?: number; priority?: Priority; testIds?: string[] };
      if (!parsed?.savedAt || Date.now() - parsed.savedAt > this.DRAFT_TTL_MS) {
        try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + patientId); } catch { /* ignore */ }
        return false;
      }
      const ids = (parsed.testIds ?? []).filter(id => typeof id === 'string');
      if (ids.length === 0) return false;
      this._selected.set(ids);
      if (parsed.priority) this._priority.set(parsed.priority);
      this._hasDraft.set(true);
      this.toasts.info('Draft restored');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Repeat-from-prior-order helper. Pulls every test id that appeared on
   * the prior order's samples, intersects with the current tenant's
   * active test catalog so we don't preselect a test that's been
   * deactivated since, then sets the cart. Surfaces a toast summarising
   * what carried over and what was dropped so the user has a clear
   * audit trail.
   */
  private preselectFromOrder(prior: HistoryRow) {
    const want = new Set<string>();
    for (const s of prior.samples ?? []) {
      for (const t of s.tests ?? []) {
        const testId = (t as { test?: { id?: string }; testId?: string }).testId
                    ?? (t as { test?: { id?: string }; testId?: string }).test?.id;
        if (testId) want.add(testId);
      }
    }
    if (want.size === 0) {
      this.toasts.warning('Repeated order had no tests');
      return;
    }
    // Intersect with the catalog we just loaded so removed tests don't
    // ride along. The catalog list arrives async — re-run this once
    // _tests fills if it isn't there yet.
    const apply = () => {
      const ids = Array.from(want).filter(id => this._tests().some(x => x.id === id));
      this._selected.set(ids);
      const date = new Date(prior.createdAt);
      const human = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const dropped = want.size - ids.length;
      if (dropped > 0) {
        this.toasts.warning(`Repeated from ${human}: ${ids.length} carried over, ${dropped} no longer available`);
      } else {
        this.toasts.success(`Repeated from ${human}: ${ids.length} test${ids.length === 1 ? '' : 's'} added`);
      }
    };
    if (this._tests().length > 0) {
      apply();
    } else {
      // Re-attempt once tests load. Cheaper than wiring an effect for a
      // one-shot deep-link.
      const interval = setInterval(() => {
        if (this._tests().length > 0) {
          clearInterval(interval);
          apply();
        }
      }, 150);
      setTimeout(() => clearInterval(interval), 5000);
    }
  }

  setPriority(p: Priority) { this._priority.set(p); }
  setQuery(q: string) { this._query.set(q); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  isSelected(id: string): boolean { return this._selected().includes(id); }

  /** Swap the matching individual tests out of the cart and add the
   *  package in their place. The receptionist accepted the suggestion. */
  applyPackage(s: PackageSuggestion) {
    this._selected.update(cur => {
      const dropped = new Set(s.coveredIds);
      const next = cur.filter(id => !dropped.has(id));
      if (!next.includes(s.package.id)) next.push(s.package.id);
      return next;
    });
    this.toasts.success(`Switched to ${s.package.name} — saving ₹${s.savings}`);
  }
  findTest(id: string): Test | undefined { return this._tests().find(t => t.id === id); }

  toggleTest(t: Test) {
    this._selected.update(cur => cur.includes(t.id) ? cur.filter(id => id !== t.id) : [...cur, t.id]);
  }
  removeTest(id: string) {
    this._selected.update(cur => cur.filter(x => x !== id));
  }
  clearCart() { this._selected.set([]); }

  /** Click toggles a quick-package: add if missing, remove if already in cart.
   * Quietly mutates selection without flooding the toast stack — the cart
   * sidebar is the source of truth and visually reflects the change. */
  togglePackage(pkg: Test) {
    this._selected.update(cur =>
      cur.includes(pkg.id) ? cur.filter(id => id !== pkg.id) : [...cur, pkg.id]
    );
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
  changePatient() {
    this._patient.set(null);
    this.router.navigate([], { queryParams: { patientId: null }, queryParamsHandling: 'merge' });
  }
  goHome() { this.router.navigateByUrl('/frontdesk'); }

  submit() {
    const p = this._patient();
    if (!p || this._saving() || this._selected().length === 0) return;

    // If we arrived from an appointment check-in (?appointmentId=…),
    // tag the order so it traces back. Source flips to 'appointment'
    // so reports/queries can distinguish post-check-in orders from
    // pure walk-ins.
    const appointmentId = this.route.snapshot.queryParamMap.get('appointmentId');
    this._saving.set(true);
    this.api.post<Order>('/api/orders/', {
      patientId: p.id,
      refDoctorName: this.refDoctorName().trim() || null,
      priority: this._priority(),
      source: appointmentId ? 'appointment' : 'walkin',
      collectionType: 'walkin',
      testIds: this._selected(),
      metadataJson: appointmentId ? JSON.stringify({ appointmentId }) : null
    }).subscribe({
      next: order => {
        this._saving.set(false);
        // Order persisted — drop any saved draft for this patient.
        const pid = p.id;
        try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + pid); } catch { /* ignore */ }
        this._hasDraft.set(false);
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

  back() {
    if (window.history.length > 1) this.locationSvc.back();
    else this.router.navigateByUrl('/frontdesk');
  }

  // ── Favourites + ref doctor handlers ────────────────────────────

  /** Click handler for the star icon on a test card. Optimistic toggle —
   *  on API failure we revert and toast. */
  toggleFavourite(testId: string, ev?: Event): void {
    ev?.stopPropagation();
    const next = new Set(this.favouriteIds());
    const wasFav = next.has(testId);
    if (wasFav) next.delete(testId); else next.add(testId);
    this.favouriteIds.set(next);

    const obs = wasFav
      ? this.api.delete<unknown>(`/api/test-picker/favorites/${testId}`)
      : this.api.post<unknown>(`/api/test-picker/favorites/${testId}`, {});
    obs.subscribe({
      error: () => {
        // Revert.
        const revert = new Set(this.favouriteIds());
        if (wasFav) revert.add(testId); else revert.delete(testId);
        this.favouriteIds.set(revert);
        this.toasts.error('Could not update favourites');
      }
    });
  }

  setCategoryTab(tab: 'recent' | 'favourites' | 'packages' | 'all'): void {
    this.categoryTab.set(tab);
  }

  /** Reception types in the ref-doctor input — fetch suggestions debounced. */
  onRefDoctorInput(value: string): void {
    this.refDoctorName.set(value);
    this.refDoctorOpen.set(true);
    if (this.refDoctorDebounce) clearTimeout(this.refDoctorDebounce);
    this.refDoctorDebounce = setTimeout(() => {
      const q = value.trim();
      this.api.get<string[]>(`/api/test-picker/doctors${q ? `?q=${encodeURIComponent(q)}` : ''}`).subscribe({
        next: names => this.refDoctorSuggestions.set(names ?? []),
        error: () => this.refDoctorSuggestions.set([])
      });
    }, 200);
  }

  pickRefDoctor(name: string): void {
    this.refDoctorName.set(name);
    this.refDoctorOpen.set(false);
  }

  onRefDoctorBlur(): void {
    // Delay so a click on a suggestion fires before the popover hides.
    setTimeout(() => this.refDoctorOpen.set(false), 150);
  }

  onRefDoctorFocus(): void {
    // Show recent suggestions when the field is focused, even on empty input.
    if (this.refDoctorSuggestions().length === 0) {
      this.api.get<string[]>('/api/test-picker/doctors').subscribe({
        next: names => this.refDoctorSuggestions.set(names ?? []),
        error: () => undefined
      });
    }
    this.refDoctorOpen.set(true);
  }
}

/** Suggestion shown above the cart when picked individual tests are
 *  available as part of a cheaper package. */
interface PackageSuggestion {
  package: Test;
  /** Selected individual-test ids that this package contains. */
  coveredIds: string[];
  /** How many tests the package contains in total (covered + extras). */
  memberCount: number;
  /** Sum of the covered individual tests' prices (without GST). */
  individualSum: number;
  /** individualSum − package.price, clamped at 0. */
  savings: number;
}

/** Parse the package's `Parameters` JSON to extract member test ids.
 *  Mirrors the backend's OrderService.ParsePackageChildIds shape:
 *    { items: [{ testId: '<guid>' }, ...] }
 *  Returns [] for any malformed/missing payload — safe to call on
 *  every test, package or not. */
function parsePackageMembers(parametersJson: string | undefined | null): string[] {
  if (!parametersJson) return [];
  try {
    const parsed = JSON.parse(parametersJson) as { items?: Array<{ testId?: string }> };
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items
      .map(it => (it?.testId ?? '').trim())
      .filter(id => id.length > 0);
  } catch {
    return [];
  }
}
