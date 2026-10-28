import { Router } from 'express';

import upload from '../middleware/upload.middleware';
import { loginEmailRoute } from '../controllers/Authorizer';
import { UserAuth } from '../middleware/Authentication';
import { importFile } from '../controllers/upload';
import { getDashboardOverviewRoute } from '../controllers/dashboard';

const router = Router();

router.post('/excel', upload.single('file'), UserAuth(), importFile);
router.post('/login', loginEmailRoute);
router.get('/dashboard/overview', getDashboardOverviewRoute);

export default router;