

(async () => {
  'use strict';

  const origin = location.origin;
  console.log(`[TrackerWipeper+] Starting next-level cleanup for origin: ${origin}`);

  // ---------------- HELPER FUNCTIONS ----------------
  const safeDeleteCookie = cookie => {
    const eqPos = cookie.indexOf('=');
    const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
  };

  const clearLocalStorageSafe = (win) => { try { win.localStorage.clear(); } catch {} try { win.sessionStorage.clear(); } catch {}; };
  const clearIndexedDBSafe = async (win) => {
    if (!('indexedDB' in win)) return;
    const dbs = await win.indexedDB.databases?.() || [];
    await Promise.all(dbs.filter(db => db.name).map(db => new Promise(resolve => {
      const req = win.indexedDB.deleteDatabase(db.name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    })));
  };
  const clearCachesSafe = async (win) => { if ('caches' in win) { const keys = await win.caches.keys(); await Promise.all(keys.map(k => win.caches.delete(k))); } };
  const clearServiceWorkersSafe = async (win) => { if ('serviceWorker' in win) { const regs = await win.navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); } };
  const clearWebSQLSafe = (win) => { if ('openDatabase' in win) { ['db1','db2','defaultDB'].forEach(dbName => { const db = win.openDatabase(dbName,'1.0','stealth',2*1024*1024); if(db){ db.transaction(tx=>tx.executeSql('DROP TABLE IF EXISTS sqlite_master',[],()=>{},()=>{})); } }); } };
  const clearFileSystemSafe = (win) => { try { if ('webkitRequestFileSystem' in win) win.webkitRequestFileSystem(win.TEMPORARY,1024,fs=>fs.root.removeRecursively(()=>{},()=>{}),()=>{}); } catch {} };
  const clearCookiesSafe = (win) => { try { win.document.cookie.split(';').forEach(safeDeleteCookie); } catch {} };

  const clearAllStorage = async (win) => {
    clearLocalStorageSafe(win);
    await clearIndexedDBSafe(win);
    await clearCachesSafe(win);
    await clearServiceWorkersSafe(win);
    clearWebSQLSafe(win);
    clearFileSystemSafe(win);
    clearCookiesSafe(win);
  };

  // ---------------- NETWORK RESOURCE TRACKING ----------------
  const discoverThirdPartyDomains = () => {
    const domains = new Set();

    // From DOM elements
    const elements = Array.from(document.querySelectorAll('iframe, script[src], img[src], link[href]'));
    elements.forEach(el => {
      const url = el.src || el.href;
      if (!url) return;
      try {
        const u = new URL(url, location.href);
        if (u.hostname !== location.hostname) domains.add(u.hostname);
      } catch {}
    });

    // From Performance API (dynamic resources)
    if ('performance' in window && performance.getEntriesByType) {
      performance.getEntriesByType('resource').forEach(r => {
        try {
          const u = new URL(r.name, location.href);
          if (u.hostname !== location.hostname) domains.add(u.hostname);
        } catch {}
      });
    }

    return Array.from(domains);
  };

  // ---------------- AGGRESSIVE IFRAME CLEANUP ----------------
  const aggressiveIframeCleanup = async (domains) => {
    for (let domain of domains) {
      try {
        const iframe = document.createElement('iframe');
        iframe.src = `${location.protocol}//${domain}/`;
        iframe.style.display = 'none';
        iframe.sandbox = 'allow-same-origin allow-scripts';
        document.body.appendChild(iframe);

        await new Promise(resolve => {
          iframe.onload = async () => {
            try {
              const win = iframe.contentWindow;
              await clearAllStorage(win);
            } catch (e) {}
            finally { iframe.remove(); resolve(); }
          };
          setTimeout(() => { iframe.remove(); resolve(); }, 5000);
        });
      } catch {}
    }
  };

  // ---------------- RECURSIVE IFRAME CLEANUP ----------------
  const cleanAccessibleIframes = async (win) => {
    await clearAllStorage(win);
    const iframes = win.document.getElementsByTagName('iframe');
    for (let iframe of iframes) {
      try {
        const iframeWin = iframe.contentWindow;
        if (iframeWin) await cleanAccessibleIframes(iframeWin);
      } catch {}
    }
  };

  // ---------------- EXECUTE CLEANUP ----------------
  await clearAllStorage(window);                   // 1. First-party cleanup
  await cleanAccessibleIframes(window);            // 2. Accessible iframes
  const thirdPartyDomains = discoverThirdPartyDomains();  // 3. Discover trackers dynamically
  console.log(`[TrackerWipeper+] Found third-party domains: ${thirdPartyDomains.join(', ')}`);
  await aggressiveIframeCleanup(thirdPartyDomains);        // 4. Attempt cleanup for third-party domains

  console.log(`[TrackerWipeper+] Next-level cross-site cleanup complete for: ${origin}`);
})();