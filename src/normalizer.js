const crypto = require('node:crypto');

const COMMON_HEADERS = new Set([
  'link',
  'links',
  'url',
  'urls',
  'domain',
  'domains',
  'website',
  'websites',
  'site',
  'sites',
  'nama',
  'name',
  'names',
]);

// Common 2-level public suffixes so domains like example.co.id extract "example", not "co"
const MULTI_PART_TLDS = new Set([
  'co.id', 'ac.id', 'or.id', 'go.id', 'sch.id', 'net.id', 'web.id', 'my.id', 'biz.id', 'ponpes.id', 'desa.id',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.sg', 'org.sg', 'edu.sg', 'net.sg',
  'com.my', 'net.my', 'org.my', 'edu.my',
  'com.ph', 'com.vn', 'co.th', 'in.th', 'com.tw', 'com.hk', 'com.cn',
  'com.br', 'com.mx', 'com.tr', 'co.kr', 'co.in', 'co.nz', 'co.za',
  'com.ar', 'com.co', 'com.pe', 'com.ec', 'com.ng', 'com.eg', 'com.sa', 'com.ae', 'com.pk', 'com.bd',
]);

const WEBSITE_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/**
 * Extract the base website name (without domain extension / TLD, subdomain, or path)
 * from either a bare website name (e.g. "tokopedia") or a full domain/URL
 * (e.g. "https://www.tokopedia.co.id/promo" -> "tokopedia").
 *
 * @param {string} hostname
 * @returns {string | null}
 */
function extractWebsiteName(hostname) {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return null;

  if (IPV4_RE.test(host) || host === 'localhost') {
    return host;
  }

  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return null;

  // Bare website name without extension (e.g. "tokopedia", "situs-a")
  if (labels.length === 1) {
    return WEBSITE_NAME_RE.test(labels[0]) ? labels[0] : null;
  }

  // Check if host ends with a known 2-part TLD (e.g. ".co.id")
  if (labels.length >= 3) {
    const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
    if (MULTI_PART_TLDS.has(lastTwo)) {
      const target = labels[labels.length - 3];
      return WEBSITE_NAME_RE.test(target) ? target : null;
    }
  }

  // Otherwise strip the single TLD (last label) and take the main website label
  const target = labels[labels.length - 2];
  return WEBSITE_NAME_RE.test(target) ? target : null;
}

/**
 * Normalize a link, domain, or bare website name into a canonical website name for matching.
 *
 * Examples:
 * - "tokopedia" -> "tokopedia"
 * - "tokopedia.com" -> "tokopedia"
 * - "https://www.tokopedia.co.id/promo?x=1" -> "tokopedia"
 * - "m.tokopedia.xyz" -> "tokopedia"
 *
 * @param {string} raw
 * @returns {{ valid: boolean, input: string, canonical: string | null, hash: string | null, reason?: string }}
 */
function normalizeLink(raw) {
  const input = String(raw ?? '').trim();
  if (!input) {
    return { valid: false, input, canonical: null, hash: null, reason: 'Kosong' };
  }

  const cleaned = input.replace(/^["'<\s]+|["'>\s]+$/g, '').trim();
  if (!cleaned || /\s/.test(cleaned)) {
    return { valid: false, input, canonical: null, hash: null, reason: 'Mengandung spasi atau kosong' };
  }

  const explicitSchemeMatch = cleaned.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (explicitSchemeMatch) {
    const scheme = explicitSchemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return { valid: false, input, canonical: null, hash: null, reason: 'Protokol harus http atau https' };
    }
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned) && !/^localhost:\d+/i.test(cleaned)) {
    return { valid: false, input, canonical: null, hash: null, reason: 'Format input tidak valid' };
  }

  // Handle bare website name directly (no scheme, no slash, no dot, no port)
  if (!explicitSchemeMatch && !cleaned.includes('/') && !cleaned.includes('.') && !cleaned.includes(':')) {
    const lower = cleaned.toLowerCase();
    if (!WEBSITE_NAME_RE.test(lower)) {
      return { valid: false, input, canonical: null, hash: null, reason: 'Nama website tidak valid' };
    }
    const hash = crypto.createHash('sha256').update(lower).digest('hex');
    return { valid: true, input, canonical: lower, hash };
  }

  const withScheme = explicitSchemeMatch ? cleaned : `https://${cleaned}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { valid: false, input, canonical: null, hash: null, reason: 'URL atau nama website tidak valid' };
  }

  const websiteName = extractWebsiteName(parsed.hostname);
  if (!websiteName) {
    return { valid: false, input, canonical: null, hash: null, reason: 'Nama website atau domain tidak valid' };
  }

  const hash = crypto.createHash('sha256').update(websiteName).digest('hex');
  return { valid: true, input, canonical: websiteName, hash };
}

/**
 * Parse a batch input string in the defined format:
 * - One website name / link per line, OR
 * - Separated by comma (,) or semicolon (;)
 * - Blank lines and lines starting with # are ignored
 * - Optional single-column CSV header row ("link", "url", "website", "nama", etc.) on line 1 is ignored
 *
 * @param {string} rawText
 * @returns {string[]}
 */
function parseBatchInput(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return [];
  }

  const lines = rawText.split(/\r?\n/);
  const tokens = [];

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return;
    }

    const parts = trimmedLine.split(/[,;]+/);
    for (const part of parts) {
      const cleaned = part.trim().replace(/^["']|["']$/g, '').trim();
      if (!cleaned) continue;

      if (index === 0 && tokens.length === 0 && COMMON_HEADERS.has(cleaned.toLowerCase())) {
        continue;
      }
      tokens.push(cleaned);
    }
  });

  return tokens;
}

module.exports = {
  normalizeLink,
  parseBatchInput,
  extractWebsiteName,
};
