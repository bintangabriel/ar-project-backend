import prisma from "../prisma"; // adjust to where your prisma file lives
import { Prisma } from "../generated/prisma/client"; // adjust to your generated client path

/* ------------------------------------------------------------------ */
/* Config (adjustable from .env)                                       */
/* ------------------------------------------------------------------ */
// .env example:
//   BALANCE_THRESHOLD_1=60
//   BALANCE_THRESHOLD_2=90
//   BALANCE_THRESHOLD_3=120
//   POWO_THRESHOLD=150
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : fallback;
};

export const getThresholds = () => ({
  balance1: num(process.env.BALANCE_THRESHOLD_1, 60),
  balance2: num(process.env.BALANCE_THRESHOLD_2, 90),
  balance3: num(process.env.BALANCE_THRESHOLD_3, 120),
  powo: num(process.env.POWO_THRESHOLD, 150),
});

/* ------------------------------------------------------------------ */
/* Types (match the frontend BalanceMetric)                            */
/* ------------------------------------------------------------------ */
export interface BalanceMetricDTO {
  key: string;
  title: string;
  icon: "calendar" | "flag";
  color: "green" | "orange" | "purple" | "blue";
  amountTM: number;
  amountLM: number;
  pctToOsaTM: number;
  pctToOsaLM: number;
}

export interface DashboardOverviewDTO {
  osaTotalTM: number;
  osaTotalLM: number;
  metrics: BalanceMetricDTO[];
}

export interface OverviewParams {
  /** yyyy-mm-dd */
  thisMonth: string;
  /** yyyy-mm-dd */
  lastMonth: string;
  /** id_mst_wilayah as string; empty / "all" = no filter */
  cabang?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const parseIsoDate = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};

const toNumber = (v: bigint | null | undefined) => (v == null ? 0 : Number(v));

const pct = (part: number, total: number) =>
  total === 0 ? 0 : Math.round((part / total) * 10000) / 100;

const cabangFilter = (cabang?: string) => {
  if (!cabang || cabang.toLowerCase() === "all") return {};
  const id = Number(cabang);
  if (!Number.isInteger(id)) return {};
  return { id_mst_wilayah: id };
};

/**
 * Picks the source table for a date:
 *  - day 1 of the month -> ascii_aging_monthly
 *  - any other day      -> ascii_aging_daily
 * Returns a function: (extraWhere) => sum of saldo_ar.
 */
const buildSource = (iso: string, cabang?: string) => {
  const { y, m, d } = parseIsoDate(iso);
  const branch = cabangFilter(cabang);

  if (d === 1) {
    // ASSUMPTION: ascii_aging_monthly has no date column, so we identify the
    // month by file_name containing yyyyMM (e.g. "aging_202608.txt").
    // Better long-term: add a `period DateTime` column and filter on that.
    const period = `${y}${String(m).padStart(2, "0")}`;
    return async (extra: Prisma.ascii_aging_monthlyWhereInput = {}) => {
      const r = await prisma.ascii_aging_monthly.aggregate({
        _sum: { saldo_ar: true },
        where: { file_name: { contains: period }, ...branch, ...extra },
      });
      return toNumber(r._sum.saldo_ar);
    };
  }

  // Whole-day range anchored at Jakarta time (UTC+7), same as your version.
  const start = new Date(`${iso}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return async (extra: Prisma.ascii_aging_dailyWhereInput = {}) => {
    const r = await prisma.ascii_aging_daily.aggregate({
      _sum: { saldo_ar: true },
      where: { date: { gte: start, lt: end }, ...branch, ...extra },
    });
    return toNumber(r._sum.saldo_ar);
  };
};

/* ------------------------------------------------------------------ */
/* Main service                                                        */
/* ------------------------------------------------------------------ */
export async function getDashboardOverview(
  params: OverviewParams
): Promise<DashboardOverviewDTO> {
  const t = getThresholds();
  const sumTM = buildSource(params.thisMonth, params.cabang);
  const sumLM = buildSource(params.lastMonth, params.cabang);

  const over = (days: number) => ({ ovd_eom: { gt: BigInt(days) } });

  const defs = [
    { key: "balance-1", title: `BALANCE > ${t.balance1}`, icon: "calendar", color: "green", days: t.balance1 },
    { key: "balance-2", title: `BALANCE > ${t.balance2}`, icon: "calendar", color: "orange", days: t.balance2 },
    { key: "balance-3", title: `BALANCE > ${t.balance3}`, icon: "calendar", color: "purple", days: t.balance3 },
    { key: "powo", title: "POWO", icon: "flag", color: "blue", days: t.powo },
  ] as const;

  // OSA totals (all saldo_ar for that day)
  const [osaTotalTM, osaTotalLM] = await Promise.all([sumTM(), sumLM()]);

  const metrics = await Promise.all(
    defs.map(async (def): Promise<BalanceMetricDTO> => {
      const [amountTM, amountLM] = await Promise.all([
        sumTM(over(def.days)),
        sumLM(over(def.days)),
      ]);
      return {
        key: def.key,
        title: def.title,
        icon: def.icon,
        color: def.color,
        amountTM,
        amountLM,
        pctToOsaTM: pct(amountTM, osaTotalTM),
        pctToOsaLM: pct(amountLM, osaTotalLM),
      };
    })
  );

  return { osaTotalTM, osaTotalLM, metrics };
}