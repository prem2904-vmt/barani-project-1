export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  /** The form field the error belongs to (e.g. "email", "username") —
   *  set by the backend so the UI can highlight the offending input. */
  field?: string;
}

/** Structured API failure. Every ApiService error is one of these, so pages
 *  can route field-level failures to the offending input:
 *
 *    error: e => {
 *      const err = ApiError.from(e);
 *      if (err.field === 'username') this.usernameError.set(err.message);
 *      else this.toasts.error(err.message);
 *    }
 */
export class ApiError extends Error {
  constructor(
    message: string,
    /** Machine code, e.g. "email_exists", "duplicate", "validation". */
    public readonly code?: string,
    /** Offending form field, e.g. "email" — highlight this input. */
    public readonly field?: string,
    /** The error's payload (mw `CodedConflictException.Payload`, e.g.
     *  `family_in_use` → `{ tests: [...] }`); absent for most errors. */
    public readonly data?: unknown,
    /** The HTTP status, when the failure came from one (0 = no connection). */
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Back-compat shim: lots of existing handlers read `e.error.message` /
   *  `e.error.error` / `e.error.field` (the old HttpErrorResponse body shape).
   *  Exposing this getter keeps every un-migrated component working unchanged
   *  while new code uses the flat `.code` / `.field` / `.message`. */
  get error(): { message: string; error?: string; field?: string } {
    return { message: this.message, error: this.code, field: this.field };
  }

  /** Normalize ANY error (ApiError, HttpErrorResponse, Error) into ApiError. */
  static from(e: unknown): ApiError {
    if (e instanceof ApiError) return e;
    const anyE = e as { error?: { error?: string; message?: string; field?: string; data?: unknown }; message?: string };
    const body = anyE?.error;
    if (body && typeof body === 'object' && !(body instanceof Error) && (body.message || body.error)) {
      return new ApiError(body.message ?? body.error ?? 'Request failed', body.error, body.field, body.data, httpStatus(e));
    }
    // No server-authored words (an empty or non-JSON body: a gateway error, a dropped connection): say it in
    // plain language by status, never Angular's "Http failure response for https://…: 500 …" text.
    const plain = plainStatusMessage((e as { status?: unknown })?.status, e instanceof Error || (e as { name?: string })?.name === 'HttpErrorResponse');
    if (plain) return new ApiError(plain, undefined, undefined, undefined, httpStatus(e));
    return new ApiError(anyE?.message ?? 'Request failed', undefined, undefined, undefined, httpStatus(e));
  }
}

function httpStatus(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

/** Plain words for an HTTP failure that carried no message of its own (null: not an HTTP failure). */
export function plainStatusMessage(status: unknown, isHttp: boolean): string | null {
  if (!isHttp || typeof status !== 'number') return null;
  if (status === 0) return "Can't reach the server. Check your internet connection and try again.";
  if (status === 401) return 'Your session has ended. Sign in again.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return 'That could not be found.';
  if (status === 408 || status === 504) return 'The server took too long to answer. Try again in a moment.';
  if (status === 429) return 'Too many requests. Wait a moment, then try again later.';
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  return null;
}
