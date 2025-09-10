const OrigRTC = window.nativeBackups.RTCPeerConnection;
if (OrigRTC) {
  function FakeRTC(config) {
    const pc = new OrigRTC(config);
    Object.defineProperty(pc, "onicecandidate", {
      set(cb) {
        this._onicecandidate = function(event) {
          if (event?.candidate?.candidate) {
            const filtered = event.candidate.candidate.replace(
              /(candidate:[^ ]+ [^ ]+ [^ ]+ [^ ]+ )((10|192\.168|172\.(1[6-9]|2[0-9]|3[0-1]))\.[^ ]*)/,
              "$1 0.0.0.0"
            );
            event = new RTCIceCandidate({ candidate: filtered });
          }
          cb?.(event);
        };
        this.addEventListener("icecandidate", this._onicecandidate);
      },
      get() { return this._onicecandidate; },
      configurable: true,
      enumerable: true
    });
    return pc;
  }
  FakeRTC.prototype = OrigRTC.prototype;
  window.RTCPeerConnection = FakeRTC;
}
