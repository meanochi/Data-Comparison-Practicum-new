/**
 * שכבת חילוץ טקסט גנרית מקובצי PDF (mupdf).
 *
 * השכבה הזו אינה יודעת דבר על מבנה דוח ספציפי - היא רק ממירה PDF לרשימת
 * שורות טקסט בסדר חזותי, לכל עמוד. פרסרים של דוחות (כמו pdfChinuchParser.ts)
 * בנויים מעליה, ופורמט דוח חדש = פרסר חדש שמשתמש באותה שכבה.
 *
 * מה השכבה פותרת:
 *
 * 1. עברית בסדר חזותי: חילוץ טקסט מ-PDF עברי מחזיר את האותיות בסדר שבו הן
 *    מצוירות על הדף (שמאל לימין), כלומר עברית הפוכה וספרות בסדר רגיל.
 *    למשל "פחות מ-1/3" מחולץ כ-"1/3-מ תוחפ". הפונקציות toVisual/toLogical
 *    ממירות בין שתי הצורות (פעולה סימטרית).
 *
 * 2. עצמאות מ-BiDi: כל תו נאסף עם קואורדינטת ה-X שלו וממוין משמאל לימין
 *    בתוך כל שורה, כך שמתקבל תמיד הסדר החזותי שעל הדף (זהה לפלט של
 *    pdfplumber בפייתון) ללא תלות בסידור ה-BiDi הפנימי של ספריית החילוץ.
 *
 * 3. פונטים משובצים ללא ToUnicode: בדוחות אמיתיים הפונטים העבריים הם לרוב
 *    Type0 בקידוד Identity-H ללא טבלת ToUnicode, כך שהטקסט בקובץ מפנה
 *    למספרי גליפים (GID) ולא לתווים. הפתרון (כמו ב-pdfminer): קריאת טבלת
 *    ה-cmap מתוך קובץ הפונט המשובץ (FontFile2) והיפוכה למיפוי GID -> Unicode.
 *
 * 4. קיבוץ שורות לפי קו הבסיס (Y) על פני כל העמוד - כי בדוחות טבלאיים כל
 *    תא הוא פיסת טקסט נפרדת - והוספת רווח כשיש מרווח גיאומטרי ממשי.
 */
// mupdf היא חבילת ESM טהורה (טעינת ה-WASM שלה משתמשת ב-top-level await), ולכן
// לא ניתן לטעון אותה עם require() ממודול CommonJS. import() דינמי רגיל היה
// מתקמפל ל-require() תחת module: commonjs, ולכן הטעינה נעשית עם import()
// אמיתי (native) דרך new Function, כדי לעקוף את ה-downleveling; נטענת פעם
// אחת ונשמרת במטמון.
const importMupdf = new Function('return import("mupdf")') as () => Promise<any>;
let mupdfPromise: Promise<any> | null = null;
function loadMupdf(): Promise<any> {
    return (mupdfPromise ??= importMupdf());
}

// מרווח אופקי (בנקודות) שמעליו מוכנס רווח בין תווים סמוכים -
// מקביל ל-x_tolerance של pdfplumber.
const SPACE_GAP = 3;

// תווים באותה שורת טקסט: הפרש עד 3 נקודות בקו הבסיס (y_tolerance של pdfplumber)
const LINE_Y_TOLERANCE = 3;

export interface ExtractedText {
    pages: string[][];
    unmappedFonts: string[];
}

interface CharInfo {
    c: string;
    left: number;
    right: number;
    y: number;
}

interface GidMapEntry {
    gidToUni: Map<number, number>;
    cidToGid: Uint8Array | null;
}

/** היפוך מחרוזת תוך שמירת רצפי ספרות (וסימנים כמו / % .) בסדר המקורי. */
function reverseKeepDigits(s: string): string {
    const tokens = s.match(/[0-9/.%()]+|[^0-9/.%()]+/g) || [];
    return tokens
        .reverse()
        .map((tok) => (/^[0-9/.%()]/.test(tok) ? tok : [...tok].reverse().join('')))
        .join('');
}

/** תווית עברית לוגית -> הצורה שבה היא מופיעה בטקסט המחולץ מה-PDF. */
export function toVisual(logical: string): string {
    return reverseKeepDigits(logical);
}

/** טקסט מחולץ (חזותי) -> עברית לוגית. פעולה סימטרית להיפוך. */
export function toLogical(visual: string): string {
    return reverseKeepDigits(visual);
}

/** נרמול מקפים מסוגים שונים (כולל מקף רך U+00AD ומקף עברי) למקף רגיל. */
export function normalizeDashes(s: string): string {
    return s.replace(/[­־‐-―]/g, '-');
}

