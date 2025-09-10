if (navigator.mediaDevices && window.nativeBackups.enumerateDevices) {
  navigator.mediaDevices.enumerateDevices = makeNativeFunction(async function() {
    return [
      { deviceId: "default", kind: "audioinput", label: "Built-in Mic", groupId: "1" },
      { deviceId: "default", kind: "videoinput", label: "Built-in Cam", groupId: "1" }
    ];
  }, "enumerateDevices");
}
