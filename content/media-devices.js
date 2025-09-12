const mdScript = document.createElement('script');
mdScript.textContent = `

(function () {
  'use strict';

  /*
    Hardened, production-grade stealth replacement for navigator.mediaDevices.enumerateDevices()
    - Per-origin + per-tab deterministic seeds
    - Hook collision protection (wrap existing implementations safely)
    - OS-specific label pools
    - Robust timing, error emulation, and persistence with safe fallbacks
    - Per-function toString shadowing (minimizes global surface changes)
    - Non-destructive: tries not to break page behavior
  */

  /* ===========================
     CONFIG
     =========================== */
  const CONFIG = {
    MAX_DEVICES: 4,
    KIND_WEIGHTS: { audioinput: 0.5, videoinput: 0.35, audiooutput: 0.15 },
    STORAGE_KEY_PREFIX: '__mf_v5_devices_',
    SESSION_SEED_KEY: '__mf_v5_session_seed',
    TAB_SEED_KEY: '__mf_v5_tab_seed',
    TTL_MS: 30 * 60 * 1000,       // 30 minutes
    ERROR_PROBABILITY: 0.012,     // ~1.2%
    LONG_DELAY_PROB: 0.01,
    MAX_LONG_DELAY_MS: 2500,
    SPORADIC_LAG_PROB: 0.02
  };

  /* ===========================
     Safe storage helpers (sessionStorage fallback safe)
     - If sessionStorage is unavailable or throws, fall back to in-memory with an expiry
     =========================== */
  const _memStore = {};
  const safeSessionGet = (k) => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        return sessionStorage.getItem(k);
      }
    } catch (e) {}
    const ent = _memStore[k];
    if (!ent) return null;
    if (Date.now() > ent.__ts + CONFIG.TTL_MS) { delete _memStore[k]; return null; }
    return ent.value;
  };
  const safeSessionSet = (k, v) => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(k, v);
        return true;
      }
    } catch (e) {}
    _memStore[k] = { value: v, __ts: Date.now() };
    return false;
  };
  const safeSessionRemove = (k) => {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(k); } catch (e) { }
    delete _memStore[k];
  };

  /* ===========================
     Randomness & deterministic PRNGs
     =========================== */
  const safeCryptoRandomUint32 = () => {
    try {
      return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    } catch (e) {
      return Math.floor(Math.random() * 0x100000000) >>> 0;
    }
  };

  // Mulberry32
  const mulberry32 = (seed) => {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };

  // FNV-1a 32 bit for stable origin hashing
  const fnv1a32 = (str) => {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };

  const getOrCreateSessionSeed = () => {
    try {
      let hex = safeSessionGet(CONFIG.SESSION_SEED_KEY);
      if (!hex) {
        const a = safeCryptoRandomUint32();
        const b = safeCryptoRandomUint32();
        hex = a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
        safeSessionSet(CONFIG.SESSION_SEED_KEY, hex);
      }
      return (parseInt(hex.slice(0, 8), 16) ^ parseInt(hex.slice(8, 16), 16)) >>> 0;
    } catch (e) {
      return safeCryptoRandomUint32();
    }
  };

  const getOrCreateTabSeed = () => {
    try {
      // sessionStorage is per-tab in most browsers; fall back to memory if blocked
      let hex = safeSessionGet(CONFIG.TAB_SEED_KEY + '_' + (typeof location !== 'undefined' ? location.origin : 'null'));
      if (!hex) {
        const v = safeCryptoRandomUint32();
        hex = v.toString(16).padStart(8, '0');
        // store per-tab seed - not shared across tabs if sessionStorage is real
        safeSessionSet(CONFIG.TAB_SEED_KEY + '_' + (typeof location !== 'undefined' ? location.origin : 'null'), hex);
      }
      return parseInt(hex.slice(0, 8), 16) >>> 0;
    } catch (e) {
      return safeCryptoRandomUint32();
    }
  };

  const sessionSeed = getOrCreateSessionSeed();
  const tabSeed = getOrCreateTabSeed();
  const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : 'null://';
  const originHash = fnv1a32(origin);
  const perContextSeed = (sessionSeed ^ originHash ^ tabSeed) >>> 0;

  const prng = mulberry32(perContextSeed);
  const sessionPrng = mulberry32(sessionSeed);

  const dFloat = () => prng();
  const ndFloat = () => sessionPrng();
  const dInt = (min, max) => Math.floor(dFloat() * (max - min + 1)) + min;
  const ndInt = (min, max) => Math.floor(ndFloat() * (max - min + 1)) + min;
  const dChoice = (arr) => arr[Math.floor(dFloat() * arr.length)];
  const ndChoice = (arr) => arr[Math.floor(ndFloat() * arr.length)];

  const stableId = (prefix = '') => {
    const a = Math.floor(dFloat() * 0x100000000) >>> 0;
    const b = Math.floor(dFloat() * 0x100000000) >>> 0;
    const c = Math.floor(dFloat() * 0x100000000) >>> 0;
    return prefix + a.toString(16).padStart(8, '0') + '-' + b.toString(16).padStart(8, '0') + '-' + c.toString(16).slice(0, 6);
  };

  /* ===========================
     Platform detection & OS-specific label pools
     =========================== */
  const UA = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  const platform = (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent || '')).toLowerCase();

  const detectOS = () => {
    if (/windows|win32|win64|wow32|wow64/.test(platform) || /windows/.test(UA)) return 'windows';
    if (/mac|macintel|macppc|mac68k/.test(platform) || /macintosh/.test(UA)) return 'macos';
    if (/linux|x11/.test(platform)) return 'linux';
    if (/android/.test(UA)) return 'android';
    if (/iphone|ipad|ipod/.test(UA)) return 'ios';
    return 'unknown';
  };
  const OS = detectOS();

  const micNames = {
    windows: ['Microphone (Realtek(R) Audio)', 'Microphone Array (Realtek(R) Audio)', 'USB Microphone', 'Stereo Mix', 'Virtual Audio Device'],
    macos: ['MacBook Microphone', 'Internal Microphone', 'USB Audio Device', 'Aggregate Device'],
    linux: ['Built-in Audio Analog Stereo', 'USB Audio', 'PulseAudio Sound Server', 'ALSA: USB Audio'],
    android: ['Internal Microphone', 'External Mic', 'USB Microphone'],
    ios: ['iPhone Microphone', 'Internal Microphone'],
    unknown: ['Internal Microphone', 'External Microphone']
  };

  const camNames = {
    windows: ['Integrated Webcam', 'HD Webcam', 'USB Camera', 'Logitech HD Webcam C270', 'Microsoft LifeCam'],
    macos: ['FaceTime HD Camera', 'Built-in iSight', 'USB Camera'],
    linux: ['Webcam', 'USB Camera', 'UVC Camera'],
    android: ['Front Camera', 'Back Camera'],
    ios: ['Front Camera', 'Back Camera'],
    unknown: ['Integrated Webcam', 'USB Camera']
  };

  const spkNames = {
    windows: ['Speakers (Realtek(R) Audio)', 'Headphones', 'HDMI Output', 'USB Audio Device'],
    macos: ['Internal Speakers', 'Headphones', 'AirPlay Output'],
    linux: ['Built-in Audio Analog Stereo', 'HDMI / DisplayPort Output', 'USB Audio'],
    android: ['Phone Speaker', 'Bluetooth Headphones'],
    ios: ['iPhone Speaker', 'AirPods'],
    unknown: ['Internal Speaker', 'External Headphones']
  };

  const labelQuirks = (label, kind) => {
    let out = String(label || '');
    // inject manufacturer fragments or small suffixes deterministically
    if (dFloat() < 0.12) out += ' (' + stableId('mfg').slice(0, 3).toUpperCase() + ')';
    if (dFloat() < 0.06) out = out.replace(/\bCamera\b/i, 'Cam').replace(/\bWebcam\b/i, 'Camera');
    if (dFloat() < 0.03 && kind === 'audioinput') out = out + ' (Plug-in)';
    // small capitalization quirks
    if (dFloat() < 0.05) out = out.replace(/\b([a-z]{2,})\b/ig, (m) => (m.length <= 3 ? m.toUpperCase() : m));
    return out;
  };

  const randomDeviceLabel = (kind) => {
    if (kind === 'audioinput') return labelQuirks(dChoice(micNames[OS] || micNames.unknown), kind);
    if (kind === 'videoinput') return labelQuirks(dChoice(camNames[OS] || camNames.unknown), kind);
    return labelQuirks(dChoice(spkNames[OS] || spkNames.unknown), kind);
  };

  /* ===========================
     MediaDeviceInfo shim + creation
     - Create objects that closely match native shapes, anti-bridge checks
     =========================== */
  const NativeMediaDeviceInfo = (typeof window !== 'undefined' && window.MediaDeviceInfo) || null;

  const FakeMediaDeviceInfo = function MediaDeviceInfo() {
    // throw like native
    throw new TypeError('Illegal constructor');
  };

  try {
    if (NativeMediaDeviceInfo && NativeMediaDeviceInfo.prototype) {
      FakeMediaDeviceInfo.prototype = NativeMediaDeviceInfo.prototype;
    } else {
      Object.defineProperty(FakeMediaDeviceInfo.prototype, Symbol.toStringTag, {
        value: 'MediaDeviceInfo', configurable: false, enumerable: false, writable: false
      });
    }
  } catch (e) { /* silent */ }

  const makeDevice = ({ deviceId, kind, label = '', groupId }) => {
    const obj = Object.create(FakeMediaDeviceInfo.prototype);
    const define = (name, value, opts = {}) => {
      try {
        Object.defineProperty(obj, name, {
          value: value,
          writable: !!opts.writable,
          enumerable: !!opts.enumerable,
          configurable: !!opts.configurable
        });
      } catch (e) {
        try { obj[name] = value; } catch (e2) { /* silent */ }
      }
    };
    define('deviceId', String(deviceId), { writable: false, enumerable: true, configurable: false });
    define('kind', String(kind), { writable: false, enumerable: true, configurable: false });
    define('label', String(label), { writable: false, enumerable: true, configurable: false });
    define('groupId', String(groupId), { writable: false, enumerable: true, configurable: false });
    try {
      Object.defineProperty(obj, 'constructor', { value: FakeMediaDeviceInfo, writable: false, enumerable: false, configurable: false });
    } catch (e) { /* silent */ }
    return obj;
  };

  /* ===========================
     Persistence with TTL: read / write / expire
     - Store a canonical raw representation (not objects)
     =========================== */
  const originKey = CONFIG.STORAGE_KEY_PREFIX + originHash.toString(16).padStart(8, '0');

  const readPersisted = () => {
    try {
      const raw = safeSessionGet(originKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const ts = parsed.__ts || 0;
      if (Date.now() - ts > CONFIG.TTL_MS) {
        safeSessionRemove(originKey);
        return null;
      }
      return parsed.devices || null;
    } catch (e) {
      return null;
    }
  };

  const persistDevices = (devices) => {
    try {
      const payload = { __ts: Date.now(), devices };
      safeSessionSet(originKey, JSON.stringify(payload));
    } catch (e) { /* silent */ }
  };

  /* ===========================
     Permission checks (tolerant)
     =========================== */
  const checkPermissions = async () => {
    const result = { audio: false, video: false };
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return result;
    const tryQuery = async (name) => {
      try { return await navigator.permissions.query({ name }); } catch (e) { return null; }
    };
    try {
      const settled = await Promise.allSettled([tryQuery('microphone'), tryQuery('camera')]);
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value && typeof r.value.state === 'string') {
          const nm = r.value.name || '';
          if (nm === 'microphone' && r.value.state === 'granted') result.audio = true;
          if (nm === 'camera' && r.value.state === 'granted') result.video = true;
        }
      }
    } catch (e) { /* silent */ }
    return result;
  };

  /* ===========================
     Timing realism utilities
     =========================== */
  const baseDelayDistribution = () => {
    const p = dFloat();
    if (p < 0.14) return dInt(0, 10);
    if (p < 0.86) return dInt(20, 240);
    return dInt(240, 600);
  };

  const microVariation = (deviceCount) => {
    const micro = Math.floor((dFloat() * 6) + (deviceCount * (dFloat() * 4)));
    return micro + ndInt(0, 6);
  };

  const realisticDelay = (deviceCount) => {
    let delay = baseDelayDistribution() + microVariation(deviceCount);
    if (ndFloat() < CONFIG.SPORADIC_LAG_PROB) delay += ndInt(20, 160);
    if (ndFloat() < CONFIG.LONG_DELAY_PROB) delay += ndInt(350, CONFIG.MAX_LONG_DELAY_MS);
    if (ndFloat() < 0.004) delay += ndInt(500, 2500);
    return delay;
  };

  /* ===========================
     Error emulation (native-like)
     - Use DOMException where available
     - Provide name/message similar to browser errors
     =========================== */
  const makeDOMExceptionLike = (name, message) => {
    try {
      if (typeof DOMException === 'function') {
        // Some browsers have DOMException constructors that accept (message, name)
        try { return new DOMException(String(message || ''), String(name)); } catch (e) {
          // older signature fallback
          const ex = new Error(String(message || ''));
          ex.name = String(name);
          return ex;
        }
      }
    } catch (e) { /* fallback below */ }
    const ex = new Error(String(message || ''));
    ex.name = String(name);
    try {
      Object.defineProperty(ex, 'toString', {
        configurable: true, enumerable: false, writable: false,
        value: function () { return \`\${this.name}: \${this.message}\`; }
      });
    } catch (e) { /* silent */ }
    return ex;
  };

  const maybeThrowError = (perm) => {
    if (ndFloat() >= CONFIG.ERROR_PROBABILITY) return null;
    // If no permissions at all -> NotAllowedError resembles user denial
    if (!perm.audio && !perm.video) {
      return makeDOMExceptionLike('NotAllowedError', 'Permission denied by user agent');
    }
    // If one kind missing -> NotFoundError
    if (!perm.audio && perm.video) return makeDOMExceptionLike('NotFoundError', 'No audio capture devices found');
    if (!perm.video && perm.audio) return makeDOMExceptionLike('NotFoundError', 'No video capture devices found');
    // Otherwise rare hardware glitches
    const choices = ['NotReadableError', 'AbortError', 'UnknownError'];
    return makeDOMExceptionLike(dChoice(choices), 'Hardware or I/O error occurred');
  };

  /* ===========================
     Deterministic device generation
     =========================== */
  const weightedKind = () => {
    const entries = Object.entries(CONFIG.KIND_WEIGHTS);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = dFloat() * total;
    for (const [k, w] of entries) {
      if (r < w) return k;
      r -= w;
    }
    return 'audioinput';
  };

  const deviceKindsOrder = () => {
    const UA = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const isChromeLike = /Chrome|Chromium|CriOS/.test(UA) && !/Edg\\//.test(UA);
    const isFirefoxLike = /Firefox/.test(UA);
    const isSafariLike = /Safari/.test(UA) && !/Chrome/.test(UA);
    if (isChromeLike) return ['audioinput', 'audiooutput', 'videoinput'];
    if (isFirefoxLike) return ['videoinput', 'audioinput', 'audiooutput'];
    if (isSafariLike) return ['audioinput', 'videoinput', 'audiooutput'];
    const base = ['audioinput', 'videoinput', 'audiooutput'];
    for (let i = base.length - 1; i > 0; i--) {
      const j = perContextSeed % (i + 1);
      [base[i], base[j]] = [base[j], base[i]];
    }
    return base;
  };

  const generateDevicesRaw = (perm) => {
    const kinds = deviceKindsOrder();
    const devices = [];
    const groupMap = {};
    for (const kind of kinds) {
      const weight = CONFIG.KIND_WEIGHTS[kind] || 0.2;
      const baseProb = dFloat();
      const count = (baseProb < weight) ? dInt(1, CONFIG.MAX_DEVICES) : (dFloat() < 0.12 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const id = stableId(kind[0] + '-');
        const manufacturer = Math.floor(dFloat() * 6);
        const gid = groupMap[manufacturer] || (groupMap[manufacturer] = stableId('g-'));
        const label = ((kind === 'audioinput' && perm.audio) || (kind === 'videoinput' && perm.video) || (kind === 'audiooutput')) ? randomDeviceLabel(kind) : '';
        devices.push({ deviceId: id, kind, label, groupId: gid });
      }
    }
    if (!devices.some(d => d.kind === 'audioinput')) {
      const id = stableId('dev-');
      devices.push({ deviceId: id, kind: 'audioinput', label: (perm.audio ? randomDeviceLabel('audioinput') : ''), groupId: stableId('g-') });
    }
    return devices;
  };

  const getDeterministicDeviceObjects = (perm) => {
    const stored = readPersisted();
    if (stored && Array.isArray(stored) && stored.length) {
      return stored.map(d => makeDevice({
        deviceId: d.deviceId,
        kind: d.kind,
        label: ((d.kind === 'audioinput' && perm.audio) || (d.kind === 'videoinput' && perm.video) || (d.kind === 'audiooutput')) ? (d.label || randomDeviceLabel(d.kind)) : '',
        groupId: d.groupId
      }));
    }
    const created = generateDevicesRaw(perm);
    try { persistDevices(created); } catch (e) {}
    return created.map(d => makeDevice(d));
  };

  /* ===========================
     toString shadowing (per-function)
     - We create a WeakMap for functions we wrap and a single patched Function.prototype.toString
     - The patched toString consults the WeakMap and otherwise calls the original toString
     =========================== */
  const originalFunctionToString = (typeof Function !== 'undefined' && Function.prototype && Function.prototype.toString) ? Function.prototype.toString : function () { return 'function () { [native code] }'; };
  const stealthFnMap = new WeakMap();

  const makeNativeLikeString = (name) => {
    name = typeof name === 'string' ? name : '';
    if (name && !/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(name)) {
      name = name.replace(/[^\\w$]/g, '');
    }
    return 'function ' + (name || '') + '() { [native code] }';
  };

  (function patchFunctionToStringOnce() {
    try {
      if (typeof Function === 'undefined' || typeof Function.prototype.toString !== 'function') return;
      const orig = originalFunctionToString;
      const wrapper = function () {
        try {
          // If function instance is in our stealth map -> return native-like
          if (stealthFnMap.has(this)) {
            const nm = stealthFnMap.get(this) || '';
            return makeNativeLikeString(nm);
          }
          // Otherwise delegate to original (handle cases where this has its own toString)
          return orig.call(this);
        } catch (e) {
          try { return orig.call(this); } catch (e2) { return makeNativeLikeString(''); }
        }
      };
      try {
        Object.defineProperty(Function.prototype, 'toString', {
          configurable: true,
          enumerable: false,
          writable: true,
          value: wrapper
        });
      } catch (e) {
        try { Function.prototype.toString = wrapper; } catch (e2) { /* silent */ }
      }
    } catch (e) { /* silent */ }
  })();

  const markStealthFn = (fn, name) => {
    try {
      stealthFnMap.set(fn, String(name || ''));
      try {
        Object.defineProperty(fn, 'toString', {
          configurable: true,
          enumerable: false,
          writable: false,
          value: () => makeNativeLikeString(name)
        });
      } catch (e) { /* silent */ }
    } catch (e) { /* silent */ }
  };

  /* ===========================
     Clone descriptor helper (tries to preserve descriptors)
     =========================== */
  const cloneFunctionDescriptor = (target, prop, replacement) => {
    try {
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      if (desc) {
        Object.defineProperty(target, prop, {
          configurable: desc.configurable,
          enumerable: desc.enumerable,
          writable: desc.writable === true,
          value: replacement
        });
        return true;
      }
    } catch (e) {}
    try {
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: replacement
      });
      return true;
    } catch (e) {
      try { target[prop] = replacement; return true; } catch (e2) { return false; }
    }
  };

  /* ===========================
     Safe wrapper installation with collision protection
     - If existing function was modified, we wrap it but preserve its behavior
     - If original is native, we still wrap and keep a reference to call it
     =========================== */
  const installStealthEnumerate = (targetObj, propName = 'enumerateDevices') => {
    try {
      const origDesc = Object.getOwnPropertyDescriptor(targetObj, propName);
      const originalFn = (origDesc && typeof origDesc.value === 'function') ? origDesc.value : (typeof targetObj[propName] === 'function' ? targetObj[propName] : null);

      // Build our stealth function (async)
      const stealthFn = async function stealthEnumerateDevices(...args) {
        // Ensure not to break if page passes unusual context
        const perm = await (typeof checkPermissions === 'function' ? checkPermissions() : Promise.resolve({ audio: false, video: false }));

        // Estimate count for delay
        let persistedRaw = null;
        try {
          const rawWrapper = safeSessionGet(originKey);
          if (rawWrapper) {
            const parsed = JSON.parse(rawWrapper);
            persistedRaw = Array.isArray(parsed && parsed.devices) ? parsed.devices : null;
          }
        } catch (e) { /* silent */ }

        const expectedCount = (persistedRaw && persistedRaw.length) ? persistedRaw.length : dInt(1, Math.max(1, CONFIG.MAX_DEVICES));
        let delay = realisticDelay(expectedCount);
        delay += ndInt(0, 10);
        if (ndFloat() < 0.005) delay += ndInt(200, 1000);

        await new Promise(res => setTimeout(res, delay));

        // Occasionally simulate real errors
        const err = maybeThrowError(perm);
        if (err) return Promise.reject(err);

        // If original exists and produces results, try to sanitize and reuse
        if (typeof originalFn === 'function') {
          try {
            // Call original with correct this (some old sites depend on binding)
            const nativeResult = await originalFn.apply(this, args);
            if (Array.isArray(nativeResult) && nativeResult.length > 0) {
              // sanitize entries and map into our shaped objects
              const list = nativeResult.map(d => {
                try {
                  const kind = d && d.kind || (d && d.label && /camera/i.test(d.label) ? 'videoinput' : 'audioinput');
                  const deviceId = (d && d.deviceId) ? d.deviceId : stableId('dev-');
                  const groupId = (d && d.groupId) ? d.groupId : stableId('g-');
                  const label = ((kind === 'audioinput' && perm.audio) || (kind === 'videoinput' && perm.video) || (kind === 'audiooutput')) ? (d.label || randomDeviceLabel(kind)) : '';
                  return makeDevice({ deviceId, kind, label, groupId });
                } catch (e) {
                  return makeDevice({ deviceId: stableId('dev-'), kind: weightedKind(), label: '', groupId: stableId('g-') });
                }
              });

              // ordering heuristics
              const UA = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
              const isChromeLike = /Chrome|Chromium|CriOS/.test(UA) && !/Edg\\//.test(UA);
              const isFirefoxLike = /Firefox/.test(UA);
              if (isChromeLike) {
                list.sort((a, b) => {
                  if (a.kind === b.kind) return 0;
                  if (a.kind === 'audioinput') return -1;
                  if (b.kind === 'audioinput') return 1;
                  return 0;
                });
              } else if (isFirefoxLike) {
                list.sort((a, b) => a.kind.localeCompare(b.kind));
              }

              // Persist sanitized canonical raw representation
              try {
                const raw = list.map(x => ({ deviceId: x.deviceId, kind: x.kind, label: x.label, groupId: x.groupId }));
                persistDevices(raw);
              } catch (e) { /* silent */ }

              return list;
            }
          } catch (nativeErr) {
            // swallow and fallback
          }
        }

        // Fallback deterministic generation
        return getDeterministicDeviceObjects(perm);
      };

      // Mark the stealth function for toString shadowing
      markStealthFn(stealthFn, propName);

      // Replace safely: preserve descriptor if configurable, otherwise attempt best-effort set
      try {
        if (origDesc && origDesc.configurable === false) {
          // Non-configurable original: attach a wrapper by replacing the function reference but keep descriptor flags
          try {
            // If originalFn exists, bind it to a safeName so we can call it from wrapper (collision protection)
            if (originalFn && typeof originalFn === 'function') {
              try { Object.defineProperty(stealthFn, '__original__', { value: originalFn, configurable: false, writable: false, enumerable: false }); } catch (e) { /* silent */ }
            }
            // attempt to set value where possible
            Object.defineProperty(targetObj, propName, {
              configurable: false,
              enumerable: origDesc.enumerable,
              writable: origDesc.writable === true,
              value: stealthFn
            });
          } catch (e) {
            // last resort: set property directly (may fail in strict environments)
            try { targetObj[propName] = stealthFn; } catch (e2) { /* silent */ }
          }
        } else {
          // Configurable or missing: set descriptor to non-enumerable, configurable true for safety
          cloneFunctionDescriptor(targetObj, propName, stealthFn);
        }
      } catch (e) {
        try { targetObj[propName] = stealthFn; } catch (e2) { /* silent */ }
      }

      // Expose a small non-enumerable reference to original if possible (for internal debugging only - not accessible via ordinary enumeration)
      try {
        if (originalFn && typeof originalFn === 'function') {
          try {
            Object.defineProperty(targetObj[propName], '__orig_native__', { value: originalFn, configurable: false, enumerable: false, writable: false });
          } catch (e) { /* silent */ }
        }
      } catch (e) { /* silent */ }

      // Mark the installed function itself too
      try { markStealthFn(targetObj[propName], propName); } catch (e) { /* silent */ }

    } catch (e) {
      // intolerant failure: do nothing to avoid breaking page
    }
  };

  /* ===========================
     Install on navigator.mediaDevices or navigator
     - Preference: navigator.mediaDevices.enumerateDevices
     - If neither available, attempt to create minimal mediaDevices object safely
     =========================== */
  try {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      installStealthEnumerate(navigator.mediaDevices, 'enumerateDevices');
    } else if (typeof navigator !== 'undefined' && typeof navigator.enumerateDevices === 'function') {
      installStealthEnumerate(navigator, 'enumerateDevices');
    } else if (typeof navigator !== 'undefined') {
      // minimal polyfill: create mediaDevices object if safe (avoid breaking)
      try {
        const md = navigator.mediaDevices || {};
        if (!md.enumerateDevices || typeof md.enumerateDevices !== 'function') {
          // define stable object with our implementation
          Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            enumerable: false,
            writable: true,
            value: md
          });
        }
        installStealthEnumerate(navigator.mediaDevices, 'enumerateDevices');
      } catch (e) { /* silent */ }
    }
  } catch (e) { /* silent */ }

  // End of IIFE
})();
`;

document.documentElement.appendChild(mdScript);
mdScript.remove();
