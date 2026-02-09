// ==UserScript==
// @name         Logistics Table Sorter (Replace-render safe)
// @namespace    Replenish_Arin
// @author       Kategorie
// @version      1.3.2
// @description  Sort columns even when the server re-renders the whole table.
// @match        https://inventory.coupang.com/replenish/order/list*
// @match        http://inventory.coupang.com/replenish/order/list*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Kategorie/Logistics-Table-Sorter/main/Logistics-Table-Sorter.user.js
// @updateURL    https://raw.githubusercontent.com/Kategorie/Logistics-Table-Sorter/main/Logistics-Table-Sorter.user.js

// ==/UserScript==

// TM = Tampermonkey
// version 매 번 올릴 것. 그래야 적용됨.
// namespace, downloadURL, updateURL 고정.
// 개발자 모드 + 확/프 세부정보-사용자 스크립트 허용 체크 필요.

(function () {
  "use strict";

  // 여기에서만 조정.
  const CONFIG_OVERRIDE = {
    tableSelector: 'table.table-bordered.table-striped.table-hover',
    headerNames: {
      buffer: "버퍼수량",
      replenish: "보충수량",
      order: "주문수량",
    },
    forcePageSize: 300,
    forceFirstPage: true,
    debug: false,
    debugTableDump: false,
    xhrMatch: (url) => {
      try {
        const u = new URL(url, location.href);
        return /^\/async\/replenish\/order\/search\/?$/.test(u.pathname);
      } catch {
        return false;
      }
    },
  };
  // tableSelector : 테이블 선택자
  // forceFirstPage : 항상 첫 페이지부터 다시 조회
  // debug : 개발 중엔 true, 배포 시 false

  // ---------- Debug logging ----------
  function logDebug(...args) {
    if (!CONFIG_OVERRIDE.debug) return;
    console.log("[TM][Logistics]", ...args);
  }

  // ---------- Replace-render safe sorter core ----------
  const TmSorter = (() => {
    "use strict";

    logDebug("[TM][Logistics] loaded v1.3.2", location.href);

    const CONFIG = {
      tableSelector: CONFIG_OVERRIDE.tableSelector,
      headerNames: CONFIG_OVERRIDE.headerNames,
      markerAttr: "data-tm-sort-initialized",
      parse: { emptyAs: Number.POSITIVE_INFINITY },
    };

    function normalizeText(s) {
      return (s ?? "").replace(/\s+/g, "").trim();
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

      const primary = Array.from(document.querySelectorAll(CONFIG.tableSelector));
      const all = primary.length ? primary : Array.from(document.querySelectorAll("table"));

      for (const table of all) {
        const ths = Array.from(table.querySelectorAll("thead th"));
        if (!ths.length) continue;
        const headers = ths.map(th => normalizeText(th.textContent));
        const ok = targets.every(t => headers.some(h => h.includes(t)));
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
      let fallback = -1;

      for (let i = 0; i < ths.length; i++) {
        const got = normalizeText(ths[i].textContent);
        if (got === target) return i;        // 완전 일치 우선
        if (fallback === -1 && got.includes(target)) fallback = i;
      }
      return fallback;
    }

    function readCellNumber(row, colIndex) {
      const cell = row?.children?.[colIndex];
      return cell ? parseNumber(cell.textContent) : CONFIG.parse.emptyAs;
    }

    function stableSortRows(rows, getKey, direction) {
      const dir = direction === "desc" ? -1 : 1;
      return rows
        .map((row, idx) => ({ row, idx, key: getKey(row) }))
        .sort((a, b) => {
          if (a.key < b.key) return -1 * dir;
          if (a.key > b.key) return  1 * dir;
          return a.idx - b.idx; // 동률이면 항상 원래 순서 유지
        })
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
        if (!h4) {
          if (CONFIG_OVERRIDE.debug) logDebug("shown/total ui skipped: h4 not found", { rootId });
          return;
        }

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

        // debug log
        if (CONFIG_OVERRIDE.debug) {
          const m = (totalTextNode.nodeValue || "").match(/총\s*([0-9,]+)\s*건/);
          const totalParsed = m ? Number(m[1].replaceAll(",", "")) : null;
          logDebug("count check", { shown, totalParsed });
        }
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
      if (window.__tmSorterObserverInstalled) return;
      window.__tmSorterObserverInstalled = true;

      let scheduled = false;
      let mo = null;

      const tryInit = () => {
        const table = getLatestTable();
        const thCount = table ? table.querySelectorAll("thead th").length : 0;
        const hasTbody = !!(table && table.querySelector("tbody"));
        logDebug("table probe", { found: !!table, th: thCount, hasTbody });

        if (table && thCount > 0 && hasTbody) {
          initTableIfNeeded(table);
        }
      };

      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          tryInit();
          // searchResultArea가 잡히면 observe 범위를 좁힘
          const area = document.getElementById("searchResultArea");
          if (area && mo) {
            mo.disconnect();
            mo.observe(area, { childList: true, subtree: true });
          }
        });
      };

      tryInit();

      mo = new MutationObserver(schedule);
      mo.observe(document.documentElement, { childList: true, subtree: true });
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
      const headerElNow = findSummaryHeaderElement();
      const latestTable = (typeof getLatestTable === "function") ? getLatestTable() : tableEl;
      openPrintWindowWithHeaderAndTable(headerElNow, latestTable, "Replenish Order Table");
    });

    const left = bar.querySelector("#tm-print-left");
    left.appendChild(btn);
  }

  // ---------- Lifecycle kick ----------
  // 페이지 복원, 포커스 복귀, SPA 내비게이션 시도 시 정렬 재시작.
  function installLifecycleKick() {
    const kick = () => {
      try { TmSorter.start(); } catch (e) {}
    };

    // bfcache 복원 포함
    window.addEventListener("pageshow", () => kick(), true);
    window.addEventListener("focus", () => kick(), true);

    // SPA 내비게이션 대응
    const _push = history.pushState;
    history.pushState = function (...args) { const r = _push.apply(this, args); kick(); return r; };
    const _rep = history.replaceState;
    history.replaceState = function (...args) { const r = _rep.apply(this, args); kick(); return r; };
    window.addEventListener("popstate", kick, true);
  }

  // ---------- Search request hook to force page size ----------
  /**
   * URL 문자열에서 특정 쿼리 파라미터만 안전하게 덮어씀.
   * - 기존에 없던 파라미터를 추가할 수도 있지만, 기본은 "덮어쓰기만" 하도록 옵션화
   * - 나머지 파라미터는 절대 건드리지 않음
   */
  function patchUrlQuery(url, patchMap, opts = {}) {
    const {
      allowAdd = false,   // false면 원래 없던 키는 추가하지 않음
      keepHash = true,
    } = opts;

    // 상대경로도 처리
    const u = new URL(url, location.href);
    const sp = u.searchParams;

    for (const [k, v] of Object.entries(patchMap)) {
      if (sp.has(k) || allowAdd) sp.set(k, String(v));
    }

    // URL 객체는 hash도 포함하므로 별도 처리 불필요하지만,
    // 혹시 정책상 hash 제거가 필요하면 옵션 처리
    if (!keepHash) u.hash = "";

    return u.toString();
  }

  // 조회값이 한 페이지에 모두 나오도록.
  /**
 * XHR send 후킹: 특정 엔드포인트에 대해서만 page/size만 강제
 * - '없던 파라미터를 추가'하지 않음(기본)
 * - 요청 본문(body) / headers 건드리지 않음
 * - GET/POST 모두 URL에 쿼리가 있는 경우만 패치
 */
  function installSearchRequestHook() {
    if (window.__tmXhrHookInstalled) return;
    window.__tmXhrHookInstalled = true;

    const OriginalOpen = XMLHttpRequest.prototype.open;

    // "order/list 화면"에서 발생하는 데이터 조회 호출만 체크.
    // pathname에 xhrMatch가 포함된 요청만 대상.
    const match = CONFIG_OVERRIDE.xhrMatch;

    // page/size만 최소 개입으로 덮어쓰기
    const buildPatch = () => {
      const size = Math.min(Number(CONFIG_OVERRIDE.forcePageSize) || 300, 300);
      const patch = { size };
      if (CONFIG_OVERRIDE.forceFirstPage) patch.page = 1;
      return patch;
    };

    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
      try {
        const urlStr = String(url ?? "");
        if (urlStr && match(urlStr)) {
          const patched = patchUrlQuery(urlStr, buildPatch(), {
            allowAdd: false, // 원래 없던 파라미터는 추가하지 않는 것이 안전
            keepHash: true,
          });

          if (patched !== urlStr) {
            logDebug("XHR url patched", { from: urlStr, to: patched });
          }

          return OriginalOpen.call(this, method, patched, async, user, password);
        }
      } catch (e) {
        logDebug("XHR hook open error", e);
      }

      return OriginalOpen.call(this, method, url, async, user, password);
    };
  }

  installSearchRequestHook();

  // 여기 한 줄만 실행
  TmSorter.start();
  installLifecycleKick();
  logDebug("TmSorter.start()");
})();
