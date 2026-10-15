// app/api/aging/route.ts
import { Request, Response } from "express";
import prisma from "../prisma"; // adjust to where your prisma file lives
import { Prisma } from "../generated/prisma/client"; // adjust to your generated client path

// Overdue buckets: "bal > N" sums saldo_ar where ovd_eom > N.
// Add / remove thresholds here and the response follows automatically.
const OVD_THRESHOLDS = [30, 60, 90, 120, 180, 360] as const;

const toNum = (v: Prisma.Decimal | null | undefined) => (v ? Number(v) : 0);

/**
 * GET /api/aging?date=2026-08-04&cabang=12
 *
 * date   (required) yyyy-mm-dd, matches the whole day of `date` column
 * cabang (optional) id_mst_wilayah; omit or "all" for every branch
 */
export async function GET(req: Request, res: Response) {
  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get("date");
  const cabang = searchParams.get("cabang");

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({
      error: "Query param `date` is required (format yyyy-mm-dd)"
    });
  }

  // Whole-day range. Anchored at Jakarta time (UTC+7) so the day matches what the user picked.
  const start = new Date(`${dateStr}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const where: Prisma.ascii_aging_dailyWhereInput = {
    date: { gte: start, lt: end },
  };

  if (cabang && cabang !== "all") {
    const id = Number(cabang);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "`cabang` must be an integer id" });
    }
    where.id_mst_wilayah = id;
  }

  try {
    const [totalAgg, ...bucketAggs] = await Promise.all([
      prisma.ascii_aging_daily.aggregate({
        where,
        _sum: { saldo_ar: true },
        _count: { _all: true },
      }),
      ...OVD_THRESHOLDS.map((n) =>
        prisma.ascii_aging_daily.aggregate({
          where: { ...where, ovd_eom: { gt: n } },
          _sum: { saldo_ar: true },
        })
      ),
    ]);

    const osaTotal = toNum(totalAgg._sum.saldo_ar);

    const buckets = OVD_THRESHOLDS.map((n, i) => {
      const bal = toNum(bucketAggs?.[i]?._sum.saldo_ar);
      return {
        label: `>${n}`,
        threshold: n,
        bal,
        // % to OSA = bucket sum / sum of all saldo_ar on that date
        pctToOsa: osaTotal !== 0 ? (bal / osaTotal) * 100 : 0,
      };
    });

    return res.json({
      date: dateStr,
      cabang: cabang ?? "all",
      osaTotal,
      count: totalAgg._count._all, // all customers/rows on that date
      buckets,
    });
  } catch (err) {
    console.error("[GET /api/aging]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}