import { NextFunction, Request, RequestHandler, Response } from 'express';
import { isKnownIdentity, KNOWN_IDENTITIES, KnownIdentity } from '../fabric';

/** Reads and validates the X-Identity header selecting which pre-enrolled identity to act as. */
export function requireIdentity(req: Request): KnownIdentity {
  const header = req.header('X-Identity');
  if (!header || !isKnownIdentity(header)) {
    throw new HttpError(
      400,
      `missing or invalid X-Identity header; must be one of ${KNOWN_IDENTITIES.join(', ')}`
    );
  }
  return header;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wraps an async Express handler so rejected promises reach the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  // Fabric endorsement/chaincode errors surface here as generic Errors;
  // treat them as client errors (400) since they're almost always caused
  // by invalid input or a business-rule rejection (insufficient balance,
  // wrong state, etc.), not a gateway-side fault.
  res.status(400).json({ error: message });
}
