document.addEventListener('DOMContentLoaded', () => {
  const csvFileInput = document.getElementById('csvFile');
  const startBtn = document.getElementById('startBtn');
  const progressDiv = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const spinner = document.getElementById('spinner');
  const resultsDiv = document.getElementById('results');
  const downloadBtn = document.getElementById('downloadBtn');

  let results = [];
  let totalCompanies = 0;
  let processedCount = 0;

  startBtn.addEventListener('click', () => {
    const file = csvFileInput.files[0];
    if (!file) return alert('Please select a CSV file.');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true, // Improved: Skip empty lines
      complete: (parseResult) => {
        console.log('Parsed CSV:', parseResult); // Debug log
        if (parseResult.errors.length > 0) {
          alert('CSV parsing errors: ' + parseResult.errors.map(e => e.message).join('; '));
          return;
        }
        const companies = parseResult.data.filter(row => 
          row.Company && row.Company.trim() && // Required Company
          (row.City || row.Country) // At least City or Country
        );
        totalCompanies = companies.length;
        if (totalCompanies === 0) return alert('No valid companies found in CSV. Ensure headers are "Company", "City", "Country".');

        progressDiv.textContent = `Processing 0/${totalCompanies} companies...`;
        progressFill.style.width = '0%';
        results = [];
        resultsDiv.innerHTML = '';
        downloadBtn.disabled = true;
        spinner.style.display = 'block';
        startBtn.disabled = true;

        chrome.runtime.sendMessage({ action: 'processCompanies', companies }, (response) => {
          if (response && response.status === 'started') {
            // Processing started
          }
        });
      },
      error: (err) => {
        console.error('CSV Parse Error:', err);
        alert('Error parsing CSV: ' + err.message + '. Check file encoding (UTF-8) and format.');
      }
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'updateResult') {
      const { company, data, error } = message;
      processedCount++;
      results.push({ ...company, ...data });

      const statusClass = error ? 'error' : 'success';
      const icon = error ? 'fa-times-circle' : 'fa-check-circle';
      const resultText = `${company.Company}: ${data.name || 'N/A'}, Phone: ${data.phone || 'N/A'}, Website: ${data.website || 'N/A'}${error ? ' (Error: ' + error + ')' : ''}`;

      resultsDiv.innerHTML += `
        <div class="result-item ${statusClass}">
          <i class="fas ${icon} result-icon"></i>
          <span>${resultText}</span>
        </div>
      `;
      resultsDiv.scrollTop = resultsDiv.scrollHeight;

      progressDiv.textContent = `Processing ${processedCount}/${totalCompanies} companies...`;
      progressFill.style.width = `${(processedCount / totalCompanies) * 100}%`;
    } else if (message.action === 'processingDone') {
      progressDiv.textContent = 'Processing complete!';
      spinner.style.display = 'none';
      startBtn.disabled = false;
      downloadBtn.disabled = false;
    }
  });

  downloadBtn.addEventListener('click', () => {
    const csvContent = Papa.unparse(results, { header: true });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'scraped_companies.csv', saveAs: true });
  });
});
