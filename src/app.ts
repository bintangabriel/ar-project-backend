import express, {
  ErrorRequestHandler
} from 'express';
import cors from 'cors'
import routes from './routes/routes';
import { UserAuth } from './middleware/Authentication';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: ["http://localhost:3000", 'https://ar-project-ochre-one.vercel.app'],
    credentials: true, // only if you use cookies
  })
);

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'AR Project Backend is running'
  });
});

/**
 * Routes
 */
app.use('/api/v1', routes);

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