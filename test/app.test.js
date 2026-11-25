const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { normalizeLink, parseBatchInput } = require('../src/normalizer');
const { createApp } = require('../src/server');

test('normalizeLink extracts website name across bare names, TLDs, multi-part TLDs, subdomains, and paths', () => {
  const bare = normalizeLink('tokopedia');
  const com = normalizeLink('https://Example.COM/promo/');
  const coId = normalizeLink('http://www.example.co.id:80/promo');
  const sub = normalizeLink('m.example.xyz/login?ref=1');

  assert.equal(bare.valid, true);
  assert.equal(bare.canonical, 'tokopedia');

  assert.equal(com.valid, true);
  assert.equal(coId.valid, true);
  assert.equal(sub.valid, true);
  assert.equal(com.canonical, 'example');
  assert.equal(coId.canonical, 'example');
  assert.equal(sub.canonical, 'example');
  assert.equal(com.hash, coId.hash);
  assert.equal(coId.hash, sub.hash);
});

test('normalizeLink rejects invalid or unsafe inputs', () => {
  assert.equal(normalizeLink('').valid, false);
  assert.equal(normalizeLink('javascript:alert(1)').valid, false);
  assert.equal(normalizeLink('not a valid link').valid, false);
  assert.equal(normalizeLink('-badname-').valid, false);
});

test('parseBatchInput parses newlines, commas, semicolons, comments, and CSV header', () => {
  const raw = [
    'website',
    '# komentar diabaikan',
    'tokopedia',
    'https://a.example.com/1',
    'b.co.id/2, c.xyz/3; d',
    '',
    '  "https://e.example.com/5"  ',
  ].join('\n');

  assert.deepEqual(parseBatchInput(raw), [
    'tokopedia',
    'https://a.example.com/1',
    'b.co.id/2',
    'c.xyz/3',
    'd',
    'https://e.example.com/5',
  ]);
});

test('end-to-end API matches website names regardless of domain extension and enforces master auth', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkvault-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const app = createApp({
    dbPath,
    masterPassword: 'secret-test-password',
    sessionSecret: 'test-session-secret',
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Public status initially empty and never leaks list items
    const statusRes = await fetch(`${baseUrl}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.hasData, false);
    assert.equal(statusJson.totalLinks, 0);

    // 2. Unauthenticated user cannot upload, read logs, or clear list
    const unauthUpload = await fetch(`${baseUrl}/api/master/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'rahasia', mode: 'replace' }),
    });
    assert.equal(unauthUpload.status, 401);

    const unauthLogs = await fetch(`${baseUrl}/api/master/logs`);
    assert.equal(unauthLogs.status, 401);

    const nonExistentList = await fetch(`${baseUrl}/api/master/links`);
    assert.equal(nonExistentList.status, 401);

    // 3. Master login
    const goodLogin = await fetch(`${baseUrl}/api/master/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret-test-password' }),
    });
    assert.equal(goodLogin.status, 200);
    const cookie = goodLogin.headers.get('set-cookie').split(';')[0];

    // 4. Master uploads bare website names (and/or URLs that normalize to website name)
    const uploadRes = await fetch(`${baseUrl}/api/master/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        mode: 'replace',
        content: [
          'website',
          'trusted',
          'partner',
          'invalid entry with spaces',
        ].join('\n'),
      }),
    });
    assert.equal(uploadRes.status, 200);
    const uploadData = await uploadRes.json();
    assert.equal(uploadData.totalLinks, 2);
    assert.equal(uploadData.invalidCount, 1);

    // 5. User inputs URL with changing domain extensions (.com, .co.id, .xyz) and matches "trusted"
    const singleCheck = await fetch(`${baseUrl}/api/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links: ['https://www.TRUSTED.co.id/offer/'] }),
    });
    assert.equal(singleCheck.status, 200);
    const singleData = await singleCheck.json();
    assert.equal(singleData.summary.matched, 1);
    assert.equal(singleData.results[0].canonical, 'trusted');
    assert.equal(singleData.results[0].inList, true);

    // 6. User batch check with different extensions + bare name + invalid input
    const batchCheck = await fetch(`${baseUrl}/api/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'https://partner.xyz/campaign; https://unknown.site/x, invalid url',
      }),
    });
    assert.equal(batchCheck.status, 200);
    const batchData = await batchCheck.json();
    assert.deepEqual(batchData.summary, {
      total: 3,
      valid: 2,
      invalid: 1,
      matched: 1,
      notMatched: 1,
      listReady: true,
    });
    assert.equal(batchData.results[0].canonical, 'partner');
    assert.equal(batchData.results[0].inList, true);
    assert.equal(batchData.results[1].canonical, 'unknown');
    assert.equal(batchData.results[1].inList, false);
    assert.equal(batchData.results[2].valid, false);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
