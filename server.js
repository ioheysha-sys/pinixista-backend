const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = 3000;

// ===== SECURITY & MIDDLEWARE =====
app.use(helmet());
app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

// Rate limit (basic protection)
app.use(
    rateLimit({
        windowMs: 60 * 1000,
        max: 30
    })
);

// yt-dlp executable (Windows safe)
const YTDLP_PATH = path.join(__dirname, 'yt-dlp.exe');

// Ensure yt-dlp exists
const fs = require('fs');
if (!fs.existsSync(YTDLP_PATH)) {
    console.error('❌ yt-dlp.exe not found!');
    process.exit(1);
}

// ===== UNIVERSAL DOWNLOAD ENDPOINT =====
/**
 * GET /api/download?url=VIDEO_URL
 */
app.get('/api/download', (req, res) => {
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({
            success: false,
            message: 'URL is required'
        });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader(
        'Content-Disposition',
        'attachment; filename="video.mp4"'
    );
    res.setHeader('Transfer-Encoding', 'chunked');

    const yt = spawn(
        YTDLP_PATH,
        [
            '-f', 'bv*+ba/b',
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '-o', '-',
            url
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    yt.stdout.pipe(res);

    yt.stderr.on('data', data => {
        console.error('yt-dlp:', data.toString());
    });

    yt.on('error', err => {
        console.error('Spawn failed:', err);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Downloader failed'
            });
        }
    });

    yt.on('close', code => {
        if (code !== 0) {
            console.error(`yt-dlp exited with code ${code}`);
        }
        res.end();
    });

    // Client disconnect safety
    req.on('close', () => {
        yt.kill('SIGKILL');
    });
});

// ===== VIDEO INFO (PLATFORM DETECTION) =====
/**
 * POST /api/info
 * { "url": "VIDEO_URL" }
 */
app.post('/api/info', (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({
            success: false,
            message: 'URL is required'
        });
    }

    const yt = spawn(YTDLP_PATH, [
        '--dump-json',
        '--no-playlist',
        url
    ]);

    let output = '';

    yt.stdout.on('data', chunk => {
        output += chunk.toString();
    });

    yt.on('close', () => {
        try {
            const info = JSON.parse(output);
            res.json({
                success: true,
                data: {
                    title: info.title,
                    thumbnail: info.thumbnail,
                    duration: info.duration,
                    uploader: info.uploader,
                    platform: info.extractor_key
                }
            });
        } catch {
            res.status(500).json({
                success: false,
                message: 'Failed to fetch info'
            });
        }
    });
});

// ===== HEALTH CHECK =====
app.get('/api/health', (_, res) => {
    res.json({
        status: 'ok',
        service: 'universal-video-downloader',
        uptime: process.uptime()
    });
});

// ===== GLOBAL ERROR HANDLER =====
process.on('uncaughtException', err => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', err => {
    console.error('Unhandled Rejection:', err);
});

// ===== START SERVER =====
app.listen(PORT, () => {
    console.log(`🚀 Production server running on http://localhost:${PORT}`);
    console.log(`📥 Download: /api/download?url=VIDEO_URL`);
});
