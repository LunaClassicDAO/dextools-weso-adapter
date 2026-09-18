export interface Issue {
  code?: string;
  param?: string;
  message: string;
}

export interface ErrorBody {
  code: string;
  message: string;
  issues: Issue[];
}

export function errorBody(
  code: string,
  message: string,
  issues: Issue[] = [],
): ErrorBody {
  return { code, message, issues: issues.length ? issues : [{ message }] };
}

export function badRequest(
  message: string,
  param?: string,
): ErrorBody {
  return errorBody("BAD_REQUEST", message, [
    { code: "invalid_param", param, message },
  ]);
}

export function notFound(message: string, param?: string): ErrorBody {
  return errorBody("NOT_FOUND", message, [
    { code: "not_found", param, message },
  ]);
}

export function internal(message: string): ErrorBody {
  return errorBody("INTERNAL", message);
}
