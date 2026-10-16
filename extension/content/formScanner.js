(() => {
  const SENSITIVE_KEYWORDS =
    /password|passwd|passcode|cvv|cvc|creditcard|cardnum|otp|token|ssn|secret|pin/i;

  // Track the right-clicked element globally so script updates never lose the reference
  if (!window.__smartFillContextMenuBound) {
    window.__smartFillContextMenuBound = true;
    document.addEventListener(
      "contextmenu",
      (event) => {
        window.__smartFillLastRightClicked = event.target;
      },
      true,
    );
  }

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

  function cleanPlaceholderText(raw) {
    if (!raw) return "";
    const trimmed = raw.trim();

    // Check if placeholder is purely an example like "e.g. Rakib Mahmud" or "Ex: Dhaka"
    const pureExampleMatch = trimmed.match(
      /^(?:e\.?g\.?|ex|example|for example|যেমন)[:.,\s-]+(.+)$/i,
    );
    if (pureExampleMatch) {
      const sample = pureExampleMatch[1].trim();
      if (sample.includes("@")) return "Email Address";
      if (/^\+?[\d\s()-]{7,}$/.test(sample)) return "Phone Number";
      if (/^https?:\/\//i.test(sample)) return "Website URL";
      return `Value similar to '${sample}' (generate a different one)`;
    }

    // Remove inline example suffixes like "Full Name (e.g. John Doe)"
    const cleaned = trimmed
      .replace(/\(?\b(e\.?g\.?|ex|example|for example|যেমন)\b[:.,\s-]*[^)]*\)?/gi, "")
      .replace(/^(enter|type|input|write|provide)\s+(your\s+|a\s+|the\s+)?/i, "")
      .replace(/\.{2,}$/, "")
      .trim();

    return cleaned || trimmed;
  }

  function isMeaningfulIdentifier(str) {
    if (!str || str.length < 2 || str.length > 40) return false;
    if (/^[0-9_-]+$/.test(str)) return false;
    if (/^(input|field|text|el|item|id|f)[\d_-]*$/i.test(str)) return false;
    return /[a-zA-Z]{2,}/.test(str);
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

    // Check previous sibling label/span or parent wrapper's previous sibling
    const prev =
      el.previousElementSibling || el.parentElement?.previousElementSibling;
    if (
      prev &&
      ["LABEL", "SPAN", "STRONG", "B", "P", "DIV"].includes(prev.tagName) &&
      !prev.querySelector("input, select, textarea") &&
      prev.innerText.trim() &&
      prev.innerText.trim().length <= 60
    ) {
      return prev.innerText.trim();
    }

    // Walk up 3 parent levels to find a single field container with a <label>
    let parent = el.parentElement;
    for (let depth = 0; depth < 3 && parent && parent !== document.body; depth++) {
      const inputsInParent = parent.querySelectorAll(
        "input:not([type='hidden']), select, textarea",
      );
      if (inputsInParent.length === 1) {
        const groupLabel = parent.querySelector("label");
        if (groupLabel && groupLabel.innerText.trim()) {
          return groupLabel.innerText.trim();
        }
      }
      parent = parent.parentElement;
    }

    // Prefer semantic name or id (e.g. name="fullName", id="p_fullName") before placeholder
    if (isMeaningfulIdentifier(el.name)) return humanizeName(el.name);
    if (isMeaningfulIdentifier(el.id)) {
      const strippedId = el.id.replace(/^(p_|input_|txt_|fld_|field_)/i, "");
      return humanizeName(strippedId || el.id);
    }

    if (el.title && el.title.trim()) return el.title.trim();

    if (el.placeholder && el.placeholder.trim()) {
      const cleanedPh = cleanPlaceholderText(el.placeholder);
      if (cleanedPh) return cleanedPh;
    }

    return el.type && el.type !== "text" ? humanizeName(el.type) : "Field";
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

      // Always clear any previous data-smartfill-key attributes across the entire page first
      document
        .querySelectorAll("[data-smartfill-key]")
        .forEach((node) => node.removeAttribute("data-smartfill-key"));

      // If singleTarget is requested via keyboard shortcut or context menu
      if (singleTarget) {
        const active = document.activeElement;
        const activeTag = active?.tagName ? active.tagName.toLowerCase() : "";
        const isFocusedInput =
          ["input", "textarea", "select"].includes(activeTag) &&
          !isSensitive(active);

        const el = isFocusedInput
          ? active
          : window.__smartFillLastRightClicked || active;
        const tag = el?.tagName ? el.tagName.toLowerCase() : "";
        if (["input", "textarea", "select"].includes(tag) && !isSensitive(el)) {
          const key = `f_single_${Date.now()}`;
          el.setAttribute("data-smartfill-key", key);
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
