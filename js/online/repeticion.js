/**
 * repeticion.js
 *
 * Lógica compartida (servidor + navegador) para las repeticiones de gol:
 * - Buffer circular de cuadros de la jugada.
 * - Detección del último golpe/patada del autor del gol para disparar cámara lenta.
 * - Curva de tiempo determinista (velocidad normal 1.0x → cámara lenta 0.25x → 1.0x)
 *   e interpolación suave entre cuadros para 60/144 Hz sin saltos.
 * - Votación mayoritaria para saltar la repetición (más de la mitad de los jugadores).
 */
(function (global) {
    const MS_TICK = 1000 / 60;
    const MAX_BUFFER_TICKS = 360; // 6 segundos a 60 Hz
    const PRE_GOAL_DEFAULT_TICKS = 165; // ~2.75 s previos al gol
    const PRE_GOAL_MAX_TICKS = 270; // ~4.5 s máximo previos al gol
    const PRE_KICK_MARGIN_TICKS = 36; // ~0.6 s antes del último golpe del autor
    const POST_GOAL_TICKS = 36; // ~0.6 s después del gol para ver entrar la pelota
    const SLOW_MO_FACTOR = 0.25;
    const SLOW_MO_LEAD_TICKS = 2;
    const SLOW_MO_DURATION_TICKS = 24;
    const VENTANA_PATADA_ANTES_TOQUE_TICKS = 25;

    function clamp(val, min, max) {
        return Math.min(max, Math.max(min, val));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function smoothstep(t) {
        const x = clamp(t, 0, 1);
        return x * x * (3 - 2 * x);
    }

    /**
     * Captura un cuadro compacto del estado físico actual para guardarlo en el buffer.
     */
    function capturarFrame(partido) {
        if (!partido || !partido.fisica) return null;
        const f = partido.fisica;
        const codigoPoderes = (typeof global.FisicaHaxball !== 'undefined' && global.FisicaHaxball.codigoPoderes)
            ? global.FisicaHaxball.codigoPoderes
            : (p => p.activePower || '');

        return {
            tick: partido.tick,
            b: [
                Number(f.ball.x.toFixed(2)),
                Number(f.ball.y.toFixed(2)),
                Number(f.ball.r.toFixed(2)),
                Number((f.ball.vx || 0).toFixed(2)),
                Number((f.ball.vy || 0).toFixed(2))
            ],
            u: (f.activePowerUps || []).map(p => [
                Number(p.x.toFixed(1)),
                Number(p.y.toFixed(1)),
                p.type,
                Number(p.r.toFixed(1))
            ]),
            i: f.lastPowerImpact
                ? [f.lastPowerImpact.id, Number(f.lastPowerImpact.x.toFixed(1)), Number(f.lastPowerImpact.y.toFixed(1))]
                : null,
            j: f.players.map(p => [
                p.id,
                Number(p.x.toFixed(2)),
                Number(p.y.toFixed(2)),
                Number(p.r.toFixed(2)),
                p.pateando ? 1 : 0,
                codigoPoderes(p)
            ])
        };
    }

    function agregarFrameAlBuffer(buffer, frame, maxTicks = MAX_BUFFER_TICKS) {
        if (!Array.isArray(buffer) || !frame) return;
        const ultimo = buffer[buffer.length - 1];
        if (ultimo && ultimo.tick === frame.tick) {
            buffer[buffer.length - 1] = frame;
        } else {
            buffer.push(frame);
        }
        while (buffer.length > maxTicks) {
            buffer.shift();
        }
    }

    /**
     * Elige el tick donde arranca la cámara lenta:
     * Prioriza la última patada (Espacio/X) del autor del gol si ocurrió cerca de su último toque;
     * si empujó la pelota sin patear, usa su último contacto con la pelota.
     */
    function elegirTickCamaraLenta({ tickGol, ultimaPatadaTick = null, ultimoToqueTick = null, primerTickBuffer = 0 }) {
        const tienePatada = Number.isFinite(ultimaPatadaTick) && ultimaPatadaTick <= tickGol;
        const tieneToque = Number.isFinite(ultimoToqueTick) && ultimoToqueTick <= tickGol;

        if (tienePatada && (!tieneToque || (ultimoToqueTick - ultimaPatadaTick) <= VENTANA_PATADA_ANTES_TOQUE_TICKS)) {
            return Math.max(primerTickBuffer, ultimaPatadaTick);
        }
        if (tieneToque) {
            return Math.max(primerTickBuffer, ultimoToqueTick);
        }
        return Math.max(primerTickBuffer, tickGol - 20);
    }

    /**
     * Calcula la velocidad de reproducción (1.0 normal, 0.25 cámara lenta) para el intervalo [idx, idx + 1].
     */
    function velocidadIntervalo(idx, slowStartIdx, slowEndIdx) {
        if (slowStartIdx < 0 || slowEndIdx <= slowStartIdx) return 1;
        if (idx < slowStartIdx || idx > slowEndIdx) return 1;

        const entradaFin = slowStartIdx + 3;
        const salidaIni = Math.max(entradaFin, slowEndIdx - 4);

        if (idx < entradaFin) {
            const p = (idx - slowStartIdx + 1) / 3;
            return lerp(1, SLOW_MO_FACTOR, smoothstep(p));
        }
        if (idx > salidaIni) {
            const p = (idx - salidaIni) / Math.max(1, slowEndIdx - salidaIni);
            return lerp(SLOW_MO_FACTOR, 1, smoothstep(p));
        }
        return SLOW_MO_FACTOR;
    }

    function calcularTablaTiempos(totalFrames, slowStartIdx, slowEndIdx) {
        const n = Math.max(0, totalFrames | 0);
        const tiemposMs = new Array(n);
        if (n === 0) return { tiemposMs, duracionMs: 0 };
        tiemposMs[0] = 0;
        for (let i = 0; i < n - 1; i += 1) {
            const vel = velocidadIntervalo(i, slowStartIdx, slowEndIdx);
            tiemposMs[i + 1] = tiemposMs[i] + (MS_TICK / vel);
        }
        return {
            tiemposMs,
            duracionMs: tiemposMs[n - 1]
        };
    }

    /**
     * Construye el clip de repetición listo para enviar por Socket.IO a toda la sala.
     */
    function construirClipReplay({
        buffer,
        tickGol,
        ultimaPatadaTick = null,
        ultimoToqueTick = null,
        ultimoGol = null,
        jugadores = []
    }) {
        if (!Array.isArray(buffer) || buffer.length < 2) return null;

        const primerTick = buffer[0].tick;
        const slowTick = elegirTickCamaraLenta({
            tickGol,
            ultimaPatadaTick,
            ultimoToqueTick,
            primerTickBuffer: primerTick
        });

        const minPermitido = Math.max(primerTick, tickGol - PRE_GOAL_MAX_TICKS);
        const deseado = Math.min(tickGol - PRE_GOAL_DEFAULT_TICKS, slowTick - PRE_KICK_MARGIN_TICKS);
        const startTick = clamp(deseado, minPermitido, tickGol);
        const endTick = tickGol + POST_GOAL_TICKS;

        const frames = buffer.filter(f => f.tick >= startTick && f.tick <= endTick);
        if (frames.length < 2) return null;

        let goalIdx = frames.findIndex(f => f.tick >= tickGol);
        if (goalIdx === -1) goalIdx = frames.length - 1;

        let kickIdx = frames.findIndex(f => f.tick >= slowTick);
        if (kickIdx === -1) kickIdx = Math.max(0, goalIdx - 12);
        kickIdx = clamp(kickIdx, 0, goalIdx);

        const slowStartIdx = Math.max(0, kickIdx - SLOW_MO_LEAD_TICKS);
        const slowEndIdx = Math.min(
            frames.length - 1,
            Math.max(kickIdx + 6, Math.min(goalIdx + 10, kickIdx + SLOW_MO_DURATION_TICKS))
        );

        const { tiemposMs, duracionMs } = calcularTablaTiempos(frames.length, slowStartIdx, slowEndIdx);

        const jugadoresMeta = (jugadores || []).map(j => ({
            id: j.id,
            nombre: j.nombre || '',
            equipo: j.equipo || null,
            avatar: j.avatar || ''
        }));

        return {
            frames,
            goalIdx,
            kickIdx,
            slowStartIdx,
            slowEndIdx,
            tiemposMs,
            duracionMs,
            ultimoGol: ultimoGol ? { ...ultimoGol } : null,
            jugadoresMeta
        };
    }

    /**
     * Dado un elapsedMs actual, devuelve el índice de cuadro, factor de interpolación,
     * velocidad instantánea y si la cámara lenta está activa en este instante.
     */
    function evaluarProgresoReplay(clip, elapsedMs) {
        if (!clip || !Array.isArray(clip.frames) || clip.frames.length === 0) {
            return {
                frameIndex: 0,
                nextIndex: 0,
                t: 0,
                velocidad: 1,
                enCamaraLenta: false,
                progreso: 1,
                terminado: true
            };
        }

        const n = clip.frames.length;
        const duracion = Math.max(1, clip.duracionMs || 1);
        const ms = clamp(Number(elapsedMs) || 0, 0, duracion);
        const tiempos = Array.isArray(clip.tiemposMs) && clip.tiemposMs.length === n
            ? clip.tiemposMs
            : calcularTablaTiempos(n, clip.slowStartIdx, clip.slowEndIdx).tiemposMs;

        if (ms >= duracion || n === 1) {
            return {
                frameIndex: n - 1,
                nextIndex: n - 1,
                t: 0,
                velocidad: 1,
                enCamaraLenta: false,
                progreso: 1,
                terminado: ms >= duracion
            };
        }

        let lo = 0;
        let hi = n - 2;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (tiempos[mid + 1] <= ms) {
                lo = mid + 1;
            } else if (tiempos[mid] > ms) {
                hi = mid - 1;
            } else {
                lo = mid;
                break;
            }
        }
        const idx = clamp(lo, 0, n - 2);
        const span = Math.max(0.001, tiempos[idx + 1] - tiempos[idx]);
        const t = clamp((ms - tiempos[idx]) / span, 0, 1);
        const velocidad = velocidadIntervalo(idx, clip.slowStartIdx, clip.slowEndIdx);
        const enCamaraLenta = idx >= clip.slowStartIdx && idx <= clip.slowEndIdx;

        return {
            frameIndex: idx,
            nextIndex: idx + 1,
            t,
            velocidad,
            enCamaraLenta,
            progreso: clamp(ms / duracion, 0, 1),
            terminado: false
        };
    }

    /**
     * Interpola pelota y jugadores entre frameIndex y nextIndex para renderizado fluido.
     */
    function interpolarFrameReplay(frames, prog) {
        if (!Array.isArray(frames) || !frames.length) return null;
        const a = frames[prog.frameIndex] || frames[0];
        const b = frames[prog.nextIndex] || a;
        const t = prog.t || 0;

        if (a === b || t <= 0) return a;

        const mapaPrev = new Map((a.j || []).map(row => [row[0], row]));
        return {
            tick: a.tick,
            b: [
                lerp(a.b[0], b.b[0], t),
                lerp(a.b[1], b.b[1], t),
                b.b[2],
                lerp(a.b[3] || 0, b.b[3] || 0, t),
                lerp(a.b[4] || 0, b.b[4] || 0, t)
            ],
            u: a.u || [],
            i: b.i || a.i || null,
            j: (b.j || []).map(row => {
                const prev = mapaPrev.get(row[0]);
                if (!prev) return row;
                return [
                    row[0],
                    lerp(prev[1], row[1], t),
                    lerp(prev[2], row[2], t),
                    row[3],
                    t < 0.5 ? prev[4] : row[4],
                    t < 0.5 ? prev[5] : row[5]
                ];
            })
        };
    }

    /* ========================= */
    /* VOTACIÓN PARA SKIPPEAR    */
    /* ========================= */

    function obtenerElegiblesSkip(jugadores = []) {
        const enCancha = (jugadores || []).filter(j => !j.desconectado && (j.equipo === 'red' || j.equipo === 'blue'));
        if (enCancha.length > 0) return enCancha;
        return (jugadores || []).filter(j => !j.desconectado);
    }

    function esElegibleSkip(jugadores, jugadorId) {
        return obtenerElegiblesSkip(jugadores).some(j => j.id === jugadorId);
    }

    /**
     * Más de la mitad estricta (> total / 2):
     * 1 -> 1, 2 -> 2, 3 -> 2, 4 -> 3, 5 -> 3, 6 -> 4, etc.
     */
    function requeridosParaSkip(totalElegibles) {
        const total = Math.max(0, Number(totalElegibles) || 0);
        if (total <= 1) return 1;
        return Math.floor(total / 2) + 1;
    }

    function evaluarVotosSkip(jugadores, votosSet) {
        const elegibles = obtenerElegiblesSkip(jugadores);
        const idsElegibles = new Set(elegibles.map(j => j.id));
        const votantes = Array.from(votosSet || []).filter(id => idsElegibles.has(id));
        const total = elegibles.length;
        const requeridos = requeridosParaSkip(total);
        const votos = votantes.length;
        return {
            votos,
            requeridos,
            total,
            votantes,
            aprobado: total > 0 && votos >= requeridos
        };
    }

    /* ========================= */
    /* REPLAY POST-PARTIDO       */
    /* ========================= */

    function filtrarGolesConReplay(goles = []) {
        if (!Array.isArray(goles)) return [];
        const resultado = [];
        goles.forEach((gol, indice) => {
            if (!gol || !gol.tieneReplay) return;
            resultado.push({
                indiceOriginal: indice,
                numeroGol: resultado.length + 1,
                equipo: gol.equipo === 'blue' ? 'blue' : 'red',
                autor: gol.autor || null,
                minuto: Number(gol.minuto) || 0,
                extra: !!gol.extra,
                enContra: !!gol.enContra,
                golazo: !!gol.golazo
            });
        });
        return resultado;
    }

    function formatearEtiquetaGol(gol, posicion = 0, total = 1) {
        const cant = Math.max(1, Number(total) || 1);
        const pos = clamp(Number(posicion) || 0, 0, cant - 1);
        const titulo = `Gol ${pos + 1}/${cant}`;
        if (!gol) {
            return { titulo, detalle: 'Gol', minuto: '' };
        }
        const nombreBase = gol.autor
            ? gol.autor
            : (gol.equipo === 'blue' ? 'Equipo Azul' : 'Equipo Rojo');
        const sufijoEc = gol.enContra ? ' (En contra)' : '';
        const sufijoGolazo = gol.golazo ? ' ★' : '';
        const detalle = gol.autor
            ? `Gol de ${nombreBase}${sufijoEc}${sufijoGolazo}`
            : `Gol ${nombreBase}${sufijoEc}${sufijoGolazo}`;
        const minuto = gol.minuto ? `${gol.minuto}'${gol.extra ? '+' : ''}` : '';
        return { titulo, detalle, minuto };
    }

    function navegarIndiceGol(indiceActual = 0, delta = 0, total = 0) {
        const cant = Math.max(0, Number(total) || 0);
        if (cant === 0) {
            return { indice: 0, puedeAnterior: false, puedeSiguiente: false };
        }
        const actual = clamp(Number(indiceActual) || 0, 0, cant - 1);
        const indice = clamp(actual + (Number(delta) || 0), 0, cant - 1);
        return {
            indice,
            puedeAnterior: indice > 0,
            puedeSiguiente: indice < cant - 1
        };
    }

    const RepeticionOnline = {
        MS_TICK,
        MAX_BUFFER_TICKS,
        POST_GOAL_TICKS,
        SLOW_MO_FACTOR,
        capturarFrame,
        agregarFrameAlBuffer,
        elegirTickCamaraLenta,
        velocidadIntervalo,
        calcularTablaTiempos,
        construirClipReplay,
        evaluarProgresoReplay,
        interpolarFrameReplay,
        obtenerElegiblesSkip,
        esElegibleSkip,
        requeridosParaSkip,
        evaluarVotosSkip,
        filtrarGolesConReplay,
        formatearEtiquetaGol,
        navegarIndiceGol
    };

    global.RepeticionOnline = RepeticionOnline;
    if (typeof module !== 'undefined' && module.exports) module.exports = RepeticionOnline;
})(typeof globalThis !== 'undefined' ? globalThis : this);
