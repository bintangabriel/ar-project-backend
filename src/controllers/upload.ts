import type {Request, Response} from 'express';
import * as XLSX from 'xlsx';
import {Prisma} from '../generated/prisma/client'; // adjust path to your generated client
import prisma from '../prisma'; // your shared client (the file with PrismaPg adapter)

/* -------------------------------------------------------------------------- */
/* Value parsers                                                              */
/* -------------------------------------------------------------------------- */

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const toStr = (v: unknown): string | null =>
  isEmpty(v) ? null : String(v).trim();

const toInt = (v: unknown): number | null => {
  if (isEmpty(v)) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

// Decimal: pass as string to avoid float precision loss
const toDecimal = (v: unknown): Prisma.Decimal | null => {
  if (isEmpty(v)) return null;
  const s = String(v).replace(/,/g, '').trim();
  return Number.isFinite(Number(s)) ? new Prisma.Decimal(s) : null;
};

const toDate = (v: unknown): Date | null => {
  if (isEmpty(v)) return null;

  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;

    // Preserve the calendar date and normalize to UTC midnight.
    return new Date(
      Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())
    );
  }

  // Handle Excel date strings in DD-MM-YYYY format.
  const value = String(v).trim();
  const match = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);

  if (match) {
    const [, dayStr, monthStr, yearStr] = match;
    const day = Number(dayStr);
    const month = Number(monthStr);
    const year = Number(yearStr);

    const date = new Date(Date.UTC(year, month - 1, day));

    // Reject invalid dates, such as 32-01-2026.
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return date;
  }

  // Fallback for other supported date formats.
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

/* -------------------------------------------------------------------------- */
/* Per-table config                                                           */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type Mapper = (row: Row, ctx: {fileName: string; idWilayah: number | null; importDate: Date | null;}) => any;

interface ImportConfig {
  required: (ctx: {idWilayah: number | null}) => string[];
  map: Mapper;
  insert: (data: any[]) => Promise<{count: number}>;
}



