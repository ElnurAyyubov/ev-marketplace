import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { startReservationExpiryWorker } from './expiryWorker';
import { chargersRouter } from './routes/chargers';
import { nlSearchRouter } from './routes/nlSearch';
import { providersRouter } from './routes/providers';
import { reservationsRouter } from './routes/reservations';
import { sessionsRouter } from './routes/sessions';
import { tokenRouter } from './routes/token';
import { usersRouter } from './routes/users';
import { errorMiddleware } from './routes/util';

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(usersRouter);
app.use(providersRouter);
app.use(nlSearchRouter);
app.use(chargersRouter);
app.use(reservationsRouter);
app.use(sessionsRouter);
app.use(tokenRouter);

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`EV charging marketplace gateway listening on http://localhost:${PORT}`);
});

startReservationExpiryWorker();
