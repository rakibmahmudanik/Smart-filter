(() => {
  const SENSITIVE_KEYWORDS =
    /password|passwd|passcode|cvv|cvc|creditcard|cardnum|otp|token|ssn|secret|pin/i;
  let lastRightClickedElement = null;

  // Track the right-clicked element
  document.addEventListener(
    "contextmenu",
    (event) => {
      lastRightClickedElement = event.target;
    },
    true,
  );

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function humanizeName(str) {
    if (!str) return "";
    return str
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]/g, " ")
      .trim();
  }

  function resolveLabel(el) {
    if (el.id) {
      const explicitLabel = document.querySelector(
        `label[for="${CSS.escape(el.id)}"]`,
      );
      if (explicitLabel && explicitLabel.innerText.trim()) {
        return explicitLabel.innerText.trim();
      }
    }

    const wrappingLabel = el.closest("label");
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone
        .querySelectorAll("input, select, textarea, button")
        .forEach((c) => c.remove());
      const text = clone.innerText.trim();
      if (text) return text;
    }

    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const refEl = document.getElementById(ariaLabelledBy);
      if (refEl && refEl.innerText.trim()) return refEl.innerText.trim();
    }

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();
    if (el.title && el.title.trim()) return el.title.trim();

    if (el.name) return humanizeName(el.name);
    if (el.id) return humanizeName(el.id);

    return "Field";
  }

  function isSensitive(el) {
    if (el.type === "password") return true;
    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (
      autocomplete.includes("cc-") ||
      autocomplete.includes("one-time-code") ||
      autocomplete.includes("password")
    ) {
      return true;
    }
    const testString = `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""}`;
    return SENSITIVE_KEYWORDS.test(testString);
  }

  function getPageContext() {
    const nearestHeading = document.querySelector("h1, h2, h3");
    const activeForm = document.querySelector("form");
    return {
      title: document.title || "",
      hostname: window.location.hostname || "",
      heading: nearestHeading
        ? nearestHeading.innerText.trim().slice(0, 80)
        : "",
      formAction: activeForm ? activeForm.getAttribute("action") || "" : "",
      formIdOrClass: activeForm
        ? `${activeForm.id || ""} ${activeForm.className || ""}`
            .trim()
            .slice(0, 60)
        : "",
    };
  }

  window.SmartFillScanner = {
    scan(singleTarget = false) {
      const pageContext = getPageContext();

      // If singleTarget is requested via context menu
      if (singleTarget && lastRightClickedElement) {
        const el = lastRightClickedElement;
        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        if (["input", "textarea", "select"].includes(tag) && !isSensitive(el)) {
          const key = "f_single_0";
          el.dataset.smartfillKey = key;
          let options = null;
          if (tag === "select") {
            options = Array.from(el.options)
              .filter((o) => o.value && !o.disabled)
              .map((o) => ({ value: o.value, text: o.text.trim() }));
          }

          return {
            fields: [
              {
                key,
                tag,
                type: (
                  el.getAttribute("type") ||
                  (tag === "select" ? "select" : "text")
                ).toLowerCase(),
                label: resolveLabel(el),
                placeholder: el.placeholder || "",
                name: el.name || "",
                id: el.id || "",
                autocomplete: el.getAttribute("autocomplete") || "",
                required: el.required || false,
                maxLength: el.maxLength > 0 ? el.maxLength : null,
                min: el.getAttribute("min"),
                max: el.getAttribute("max"),
                pattern: el.getAttribute("pattern"),
                options,
                current_value: el.value || "",
              },
            ],
            pageContext,
          };
        }
      }

      // Default: Scan entire form
      const elements = Array.from(
        document.querySelectorAll("input, textarea, select"),
      );
      const descriptors = [];
      const radioGroups = new Map();
      let keyCounter = 0;

      for (const el of elements) {
        if (!isVisible(el) || el.disabled || el.readOnly) continue;
        if (
          ["hidden", "submit", "button", "reset", "image", "file"].includes(
            el.type,
          )
        )
          continue;
        if (isSensitive(el)) continue;

        const tag = el.tagName.toLowerCase();
        const type = (
          el.getAttribute("type") || (tag === "select" ? "select" : "text")
        ).toLowerCase();

        if (type === "radio") {
          const groupName = el.name || "unnamed_radio";
          if (!radioGroups.has(groupName)) {
            const key = `f_${keyCounter++}`;
            radioGroups.set(groupName, {
              key,
              tag: "input",
              type: "radio",
              name: groupName,
              label: resolveLabel(el),
              options: [],
              current_value: "",
              elementRefs: [],
            });
            descriptors.push(radioGroups.get(groupName));
          }
          const group = radioGroups.get(groupName);
          group.elementRefs.push(el);
          const optVal = el.value || resolveLabel(el);
          group.options.push({
            value: optVal,
            text: resolveLabel(el) || optVal,
          });
          if (el.checked) group.current_value = optVal;
          el.dataset.smartfillKey = group.key;
          continue;
        }

        const key = `f_${keyCounter++}`;
        el.dataset.smartfillKey = key;

        let options = null;
        if (tag === "select") {
          options = Array.from(el.options)
            .filter((o) => o.value && !o.disabled)
            .map((o) => ({ value: o.value, text: o.text.trim() }));
        }

        descriptors.push({
          key,
          tag,
          type,
          label: resolveLabel(el),
          placeholder: el.placeholder || "",
          name: el.name || "",
          id: el.id || "",
          autocomplete: el.getAttribute("autocomplete") || "",
          required: el.required || false,
          maxLength: el.maxLength > 0 ? el.maxLength : null,
          min: el.getAttribute("min"),
          max: el.getAttribute("max"),
          pattern: el.getAttribute("pattern"),
          options,
          current_value:
            tag === "select"
              ? el.value
              : el.type === "checkbox"
                ? el.checked
                : el.value,
        });

        if (descriptors.length >= 60) break;
      }

      return { fields: descriptors, pageContext };
    },
  };
})();
