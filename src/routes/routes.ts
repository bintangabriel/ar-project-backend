import { Router } from 'express';

import upload from '../middleware/upload.middleware';
import { uploadExcel } from '../controllers/upload.controller';
import { loginEmailRoute } from '../controllers/Authorizer';
import { UserAuth } from '../middleware/Authentication';

const router = Router();

router.post('/excel', upload.single('file'), UserAuth(), uploadExcel);
router.post('/login', loginEmailRoute);

export default router;