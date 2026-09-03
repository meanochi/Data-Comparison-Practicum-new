import { Router } from 'express';

export abstract class IController {
    constructor() {
        this.router = Router();
        this.intializeRoutes(this.router);
    }

    readonly router: Router;

    abstract get path(): string;
    protected abstract intializeRoutes(router: Router): void;

    protected static Cast<TInterface>(serialized: any): TInterface {
        return serialized as TInterface;
    }
}
