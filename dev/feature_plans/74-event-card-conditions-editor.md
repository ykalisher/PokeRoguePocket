# Phase 74 — Event card conditions: author them in the data editor

**Recommended agent:** Sonnet · high effort.
(High because it is many small edits inside one 1200-line file and the round-trip fidelity
rule below makes sloppy draft mutation a real risk — go slowly, and step up to Opus if the
handler wiring fights back.)
**Prereqs:** phase 72 (the JSON shape is fixed there). Independent of phase 73.
**Read first:** `70-event-card-conditions-overview.md`.
**Goal:** In the local data editor (`node dev/editor/server.js` → 127.0.0.1:8932), the
Events tab can add / edit / remove card conditions on the event itself, on each choice, and
on the trainer payment — and the left-hand preview shows them. Saving an event nobody
edited still produces an empty diff.

## Context you need

Everything is in **`dev/editor/tab_events.js`** (1200 lines). No CSS changes: reuse the
existing `.editor-events-subsection`, `.editor-events-rows`, `.editor-events-req-row`,
`.editor-events-row-remove`, `.editor-empty`, `.editor-hint` classes — all already styled
in `dev/editor/editor.css`.

**The binding rule** (file header comment): the form mutates the `structuredClone` draft
**in place**. Set only what the user edits; delete a field when they clear it; never
rebuild an existing object. Concretely for this phase: an event with no conditions must
never gain a `conditions: []` key, and removing the last condition must `delete` the key.

**The "action" abstraction** (~line 275). `resolveAction(draft, key)` maps an owner key to
a live draft object plus the field names its effects / requirements live under:

```js
    if (key === 'gift') return { key, obj: draft, effectsField: 'effects', requiresField: 'requires' };
    if (key === 'reward') return { key, obj: draft, effectsField: 'rewardEffects', requiresField: null };
    if (key === 'payment') return { key, obj: draft.payment, effectsField: 'effects', requiresField: 'requires' };
    if (key.indexOf('choice:') === 0) { … effectsField: 'effects', requiresField: 'requires' }
```

You extend this with a `conditionsField` and one new key, `'event'`, whose object is the
draft itself. That one trick makes the *same* row renderer and the *same* three DOM
handlers serve both event-level and action-level conditions — do it this way rather than
writing a second set of handlers.

Per the locked spec, conditions belong to: the **event** (`'event'`), each **choice**
(`'choice:N'`), and the **payment** (`'payment'`). The gift claim inherits the event-level
list, so `'gift'` gets `conditionsField: null`; so does `'reward'`.

Existing helpers you will reuse (do not reimplement): `escapeHtml`, `escapeAttr`,
`optionTags(values, current)`, `textField(label, scopeAttrs, value)`,
`datalistForStore(store)`, `unknownBadge(store, name)` (renders an "unknown" badge for a
name absent from that data file), `STORE_FOR_KIND`, `CARD_KINDS_UI`
(`['pokemon','attack','item']`), `setOrDelete(obj, key, value)`.

Handler wiring lives in `renderForm` (~line 909): an `input` listener for text fields
(no repaint), a `change` listener for selects/checkboxes (repaints), and a `click`
listener for `[data-action]` buttons (repaints). Each reads `data-scope`, `data-owner`,
`data-index`, `data-field`. `requireAt(owner, index)` (~line 931) is the pattern for
`conditionAt`.

## Steps

- [x] 1. **`dev/editor/tab_events.js`** — near `CARD_KINDS_UI` (~line 21) add the mode
  vocabulary and its option renderer (labels are the UI wording; values are the JSON):

  ```js
  const CONDITION_MODES = [
      { value: 'has', label: 'Must have' },
      { value: 'lacks', label: 'Must not have' }
  ];
  ```

  and, next to `optionTags` (~line 462):

  ```js
      function conditionModeOptions(current) {
          return CONDITION_MODES.map(({ value, label }) =>
              `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`
          ).join('');
      }
  ```

- [x] 2. **`dev/editor/tab_events.js`** — add a factory beside `newRequirement` (~line 199).
  `cardKind` is always explicit because the engine defaults a missing kind to `'attack'`:

  ```js
      function newCondition() {
          return { mode: 'has', cardKind: 'pokemon', name: '' };
      }
  ```

