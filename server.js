const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const FisicaHaxball = require('./js/local/fisica-haxball.js');
const FisicaHbs = require('./js/local/fisica-hbs.js');
const Clubes = require('./js/online/clubes.js');
const Puntuacion = require('./js/online/puntuacion.js');
const Repeticion = require('./js/online/repeticion.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const MS_TICK = FisicaHaxball.constantes.MS_POR_TICK;
const DURACION_GOL_MS = 1800;
const TIEMPO_DESCONEXION_MS = 12000;
const TIEMPO_SALA_VACIA_MS = 15000;
const MAX_CUSTOM_MAPAS_SALA = 15;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 2e6
});

// ========================= //
// CONFIGURACIÓN DE MAPAS    //
// ========================= //

const TIEMPOS_VALIDOS = [1, 2, 3, 5, 7, 10];
const GOLES_VALIDOS = [0, 1, 3, 5, 7, 10];
const MODOS_VALIDOS = [
    { id: 'normal', nombre: 'Normal' },
    { id: 'futsal', nombre: 'Futsal' }
];
const TAMANOS_VALIDOS = [
    ...Clubes.TAMANOS_JUGADORES,
    { id: 'chica', nombre: 'Chica', factor: 0.82 },
    { id: 'normal', nombre: 'Normal', factor: 1 },
    { id: 'grande', nombre: 'Grande', factor: 1.22 }
];
const ESTADIOS_CLUBES = Clubes.ESTADIOS_CLUBES;
const POTENCIADORES_VALIDOS = ['SUPER_KICK', 'BIG', 'SPEED'];
const MODOS_POTENCIADORES_VALIDOS = ['aleatorio', 'determinado', 'desactivado'];

const MAPAS_BASE = [
    {
        id: 'classic',
        name: 'Classic',
        theme: 'haxball',
        bg: '#718c5a',
        fieldColor: '#66824f',
        lineColor: '#ffffff',
        goalBg: '#3e5230',
        width: 840,
        height: 400,
        goalHeight: 120
    },
    {
        id: 'futsal',
        name: 'Futsal Arena',
        theme: 'classic',
        fieldColor: '#1e3a5f',
        lineColor: '#f8fafc',
        goalBg: '#0f172a',
        width: 840,
        height: 400,
        goalHeight: 120
    },
    {
        id: 'frozen',
        name: 'Frozen',
        theme: 'frozen',
        fieldColor: '#2563eb',
        lineColor: '#e0f2fe',
        goalBg: '#172554',
        width: 960,
        height: 460,
        goalHeight: 135
    },
    {
        id: 'desert',
        name: 'Desert',
        theme: 'desert',
        fieldColor: '#b45309',
        lineColor: '#fef3c7',
        goalBg: '#78350f',
        width: 900,
        height: 430,
        goalHeight: 125
    },
    {
        id: 'street',
        name: 'Street',
        theme: 'street',
        fieldColor: '#374151',
        lineColor: '#fbbf24',
        goalBg: '#111827',
        width: 860,
        height: 410,
        goalHeight: 120
    },
    {
        id: 'champions',
        name: 'Champions',
        theme: 'champions',
        fieldColor: '#15803d',
        lineColor: '#ffffff',
        goalBg: '#0f172a',
        width: 1080,
        height: 520,
        goalHeight: 150
    },
    {
        id: 'cyberpunk',
        name: 'Cyberpunk',
        theme: 'cyberpunk',
        fieldColor: '#1e1b4b',
        lineColor: '#00ffcc',
        goalBg: '#090b18',
        width: 920,
        height: 440,
        goalHeight: 130
    },
    {
        id: 'micro',
        name: 'Micro Arena',
        theme: 'micro',
        fieldColor: '#7c2d12',
        lineColor: '#fde68a',
        goalBg: '#451a03',
        width: 700,
        height: 340,
        goalHeight: 105
    },
    {
        id: 'volcanic',
        name: 'Volcanic',
        theme: 'volcanic',
        fieldColor: '#450a0a',
        lineColor: '#fb923c',
        goalBg: '#1c0505',
        width: 980,
        height: 470,
        goalHeight: 140
    },
    {
        id: 'tunnel',
        name: 'The Tunnel',
        theme: 'tunnel',
        fieldColor: '#14532d',
        lineColor: '#bbf7d0',
        goalBg: '#052e16',
        width: 1060,
        height: 380,
        goalHeight: 115
    },
    {
        id: 'titan',
        name: 'Titan Stadium',
        theme: 'titan',
        fieldColor: '#3b0764',
        lineColor: '#f59e0b',
        goalBg: '#1b1022',
        width: 1260,
        height: 600,
        goalHeight: 170
    }
];

function cargarCatalogoHbs() {
    try {
        const ruta = path.join(__dirname, 'maps', 'haxmaps-catalog.json');
        if (!fs.existsSync(ruta)) return [];
        const lista = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        if (!Array.isArray(lista)) return [];
        return lista.map(item => FisicaHbs.normalizarHbs(item.hbs, {
            id: item.id,
            name: item.name,
            category: item.category || 'HaxBall',
            haxmapsId: item.haxmapsId || null
        }));
    } catch (err) {
        console.error('Error cargando catálogo HaxMaps:', err.message);
        return [];
    }
}

const CATALOGO_HBS = cargarCatalogoHbs();

function construirMapa(mapaId, modo = 'normal', tamano = '3v3', room = null) {
    const custom = room && Array.isArray(room.mapasCustom)
        ? room.mapasCustom.find(m => m.id === mapaId)
        : null;
    if (custom) return custom;

    const hbsMapa = CATALOGO_HBS.find(m => m.id === mapaId);
    if (hbsMapa) return hbsMapa;

    const clubEstadio = ESTADIOS_CLUBES.find(m => m.id === mapaId);
    const base = clubEstadio || MAPAS_BASE.find(m => m.id === mapaId) || ESTADIOS_CLUBES[0];
    const tamanoObj = TAMANOS_VALIDOS.find(t => t.id === tamano) || Clubes.obtenerTamanoJugadores('3v3');
    const factor = tamanoObj.factor;
    const baseEscala = Number.isFinite(base.escala) && base.escala > 0
        ? base.escala
        : Math.min(1.65, Math.max(1, Math.sqrt((base.width * base.height) / (840 * 400))));
    const escala = Number((baseEscala * Math.min(1.32, Math.max(0.92, 0.86 + factor * 0.14))).toFixed(3));
    const normalizado = FisicaHaxball.normalizarMapa({
        ...base,
        width: Math.round(base.width * factor),
        height: Math.round(base.height * factor),
        goalHeight: Math.round(base.goalHeight * factor),
        profundidadArco: Math.round((Number.isFinite(base.profundidadArco) ? base.profundidadArco : 45) * escala),
        escala,
        modo: modo === 'futsal' ? 'futsal' : 'normal'
    });
    normalizado.category = clubEstadio ? 'Clubes' : 'Original';
    normalizado.tamano = tamanoObj.id;
    normalizado.tamanoNombre = tamanoObj.nombre;
    if (clubEstadio) {
        normalizado.esClub = true;
        normalizado.club = clubEstadio.club;
        normalizado.clubId = clubEstadio.clubId;
    }
    normalizado.radioPoste = FisicaHaxball.constantes.POSTE.radio * normalizado.escala;
    return normalizado;
}

const MAPAS_PREVIEW = MAPAS_BASE.map(m => construirMapa(m.id, 'normal', '3v3'));
const ESTADIOS_CLUBES_PREVIEW = ESTADIOS_CLUBES.map(m => construirMapa(m.id, 'normal', '3v3'));

