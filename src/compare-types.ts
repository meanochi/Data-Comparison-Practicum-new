/** תקופת עבודה אחת מקובץ ה-DAT (או מהטבלה הזמנית - אותו מבנה). */
export interface DataPeriod {
    idNumber: string;
    sugTkufa: number;
    start: string;
    end: string;
    months: number;
    sugZchuyot: number;
    heikef: number;
    lineNumber: number;
}

export interface ParseResult {
    periodsById: Record<string, DataPeriod[]>;
    warnings: string[];
    errors: string[];
}

/** תקופת עבודה אחת שחולצה מהדוח PDF. */
export interface PdfPeriod {
    tkufaLabel: string;
    start: string;
    end: string;
    months: number;
    zchuyotLabel: string;
    heikef: number;
    mekadem: number;
    page: number;
}

/**
 * שורת "סיכום תקופות עבודה" מהדוח (שתי שורות קבועות: "לפי אורך שירות"
 * ו"מחוץ לשירות"). בשורת "מחוץ לשירות" רק years/months מאוכלסים בדרך
 * כלל בדוח - שאר העמודות null.
 */
export interface PdfWorkSummaryRow {
    kind: 'service' | 'outside';
    years: number | null;
    months: number | null;
    weightedFraction: number | null;
    pensionPercentSubjectToFraction: number | null;
    percentOfFullFraction: number | null;
}

export interface PdfParseResult {
    idNumber: string | null;
    periods: PdfPeriod[];
    workSummary: PdfWorkSummaryRow[];
    warnings: string[];
    errors: string[];
}

export interface FieldDiff {
    fieldName: string;
    pdfValue: string;
    dataValue: string;
}

export type RowStatus = 'match' | 'diff' | 'data_only' | 'pdf_only';

export interface DataRowDict {
    sugTkufa: number;
    sugTkufaTeur: string;
    start: string;
    end: string;
    months: number;
    sugZchuyot: number;
    sugZchuyotTeur: string;
    heikef: number;
}

export interface PdfRowDict {
    tkufaLabel: string;
    start: string;
    end: string;
    months: number;
    zchuyotLabel: string;
    heikef: number;
    mekadem: number;
}

export interface CompareRowResult {
    status: RowStatus;
    start: string | null;
    end: string | null;
    diffs: FieldDiff[];
    pdfRow: PdfRowDict | null;
    dataRow: DataRowDict | null;
    startDisplay: string;
    endDisplay: string;
}

export type IdCompareStatus = 'match' | 'mismatch' | 'missing_pdf' | 'missing_data' | 'error';

export interface CompareIdResult {
    idNumber: string;
    status: IdCompareStatus;
    pdfFile: string | null;
    totalCompared: number;
    matched: number;
    rows: CompareRowResult[];
    // שורות שאינן משתתפות בהשוואה (למשל עזיבה/אין העסקה - קוד 4): יכולות
    // להגיע מצד הנתונים או מצד ה-PDF, לכן שני הצורות אפשריות כאן.
    excluded: (DataRowDict | PdfRowDict)[];
    warnings: string[];
    errors: string[];
    percent: number;
    mismatchCount: number;
}