- [x] 3. **`dev/editor/tab_events.js`** — extend `resolveAction` (~line 280): add
  `conditionsField` to every branch — `'gift'` → `null`, `'reward'` → `null`,
  `'payment'` → `'conditions'`, `'choice:N'` → `'conditions'` — and add a new first branch:

  ```js
      if (key === 'event') return { key, obj: draft, effectsField: null, requiresField: null, conditionsField: 'conditions' };
  ```

  Also add `conditionsField: 'conditions'` to the inline choice-action literal in
  `choiceBlockHtml` (~line 777), which builds its own action object instead of calling
  `resolveAction`.

- [x] 4. **`dev/editor/tab_events.js`** — beside `actionRequires` / `ensureRequires`
  (~line 295) add the two accessors:

  ```js
      function actionConditions(action) {
          return action.conditionsField ? (action.obj[action.conditionsField] || []) : [];
      }

      function ensureConditions(action) {
          if (!action.conditionsField) return [];
          if (!action.obj[action.conditionsField]) action.obj[action.conditionsField] = [];
          return action.obj[action.conditionsField];
      }
  ```

- [x] 5. **`dev/editor/tab_events.js`** — add the row + section renderers next to
  `requirementRowHtml` / `requirementsEditorHtml` (~line 694):

  ```js
      function conditionRowHtml(cond, index, owner) {
          const base = `data-owner="${escapeAttr(owner)}" data-index="${index}"`;
          const kind = cond.cardKind || 'pokemon';
          const store = STORE_FOR_KIND[kind] || 'pokemon';
          return `
              <li class="editor-events-req-row">
                  <div class="editor-form-row">
                      <label>Rule<select data-scope="cond-mode" ${base}>${conditionModeOptions(cond.mode || 'has')}</select></label>
                      <label>Card kind<select data-scope="cond-cardkind" ${base}>${optionTags(CARD_KINDS_UI, kind)}</select></label>
                      <label>Card<input type="text" list="${datalistForStore(store)}" data-scope="cond" ${base} data-field="name" value="${escapeAttr(cond.name || '')}">${unknownBadge(store, cond.name)}</label>
                      <button type="button" class="editor-btn editor-btn--danger editor-events-row-remove" data-action="remove-cond" ${base}>Remove</button>
                  </div>
                  <div class="editor-form-row">
                      ${textField('Locked text', `data-scope="cond" ${base} data-field="text"`, cond.text)}
                  </div>
              </li>
          `;
      }

      function conditionsEditorHtml(action, title, hint) {
          const conditions = actionConditions(action);
          const rows = conditions.length
              ? conditions.map((cond, index) => conditionRowHtml(cond, index, action.key)).join('')
              : '<li class="editor-empty">No conditions.</li>';
          return `
              <div class="editor-events-subsection">
                  <h4>${escapeHtml(title)}</h4>
                  <span class="editor-hint">${escapeHtml(hint)}</span>
                  <ul class="editor-events-rows">${rows}</ul>
                  <button type="button" class="editor-btn" data-action="add-cond" data-owner="${escapeAttr(action.key)}">+ Add condition</button>
              </div>
          `;
      }
  ```

- [x] 6. **`dev/editor/tab_events.js`** — render the section in exactly three places. The
  hint text matters: it is the only thing telling the author how conditions differ from
  requirements, so use these words.
  - `commonZoneHtml` (~line 728), after the location/terrain chip labels:
    ```js
    ${conditionsEditorHtml(resolveAction(draft, 'event'), 'Event card conditions',
        'Checked when the game picks an event: the whole event is skipped unless the run satisfies every condition. Nothing is selected or taken away. A gift event\'s claim button inherits these too.')}
    ```
  - `choiceBlockHtml` (~line 776), **above** `${requirementsEditorHtml(choiceAction)}`:
    ```js
    ${conditionsEditorHtml(choiceAction, 'Choice card conditions',
        'Grays out this choice unless the run satisfies every condition. Unlike a requirement, the player picks nothing and loses nothing.')}
    ```
  - `paymentZoneHtml` (~line 817), above its `requirementsEditorHtml(action)` call, with
    the same hint wording as the choice one but "this payment option".

- [x] 7. **`dev/editor/tab_events.js`** — in `renderForm`, add the lookup helper next to
  `requireAt` (~line 931):

  ```js
          function conditionAt(owner, index) {
              return actionConditions(resolveAction(draft, owner))[index];
          }
  ```

- [x] 8. **`dev/editor/tab_events.js`** — `input` listener (~line 971): add a branch beside
  the `scope === 'req'` one. `name` is always set (never deleted) so a cleared box round-trips
  as `""` rather than vanishing mid-edit — same convention as `req.id` / `choice.id`:

  ```js
              } else if (scope === 'cond') {
                  const cond = conditionAt(owner, index);
                  if (field === 'name') cond.name = value;
                  else setOrDelete(cond, field, value);
  ```

