
# 📦 CHANGELOG

All notable changes to **Logistics Table Sorter (Tampermonkey Script)**
will be documented in this file.

---

## [1.3.6] – 2026-02-XX

### Added

* `disableNetworkHook` option to enable/disable XHR interception safely
* `xhrMatch` configuration for endpoint-level request targeting
* `debug` and `debugTableDump` separated for fine-grained logging control
* Print button now retrieves latest table dynamically via injected function

### Changed

* Unified page handling to 0-based (`page = 0`)
* Page size limit capped at `300`
* Improved MutationObserver stability (scoped observer, rAF scheduling)
* Table detection now prioritizes `CONFIG.tableSelector` before fallback
* Column detection: exact match first, then `includes()` fallback
* Stable sorting guaranteed for both asc/desc (tie-breaking index preserved)

### Fixed

* Descending sort instability (row order reversal on equal keys)
* Scope issue in `injectPrintButton` (safe function injection applied)
* False-positive XHR patched logs (query-only comparison)

---

## [1.3.5] – 2026-02-XX

### Added

* XHR `send()` interception for POST body modification

  * Supports:

    * JSON payload
    * `URLSearchParams`
    * `FormData`
* Automatic injection of:

  * `size = forcePageSize`
  * `page = 0` (if `forceFirstPage` enabled)

### Changed

* Network hook redesigned to modify payload instead of URL-only
* Page size override configurable via `CONFIG_OVERRIDE.forcePageSize`

### Notes

* Enables full-page dataset loading when server accepts size parameter.
* Does not alter server permissions or bypass authorization.

---

## [1.3.4] – 2026-02-XX

### Added

* URL-based XHR interception (`patchUrlQuery`)
* `allowAdd` control option for query parameter patching

### Limitations

* Only affected query-string based pagination
* POST body pagination remained unaffected

---

## [1.3.3] – 2026-02-XX

### Changed

* Improved column matching logic:

  * Exact match priority
  * Fallback to partial match
* Reduced header detection ambiguity

---

## [1.3.2] – 2026-02-XX

### Fixed

* Sorting stability issue in descending order

  * Equal keys now preserve original row order

---

## [1.3.1] – 2026-02-XX

### Added

* Always-on load confirmation log
* Safer MutationObserver initialization guard
* `requestAnimationFrame` scheduling to prevent mutation flooding
* Improved re-render resilience

---

# 🛠 Design Notes

* Sorting logic operates strictly on DOM-rendered rows.
* Network interception is optional and configurable.
* Script does not bypass server-side access control.
* Page size override only works if backend accepts the parameter.

---

# ⚠ Maintenance Considerations

The script may require updates if:

* API endpoint changes
* `page/size` parameter naming changes
* Pagination logic switches to `fetch`
* Table DOM structure changes
* Server enforces size upper limit

---

# 📌 Current Stable Version

**v1.3.6**

---