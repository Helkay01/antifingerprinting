(() => {
    "use strict";

    // --- Configuration ---
    const ROTATION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
    const STORAGE_KEY = 'android_bfp_config';

    // Android-specific plausible values
    const ANDROID_GPU_VENDORS = ['ARM'];
    const ANDROID_GPU_RENDERERS = [
        "Mali-G52",
        "Mali-G57",
        "Mali-G68",
        "Mali-G710",
        "Mali-G715",
        "Mali-G720",
        "Mali-400",
    "Mali-400 MP1",
    "Mali-400 MP2",
    "Mali-400 MP4",
    "Mali-450 MP4",
    "Mali-G51 MP2",
    "Mali-G51 MP4",
    "Mali-G52",
    "Mali-G52 3EE",
    "Mali-G52 MC2",
    "Mali-G52 MP1",
    "Mali-G52 MP6",
    "Mali-G57",
    "Mali-G57 MC1",
    "Mali-G57 MC2",
    "Mali-G57 MC3",
    "Mali-G57 MP1",
    "Mali-G57 MP4",
    "Mali-G57 MP5",
    "Mali-G57 MP6",
    "Mali-G610 MC4",
    "Mali-G610 MC6",
    "Mali-G615 MC2",
    "Mali-G615 MC6",
    "Mali-G68",
    "Mali-G68 MC4",
    "Mali-G68 MP2",
    "Mali-G68 MP5",
    "Mali-G71 MP1",
    "Mali-G71 MP2",
    "Mali-G71 MP20",
    "Mali-G71 MP8",
    "Mali-G710 MC10",
    "Mali-G710 MP07",
    "Mali-G715 MC7",
    "Mali-G72 MP12",
    "Mali-G72 MP18",
    "Mali-G72 MP3",
    "Mali-G720 MC7",
    "Mali-G76 MC16",
    "Mali-G76 MC4",
    "Mali-G76 MP10",
    "Mali-G76 MP12",
    "Mali-G76 MP14",
    "Mali-G76 MP5",
    "Mali-G77",
    "Mali-G77 MC7",
    "Mali-G77 MC9",
    "Mali-G77 MP11",
    "Mali-G78 MP10",
    "Mali-G78 MP14",
    "Mali-G78 MP14",
    "Mali-G78 MP24",
    "Mali-T624",
    "Mali-T628 MP4",
    "Mali-T628 MP6",
    "Mali-T720",
    "Mali-T720 MP1",
    "Mali-T720 MP2",
    "Mali-T720 MP3",
    "Mali-T760",
    "Mali-T760 MP2",
    "Mali-T760 MP8",
    "Mali-T820 MP1",
    "Mali-T830 MP1",
    "Mali-T830 MP2",
    "Mali-T830 MP3",
    "Mali-T860 MP2",
    "Mali-T880 MP10",
    "Mali-T880 MP12",
    "Mali-T880 MP2",
    "Mali-T880 MP4",
    "Mali-G52 MC1",
    "Mali-G57 MC4",
    "Mali-T860 MP4"
    ];
    const ANDROID_DRIVER_SUFFIXES = ['OpenGL ES 3.2'];

    // --- Utilities ---
    const nativeToString = Function.prototype.toString;
    const MathRandom = Math.random;
    const _DateNow = Date.now;
    const _PerformanceNow = performance.now.bind(performance);

    // High-quality seeded PRNG (sfc32) for deterministic noise
    function createSfc32(a, b, c, d) {
        return function() {
            a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
            let t = (a + b) | 0;
            a = b ^ (b >>> 9);
            b = (c + (c << 3)) | 0;
            c = (c << 21) | (c >>> 11);
            d = (d + 1) | 0;
            t = (t + d) | 0;
            c = (c + t) | 0;
            return (t >>> 0) / 4294967296;
        };
    }

    function makeNative(fn, name) {
        const fnStr = `function ${name || ""}() { [native code] }`.trim();
        Object.defineProperty(fn, "toString", {
            value: () => fnStr,
            writable: false,
            configurable: true,
            enumerable: false
        });
        return fn;
    }

    function getFingerprintSeed() {
        let config;
        try {
            config = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        } catch (e) { /* Ignore */ }

        const currentTimeBlock = Math.floor(Date.now() / ROTATION_TTL_MS);
        const siteKey = `${location.hostname}`;

        if (!config || config.timeBlock !== currentTimeBlock || config.siteKey !== siteKey) {
            const androidId = Array.from({ length: 16 }, () => '0123456789abcdef'[Math.floor(MathRandom() * 16)]).join('');
            const seed = androidId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            
            config = {
                siteKey: siteKey,
                timeBlock: currentTimeBlock,
                persistentSeed: androidId,
                prngSeed: [0x9E3779B9, 0x243F6A88, 0xB7E15162, seed], // Seeds for sfc32
                gpuVendor: ANDROID_GPU_VENDORS[Math.floor(MathRandom() * ANDROID_GPU_VENDORS.length)],
                gpuRenderer: ANDROID_GPU_RENDERERS[Math.floor(MathRandom() * ANDROID_GPU_RENDERERS.length)],
                driverSuffix: ANDROID_DRIVER_SUFFIXES[Math.floor(MathRandom() * ANDROID_DRIVER_SUFFIXES.length)],
                mediaDeviceId: `android-${androidId.slice(0, 8)}`,
                webglExtensions: null,
                webglMaxTextureSize: 4096, // Common mobile value
                webglVendor: 'WebKit', // Common WebGL vendor for mobile Chrome
                webglVersion: 'WebGL 2.0 (OpenGL ES 3.2 Chromium)'
            };
            saveFingerprintSeed(config);
        }
        config.deterministicRandom = createSfc32(...config.prngSeed);
        return config;
    }

    function saveFingerprintSeed(config) {
        // Remove the function before saving
        const { deterministicRandom, ...saveableConfig } = config;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saveableConfig));
        } catch (e) { /* Ignore quota errors */ }
    }

    // --- Critical: Early Function.prototype.toString Protection ---
    function protectFunctionToString() {
        const originalToString = Function.prototype.toString;
        let isLocked = false;

        Function.prototype.toString = new Proxy(originalToString, {
            apply: function(target, thisArg, args) {
                // Allow our own nativized functions to pass through
                if (thisArg && thisArg.toString && thisArg.toString !== originalToString) {
                    try {
                        const result = thisArg.toString();
                        if (result.includes('[native code]')) {
                            return result;
                        }
                    } catch (e) {}
                }
                return target.apply(thisArg, args);
            }
        });

        // Mark as locked to prevent re-patching
        Object.defineProperty(Function.prototype.toString, '__locked', {
            value: true,
            writable: false,
            configurable: false,
            enumerable: false
        });
    }

    // --- Advanced GPU Spoofing with Timing ---
    function createFakeGPUEnvironment(config) {
        const adapterLimits = {
            maxTextureDimension1D: 8192,
            maxTextureDimension2D: 8192,
            maxTextureDimension3D: 2048,
            maxTextureArrayLayers: 256,
            maxBindGroups: 4,
            maxBindingsPerBindGroup: 1000,
            maxDynamicUniformBuffersPerPipelineLayout: 8,
            maxDynamicStorageBuffersPerPipelineLayout: 4,
            maxSampledTexturesPerShaderStage: 16,
            maxSamplersPerShaderStage: 16,
            maxStorageBuffersPerShaderStage: 8,
            maxStorageTexturesPerShaderStage: 8,
            maxUniformBuffersPerShaderStage: 12,
            maxUniformBufferBindingSize: 65536,
            maxStorageBufferBindingSize: 67108864,
            minUniformBufferOffsetAlignment: 256,
            minStorageBufferOffsetAlignment: 32,
            maxVertexBuffers: 8,
            maxBufferSize: 134217728,
            maxVertexAttributes: 16,
            maxVertexBufferArrayStride: 2048,
            maxInterStageShaderComponents: 32,
            maxColorAttachments: 4,
            maxComputeWorkgroupStorageSize: 16384,
            maxComputeInvocationsPerWorkgroup: 256,
            maxComputeWorkgroupSizeX: 256,
            maxComputeWorkgroupSizeY: 256,
            maxComputeWorkgroupSizeZ: 64,
            maxComputeWorkgroupsPerDimension: 65535,
        };

        const adapterFeatures = new Set([
            'depth-clip-control',
            'timestamp-query',
            'shader-f16',
            'texture-compression-etc2',
            'texture-compression-astc',
            'indirect-first-instance',
            'rg11b10ufloat-renderable',
        ]);

        const createFakeDevice = () => {
            const queue = {
                submit: makeNative(() => { }, "submit"),
                writeBuffer: makeNative(() => { }, "writeBuffer"),
                writeTexture: makeNative(() => { }, "writeTexture"),
                onSubmittedWorkDone: makeNative(async () => { }, "onSubmittedWorkDone")
            };

            const device = {
                lost: Promise.resolve({ reason: "destroyed", message: "Device was destroyed." }),
                features: adapterFeatures,
                limits: adapterLimits,
                queue: queue,
                createShaderModule: makeNative(() => ({}), "createShaderModule"),
                createBuffer: makeNative(() => ({}), "createBuffer"),
                createTexture: makeNative(() => ({}), "createTexture"),
                createSampler: makeNative(() => ({}), "createSampler"),
                createBindGroupLayout: makeNative(() => ({}), "createBindGroupLayout"),
                createPipelineLayout: makeNative(() => ({}), "createPipelineLayout"),
                createRenderPipeline: makeNative(() => ({}), "createRenderPipeline"),
                createComputePipeline: makeNative(() => ({}), "createComputePipeline"),
                destroy: makeNative(() => { }, "destroy"),
                pushErrorScope: makeNative(async () => { }, "pushErrorScope"),
                popErrorScope: makeNative(async () => null, "popErrorScope"),
            };
            Object.defineProperty(device, Symbol.toStringTag, { value: 'GPUDevice' });
            Object.defineProperty(device, 'toString', {
                value: () => '[object GPUDevice]',
                enumerable: false
            });
            return device;
        };

        const spoofedAdapter = {
            name: `${config.gpuRenderer}`,
            features: adapterFeatures,
            limits: adapterLimits,
            isFallbackAdapter: false,
            requestDevice: makeNative(async () => {
                // Add realistic delay (5-20ms)
                const start = _PerformanceNow();
                await new Promise(resolve => setTimeout(resolve, 5 + config.deterministicRandom() * 15));
                const device = createFakeDevice();
                // Simulate some internal processing time
                const elapsed = _PerformanceNow() - start;
                if (elapsed < 5) {
                    await new Promise(resolve => setTimeout(resolve, 5 - elapsed));
                }
                return device;
            }, "requestDevice"),
        };
        Object.defineProperty(spoofedAdapter, Symbol.toStringTag, { value: 'GPUAdapter' });
        Object.defineProperty(spoofedAdapter, 'toString', {
            value: () => '[object GPUAdapter]',
            enumerable: false
        });

        const spoofedGPU = {
            requestAdapter: makeNative(async () => {
                // Add realistic delay (2-10ms)
                await new Promise(resolve => setTimeout(resolve, 2 + config.deterministicRandom() * 8));
                return spoofedAdapter;
            }, "requestAdapter"),
            getPreferredCanvasFormat: makeNative(() => 'bgra8unorm', "getPreferredCanvasFormat"),
            wgslLanguageFeatures: new Set(['readonly_and_readwrite', 'packed_4x8_integer_dot_product'])
        };
        Object.defineProperty(spoofedGPU, Symbol.toStringTag, { value: 'GPU' });
        Object.defineProperty(spoofedGPU, 'toString', {
            value: () => '[object GPU]',
            enumerable: false
        });

        return spoofedGPU;
    }

    function patchGPU() {
        if (!('gpu' in Navigator.prototype)) return;
        const config = getFingerprintSeed();
        const spoofedGPU = createFakeGPUEnvironment(config);

        const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'gpu');
        
        // Create a property descriptor that mimics the original but with our getter
        const newDescriptor = {
            configurable: originalDescriptor ? originalDescriptor.configurable : true,
            enumerable: originalDescriptor ? originalDescriptor.enumerable : true, // CRITICAL: Match original enumerability
            get: makeNative(() => spoofedGPU, `get gpu`),
            set: originalDescriptor ? originalDescriptor.set : undefined
        };

        Object.defineProperty(navigator, 'gpu', newDescriptor);
        Object.defineProperty(Navigator.prototype, 'gpu', newDescriptor);
    }

    // --- Comprehensive WebGL Spoofing ---
    function patchWebGL() {
        const config = getFingerprintSeed();
        
        // Generate plausible WebGL extensions based on GPU profile
        const baseExtensions = [
            'EXT_color_buffer_float',
            'EXT_texture_filter_anisotropic',
            'OES_texture_float_linear',
            'WEBGL_compressed_texture_astc',
            'WEBGL_compressed_texture_etc',
            'WEBGL_compressed_texture_etc1',
            'WEBGL_debug_renderer_info',
            'WEBGL_debug_shaders',
            'WEBGL_depth_texture',
            'WEBGL_draw_buffers',
            'WEBGL_lose_context'
        ];

        if (!config.webglExtensions) {
            config.webglExtensions = [...baseExtensions];
            // Randomly add/remove some extensions for variety
            if (config.deterministicRandom() > 0.7) config.webglExtensions.push('WEBGL_compressed_texture_pvrtc');
            if (config.deterministicRandom() > 0.8) config.webglExtensions.push('WEBGL_compressed_texture_s3tc');
            saveFingerprintSeed(config);
        }

        const origGetParameter = WebGLRenderingContext.prototype.getParameter;
        const origGetSupportedExtensions = WebGLRenderingContext.prototype.getSupportedExtensions;
        const origGetShaderPrecisionFormat = WebGLRenderingContext.prototype.getShaderPrecisionFormat;

        WebGLRenderingContext.prototype.getParameter = makeNative(function(p) {
            const UNMASKED_VENDOR_WEBGL = 37445;
            const UNMASKED_RENDERER_WEBGL = 37446;
            const VERSION = 7938;
            const SHADING_LANGUAGE_VERSION = 35724;
            const MAX_TEXTURE_SIZE = 3379;

            switch (p) {
                case UNMASKED_VENDOR_WEBGL:
                    return config.gpuVendor;
                case UNMASKED_RENDERER_WEBGL:
                    return config.gpuRenderer;
                case VERSION:
                    return config.webglVersion;
                case SHADING_LANGUAGE_VERSION:
                    return 'WebGL GLSL ES 3.20 (WebGL 2.0 Chromium)';
                case MAX_TEXTURE_SIZE:
                    return config.webglMaxTextureSize;
                default:
                    return origGetParameter.call(this, p);
            }
        }, "getParameter");

        WebGLRenderingContext.prototype.getSupportedExtensions = makeNative(function() {
            return config.webglExtensions;
        }, "getSupportedExtensions");

        WebGLRenderingContext.prototype.getShaderPrecisionFormat = makeNative(function(type, precisionType) {
            const realFormat = origGetShaderPrecisionFormat.call(this, type, precisionType);
            if (realFormat) {
                // Slightly perturb the values for fingerprinting
                return {
                    rangeMin: realFormat.rangeMin,
                    rangeMax: realFormat.rangeMax + (config.deterministicRandom() > 0.5 ? 1 : 0),
                    precision: realFormat.precision
                };
            }
            return realFormat;
        }, "getShaderPrecisionFormat");
    }

    // --- Stealthier Canvas Fingerprinting ---
    function patchCanvas() {
        const config = getFingerprintSeed();

        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = makeNative(function(x, y, w, h) {
            const data = origGetImageData.call(this, x, y, w, h);
            // Add subtle, deterministic noise
            for (let i = 0; i < data.data.length; i += 4) {
                const noise = config.deterministicRandom() * 0.8 - 0.4; // -0.4 to +0.4
                data.data[i] = Math.max(0, Math.min(255, data.data[i] + noise));     // R
                data.data[i + 1] = Math.max(0, Math.min(255, data.data[i + 1] + noise)); // G
                data.data[i + 2] = Math.max(0, Math.min(255, data.data[i + 2] + noise)); // B
            }
            return data;
        }, "getImageData");
    }

    // --- Correct Media Devices Spoofing ---
    function patchMediaDevices() {
        if (!navigator.mediaDevices) return;
        const config = getFingerprintSeed();

        const fakeDevices = [
            { kind: "audioinput", label: "", deviceId: config.mediaDeviceId, groupId: `group-${config.mediaDeviceId}` },
            { kind: "audiooutput", label: "", deviceId: config.mediaDeviceId, groupId: `group-${config.mediaDeviceId}` },
            { kind: "videoinput", label: "", deviceId: config.mediaDeviceId, groupId: `group-${config.mediaDeviceId}` }
        ];

        const origEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = makeNative(async () => {
            const realDevices = await origEnumerateDevices.call(navigator.mediaDevices);
            // Always return blank labels regardless of permission state
            return realDevices.length > 0 && realDevices.some(d => d.deviceId && d.deviceId !== 'default') 
                ? realDevices.map(d => ({ ...d, label: '' })) 
                : fakeDevices;
        }, "enumerateDevices");

        const origGetUserMedia = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = makeNative(async (constraints) => {
            // Return a promise that never resolves instead of rejecting
            return new Promise(() => {});
        }, "getUserMedia");
    }

    // --- AudioContext Fingerprint Spoofing ---
    function patchAudio() {
        if (!window.AudioContext) return;
        
        const OrigAudioContext = window.AudioContext;
        const config = getFingerprintSeed();
        
        window.AudioContext = makeNative(function() {
            const ctx = new OrigAudioContext();
            
            const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
            const origGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;
            const origGetByteTimeDomainData = AnalyserNode.prototype.getByteTimeDomainData;
            
            AnalyserNode.prototype.getFloatFrequencyData = makeNative(function(array) {
                origGetFloatFrequencyData.call(this, array);
                for (let i = 0; i < array.length; i++) {
                    array[i] += (config.deterministicRandom() - 0.5) * 0.5;
                }
            }, "getFloatFrequencyData");
            
            AnalyserNode.prototype.getByteFrequencyData = makeNative(function(array) {
                origGetByteFrequencyData.call(this, array);
                for (let i = 0; i < array.length; i++) {
                    array[i] = Math.max(0, Math.min(255, array[i] + (config.deterministicRandom() - 0.5) * 2));
                }
            }, "getByteFrequencyData");
            
            AnalyserNode.prototype.getByteTimeDomainData = makeNative(function(array) {
                origGetByteTimeDomainData.call(this, array);
                for (let i = 0; i < array.length; i++) {
                    array[i] = Math.max(0, Math.min(255, array[i] + (config.deterministicRandom() - 0.5) * 2));
                }
            }, "getByteTimeDomainData");
            
            return ctx;
        }, "AudioContext");
        
        // Also patch OfflineAudioContext
        if (window.OfflineAudioContext) {
            const OrigOfflineAudioContext = window.OfflineAudioContext;
            window.OfflineAudioContext = makeNative(function() {
                return new OrigOfflineAudioContext(...arguments);
            }, "OfflineAudioContext");
        }
    }

    // --- Apply All Patches Stealthily ---
    function applyPatches() {
        const patches = [protectFunctionToString, patchGPU, patchWebGL, patchCanvas, patchMediaDevices, patchAudio];
        
        patches.forEach((patch, index) => {
            setTimeout(() => {
                try { 
                    patch(); 
                } catch (e) { 
                    // Silent catch
                }
            }, index * 50 + Math.floor(Math.random() * 30)); // Randomize timing
        });
    }

    // --- Execution ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyPatches, { once: true });
    } else {
        setTimeout(applyPatches, 100);
    }

})();