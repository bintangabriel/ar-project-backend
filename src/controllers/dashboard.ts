
import { Request, Response } from 'express';
import { getDashboardOverview } from "../service/Dashboard";

function getQueryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function getDashboardOverviewRoute(req: Request, res: Response) {
  const tm = getQueryString(req.query.tm);
  const lm = getQueryString(req.query.lm);
  const cabang = getQueryString(req.query.cabang);

  if (!tm || !lm) {
    return res.status(400).json({
      error: "tm and lm are required (yyyy-mm-dd)"
    });
  }

  try {
    const data = await getDashboardOverview({
      thisMonth: tm,
      lastMonth: lm,
      ...(cabang !== undefined && { cabang })
    });

    return res.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    return res.status(500).json({ error: message });
  }
}
