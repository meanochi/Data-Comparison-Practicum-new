/**
 * השוואת תקופות עבודה בין נתוני הטבלה הזמנית (או קובץ DAT) לקבצי PDF.
 *
 * ההתאמה בין שורות נעשית לפי מפתח (תאריך התחלה, תאריך סיום),
 * ולאחר מכן מושווים: סוג תקופה, אורך שירות, סוג זכויות והיקף משרה.
 */
import { fmtDate } from './parsers/datParser';
import {
    EXCLUDED_TKUFA_CODES,
    PDF_TKUFA_LABELS,
    PDF_ZCHUYOT_LABELS,
    SABBATICAL_LABEL,
    SABBATICAL_TKUFA_CODE,
    SABBATICAL_ZCHUYOT_CODE,
    SUG_TKUFA,
    SUG_ZCHUYOT,
} from './mappings';
import {
    CompareIdResult,
    CompareRowResult,
    DatPeriod,
    DatRowDict,
    FieldDiff,
    PdfParseResult,
    PdfPeriod,
    PdfRowDict,
    RowStatus,
} from './compare-types';

const MONTHS_TOLERANCE = 0.001;
const HEIKEF_TOLERANCE = 0.0005;

// סטטוסים לשורה בודדת
export const ROW_MATCH: RowStatus = 'match'; // כל השדות זהים
export const ROW_DIFF: RowStatus = 'diff'; // נמצאה אי-התאמה בשדות
export const ROW_DAT_ONLY: RowStatus = 'dat_only'; // תקופה שקיימת רק ב-DAT
export const ROW_PDF_ONLY: RowStatus = 'pdf_only'; // תקופה שקיימת רק ב-PDF

/** עיצוב מספר בסגנון %g של פייתון (6 ספרות משמעותיות, בלי אפסים עודפים). */
export function fmtG(n: number): string {
    return String(parseFloat(Number(n).toPrecision(6)));
}

function rowResult(status: RowStatus, start: string | null = null, end: string | null = null, extra: Partial<CompareRowResult> = {}): CompareRowResult {
    return {
        status,
        start,
        end,
        diffs: [],
        pdfRow: null,
        datRow: null,
        startDisplay: start ? fmtDate(start) : '',
        endDisplay: end ? fmtDate(end) : '',
        ...extra,
    };
}

function datRowDict(d: DatPeriod): DatRowDict {
    return {
        sugTkufa: d.sugTkufa,
        sugTkufaTeur: SUG_TKUFA[d.sugTkufa] ?? `קוד לא מוכר (${d.sugTkufa})`,
        start: d.start,
        end: d.end,
        months: d.months,
        sugZchuyot: d.sugZchuyot,
        sugZchuyotTeur: SUG_ZCHUYOT[d.sugZchuyot] ?? `קוד לא מוכר (${d.sugZchuyot})`,
        heikef: d.heikef,
    };
}

function pdfRowDict(p: PdfPeriod): PdfRowDict {
    return {
        tkufaLabel: p.tkufaLabel,
        start: p.start,
        end: p.end,
        months: p.months,
        zchuyotLabel: p.zchuyotLabel,
        heikef: p.heikef,
        mekadem: p.mekadem,
    };
}

