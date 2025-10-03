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
      complete: (parseResult) => {
        const companies = parseResult.data.filter(row => row.Company && row.City && row.Country); // Basic validation
        totalCompanies = companies.length;
        if (totalCompanies === 0) return alert('No valid companies in CSV.');

        progressDiv.textContent = `Processing 0/${totalCompanies} companies...`;
        progressFill.style.width = '0%';
        results = [];
        resultsDiv.innerHTML = '';
        downloadBtn.disabled = true;
        spinner.style.display = 'block';
        startBtn.disabled = true;

        chrome.runtime.sendMessage({ action: 'processCompanies', companies }, (response) => {
          if (response.status === 'started') {
            // Processing initiated
          }
        });
      },
      error: (err) => alert('Error parsing CSV: ' + err.message)
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
      resultsDiv.scrollTop = resultsDiv.scrollHeight; // Auto-scroll

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
    const csvContent = Papa.unparse(results);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'scraped_companies_pro.csv', saveAs: true });
  });
});
