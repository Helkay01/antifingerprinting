
// stealth-merged.js
// Single-file merged production-grade stealth utilities
// - Per-origin isolation
// - Navigator spoofing
// - Canvas & media anti-fingerprinting
// - Timing noise (performance.now, Date.now)
// - Proxy & Reflect hardening
// - Dynamic stack trace / Function.prototype.toString spoofing
// Author: generated (adjust config below as needed)


// Create, inject, run, then remove the script (keeps same outer pattern you had)

// Stealth/fingerprint-mitigation script (production-hardened)
// Inserted as a string into a <script> element and appended to the document.
(function () {
  'use strict';

  // -----------------------------
  // CONFIGURATION (tune here)
  // -----------------------------
  const CFG = {
    originMarkerPrefix: '__stealth_installed@',
    timing: {
      enabled: true,
      jitterMaxMs: 3.5,    // small jitter for performance.now
      dateSkewMaxMs: 80    // ms skew for Date.now
    },
    navigator: {
      userAgent: null,
      platform: null,
      languages: null
    },
    canvas: {
      enabled: true,
      noiseClamp: 0.003,
      fuzzDataURL: true
    },
    stealthSymbol: Symbol.for('__stealth_hidden__'),
    debug: false
  };

  // -----------------------------
  // SHALLOW UTILITIES
  // -----------------------------
  const _ = {
    isObj: v => v && typeof v === 'object',
    isFn: v => typeof v === 'function',
    rand: (min, max) => Math.random() * (max - min) + min,
    randInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    gaussianNoise(scale = 1) { return (Math.random() + Math.random() + Math.random() - 1.5) * (scale / 1.5); },
    safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
  };

  // tryOr small helper
  function tryOr(originalFn, fallbackFn) {
    try { return originalFn(); } catch (e) { try { return fallbackFn(); } catch (e2) { return undefined; } }
  }

  // -----------------------------
  // PER-ORIGIN GUARD
  // -----------------------------
  const ORIGIN_MARKER = Symbol.for(CFG.originMarkerPrefix + (location && location.origin ? location.origin : 'unknown'));
  if (window[ORIGIN_MARKER]) {
    if (CFG.debug) console.warn('Stealth already installed for origin', location && location.origin);
    return;
  }
  try {
    Object.defineProperty(window, ORIGIN_MARKER, { value: true, configurable: false, enumerable: false, writable: false });
  } catch (_) { window[ORIGIN_MARKER] = true; }

  // -----------------------------
  // BACKUP ORIGINALS (minimal, defensive)
  // -----------------------------
  const ORIGINALS = {
    Object_defineProperty: Object.defineProperty,
    Object_getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    Object_getOwnPropertyDescriptors: Object.getOwnPropertyDescriptors || null,
    Object_getOwnPropertyNames: Object.getOwnPropertyNames,
    Function_toString: Function.prototype.toString,
    Error_ctor: (typeof Error !== 'undefined') ? Error : function () {},
    HTMLCanvasPrototype_getContext: (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype) ? HTMLCanvasElement.prototype.getContext : undefined,
    CanvasRenderingContext2D_toDataURL: (typeof CanvasRenderingContext2D !== 'undefined') ? CanvasRenderingContext2D.prototype.toDataURL : undefined,
    CanvasRenderingContext2D_toBlob: (typeof CanvasRenderingContext2D !== 'undefined') ? CanvasRenderingContext2D.prototype.toBlob : undefined,
    performance_now: (typeof performance !== 'undefined' && performance.now) ? performance.now.bind(performance) : null,
    Date_now: Date.now.bind(Date),
    Reflect_apply: (typeof Reflect !== 'undefined' && Reflect.apply) ? Reflect.apply.bind(Reflect) : null,
    Reflect_defineProperty: (typeof Reflect !== 'undefined' && Reflect.defineProperty) ? Reflect.defineProperty.bind(Reflect) : null,
    Proxy: (typeof Proxy !== 'undefined') ? Proxy : undefined,
    Reflect: (typeof Reflect !== 'undefined') ? Reflect : undefined
  };

  // safeDefine: best-effort property definition
  _.safeDefine = function (obj, prop, desc) {
    try {
      if (ORIGINALS && ORIGINALS.Object_defineProperty) {
        ORIGINALS.Object_defineProperty(obj, prop, desc);
        return true;
      } else {
        Object.defineProperty(obj, prop, desc);
        return true;
      }
    } catch (e) {
      try { obj[prop] = desc && desc.value !== undefined ? desc.value : undefined; return true; } catch (_) { return false; }
    }
  };

  // store hidden metadata
  try {
    _.safeDefine(window, CFG.stealthSymbol, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: {
        originals: { has: Object.keys(ORIGINALS) },
        installedAt: Date.now(),
        origin: (location && location.origin) ? location.origin : ''
      }
    });
  } catch (_) {
    window[CFG.stealthSymbol] = { originals: { has: Object.keys(ORIGINALS) }, installedAt: Date.now(), origin: (location && location.origin) ? location.origin : '' };
  }

  // -----------------------------
  // NATIVE-LIKE MAKER
  // -----------------------------
  function makeNativeLike(originalFunc, fakeName, lengthOverride) {
    if (!_.isFn(originalFunc)) return originalFunc;
    fakeName = (typeof fakeName === 'string' && fakeName.length) ? fakeName : (originalFunc.name || 'anonymous');
    const declaredLength = (typeof lengthOverride === 'number') ? lengthOverride : Math.max(0, originalFunc.length || 0);
    const params = Array.from({ length: declaredLength }).map((_, i) => 'p' + i).join(',');
    const safeIdent = fakeName.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^[0-9]/, '_');

    try {
      // Create a named function that closes over the original function.
      // This approach binds the original as a parameter so the returned named function can call it directly.
      const factorySrc = '"use strict"; return function ' + safeIdent + '(' + params + ') { return __original__.apply(this, arguments); };';
      const factory = new Function('__original__', factorySrc);
      const wrapper = factory(originalFunc);

      // attach original call in non-enumerable way
      try {
        ORIGINALS.Object_defineProperty(wrapper, '__callOriginal__', {
          value: originalFunc,
          configurable: false, writable: false, enumerable: false
        });
      } catch (_) {
        try { wrapper.__callOriginal__ = originalFunc; } catch (_) { /* swallow */ }
      }

      // mimic toString
      try {
        ORIGINALS.Object_defineProperty(wrapper, 'toString', {
          value: function () { return 'function ' + fakeName + '() { [native code] }'; },
          configurable: true, writable: false, enumerable: false
        });
      } catch (_) { /* swallow */ }

      // name property
      try {
        const nameDesc = ORIGINALS.Object_getOwnPropertyDescriptor(wrapper, 'name') || {};
        if (nameDesc && nameDesc.configurable !== false) {
          try { ORIGINALS.Object_defineProperty(wrapper, 'name', { value: fakeName, configurable: true }); } catch (_) { /* swallow */ }
        }
      } catch (_) {}

      try { Object.freeze(wrapper); } catch (_) { }
      return wrapper;
    } catch (e) {
      // fallback: simple wrapper that calls original
      const fallback = function () { return originalFunc.apply(this, arguments); };
      try { ORIGINALS.Object_defineProperty(fallback, 'name', { value: fakeName, configurable: true }); } catch (_) { }
      try { ORIGINALS.Object_defineProperty(fallback, 'toString', { value: function () { return 'function ' + fakeName + '() { [native code] }'; }, configurable: true }); } catch (_) { }
      try { ORIGINALS.Object_defineProperty(fallback, '__callOriginal__', { value: originalFunc, configurable: false, enumerable: false, writable: false }); } catch (_) { try { fallback.__callOriginal__ = originalFunc; } catch (_) {} }
      return fallback;
    }
  }

  // -----------------------------
  // DYNAMIC STACK TRACE / Error SPOOFING
  // -----------------------------
  // Create stealthy Error replacement BEFORE patching Function.prototype.toString
  const stealthErrorCtor = (function makeErrorReplacement() {
    const NativeError = ORIGINALS.Error_ctor || Error;
    function FakeError(message) {
      const e = new NativeError(message);
      try {
        // Define a stealthy stack getter that tries to look native-ish
        ORIGINALS.Object_defineProperty(e, 'stack', {
          configurable: true,
          enumerable: false,
          get: makeNativeLike(function () {
            try {
              const topName = (this && this.name) || 'Error';
              const msg = (this && this.message) || '';
              // Build a very small, plausible stack trace
              const host = (typeof location !== 'undefined' && location.hostname) ? location.hostname : 'anonymous';
              const frames = [
                topName + (msg ? (': ' + msg) : ''),
                '    at ' + host + ':0:0',
                '    at Array.forEach (native)',
                '    at Function.prototype.apply (native)'
              ];
              return frames.join('\\n');
            } catch (err) {
              try { return (new NativeError(message)).stack; } catch (_) { return ''; }
            }
          }, 'get stack'), writable: false
        });
      } catch (_) { /* swallow */ }
      return e;
    }
    try {
      ORIGINALS.Object_defineProperty(FakeError, 'name', { value: 'Error', configurable: true });
      ORIGINALS.Object_defineProperty(FakeError, 'toString', { value: function () { return ORIGINALS.Function_toString.call(NativeError); }, configurable: true });
    } catch (_) {}
    return makeNativeLike(FakeError, 'Error', 1);
  })();

  // Replace global Error with stealthy Error (best-effort)
  try {
    _.safeDefine(window, 'Error', { configurable: true, enumerable: false, writable: true, value: stealthErrorCtor });
  } catch (_) { try { window.Error = stealthErrorCtor; } catch (_) { /* ignore */ } }

  // -----------------------------
  // FUNCTION.prototype.toString PATCH
  // -----------------------------
  (function patchFunctionToString() {
    const originalToString = ORIGINALS.Function_toString;
    function stealthyToString() {
      try {
        if (this && typeof this === 'function') {
          // prefer toString of wrapped original if present
          if (this.__callOriginal__ && _.isFn(this.__callOriginal__)) {
            try { return ORIGINALS.Function_toString.call(this.__callOriginal__); } catch (_) { /* fallthrough */ }
          }
          // If function is our stealth Error wrapper, show native Error.toString
          if (this === stealthErrorCtor) {
            try { return ORIGINALS.Function_toString.call(ORIGINALS.Error_ctor); } catch (_) { /* fallthrough */ }
          }
          return ORIGINALS.Function_toString.call(this);
        }
      } catch (e) { /* swallow */ }
      return originalToString.call(this);
    }
    try {
      _.safeDefine(Function.prototype, 'toString', { value: makeNativeLike(stealthyToString, 'toString'), configurable: true, writable: true });
    } catch (_) { /* best-effort */ }
  })();

  // -----------------------------
  // TIMING NOISE (performance.now & Date.now)
  // -----------------------------
  (function installTimingNoise() {
    if (!CFG.timing.enabled) return;
    try {
      if (ORIGINALS.performance_now) {
        const perfNow = function () {
          try {
            const base = ORIGINALS.performance_now();
            const jitter = _.gaussianNoise(CFG.timing.jitterMaxMs);
            return base + jitter;
          } catch (e) {
            return (Date.now && Date.now()) || 0;
          }
        };
        try { _.safeDefine(performance, 'now', { value: makeNativeLike(perfNow, 'now'), configurable: true }); } catch (_) { try { performance.now = perfNow; } catch (_) {} }
      }
    } catch (_) {}

    try {
      const origDateNow = ORIGINALS.Date_now || Date.now;
      const dateNow = function () {
        const base = origDateNow();
        if (!dateNow._skew) dateNow._skew = Math.round(_.rand(-CFG.timing.dateSkewMaxMs, CFG.timing.dateSkewMaxMs));
        return base + dateNow._skew;
      };
      try { _.safeDefine(Date, 'now', { value: makeNativeLike(dateNow, 'now'), configurable: true }); } catch (_) { try { Date.now = dateNow; } catch (_) {} }

      try {
        if (typeof performance !== 'undefined' && performance && performance.timing && typeof performance.timing === 'object') {
          const originalTiming = performance.timing;
          if (ORIGINALS.Proxy && ORIGINALS.Reflect) {
            try {
              const timingProxy = new ORIGINALS.Proxy(originalTiming, {
                get(t, p, r) {
                  try { if (p === 'navigationStart') return (originalTiming && originalTiming.navigationStart ? originalTiming.navigationStart : 0) + (dateNow._skew || 0); } catch (_) {}
                  return ORIGINALS.Reflect.get(t, p, r);
                }
              });
              try { _.safeDefine(performance, 'timing', { value: timingProxy, configurable: true }); } catch (_) { performance.timing = timingProxy; }
            } catch (_) { /* swallow */ }
          }
        }
      } catch (_) {}
    } catch (_) {}
  })();

  // -----------------------------
  // NAVIGATOR SPOOFING
  // -----------------------------
  (function installNavigatorSpoof() {
    try {
      if (typeof navigator === 'undefined') return;
      const originalProps = {};
      try {
        const navProps = (ORIGINALS.Object_getOwnPropertyNames && navigator) ? ORIGINALS.Object_getOwnPropertyNames(navigator) : [];
        navProps.forEach(p => {
          try { originalProps[p] = ORIGINALS.Object_getOwnPropertyDescriptor(navigator, p); } catch (_) {}
        });
      } catch (_) {}

      const spoof = {};
      spoof.userAgent = (CFG.navigator.userAgent && typeof CFG.navigator.userAgent === 'string') ? CFG.navigator.userAgent : tryOr(() => navigator.userAgent, () => '');
      spoof.platform = CFG.navigator.platform || (navigator && navigator.platform) || '';
      spoof.languages = (CFG.navigator.languages && Array.isArray(CFG.navigator.languages)) ? CFG.navigator.languages.slice() : (Array.isArray(navigator.languages) ? navigator.languages.slice() : []);

      spoof.userAgent = spoof.userAgent || (navigator && navigator.userAgent) || '';
      spoof.platform = spoof.platform || (navigator && navigator.platform) || '';
      spoof.languages = spoof.languages.length ? spoof.languages : (Array.isArray(navigator.languages) ? navigator.languages.slice() : []);

      const definePairs = {
        userAgent: spoof.userAgent,
        platform: spoof.platform,
        language: spoof.languages[0] || '',
        languages: spoof.languages.slice()
      };

      for (const k of Object.keys(definePairs)) {
        const v = definePairs[k];
        try {
          _.safeDefine(navigator, k, { value: v, writable: false, enumerable: false, configurable: true });
        } catch (_) {
          try { navigator[k] = v; } catch (_) {}
        }
      }
    } catch (e) {
      if (CFG.debug) console.error('navigator spoof install failed', e);
    }
  })();

  // -----------------------------
  // CANVAS & IMAGE FINGERPRINT MITIGATION
  // -----------------------------
  (function installCanvasMitigations() {
    if (!CFG.canvas.enabled) return;
    try {
      const origGetContext = ORIGINALS.HTMLCanvasPrototype_getContext;
      if (!origGetContext) return;

      const _seed = (function seedFrom() {
        try {
          const s = (location && location.origin ? location.origin : '') + '|' + (Date.now() & 0xffff);
          let h = 2166136261 >>> 0;
          for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
          return h;
        } catch (_) { return Math.floor(Math.random() * 0xffffffff); }
      })();

      function seededRandom() {
        let x = _seed ^ (Date.now() & 0xffffffff);
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        return (x >>> 0) / 0xFFFFFFFF;
      }

      function pixelNoise(val) {
        try {
          const r = (seededRandom() - 0.5) * 2 * CFG.canvas.noiseClamp;
          const out = Math.round(_.clamp(val + val * r, 0, 255));
          return out;
        } catch (_) { return val; }
      }

      const fakeGetContext = makeNativeLike(function (type) {
        const ctx = origGetContext.apply(this, arguments);
        if (!ctx) return ctx;

        try {
          if (ctx.getImageData && !ctx.__stealth_patched_getImageData) {
            const origGetImageData = ctx.getImageData;
            const patched = function (sx, sy, sw, sh) {
              const imageData = origGetImageData.apply(this, arguments);
              try {
                const data = imageData && imageData.data;
                if (data && data.length) {
                  for (let i = 0; i < data.length; i += 4) {
                    data[i] = pixelNoise(data[i]);
                    data[i + 1] = pixelNoise(data[i + 1]);
                    data[i + 2] = pixelNoise(data[i + 2]);
                  }
                }
              } catch (_) { /* swallow */ }
              return imageData;
            };
            try { ORIGINALS.Object_defineProperty(ctx, 'getImageData', { value: makeNativeLike(patched, 'getImageData'), configurable: true }); } catch (_) { ctx.getImageData = patched; }
            try { ctx.__stealth_patched_getImageData = true; } catch (_) {}
          }

          if (ctx.toDataURL && !ctx.__stealth_patched_toDataURL) {
            const origToDataURL = ctx.toDataURL;
            const patched = function () {
              if (CFG.canvas.fuzzDataURL) {
                try {
                  const w = (this.canvas && this.canvas.width) || 1;
                  const h = (this.canvas && this.canvas.height) || 1;
                  try {
                    // Keep size very small to minimize side-effects
                    const tmp = this.getImageData(0, 0, Math.min(w, 3), Math.min(h, 3));
                    if (tmp && tmp.data) {
                      for (let i = 0; i < tmp.data.length; i += 4) {
                        tmp.data[i] = pixelNoise(tmp.data[i]);
                        tmp.data[i + 1] = pixelNoise(tmp.data[i + 1]);
                        tmp.data[i + 2] = pixelNoise(tmp.data[i + 2]);
                      }
                    }
                    try { this.putImageData(tmp, 0, 0); } catch (_) { /* CORS or tainted; ignore */ }
                  } catch (_) { /* cannot access image data due to CORS; ignore */ }
                } catch (_) { /* swallow */ }
              }
              return origToDataURL.apply(this, arguments);
            };
            try { ORIGINALS.Object_defineProperty(ctx, 'toDataURL', { value: makeNativeLike(patched, 'toDataURL'), configurable: true }); } catch (_) { ctx.toDataURL = patched; }
            try { ctx.__stealth_patched_toDataURL = true; } catch (_) {}
          }

          if (ctx.toBlob && !ctx.__stealth_patched_toBlob) {
            const origToBlob = ctx.toBlob;
            const patched = function (cb, type, quality) {
              // wrap callback to preserve interface, no-op modification - placeholder for future logic
              const wrappedCb = function (blob) { try { cb && cb(blob); } catch (_) {} };
              return origToBlob.call(this, wrappedCb, type, quality);
            };
            try { ORIGINALS.Object_defineProperty(ctx, 'toBlob', { value: makeNativeLike(patched, 'toBlob'), configurable: true }); } catch (_) { ctx.toBlob = patched; }
            try { ctx.__stealth_patched_toBlob = true; } catch (_) {}
          }
        } catch (_) { /* swallow */ }
        return ctx;
      }, 'getContext', 1);

      try {
        ORIGINALS.Object_defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: makeNativeLike(fakeGetContext, 'getContext', 1), configurable: true });
      } catch (_) { HTMLCanvasElement.prototype.getContext = fakeGetContext; }

    } catch (e) {
      if (CFG.debug) console.error('installCanvasMitigations failed', e);
    }
  })();

  // -----------------------------
  // PROXY & REFLECT HARDENING
  // -----------------------------
  (function installProxyReflectHardening() {
    try {
      if (ORIGINALS.Reflect_apply) {
        const origReflectApply = ORIGINALS.Reflect_apply;
        const safeApply = function (target, thisArg, args) {
          try {
            // Basic sanity: ensure wrapper shape doesn't trick native into illegal invocation
            if (target && target.__callOriginal__ && !_.isFn(target.__callOriginal__)) {
              throw new TypeError('Illegal invocation');
            }
          } catch (_) { /* swallow */ }
          return origReflectApply(target, thisArg, args);
        };
        try { _.safeDefine(Reflect, 'apply', { value: makeNativeLike(safeApply, 'apply'), configurable: true }); } catch (_) { Reflect.apply = safeApply; }
      }
    } catch (e) {
      if (CFG.debug) console.error('Reflect.apply harden failed', e);
    }

    try {
      if (ORIGINALS.Reflect_defineProperty) {
        const origReflectDefineProperty = ORIGINALS.Reflect_defineProperty;
        const safeDefineProperty = function (target, prop, descriptor) {
          try {
            if (prop === CFG.stealthSymbol) return false;
            if (prop && String(prop).indexOf('__stealth') >= 0) return false;
          } catch (_) { /* swallow */ }
          return origReflectDefineProperty(target, prop, descriptor);
        };
        try { _.safeDefine(Reflect, 'defineProperty', { value: makeNativeLike(safeDefineProperty, 'defineProperty'), configurable: true }); } catch (_) { Reflect.defineProperty = safeDefineProperty; }
      }
    } catch (e) {
      if (CFG.debug) console.error('Reflect.defineProperty harden failed', e);
    }

    try {
      if (ORIGINALS.Proxy) {
        const OrigProxy = ORIGINALS.Proxy;
        const ProxyShim = function (target, handler) {
          return new OrigProxy(target, handler);
        };
        try { _.safeDefine(window, 'Proxy', { value: makeNativeLike(ProxyShim, 'Proxy'), configurable: true }); } catch (_) { window.Proxy = ProxyShim; }
      }
    } catch (e) {
      if (CFG.debug) console.error('Proxy shim failed', e);
    }
  })();

  // -----------------------------
  // WRAP Object.* DESCRIPTOR APIS
  // -----------------------------
  (function installDescriptorHooks() {
    try {
      const originals = {
        defineProperty: ORIGINALS.Object_defineProperty,
        getOwnPropertyDescriptor: ORIGINALS.Object_getOwnPropertyDescriptor,
        getOwnPropertyDescriptors: ORIGINALS.Object_getOwnPropertyDescriptors,
        defineProperties: Object.defineProperties
      };

      function safeCall(fn, thisArg, args, fallback) {
        try { return fn.apply(thisArg, args); } catch (err) {
          if (_.isFn(fallback)) {
            try { return fallback.apply(thisArg, args); } catch (_) { /* swallow */ }
          }
          throw err;
        }
      }

      function cloneDescriptorExact(desc) {
        if (!desc || typeof desc !== 'object') return desc;
        const newDesc = {};
        const keys = ['configurable', 'enumerable', 'writable', 'value', 'get', 'set'];
        for (const k of keys) if (k in desc) newDesc[k] = desc[k];
        return newDesc;
      }

      function makeWrappedAccessor(accessorFn, label) {
        if (!_.isFn(accessorFn)) return accessorFn;
        const wrapped = makeNativeLike(accessorFn, label || (accessorFn.name || 'accessor'));
        try { ORIGINALS.Object_defineProperty(wrapped, '__originalAccessor__', { value: accessorFn, configurable: false, enumerable: false, writable: false }); } catch (_) { try { wrapped.__originalAccessor__ = accessorFn; } catch (_) {} }
        return wrapped;
      }

      const definePropertyWrapper = makeNativeLike(function (target, prop, descriptor) {
        const descCopy = cloneDescriptorExact(descriptor || {});
        try {
          if (_.isFn(descCopy.get)) descCopy.get = makeWrappedAccessor(descCopy.get, 'get ' + String(prop));
          if (_.isFn(descCopy.set)) descCopy.set = makeWrappedAccessor(descCopy.set, 'set ' + String(prop));
          // Prefer Reflect.defineProperty (original) and fallback to Object.defineProperty
          return safeCall(function (t, p, d) { return (Reflect && Reflect.defineProperty) ? Reflect.defineProperty(t, p, d) : ORIGINALS.Object_defineProperty(t, p, d); }, Reflect || Object, [target, prop, descCopy], function () {
            return ORIGINALS.Object_defineProperty(target, prop, descriptor);
          });
        } catch (err) { throw err; }
      }, 'defineProperty');

      const getOwnPropertyDescriptorWrapper = makeNativeLike(function (target, prop) {
        const desc = safeCall(function (t, p) { return ORIGINALS.Object_getOwnPropertyDescriptor(t, p); }, Object, [target, prop], null);
        if (!desc) return desc;
        try {
          const descCopy = cloneDescriptorExact(desc);
          if (_.isFn(descCopy.get)) descCopy.get = makeWrappedAccessor(descCopy.get, 'get ' + String(prop));
          if (_.isFn(descCopy.set)) descCopy.set = makeWrappedAccessor(descCopy.set, 'set ' + String(prop));
          return descCopy;
        } catch (err) { return desc; }
      }, 'getOwnPropertyDescriptor');

      const getOwnPropertyDescriptorsWrapper = makeNativeLike(function (target) {
        if (!originals.getOwnPropertyDescriptors) return safeCall(function (t) { return Object.getOwnPropertyDescriptors(t); }, Object, [target], null);
        const descriptors = safeCall(function (t) { return originals.getOwnPropertyDescriptors(t); }, Object, [target], null);
        if (!descriptors || typeof descriptors !== 'object') return descriptors;
        try {
          const out = {};
          for (const k of Object.keys(descriptors)) {
            const d = descriptors[k];
            out[k] = cloneDescriptorExact(d);
            if (_.isFn(out[k].get)) out[k].get = makeWrappedAccessor(out[k].get, 'get ' + String(k));
            if (_.isFn(out[k].set)) out[k].set = makeWrappedAccessor(out[k].set, 'set ' + String(k));
          }
          return out;
        } catch (_) { return descriptors; }
      }, 'getOwnPropertyDescriptors');

      const definePropertiesWrapper = makeNativeLike(function (target, descriptors) {
        const clone = {};
        try {
          for (const key of Object.keys(descriptors || {})) {
            const d = descriptors[key];
            const dCopy = cloneDescriptorExact(d);
            if (_.isFn(dCopy.get)) dCopy.get = makeWrappedAccessor(dCopy.get, 'get ' + String(key));
            if (_.isFn(dCopy.set)) dCopy.set = makeWrappedAccessor(dCopy.set, 'set ' + String(key));
            clone[key] = dCopy;
          }
          return safeCall(function (t, dsc) { return Reflect && Reflect.defineProperties ? Reflect.defineProperties(t, dsc) : Object.defineProperties(t, dsc); }, Object, [target, clone], function () {
            return originals.defineProperties.call(Object, target, descriptors);
          });
        } catch (err) { throw err; }
      }, 'defineProperties');

      // Install replacements in a stealthy manner using original defineProperty
      try {
        // Use ORIGINALS.Object_defineProperty to set properties on Object
        ORIGINALS.Object_defineProperty(Object, 'defineProperty', { configurable: true, enumerable: false, writable: true, value: definePropertyWrapper });
        ORIGINALS.Object_defineProperty(Object, 'getOwnPropertyDescriptor', { configurable: true, enumerable: false, writable: true, value: getOwnPropertyDescriptorWrapper });
        if (originals.getOwnPropertyDescriptors) {
          ORIGINALS.Object_defineProperty(Object, 'getOwnPropertyDescriptors', { configurable: true, enumerable: false, writable: true, value: getOwnPropertyDescriptorsWrapper });
        }
        ORIGINALS.Object_defineProperty(Object, 'defineProperties', { configurable: true, enumerable: false, writable: true, value: definePropertiesWrapper });

        // small debug marker (non-enumerable)
        try {
          ORIGINALS.Object_defineProperty(window, Symbol.for('__descriptor_hooks_debug__'), {
            value: { originals: Object.keys(originals), installed: true, origin: (location && location.origin) ? location.origin : '' },
            configurable: false, enumerable: false, writable: false
          });
        } catch (_) { /* swallow */ }
      } catch (installErr) {
        // attempt to restore minimal original behaviour if we failed
        try {
          ORIGINALS.Object_defineProperty(Object, 'defineProperty', { configurable: true, enumerable: false, writable: true, value: ORIGINALS.Object_defineProperty });
          ORIGINALS.Object_defineProperty(Object, 'getOwnPropertyDescriptor', { configurable: true, enumerable: false, writable: true, value: ORIGINALS.Object_getOwnPropertyDescriptor });
        } catch (_) { /* swallow */ }
        if (CFG.debug) console.error('Descriptor hook installation failed', installErr);
      }

    } catch (e) {
      if (CFG.debug) console.error('installDescriptorHooks top-level failed', e);
    }
  })();

  // -----------------------------
  // FINAL HARDENING & LOGGING
  // -----------------------------
  (function finalize() {
    try {
      try { Object.freeze(window[CFG.stealthSymbol]); } catch (_) { /* swallow */ }

      // Do NOT revert our Function.prototype.toString patch here.
      // Keep our stealthy toString in place (intentional).

      if (CFG.debug) console.info('Stealth merged script installed for', (location && location.origin) ? location.origin : 'unknown');
    } catch (e) { /* swallow */ }
  })();

})();
