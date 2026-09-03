import { Request } from 'express';

declare global {
    namespace Express {
        interface Request {
            // Add custom request properties here
        }
    }
}
