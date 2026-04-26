/**
 * Validator ↔ tech conversation about a single test result. Mirrors
 * OrderTestCommentEntity on the backend. See that file for the full
 * semantic — in short:
 *   • parameterName == null → overall comment on the test
 *   • parameterName == "x"  → comment pinned to that parameter input
 *   • parentId == null      → root comment (starts a thread)
 *   • parentId == "x"       → flat reply to that root
 *   • commentType == 'observation' → tech-initiated thread
 *   • commentType == 'correction'  → validator-initiated thread
 */
export interface OrderTestComment {
  id: string;
  orderTestId: string;
  parameterName?: string | null;
  parentId?: string | null;
  commentType: 'observation' | 'correction';
  body: string;
  authorId: string;
  authorRole: 'tech' | 'validator';
  initiatedBy: 'tech' | 'validator';
  isResolved: boolean;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  createdAt: string;
  // Optional nested author entity returned by the backend's Include().
  author?: { id: string; firstName?: string; fathersName?: string; displayName?: string } | null;
}

/** Body posted to POST /api/results/:orderTestId/comments. */
export interface AddCommentRequest {
  parameterName?: string | null;
  parentId?: string | null;
  commentType: 'observation' | 'correction';
  body: string;
}

/** A flat thread = root comment + its replies in time order. */
export interface CommentThread {
  root: OrderTestComment;
  replies: OrderTestComment[];
}

/** Group flat comment list into threads. Comments without a parent are
 *  roots; replies hang off their parent's id. Roots come back in
 *  creation-order; replies inside each thread come back in creation-order. */
export function groupIntoThreads(comments: OrderTestComment[]): CommentThread[] {
  const byId = new Map<string, OrderTestComment>();
  for (const c of comments) byId.set(c.id, c);
  const repliesByParent = new Map<string, OrderTestComment[]>();
  const roots: OrderTestComment[] = [];
  for (const c of comments) {
    if (c.parentId) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId, arr);
    } else {
      roots.push(c);
    }
  }
  // Sort roots + replies by createdAt ascending (oldest first reads
  // like a conversation).
  roots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const arr of repliesByParent.values()) {
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return roots.map(root => ({
    root,
    replies: repliesByParent.get(root.id) ?? []
  }));
}
