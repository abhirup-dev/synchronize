// fixtures/merge.js — builds window.FIXTURES from the provided base world plus
// an optional designer overlay. Include order in a template page
// (the overlay lives in the template's own folder — the writable surface):
//   <script src="../../fixtures/base.js"></script>
//   <script src="fixtures.active.js"></script>  (optional)
//   <script src="../../fixtures/merge.js"></script>
//
// Merge rules: arrays of {id} objects upsert by id; plain objects merge per
// key (recursively); anything else the overlay wins. Overlays are PARTIAL —
// declare only what you add or change.
(() => {
  const base = window.FIXTURES_BASE ?? {};
  const active = window.FIXTURES_ACTIVE ?? null;

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b) && a.every((x) => isObj(x) && "id" in x)) {
      const out = [...a];
      for (const item of b) {
        const i = out.findIndex((x) => x.id === item.id);
        i >= 0 ? (out[i] = merge(out[i], item)) : out.push(item);
      }
      return out;
    }
    if (isObj(a) && isObj(b)) {
      const out = { ...a };
      for (const k of Object.keys(b)) out[k] = k in a ? merge(a[k], b[k]) : b[k];
      return out;
    }
    return b; // overlay wins
  };

  window.FIXTURES = active ? merge(base, active) : base;
  window.FIXTURES.meta = {
    ...(base.meta ?? {}),
    // parity harness reads these for the data-parity label
    activeOverlay: !!active,
    mode: active?.meta?.mode ?? (active ? "extend" : "base-only"),
  };
})();
