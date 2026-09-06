/**
 * בדיקות למקור הטבלה הזמנית (tableSource) ול-API (POST /api/compare).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { compareId } from '../src/comparator';
import { parsePdfFile } from '../src/parsers/pdfChinuchParser';
import { parseTableRows } from '../src/tableSource';
import { StartApp } from '../src/startApp';
import { CompareController } from '../src/components/compare/compare.controller';
import { SAMPLES, sampleTableRows } from './helpers/sampleData';

const ROW_12345678 = {
    MISPAR_TNUA: '9050',
    MISPAR_ZEHUT: '012345678',
    SUG_TKUFA: '9999',
    TAARICH_ME: '01092010',
    TAARICH_AD: '31082015',
    ORECH_SHERUT: '06000',
    SUG_ZECHUYOT_LEGIMLA: '02',
    HEKEF_MISRA: '1000',
    SEQ: 1,
};

describe('פענוח שורות מהטבלה הזמנית', () => {
    it('רשומות שאינן 9050 מדולגות בשקט', () => {
        const res = parseTableRows([{ ...ROW_12345678, MISPAR_TNUA: '9022' }, ROW_12345678]);
        assert.equal(res.periodsById['12345678'].length, 1);
        assert.equal(res.errors.length, 0);
    });

    it('שמות עמודות באותיות קטנות מתקבלים גם כן', () => {
        const lower = Object.fromEntries(Object.entries(ROW_12345678).map(([k, v]) => [k.toLowerCase(), v]));
        const res = parseTableRows([lower]);
        assert.equal(res.periodsById['12345678'].length, 1);
    });

    it('שורות פגומות מדווחות כשגיאות ומדולגות', () => {
        const res = parseTableRows([
            ROW_12345678,
            { ...ROW_12345678, SUG_TKUFA: 'XXXX', TAARICH_ME: '01092015', SEQ: 2 }, // לא מספרי
            { ...ROW_12345678, MISPAR_ZEHUT: null, SEQ: 3 }, // עמודה חסרה
            'לא אובייקט',
        ]);
        assert.equal(res.periodsById['12345678'].length, 1);
        assert.equal(res.errors.length, 3);
        assert.ok(res.errors[0].includes('שורה 2'));
        assert.ok(res.errors[1].includes('MISPAR_ZEHUT'));
    });

    it('אזהרה על תקופות כפולות', () => {
        const res = parseTableRows([ROW_12345678, { ...ROW_12345678, SEQ: 2 }]);
        assert.ok(res.warnings.some((w) => w.includes('אותם תאריכים')));
    });

    it('קלט שאינו מערך מוחזר כשגיאה', () => {
        const res = parseTableRows({ not: 'array' });
        assert.equal(res.errors.length, 1);
    });
});

describe('השוואה מלאה מנתוני הטבלה הזמנית', () => {
    it('תוצאות זהות לקבצי הדוגמה', async () => {
        const table = parseTableRows(sampleTableRows());
        const byId = new Map<string, string>();
        for (const fname of fs.readdirSync(SAMPLES).sort()) {
            if (!fname.endsWith('.pdf')) continue;
            const pres = await parsePdfFile(path.join(SAMPLES, fname));
            const idNumber = pres.idNumber ?? `? (${fname})`;
            byId.set(idNumber, compareId(idNumber, table.periodsById[idNumber], pres, fname).status);
        }
        for (const idNumber of Object.keys(table.periodsById)) {
            if (!byId.has(idNumber)) {
                byId.set(idNumber, compareId(idNumber, table.periodsById[idNumber], undefined, null).status);
            }
        }
        assert.equal(byId.get('12345678'), 'match');
        assert.equal(byId.get('23456789'), 'mismatch');
        assert.equal(byId.get('34567890'), 'missing_pdf');
        assert.equal(byId.get('45678901'), 'missing_data');
    });
});

describe('POST /api/compare', () => {
    let server: Server;
    let baseUrl: string;

    before(async () => {
        const app = new StartApp([new CompareController()], 0).app;
        server = app.listen(0, '127.0.0.1');
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(() => server.close());

    async function post(body: unknown, { full = false } = {}): Promise<[number, any]> {
        const resp = await fetch(`${baseUrl}/api/compare${full ? '?full=1' : ''}`, {
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
    const rowsOf = (id: string) => sampleTableRows().filter((r) => r.MISPAR_ZEHUT === id);

    it('קריאה נפרדת לכל ת"ז, כמו המעטפת והמערכת הקיימת', async () => {
        // ת"ז תקינה במלואה
        let [status, body] = await post({ rows: rowsOf('012345678'), pdf: pdfOf('12345678') });
        assert.equal(status, 200);
        assert.equal(body.valid, 1);
        assert.equal(body.idNumber, '12345678');
        assert.ok(body.text.includes('זהה במלואו'));

        // ת"ז עם אי-התאמות - עם ?full=1 מקבלים גם את הפירוט המלא
        [status, body] = await post({ rows: rowsOf('023456789'), pdf: pdfOf('23456789') }, { full: true });
        assert.equal(status, 200);
        assert.equal(body.valid, 0);
        assert.equal(body.summary.mismatch, 1);
        assert.ok(body.text.includes('מול'));

        // מסמך שאין לו שורות בטבלה
        [status, body] = await post({ rows: [], pdf: pdfOf('45678901') }, { full: true });
        assert.equal(status, 200);
        assert.equal(body.valid, 0);
        assert.equal(body.results[0].status, 'missing_data');
    });

    it('תיעוד ה-API זמין ב-/api-docs (Swagger UI)', async () => {
        const resp = await fetch(`${baseUrl}/api-docs/`);
        assert.equal(resp.status, 200);
        assert.ok((await resp.text()).includes('swagger-ui'));
    });

    it('התשובה כברירת מחדל רזה: valid, idNumber, rows, text בלבד', async () => {
        const [status, body] = await post({ rows: rowsOf('012345678'), pdf: pdfOf('12345678') });
        assert.equal(status, 200);
        assert.deepEqual(Object.keys(body).sort(), ['idNumber', 'rows', 'text', 'valid']);
    });

    it('form-data: ה-PDF מצורף כקובץ ממש ו-rows כשדה טקסט', async () => {
        const fd = new FormData();
        fd.append('rows', JSON.stringify(rowsOf('012345678')));
        fd.append(
            'pdf',
            new Blob([fs.readFileSync(path.join(SAMPLES, 'sample_12345678.pdf'))], { type: 'application/pdf' }),
            'sample_12345678.pdf'
        );
        const resp = await fetch(`${baseUrl}/api/compare`, { method: 'POST', body: fd });
        const body: any = await resp.json();
        assert.equal(resp.status, 200);
        assert.equal(body.valid, 1);
        assert.equal(body.idNumber, '12345678');
        assert.ok(body.rows.every((r: any) => r.valid === 1));
    });

    it('form-data עם rows שאינו JSON תקין נדחה ב-400', async () => {
        const fd = new FormData();
        fd.append('rows', 'לא JSON');
        fd.append('pdf', new Blob([Buffer.from('x')], { type: 'application/pdf' }), 'a.pdf');
        const resp = await fetch(`${baseUrl}/api/compare`, { method: 'POST', body: fd });
        assert.equal(resp.status, 400);
    });

    it('התשובה מחזירה את השורות שנשלחו עם valid לכל שורה', async () => {
        const sent = rowsOf('023456789');
        const [status, body] = await post({ rows: sent, pdf: pdfOf('23456789') });
        assert.equal(status, 200);
        assert.equal(body.rows.length, sent.length);
        // השורות חוזרות כפי שנשלחו, בתוספת valid (ו-reason כשלא תקין)
        for (const [i, row] of body.rows.entries()) {
            assert.equal(row.MISPAR_ZEHUT, sent[i].MISPAR_ZEHUT);
            assert.equal(row.SEQ, sent[i].SEQ);
            assert.ok(row.valid === 0 || row.valid === 1);
            if (row.valid === 0) assert.ok(row.reason.length > 0);
        }
        const byStart = new Map(body.rows.map((r: any) => [r.TAARICH_ME, r]));
        assert.equal((byStart.get('01092000') as any).valid, 1); // תואמת במלואה
        assert.equal((byStart.get('01092005') as any).valid, 0); // היקף משרה שונה
        assert.ok((byStart.get('01092005') as any).reason.includes('היקף משרה'));
        assert.equal((byStart.get('01092013') as any).valid, 0); // אין תקופה כזו במסמך
    });

    it('יותר מת"ז אחת בקריאה נדחית ב-400', async () => {
        const [status, body] = await post({ rows: sampleTableRows(), pdf: pdfOf('12345678') });
        assert.equal(status, 400);
        assert.ok(body.error.includes('אחד-על-אחד'));
    });

    it('בקשה ללא rows נדחית', async () => {
        const [status] = await post({ pdf: pdfOf('12345678') });
        assert.equal(status, 400);
    });

    it('בקשה ללא pdf נדחית', async () => {
        const [status, body] = await post({ rows: rowsOf('012345678') });
        assert.equal(status, 400);
        assert.ok(body.error.includes('pdf'));
    });

    it('rows ריק + PDF פגום יחד - מדווח כשגיאה, לא כחסר בנתונים', async () => {
        const [status, body] = await post(
            {
                rows: [],
                pdf: { filename: 'broken.pdf', content: Buffer.from('לא PDF').toString('base64') },
            },
            { full: true }
        );
        assert.equal(status, 200);
        assert.equal(body.valid, 0);
        assert.equal(body.results[0].status, 'error');
    });

    it('PDF פגום מדווח כשגיאה בלי להפיל את הבקשה', async () => {
        const [status, body] = await post(
            {
                rows: rowsOf('012345678'),
                pdf: { filename: 'broken.pdf', content: Buffer.from('לא PDF').toString('base64') },
            },
            { full: true }
        );
        assert.equal(status, 200);
        assert.equal(body.valid, 0);
        assert.equal(body.summary.error, 1);
    });
});
