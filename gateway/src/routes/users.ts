import { Router } from 'express';
import { withContract } from '../fabric';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const usersRouter = Router();

usersRouter.post(
  '/users/register',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { name } = req.body as { name?: string };
    if (!name) throw new HttpError(400, 'name is required');

    const result = await withContract(identity, (contract) =>
      contract.submitTransaction('RegisterUser', name)
    );
    res.status(201).json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);

usersRouter.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('GetUser', req.params.id)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);
