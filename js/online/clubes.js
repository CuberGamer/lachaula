/**
 * clubes.js
 *
 * Catálogo compartido (servidor + navegador) de:
 * 1. Clubes de fútbol (incluyendo Nueva Chicago y clubes internacionales)
 *    con sus escudos SVG y diseños de camiseta para dibujar en cancha.
 * 2. Estadios famosos de clubes para la ruleta exclusiva de la izquierda.
 * 3. Escalas de tamaño de estadio según cantidad de jugadores (1v1 a 11v11).
 */
(function (global) {
    const TAMANOS_JUGADORES = [
        { id: '1v1', etiqueta: '1', nombre: '1 vs 1', factor: 0.72, maxSugerido: 2 },
        { id: '2v2', etiqueta: '2', nombre: '2 vs 2', factor: 0.88, maxSugerido: 4 },
        { id: '3v3', etiqueta: '3', nombre: '3 vs 3', factor: 1.0, maxSugerido: 6 },
        { id: '4v4', etiqueta: '4', nombre: '4 vs 4', factor: 1.35, maxSugerido: 8 },
        { id: '5v5', etiqueta: '5', nombre: '5 vs 5', factor: 1.68, maxSugerido: 10 },
        { id: '6v6', etiqueta: '6', nombre: '6 vs 6', factor: 2.05, maxSugerido: 12 },
        { id: '7v7', etiqueta: '7', nombre: '7 vs 7', factor: 2.45, maxSugerido: 14 },
        { id: '11v11', etiqueta: '+', nombre: '11 vs 11', factor: 3.0, maxSugerido: 22 }
    ];

    const CAMISETA_PRACTICA = {
        id: 'practica',
        nombre: 'Práctica (Blanca)',
        sigla: 'PRAC',
        liga: 'Práctica',
        primario: '#ffffff',
        secundario: '#e2e8f0',
        acento: '#0f172a',
        texto: '#0f172a',
        patron: 'solida'
    };

    const CLUBES = [
        {
            id: 'boca',
            nombre: 'Boca Juniors',
            sigla: 'BOC',
            liga: 'Argentina',
            primario: '#0f2c67',
            secundario: '#facc15',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'franja-horizontal'
        },
        {
            id: 'river',
            nombre: 'River Plate',
            sigla: 'RIV',
            liga: 'Argentina',
            primario: '#f8fafc',
            secundario: '#dc2626',
            acento: '#111827',
            texto: '#111827',
            patron: 'banda-diagonal'
        },
        {
            id: 'chicago',
            nombre: 'Nueva Chicago',
            sigla: 'CHI',
            liga: 'Argentina',
            primario: '#15803d',
            secundario: '#111827',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'bastones'
        },
        {
            id: 'racing',
            nombre: 'Racing Club',
            sigla: 'RAC',
            liga: 'Argentina',
            primario: '#38bdf8',
            secundario: '#f8fafc',
            acento: '#0c4a6e',
            texto: '#0f172a',
            patron: 'bastones'
        },
        {
            id: 'independiente',
            nombre: 'Independiente',
            sigla: 'CAI',
            liga: 'Argentina',
            primario: '#dc2626',
            secundario: '#ffffff',
            acento: '#991b1b',
            texto: '#ffffff',
            patron: 'solida'
        },
        {
            id: 'sanlorenzo',
            nombre: 'San Lorenzo',
            sigla: 'SLO',
            liga: 'Argentina',
            primario: '#1d4ed8',
            secundario: '#dc2626',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'bastones'
        },
        {
            id: 'estudiantes',
            nombre: 'Estudiantes LP',
            sigla: 'EDLP',
            liga: 'Argentina',
            primario: '#dc2626',
            secundario: '#f8fafc',
            acento: '#111827',
            texto: '#ffffff',
            patron: 'bastones'
        },
        {
            id: 'velez',
            nombre: 'Vélez Sarsfield',
            sigla: 'VEL',
            liga: 'Argentina',
            primario: '#f8fafc',
            secundario: '#1d4ed8',
            acento: '#1e3a8a',
            texto: '#0f172a',
            patron: 'cuello'
        },
        {
            id: 'huracan',
            nombre: 'Huracán',
            sigla: 'HUR',
            liga: 'Argentina',
            primario: '#f8fafc',
            secundario: '#dc2626',
            acento: '#dc2626',
            texto: '#111827',
            patron: 'cuello'
        },
        {
            id: 'rosariocentral',
            nombre: 'Rosario Central',
            sigla: 'CARC',
            liga: 'Argentina',
            primario: '#1e3a8a',
            secundario: '#facc15',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'bastones'
        },
        {
            id: 'newells',
            nombre: 'Newell\'s Old Boys',
            sigla: 'NOB',
            liga: 'Argentina',
            primario: '#dc2626',
            secundario: '#111827',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'franja-vertical'
        },
        {
            id: 'talleres',
            nombre: 'Talleres (Cba)',
            sigla: 'CAT',
            liga: 'Argentina',
            primario: '#1e3a8a',
            secundario: '#f8fafc',
            acento: '#60a5fa',
            texto: '#ffffff',
            patron: 'bastones'
        },
        {
            id: 'lanus',
            nombre: 'Lanús',
            sigla: 'LAN',
            liga: 'Argentina',
            primario: '#7f1d1d',
            secundario: '#f8fafc',
            acento: '#facc15',
            texto: '#ffffff',
            patron: 'solida'
        },
        {
            id: 'argentinos',
            nombre: 'Argentinos Jrs',
            sigla: 'AAAJ',
            liga: 'Argentina',
            primario: '#dc2626',
            secundario: '#f8fafc',
            acento: '#111827',
            texto: '#ffffff',
            patron: 'banda-diagonal'
        },
        {
            id: 'belgrano',
            nombre: 'Belgrano (Cba)',
            sigla: 'CAB',
            liga: 'Argentina',
            primario: '#38bdf8',
            secundario: '#0f172a',
            acento: '#ffffff',
            texto: '#0f172a',
            patron: 'solida'
        },
        {
            id: 'gimnasia',
            nombre: 'Gimnasia LP',
            sigla: 'GELP',
            liga: 'Argentina',
            primario: '#f8fafc',
            secundario: '#1e3a8a',
            acento: '#1e3a8a',
            texto: '#0f172a',
            patron: 'franja-horizontal'
        },
        {
            id: 'banfield',
            nombre: 'Banfield',
            sigla: 'BAN',
            liga: 'Argentina',
            primario: '#16a34a',
            secundario: '#f8fafc',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'banda-diagonal'
        },
        {
            id: 'defensa',
            nombre: 'Defensa y Justicia',
            sigla: 'DYJ',
            liga: 'Argentina',
            primario: '#facc15',
            secundario: '#15803d',
            acento: '#111827',
            texto: '#0f172a',
            patron: 'cuello'
        },
        {
            id: 'argentina',
            nombre: 'Argentina',
            sigla: 'ARG',
            liga: 'Selecciones',
            primario: '#38bdf8',
            secundario: '#ffffff',
            acento: '#facc15',
            texto: '#0f172a',
            patron: 'bastones'
        },
        {
            id: 'brasil',
            nombre: 'Brasil',
            sigla: 'BRA',
            liga: 'Selecciones',
            primario: '#facc15',
            secundario: '#16a34a',
            acento: '#1d4ed8',
            texto: '#0f172a',
            patron: 'cuello'
        },
        {
            id: 'uruguay',
            nombre: 'Uruguay',
            sigla: 'URU',
            liga: 'Selecciones',
            primario: '#38bdf8',
            secundario: '#111827',
            acento: '#facc15',
            texto: '#0f172a',
            patron: 'cuello'
        },
        {
            id: 'colombia',
            nombre: 'Colombia',
            sigla: 'COL',
            liga: 'Selecciones',
            primario: '#facc15',
            secundario: '#1e3a8a',
            acento: '#dc2626',
            texto: '#0f172a',
            patron: 'franja-horizontal'
        },
        {
            id: 'chile',
            nombre: 'Chile',
            sigla: 'CHL',
            liga: 'Selecciones',
            primario: '#dc2626',
            secundario: '#1d4ed8',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'cuello'
        },
        {
            id: 'ecuador',
            nombre: 'Ecuador',
            sigla: 'ECU',
            liga: 'Selecciones',
            primario: '#facc15',
            secundario: '#1e3a8a',
            acento: '#dc2626',
            texto: '#0f172a',
            patron: 'banda-diagonal'
        },
        {
            id: 'mexico',
            nombre: 'México',
            sigla: 'MEX',
            liga: 'Selecciones',
            primario: '#15803d',
            secundario: '#dc2626',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'cuello'
        },
        {
            id: 'espana',
            nombre: 'España',
            sigla: 'ESP',
            liga: 'Selecciones',
            primario: '#dc2626',
            secundario: '#facc15',
            acento: '#1e3a8a',
            texto: '#ffffff',
            patron: 'cuello'
        },
        {
            id: 'francia',
            nombre: 'Francia',
            sigla: 'FRA',
            liga: 'Selecciones',
            primario: '#1e3a8a',
            secundario: '#dc2626',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'cuello'
        },
        {
            id: 'alemania',
            nombre: 'Alemania',
            sigla: 'GER',
            liga: 'Selecciones',
            primario: '#f8fafc',
            secundario: '#111827',
            acento: '#eab308',
            texto: '#111827',
            patron: 'franja-horizontal'
        },
        {
            id: 'inglaterra',
            nombre: 'Inglaterra',
            sigla: 'ENG',
            liga: 'Selecciones',
            primario: '#f8fafc',
            secundario: '#dc2626',
            acento: '#1e3a8a',
            texto: '#0f172a',
            patron: 'cuello'
        },
        {
            id: 'portugal',
            nombre: 'Portugal',
            sigla: 'POR',
            liga: 'Selecciones',
            primario: '#b91c1c',
            secundario: '#15803d',
            acento: '#facc15',
            texto: '#ffffff',
            patron: 'banda-diagonal'
        },
        {
            id: 'italia',
            nombre: 'Italia',
            sigla: 'ITA',
            liga: 'Selecciones',
            primario: '#1d4ed8',
            secundario: '#ffffff',
            acento: '#16a34a',
            texto: '#ffffff',
            patron: 'cuello'
        },
        {
            id: 'paisesbajos',
            nombre: 'Países Bajos',
            sigla: 'NED',
            liga: 'Selecciones',
            primario: '#ea580c',
            secundario: '#111827',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'solida'
        },
        {
            id: 'realmadrid',
            nombre: 'Real Madrid',
            sigla: 'RMA',
            liga: 'Europa',
            primario: '#f8fafc',
            secundario: '#eab308',
            acento: '#1e3a8a',
            texto: '#1e293b',
            patron: 'cuello'
        },
        {
            id: 'barcelona',
            nombre: 'FC Barcelona',
            sigla: 'FCB',
            liga: 'Europa',
            primario: '#1e40af',
            secundario: '#b91c1c',
            acento: '#facc15',
            texto: '#ffffff',
            patron: 'bastones'
        },
        {
            id: 'manutd',
            nombre: 'Manchester Utd',
            sigla: 'MUN',
            liga: 'Europa',
            primario: '#dc2626',
            secundario: '#111827',
            acento: '#facc15',
            texto: '#ffffff',
            patron: 'cuello'
        },
        {
            id: 'mancity',
            nombre: 'Manchester City',
            sigla: 'MCI',
            liga: 'Europa',
            primario: '#67e8f9',
            secundario: '#0f172a',
            acento: '#ffffff',
            texto: '#0f172a',
            patron: 'solida'
        },
        {
            id: 'liverpool',
            nombre: 'Liverpool',
            sigla: 'LIV',
            liga: 'Europa',
            primario: '#b91c1c',
            secundario: '#f8fafc',
            acento: '#facc15',
            texto: '#ffffff',
            patron: 'solida'
        },
        {
            id: 'psg',
            nombre: 'Paris SG',
            sigla: 'PSG',
            liga: 'Europa',
            primario: '#0f172a',
            secundario: '#dc2626',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'franja-vertical'
        },
        {
            id: 'bayern',
            nombre: 'Bayern Múnich',
            sigla: 'BAY',
            liga: 'Europa',
            primario: '#dc2626',
            secundario: '#ffffff',
            acento: '#1d4ed8',
            texto: '#ffffff',
            patron: 'solida'
        },
        {
            id: 'acmilan',
            nombre: 'AC Milan',
            sigla: 'MIL',
            liga: 'Europa',
            primario: '#dc2626',
            secundario: '#111827',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'bastones'
        },
        {
            id: 'inter',
            nombre: 'Inter de Milán',
            sigla: 'INT',
            liga: 'Europa',
            primario: '#1d4ed8',
            secundario: '#0f172a',
            acento: '#facc15',
            texto: '#ffffff',
            patron: 'bastones'
        },
        {
            id: 'juventus',
            nombre: 'Juventus',
            sigla: 'JUV',
            liga: 'Europa',
            primario: '#f8fafc',
            secundario: '#111827',
            acento: '#eab308',
            texto: '#0f172a',
            patron: 'bastones'
        },
        {
            id: 'flamengo',
            nombre: 'Flamengo',
            sigla: 'FLA',
            liga: 'Sudamérica',
            primario: '#dc2626',
            secundario: '#111827',
            acento: '#ffffff',
            texto: '#ffffff',
            patron: 'aros-horizontales'
        },
        {
            id: 'palmeiras',
            nombre: 'Palmeiras',
            sigla: 'PAL',
            liga: 'Sudamérica',
            primario: '#15803d',
            secundario: '#ffffff',
            acento: '#facc15',
            texto: '#ffffff',
            patron: 'cuello'
        }
    ];

    const ESTADIOS_CLUBES = [
        {
            id: 'estadio_bombonera',
            name: 'La Bombonera',
            club: 'Boca Juniors',
            clubId: 'boca',
            category: 'Clubes',
            theme: 'haxball',
            bg: '#5c7c46',
            fieldColor: '#52733d',
            lineColor: '#fde047',
            goalBg: '#0f2c67',
            width: 920,
            height: 440,
            goalHeight: 132
        },
        {
            id: 'estadio_mataderos',
            name: 'República de Mataderos',
            club: 'Nueva Chicago',
            clubId: 'chicago',
            category: 'Clubes',
            theme: 'haxball',
            bg: '#3f6e39',
            fieldColor: '#366031',
            lineColor: '#ffffff',
            goalBg: '#111827',
            width: 900,
            height: 430,
            goalHeight: 128
        },
        {
            id: 'estadio_monumental',
            name: 'Mâs Monumental',
            club: 'River Plate',
            clubId: 'river',
            category: 'Clubes',
            theme: 'haxball',
            bg: '#64854d',
            fieldColor: '#597943',
            lineColor: '#ffffff',
            goalBg: '#991b1b',
            width: 1020,
            height: 490,
            goalHeight: 142
        },
        {
            id: 'estadio_bernabeu',
            name: 'Santiago Bernabéu',
            club: 'Real Madrid',
            clubId: 'realmadrid',
            category: 'Clubes',
            theme: 'champions',
            bg: '#1c5a41',
            fieldColor: '#15803d',
            lineColor: '#ffffff',
            goalBg: '#1e3a8a',
            width: 1040,
            height: 500,
            goalHeight: 144
        },
        {
            id: 'estadio_campnou',
            name: 'Camp Nou',
            club: 'FC Barcelona',
            clubId: 'barcelona',
            category: 'Clubes',
            theme: 'champions',
            bg: '#1c516b',
            fieldColor: '#166534',
            lineColor: '#f8fafc',
            goalBg: '#7f1d1d',
            width: 1040,
            height: 500,
            goalHeight: 144
        },
        {
            id: 'estadio_oldtrafford',
            name: 'Old Trafford',
            club: 'Manchester Utd',
            clubId: 'manutd',
            category: 'Clubes',
            theme: 'haxball',
            bg: '#4d7740',
            fieldColor: '#436b37',
            lineColor: '#fef2f2',
            goalBg: '#7f1d1d',
            width: 980,
            height: 470,
            goalHeight: 138
        },
        {
            id: 'estadio_maracana',
            name: 'Maracaná',
            club: 'Flamengo / Brasil',
            clubId: 'flamengo',
            category: 'Clubes',
            theme: 'haxball',
            bg: '#5b8a42',
            fieldColor: '#4f7a38',
            lineColor: '#fef08a',
            goalBg: '#14532d',
            width: 1060,
            height: 510,
            goalHeight: 146
        },
        {
            id: 'estadio_sansiro',
            name: 'San Siro',
            club: 'AC Milan / Inter',
            clubId: 'acmilan',
            category: 'Clubes',
            theme: 'champions',
            bg: '#1f2937',
            fieldColor: '#166534',
            lineColor: '#e2e8f0',
            goalBg: '#111827',
            width: 990,
            height: 475,
            goalHeight: 138
        }
    ];

    const CLUBES_CON_ESCUDO = CLUBES.map(club => ({
        ...club,
        escudo: `/img/escudos/${club.id}.png`
    }));

    function obtenerClub(id) {
        return CLUBES_CON_ESCUDO.find(c => c.id === id) || CLUBES_CON_ESCUDO[0];
    }

    function obtenerEscudoUrl(club) {
        const c = typeof club === 'string' ? obtenerClub(club) : (club || CLUBES_CON_ESCUDO[0]);
        return (c && c.escudo) || crearEscudoSvgDataUrl(c);
    }

    function obtenerTamanoJugadores(id) {
        return TAMANOS_JUGADORES.find(t => t.id === id) || TAMANOS_JUGADORES[2];
    }

    function crearEscudoSvgDataUrl(club) {
        const c = typeof club === 'string' ? obtenerClub(club) : (club || CLUBES[0]);
        let interior = `<rect x="0" y="0" width="64" height="72" fill="${c.primario}" />`;
        if (c.patron === 'bastones') {
            interior += `<rect x="12" y="0" width="12" height="72" fill="${c.secundario}" />`
                + `<rect x="38" y="0" width="12" height="72" fill="${c.secundario}" />`;
        } else if (c.patron === 'franja-horizontal') {
            interior += `<rect x="0" y="25" width="64" height="22" fill="${c.secundario}" />`;
        } else if (c.patron === 'banda-diagonal') {
            interior += `<polygon points="-10,60 54,-10 74,10 10,80" fill="${c.secundario}" />`;
        } else if (c.patron === 'franja-vertical') {
            interior += `<rect x="22" y="0" width="20" height="72" fill="${c.secundario}" />`;
        } else if (c.patron === 'aros-horizontales') {
            interior += `<rect x="0" y="14" width="64" height="14" fill="${c.secundario}" />`
                + `<rect x="0" y="42" width="64" height="14" fill="${c.secundario}" />`;
        } else {
            interior += `<circle cx="32" cy="34" r="14" fill="${c.secundario}" opacity="0.28" />`;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 72">`
            + `<defs><clipPath id="shield"><path d="M8 6 L56 6 L56 36 C56 54 32 66 32 66 C32 66 8 54 8 36 Z"/></clipPath></defs>`
            + `<g clip-path="url(#shield)">${interior}</g>`
            + `<path d="M8 6 L56 6 L56 36 C56 54 32 66 32 66 C32 66 8 54 8 36 Z" fill="none" stroke="${c.acento}" stroke-width="4"/>`
            + `<rect x="13" y="26" width="38" height="18" rx="4" fill="rgba(2,6,23,0.78)" stroke="${c.acento}" stroke-width="1.5"/>`
            + `<text x="32" y="38.5" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="11" font-weight="900" fill="#ffffff">${c.sigla}</text>`
            + `</svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    const ClubesLaChaula = {
        CLUBES: CLUBES_CON_ESCUDO,
        ESTADIOS_CLUBES,
        TAMANOS_JUGADORES,
        CAMISETA_PRACTICA,
        obtenerClub,
        obtenerEscudoUrl,
        obtenerTamanoJugadores,
        crearEscudoSvgDataUrl
    };

    global.ClubesLaChaula = ClubesLaChaula;
    if (typeof module !== 'undefined' && module.exports) module.exports = ClubesLaChaula;
})(typeof globalThis !== 'undefined' ? globalThis : this);
