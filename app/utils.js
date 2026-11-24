// ===== UTILS =====
        // --- UTILS ---
        const normalize = (s) => s ? s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
        const getLogo = (name) => {
            const n = normalize(name || '?');
            if (n.includes('valence')) return 'https://www.leslynx.com/build/logo-lynx.9f4a56ec.png'; // logo officiel des Lynx par défaut
            let key = Object.keys(teamLogos).find(k => normalize(k) === n);
            if (!key) key = Object.keys(teamLogos).find(k => normalize(k).includes(n) || n.includes(normalize(k)));
            return key ? teamLogos[key] : `https://ui-avatars.com/api/?name=${n.substring(0,2)}&background=6B7280&color=fff&bold=true`;
        };
        const parseScoreVal = (val) => { if (val === null || val === undefined || val.trim() === '') return null; const n = Number(val); return isNaN(n) ? null : n; };
        
        // Helper to parse French CSV Floats (e.g. "92,5" -> 92.5)
        const parseFrenchFloat = (val) => {
            if(!val) return 0;
            if(typeof val === 'number') return val;
            return parseFloat(val.replace(',', '.').replace('%', '').trim());
        };

        const parseCSV = (txt) => {
            const lines = txt.trim().split(/\r?\n/).filter(l => l.trim()); if (lines.length < 2) return []; const del = lines[0].includes(';') ? ';' : ',';
            const splitRow = (row) => { const result = []; let current = ''; let inQuote = false; for (let i = 0; i < row.length; i++) { const c = row[i]; if (c === '"') inQuote = !inQuote; else if (c === del && !inQuote) { result.push(current); current = ''; } else current += c; } result.push(current); return result.map(c => c.trim().replace(/^"|"$/g, '').trim()); };
            const headers = splitRow(lines[0]).map(h => normalize(h)); return lines.slice(1).map(l => { const v = splitRow(l); while (v.length < headers.length) v.push(''); const o = {}; headers.forEach((h, i) => o[h] = (v[i] === undefined ? '' : v[i])); o._raw = v; return o; });
        };
        const findKey = (keys, candidates) => keys.find(k => candidates.some(c => k === c || k === c.toLowerCase())) || keys.find(k => candidates.some(c => k.includes(c)));
        const exportLynxIcs = (homeOnly) => {
            const lynx = allMatches.filter(m => m.season === activeSeason && (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence')) && (!homeOnly || normalize(m.homeTeam).includes('valence'))).sort((a,b) => new Date(a.date) - new Date(b.date));
            if(!lynx.length) return;
            const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
            const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
            const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lynx de Valence Hub//Calendrier//FR', 'CALSCALE:GREGORIAN'];
            for(const m of lynx) {
                const st = new Date(m.date);
                if(!st.getHours() && !st.getMinutes()) st.setHours(20, 0, 0, 0);
                const en = new Date(st.getTime() + 135 * 60000);
                const isHome = normalize(m.homeTeam).includes('valence');
                const opp = isHome ? m.awayTeam : m.homeTeam;
                lines.push('BEGIN:VEVENT', `UID:lynx-${hashId(m.id)}@lynx-data`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(st)}`, `DTEND:${fmt(en)}`, `SUMMARY:${esc('Hockey : Lynx de Valence ' + (isHome ? 'vs ' : '@ ') + opp)}`, `LOCATION:${esc(isHome ? (m.venue || 'Le Polygone, Valence') : (m.venue || opp))}`, `DESCRIPTION:${esc((m.journee ? m.journee + ' · ' : '') + 'Saison ' + m.season + (m.note ? ' · ' + m.note : ''))}`, 'END:VEVENT');
            }
            lines.push('END:VCALENDAR');
            const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `lynx-valence-${activeSeason}${homeOnly ? '-domicile' : ''}.ics`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
        };
        const exportToCSV = (filename, rows) => { if(!rows || !rows.length) return; const headers = Object.keys(rows[0]); const csvContent = [headers.join(';'), ...rows.map(row => headers.map(h => row[h]).join(';'))].join('\n'); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", filename); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); };
        const isValidScore = (s) => s !== null && s !== undefined && s !== '' && !isNaN(s);
        const isMatchFinished = (m) => isValidScore(m.scoreHome) && isValidScore(m.scoreAway);