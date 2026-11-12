import { ARError } from "../util/error";
// Thin client for the internal Python ML service (Node >= 18 has fetch built in).
import type { Customer, FormOptions, MlRecommendResponse } from "../util/type";

const TIMEOUT_MS = 10_000;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": process.env.ML_SERVICE_KEY ?? "",
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ARError("Recommendation service is unavailable", { status: 502 });
  }
  if (!res.ok) throw new ARError("Recommendation service error", { status: res.status === 422 ? 400 : 502 });
  return (await res.json()) as T;
}

export const recommend = (body: { customer: Customer; topN: number; minCases: number }) =>
  call<MlRecommendResponse>("/recommend", { method: "POST", body: JSON.stringify(body) });

export const options = () => call<FormOptions>("/options");
