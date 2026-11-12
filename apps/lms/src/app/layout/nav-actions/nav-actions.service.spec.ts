import { TemplateRef } from '@angular/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NavActionsService } from './nav-actions.service';

describe('NavActionsService', () => {
  const t = (): TemplateRef<unknown> => ({}) as TemplateRef<unknown>;

  it('starts empty, shows what a page lends and clears it', () => {
    const s = new NavActionsService();
    const a = {};
    expect(s.template()).toBeNull();
    const tpl = t();
    s.show(a, tpl);
    expect(s.template()).toBe(tpl);
    s.clear(a);
    expect(s.template()).toBeNull();
  });

  it('only the owner can take the slot back; a newer page keeps its own', () => {
    const s = new NavActionsService();
    const a = {}, b = {};
    const ta = t(), tb = t();
    s.show(a, ta);
    s.show(b, tb);
    s.clear(a);
    expect(s.template()).toBe(tb);
    s.clear(b);
    expect(s.template()).toBeNull();
  });
});

describe('the bottom nav renders the slot', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.html'), 'utf8');

  it('on the right, before Messages / bell / avatar, outside the work-area branch', () => {
    const slot = html.indexOf('data-nav-actions');
    const right = html.indexOf('class="pf-ts-right');
    const chat = html.indexOf('pf-chat-btn press');
    expect(slot).toBeGreaterThan(right);
    expect(slot).toBeLessThan(chat);
    expect(html).toContain('navActions.template()');
  });
});
