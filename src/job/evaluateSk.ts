// src/jobs/evaluateSk.ts
import { Prisma } from '../generated/prisma/client';
import prisma from '../prisma';

export async function evaluateSk() {
  const [success, failed] = await prisma.$transaction([
    prisma.$executeRaw(Prisma.sql`
      UPDATE ascii_sk sk
      SET is_success = true
      WHERE sk.is_success IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM ascii_cr cr
            WHERE cr.no_aggr = sk.no_aggr
              AND cr.date::date BETWEEN sk.date::date AND sk.date::date + 7
          )
          OR EXISTS (
            SELECT 1
            FROM ascii_aging_daily d
            JOIN ascii_aging_monthly m
              ON m.no_aggr = d.no_aggr
             AND m.snapshot_date = date_trunc('month', d.date)::date
            WHERE d.no_aggr = sk.no_aggr
              AND d.date::date - 1 BETWEEN sk.date::date AND sk.date::date + 7
              AND d.angke >= m.angke + 1
          )
        )
    `),
    prisma.$executeRaw(Prisma.sql`
      UPDATE ascii_sk
      SET is_success = false
      WHERE is_success IS NULL
        AND date::date + 8 < CURRENT_DATE
    `),
  ]);

  console.log(`[evaluateSk] success=${success}, failed=${failed}`);
}

let running = false;

export async function runEvaluateSk() {
  if (running) return console.log('[evaluateSk] already running, skipped');
  running = true;
  try { await evaluateSk(); }
  catch (e) { console.error('[evaluateSk] failed', e); }
  finally { running = false; }
}

