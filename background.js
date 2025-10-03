// background.js - service worker for scraping logic and downloads
// ⚠️ WARNING: Direct scraping of Google Maps DOM may violate Google TOS.
// For production, use the Google Places API with an API key.

let scrapeQueue = [];
let currentIndex = 0;
let activeTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
  if (msg.action === 'start-scrape') {
    scrapeQueue = msg.payload;
    currentIndex = 0;
    processNext();
    sendResp({ started: true });
  }

  if (msg.action === 'download-csv') {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename,
      saveAs: true
    });
    sendResp({ ok: true });
  }
});

// Sequentially process each company
function processNext() {
  if (currentIndex >= scrapeQueue.length) return;

  const item = scrapeQueue[currentIndex];
  const query = encodeURIComponent(`${item.company}, ${item.city || ''}, ${item.country || ''}`);
  const url = `https://www.google.com/maps/search/${query}`;

  chrome.tabs.create({ url, active: false }, (tab) => {
    activeTabId = tab.id;

    // Wait for page load
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeGoogleMapsDOM
    }, (results) => {
      let data = results && results[0] ? results[0].result : null;
      let success = !!data && !!data.name;

      const finishedRow = {
        Company: item.company,
        City: item.city,
        Country: item.country,
        Name: data?.name || '',
        Phone: data?.phone || '',
        Website: data?.website || '',
        Email: data?.email || ''
      };

      chrome.runtime.sendMessage({
        action: 'progress-update',
        id: item.id,
        company: item.company,
        status: success ? 'Success' : 'Error',
        success,
        data,
        processed: currentIndex + 1,
        total: scrapeQueue.length,
        finishedRow,
        error: success ? null : 'Not found'
      });

      // Close tab
      chrome.tabs.remove(tab.id);

      currentIndex++;
      if (currentIndex < scrapeQueue.length) {
        setTimeout(processNext, 2500); // delay between requests
      }
    });
  });
}

// ⚠️ DOM scraping (demo only). Use Places API for production.
function scrapeGoogleMapsDOM() {
  let name = document.querySelector('h1')?.innerText || '';
  let phone = '';
  let website = '';
  let email = '';

  document.querySelectorAll('a, button, div').forEach(el => {
    const txt = el.innerText || '';
    if (/^\+?\d[\d\s\-()]{6,}$/.test(txt)) phone = txt;
    if (el.href && el.href.startsWith('http') && !el.href.includes('google.com/maps')) {
      website = el.href;
    }
    if (el.href && el.href.startsWith('mailto:')) {
      email = el.href.replace('mailto:', '');
    }
  });

  return { name, phone, website, email };
}

