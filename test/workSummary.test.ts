/**
 * בדיקות ל-compareWorkSummary (לוגיקה טהורה) ול-POST /api/compare-summary.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { compareWorkSummary } from '../src/workSummaryComparator';
import { DbWorkSummaryRow, PdfParseResult, PdfWorkSummaryRow } from '../src/compare-types';
import { StartApp } from '../src/startApp';
import { CompareSummaryController } from '../src/components/compareSummary/compareSummary.controller';
import { SAMPLES } from './helpers/sampleData';

const dbRow: DbWorkSummaryRow = {
    tkufa_mezaka_sherut: 132,
    chelkiyut_meshuklelet_sherut: 0.822,
    achuz_kizba_kafuf_chelkiyut: 22,
    achuz_kizb_achry_hagdl_chl_mla: 18.084,
};

function pdfResultWith(serviceRow: Partial<PdfWorkSummaryRow> | null, extra: Partial<PdfParseResult> = {}): PdfParseResult {
    const workSummary: PdfWorkSummaryRow[] = serviceRow
        ? [{ kind: 'service', years: 11.0, months: 132, weightedFraction: 0.822, pensionPercentSubjectToFraction: 22, percentOfFullFraction: 18.084, ...serviceRow }]
        : [];
    return { idNumber: '12345678', periods: [], workSummary, warnings: [], errors: [], ...extra };
}

describe('compareWorkSummary', () => {
    it('הכל זהה - match', () => {
        const r = compareWorkSummary(dbRow, pdfResultWith({}));
        assert.equal(r.status, 'match');
        assert.deepEqual(r.diffs, []);
    });

    it('הפרש זעיר (עיגול) בתוך הסבילות - עדיין match', () => {
        const r = compareWorkSummary(dbRow, pdfResultWith({ weightedFraction: 0.8220003 }));
        assert.equal(r.status, 'match');
    });

    it('הפרש אמיתי בשדה אחד - mismatch עם diff אחד', () => {
        const r = compareWorkSummary(dbRow, pdfResultWith({ weightedFraction: 0.9 }));
        assert.equal(r.status, 'mismatch');
        assert.equal(r.diffs.length, 1);
        assert.equal(r.diffs[0].fieldName, 'חלקיות משוקללת');
    });

    it('הפרש בכמה שדות - diff לכל שדה', () => {
        const r = compareWorkSummary(dbRow, pdfResultWith({ pensionPercentSubjectToFraction: 50, percentOfFullFraction: 5 }));
        assert.equal(r.status, 'mismatch');
        assert.equal(r.diffs.length, 2);
    });

    it('יחס שנים/חודשים לא תקין בדוח עצמו - מדווח כ-diff (לא מול ה-DB)', () => {
        const r = compareWorkSummary(dbRow, pdfResultWith({ years: 5.0 })); // 132 חודשים = 11.0 שנים, לא 5.0
        assert.equal(r.status, 'mismatch');
        assert.ok(r.diffs.some((d) => d.fieldName === 'יחס שנים/חודשים בדוח'));
    });

    it('אין שורת "לפי אורך שירות" ב-PDF - missing_pdf', () => {
        const r = compareWorkSummary(dbRow, pdfResultWith(null));
        assert.equal(r.status, 'missing_pdf');
    });

    it('שגיאת פענוח PDF - error, בלי להשוות בכלל', () => {
        const r = compareWorkSummary(dbRow, pdfResultWith({}, { errors: ['קובץ פגום'] }));
        assert.equal(r.status, 'error');
        assert.deepEqual(r.errors, ['קובץ פגום']);
    });
});

describe('POST /api/compare-summary', () => {
    let server: Server;
    let baseUrl: string;

    before(async () => {
        const app = new StartApp([new CompareSummaryController()], 0).app;
        server = app.listen(0, '127.0.0.1');
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(() => server.close());

    async function post(body: unknown, { full = false } = {}): Promise<[number, any]> {
        const resp = await fetch(`${baseUrl}/api/compare-summary${full ? '?full=1' : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return [resp.status, await resp.json()];
    }

    const pdfOf = (id: string) => ({
        filename: `sample_${id}.pdf`,
        content: fs.readFileSync(path.join(SAMPLES, `sample_${id}.pdf`)).toString('base64'),
    });

    it('קובץ הדוגמה הקיים לא כולל טבלת סיכום - missing_pdf, valid=0', async () => {
        const [status, body] = await post({ row: dbRow, pdf: pdfOf('12345678') }, { full: true });
        assert.equal(status, 200);
        assert.equal(body.valid, 0);
        assert.equal(body.status, 'missing_pdf');
    });

    it('row חסר נדחה עם 400', async () => {
        const [status, body] = await post({ pdf: pdfOf('12345678') });
        assert.equal(status, 400);
        assert.ok(body.message || body.error);
    });

    it('row עם שדה חסר נדחה עם 400', async () => {
        const [status] = await post({ row: { tkufa_mezaka_sherut: 132 }, pdf: pdfOf('12345678') });
        assert.equal(status, 400);
    });

    it('pdf חסר נדחה עם 400', async () => {
        const [status] = await post({ row: dbRow });
        assert.equal(status, 400);
    });

    it('תשובה כברירת מחדל רזה: valid, text בלבד', async () => {
        const [status, body] = await post({ row: dbRow, pdf: pdfOf('12345678') });
        assert.equal(status, 200);
        assert.deepEqual(Object.keys(body).sort(), ['text', 'valid']);
    });
});
