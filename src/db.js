const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createDatabase(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new DatabaseSync(resolved);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS master_links (
      canonical_hash TEXT PRIMARY KEY,
      canonical_value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS upload_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      total_submitted INTEGER NOT NULL,
      valid_count INTEGER NOT NULL,
      invalid_count INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL,
      total_after INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const countStmt = db.prepare('SELECT COUNT(*) AS total, MAX(created_at) AS lastUpdatedAt FROM master_links');
  const checkStmt = db.prepare('SELECT 1 AS found FROM master_links WHERE canonical_hash = ? LIMIT 1');
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO master_links (canonical_hash, canonical_value, created_at) VALUES (?, ?, ?)'
  );
  const deleteAllStmt = db.prepare('DELETE FROM master_links');
  const insertLogStmt = db.prepare(`
    INSERT INTO upload_logs (mode, total_submitted, valid_count, invalid_count, inserted_count, total_after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const listLogsStmt = db.prepare(`
    SELECT id, mode, total_submitted, valid_count, invalid_count, inserted_count, total_after, created_at
    FROM upload_logs
    ORDER BY id DESC
    LIMIT 20
  `);

  function getStatus() {
    const row = countStmt.get();
    return {
      hasData: Number(row.total) > 0,
      totalLinks: Number(row.total),
      lastUpdatedAt: row.lastUpdatedAt || null,
    };
  }

  function hasLinkHash(hash) {
    const row = checkStmt.get(hash);
    return Boolean(row);
  }

  function saveMasterLinks(validItems, mode, stats) {
    const now = new Date().toISOString();
    let insertedCount = 0;

    db.exec('BEGIN');
    try {
      if (mode === 'replace') {
        deleteAllStmt.run();
      }
      for (const item of validItems) {
        const result = insertStmt.run(item.hash, item.canonical, now);
        insertedCount += Number(result.changes || 0);
      }
      const after = countStmt.get();
      const totalAfter = Number(after.total);
      insertLogStmt.run(
        mode,
        stats.totalSubmitted,
        stats.validCount,
        stats.invalidCount,
        insertedCount,
        totalAfter,
        now
      );
      db.exec('COMMIT');

      return {
        insertedCount,
        totalLinks: totalAfter,
        updatedAt: now,
      };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function clearAllLinks() {
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      deleteAllStmt.run();
      insertLogStmt.run('clear', 0, 0, 0, 0, 0, now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { totalLinks: 0, updatedAt: now };
  }

  function getUploadLogs() {
    return listLogsStmt.all();
  }

  function close() {
    db.close();
  }

  return {
    getStatus,
    hasLinkHash,
    saveMasterLinks,
    clearAllLinks,
    getUploadLogs,
    close,
  };
}

module.exports = { createDatabase };
