// Content script entry: listens for messages and orchestrates scan + fill
(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SCAN_FORM") {
      const result = window.SmartFillScanner.scan(
        message.singleTarget || false,
      );
      sendResponse(result);
      return true;
    }

    if (message.type === "APPLY_FILL") {
      const report = window.SmartFillFiller.applyFill(
        message.values,
        message.scope,
      );
      sendResponse(report);
      return true;
    }

    if (message.type === "UNDO_FILL") {
      const report = window.SmartFillFiller.undo();
      sendResponse(report);
      return true;
    }
  });
})();