/** השוואת שורה בודדת. מחזיר רשימת אי-התאמות (ריקה = זהה). */
function compareRow(pdfRow: PdfPeriod, datRow: DatPeriod, warnings: string[]): FieldDiff[] {
    const diffs: FieldDiff[] = [];

    // סוג תקופה. כלל מיוחד: "שבתון" ב-PDF = קוד 2 + זכויות 67 ב-DAT
    if (pdfRow.tkufaLabel === SABBATICAL_LABEL) {
        const ok = datRow.sugTkufa === SABBATICAL_TKUFA_CODE && datRow.sugZchuyot === SABBATICAL_ZCHUYOT_CODE;
        if (!ok) {
            diffs.push({
                fieldName: 'סוג תקופה',
                pdfValue: 'שבתון',
                datValue: `${datRow.sugTkufa} (${SUG_TKUFA[datRow.sugTkufa] ?? 'לא מוכר'}) + זכויות ${datRow.sugZchuyot}`,
            });
        }
    } else {
        const allowed = PDF_TKUFA_LABELS[pdfRow.tkufaLabel];
        if (allowed === undefined) {
            warnings.push(
                `תווית סוג תקופה לא מוכרת ב-PDF: "${pdfRow.tkufaLabel}" ` +
                `(תקופה ${fmtDate(pdfRow.start)} - ${fmtDate(pdfRow.end)}) - נדרש עדכון מיפוי`
            );
            diffs.push({
                fieldName: 'סוג תקופה',
                pdfValue: `${pdfRow.tkufaLabel} (תווית לא מוכרת)`,
                datValue: `${datRow.sugTkufa} (${SUG_TKUFA[datRow.sugTkufa] ?? 'לא מוכר'})`,
            });
        } else if (!allowed.has(datRow.sugTkufa)) {
            diffs.push({
                fieldName: 'סוג תקופה',
                pdfValue: pdfRow.tkufaLabel,
                datValue: `${datRow.sugTkufa} (${SUG_TKUFA[datRow.sugTkufa] ?? 'לא מוכר'})`,
            });
        }
    }

    // אורך שירות (חודשים)
    if (Math.abs(pdfRow.months - datRow.months) > MONTHS_TOLERANCE) {
        diffs.push({
            fieldName: 'אורך שירות (חודשים)',
            pdfValue: fmtG(pdfRow.months),
            datValue: fmtG(datRow.months),
        });
    }

    // סוג זכויות
    const allowedZ = PDF_ZCHUYOT_LABELS[pdfRow.zchuyotLabel];
    if (allowedZ === undefined) {
        warnings.push(
            `תווית סוג זכויות לא מוכרת ב-PDF: "${pdfRow.zchuyotLabel}" ` +
            `(תקופה ${fmtDate(pdfRow.start)} - ${fmtDate(pdfRow.end)}) - נדרש עדכון מיפוי`
        );
        diffs.push({
            fieldName: 'סוג זכויות',
            pdfValue: `${pdfRow.zchuyotLabel} (תווית לא מוכרת)`,
            datValue: `${datRow.sugZchuyot} (${SUG_ZCHUYOT[datRow.sugZchuyot] ?? 'לא מוכר'})`,
        });
    } else if (!allowedZ.has(datRow.sugZchuyot)) {
        diffs.push({
            fieldName: 'סוג זכויות',
            pdfValue: pdfRow.zchuyotLabel,
            datValue: `${datRow.sugZchuyot} (${SUG_ZCHUYOT[datRow.sugZchuyot] ?? 'לא מוכר'})`,
        });
    }

    // היקף משרה
    if (Math.abs(pdfRow.heikef - datRow.heikef) > HEIKEF_TOLERANCE) {
        diffs.push({
            fieldName: 'היקף משרה',
            pdfValue: pdfRow.heikef.toFixed(3),
            datValue: datRow.heikef.toFixed(3),
        });
    }
    return diffs;
}

/** תאימות סוג תקופה בין תווית ה-PDF לקוד בנתונים (כולל כלל השבתון). */
function tkufaCompatible(p: PdfPeriod, d: DatPeriod): boolean {
    if (p.tkufaLabel === SABBATICAL_LABEL) {
        return d.sugTkufa === SABBATICAL_TKUFA_CODE && d.sugZchuyot === SABBATICAL_ZCHUYOT_CODE;
    }
    return PDF_TKUFA_LABELS[p.tkufaLabel]?.has(d.sugTkufa) ?? false;
}

/** תאימות סוג זכויות בין תווית ה-PDF לקוד בנתונים. */
function zchuyotCompatible(p: PdfPeriod, d: DatPeriod): boolean {
    return PDF_ZCHUYOT_LABELS[p.zchuyotLabel]?.has(d.sugZchuyot) ?? false;
}

/**
 * ניקוד דמיון בין תקופת PDF לתקופת נתונים, לזיהוי "שורה עם שגיאה":
 * תאריכים שווים שוקלים 2 כל אחד, שאר השדות 1 כל אחד (מקסימום 8).
 */
function similarityScore(p: PdfPeriod, d: DatPeriod): number {
    let score = 0;
    if (p.start === d.start) score += 2;
    if (p.end === d.end) score += 2;
    if (Math.abs(p.months - d.months) <= MONTHS_TOLERANCE) score += 1;
    if (Math.abs(p.heikef - d.heikef) <= HEIKEF_TOLERANCE) score += 1;
    if (tkufaCompatible(p, d)) score += 1;
    if (zchuyotCompatible(p, d)) score += 1;
    return score;
}

