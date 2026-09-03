import dotenv from 'dotenv';

dotenv.config();

export const config = {
    server: {
        port: Number(process.env.PORT) || 3000,
        env: process.env.NODE_ENV || 'development',
    },
    upload: {
        // Base64-encoded PDFs (JSON mode) roughly add ~33% to the raw file size,
        // so the JSON body limit is kept well above the raw upload limit.
        maxFileSize: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB) || 50,
        jsonBodyLimitMb: Number(process.env.JSON_BODY_LIMIT_MB) || 200,
    },
    compare: {
        // When set, every /api/compare request body is dumped there as JSON, for debugging.
        dumpDir: process.env.API_DUMP_DIR || null,
    },
};
