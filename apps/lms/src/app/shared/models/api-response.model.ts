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
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Normalize ANY error (ApiError, HttpErrorResponse, Error) into ApiError. */
  static from(e: unknown): ApiError {
    if (e instanceof ApiError) return e;
    const anyE = e as { error?: { error?: string; message?: string; field?: string }; message?: string };
    const body = anyE?.error;
    if (body && typeof body === 'object' && (body.message || body.error)) {
      return new ApiError(body.message ?? body.error ?? 'Request failed', body.error, body.field);
    }
    return new ApiError(anyE?.message ?? 'Request failed');
  }
}
