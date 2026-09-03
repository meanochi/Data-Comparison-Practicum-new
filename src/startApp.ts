import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { Express } from 'express';
import fileUpload from 'express-fileupload';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { IController } from '../IController';
import { HeadersMiddleware } from './middleware/headers-middleware';
import { logErrors } from './middleware/logErrors-middleware';
import { config } from './utils/config';
import { logger } from './utils/logger';

export class StartApp {
    public readonly app: Express;
    private readonly port: number;

    constructor(controllers: IController[], port: number) {
        this.app = express();
        this.port = port;

        this.initializeMiddlewares();
        this.initializeControllers(controllers);
        this.initializeHealthcheck();
        this.initializeSwagger();
        this.initializeErrorHandling();
    }

    private initializeMiddlewares(): void {
        const jsonLimit = `${config.upload.jsonBodyLimitMb}mb`;
        this.app.use(express.json({ limit: jsonLimit }));
        this.app.use(express.urlencoded({ extended: true, limit: jsonLimit }));
        this.app.use(HeadersMiddleware);
        this.app.use(fileUpload({ limits: { fileSize: config.upload.maxFileSize * 1024 * 1024 } }));
        if (config.server.env === 'development') {
            this.app.use(morgan('dev'));
        }
        this.app.use(cors({ origin: true, credentials: true }));
    }

    private initializeControllers(controllers: IController[]): void {
        controllers.forEach((controller) => {
            this.app.use(`/api/${controller.path}`, controller.router);
        });
    }

    private initializeHealthcheck(): void {
        this.app.get('/api/healthcheck', (_req, res) => {
            res.json({ status: 'ok' });
        });
    }

    /**
     * תיעוד אינטראקטיבי של ה-API (Swagger UI): /api-docs, לפי openapi.json.
     * openapi.json אינו קובץ TypeScript ואינו מועתק ל-build/ על ידי tsc,
     * ולכן נקרא יחסית לתיקיית ההרצה (שורש הפרויקט) ולא ל-__dirname - כך זה
     * עובד גם תחת ts-node (dev/start) וגם מריצה של build/app.js.
     */
    private initializeSwagger(): void {
        const openapiSpec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'openapi.json'), 'utf8'));
        this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
    }

    private initializeErrorHandling(): void {
        this.app.use(logErrors);
    }

    public listen(): void {
        this.app.listen(this.port, () => {
            logger.info(`השרת פעיל על פורט ${this.port}`);
        });
    }
}
