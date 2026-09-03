/** בדיקות מערכת: פענוח PDF והשוואה, על קבצי הדוגמה שב-samples/. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';

import { ROW_DAT_ONLY, ROW_DIFF, ROW_MATCH, ROW_PDF_ONLY, compareId } from '../src/comparator';
import { parsePdfFile, toLogical, toVisual } from '../src/parsers/pdfChinuchParser';
import { parseTableRows } from '../src/tableSource';
import { CompareIdResult } from '../src/compare-types';
import { SAMPLES, sampleTableRows } from './helpers/sampleData';

// ---------- פענוח בסיסי ----------

describe('היפוך חזותי/לוגי', () => {
    it('פעולה סימטרית על תוויות', () => {
        for (const label of ['פחות מ-1/3', 'חל"ת', 'נושא זכויות', 'שבתון', 'הפעלת סעיף 99']) {
            assert.equal(toLogical(toVisual(label)), label);
        }
        // ספרות נשארות בסדר לוגי בצורה החזותית
        assert.ok(toVisual('פחות מ-1/3').startsWith('1/3'));
    });
});

describe('פענוח PDF', () => {
    it('פענוח קובץ הדוגמה', async () => {
        const pres = await parsePdfFile(path.join(SAMPLES, 'sample_12345678.pdf'));
        assert.equal(pres.idNumber, '12345678');
        assert.equal(pres.errors.length, 0);
        assert.equal(pres.periods.length, 5);
        const byKey = new Map(pres.periods.map((p) => [`${p.start}|${p.end}`, p]));
        const p = byKey.get('01092015|31082016')!;
        assert.equal(p.zchuyotLabel, 'פחות מ-1/3');
        assert.equal(p.heikef, 0.3);
        assert.equal(p.months, 12.0);
        const sab = byKey.get('01092016|31082017')!;
        assert.equal(sab.tkufaLabel, 'שבתון');
        assert.equal(sab.zchuyotLabel, 'שבתון');
    });
});

// ---------- השוואה ----------

/**
 * השוואת כל מספרי הזהות שבנתוני הטבלה הזמנית (מ-sample.dat) ובקבצי ה-PDF
 * שבתיקייה, ת"ז מול ת"ז - מקביל למה ש-compareAll עשתה בגרסה הקודמת, כשה-API
 * עצמו משווה תמיד ת"ז אחת.
 */
async function compareSamples(): Promise<Map<string, CompareIdResult>> {
    const dat = parseTableRows(sampleTableRows());
    const pdfsById = new Map<string, { fname: string; result: Awaited<ReturnType<typeof parsePdfFile>> }>();
    for (const fname of fs.readdirSync(SAMPLES).sort()) {
        if (!fname.endsWith('.pdf')) continue;
        const result = await parsePdfFile(path.join(SAMPLES, fname));
        if (result.idNumber) pdfsById.set(result.idNumber, { fname, result });
    }
    const allIds = new Set([...Object.keys(dat.periodsById), ...pdfsById.keys()]);
    const byId = new Map<string, CompareIdResult>();
    for (const idNumber of allIds) {
        const pdf = pdfsById.get(idNumber);
        byId.set(idNumber, compareId(idNumber, dat.periodsById[idNumber], pdf?.result, pdf?.fname ?? null));
    }
    return byId;
}

