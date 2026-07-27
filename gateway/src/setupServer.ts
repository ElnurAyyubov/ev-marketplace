// Runs instead of index.ts when this device has no identity yet (see
// gateway/docker/entrypoint.sh). Deliberately minimal: no Fabric peer
// connectivity, no routers -- CA registration doesn't need any of that.
// Serves the same built frontend as index.ts does, so the browser can load
// the first-run registration screen from this process.
import cors from 'cors';
import express from 'express';
import * as path from 'path';
import { enrollIdentity, ProvisioningError } from './provisioning';

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_DIST = process.env.FRONTEND_DIST_DIR || path.join(__dirname, '..', '..', 'frontend', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/setup/status', (_req, res) => res.json({ provisioned: false }));

app.post('/setup/register', (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  enrollIdentity(username)
    .then(() => {
      res.status(204).send();
      // Let the response flush, then exit -- the container's restart
      // policy (restart: unless-stopped) relaunches entrypoint.sh, which
      // now finds the marker written by enrollIdentity() and boots the
      // real gateway (dist/index.js) with GATEWAY_USER set.
      setTimeout(() => process.exit(0), 250);
    })
    .catch((err) => {
      const message = err instanceof ProvisioningError ? err.message : 'enrollment failed';
      if (!(err instanceof ProvisioningError)) console.error(err);
      res.status(400).json({ error: message });
    });
});

app.use(express.static(FRONTEND_DIST));
app.get('*', (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));

app.listen(PORT, () => {
  console.log(`Setup server listening on http://localhost:${PORT} -- awaiting device registration`);
});
