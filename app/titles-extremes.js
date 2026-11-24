// --- v2.22-b : Les Extrêmes étendus + tableau de toutes les équipes + titres/badges + fiche détaillée ---
        function computeTitles(S) {
            const ts = (S.teams || []).filter(t => t && t.name && (t.mj || t.rep));
            if (!ts.length) return [];
            const best = (fn, dir) => { const arr = ts.map(t => ({ t, v: fn(t) })).filter(x => x.v != null && !isNaN(x.v)); if (!arr.length) return null; arr.sort((a, b) => dir * (b.v - a.v)); return arr[0]; };
            const ppOf = t => (t.ppOcc ? t.supG / t.ppOcc : null), pkOf = t => (t.penN ? 1 - t.infGa / t.penN : null);
            const T = [];
            const add = (icon, label, x, fmt) => { if (x && x.t && x.t.name) T.push({ icon, label, team: x.t.name, val: fmt ? fmt(x.v) : String(x.v), key: icon + " " + label }); };
            add("🏆", "Meilleure attaque", best(t => (t.mj ? t.gf / t.mj : null), 1), v => v.toFixed(2) + " but/match");
            add("🛡️", "Meilleure défense", best(t => (t.mj ? -t.ga / t.mj : null), 1), v => (-v).toFixed(2) + " but/match");
            add("⚡", "Powerplay en or", best(t => (ppOf(t) != null && t.ppOcc >= 5 ? ppOf(t) : null), 1), v => Math.round(v * 100) + "% de réussite");
            add("🧊", "Infériorité de fer", best(t => (pkOf(t) != null && t.penN >= 5 ? pkOf(t) : null), 1), v => Math.round(v * 100) + "% de réussite");
            add("😇", "La plus disciplinée", best(t => (t.rep ? -t.penMin / t.rep : null), 1), v => (-v).toFixed(1) + " min/match");
            add("🥊", "La plus sanctionnée", best(t => (t.rep ? t.penMin / t.rep : null), 1), v => v.toFixed(1) + " min/match");
            add("🎯", "Meilleur départ", best(t => (t.fbN >= 3 ? t.fbW / t.fbN : null), 1), v => Math.round(v * 100) + "% de 1er but");
            add("🌪️", "Reine des remontées", best(t => (t.behind2N ? t.behind2W / t.behind2N : null), 1), v => Math.round(v * 100) + "% de comeback");
            add("⏱️", "Tueuse de fin de match", best(t => (t.late >= 2 ? t.late : null), 1), v => v + " but(s) après la 58e");
            add("🎿", "Le plus de tirs", best(t => (t.shotsN ? t.shotsF / t.shotsN : null), 1), v => v.toFixed(1) + " tirs/match");
            add("🔥", "Série chaude", best(t => (t.bestW >= 2 ? t.bestW : null), 1), v => v + " victoires d'affilée");
            add("🧲", "Reine du suspense", best(t => (t.closeN >= 2 ? t.closeN : null), 1), v => v + " matchs à un but");
            add("📈", "La plus sur-performante", best(t => (t.xN >= 3 ? t.realPts - t.xPts : null), 1), v => (v > 0 ? "+" : "") + Math.round(v) + " pts vs mérités");
            add("📉", "La plus sous-performante", best(t => (t.xN >= 3 ? t.realPts - t.xPts : null), -1), v => Math.round(v) + " pts vs mérités");
            add("🤝", "Spécialiste des prolongations", best(t => (((t.wot || 0) + (t.lot || 0)) >= 1 ? (t.wot || 0) + (t.lot || 0) : null), 1), v => v + " prolongation(s)");
            add("💣", "Dépendante de son top 3", best(t => (t.top3Share != null ? t.top3Share : null), 1), v => v + "% des buts sur 3 joueurs");
            return T;
        }
        function titlesHistory() {
            let h = {}; try { h = JSON.parse(localStorage.getItem("lynx_titles_hist") || "{}"); } catch (e) {}
            return h;
        }
        function updateTitlesHistory(T) {
            const day = new Date().toISOString().slice(0, 10);
            const h = titlesHistory();
            const sn = String(activeSeason || "?");
            if (!h[sn]) h[sn] = {};
            T.forEach(t => {
                const cur = h[sn][t.key];
                if (!cur) { h[sn][t.key] = { team: t.team, val: t.val, since: day, prev: [] }; }
                else if (cur.team !== t.team) {
                    cur.prev = cur.prev || [];
                    cur.prev.unshift({ team: cur.team, val: cur.val, until: day });
                    cur.prev = cur.prev.slice(0, 30);
                    cur.team = t.team; cur.val = t.val; cur.since = day;
                } else { cur.val = t.val; }
            });
            try { localStorage.setItem("lynx_titles_hist", JSON.stringify(h)); } catch (e) {}
            return h;
        }
        async function renderExtremesLive() {
            const cont = document.getElementById("home-extremes-container");
            if (!cont) return;
            let S; try { S = await seasonLiveStats(); } catch (e) { return; }
            // v2.23 : Créer un conteneur séparé pour les titres de la saison (visible même les jours de match)
            let titlesCont = document.getElementById("home-titles-container");
            if (!titlesCont) {
                titlesCont = document.createElement("div");
                titlesCont.id = "home-titles-container";
                titlesCont.className = "bg-white/70 dark:bg-dark-card/70 backdrop-blur-lg p-4 rounded-xl shadow-xl border-t-4 border-purple-500 mt-4";
                cont.parentNode.insertBefore(titlesCont, cont.nextSibling);
            }
            let el = document.getElementById("home-extremes-extra");
            if (!el) { el = document.createElement("div"); el.id = "home-extremes-extra"; el.className = "mt-4 pt-4 border-t dark:border-gray-700"; cont.appendChild(el); }
            const T = computeTitles(S);
            if (!T.length) { 
                if (titlesCont) titlesCont.innerHTML = "";
                el.innerHTML = ""; 
                return; 
            }
            updateTitlesHistory(T);
            // v2.23 : Générer les titres dans le conteneur dédié (visible même les jours de match)
            if (titlesCont) {
                titlesCont.innerHTML = `<h3 class="text-sm font-bold uppercase text-gray-500 mb-4 tracking-widest text-center">Titres de la saison</h3><div class="grid grid-cols-2 md:grid-cols-4 gap-2">${T.map(t => `<button class="title-chip text-left p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 shadow border-l-4 border-purple-500 hover:shadow-md transition" data-team="${xmlEsc(t.team)}"><div class="text-[10px] font-black uppercase text-gray-400 truncate">${t.icon} ${xmlEsc(t.label)}</div><div class="text-xs font-black truncate">${xmlEsc(t.team)}</div><div class="text-[10px] text-gray-400 truncate">${xmlEsc(t.val)}</div></button>`).join("\n")}</div>`;
            }
            }