/** פענוח טבלת cmap של פונט TrueType: מחזיר מיפוי GID -> קוד יוניקוד. */
function ttfGidToUnicode(bytes: Uint8Array): Map<number, number> | null {
    try {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const u16 = (o: number) => dv.getUint16(o);
        const u32 = (o: number) => dv.getUint32(o);
        let base = 0;
        if (u32(0) === 0x74746366) base = u32(12); // 'ttcf' - אוסף פונטים, לוקחים את הראשון
        const numTables = u16(base + 4);
        let cmapOff: number | null = null;
        for (let i = 0; i < numTables; i++) {
            const rec = base + 12 + i * 16;
            const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
            if (tag === 'cmap') {
                cmapOff = u32(rec + 8);
                break;
            }
        }
        if (cmapOff === null) return null;

        // בחירת תת-הטבלה העדיפה: (3,10) מלא, (3,1) יוניקוד, (0,*), (3,0) סמלים
        const n = u16(cmapOff + 2);
        let best: number | null = null;
        let bestScore = -1;
        let bestSymbol = false;
        for (let i = 0; i < n; i++) {
            const rec = cmapOff + 4 + i * 8;
            const plat = u16(rec);
            const enc = u16(rec + 2);
            const off = u32(rec + 4);
            let score = 0;
            if (plat === 3 && enc === 10) score = 5;
            else if (plat === 3 && enc === 1) score = 4;
            else if (plat === 0) score = 3;
            else if (plat === 3 && enc === 0) score = 1;
            if (score > bestScore) {
                bestScore = score;
                best = cmapOff + off;
                bestSymbol = plat === 3 && enc === 0;
            }
        }
        if (best === null) return null;

        const map = new Map<number, number>();
        const put = (code: number, gid: number) => {
            if (bestSymbol && code >= 0xf000 && code <= 0xf0ff) code -= 0xf000;
            if (gid !== 0 && !map.has(gid)) map.set(gid, code);
        };
        const format = u16(best);
        if (format === 4) {
            const segX2 = u16(best + 6);
            const endO = best + 14;
            const startO = endO + segX2 + 2;
            const deltaO = startO + segX2;
            const rangeO = deltaO + segX2;
            for (let s = 0; s < segX2; s += 2) {
                const end = u16(endO + s);
                const start = u16(startO + s);
                const delta = dv.getInt16(deltaO + s);
                const ro = u16(rangeO + s);
                if (start === 0xffff) continue;
                for (let code = start; code <= end; code++) {
                    let gid: number;
                    if (ro === 0) {
                        gid = (code + delta) & 0xffff;
                    } else {
                        const gi = rangeO + s + ro + (code - start) * 2;
                        if (gi + 1 >= bytes.byteLength) continue;
                        gid = u16(gi);
                        if (gid !== 0) gid = (gid + delta) & 0xffff;
                    }
                    put(code, gid);
                }
            }
        } else if (format === 12) {
            const nGroups = u32(best + 12);
            for (let g = 0; g < nGroups; g++) {
                const o = best + 16 + g * 12;
                const sc = u32(o);
                const ec = u32(o + 4);
                const sg = u32(o + 8);
                for (let c = sc; c <= ec; c++) put(c, sg + (c - sc));
            }
        } else if (format === 6) {
            const first = u16(best + 6);
            const cnt = u16(best + 8);
            for (let i = 0; i < cnt; i++) put(first + i, u16(best + 10 + i * 2));
        } else if (format === 0) {
            for (let c = 0; c < 256; c++) put(c, bytes[best + 6 + c]);
        } else {
            return null;
        }
        return map;
    } catch {
        return null;
    }
}

/**
 * מיפויי GID -> Unicode לכל הפונטים במסמך שהם Type0 ללא ToUnicode.
 * המפתח הוא שם ה-BaseFont, שהוא גם השם ש-walk מדווח לכל תו.
 */
