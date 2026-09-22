import { Router } from 'express';

import upload from '../middleware/upload.middleware';
import { uploadExcel } from '../controllers/upload.controller';

const router = Router();

router.post(
  '/excel',
  upload.single('file'),
  uploadExcel
);

export default router;