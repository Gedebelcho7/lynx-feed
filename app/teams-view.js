// ===== TABLEAU DE TOUTES LES ÉQUIPES + FICHE DÉTAILLÉE (title-chip / at-sort-th) =====
        let _atSort = { k: "pts", dir: -1 };
        async function renderAllTeams() {
            const anchor = document.getElementById("home-extremes-container");
            if (!anchor) return;
            let S; try { S = await seasonLiveStats(); } catch (e) { return; }
            let el = document.getElementById("all-teams-block");
            if (!el) {
                el = document.createElement("div"); el.id = "all-teams-block";
                el.className = "bg-white/70 dark:bg-dark-card/70 backdrop-blur-lg p-4 rounded-xl shadow-xl mt-4";
                anchor.parentNode.insertBefore(el, anchor.nextSibling);
            }
            const ts = (S.teams || []).filter(t => t && t.name && (t.mj || t.rep));
            if (!ts.length) { el.innerHTML = ""; return; }
            const cols = [
                ["Équipe", "name", 0], ["MJ", "mj", -1], ["Pts", "pts", -1], ["Bilan", null, 0], ["Buts", null, 0], ["PP%", "ppr", -1], ["PK%", "pkr", -1],
                ["Tirs/m", "shm", -1], ["Pén/m", "penm", -1], ["Serrés", "closeN", -1], ["1er but", "fbr", -1], ["xPts", "xPts", -1], ["Δ", "delta", -1]
            ];
            ts.forEach(t => {
                t.ppr = t.ppOcc ? t.supG / t.ppOcc : -1;
                t.pkr = t.penN ? 1 - t.infGa / t.penN : -1;
                t.shm = t.shotsN ? t.shotsF / t.shotsN : -1;
                t.penm = t.rep ? t.penMin / t.rep : -1;
                t.fbr = t.fbN ? t.fbW / t.fbN : -1;
                t.delta = (t.xN && t.xPts != null) ? t.realPts - t.xPts : -99;
            });
            const k = _atSort.k;
            ts.sort((a, b) => {
                if (k === "name") return _atSort.dir * String(a.name).localeCompare(String(b.name));
                if (k === null || a[k] == null || b[k] == null) return (b.pts - a.pts) || (b.gf - b.ga) - (a.gf - a.ga);
                return _atSort.dir * (b[k] - a[k]);
            });
            const cell = (t, c) => {
                switch (c[1]) {
                    case "name": return `<td class="py-2 px-2 font-bold text-left cursor-pointer team-detail-open hover:text-lynx-red" data-team="${xmlEsc(t.name)}">${xmlEsc(t.name)}</td>`;
                    case null: return c[0] === "Bilan" ? `<td class="py-2 px-2 whitespace-nowrap">${t.w}-${t.l}${(t.wot || t.lot) ? ` <span class="text-[10px] text-gray-400">(${t.wot || 0}pp/${t.lot || 0}po)</span>` : ""}</td>` : `<td class="py-2 px-2 whitespace-nowrap">${t.gf}:${t.ga}</td>`;
                    case "ppr": return `<td class="py-2 px-2">${t.ppOcc ? Math.round(t.ppr * 100) + "%" : "—"}</td>`;
                    case "pkr": return `<td class="py-2 px-2">${t.penN ? Math.round(t.pkr * 100) + "%" : "—"}</td>`;
                    case "shm": return `<td class="py-2 px-2">${t.shotsN ? t.shm.toFixed(1) : "—"}</td>`;
                    case "penm": return `<td class="py-2 px-2">${t.rep ? t.penm.toFixed(1) : "—"}</td>`;
                    case "fbr": return `<td class="py-2 px-2">${t.fbN ? Math.round(t.fbr * 100) + "%" : "—"}</td>`;
                    case "xPts": return `<td class="py-2 px-2">${t.xN ? Math.round(t.xPts) : "—"}</td>`;
                    case "delta": return `<td class="py-2 px-2 font-bold ${(t.delta > 0) ? "text-green-600" : ((t.delta < 0 && t.delta > -99) ? "text-red-500" : "")}">${(t.delta > -99 && t.delta != 0) ? ((t.delta > 0 ? "+" : "") + Math.round(t.delta)) : "="}</td>`;
                    default: return `<td class="py-2 px-2">${t[c[1]] != null ? t[c[1]] : "—"}</td>`;
                }
            };
            el.innerHTML = `<div class="flex items-center justify-between mb-2 flex-wrap gap-1"><h3 class="text-sm font-bold uppercase text-gray-500 tracking-widest">📊 Toutes les équipes — la saison en chiffres</h3><span class="text-[10px] text-gray-400">Clique sur un nom pour la fiche complète · clique sur un titre de colonne pour trier</span></div><div class="overflow-x-auto"><table class="w-full text-xs text-center min-w-[760px]"><thead><tr class="text-[10px] uppercase text-gray-400 border-b dark:border-gray-700">${cols.map(c => `<th class="py-2 px-2 cursor-pointer hover:text-lynx-red at-sort-th" data-k="${c[1] || ""}" data-lab="${c[0]}">${c[0]}${_atSort.k === c[1] ? (_atSort.dir < 0 ? " ▼" : " ▲") : ""}</th>`).join("")}</tr></thead><tbody>${ts.map(t => `<tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">${cols.map(c => cell(t, c)).join("")}</tr>`).join("")}</tbody></table></div>`;
        }
        async function openTeamDetail(name) {
            let S; try { S = await seasonLiveStats(); } catch (e) { return; }
            const t = (S.teams || []).find(x => normalize(x.name) === normalize(name));
            if (!t) return;
            const T = computeTitles(S).filter(x => normalize(x.team) === normalize(name));
            const h = titlesHistory();
            const sn = String(activeSeason || "?");
            const past = [];
            Object.keys(h[sn] || {}).forEach(k2 => {
                const c = h[sn][k2];
                if (normalize(c.team) === normalize(name)) past.push(k2 + " (depuis le " + new Date(c.since).toLocaleDateString("fr-FR") + ")");
                (c.prev || []).forEach(p => { if (normalize(p.team) === normalize(name)) past.push(k2 + " (jusqu\'au " + new Date(p.until).toLocaleDateString("fr-FR") + ")"); });
            });
            const scorers = Object.keys(t.scorers || {}).sort((a, b) => t.scorers[b] - t.scorers[a]).slice(0, 5);
            const pp = t.ppOcc ? Math.round(t.supG / t.ppOcc * 100) + "%" : "—", pk = t.penN ? Math.round((1 - t.infGa / t.penN) * 100) + "%" : "—";
            const row = (lab, val) => `<div class="flex justify-between gap-2 py-1 border-b border-gray-100 dark:border-gray-800"><span class="text-gray-400">${lab}</span><span class="font-bold text-right">${val}</span></div>`;
            let modal = document.getElementById("team-detail-modal");
            if (!modal) {
                modal = document.createElement("div"); modal.id = "team-detail-modal";
                modal.className = "modal fixed inset-0 bg-black/80 backdrop-blur-sm flex justify-center items-center p-4 z-[9999] opacity-0 pointer-events-none";
                modal.innerHTML = `<div class="modal-content bg-white dark:bg-dark-card w-[95%] max-w-lg rounded-2xl p-6 shadow-2xl border border-gray-200 dark:border-gray-700 relative max-h-[85vh] overflow-y-auto"><button id="team-detail-close" class="absolute top-3 right-3 text-gray-400 hover:text-lynx-red text-2xl p-2">✕</button><div id="team-detail-content"></div></div>`;
                document.body.appendChild(modal);
                modal.querySelector("#team-detail-close").onclick = () => toggleModal("team-detail-modal", false);
            }
            const dots = (t.form || []).slice(-5).map(f => `<span class="form-dot ${String(f)[0] === "V" ? "form-win" : (String(f)[0] === "D" ? "form-loss" : "form-draw")}" title="${f}"></span>`).join("");
            document.getElementById("team-detail-content").innerHTML = `<h2 class="text-2xl font-black mb-1">${xmlEsc(t.name)}</h2><div class="flex items-center gap-2 mb-3">${dots}<span class="text-[10px] text-gray-400">forme (5 derniers)</span></div>${T.length ? `<div class="flex flex-wrap gap-1.5 mb-4">${T.map(x => `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">${x.icon} ${xmlEsc(x.label)} · ${xmlEsc(x.val)}</span>`).join("")}</div>` : ""}<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-sm">${row("Matchs", t.mj) + row("Points", t.pts + (t.xN ? " (mérités : " + Math.round(t.xPts) + ")" : "")) + row("Bilan", t.w + " V · " + (t.wot || 0) + " Vp · " + (t.lot || 0) + " Dp · " + t.l + " D") + row("Buts", t.gf + " pour / " + t.ga + " contre") + row("Supériorité", pp + " (" + t.supG + "/" + t.ppOcc + ")") + row("Infériorité", pk + " (" + t.infGa + " encaissés/" + t.penN + ")") + row("Tirs", (t.shotsN ? (t.shotsF / t.shotsN).toFixed(1) + " pour / match" : "—") + (t.shotsN ? " · " + (t.shotsAg / t.shotsN).toFixed(1) + " concédés" : "")) + row("Pénalités", (t.rep ? (t.penMin / t.rep).toFixed(1) + " min/match" : "—") + (t.pen5 ? " · " + t.pen5 + " en fin de match" : "")) + row("1er but", (t.fbN ? Math.round(t.fbW / t.fbN * 100) + "% (" + t.fbW + "/" + t.fbN + ")" : "—")) + row("Matchs serrés", t.closeN + " joués · " + t.closeW + " gagnés") + row("Remontées", t.behind2N + " mené après 2 tiers · " + t.behind2W + " gagné(s)") + row("Égalisations", t.eq + " dont " + t.eqW + " suivies d\'une victoire") + row("Fin de match", t.late + " buts après la 58e · " + t.lateGa + " encaissés") + row("Rebond après défaite", (t.bounceN ? Math.round(t.bounceW / t.bounceN * 100) + "% (" + t.bounceW + "/" + t.bounceN + ")" : "—")) + row("Meilleure série", (t.bestW ? t.bestW + " victoires" : "—") + (t.bestL ? " / " + t.bestL + " défaites" : "")) + row("Repos", "≤2j : " + (t.rest.a[0] ? (t.rest.a[1] / t.rest.a[0]).toFixed(2) + " pts/m" : "—") + " · 3-6j : " + (t.rest.b[0] ? (t.rest.b[1] / t.rest.b[0]).toFixed(2) + " pts/m" : "—") + " · >6j : " + (t.rest.c[0] ? (t.rest.c[1] / t.rest.c[0]).toFixed(2) + " pts/m" : "—"))}</div>${scorers.length ? `<div class="mt-4"><div class="text-[10px] font-black uppercase text-gray-400 mb-1">Buteurs (déroulés archivés)</div>${scorers.map(s => `<div class="flex justify-between text-sm py-0.5"><span>${xmlEsc(s)}</span><span class="font-bold">${t.scorers[s]}</span></div>`).join("")}${t.topDuo ? `<div class="text-[10px] text-gray-400 mt-1">Meilleur duo : ${xmlEsc(t.topDuo.label)} (${t.topDuo.n} fois)</div>` : ""}${t.topDec ? `<div class="text-[10px] text-gray-400">Buts décisifs : ${xmlEsc(t.topDec)}</div>` : ""}</div>` : ""}${past.length ? `<div class="mt-4"><div class="text-[10px] font-black uppercase text-gray-400 mb-1">Historique des titres (cette saison, sur cet appareil)</div><div class="text-xs text-gray-500 space-y-0.5">${past.map(p => `<div>🎖️ ${xmlEsc(p)}</div>`).join("")}</div></div>` : ""}`;
            toggleModal("team-detail-modal", true);
        }
        document.addEventListener("click", (ev) => {
            const tc = ev.target && ev.target.closest ? ev.target.closest(".team-detail-open") : null;
            if (tc) { ev.preventDefault(); try { openTeamDetail(tc.dataset.team); } catch (e) {} return; }
            const tt = ev.target && ev.target.closest ? ev.target.closest(".title-chip") : null;
            if (tt) { ev.preventDefault(); try { openTeamDetail(tt.dataset.team); } catch (e) {} return; }
            const th = ev.target && ev.target.closest ? ev.target.closest(".at-sort-th") : null;
            if (th) { ev.preventDefault(); const k = th.dataset.k || null; if (_atSort.k === k) _atSort.dir *= -1; else { _atSort.k = k; _atSort.dir = -1; } try { renderAllTeams(); } catch (e) {} return; }
        });