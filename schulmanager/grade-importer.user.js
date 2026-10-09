
 // ==UserScript==
 // @name         Schulmanager - Grade Import
 // @namespace    http://tampermonkey.net/
 // @version      1.2.0
 // @description  Import grades from JSON by student name
 // @match        https://*.schulmanager-online.de/*
 // @match        https://schulmanager-online.de/*
 // @grant        none
 // @run-at       document-idle
 // ==/UserScript==

 (function () {
     'use strict';

     const ID = 'tm-grade-import';
     const UPDATE_DELAY = 250;

     const GRADE_PATTERN =
         /^(?:[1-6]|[2-5][+-]|[+-][2-5]|1-|-1|\+6|6\+)$/;

     let checkedPlan = null;
     let updateTimer = null;

     // --------------------------------------------------
     // Grade table
     // --------------------------------------------------

     const normalize = text =>
         text.trim().replace(/\s+/g, ' ').normalize('NFC');

     function getRows() {
         return [...document.querySelectorAll(
             'table.grading-event-input-table tbody tr'
         )].map(row => {
             const nameElement = row.querySelector(
                 'td.stick-left .text-truncate'
             );

             const input = row.querySelector(
                 'grade-input input.grade-input-field'
             );

             if (!nameElement || !input) return null;

             return {
                 name: normalize(nameElement.textContent),
                 input
             };
         }).filter(Boolean);
     }

     // --------------------------------------------------
     // Import validation
     // --------------------------------------------------

     function extractGrade(value) {
         // Structured format:
         // {
         //   "points": "4",
         //   "mark": "2"
         // }
         if (
             value !== null &&
             typeof value === 'object' &&
             !Array.isArray(value)
         ) {
             value = value.mark;
         }

         // Prevent null / undefined from becoming
         // the strings "null" or "undefined".
         return value == null
             ? ''
             : String(value).trim();
     }

     function checkImport(json) {
         const data = JSON.parse(json);

         if (!data || Array.isArray(data) ||
             typeof data !== 'object') {
             throw new Error(
                 'Expected a JSON object containing name: grade pairs.'
             );
         }

         const rows = getRows();

         if (!rows.length) {
             throw new Error(
                 'No grade table found on the current page.'
             );
         }

         const byName = new Map();

         for (const row of rows) {
             if (!byName.has(row.name)) {
                 byName.set(row.name, []);
             }

             byName.get(row.name).push(row);
         }

         const plan = {
             updates: [],
             unknown: [],
             invalid: [],
             ambiguous: []
         };

         const seen = new Set();

         for (const [rawName, rawGrade] of Object.entries(data)) {
             const name = normalize(rawName);

             // Accept direct grades and structured objects.
             const grade = extractGrade(rawGrade);

             if (seen.has(name)) {
                 plan.ambiguous.push(
                     name + ' (duplicate JSON name)'
                 );
                 continue;
             }

             seen.add(name);

             if (!GRADE_PATTERN.test(grade)) {
                 plan.invalid.push(name + ': ' + grade);
                 continue;
             }

             const matches = byName.get(name) || [];

             if (!matches.length) {
                 plan.unknown.push(name);
             } else if (matches.length > 1) {
                 plan.ambiguous.push(name);
             } else {
                 const row = matches[0];

                 plan.updates.push({
                     name,
                     grade,
                     previous: row.input.value,
                     input: row.input
                 });
             }
         }

         return plan;
     }

     // --------------------------------------------------
     // Angular-compatible input updates
     // --------------------------------------------------

     function setInputValue(input, value) {
         const setter = Object.getOwnPropertyDescriptor(
             HTMLInputElement.prototype, 'value'
         ).set;

         input.focus();
         setter.call(input, value);

         input.dispatchEvent(new Event('input', {
             bubbles: true
         }));

         input.dispatchEvent(new Event('change', {
             bubbles: true
         }));

         input.blur();
     }

     // --------------------------------------------------
     // Styles
     // --------------------------------------------------

     function addStyles() {
         if (document.getElementById(ID + '-styles')) {
             return;
         }

         const style = document.createElement('style');
         style.id = ID + '-styles';

         style.textContent = `
             #${ID}-button {
                 position: static;
                 display: inline-block;
                 margin-right: 8px;
                 white-space: nowrap;
                 cursor: pointer;
             }

             #${ID}-overlay {
                 position: fixed;
                 inset: 0;
                 z-index: 20000;
                 background: #0008;
                 display: flex;
                 align-items: center;
                 justify-content: center;
             }

             #${ID}-dialog {
                 box-sizing: border-box;
                 width: min(650px, 95vw);
                 max-height: 90vh;
                 overflow: auto;
                 padding: 24px;
                 background: white;
                 color: #222;
                 border-radius: 10px;
                 box-shadow: 0 8px 32px #0004;
                 font: 14px Arial, sans-serif;
             }

             #${ID}-dialog h2 {
                 margin: 0 0 14px;
                 font-size: 20px;
             }

             #${ID}-json {
                 display: block;
                 box-sizing: border-box;
                 width: 100%;
                 height: 180px;
                 margin: 12px 0;
                 padding: 10px;
                 font: 13px monospace;
                 border: 1px solid #aaa;
                 border-radius: 5px;
                 resize: vertical;
             }

             #${ID}-results {
                 max-height: 250px;
                 overflow: auto;
                 margin: 12px 0;
                 white-space: pre-wrap;
                 font: 13px monospace;
             }

             #${ID}-actions {
                 display: flex;
                 justify-content: flex-end;
                 gap: 8px;
             }

             #${ID}-actions button {
                 padding: 8px 14px;
                 border: 1px solid #bbb;
                 border-radius: 5px;
                 cursor: pointer;
             }

             #${ID}-apply {
                 background: #286090;
                 color: white;
             }

             #${ID}-apply:disabled {
                 background: #aaa;
                 cursor: not-allowed;
             }
         `;

         document.head.appendChild(style);
     }

     // --------------------------------------------------
     // Import dialog
     // --------------------------------------------------

     function openDialog() {
         if (document.getElementById(ID + '-overlay')) {
             return;
         }

         checkedPlan = null;

         const overlay = document.createElement('div');
         overlay.id = ID + '-overlay';

         const dialog = document.createElement('div');
         dialog.id = ID + '-dialog';

         dialog.setAttribute('role', 'dialog');
         dialog.setAttribute('aria-modal', 'true');
         dialog.setAttribute('aria-label', 'Notenimport');

         dialog.innerHTML = `
             <h2>Notenimport</h2>

             <p>
                 JSON mit Schülernamen und Noten einfügen.
                 Bestehende Noten werden nur für passende
                 Namen überschrieben.
             </p>

             <textarea
                 id="${ID}-json"
                 placeholder='{"Nachname, Vorname": 2}'
                 aria-label="JSON grades"
             ></textarea>

             <div
                 id="${ID}-results"
                 aria-live="polite"
             ></div>

             <div id="${ID}-actions">
                 <button id="${ID}-cancel" type="button">
                     Abbrechen
                 </button>

                 <button id="${ID}-check" type="button">
                     Prüfen
                 </button>

                 <button
                     id="${ID}-apply"
                     type="button"
                     disabled
                 >
                     Noten übernehmen
                 </button>
             </div>
         `;

         overlay.appendChild(dialog);
         document.body.appendChild(overlay);

         const textarea = dialog.querySelector(
             '#' + ID + '-json'
         );

         const results = dialog.querySelector(
             '#' + ID + '-results'
         );

         const apply = dialog.querySelector(
             '#' + ID + '-apply'
         );

         function close() {
             checkedPlan = null;
             overlay.remove();
         }

         dialog.querySelector(
             '#' + ID + '-cancel'
         ).addEventListener('click', close);

         textarea.addEventListener('input', () => {
             checkedPlan = null;
             apply.disabled = true;
             results.textContent = '';
         });

         // Preview and validate grades.
         dialog.querySelector(
             '#' + ID + '-check'
         ).addEventListener('click', () => {
             checkedPlan = null;
             apply.disabled = true;
             results.textContent = '';

             try {
                 const plan = checkImport(textarea.value);

                 const lines = [
                     `Matched: ${plan.updates.length}`,
                     `Unknown: ${plan.unknown.length}`,
                     `Invalid: ${plan.invalid.length}`,
                     `Ambiguous: ${plan.ambiguous.length}`,
                     ''
                 ];

                 for (const item of plan.updates) {
                     lines.push(
                         `${item.name}: ` +
                         `${item.previous || '(empty)'} → ` +
                         item.grade
                     );
                 }

                 for (const type of [
                     'unknown',
                     'invalid',
                     'ambiguous'
                 ]) {
                     if (plan[type].length) {
                         lines.push(
                             '\n' + type.toUpperCase() + ':'
                         );
                         lines.push(...plan[type]);
                     }
                 }

                 results.textContent = lines.join('\n');

                 // Never apply a partially invalid import.
                 if (
                     plan.invalid.length ||
                     plan.unknown.length ||
                     plan.ambiguous.length
                 ) {
                     results.textContent +=
                         '\n\nResolve all issues before importing.';
                     return;
                 }

                 if (plan.updates.length === 0) {
                     results.textContent +=
                         '\nNo grades to import.';
                     return;
                 }

                 checkedPlan = plan;
                 apply.disabled = false;

             } catch (error) {
                 results.textContent =
                     'Error: ' + error.message;
             }
         });

         // Apply validated grades.
         apply.addEventListener('click', () => {
             if (!checkedPlan) return;

             const currentRows = getRows();

             // Refuse to apply a stale preview.
             const stillValid = checkedPlan.updates.every(
                 item =>
                     item.input.isConnected &&
                     item.input.value === item.previous &&
                     currentRows.some(
                         row =>
                             row.name === item.name &&
                             row.input === item.input
                     )
             );

             if (!stillValid) {
                 checkedPlan = null;
                 apply.disabled = true;

                 results.textContent =
                     'The grade table has changed. ' +
                     'Please check the import again.';

                 return;
             }

             try {
                 for (const item of checkedPlan.updates) {
                     setInputValue(item.input, item.grade);
                 }

                 const count = checkedPlan.updates.length;
                 close();

                 alert(
                     `${count} grades entered.\n\n` +
                     'Please review the grades and save ' +
                     'them using Schulmanager.'
                 );

             } catch (error) {
                 checkedPlan = null;
                 apply.disabled = true;

                 results.textContent =
                     'Import interrupted: ' +
                     error.message +
                     '\nPlease inspect the grade table.';
             }
         });

         textarea.focus();
     }

     // --------------------------------------------------
     // Find the correct Save button
     // --------------------------------------------------

     function findSaveButton() {
         // Restrict search to the "Eingabe" tile.
         const tiles = [
             ...document.querySelectorAll('.tile')
         ];

         const inputTile = tiles.find(tile => {
             const header = tile.querySelector(
                 ':scope > .tile-header'
             );

             return header &&
                 normalize(header.textContent) === 'Eingabe';
         });

         if (!inputTile) return null;

         // Find the upper Save button inside this tile.
         const buttons = [
             ...inputTile.querySelectorAll('button')
         ];

         return buttons.find(button =>
             normalize(button.textContent) === 'Speichern'
         ) || null;
     }

     // --------------------------------------------------
     // Import button placement
     // --------------------------------------------------

     function updateButton() {
         let button = document.getElementById(
             ID + '-button'
         );

         const saveButton = findSaveButton();
         const hasGradeTable = getRows().length > 0;

         if (!saveButton || !hasGradeTable) {
             if (button) button.remove();
             return;
         }

         if (!button) {
             button = document.createElement('button');

             button.id = ID + '-button';
             button.type = 'button';
             button.className = 'btn btn-outline-primary';
             button.textContent = 'Noten importieren';

             button.addEventListener('click', openDialog);
         }

         // Schulmanager wraps its Save button in a span.
         // Place the import button immediately before it.
         const saveWrapper = saveButton.closest('span');

         if (!saveWrapper || !saveWrapper.parentElement) {
             return;
         }

         if (
             button.parentElement !== saveWrapper.parentElement ||
             button.nextElementSibling !== saveWrapper
         ) {
             saveWrapper.parentElement.insertBefore(
                 button,
                 saveWrapper
             );
         }
     }

     // --------------------------------------------------
     // Angular single-page navigation support
     // --------------------------------------------------

     function scheduleUpdate() {
         if (updateTimer !== null) {
             clearTimeout(updateTimer);
         }

         updateTimer = setTimeout(() => {
             updateTimer = null;
             updateButton();
         }, UPDATE_DELAY);
     }

     addStyles();
     updateButton();

     const observer = new MutationObserver(scheduleUpdate);

     observer.observe(document.body, {
         childList: true,
         subtree: true
     });

 })();
