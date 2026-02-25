import express, { type Application, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

function findDashboardDir(): string | null {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  const isBundled = currentFileDir.startsWith('/$bunfs/');

  if (!isBundled) {
    const bundledOutDir = path.join(currentFileDir, '..', 'out');
    if (fs.existsSync(bundledOutDir)) {
      return bundledOutDir;
    }
  }

  const cachedDashboardDir = path.join(os.homedir(), '.relay', 'dashboard', 'out');
  if (fs.existsSync(cachedDashboardDir)) {
    return cachedDashboardDir;
  }

  try {
    const dashboardPkg = require.resolve('@agent-relay/dashboard/package.json');
    const dashboardRoot = path.dirname(dashboardPkg);
    const outDir = path.join(dashboardRoot, 'out');
    if (fs.existsSync(outDir)) {
      return outDir;
    }
  } catch {
    // Package not found.
  }

  return null;
}

/**
 * Register dashboard UI/static routes for integrated mode.
 */
export function registerUiRoutes(app: Application): void {
  const dashboardDir = findDashboardDir();
  if (dashboardDir) {
    console.log(`[dashboard] Serving from: ${dashboardDir}`);
    app.use(express.static(dashboardDir, { extensions: ['html'] }));

    const uiMissingMessage =
      'Dashboard UI file not found. Please reinstall using: curl -fsSL https://raw.githubusercontent.com/AgentWorkforce/relay/main/install.sh | bash';

    const sendFileOr = (
      res: Response,
      filePath: string,
      onError: (err: Error) => void,
    ) => {
      res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) {
          onError(err);
        }
      });
    };

    const sendFileOrRedirectRoot = (res: Response, filePath: string) => {
      sendFileOr(res, filePath, () => {
        if (fs.existsSync(path.join(dashboardDir, 'index.html'))) {
          res.redirect(302, '/');
          return;
        }
        res.status(404).send(uiMissingMessage);
      });
    };

    const resolveMetricsFilePath = () => {
      const candidates = [
        path.join(dashboardDir, 'metrics.html'),
        path.join(dashboardDir, 'metrics', 'index.html'),
        path.join(dashboardDir, 'app.html'),
        path.join(dashboardDir, 'index.html'),
      ];

      return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
    };

    app.get('/metrics', (_req, res) => {
      sendFileOrRedirectRoot(res, resolveMetricsFilePath());
    });
    app.get('/app', (_req, res) => {
      sendFileOrRedirectRoot(res, path.join(dashboardDir, 'app.html'));
    });
    app.get('/app/{*path}', (_req, res) => {
      sendFileOrRedirectRoot(res, path.join(dashboardDir, 'app.html'));
    });
    return;
  }

  const fallbackHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Agent Relay Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; }
    h1 { color: #333; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 5px; overflow-x: auto; }
    .api-status { margin-top: 30px; padding: 15px; background: #e8f5e9; border-radius: 5px; }
  </style>
</head>
<body>
  <h1>Agent Relay Dashboard</h1>
  <p>The dashboard API is running, but the UI files are not available.</p>
  <p>To get the full dashboard UI, reinstall using the official installer:</p>
  <pre><code>curl -fsSL https://raw.githubusercontent.com/AgentWorkforce/relay/main/install.sh | bash</code></pre>
  <div class="api-status">
    <strong>API Status:</strong> Running<br>
    <a href="/api/agents">View connected agents</a> |
    <a href="/api/messages">View messages</a>
  </div>
</body>
</html>`;

  app.get('/', (_req, res) => {
    res.type('html').send(fallbackHtml);
  });
}
