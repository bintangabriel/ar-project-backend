import { Request, Response } from 'express';
import { getDashboardOverview } from "../service/Dashboard";

export async function getDashboardOverviewRoute(req: Request, res: Response) {
  const sp = req.query;
  const tm = sp.tm;
  const lm = sp.lm;
  const cabang = sp.cabang ?? undefined;

  if (!tm || !lm) {
    return res.status(400).json({ error: "tm and lm are required (yyyy-mm-dd)" });
  }

  try {
    const data = await getDashboardOverview({ thisMonth: tm, lastMonth: lm, cabang });
    return res.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    return res.status(500).json({ error: message });
  }
}