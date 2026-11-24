// ===== CARTES PARTAGEABLES (PNG 1200×630, aucune image externe) =====
        // Carte résultat (makeResultCard) puis carte stats de saison (makeStatsCard, à la fin). Extrait d'origine ;
        // à l'origine, makeStatsCard se trouvait après le quiz/ADN : déplacé ici pour regrouper les deux cartes.
        // --- Carte résultat partageable (canvas 1200x630, aucune image externe) ---
        async function makeResultCard() {
            const prev = document.getElementById('result-card-preview');
            if (prev) { prev.classList.remove('hidden'); prev.innerHTML = '<div class="text-xs text-gray-400">Génération…</div>'; }
            const ms = (allMatches || []).filter(m => m && m.season === activeSeason && (!m.type || m.type === 'Saison') && isMatchFinished(m) && m.scoreHome != null && (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence'))).sort((a, b) => new Date(b.date) - new Date(a.date));
            const m = ms[0];
            if (!m) { if (prev) prev.innerHTML = '<div class="text-xs text-orange-500">Aucun match joué avec un score.</div>'; return; }
            let rep = null;
            try { rep = (await dbFetchCol('live-reports')).map(d => ({ ...d.data, _id: d.id })).find(r => r._id === m.id) || null; } catch (e) {}
            const isH = normalize(m.homeTeam).includes('valence');
            const lxS = Number(isH ? m.scoreHome : m.scoreAway), opS = Number(isH ? m.scoreAway : m.scoreHome);
            const opName = isH ? m.awayTeam : m.homeTeam;
            const c = document.createElement('canvas'); c.width = 1200; c.height = 630;
            const x = c.getContext('2d');
            const grd = x.createLinearGradient(0, 0, 0, 630); grd.addColorStop(0, '#101828'); grd.addColorStop(1, '#1b2740');
            x.fillStyle = grd; x.fillRect(0, 0, 1200, 630);
            x.fillStyle = '#D90429'; x.fillRect(0, 0, 1200, 10);
            x.textAlign = 'center';
            x.fillStyle = '#9aa7bd'; x.font = 'bold 24px Arial';
            x.fillText((rep && rep.phase ? String(rep.phase).toUpperCase() : 'MATCH') + (m.isProl ? '  •  APRÈS PROLONGATION' : ''), 600, 80);
            x.fillStyle = '#ffffff'; x.font = 'bold 36px Arial'; x.fillText('LYNX DE VALENCE', 600, 132);
            x.font = 'bold 44px Arial';
            x.fillText('LYNX', 280, 250); x.fillText(String(opName).toUpperCase().slice(0, 24), 920, 250);
            x.font = 'bold 130px Arial';
            x.fillStyle = lxS > opS ? '#D90429' : '#ffffff';
            x.fillText(lxS + '  -  ' + opS, 600, 385);
            x.fillStyle = '#ffffff';
            if (rep && Array.isArray(rep.perT) && rep.perT.length) {
                const pp = (v) => { const a2 = perPair2(v); return isH ? a2[0] + '-' + a2[1] : a2[1] + '-' + a2[0]; };
                x.font = 'bold 26px Arial'; x.fillStyle = '#9aa7bd';
                x.fillText('T1 ' + pp(rep.perT[0]) + '   T2 ' + pp(rep.perT[1]) + (rep.perT[2] ? '   T3 ' + pp(rep.perT[2]) : ''), 600, 445);
            }
            if (rep) {
                const cnt = {};
                (rep.events || []).forEach(e => { if (e && e.ty === 'BUT' && e.who) { let sd = e.side === 'A' ? 'A' : 'H'; if (/\bcsc\b/i.test(String(e.who))) sd = sd === 'H' ? 'A' : 'H'; if (sd === (isH ? 'H' : 'A')) { const n = parseScorer(e.who).g; if (n) cnt[n] = (cnt[n] || 0) + 1; } } });
                const top = Object.keys(cnt).sort((a2, b2) => cnt[b2] - cnt[a2]).slice(0, 3).map(n => n + (cnt[n] > 1 ? ' ×' + cnt[n] : ''));
                if (top.length) { x.font = 'bold 26px Arial'; x.fillStyle = '#e5e9f0'; x.fillText('🏒 ' + top.join('  •  '), 600, 505); }
            }
            x.font = '22px Arial'; x.fillStyle = '#9aa7bd';
            x.fillText(new Date(m.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), 600, 565);
            x.font = 'bold 20px Arial'; x.fillStyle = '#D90429'; x.fillText('🦌 LYNX DE VALENCE — HOCKEY SUR GLACE', 600, 608);
            const url = c.toDataURL('image/png');
            if (prev) prev.innerHTML = '<img src="' + url + '" alt="Carte résultat" class="w-full rounded-xl shadow-lg mb-2"><a href="' + url + '" download="resultat-lynx.png" class="block w-full py-2 bg-lynx-red text-white rounded-xl text-sm font-bold text-center">⬇️ Télécharger le PNG</a><div id="result-card-clip" class="text-[10px] text-gray-400 mt-1"></div>';
            try {
                c.toBlob(async (blob) => {
                    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); const s = document.getElementById('result-card-clip'); if (s) s.textContent = '✅ Image aussi copiée dans le presse-papiers'; } catch (e) {}
                });
            } catch (e) {}
        }

        // 4) Carte « stats de saison » partageable (PNG 1200×630, sans image externe)
        async function makeStatsCard() {
            let S; try { S = await seasonLiveStats(); } catch (e) { return; }
            const L = S.lx;
            if (!L) { appAlert("Stats de saison indisponibles pour l\'instant."); return; }
            const cv = document.createElement("canvas"); cv.width = 1200; cv.height = 630;
            const ctx = cv.getContext("2d");
            const g = ctx.createLinearGradient(0, 0, 1200, 630);
            g.addColorStop(0, "#0f172a"); g.addColorStop(1, "#1e293b");
            ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 630);
            ctx.fillStyle = "#D90429"; ctx.fillRect(0, 0, 1200, 10);
            ctx.fillStyle = "#94a3b8"; ctx.font = "bold 26px sans-serif"; ctx.textAlign = "center";
            ctx.fillText("LYNX DE VALENCE — SAISON " + String(activeSeason || "").replace("-", "/"), 600, 80);
            const pp = L.ppOcc ? Math.round(L.supG / L.ppOcc * 100) + "%" : "—";
            const pk = L.penN ? Math.round((1 - L.infGa / L.penN) * 100) + "%" : "—";
            const cells = [
                ["Points", String(L.pts)], ["Bilan", L.w + "-" + L.l + ((L.wot || L.lot) ? " (" + (L.wot || 0) + "pp/" + (L.lot || 0) + "po)" : "")],
                ["Buts", L.gf + " / " + L.ga], ["Supériorité", pp], ["Infériorité", pk],
                ["1er but", pctOrDash(L.fbW, L.fbN)], ["Matchs serrés", String(L.closeN || 0)], ["Tirs/match", L.shotsN ? (L.shotsF / L.shotsN).toFixed(1) : "—"]
            ];
            cells.forEach((c, i) => {
                const x = 90 + (i % 4) * 260, y = 150 + Math.floor(i / 4) * 190;
                ctx.fillStyle = "#334155"; ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(x, y, 220, 140, 16); else ctx.rect(x, y, 220, 140);
                ctx.fill();
                ctx.fillStyle = "#cbd5e1"; ctx.font = "bold 20px sans-serif"; ctx.fillText(c[0].toUpperCase(), x + 110, y + 46);
                ctx.fillStyle = "#ffffff"; ctx.font = "bold 44px sans-serif"; ctx.fillText(c[1], x + 110, y + 104);
            });
            ctx.fillStyle = "#64748b"; ctx.font = "16px sans-serif";
            ctx.fillText("Stats calculées depuis les déroulés archivés — Lynx Data Hub", 600, 600);
            const url = cv.toDataURL("image/png");
            const prev = document.getElementById("stats-card-preview");
            if (prev) { prev.classList.remove("hidden"); prev.innerHTML = `<img src="${url}" alt="Carte stats de saison" class="w-full rounded-xl shadow-lg">`; }
            try { const a = document.createElement("a"); a.href = url; a.download = "lynx-stats-saison.png"; a.click(); } catch (e) {}
        }