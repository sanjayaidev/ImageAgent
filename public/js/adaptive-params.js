// public/js/adaptive-params.js
//
// Renders a model's parameter panel purely from its schema object — the
// same `schemas` object GET /api/image/catalog returns. Control types:
// <select>, <input type=range>, a checkbox, and <input type=number> (used
// for free-entry custom width/height on models that support arbitrary
// resolutions — see the `number` type below).
//
// Schema field shape:
//   {
//     type: 'select' | 'range' | 'checkbox' | 'number',
//     label?: string,
//     default: any,
//     options?: (string|number|{value, label})[],   // select only
//     min?, max?, step?: number,                     // range & number only
//     dependsOn?: string,    // name of a controlling field (e.g. a select) —
//                            // when that field's value doesn't match the
//                            // expected trigger value ('custom' or truthy),
//                            // this field is dimmed AND omitted from getValues()
//     disabledWhen?: string, // name of a checkbox field that, when ON,
//                            // dims this field AND omits it from
//                            // getValues() (the inverse of dependsOn — e.g.
//                            // an aspect_ratio select that should stop
//                            // applying once a "custom resolution" toggle
//                            // is on and width/height take over)
//   }
//
// Usage:
//   const panel = AdaptiveParams.mount(containerEl, schema);
//   const values = panel.getValues();     // read right before submit
//   panel.setSchema(newSchema);           // swap when model changes

console.log('[SanjayImageGen] adaptive-params.js build marker: custom-resolution-debug-1');