// ========================= //
// RUTAS HTTP Y ESTÁTICOS    //
// ========================= //

const STATIC_DIRS = ['css', 'js', 'pages', 'img', 'fonts', 'sonidos', 'musica'];
STATIC_DIRS.forEach(dir => {
    app.use('/' + dir, express.static(path.join(__dirname, dir)));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function listarAudios(dirPath, prefixUrl) {
    try {
        if (!fs.existsSync(dirPath)) return [];
        return fs.readdirSync(dirPath)
            .filter(file => /\.(mp3|ogg|wav|m4a)$/i.test(file))
            .map(file => `${prefixUrl}${encodeURIComponent(file)}`);
    } catch {
        return [];
    }
}

app.get('/api/musica', (req, res) => {
    const menu = listarAudios(path.join(__dirname, 'musica'), '/musica/');
    const partido = listarAudios(path.join(__dirname, 'musica', 'partido'), '/musica/partido/');
    res.json({ menu, partido });
});

app.get('/api/mapas-hbs', (req, res) => {
    res.json({ mapas: CATALOGO_HBS });
});

// ========================= //
// ESTADO DE SALAS Y JUEGO   //
// ========================= //

const rooms = new Map();
const socketToRoom = new Map();

function generarCodigoSala() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
        code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (rooms.has(code));
    return code;
}

function generarToken() {
    return crypto.randomBytes(16).toString('hex');
}

function limpiarNombre(valor, fallback = 'Jugador') {
    const texto = String(valor || '').trim().slice(0, 16);
    return texto || fallback;
}

function limpiarAvatar(valor) {
    const texto = String(valor || '').replace(/\s/g, '');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segs = Array.from(new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(texto), s => s.segment);
        return segs.slice(0, 2).join('');
    }
    return Array.from(texto).slice(0, 2).join('');
}

function resumenSalaLista(room) {
    const sinLimite = room.maxJugadores === 0;
    return {
        id: room.id,
        nombre: room.nombre,
        conClave: !!room.clave,
        sinLimite,
        jugadores: room.jugadores.length,
        maxJugadores: sinLimite ? 999 : room.maxJugadores,
        mapa: room.mapa.name,
        enJuego: !!room.partido
    };
}

function listaSalasPublica() {
    return Array.from(rooms.values())
        .filter(room => !room.privada)
        .map(resumenSalaLista);
}

function emitirListaSalas() {
    io.emit('salas:lista', listaSalasPublica());
}

function estadoSalaPublico(room) {
    return {
        id: room.id,
        nombre: room.nombre,
        conClave: !!room.clave,
        privada: !!room.privada,
        maxPorEquipo: room.maxJugadores > 0 ? Math.floor(room.maxJugadores / 2) : 0,
        jugadores: room.jugadores.map(j => ({
            id: j.id,
            nombre: j.nombre,
            equipo: j.equipo,
            admin: j.admin,
            avatar: j.avatar,
            escribiendo: !!j.escribiendo,
            desconectado: !!j.desconectado
        })),
        tiempos: TIEMPOS_VALIDOS,
        golesValidos: GOLES_VALIDOS,
        modos: MODOS_VALIDOS,
        tamanos: Clubes.TAMANOS_JUGADORES.map(({ id, etiqueta, nombre }) => ({ id, etiqueta, nombre })),
        config: {
            ...room.config,
            potenciadoresActivos: [...(room.config.potenciadoresActivos || POTENCIADORES_VALIDOS)],
            clubes: { ...(room.config.clubes || { red: 'boca', blue: 'river' }) }
        },
        mapa: room.mapa,
        partido: room.partido ? {
            pausado: !!room.partido.pausado,
            practica: !!room.partido.practica,
            fase: room.partido.fase,
            marcador: { ...room.partido.marcador },
            goles: room.partido.goles.slice()
        } : null,
        ultimoResultado: room.ultimoResultado
    };
}

function emitirEstadoSala(room) {
    io.to(room.id).emit('sala:estado', estadoSalaPublico(room));
}

function emitirMensajeSistema(room, texto) {
    io.to(room.id).emit('sala:chat', { sistema: true, texto });
}

function asegurarAdmin(room) {
    if (!room.jugadores.length) return;
    const conectados = room.jugadores.filter(j => !j.desconectado);
    const pool = conectados.length ? conectados : room.jugadores;
    if (!pool.some(j => j.admin)) {
        pool[0].admin = true;
    }
}

function equipoAutomatico(room) {
    const rojos = room.jugadores.filter(j => j.equipo === 'red').length;
    const azules = room.jugadores.filter(j => j.equipo === 'blue').length;
    const maxPorEquipo = room.maxJugadores > 0 ? Math.floor(room.maxJugadores / 2) : Infinity;
    if (rojos <= azules && rojos < maxPorEquipo) return 'red';
    if (azules < maxPorEquipo) return 'blue';
    if (rojos < maxPorEquipo) return 'red';
    return null;
}

// ========================= //
// SIMULACIÓN DE PARTIDOS    //
// ========================= //

function iniciarPartido(room, opciones = {}) {
    const esPractica = !!(opciones && opciones.practica);
    if (room.partido && !(room.partido.practica && !esPractica)) {
        return { error: 'Ya hay un partido en curso.' };
    }
    const enCancha = room.jugadores.filter(j => j.equipo === 'red' || j.equipo === 'blue');
    if (!enCancha.length) {
        return { error: 'Tiene que haber al menos un jugador en Rojo o Azul.' };
    }
    if (room.partido && room.partido.practica && !esPractica) {
        if (room.partido.intervalId) {
            clearInterval(room.partido.intervalId);
            room.partido.intervalId = null;
        }
        room.partido = null;
    }

    const esHbs = !!(room.mapa && room.mapa.hbs);
    const modoPot = room.config.potenciadoresModo || (room.config.powerUps ? 'aleatorio' : 'desactivado');
    const activosPot = Array.isArray(room.config.potenciadoresActivos) ? room.config.potenciadoresActivos : POTENCIADORES_VALIDOS;
    const kickoffTeam = enCancha.some(j => j.equipo === 'red') ? 'red' : 'blue';
    const fisica = FisicaHaxball.crearEstado({
        mapa: room.mapa,
        ladoIzquierdo: 'red',
        kickoffTeam,
        jugadores: enCancha.map(j => ({ id: j.id, equipo: j.equipo })),
        powerUps: esHbs ? false : modoPot !== 'desactivado',
        potenciadoresModo: esHbs ? 'desactivado' : modoPot,
        potenciadoresActivos: activosPot,
        combinarPoderes: esHbs ? false : !!room.config.combinarPoderes,
        sinSaques: esPractica
    });

    const inputs = new Map();
    enCancha.forEach(j => {
        inputs.set(j.id, { bits: 0, tickTecla: -1, ticksDesde: 0 });
    });

    room.partido = {
        tick: 0,
        pausado: false,
        practica: esPractica,
        fase: esPractica ? 'PRACTICA' : 'SAQUE',
        practicaResetTicks: 0,
        servingTeam: kickoffTeam,
        overtime: false,
        marcador: { red: 0, blue: 0 },
        goles: [],
        ultimoGol: null,
        golTranscurridoMs: 0,
        restanteMs: (room.config.tiempoMin || 5) * 60 * 1000,
        overtimeMs: 0,
        elapsedMs: 0,
        fisica,
        inputs,
        puntuacion: esPractica ? null : Puntuacion.crearMotorPuntuacion(enCancha),
        replayBuffer: [],
        goalClips: [],
        ultimoToquePorJugador: new Map(),
        ultimaPatadaPorJugador: new Map(),
        golTick: null,
        golAutorId: null,
        golPostTicksRestantes: 0,
        replay: null,
        ultimoTickAt: Date.now(),
        intervalId: null
    };

    io.to(room.id).emit('partido:inicio', { mapa: room.mapa, practica: esPractica });
    emitirEstadoSala(room);
    emitirListaSalas();
    emitirFotoPartido(room);

    room.partido.intervalId = setInterval(() => procesarTickPartido(room), MS_TICK);
    return { ok: true };
}

