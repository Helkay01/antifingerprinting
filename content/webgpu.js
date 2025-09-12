(() => {
  'use strict';

  // ------------------- CONFIG -------------------
  const BLOCK_WEBGPU = true;        // Block WebGPU completely
  const FAKE_UNSUPPORTED = true;    // Simulate real "unsupported" behavior
  const LOGGING = false;            // Debug logging
  // ----------------------------------------------

  const debug = (...args) => { if (LOGGING) console.log('[WebGPU Stealth]', ...args); };

  // ------------------- ERRORS -------------------
  class NotSupportedError extends Error {
    constructor(msg = 'WebGPU is not supported on this system.') {
      super(msg);
      this.name = 'NotSupportedError';
    }
  }

  // ------------------- FAKE GPU OBJECTS -------------------
  const createFakeGPU = () => {
    const fakeAdapterProto = {};
    const fakeAdapter = Object.create(fakeAdapterProto, {
      requestDevice: {
        value: async () => { debug('requestDevice called'); throw new NotSupportedError(); },
        writable: false,
        configurable: true,
        enumerable: true
      },
      name: { value: 'Unavailable GPU', configurable: true, enumerable: true },
      features: { value: new Set(), configurable: true, enumerable: true },
      limits: { value: {}, configurable: true, enumerable: true },
      toString: { value: () => '[object GPUAdapter]', configurable: true, enumerable: false }
    });

    const fakeGPUProto = {};
    const fakeGPU = Object.create(fakeGPUProto, {
      requestAdapter: {
        value: async () => { debug('requestAdapter called'); return FAKE_UNSUPPORTED ? null : fakeAdapter; },
        writable: false,
        configurable: true,
        enumerable: true
      },
      toString: { value: () => '[object GPU]', configurable: true, enumerable: false }
    });

    // Seal prototypes
    Object.seal(fakeAdapterProto);
    Object.seal(fakeAdapter);
    Object.seal(fakeGPUProto);
    Object.seal(fakeGPU);

    return { fakeGPU, fakeAdapter, fakeGPUProto, fakeAdapterProto };
  };

  // ------------------- STEALTH PROPERTY DEFINITION -------------------
  const stealthDefine = (obj, prop, value) => {
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set() { debug(`Attempt to overwrite ${prop} ignored`); },
    });
  };

  // ------------------- ENUMERATION SPOOF -------------------
  const patchEnumeration = (target, prop) => {
    const originalKeys = Object.keys;
    const originalNames = Object.getOwnPropertyNames;
    const originalReflectKeys = Reflect.ownKeys;
    const originalHas = Object.prototype.hasOwnProperty;

    Object.keys = function(obj) {
      if (obj === target) return [...originalKeys(obj).filter(k => k !== prop), prop];
      return originalKeys(obj);
    };

    Object.getOwnPropertyNames = function(obj) {
      if (obj === target) return [...originalNames(obj).filter(k => k !== prop), prop];
      return originalNames(obj);
    };

    Reflect.ownKeys = function(obj) {
      if (obj === target) return [...originalReflectKeys(obj).filter(k => k !== prop), prop];
      return originalReflectKeys(obj);
    };

    Object.prototype.hasOwnProperty = function(key) {
      if (this === target && key === prop) return true;
      return originalHas.call(this, key);
    };

    debug(`Enumeration patched for ${prop}`);
  };

  // ------------------- FUNCTION.TOSTRING HARDENING -------------------
  const patchFunctionToString = (target, name) => {
    const nativeToString = Function.prototype.toString;
    Function.prototype.toString = new Proxy(nativeToString, {
      apply(targetFn, thisArg, args) {
        if (!thisArg) return nativeToString.apply(thisArg, args);
        if (thisArg === target) return `function ${name}() { [native code] }`;
        if (target.__stealthFunctions && target.__stealthFunctions.has(thisArg)) {
          return `function ${thisArg.__stealthName}() { [native code] }`;
        }
        return nativeToString.apply(thisArg, args);
      }
    });
  };

  // ------------------- DESCRIPTOR HARDENING -------------------
  const patchDescriptors = (target, prop, value) => {
    const originalGetDesc = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = new Proxy(originalGetDesc, {
      apply(targetFn, thisArg, args) {
        const [obj, key] = args;
        if ((obj === target || obj === target.constructor?.prototype) && key === prop) {
          return { configurable: true, enumerable: true, get: () => value };
        }
        return originalGetDesc.apply(targetFn, args);
      }
    });
  };

  // ------------------- APPLY PATCHES -------------------
  if (BLOCK_WEBGPU) {
    const { fakeGPU, fakeAdapter, fakeGPUProto, fakeAdapterProto } = createFakeGPU();

    // Attach fakeGPU to navigator
    stealthDefine(navigator, 'gpu', fakeGPU);
    stealthDefine(Navigator.prototype, 'gpu', fakeGPU);

    // Patch enumeration
    patchEnumeration(navigator, 'gpu');
    patchEnumeration(Navigator.prototype, 'gpu');

    // Prototype chain spoofing
    Object.setPrototypeOf(fakeGPU, fakeGPUProto);
    Object.setPrototypeOf(fakeAdapter, fakeAdapterProto);

    // Patch function.toString
    fakeGPU.__stealthFunctions = new WeakSet();
    fakeGPU.requestAdapter.__stealthName = 'requestAdapter';
    fakeGPU.__stealthFunctions.add(fakeGPU.requestAdapter);

    fakeAdapter.requestDevice.__stealthName = 'requestDevice';
    fakeGPU.__stealthFunctions.add(fakeAdapter.requestDevice);

    patchFunctionToString(fakeGPU, 'GPU');

    // Patch getOwnPropertyDescriptor
    patchDescriptors(navigator, 'gpu', fakeGPU);
    patchDescriptors(Navigator.prototype, 'gpu', fakeGPU);

    // Freeze spoofed objects but appear unfrozen
    Object.freeze(fakeGPU);
    Object.freeze(fakeAdapter);
    const origIsFrozen = Object.isFrozen;
    Object.isFrozen = function(obj) {
      if (obj === navigator.gpu || obj === Navigator.prototype.gpu) return false;
      return origIsFrozen(obj);
    };

    debug('navigator.gpu fully patched, prototype spoofed, and stealth-hardened ✅');
  }
})();
