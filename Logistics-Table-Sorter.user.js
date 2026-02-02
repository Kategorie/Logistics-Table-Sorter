// ==UserScript==
// @name         Logistics Table Sorter (Replace-render safe)
// @namespace    Replenish_Arin
// @author       Kategorie
// @version      1.0.6
// @description  Sort buffer/replenish/order columns even when the server re-renders the whole table.
// @match        inventory.coupang.com/replenish/order/list
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Kategorie/Logistics-Table-Sorter/main/Logistics-Table-Sorter.user.js
// @updateURL    https://raw.githubusercontent.com/Kategorie/Logistics-Table-Sorter/main/Logistics-Table-Sorter.user.js

// ==/UserScript==

// match 주의할 것. 기본 형태 https://.../*
// version 매 번 올릴 것. 그래야 적용됨.
// namespace, downloadURL, updateURL 고정.
// 개발자 모드 + 확/프 세부정보-사용자 스크립트 허용 체크 필요.

(function () {
  "use strict";

  // 여기에서만 조정.
  const CONFIG_OVERRIDE = {
    tableSelector: 'table.table.table-bordered.table-striped.table-hover', // 테이블 선택자
    headerNames: {
      buffer: "버퍼수량",
      replenish: "보충수량",
      order: "주문수량",
    },
  };

  // ---------- Replace-render safe sorter core ----------
  const TmSorter = (() => {
    "use strict";

    const CONFIG = {
      tableSelector: CONFIG_OVERRIDE.tableSelector,
      headerNames: CONFIG_OVERRIDE.headerNames,
      markerAttr: "data-tm-sort-initialized",
      parse: { emptyAs: Number.POSITIVE_INFINITY },
    };

    function normalizeText(s) {
      return (s ?? "").replace(/\s+/g, " ").trim();
    }

    function parseNumber(text) {
      const raw = normalizeText(text);
      if (!raw) return CONFIG.parse.emptyAs;
      const cleaned = raw.replace(/[^\d.+-]/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : CONFIG.parse.emptyAs;
    }

    function getLatestTable() {
      const targets = Object.values(CONFIG.headerNames).map(normalizeText);

      const tables = Array.from(document.querySelectorAll("table"));
      for (const table of tables) {
        const ths = Array.from(table.querySelectorAll("thead th"));
        if (!ths.length) continue;

        const headers = ths.map(th => normalizeText(th.textContent));
        const headerLine = headers.join(" | ");

        const ok = targets.every(t => headerLine.includes(t));
        if (ok) return table;
      }
      return null;
    }

    console.log("[TM] running on", location.href);  // debug log

    function debugDumpTable(table) {  // debug log
      if (!table) {
        console.log("[TM] table not found");
        return;
      }
      const ths = Array.from(table.querySelectorAll("thead th"));
      console.log("[TM] found table, th count =", ths.length);
      console.log("[TM] headers =", ths.map(th => th.textContent.replace(/\s+/g, " ").trim()));
    }


    function getHeaderCells(table) {
      return Array.from(table.querySelectorAll("thead th"));
    }

    function findColIndex(table, headerText) {
      const target = normalizeText(headerText);
      const ths = Array.from(table.querySelectorAll("thead th"));
      for (let i = 0; i < ths.length; i++) {
        const got = normalizeText(ths[i].textContent);
        if (got.includes(target)) return i; // 핵심 변경
      }
      return -1;
    }

    function readCellNumber(row, colIndex) {
      const cell = row?.children?.[colIndex];
      return cell ? parseNumber(cell.textContent) : CONFIG.parse.emptyAs;
    }

    function stableSortRows(rows, getKey, direction) {
      const dir = direction === "desc" ? -1 : 1;
      return rows
        .map((row, idx) => ({ row, idx, key: getKey(row) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.idx - b.idx) * dir)
        .map(x => x.row);
    }

    function sortTable(table, colIndex, direction) {
      const tbody = table.querySelector("tbody");
      if (!tbody) return;
      const rows = Array.from(tbody.querySelectorAll("tr"));
      if (!rows.length) return;

      const sorted = stableSortRows(rows, r => readCellNumber(r, colIndex), direction);
      const frag = document.createDocumentFragment();
      sorted.forEach(r => frag.appendChild(r));
      tbody.appendChild(frag);
    }

    function ensureStyles() {
      if (document.querySelector("#tm-sort-style")) return;
      const style = document.createElement("style");
      style.id = "tm-sort-style";
      style.textContent = `
        .tm-sort-controls{display:inline-flex;gap:4px;margin-left:6px;vertical-align:middle}
        .tm-sort-controls button{border:1px solid rgba(0,0,0,.15);background:#fff;border-radius:6px;cursor:pointer;padding:0 6px;line-height:18px;height:20px}
        .tm-sort-controls button.tm-active{border-color:rgba(0,0,0,.35);background:rgba(0,0,0,.05);font-weight:700}
        .tm-sort-panel{display:inline-flex;gap:8px;align-items:center;padding:8px 10px;margin:6px 0;border:1px solid rgba(0,0,0,.12);border-radius:8px;background:#fff;font-size:12px}
        .tm-sort-panel select,.tm-sort-panel button{font-size:12px;padding:4px 6px}
      `;
      document.head.appendChild(style);
    }

    function clearActiveButtons(scope) {
      scope.querySelectorAll(".tm-sort-controls button").forEach(b => b.classList.remove("tm-active"));
    }

    function injectHeaderButtons(table, columnMap) {
      const ths = getHeaderCells(table);
      Object.entries(columnMap).forEach(([key, colIndex]) => {
        if (colIndex < 0 || colIndex >= ths.length) return;

        const th = ths[colIndex];
        const old = th.querySelector(".tm-sort-controls");
        if (old) old.remove();

        const wrap = document.createElement("span");
        wrap.className = "tm-sort-controls";

        const up = document.createElement("button");
        up.type = "button";
        up.textContent = "▲";
        up.title = "오름차순";
        up.dataset.tmSortKey = key;
        up.dataset.tmSortDir = "asc";

        const down = document.createElement("button");
        down.type = "button";
        down.textContent = "▼";
        down.title = "내림차순";
        down.dataset.tmSortKey = key;
        down.dataset.tmSortDir = "desc";

        wrap.appendChild(up);
        wrap.appendChild(down);
        th.appendChild(wrap);
      });
    }

    function injectPanel(table, columnMap) {
      const prev = table.parentElement?.querySelector("#tm-sort-panel");
      if (prev) prev.remove();

      const panel = document.createElement("div");
      panel.id = "tm-sort-panel";
      panel.className = "tm-sort-panel";

      const colSelect = document.createElement("select");
      [
        { key: "buffer", label: CONFIG.headerNames.buffer },
        { key: "replenish", label: CONFIG.headerNames.replenish },
        { key: "order", label: CONFIG.headerNames.order },
      ].forEach(c => {
        const idx = columnMap[c.key];
        if (idx < 0) return;
        const opt = document.createElement("option");
        opt.value = c.key;
        opt.textContent = c.label;
        colSelect.appendChild(opt);
      });

      const dirSelect = document.createElement("select");
      [["asc","오름차순"],["desc","내림차순"]].forEach(([v, t]) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = t;
        dirSelect.appendChild(opt);
      });

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "정렬 적용";
      btn.dataset.tmPanelApply = "1";

      colSelect.dataset.tmPanelCol = "1";
      dirSelect.dataset.tmPanelDir = "1";

      panel.appendChild(colSelect);
      panel.appendChild(dirSelect);
      panel.appendChild(btn);

      table.parentElement.insertBefore(panel, table);
    }

    function computeColumnMap(table) {
      return {
        buffer: findColIndex(table, CONFIG.headerNames.buffer),
        replenish: findColIndex(table, CONFIG.headerNames.replenish),
        order: findColIndex(table, CONFIG.headerNames.order),
      };
    }

    function initTableIfNeeded(table) {
      if (!table) return;
      if (table.getAttribute(CONFIG.markerAttr) === "1") return;

      ensureStyles();

      const columnMap = computeColumnMap(table);
      const hasAny = Object.values(columnMap).some(i => i >= 0);
      if (!hasAny) return;

      injectHeaderButtons(table, columnMap);
      // injectPanel(table, columnMap); // 드롭다운 패널 비활성화

      table.setAttribute(CONFIG.markerAttr, "1");
    }

    function attachDelegatedEventsOnce() {
      if (window.__tmSorterDelegated) return;
      window.__tmSorterDelegated = true;

      document.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;

        if (t.matches(".tm-sort-controls button[data-tm-sort-key][data-tm-sort-dir]")) {
          const key = t.dataset.tmSortKey;
          const dir = t.dataset.tmSortDir;

          const table = getLatestTable();
          if (!table) return;

          const columnMap = computeColumnMap(table);
          const colIndex = columnMap[key];
          if (typeof colIndex !== "number" || colIndex < 0) return;

          clearActiveButtons(table);
          t.classList.add("tm-active");
          sortTable(table, colIndex, dir);
          return;
        }

        if (t.matches("button[data-tm-panel-apply='1']")) {
          const panel = t.closest("#tm-sort-panel");
          if (!panel) return;

          const colSelect = panel.querySelector("select[data-tm-panel-col='1']");
          const dirSelect = panel.querySelector("select[data-tm-panel-dir='1']");
          if (!(colSelect instanceof HTMLSelectElement) || !(dirSelect instanceof HTMLSelectElement)) return;

          const key = colSelect.value;
          const dir = dirSelect.value;

          const table = getLatestTable();
          if (!table) return;

          const columnMap = computeColumnMap(table);
          const colIndex = columnMap[key];
          if (typeof colIndex !== "number" || colIndex < 0) return;

          clearActiveButtons(table);
          sortTable(table, colIndex, dir);
        }
      }, true);
    }

    function observeAndInit() {
      const tryInit = () => {
        const table = getLatestTable();
        debugDumpTable(table);  // debug log
        if (table) initTableIfNeeded(table);
      };

      tryInit();

      const mo = new MutationObserver(() => {
        if (window.__tmSorterInitScheduled) return;
        window.__tmSorterInitScheduled = true;
        requestAnimationFrame(() => {
          window.__tmSorterInitScheduled = false;
          tryInit();
        });
      });

      mo.observe(document.body, { childList: true, subtree: true });
    }

    function start() {
      attachDelegatedEventsOnce();
      observeAndInit();
    }

    return { start };
  })();

  // 여기 한 줄만 실행
  TmSorter.start();
  console.log("[TM] TmSorter.start()"); // debug log
})();
