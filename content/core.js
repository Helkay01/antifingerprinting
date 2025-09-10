window.nativeBackups = {
  defineProperty: Object.defineProperty,
  getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  now: performance.now.bind(performance),
  userAgent: navigator.userAgent,
  languages: navigator.languages,
  platform: navigator.platform,
  vendor: navigator.vendor,
  permissionsQuery: navigator.permissions?.query,
  getContext: HTMLCanvasElement.prototype.getContext,
  toDataURL: HTMLCanvasElement.prototype.toDataURL,
  getImageData: CanvasRenderingContext2D.prototype.getImageData,
  enumerateDevices: navigator.mediaDevices?.enumerateDevices,
  RTCPeerConnection: window.RTCPeerConnection || window.webkitRTCPeerConnection,
};

window.makeNativeFunction = function(fn, name) {
  Object.defineProperty(fn, "toString", {
    value: () => `function ${name}() { [native code] }`,
    writable: false,
    configurable: true,
    enumerable: false
  });
  return fn;
};

window.safeGet = function(obj, prop) {
  try { return obj[prop]; } catch { return undefined; }
};
