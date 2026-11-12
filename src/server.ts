import 'dotenv/config';

import app from './app';
import prisma from './prisma';

const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const shutdown = async () => {
  console.log('Shutting down...');

  await prisma.$disconnect();

  server.close(() => {
    console.log('Server closed');

    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);