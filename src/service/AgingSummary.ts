import prisma from "../prisma";
import { Prisma } from "../generated/prisma/client";
import { ARError } from "../util/error"; // adjust to where ARError lives
import { getThresholds } from "./Dashboard";

/* ------------------------------------------------------------------ */
/* Buckets (thresholds come from .env via getThresholds)               */
/* ------------------------------------------------------------------ */
export type BucketKey = "B1" | "B2" | "B3" | "POWO";

export const getBuckets = (): { key: BucketKey; threshold: number }[] => {
  const t = getThresholds();
  return [
    { key: "B1", threshold: t.balance1 },
    { key: "B2", threshold: t.balance2 },
    { key: "B3", threshold: t.balance3 },
    { key: "POWO", threshold: t.powo },
  ];
};

/* ------------------------------------------------------------------ */
/* Date helpers (all calendar days are Asia/Jakarta, UTC+7)            */
/* ------------------------------------------------------------------ */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const toDbDate = (iso: string) => new Date(`${iso}T00:00:00Z`); // for @db.Date columns
const jakartaIso = (d: Date) => isoOf(new Date(d.getTime() + JAKARTA_OFFSET_MS));
export const jakartaToday = () => jakartaIso(new Date());

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return isoOf(new Date(Date.UTC(y!, m! - 1, d! + n)));
};

const dayRange = (iso: string) => {
  const start = new Date(`${iso}T00:00:00+07:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
};

const enumerate = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/* ------------------------------------------------------------------ */
/* 1. Compute one day's snapshot from the raw tables                   */
/* ------------------------------------------------------------------ */
type RawRow = { cnt: number; osa: string; b1: string; b2: string; b3: string; powo: string };

// The 1st of a month lives in ascii_aging_monthly, every other day in ascii_aging_daily.
async function aggregateDay(iso: string, source: "monthly" | "daily"): Promise<RawRow | null> {
  const t = getThresholds();
  const { start, end } = dayRange(iso);
  // Static identifiers from our own code, never user input.
  const table = Prisma.raw(source === "monthly" ? "ascii_aging_monthly" : "ascii_aging_daily");
  const dateCol = Prisma.raw(source === "monthly" ? "snapshot_date" : "date");

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::int AS cnt,
      COALESCE(SUM(saldo_ar), 0)::text AS osa,
      COALESCE(SUM(saldo_ar) FILTER (WHERE ovd_eom > ${t.balance1}), 0)::text AS b1,
      COALESCE(SUM(saldo_ar) FILTER (WHERE ovd_eom > ${t.balance2}), 0)::text AS b2,
      COALESCE(SUM(saldo_ar) FILTER (WHERE ovd_eom > ${t.balance3}), 0)::text AS b3,
      COALESCE(SUM(saldo_ar) FILTER (WHERE ovd_eom > ${t.powo}), 0)::text AS powo
    FROM ${table}
    WHERE ${dateCol} >= ${start} AND ${dateCol} < ${end}
  `);

  const row = rows[0];
  return row && row.cnt > 0 ? row : null;
}

