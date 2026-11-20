import 'dotenv/config';
import express, { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './server/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  // Serve standalone promotional commercial video & player page with full HTTP Range (206) support
  app.use(
    '/commercial',
    express.static(path.join(__dirname, 'public', 'commercial'), {
      acceptRanges: true,
    })
  );
  app.get('/commercial.html', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'public', 'commercial.html'));
  });

  // Mount Vite middleware in dev mode, or static dist in production
  const isDevMode = process.env.NODE_ENV === 'development';
  const distDir = path.join(__dirname, 'dist');

  if (isDevMode || !fs.existsSync(path.join(distDir, 'index.html'))) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
