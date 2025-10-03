// scrape_maps.js
// This file runs **inside** the Google Maps tab and attempts to extract information
// from the Maps DOM. It returns an object (via the execution result).
//
// WARNING: DOM selectors on Google Maps are fragile and change frequently.
// This is for educational/demo use only. Use the Places API for reliable, legal access.

// Helper: wait for a selector up to timeout milliseconds
function waitForSelector(selector, timeout = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function check(){
      const el = document.querySelector(selector);
      if(el) return resolve(el);
      if(Date.now() - start > timeout) return resolve(null);
      requestAnimationFrame(check);
    })();
  });
}

// try to extract content with many fallbacks
(async function(){
  try{
    // Wait a little for Maps to render
    await new Promise(r => setTimeout(r, 1200));

    // Attempt multiple known container selectors for the place details panel
    const panelSelectors = [
      '#pane', // generic
      'div[role="main"] div.widget-pane', // older layouts
      '[data-section-id="pane"]', // new-ish
      'div[aria-label^="Results for"]'
    ];
    let panel = null;
    for(const s of panelSelectors){
      panel = document.querySelector(s);
      if(panel) break;
    }

    // If no panel found, it might be at the top results list — return not-ready to ask for retry
    if(!panel){
      // maps often shows a results list before opening place panel
      // check for any result item
      const someResult = document.querySelector('div[role="listitem"], .section-result, .Nv2PK'); // fallback set
      if(!someResult) {
        return {status:'not-ready'};
      }
    }

    // We will try to find name/address/phone/website/email from various possible selectors
    let name = '';
    let address = '';
    let phone = '';
    let phone2 = '';
    let website = '';
    let email = '';

    // Name: common selectors
    const nameEl = document.querySelector('h1[class*="fontHeadline"],h1[aria-level="1"]') || document.querySelector('h1.section-hero-header-title-title') || document.querySelector('[data-testid="title"]') || document.querySelector('[aria-label][role="heading"]');
    if(nameEl) name = nameEl.innerText.trim();

    // Address
    const addressEl = document.querySelector('[data-item-id="address"], .LrzXr, .Io6YTe, .section-info-line, button[data-tooltip="Copy address"]') || document.querySelector('button[aria-label*="Address"]');
    if(addressEl) address = addressEl.innerText.trim();

    // Phone: look for telephone link or button text
    // Many maps versions include a button whose aria-label or data attr contains phone.
    const phoneSelectorCandidates = [
      'button[data-tooltip*="Call"]',
      'button[aria-label*="call"]',
      'button[aria-label*="Phone"]',
      'a[href^="tel:"]',
      'button[jsaction*="phone"]',
      '.LrzXr.zdqRlf.kno-fv'
    ];
    for(const sel of phoneSelectorCandidates){
      const el = document.querySelector(sel);
      if(el){
        // try href
        if(el.tagName === 'A' && el.href && el.href.startsWith('tel:')) {
          phone = decodeURIComponent(el.href.replace('tel:','')).trim();
          break;
        }
        // aria-label
        if(el.getAttribute && el.getAttribute('aria-label')){
          phone = el.getAttribute('aria-label').replace(/call/i,'').trim();
          break;
        }
        // inner text
        if(el.innerText && el.innerText.match(/\d/)){
          phone = el.innerText.trim();
          break;
        }
      }
    }

    // Website: look for anchor that points to domain or has "Website" label
    const websiteCandidates = [
      'a[data-item-id="authority"]',
      'a[aria-label*="Website"]',
      'a[href^="http"]',
      'a[href*="http"][data-attrid]'
    ];
    for(const sel of websiteCandidates){
      const el = document.querySelector(sel);
      if(el && el.href){
        // prefer external site (not google.com)
        if(!el.href.includes('google.com')){
          website = el.href;
          break;
        } else if(!website) {
          website = el.href;
        }
      }
    }

    // Try to get email — maps rarely shows email. If present it might be in details or description
    const descEl = document.querySelector('.QAXWLe, .section-editorial, .section-info-text');
    if(descEl){
      const txt = descEl.innerText;
      const em = txt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if(em) email = em[0];
    }

    // Extra: search the page text for additional phone numbers
    const pageText = document.body.innerText;
    if(!phone){
      const phoneMatch = pageText.match(/(\+?\d[\d\-\s().]{6,}\d)/);
      if(phoneMatch) phone = phoneMatch[0].trim();
    }

    // Attempt to get second phone if present (rare)
    const phoneMatches = (pageText.match(/\+?\d[\d\-\s().]{6,}\d/g) || []).slice(0,2);
    if(phoneMatches && phoneMatches.length > 1) phone2 = phoneMatches[1];

    // Clean up website: keep first http(s) link that is not Google maps
    if(!website){
      const links = Array.from(document.querySelectorAll('a[href^="http"]')).map(a=>a.href);
      const ext = links.find(l => !l.includes('google.com') && !l.includes('/maps'));
      if(ext) website = ext;
    }

    // Return collected info
    return {
      status: 'ok',
      name: name || '',
      address: address || '',
      phone: phone || '',
      phone2: phone2 || '',
      website: website || '',
      email: email || '',
      raw_text_snippet: (document.body.innerText || '').slice(0,1500)
    };

  } catch(e){
    return {status:'error', message: String(e)};
  }
})();
