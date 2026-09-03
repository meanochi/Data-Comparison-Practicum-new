import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

export class ApiError extends Error {
    constructor(public statusCode: number, message: string) {
        super(message);
    }
}

const STATUS_MESSAGES: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    404: 'Not Found',
    500: 'Internal Server Error',
};

export function logErrors(err: any, req: Request, res: Response, next: NextFunction): void {
    const statusCode: number = err.statusCode && STATUS_MESSAGES[err.statusCode] ? err.statusCode : 500;
    logger.error(`${req.method} ${req.originalUrl}: ${err.message}`);
    res.status(statusCode).json({ error: err.message || STATUS_MESSAGES[statusCode] });
}
