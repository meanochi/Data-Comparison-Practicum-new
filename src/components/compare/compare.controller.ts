import { NextFunction, Request, Response, Router } from 'express';
import Joi from 'joi';
import { IController } from '../../../IController';
import CompareService, { PdfInput } from './compare.service';
import { ApiError } from '../../middleware/logErrors-middleware';

// בדיקת מבנה בלבד (אובייקט, לא מערך) - כמו הבדיקה המקורית; תוכן שדה content
// חסר/ריק אינו 400 אלא מדווח כשגיאת השוואה על ידי השירות (מסמך פגום).
const pdfShapeSchema = Joi.object().unknown(true).required();

export class CompareController extends IController {
    get path(): string {
        return 'compare';
    }

    protected intializeRoutes(router: Router): void {
        // הפניה עוטפת (ולא this.compare ישירות): שדה המחלקה הבסיסית מפעיל
        // את intializeRoutes בתוך ה-constructor שלה, לפני שדות/מתודות של
        // המחלקה היורשת מוכנים - עטיפה ב-arrow שומרת על this בזמן הקריאה בפועל.
        router.post('/', (req, res, next) => this.compare(req, res, next));
    }

    private async compare(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const pdf = this.extractPdfInput(req);
            const rows = this.extractRows(req);
            const result = await CompareService.compare(rows, pdf);

            const response: Record<string, unknown> = {
                valid: result.valid,
                idNumber: result.idNumber,
                rows: result.rows,
                text: result.text,
            };
            if (req.query.full === '1') {
                Object.assign(response, { summary: result.summary, warnings: result.warnings, results: result.results });
            }
            res.json(response);
        } catch (err) {
            next(err);
        }
    }

    /**
     * rows מגיע כ-JSON גולמי בגוף הבקשה, או (form-data - נוח מפוסטמן) כשדה
     * טקסט לצד קובץ ה-pdf, ואז יש לפענח אותו כ-JSON.
     */
    private extractRows(req: Request): unknown {
        if (req.files?.pdf) {
            const raw = req.body?.rows;
            if (raw === undefined) return undefined;
            try {
                return JSON.parse(raw);
            } catch {
                throw new ApiError(400, 'שדה rows חייב להכיל מערך JSON תקין (כשדה טקסט לצד קובץ ה-pdf)');
            }
        }
        return req.body?.rows;
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
