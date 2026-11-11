import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

/** Request body of POST /recommendation. The TypeScript type is derived from this schema, so they cannot drift apart. */
export const recommendationBodySchema = z
  .object({
    pekerjaan: text(100).min(1),
    sumberDana: text(100).min(1),
    rincianSumberDana: text(300).default(""),
    ansusDetail: text(2000).default(""),
    keberadaanDebitur: text(100).min(1),
    keberadaanUnit: text(100).min(1),
    kategoriKasus: text(100).min(1),
    topN: z.number().int().min(1).max(20).default(5),
    minCases: z.number().int().min(0).max(1000).default(20),
  })
  .strict();

export type RecommendationBody = z.infer<typeof recommendationBodySchema>;
export type Customer = Omit<RecommendationBody, "topN" | "minCases">;

// ---- what the Python ML service returns (keep in sync with ml-service/registry.py + app.py) ----
export interface RecommendationItem {
  rank: number;
  peojf: string;
  probability: number;          // 0..1
  nCases: number;
  overallRate: number | null;
}

export interface GroupResult {
  available: boolean;
  label: string;
  reason?: string;
  items: RecommendationItem[];
}

export type GroupName = "pay" | "cr";

export interface MlRecommendResponse {
  results: Record<GroupName, GroupResult>;
  meta: { topN: number; minCases: number };
}

export interface FormOptions {
  pekerjaan: string[];
  sumberDana: string[];
  keberadaanDebitur: string[];
  keberadaanUnit: string[];
  kategoriKasus: string[];
}

/** What this API sends back to the Next.js app. */
export interface RecommendationResponse {
  data: Record<GroupName, GroupResult>;
  meta: MlRecommendResponse["meta"];
}

/** Error body shape that the frontend fetchClient reads: { error: { message, status } } */
export interface ApiErrorBody {
  code?: string;
  error: { message: string; status: number };
}
