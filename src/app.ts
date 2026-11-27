import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './config';
import { connectDatabase } from './database';
import { errorHandler } from './middleware/error.middleware';
import router from './routes';

const app = express();

// Render (and most hosts) put one proxy in front of the app; trust it so
// rate limits see each visitor's real address instead of the proxy's.
app.set('trust proxy', 1);

// Don't announce the framework; this JSON API is never meant to be sniffed as
// another type or shown inside a frame.
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
  next();
});

// Browsers may call the API only from the shop itself (FRONTEND_URL) and from
// local development. Apps without an Origin header (curl, servers) are allowed.
const allowedOrigins = new Set([
  config.frontendUrl,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8787', // `npm run preview` (Cloudflare Workers runtime)
]);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    callback(Object.assign(new Error('Not allowed by CORS'), { status: 403 }));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['*'],
  maxAge: 3600,
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'sleepy-care' });
});

// API routes
app.use('/', router);

// Error handler
app.use(errorHandler);

// Start server
async function start() {
  try {
    await connectDatabase();
    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Only listen when run directly (npm run dev / npm start), not when the tests import the app.
if (require.main === module) {
  start();
}

export default app;
