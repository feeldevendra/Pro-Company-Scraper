// background.js - service worker
// Educational demo: DOM-scraping Google Maps. For production use Google Places API.

let queue = [];
let running = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
  if (msg.action === 'start-scrape') {
    if (running) return sendResp({ error: 'Already running' });
    queue = Array.isArray(msg.payload) ? msg.payload.slice() : [];
    console.log('Queue received:', queue);
    runQueue();
    sendResp({ ok: true });
    return true;
  }

  if (msg.action === 'download-csv') {
    try {
      const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(msg.csv);
      chrome.downloads.download({ url: dataUrl, filename: msg.filename }, (id) => {
        console.log('download started id=', id);
      });
      sendResp({ ok: true });
    } catch (e) {
      console.error('download-csv error', e);
      sendResp({ ok: false, error: String(e) });
    }
    return true;
  }
});

// Helper: sleep
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Wait until a tab finishes loading (status === 'complete') or timeout
function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function checkStatus() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!tab) return reject(new Error('Tab not found'));
        if (tab.status === 'complete') return resolve(tab);
        if (Date.now() - start > timeoutMs) return reject(new Error('Timeout waiting for tab load'));
        // else retry after short delay
        setTimeout(checkStatus, 800);
      });
    }
    checkStatus();
  });
}

// Scrape function to run inside page — returns structured info
function pageScrapeFunction() {
  try {
    // small helper
    const textBody = (el) => el ? el.innerText.trim() : '';
    // Name: common selectors
    let name = '';
    const nameSelectors = ['h1', '[role="heading"] h1', '[data-testid="title"]', '.section-hero-header-title-title'];
    for (const s of nameSelectors) {
      const el = document.querySelector(s);
      if (el && el.innerText.trim()) { name = el.innerText.trim(); break; }
    }

    // Address/phone/website/email heuristics
    let address = '';
    let phone = '';
    let website = '';
    let email = '';

    // Address: look for common address classes
    const addrEl = document.querySelector('[data-item-id="address"], .LrzXr, .Io6YTe');
    if (addrEl) address = addrEl.innerText.trim();

    // phone from anchors or visible text
    const telAnchor = document.querySelector('a[href^="tel:"]');
    if (telAnchor) phone = telAnchor.href.replace(/^tel:/, '').trim();

    // website anchor — prefer first external link
    const anchors = Array.from(document.querySelectorAll('a[href^="http"]'));
    for (const a of anchors) {
      const href = a.href || '';
      if (href && !href.includes('google.com') && !href.includes('/maps')) { website = href; break; }
    }

    // look for mailto
    const mailAnchor = document.querySelector('a[href^="mailto:"]');
    if (mailAnchor) email = mailAnchor.href.replace(/^mailto:/, '').trim();

    // Last-resort: search page text for phone/email
    const pageText = document.body.innerText || '';
    if (!phone) {
      const phoneMatch = pageText.match(/(\+?\d[\d\-\s().]{6,}\d)/);
      if (phoneMatch) phone = phoneMatch[0].trim();
    }
    if (!email) {
      const em = pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (em) email = em[0].trim();
    }

    return { name, address, phone, website, email, ok: !!name };
  } catch (e) {
    return { error: String(e) };
  }
}

// Process the queue sequentially
async function runQueue() {
  if (running) return;
  running = true;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const query = `${item.company}${item.city ? ', ' + item.city : ''}${item.country ? ', ' + item.country : ''}`;
    console.log(`Processing [${i}] ${query}`);

    let tab;
    try {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
      tab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url, active: false }, (t) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(t);
        });
      });

      // wait for tab to finish loading
      await waitForTabComplete(tab.id, 30000);

      // small delay to let Maps render dynamic content
      await sleep(1200);

      // execute scraping function in page
      const results = await new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, func: pageScrapeFunction },
          (res) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            if (!res || !res[0]) return reject(new Error('No result from executeScript'));
            resolve(res[0].result);
          }
        );
      });

      console.log('Scrape result:', results);

      const success = results && (results.ok || results.name);

      const finishedRow = {
        Company: item.company || '',
        City: item.city || '',
        Country: item.country || '',
        Name: results.name || '',
        Phone: results.phone || '',
        Website: results.website || '',
        Email: results.email || '',
        Address: results.address || ''
      };

      // notify popup
      chrome.runtime.sendMessage({
        action: 'progress-update',
        id: item.id,
        processed: i + 1,
        total: queue.length,
        success: !!success,
        status: success ? 'Found' : 'Not found',
        finishedRow,
        data: results,
        company: item.company
      });

    } catch (err) {
      console.error('Error processing item', item, err);
      // send error update
      chrome.runtime.sendMessage({
        action: 'progress-update',
        id: item.id,
        processed: i + 1,
        total: queue.length,
        success: false,
        status: 'Error',
        error: String(err),
        company: item.company,
        finishedRow: {
          Company: item.company || '',
          City: item.city || '',
          Country: item.country || '',
          Name: '',
          Phone: '',
          Website: '',
          Email: '',
          Address: ''
        }
      });
    } finally {
      // close tab if it exists
      if (tab && tab.id) {
        try {
          chrome.tabs.remove(tab.id);
        } catch (e) {
          // ignore
        }
      }
      // small polite delay between queries
      await sleep(1500);
    }
  } // end loop

  running = false;
  queue = [];
  console.log('Queue finished.');
}
