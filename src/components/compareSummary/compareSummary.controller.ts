import { NextFunction, Request, Response, Router } from 'express';
import Joi from 'joi';
import { IController } from '../../../IController';
import CompareSummaryService, { PdfInput } from './compareSummary.service';
import { ApiError } from '../../middleware/logErrors-middleware';

// בדיקת מבנה בלבד (אובייקט, לא מערך) - תוכן שדה content חסר/ריק אינו 400
// אלא מדווח כשגיאת השוואה על ידי השירות (מסמך פגום), כמו ב-/api/compare.
const pdfShapeSchema = Joi.object().unknown(true).required();

export class CompareSummaryController extends IController {
    get path(): string {
        return 'compare-summary';
    }

    protected intializeRoutes(router: Router): void {
        router.post('/', (req, res, next) => this.compare(req, res, next));
    }

    private async compare(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const pdf = this.extractPdfInput(req);
            const row = this.extractRow(req);
            const { valid, text, result } = await CompareSummaryService.compare(row, pdf);

            const response: Record<string, unknown> = { valid, text };
            if (req.query.full === '1') {
                Object.assign(response, { status: result.status, diffs: result.diffs, errors: result.errors });
            }
            res.json(response);
        } catch (err) {
            next(err);
        }
    }

    /** row מגיע כ-JSON גולמי בגוף הבקשה, או (form-data) כשדה טקסט לצד קובץ ה-pdf. */
    private extractRow(req: Request): unknown {
        if (req.files?.pdf) {
            const raw = req.body?.row;
            if (raw === undefined) return undefined;
            try {
                return JSON.parse(raw);
            } catch {
                throw new ApiError(400, 'שדה row חייב להכיל אובייקט JSON תקין (כשדה טקסט לצד קובץ ה-pdf)');
            }
        }
        return req.body?.row;
    }

    /** pdf מגיע כאובייקט JSON (filename + content ב-base64) או כקובץ מצורף ממש (form-data). */
    private extractPdfInput(req: Request): PdfInput {
        const uploaded = req.files?.pdf;
        if (uploaded) {
            const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;
            return {
                filename: Buffer.from(file.name, 'latin1').toString('utf8'),
                buffer: file.data,
            };
        }

        const { error, value } = pdfShapeSchema.validate(req.body?.pdf);
        if (error) {
            throw new ApiError(400, 'נדרש שדה pdf: { filename, content (base64) } - מסמך אחד לקריאה');
        }
        const filename = typeof value.filename === 'string' ? value.filename : '?';
        const buffer = typeof value.content === 'string' && value.content !== '' ? Buffer.from(value.content, 'base64') : Buffer.alloc(0);
        return { filename, buffer };
    }
}
