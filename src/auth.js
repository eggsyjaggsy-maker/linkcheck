const crypto = require('node:crypto');

const SESSION_COOKIE_NAME = 'linkvault_master_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function createAuthManager({ masterPassword, sessionSecret }) {
  const passwordBuf = Buffer.from(String(masterPassword), 'utf8');
  const secret = sessionSecret || crypto.randomBytes(32).toString('hex');

  function verifyPassword(candidate) {
    if (typeof candidate !== 'string') return false;
    const candidateBuf = Buffer.from(candidate, 'utf8');
    // Pad or check length safely before timingSafeEqual
    const maxLen = Math.max(passwordBuf.length, candidateBuf.length, 1);
    const a = Buffer.alloc(maxLen);
    const b = Buffer.alloc(maxLen);
    passwordBuf.copy(a);
    candidateBuf.copy(b);
    return passwordBuf.length === candidateBuf.length && crypto.timingSafeEqual(a, b);
  }

  function signToken(payloadObj) {
    const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  function verifyToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!decoded || decoded.role !== 'master' || typeof decoded.exp !== 'number') {
        return null;
      }
      if (Date.now() > decoded.exp) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  function parseCookies(req) {
    const header = req.headers.cookie;
    const cookies = {};
    if (!header) return cookies;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const val = decodeURIComponent(part.slice(idx + 1).trim());
      cookies[key] = val;
    }
    return cookies;
  }

  function isMasterAuthenticated(req) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE_NAME];
    return Boolean(verifyToken(token));
  }

  function createSessionCookieHeader() {
    const token = signToken({
      role: 'master',
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
    });
    const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
  }

  function clearSessionCookieHeader() {
    return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }

  return {
    verifyPassword,
    isMasterAuthenticated,
    createSessionCookieHeader,
    clearSessionCookieHeader,
  };
}

module.exports = { createAuthManager };
