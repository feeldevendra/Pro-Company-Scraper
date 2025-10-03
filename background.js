// background.js - service worker for sequential scraping via hidden tabs
// It receives a list of queries from popup and processes them one-by-one.
// For each query, it opens a tab with Google Maps search, injects scrape_maps.js,
// retrieves structured data, and sends updates back to the popup.
// IMPORTANT: DOM scraping Google Maps may violate Google TOS. See commented Places API alternative at bottom.

let currentQueue = [];
let processing = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
  if(msg.action === 'start-scrape'){
    if(processing) return sendResp({ok: false, error: 'Already running'});
    currentQueue = msg.payload.slice(); // array of {id, company, city, country}
    processing = true;
    processQueue();
    sendResp({ok: true});
    return true;
  } else if(msg.action === 'download-csv'){
    // create an object URL used by popup; because service worker cannot access the blob URL of popup directly,
    // we use chrome.downloads API to download using the provided URL.
    const {url, filename} = msg;
    chrome.downloads.download({url, filename}, (id) => { console.log('download initiated', id); });
    sendResp({ok:true});
    return true;
  }
});

// Process queue sequentially
async function processQueue(){
  let total = currentQueue.length;
  let processed = 0;
  for(const item of currentQueue){
    try{
      // prepare query string
      const q = [item.company, item.city, item.country].filter(Boolean).join(', ');
      // Update popup: starting this row
      chrome.runtime.sendMessage({action:'progress-update', id:item.id, status:`Searching: ${q}`, processed, total});

      // Open a new tab (hidden/inactive) with Google Maps search
      const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
      const tab = await createTab({url: searchUrl, active:false});
      // Wait until page loads sufficiently. We will attempt to detect when loading is complete by checking tab status and waiting small intervals.
      const result = await runScrapeInTab(tab.id, 0); // returns structured object or throws
      // Close tab
      try{ await removeTab(tab.id); } catch(e){ /* ignore */ }

      // Normalize result
      const finishedRow = {
        Company: item.company,
        City: item.city || '',
        Country: item.country || '',
        name: result.name || '',
        phone: result.phone || '',
        phone2: result.phone2 || '',
        website: result.website || '',
        email: result.email || '',
        address: result.address || '',
        raw: JSON.stringify(result)
      };

      processed++;
      // Send success update
      chrome.runtime.sendMessage({
        action:'progress-update',
        id:item.id,
        success:true,
        data: finishedRow,
        processed,
        total,
        finishedRow
      });

    } catch(err){
      console.error('Row error', item, err);
      processed++;
      chrome.runtime.sendMessage({
        action:'progress-update',
        id:item.id,
        success:false,
        company: item.company,
        error: String(err),
        processed,
        total,
        finishedRow: {
          Company: item.company,
          City: item.city || '',
          Country: item.country || '',
          name: '',
          phone:'',
          phone2:'',
          website:'',
          email:'',
          address:'',
          raw: ''
        }
      });
    }
  }
  // finished processing
  processing = false;
  currentQueue = [];
}

// helpers using Promise wrappers
function createTab(createProperties){
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      if(chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(tab);
    });
  });
}

function removeTab(tabId){
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if(chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve();
    });
  });
}

// Execute scraping script in the tab; it may need to wait for maps content to render; do retries
function runScrapeInTab(tabId, attempt){
  return new Promise((resolve, reject) => {
    // max wait attempts
    const MAX = 30; // ~30 * 1000ms = 30s
    chrome.scripting.executeScript(
      {
        target: {tabId},
        files: ['scrape_maps.js']
      },
      (results) => {
        if(chrome.runtime.lastError){
          // try again (Maps is heavy and may not be ready)
          if(attempt < 10){
            console.warn('ExecuteScript not ready, retrying', attempt, chrome.runtime.lastError.message);
            setTimeout(()=> {
              runScrapeInTab(tabId, attempt+1).then(resolve).catch(reject);
            }, 1200);
            return;
          } else {
            reject(chrome.runtime.lastError);
            return;
          }
        }
        try{
          const res = results && results[0] && results[0].result;
          if(!res || res.status === 'not-ready'){
            // If page not ready, retry a few times
            if(attempt < MAX){
              setTimeout(()=> {
                runScrapeInTab(tabId, attempt+1).then(resolve).catch(reject);
              }, 1000);
              return;
            } else {
              reject(new Error('Timed out waiting for Google Maps content to load'));
              return;
            }
          } else {
            resolve(res);
            return;
          }
        } catch(e){
          reject(e);
        }
      }
    );
  });
}

/*
-----------------------------------------
Safer / ethical alternative (commented example):

Instead of DOM scraping, use Google Places API (requires API key and billing):
1) Use Places Text Search or Find Place to find place_id by query:
   https://maps.googleapis.com/maps/api/place/findplacefromtext/json
   params: input=q, inputtype=textquery, fields=place_id,formatted_address,name,geometry,formatted_phone_number,website,formatted_address
2) Use Place Details with the place_id to get phone, website, etc.
3) This approach is within the platform terms if you follow Google's API terms and quotas.

Pseudo-example (not included in production code):
fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=place_id,name,formatted_address&key=YOUR_API_KEY`).then(...)

Please add proper rate-limiting when using API.

-----------------------------------------
*/
