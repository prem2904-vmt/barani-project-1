import { groupIntoThreads, OrderTestComment } from './comment.model';

const makeComment = (overrides: Partial<OrderTestComment> = {}): OrderTestComment => ({
  id: 'c1',
  orderTestId: 'ot1',
  commentType: 'observation',
  body: 'test',
  authorId: 'a1',
  authorRole: 'tech',
  initiatedBy: 'tech',
  isResolved: false,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('groupIntoThreads', () => {
  it('returns empty array for empty input', () => {
    expect(groupIntoThreads([])).toEqual([]);
  });

  it('groups a single root comment with no replies', () => {
    const root = makeComment({ id: 'c1', parentId: undefined });
    const threads = groupIntoThreads([root]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root).toEqual(root);
    expect(threads[0].replies).toEqual([]);
  });

  it('groups a root comment with null parentId', () => {
    const root = makeComment({ id: 'c1', parentId: null });
    const threads = groupIntoThreads([root]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root).toEqual(root);
    expect(threads[0].replies).toEqual([]);
  });

  it('groups root comment and its single reply', () => {
    const root = makeComment({ id: 'root1', parentId: undefined, createdAt: '2026-01-01T00:00:00Z' });
    const reply = makeComment({ id: 'reply1', parentId: 'root1', createdAt: '2026-01-01T01:00:00Z' });
    const threads = groupIntoThreads([root, reply]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe('root1');
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].id).toBe('reply1');
  });

  it('groups root comment and multiple replies in creation order', () => {
    const root = makeComment({ id: 'root1', parentId: undefined, createdAt: '2026-01-01T00:00:00Z' });
    const reply1 = makeComment({ id: 'reply1', parentId: 'root1', createdAt: '2026-01-01T02:00:00Z' });
    const reply2 = makeComment({ id: 'reply2', parentId: 'root1', createdAt: '2026-01-01T01:00:00Z' });
    const reply3 = makeComment({ id: 'reply3', parentId: 'root1', createdAt: '2026-01-01T03:00:00Z' });
    const threads = groupIntoThreads([root, reply1, reply2, reply3]);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map(r => r.id)).toEqual(['reply2', 'reply1', 'reply3']);
  });

  it('groups multiple root comments and preserves their creation order', () => {
    const root1 = makeComment({ id: 'root1', parentId: undefined, createdAt: '2026-01-01T02:00:00Z' });
    const root2 = makeComment({ id: 'root2', parentId: undefined, createdAt: '2026-01-01T00:00:00Z' });
    const root3 = makeComment({ id: 'root3', parentId: undefined, createdAt: '2026-01-01T01:00:00Z' });
    const threads = groupIntoThreads([root1, root2, root3]);
    expect(threads).toHaveLength(3);
    expect(threads.map(t => t.root.id)).toEqual(['root2', 'root3', 'root1']);
  });

  it('separates comments into different threads by parentId', () => {
    const root1 = makeComment({ id: 'root1', parentId: undefined, createdAt: '2026-01-01T00:00:00Z' });
    const reply1a = makeComment({ id: 'reply1a', parentId: 'root1', createdAt: '2026-01-01T01:00:00Z' });
    const root2 = makeComment({ id: 'root2', parentId: undefined, createdAt: '2026-01-01T02:00:00Z' });
    const reply2a = makeComment({ id: 'reply2a', parentId: 'root2', createdAt: '2026-01-01T03:00:00Z' });
    const threads = groupIntoThreads([root1, reply1a, root2, reply2a]);
    expect(threads).toHaveLength(2);
    expect(threads[0].root.id).toBe('root1');
    expect(threads[0].replies.map(r => r.id)).toEqual(['reply1a']);
    expect(threads[1].root.id).toBe('root2');
    expect(threads[1].replies.map(r => r.id)).toEqual(['reply2a']);
  });

  it('handles orphaned replies (parent not in list) by collecting them under their parentId', () => {
    const reply1 = makeComment({ id: 'reply1', parentId: 'root1' });
    const reply2 = makeComment({ id: 'reply2', parentId: 'root1' });
    const threads = groupIntoThreads([reply1, reply2]);
    // Orphaned replies should not create a thread (no root in the list)
    expect(threads).toHaveLength(0);
  });

  it('sorts roots and replies independently by createdAt ascending', () => {
    const root1 = makeComment({ id: 'root1', parentId: undefined, createdAt: '2026-01-02T00:00:00Z' });
    const root2 = makeComment({ id: 'root2', parentId: undefined, createdAt: '2026-01-01T00:00:00Z' });
    const reply1a = makeComment({ id: 'reply1a', parentId: 'root1', createdAt: '2026-01-05T00:00:00Z' });
    const reply1b = makeComment({ id: 'reply1b', parentId: 'root1', createdAt: '2026-01-03T00:00:00Z' });
    const threads = groupIntoThreads([root1, root2, reply1a, reply1b]);
    expect(threads[0].root.id).toBe('root2');
    expect(threads[1].root.id).toBe('root1');
    expect(threads[1].replies.map(r => r.id)).toEqual(['reply1b', 'reply1a']);
  });

  it('preserves comment object references (no copies)', () => {
    const root = makeComment({ id: 'root1', parentId: undefined });
    const threads = groupIntoThreads([root]);
    expect(threads[0].root).toBe(root);
  });

  it('preserves reply object references', () => {
    const root = makeComment({ id: 'root1', parentId: undefined });
    const reply = makeComment({ id: 'reply1', parentId: 'root1' });
    const threads = groupIntoThreads([root, reply]);
    expect(threads[0].replies[0]).toBe(reply);
  });

  it('handles comments with different parameterNames independently', () => {
    const rootParam1 = makeComment({ id: 'c1', parentId: undefined, parameterName: 'param1', createdAt: '2026-01-01T00:00:00Z' });
    const replyParam1 = makeComment({ id: 'c2', parentId: 'c1', parameterName: 'param1', createdAt: '2026-01-01T01:00:00Z' });
    const rootParam2 = makeComment({ id: 'c3', parentId: undefined, parameterName: 'param2', createdAt: '2026-01-01T02:00:00Z' });
    const threads = groupIntoThreads([rootParam1, replyParam1, rootParam2]);
    expect(threads).toHaveLength(2);
    expect(threads[0].root.parameterName).toBe('param1');
    expect(threads[1].root.parameterName).toBe('param2');
  });

  it('handles complex interleaved input: multiple roots with multiple replies', () => {
    const root1 = makeComment({ id: 'r1', parentId: undefined, createdAt: '2026-01-01T00:00:00Z' });
    const root2 = makeComment({ id: 'r2', parentId: undefined, createdAt: '2026-01-02T00:00:00Z' });
    const reply1a = makeComment({ id: 'rep1a', parentId: 'r1', createdAt: '2026-01-01T01:00:00Z' });
    const reply2a = makeComment({ id: 'rep2a', parentId: 'r2', createdAt: '2026-01-02T01:00:00Z' });
    const reply1b = makeComment({ id: 'rep1b', parentId: 'r1', createdAt: '2026-01-01T02:00:00Z' });
    const reply2b = makeComment({ id: 'rep2b', parentId: 'r2', createdAt: '2026-01-02T02:00:00Z' });
    const threads = groupIntoThreads([root1, reply1a, root2, reply2a, reply1b, reply2b]);
    expect(threads).toHaveLength(2);
    expect(threads[0].root.id).toBe('r1');
    expect(threads[0].replies.map(r => r.id)).toEqual(['rep1a', 'rep1b']);
    expect(threads[1].root.id).toBe('r2');
    expect(threads[1].replies.map(r => r.id)).toEqual(['rep2a', 'rep2b']);
  });

  it('handles comments with undefined author field', () => {
    const root = makeComment({ id: 'root1', parentId: undefined, author: undefined });
    const reply = makeComment({ id: 'reply1', parentId: 'root1', author: { id: 'a1', displayName: 'Alice' } });
    const threads = groupIntoThreads([root, reply]);
    expect(threads[0].root.author).toBeUndefined();
    expect(threads[0].replies[0].author?.displayName).toBe('Alice');
  });
});
