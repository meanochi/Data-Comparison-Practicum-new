/**
 * עזר לבדיקות בלבד: בניית שורות טבלה (כמו שה-API מקבל) מתוך samples/sample.dat.
 *
 * פענוח בייטים גולמיים של DAT (קידוד cp862, פיצול לפי '~') הוא שלב שקורה
 * *לפני* קריאת ה-API - במציאות זה מה ש-SQL*Loader עושה בטעינה לטבלה; ה-API
 * עצמו תמיד מקבל JSON. הפענוח כאן משמש רק להפקת נתוני בדיקה מהקובץ המקורי,
 * ואינו חלק מהמערכת עצמה (src/).
 */
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';

export const SAMPLES = path.join(__dirname, '..', '..', 'samples');

function decodeCp862(buf: Buffer): string {
    return iconv.decode(buf, 'cp862');
}

/**
 * המרת שורת DAT לרשומת טבלה, לפי סדר העמודות בבלוק 9050 של LD_Chinuch.ctl:
 * MISPAR_TNUA, KOD_PEULA, SEMEL_MISRAD, MISPAR_ZEHUT, ZIHUY_NOSAF, SUG_TKUFA,
 * TAARICH_ME, TAARICH_AD, ORECH_SHERUT, SUG_ZECHUYOT_LEGIMLA, HEKEF_MISRA.
 */
function datLineToRow(line: string, seq: number): Record<string, unknown> {
    const f = line.replace(/\s+$/, '').split('~');
    return {
        MISPAR_TNUA: f[0],
        KOD_PEULA: f[1],
        SEMEL_MISRAD: f[2],
        MISPAR_ZEHUT: f[3],
        ZIHUY_NOSAF: f[4],
        SUG_TKUFA: f[5],
        TAARICH_ME: f[6],
        TAARICH_AD: f[7],
        ORECH_SHERUT: f[8],
        SUG_ZECHUYOT_LEGIMLA: f[9],
        HEKEF_MISRA: f[10],
        SEQ: seq,
    };
}

/** שורות הדוגמה כפי שהיו נראות בטבלה הזמנית (רק רשומות 9050, SEQ = מספר שורה). */
export function sampleTableRows(): Record<string, unknown>[] {
    const text = decodeCp862(fs.readFileSync(path.join(SAMPLES, 'sample.dat')));
    return text
        .split(/\r\n|\r|\n/)
        .map((line, i): [string, number] => [line, i + 1])
        .filter(([line]) => line.startsWith('9050~'))
        .map(([line, lineNo]) => datLineToRow(line, lineNo));
}
