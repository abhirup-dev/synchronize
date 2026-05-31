export interface HttpErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } } satisfies HttpErrorBody,
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  return jsonResponse(
    { error: { code: "internal_error", message } } satisfies HttpErrorBody,
    { status: 500 },
  );
}
