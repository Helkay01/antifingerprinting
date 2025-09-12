// Inject this script early (document_start) for best effect.
// It is intended for local testing/privacy research only.
const webglScript = document.createElement('script');
webglScript.textContent = `

(function() {
  'use strict';

  // Unique marker so we can safely recognize our wrappers
  const __MARK = '__wgl_spoof_v2__';

  // ===== Utilities =======================================================
  const cryptoObj = (typeof crypto !== 'undefined' && crypto) || (typeof msCrypto !== 'undefined' && msCrypto) || null;
  function rndInt(max) {
    if (cryptoObj && cryptoObj.getRandomValues) {
      const arr = new Uint32Array(1);
      cryptoObj.getRandomValues(arr);
      return arr[0] % max;
    }
    return Math.floor(Math.random() * max);
  }
  function rndFloat() {
    if (cryptoObj && cryptoObj.getRandomValues) {
      const arr = new Uint32Array(1);
      cryptoObj.getRandomValues(arr);
      return arr[0] / 0xFFFFFFFF;
    }
    return Math.random();
  }
  function pick(arr) { return arr[rndInt(arr.length)]; }

  // Session salt: deterministic within a tab/session but random across browser restarts
  const SESSION_SALT = (function() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const key = '__wgl_salt_v2';
        let v = sessionStorage.getItem(key);
        if (!v) {
          // Use time + crypto
          v = String((Date.now() ^ (rndInt(1<<30))) + (Math.floor(rndFloat()*100000)));
          sessionStorage.setItem(key, v);
        }
        return Number(v) || (Date.now() & 0xFFFFFF);
      }
    } catch (e) {}
    return Date.now() & 0xFFFFFF;
  })();

  // Minimal deterministic mask work that varies by session
  function maskWork() {
    // iterations vary with session salt so cost is not identical across clients
    const iterations = 30 + (SESSION_SALT % 40); // 30..69
    let x = 0.123456789;
    for (let i = 0; i < iterations; i++) {
      // cheap and JIT-friendly math — avoid heavy ops
      x = (x * 1.000001 + Math.sin(i + x)) % 1.0;
    }
    return x;
  }

  // Small helper to mark wrapped functions
  function markWrapped(fn) {
    try { Object.defineProperty(fn, __MARK, { value: true, configurable: true }); } catch(e) {}
    return fn;
  }

  // Create a native-like function wrapper (improves toString & descriptors)
  function makeNativeFunction(fn, name) {
    try { Object.defineProperty(fn, 'name', { value: String(name || ''), configurable: true }); } catch(e){}
    const nativeLikeToString = function() { return 'function ' + (name || '') + '() { [native code] }'; };
    try {
      // Flag the toString method for later detection by our toString proxy
      Object.defineProperty(fn, 'toString', { value: nativeLikeToString, configurable: true, writable: false, enumerable: false });
      Object.defineProperty(fn, Symbol.toStringTag, { value: 'Function', configurable: true });
    } catch(e){}
    markWrapped(fn);
    return fn;
  }

  // ===== Function.prototype.toString stealth =================================
  // Make native-like toString consistent for our wrapped functions while preserving original behavior
  (function patchFunctionToString() {
    try {
      const origToString = Function.prototype.toString;
      const origValueOf = Function.prototype.valueOf;
      const proxy = new Proxy(origToString, {
        apply(target, thisArg, args) {
          try {
            if (thisArg && (thisArg[__MARK] || (thisArg.toString && thisArg.toString.name === 'nativeLikeToString'))) {
              // keep a plausible native format
              const n = thisArg.name || '';
              return 'function ' + n + '() { [native code] }';
            }
          } catch (e) {}
          // fallback to original
          return Reflect.apply(target, thisArg, args);
        }
      });
      Object.defineProperty(Function.prototype, 'toString', {
        value: proxy,
        configurable: true,
        writable: true,
        enumerable: false
      });
      // valueOf should be untouched normally, but keep original if needed
      Function.prototype.valueOf = origValueOf;
    } catch(e) {}
  })();

  // ===== Performance.now / timing fuzzing ===================================
  // Add tiny session-consistent jitter + small random noise to thwart nanobenchmarks
  (function patchPerformance() {
    try {
      if (typeof performance !== 'undefined' && performance.now) {
        const origNow = performance.now.bind(performance);
        const baseShift = (SESSION_SALT % 7) * 0.0005; // tiny deterministic per-session base: 0..0.003
        const proxy = function() {
          // small deterministic + random micro-jitter
          const t = origNow();
          const jitter = baseShift + (rndFloat() - 0.5) * 0.0008; // +/- ~0.0004 ms
          return t + jitter;
        };
        try {
          Object.defineProperty(performance, 'now', { value: proxy, configurable: true, writable: true });
        } catch(e) {
          performance.now = proxy;
        }
      }
    } catch(e) {}
  })();

  // ===== Error stack cloaking (safe) ========================================
  // Filter stack frames that reference our injected script name or unique marker
  (function patchErrorStack() {
    try {
      const origPrepare = Error.prepareStackTrace;
      Error.prepareStackTrace = function(err, frames) {
        try {
          if (!frames || !frames.length) return origPrepare ? origPrepare(err, frames) : err.stack;
          const filtered = frames.filter(f => {
            try {
              const fn = (f.getFunctionName && f.getFunctionName()) || '';
              const file = (f.getFileName && f.getFileName()) || '';
              // drop frames referencing our marker or blob URLs where we injected
              if (file && file.indexOf('blob:') !== -1) return false;
              if (file && file.indexOf('__wgl_spoof') !== -1) return false;
              if (fn && String(fn).indexOf(__MARK) !== -1) return false;
              return true;
            } catch(e) { return true; }
          });
          return origPrepare ? origPrepare(err, filtered) : (err.name + ': ' + err.message + '\\n' + filtered.join('\\n'));
        } catch(e) {
          return origPrepare ? origPrepare(err, frames) : err.stack;
        }
      };
    } catch(e) {}
  })();

  // ===== Cross-context sync (bc + storage + postMessage + SharedWorker) =======
  // We attempt multiple sync channels so that values are consistent across same-origin tabs and frames.
  const SYNC_KEY_VENDOR = '__wgl_vendor_v2';
  const SYNC_KEY_RENDERER = '__wgl_renderer_v2';
  const SYNC_CHANNEL = '__wgl_broadcast_v2';
  let bc = null;

  function broadcastSet(vendor, renderer) {
    try { if (bc) bc.postMessage({ vendor, renderer }); } catch(e) {}
    try { if (typeof sessionStorage !== 'undefined') { sessionStorage.setItem(SYNC_KEY_VENDOR, vendor); sessionStorage.setItem(SYNC_KEY_RENDERER, renderer); } } catch(e) {}
    try { localStorage.setItem(SYNC_KEY_VENDOR, vendor); localStorage.setItem(SYNC_KEY_RENDERER, renderer); } catch(e){}
    // postMessage to same-origin frames
    try { window.postMessage({ __wgl_spoof_msg: 1, vendor, renderer }, '*'); } catch(e) {}
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(SYNC_CHANNEL);
      bc.onmessage = (ev) => {
        try {
          const d = ev && ev.data;
          if (d && d.vendor && d.renderer) {
            applySpoof(d.vendor, d.renderer, false);
          }
        } catch(e){}
      };
    }
  } catch(e) { bc = null; }

  // listen storage events (other tabs)
  try {
    window.addEventListener('storage', function(ev) {
      try {
        if (!ev) return;
        if (ev.key === SYNC_KEY_VENDOR || ev.key === SYNC_KEY_RENDERER) {
          const v = localStorage.getItem(SYNC_KEY_VENDOR);
          const r = localStorage.getItem(SYNC_KEY_RENDERER);
          if (v && r) applySpoof(v, r, false);
        }
      } catch(e){}
    }, false);
  } catch(e) {}

  // listen postMessage
  try {
    window.addEventListener('message', function(ev) {
      try {
        const d = ev && ev.data;
        if (d && d.__wgl_spoof_msg && d.vendor && d.renderer) {
          applySpoof(d.vendor, d.renderer, false);
        }
      } catch(e){}
    }, false);
  } catch(e){}

  // SharedWorker best-effort sync (same-origin)
  let sharedWorkerPort = null;
  try {
    if (typeof SharedWorker !== 'undefined') {
      try {
        // Use double-quoted string for the Blob body so inner single-quotes are safe
        const swBlob = new Blob([\"self.addEventListener('connect', function(e) {\\n  var port = e.ports[0];\\n  port.onmessage = function(ev) {\\n    var d = ev.data;\\n    if (d && d.vendor && d.renderer) {\\n      // echo back to the sender port (best-effort)\\n      try { port.postMessage(d); } catch(e){}\\n    }\\n  };\\n});\\n\"], { type: 'text/javascript' });
        const swUrl = URL.createObjectURL(swBlob);
        const sw = new SharedWorker(swUrl);
        sharedWorkerPort = sw.port;
        if (sharedWorkerPort.start) sharedWorkerPort.start();
        sharedWorkerPort.onmessage = function(e) {
          try {
            const d = e && e.data;
            if (d && d.vendor && d.renderer) applySpoof(d.vendor, d.renderer, false);
          } catch(e){}
        };
      } catch(e){}
    }
  } catch(e){}

  // ===== Vendor/Renderer generation =======================================
  const VENDOR_LIST = ["Google Inc.","Intel Inc.","NVIDIA Corporation","AMD","Apple Inc."];
  const RENDERER_TEMPLATES = [
    "ANGLE (Qualcomm, Adreno (TM) {num})",
    "ANGLE (NVIDIA, NVIDIA GeForce {num})",
    "ANGLE (Intel, Intel(R) UHD Graphics {num})",
    "{vendor} GPU {num}",
    "ANGLE (Google, Google GPU {num})"
  ];
  function genRenderer(vendor) {
    const tpl = pick(RENDERER_TEMPLATES);
    // create a 3-digit-ish model number consistent per-session
    const num = 100 + Math.floor(((SESSION_SALT & 0xFFF) + rndInt(900)) % 900);
    return tpl.replace('{vendor}', vendor).replace('{num}', num);
  }

  // Current spoof values (populated by applySpoof)
  let spoofedVendor = null;
  let spoofedRenderer = null;

  function applySpoof(vendor, renderer, broadcast = true) {
    spoofedVendor = vendor;
    spoofedRenderer = renderer;
    try {
      Object.defineProperty(navigator, '__spoofed_webgl_vendor', { value: spoofedVendor, configurable: true });
      Object.defineProperty(navigator, '__spoofed_webgl_renderer', { value: spoofedRenderer, configurable: true });
      // also keep window debug props for local testing only
      try { Object.defineProperty(window, '__spoofed_webgl_vendor', { value: spoofedVendor, configurable: true }); } catch(e){}
      try { Object.defineProperty(window, '__spoofed_webgl_renderer', { value: spoofedRenderer, configurable: true }); } catch(e){}
    } catch(e){}
    if (broadcast) broadcastSet(vendor, renderer);
    // also apply to any already patched contexts/ prototypes immediately
    try { patchPrototype(window.WebGLRenderingContext && WebGLRenderingContext.prototype); } catch(e){}
    try { patchPrototype(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch(e){}
  }

  // try reading from sessionStorage/localStorage first
  try {
    if (!spoofedVendor && typeof sessionStorage !== 'undefined') {
      const v = sessionStorage.getItem(SYNC_KEY_VENDOR);
      const r = sessionStorage.getItem(SYNC_KEY_RENDERER);
      if (v && r) applySpoof(v, r, false);
    }
  } catch(e){}
  try {
    if (!spoofedVendor && typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(SYNC_KEY_VENDOR);
      const r = localStorage.getItem(SYNC_KEY_RENDERER);
      if (v && r) applySpoof(v, r, false);
    }
  } catch(e){}

  // If none present, pick and broadcast
  if (!spoofedVendor) {
    const v = pick(VENDOR_LIST);
    const r = genRenderer(v);
    applySpoof(v, r, true);
  }

  // ===== Real parameter cache and plausible perturbation ====================
  const UNMASKED_VENDOR_WEBGL = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  const realParameterCache = new Map();

  function tryProbeRealGL() {
    try {
      const probeCanvas = document.createElement('canvas');
      // don't add to DOM
      const realGL = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl') || probeCanvas.getContext('experimental-webgl');
      if (!realGL) return;
      const params = [
        0x0BA2, 0x1F01, UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL,
        0x1F02, 0x8B8C, 0x0D33, 0x8B4A, 0x8B4B, 0x8B4C, 0x8872, 0x8B4D,
        0x8B50, 0x8DFA, 0x8D57, 0x84E8, 0x0D3A, 0x851C, 0x887F,
        0x0D3D, 0x8B56, 0x8B57, 0x8B58, 0x8B59, 0x8D56, 0x8D5A
      ];
      params.forEach(p => {
        try {
          const v = realGL.getParameter(p);
          if (v && (v instanceof Float32Array || v instanceof Int32Array || v instanceof Uint8Array || v instanceof Uint8ClampedArray)) {
            realParameterCache.set(p, new v.constructor(v));
          } else {
            realParameterCache.set(p, v);
          }
        } catch(e){}
      });
    } catch(e){}
  }
  tryProbeRealGL();

  // For numeric parameters, return plausible session-perturbed value
  function perturbNumeric(val, frac = 0.03) {
    if (typeof val !== 'number' || !isFinite(val)) return val;
    // small deterministic perturbation based on SESSION_SALT
    const base = ((SESSION_SALT % 100) / 1000) - 0.05; // -0.05 .. +0.049
    const randomTiny = (rndFloat() - 0.5) * frac; // +/- frac/2
    const factor = 1 + base + randomTiny;
    const pert = Math.max(1, Math.round(val * factor));
    return pert;
  }

  function cloneIfNeeded(val) {
    if (val == null) return val;
    if (val instanceof Float32Array || val instanceof Int32Array ||
        val instanceof Uint8Array || val instanceof Uint8ClampedArray) {
      return new val.constructor(val);
    }
    if (Array.isArray(val)) return val.slice();
    if (typeof val === 'number') return perturbNumeric(val);
    // strings / objects: return as-is (for vendor/renderer we override separately)
    try {
      // shallow clone plain object to avoid exposing internal references
      if (Object.prototype.toString.call(val) === '[object Object]') return Object.assign({}, val);
    } catch(e){}
    return val;
  }

  // ===== Make debug info extension =======================================
  function makeDebugInfoExtension() {
    const ext = {
      UNMASKED_VENDOR_WEBGL: UNMASKED_VENDOR_WEBGL,
      UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER_WEBGL,
      getParameter: makeNativeFunction(function(param) {
        // small mask
        maskWork();
        if (param === UNMASKED_VENDOR_WEBGL) return spoofedVendor;
        if (param === UNMASKED_RENDERER_WEBGL) return spoofedRenderer;
        return null;
      }, 'getParameter')
    };
    // mark toString as native-like
    try { Object.defineProperty(ext.getParameter, 'toString', { value: function() { return 'function getParameter() { [native code] }'; }, configurable: true }); } catch(e){}
    return ext;
  }

  // ===== Patch prototype-level functions =================================
  function patchPrototype(proto) {
    if (!proto || proto.__wgl_spoofed_v2) return;
    try {
      const origGP = proto.getParameter;
      const origGE = proto.getExtension;
      const origGSE = proto.getSupportedExtensions;

      if (origGP) {
        proto.getParameter = makeNativeFunction(function(param) {
          maskWork();
          try {
            if (param === this.VENDOR || param === UNMASKED_VENDOR_WEBGL) return spoofedVendor;
            if (param === this.RENDERER || param === UNMASKED_RENDERER_WEBGL) return spoofedRenderer;
            if (realParameterCache.has(param)) return cloneIfNeeded(realParameterCache.get(param));
            return origGP.call(this, param);
          } catch(e) {
            try { return origGP.call(this, param); } catch(_) { return null; }
          }
        }, 'getParameter');
      }

      if (origGE) {
        proto.getExtension = makeNativeFunction(function(name) {
          maskWork();
          if (name === 'WEBGL_debug_renderer_info') return makeDebugInfoExtension();
          return origGE.call(this, name);
        }, 'getExtension');
      }

      if (origGSE) {
        proto.getSupportedExtensions = makeNativeFunction(function() {
          maskWork();
          try {
            const exts = origGSE.call(this) || [];
            if (!exts.includes('WEBGL_debug_renderer_info')) exts.push('WEBGL_debug_renderer_info');
            return exts;
          } catch(e) {
            return ['WEBGL_debug_renderer_info'];
          }
        }, 'getSupportedExtensions');
      }

      // preserve descriptors typical of native functions
      ['getParameter','getExtension','getSupportedExtensions'].forEach(k => {
        try { if (proto[k]) Object.defineProperty(proto, k, { value: proto[k], configurable: true, enumerable: false, writable: true }); } catch(e){}
      });

      proto.__wgl_spoofed_v2 = true;
    } catch(e) {}
  }

  // ===== Patch a specific context instance =================================
  function patchContextInstance(gl) {
    if (!gl || gl.__wgl_spoofed_instance_v2) return gl;
    gl.__wgl_spoofed_instance_v2 = true;

    const origGetParameter = (typeof gl.getParameter === 'function') ? gl.getParameter.bind(gl) : function() { return null; };
    const origGetExtension = (typeof gl.getExtension === 'function') ? gl.getExtension.bind(gl) : function() { return null; };
    const origGetSupportedExtensions = (typeof gl.getSupportedExtensions === 'function') ? gl.getSupportedExtensions.bind(gl) : null;

    function wrappedGetParameter(param) {
      maskWork();
      try {
        if (param === (typeof gl.VENDOR !== 'undefined' ? gl.VENDOR : 0x0BA2) || param === UNMASKED_VENDOR_WEBGL) {
          return spoofedVendor;
        }
        if (param === (typeof gl.RENDERER !== 'undefined' ? gl.RENDERER : 0x1F01) || param === UNMASKED_RENDERER_WEBGL) {
          return spoofedRenderer;
        }
        if (realParameterCache.has(param)) return cloneIfNeeded(realParameterCache.get(param));
        return origGetParameter(param);
      } catch(e) {
        try { return origGetParameter(param); } catch(_) { return null; }
      }
    }

    function wrappedGetExtension(name) {
      maskWork();
      if (name === 'WEBGL_debug_renderer_info') return makeDebugInfoExtension();
      return origGetExtension(name);
    }

    const wrappedGetSupportedExtensions = origGetSupportedExtensions ? function() {
      maskWork();
      try {
        const exts = origGetSupportedExtensions() || [];
        if (!exts.includes('WEBGL_debug_renderer_info')) exts.push('WEBGL_debug_renderer_info');
        return exts;
      } catch(e) {
        return ['WEBGL_debug_renderer_info'];
      }
    } : null;

    try {
      gl.getParameter = makeNativeFunction(wrappedGetParameter, 'getParameter');
      gl.getExtension = makeNativeFunction(wrappedGetExtension, 'getExtension');
      if (wrappedGetSupportedExtensions) gl.getSupportedExtensions = makeNativeFunction(wrappedGetSupportedExtensions, 'getSupportedExtensions');

      // set descriptors to non-enumerable like built-ins
      ['getParameter','getExtension','getSupportedExtensions'].forEach(k => {
        try { if (gl[k]) Object.defineProperty(gl, k, { value: gl[k], configurable: true, enumerable: false, writable: true }); } catch(e){}
      });
    } catch(e) {}

    return gl;
  }

  // ===== Patch HTMLCanvasElement.prototype.getContext early ================
  (function patchCanvasGetContext() {
    try {
      const proto = HTMLCanvasElement.prototype;
      if (!proto) return;
      const orig = proto.getContext;
      if (!orig || orig.__wgl_getContext_patched_v2) return;
      const wrapped = makeNativeFunction(function(type, attrs) {
        // call original
        const ctx = orig.call(this, type, attrs);
        if (!ctx) return ctx;
        // patch if webgl-ish
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
          try { return patchContextInstance(ctx); } catch(e) { return ctx; }
        }
        return ctx;
      }, 'getContext');
      Object.defineProperty(proto, 'getContext', { value: wrapped, configurable: true, enumerable: false, writable: true });
      proto.getContext.__wgl_getContext_patched_v2 = true;
    } catch(e) {}
  })();

  // ===== Apply prototoype patches (if available) ===========================
  try { patchPrototype(window.WebGLRenderingContext && WebGLRenderingContext.prototype); } catch(e) {}
  try { patchPrototype(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch(e) {}

  // ===== Patch existing canvases immediately (scan) =======================
  (function scanAndPatchExistingCanvases() {
    try {
      const canvases = document.getElementsByTagName ? document.getElementsByTagName('canvas') : [];
      for (let i = 0; i < canvases.length; i++) {
        try {
          const c = canvases[i];
          ['webgl','webgl2','experimental-webgl'].forEach(t => {
            try {
              const ctx = c.getContext(t);
              if (ctx) patchContextInstance(ctx);
            } catch(e){}
          });
        } catch(e){}
      }
    } catch(e){}
  })();

  // ===== MutationObserver to catch canvases added later ====================
  (function observeForCanvases() {
    try {
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          try {
            if (m.addedNodes) {
              for (const n of m.addedNodes) {
                try {
                  if (!n) continue;
                  // cover both element and HTML string inserts
                  if (n.nodeType === 1 && n.tagName === 'CANVAS') {
                    ['webgl','webgl2','experimental-webgl'].forEach(t => {
                      try {
                        const ctx = n.getContext(t);
                        if (ctx) patchContextInstance(ctx);
                      } catch(e){}
                    });
                  } else if (n.querySelectorAll) {
                    const canvases = n.querySelectorAll('canvas');
                    for (const c of canvases) {
                      try {
                        ['webgl','webgl2','experimental-webgl'].forEach(t => {
                          try {
                            const ctx = c.getContext(t);
                            if (ctx) patchContextInstance(ctx);
                          } catch(e){}
                        });
                      } catch(e){}
                    }
                  }
                } catch(e){}
              }
            }
          } catch(e){}
        }
      });
      mo.observe(document, { childList: true, subtree: true });
      try { Object.defineProperty(window, '__wgl_spoof_mo', { value: mo, configurable: true }); } catch(e){}
    } catch(e){}
  })();

  // ===== Descriptor masking for enumerations (getOwnPropertyDescriptors etc.) ==
  (function maskEnumerations() {
    try {
      const origGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
      const origGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      const origGetOwnPropertyNames = Object.getOwnPropertyNames;
      const origReflectOwnKeys = Reflect.ownKeys;

      function sanitizeDescriptors(target, descriptors) {
        try {
          if (!descriptors || typeof descriptors !== 'object') return descriptors;
          const suspiciousTargets = [HTMLCanvasElement.prototype,
                                     (window.WebGLRenderingContext && WebGLRenderingContext.prototype),
                                     (window.WebGL2RenderingContext && WebGL2RenderingContext.prototype)];
          for (let st of suspiciousTargets) {
            if (!st) continue;
            if (target === st) {
              ['getContext','getParameter','getExtension','getSupportedExtensions'].forEach(k => {
                if (k in descriptors) {
                  descriptors[k] = descriptors[k] || {};
                  descriptors[k].enumerable = false;
                  descriptors[k].configurable = true;
                  descriptors[k].writable = true;
                  try { descriptors[k].value = target[k]; } catch(e){}
                }
              });
            }
          }
        } catch(e){}
        return descriptors;
      }

      Object.defineProperty(Object, 'getOwnPropertyDescriptors', {
        value: makeNativeFunction(function(obj) {
          try {
            const d = origGetOwnPropertyDescriptors.call(Object, obj);
            return sanitizeDescriptors(obj, d);
          } catch(e) { return origGetOwnPropertyDescriptors.call(Object, obj); }
        }, 'getOwnPropertyDescriptors'),
        configurable: true, enumerable: false, writable: true
      });

      Object.defineProperty(Object, 'getOwnPropertyDescriptor', {
        value: makeNativeFunction(function(obj, prop) {
          try {
            const d = origGetOwnPropertyDescriptor.call(Object, obj, prop);
            if (d) {
              const suspicious = [HTMLCanvasElement.prototype,
                                   (window.WebGLRenderingContext && WebGLRenderingContext.prototype),
                                   (window.WebGL2RenderingContext && WebGL2RenderingContext.prototype)];
              for (let st of suspicious) {
                if (!st) continue;
                if (obj === st && (prop === 'getContext' || prop === 'getParameter' || prop === 'getExtension' || prop === 'getSupportedExtensions')) {
                  d.enumerable = false; d.configurable = true; d.writable = true;
                  try { d.value = obj[prop]; } catch(e){}
                }
              }
            }
            return d;
          } catch(e) { return origGetOwnPropertyDescriptor.call(Object, obj, prop); }
        }, 'getOwnPropertyDescriptor'),
        configurable: true, enumerable: false, writable: true
      });

      Object.defineProperty(Object, 'getOwnPropertyNames', {
        value: makeNativeFunction(function(obj) {
          try {
            const names = origGetOwnPropertyNames.call(Object, obj);
            if (obj === HTMLCanvasElement.prototype || obj === (window.WebGLRenderingContext && WebGLRenderingContext.prototype) || obj === (window.WebGL2RenderingContext && WebGL2RenderingContext.prototype)) {
              ['getContext','getParameter','getExtension','getSupportedExtensions'].forEach(k => { if (!names.includes(k)) names.push(k); });
            }
            return names;
          } catch(e) { return origGetOwnPropertyNames.call(Object, obj); }
        }, 'getOwnPropertyNames'),
        configurable: true, enumerable: false, writable: true
      });

      Object.defineProperty(Reflect, 'ownKeys', {
        value: makeNativeFunction(function(obj) {
          try {
            const keys = origReflectOwnKeys.call(Reflect, obj);
            if (obj === HTMLCanvasElement.prototype || obj === (window.WebGLRenderingContext && WebGLRenderingContext.prototype) || obj === (window.WebGL2RenderingContext && WebGL2RenderingContext.prototype)) {
              ['getContext','getParameter','getExtension','getSupportedExtensions'].forEach(k => { if (!keys.includes(k)) keys.push(k); });
            }
            return keys;
          } catch(e) { return origReflectOwnKeys.call(Reflect, obj); }
        }, 'ownKeys'),
        configurable: true, enumerable: false, writable: true
      });

    } catch(e){}
  })();

  // ===== Navigator-level spoofing =========================================
  (function patchNavigatorAPIs() {
    try {
      // hardwareConcurrency: choose a plausible value (2,4,6,8)
      const plausibleHC = [2,4,6,8,12];
      const hc = plausibleHC[(SESSION_SALT % plausibleHC.length)];
      try {
        Object.defineProperty(navigator, 'hardwareConcurrency', { value: hc, configurable: true, enumerable: false });
      } catch(e){}

      // deviceMemory: common values 0.5,1,2,4,8
      const plausibleDM = [0.5,1,2,4,8];
      const dm = plausibleDM[(SESSION_SALT % plausibleDM.length)];
      try {
        Object.defineProperty(navigator, 'deviceMemory', { value: dm, configurable: true, enumerable: false });
      } catch(e){}

      // navigator.gpu (WebGPU) : present a safe stub if missing
      if (!('gpu' in navigator)) {
        try {
          const fakeGPU = { 
            // minimal plausible API surface
            getAdapter: makeNativeFunction(function() { return Promise.resolve(null); }, 'getAdapter')
          };
          try { Object.defineProperty(navigator, 'gpu', { value: fakeGPU, configurable: true }); } catch(e){}
        } catch(e){}
      } else {
        // if real exists, don't modify, but could optionally wrap (risky)
      }
    } catch(e){}
  })();

  // ===== Finally: ensure existing contexts are patched once more ==============
  (function finalScanContexts() {
    try {
      const canvases = document.getElementsByTagName ? document.getElementsByTagName('canvas') : [];
      for (let i = 0; i < canvases.length; i++) {
        try {
          const c = canvases[i];
          ['webgl','webgl2','experimental-webgl'].forEach(t => {
            try {
              const ctx = c.getContext(t);
              if (ctx) patchContextInstance(ctx);
            } catch(e){}
          });
        } catch(e){}
      }
    } catch(e){}
  })();

  // ===== End of script - expose small debug API for local testing only =====
  try {
    Object.defineProperty(window, '__wgl_spoof_info_v2', { value: { vendor: spoofedVendor, renderer: spoofedRenderer }, configurable: true });
    // small function to change spoof values during testing
    try {
      Object.defineProperty(window, '__wgl_set_spoof_v2', { value: function(vendor, renderer) { applySpoof(vendor, renderer, true); }, configurable: true });
    } catch(e){}
  } catch(e) {}

})(); `;

document.documentElement.appendChild(webglScript);
// remove the injected script element after it has run (keeps DOM clean)
try { webglScript.remove(); } catch (e) {}
