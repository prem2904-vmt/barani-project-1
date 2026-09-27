import { Conversation } from './chat.model';
import { conversationDisambiguator, conversationPeerId, emailHandle } from './conversation-name';

const ME = 'me';
const c = (id: string, peer: { id: string; name: string; email?: string }, extra: Partial<Conversation> = {}): Conversation => ({
  id, isGroup: false, name: null, createdById: ME, lastMessageAt: '', unreadCount: 0, lastMessage: null,
  participants: [{ userId: ME, displayName: 'Me', email: '' }, { userId: peer.id, displayName: peer.name, email: peer.email ?? '' }],
  ...extra,
});

/** Owner 2026-09-27: "Front Desk" twice under Recent. */
describe('conversationDisambiguator', () => {
  it('a record-anchored thread shows its context (same colleague, general + per-patient chats)', () => {
    const general = c('c1', { id: 'fd1', name: 'Front Desk' });
    const anchored = c('c2', { id: 'fd1', name: 'Front Desk' }, { contextType: 'patient', contextId: 'p1', contextLabel: 'Ravi Kumar · 26117' });
    const all = [general, anchored];
    expect(conversationDisambiguator(anchored, ME, all)).toBe('Ravi Kumar · 26117');
    // The general thread needs no label — the anchored one carries its context.
    expect(conversationDisambiguator(general, ME, all)).toBeNull();
  });

  it('two different people with the same name → their login handle', () => {
    const a = c('c1', { id: 'fd1', name: 'Front Desk', email: 'frontdesk.annanagar@abc.tenant.prefrontal' });
    const b = c('c2', { id: 'fd2', name: 'Front Desk', email: 'frontdesk.tnagar@abc.tenant.prefrontal' });
    expect(conversationDisambiguator(a, ME, [a, b])).toBe('@frontdesk.annanagar');
    expect(conversationDisambiguator(b, ME, [a, b])).toBe('@frontdesk.tnagar');
  });

  it('a group that shares a person\'s name says it is a group', () => {
    const person = c('c1', { id: 'fd1', name: 'Front Desk' });
    const group: Conversation = { ...c('c2', { id: 'x', name: 'X' }), isGroup: true, name: 'Front Desk' };
    expect(conversationDisambiguator(group, ME, [person, group])).toBe('Group · 2 members');
  });

  it('unique titles need nothing', () => {
    const a = c('c1', { id: 'u1', name: 'Priya Sharma' });
    const b = c('c2', { id: 'u2', name: 'Muthu Raj' });
    expect(conversationDisambiguator(a, ME, [a, b])).toBeNull();
  });

  it('peer id + email handle helpers', () => {
    expect(conversationPeerId(c('c1', { id: 'u1', name: 'A' }), ME)).toBe('u1');
    expect(conversationPeerId({ ...c('c1', { id: 'u1', name: 'A' }), isGroup: true }, ME)).toBeNull();
    expect(emailHandle('someone@lab.com')).toBe('someone@lab.com');
    expect(emailHandle('')).toBe('');
  });
});