function detenerPartido(room, porFin = false, ganador = null) {
    if (!room.partido) return;
    const partido = room.partido;
    if (partido.intervalId) {
        clearInterval(partido.intervalId);
        partido.intervalId = null;
    }
    const marcador = { ...partido.marcador };
    const goles = partido.goles.slice();
    const goalClips = Array.isArray(partido.goalClips) ? partido.goalClips.slice(0, 25) : [];
    if (!partido.practica && partido.fase === 'GOL' && goles.length > 0) {
        const ultimoIdx = goles.length - 1;
        if (ultimoIdx < 25 && !goalClips[ultimoIdx] && Array.isArray(partido.replayBuffer) && partido.replayBuffer.length >= 2) {
            const autorId = partido.golAutorId;
            const ultimaPatada = autorId ? partido.ultimaPatadaPorJugador.get(autorId) : null;
            const ultimoToque = autorId ? partido.ultimoToquePorJugador.get(autorId) : null;
            const clipFinal = Repeticion.construirClipReplay({
                buffer: partido.replayBuffer,
                tickGol: partido.golTick || partido.tick,
                ultimaPatadaTick: ultimaPatada ? ultimaPatada.tick : null,
                ultimoToqueTick: ultimoToque ? ultimoToque.tick : null,
                ultimoGol: partido.ultimoGol,
                jugadores: room.jugadores
            });
            if (clipFinal) goalClips[ultimoIdx] = clipFinal;
        }
    }
    const golesConReplay = goles.map((g, idx) => ({
        ...g,
        tieneReplay: !!goalClips[idx]
    }));
    const puntuacion = !partido.practica && partido.puntuacion
        ? partido.puntuacion.obtenerResumen(room.jugadores)
        : null;
    room.partido = null;

    if (porFin && !partido.practica) {
        room.ultimoResultadoSeq = (room.ultimoResultadoSeq || 0) + 1;
        room.ultimoResultado = { resultadoId: room.ultimoResultadoSeq, ganador, marcador, goles: golesConReplay, puntuacion };
        room.ultimoResultadoClips = goalClips;
        io.to(room.id).emit('partido:fin', { ganador, marcador, puntuacion, goles: golesConReplay });
    } else {
        if (!partido.practica && (golesConReplay.length > 0 || (puntuacion && puntuacion.jugadores.some(j => j.puntos > 0)))) {
            room.ultimoResultadoSeq = (room.ultimoResultadoSeq || 0) + 1;
            room.ultimoResultado = {
                resultadoId: room.ultimoResultadoSeq,
                ganador: null,
                practica: false,
                detenido: true,
                marcador,
                goles: golesConReplay,
                puntuacion
            };
            room.ultimoResultadoClips = goalClips;
        }
        io.to(room.id).emit('partido:detenido', { puntuacion });
    }
    emitirEstadoSala(room);
    emitirListaSalas();
}

function bitsAInput(bits) {
    return {
        up: !!(bits & 1),
        down: !!(bits & 2),
        left: !!(bits & 4),
        right: !!(bits & 8),
        kick: !!(bits & 16)
    };
}

function emitirFotoPartido(room) {
    const partido = room.partido;
    if (!partido) return;
    const f = partido.fisica;
    const foto = {
        n: partido.tick,
        p: !!partido.pausado,
        pr: partido.practica ? 1 : 0,
        f: partido.fase,
        s: partido.servingTeam,
        x: !!partido.overtime,
        t: partido.practica ? partido.elapsedMs : (partido.overtime ? partido.overtimeMs : partido.restanteMs),
        m: [partido.marcador.red, partido.marcador.blue],
        b: [f.ball.x, f.ball.y, f.ball.r, f.ball.vx, f.ball.vy],
        eb: (f.extraBalls || []).map(eb => [eb.ownerId, eb.x, eb.y, eb.r, eb.vx, eb.vy, eb.color]),
        u: (f.activePowerUps || []).map(p => [p.x, p.y, p.type, p.r]),
        i: f.lastPowerImpact ? [f.lastPowerImpact.id, f.lastPowerImpact.x, f.lastPowerImpact.y] : null,
        j: f.players.map(p => {
            const inp = partido.inputs.get(p.id) || { bits: 0, tickTecla: -1, ticksDesde: 0 };
            return [
                p.id,
                p.x,
                p.y,
                p.r,
                p.pateando ? 1 : 0,
                FisicaHaxball.codigoPoderes(p),
                p.vx,
                p.vy,
                p.patadaUsada ? 1 : 0,
                inp.tickTecla,
                inp.ticksDesde,
                inp.bits
            ];
        })
    };

    if (partido.fase === 'REPETICION' && partido.replay) {
        const fotoReplay = {
            n: partido.tick,
            p: !!partido.pausado,
            pr: partido.practica ? 1 : 0,
            f: 'REPETICION',
            s: partido.servingTeam,
            x: !!partido.overtime,
            t: partido.practica ? partido.elapsedMs : (partido.overtime ? partido.overtimeMs : partido.restanteMs),
            m: [partido.marcador.red, partido.marcador.blue],
            b: [f.ball.x, f.ball.y, f.ball.r, 0, 0],
            u: [],
            i: null,
            j: [],
            rt: Math.round(partido.replay.elapsedMs),
            rd: Math.round(partido.replay.duracionMs)
        };
        io.to(room.id).emit('partido:estado', fotoReplay);
        return;
    }

    if (partido.fase === 'GOL' && partido.ultimoGol) {
        foto.ug = [partido.ultimoGol.equipo, partido.ultimoGol.autor || '', partido.ultimoGol.enContra ? 1 : 0];
        foto.g = partido.golTranscurridoMs;
    }

    io.to(room.id).emit('partido:estado', foto);
}

function payloadReplayActual(room) {
    const partido = room && room.partido;
    if (!partido || partido.fase !== 'REPETICION' || !partido.replay) return null;
    const estadoVotos = Repeticion.evaluarVotosSkip(room.jugadores, partido.replay.votosSkip);
    return {
        clip: partido.replay.clip,
        elapsedMs: Math.round(partido.replay.elapsedMs),
        ...estadoVotos
    };
}

function verificarSkipReplay(room) {
    const partido = room && room.partido;
    if (!partido || partido.fase !== 'REPETICION' || !partido.replay) return false;
    const estadoVotos = Repeticion.evaluarVotosSkip(room.jugadores, partido.replay.votosSkip);
    io.to(room.id).emit('partido:replayVotos', estadoVotos);
    if (estadoVotos.aprobado) {
        finalizarFaseGolYReplay(room, true);
        return true;
    }
    return false;
}

