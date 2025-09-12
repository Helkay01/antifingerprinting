const script = document.createElement('script');
script.textContent = `

(function() {
 
  // Chrome Android real navigator properties (as of recent Chrome 116)
  const chromeAndroidNavigator = {
    appCodeName: "Mozilla",
    appName: "Netscape",
    appVersion: "5.0 (Linux; Android 13; Pixel 6 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.5845.141 Mobile Safari/537.36",
    platform: "Linux armv8l",
    product: "Gecko",
    productSub: "20030107",
    vendor: "Google Inc.",
    vendorSub: "",
    language: "en-NG",
    languages: ["en-NG", "en"],
    onLine: true,
    cookieEnabled: true,
    webdriver: undefined,
    doNotTrack: null,
    maxTouchPoints: 5,
    deviceMemory: 8,
    hardwareConcurrency: 8,
    // plugins and mimeTypes spoofed separately below
  };

  // Spoof all navigator properties except userAgent
  for (const prop of Object.getOwnPropertyNames(chromeAndroidNavigator)) {
    try {
      Object.defineProperty(navigator, prop, {
        get: () => chromeAndroidNavigator[prop],
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  

  // Spoof plugins similar to Chrome Android
  const fakePlugins = [
    { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
    { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
    { name: "Native Client", filename: "internal-nacl-plugin", description: "" }
  ];

  const fakePluginArray = {
    length: fakePlugins.length,
    item: (index) => fakePlugins[index] || null,
    namedItem: (name) => fakePlugins.find(p => p.name === name) || null,
    refresh: () => {}
  };

  for (let i = 0; i < fakePlugins.length; i++) {
    fakePluginArray[i] = fakePlugins[i];
  }

  try {
    Object.defineProperty(navigator, "plugins", {
      get: () => fakePluginArray,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  const fakeMimeTypeArray = {
    length: 0,
    item: () => null,
    namedItem: () => null,
    refresh: () => {}
  };

  try {
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => fakeMimeTypeArray,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // Spoof window.chrome API
  Object.defineProperty(window, "chrome", {
    get: () => ({
      app: {},
      runtime: {},
      csi: () => ({}),
      loadTimes: () => ({}),
      // You can add more chrome.* APIs here if needed
    }),
    configurable: true,
    enumerable: true
  });

  // Spoof other window properties Chrome Android typically has
  try {
    Object.defineProperty(window, 'deviceMemory', {
      get: () => 8,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  try {
    Object.defineProperty(window, 'hardwareConcurrency', {
      get: () => 8,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // Intl support (as Chrome Android)
  if (!window.Intl) {
    window.Intl = {};
  }
  // Other APIs can be spoofed here as needed (e.g., speechSynthesis, Notification)

  
})();
`;

document.documentElement.appendChild(script);
script.remove();