describe('השוואה מלאה על קבצי הדוגמה', () => {
    let res: Map<string, CompareIdResult>;

    before(async () => {
        res = await compareSamples();
    });

    it('התאמה מלאה כולל עזיבה מוחרגת', () => {
        const r = res.get('12345678')!;
        assert.equal(r.status, 'match');
        assert.equal(r.totalCompared, 5);
        assert.equal(r.matched, 5);
        assert.equal(r.percent, 100.0);
        // שורת העזיבה לא נספרת אלא רק מוצגת לידיעה
        assert.equal(r.excluded.length, 1);
        assert.equal(r.excluded[0].sugTkufa, 4);
    });

    it('זיהוי כל אי-ההתאמות המכוונות', () => {
        const r = res.get('23456789')!;
        assert.equal(r.status, 'mismatch');
        assert.equal(r.totalCompared, 7);
        assert.equal(r.matched, 2);
        const rows = new Map(r.rows.map((row) => [`${row.start}|${row.end}`, row]));

        let diff = rows.get('01092005|31082010')!;
        assert.equal(diff.status, ROW_DIFF);
        assert.deepEqual(diff.diffs.map((d) => d.fieldName), ['היקף משרה']);

        diff = rows.get('01092010|31082012')!;
        assert.deepEqual(diff.diffs.map((d) => d.fieldName), ['סוג זכויות']);

        diff = rows.get('01092012|31082013')!;
        assert.deepEqual(diff.diffs.map((d) => d.fieldName), ['אורך שירות (חודשים)']);

        assert.equal(rows.get('01092013|31082014')!.status, ROW_DAT_ONLY);
        assert.equal(rows.get('01091998|31082000')!.status, ROW_PDF_ONLY);
        assert.equal(rows.get('01092000|31082005')!.status, ROW_MATCH);
    });

    it('צדדים חסרים', () => {
        assert.equal(res.get('34567890')!.status, 'missing_pdf');
        assert.equal(res.get('45678901')!.status, 'missing_dat');
    });

    it('כלל השבתון', () => {
        const r = res.get('12345678')!;
        const sab = r.rows.find((row) => row.start === '01092016')!;
        assert.equal(sab.status, ROW_MATCH);
    });
});

// ---------- זיהוי "שורה עם שגיאה" (תקופות כמעט זהות) ----------

describe('זיהוי שורה עם שגיאה', () => {
    const datPeriod = {
        idNumber: '1',
        sugTkufa: 9999,
        start: '01092010',
        end: '31082015',
        months: 60,
        sugZchuyot: 2,
        heikef: 1,
        lineNumber: 1,
    };
    const pdfResult = (period: any) => ({
        idNumber: '1',
        periods: [period],
        warnings: [],
        errors: [],
    });
    const pdfPeriod = {
        tkufaLabel: 'קביעות',
        start: '01092010',
        end: '31082015',
        months: 60,
        zchuyotLabel: 'מוקפא',
        heikef: 1,
        mekadem: 0,
        page: 1,
    };

    it('תאריך סיום שונה - שורה שגויה אחת, לא שתי שורות חד-צדדיות', () => {
        const r = compareId('1', [datPeriod], pdfResult({ ...pdfPeriod, end: '30082015' }));
        assert.equal(r.totalCompared, 1);
        assert.equal(r.rows.length, 1);
        assert.equal(r.rows[0].status, ROW_DIFF);
        assert.deepEqual(r.rows[0].diffs.map((d) => d.fieldName), ['עד תאריך']);
        assert.equal(r.status, 'mismatch');
    });

    it('תאריך התחלה שונה + היקף שונה - שורה שגויה עם שני פערים', () => {
        const r = compareId('1', [datPeriod], pdfResult({ ...pdfPeriod, start: '01102010', heikef: 0.5 }));
        assert.equal(r.rows.length, 1);
        assert.equal(r.rows[0].status, ROW_DIFF);
        assert.deepEqual(r.rows[0].diffs.map((d) => d.fieldName), ['מתאריך', 'היקף משרה']);
    });

    it('תקופות שונות באמת (אף תאריך זהה) נשארות חד-צדדיות', () => {
        const r = compareId('1', [datPeriod], pdfResult({ ...pdfPeriod, start: '01091990', end: '31081995' }));
        assert.equal(r.totalCompared, 2);
        const statuses = r.rows.map((row) => row.status).sort();
        assert.deepEqual(statuses, [ROW_DAT_ONLY, ROW_PDF_ONLY]);
    });

    it('תאריך אחד זהה אבל כל השאר שונה - לא מצומד', () => {
        const r = compareId(
            '1',
            [datPeriod],
            pdfResult({
                ...pdfPeriod,
                end: '31121212',
                months: 3,
                heikef: 0.1,
                tkufaLabel: 'חל"ת',
                zchuyotLabel: 'נרכש',
            })
        );
        assert.equal(r.totalCompared, 2);
        const statuses = r.rows.map((row) => row.status).sort();
        assert.deepEqual(statuses, [ROW_DAT_ONLY, ROW_PDF_ONLY]);
    });
});