function finalizarFaseGolYReplay(room, skipped = false) {
    const partido = room && room.partido;
    if (!partido) return;
    const f = partido.fisica;
    const estabaEnReplay = partido.fase === 'REPETICION' || !!partido.replay;
    partido.replay = null;

    const limiteGoles = Number(room.config.goles) || 0;
    const ganadorPorGoles = !partido.practica && limiteGoles > 0
        ? (partido.marcador.red >= limiteGoles ? 'red' : (partido.marcador.blue >= limiteGoles ? 'blue' : null))
        : null;
    if (!partido.practica && (ganadorPorGoles || partido.overtime)) {
        const ganador = partido.marcador.red > partido.marcador.blue
            ? 'red'
            : (partido.marcador.blue > partido.marcador.red ? 'blue' : null);
        if (estabaEnReplay) {
            io.to(room.id).emit('partido:repeticionFin', { motivo: skipped ? 'skip' : 'fin' });
        }
        emitirFotoPartido(room);
        detenerPartido(room, true, ganador);
        return;
    }

    const equipoSaca = partido.ultimoGol && partido.ultimoGol.equipo === 'red' ? 'blue' : 'red';
    partido.servingTeam = equipoSaca;
    f.kickoffTeam = equipoSaca;
    FisicaHaxball.reiniciarSaque(f);
    if (partido.puntuacion) partido.puntuacion.limpiarHistorialSaque();
    partido.replayBuffer = [];
    partido.ultimoToquePorJugador.clear();
    partido.ultimaPatadaPorJugador.clear();
    partido.golTick = null;
    partido.golAutorId = null;
    partido.golPostTicksRestantes = 0;
    partido.fase = 'SAQUE';
    partido.ultimoGol = null;
    partido.golTranscurridoMs = 0;

    if (estabaEnReplay) {
        io.to(room.id).emit('partido:repeticionFin', { motivo: skipped ? 'skip' : 'completado' });
    }
    io.to(room.id).emit('partido:evento', { tipo: 'saque' });
    emitirEstadoSala(room);
    emitirFotoPartido(room);
}

function iniciarReplayGol(room) {
    const partido = room && room.partido;
    if (!partido) return;
    if (partido.practica) {
        finalizarFaseGolYReplay(room, false);
        return;
    }

    const autorId = partido.golAutorId;
    const ultimaPatada = autorId ? partido.ultimaPatadaPorJugador.get(autorId) : null;
    const ultimoToque = autorId ? partido.ultimoToquePorJugador.get(autorId) : null;

    const clip = Repeticion.construirClipReplay({
        buffer: partido.replayBuffer,
        tickGol: partido.golTick || partido.tick,
        ultimaPatadaTick: ultimaPatada ? ultimaPatada.tick : null,
        ultimoToqueTick: ultimoToque ? ultimoToque.tick : null,
        ultimoGol: partido.ultimoGol,
        jugadores: room.jugadores
    });

    if (!clip) {
        finalizarFaseGolYReplay(room, false);
        return;
    }

    if (!Array.isArray(partido.goalClips)) partido.goalClips = [];
    const golIndex = Math.max(0, partido.goles.length - 1);
    if (golIndex < 25) {
        partido.goalClips[golIndex] = clip;
    }

    partido.fase = 'REPETICION';
    partido.replay = {
        clip,
        elapsedMs: 0,
        duracionMs: clip.duracionMs,
        votosSkip: new Set()
    };

    const payload = payloadReplayActual(room);
    io.to(room.id).emit('partido:repeticion', payload);
    emitirEstadoSala(room);
    emitirFotoPartido(room);
}

function procesarTickPartido(room) {
    const partido = room.partido;
    if (!partido) return;
    const ahora = Date.now();
    const delta = Math.min(Math.max(ahora - partido.ultimoTickAt, 0), 100);
    partido.ultimoTickAt = ahora;

    if (partido.pausado) {
        return;
    }

    if (partido.fase === 'REPETICION' && partido.replay) {
        partido.replay.elapsedMs += MS_TICK;
        if (partido.replay.elapsedMs >= partido.replay.duracionMs) {
            finalizarFaseGolYReplay(room, false);
            return;
        }
        emitirFotoPartido(room);
        return;
    }

    partido.tick += 1;
    const f = partido.fisica;
    const inputsObj = {};
    f.players.forEach(p => {
        const inp = partido.inputs.get(p.id);
        if (inp) {
            inputsObj[p.id] = bitsAInput(inp.bits);
            if (inp.tickTecla >= 0) inp.ticksDesde += 1;
        } else {
            inputsObj[p.id] = bitsAInput(0);
        }
    });

    f.restoMs = 0;
    const { eventos } = FisicaHaxball.avanzar(f, MS_TICK, inputsObj);

    if (partido.practica && partido.practicaResetTicks > 0) {
        partido.practicaResetTicks -= 1;
        if (partido.practicaResetTicks === 0) {
            const bp = f.motor === 'hbs' && f.mapa && f.mapa.ballPhysics
                ? f.mapa.ballPhysics
                : { x: f.mapa.width / 2, y: f.mapa.height / 2, vx: 0, vy: 0 };
            f.ball.x = bp.x;
            f.ball.y = bp.y;
            f.ball.vx = bp.vx || 0;
            f.ball.vy = bp.vy || 0;
            f.golEnCurso = false;
            f.goalDetected = false;
            f.goalResetPending = false;
            f.waitingForKickOff = false;
            f.lastTouch = null;
            f.secondLastTouch = null;
            f.lastTouchSuperKick = false;
        }
    }

    if (f.touchEvents && f.touchEvents.length > 0) {
        const campo = f.field ? {
            left: f.field.left,
            right: f.field.right,
            goalTop: f.goalTop,
            goalBottom: f.goalBottom
        } : null;
        f.touchEvents.forEach(ev => {
            const autor = room.jugadores.find(j => j.id === (ev.player && ev.player.id));
            if (!autor) return;
            if (partido.fase !== 'GOL') {
                partido.ultimoToquePorJugador.set(autor.id, {
                    tick: partido.tick,
                    fuePatada: !!ev.fuePatada,
                    superTiro: !!ev.superTiro
                });
                if (ev.fuePatada) {
                    partido.ultimaPatadaPorJugador.set(autor.id, {
                        tick: partido.tick,
                        superTiro: !!ev.superTiro
                    });
                }
            }
            if (partido.puntuacion) {
                partido.puntuacion.registrarToque(autor, partido.tick, {
                    esPrimerToqueSaque: !!ev.esPrimerToque,
                    superTiro: !!ev.superTiro
                });
                const notifs = partido.puntuacion.evaluarIntervencion({
                    jugador: autor,
                    tickActual: partido.tick,
                    pelotaAntes: ev.pelotaAntes,
                    pelotaDespues: ev.pelotaDespues,
                    campo,
                    fuePatada: !!ev.fuePatada,
                    superTiro: !!ev.superTiro,
                    diferirTiro: true
                });
                notifs.forEach(n => {
                    if (n.tipo === 'atajada' || n.tipo === 'tiro') {
                        io.to(room.id).emit('partido:notificacion', n);
                    }
                });
            }
        });
        f.touchEvents.length = 0;
    }

    if (f.kickImpactEvents && f.kickImpactEvents.length > 0) {
        io.to(room.id).emit('partido:evento', { tipo: 'patada' });
    }
    f.kickEvents.length = 0;
    f.kickImpactEvents.length = 0;

    if (eventos.includes('gol')) {
        if (partido.practica) {
            // En práctica no hay notificaciones de gol, ni festejos ni saques: solo vuelve la pelota al centro.
            partido.practicaResetTicks = 22;
        } else {
            const equipoGol = f.lastGoalTeam === 'blue' ? 'blue' : 'red';
            partido.marcador[equipoGol] += 1;
            const autorObj = room.jugadores.find(j => j.id === f.lastTouch);
            const enContra = !!(autorObj && autorObj.equipo !== equipoGol);
            const fueGolazo = !enContra && !!f.lastTouchSuperKick;
            const duracionBaseMs = (room.config.tiempoMin || 5) * 60 * 1000;
            const transcurridoMs = Math.max(0, duracionBaseMs - partido.restanteMs) + (partido.overtime ? partido.overtimeMs : 0);
            const minuto = Math.max(1, Math.floor(transcurridoMs / 60000) + 1);
            const golInfo = {
                equipo: equipoGol,
                autor: autorObj ? autorObj.nombre : null,
                minuto,
                extra: !!partido.overtime,
                enContra,
                golazo: fueGolazo
            };
            partido.goles.push(golInfo);
            partido.ultimoGol = golInfo;
            partido.golTranscurridoMs = 0;
            partido.golTick = partido.tick;
            partido.golAutorId = autorObj ? autorObj.id : (f.lastTouch || null);
            partido.golPostTicksRestantes = Repeticion.POST_GOAL_TICKS;
            partido.fase = 'GOL';
            io.to(room.id).emit('partido:evento', { tipo: 'gol', golazo: fueGolazo });
            if (partido.puntuacion) {
                const notifsGol = partido.puntuacion.registrarGol({
                    equipoGol,
                    autorJugador: autorObj,
                    jugadoresSala: room.jugadores,
                    tickActual: partido.tick,
                    superTiro: fueGolazo
                });
                notifsGol.forEach(n => {
                    if (n.tipo === 'gol' || n.tipo === 'golazo') {
                        io.to(room.id).emit('partido:notificacion', n);
                    }
                });
            }
            emitirEstadoSala(room);
        }
    } else if (partido.puntuacion && partido.fase !== 'GOL') {
        const notifsTiros = partido.puntuacion.actualizarTirosPendientes(partido.tick, f.ball);
        notifsTiros.forEach(n => {
            if (n.tipo === 'tiro' || n.tipo === 'atajada') {
                io.to(room.id).emit('partido:notificacion', n);
            }
        });
    }

    if (!partido.practica) {
        if (partido.fase !== 'GOL') {
            Repeticion.agregarFrameAlBuffer(partido.replayBuffer, Repeticion.capturarFrame(partido));
        } else if (partido.golPostTicksRestantes > 0) {
            Repeticion.agregarFrameAlBuffer(partido.replayBuffer, Repeticion.capturarFrame(partido));
            partido.golPostTicksRestantes -= 1;
        }
    }

    if (partido.fase === 'GOL') {
        partido.golTranscurridoMs += MS_TICK;
        if (partido.golTranscurridoMs >= DURACION_GOL_MS) {
            iniciarReplayGol(room);
            return;
        }
    } else if (partido.practica) {
        f.waitingForKickOff = false;
        f.timerStarted = true;
        partido.elapsedMs += MS_TICK;
        partido.fase = 'PRACTICA';
    } else {
        if (f.timerStarted && !partido.overtime) {
            partido.restanteMs = Math.max(0, partido.restanteMs - MS_TICK);
            if (partido.restanteMs <= 0) {
                if (partido.marcador.red !== partido.marcador.blue) {
                    const ganador = partido.marcador.red > partido.marcador.blue ? 'red' : 'blue';
                    emitirFotoPartido(room);
                    detenerPartido(room, true, ganador);
                    return;
                }
                partido.overtime = true;
                partido.fase = 'TIEMPO_EXTRA';
                io.to(room.id).emit('partido:evento', { tipo: 'tiempoExtra' });
            } else {
                partido.fase = 'JUGANDO';
            }
        } else if (partido.overtime) {
            partido.overtimeMs += MS_TICK;
            partido.fase = f.waitingForKickOff ? 'SAQUE' : 'TIEMPO_EXTRA';
        } else {
            partido.fase = f.waitingForKickOff ? 'SAQUE' : 'JUGANDO';
        }
    }

    emitirFotoPartido(room);
}

