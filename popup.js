// popup.js - handles UI, CSV parsing, sending rows to background for scraping, and receiving updates

const csvInput = document.getElementById('csvFileInput');
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

// ---------------- CSV UPLOAD + PARSING ----------------
csvInput.addEventListener('change', (e) => {
  resetUI();
  const f = e.target.files[0];
  if (!f) { startBtn.disabled = true; return; }

  Papa.parse(f, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      console.log('Raw parsed headers:', results.meta.fields);

      // Normalize headers (trim + lowercase + strip BOM)
      const normalize = h => h.replace(/^\uFEFF/, '').trim().toLowerCase();
      const normFields = results.meta.fields.map(normalize);

      // Find actual header names
      const companyKey = results.meta.fields.find(h => normalize(h) === 'company');
      const countryKey = results.meta.fields.find(h => normalize(h) === 'country');
      const cityKey = results.meta.fields.find(h => normalize(h) === 'city' || normalize(h) === 'city/town');

      if (!companyKey) {
        alert('CSV must include a "Company" column.');
        startBtn.disabled = true;
        return;
      }
      if (!countryKey) {
        alert('CSV must include a "Country" column.');
        startBtn.disabled = true;
        return;
      }

      // Normalize rows
      rows = results.data
        .map(r => ({
          Company: (r[companyKey] || '').trim(),
          City: cityKey ? (r[cityKey] || '').trim() : '',
          Country: (r[countryKey] || '').trim(),
          __raw: r
        }))
        .filter(r => r.Company && r.Country); // ✅ require only company + country

      console.log('Processed rows:', rows);

      if (!rows.length) {
        alert('No valid rows found. Ensure at least Company and Country have values.');
        startBtn.disabled = true;
        return;
      }

      total = rows.length;
      countText.textContent = `0 / ${total}`;
      progressText.textContent = `Ready to start (${total} rows)`;
      startBtn.disabled = false;
    },
    error: (err) => {
      console.error('Parse error', err);
      alert('CSV parsing error. Check encoding and format.');
    }
  });
});

// ---------------- START SCRAPING ----------------
startBtn.addEventListener('click', () => {
  if (!rows.length) return alert('No rows to process.');

  startBtn.disabled = true;
  csvInput.disabled = true;
  spinner.classList.remove('hidden');

  const payload = rows.map((r, idx) => ({
    id: idx,
    company: r.Company,
    city: r.City,
    country: r.Country
  }));

  chrome.runtime.sendMessage({ action: 'start-scrape', payload }, (resp) => {
    console.log('Background accepted start command', resp);
  });
});

// ---------------- PROGRESS UPDATES ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
  if (msg.action === 'progress-update') {
    const { id, status, data, processed: p, total: t } = msg;
    processed = p; total = t;
    countText.textContent = `${processed} / ${total}`;
    const pct = Math.round((processed / total) * 100);
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${status} (${pct}%)`;

    const liId = `res-${id}`;
    let li = document.getElementById(liId);
    if (!li) {
      li = document.createElement('li');
      li.id = liId;
      li.className = 'result-item';
      resultsList.prepend(li); // newest on top
    }

    if (msg.success) {
      li.classList.remove('result-error');
      li.classList.add('result-success');
      li.innerHTML = `
        <div class="result-row">
          <div>
            <div class="result-title">${escapeHtml(data.name || data.company)}</div>
            <div class="result-sub">${escapeHtml(data.address || (data.city || '') + ' ' + (data.country || ''))}</div>
          </div>
          <div style="text-align:right">
            <div class="result-sub">${escapeHtml(data.phone || '')}</div>
            <div class="result-sub"><a target="_blank" href="${escapeAttr(data.website || '')}" title="Open website">${data.website ? 'Website' : ''}</a></div>
          </div>
        </div>
      `;
    } else {
      li.classList.remove('result-success');
      li.classList.add('result-error');
      li.innerHTML = `
        <div class="result-row">
          <div>
            <div class="result-title">${escapeHtml(msg.company)}</div>
            <div class="result-sub">Error: ${escapeHtml(msg.error || 'No results')}</div>
          </div>
        </div>
      `;
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
    }
  }
});

// ---------------- DOWNLOAD ----------------
downloadBtn.addEventListener('click', () => {
  if (!outputRows.length) return alert('No results yet.');
  const csv = Papa.unparse(outputRows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const filename = `pro_company_scraper_results_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  chrome.runtime.sendMessage({ action: 'download-csv', url, filename }, (resp) => {
    console.log('download response', resp);
  });
});

// ---------------- HELPERS ----------------
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escapeAttr(s) {
  if (!s) return '';
  try { return s.replace(/"/g, '&quot;'); } catch (e) { return s; }
}
