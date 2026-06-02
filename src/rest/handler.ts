import { evaluateSignal, evaluateSignals } from "../core/index.js";
import type {
  CoreSignalEvaluationOptions,
  FreshContextSignalInput,
} from "../core/index.js";

const SERVICE_VERSION = "0.1.0";
const JSON_CONTENT_TYPE = "application/json";
const MAX_BODY_BYTES = 256 * 1024;

type RestErrorCode =
  | "invalid_request"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "payload_too_large"
  | "not_found"
  | "internal_error";

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": JSON_CONTENT_TYPE },
  });
}

function errorResponse(code: RestErrorCode, message: string, status: number, details: unknown[] = []): Response {
  return jsonResponse({ error: { code, message, details } }, status);
}

function methodNotAllowed(allowed: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "method_not_allowed",
        message: `Method not allowed. Use ${allowed}.`,
        details: [],
      },
    }),
    {
      status: 405,
      headers: {
        "Content-Type": JSON_CONTENT_TYPE,
        "Allow": allowed,
      },
    }
  );
}

function isJsonContentType(request: Request): boolean {
  return (request.headers.get("Content-Type") ?? "").toLowerCase().includes(JSON_CONTENT_TYPE);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: Request): Promise<{ ok: true; body: JsonRecord } | { ok: false; response: Response }> {
  if (!isJsonContentType(request)) {
    return {
      ok: false,
      response: errorResponse("unsupported_media_type", "POST requests require Content-Type: application/json.", 415),
    };
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse("payload_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes.`, 413),
    };
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse("payload_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes.`, 413),
    };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return {
        ok: false,
        response: errorResponse("invalid_request", "Request body must be a JSON object.", 400),
      };
    }
    return { ok: true, body: parsed };
  } catch {
    return {
      ok: false,
      response: errorResponse("invalid_request", "Request body must be valid JSON.", 400),
    };
  }
}

function optionsFromBody(body: JsonRecord): CoreSignalEvaluationOptions | undefined {
  if (body.options === undefined) return undefined;
  return isRecord(body.options) ? body.options as CoreSignalEvaluationOptions : {};
}

async function handleEvaluate(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  if (!isRecord(parsed.body.signal)) {
    return errorResponse("invalid_request", "Request body must include signal.", 400);
  }

  const result = evaluateSignal(
    parsed.body.signal as unknown as FreshContextSignalInput,
    optionsFromBody(parsed.body)
  );
  return jsonResponse(result);
}

async function handleEvaluateBatch(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  if (!Array.isArray(parsed.body.signals)) {
    return errorResponse("invalid_request", "Request body must include signals array.", 400);
  }

  const result = evaluateSignals(
    parsed.body.signals as unknown as FreshContextSignalInput[],
    optionsFromBody(parsed.body)
  );
  return jsonResponse({ evaluations: result });
}

function handleHealth(request: Request): Response {
  if (request.method !== "GET") return methodNotAllowed("GET");
  return jsonResponse({
    ok: true,
    service: "freshcontext-rest",
    version: SERVICE_VERSION,
    core_available: true,
  });
}

export async function handleRestRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/v1/health") return handleHealth(request);
    if (url.pathname === "/v1/evaluate") return handleEvaluate(request);
    if (url.pathname === "/v1/evaluate-batch") return handleEvaluateBatch(request);

    return errorResponse("not_found", `Not found: ${url.pathname}.`, 404);
  } catch {
    return errorResponse("internal_error", "Unexpected REST host error.", 500);
  }
}
