import { StartApp } from './src/startApp';
import { CompareController } from './src/components/compare/compare.controller';
import { logger } from './src/utils/logger';

process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason}`);
});

process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
});

const startApp = new StartApp([new CompareController()], Number(process.env.PORT) || 3000);

startApp.listen();
