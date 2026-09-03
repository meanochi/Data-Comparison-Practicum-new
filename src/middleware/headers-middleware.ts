import { NextFunction, Request, Response } from 'express';

export function HeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
}
