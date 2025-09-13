(() => {
    'use strict';

    // ==================== ENTERPRISE CONFIGURATION ====================
    const CONFIG = {
        SESSION_TTL_MINUTES: 3,
        ROTATION_INTERVAL_MINUTES: 120,
        JITTER_PERCENTAGE: 0.1,
        DEBUG: false
    };

    // ==================== USER AGENT DATA CONFIGURATION ====================
    const USER_AGENT_DATA = {
        brands: [
            { brand: "Not-A.Brand", version: "99" },
            { brand: "Google Chrome", version: "119" },
            { brand: "Chromium", version: "119" }
        ],
        // mobile should always be true — we'll enforce it everywhere
        mobile: true,
        platform: "Android",
        platformVersion: "13.0.0",
        architecture: "arm",
        model: "SM-G991B",
        uaFullVersion: "119.0.6045.163"
    };

    // ==================== NAVIGATOR SPOOFING PROFILES ====================
    const NAVIGATOR_PROFILES = {
        ANDROID_CHROME: {
            userAgent: "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.163 Mobile Safari/537.36",
            appVersion: "5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.163 Mobile Safari/537.36",
            platform: "Linux armv8l",
            vendor: "Google Inc.",
            vendorSub: "",
            product: "Gecko",
            productSub: "20030107",
            appName: "Netscape",
            appCodeName: "Mozilla",
            language: "en-NG",
            languages: ["en-NG", "en"],
            hardwareConcurrency: 8,
            deviceMemory: 8,
            maxTouchPoints: 10,
            pdfViewerEnabled: true,
            webdriver: false,
            doNotTrack: null,
            cookieEnabled: true,
            onLine: true,
            connection: {
                effectiveType: "4g",
                rtt: 100,
                downlink: 5.5,
                saveData: false
            }
        }
    };

    // ==================== STORAGE & STATE MANAGEMENT ====================
    const originsData = new Map();
    const sessionState = {
        currentProfile: null,
        lastRotation: Date.now(),
        sessionStart: Date.now()
    };

    // ==================== UTILITY FUNCTIONS ====================
    const objectDefineProperty = Object.defineProperty;
    const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const objectGetPrototypeOf = Object.getPrototypeOf;
    const objectSetPrototypeOf = Object.setPrototypeOf;
    const mathRandom = Math.random;
    const mathFloor = Math.floor;

    const randomItem = arr => arr[mathFloor(mathRandom() * arr.length)];
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
        } catch (e) {
            if (CONFIG.DEBUG) console.warn('[Stealth] patchToString failed', e);
        }
    };

    const createDeepClone = (obj) => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (Array.isArray(obj)) return obj.map(createDeepClone);

        const cloned = {};
        Object.keys(obj).forEach(k => {
            cloned[k] = createDeepClone(obj[k]);
        });
        return cloned;
    };

    // ==================== FINGERPRINT MANAGEMENT ====================
    const generateSessionId = () => Math.random().toString(36).substring(2) + Date.now().toString(36);

    const generateSessionFingerprint = () => {
        const baseProfile = createDeepClone(NAVIGATOR_PROFILES.ANDROID_CHROME);

        // Add slight variations for realism
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

        if (!originsData.has(origin) ||
            (now - originsData.get(origin).timestamp > CONFIG.SESSION_TTL_MINUTES * 60 * 1000)) {

            const newFingerprint = generateSessionFingerprint();
            originsData.set(origin, newFingerprint);

            if (CONFIG.DEBUG) {
                console.log('[Stealth] New fingerprint generated for origin:', origin);
            }
        }

        return originsData.get(origin);
    };

    // ==================== ADVANCED PATCHING TECHNIQUES ====================
    const stealthDefine = (obj, prop, value, options = {}) => {
        try {
            const descriptor = objectGetOwnPropertyDescriptor(obj, prop);
            if (descriptor && descriptor.configurable === false) return false;

            // if value is a function, ensure its toString is patched
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
            if (CONFIG.DEBUG) {
                console.warn('[Stealth] Failed to define property:', prop, e);
            }
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
            if (CONFIG.DEBUG) console.warn('[Stealth] Failed to define data property:', prop, e);
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
                    // try to go deeper if targetObj[key] exists
                    if (targetObj[key] !== undefined && targetObj[key] !== null) {
                        stealthObject(targetObj[key], v, fullKey);
                    } else {
                        // create a readonly property that holds the object (best-effort)
                        stealthDefine(targetObj, key, v);
                    }
                } else {
                    stealthDefine(targetObj, key, v);
                }
            } catch (e) {
                if (CONFIG.DEBUG) {
                    console.warn('[Stealth] Failed to spoof:', fullKey, e);
                }
            }
        });
    };

    // ==================== ROBUST userAgentData SPOOF ====================
    const makeFakeUserAgentData = (base = USER_AGENT_DATA) => {
        // Create a lightweight class to produce an object with prototype and instance properties.
        function FakeUAData() {}
        // Create the prototype methods and properties we want to emulate
        FakeUAData.prototype.getHighEntropyValues = function(hints) {
            return Promise.resolve().then(() => {
                const result = {};
                if (!Array.isArray(hints)) hints = [];

                hints.forEach(hint => {
                    switch (hint) {
                        case 'formFactor':
                            // formFactor values typically: 'mobile', 'desktop', 'tablet'
                            result.formFactor = 'mobile';
                            break;
                        case 'architecture':
                            result.architecture = base.architecture;
                            break;
                        case 'bitness':
                            result.bitness = '64';
                            break;
                        case 'model':
                            result.model = base.model;
                            break;
                        case 'platformVersion':
                            result.platformVersion = base.platformVersion;
                            break;
                        case 'uaFullVersion':
                            result.uaFullVersion = base.uaFullVersion;
                            break;
                        case 'fullVersionList':
                            result.fullVersionList = base.brands.map(b => ({brand: b.brand, version: b.version}));
                            break;
                        default:
                            // unknown hints are ignored for safety
                            break;
                    }
                });

                // Always include mobile=true guarantee for high-entropy calls that might omit it
                result.mobile = true;
                return result;
            });
        };

        // Patch toString for the function on the prototype
        patchToString(FakeUAData.prototype.getHighEntropyValues, FakeUAData.prototype.getHighEntropyValues, 'getHighEntropyValues');

        // Create an instance that will be used as navigator.userAgentData
        const instance = new FakeUAData();

        // Provide the "brands", "mobile", "platform" and "toJSON" as data properties on the instance (so destructuring reads stable values)
        stealthDefineDataProp(instance, 'brands', base.brands.map(b => ({brand: b.brand, version: b.version})), {writable: false, enumerable: false, configurable: false});
        stealthDefineDataProp(instance, 'mobile', true, {writable: false, enumerable: false, configurable: false}); // GUARANTEE this is always true
        stealthDefineDataProp(instance, 'platform', base.platform, {writable: false, enumerable: false, configurable: false});

        // toJSON should return the expected shape
        const fakeToJSON = function() {
            return {
                brands: this.brands,
                mobile: this.mobile,
                platform: this.platform
            };
        };
        patchToString(fakeToJSON, fakeToJSON, 'toJSON');
        stealthDefineDataProp(instance, 'toJSON', fakeToJSON, {writable: false, enumerable: false, configurable: false});

        // make instance prototype chain look plausible - set __proto__ to the native prototype where possible
        try {
            const nativeProto = navigator.userAgentData && Object.getPrototypeOf(navigator.userAgentData);
            if (nativeProto) {
                objectSetPrototypeOf(FakeUAData.prototype, nativeProto);
                objectSetPrototypeOf(instance, FakeUAData.prototype);
            }
        } catch (e) {
            if (CONFIG.DEBUG) console.warn('[Stealth] Could not set prototype chain for FakeUAData', e);
        }

        // Freeze instance to prevent script tampering
        try { Object.freeze(instance); } catch (e) {}

        return instance;
    };

    const spoofUserAgentData = () => {
        try {
            // If navigator.userAgentData is absent, bail out (older browsers)
            if (!('userAgentData' in navigator)) return;

            const fakeUA = makeFakeUserAgentData(USER_AGENT_DATA);

            // Place the fake object on navigator (own property) — many scripts will access navigator.userAgentData directly
            try {
                // Replace property on navigator itself with a getter that returns the frozen fake object
                objectDefineProperty(navigator, 'userAgentData', {
                    get: () => fakeUA,
                    configurable: true,
                    enumerable: false
                });
            } catch (e) {
                if (CONFIG.DEBUG) console.warn('[Stealth] Failed to define navigator.userAgentData directly', e);
            }

            // Also attempt to patch the prototype (defense-in-depth) so accesses from frames or clones see same shape
            try {
                const uaProto = Object.getPrototypeOf(navigator.userAgentData) || {};
                // Define brand/mobile/platform getters on that prototype as extra insurance
                stealthDefine(uaProto, 'brands', fakeUA.brands);
                stealthDefine(uaProto, 'mobile', true); // Force mobile true on prototype too
                stealthDefine(uaProto, 'platform', fakeUA.platform);
                // Patch getHighEntropyValues on prototype (ensures calls via prototype work)
                if (typeof fakeUA.getHighEntropyValues === 'function') {
                    stealthDefine(uaProto, 'getHighEntropyValues', fakeUA.getHighEntropyValues);
                }
                // patch toJSON on prototype as well
                stealthDefine(uaProto, 'toJSON', fakeUA.toJSON);
            } catch (e) {
                if (CONFIG.DEBUG) console.warn('[Stealth] Failed to patch userAgentData prototype', e);
            }

            // Ensure direct navigator.userAgent still matches profile (defense-in-depth)
            try {
                stealthDefine(navigator, 'userAgent', NAVIGATOR_PROFILES.ANDROID_CHROME.userAgent, {configurable: true, enumerable: false});
            } catch (e) {
                if (CONFIG.DEBUG) console.warn('[Stealth] Failed to override navigator.userAgent', e);
            }
        } catch (e) {
            if (CONFIG.DEBUG) console.warn('[Stealth] spoofUserAgentData error', e);
        }
    };

    // ==================== NAVIGATOR SPOOFING (restored and improved) ====================
    const spoofNavigator = () => {
        try {
            const fingerprint = getOriginFingerprint();
            const navigatorProto = objectGetPrototypeOf(navigator);

            if (!navigatorProto) return;

            // Spoof regular navigator properties (defense-in-depth)
            stealthObject(navigatorProto, fingerprint);

            // Special handling for connection object
            if (fingerprint.connection && navigator.connection) {
                const connectionProto = objectGetPrototypeOf(navigator.connection);
                if (connectionProto) {
                    stealthObject(connectionProto, fingerprint.connection);
                }
            }

            // Patch navigator.toString()
            try {
                if (typeof navigatorProto.toString === 'function') {
                    const originalToString = navigatorProto.toString;
                    const fakeToString = function() { return "[object Navigator]"; };
                    patchToString(originalToString, fakeToString, 'toString');
                    stealthDefine(navigatorProto, 'toString', fakeToString);
                }
            } catch (e) {
                if (CONFIG.DEBUG) console.warn('[Stealth] navigator toString patch failed', e);
            }
        } catch (e) {
            if (CONFIG.DEBUG) console.warn('[Stealth] spoofNavigator error', e);
        }
    };

    // ==================== IFRAME PROTECTION ====================
    const protectIframes = () => {
        try {
            if (!window.HTMLIFrameElement) return;

            const iframeProto = window.HTMLIFrameElement.prototype;
            const cd = objectGetOwnPropertyDescriptor(iframeProto, 'contentWindow');
            const originalContentWindowGetter = cd && cd.get;

            if (typeof originalContentWindowGetter === 'function') {
                const protectedContentWindowGetter = function() {
                    const win = originalContentWindowGetter.call(this);

                    if (win && win.navigator) {
                        try {
                            // For each iframe, re-apply the UA spoofing and navigator spoofing
                            const fingerprint = getOriginFingerprint();
                            const iframeNavProto = objectGetPrototypeOf(win.navigator);

                            if (iframeNavProto) {
                                stealthObject(iframeNavProto, fingerprint);
                            }

                            // Ensure iframe's userAgentData is patched (defense-in-depth)
                            try {
                                if ('userAgentData' in win.navigator) {
                                    // attempt to create a fake per-frame userAgentData instance cached on that window
                                    const fake = makeFakeUserAgentData(USER_AGENT_DATA);
                                    try {
                                        objectDefineProperty(win.navigator, 'userAgentData', {
                                            get: () => fake,
                                            configurable: true,
                                            enumerable: false
                                        });
                                    } catch (inner) {
                                        // fallback - patch prototype
                                        stealthDefine(objectGetPrototypeOf(win.navigator), 'mobile', true);
                                    }
                                }
                            } catch (innerErr) {
                                if (CONFIG.DEBUG) console.warn('[Stealth] iframe userAgentData patch failed', innerErr);
                            }
                        } catch (e) {
                            if (CONFIG.DEBUG) {
                                console.warn('[Stealth] Failed to protect iframe navigator:', e);
                            }
                        }
                    }

                    return win;
                };

                patchToString(originalContentWindowGetter, protectedContentWindowGetter, 'get');
                objectDefineProperty(iframeProto, 'contentWindow', {
                    get: protectedContentWindowGetter,
                    enumerable: true,
                    configurable: true
                });
            }
        } catch (e) {
            if (CONFIG.DEBUG) console.warn('[Stealth] protectIframes error', e);
        }
    };

    // ==================== DETECTION COUNTERMEASURES ====================
    const installCountermeasures = () => {
        try {
            const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

            // Replace Object.getOwnPropertyDescriptor with a guarded wrapper
            objectDefineProperty(Object, 'getOwnPropertyDescriptor', {
                value: function(obj, prop) {
                    // call the original to get descriptor
                    const result = originalGetOwnPropertyDescriptor.call(Object, obj, prop);

                    try {
                        if (result && typeof result.get === 'function') {
                            const s = result.get.toString();
                            // conservative check: if getter's toString contains our marker, return safe descriptor
                            if (s.includes('stealth') || s.includes('getHighEntropyValues') || s.includes('protectedContentWindowGetter')) {
                                // return a safe, non-getter descriptor that exposes the value
                                let val;
                                try {
                                    val = result.get.call(obj);
                                } catch (inner) {
                                    val = undefined;
                                }
                                return {
                                    value: val,
                                    writable: false,
                                    enumerable: result.enumerable,
                                    configurable: result.configurable
                                };
                            }
                        }
                    } catch (e) {
                        // swallow errors - fallback to original descriptor
                    }

                    return result;
                },
                configurable: true,
                writable: true,
                enumerable: false
            });

            if (CONFIG.DEBUG) console.log('[Stealth] Countermeasures installed.');
        } catch (e) {
            if (CONFIG.DEBUG) console.warn('[Stealth] installCountermeasures failed', e);
        }
    };

    // ==================== INITIALIZATION ====================
    const initializeStealth = () => {
        try {
            // Install countermeasures first
            installCountermeasures();

            // Apply spoofing
            spoofNavigator();
            spoofUserAgentData();
            protectIframes();

            // Freeze configuration objects to prevent tampering
            try { Object.freeze(USER_AGENT_DATA); } catch (e) {}
            try { Object.freeze(NAVIGATOR_PROFILES); } catch (e) {}
            try { Object.freeze(CONFIG); } catch (e) {}

            if (CONFIG.DEBUG) {
                console.log('[Stealth] Enterprise privacy protection initialized');
            }

        } catch (error) {
            if (CONFIG.DEBUG) {
                console.error('[Stealth] Initialization failed:', error);
            }
        }
    };

    // ==================== EXECUTION ====================
    // Wait for DOM to be ready for iframe protection
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeStealth);
    } else {
        initializeStealth();
    }

    // Re-apply protection on page navigation (SPA support)
    (function() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function(...args) {
            const result = originalPushState.apply(this, args);
            try { setTimeout(initializeStealth, 50); } catch (e) {}
            return result;
        };

        history.replaceState = function(...args) {
            const result = originalReplaceState.apply(this, args);
            try { setTimeout(initializeStealth, 50); } catch (e) {}
            return result;
        };

        window.addEventListener('popstate', () => {
            try { setTimeout(initializeStealth, 50); } catch (e) {}
        });
    })();

})();
