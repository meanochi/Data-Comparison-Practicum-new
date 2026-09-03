/**
 * עזרים משותפים לפענוח תקופות עבודה: נרמול מספר זהות, המרת שדה מספרי,
 * עיצוב תאריך לתצוגה, ובדיקת תקופות כפולות. משמשים את tableSource.ts
 * (מקור הנתונים היחיד של ה-API - שורות JSON מהטבלה הזמנית) ואת comparator.ts.
 *
 * פענוח בייטים גולמיים של קובץ ה-DAT עצמו (קידוד DOS-862, טעינה לטבלה)
 * אינו חלק מה-API: זה קורה קודם, במערכת המקור (SQL*Loader), ולא כאן.
 */
import { ParseResult } from '../compare-types';

/** נרמול מספר זהות: הסרת רווחים ואפסים מובילים (ב-PDF מודפס ללא אפס מוביל). */
export function normalizeId(raw: string): string {
    return raw.trim().replace(/^0+/, '');
}

/** DDMMYYYY -> DD/MM/YYYY לתצוגה. */
export function fmtDate(ddmmyyyy: string | null): string {
    if (ddmmyyyy && ddmmyyyy.length === 8) {
        return `${ddmmyyyy.slice(0, 2)}/${ddmmyyyy.slice(2, 4)}/${ddmmyyyy.slice(4)}`;
    }
    return ddmmyyyy ?? '';
}

/** המרת שדה מספרי; זורק שגיאה על ערך לא מספרי (כמו int() בפייתון). */
export function toInt(s: string): number {
    const t = s.trim();
    if (!/^-?\d+$/.test(t)) {
        throw new Error(`ערך לא מספרי: '${s}'`);
    }
    return parseInt(t, 10);
}

/** בדיקת שפיות: לא אמורות להיות שתי תקופות עם אותם תאריכים לאותה ת"ז. */
export function checkDuplicatePeriods(result: ParseResult): void {
    for (const [idNumber, periods] of Object.entries(result.periodsById)) {
        const seen = new Map<string, number>();
        for (const p of periods) {
            const key = `${p.start}|${p.end}`;
            if (seen.has(key)) {
                result.warnings.push(
                    `ת"ז ${idNumber}: נמצאו שתי תקופות עם אותם תאריכים ` +
                    `(${fmtDate(p.start)} - ${fmtDate(p.end)}, שורות ${seen.get(key)} ו-${p.lineNumber}). ` +
                    `ההשוואה עבור התקופה הזו עלולה להיות שגויה.`
                );
            } else {
                seen.set(key, p.lineNumber);
            }
        }
    }
}
