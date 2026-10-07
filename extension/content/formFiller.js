// Fills fields with AI-generated values and dispatches input/change events (React-safe)
(() => {
  let lastFillHistory = [];

  function setNativeValue(element, value) {
    let prototype = window.HTMLInputElement.prototype;
    if (element instanceof HTMLTextAreaElement) {
      prototype = window.HTMLTextAreaElement.prototype;
    } else if (element instanceof HTMLSelectElement) {
      prototype = window.HTMLSelectElement.prototype;
    }

    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setNativeChecked(element, checked) {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "checked",
    );
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, checked);
    } else {
      element.checked = checked;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlightElement(element) {
    const originalTransition = element.style.transition;
    const originalOutline = element.style.outline;
    element.style.transition = "outline 0.2s ease-in-out";
    element.style.outline = "2px solid #2563eb";
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.transition = originalTransition;
    }, 1500);
  }

  window.SmartFillFiller = {
    applyFill(valuesMap, scope = "empty_only") {
      lastFillHistory = [];
      let filled = 0;
      let skipped = 0;
      let failed = 0;

      for (const [key, value] of Object.entries(valuesMap)) {
        const elements = Array.from(
          document.querySelectorAll(`[data-smartfill-key="${key}"]`),
        );
        if (!elements.length) continue;

        for (const el of elements) {
          try {
            const tag = el.tagName.toLowerCase();
            const type = (el.getAttribute("type") || "").toLowerCase();

            // Scope handling
            if (scope === "empty_only") {
              if (type === "checkbox" && el.checked) {
                skipped++;
                continue;
              }
              if (type === "radio" && el.checked) {
                skipped++;
                continue;
              }
              if (
                type !== "checkbox" &&
                type !== "radio" &&
                el.value &&
                el.value.trim() !== ""
              ) {
                skipped++;
                continue;
              }
            }

            // Save undo snapshot
            lastFillHistory.push({
              element: el,
              wasChecked: el.checked,
              originalValue: el.value,
            });

            if (type === "radio") {
              if (
                String(el.value).toLowerCase() === String(value).toLowerCase()
              ) {
                setNativeChecked(el, true);
                highlightElement(el);
                filled++;
              }
              continue;
            }

            if (type === "checkbox") {
              const shouldCheck = Boolean(value);
              setNativeChecked(el, shouldCheck);
              highlightElement(el);
              filled++;
              continue;
            }

            if (tag === "select") {
              let matchedVal = "";
              for (const opt of el.options) {
                if (
                  opt.value === value ||
                  opt.text.trim().toLowerCase() ===
                    String(value).trim().toLowerCase()
                ) {
                  matchedVal = opt.value;
                  break;
                }
              }
              if (!matchedVal && el.options.length > 0) {
                matchedVal = el.options[0].value;
              }
              setNativeValue(el, matchedVal);
              highlightElement(el);
              filled++;
              continue;
            }

            // Validate pattern constraint if any
            let targetValue = String(value);
            if (el.maxLength > 0) {
              targetValue = targetValue.slice(0, el.maxLength);
            }
            if (el.pattern) {
              const regex = new RegExp(`^${el.pattern}$`);
              if (!regex.test(targetValue)) {
                console.warn(
                  `[SmartFill] Value '${targetValue}' failed pattern '${el.pattern}'. Skipped.`,
                );
                failed++;
                continue;
              }
            }

            setNativeValue(el, targetValue);
            highlightElement(el);
            filled++;
          } catch (err) {
            console.error("[SmartFill Fill Error]", err);
            failed++;
          }
        }
      }

      return { filled, skipped, failed };
    },

    undo() {
      let restoredCount = 0;
      for (const item of lastFillHistory) {
        if (!item.element || !document.body.contains(item.element)) continue;
        if (item.element.type === "checkbox" || item.element.type === "radio") {
          setNativeChecked(item.element, item.wasChecked);
        } else {
          setNativeValue(item.element, item.originalValue);
        }
        restoredCount++;
      }
      lastFillHistory = [];
      return { restored: restoredCount };
    },
  };
})();
