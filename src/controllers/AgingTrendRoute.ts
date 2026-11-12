import { NextFunction, Request, Response } from "express";
import { ARError } from "../util/error"; // adjust to where ARError lives
import { getAgingTrend, jakartaToday, refreshRecentAgingSummary, type YearMonth } from "../service/AgingSummary";

// "2026-01" -> { year: 2026, month: 1 }
const parseYearMonth = (value: unknown, name: string): YearMonth => {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match) {
    throw new ARError(`\`${name}\` is required and must look like yyyy-MM (e.g. 2026-01)`, { status: 400 });
  }
  return { year: Number(match[1]), month: Number(match[2]) };
};

const shiftMonth = (ym: YearMonth, delta: number): YearMonth => {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
};

const fmt = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, "0")}`;

export async function getAgingTrendRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const today = jakartaToday(); // yyyy-mm-dd
    const current: YearMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };

    const m2 = parseYearMonth(req.query.m2 ?? fmt(current), "m2");
    const m1 = parseYearMonth(req.query.m1 ?? fmt(shiftMonth(m2, -1)), "m1");

    res.json(await getAgingTrend(m1, m2));
  } catch (err) {
    next(err); // your global handler turns ARError into { error: { message, status } }
  }
}

export async function refreshAgingCron(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      throw new ARError("Unauthorized", { status: 401 });
    }
    await refreshRecentAgingSummary();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}