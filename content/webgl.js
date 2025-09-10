function patchWebGL(gl) {
  const spoofedVendor = "Google Inc.";
  const spoofedRenderer = "ANGLE (Qualcomm, Adreno (TM) 740...)";
  const debugInfo = {
    UNMASKED_VENDOR_WEBGL: 0x9245,
    UNMASKED_RENDERER_WEBGL: 0x9246
  };

  const origGetParameter = gl.getParameter.bind(gl);
  gl.getParameter = makeNativeFunction(function(param) {
    if (param === gl.VENDOR || param === debugInfo.UNMASKED_VENDOR_WEBGL) return spoofedVendor;
    if (param === gl.RENDERER || param === debugInfo.UNMASKED_RENDERER_WEBGL) return spoofedRenderer;
    return origGetParameter(param);
  }, "getParameter");

  const origGetExtension = gl.getExtension.bind(gl);
  gl.getExtension = makeNativeFunction(function(name) {
    if (name === "WEBGL_debug_renderer_info") return debugInfo;
    return origGetExtension(name);
  }, "getExtension");
}

const origGetContext = window.nativeBackups.getContext;
HTMLCanvasElement.prototype.getContext = makeNativeFunction(function(type, attrs) {
  const context = origGetContext.call(this, type, attrs);
  if (type === "webgl" || type === "experimental-webgl") {
    patchWebGL(context);
  }
  return context;
}, "getContext");