function sincronizarJugadorEnPartido(room, jugador) {
    const partido = room.partido;
    if (!partido) return;
    const f = partido.fisica;
    const indice = f.players.findIndex(p => p.id === jugador.id);
    const debeJugar = jugador.equipo === 'red' || jugador.equipo === 'blue';

    if (!debeJugar) {
        if (indice !== -1) f.players.splice(indice, 1);
        FisicaHaxball.quitarPelotaPractica(f, jugador.id);
        partido.inputs.delete(jugador.id);
        return;
    }

    if (indice !== -1) {
        f.players[indice].equipo = jugador.equipo;
        if (f.motor === 'hbs') {
            f.players[indice].cGroup = jugador.equipo === 'blue' ? FisicaHbs.MASK.blue : FisicaHbs.MASK.red;
        }
    } else if (f.motor === 'hbs') {
        const pp = f.mapa.playerPhysics;
        const cantEquipo = f.players.filter(p => p.equipo === jugador.equipo).length;
        const pos = FisicaHbs.posicionJugadorHbs(f.mapa, jugador.equipo, cantEquipo);
        f.players.push({
            id: jugador.id,
            equipo: jugador.equipo,
            x: pos.x,
            y: pos.y,
            vx: 0,
            vy: 0,
            r: pp.radio,
            rBase: pp.radio,
            invMass: pp.invMass,
            bCoef: pp.bCoef,
            cGroup: jugador.equipo === 'blue' ? FisicaHbs.MASK.blue : FisicaHbs.MASK.red,
            cMask: FisicaHbs.ALL_MASK,
            pateando: false,
            patadaUsada: false,
            activePower: null,
            powerTimer: 0,
            poderes: {},
            niveles: {}
        });
        partido.inputs.set(jugador.id, { bits: 0, tickTecla: -1, ticksDesde: 0 });
    } else {
        const radio = FisicaHaxball.constantes.JUGADOR.radio * f.mapa.escala;
        const cantEquipo = f.players.filter(p => p.equipo === jugador.equipo).length;
        const pos = FisicaHaxball.posicionEnFormacion(f.mapa, jugador.equipo === f.ladoIzquierdo, cantEquipo);
        f.players.push({
            id: jugador.id,
            equipo: jugador.equipo,
            x: pos.x,
            y: pos.y,
            vx: 0,
            vy: 0,
            r: radio,
            rBase: radio,
            invMass: FisicaHaxball.constantes.JUGADOR.invMass,
            pateando: false,
            patadaUsada: false,
            activePower: null,
            powerTimer: 0,
            poderes: {},
            niveles: {}
        });
        partido.inputs.set(jugador.id, { bits: 0, tickTecla: -1, ticksDesde: 0 });
    }
}

function removerJugadorDeSala(room, jugador, motivo = null) {
    const idx = room.jugadores.findIndex(j => j.id === jugador.id);
    if (idx === -1) return;
    room.jugadores.splice(idx, 1);
    if (jugador.socketId) {
        socketToRoom.delete(jugador.socketId);
        const sock = io.sockets.sockets.get(jugador.socketId);
        if (sock) sock.leave(room.id);
    }

    if (room.partido) {
        const f = room.partido.fisica;
        const fi = f.players.findIndex(p => p.id === jugador.id);
        if (fi !== -1) f.players.splice(fi, 1);
        FisicaHaxball.quitarPelotaPractica(f, jugador.id);
        room.partido.inputs.delete(jugador.id);
        if (f.players.length === 0) {
            detenerPartido(room, false);
        }
    }

    if (room.jugadores.length === 0) {
        if (room.partido) detenerPartido(room, false);
        rooms.delete(room.id);
        emitirListaSalas();
        return;
    }

    asegurarAdmin(room);
    emitirMensajeSistema(room, motivo || `${jugador.nombre} salió de la sala.`);
    emitirEstadoSala(room);
    emitirListaSalas();
    if (room.partido && room.partido.fase === 'REPETICION') {
        verificarSkipReplay(room);
    }
}

