/**
 * פרסר דו"ח "סיכום נתוני פרישה": מספר זהות + טבלת "פירוט תקופות עבודה".
 *
 * הפרסר בנוי מעל שכבת החילוץ הגנרית (pdfText.ts), שמספקת את שורות הטקסט
 * של כל עמוד בסדר חזותי. פורמט דוח נוסף בעתיד = קובץ פרסר חדש כמו זה,
 * שמשתמש באותו extractVisualLines ומגדיר רק את הרג'קסים ומבנה השורה שלו.
 */
import fs from 'node:fs';
import { extractVisualLines, normalizeDashes, toLogical, toVisual } from '../pdfText';
import { PdfParseResult, PdfPeriod } from '../compare-types';

// ייצוא חוזר לנוחות הצרכנים (בדיקות, פרסרים עתידיים)
export { toLogical, toVisual, normalizeDashes };

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// שורת טבלה בטקסט המחולץ (משמאל לימין):
// מקדם | היקף משרה | סוג זכויות | אורך שירות | תאריך עד | מתאריך | סוג תקופה
// עמודת "מקדם" יכולה להכיל גם ערך לא-מספרי (למשל "V" כדגל סטטוס) - היא
// לא משמשת בהשוואה בפועל (comparator.ts לא בודק אותה), ולכן מתקבלת כאן
// באופן גמיש (\S+) כדי לא לגרום לדילוג שקט על שורות שלמות בטבלה.
const ROW_RE = new RegExp(
    '^(\\S+)\\s+([\\d.]+)\\s+(\\S.*?)\\s+([\\d.]+)\\s+' +
    '(\\d{2}-\\d{2}-\\d{4})\\s+(\\d{2}-\\d{2}-\\d{4})\\s+(\\S.*)$'
);

// "מספר זהות: 12345678" - בטקסט החזותי התווית הפוכה והמספר לפניה
const ID_RE = new RegExp('(\\d{5,9})\\s*:' + escapeRegExp(toVisual('מספר זהות')));

/** פענוח PDF מתוך Buffer. */
export async function parsePdfBuffer(buf: Buffer): Promise<PdfParseResult> {
    const result: PdfParseResult = { idNumber: null, periods: [], warnings: [], errors: [] };
    let extracted;
    try {
        extracted = await extractVisualLines(buf);
    } catch (exc: any) {
        // קובץ פגום, מוצפן וכו'
        result.errors.push(`שגיאה בקריאת ה-PDF: ${exc.message || exc}`);
        return result;
    }

    extracted.pages.forEach((lines, i) => parsePageLines(lines, i + 1, result));
    for (const name of extracted.unmappedFonts) {
        result.warnings.push(`הפונט המשובץ "${name}" מכיל תווים שלא ניתן לפענח - ייתכן טקסט חסר`);
    }

    if (result.idNumber === null) {
        result.errors.push('לא נמצא "מספר זהות" בכותרת הדו"ח');
    }
    if (result.periods.length === 0) {
        result.errors.push('לא נמצאו שורות בטבלת "פירוט תקופות עבודה"');
    }
    return result;
}

export async function parsePdfFile(path: string): Promise<PdfParseResult> {
    return parsePdfBuffer(fs.readFileSync(path));
}

function parsePageLines(lines: string[], pageNo: number, result: PdfParseResult): void {
    for (let rawLine of lines) {
        const line = normalizeDashes(rawLine.trim());
        if (result.idNumber === null) {
            const m = ID_RE.exec(line);
            if (m) {
                result.idNumber = m[1].replace(/^0+/, '');
            }
        }
        const m = ROW_RE.exec(line);
        if (!m) continue;
        const [, mekadem, heikef, zchuyotVis, months, end, start, tkufaVis] = m;
        const parsed: PdfPeriod = {
            tkufaLabel: toLogical(tkufaVis.trim()),
            start: start.replace(/-/g, ''),
            end: end.replace(/-/g, ''),
            months: parseFloat(months),
            zchuyotLabel: toLogical(zchuyotVis.trim()),
            heikef: parseFloat(heikef),
            mekadem: parseFloat(mekadem), // עשוי להיות NaN (למשל "V") - לא בשימוש בהשוואה
            page: pageNo,
        };
        if ([parsed.months, parsed.heikef].some((n) => !Number.isFinite(n))) {
            result.warnings.push(`עמוד ${pageNo}: שורת טבלה לא תקינה (ערך מספרי שגוי)`);
            continue;
        }
        result.periods.push(parsed);
    }
}
