import winston from 'winston';
import { config } from './config';

const transports: winston.transport[] = [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
];

if (config.server.env !== 'production') {
    transports.push(new winston.transports.Console({ format: winston.format.simple() }));
}

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports,
});
