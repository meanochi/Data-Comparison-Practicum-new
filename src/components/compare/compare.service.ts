/**
 * לוגיקת ה-API להשוואת שורות טבלה מול מסמך PDF, עבור מספר זהות אחד לכל קריאה
 * (אחד-על-אחד) - החוזה של POST /api/compare.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compareId, unifiedText } from '../../comparator';
import { normalizeId } from '../../parsers/datParser';
import { parsePdfBuffer } from '../../parsers/pdfChinuchParser';
import { normalizeKeys, parseTableRows } from '../../tableSource';
import { CompareIdResult, PdfParseResult } from '../../compare-types';
import { ApiError } from '../../middleware/logErrors-middleware';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

export interface PdfInput {
    filename: string;
    buffer: Buffer;
}

export interface CompareSummary {
    total: number;
    match: number;
    mismatch: number;
    missing: number;
    error: number;
}

export interface AnnotatedRow {
    [key: string]: unknown;
    valid: 0 | 1;
    reason?: string;
}

export interface CompareApiResult {
    valid: 0 | 1;
    idNumber: string | null;
    rows: AnnotatedRow[];
    text: string;
    summary: CompareSummary;
    warnings: string[];
    results: CompareIdResult[];
}

function buildSummary(results: CompareIdResult[]): CompareSummary {
    return {
        total: results.length,
        match: results.filter((r) => r.status === 'match').length,
        mismatch: results.filter((r) => r.status === 'mismatch').length,
        missing: results.filter((r) => r.status === 'missing_pdf' || r.status === 'missing_dat').length,
        error: results.filter((r) => r.status === 'error').length,
    };
}

/**
 * החזרת השורות שנשלחו כפי שהן, עם תוספת לכל שורה:
 *   valid  - 1 אם השורה נמצאה תואמת במלואה במסמך, 0 אחרת
 *   reason - פירוט קצר כשהשורה אינה תקינה (או הערה כשאינה מושווית)
 */
function annotateSentRows(rawRows: unknown[], results: CompareIdResult[]): AnnotatedRow[] {
    const rowIndex = new Map<string, CompareIdResult['rows'][number]>();
    const excludedKeys = new Set<string>();
    for (const r of results) {
        for (const row of r.rows) {
            if (row.datRow) rowIndex.set(`${r.idNumber}|${row.start}|${row.end}`, row);
        }
        for (const ex of r.excluded) excludedKeys.add(`${r.idNumber}|${ex.start}|${ex.end}`);
    }

    return rawRows.map((raw): AnnotatedRow => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
            return { row: raw, valid: 0, reason: 'רשומה שאינה אובייקט - לא נבדקה' };
        }
        const row = normalizeKeys(raw as Record<string, unknown>);
        const key =
            `${normalizeId(String(row.MISPAR_ZEHUT ?? ''))}|` + `${String(row.TAARICH_ME ?? '')}|${String(row.TAARICH_AD ?? '')}`;

        const resultRow = rowIndex.get(key);
        if (resultRow) {
            if (resultRow.status === 'match') return { ...(raw as object), valid: 1 };
            if (resultRow.status === 'diff') {
                return {
                    ...(raw as object),
                    valid: 0,
                    reason: resultRow.diffs.map((d) => `${d.fieldName}: במסמך "${d.pdfValue}" מול "${d.datValue}" בנתונים`).join('; '),
                };
            }
            return { ...(raw as object), valid: 0, reason: 'לא נמצאה תקופה תואמת במסמך' };
        }
        if (excludedKeys.has(key)) {
            return { ...(raw as object), valid: 1, reason: 'עזיבה - אינה מודפסת במסמך ולא נכללת בהשוואה' };
        }
        return { ...(raw as object), valid: 0, reason: 'השורה לא נקלטה (ערך שגוי או רשומה שאינה 9050)' };
    });
}

function dumpRequest(rows: unknown, pdf: PdfInput): void {
    const dumpDir = config.compare.dumpDir;
    if (!dumpDir) return;
    fs.mkdirSync(dumpDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dumpPath = path.join(dumpDir, `request_${stamp}.json`);
    fs.writeFileSync(
        dumpPath,
        JSON.stringify({ rows, pdf: { filename: pdf.filename, content: pdf.buffer.toString('base64') } }, null, 2)
    );
    logger.info(`Request dumped to ${dumpPath}`);
}

export default class CompareService {
    /** השוואת שורות טבלה מול מסמך PDF, עבור תעודת זהות אחת (אחד-על-אחד). */
    static async compare(rows: unknown, pdf: PdfInput): Promise<CompareApiResult> {
        if (!Array.isArray(rows)) {
            throw new ApiError(400, 'נדרש שדה rows: מערך שורות מהטבלה הזמנית');
        }

        logger.info(`/api/compare: התקבלו ${rows.length} שורות טבלה ומסמך "${pdf.filename}"`);

        const datResult = parseTableRows(rows);

        // אכיפת מצב אחד-על-אחד: כל קריאה נושאת ת"ז אחת בלבד
        const idsInRows = Object.keys(datResult.periodsById);
        if (idsInRows.length > 1) {
            throw new ApiError(
                400,
                `הממשק עובד אחד-על-אחד: בקריאה נשלחות שורות של תעודת זהות אחת בלבד, ` +
                `אך נמצאו ${idsInRows.length}: ${idsInRows.join(', ')}`
            );
        }

        dumpRequest(rows, pdf);

        // פענוח מסמך ה-PDF היחיד; קובץ פגום לא מפיל את הבקשה - מדווח כשגיאת השוואה
        let pdfResult: PdfParseResult;
        try {
            if (pdf.buffer.length === 0) {
                throw new Error('שדה content חסר או ריק');
            }
            pdfResult = await parsePdfBuffer(pdf.buffer);
        } catch (exc: any) {
            pdfResult = { idNumber: null, periods: [], warnings: [], errors: [`שגיאה בפענוח ${pdf.filename}: ${exc.message}`] };
        }

        // השוואה אחד-על-אחד: ת"ז אחת (מה-rows, ואם אין - מה-PDF) מול המסמך היחיד
        const compareIdNumber = idsInRows[0] ?? pdfResult.idNumber ?? '?';
        const results = [compareId(compareIdNumber, datResult.periodsById[compareIdNumber], pdfResult, pdf.filename)];
        const warnings = [...datResult.warnings, ...datResult.errors];
        const summary = buildSummary(results);
        // אינדיקציית תקינות לפי האפיון: 1 רק כשכל ההשוואות תקינות במלואן
        const valid: 0 | 1 = summary.total > 0 && summary.match === summary.total ? 1 : 0;

        logger.info(
            `/api/compare: הושוו ${summary.total} ת"ז (תואמות: ${summary.match}, שונות: ${summary.mismatch}, ` +
            `חסרות: ${summary.missing}, שגיאות: ${summary.error}) => valid=${valid}`
        );

        return {
            valid,
            idNumber: idsInRows.length === 1 ? idsInRows[0] : null,
            rows: annotateSentRows(rows, results),
            text: unifiedText(results, warnings),
            summary,
            warnings,
            results,
        };
    }
}
