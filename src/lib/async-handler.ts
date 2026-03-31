import type { Request, Response, NextFunction } from 'express';

// Wraps async route handlers so unhandled errors go to Express error handler
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
