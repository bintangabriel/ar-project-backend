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
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};

/* -------------------------------------------------------------------------- */
/* Per-table config                                                           */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type Mapper = (row: Row, ctx: {fileName: string; idWilayah: number | null}) => any;

interface ImportConfig {
  map: Mapper;
  insert: (data: any[]) => Promise<{count: number}>;
}

const CONFIG: Record<string, ImportConfig> = {
  sk: {
    map: (r, c) => ({
      peojf: toStr(r.peojf),
      remo: toStr(r.remo),
      date: toDate(r.date),
      no_aggr: toStr(r.no_aggr),
      file_name: c.fileName
    }),
    insert: data => prisma.ascii_sk.createMany({data})
  },

  cr: {
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
    map: (r, c) => ({
      cust_name: toStr(r.cust_name),
      saldo_ar: toDecimal(r.saldo_ar),
      ovd_eom: toDecimal(r.ovd_eom),
      no_aggr: toStr(r.no_aggr),
      angke: toInt(r.angke),
      id_mst_wilayah: toInt(r.id_mst_wilayah) ?? c.idWilayah,
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

// Make headers case/space-insensitive: " No_Aggr " -> "no_aggr"
const normalizeRow = (row: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.trim().toLowerCase().replace(/\s+/g, '_')] = v;
  }
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

    /* Read XLSX / CSV (cellDates => real Date objects for date columns) */
    const workbook = XLSX.read(req.file.buffer, {type: 'buffer', cellDates: true});
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      res.status(400).json({success: false, message: 'File does not contain any worksheet'});
      return;
    }

    const rawRows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[firstSheetName]!, {
      defval: null
    });

    if (rawRows.length === 0) {
      res.status(400).json({success: false, message: 'File contains no data'});
      return;
    }

    /* Map rows, skipping rows where every mapped value is empty */
    const data = rawRows
      .map(normalizeRow)
      .map(r => config.map(r, {fileName, idWilayah}))
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