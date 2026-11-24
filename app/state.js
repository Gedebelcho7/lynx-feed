let allMatches = [], rankingA = [], rankingB = [], roster = [], goalies = [], leaguePlayers = [], teamLogos = [], userPreds = [], usefulLinks = [], newsList = [], knowledgeBase = [];
        let leagueGoalies = [], rssItems = [];
        let rssPublicUrl = "";
        let oddsNext = null; // v2.18 : cotes bookmakers du prochain match { cH, cN, cA, updatedAt } — comparaison avec le modèle, pas un 2e pronostic
        let oddsNextHtmlForCard = ''; // v2.18 : ligne « bookmakers vs modèle » prête pour la carte du prochain match
        let absentPlayers = []; // v2.18 : absents/blessés déclarés en Admin — ajustent le modèle UNIQUEMENT pour les matchs à venir
        let customPunchlines = []; // v2.18 : punchlines maison (une par ligne) — priment sur les punchlines IA à chaque but
        let shareTags = '#LynxDeValence #Hockey'; // v2.19 : hashtags ajoutés aux partages (articles + presse), modifiables en Admin → News
        let scoutDocs = {}; // v2.18 : scouting auto — effectifs adverses récoltés sur les matchs suivis en direct (collection « scout »)
        let ticketItems = []; // billetterie : évènements en vente détectés par l'action GitHub
        let actionHealth = null, pushTestState = null; // settings/health écrit par l'action GitHub + settings/push-test (tests admin)
        let seasonFormats = {}; // { "2025-2026": { division: 'D1'|'D2', playoffSpots: 8 } }
        let playerPhotos = {}; // photos des joueurs (settings/player-photos) : { nom normalisé -> url internet }
        let rssKeywords = ['valence', 'lynx'];
        let rssTeamAliases = {}; // v2.18 : alias d'équipes { nom normalisé: [mots-clés] } — ex. « corsaires de nantes »: ['nantes']
        let rssDynKws = []; // v2.18 : mots-clés du prochain adversaire, ajoutés automatiquement au filtrage
        let rssFeeds = [
            { name: 'Lynx Alerte', url: 'https://www.google.com/alerts/feeds/10474602441040537889/15127254246407494531' },
            { name: 'Lynx Facebook', url: 'https://www.google.com/alerts/feeds/10474602441040537889/15127254246407494531' },
            { name: 'Hockey Archives Bluesky', url: 'https://bsky.app/profile/did:plc:xq7bpibwunhwhenyjoh45wep/rss' },
            { name: 'Hockey Division1 Facebook', url: 'https://fetchrss.com/feed/1x8ZeQFkT8H61x8Zkq3asB1f.rss' },
            { name: 'Plan de Match Bluesky', url: 'https://bsky.app/profile/did:plc:g2z6lkskudyf67eddvswjckw/rss' },
            { name: 'Hockey Archives Forum', url: 'https://forum.passionhockey.com/feed.php' },
            { name: 'Hockey Hebdo', url: 'https://www.hockeyhebdo.com/include/rss.xml.php' },
            { name: 'EliteProspects Transactions Lynx', url: 'https://www.eliteprospects.com/rss/team/1236/valence/transactions' },
            { name: 'EliteProspects D1 (transactions)', url: 'https://www.eliteprospects.com/rss/league/france2/transactions' },
            { name: 'EliteProspects D2 (transactions)', url: 'https://www.eliteprospects.com/rss/league/france3/transactions' },
            { name: 'Hockey Division Forum', url: 'https://hockeydivisionsfr.forum.st/rss' }
        ];
        let botSettings = { tone: 'fan', persona: 'Tu es un supporter fanatique des Lynx.' }; // Default
        let botHistory = []; // NEW: Stores past bot predictions
        let activeSeason = "";
        let leagueSort = "pts";
        let rankSort = "pts"; 
        let statsPeriod = "season"; 
        let listenersInitialized = false;