async function computeSnapshot(iso: string) {
  const isFirstOfMonth = iso.endsWith("-01");
  let row = isFirstOfMonth ? await aggregateDay(iso, "monthly") : null;
  if (!row) row = await aggregateDay(iso, "daily"); // also the fallback if monthly has no rows
  if (!row) return null;

  return {
    osa: BigInt(row.osa),
    am: { B1: BigInt(row.b1), B2: BigInt(row.b2), B3: BigInt(row.b3), POWO: BigInt(row.powo) } as Record<BucketKey, bigint>,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Upsert am / bal for a list of dates                              */
/* ------------------------------------------------------------------ */
async function upsertDates(isos: string[]) {
  const buckets = getBuckets();

  for (const iso of isos) {
    const snap = await computeSnapshot(iso);
    if (!snap) continue; // no data for that day, so nothing to store

    await prisma.$transaction(
      buckets.map((b) => {
        const am = snap.am[b.key];
        const bal = snap.osa > 0n ? (Number(am) / Number(snap.osa)) * 100 : 0;
        return prisma.aging_daily_summary.upsert({
          where: { date_bucket: { date: toDbDate(iso), bucket: b.key } },
          create: { date: toDbDate(iso), bucket: b.key, threshold: b.threshold, osa_total: snap.osa, am, bal },
          update: { threshold: b.threshold, osa_total: snap.osa, am, bal },
        });
      })
    );
  }
}

/* ------------------------------------------------------------------ */
/* 3. penyelesaian = am(D + 1) - am(D)                                 */
/* ------------------------------------------------------------------ */
async function recomputePen(fromIso: string, toIso: string) {
  const rows = await prisma.aging_daily_summary.findMany({
    where: { date: { gte: toDbDate(fromIso), lte: toDbDate(addDays(toIso, 1)) } },
  });

  const amMap = new Map<string, bigint>();
  for (const r of rows) amMap.set(`${isoOf(r.date)}|${r.bucket}`, r.am);

  const updates = [];
  for (const r of rows) {
    const iso = isoOf(r.date);
    if (iso > toIso) continue; // the extra "+1" day is only a lookup
    const next = amMap.get(`${addDays(iso, 1)}|${r.bucket}`);
    const pen = next === undefined ? null : next - r.am;
    if (pen !== r.pen) {
      updates.push(prisma.aging_daily_summary.update({ where: { id: r.id }, data: { pen } }));
    }
  }
  for (let i = 0; i < updates.length; i += 100) {
    await prisma.$transaction(updates.slice(i, i + 100));
  }
}

/** Idempotent: safe to run many times / from several instances. */
export async function refreshAgingSummary(fromIso: string, toIso: string) {
  await upsertDates(enumerate(fromIso, toIso));
  // start 1 day earlier: yesterday's pen needs the first refreshed day
  await recomputePen(addDays(fromIso, -1), toIso);
}

/** Nightly job entry: re-computes the last N days to catch late imports. */
export async function refreshRecentAgingSummary() {
  const daysBack = Number(process.env.AGING_REFRESH_DAYS ?? 3);
  const today = jakartaToday();
  await refreshAgingSummary(addDays(today, -daysBack), today);
}

/** One-off: fill history. Defaults to the earliest date found in the raw tables. */
export async function backfillAgingSummary(fromIso?: string, toIso?: string) {
  let from = fromIso;
  if (!from) {
    const [d, m] = await Promise.all([
      prisma.ascii_aging_daily.aggregate({ _min: { date: true } }),
      prisma.ascii_aging_monthly.aggregate({ _min: { snapshot_date: true } }),
    ]);
    const candidates = [d._min.date, m._min.snapshot_date].filter(Boolean) as Date[];
    if (candidates.length === 0) return;
    from = jakartaIso(new Date(Math.min(...candidates.map((c) => c.getTime()))));
  }
  await refreshAgingSummary(from, toIso ?? jakartaToday());
}

/* ------------------------------------------------------------------ */
/* 4. Read model for the chart: any two months picked by the user      */
/* ------------------------------------------------------------------ */
export interface YearMonth {
  year: number;
  month: number;
}

/** Fields ending in 1 belong to the first month, fields ending in 2 to the second. */
export interface TrendPoint {
  day: number;
  am1: number | null;
  am2: number | null;
  /** am(day + 1) - am(day), as stored */
  pen1: number | null;
  pen2: number | null;
  /** percent of OSA, e.g. 1.28 */
  bal1: number | null;
  bal2: number | null;
}

export interface AgingTrendDTO {
  months: [YearMonth, YearMonth];
  buckets: { key: BucketKey; threshold: number; series: TrendPoint[] }[];
}

const assertYearMonth = (ym: YearMonth, name: string) => {
  if (!Number.isInteger(ym.year) || ym.year < 2000 || ym.year > 2100) {
    throw new ARError(name + " has an invalid year", { status: 400 });
  }
  if (!Number.isInteger(ym.month) || ym.month < 1 || ym.month > 12) {
    throw new ARError(name + " has an invalid month (1-12)", { status: 400 });
  }
};

export async function getAgingTrend(m1: YearMonth, m2: YearMonth): Promise<AgingTrendDTO> {
  assertYearMonth(m1, "m1");
  assertYearMonth(m2, "m2");

  const mm = (n: number) => String(n).padStart(2, "0");
  const monthRange = (ym: YearMonth) => ({
    gte: toDbDate(ym.year + "-" + mm(ym.month) + "-01"),
    lte: toDbDate(ym.year + "-" + mm(ym.month) + "-" + mm(daysInMonth(ym.year, ym.month))),
  });

  const rows = await prisma.aging_daily_summary.findMany({
    where: { OR: [{ date: monthRange(m1) }, { date: monthRange(m2) }] },
  });

  const buckets = getBuckets();
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    // ignore rows computed with an older threshold (e.g. .env was changed)
    const current = buckets.find((b) => b.key === r.bucket);
    if (current && current.threshold === r.threshold) byKey.set(isoOf(r.date) + "|" + r.bucket, r);
  }

  const num = (v: bigint | null | undefined) => (v == null ? null : Number(v));

  return {
    months: [m1, m2],
    buckets: buckets.map((b) => {
      const pick = (ym: YearMonth, day: number) =>
        day <= daysInMonth(ym.year, ym.month)
          ? byKey.get(ym.year + "-" + mm(ym.month) + "-" + mm(day) + "|" + b.key)
          : undefined;

      return {
        key: b.key,
        threshold: b.threshold,
        series: Array.from({ length: 31 }, (_, i): TrendPoint => {
          const day = i + 1;
          const a = pick(m1, day);
          const c = pick(m2, day);
          return {
            day,
            am1: num(a?.am),
            am2: num(c?.am),
            pen1: num(a?.pen),
            pen2: num(c?.pen),
            bal1: a?.bal ?? null,
            bal2: c?.bal ?? null,
          };
        }),
      };
    }),
  };
}