function buildGidMaps(doc: any): Map<string, GidMapEntry | null> {
    const maps = new Map<string, GidMapEntry | null>();
    const numPages = doc.countPages();
    for (let i = 0; i < numPages; i++) {
        const page = doc.loadPage(i);
        try {
            const res = page.getObject().get('Resources');
            if (!res || res.isNull()) continue;
            const fonts = res.resolve().get('Font');
            if (!fonts || fonts.isNull()) continue;
            fonts.forEach((fontRef: any) => {
                try {
                    const f = fontRef.resolve();
                    if (String(f.get('Subtype')) !== '/Type0') return;
                    const tu = f.get('ToUnicode');
                    if (tu && !tu.isNull()) return; // ל-mupdf יש כבר פענוח מלא
                    const name = String(f.get('BaseFont')).replace(/^\//, '');
                    if (maps.has(name)) return;
                    const dFont = f.get('DescendantFonts').resolve().get(0).resolve();
                    const fd = dFont.get('FontDescriptor').resolve();
                    const ff = fd.get('FontFile2');
                    let entry: GidMapEntry | null = null;
                    if (ff && !ff.isNull()) {
                        const gidToUni = ttfGidToUnicode(ff.readStream().asUint8Array());
                        if (gidToUni) {
                            let cidToGid: Uint8Array | null = null;
                            const c2g = dFont.get('CIDToGIDMap');
                            if (c2g && !c2g.isNull() && c2g.isStream && c2g.isStream()) {
                                cidToGid = c2g.readStream().asUint8Array();
                            }
                            entry = { gidToUni, cidToGid };
                        }
                    }
                    maps.set(name, entry); // null = פונט שלא ניתן לפענח
                } catch {
                    /* פונט בעייתי - נתעלם, תווים ממנו יסומנו כלא מפוענחים */
                }
            });
        } finally {
            page.destroy();
        }
    }
    return maps;
}

/** חילוץ שורות הטקסט החזותיות של עמוד אחד. */
function pageToVisualLines(page: any, gidMaps: Map<string, GidMapEntry | null>, unmappedFonts: Set<string>): string[] {
    // inhibit-spaces: בלי רווחים מסונתזים של mupdf (הם מקבלים את הפונט של התו
    // הקודם ומתנגשים עם פענוח ה-GID); הרווחים נבנים אצלנו מהמרווח הגיאומטרי.
    const st = page.toStructuredText('preserve-whitespace,use-cid-for-unknown-unicode,inhibit-spaces');
    const chars: CharInfo[] = [];
    try {
        st.walk({
            onChar(c: string, origin: number[], font: any, size: number, quad: number[]) {
                // תו מפונט Type0 ללא ToUnicode מגיע כמספר גליף (GID) - מפוענח דרך ה-cmap
                const info = gidMaps.get(font.getName());
                if (info !== undefined) {
                    let cid = c.codePointAt(0)!;
                    if (info && info.cidToGid) {
                        cid = (info.cidToGid[2 * cid] << 8) | info.cidToGid[2 * cid + 1];
                    }
                    const uni = info ? info.gidToUni.get(cid) : undefined;
                    if (uni === undefined) {
                        unmappedFonts.add(font.getName());
                        c = '�';
                    } else {
                        c = String.fromCodePoint(uni);
                    }
                }
                // quad: [ulx, uly, urx, ury, llx, lly, lrx, lry]
                chars.push({
                    c,
                    left: Math.min(quad[0], quad[4]),
                    right: Math.max(quad[2], quad[6]),
                    y: origin[1],
                });
            },
        });
    } finally {
        st.destroy();
    }

    // קיבוץ לשורות לפי קו הבסיס, מלמעלה למטה
    chars.sort((a, b) => a.y - b.y || a.left - b.left);
    const lines: CharInfo[][] = [];
    let current: CharInfo[] | null = null;
    let currentY: number | null = null;
    for (const ch of chars) {
        if (current === null || currentY === null || Math.abs(ch.y - currentY) > LINE_Y_TOLERANCE) {
            current = [];
            currentY = ch.y;
            lines.push(current);
        }
        current.push(ch);
    }

    return lines.map((lineChars) => {
        lineChars.sort((a, b) => a.left - b.left);
        let text = '';
        let prevRight: number | null = null;
        for (const ch of lineChars) {
            if (prevRight !== null && ch.left - prevRight > SPACE_GAP && !/\s/.test(text.slice(-1))) {
                text += ' ';
            }
            text += ch.c;
            prevRight = ch.right;
        }
        // כיווץ רצפי רווחים כדי שהתוויות יתאימו למיפוי גם אם נוצר רווח כפול
        return text.replace(/\s+/g, ' ').trim();
    });
}

/**
 * חילוץ כל שורות הטקסט מקובץ PDF, בסדר חזותי.
 *
 * מחזיר { pages: [[שורות עמוד 1], [שורות עמוד 2], ...], unmappedFonts: [שמות] }.
 * זורק שגיאה על קובץ פגום/מוצפן - באחריות הקורא לתפוס.
 */
export async function extractVisualLines(buf: Buffer): Promise<ExtractedText> {
    const mupdf = await loadMupdf();
    const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf') as any;
    try {
        const gidMaps = buildGidMaps(doc);
        const unmappedFonts = new Set<string>();
        const pages: string[][] = [];
        for (let i = 0; i < doc.countPages(); i++) {
            const page = doc.loadPage(i);
            try {
                pages.push(pageToVisualLines(page, gidMaps, unmappedFonts));
            } finally {
                page.destroy();
            }
        }
        return { pages, unmappedFonts: [...unmappedFonts] };
    } finally {
        doc.destroy();
    }
}