- [x] 9. **`dev/editor/tab_events.js`** — `change` listener (~line 1020): two cases beside
  `'req-cardkind'`. Both repaint (the card-kind switch must re-point the datalist and the
  unknown badge):

  ```js
                  case 'cond-mode':
                      conditionAt(owner, index).mode = value;
                      break;
                  case 'cond-cardkind':
                      conditionAt(owner, index).cardKind = value;
                      break;
  ```

- [x] 10. **`dev/editor/tab_events.js`** — `click` listener (~line 1077): two actions beside
  `add-req` / `remove-req`. Removing the last one deletes the key so untouched events stay
  diff-clean:

  ```js
              } else if (action === 'add-cond') {
                  ensureConditions(resolveAction(draft, owner)).push(newCondition());
              } else if (action === 'remove-cond') {
                  const target = resolveAction(draft, owner);
                  actionConditions(target).splice(index, 1);
                  if (target.conditionsField && target.obj[target.conditionsField].length === 0) {
                      delete target.obj[target.conditionsField];
                  }
  ```

- [x] 11. **`dev/editor/tab_events.js`** — show conditions in the LEFT preview. Add a
  helper next to `previewActionHtml` (~line 378):

  ```js
      function conditionsPreviewHtml(conditions) {
          const list = (Array.isArray(conditions) ? conditions : []).filter((cond) => cond && cond.name);
          if (!list.length) return '';
          const parts = list.map((cond) =>
              `${cond.mode === 'lacks' ? 'Only without' : 'Requires'} ${cond.name}`);
          return `<p class="editor-events-preview-desc">${escapeHtml(parts.join(' · '))}</p>`;
      }
  ```

  Give `previewActionHtml` a fourth parameter `conditions` and render
  `${conditionsPreviewHtml(conditions)}` between the description and the effects list. Pass
  it at the three call sites in `eventPreviewHtml` (~line 417): `choice.conditions` for
  choices, `draft.payment.conditions` for the payment, and `draft.conditions` for the gift
  claim. The trainer battle-reward call keeps passing nothing. Also render
  `${conditionsPreviewHtml(draft.conditions)}` once inside `.editor-events-preview-text`
  (just before the body paragraph) so event-level gates are visible for every event type.

- [x] 12. **`node tests/run_all.js`** — green (it syntax-checks every tracked JS file,
  which is the main guard for this phase).

- [x] 13. Drive the editor in a browser and actually use the new UI. Start it with
  `node dev/editor/server.js` (127.0.0.1:8932) — or adapt `dev/verify/drive_editor.py`,
  which already spawns the server on port 8933 and restores any file it writes. Open the
  Events tab, open the existing `choice`-type event, and confirm:
  - "Event card conditions" appears in the Event zone and "Choice card conditions" in every
    choice block, each above the Requirements subsection;
  - "+ Add condition" adds a row defaulting to Must have / pokemon / empty name;
  - typing a real pokemon name clears the "unknown" badge, a nonsense name shows it;
  - switching Card kind to `item` re-points the datalist to item names;
  - the preview shows `Requires <name>` (and `Only without <name>` for Must not have);
  - Remove takes the row away, and removing the last one leaves **no** `conditions` key —
    check with `git diff events.json` after saving.
  - **Restore `events.json` afterwards** (`git checkout -- events.json`) unless you
    deliberately left a real authored event, which this batch does not.

## Verification

- [x] `node tests/run_all.js` green.
- [x] Manual/driven editor session per step 13 completed, with a screenshot saved under
  `dev/verify/` showing an event whose conditions round-trip through the form.
- [x] Round-trip check: open an event, change nothing, save → `git diff events.json` is
  empty. Then add a condition, save, and confirm the diff contains exactly the new
  `conditions` array (with `mode`, `cardKind`, `name`) and nothing else. Restore the file.
- [x] `git status --porcelain` shows `dev/editor/tab_events.js` modified (plus any new
  screenshot/driver) and **`events.json` unchanged**.

## Out of scope / do not touch

`dev/editor/validate.js` and the test mirrors (phase 75 — it is fine that the editor can
currently save a typo'd card name; that is exactly what 75 catches), `map/**` (phases
72–73), `dev/editor/editor.css` (reuse the existing classes; if something genuinely has no
class that fits, say so rather than restyling the tab), the Requirements subsection and
every existing effect editor, and the other editor tabs. Do not author real events.
