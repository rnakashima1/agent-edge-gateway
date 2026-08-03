// Light admin UI for editing the KV policy doc.
//
// Served at GET /__policy/ui. The page shell loads without auth; it asks for
// the admin token and sends it as a Bearer header on every API call
// (/__policy/api/*). Nothing is persisted client-side.
//
// A single site-wide grid: rows = "Default (all labs)" + each frontier lab;
// columns = the three buckets (AI Live Search / AI Indexing / AI Training).
// Each cell is an action select + a price field (enabled only for "monetize").
// Lab rows also offer "inherit" = no override (falls back to the default).
//
// The client script below deliberately uses no template literals or ${...} so
// it nests cleanly inside this module's own template string.

export function adminUiHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Edge Gateway — Policy Editor</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666;
    --line:#e2e2e2; --card:#fafafa; --accent:#2d6cdf; --ok:#137a3f; --err:#b00020; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --fg:#e8e8ea; --muted:#9aa0a6; --line:#2a2d34;
      --card:#171a20; --accent:#5b8def; --ok:#3fbf6b; --err:#ff6b6b; } }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:var(--bg); color:var(--fg); }
  header { padding:16px 20px; border-bottom:1px solid var(--line); display:flex;
    flex-wrap:wrap; gap:12px; align-items:center; }
  h1 { font-size:16px; margin:0; font-weight:650; }
  .grow { flex:1; }
  .muted { color:var(--muted); }
  main { padding:20px; max-width:980px; margin:0 auto; }
  input, select, button { font:inherit; color:var(--fg); background:var(--bg);
    border:1px solid var(--line); border-radius:6px; padding:6px 8px; }
  input[type=password] { min-width:220px; }
  button { cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:disabled { opacity:.5; cursor:default; }
  section.zone { border:1px solid var(--line); border-radius:10px; margin:0 0 20px;
    overflow:hidden; }
  section.zone > h2 { font-size:14px; margin:0; padding:10px 14px; background:var(--card);
    border-bottom:1px solid var(--line); }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left;
    vertical-align:middle; }
  th { font-weight:600; color:var(--muted); font-size:12px; text-transform:uppercase;
    letter-spacing:.03em; }
  td.vendor { font-weight:600; white-space:nowrap; }
  tr.default td.vendor { color:var(--accent); }
  .cell { display:flex; gap:6px; align-items:center; }
  .cell input.price { width:88px; }
  .price-wrap { display:flex; gap:4px; align-items:center; }
  .price-wrap.hidden { visibility:hidden; }
  #status { padding:8px 12px; border-radius:6px; }
  #status.ok { color:var(--ok); } #status.err { color:var(--err); white-space:pre-wrap; }
  .bar { position:sticky; bottom:0; background:var(--bg); border-top:1px solid var(--line);
    padding:12px 20px; display:flex; gap:12px; align-items:center; }
</style>
</head>
<body>
<header>
  <h1>Policy Editor <span class="muted">· agent-edge-gateway</span></h1>
  <div class="grow"></div>
  <label class="muted">Admin token
    <input id="token" type="password" placeholder="ADMIN_TOKEN" autocomplete="off">
  </label>
  <button id="load" class="primary">Load</button>
</header>
<main>
  <p id="hint" class="muted">Enter the admin token and click Load. Prices are in
    USD per request; charged only when the action is <b>monetize</b>. "Inherit"
    on a lab row means it falls back to the default.</p>
  <div id="zones"></div>
</main>
<div class="bar">
  <button id="save" class="primary" disabled>Save changes</button>
  <button id="reload" disabled>Reload</button>
  <span id="updated" class="muted"></span>
  <div class="grow"></div>
  <span id="status"></span>
