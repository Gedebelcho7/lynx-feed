// --- v2.22-b : quiz du jour, collage malin, ADN offensif, carte stats de saison ---
        // 1) Quiz du Lynx — 5 questions calculées depuis les vraies données (déterministes : le même quiz pour toute la journée)
        let _quizState = null;
        function quizRng(seedStr) { let h = 2166136261; for (let i = 0; i < String(seedStr).length; i++) { h ^= String(seedStr).charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; }; }
        function buildQuizQuestions() {
            const day = new Date().toISOString().slice(0, 10);
            let S = null; try { S = seasonLiveStats(); } catch (e) {}
            if (!S || !S.lx) return [];
            const L = S.lx;
            const qs = [];
            const mk = (q, good, bads, src) => {
                if (good == null || good === "") return;
                const opts = [String(good), ...bads.map(b => String(b)).filter(b => b && b !== String(good))];
                const uniq = [...new Set(opts)].slice(0, 4);
                if (uniq.length < 2) return;
                while (uniq.length < 4) uniq.push(["Aucun des trois", "Impossible à dire", "La réponse D", "Aucune idée"][uniq.length % 4] + "");
                const rng = quizRng(day + q);
                const idx = uniq.map((o, i) => ({ o, i })).sort((x, y) => rng() - rng());
                qs.push({ q, opts: idx.map(x => x.o), a: idx.findIndex(x => x.o === String(good)), src: src || "" });
            };
            // Q1 : meilleur buteur (depuis les déroulés)
            const otherScorers = Object.keys(L.scorers || {}).filter(k => k !== L.topScorer).slice(0, 3);
            mk("Qui est le meilleur buteur des Lynx cette saison ?", L.topScorer, otherScorers.length ? otherScorers : (leaguePlayers || []).filter(p => normalize(p.team || "").includes("valence") && p.name !== L.topScorer).slice(0, 3).map(p => p.name), L.topScorerGoals + " buts en " + L.rep + " déroulé(s) archivé(s)");
            // Q2 : réussite en supériorité numérique
            if (L.ppOcc >= 3) {
                const pp = Math.round(L.supG / L.ppOcc * 100);
                mk("Quelle est la réussite des Lynx en supériorité numérique ?", pp + "%", [Math.max(0, pp - 17) + "%", Math.min(100, pp + 14) + "%", Math.max(5, pp - 33) + "%"], L.supG + " buts sur " + L.ppOcc + " occasions numériques");
            }
            // Q3 : plus large victoire (calendrier)
            const wins = (S.cal || []).filter(m => (normalize(m.homeTeam).includes("valence") || normalize(m.awayTeam).includes("valence")));
            let big = null;
            wins.forEach(m => { const d = Math.abs(Number(m.scoreHome) - Number(m.scoreAway)); if (!big || d > big.d) big = { d, m }; });
            if (big && big.d > 0) {
                const m = big.m, vh = normalize(m.homeTeam).includes("valence");
                const gf = vh ? m.scoreHome : m.scoreAway, ga = vh ? m.scoreAway : m.scoreHome;
                mk("Quelle a été la plus large victoire des Lynx cette saison ?", gf + "-" + ga, [(gf - 1) + "-" + ga, gf + "-" + (ga + 1), (gf + 1) + "-" + ga], "contre " + (vh ? m.awayTeam : m.homeTeam));
            }
            // Q4 : remontées
            if (L.behind2N) mk("Combien de fois les Lynx ont-ils gagné après être menés après 2 tiers ?", String(L.behind2W), [String(L.behind2N), String(L.behind2W + 1), String(Math.max(0, L.behind2W - 1))], L.behind2W + " comeback(s) sur " + L.behind2N + " situation(s)");
            // Q5 : prochain adversaire
            const next = (allMatches || []).filter(m => m.season === activeSeason && !isMatchFinished(m) && (normalize(m.homeTeam).includes("valence") || normalize(m.awayTeam).includes("valence"))).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
            if (next) {
                const opp = normalize(next.homeTeam).includes("valence") ? next.awayTeam : next.homeTeam;
                const bads = (S.teams || []).map(t => t.name).filter(n => normalize(n) !== normalize(opp) && !normalize(n).includes("valence")).sort(() => 0.5 - Math.random()).slice(0, 3);
                mk("Qui les Lynx affrontent-ils au prochain match ?", opp, bads, new Date(next.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));
            }
            return qs;
        }
        function renderHomeQuiz() {
            const el = document.getElementById("home-quiz-body") || document.getElementById("home-quiz");
            if (!el) return;
            const day = new Date().toISOString().slice(0, 10);
            if (!_quizState || _quizState.day !== day) { _quizState = { day, i: 0, score: 0, answered: {} }; }
            let qs = []; try { qs = buildQuizQuestions(); } catch (e) {}
            if (!qs.length) { el.innerHTML = "<p class=\"text-xs text-gray-400\">Le quiz arrive dès que les déroulés de la saison sont archivés en base.</p>"; return; }
            _quizState.qs = qs;
            if (_quizState.i >= qs.length) {
                const sc = _quizState.score;
                const medal = sc === qs.length ? "🥇 Sans faute !" : sc >= qs.length - 2 ? "🔥 Solide !" : "💪 On progresse !";
                el.innerHTML = `<div class="text-center"><div class="text-3xl font-black text-lynx-red mb-1">${sc}/${qs.length}</div><div class="text-sm font-bold mb-3">${medal}</div><button id="quiz-share" class="py-2 px-4 bg-lynx-red hover:bg-red-700 text-white rounded-full font-bold text-sm">📤 Partager mon score</button><button id="quiz-restart" class="ml-2 text-xs text-gray-400 underline">Rejouer</button></div>`;
                return;
            }
            const Q = qs[_quizState.i];
            const answered = _quizState.answered[_quizState.i] !== undefined;
            el.innerHTML = `<div class="flex items-center justify-between mb-2"><span class="text-[10px] font-black uppercase tracking-wider text-gray-400">Question ${_quizState.i + 1}/${qs.length}</span><span class="text-xs font-bold text-gray-400">Score : ${_quizState.score}</span></div><div class="font-bold text-sm mb-3">${Q.q}</div><div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${Q.opts.map((o, k) => `<button class="quiz-opt text-left text-sm p-2.5 rounded-lg border transition ${answered ? (k === Q.a ? "bg-green-100 border-green-500 dark:bg-green-900/30" : (_quizState.answered[_quizState.i] === k ? "bg-red-100 border-red-500 dark:bg-red-900/30" : "opacity-50")) : "hover:border-lynx-red"}" data-k="${k}" ${answered ? "disabled" : ""}>${String.fromCharCode(65 + k)}. ${xmlEsc(o)}</button>`).join("")}</div>${answered && Q.src ? `<div class="text-[10px] text-gray-400 mt-2">💡 ${Q.src}</div>` : ""}${answered ? `<button id="quiz-next" class="mt-3 w-full py-2 bg-gray-900 dark:bg-gray-700 text-white rounded-lg font-bold text-sm">Suivant →</button>` : ""}`;
        }
        document.addEventListener("click", (ev) => {
            const opt = ev.target && ev.target.closest ? ev.target.closest(".quiz-opt") : null;
            if (opt) {
                ev.preventDefault();
                if (!_quizState || !_quizState.qs || _quizState.answered[_quizState.i] !== undefined) return;
                const k = Number(opt.dataset.k), Q = _quizState.qs[_quizState.i];
                _quizState.answered[_quizState.i] = k;
                if (k === Q.a) _quizState.score++;
                setTimeout(() => { try { renderHomeQuiz(); } catch (e) {} }, 600);
                return;
            }
            if (ev.target && ev.target.closest && ev.target.closest("#quiz-next")) { ev.preventDefault(); _quizState.i++; renderHomeQuiz(); return; }
            if (ev.target && ev.target.closest && ev.target.closest("#quiz-restart")) { ev.preventDefault(); _quizState = { day: _quizState.day, i: 0, score: 0, answered: {} }; renderHomeQuiz(); return; }
            if (ev.target && ev.target.closest && ev.target.closest("#quiz-share")) {
                ev.preventDefault();
                const txt = "🧠 Quiz du Lynx : " + _quizState.score + "/" + _quizState.qs.length + " — sauras-tu faire mieux ? " + (location.href || "");
                if (navigator.share) { navigator.share({ text: txt }).catch(() => {}); } else if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(() => appAlert("Score copié : colle-le où tu veux !")).catch(() => {}); }
                return;
            }
        });

        // 2) Collage malin — colle un texte de résultat, l'app retrouve le match du calendrier et pré-remplit la saisie
        function smartParseResult(txt) {
            const res = [];
            String(txt || "").split(/\n+/).forEach(l => {
                const m = l.match(/([A-Za-zÀ-ÿ0-9'’\-\. ]{3,32}?)\s*(?:[\-–—]|\bvs\b\.?|\bv\b)\s*([A-Za-zÀ-ÿ0-9'’\-\. ]{3,32}?)\s+(\d{1,2})\s*[\-–—:]\s*(\d{1,2})/i);
                if (m) res.push({ home: m[1].trim(), away: m[2].trim(), sh: Number(m[3]), sa: Number(m[4]), prol: /(ap\b|prol|tab|t\.a\.b|fusillade)/i.test(l) });
            });
            return res;
        }
        function smartPasteApply() {
            const box = document.getElementById("smart-paste-txt"), msg = document.getElementById("smart-paste-msg");
            if (!box || !msg) return;
            const parsed = smartParseResult(box.value);
            if (!parsed.length) { msg.textContent = "Résultat non reconnu — vérifie le format (Équipe A - Équipe B 4-1)."; return; }
            let okN = 0;
            parsed.forEach(p => {
                const nh = normalize(p.home), na = normalize(p.away);
                const cands = (allMatches || []).filter(m => {
                    const mh = normalize(m.homeTeam || ""), ma = normalize(m.awayTeam || "");
                    return mh && ma && (mh.includes(nh) || nh.includes(mh)) && (ma.includes(na) || na.includes(ma));
                });
                if (!cands.length) return;
                cands.sort((a, b) => new Date(a.date) - new Date(b.date));
                const m = cands[0];
                const trig = document.querySelector(`.quick-score-trigger[data-id="${m.id}"]`);
                if (!trig) return;
                window._smartPaste = { sh: p.sh, sa: p.sa, prol: p.prol };
                trig.click();
                okN++;
            });
            msg.textContent = okN ? okN + " résultat(s) reconnu(s) : vérifie le formulaire et enregistre." : "Aucun match du calendrier ne correspond aux équipes collées.";
        }
        document.addEventListener("click", (ev) => {
            const t1 = ev.target && ev.target.closest ? ev.target.closest("#btn-smart-paste") : null;
            if (t1) { ev.preventDefault(); const bx = document.getElementById("smart-paste-box"); if (bx) bx.classList.toggle("hidden"); return; }
            const t2 = ev.target && ev.target.closest ? ev.target.closest("#btn-smart-paste-go") : null;
            if (t2) { ev.preventDefault(); smartPasteApply(); return; }
            const t3 = ev.target && ev.target.closest ? ev.target.closest("#btn-stats-card") : null;
            if (t3) { ev.preventDefault(); try { makeStatsCard(); } catch (e) {} return; }
        });

        // 3) ADN offensif — quand les Lynx marquent-ils ? (buts par tranche de 5 minutes, depuis les déroulés archivés)
        let _adnCache = null;
        async function buildLynxDna() {
            if (_adnCache && Date.now() - _adnCache.at < 120000) return _adnCache.v;
            const rows = await dbFetchCol("live-reports");
            const forB = new Array(12).fill(0), agB = new Array(12).fill(0);
            rows.forEach(d => {
                const r = d.data || {};
                if (!Array.isArray(r.events)) return;
                const isH = normalize(r.homeTeam || "").includes("valence"), isA = normalize(r.awayTeam || "").includes("valence");
                if (!isH && !isA) return;
                r.events.forEach(e => {
                    if (!e || e.ty !== "BUT") return;
                    let side = e.side === "A" ? "A" : "H";
                    if (/\bcsc\b/i.test(String(e.who || ""))) side = side === "H" ? "A" : "H";
                    const mine = (isH && side === "H") || (isA && side === "A");
                    const b = Math.min(11, Math.floor((Number(e.t) || 0) / 300));
                    if (mine) forB[b]++; else agB[b]++;
                });
            });
            const v = { forB, agB };
            _adnCache = { at: Date.now(), v };
            return v;
        }
        async function renderHomeDna() {
            const anchor = document.getElementById("home-live-stats");
            if (!anchor) return;
            let el = document.getElementById("home-dna-body");
            if (!el) {
                el = document.createElement("div"); el.id = "home-dna-body";
                const host = document.createElement("div"); host.id = "home-dna"; host.className = "bg-white/70 dark:bg-dark-card/70 backdrop-blur-lg p-4 rounded-xl shadow-xl mt-4";
                host.appendChild(el); anchor.parentNode.insertBefore(host, anchor.nextSibling);
            }
            let v; try { v = await buildLynxDna(); } catch (e) { return; }
            const totF = v.forB.reduce((a, b) => a + b, 0), totA = v.agB.reduce((a, b) => a + b, 0);
            if (!totF && !totA) { el.innerHTML = ""; return; }
            const maxB = Math.max(...v.forB, ...v.agB, 1);
            
            const bars = (arr, cls) => arr.map((n, i) => `<div class="flex-1 flex flex-col justify-end items-center" title="${i * 5}-${(i + 1) * 5} min : ${n} but(s)"><div class="w-full rounded-t ${n ? cls : "bg-gray-200 dark:bg-gray-700"}" style="height:${Math.max(n ? 6 : 2, Math.round(n / maxB * 60))}px"></div></div>`).join("");
            const labels = arr => arr.map((_, i) => `<div class="flex-1 text-center text-[8px] text-gray-400">${i % 2 === 0 ? (i * 5) + "'" : ""}</div>`).join("");

            el.innerHTML = `<div class="text-[10px] text-gray-400 mb-1 flex items-center gap-1">Buts par tranche de 5 minutes <span class="stat-info cursor-pointer text-gray-300 hover:text-lynx-red" title="Qu\'est-ce que c\'est ?">ⓘ</span><span class="stat-exp hidden">Chaque barre = une tranche de 5 minutes. Rouges : buts marqués par les Lynx. Grises : buts encaissés. Ça montre quand l\'équipe est dangereuse, et quand elle souffle.</span></div><div class="text-[10px] text-gray-400 mb-1">${totF} but(s) marqué(s) · ${totA} encaissé(s) sur les déroulés archivés</div><div class="flex items-end gap-0.5 h-20">${bars(v.forB, "bg-lynx-red")}</div><div class="flex items-end gap-0.5 h-14 mt-1 opacity-50">${bars(v.agB, "bg-gray-500")}</div><div class="flex gap-0.5 mt-1">${labels(v.forB)}</div><div class="flex gap-3 mt-1 text-[9px] text-gray-400"><span>■ marqués</span><span class="opacity-50">■ encaissés</span></div>`;
        }