import express, {
  ErrorRequestHandler
} from 'express';

import uploadRoutes from './routes/upload.route';
import { UserAuth } from './middleware/Authentication';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Excel Upload API is running'
  });
});

/**
 * Routes
 */
app.use('/api/upload', UserAuth(), uploadRoutes);

/**
 * Error handler
 */
const errorHandler: ErrorRequestHandler = (
  err,
  req,
  res,
  next
) => {
  console.error(err);

  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      success: false,
      message: 'File size exceeds the configured limit'
    });

    return;
  }

  res.status(400).json({
    success: false,
    message: err.message || 'Something went wrong'
  });
};

app.use(errorHandler);

export default app;