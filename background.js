chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processCompanies') {
    processCompanies(message.companies);
    sendResponse({ status: 'started' });
  }
  return true;
});

async function processCompanies(companies) {
  for (const company of companies) {
    let extracted = {};
    let error = null;
    try {
      const query = `${company.Company}, ${company.City || ''}, ${company.Country || ''}`;
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

      // Preferred: Use Google Places API (uncomment and add your key)
      // const apiKey = 'YOUR_GOOGLE_PLACES_API_KEY';
      // const placesUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
      // const response = await fetch(placesUrl);
      // if (!response.ok) throw new Error('API request failed');
      // const data = await response.json();
      // const place = data.results[0];
      // extracted = place ? {
      //   name: place.name,
      //   phone: place.formatted_phone_number || 'N/A',
      //   website: place.website || 'N/A'
      //   // Add: email if available via details API (place_id -> details endpoint)
      // } : {};

      // Alternative: Direct scraping (educational, TOS risk)
      const tab = await new Promise((resolve) => chrome.tabs.create({ url: mapsUrl, active: false }, resolve));
      await waitForTabLoad(tab.id);
      extracted = await extractDataFromTab(tab.id);
      await chrome.tabs.remove(tab.id);
    } catch (err) {
      error = err.message;
      extracted = { name: 'N/A', phone: 'N/A', website: 'N/A' };
    }

    chrome.runtime.sendMessage({ action: 'updateResult', company, data: extracted, error });
  }

  chrome.runtime.sendMessage({ action: 'processingDone' });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 2000); // Extra wait for JS load
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractDataFromTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const name = document.querySelector('.fontHeadlineLarge')?.textContent.trim() || 'N/A';
      const details = Array.from(document.querySelectorAll('.Io6YTe')).map(el => el.textContent.trim());
      const phone = details.find(text => /^\+?\d{1,3}[\s-]\d{3,}/.test(text)) || 'N/A';
      const website = details.find(text => /^https?:\/\//.test(text)) || 'N/A';
      // Email: Rarely on Maps; could regex but unlikely
      return { name, phone, website };
    }
  });
  return result.result || { name: 'N/A', phone: 'N/A', website: 'N/A' };
}
