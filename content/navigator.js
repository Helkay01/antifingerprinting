(() => {
    'use strict';

    // ==================== ENTERPRISE CONFIGURATION ====================
    const CONFIG = {
        SESSION_TTL_MINUTES: 3,
        ROTATION_INTERVAL_MINUTES: 120,
        JITTER_PERCENTAGE: 0.1,
        DEBUG: false,
        FALLBACK_UA: "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36",
        UA_API_ENDPOINTS: [
            "https://httpbin.org/user-agent",
            "https://api.httpbin.org/user-agent",
            "https://httpbin.org/headers"
        ],
        MAX_RETRIES: 2,
        RETRY_DELAY: 1000
    };

    // ==================== GLOBAL STATE (needed by many functions) ====================
    let USER_AGENT_DATA = null;
    const NAVIGATOR_PROFILES = {
        ANDROID_CHROME: null
    };

    const originsData = new Map();  // origin -> fingerprint
    const sessionState = {
        lastRotation: 0,
        initialized: false
    };

    // Utility aliases
    const objectDefineProperty = Object.defineProperty;
    const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const objectGetPrototypeOf = Object.getPrototypeOf;
    const objectSetPrototypeOf = Object.setPrototypeOf;
    const mathRandom = Math.random;
    const mathFloor = Math.floor;

    // ==================== ERROR HANDLING & LOGGING ====================
    const logger = {
        debug: (...args) => {
            if (CONFIG.DEBUG) console.log('[Stealth]', ...args);
        },
        warn: (...args) => {
            console.warn('[Stealth]', ...args);
        },
        error: (...args) => {
            console.error('[Stealth]', ...args);
        },
        info: (...args) => {
            console.log('[Stealth]', ...args);
        }
    };

    // ==================== FETCH UA & BUILD PROFILES ====================
    async function fetchWithRetry(url, options = {}, retries = CONFIG.MAX_RETRIES) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (error) {
            if (retries > 0) {
                logger.debug(`Retrying ${url}, attempts left: ${retries}`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
                return fetchWithRetry(url, options, retries - 1);
            }
            throw error;
        }
    }

    async function fetchAndParseUA() {
        let lastError;
        
        // Try each endpoint in order
        for (const apiUrl of CONFIG.UA_API_ENDPOINTS) {
            try {
                const response = await fetchWithRetry(apiUrl, {
                    credentials: 'omit',
                    referrerPolicy: 'no-referrer'
                });
                
                if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);
                
                const data = await response.json();
                let ua;
                
                // Handle different API response formats
                if (apiUrl.includes('headers')) {
                    ua = data.headers['User-Agent'] || data.headers['user-agent'];
                } else {
                    ua = data["user-agent"] || data["User-Agent"];
                }
                
                if (!ua) throw new Error('No user agent found in response');
                
                const regex = /\(Linux; Android (\d+(?:\.\d+){0,2});\s*([^\);]+).*?\).*Chrome\/([\d.]+)/;
                const match = ua.match(regex);
                
                if (!match) {
                    logger.debug("No Android UA match found in:", ua);
                    continue; // Try next endpoint
                }
                
                const parsedUA = {
                    platformVersion: match[1],
                    model: match[2].trim(),
                    uaFullVersion: match[3],
                    appVersion: ua
                };
                
                const userAgentData = {
                    brands: [
                        { brand: "Not-A.Brand", version: parsedUA.uaFullVersion.split(".")[0] },
                        { brand: "Google Chrome", version: parsedUA.uaFullVersion.split(".")[0] },
                        { brand: "Chromium", version: parsedUA.uaFullVersion.split(".")[0] }
                    ],
                    mobile: true,
                    platform: "Android",
                    platformVersion: parsedUA.platformVersion,
                    architecture: "arm",
                    model: parsedUA.model,
                    uaFullVersion: parsedUA.uaFullVersion
                };

                let hdC = [4, 4, 4, 8];
                let dm = [2, 4, 6, 8];
                let mtp = [4, 5, 6, 8];
                let ArrayRandom = Math.round(Math.random() * 3);

                const navigatorProfile = {
                    userAgent: parsedUA.appVersion,
                    appVersion: parsedUA.appVersion,
                    platform: "Linux armv8l",
                    vendor: "Google Inc.",
                    vendorSub: "",
                    product: "Gecko",
                    productSub: "20030107",
                    appName: "Netscape",
                    appCodeName: "Mozilla",
                    language: "en-NG",
                    languages: ["en-NG", "en"],
                    hardwareConcurrency: hdC[ArrayRandom],
                    deviceMemory: dm[ArrayRandom],
                    maxTouchPoints: mtp[ArrayRandom],
                    pdfViewerEnabled: true,
                    webdriver: false,
                    doNotTrack: "unavailable",
                    cookieEnabled: true,
                    onLine: true,
                    connection: {
                        effectiveType: "4g",
                        rtt: 100,
                        downlink: 5.5,
                        saveData: false
                    }
                };
                
                return { userAgentData, navigatorProfile };
            } catch (error) {
                lastError = error;
                logger.debug(`Failed to fetch from ${apiUrl}:`, error);
            }
        }
        
        // If all endpoints failed, use fallback
        logger.warn('All UA endpoints failed, using fallback UA');
        return createFallbackProfile();
    }

    function createFallbackProfile() {
        const ua = CONFIG.FALLBACK_UA;
        const regex = /\(Linux; Android (\d+(?:\.\d+){0,2});\s*([^\);]+).*?\).*Chrome\/([\d.]+)/;
        const match = ua.match(regex) || ["", "10", "SM-G981B", "80.0.3987.162"];
        
        const parsedUA = {
            platformVersion: match[1],
            model: match[2],
            uaFullVersion: match[3],
            appVersion: ua
        };
        
        const userAgentData = {
            brands: [
                { brand: "Not-A.Brand", version: "80" },
                { brand: "Google Chrome", version: "80" },
                { brand: "Chromium", version: "80" }
            ],
            mobile: true,
            platform: "Android",
            platformVersion: parsedUA.platformVersion,
            architecture: "arm",
            model: parsedUA.model,
            uaFullVersion: parsedUA.uaFullVersion
        };

        let hdC = [4, 4, 4, 8];
        let dm = [2, 4, 6, 8];
        let mtp = [4, 5, 6, 8];
        let ArrayRandom = Math.round(Math.random() * 3);

        const navigatorProfile = {
            userAgent: parsedUA.appVersion,
            appVersion: parsedUA.appVersion,
            platform: "Linux armv8l",
            vendor: "Google Inc.",
            vendorSub: "",
            product: "Gecko",
            productSub: "20030107",
            appName: "Netscape",
            appCodeName: "Mozilla",
            language: "en-NG",
            languages: ["en-NG", "en"],
            hardwareConcurrency: hdC[ArrayRandom],
            deviceMemory: dm[ArrayRandom],
            maxTouchPoints: mtp[ArrayRandom],
            pdfViewerEnabled: true,
            webdriver: false,
            doNotTrack: "unavailable",
            cookieEnabled: true,
            onLine: true,
            connection: {
                effectiveType: "4g",
                rtt: 100,
                downlink: 5.5,
                saveData: false
            }
        };
        
        return { userAgentData, navigatorProfile };
    }

    // ==================== UTILITY FUNCTIONS ====================
    const addJitter = (value, percentage = CONFIG.JITTER_PERCENTAGE) => {
        const jitter = Math.abs(value) * percentage;
        return value + (mathRandom() * jitter * 2 - jitter);
    };

    const makeNativeString = (fnName = '') => `function ${fnName}() { [native code] }`;

    const patchToString = (origFn, fakeFn, name = '') => {
        try {
            objectDefineProperty(fakeFn, 'toString', {
                value: () => makeNativeString(name || (origFn && origFn.name) || ''),
                writable: false,
                enumerable: false,
                configurable: true
            });
            // Further hardening: hide the toString of toString
            if (fakeFn.toString && typeof fakeFn.toString.toString === 'function') {
                objectDefineProperty(fakeFn.toString, 'toString', {
                    value: () => makeNativeString('toString'),
                    writable: false,
                    enumerable: false,
                    configurable: false
                });
            }
        } catch (e) {
            logger.warn('patchToString failed', e);
        }
    };

    const createDeepClone = (obj) => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (Array.isArray(obj)) return obj.map(createDeepClone);
        const cloned = {};
        Object.keys(obj).forEach(k => cloned[k] = createDeepClone(obj[k]));
        return cloned;
    };

    const generateSessionId = () => mathRandom().toString(36).substring(2) + Date.now().toString(36);

    const generateSessionFingerprint = () => {
        const baseProfile = createDeepClone(NAVIGATOR_PROFILES.ANDROID_CHROME);
        if (baseProfile.connection) {
            baseProfile.connection.rtt = mathFloor(addJitter(baseProfile.connection.rtt));
            baseProfile.connection.downlink = parseFloat(addJitter(baseProfile.connection.downlink).toFixed(1));
        }
        return {
            ...baseProfile,
            sessionId: generateSessionId(),
            timestamp: Date.now()
        };
    };

    const getOriginFingerprint = () => {
        const origin = (location && location.origin) ? location.origin : "null";
        const now = Date.now();
        const existing = originsData.get(origin);
        if (!existing || (now - existing.timestamp > CONFIG.SESSION_TTL_MINUTES * 60 * 1000)) {
            const newFp = generateSessionFingerprint();
            originsData.set(origin, newFp);
            logger.debug('New fingerprint for origin', origin, newFp);
        }
        return originsData.get(origin);
    };

    // ==================== STEALTH PATCHING ====================
    const stealthDefine = (obj, prop, value, options = {}) => {
        try {
            const descriptor = objectGetOwnPropertyDescriptor(obj, prop);
            if (descriptor && descriptor.configurable === false) return false;
            if (typeof value === 'function') {
                patchToString(descriptor && descriptor.value, value, prop);
            }
            objectDefineProperty(obj, prop, {
                get: () => value,
                enumerable: options.enumerable ?? false,
                configurable: options.configurable ?? true
            });
            return true;
        } catch (e) {
            logger.warn('Failed to define property:', prop, e);
            return false;
        }
    };

    const stealthDefineDataProp = (obj, prop, value, options = {}) => {
        try {
            const descriptor = objectGetOwnPropertyDescriptor(obj, prop);
            if (descriptor && descriptor.configurable === false) return false;
            objectDefineProperty(obj, prop, {
                value: value,
                writable: !!options.writable,
                enumerable: options.enumerable ?? false,
                configurable: options.configurable ?? true
            });
            return true;
        } catch (e) {
            logger.warn('Failed to define data property:', prop, e);
            return false;
        }
    };

    const stealthObject = (targetObj, fakeData, parentKey = '') => {
        if (!targetObj || typeof targetObj !== 'object') return;
        Object.keys(fakeData).forEach(key => {
            const fullKey = parentKey ? `${parentKey}.${key}` : key;
            try {
                const v = fakeData[key];
                if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
                    if (targetObj[key] !== undefined && targetObj[key] !== null) {
                        stealthObject(targetObj[key], v, fullKey);
                    } else {
                        stealthDefine(targetObj, key, v);
                    }
                } else {
                    stealthDefine(targetObj, key, v);
                }
            } catch (e) {
                logger.warn('Failed to spoof:', fullKey, e);
            }
        });
    };

    const makeFakeUserAgentData = (base = USER_AGENT_DATA) => {
        function FakeUAData() {}
        FakeUAData.prototype.getHighEntropyValues = function(hints) {
            return Promise.resolve().then(() => {
                const result = {};
                if (!Array.isArray(hints)) hints = [];
                hints.forEach(hint => {
                    switch (hint) {
                        case 'formFactor': result.formFactor = 'mobile'; break;
                        case 'architecture': result.architecture = base.architecture; break;
                        case 'bitness': result.bitness = '64'; break;
                        case 'model': result.model = base.model; break;
                        case 'platformVersion': result.platformVersion = base.platformVersion; break;
                        case 'uaFullVersion': result.uaFullVersion = base.uaFullVersion; break;
                        case 'fullVersionList': result.fullVersionList = base.brands.map(b => ({ brand: b.brand, version: b.version })); break;
                        default: break;
                    }
                });
                result.mobile = true;
                return result;
            });
        };
        patchToString(FakeUAData.prototype.getHighEntropyValues, FakeUAData.prototype.getHighEntropyValues, 'getHighEntropyValues');

        const instance = new FakeUAData();
        stealthDefineDataProp(instance, 'brands', base.brands.map(b => ({ brand: b.brand, version: b.version })), { writable: false, enumerable: false, configurable: false });
        stealthDefineDataProp(instance, 'mobile', true, { writable: false, enumerable: false, configurable: false });
        stealthDefineDataProp(instance, 'platform', base.platform, { writable: false, enumerable: false, configurable: false });
        const fakeToJSON = function () {
            return {
                brands: this.brands,
                mobile: this.mobile,
                platform: this.platform
            };
        };
        patchToString(fakeToJSON, fakeToJSON, 'toJSON');
        stealthDefineDataProp(instance, 'toJSON', fakeToJSON, { writable: false, enumerable: false, configurable: false });

        try {
            const nativeProto = navigator.userAgentData && objectGetPrototypeOf(navigator.userAgentData);
            if (nativeProto) {
                objectSetPrototypeOf(FakeUAData.prototype, nativeProto);
                objectSetPrototypeOf(instance, FakeUAData.prototype);
            }
        } catch (e) {
            logger.warn('Failed setting prototype chain for FakeUAData', e);
        }

        try { Object.freeze(instance); } catch (e) {}

        return instance;
    };

    const spoofUserAgentData = () => {
        if (!('userAgentData' in navigator)) return;
        const fakeUA = makeFakeUserAgentData(USER_AGENT_DATA);
        stealthDefine(navigator, 'userAgentData', fakeUA);
        const uaProto = objectGetPrototypeOf(navigator.userAgentData) || {};
        stealthDefine(uaProto, 'brands', fakeUA.brands);
        stealthDefine(uaProto, 'mobile', true);
        stealthDefine(uaProto, 'platform', fakeUA.platform);
        stealthDefine(uaProto, 'getHighEntropyValues', fakeUA.getHighEntropyValues);
        stealthDefine(uaProto, 'toJSON', fakeUA.toJSON);
        stealthDefine(navigator, 'userAgent', NAVIGATOR_PROFILES.ANDROID_CHROME.userAgent);
    };

    const spoofNavigator = () => {
        const fingerprint = getOriginFingerprint();
        
        // Directly override navigator properties
        Object.keys(fingerprint).forEach(key => {
            if (key !== 'connection' && key !== 'sessionId' && key !== 'timestamp') {
                try {
                    stealthDefine(navigator, key, fingerprint[key]);
                } catch (e) {
                    logger.warn('Failed to spoof navigator property:', key, e);
                }
            }
        });
        
        // Handle connection separately
        if (fingerprint.connection && navigator.connection) {
            Object.keys(fingerprint.connection).forEach(key => {
                try {
                    stealthDefine(navigator.connection, key, fingerprint.connection[key]);
                } catch (e) {
                    logger.warn('Failed to spoof connection property:', key, e);
                }
            });
        }
    };

    const installCountermeasures = () => {
        // 1. Guard Object.getOwnPropertyDescriptor to hide stealth getters
        const originalGetOwnPropDesc = Object.getOwnPropertyDescriptor;
        objectDefineProperty(Object, 'getOwnPropertyDescriptor', {
            value: function(obj, prop) {
                const result = originalGetOwnPropDesc.call(Object, obj, prop);
                try {
                    if (result && typeof result.get === 'function') {
                        const s = result.get.toString();
                        if (s.includes('getHighEntropyValues') || s.includes('stealth') || s.includes('spoofUserAgentData')) {
                            let val;
                            try { val = result.get.call(obj); } catch (inner) { val = undefined; }
                            return {
                                value: val,
                                writable: false,
                                enumerable: result.enumerable,
                                configurable: result.configurable
                            };
                        }
                    }
                } catch(e) {
                    // ignore
                }
                return result;
            },
            configurable: true,
            writable: true,
            enumerable: false
        });

        // 2. Harden Object.getPrototypeOf so it's harder to detect the fake UAData class etc.
        const originalGetPrototypeOf = Object.getPrototypeOf;
        objectDefineProperty(Object, 'getPrototypeOf', {
            value: function(obj) {
                try {
                    // If obj is instance of our fake UAData, return a benign prototype (e.g. navigator.userAgentData's original prototype)
                    if (obj && obj.constructor && obj.constructor.name === 'FakeUAData') {
                        // Try to get a native prototype or fallback
                        const nat = (navigator.userAgentData && originalGetPrototypeOf(navigator.userAgentData)) || Object.prototype;
                        return nat;
                    }
                } catch (e) {
                    // swallow
                }
                return originalGetPrototypeOf.call(Object, obj);
            },
            configurable: true,
            writable: true,
            enumerable: false
        });

        // 3. Optionally reduce stack trace limit / filter stacks to avoid leaked internals
        try {
            if ('stackTraceLimit' in Error) {
                Error.stackTraceLimit = Math.max(10, Math.min(50, Error.stackTraceLimit));
            }
        } catch(e) {}

        // 4. Optionally override Error.prepareStackTrace (V8) / equivalent if available to filter frames
        // Not added here because browsers vary — could leak anyway
    };

    // ==================== ROTATION LOGIC ====================
    const scheduleFingerprintRotation = () => {
        sessionState.lastRotation = Date.now();
        setInterval(() => {
            const now = Date.now();
            if (now - sessionState.lastRotation >= CONFIG.ROTATION_INTERVAL_MINUTES * 60 * 1000) {
                // Rotate
                const origin = location.origin;
                const newFp = generateSessionFingerprint();
                originsData.set(origin, newFp);
                sessionState.lastRotation = now;
                logger.debug('Fingerprint rotated at', newFp);
                // Re‑apply stealth with new profile
                initializeStealth();  
            }
        }, 60 * 1000);  // check every minute
    };

    // ==================== IFRAME / DETACHED DOCUMENT RE‑APPLICATION ====================
    function injectIntoFrameContext(frameWindow) {
        try {
            if (!frameWindow || !frameWindow.navigator) return;
            // Spoof navigator in the frame
            const fp = getOriginFingerprint();
            Object.keys(fp).forEach(key => {
                if (key !== 'connection' && key !== 'sessionId' && key !== 'timestamp') {
                    try {
                        stealthDefine(frameWindow.navigator, key, fp[key]);
                    } catch (e) {
                        logger.warn('Failed to spoof frame navigator property:', key, e);
                    }
                }
            });
            
            // Handle connection separately
            if (fp.connection && frameWindow.navigator.connection) {
                Object.keys(fp.connection).forEach(key => {
                    try {
                        stealthDefine(frameWindow.navigator.connection, key, fp.connection[key]);
                    } catch (e) {
                        logger.warn('Failed to spoof frame connection property:', key, e);
                    }
                });
            }
            
            // Spoof userAgentData if present
            if ('userAgentData' in frameWindow.navigator) {
                const fakeUA = makeFakeUserAgentData(USER_AGENT_DATA);
                stealthDefine(frameWindow.navigator, 'userAgentData', fakeUA);
                const uaProto = objectGetPrototypeOf(frameWindow.navigator.userAgentData) || {};
                stealthDefine(uaProto, 'brands', fakeUA.brands);
                stealthDefine(uaProto, 'mobile', true);
                stealthDefine(uaProto, 'platform', fakeUA.platform);
                stealthDefine(uaProto, 'getHighEntropyValues', fakeUA.getHighEntropyValues);
                stealthDefine(uaProto, 'toJSON', fakeUA.toJSON);
            }
        } catch (e) {
            logger.warn('injectIntoFrameContext error', e);
        }
    }

    function observeAndInjectFrames() {
        // Observe for added iframes
        const mutationObserver = new MutationObserver(mutations => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.tagName === 'IFRAME') {
                        node.addEventListener('load', () => {
                            try { injectIntoFrameContext(node.contentWindow); } catch (e) {}
                        });
                    }
                }
            }
        });
        mutationObserver.observe(document, { childList: true, subtree: true });

        // Also apply to existing iframes
        const frames = document.querySelectorAll('iframe');
        frames.forEach(frame => {
            try { injectIntoFrameContext(frame.contentWindow); } catch (e) {}
        });
    }

    // ==================== INITIALIZE ====================
    function initializeStealth() {
        try {
            installCountermeasures();
            spoofNavigator();
            spoofUserAgentData();
            observeAndInjectFrames();
            // Freeze key profiles so code can't be tampered
            try { Object.freeze(USER_AGENT_DATA); } catch (e) {}
            try { Object.freeze(NAVIGATOR_PROFILES.ANDROID_CHROME); } catch (e) {}
            try { Object.freeze(NAVIGATOR_PROFILES); } catch (e) {}
            
            return true;
        } catch (e) {
            logger.error('initializeStealth failed', e);
            return false;
        }
    }

    // ==================== SUCCESS CHECK AND LOGGING ====================
    function checkStealthApplied() {
        // Check if UA data was fetched successfully
        if (!USER_AGENT_DATA || !NAVIGATOR_PROFILES.ANDROID_CHROME) {
            logger.error('Failed: User agent data not fetched');
            return false;
        }
        
        const fingerprint = getOriginFingerprint();
        
        // Check if navigator properties were spoofed
        let navigatorSpoofed = true;
        Object.keys(fingerprint).forEach(key => {
            if (key !== 'connection' && key !== 'sessionId' && key !== 'timestamp') {
                if (navigator[key] !== fingerprint[key]) {
                    logger.warn(`Navigator property ${key} not properly spoofed. Expected: ${fingerprint[key]}, Got: ${navigator[key]}`);
                    navigatorSpoofed = false;
                }
            }
        });
        
        // Check if connection properties were spoofed
        let connectionSpoofed = true;
        if (fingerprint.connection && navigator.connection) {
            Object.keys(fingerprint.connection).forEach(key => {
                if (navigator.connection[key] !== fingerprint.connection[key]) {
                    logger.warn(`Connection property ${key} not properly spoofed. Expected: ${fingerprint.connection[key]}, Got: ${navigator.connection[key]}`);
                    connectionSpoofed = false;
                }
            });
        }
        
        // Check if userAgentData was spoofed (if available in browser)
        let userAgentDataSpoofed = true;
        if ('userAgentData' in navigator) {
            if (!navigator.userAgentData || 
                !navigator.userAgentData.brands || 
                !navigator.userAgentData.mobile) {
                logger.error('Failed: User agent data not properly spoofed');
                userAgentDataSpoofed = false;
            }
        }
        
        return navigatorSpoofed && connectionSpoofed && userAgentDataSpoofed;
    }

    // ==================== PERFORMANCE MONITORING ====================
    const performanceMonitor = {
        startTime: Date.now(),
        measures: {},
        mark: (name) => {
            performanceMonitor.measures[name] = Date.now();
        },
        measure: (name, startMark) => {
            const end = performanceMonitor.measures[name] || Date.now();
            const start = performanceMonitor.measures[startMark] || performanceMonitor.startTime;
            return end - start;
        }
    };

    // ==================== MAIN ENTRYPOINT ====================
    (async () => {
        performanceMonitor.mark('start');
        
        try {
            const result = await fetchAndParseUA();
            if (!result) {
                logger.warn('Could not initialize due to missing UA');
                return;
            }
            
            USER_AGENT_DATA = result.userAgentData;
            NAVIGATOR_PROFILES.ANDROID_CHROME = result.navigatorProfile;

            // Generate initial fingerprint
            const origin = location.origin;
            const initialFp = generateSessionFingerprint();
            originsData.set(origin, initialFp);
            sessionState.lastRotation = Date.now();

            performanceMonitor.mark('uaFetched');
            
            const stealthApplied = initializeStealth();
            performanceMonitor.mark('stealthInitialized');
            
            // Check if stealth was successfully applied
            if (stealthApplied && checkStealthApplied()) {
                sessionState.initialized = true;
                logger.info('Success: User agent fetched and all stealth techniques applied');
                logger.info('User Agent:', navigator.userAgent);
                logger.info('Platform:', navigator.platform);
                logger.info('Hardware Concurrency:', navigator.hardwareConcurrency);
                
                // Performance metrics
                const totalTime = performanceMonitor.measure('total', 'start');
                const fetchTime = performanceMonitor.measure('uaFetch', 'start');
                const initTime = performanceMonitor.measure('stealthInit', 'uaFetched');
                
                logger.debug(`Performance - Total: ${totalTime}ms, UA Fetch: ${fetchTime}ms, Stealth Init: ${initTime}ms`);
            } else {
                logger.error('Failed: Stealth techniques not properly applied');
            }
            
            scheduleFingerprintRotation();

            // SPA/navigation hooks
            const reinit = () => {
                if (USER_AGENT_DATA) {
                    initializeStealth();
                }
            };
            const origPush = history.pushState;
            const origReplace = history.replaceState;

            history.pushState = function (...args) {
                const res = origPush.apply(this, args);
                setTimeout(reinit, 50);
                return res;
            };
            history.replaceState = function (...args) {
                const res = origReplace.apply(this, args);
                setTimeout(reinit, 50);
                return res;
            };
            window.addEventListener('popstate', () => {
                setTimeout(reinit, 50);
            });
            
            // Export for external access if needed
            window.__stealth = {
                version: '1.0.0',
                config: CONFIG,
                status: sessionState.initialized ? 'active' : 'failed',
                getFingerprint: getOriginFingerprint,
                reinitialize: () => {
                    originsData.clear();
                    initializeStealth();
                }
            };
            
        } catch (error) {
            logger.error('Initialization failed completely:', error);
        }
    })();

})();