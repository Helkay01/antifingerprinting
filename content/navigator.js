const script = document.createElement('script');
script.textContent = `

(function() {
  const spoofed = {
    userAgent: "Mozilla/5.0 ..",
    platform: "Linux armv8l",
    vendor: "Google Inc.",
    languages: ["en-NG", "en"],
    language: "en-NG",
    webdriver: undefined
  };

  for (const prop in spoofed) {
    try {
      Object.defineProperty(navigator, prop, {
        get: () => spoofed[prop],
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  Object.defineProperty(window, "chrome", {
    get: () => ({
      app: {},
      runtime: {},
      csi: () => ({}),
      loadTimes: () => ({}),
    }),
    configurable: true,
    enumerable: true
  });

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

})();

`;

document.documentElement.appendChild(script);
script.remove();
