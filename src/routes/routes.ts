import { Router } from 'express';

import upload from '../middleware/upload.middleware';
import { loginEmailRoute } from '../controllers/Authorizer';
import { UserAuth } from '../middleware/Authentication';
import { importFile } from '../controllers/upload';
import { getDashboardOverviewRoute } from '../controllers/dashboard';
import { getDashboardData } from '../service/DashboardPeojf';
import { FormOptions } from '../util/type';
import { getFormOptions, Recommendation } from '../controllers/recommendation';
import { getAgingTrendRoute, refreshAgingCron } from '../controllers/AgingTrendRoute';

const router = Router();

router.post('/excel', upload.single('file'), UserAuth(), importFile);
router.post('/login', loginEmailRoute);
router.get('/dashboard/overview', getDashboardOverviewRoute);
router.get('/dashboard/peojf', getDashboardData);
router.post(
  "/recommendation",
  UserAuth(),
  Recommendation
);

// GET /recommendation/options -> dropdown values for the form
router.get("/recommendation/options", UserAuth(), getFormOptions);

router.get('/aging/trend', UserAuth(), getAgingTrendRoute)
router.get("/aging/refresh", refreshAgingCron);

export default router;