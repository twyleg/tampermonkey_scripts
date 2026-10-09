
 // ==UserScript==
 // @name         Google Drive - Folder Up
 // @namespace    http://tampermonkey.net/
 // @version      1.4
 // @description  Adds Up buttons on both sides of Drive breadcrumbs
 // @match        https://drive.google.com/drive/*
 // @grant        none
 // @run-at       document-idle
 // ==/UserScript==

 (function () {
     'use strict';

     const BUTTON_CLASS = 'tm-folder-up';
     const UPDATE_DELAY = 150;

     let updateTimer = null;

     function isFolder() {
         return /\/folders\/[^/?#]+/.test(location.pathname);
     }

     function findBreadcrumbs() {
         const primary = document.querySelector(
             'nav[guidedhelpid="folder_path"] [role="list"]'
         );

         if (primary) return primary;

         const candidates = document.querySelectorAll(
             'nav[role="navigation"] [role="list"]'
         );

         for (const candidate of candidates) {
             const items = candidate.querySelectorAll(
                 ':scope > [role="listitem"]'
             );

             if (items.length < 2) continue;

             if (candidate.querySelector('[role="link"][data-id]')) {
                 return candidate;
             }
         }

         return null;
     }

     function getParentFolder() {
         if (!isFolder()) return null;

         const breadcrumbs = findBreadcrumbs();
         if (!breadcrumbs) return null;

         const items = Array.from(
             breadcrumbs.querySelectorAll(
                 ':scope > [role="listitem"]'
             )
         );

         if (items.length < 2) return null;

         const parentItem = items[items.length - 2];
         const link = parentItem.querySelector(
             '[role="link"][data-id]'
         );

         if (!link) return null;

         return {
             element: link,
             name: link.getAttribute('aria-label')
                 || link.textContent.trim()
         };
     }

     function goUp() {
         const parent = getParentFolder();

         if (!parent || !parent.element.isConnected) {
             scheduleUpdate();
             return;
         }

         parent.element.click();
     }

     function createButton(position) {
         const button = document.createElement('button');

         button.className = BUTTON_CLASS;
         button.dataset.position = position;
         button.type = 'button';
         button.textContent = '↑ Up';
         button.title = 'Go to parent folder';

         button.addEventListener('click', goUp);

         Object.assign(button.style, {
             display: 'inline-flex',
             alignItems: 'center',
             justifyContent: 'center',
             flexShrink: '0',
             marginLeft: position === 'right' ? '12px' : '0',
             marginRight: position === 'left' ? '12px' : '0',
             padding: '6px 12px',
             background: '#e8f0fe',
             color: '#174ea6',
             border: '1px solid #aecbfa',
             borderRadius: '18px',
             fontSize: '13px',
             fontFamily: 'Arial, sans-serif',
             fontWeight: '500',
             lineHeight: '20px',
             cursor: 'pointer'
         });

         button.addEventListener('mouseenter', () => {
             button.style.background = '#d2e3fc';
         });

         button.addEventListener('mouseleave', () => {
             button.style.background = '#e8f0fe';
         });

         return button;
     }

     function updateButton() {
         const breadcrumbs = findBreadcrumbs();
         const parent = getParentFolder();

         if (!breadcrumbs || !parent) {
             document.querySelectorAll(
                 '.' + BUTTON_CLASS
             ).forEach(button => button.remove());
             return;
         }

         const nav = breadcrumbs.closest('nav');
         if (!nav || !nav.parentElement) return;

         const container = nav.parentElement;

         container.style.display = 'flex';
         container.style.alignItems = 'center';

         for (const position of ['left', 'right']) {
             let button = document.querySelector(
                 '.' + BUTTON_CLASS +
                 '[data-position="' + position + '"]'
             );

             if (!button) {
                 button = createButton(position);
             }

             if (position === 'left') {
                 if (button.nextElementSibling !== nav) {
                     nav.insertAdjacentElement(
                         'beforebegin', button
                     );
                 }
             } else {
                 if (button.previousElementSibling !== nav) {
                     nav.insertAdjacentElement(
                         'afterend', button
                     );
                 }
             }

             button.title = 'Go up to: ' + parent.name;
         }
     }

     function scheduleUpdate() {
         if (updateTimer !== null) {
             clearTimeout(updateTimer);
         }

         updateTimer = setTimeout(() => {
             updateTimer = null;
             updateButton();
         }, UPDATE_DELAY);
     }

     const observer = new MutationObserver(scheduleUpdate);

     observer.observe(document.body, {
         childList: true,
         subtree: true
     });

     updateButton();
 })();
