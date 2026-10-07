/**
 * לוגיקת ה-API להשוואת שורת "סיכום תקופות עבודה" (NETUNEY_TIK_MECHUSHAVIM)
 * מול דוח PDF - החוזה של POST /api/compare-summary.
 */
import { compareWorkSummary, workSummaryText } from '../../workSummaryComparator';
import { parsePdfBuffer } from '../../parsers/pdfChinuchParser';
import { DbWorkSummaryRow, PdfParseResult, WorkSummaryCompareResult } from '../../compare-types';
import { ApiError } from '../../middleware/logErrors-middleware';
import { logger } from '../../utils/logger';

export interface PdfInput {
    filename: string;
    buffer: Buffer;
}

export interface CompareSummaryApiResult {
    valid: 0 | 1;
    text: string;
    result: WorkSummaryCompareResult;
}

const REQUIRED_FIELDS: (keyof DbWorkSummaryRow)[] = [
    'tkufa_mezaka_sherut',
    'chelkiyut_meshuklelet_sherut',
    'achuz_kizba_kafuf_chelkiyut',
    'achuz_kizb_achry_hagdl_chl_mla',
];

function validateRow(row: unknown): DbWorkSummaryRow {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw new ApiError(400, 'נדרש שדה row: אובייקט עם שדות סיכום תקופות העבודה (NETUNEY_TIK_MECHUSHAVIM)');
    }
    const r = row as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
        if (typeof r[field] !== 'number' || !Number.isFinite(r[field] as number)) {
            throw new ApiError(400, `שדה row.${field} חייב להיות מספר`);
        }
    }
    return r as unknown as DbWorkSummaryRow;
}

export default class CompareSummaryService {
    static async compare(row: unknown, pdf: PdfInput): Promise<CompareSummaryApiResult> {
        const dbRow = validateRow(row);

        logger.info(`/api/compare-summary: התקבלה שורת DB ומסמך "${pdf.filename}"`);

        let pdfResult: PdfParseResult;
        try {
            if (pdf.buffer.length === 0) {
                throw new Error('שדה content חסר או ריק');
            }
            pdfResult = await parsePdfBuffer(pdf.buffer);
        } catch (exc: any) {
            pdfResult = { idNumber: null, periods: [], workSummary: [], warnings: [], errors: [`שגיאה בפענוח ${pdf.filename}: ${exc.message}`] };
        }

        const result = compareWorkSummary(dbRow, pdfResult);
        const valid: 0 | 1 = result.status === 'match' ? 1 : 0;

        logger.info(`/api/compare-summary: סטטוס=${result.status} => valid=${valid}`);

        return { valid, text: workSummaryText(result), result };
    }
}