</div>
<script>
(function () {
  var TOKEN = "";
  var META = null;
  var DOC = null;

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k.slice(0,2) === "on") n.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else n.setAttribute(k, props[k]);
    }
    if (kids) for (var i=0;i<kids.length;i++) if (kids[i] != null) n.appendChild(kids[i]);
    return n;
  }

  function setStatus(msg, kind) {
    var s = document.getElementById("status");
    s.textContent = msg || "";
    s.className = kind || "";
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: {
        "authorization": "Bearer " + TOKEN,
        "content-type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function(){ return {}; }).then(function (j) {
        return { status: r.status, json: j };
      });
    });
  }

  function cellValue(vendorSlug, intent) {
    if (vendorSlug === "__default__") return (DOC.defaults || {})[intent] || { action: "pass" };
    var v = (DOC.vendors || {})[vendorSlug];
    return v && v[intent] ? v[intent] : { action: "__inherit__" };
  }

  function buildCell(vendorSlug, intent) {
    var cur = cellValue(vendorSlug, intent);
    var opts = META.actions.slice();
    if (vendorSlug !== "__default__") opts = ["__inherit__"].concat(opts);

    var sel = el("select", { "data-vendor": vendorSlug, "data-intent": intent });
    for (var i=0;i<opts.length;i++) {
      var label = opts[i] === "__inherit__" ? "inherit" : opts[i];
      var o = el("option", { value: opts[i], text: label });
      if (opts[i] === cur.action) o.selected = true;
      sel.appendChild(o);
    }

    var price = el("input", { type: "number", step: "0.001", min: "0", "class": "price",
      value: cur.priceUsd != null ? String(cur.priceUsd) : "" });
    var priceWrap = el("span", { "class": "price-wrap" }, [ el("span",{text:"$"}), price ]);

    function sync() {
      if (sel.value === "monetize") priceWrap.classList.remove("hidden");
      else priceWrap.classList.add("hidden");
    }
    sel.addEventListener("change", sync);
    sync();

    return el("div", { "class": "cell" }, [ sel, priceWrap ]);
  }

  function render() {
    var root = document.getElementById("zones");
    root.innerHTML = "";
    var head = el("tr", null, [ el("th", { text: "Lab" }) ].concat(
      META.intents.map(function (it) { return el("th", { text: META.intentLabels[it] }); })
    ));
    var rows = [ el("tr", { "class": "default" }, [ el("td", { "class":"vendor", text:"Default (all labs)" }) ].concat(
      META.intents.map(function (it) { return el("td", null, [ buildCell("__default__", it) ]); })
    )) ];
    META.vendorList.forEach(function (v) {
      rows.push(el("tr", null, [ el("td", { "class":"vendor", text: v.label } ) ].concat(
        META.intents.map(function (it) { return el("td", null, [ buildCell(v.slug, it) ]); })
      )));
    });
    var table = el("table", null, [ el("thead", null, [head]), el("tbody", null, rows) ]);
    root.appendChild(el("section", { "class":"zone" }, [
      el("h2", { text: "Site-wide policy" }), table
    ]));
    document.getElementById("updated").textContent =
      DOC.updatedAt ? ("Last saved " + DOC.updatedAt) : "Unsaved (seed defaults)";
  }

  function collect() {
    var doc = { version: DOC.version || 3, defaults: {}, vendors: {} };
    var sels = document.querySelectorAll("select[data-vendor]");
    for (var i=0;i<sels.length;i++) {
      var s = sels[i];
      var vendor = s.getAttribute("data-vendor");
      var intent = s.getAttribute("data-intent");
      var action = s.value;
      if (action === "__inherit__") continue;
      var cell = { action: action };
      if (action === "monetize") {
        var price = s.parentNode.querySelector("input.price");
        cell.priceUsd = parseFloat(price.value) || 0;
      }
      if (vendor === "__default__") doc.defaults[intent] = cell;
      else {
        if (!doc.vendors[vendor]) doc.vendors[vendor] = {};
        doc.vendors[vendor][intent] = cell;
      }
    }
    return doc;
  }

  function load() {
    TOKEN = document.getElementById("token").value.trim();
    if (!TOKEN) { setStatus("Enter the admin token.", "err"); return; }
    setStatus("Loading…", "");
    api("GET", "/__policy/api/meta").then(function (m) {
      if (m.status !== 200) { setStatus("Auth failed (" + m.status + ")", "err"); return; }
      META = m.json;
      return api("GET", "/__policy/api/config").then(function (c) {
        if (c.status !== 200) { setStatus("Load failed (" + c.status + ")", "err"); return; }
        DOC = c.json;
        document.getElementById("hint").style.display = "none";
        render();
        document.getElementById("save").disabled = false;
        document.getElementById("reload").disabled = false;
        setStatus("Loaded.", "ok");
      });
    }).catch(function (e) { setStatus(String(e), "err"); });
  }

  function save() {
    var doc = collect();
    setStatus("Saving…", "");
    api("PUT", "/__policy/api/config", doc).then(function (r) {
      if (r.status === 200) {
        DOC = r.json.doc;
        document.getElementById("updated").textContent = "Last saved " + DOC.updatedAt;
        setStatus("Saved ✓", "ok");
      } else {
        var errs = (r.json && r.json.errors) ? r.json.errors.join("\\n") : ("Error " + r.status);
        setStatus(errs, "err");
      }
    }).catch(function (e) { setStatus(String(e), "err"); });
  }

  document.getElementById("load").addEventListener("click", load);
  document.getElementById("reload").addEventListener("click", load);
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("token").addEventListener("keydown", function (e) {
    if (e.key === "Enter") load();
  });
})();
</script>
</body>
</html>`;
}
