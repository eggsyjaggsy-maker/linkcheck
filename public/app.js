const state = {
  lastBatchResults: [],
  activeFilter: 'all',
  masterAuthenticated: false,
};

const els = {
  listStatusPill: document.getElementById('listStatusPill'),
  listStatusText: document.getElementById('listStatusText'),
  tabSingle: document.getElementById('tabSingle'),
  tabBatch: document.getElementById('tabBatch'),
  panelSingle: document.getElementById('panelSingle'),
  panelBatch: document.getElementById('panelBatch'),

  singleCheckForm: document.getElementById('singleCheckForm'),
  singleLinkInput: document.getElementById('singleLinkInput'),
  singleCheckBtn: document.getElementById('singleCheckBtn'),
  clearSingleBtn: document.getElementById('clearSingleBtn'),
  singleResultBox: document.getElementById('singleResultBox'),

  batchCheckForm: document.getElementById('batchCheckForm'),
  batchLinkInput: document.getElementById('batchLinkInput'),
  batchFileInput: document.getElementById('batchFileInput'),
  batchCheckBtn: document.getElementById('batchCheckBtn'),
  clearBatchBtn: document.getElementById('clearBatchBtn'),
  fillSampleBatchBtn: document.getElementById('fillSampleBatchBtn'),

  batchResultsSection: document.getElementById('batchResultsSection'),
  batchResultSubtitle: document.getElementById('batchResultSubtitle'),
  statTotal: document.getElementById('statTotal'),
  statMatched: document.getElementById('statMatched'),
  statNotMatched: document.getElementById('statNotMatched'),
  statInvalid: document.getElementById('statInvalid'),
  batchResultsBody: document.getElementById('batchResultsBody'),
  copyResultsBtn: document.getElementById('copyResultsBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),

  openMasterBtn: document.getElementById('openMasterBtn'),
  closeMasterBtn: document.getElementById('closeMasterBtn'),
  masterModal: document.getElementById('masterModal'),
  masterLoginView: document.getElementById('masterLoginView'),
  masterWorkspaceView: document.getElementById('masterWorkspaceView'),
  masterLoginForm: document.getElementById('masterLoginForm'),
  masterPasswordInput: document.getElementById('masterPasswordInput'),
  masterLoginError: document.getElementById('masterLoginError'),
  masterLogoutBtn: document.getElementById('masterLogoutBtn'),
  masterTotalCount: document.getElementById('masterTotalCount'),
  masterUploadForm: document.getElementById('masterUploadForm'),
  masterDropZone: document.getElementById('masterDropZone'),
  masterFileInput: document.getElementById('masterFileInput'),
  pickMasterFileBtn: document.getElementById('pickMasterFileBtn'),
  masterFileName: document.getElementById('masterFileName'),
  masterTextInput: document.getElementById('masterTextInput'),
  masterUploadFeedback: document.getElementById('masterUploadFeedback'),
  masterUploadBtn: document.getElementById('masterUploadBtn'),
  masterClearBtn: document.getElementById('masterClearBtn'),
  masterLogsList: document.getElementById('masterLogsList'),

  toast: document.getElementById('toast'),
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 2600);
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request gagal (${res.status})`);
  }
  return data;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function refreshStatus() {
  try {
    const status = await apiJson('/api/status');
    els.listStatusPill.classList.remove('status-loading', 'status-ready', 'status-empty');
    if (status.hasData) {
      els.listStatusPill.classList.add('status-ready');
      els.listStatusText.textContent = `List Aktif (${status.totalLinks} data)`;
    } else {
      els.listStatusPill.classList.add('status-empty');
      els.listStatusText.textContent = 'List Master Kosong';
    }
    els.masterTotalCount.textContent = status.totalLinks;
  } catch {
    els.listStatusText.textContent = 'Server tidak terjangkau';
  }
}

function switchTab(mode) {
  const isSingle = mode === 'single';
  els.tabSingle.classList.toggle('active', isSingle);
  els.tabBatch.classList.toggle('active', !isSingle);
  els.tabSingle.setAttribute('aria-selected', String(isSingle));
  els.tabBatch.setAttribute('aria-selected', String(!isSingle));
  els.panelSingle.classList.toggle('active', isSingle);
  els.panelBatch.classList.toggle('active', !isSingle);
}

els.tabSingle.addEventListener('click', () => switchTab('single'));
els.tabBatch.addEventListener('click', () => switchTab('batch'));

els.singleLinkInput.addEventListener('input', () => {
  els.clearSingleBtn.classList.toggle('hidden', !els.singleLinkInput.value.length);
});

els.clearSingleBtn.addEventListener('click', () => {
  els.singleLinkInput.value = '';
  els.clearSingleBtn.classList.add('hidden');
  els.singleResultBox.classList.add('hidden');
  els.singleLinkInput.focus();
});

function renderSingleResult(result, listReady) {
  els.singleResultBox.classList.remove('hidden', 'is-match', 'is-miss', 'is-invalid');

  if (!result.valid) {
    els.singleResultBox.classList.add('is-invalid');
    els.singleResultBox.innerHTML = `
      <div class="result-headline">⚠️ Format Link Tidak Valid</div>
      <div class="result-meta">Input: <strong>${escapeHtml(result.input)}</strong> — ${escapeHtml(result.reason || 'Periksa kembali format URL')}</div>
    `;
    return;
  }

  if (result.inList) {
    els.singleResultBox.classList.add('is-match');
    els.singleResultBox.innerHTML = `
      <div class="result-headline">🚨 Bagian dari List</div>
      <div class="result-meta">Nama website <strong>${escapeHtml(result.canonical)}</strong> ditemukan di dalam daftar Master.</div>
    `;
  } else {
    els.singleResultBox.classList.add('is-miss');
    const note = listReady
      ? 'Nama website tidak ditemukan di dalam daftar Master.'
      : 'Daftar Master saat ini masih kosong.';
    els.singleResultBox.innerHTML = `
      <div class="result-headline">✅ Bukan Bagian dari List</div>
      <div class="result-meta">Nama website: <strong>${escapeHtml(result.canonical)}</strong> — ${note}</div>
    `;
  }
}

els.singleCheckForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = els.singleLinkInput.value.trim();
  if (!value) {
    showToast('Masukkan link terlebih dahulu.');
    els.singleLinkInput.focus();
    return;
  }

  els.singleCheckBtn.disabled = true;
  try {
    const data = await apiJson('/api/check', {
      method: 'POST',
      body: JSON.stringify({ links: [value] }),
    });
    renderSingleResult(data.results[0], data.summary.listReady);
  } catch (err) {
    showToast(err.message);
  } finally {
    els.singleCheckBtn.disabled = false;
  }
});

// Batch input helpers
els.fillSampleBatchBtn.addEventListener('click', () => {
  els.batchLinkInput.value = [
    'https://contohsite.com/promo',
    'http://www.contohsite.co.id/login',
    'partner.org/daftar, https://news.site.id/artikel',
    'input tidak valid',
  ].join('\n');
});

els.batchFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  els.batchLinkInput.value = text;
  showToast(`File "${file.name}" dimuat (${text.length} karakter).`);
  e.target.value = '';
});

els.clearBatchBtn.addEventListener('click', () => {
  els.batchLinkInput.value = '';
  els.batchResultsSection.classList.add('hidden');
  state.lastBatchResults = [];
});

function renderBatchResultsTable() {
  const filtered = state.lastBatchResults.filter((item) => {
    if (state.activeFilter === 'matched') return item.valid && item.inList;
    if (state.activeFilter === 'not-matched') return item.valid && !item.inList;
    if (state.activeFilter === 'invalid') return !item.valid;
    return true;
  });

  if (filtered.length === 0) {
    els.batchResultsBody.innerHTML = `
      <tr>
        <td colspan="3" class="muted-text">Tidak ada item pada filter ini.</td>
      </tr>
    `;
    return;
  }

  els.batchResultsBody.innerHTML = filtered
    .map((item, idx) => {
      let badgeHtml = '';
      if (!item.valid) {
        badgeHtml = `<span class="badge badge-invalid">⚠️ Invalid (${escapeHtml(item.reason || 'Format salah')})</span>`;
      } else if (item.inList) {
        badgeHtml = `<span class="badge badge-match">🚨 Bagian dari List</span>`;
      } else {
        badgeHtml = `<span class="badge badge-miss">✅ Bukan Bagian List</span>`;
      }

      const canonicalNote = item.canonical
        ? `<span class="link-canonical">Nama website: ${escapeHtml(item.canonical)}</span>`
        : '';

      return `
        <tr>
          <td>${idx + 1}</td>
          <td class="link-cell">${escapeHtml(item.input)}${canonicalNote}</td>
          <td>${badgeHtml}</td>
        </tr>
      `;
    })
    .join('');
}

document.querySelectorAll('.filter-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeFilter = btn.dataset.filter;
    renderBatchResultsTable();
  });
});

els.batchCheckForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = els.batchLinkInput.value.trim();
  if (!input) {
    showToast('Masukkan daftar link terlebih dahulu.');
    els.batchLinkInput.focus();
    return;
  }

  els.batchCheckBtn.disabled = true;
  try {
    const data = await apiJson('/api/check', {
      method: 'POST',
      body: JSON.stringify({ input }),
    });

    state.lastBatchResults = data.results;
    state.activeFilter = 'all';
    document.querySelectorAll('.filter-pill').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === 'all');
    });

    els.statTotal.textContent = data.summary.total;
    els.statMatched.textContent = data.summary.matched;
    els.statNotMatched.textContent = data.summary.notMatched;
    els.statInvalid.textContent = data.summary.invalid;

    els.batchResultSubtitle.textContent = data.summary.listReady
      ? `Dibandingkan terhadap daftar Master (${data.summary.matched} cocok dari ${data.summary.total} link).`
      : 'Catatan: Daftar Master saat ini masih kosong.';

    els.batchResultsSection.classList.remove('hidden');
    renderBatchResultsTable();
    els.batchResultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    showToast(err.message);
  } finally {
    els.batchCheckBtn.disabled = false;
  }
});

els.copyResultsBtn.addEventListener('click', async () => {
  if (!state.lastBatchResults.length) return;
  const lines = state.lastBatchResults.map((r) => {
    const label = !r.valid ? 'INVALID' : r.inList ? 'BAGIAN_DARI_LIST' : 'BUKAN_BAGIAN_LIST';
    return `${r.input}\t${label}`;
  });
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    showToast('Hasil pengecekan disalin ke clipboard.');
  } catch {
    showToast('Gagal menyalin otomatis.');
  }
});

els.exportCsvBtn.addEventListener('click', () => {
  if (!state.lastBatchResults.length) return;
  const rows = [['input', 'normalized', 'status']];
  for (const r of state.lastBatchResults) {
    const status = !r.valid ? 'INVALID' : r.inList ? 'BAGIAN_DARI_LIST' : 'BUKAN_BAGIAN_LIST';
    rows.push([r.input, r.canonical || '', status]);
  }
  const csv = rows
    .map((cols) => cols.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hasil-cek-link-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// Master Modal & Auth
async function syncMasterModalView() {
  try {
    const session = await apiJson('/api/master/session');
    state.masterAuthenticated = Boolean(session.authenticated);
  } catch {
    state.masterAuthenticated = false;
  }

  els.masterLoginView.classList.toggle('hidden', state.masterAuthenticated);
  els.masterWorkspaceView.classList.toggle('hidden', !state.masterAuthenticated);

  if (state.masterAuthenticated) {
    await Promise.all([refreshStatus(), loadMasterLogs()]);
  }
}

async function loadMasterLogs() {
  try {
    const data = await apiJson('/api/master/logs');
    if (!data.logs.length) {
      els.masterLogsList.innerHTML = '<span class="muted-text">Belum ada aktivitas upload.</span>';
      return;
    }
    els.masterLogsList.innerHTML = data.logs
      .map((log) => {
        const time = new Date(log.created_at).toLocaleString('id-ID');
        const modeLabel =
          log.mode === 'replace' ? 'Replace' : log.mode === 'append' ? 'Append' : 'Clear';
        return `
          <div class="log-item">
            <span><strong>${modeLabel}</strong> • Valid: ${log.valid_count}, Ditambah: ${log.inserted_count}, Total: ${log.total_after}</span>
            <span class="muted-text">${escapeHtml(time)}</span>
          </div>
        `;
      })
      .join('');
  } catch {
    els.masterLogsList.textContent = 'Gagal memuat riwayat.';
  }
}

els.openMasterBtn.addEventListener('click', async () => {
  els.masterModal.classList.remove('hidden');
  els.masterLoginError.classList.add('hidden');
  els.masterUploadFeedback.classList.add('hidden');
  await syncMasterModalView();
  if (!state.masterAuthenticated) {
    els.masterPasswordInput.focus();
  }
});

els.closeMasterBtn.addEventListener('click', () => {
  els.masterModal.classList.add('hidden');
});

els.masterModal.addEventListener('click', (e) => {
  if (e.target === els.masterModal) {
    els.masterModal.classList.add('hidden');
  }
});

els.masterLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.masterLoginError.classList.add('hidden');
  try {
    await apiJson('/api/master/login', {
      method: 'POST',
      body: JSON.stringify({ password: els.masterPasswordInput.value }),
    });
    els.masterPasswordInput.value = '';
    await syncMasterModalView();
    showToast('Login Master berhasil.');
  } catch (err) {
    els.masterLoginError.textContent = err.message;
    els.masterLoginError.classList.remove('hidden');
  }
});

els.masterLogoutBtn.addEventListener('click', async () => {
  await apiJson('/api/master/logout', { method: 'POST' });
  await syncMasterModalView();
  showToast('Keluar dari sesi Master.');
});

// Master file upload & drag-drop
els.pickMasterFileBtn.addEventListener('click', () => els.masterFileInput.click());

async function loadMasterFile(file) {
  if (!file) return;
  const text = await file.text();
  els.masterTextInput.value = text;
  els.masterFileName.textContent = `File dipilih: ${file.name}`;
}

els.masterFileInput.addEventListener('change', async (e) => {
  await loadMasterFile(e.target.files?.[0]);
  e.target.value = '';
});

els.masterDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.masterDropZone.classList.add('dragover');
});

els.masterDropZone.addEventListener('dragleave', () => {
  els.masterDropZone.classList.remove('dragover');
});

els.masterDropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  els.masterDropZone.classList.remove('dragover');
  await loadMasterFile(e.dataTransfer?.files?.[0]);
});

function showMasterFeedback(type, message) {
  els.masterUploadFeedback.className = type === 'error' ? 'alert-error' : 'alert-success';
  els.masterUploadFeedback.textContent = message;
  els.masterUploadFeedback.classList.remove('hidden');
}

els.masterUploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = els.masterTextInput.value.trim();
  if (!content) {
    showMasterFeedback('error', 'Pilih file atau tempel daftar link terlebih dahulu.');
    return;
  }

  const mode = document.querySelector('input[name="uploadMode"]:checked')?.value || 'replace';
  els.masterUploadBtn.disabled = true;
  try {
    const res = await apiJson('/api/master/upload', {
      method: 'POST',
      body: JSON.stringify({ content, mode }),
    });
    showMasterFeedback(
      'success',
      `Berhasil (${res.mode}): ${res.uniqueValidCount} link valid unik diproses, ${res.insertedCount} ditambahkan, total di database ${res.totalLinks} link.`
    );
    els.masterTextInput.value = '';
    els.masterFileName.textContent = '';
    await Promise.all([refreshStatus(), loadMasterLogs()]);
  } catch (err) {
    showMasterFeedback('error', err.message);
  } finally {
    els.masterUploadBtn.disabled = false;
  }
});

els.masterClearBtn.addEventListener('click', async () => {
  if (!confirm('Yakin ingin menghapus seluruh daftar link Master?')) return;
  try {
    await apiJson('/api/master/links', { method: 'DELETE' });
    showMasterFeedback('success', 'Seluruh daftar link telah dikosongkan.');
    await Promise.all([refreshStatus(), loadMasterLogs()]);
  } catch (err) {
    showMasterFeedback('error', err.message);
  }
});

refreshStatus();
