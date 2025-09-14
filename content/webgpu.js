const webgpuScript = document.createElement('script');
webgpuScript.textContent = `

(() => {
  'use strict';

  // ------------------- FAKE DATA -------------------
  const adapterLimits = {
    maxTextureDimension1D: 16384,
    maxTextureDimension2D: 16384,
    maxTextureDimension3D: 2048,
    maxTextureArrayLayers: 2048,
    maxBindGroups: 8,
    maxBindGroupsPlusVertexBuffers: 24,
    maxBindingsPerBindGroup: 65535,
    maxDynamicUniformBuffersPerPipelineLayout: 8,
    maxDynamicStorageBuffersPerPipelineLayout: 4,
    maxSampledTexturesPerShaderStage: 64,
    maxSamplersPerShaderStage: 64,
    maxStorageBuffersPerShaderStage: 64,
    maxStorageTexturesPerShaderStage: 64,
    maxUniformBuffersPerShaderStage: 64,
    maxUniformBufferBindingSize: 65536,
    maxStorageBufferBindingSize: 1073741824,
    minUniformBufferOffsetAlignment: 256,
    minStorageBufferOffsetAlignment: 32,
    maxVertexBuffers: 16,
    maxBufferSize: 1073741824,
    maxVertexAttributes: 32,
    maxVertexBufferArrayStride: 2048,
    maxInterStageShaderVariables: 16,
    maxColorAttachments: 8,
    maxColorAttachmentBytesPerSample: 32,
    maxComputeWorkgroupStorageSize: 32768,
    maxComputeInvocationsPerWorkgroup: 768,
    maxComputeWorkgroupSizeX: 1024,
    maxComputeWorkgroupSizeY: 1024,
    maxComputeWorkgroupSizeZ: 64,
    maxComputeWorkgroupsPerDimension: 65535,
    subgroupMaxSize: 128
  };

  const adapterFeatures = new Set([
    'core-features-and-limits',
    'depth-clip-control',
    'depth32float-stencil8',
    'texture-compression-bc',
    'texture-compression-bc-sliced-3d',
    'timestamp-query',
    'indirect-first-instance',
    'shader-f16',
    'rg11b10ufloat-renderable',
    'bgra8unorm-storage',
    'float32-filterable',
    'pointer-composite-access',
    'readonly-and-readwrite-storage-textures'
  ]);

  // ------------------- FAKE GPU DEVICE -------------------
  const createFakeDevice = () => {
    const queueProto = {};
    const queue = Object.create(queueProto, {
      submit: { value: () => {}, writable: false },
      writeBuffer: { value: () => {}, writable: false },
      writeTexture: { value: () => {}, writable: false }
    });

    const deviceProto = {};
    const device = Object.create(deviceProto, {
      queue: { value: queue },
      createShaderModule: { value: () => ({}) },
      createBuffer: { value: () => ({}) },
      createTexture: { value: () => ({}) },
      createSampler: { value: () => ({}) },
      createBindGroup: { value: () => ({}) },
      createBindGroupLayout: { value: () => ({}) },
      createPipelineLayout: { value: () => ({}) },
      createComputePipeline: { value: () => ({}) },
      createRenderPipeline: { value: () => ({}) },
      destroy: { value: () => {} },
      pushErrorScope: { value: async () => {} },
      popErrorScope: { value: async () => {} },
      toString: { value: () => '[object GPUDevice]' }
    });
    Object.freeze(device);
    Object.freeze(queue);
    return device;
  };

  // ------------------- FAKE GPU ADAPTER -------------------
  const fakeAdapterProto = {};
  const fakeAdapter = Object.create(fakeAdapterProto, {
    name: { value: 'Android High-End GPU' },
    features: { value: adapterFeatures },
    limits: { value: adapterLimits },
    isFallbackAdapter: { value: false },
    requestDevice: { value: async () => createFakeDevice(), writable: false },
    toString: { value: () => '[object GPUAdapter]' }
  });
  Object.freeze(fakeAdapter);

  // ------------------- FAKE GPU -------------------
  const fakeGPUProto = {};
  const fakeGPU = Object.create(fakeGPUProto, {
    requestAdapter: { value: async () => fakeAdapter, writable: false },
    getPreferredCanvasFormat: { value: () => 'bgra8unorm', writable: false },
    toString: { value: () => '[object GPU]' }
  });
  Object.freeze(fakeGPU);

  // ------------------- STEALTH DEFINITIONS -------------------
  const stealthDefine = (obj, prop, value) => {
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: false, // Set enumerable to false to hide property from enumerations
      get: () => value,
      set: () => {}
    });
  };
  stealthDefine(navigator, 'gpu', fakeGPU);
  stealthDefine(Navigator.prototype, 'gpu', fakeGPU);

  // ------------------- PATCH ENUMERATION -------------------
  const patchEnumeration = (obj, prop) => {
    const originalKeys = Object.keys;
    const originalNames = Object.getOwnPropertyNames;
    const originalReflectKeys = Reflect.ownKeys;

    // Avoid adding the 'gpu' property during enumeration
    Object.keys = (target) => {
      if (target === obj) {
        return [...originalKeys(target)].filter(key => key !== prop);
      }
      return originalKeys(target);
    };

    Object.getOwnPropertyNames = (target) => {
      if (target === obj) {
        return [...originalNames(target)].filter(name => name !== prop);
      }
      return originalNames(target);
    };

    Reflect.ownKeys = (target) => {
      if (target === obj) {
        return [...originalReflectKeys(target)].filter(key => key !== prop);
      }
      return originalReflectKeys(target);
    };
  };
  patchEnumeration(navigator, 'gpu');
  patchEnumeration(Navigator.prototype, 'gpu');

  // ------------------- FUNCTION.TOSTRING HARDENING -------------------
  const patchFunctionToString = (target, name) => {
    const origToString = Function.prototype.toString;

    Function.prototype.toString = new Proxy(origToString, {
      apply(fn, thisArg, args) {
        if (thisArg === target) return \`function \${name}() { [native code] }\`;
        return origToString.apply(fn, [thisArg, ...args]);
      }
    });
  };
  patchFunctionToString(fakeGPU, 'GPU');
  patchFunctionToString(fakeAdapter, 'GPUAdapter');

  // ------------------- SILENT FALLBACK FOR UNDEFINED BEHAVIORS -------------------
  const silentFallback = (func) => {
    return (...args) => {
      try {
        return func(...args);
      } catch (e) {
        // Prevent any error exposure
        return undefined;
      }
    };
  };

  // Override potentially faulty methods
  const fakeDevice = createFakeDevice();
  fakeDevice.createBuffer = silentFallback(fakeDevice.createBuffer);
  fakeDevice.createTexture = silentFallback(fakeDevice.createTexture);
  fakeDevice.createShaderModule = silentFallback(fakeDevice.createShaderModule);

})();
`;

document.documentElement.appendChild(webgpuScript);
try {  
  // webgpuScript.remove(); 
} 
catch(e) {}
