import { Request, Response, NextFunction } from "express";
import { options, recommend } from "../service/ml-services";
import { recommendationBodySchema, RecommendationResponse, ApiErrorBody, FormOptions } from "../util/type";

export const Recommendation = async (req: Request, res: Response<RecommendationResponse | ApiErrorBody>, next: NextFunction) => {
  try {
    const parsed = recommendationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({ error: { message: `${issue?.path.join(".") || "body"}: ${issue?.message}`, status: 400 } });
      return;
    }
    const { topN, minCases, ...customer } = parsed.data;
    const out = await recommend({ customer, topN, minCases });
    res.json({ data: out.results, meta: out.meta });
  } catch (e) {
    next(e);
  }
};

export const getFormOptions = async (_req: Request, res: Response<{ data: FormOptions }>, next: NextFunction) => {
  try {
    res.json({ data: await options() });
  } catch (e) {
    next(e);
  }
}