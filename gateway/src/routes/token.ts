import { Router } from 'express';
import { withContract } from '../fabric';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const tokenRouter = Router();

tokenRouter.get(
  '/balance/:userId',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('GetBalance', req.params.userId)
    );
    res.json({ balance: Number(Buffer.from(result).toString('utf8')) });
  })
);

// Dev-only faucet. The chaincode itself enforces that only the 'admin'
// identity may mint; the gateway just forwards whatever X-Identity was sent.
tokenRouter.post(
  '/faucet',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { userId, amount } = req.body as { userId?: string; amount?: number };
    if (!userId || !amount) throw new HttpError(400, 'userId and amount are required');

    await withContract(identity, (contract) =>
      contract.submitTransaction('Mint', userId, String(amount))
    );
    res.status(204).send();
  })
);
