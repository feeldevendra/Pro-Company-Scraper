// popup.js - robust CSV parsing + UI + messaging to background
const csvInput = document.getElementById('csvFile');
const startBtn = document.getElementById('startBtn');
const downloadBtn = document.getElementById('downloadBtn');
const progressText = document.getElementById('progressText');
const countText = document.getElementById('countText');
const progressBar = document.getElementById('progressBar');
const spinner = document.getElementById('spinner');
const resultsList = document.getElementById('resultsList');

let rows = [];
let outputRows = [];
let total = 0;
let processed = 0;

function resetUI() {
  outputRows = [];
  rows = [];
  resultsList.innerHTML = '';
  progressText.textContent = 'Idle';
  countText.textContent = '0 / 0';
  progressBar.style.width = '0%';
  spinner.classList.add('hidden');
  downloadBtn.disabled = true;
  startBtn.disabled = true;
  csvInput.disabled = false;
}
resetUI();

// Utility helpers
function escapeHtml(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function logToList(text, cls = '') {
  const li = document.createElement('li');
  li.className = 'result-item ' + (cls || '');
  li.innerHTML = `<div class="result-row"><div class="result-title">${escapeHtml(text)}</div></div>`;
  resultsList.prepend(li);
}

// CSV parsing — robust: normalize headers (strip BOM + lowercase)
csvInput.addEventListener('change', (e) => {
  resetUI();
  const file = e.target.files && e.target.files[0];
  if (!file) { startBtn.disabled = true; return; }

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => {
      if (!h) return '';
      return h.replace(/^\uFEFF/, '').trim().toLowerCase();
    },
    complete: (results) => {
      console.log('PapaParse meta.fields:', results.meta.fields);
      console.log('First rows sample:', results.data.slice(0,3));
      // required headers: company, country
      const fields = results.meta.fields || [];
      if (!fields.includes('company')) {
        alert('CSV must include a header named "Company" (case-insensitive). Found: ' + fields.join(', '));
        return;
      }
      if (!fields.includes('country')) {
        alert('CSV must include a header named "Country" (case-insensitive). Found: ' + fields.join(', '));
        return;
      }

      // build rows: expect keys already normalized to lowercase
      rows = results.data.map((r, idx) => ({
        id: idx,
        company: (r['company'] || '').trim(),
        city: (r['city'] || '').trim() || '',
        country: (r['country'] || '').trim()
      })).filter(r => r.company && r.country);

      if (!rows.length) {
        alert('No valid rows found. Each row must have Company and Country values.');
        return;
      }

      total = rows.length;
      processed = 0;
      countText.textContent = `0 / ${total}`;
      progressText.textContent = `Ready (${total} rows)`;
      startBtn.disabled = false;

      console.log('Rows ready for scraping:', rows);
      logToList(`Loaded ${rows.length} rows — ready to start.`);
    },
    error: (err) => {
      console.error('PapaParse error', err);
      alert('Error parsing CSV: ' + (err.message || err));
    }
  });
});

// Start scraping — send rows to background
startBtn.addEventListener('click', () => {
  if (!rows.length) {
    alert('No rows to process.');
    return;
  }
  startBtn.disabled = true;
  csvInput.disabled = true;
  spinner.classList.remove('hidden');
  progressText.textContent = 'Starting...';
  chrome.runtime.sendMessage({ action: 'start-scrape', payload: rows }, (resp) => {
    console.log('start-scrape response:', resp);
    if (!resp || resp.error) {
      console.error('Background error starting:', resp);
      alert('Unable to start scraping: ' + (resp && resp.error ? resp.error : 'unknown'));
      spinner.classList.add('hidden');
      csvInput.disabled = false;
      startBtn.disabled = false;
    }
  });
});

// Receive progress updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'progress-update') return;
  console.log('progress-update', msg);
  processed = msg.processed || processed;
  total = msg.total || total;
  countText.textContent = `${processed} / ${total}`;
  const pct = total ? Math.round((processed / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${msg.status || 'Processing'} (${pct}%)`;

  // Add or update entry
  const liId = `res-${msg.id}`;
  let li = document.getElementById(liId);
  if (!li) {
    li = document.createElement('li');
    li.id = liId;
    li.className = 'result-item';
    resultsList.prepend(li);
  }

  if (msg.success) {
    li.classList.remove('result-error');
    li.classList.add('result-success');
    li.innerHTML = `
      <div class="result-row">
        <div>
          <div class="result-title">${escapeHtml(msg.finishedRow.Name || msg.finishedRow.Company)}</div>
          <div class="result-sub">${escapeHtml(msg.finishedRow.City || '')} ${escapeHtml(msg.finishedRow.Country || '')}</div>
        </div>
        <div style="text-align:right">
          <div class="result-sub">${escapeHtml(msg.finishedRow.Phone || '')}</div>
          <div class="result-sub"><a target="_blank" href="${escapeAttr(msg.finishedRow.Website||'')}">${msg.finishedRow.Website ? 'Website' : ''}</a></div>
        </div>
      </div>`;
  } else {
    li.classList.remove('result-success');
    li.classList.add('result-error');
    li.innerHTML = `
      <div class="result-row">
        <div>
          <div class="result-title">${escapeHtml(msg.company || 'Unknown')}</div>
          <div class="result-sub">Error: ${escapeHtml(msg.error || 'No results')}</div>
        </div>
      </div>`;
  }

  if (msg.finishedRow) {
    outputRows.push(msg.finishedRow);
    downloadBtn.disabled = false;
  }

  if (processed >= total) {
    spinner.classList.add('hidden');
    progressText.textContent = 'Completed';
    csvInput.disabled = false;
    startBtn.disabled = false;
    logToList('All done — download available.', 'result-success');
  }
});

// Download results (send CSV text to background for download)
downloadBtn.addEventListener('click', () => {
  if (!outputRows.length) return alert('No results to download.');
  const csv = Papa.unparse(outputRows);
  const filename = `pro-company-scraper-results-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
  chrome.runtime.sendMessage({ action: 'download-csv', csv, filename }, (resp) => {
    console.log('download-csv response', resp);
    if (resp && resp.ok) {
      alert('Download started.');
    } else {
      alert('Download failed. Check extension Errors (service worker console).');
    }
  });
});
