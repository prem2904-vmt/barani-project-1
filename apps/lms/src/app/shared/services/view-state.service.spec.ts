import { Component, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { SessionScopeService } from '../../core/auth/session-scope.service';
import { ViewStateService } from './view-state.service';

/**
 * Screen view state (owner 2026-11-21): kept across in-app navigation, fresh on reload (memory only), sign-out,
 * user / tenant switch and branch switch; keys are isolated.
 */
function setup() {
  const branch = signal<string | null>('b1');
  TestBed.configureTestingModule({
    providers: [{ provide: AuthService, useValue: { activeBranchId: branch.asReadonly() } }],
  });
  const scope = TestBed.inject(SessionScopeService);
  scope.changed({ userId: 'u1', tenantId: 't1' });
  const vs = TestBed.inject(ViewStateService);
  return { vs, scope, branch };
}

@Component({ template: '' })
class Screen {
  readonly vs = TestBed.inject(ViewStateService);
  readonly range = signal<'today' | 'yesterday'>('today');
  readonly q = signal('');
  readonly restored = this.vs.bind('fd.work', { range: this.range, q: this.q });
}

describe('ViewStateService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('get / patch / clear one key', () => {
    const { vs } = setup();
    expect(vs.get('a')).toBeUndefined();
    vs.patch('a', { x: 1 });
    vs.patch('a', { y: 2 });
    expect(vs.get('a')).toEqual({ x: 1, y: 2 });
    expect(vs.value('a', 'y')).toBe(2);
    expect(vs.has('a')).toBe(true);
    vs.clear('a');
    expect(vs.get('a')).toBeUndefined();
  });

  it('keys are isolated (screen + tab), and a prefix clear only drops that family', () => {
    const { vs } = setup();
    vs.patch('lab.my-work', { tab: 'queue' });
    vs.patch('lab.my-work.queue', { q: 'cbc' });
    vs.patch('reports', { q: 'priya' });
    expect(vs.get('lab.my-work')).toEqual({ tab: 'queue' });
    expect(vs.get('lab.my-work.queue')).toEqual({ q: 'cbc' });
    vs.patch('lab.my-work', { tab: 'completed' });
    expect(vs.get('reports')).toEqual({ q: 'priya' });
    vs.clear('lab.');
    expect(vs.get('lab.my-work')).toBeUndefined();
    expect(vs.get('lab.my-work.queue')).toBeUndefined();
    expect(vs.get('reports')).toEqual({ q: 'priya' });
  });

  it('a returned bag is a copy (mutating it does not change the store)', () => {
    const { vs } = setup();
    vs.patch('a', { x: 1 });
    const b = vs.get('a')!;
    b['x'] = 9;
    expect(vs.value('a', 'x')).toBe(1);
  });

  it('sign-out clears everything', () => {
    const { vs, scope } = setup();
    vs.patch('fd.work', { range: 'yesterday' });
    scope.changed(null);
    expect(vs.get('fd.work')).toBeUndefined();
  });

  it('another user / tenant (Add account, no reload) gets fresh defaults', () => {
    const { vs, scope } = setup();
    vs.patch('fd.work', { range: 'yesterday' });
    scope.changed({ userId: 'u2', tenantId: 't1' });
    expect(vs.get('fd.work')).toBeUndefined();
    vs.patch('fd.work', { range: 'yesterday' });
    scope.changed({ userId: 'u2', tenantId: 't2' });
    expect(vs.get('fd.work')).toBeUndefined();
  });

  it('the same person re-publishing their profile keeps the state', () => {
    const { vs, scope } = setup();
    vs.patch('fd.work', { range: 'yesterday' });
    scope.changed({ userId: 'u1', tenantId: 't1', authId: 'sub' });
    expect(vs.get('fd.work')).toEqual({ range: 'yesterday' });
  });

  it('branch switch clears (even without an explicit clear call)', () => {
    const { vs, branch } = setup();
    vs.patch('fd.work', { range: 'yesterday' });
    branch.set('b2');
    expect(vs.get('fd.work')).toBeUndefined();
    vs.patch('fd.work', { range: 'tomorrow' });
    branch.set('b1');
    expect(vs.get('fd.work')).toBeUndefined();
  });

  it('clear() drops everything', () => {
    const { vs } = setup();
    vs.patch('a', { x: 1 });
    vs.patch('b', { x: 2 });
    vs.clear();
    expect(vs.get('a')).toBeUndefined();
    expect(vs.get('b')).toBeUndefined();
  });

  it('bind: defaults on the first visit, restores on the next (in-app navigation)', () => {
    setup();
    const f1 = TestBed.createComponent(Screen);
    expect(f1.componentInstance.restored).toBe(false);
    f1.componentInstance.range.set('yesterday');
    f1.componentInstance.q.set('priya');
    TestBed.tick();
    f1.destroy();

    const f2 = TestBed.createComponent(Screen);
    expect(f2.componentInstance.restored).toBe(true);
    expect(f2.componentInstance.range()).toBe('yesterday');
    expect(f2.componentInstance.q()).toBe('priya');
  });

  it('bind: after sign-out the screen comes back on its defaults', () => {
    const { scope } = setup();
    const f1 = TestBed.createComponent(Screen);
    f1.componentInstance.range.set('yesterday');
    TestBed.tick();
    f1.destroy();
    scope.changed(null);
    scope.changed({ userId: 'u1', tenantId: 't1' });
    const f2 = TestBed.createComponent(Screen);
    expect(f2.componentInstance.restored).toBe(false);
    expect(f2.componentInstance.range()).toBe('today');
  });

  it('bind: a screen alive across a branch switch never writes into the new branch', () => {
    const { vs, branch } = setup();
    const f1 = TestBed.createComponent(Screen);
    f1.componentInstance.range.set('yesterday');
    TestBed.tick();
    branch.set('b2');
    vs.clear();
    f1.componentInstance.q.set('late write');
    TestBed.tick();
    expect(vs.get('fd.work')).toBeUndefined();
  });

  it('bindControl restores and tracks a form control', () => {
    const { vs } = setup();
    const injector = TestBed.inject(Injector);
    const c1 = new FormControl('');
    expect(vs.bindControl('exp', 'q', c1, { injector })).toBe(false);
    c1.setValue('fuel');
    expect(vs.value('exp', 'q')).toBe('fuel');
    const c2 = new FormControl('');
    expect(vs.bindControl('exp', 'q', c2, { injector })).toBe(true);
    expect(c2.value).toBe('fuel');
  });
});