const CONFIG: Record<string, ImportConfig> = {
  sk: {
    required: () => ['name_collector', 'name_remo', 'tgl_sk_keluar', 'no_aggr'],
    map: (r, c) => ({
      peojf: toStr(r.name_collector),
      remo: toStr(r.name_remo),
      date: toDate(r.tgl_sk_keluar),
      no_aggr: toStr(r.no_aggr),
      file_name: c.fileName
    }),
    insert: data => prisma.ascii_sk.createMany({data})
  },

  cr: {
    required: () => [],
    map: (r, c) => ({
      peojf: toStr(r.peojf),
      remo: toStr(r.remo),
      date: toDate(r.date),
      no_aggr: toStr(r.no_aggr),
      file_name: c.fileName
    }),
    insert: data => prisma.ascii_cr.createMany({data})
  },

  aging: {
    required: () => [],
    map: (r, c) => ({
      cust_name: toStr(r.cust_name),
      saldo_ar: toDecimal(r.saldo_ar),
      ovd_eom: toDecimal(r.ovd_eom),
      no_aggr: toStr(r.no_aggr),
      angke: toInt(r.angke),
      file_name: c.fileName
    }),
    insert: data => prisma.ascii_aging.createMany({data})
  },

  aging_monthly: {
    required: () => [],
    map: (r, c) => ({
      cust_name: toStr(r.cust_name),
      saldo_ar: toDecimal(r.saldo_ar),
      ovd_eom: toDecimal(r.ovd_eom),
      no_aggr: toStr(r.no_aggr),
      angke: toInt(r.angke),
      // column in file wins, otherwise fall back to request body
      id_mst_wilayah: toInt(r.id_mst_wilayah) ?? c.idWilayah,
      file_name: c.fileName
    }),
    insert: data => prisma.ascii_aging_monthly.createMany({data})
  },

  aging_daily: {
    required: () => [],
    map: (r, c) => ({
      cust_name: toStr(r.cust_name),
      saldo_ar: toDecimal(r.saldo_ar),
      ovd_eom: toDecimal(r.ovd_eom),
      no_aggr: toStr(r.no_aggr),
      angke: toInt(r.angke),
      id_mst_wilayah: toInt(r.id_mst_wilayah) ?? c.idWilayah,
      date: c.importDate,
      file_name: c.fileName
    }),
    insert: data => prisma.ascii_aging_daily.createMany({data})
  }
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Postgres allows ~32,767 bind params per query; widest table has 8 columns
const CHUNK_SIZE = 1000;

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const normalizeKey = (k: string) => k.trim().toLowerCase().replace(/\s+/g, '_');

const normalizeRow = (row: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[normalizeKey(k)] = v;
  return out;
};

/* -------------------------------------------------------------------------- */
/* Controller                                                                 */
/* -------------------------------------------------------------------------- */

export const importFile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({success: false, message: 'No file uploaded'});
      return;
    }

    const type = String(req.body.type ?? '').toLowerCase();
    const config = CONFIG[type];

    if (!config) {
      res.status(400).json({
        success: false,
        message: `Invalid type "${type}". Allowed: ${Object.keys(CONFIG).join(', ')}`
      });
      return;
    }

    const fileName = req.file.originalname;
    const idWilayah = toInt(req.body.id_mst_wilayah);

    let importDate: Date | null = null;

    if (type === 'aging_daily') {
      const value = String(req.body.date ?? '').trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        res.status(400).json({
          success: false,
          message: 'A valid import date is required for Aging daily.'
        });
        return;
      }

      const parts = value.split('-');

      const year = Number(parts[0]);
      const month = Number(parts[1]);
      const day = Number(parts[2]);

      const parsedDate = new Date(
        Date.UTC(year, month - 1, day)
      );

      if (
        parsedDate.getUTCFullYear() !== year ||
        parsedDate.getUTCMonth() !== month - 1 ||
        parsedDate.getUTCDate() !== day
      ) {
        res.status(400).json({
          success: false,
          message: 'Invalid import date.'
        });
        return;
      }

      importDate = parsedDate;
    }

    /* Read XLSX / CSV (cellDates => real Date objects for date columns) */
    const workbook = XLSX.read(req.file.buffer, {type: 'buffer', cellDates: true});
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      res.status(400).json({success: false, message: 'File does not contain any worksheet'});
      return;
    }

    const sheet = workbook.Sheets[firstSheetName]!;

    const headerRow =
      XLSX.utils.sheet_to_json<unknown[]>(sheet, {header: 1, defval: null})[0] ?? [];
    const fileColumns = new Set(
      headerRow.filter(h => !isEmpty(h)).map(h => normalizeKey(String(h)))
    );

    const missingColumns = config.required({idWilayah}).filter(c => !fileColumns.has(c));

    if (missingColumns.length > 0) {
      res.status(400).json({
        success: false,
        message: `Missing required column(s): ${missingColumns.join(', ')}`,
        missingColumns
      });
      return;
    }

    const rawRows = XLSX.utils.sheet_to_json<Row>(sheet, {defval: null});

    if (rawRows.length === 0) {
      res.status(400).json({success: false, message: 'File contains no data'});
      return;
    }

    /* Map rows, skipping rows where every mapped value is empty */
    const data = rawRows
      .map(normalizeRow)
      .map(r => config.map(r, {fileName, idWilayah, importDate}))
      .filter(item =>
        Object.entries(item).some(([k, v]) => k !== 'file_name' && v !== null && v !== undefined)
      );

    if (data.length === 0) {
      res.status(400).json({
        success: false,
        message: 'No valid rows found. Check that the column headers match the table fields.'
      });
      return;
    }

    /* Insert in chunks inside ONE transaction (all-or-nothing) + log file in mst_file */
    const inserted = await prisma.$transaction(
      async tx => {
        let total = 0;

        for (const part of chunk(data, CHUNK_SIZE)) {
          // pick the delegate from the transaction client, not the global one
          const result = await insertWithTx(tx, type, part);
          total += result.count;
        }

        await tx.mst_file.create({
          data: {
            name: fileName,
            size: new Prisma.Decimal(req.file!.size),
            type,
            created_at: new Date()
          }
        });

        return total;
      },
      {timeout: 120_000} // large imports can exceed the 5s default
    );

    res.status(201).json({
      success: true,
      message: `Imported ${inserted} rows into ascii_${type}`,
      data: {type, fileName, inserted, skipped: rawRows.length - data.length}
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({success: false, message: 'Failed to import file'});
  }
};

/* Same routing as CONFIG.insert, but bound to a transaction client */
const insertWithTx = (tx: Prisma.TransactionClient, type: string, data: any[]) => {
  switch (type) {
    case 'sk':
      return tx.ascii_sk.createMany({data});
    case 'cr':
      return tx.ascii_cr.createMany({data});
    case 'aging':
      return tx.ascii_aging.createMany({data});
    case 'aging_monthly':
      return tx.ascii_aging_monthly.createMany({data});
    case 'aging_daily':
      return tx.ascii_aging_daily.createMany({data});
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
};