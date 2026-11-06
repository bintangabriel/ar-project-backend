// src/routes/skDashboard.ts
import { Response, Router, Request } from 'express';
import { Prisma } from '../generated/prisma/client';
import prisma from '../prisma';

const WINDOW_DAYS = 8;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// midnight today in WIB, expressed as a UTC Date
function startOfTodayWIB(): Date {
  const wibNow = new Date(Date.now() + WIB_OFFSET_MS);
  return new Date(
    Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate()) - WIB_OFFSET_MS
  );
}

// "2026-10" -> [start, end) in UTC, aligned to WIB month boundaries
function monthRangeWIB(period: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return {
    start: new Date(Date.UTC(y, mo, 1) - WIB_OFFSET_MS),
    end: new Date(Date.UTC(y, mo + 1, 1) - WIB_OFFSET_MS),
  };
}

export async function getDashboardData(req: Request, res: Response) {
  try {
    // ---- dropdown options (not affected by the current selection) ----
    const [periodRows, areaRows, peojfRows] = await Promise.all([
      prisma.$queryRaw<{ period: string }[]>`
        SELECT DISTINCT to_char(date AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS period
        FROM ascii_sk
        WHERE date IS NOT NULL
        ORDER BY period DESC`,
      prisma.ascii_sk.findMany({
        where: { remo: { not: null } },
        distinct: ['remo'],
        select: { remo: true },
        orderBy: { remo: 'asc' },
      }),
      prisma.ascii_sk.findMany({
        where: { peojf: { not: null } },
        distinct: ['peojf'],
        select: { peojf: true },
        orderBy: { peojf: 'asc' },
      }),
    ]);

    const periods = periodRows.map((r) => r.period);
    const areas = ['All', ...areaRows.map((r) => r.remo!)];
    const peojfOptions = ['All', ...peojfRows.map((r) => r.peojf!)];

    // ---- filters ----
    const period = (req.query.period as string) || periods[0];
    const area = (req.query.area as string) || 'All';
    const peojf = (req.query.peojf as string) || 'All';

    if (!period) {
      return res.json({
        summary: { total: 0, success: 0, inProgress: 0, failed: 0 },
        rows: [], periods, areas, peojfOptions,
      });
    }

    const range = monthRangeWIB(period);
    if (!range) return res.status(400).json({ error: 'period must be YYYY-MM' });

    const cutoff = new Date(startOfTodayWIB().getTime() - WINDOW_DAYS * DAY_MS);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`date >= ${range.start}`,
      Prisma.sql`date < ${range.end}`,
      Prisma.sql`peojf IS NOT NULL`,
    ];
    if (area !== 'All') conditions.push(Prisma.sql`remo = ${area}`);
    if (peojf !== 'All') conditions.push(Prisma.sql`peojf = ${peojf}`);

    // ---- aggregate per PEOJF in one query ----
    const raw = await prisma.$queryRaw<
      { peojf: string; total: number; success: number; in_progress: number; failed: number }[]
    >`
      SELECT
        peojf,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_success = true)::int AS success,
        COUNT(*) FILTER (WHERE is_success IS DISTINCT FROM true AND date >= ${cutoff})::int AS in_progress,
        COUNT(*) FILTER (WHERE is_success IS DISTINCT FROM true AND date <  ${cutoff})::int AS failed
      FROM ascii_sk
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY peojf
      ORDER BY peojf`;

    const rows = raw.map((r) => ({
      id: r.peojf,
      name: r.peojf,
      totalSk: r.total,
      skSuccess: r.success,
    }));

    const summary = raw.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        success: acc.success + r.success,
        inProgress: acc.inProgress + r.in_progress,
        failed: acc.failed + r.failed,
      }),
      { total: 0, success: 0, inProgress: 0, failed: 0 }
    );

    res.json({ summary, rows, periods, areas, peojfOptions });
  } catch (e) {
    console.error('[sk/dashboard]', e);
    res.status(500).json({ error: 'internal error' });
  }
};

export default router;