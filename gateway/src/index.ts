import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { startReservationExpiryWorker } from './expiryWorker';
import { chargersRouter } from './routes/chargers';
import { nlSearchRouter } from './routes/nlSearch';
import { providersRouter } from './routes/providers';
import { reservationsRouter } from './routes/reservations';
import { sessionsRouter } from './routes/sessions';
import { tokenRouter } from './routes/token';
import { tripPlanRouter } from './routes/tripPlan';
import { usersRouter } from './routes/users';
import { errorMiddleware } from './routes/util';
import { requireGatewayUser } from './fabric';

const GATEWAY_USER = requireGatewayUser();
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/setup/status', (_req, res) => res.json({ provisioned: true, identity: GATEWAY_USER }));

app.use(usersRouter);
app.use(providersRouter);
app.use(nlSearchRouter);
app.use(chargersRouter);
app.use(reservationsRouter);
app.use(sessionsRouter);
app.use(tokenRouter);
app.use(tripPlanRouter);
const FRONTEND_DIST = process.env.FRONTEND_DIST_DIR || path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(FRONTEND_DIST));
app.get('*', (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`EV charging marketplace gateway listening on http://localhost:${PORT}`);
});

startReservationExpiryWorker();
