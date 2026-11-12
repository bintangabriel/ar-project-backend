import { Request, Response } from 'express';
import XLSX from 'xlsx';

import prisma from '../prisma';

export const uploadExcel = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'File is required'
      });

      return;
    }

    /**
     * Read XLSX / CSV
     */
    const workbook = XLSX.read(req.file.buffer, {
      type: 'buffer'
    });

    /**
     * Get first worksheet
     */
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      res.status(400).json({
        success: false,
        message: 'File does not contain any worksheet'
      });

      return;
    }

    const worksheet = workbook.Sheets[firstSheetName];

    /**
     * Convert worksheet to JSON
     *
     * Example:
     *
     * [
     *   {
     *     name: "Bintang",
     *     age: 24,
     *     email: "bintang@gmail.com"
     *   }
     * ]
     */
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      worksheet!,
      {
        defval: null
      }
    );

    if (rows.length === 0) {
      res.status(400).json({success: false, message: 'File contains no data'});
      return;
    }

    /**
     * Extract "name" column
     */
    const data = [];

    for (const row of rows) {
      const name = row.name;

      if (!name) {
        continue;
      }

      data.push({
        name: String(name).trim()
      });
    }

    if (data.length === 0) {
      res.status(400).json({
        success: false,
        message: 'No valid "name" column found'
      });

      return;
    }

    /**
     * Insert into PostgreSQL
     */
    const result = await prisma.importedData.createMany({
      data
    });

    res.status(201).json({
      success: true,
      message: 'File imported successfully',
      fileName: req.file.originalname,
      worksheet: firstSheetName,
      totalRows: rows.length,
      importedRows: result.count
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: 'Failed to process uploaded file'
    });
  }
};