// סף לצימוד תקופות "כמעט זהות": לפחות תאריך אחד זהה + עוד שני שדות תואמים
const FUZZY_MIN_SCORE = 4;

/**
 * צימוד תקופות שנשארו ללא התאמה מדויקת משני הצדדים, כשהן כמעט זהות.
 * מחזיר רשימת זוגות [pdfPeriod, datPeriod] ממוינת מהדמיון הגבוה לנמוך;
 * כל תקופה משתתפת בזוג אחד לכל היותר, ונדרש לפחות תאריך אחד זהה.
 */
function pairAlmostIdentical(pdfLeft: PdfPeriod[], datLeft: DatPeriod[]): [PdfPeriod, DatPeriod][] {
    const candidates: [number, PdfPeriod, DatPeriod][] = [];
    for (const p of pdfLeft) {
        for (const d of datLeft) {
            if (p.start !== d.start && p.end !== d.end) continue;
            const score = similarityScore(p, d);
            if (score >= FUZZY_MIN_SCORE) candidates.push([score, p, d]);
        }
    }
    candidates.sort((a, b) => b[0] - a[0]);
    const usedP = new Set<PdfPeriod>();
    const usedD = new Set<DatPeriod>();
    const pairs: [PdfPeriod, DatPeriod][] = [];
    for (const [, p, d] of candidates) {
        if (usedP.has(p) || usedD.has(d)) continue;
        usedP.add(p);
        usedD.add(d);
        pairs.push([p, d]);
    }
    return pairs;
}

function finalizeIdResult(res: CompareIdResult): CompareIdResult {
    res.percent = res.totalCompared === 0 ? 0.0 : Math.round((1000.0 * res.matched) / res.totalCompared) / 10;
    res.mismatchCount = res.totalCompared - res.matched;
    return res;
}

/** השוואת כל התקופות של מספר זהות אחד. */
export function compareId(
    idNumber: string,
    datPeriods: DatPeriod[] | undefined,
    pdfResult: PdfParseResult | null | undefined,
    pdfFile: string | null = null
): CompareIdResult {
    const res: CompareIdResult = {
        idNumber,
        status: 'match', // 'match' / 'mismatch' / 'missing_pdf' / 'missing_dat' / 'error'
        pdfFile,
        totalCompared: 0, // מספר התקופות שהושוו
        matched: 0, // מכללן - כמה זהות לחלוטין
        rows: [],
        excluded: [], // שורות עזיבה שלא הושוו
        warnings: [],
        errors: [],
        percent: 0,
        mismatchCount: 0,
    };
    if (pdfResult !== null && pdfResult !== undefined) {
        res.warnings.push(...pdfResult.warnings);
        res.errors.push(...pdfResult.errors);
    }

    const allPeriods = datPeriods || [];
    const active = allPeriods.filter((d) => !EXCLUDED_TKUFA_CODES.has(d.sugTkufa));
    res.excluded = allPeriods.filter((d) => EXCLUDED_TKUFA_CODES.has(d.sugTkufa)).map(datRowDict);

    if (pdfResult === null || pdfResult === undefined) {
        res.status = 'missing_pdf';
        res.rows = active.map((d) => rowResult(ROW_DAT_ONLY, d.start, d.end, { datRow: datRowDict(d) }));
        return finalizeIdResult(res);
    }
    if (pdfResult.errors.length > 0) {
        res.status = 'error';
        return finalizeIdResult(res);
    }
    if (allPeriods.length === 0) {
        res.status = 'missing_dat';
        res.rows = pdfResult.periods.map((p) => rowResult(ROW_PDF_ONLY, p.start, p.end, { pdfRow: pdfRowDict(p) }));
        return finalizeIdResult(res);
    }

    const pdfMap = new Map(pdfResult.periods.map((p) => [`${p.start}|${p.end}`, p]));
    const matchedKeys = new Set<string>();
    const datLeft: DatPeriod[] = [];

    // שלב 1: התאמה מדויקת לפי (תאריך התחלה, תאריך סיום)
    for (const d of active) {
        const key = `${d.start}|${d.end}`;
        const p = pdfMap.get(key);
        if (p === undefined) {
            datLeft.push(d);
            continue;
        }
        matchedKeys.add(key);
        res.totalCompared += 1;
        const diffs = compareRow(p, d, res.warnings);
        const status = diffs.length === 0 ? ROW_MATCH : ROW_DIFF;
        if (diffs.length === 0) res.matched += 1;
        res.rows.push(rowResult(status, d.start, d.end, { diffs, pdfRow: pdfRowDict(p), datRow: datRowDict(d) }));
    }
    const pdfLeft = pdfResult.periods.filter((p) => !matchedKeys.has(`${p.start}|${p.end}`));

    // שלב 2: זיהוי "שורה עם שגיאה" - תקופות כמעט זהות שנשארו משני הצדדים
    // מדווחות כשורה שגויה אחת עם פירוט ההבדלים (כולל הפרשי תאריכים),
    // במקום "קיימת רק בנתונים" + "קיימת רק במסמך".
    const pairs = pairAlmostIdentical(pdfLeft, datLeft);
    for (const [p, d] of pairs) {
        res.totalCompared += 1;
        const diffs: FieldDiff[] = [];
        if (p.start !== d.start) {
            diffs.push({ fieldName: 'מתאריך', pdfValue: fmtDate(p.start), datValue: fmtDate(d.start) });
        }
        if (p.end !== d.end) {
            diffs.push({ fieldName: 'עד תאריך', pdfValue: fmtDate(p.end), datValue: fmtDate(d.end) });
        }
        diffs.push(...compareRow(p, d, res.warnings));
        res.rows.push(rowResult(ROW_DIFF, d.start, d.end, { diffs, pdfRow: pdfRowDict(p), datRow: datRowDict(d) }));
    }
    const pairedD = new Set(pairs.map(([, d]) => d));
    const pairedP = new Set(pairs.map(([p]) => p));

    // שלב 3: מה שבאמת נשאר בצד אחד בלבד
    for (const d of datLeft) {
        if (pairedD.has(d)) continue;
        res.totalCompared += 1;
        res.rows.push(rowResult(ROW_DAT_ONLY, d.start, d.end, { datRow: datRowDict(d) }));
    }
    for (const p of pdfLeft) {
        if (pairedP.has(p)) continue;
        res.totalCompared += 1;
        res.rows.push(rowResult(ROW_PDF_ONLY, p.start, p.end, { pdfRow: pdfRowDict(p) }));
    }

    // מיון לפי תאריך התחלה (YYYYMMDD) מהחדש לישן, כמו בדו"ח
    const sortKey = (r: CompareRowResult) => {
        const s = r.start || '';
        return s.slice(4) + s.slice(2, 4) + s.slice(0, 2);
    };
    res.rows.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));
    res.status = res.matched === res.totalCompared ? 'match' : 'mismatch';
    return finalizeIdResult(res);
}

