// ===== VERROUS DES ARTICLES AUTO + RECORDS DU CLUB =====
        // (le commentaire orphelin « ADVANCED PLAYOFFS RENDERER » hérité du monolithe reste en tête, à deleter si gênant)
        // --- NEW: ADVANCED PLAYOFFS RENDERER ---
        // v2.21 : dates & verrous des articles automatiques — par type (result, preview, month, poule, ev)
        let articleControls = {};
        const ART_KINDS = [ { k: 'result', lbl: '📊 Résultat' }, { k: 'preview', lbl: '🔮 Avant-match' }, { k: 'month', lbl: '📅 Récap mensuel' }, { k: 'poule', lbl: '🏆 Panorama' }, { k: 'stats', lbl: '📈 Stats de la semaine' } ];
        const artLock = (k) => { const c = articleControls[k]; return !!(c && c.lockUntil && new Date(c.lockUntil).getTime() > Date.now()); };
        async function saveArticleControls() { try { await setDoc(doc(db, `${basePath}/settings/general`), { articleControls }, { merge: true }); } catch (e) {} }
        function renderArticleControls() {
            const el = document.getElementById('article-controls-list');
            if (!el) return;
            try {
                el.innerHTML = ART_KINDS.map(({ k, lbl }) => {
                    const arts = (newsList || []).filter(n => n.kind === k).sort((a, b) => new Date(b.date) - new Date(a.date));
                    const last = arts[0];
                    const locked = artLock(k);
                    return `<div class="flex flex-wrap items-center gap-2 py-2 border-t border-gray-100 dark:border-gray-700/60">
                        <span class="text-xs font-bold min-w-[130px]">${lbl}</span>
                        <span class="text-[11px] text-gray-500 min-w-[110px]">${last ? new Date(last.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'aucun article'}</span>
                        <input type="date" data-kind="${k}" class="art-date-input p-1 border rounded-lg dark:bg-gray-700 text-xs" value="${last ? new Date(last.date).toISOString().slice(0, 10) : ''}">
                        <button data-kind="${k}" class="art-date-save text-[11px] font-bold px-2 py-1 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 transition">OK</button>
                        <button data-kind="${k}" class="art-lock-btn text-[11px] font-bold px-2 py-1 rounded-lg transition ${locked ? 'bg-amber-500 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300'}">${locked ? '🔒 verrouillé' : 'Verrouiller 7 j'}</button>
                    </div>`;
                }).join('');
                el.querySelectorAll('.art-date-save').forEach(b => b.onclick = async () => {
                    const k = b.dataset.kind;
                    const inp = el.querySelector(`.art-date-input[data-kind="${k}"]`);
                    const v = inp && inp.value;
                    if (!v) { appAlert('Choisis une date.'); return; }
                    const arts = (newsList || []).filter(n => n.kind === k).sort((a, b) => new Date(b.date) - new Date(a.date));
                    const last = arts[0];
                    if (!last) { appAlert('Aucun article de ce type à dater.'); return; }
                    try { await setDoc(doc(db, `${basePath}/news/${last.id}`), { date: new Date(v + 'T12:00:00').toISOString() }, { merge: true }); appAlert('Date mise à jour.'); } catch (e) { appAlert('Erreur : ' + e.message); }
                });
                el.querySelectorAll('.art-lock-btn').forEach(b => b.onclick = async () => {
                    const k = b.dataset.kind;
                    if (artLock(k)) articleControls[k] = { ...(articleControls[k] || {}), lockUntil: 0 };
                    else articleControls[k] = { ...(articleControls[k] || {}), lockUntil: Date.now() + 7 * 24 * 3600e3 };
                    await saveArticleControls();
                    renderArticleControls();
                });
            } catch (e) {}
        }

        // v2.21 : records du club — toutes saisons en base, zéro saisie
        function renderClubRecords() {
            const el = document.getElementById('chart-club-records');
            if (!el) return;
            try {
                const done = (allMatches || []).filter(m => isMatchFinished(m) && (normalize(m.homeTeam || '').includes('valence') || normalize(m.awayTeam || '').includes('valence')));
                if (!done.length) { el.innerHTML = '<div class="text-xs text-gray-400 italic text-center p-2">Aucun match en base.</div>'; return; }
                const isL = (m) => normalize(m.homeTeam || '').includes('valence');
                const gf = (m) => isL(m) ? m.scoreHome : m.scoreAway, ga = (m) => isL(m) ? m.scoreAway : m.scoreHome;
                const diff = (m) => (Number(gf(m)) || 0) - (Number(ga(m)) || 0);
                const tot = (m) => (Number(gf(m)) || 0) + (Number(ga(m)) || 0);
                const bigW = done.reduce((b, m) => (!b || diff(m) > diff(b)) ? m : b, null);
                const bigS = done.reduce((b, m) => (!b || tot(m) > tot(b)) ? m : b, null);
                let cur = 0, best = 0, bestEnd = null;
                [...done].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(m => { if (diff(m) > 0) { cur++; if (cur > best) { best = cur; bestEnd = m; } } else cur = 0; });
                const byS = {};
                done.forEach(m => { const s = m.season || '?'; byS[s] = byS[s] || { v: 0, n: 0, d: 0, pts: 0, mj: 0 };
                    const w = diff(m) > 0, nl = (Number(gf(m)) || 0) === (Number(ga(m)) || 0);
                    if (w) byS[s].v++; else if (nl) byS[s].n++; else byS[s].d++;
                    byS[s].pts += isL(m) ? matchPoints(gf(m), ga(m), m.isProl) : matchPoints(ga(m), gf(m), m.isProl); byS[s].mj++; });
                // v2.22 : rang en saison régulière + division + phases (playoffs/maintien) par saison
                const seasons = Object.keys(byS).sort();
                seasons.forEach(s => {
                    // Rang calculé sur TOUS les matchs finis de la saison en base (pas seulement ceux des Lynx) :
                    // l'ancien calcul ne comptait que les matchs de Valence, donc les adversaires n'avaient
                    // que leurs points pris ou donnés contre Valence — classement faux.
                    const allDone = (allMatches || []).filter(m => isMatchFinished(m) && (m.season || '?') === s && (!m.type || /^saison/i.test(String(m.type))));
                    const ms = done.filter(m => (m.season || '?') === s);
                    const tab = {};
                    allDone.forEach(m => { const th = m.homeTeam || '?', ta = m.awayTeam || '?';
                        tab[th] = tab[th] || { team: th, pts: 0, diff: 0 };
                        tab[ta] = tab[ta] || { team: ta, pts: 0, diff: 0 };
                        tab[th].pts += matchPoints(Number(m.scoreHome) || 0, Number(m.scoreAway) || 0, m.isProl);
                        tab[ta].pts += matchPoints(Number(m.scoreAway) || 0, Number(m.scoreHome) || 0, m.isProl);
                        tab[th].diff += (Number(m.scoreHome) || 0) - (Number(m.scoreAway) || 0);
                        tab[ta].diff += (Number(m.scoreAway) || 0) - (Number(m.scoreHome) || 0); });
                    const ordered = Object.values(tab).sort((x, y) => y.pts - x.pts || y.diff - x.diff);
                    const ir = ordered.findIndex(r => normalize(r.team).includes('valence'));
                    byS[s].rank = ir >= 0 ? ir + 1 : null;
                    const divs = [...new Set(ms.map(m => m.division).filter(Boolean))];
                    byS[s].div = (getFormat(s) || {}).division || (divs.length ? divs.join(', ') : '—');
                    const phases = new Set();
                    ms.filter(m => m.type && m.type !== 'Saison').forEach(m => {
                        const t = String(m.type);
                        if (/huitieme|1\s*\/\s*8/i.test(t)) phases.add('1/8');
                        else if (/quart|1\s*\/\s*4/i.test(t)) phases.add('1/4');
                        else if (/demi|1\s*\/\s*2|semi/i.test(t)) phases.add('1/2');
                        else if (/maintien/i.test(t)) phases.add('Maintien');
                        else if (/final/i.test(t)) { const my = isL(m) ? (Number(gf(m)) > Number(ga(m))) : (Number(ga(m)) > Number(gf(m))); if (my && isMatchFinished(m)) phases.add('🏆 Champion'); else phases.add('Finale'); }
                        else if (/playoff/i.test(t)) phases.add('Playoffs');
                    });
                    // v2.22 : on n'affiche que le MEILLEUR tour atteint (Champion > Finale > 1/2 > 1/4 > 1/8 > Playoffs > Maintien)
                    const ordrePh = ['🏆 Champion', 'Finale', '1/2', '1/4', '1/8', 'Playoffs', 'Maintien'];
                    const bestPhase = ordrePh.find(p => phases.has(p));
                    byS[s].phases = bestPhase ? [bestPhase] : [];
                });
                const fmtM = (m) => `${isL(m) ? 'vs' : '@'} ${xmlEsc(isL(m) ? m.awayTeam : m.homeTeam)} <b class="tabular-nums">${gf(m)}-${ga(m)}</b>${m.isProl ? ' (ap)' : ''} <span class="text-gray-400 font-normal">— ${new Date(m.date).toLocaleDateString('fr-FR')}</span>`;
                el.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    <div class="p-3 bg-green-50 dark:bg-green-900/20 rounded-xl text-center"><div class="text-[10px] uppercase font-bold text-green-600 mb-1">Plus large victoire</div><div class="text-sm">${fmtM(bigW)}</div></div>
                    <div class="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-center"><div class="text-[10px] uppercase font-bold text-blue-600 mb-1">Plus gros score</div><div class="text-sm">${fmtM(bigS)}</div></div>
                    <div class="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-center"><div class="text-[10px] uppercase font-bold text-amber-600 mb-1">Série de victoires</div><div class="text-sm font-black">${best} matchs d'affilée</div><div class="text-[11px] text-gray-500">${bestEnd ? 'jusqu\u2019au ' + new Date(bestEnd.date).toLocaleDateString('fr-FR') : ''}</div></div>
                </div>
                <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="ranking-header"><th class="p-2">Saison</th><th class="p-2 text-center">Div</th><th class="p-2 text-center">Rang</th><th class="p-2 text-center">MJ</th><th class="p-2 text-center">V</th><th class="p-2 text-center">N</th><th class="p-2 text-center">D</th><th class="p-2 text-center">Pts</th><th class="p-2">Phases</th></tr></thead><tbody>
                ${seasons.map(s => `<tr class="border-t border-gray-100 dark:border-gray-700/60"><td class="p-2 font-bold">${s === activeSeason ? xmlEsc(s) + ' 🦁' : xmlEsc(s)}</td><td class="p-2 text-center text-xs">${xmlEsc(byS[s].div)}</td><td class="p-2 text-center font-bold tabular-nums">${byS[s].rank ? byS[s].rank + (byS[s].rank === 1 ? 'ᵉʳ' : 'e') : '—'}</td><td class="p-2 text-center tabular-nums">${byS[s].mj}</td><td class="p-2 text-center text-green-600 font-bold tabular-nums">${byS[s].v}</td><td class="p-2 text-center tabular-nums">${byS[s].n}</td><td class="p-2 text-center text-red-500 font-bold tabular-nums">${byS[s].d}</td><td class="p-2 text-center font-black tabular-nums">${byS[s].pts}</td><td class="p-2 text-xs">${byS[s].phases.length ? xmlEsc(byS[s].phases.join(' · ')) : '—'}</td></tr>`).join('')}
                </tbody></table></div><p class="text-[10px] text-gray-400 text-center mt-2">Rang = classement en saison régulière calculé depuis TOUS les matchs de la saison en base · Phases = meilleur tour atteint (Finale remportée = 🏆) · Div = division du format de saison (Admin → Format de la saison), sinon celle des matchs importés.</p>`;
            } catch (e) { el.innerHTML = ''; }
        }
