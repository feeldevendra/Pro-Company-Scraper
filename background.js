chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processCompanies') {
    processCompanies(message.companies).then(() => {
      sendResponse({ status: 'started' });
    });
    return true; // Async response
  }
});

async function processCompanies(companies) {
  for (const company of companies) {
    let extracted = { name: 'N/A', phone: 'N/A', website: 'N/A' };
    let error = null;
    try {
      const query = `${company.Company.trim()}, ${company.City ? company.City.trim() : ''}, ${company.Country ? company.Country.trim() : ''}`.trim();
      if (!query) throw new Error('Invalid query');

      // Ethical Approach: Google Places API (Recommended - Uncomment and add your API key)
      // const apiKey = 'YOUR_GOOGLE_PLACES_API_KEY_HERE'; // Get from https://console.cloud.google.com/
      // const placesUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
      // const response = await fetch(placesUrl);
      // if (!response.ok) throw new Error(`API error: ${response.status}`);
      // const data = await response.json();
      // if (data.results && data.results[0]) {
      //   const place = data.results[0];
      //   extracted = {
      //     name: place.name || 'N/A',
      //     phone: place.formatted_phone_number || 'N/A',
      //     website: place.website || 'N/A'
      //   };
      // } else {
      //   throw new Error('No results found');
      // }

      // Alternative: Direct Scraping (Educational only - Against Google TOS)
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
      const tab = await createTab(mapsUrl);
      await waitForTabLoad(tab.id);
      extracted = await extractDataFromTab(tab.id);
      await chrome.tabs.remove(tab.id);
    } catch (err) {
      error = err.message;
    }

    chrome.runtime.sendMessageToPopup({ action: 'updateResult', company, data: extracted, error });
  }

  chrome.runtime.sendMessageToPopup({ action: 'processingDone' });
}

function createTab(url) {
  return new Promise((resolve) => chrome.tabs.create({ url, active: false }, resolve));
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 3000); // Wait for full render
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractDataFromTab(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const name = document.querySelector('[data-item-id="authority"] .fontHeadlineLarge')?.textContent.trim() || document.querySelector('.fontHeadlineLarge')?.textContent.trim() || 'N/A';
        const details = Array.from(document.querySelectorAll('.Io6YTe.fontBodyMedium')).map(el => el.textContent.trim());
        const phone = details.find(text => /^\+?(\d{1,3}[\s-]?)?($$ \d{3} $$|\d{3})[\s-]?\d{3}[\s-]?\d{4}$/.test(text)) || 'N/A';
        const website = details.find(text => /^https?:\/\/.*/.test(text)) || 'N/A';
        return { name, phone, website };
      }
    });
    return result.result;
  } catch (err) {
    return { name: 'N/A', phone: 'N/A', website: 'N/A' };
  }
}

// Helper to send messages (since sendMessage may not always find the popup if closed)
chrome.runtime.sendMessageToPopup = (message) => {
  chrome.runtime.sendMessage(message).catch(() => {}); // Ignore if popup closed
};
