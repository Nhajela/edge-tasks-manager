// Typed errors, mapped once per adapter (bot reply, server action result, MCP error, HTTP status).

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export class PermissionError extends ServiceError {
  constructor(message = "You can't do that.", details?: Record<string, unknown>) {
    super("PERMISSION_DENIED", message, details);
    this.name = "PermissionError";
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_FAILED", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends ServiceError {
  constructor(message = "Not found.", details?: Record<string, unknown>) {
    super("NOT_FOUND", message, details);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

export const TEXT_LIMITS = { title: 200, body: 20_000, comment: 4_000, name: 100 } as const;

export function requireText(value: unknown, field: string, max: number): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new ValidationError(`${field} is required.`, { field });
  if (v.length > max) throw new ValidationError(`${field} is longer than ${max} characters.`, { field, max });
  return v;
}

/** Safe message for users; unexpected errors get a generic one (log them at the adapter). */
export function errorMessage(e: unknown): string {
  return e instanceof ServiceError ? e.message : "Something went wrong. Try again.";
}