// Limpieza periódica de desconectados y salas vacías
setInterval(() => {
    const ahora = Date.now();
    rooms.forEach(room => {
        const expirados = room.jugadores.filter(j => j.desconectado && (ahora - j.desconectado) >= TIEMPO_DESCONEXION_MS);
        expirados.forEach(j => removerJugadorDeSala(room, j, `${j.nombre} se desconectó.`));

        if (room.jugadores.length === 0) {
            if (!room.vaciaDesde) room.vaciaDesde = ahora;
            else if (ahora - room.vaciaDesde >= TIEMPO_SALA_VACIA_MS) {
                if (room.partido) detenerPartido(room, false);
                rooms.delete(room.id);
                emitirListaSalas();
            }
        } else {
            room.vaciaDesde = null;
        }
    });
}, 2000);

// ========================= //
// SOCKET.IO                 //
// ========================= //

io.on('connection', (socket) => {
    function obtenerContexto() {
        const salaId = socketToRoom.get(socket.id);
        if (!salaId) return null;
        const room = rooms.get(salaId);
        if (!room) return null;
        const jugador = room.jugadores.find(j => j.socketId === socket.id);
        if (!jugador) return null;
        return { room, jugador };
    }

    socket.on('ping', (_data, cb) => {
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('salas:pedir', (_data, cb) => {
        const salas = listaSalasPublica();
        if (typeof cb === 'function') cb({ salas });
        else socket.emit('salas:lista', salas);
    });

    socket.on('sala:crear', (data = {}, cb) => {
        const actual = obtenerContexto();
        if (actual) removerJugadorDeSala(actual.room, actual.jugador);

        const salaId = generarCodigoSala();
        const nombreJugador = limpiarNombre(data.nombreJugador, 'Host');
        const nombreSala = String(data.nombre || '').trim().slice(0, 30) || `Sala de ${nombreJugador}`;
        const clave = String(data.clave || '').trim().slice(0, 20);
        const maxVal = Number(data.maxJugadores);
        const maxJugadores = Number.isFinite(maxVal) && maxVal > 0 ? Math.min(22, Math.max(2, Math.round(maxVal))) : 0;

        const playerId = `j_${crypto.randomBytes(4).toString('hex')}`;
        const token = generarToken();
        const jugador = {
            id: playerId,
            socketId: socket.id,
            token,
            nombre: nombreJugador,
            equipo: 'red',
            admin: true,
            avatar: limpiarAvatar(data.avatar),
            escribiendo: false,
            desconectado: null
        };

        const config = {
            mapaId: 'estadio_bombonera',
            modo: 'normal',
            tamano: '3v3',
            tiempoMin: 5,
            goles: 3,
            powerUps: true,
            potenciadoresModo: 'aleatorio',
            potenciadoresActivos: [...POTENCIADORES_VALIDOS],
            combinarPoderes: false,
            equiposBloqueados: false,
            clubes: {
                red: 'boca',
                blue: 'river'
            }
        };

        const room = {
            id: salaId,
            nombre: nombreSala,
            clave,
            privada: !!data.privada,
            maxJugadores,
            jugadores: [jugador],
            config,
            mapasCustom: [],
            mapa: construirMapa(config.mapaId, config.modo, config.tamano),
            partido: null,
            ultimoResultado: null,
            ultimoResultadoClips: [],
            ultimoResultadoSeq: 0,
            vaciaDesde: null
        };

        rooms.set(salaId, room);
        socketToRoom.set(socket.id, salaId);
        socket.join(salaId);

        if (typeof cb === 'function') {
            cb({
                ok: true,
                salaId,
                tuId: playerId,
                token,
                mapas: MAPAS_PREVIEW,
                estadiosClubes: ESTADIOS_CLUBES_PREVIEW,
                mapasCustom: room.mapasCustom,
                sala: estadoSalaPublico(room),
                reconectado: false
            });
        }
        emitirMensajeSistema(room, `${nombreJugador} creó la sala.`);
        emitirListaSalas();
    });

    socket.on('sala:unirse', (data = {}, cb) => {
        const salaId = String(data.salaId || '').trim().toUpperCase();
        const room = rooms.get(salaId);
        if (!room) {
            if (typeof cb === 'function') cb({ error: 'Esa sala no existe o ya se cerró.' });
            return;
        }

        // Reconexión con token
        if (data.token) {
            const existente = room.jugadores.find(j => j.token === data.token);
            if (existente) {
                const actual = obtenerContexto();
                if (actual && actual.jugador.id !== existente.id) {
                    removerJugadorDeSala(actual.room, actual.jugador);
                }
                existente.socketId = socket.id;
                existente.desconectado = null;
                socketToRoom.set(socket.id, room.id);
                socket.join(room.id);
                if (typeof cb === 'function') {
                    cb({
                        ok: true,
                        salaId: room.id,
                        tuId: existente.id,
                        token: existente.token,
                        mapas: MAPAS_PREVIEW,
                        estadiosClubes: ESTADIOS_CLUBES_PREVIEW,
                        mapasCustom: room.mapasCustom || [],
                        sala: estadoSalaPublico(room),
                        reconectado: true
                    });
                }
                emitirEstadoSala(room);
                const replayActual = payloadReplayActual(room);
                if (replayActual) socket.emit('partido:repeticion', replayActual);
                return;
            }
        }

        if (room.clave && String(data.clave || '') !== room.clave) {
            const yaIntento = data.clave !== undefined && data.clave !== '';
            if (typeof cb === 'function') {
                cb({
                    pideClave: true,
                    error: yaIntento ? 'Contraseña incorrecta.' : undefined
                });
            }
            return;
        }

        if (room.maxJugadores > 0 && room.jugadores.length >= room.maxJugadores) {
            if (typeof cb === 'function') cb({ error: 'La sala está llena.' });
            return;
        }

        const actual = obtenerContexto();
        if (actual) removerJugadorDeSala(actual.room, actual.jugador);

        const nombreJugador = limpiarNombre(data.nombreJugador, `Jugador ${room.jugadores.length + 1}`);
        const playerId = `j_${crypto.randomBytes(4).toString('hex')}`;
        const token = generarToken();
        const jugador = {
            id: playerId,
            socketId: socket.id,
            token,
            nombre: nombreJugador,
            equipo: room.partido ? null : equipoAutomatico(room),
            admin: room.jugadores.length === 0,
            avatar: limpiarAvatar(data.avatar),
            escribiendo: false,
            desconectado: null
        };

        room.jugadores.push(jugador);
        room.vaciaDesde = null;
        socketToRoom.set(socket.id, room.id);
        socket.join(room.id);

        if (typeof cb === 'function') {
            cb({
                ok: true,
                salaId: room.id,
                tuId: playerId,
                token,
                mapas: MAPAS_PREVIEW,
                estadiosClubes: ESTADIOS_CLUBES_PREVIEW,
                mapasCustom: room.mapasCustom || [],
                sala: estadoSalaPublico(room),
                reconectado: false
            });
        }
        emitirMensajeSistema(room, `${nombreJugador} entró a la sala.`);
        emitirEstadoSala(room);
        emitirListaSalas();
        const replayActual = payloadReplayActual(room);
        if (replayActual) socket.emit('partido:repeticion', replayActual);
    });

    socket.on('sala:salir', (_data, cb) => {
        const ctx = obtenerContexto();
        if (ctx) removerJugadorDeSala(ctx.room, ctx.jugador);
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('sala:avatar', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx) return typeof cb === 'function' && cb({ error: 'No estás en ninguna sala.' });
        ctx.jugador.avatar = limpiarAvatar(data.avatar);
        emitirEstadoSala(ctx.room);
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('sala:mover', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx) return typeof cb === 'function' && cb({ error: 'No estás en ninguna sala.' });
        const { room, jugador } = ctx;
        const objetivo = room.jugadores.find(j => j.id === data.jugadorId);
        if (!objetivo) return typeof cb === 'function' && cb({ error: 'Jugador no encontrado.' });
        if (!jugador.admin && (objetivo.id !== jugador.id || room.config.equiposBloqueados)) {
            return typeof cb === 'function' && cb({ error: 'Solo el admin puede mover jugadores.' });
        }
        const equipo = data.equipo === 'red' || data.equipo === 'blue' ? data.equipo : null;
        if (equipo && room.maxJugadores > 0) {
            const maxPorEquipo = Math.floor(room.maxJugadores / 2);
            const cant = room.jugadores.filter(j => j.equipo === equipo && j.id !== objetivo.id).length;
            if (cant >= maxPorEquipo) {
                return typeof cb === 'function' && cb({ error: 'Ese equipo ya está completo.' });
            }
        }
        objetivo.equipo = equipo;
        sincronizarJugadorEnPartido(room, objetivo);
        emitirEstadoSala(room);
        if (room.partido && room.partido.fase === 'REPETICION') {
            verificarSkipReplay(room);
        }
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('sala:admin', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.jugador.admin) return typeof cb === 'function' && cb({ error: 'Solo el admin puede hacer eso.' });
        const objetivo = ctx.room.jugadores.find(j => j.id === data.jugadorId);
        if (!objetivo || objetivo.id === ctx.jugador.id) {
            return typeof cb === 'function' && cb({ error: 'No podés cambiar tu propio admin.' });
        }
        objetivo.admin = !objetivo.admin;
        emitirMensajeSistema(ctx.room, `${objetivo.nombre} ${objetivo.admin ? 'ahora es admin' : 'ya no es admin'}.`);
        emitirEstadoSala(ctx.room);
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('sala:echar', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.jugador.admin) return typeof cb === 'function' && cb({ error: 'Solo el admin puede echar jugadores.' });
        const objetivo = ctx.room.jugadores.find(j => j.id === data.jugadorId);
        if (!objetivo || objetivo.id === ctx.jugador.id) {
            return typeof cb === 'function' && cb({ error: 'No podés echarte a vos mismo.' });
        }
        const targetSock = objetivo.socketId ? io.sockets.sockets.get(objetivo.socketId) : null;
        if (targetSock) targetSock.emit('sala:expulsado', { motivo: 'El admin te echó de la sala.' });
        removerJugadorDeSala(ctx.room, objetivo, `${objetivo.nombre} fue echado de la sala.`);
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('sala:config', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.jugador.admin) return typeof cb === 'function' && cb({ error: 'Solo el admin puede cambiar la configuración.' });
        const { room } = ctx;
        if (data.equiposBloqueados !== undefined) {
            room.config.equiposBloqueados = !!data.equiposBloqueados;
        }
        if (data.privada !== undefined) {
            room.privada = !!data.privada;
        }
        if (typeof data.clave === 'string') {
            room.clave = data.clave.trim().slice(0, 20);
        }
        if (data.clubes && typeof data.clubes === 'object') {
            if (!room.config.clubes) room.config.clubes = { red: 'boca', blue: 'river' };
            if (data.clubes.red && Clubes.CLUBES.some(c => c.id === data.clubes.red)) {
                room.config.clubes.red = data.clubes.red;
            }
            if (data.clubes.blue && Clubes.CLUBES.some(c => c.id === data.clubes.blue)) {
                room.config.clubes.blue = data.clubes.blue;
            }
        }
        if (!room.partido) {
            const mapaValido = data.mapaId && (
                ESTADIOS_CLUBES.some(m => m.id === data.mapaId) ||
                MAPAS_BASE.some(m => m.id === data.mapaId) ||
                CATALOGO_HBS.some(m => m.id === data.mapaId) ||
                (room.mapasCustom && room.mapasCustom.some(m => m.id === data.mapaId))
            );
            if (mapaValido) room.config.mapaId = data.mapaId;
            if (data.modo && MODOS_VALIDOS.some(m => m.id === data.modo)) room.config.modo = data.modo;
            if (data.tamano && TAMANOS_VALIDOS.some(t => t.id === data.tamano)) room.config.tamano = data.tamano;
            if (TIEMPOS_VALIDOS.includes(Number(data.tiempoMin))) room.config.tiempoMin = Number(data.tiempoMin);
            if (GOLES_VALIDOS.includes(Number(data.goles))) room.config.goles = Number(data.goles);
            if (Array.isArray(data.potenciadoresActivos)) {
                room.config.potenciadoresActivos = data.potenciadoresActivos.filter(p => POTENCIADORES_VALIDOS.includes(p));
            }
            if (data.potenciadoresModo && MODOS_POTENCIADORES_VALIDOS.includes(data.potenciadoresModo)) {
                room.config.potenciadoresModo = data.potenciadoresModo;
                room.config.powerUps = data.potenciadoresModo !== 'desactivado';
            } else if (data.powerUps !== undefined) {
                room.config.powerUps = !!data.powerUps;
                room.config.potenciadoresModo = room.config.powerUps ? 'aleatorio' : 'desactivado';
            }
            if (data.combinarPoderes !== undefined) room.config.combinarPoderes = !!data.combinarPoderes;
            room.mapa = construirMapa(room.config.mapaId, room.config.modo, room.config.tamano, room);
        }
        emitirEstadoSala(room);
        emitirListaSalas();
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('sala:importarHbs', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.jugador.admin) return typeof cb === 'function' && cb({ error: 'Solo el admin puede importar mapas.' });
        const { room, jugador } = ctx;
        if (room.partido) return typeof cb === 'function' && cb({ error: 'Detené el partido para importar un mapa.' });

        let rawHbs;
        try {
            if (typeof data.texto === 'string') {
                rawHbs = FisicaHbs.parseHbsTexto(data.texto);
            } else if (data.hbs && typeof data.hbs === 'object' && !Array.isArray(data.hbs)) {
                rawHbs = FisicaHbs.parseHbsTexto(JSON.stringify(data.hbs));
            } else {
                throw new Error('No se recibió ningún mapa .hbs.');
            }
        } catch (err) {
            return typeof cb === 'function' && cb({ error: err.message || 'Mapa .hbs inválido.' });
        }

        const nombreArchivo = String(data.nombreArchivo || '').replace(/\.(hbs|json|txt)$/i, '').trim();
        const nombreCustom = String(rawHbs.name || nombreArchivo || 'Mapa importado').trim().slice(0, 48);
        const nuevoMapa = FisicaHbs.normalizarHbs(rawHbs, {
            id: `custom_${crypto.randomBytes(4).toString('hex')}`,
            name: nombreCustom,
            category: 'Importados',
            imported: true
        });

        if (!Array.isArray(room.mapasCustom)) room.mapasCustom = [];
        while (room.mapasCustom.length >= MAX_CUSTOM_MAPAS_SALA) {
            room.mapasCustom.shift();
        }
        room.mapasCustom.push(nuevoMapa);
        room.config.mapaId = nuevoMapa.id;
        room.mapa = nuevoMapa;

        io.to(room.id).emit('sala:mapasCustom', room.mapasCustom);
        emitirMensajeSistema(room, `${jugador.nombre} importó el mapa "${nuevoMapa.name}".`);
        emitirEstadoSala(room);
        emitirListaSalas();
        if (typeof cb === 'function') cb({ ok: true, mapa: nuevoMapa });
    });

    socket.on('sala:mezclar', (_data, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.jugador.admin) return typeof cb === 'function' && cb({ error: 'Solo el admin puede mezclar equipos.' });
        if (ctx.room.partido) return typeof cb === 'function' && cb({ error: 'Detené el partido para mezclar.' });
        const pool = ctx.room.jugadores.slice().sort(() => Math.random() - 0.5);
        const maxPorEquipo = ctx.room.maxJugadores > 0 ? Math.floor(ctx.room.maxJugadores / 2) : Infinity;
        let rojos = 0;
        let azules = 0;
        pool.forEach(j => {
            if (rojos <= azules && rojos < maxPorEquipo) {
                j.equipo = 'red';
                rojos += 1;
            } else if (azules < maxPorEquipo) {
                j.equipo = 'blue';
                azules += 1;
            } else {
                j.equipo = null;
            }
        });
        emitirMensajeSistema(ctx.room, 'Equipos mezclados al azar.');
        emitirEstadoSala(ctx.room);
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('sala:chat', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx) return typeof cb === 'function' && cb({ error: 'No estás en ninguna sala.' });
        const texto = String(data.texto || '').trim().slice(0, 140);
        if (!texto) return typeof cb === 'function' && cb({ ok: true });
        io.to(ctx.room.id).emit('sala:chat', {
            sistema: false,
            de: ctx.jugador.nombre,
            equipo: ctx.jugador.equipo,
            admin: ctx.jugador.admin,
            texto
        });
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('sala:escribiendo', (data = {}) => {
        const ctx = obtenerContexto();
        if (!ctx) return;
        ctx.jugador.escribiendo = !!data.si;
        emitirEstadoSala(ctx.room);
    });

    socket.on('partido:iniciar', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.jugador.admin) return typeof cb === 'function' && cb({ error: 'Solo el admin puede iniciar el partido.' });
        const res = iniciarPartido(ctx.room, { practica: !!(data && data.practica) });
        if (typeof cb === 'function') cb(res);
    });

    socket.on('partido:detener', (_data, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.jugador.admin) return typeof cb === 'function' && cb({ error: 'Solo el admin puede detener el partido.' });
        detenerPartido(ctx.room, false);
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('partido:pausa', (_data, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.jugador.admin) return typeof cb === 'function' && cb({ error: 'Solo el admin puede pausar.' });
        if (!ctx.room.partido) return typeof cb === 'function' && cb({ error: 'No hay partido en curso.' });
        ctx.room.partido.pausado = !ctx.room.partido.pausado;
        ctx.room.partido.ultimoTickAt = Date.now();
        emitirEstadoSala(ctx.room);
        emitirFotoPartido(ctx.room);
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('practica:pelota', (_data, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.room.partido || !ctx.room.partido.practica) {
            return typeof cb === 'function' && cb({ error: 'La pelota propia solo está disponible en modo práctica.' });
        }
        const { room, jugador } = ctx;
        if (jugador.equipo !== 'red' && jugador.equipo !== 'blue') {
            return typeof cb === 'function' && cb({ error: 'Entrá a la cancha para invocar tu pelota.' });
        }
        const resultado = FisicaHaxball.invocarPelotaPractica(room.partido.fisica, jugador.id);
        if (!resultado) {
            return typeof cb === 'function' && cb({ error: 'No se pudo invocar la pelota.' });
        }
        emitirFotoPartido(room);
        if (typeof cb === 'function') {
            cb({
                ok: true,
                creado: resultado.creado,
                teletransportada: resultado.teletransportada,
                pelota: {
                    ownerId: resultado.pelota.ownerId,
                    x: resultado.pelota.x,
                    y: resultado.pelota.y,
                    r: resultado.pelota.r,
                    color: resultado.pelota.color
                }
            });
        }
    });

    socket.on('partido:skipReplay', (_data, cb) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.room.partido) return typeof cb === 'function' && cb({ error: 'No hay partido en curso.' });
        const { room, jugador } = ctx;
        const partido = room.partido;
        if (partido.fase !== 'REPETICION' || !partido.replay) {
            return typeof cb === 'function' && cb({ error: 'No hay repetición activa.' });
        }
        if (!Repeticion.esElegibleSkip(room.jugadores, jugador.id)) {
            return typeof cb === 'function' && cb({ error: 'Solo los jugadores en cancha pueden votar para saltar.' });
        }
        partido.replay.votosSkip.add(jugador.id);
        const estadoVotos = Repeticion.evaluarVotosSkip(room.jugadores, partido.replay.votosSkip);
        io.to(room.id).emit('partido:replayVotos', estadoVotos);
        if (typeof cb === 'function') cb({ ok: true, ...estadoVotos });
        if (estadoVotos.aprobado) {
            finalizarFaseGolYReplay(room, true);
        }
    });

    socket.on('sala:verGolReplay', (data = {}, cb) => {
        const ctx = obtenerContexto();
        if (!ctx) return typeof cb === 'function' && cb({ error: 'No estás en ninguna sala.' });
        const { room } = ctx;
        if (room.partido) return typeof cb === 'function' && cb({ error: 'Esperá a que termine el partido actual.' });
        const idx = Number(data && data.indice);
        const clips = Array.isArray(room.ultimoResultadoClips) ? room.ultimoResultadoClips : [];
        const clip = Number.isInteger(idx) && idx >= 0 && idx < clips.length ? clips[idx] : null;
        if (!clip) return typeof cb === 'function' && cb({ error: 'Ese gol no tiene repetición guardada.' });
        if (typeof cb === 'function') cb({ ok: true, clip, indice: idx, totalGoles: clips.length });
    });

    socket.on('entrada', (data = {}) => {
        const ctx = obtenerContexto();
        if (!ctx || !ctx.room.partido) return;
        const partido = ctx.room.partido;
        if (partido.fase === 'REPETICION') return;
        const bits = Number(data.b) | 0;
        const tickTecla = Number.isFinite(Number(data.k)) ? Math.floor(Number(data.k)) : -1;
        partido.inputs.set(ctx.jugador.id, {
            bits,
            tickTecla,
            ticksDesde: 0
        });
    });

    socket.on('disconnect', () => {
        const ctx = obtenerContexto();
        if (!ctx) return;
        const { room, jugador } = ctx;
        socketToRoom.delete(socket.id);
        jugador.desconectado = Date.now();
        jugador.escribiendo = false;
        if (room.partido) {
            const inp = room.partido.inputs.get(jugador.id);
            if (inp) inp.bits = 0;
        }
        asegurarAdmin(room);
        emitirEstadoSala(room);
        if (room.partido && room.partido.fase === 'REPETICION') {
            verificarSkipReplay(room);
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`La Chaula servidor escuchando en http://${HOST}:${PORT}`);
});
