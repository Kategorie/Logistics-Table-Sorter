// ==UserScript==
// @name         Logistics Table Sorter (Replace-render safe)
// @namespace    Replenish_Arin
// @author       Kategorie
// @version      1.2.16
// @description  Sort buffer/replenish/order columns even when the server re-renders the whole table.
// @match        https://inventory.coupang.com/replenish/order/list*
// @match        http://inventory.coupang.com/replenish/order/list*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Kategorie/Logistics-Table-Sorter/main/Logistics-Table-Sorter.user.js
// @updateURL    https://raw.githubusercontent.com/Kategorie/Logistics-Table-Sorter/main/Logistics-Table-Sorter.user.js

// ==/UserScript==

// version 매 번 올릴 것. 그래야 적용됨.
// namespace, downloadURL, updateURL 고정.
// 개발자 모드 + 확/프 세부정보-사용자 스크립트 허용 체크 필요.

(function () {
  "use strict";

  // 여기에서만 조정.
  const CONFIG_OVERRIDE = {
    tableSelector: 'table.table.table-bordered.table-striped.table-hover',
    headerNames: {
      buffer: "버퍼수량",
      replenish: "보충수량",
      order: "주문수량",
    },
    forcePageSize: 200,
    forceFirstPage: true,
    debug: true,
    debugTableDump: false,
  };
  // tableSelector : 테이블 선택자
  // forceFirstPage : 원하면 true, 싫으면 false
  // debug : 개발 중엔 true, 배포 시 false

  // ---------- Debug logging ----------
  function logDebug(...args) {
    if (!CONFIG_OVERRIDE.debug) return;
    console.log("[TM][Logistics]", ...args);
  }

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

    logDebug("running on", location.href);

    function debugTableDump(table) {
      if (!CONFIG_OVERRIDE.debugTableDump) return;
      if (!table) {
        logDebug("table not found");
        return;
      }
      const ths = Array.from(table.querySelectorAll("thead th"));
      logDebug("found table, th count =", ths.length);
      logDebug("headers =", ths.map(th => th.textContent.replace(/\s+/g, " ").trim()));
    }

    function getHeaderCells(table) {
      return Array.from(table.querySelectorAll("thead th"));
    }

    // 핵심 변경 : 헤더 텍스트로 열 인덱스 찾기
    function findColIndex(table, headerText) {
      const target = normalizeText(headerText);
      const ths = Array.from(table.querySelectorAll("thead th"));
      for (let i = 0; i < ths.length; i++) {
        const got = normalizeText(ths[i].textContent);
        if (got.includes(target)) return i;
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
        .tm-sort-controls button{color: #111 !important;border:1px solid rgba(0,0,0,.15);background:#fff;border-radius:6px;cursor:pointer;padding:0 6px;line-height:18px;height:20px}
        .tm-sort-controls button.tm-active{color: #d00 !important;border-color:rgba(0,0,0,.35);background:rgba(0,0,0,.05);font-weight:700}
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

    // 화면에 렌더된 행 개수 세기
    function countRenderedRows(tableEl) {
        if (!tableEl) return 0;
        const tbody = tableEl.querySelector("tbody");
        if (!tbody) return 0;
        return tbody.querySelectorAll("tr").length;
    }

    // "총 XX건" 앞에 "표 YY건/" 추가
    function upsertShownPrefixBeforeTotal({ tableEl, rootId = "searchResultArea" }) {
        const root = document.getElementById(rootId);
        if (!root || !tableEl) return;

        const h4 = root.querySelector(".pull-right h4");
        if (!h4) return;

        // 1) h4를 한 줄 정렬 컨테이너로
        h4.style.display = "inline-flex";
        h4.style.alignItems = "center";
        h4.style.gap = "4px";

        // 날짜 span 보정 (있다면)
        const dateSpan = h4.querySelector("span");
        if (dateSpan) {
            dateSpan.style.display = "inline-flex";
            dateSpan.style.alignItems = "center";
            dateSpan.style.lineHeight = "1.1";
        }

        const shown = countRenderedRows(tableEl);

        // "총 48건" 텍스트 노드 찾기
        const totalTextNode = Array.from(h4.childNodes).find(
            n =>
                n.nodeType === Node.TEXT_NODE &&
                /총\s*[0-9,]+\s*건/.test(n.nodeValue || "")
        );
        if (!totalTextNode) return;

        const uiId = "tm-shown-prefix";
        let prefix = h4.querySelector(`#${uiId}`);
        if (!prefix) {
            prefix = document.createElement("span");
            prefix.id = uiId;
            prefix.style.cssText = [
                "display: inline-flex",
                "align-items: center",
                "white-space: nowrap",
            ].join(";");

            // "총 48건" 텍스트 앞에 삽입
            h4.insertBefore(prefix, totalTextNode);
        }

        prefix.textContent = `표 ${shown}건/`;
        logDebug("count check", { shown, totalParsed });
    }

    function initTableIfNeeded(table) {
      if (!table) return;
      if (table.getAttribute(CONFIG.markerAttr) === "1") return;

      ensureStyles();

      const columnMap = computeColumnMap(table);
      logDebug("columnMap", columnMap);
      const hasAny = Object.values(columnMap).some(i => i >= 0);
      if (!hasAny) return;

      injectHeaderButtons(table, columnMap);
      // 드롭다운 패널 비활성화
      // injectPanel(table, columnMap);
      // 프린트 버튼 추가
      injectPrintButton(table);
      // 표시된 행 갯수 확인 UI 추가.
      // 반드시 마지막에 호출 (최종적으로 화면에 보이는 tr 개수를 기준으로 표시 건수를 계산.)
      upsertShownPrefixBeforeTotal({ tableEl: table });

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
        debugTableDump(table);
        logDebug("table probe", { found: !!table, th: table ? table.querySelectorAll("thead th").length : 0 });
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

  // ---------- Print button functionality ----------
  // 프린트 버튼 관련 기능
  function findSummaryHeaderElement() {
    // 1순위: h4 안에 span[style*="color:red"]가 있고, 텍스트에 "총"과 "건"이 함께 있는 것.
    const h4s = Array.from(document.querySelectorAll("h4"));
    for (const h4 of h4s) {
        const redSpan = h4.querySelector('span[style*="color:red"]');
        const txt = (h4.textContent || "").replace(/\s+/g, " ").trim();
        if (redSpan && txt.includes("총") && txt.includes("건")) return h4;
    }
    // 2순위: 텍스트 패턴만으로라도 찾기.
    for (const h4 of h4s) {
        const txt = (h4.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.match(/\d{4}-\d{2}-\d{2}/) && txt.includes("총") && txt.includes("건")) return h4;
    }
    return null;
  }

  // 프린트 버튼 관련 기능
  function openPrintWindowWithHeaderAndTable(headerEl, tableEl, titleText = "Replenish Order Print") {
    const headerHtml = headerEl ? headerEl.outerHTML : "";
    const tableHtml = tableEl ? tableEl.outerHTML : "<div>table not found</div>";

    // 테이블이 부트스트랩 클래스 기반이라면 최소한의 표 스타일을 함께 넣는 편이 인쇄 품질이 좋다.
    const css = `
        @page { margin: 12mm; }
        body { font-family: Arial, "Malgun Gothic", sans-serif; font-size: 12px; color: #111; }
        h4 { margin: 0 0 10px 0; font-size: 14px; font-weight: 600; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; }
        th { background: #f2f2f2; }
        .table-bordered th, .table-bordered td { border: 1px solid #333; }
        .table-striped tbody tr:nth-child(odd) { background: #fafafa; }
        .tm-sort-controls { display: none !important; } /* 인쇄물에는 정렬 버튼 숨김 */
    `;

    const html = `<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${escapeHtml(titleText)}</title>
            <style>${css}</style>
        </head>
        <body>
            ${headerHtml}
            ${tableHtml}
            <script>
                // 로드되면 바로 인쇄 다이얼로그를 열고, 사용자가 인쇄/취소 후 창을 닫기 쉽게 처리
                window.onload = function () {
                    try { window.focus(); } catch (e) {}
                    try { window.print(); } catch (e) {}
                };
                window.onafterprint = function () {
                    try { window.close(); } catch (e) {}
            };
            </script>
        </body>
        </html>`;

    const w = window.open("", "_blank", "width=1000,height=800");
    if (!w) {
        alert("팝업이 차단되어 인쇄 창을 열 수 없습니다. 이 사이트에서 팝업 허용 후 다시 시도해 주세요.");
        return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function injectPrintButton(tableEl) {
    if (!tableEl) return;

    const root = document.querySelector("#searchResultArea");
    if (!root) return;

    // 상단 바(controls bar) 기준으로 중복 방지
    const barId = "tm-print-bar";
    let bar = root.querySelector(`#${barId}`);

    if (!bar) {
        bar = document.createElement("div");
        bar.id = barId;
        bar.style.display = "flex";
        bar.style.alignItems = "center";
        bar.style.justifyContent = "space-between";
        bar.style.gap = "8px";
        bar.style.margin = "6px 0 8px 0";

        // 좌측 영역
        const left = document.createElement("div");
        left.id = "tm-print-left";
        left.style.display = "flex";
        left.style.alignItems = "center";
        left.style.gap = "8px";

        // 우측 영역: 기존 pull-right를 그대로 담거나, 없으면 비워둠
        const right = document.createElement("div");
        right.id = "tm-print-right";
        right.style.display = "flex";
        right.style.alignItems = "center";
        right.style.gap = "8px";

        bar.appendChild(left);
        bar.appendChild(right);

        // bar를 root 맨 위에 삽입
        root.insertBefore(bar, root.firstChild);

        // 기존 pull-right가 있으면 bar의 오른쪽으로 옮김(통째로)
        const pullRight = root.querySelector(":scope > .pull-right");
        if (pullRight) {
            right.appendChild(pullRight);
            // pull-right가 float로 우측 정렬을 강제할 수 있으니 float 해제
            pullRight.style.float = "none";
        }
    }

    // 버튼이 이미 있으면 끝
    if (bar.querySelector("#tm-print-table-btn")) return;

    const btn = document.createElement("button");
    btn.id = "tm-print-table-btn";
    btn.type = "button";
    btn.textContent = "조회 데이터 인쇄";
    btn.style.cssText = [
        "display: inline-flex",
        "align-items: center",
        "padding: 6px 10px",
        "border: 1px solid #888",
        "border-radius: 6px",
        "background: #fff",
        "cursor: pointer",
        "font-size: 12px",
        "margin: 0",
        "white-space: nowrap",
    ].join(";");

    btn.addEventListener("click", () => {
        // 클릭 시점에 최신 헤더와 최신 테이블을 다시 잡아 출력하는 게 안전.
        const headerElNow = findSummaryHeaderElement();
        openPrintWindowWithHeaderAndTable(headerElNow, tableEl, "Replenish Order Table");
    });

    const left = bar.querySelector("#tm-print-left");
    left.appendChild(btn);
  }



  // ---------- Search request hook to force page size ----------
  // 조회값 파라미터 기본 설정.
  function ensureParam(params, key, defaultValue = "") {
    if (!params.has(key)) {
        params.set(key, defaultValue);
    }
  }

  // 조회값이 한 페이지에 모두 나오도록.
  function installSearchRequestHook() {
    const TARGET_PATH = "/async/replenish/order/search";
    const PAGE_SIZE = CONFIG_OVERRIDE.forcePageSize ?? 200;
    const FORCE_FIRST = CONFIG_OVERRIDE.forceFirstPage ?? false;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    // 중복 설치 방지
    if (XMLHttpRequest.prototype.__tm_size_hook_installed) return;
    XMLHttpRequest.prototype.__tm_size_hook_installed = true;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__tm_url = url;
        this.__tm_method = method;
        return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
        try {
          const url = String(this.__tm_url || "");
          const isTarget =
              url === TARGET_PATH ||
              url.includes(TARGET_PATH);

          if (isTarget && typeof body === "string") {
              const params = new URLSearchParams(body);

              // 서버가 요구하는 필수 키 보장
              ensureParam(params, "shippingCompanyId");
              ensureParam(params, "shippingType");
              ensureParam(params, "shippingCutLine");
              ensureParam(params, "skuBarcode");
              ensureParam(params, "skuId");
              ensureParam(params, "externalSkuId");

              // size 강제
              params.set("size", String(PAGE_SIZE));

              // 선택: 첫 페이지로 고정
              if (FORCE_FIRST) params.set("page", "0");

              body = params.toString();
          }
        } catch (e) {
        // 후킹 실패해도 원 요청은 보내야 하므로 조용히 통과
        }
        logDebug("hook applied", { url: url.slice(-80), page: params.get("page"), size: params.get("size") });
        return origSend.call(this, body);
    };
    logDebug("hook installed", { target: TARGET_PATH, size: PAGE_SIZE, forceFirst: FORCE_FIRST });
  }

  installSearchRequestHook();

  // 여기 한 줄만 실행
  TmSorter.start();
  logDebug("TmSorter.start()");
})();
