// Content script entry: listens for messages and orchestrates scan + fill
(() => {
  if (window.__smartFillContentInitialized) return;
  window.__smartFillContentInitialized = true;

  function showToast(text, variant = "info", duration = 3000) {
    let container = document.getElementById("smartfill-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "smartfill-toast-container";
      Object.assign(container.style, {
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: "2147483647",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        pointerEvents: "none",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      });
      document.documentElement.appendChild(container);
    }

    // Clear previous toasts so they don't pile up
    container.innerHTML = "";

    const toast = document.createElement("div");
    const bgColors = {
      loading: "#0f172a",
      success: "#064e3b",
      error: "#7f1d1d",
      info: "#0f172a",
    };
    const borderColors = {
      loading: "#3b82f6",
      success: "#10b981",
      error: "#ef4444",
      info: "#64748b",
    };

    Object.assign(toast.style, {
      backgroundColor: bgColors[variant] || "#0f172a",
      color: "#ffffff",
      border: `1.5px solid ${borderColors[variant] || "#475569"}`,
      borderRadius: "8px",
      padding: "10px 16px",
      fontSize: "13px",
      fontWeight: "500",
      lineHeight: "1.4",
      boxShadow:
        "0 10px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.4)",
      transition: "all 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
      opacity: "0",
      transform: "translateY(-8px) scale(0.96)",
      pointerEvents: "none",
      maxWidth: "360px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });

    toast.textContent = text;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0) scale(1)";
    });

    if (variant !== "loading" && duration > 0) {
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-6px) scale(0.96)";
        setTimeout(() => {
          if (toast.parentElement) toast.remove();
        }, 250);
      }, duration);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "PING") {
      sendResponse({ status: "ok" });
      return true;
    }

    if (message.type === "SHOW_TOAST") {
      showToast(message.text, message.variant, message.duration);
      sendResponse({ success: true });
      return true;
    }

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