window.AdaptiveParams = (function () {
  let styleInjected = false;

  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .ap-panel { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 4px; }
      @media (max-width: 640px) { .ap-panel { grid-template-columns: 1fr; } }
      .ap-field { transition: opacity .15s; }
      .ap-field.ap-full { grid-column: 1 / -1; }
      /* Width + Height are grouped into one full-width row (see setSchema)
         so they always sit side by side, regardless of which other fields
         around them are hidden/shown (a hidden sibling shifting grid
         auto-placement used to knock them apart onto separate rows). */
      .ap-size-row { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
      @media (max-width: 640px) { .ap-size-row { grid-template-columns: 1fr; } }
      /* Fields gated off by disabledWhen (mutually exclusive with another
         field, e.g. aspect_ratio vs. custom width/height) are fully hidden
         — showing them dimmed still reads as "this option is active". */
      .ap-field.ap-hidden { display: none; }
      /* Fields gated off by dependsOn (e.g. Seed under "Use fixed seed")
         stay visible but dimmed, since they represent an optional control
         the user can still choose to turn on. */
      .ap-field.ap-disabled { opacity: .4; pointer-events: none; }
      /* Width and height fields displayed side-by-side when both are present */
      .ap-field.ap-size-field { grid-column: span 1; }
      @media (max-width: 640px) { .ap-field.ap-size-field { grid-column: 1 / -1; } }
      .ap-label {
        display:flex; justify-content:space-between; align-items:baseline;
        font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:#8a8378;
        margin:0 0 6px;
      }
      .ap-range-value { font-family: var(--mono); color: var(--developer); }
      .ap-control.ap-select, .ap-control.ap-number {
        width:100%; background:var(--paper); color:var(--ink); border:1px solid var(--line);
        border-radius:2px; padding:10px 12px; font-family:var(--mono); font-size:13px;
        box-sizing: border-box;
      }
      .ap-control.ap-range { width:100%; accent-color: var(--safelight); }
      .ap-toggle-row { display:flex; align-items:center; justify-content:space-between; padding-top:2px; }
      .ap-toggle { position:relative; width:36px; height:20px; flex-shrink:0; display:inline-block; }
      .ap-toggle input { opacity:0; width:0; height:0; }
      .ap-toggle .ap-slider {
        position:absolute; inset:0; background:#4a453e; border-radius:20px; transition:.15s; cursor:pointer;
      }
      .ap-toggle .ap-slider::before {
        content:''; position:absolute; width:14px; height:14px; left:3px; top:3px;
        background:#efe9df; border-radius:50%; transition:.15s;
      }
      .ap-toggle input:checked + .ap-slider { background: var(--developer); }
      .ap-toggle input:checked + .ap-slider::before { transform: translateX(16px); }
      .ap-empty { color:#5c574e; font-size:12px; padding:6px 0; grid-column:1/-1; }
    `;
    document.head.appendChild(style);
  }

  function labelFor(key, def) {
    return def.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function mount(container, initialSchema) {
    injectStyle();

    let schema = {};
    let state = {};
    let fieldEls = {};

    // Resolves whether a dependsOn/disabledWhen "trigger" name currently
    // holds. Two forms are supported:
    //   1. The exact name of a checkbox field (e.g. 'use_seed',
    //      'custom_size') — trigger is on when that checkbox is checked.
    //   2. `<selectFieldKey>_custom` (e.g. 'size_mode_custom', pointing at
    //      the `size_mode` select) — trigger is on when that select's
    //      current value is 'custom'. The suffix must be stripped to find
    //      the real controlling field; matching state[name] directly (the
    //      previous bug) always looked up a key that doesn't exist and so
    //      silently evaluated to "always off".
    function resolveTrigger(name) {
      if (Object.prototype.hasOwnProperty.call(schema, name)) {
        return !!state[name];
      }
      if (name.endsWith('_custom')) {
        const baseKey = name.slice(0, -'_custom'.length);
        if (Object.prototype.hasOwnProperty.call(schema, baseKey)) {
          return state[baseKey] === 'custom';
        }
      }
      return false;
    }

    function updateDependents() {
      Object.keys(schema).forEach((key) => {
        const def = schema[key];
        if (!def.dependsOn && !def.disabledWhen) return;
        const wrap = fieldEls[key] && fieldEls[key].wrap;
        if (!wrap) return;

        // dependsOn: field is shown/enabled once its trigger is on.
        const dependsOffs = def.dependsOn ? !resolveTrigger(def.dependsOn) : false;

        // disabledWhen: field is hidden once its trigger is on (the
        // inverse of dependsOn — e.g. aspect_ratio once custom size is on).
        const supersededByOther = def.disabledWhen ? resolveTrigger(def.disabledWhen) : false;

        // disabledWhen fields (e.g. aspect_ratio once custom_size is on)
        // are hidden outright — they're superseded, not just "off".
        // dependsOn-only fields (e.g. Seed under "Use fixed seed") stay
        // visible but dimmed, since the user may still switch them on.
        wrap.classList.toggle('ap-hidden', supersededByOther);
        wrap.classList.toggle('ap-disabled', dependsOffs && !supersededByOther);
      });
    }

    function getValues() {
      const out = {};
      Object.keys(schema).forEach((key) => {
        const def = schema[key];

        // dependsOn: field is included only while its trigger is on.
        if (def.dependsOn && !resolveTrigger(def.dependsOn)) return;

        // disabledWhen: field is omitted while its trigger is on (it's
        // been superseded by the other field, e.g. custom width/height
        // overriding aspect_ratio).
        if (def.disabledWhen && resolveTrigger(def.disabledWhen)) return;

        out[key] = state[key];
      });
      return out;
    }

    function buildField(key, def) {
      const wrap = document.createElement('div');
      wrap.className = 'ap-field';
      if (def.type === 'select' && (def.options || []).length > 4) wrap.classList.add('ap-full');
      // Mark width/height fields so they display side-by-side
      if (key === 'width' || key === 'height') wrap.classList.add('ap-size-field');

      if (def.type === 'checkbox') {
        const row = document.createElement('div');
        row.className = 'ap-toggle-row';
        const lbl = document.createElement('span');
        lbl.className = 'ap-label';
        lbl.textContent = labelFor(key, def);
        const toggle = document.createElement('label');
        toggle.className = 'ap-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!def.default;
        const slider = document.createElement('span');
        slider.className = 'ap-slider';
        toggle.appendChild(input);
        toggle.appendChild(slider);
        row.appendChild(lbl);
        row.appendChild(toggle);
        wrap.appendChild(row);
        input.addEventListener('change', () => {
          state[key] = input.checked;
          updateDependents();
        });
        fieldEls[key] = { wrap, input };
        return wrap;
      }

      if (def.type === 'select') {
        const lbl = document.createElement('label');
        lbl.className = 'ap-label';
        lbl.textContent = labelFor(key, def);
        const select = document.createElement('select');
        select.className = 'ap-control ap-select';
        (def.options || []).forEach((opt) => {
          const isObj = opt && typeof opt === 'object';
          const value = isObj ? opt.value : opt;
          const text = isObj ? opt.label : String(opt);
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          if (value === def.default) o.selected = true;
          select.appendChild(o);
        });
        wrap.appendChild(lbl);
        wrap.appendChild(select);
        select.addEventListener('change', () => {
          state[key] = select.value;
          updateDependents();
        });
        fieldEls[key] = { wrap, input: select };
        return wrap;
      }

      if (def.type === 'range') {
        const lbl = document.createElement('label');
        lbl.className = 'ap-label';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = labelFor(key, def);
        const valueSpan = document.createElement('span');
        valueSpan.className = 'ap-range-value';
        valueSpan.textContent = def.default;
        lbl.appendChild(nameSpan);
        lbl.appendChild(valueSpan);
        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'ap-control ap-range';
        input.min = def.min;
        input.max = def.max;
        input.step = def.step || 1;
        input.value = def.default;
        wrap.appendChild(lbl);
        wrap.appendChild(input);
        input.addEventListener('input', () => {
          const isFloat = def.step && def.step < 1;
          state[key] = isFloat ? parseFloat(input.value) : parseInt(input.value, 10);
          valueSpan.textContent = input.value;
          updateDependents();
        });
        fieldEls[key] = { wrap, input };
        return wrap;
      }

      if (def.type === 'number') {
        const lbl = document.createElement('label');
        lbl.className = 'ap-label';
        lbl.textContent = labelFor(key, def);
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'ap-control ap-number';
        if (def.min !== undefined) input.min = def.min;
        if (def.max !== undefined) input.max = def.max;
        input.step = def.step || 1;
        input.value = def.default;
        wrap.appendChild(lbl);
        wrap.appendChild(input);

        function clamp() {
          let v = parseInt(input.value, 10);
          if (isNaN(v)) v = def.default;
          if (def.min !== undefined) v = Math.max(def.min, v);
          if (def.max !== undefined) v = Math.min(def.max, v);
          input.value = v;
          return v;
        }
        input.addEventListener('input', () => {
          const v = parseInt(input.value, 10);
          state[key] = isNaN(v) ? input.value : v; // let the user type freely; clamp on blur
          updateDependents();
        });
        input.addEventListener('blur', () => {
          state[key] = clamp();
        });
        fieldEls[key] = { wrap, input };
        return wrap;
      }

      // Unknown/unsupported type: never fall back to a free-text input.
      return null;
    }

    function setSchema(newSchema) {
      schema = newSchema || {};
      state = {};
      fieldEls = {};
      container.innerHTML = '';
      container.classList.add('ap-panel');

      const keys = Object.keys(schema);
      if (keys.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ap-empty';
        empty.textContent = 'This model has no adjustable parameters.';
        container.appendChild(empty);
        return;
      }

      keys.forEach((key) => { state[key] = schema[key].default; });

      // Width + Height are rendered as a single full-width row so they
      // always stay on the same line — see the .ap-size-row comment above.
      let i = 0;
      while (i < keys.length) {
        const key = keys[i];
        if (key === 'width' && keys[i + 1] === 'height') {
          const widthEl = buildField('width', schema.width);
          const heightEl = buildField('height', schema.height);
          const row = document.createElement('div');
          row.className = 'ap-field ap-full ap-size-row';
          if (widthEl) row.appendChild(widthEl);
          if (heightEl) row.appendChild(heightEl);
          container.appendChild(row);
          // Point both fields' tracked wrap at the shared row so
          // show/hide + enable/disable toggling applies to the row as a
          // whole (width and height always share the same gating).
          if (fieldEls.width) fieldEls.width.wrap = row;
          if (fieldEls.height) fieldEls.height.wrap = row;
          i += 2;
          continue;
        }
        const el = buildField(key, schema[key]);
        if (el) container.appendChild(el);
        i += 1;
      }

      updateDependents();
    }

    setSchema(initialSchema);
    return { getValues, setSchema, container };
  }

  return { mount };
})();
