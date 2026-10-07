/**
 * השוואת "סיכום תקופות עבודה - לפי אורך שירות" בין שורת ה-DB
 * (NETUNEY_TIK_MECHUSHAVIM) לבין מה שמודפס בדוח ה-PDF.
 */
import { DbWorkSummaryRow, FieldDiff, PdfParseResult, WorkSummaryCompareResult } from './compare-types';

const FIELD_TOLERANCE = 0.001;

// "מספר שנים" לא נשמר ב-DB (רק נגזר מהחודשים) - בודקים שהדוח עצמו עקבי:
// 11.0 שנים חייב להיות קרוב ל-132/12. סבילות 0.05 כי שנים מוצג מעוגל לעשירית.
const YEARS_RATIO_TOLERANCE = 0.05;

export function compareWorkSummary(dbRow: DbWorkSummaryRow, pdfResult: PdfParseResult): WorkSummaryCompareResult {
    if (pdfResult.errors.length > 0) {
        return { status: 'error', diffs: [], errors: pdfResult.errors };
    }

    const serviceRow = pdfResult.workSummary.find((r) => r.kind === 'service');
    if (!serviceRow) {
        return {
            status: 'missing_pdf',
            diffs: [],
            errors: ['לא נמצאה טבלת "סיכום תקופות עבודה" (לפי אורך שירות) בדוח'],
        };
    }

    const diffs: FieldDiff[] = [];

    // בדיקת עצמיות הדוח: יחס שנים/חודשים - לא מול ה-DB, מול עצמו.
    if (serviceRow.years !== null && serviceRow.months !== null) {
        const expectedYears = serviceRow.months / 12;
        if (Math.abs(serviceRow.years - expectedYears) > YEARS_RATIO_TOLERANCE) {
            diffs.push({
                fieldName: 'יחס שנים/חודשים בדוח',
                pdfValue: `${serviceRow.years} שנים`,
                dataValue: `${serviceRow.months} חודשים (= ${expectedYears.toFixed(2)} שנים)`,
            });
        }
    }

    const fieldChecks: { fieldName: string; pdfValue: number | null; dbValue: number }[] = [
        { fieldName: 'סך חודשים', pdfValue: serviceRow.months, dbValue: dbRow.tkufa_mezaka_sherut },
        { fieldName: 'חלקיות משוקללת', pdfValue: serviceRow.weightedFraction, dbValue: dbRow.chelkiyut_meshuklelet_sherut },
        { fieldName: 'אחוז קצבה כפוף לחלקיות', pdfValue: serviceRow.pensionPercentSubjectToFraction, dbValue: dbRow.achuz_kizba_kafuf_chelkiyut },
        { fieldName: 'אחוז לפי חלקיות מלאה', pdfValue: serviceRow.percentOfFullFraction, dbValue: dbRow.achuz_kizb_achry_hagdl_chl_mla },
    ];
    for (const check of fieldChecks) {
        const isMatch = check.pdfValue !== null && Math.abs(check.pdfValue - check.dbValue) <= FIELD_TOLERANCE;
        if (!isMatch) {
            diffs.push({
                fieldName: check.fieldName,
                pdfValue: check.pdfValue === null ? 'חסר בדוח' : String(check.pdfValue),
                dataValue: String(check.dbValue),
            });
        }
    }

    return { status: diffs.length === 0 ? 'match' : 'mismatch', diffs, errors: [] };
}

/** טקסט מאוחד, באותו סגנון unifiedText של ההשוואה הקיימת. */
export function workSummaryText(result: WorkSummaryCompareResult): string {
    const statusText: Record<string, string> = {
        match: 'זהה במלואו',
        mismatch: 'נמצאו אי-התאמות',
        missing_pdf: 'לא נמצאה טבלת הסיכום בדוח',
        error: 'שגיאה בפענוח',
    };
    const lines = [`סיכום תקופות עבודה: ${statusText[result.status] ?? result.status}`];
    for (const d of result.diffs) {
        lines.push(`  - ${d.fieldName}: בדוח "${d.pdfValue}" מול "${d.dataValue}" בנתונים`);
    }
    for (const e of result.errors) lines.push(`  - שגיאה: ${e}`);
    return lines.join('\n');
}
