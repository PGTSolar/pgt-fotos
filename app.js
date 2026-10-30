// PGS Fotos: app dos técnicos (versão 3)
(() => {
  const CFG = window.PGS_CONFIG;
  const CL = window.CHECKLIST;
  const S = { pin: "", user: null, list: null, filter: "Ativo", proj: null, uploading: false };
  const STATUS = { ACTIVE: "Ativo", DONE: "Instalação concluída", APPROVED: "Aprovado" };
  const $ = s => document.querySelector(s);
  const view = $("#view");
  let seq = 0; // evita que uma resposta antiga sobrescreva a tela atual

  // ---------- utilidades ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
  };
  function toast(msg, ms = 2600) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
  }
  function header(title, sub, back) {
    $("#title").textContent = title; $("#subtitle").textContent = sub || "";
    $("#back").hidden = !back; $("#back").onclick = () => { location.hash = back; };
    $("#menu").hidden = !S.user;
  }
  async function api(path, body = {}) {
    const r = await fetch(CFG.WORKER_URL + path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: S.pin, ...body }),
    });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401) { logout(); throw new Error("PIN inválido"); }
    if (!r.ok) throw new Error(j.error || "Erro " + r.status);
    return j;
  }
  const svcCode = id => (String(id).match(/^\d{6}([A-Z]{2})/) || [])[1] || "";
  function visibleItems(id) {
    const code = svcCode(id);
    const col = code === "SO" ? "so" : "sb";
    return CL.items.filter(i => i[col] && i[col] !== "N");
  }
  function itemState(items, it) {
    const s = (items || {})[it.id] || {};
    if (s.na) return "na";
    if (s.photos > 0) return "done";
    return "todo";
  }
  function progress(id, items) {
    const vis = visibleItems(id);
    const ok = vis.filter(i => itemState(items, i) !== "todo").length;
    return { ok, total: vis.length, pending: vis.length - ok };
  }
  function tags(it, code) {
    const v = code === "SO" ? it.so : it.sb;
    let h = "";
    if (it.so === "N" && code !== "SO") h += '<span class="tag b">BATERIA</span>';
    if (v === "C") h += `<span class="tag c">${esc(it.cond ? "SE: " + it.cond : "SE APLICÁVEL")}</span>`;
    if (v === "TBD") h += '<span class="tag c">A CONFIRMAR</span>';
    if (it.per && it.per !== "Once") h += `<span class="tag n">${esc(perPt(it.per))}</span>`;
    return h;
  }
  function perPt(p) {
    const m = { "Per array": "por array", "Per row": "por fileira", "Per J-box": "por J-box", "Per roof plane": "por plano do telhado",
      "Per roof area": "por área do telhado", "Per mount type": "por tipo de suporte", "Per penetration": "por penetração",
      "Per rod": "por haste", "Per equipment": "por equipamento", "Per placard": "por placa", "Per PW3": "por PW3",
      "Per splice": "por emenda", "Per MPPT": "por MPPT", "Per ladder": "por escada" };
    return m[p] || p;
  }
  function statusTag(s) {
    const c = s === STATUS.APPROVED ? "appr" : s === STATUS.DONE ? "done" : "st";
    return `<span class="tag ${c}">${esc(s)}</span>`;
  }
  // encontra a pasta do Drive de um item: instalação > etapa > subpasta
  function folderFor(map, st, sf) {
    const keys = Object.keys(map || {});
    const pad = n => String(n).padStart(2, "0") + " - ";
    const roots = keys.filter(k => !k.includes("/"));
    const inst = roots.find(k => /INSTALLATION/i.test(k)) || roots.find(r => keys.some(k => k.startsWith(r + "/" + pad(1))));
    if (!inst) return null;
    const stage = keys.find(k => k.startsWith(inst + "/") && k.split("/").length === 2 && k.split("/")[1].startsWith(pad(st)));
    if (!stage) return null;
    if (!sf) return map[stage];
    const sub = keys.find(k => k.startsWith(stage + "/") && k.split("/").length === 3 && k.split("/")[2].startsWith(pad(sf)));
    return sub ? map[sub] : null;
  }
  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function loading(msg = "Carregando...") { view.innerHTML = `<p class="muted center" style="margin-top:40px"><span class="spin"></span> ${esc(msg)}</p>`; }
  function fail(e, retry) {
    view.innerHTML = `<div class="card"><p class="err">${esc(e.message || e)}</p><button class="btn ghost" id="rt">Tentar de novo</button></div>`;
    $("#rt").onclick = retry;
  }

  // ---------- login ----------
  function logout() {
    store.set("pgs_pin", ""); S.pin = ""; S.user = null; S.list = null;
    location.hash = "#/"; render();
  }
  $("#menu").onclick = () => { if (!S.uploading) logout(); else toast("Espere o envio terminar"); };

  function viewLogin(msg) {
    header("PGS Fotos", "Pure Greentech");
    view.innerHTML = `
      <div class="logo">PG</div>
      <p class="center muted" style="margin-bottom:18px">Digite seu PIN para entrar</p>
      <div class="card">
        <input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN">
        <div style="height:10px"></div>
        <button class="btn" id="go">Entrar</button>
        ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      </div>`;
    const go = async () => {
      S.pin = $("#pin").value.trim(); if (!S.pin) return;
      $("#go").disabled = true;
      try { S.user = await api("/login"); store.set("pgs_pin", S.pin); route(); }
      catch (e) { viewLogin(e.message); }
    };
    $("#go").onclick = go;
    $("#pin").onkeydown = e => { if (e.key === "Enter") go(); };
  }

  // ---------- lista de projetos ----------
  async function viewList() {
    header("Projetos", `${S.user.name}${S.user.admin ? " (admin)" : ""}`);
    if (!S.list) loading();
    const my = ++seq;
    let fresh; try { fresh = (await api("/projects")).projects; } catch (e) { return my === seq && fail(e, viewList); }
    if (my !== seq) return;
    S.list = fresh;
    const q = (store.get("pgs_q") || "").toLowerCase();
    const filters = S.user.admin ? [STATUS.ACTIVE, STATUS.DONE, STATUS.APPROVED, "Todos"] : [];
    const list = S.list.filter(p => (!S.user.admin || S.filter === "Todos" || p.status === S.filter))
      .filter(p => !q || `${p.id} ${p.client} ${p.address} ${p.internalCode}`.toLowerCase().includes(q))
      .sort((a, b) => b.id.localeCompare(a.id));
    view.innerHTML = `
      ${S.user.admin ? `<button class="btn dark" id="new">+ Criar projeto novo</button><div style="height:12px"></div>` : ""}
      <input id="q" type="search" placeholder="Buscar por nome, ID ou endereço" value="${esc(q)}">
      <div style="height:10px"></div>
      ${filters.length ? `<div class="chips">${filters.map(f => `<button class="chip ${f === S.filter ? "on" : ""}" data-f="${esc(f)}">${esc(f)}</button>`).join("")}</div>` : ""}
      ${list.length ? list.map(p => {
        const pr = progress(p.id, p.items);
        return `<a class="card proj" href="#/p/${encodeURIComponent(p.id)}">
          <div class="top"><div><b>${esc(p.client)}</b><div class="muted">${esc(p.id)}${p.internalCode ? " · #" + esc(p.internalCode) : ""} · ${esc(p.partner)}</div>
          ${p.address ? `<div class="muted">${esc(p.address)}</div>` : ""}</div>${statusTag(p.status)}</div>
          <div class="bar"><div style="width:${pr.total ? (pr.ok / pr.total * 100) : 0}%"></div></div>
          <div class="muted" style="margin-top:6px">${pr.ok} de ${pr.total} itens · ${pr.pending ? `<span class="err">${pr.pending} pendentes</span>` : '<span class="ok">tudo enviado</span>'}</div>
        </a>`;
      }).join("") : `<p class="muted center">Nenhum projeto ${S.user.admin ? "neste filtro" : "ativo no momento"}.</p>`}`;
    $("#q").oninput = e => { store.set("pgs_q", e.target.value); clearTimeout(viewList.t); viewList.t = setTimeout(viewList, 250); };
    view.querySelectorAll(".chip").forEach(c => c.onclick = () => { S.filter = c.dataset.f; viewList(); });
    if ($("#new")) $("#new").onclick = () => { location.hash = "#/admin/new"; };
  }

  // ---------- projeto ----------
  async function loadProject(id, fresh) {
    if (!fresh && S.proj && S.proj.project.id === id) return S.proj;
    S.proj = await api("/project", { id, fresh: !!fresh });
    return S.proj;
  }
  async function viewProject(id) {
    header("Projeto", id, "#/");
    if (!S.proj || S.proj.project.id !== id) loading();
    const my = ++seq;
    let d; try { d = await loadProject(id, true); } catch (e) { return my === seq && fail(e, () => viewProject(id)); }
    if (my !== seq) return;
    const p = d.project, code = svcCode(p.id);
    header(p.client, `${p.id} · ${p.service}`, "#/");
    const vis = visibleItems(p.id);
    const pr = progress(p.id, d.items);
    const open = store.get("pgs_open_" + p.id) || "";
    let html = `<div class="card"><div class="row" style="align-items:center"><div>${statusTag(p.status)}
      <div class="muted" style="margin-top:6px">${p.address ? esc(p.address) : ""}</div></div>
      <div style="text-align:right;flex:0 0 auto"><div class="big">${pr.ok}/${pr.total}</div><div class="muted">itens</div></div></div>
      <div class="bar"><div style="width:${pr.total ? pr.ok / pr.total * 100 : 0}%"></div></div></div>`;
    if (!["SB", "SO"].includes(code)) html += `<div class="card"><p class="err">Checklist pronto só para SB e SO. Este projeto usa o checklist de Solar + Battery.</p></div>`;
    for (const st of [1, 2, 3, 4]) {
      const its = vis.filter(i => i.st === st);
      const pend = its.filter(i => itemState(d.items, i) === "todo").length;
      html += `<details class="card stage" data-st="${st}" ${open.includes(st) ? "open" : ""}><summary>
        <span class="num">${st}</span><span class="nm">${esc(CL.stages[st].replace(/^\d+ - /, ""))}</span>
        <span class="cnt ${pend ? "" : "all"}">${pend ? pend + " pendentes" : "completo"}</span></summary>`;
      let lastSf = -1;
      for (const it of its) {
        if (it.sf !== lastSf && it.sf) html += `<div class="sub">${String(it.sf).padStart(2, "0")} · ${esc(CL.subs[st][it.sf])}</div>`;
        lastSf = it.sf;
        const s = itemState(d.items, it), info = (d.items || {})[it.id] || {};
        html += `<a class="item" href="#/p/${encodeURIComponent(p.id)}/i/${encodeURIComponent(it.id)}">
          <span class="dot ${s}">${s === "done" ? "&#10003;" : s === "na" ? "&ndash;" : ""}</span>
          <span class="tx"><div class="en">${esc(it.en)}</div><div class="pt">${esc(it.pt)}</div><div>${tags(it, code)}</div></span>
          <span class="meta">${s === "done" ? info.photos + " foto" + (info.photos > 1 ? "s" : "") : s === "na" ? "N/A" : ""}</span></a>`;
      }
      html += `</details>`;
    }
    const comments = (d.comments || []).filter(c => !c.item).slice(-10).reverse();
    html += `<h2>Comentários do projeto</h2><div class="card">
      <textarea id="pc" placeholder="Escreva um comentário para o escritório"></textarea><div style="height:8px"></div>
      <button class="btn ghost" id="pcs">Enviar comentário</button>
      ${comments.map(c => `<div class="comment">${esc(c.text)}<br><small>${esc(c.user)} · ${new Date(c.ts).toLocaleString("pt-BR")}</small></div>`).join("")}
    </div>`;
    if (S.user.admin) {
      html += `<h2>Administrador</h2><div class="card">
        <p class="muted">Pasta no Drive: <a href="https://drive.google.com/drive/folders/${esc(p.folderId)}" target="_blank" rel="noopener">abrir</a></p>
        <div class="row">${[STATUS.ACTIVE, STATUS.DONE, STATUS.APPROVED].filter(s => s !== p.status)
          .map(s => `<button class="btn ghost st" data-s="${esc(s)}">Marcar ${esc(s)}</button>`).join("")}</div></div>`;
    }
    view.innerHTML = html;
    if (p.status === STATUS.ACTIVE) {
      const f = document.createElement("div"); f.className = "foot";
      f.innerHTML = `<div class="in"><button class="btn ${pr.pending ? "" : "dark"}" id="fin" ${pr.pending ? "disabled" : ""}>
        ${pr.pending ? `Faltam ${pr.pending} itens para concluir` : "Marcar instalação concluída"}</button></div>`;
      view.appendChild(f);
      const fin = $("#fin");
      fin.onclick = async () => {
        if (!fin.dataset.c) { fin.dataset.c = "1"; fin.textContent = "Toque de novo para confirmar"; fin.className = "btn warn"; return; }
        fin.disabled = true;
        try { await api("/status", { projectId: p.id, status: STATUS.DONE }); toast("Instalação marcada como concluída"); S.list = null; location.hash = "#/"; }
        catch (e) { toast(e.message); fin.disabled = false; }
      };
    }
    view.querySelectorAll("details.stage").forEach(dt => dt.ontoggle = () => {
      const o = [...view.querySelectorAll("details.stage[open]")].map(x => x.dataset.st).join("");
      store.set("pgs_open_" + p.id, o);
    });
    $("#pcs").onclick = async () => {
      const t = $("#pc").value.trim(); if (!t) return;
      $("#pcs").disabled = true;
      try { await api("/log", { projectId: p.id, itemId: "", action: "comment", value: t }); toast("Comentário enviado"); viewProject(p.id); }
      catch (e) { toast(e.message); $("#pcs").disabled = false; }
    };
    view.querySelectorAll("button.st").forEach(b => b.onclick = async () => {
      if (!b.dataset.c) { b.dataset.c = "1"; b.textContent = "Confirmar: " + b.dataset.s; b.className = "btn warn st"; return; }
      b.disabled = true;
      try { await api("/status", { projectId: p.id, status: b.dataset.s }); toast("Status atualizado"); S.list = null; viewProject(p.id); }
      catch (e) { toast(e.message); b.disabled = false; }
    });
  }

  // ---------- item ----------
  async function viewItem(id, itemId) {
    const back = `#/p/${encodeURIComponent(id)}`;
    header("Item", id, back);
    const my = ++seq;
    let d; try { d = await loadProject(id); } catch (e) { return my === seq && fail(e, () => viewItem(id, itemId)); }
    if (my !== seq) return;
    const it = CL.items.find(i => i.id === itemId);
    if (!it) return fail(new Error("Item não encontrado"), () => (location.hash = back));
    const p = d.project, code = svcCode(p.id);
    header(it.en, `${p.client} · ${CL.stages[it.st]}${it.sf ? " / " + String(it.sf).padStart(2, "0") + " " + CL.subs[it.st][it.sf] : ""}`, back);
    const info = (d.items || {})[it.id] || { photos: 0, na: "" };
    const folder = folderFor(p.map, it.st, it.sf);
    const comments = (d.comments || []).filter(c => c.item === it.id).slice(-10).reverse();
    view.innerHTML = `
      <div class="card detail">
        <p class="en">${esc(it.en)}</p><p class="pt">${esc(it.pt)}</p>
        <div>${tags(it, code)}</div>
        <p>${esc(it.den)}</p><p class="muted">${esc(it.dpt)}</p>
      </div>
      <div class="card">
        <div class="row" style="align-items:center"><div><div class="big" id="cnt">${info.photos}</div><div class="muted">fotos já enviadas</div></div>
        ${info.na ? `<div><span class="tag n">NÃO SE APLICA</span><div class="muted">${esc(info.na)}</div></div>` : ""}</div>
        ${folder ? "" : `<p class="err">A pasta deste item não foi encontrada no Drive. Avise o escritório.</p>`}
        <div style="height:12px"></div>
        <label class="btn" for="pick" ${folder ? "" : 'style="opacity:.45;pointer-events:none"'}>Escolher fotos da galeria</label>
        <input id="pick" type="file" accept="image/*" multiple>
        <div style="height:8px"></div>
        <label class="btn ghost" for="cam" ${folder ? "" : 'style="opacity:.45;pointer-events:none"'}>Tirar foto agora</label>
        <input id="cam" type="file" accept="image/*" capture="environment">
        <div id="up"></div>
      </div>
      <h2>Não se aplica</h2>
      <div class="card">
        ${info.na ? `<p class="muted">Marcado por ${esc(info.naBy)}: ${esc(info.na)}</p><button class="btn danger" id="naclr">Desfazer "não se aplica"</button>`
          : `<textarea id="naj" placeholder="Explique por que este item não se aplica a este projeto (obrigatório)"></textarea><div style="height:8px"></div>
             <button class="btn ghost" id="nab">Marcar como não se aplica</button>`}
      </div>
      <h2>Comentário sobre este item</h2>
      <div class="card">
        <textarea id="ic" placeholder="Ex.: placa refeita, foto 3 é a melhor"></textarea><div style="height:8px"></div>
        <button class="btn ghost" id="ics">Enviar comentário</button>
        ${comments.map(c => `<div class="comment">${esc(c.text)}<br><small>${esc(c.user)} · ${new Date(c.ts).toLocaleString("pt-BR")}</small></div>`).join("")}
      </div>`;
    const onPick = e => { const files = [...e.target.files]; e.target.value = ""; if (files.length) upload(p, it, folder, files); };
    $("#pick").onchange = onPick; $("#cam").onchange = onPick;
    $("#pick").onclick = () => { $("#up").innerHTML = `<p class="muted"><span class="spin"></span> Preparando fotos... no iPhone isso pode levar alguns segundos.</p>`; };
    if ($("#nab")) $("#nab").onclick = async () => {
      const t = $("#naj").value.trim(); if (!t) return toast("Escreva a justificativa");
      $("#nab").disabled = true;
      try { await api("/log", { projectId: p.id, itemId: it.id, action: "na", value: t }); S.proj = null; toast("Marcado como não se aplica"); location.hash = back; }
      catch (e) { toast(e.message); $("#nab").disabled = false; }
    };
    if ($("#naclr")) $("#naclr").onclick = async () => {
      try { await api("/log", { projectId: p.id, itemId: it.id, action: "na_clear", value: "" }); S.proj = null; viewItem(id, itemId); }
      catch (e) { toast(e.message); }
    };
    $("#ics").onclick = async () => {
      const t = $("#ic").value.trim(); if (!t) return;
      $("#ics").disabled = true;
      try { await api("/log", { projectId: p.id, itemId: it.id, action: "comment", value: t }); S.proj = null; toast("Comentário enviado"); viewItem(id, itemId); }
      catch (e) { toast(e.message); $("#ics").disabled = false; }
    };
  }

  // ---------- envio de fotos ----------
  function putFile(url, file, onProg) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open("PUT", url);
      x.setRequestHeader("Content-Type", file.type || "image/jpeg");
      x.upload.onprogress = e => e.lengthComputable && onProg(e.loaded / e.total);
      x.onload = () => (x.status >= 200 && x.status < 300 ? res() : rej(new Error("Google respondeu " + x.status)));
      x.onerror = () => rej(new Error("Falha de rede"));
      x.send(file);
    });
  }
  async function upload(p, it, folder, files) {
    if (S.uploading) return toast("Já existe um envio em andamento");
    S.uploading = true;
    const banner = $("#banner"); banner.textContent = "Enviando fotos. Não feche o app nem bloqueie a tela."; banner.hidden = false;
    const base = stamp();
    const jobs = files.map((f, i) => ({ f, i, state: "fila", prog: 0, err: "" }));
    const box = $("#up");
    const draw = () => {
      const ok = jobs.filter(j => j.state === "ok").length, bad = jobs.filter(j => j.state === "erro").length;
      const pct = jobs.reduce((a, j) => a + (j.state === "ok" ? 1 : j.prog), 0) / jobs.length * 100;
      box.innerHTML = `<div style="height:12px"></div><div class="big">${ok} de ${jobs.length} enviadas</div>
        <div class="bar"><div style="width:${pct}%"></div></div>
        ${bad ? `<p class="err">${bad} falharam</p>` : ""}
        <ul class="queue">${jobs.map(j => `<li><span>Foto ${j.i + 1} (${(j.f.size / 1048576).toFixed(1)} MB)</span>
          <span class="${j.state === "ok" ? "ok" : j.state === "erro" ? "err" : "muted"}">${j.state === "enviando" ? Math.round(j.prog * 100) + "%" : j.state}${j.err ? ": " + esc(j.err) : ""}</span></li>`).join("")}</ul>
        ${bad && !S.uploading ? `<div style="height:8px"></div><button class="btn warn" id="retry">Tentar de novo as que falharam</button>` : ""}`;
      const r = $("#retry"); if (r) r.onclick = () => upload(p, it, folder, jobs.filter(j => j.state === "erro").map(j => j.f));
    };
    const one = async j => {
      const ext = (j.f.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const name = `${p.id}_${it.id}_${base}_${String(j.i + 1).padStart(2, "0")}.${ext}`;
      for (let t = 1; t <= 3; t++) {
        try {
          j.state = "enviando"; j.prog = 0; j.err = ""; draw();
          const s = await api("/upload-session", { projectId: p.id, itemId: it.id, folderId: folder, fileName: name, mimeType: j.f.type || "image/jpeg", size: j.f.size });
          await putFile(s.uploadUrl, j.f, v => { j.prog = v; draw(); });
          j.state = "ok"; draw(); return;
        } catch (e) {
          j.err = e.message;
          if (/PIN|não está ativo|não pertence/.test(e.message) || t === 3) { j.state = "erro"; draw(); return; }
          await new Promise(r => setTimeout(r, 1500 * t));
        }
      }
    };
    const q = [...jobs];
    const workers = Array.from({ length: Math.min(CFG.PARALLEL_UPLOADS || 3, q.length) }, async () => { while (q.length) await one(q.shift()); });
    draw();
    await Promise.all(workers);
    const ok = jobs.filter(j => j.state === "ok").length;
    S.uploading = false; banner.hidden = true;
    if (ok) {
      try { await api("/log", { projectId: p.id, itemId: it.id, action: "upload", value: ok }); }
      catch (e) { toast("Fotos enviadas, mas o contador não atualizou: " + e.message, 5000); }
      S.proj = null;
      const c = $("#cnt"); if (c) c.textContent = Number(c.textContent) + ok;
    }
    draw();
    toast(ok === jobs.length ? `${ok} fotos enviadas` : `${ok} de ${jobs.length} enviadas`);
  }
  window.addEventListener("beforeunload", e => { if (S.uploading) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- administrador: criar projeto ----------
  async function viewNew() {
    header("Criar projeto", "Da planilha Projects Control", "#/");
    if (!S.user.admin) return (location.hash = "#/");
    loading("Lendo a planilha...");
    const my = ++seq;
    let list; try { list = (await api("/admin/pending")).projects; } catch (e) { return my === seq && fail(e, viewNew); }
    if (my !== seq) return;
    list.sort((a, b) => b.id.localeCompare(a.id));
    const old = list.filter(r => r.existing), open = list.filter(r => !r.existing);
    const card = r => {
      const code = svcCode(r.id), probs = [...r.problems];
      if (!["SB", "SO"].includes(code)) probs.push("Checklist pronto só para SB e SO");
      if (r.conflict) probs.push(`Já existe pasta deste cliente com outro ID: "${r.conflict}". Confira o ID na planilha.`);
      return `<div class="card"><b>${esc(r.client || "(sem nome)")}</b>
        <div class="muted">${esc(r.id)} · ${esc(r.service)} · ${esc(r.partner || "sem partner")}</div>
        ${r.address ? `<div class="muted">${esc(r.address)}</div>` : ""}
        ${probs.map(x => `<div class="err" style="font-size:13.5px">${esc(x)}</div>`).join("")}
        <div style="height:10px"></div>
        <button class="btn mk" data-id="${esc(r.id)}" ${probs.length ? "disabled" : ""}>Criar pasta e liberar</button>
        <div class="out"></div></div>`;
    };
    view.innerHTML = `<p class="muted">Projetos da aba Projects que ainda não estão no app. Criar o projeto monta a pasta no Drive a partir do modelo V1 e libera o projeto para os técnicos.</p>
      ${open.length ? open.map(card).join("") : '<p class="muted center">Nenhum projeto novo para criar.</p>'}
      ${old.length ? `<h2>Já têm pasta no Drive</h2>
        <p class="muted">Pastas criadas à mão. Se a pasta foi copiada do modelo V1, dá para usar no app. Se está no padrão antigo, o projeto termina no fluxo atual.</p>
        ${old.map(r => `<div class="card old" data-id="${esc(r.id)}" data-recv="${esc(r.received)}"><b>${esc(r.client)}</b>
          <div class="muted">${esc(r.existing)}</div><div class="chk"></div><div class="out"></div></div>`).join("")}` : ""}`;
    view.querySelectorAll("button.mk").forEach(b => b.onclick = () => create(b, "create"));
    // confere as pastas existentes recentes (últimos 120 dias); as mais antigas só sob demanda
    const recent = d => { const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) return true; return Date.now() - new Date(+m[3], +m[1] - 1, +m[2]) < 120 * 864e5; };
    const cards = [...view.querySelectorAll(".card.old")];
    const check = async c => {
      const box = c.querySelector(".chk");
      box.innerHTML = '<p class="muted"><span class="spin"></span> Conferindo a pasta...</p>';
      try {
        const r = await api("/admin/check-existing", { id: c.dataset.id });
        if (r.compatible) {
          box.innerHTML = `<p class="ok" style="font-size:13.5px">Pasta no modelo V1</p>
            <button class="btn mk" data-id="${esc(c.dataset.id)}">Usar pasta existente e liberar</button>`;
          box.querySelector("button").onclick = e => create(e.target, "adopt");
        } else box.innerHTML = `<p class="muted">Padrão antigo: fica fora do app. ${esc(r.reason || "")}</p>`;
      } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    };
    const queue = cards.filter(c => recent(c.dataset.recv));
    cards.filter(c => !recent(c.dataset.recv)).forEach(c => {
      c.querySelector(".chk").innerHTML = '<button class="btn ghost">Conferir pasta</button>';
      c.querySelector(".chk button").onclick = () => check(c);
    });
    (async () => { for (const c of queue) { if (my !== seq) return; await check(c); } })();
  }
  async function create(b, mode) {
    const out = b.closest(".card").querySelector(".out");
    if (!b.dataset.c) { b.dataset.c = "1"; b.textContent = "Toque de novo para confirmar"; b.classList.add("warn"); return; }
    const btns = [...document.querySelectorAll("button.mk")];
    const was = btns.map(x => x.disabled);
    btns.forEach(x => (x.disabled = true));
    const say = h => (out.innerHTML = `<p class="muted">${h}</p>`);
    try {
      say(`<span class="spin"></span> ${mode === "adopt" ? "Lendo a pasta existente..." : "Criando a pasta do projeto..."}`);
      const r = await api(mode === "adopt" ? "/admin/adopt-start" : "/admin/create-start", { id: b.dataset.id });
      const path = r.path;
      let st = r.state;
      for (let guard = 0; guard < 40; guard++) {
        say(`<span class="spin"></span> ${esc(path)}<br>${mode === "adopt" ? "conferindo subpastas" : st.done + " pastas criadas"}...`);
        const s = await api("/admin/create-step", { state: st });
        st = s.state; if (s.finished) break;
      }
      const f = await api("/admin/create-finish", { state: st });
      out.innerHTML = `<p class="ok">${f.adopted ? `Pronto: pasta existente liberada no app${f.folders ? ` (${f.folders} subpastas que faltavam foram criadas)` : ""}.` : `Pronto: ${f.folders} pastas criadas.`}</p>
        <p class="muted">${esc(path)}</p>
        <a class="btn ghost" href="${esc(f.url)}" target="_blank" rel="noopener">Abrir no Drive</a>`;
      b.remove(); S.list = null;
    } catch (e) {
      out.innerHTML = `<p class="err">${esc(e.message)}</p>${mode === "adopt" ? "" : '<p class="muted">Se a pasta foi criada pela metade, apague-a no Drive antes de tentar de novo.</p>'}`;
    } finally {
      btns.forEach((x, i) => (x.disabled = was[i]));
    }
  }

  // ---------- rotas ----------
  function route() {
    if (S.uploading) return;
    window.scrollTo(0, 0);
    if (!S.user) return viewLogin();
    const h = decodeURIComponent(location.hash || "#/");
    let m;
    if ((m = h.match(/^#\/p\/([^/]+)\/i\/(.+)$/))) return viewItem(m[1], m[2]);
    if ((m = h.match(/^#\/p\/([^/]+)$/))) return viewProject(m[1]);
    if (h === "#/admin/new") return viewNew();
    return viewList();
  }
  async function render() {
    S.pin = store.get("pgs_pin");
    if (S.pin && !S.user) {
      loading();
      try { S.user = await api("/login"); } catch (e) { S.user = null; return viewLogin(e.message === "PIN inválido" ? "" : e.message); }
    }
    route();
  }
  window.addEventListener("hashchange", () => {
    if (S.uploading) { toast("Espere o envio terminar"); return; }
    route();
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  render();
})();