/**
 * טקסט מאוחד המרכז את כל התוצאות והפערים (לפי אפיון ה-API):
 * שורת סיכום, שורה לכל מספר זהות, ופירוט כל פער תחת הת"ז שלו.
 */
export function unifiedText(results: CompareIdResult[], warnings: string[]): string {
    const lines: string[] = [];
    const statusText: Record<string, string> = {
        match: 'זהה במלואו',
        mismatch: 'נמצאו אי-התאמות',
        missing_pdf: 'קיים בנתונים בלבד (חסר PDF)',
        missing_dat: 'קיים ב-PDF בלבד (חסר בנתונים)',
        error: 'שגיאה בפענוח',
    };
    for (const r of results) {
        let line = `ת"ז ${r.idNumber}: ${statusText[r.status] ?? r.status}`;
        if (r.totalCompared > 0) {
            line += ` (${r.matched} מתוך ${r.totalCompared} תקופות זהות)`;
        }
        lines.push(line);
        for (const row of r.rows) {
            const period = `תקופה ${row.startDisplay} - ${row.endDisplay}`;
            if (row.status === ROW_DIFF) {
                for (const d of row.diffs) {
                    lines.push(`  - ${period}: ${d.fieldName}: ב-PDF "${d.pdfValue}" מול "${d.datValue}" בנתונים`);
                }
            } else if (row.status === ROW_DAT_ONLY) {
                lines.push(`  - ${period}: קיימת בנתונים אך לא נמצאה ב-PDF`);
            } else if (row.status === ROW_PDF_ONLY) {
                lines.push(`  - ${period}: מופיעה ב-PDF אך לא נמצאה בנתונים`);
            }
        }
        for (const e of r.errors) lines.push(`  - שגיאה: ${e}`);
    }
    for (const w of warnings) lines.push(`אזהרה: ${w}`);
    return lines.join('\n');
}
