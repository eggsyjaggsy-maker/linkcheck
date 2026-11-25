const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeLink, parseBatchInput } = require('./normalizer');
const { createDatabase } = require('./db');
const { createAuthManager } = require('./auth');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_CHECK_LINKS = 500;
const MAX_CHECK_BODY_BYTES = 256 * 1024;
const MAX_UPLOAD_BODY_BYTES = 5 * 1024 * 1024;

function createRateLimiter(windowMs, maxHits) {
  const hits = new Map();
  return function checkLimit(key) {
    const now = Date.now();
    const record = hits.get(key);
    if (!record || now > record.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (record.count >= maxHits) {
      return false;
    }
    record.count += 1;
    return true;
  };
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload terlalu besar'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Format JSON tidak valid'), { statusCode: 400 }));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extraHeaders,
  });
  res.end(body);
}

function serveStatic(reqPath, res) {
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(resolved, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        sendJson(res, 404, { error: 'Not Found' });
      } else {
        sendJson(res, 500, { error: 'Internal Server Error' });
      }
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    res.end(content);
  });
}

function createApp(options = {}) {
  const dbPath = options.dbPath || path.resolve(__dirname, '..', 'data', 'app.db');
  const masterPassword = options.masterPassword || process.env.MASTER_PASSWORD || 'master123';
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;

  const db = createDatabase(dbPath);
  const auth = createAuthManager({ masterPassword, sessionSecret });

  const loginLimiter = createRateLimiter(5 * 60 * 1000, options.loginRateLimit || 15);
  const checkLimiter = createRateLimiter(60 * 1000, options.checkRateLimit || 120);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const clientIp = req.socket.remoteAddress || 'unknown';

    try {
      // Public: List status (never exposes list contents)
      if (req.method === 'GET' && pathname === '/api/status') {
        return sendJson(res, 200, db.getStatus());
      }

      // Public: Check single or batch links against Master's list
      if (req.method === 'POST' && pathname === '/api/check') {
        if (!checkLimiter(clientIp)) {
          return sendJson(res, 429, { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
        }

        const body = await readJsonBody(req, MAX_CHECK_BODY_BYTES);
        let rawItems = [];

        if (Array.isArray(body.links)) {
          rawItems = body.links.map((item) => String(item ?? '').trim()).filter(Boolean);
        } else if (typeof body.input === 'string') {
          rawItems = parseBatchInput(body.input);
        } else {
          return sendJson(res, 400, { error: 'Masukkan link pada field "input" atau "links".' });
        }

        if (rawItems.length === 0) {
          return sendJson(res, 400, { error: 'Tidak ada link yang dimasukkan.' });
        }

        if (rawItems.length > MAX_CHECK_LINKS) {
          return sendJson(res, 400, {
            error: `Maksimal ${MAX_CHECK_LINKS} link per pengecekan.`,
          });
        }

        const status = db.getStatus();
        const results = rawItems.map((raw) => {
          const norm = normalizeLink(raw);
          if (!norm.valid) {
            return {
              input: raw,
              canonical: null,
              valid: false,
              inList: false,
              reason: norm.reason,
            };
          }
          const inList = status.hasData ? db.hasLinkHash(norm.hash) : false;
          return {
            input: raw,
            canonical: norm.canonical,
            valid: true,
            inList,
          };
        });

        const summary = {
          total: results.length,
          valid: results.filter((r) => r.valid).length,
          invalid: results.filter((r) => !r.valid).length,
          matched: results.filter((r) => r.valid && r.inList).length,
          notMatched: results.filter((r) => r.valid && !r.inList).length,
          listReady: status.hasData,
        };

        return sendJson(res, 200, { summary, results });
      }

      // Master auth status
      if (req.method === 'GET' && pathname === '/api/master/session') {
        return sendJson(res, 200, { authenticated: auth.isMasterAuthenticated(req) });
      }

      // Master login
      if (req.method === 'POST' && pathname === '/api/master/login') {
        if (!loginLimiter(clientIp)) {
          return sendJson(res, 429, { error: 'Terlalu banyak percobaan login. Tunggu beberapa menit.' });
        }
        const body = await readJsonBody(req, 16 * 1024);
        if (!auth.verifyPassword(body.password)) {
          return sendJson(res, 401, { error: 'Password Master salah.' });
        }
        return sendJson(
          res,
          200,
          { authenticated: true },
          { 'Set-Cookie': auth.createSessionCookieHeader() }
        );
      }

      // Master logout
      if (req.method === 'POST' && pathname === '/api/master/logout') {
        return sendJson(
          res,
          200,
          { authenticated: false },
          { 'Set-Cookie': auth.clearSessionCookieHeader() }
        );
      }

      // Master-only protected routes
      if (pathname.startsWith('/api/master/')) {
        if (!auth.isMasterAuthenticated(req)) {
          return sendJson(res, 401, { error: 'Akses ditolak. Login sebagai Master terlebih dahulu.' });
        }

        if (req.method === 'POST' && pathname === '/api/master/upload') {
          const body = await readJsonBody(req, MAX_UPLOAD_BODY_BYTES);
          const mode = body.mode === 'append' ? 'append' : 'replace';
          const rawContent = typeof body.content === 'string' ? body.content : '';
          const parsedTokens = parseBatchInput(rawContent);

          if (parsedTokens.length === 0) {
            return sendJson(res, 400, { error: 'File atau teks upload tidak berisi link.' });
          }

          const uniqueByHash = new Map();
          let validCount = 0;
          let invalidCount = 0;

          for (const token of parsedTokens) {
            const norm = normalizeLink(token);
            if (!norm.valid) {
              invalidCount += 1;
              continue;
            }
            validCount += 1;
            if (!uniqueByHash.has(norm.hash)) {
              uniqueByHash.set(norm.hash, norm);
            }
          }

          if (uniqueByHash.size === 0) {
            return sendJson(res, 400, { error: 'Tidak ada link valid yang ditemukan dalam data upload.' });
          }

          const saved = db.saveMasterLinks(Array.from(uniqueByHash.values()), mode, {
            totalSubmitted: parsedTokens.length,
            validCount,
            invalidCount,
          });

          return sendJson(res, 200, {
            mode,
            totalSubmitted: parsedTokens.length,
            validCount,
            invalidCount,
            uniqueValidCount: uniqueByHash.size,
            insertedCount: saved.insertedCount,
            totalLinks: saved.totalLinks,
            updatedAt: saved.updatedAt,
          });
        }

        if (req.method === 'DELETE' && pathname === '/api/master/links') {
          const cleared = db.clearAllLinks();
          return sendJson(res, 200, cleared);
        }

        if (req.method === 'GET' && pathname === '/api/master/logs') {
          return sendJson(res, 200, { logs: db.getUploadLogs() });
        }

        return sendJson(res, 404, { error: 'Endpoint Master tidak ditemukan.' });
      }

      // Block any other unknown /api route
      if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
      }

      // Static frontend assets
      if (req.method === 'GET') {
        return serveStatic(pathname, res);
      }

      return sendJson(res, 405, { error: 'Method Not Allowed' });
    } catch (err) {
      const status = err.statusCode || 500;
      const message = status >= 500 ? 'Terjadi kesalahan pada server.' : err.message;
      return sendJson(res, status, { error: message });
    }
  });

  function close() {
    return new Promise((resolve) => {
      server.close(() => {
        db.close();
        resolve();
      });
    });
  }

  return { server, db, close };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const usingDefaultPw = !process.env.MASTER_PASSWORD;
  const { server } = createApp();

  server.listen(port, host, () => {
    console.log(`LinkVault server berjalan di http://localhost:${port}`);
    if (usingDefaultPw) {
      console.log('INFO: Menggunakan MASTER_PASSWORD default ("master123"). Set env MASTER_PASSWORD untuk produksi.');
    }
  });
}

module.exports = { createApp };
