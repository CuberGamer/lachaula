/**
 * puntuacion.js
 *
 * Sistema de puntuaciones por partido y detección de jugadas clave:
 * - Gol: 100 puntos
 * - Gol con potenciador de disparo (Golazo): 200 puntos
 * - Atajada: 50 puntos
 * - Asistencia: 50 puntos
 * - Despeje / Bola clara: 20 puntos
 * - Tiro al arco: 10 puntos
 * - Toque de balón: 2 puntos (salvo primer toque o toques muy seguidos)
 *
 * También determina notificaciones en vivo y el MVP del partido.
 */
(function (global) {
    const PUNTOS = {
        GOL: 100,
        GOLAZO: 200,
        ATAJADA: 50,
        ASISTENCIA: 50,
        DESPEJE: 20,
        TIRO_AL_ARCO: 10,
        TOQUE: 2
    };

    const COOLDOWN_TOQUE_TICKS = 45; // ~750 ms a 60 Hz
    const VENTANA_ASISTENCIA_TICKS = 360; // 6 segundos
    const COOLDOWN_JUGADA_TICKS = 50; // Evita repetir atajada/tiro/despeje en rebotes seguidos

    function crearRegistroJugador(jugador) {
        return {
            id: jugador.id,
            nombre: jugador.nombre,
            equipo: jugador.equipo,
            puntos: 0,
            goles: 0,
            golazos: 0,
            asistencias: 0,
            atajadas: 0,
            despejes: 0,
            tiros: 0,
            toques: 0
        };
    }

    function crearMotorPuntuacion(jugadores = []) {
        const tabla = new Map();
        const ultimoToqueTick = new Map();
        const ultimaJugadaTick = new Map();
        const historialToques = []; // { jugadorId, equipo, tick, superTiro }

        jugadores.forEach(j => {
            if (j && (j.equipo === 'red' || j.equipo === 'blue')) {
                tabla.set(j.id, crearRegistroJugador(j));
            }
        });

        function asegurarJugador(jugador) {
            if (!jugador || !jugador.id) return null;
            let reg = tabla.get(jugador.id);
            if (!reg) {
                reg = crearRegistroJugador(jugador);
                tabla.set(jugador.id, reg);
            } else {
                reg.nombre = jugador.nombre || reg.nombre;
                if (jugador.equipo === 'red' || jugador.equipo === 'blue') {
                    reg.equipo = jugador.equipo;
                }
            }
            return reg;
        }

        function sumarPuntos(jugador, campo, pts) {
            const reg = asegurarJugador(jugador);
            if (!reg) return 0;
            reg.puntos += pts;
            if (campo && Object.prototype.hasOwnProperty.call(reg, campo)) {
                reg[campo] += 1;
            }
            return reg.puntos;
        }

        function registrarToque(jugador, tickActual, { esPrimerToqueSaque = false, superTiro = false } = {}) {
            if (!jugador || (jugador.equipo !== 'red' && jugador.equipo !== 'blue')) return null;
            asegurarJugador(jugador);

            const previoHistorial = historialToques[historialToques.length - 1];
            if (!previoHistorial || previoHistorial.jugadorId !== jugador.id || (tickActual - previoHistorial.tick) > 6 || superTiro) {
                historialToques.push({
                    jugadorId: jugador.id,
                    equipo: jugador.equipo,
                    tick: tickActual,
                    superTiro: !!superTiro
                });
                if (historialToques.length > 20) historialToques.shift();
            } else if (superTiro) {
                previoHistorial.superTiro = true;
            }

            if (esPrimerToqueSaque) {
                ultimoToqueTick.set(jugador.id, tickActual);
                return null;
            }

            const prevTick = ultimoToqueTick.get(jugador.id);
            if (prevTick !== undefined && (tickActual - prevTick) < COOLDOWN_TOQUE_TICKS) {
                return null;
            }
            ultimoToqueTick.set(jugador.id, tickActual);
            sumarPuntos(jugador, 'toques', PUNTOS.TOQUE);
            return { tipo: 'toque', puntos: PUNTOS.TOQUE, jugadorId: jugador.id };
        }

        function puedeRegistrarJugada(jugadorId, tipo, tickActual) {
            const clave = `${jugadorId}:${tipo}`;
            const prev = ultimaJugadaTick.get(clave);
            if (prev !== undefined && (tickActual - prev) < COOLDOWN_JUGADA_TICKS) return false;
            ultimaJugadaTick.set(clave, tickActual);
            return true;
        }

        /**
         * Evalúa si una pelota con posición (bx, by) y velocidad (bvx, bvy) va en
         * dirección hacia el arco indicado ('left' o 'right').
         */
        function vaHaciaArco(bx, by, bvx, bvy, arcoX, goalTop, goalBottom, ladoArco) {
            const haciaLado = ladoArco === 'left' ? bvx < -1.5 : bvx > 1.5;
            if (!haciaLado) return false;
            const dx = arcoX - bx;
            if (Math.abs(bvx) < 0.05) return false;
            const ticksHastaLinea = dx / bvx;
            if (ticksHastaLinea < 0 || ticksHastaLinea > 120) return false;
            const yProyectada = by + bvy * ticksHastaLinea;
            const margenPoste = 14;
            return yProyectada >= (goalTop - margenPoste) && yProyectada <= (goalBottom + margenPoste);
        }

        /**
         * Evalúa una intervención (patada o choque limpio contra la pelota) para detectar:
         * - Atajada (+50)
         * - Despeje / Bola clara (+20)
         * - Tiro al arco (+10)
         */
        function evaluarIntervencion({
            jugador,
            tickActual,
            pelotaAntes,
            pelotaDespues,
            campo,
            fuePatada = false,
            superTiro = false
        }) {
            const notificaciones = [];
            if (!jugador || (jugador.equipo !== 'red' && jugador.equipo !== 'blue')) return notificaciones;
            if (!campo || !pelotaAntes || !pelotaDespues) return notificaciones;

            const left = campo.left;
            const right = campo.right;
            const ancho = Math.max(1, right - left);
            const goalTop = campo.goalTop;
            const goalBottom = campo.goalBottom;

            const propioEsIzquierdo = jugador.equipo === 'red';
            const arcoPropioX = propioEsIzquierdo ? left : right;
            const arcoRivalX = propioEsIzquierdo ? right : left;
            const ladoPropio = propioEsIzquierdo ? 'left' : 'right';
            const ladoRival = propioEsIzquierdo ? 'right' : 'left';

            const ibaAlArcoPropio = vaHaciaArco(
                pelotaAntes.x, pelotaAntes.y, pelotaAntes.vx, pelotaAntes.vy,
                arcoPropioX, goalTop, goalBottom, ladoPropio
            );
            const sigueAlArcoPropio = vaHaciaArco(
                pelotaDespues.x, pelotaDespues.y, pelotaDespues.vx, pelotaDespues.vy,
                arcoPropioX, goalTop, goalBottom, ladoPropio
            );

            const distAlArcoPropio = Math.abs(pelotaAntes.x - arcoPropioX);
            const enZonaDefensiva = distAlArcoPropio <= ancho * 0.32;
            const velocidadAntes = Math.hypot(pelotaAntes.vx, pelotaAntes.vy);
            const velocidadDespues = Math.hypot(pelotaDespues.vx, pelotaDespues.vy);

            // 1. Atajada: interceptó un remate que iba al arco propio y evitó que siga hacia ese arco
            if (ibaAlArcoPropio && !sigueAlArcoPropio && velocidadAntes >= 2.2 && distAlArcoPropio <= ancho * 0.42) {
                if (puedeRegistrarJugada(jugador.id, 'atajada', tickActual)) {
                    sumarPuntos(jugador, 'atajadas', PUNTOS.ATAJADA);
                    notificaciones.push({
                        tipo: 'atajada',
                        titulo: '¡ATAJADA!',
                        jugadorId: jugador.id,
                        jugador: jugador.nombre,
                        equipo: jugador.equipo,
                        puntos: PUNTOS.ATAJADA
                    });
                }
            } else if (enZonaDefensiva && fuePatada && velocidadDespues >= 3.5) {
                // 2. Despeje / Bola clara: rechazo fuerte desde zona propia hacia afuera
                const saleDeZona = propioEsIzquierdo ? pelotaDespues.vx > 2.2 : pelotaDespues.vx < -2.2;
                if (saleDeZona && puedeRegistrarJugada(jugador.id, 'despeje', tickActual)) {
                    sumarPuntos(jugador, 'despejes', PUNTOS.DESPEJE);
                    notificaciones.push({
                        tipo: 'despeje',
                        titulo: 'DESPEJE',
                        jugadorId: jugador.id,
                        jugador: jugador.nombre,
                        equipo: jugador.equipo,
                        puntos: PUNTOS.DESPEJE
                    });
                }
            }

            // 3. Tiro al arco: patada o remate potente dirigido entre los postes del arco rival
            const vaAlArcoRival = vaHaciaArco(
                pelotaDespues.x, pelotaDespues.y, pelotaDespues.vx, pelotaDespues.vy,
                arcoRivalX, goalTop, goalBottom, ladoRival
            );
            const minVelTiro = fuePatada ? 3.5 : 5.2;
            if (vaAlArcoRival && velocidadDespues >= minVelTiro && (fuePatada || superTiro)) {
                if (puedeRegistrarJugada(jugador.id, 'tiro', tickActual)) {
                    sumarPuntos(jugador, 'tiros', PUNTOS.TIRO_AL_ARCO);
                    notificaciones.push({
                        tipo: 'tiro',
                        titulo: 'TIRO AL ARCO',
                        jugadorId: jugador.id,
                        jugador: jugador.nombre,
                        equipo: jugador.equipo,
                        puntos: PUNTOS.TIRO_AL_ARCO
                    });
                }
            }

            return notificaciones;
        }

        function registrarGol({ equipoGol, autorJugador, jugadoresSala = [], tickActual = 0, superTiro = false }) {
            const notificaciones = [];
            const enContra = !!(autorJugador && autorJugador.equipo !== equipoGol);

            if (autorJugador && !enContra) {
                const esGolazo = !!superTiro;
                const ptsGol = esGolazo ? PUNTOS.GOLAZO : PUNTOS.GOL;
                sumarPuntos(autorJugador, esGolazo ? 'golazos' : 'goles', ptsGol);
                if (esGolazo) {
                    // También contabiliza en goles totales
                    const reg = asegurarJugador(autorJugador);
                    if (reg) reg.goles += 1;
                }
                notificaciones.push({
                    tipo: esGolazo ? 'golazo' : 'gol',
                    titulo: esGolazo ? '¡GOLAZO!' : '¡GOL!',
                    jugadorId: autorJugador.id,
                    jugador: autorJugador.nombre,
                    equipo: equipoGol,
                    puntos: ptsGol
                });

                // Buscar asistencia: último compañero distinto que tocó antes del autor dentro de la ventana
                for (let i = historialToques.length - 1; i >= 0; i -= 1) {
                    const t = historialToques[i];
                    if ((tickActual - t.tick) > VENTANA_ASISTENCIA_TICKS) break;
                    if (t.jugadorId === autorJugador.id) continue;
                    if (t.equipo !== equipoGol) break; // Un rival tocó en el medio
                    const asistente = jugadoresSala.find(j => j.id === t.jugadorId) || { id: t.jugadorId, nombre: 'Jugador', equipo: equipoGol };
                    sumarPuntos(asistente, 'asistencias', PUNTOS.ASISTENCIA);
                    notificaciones.push({
                        tipo: 'asistencia',
                        titulo: 'ASISTENCIA',
                        jugadorId: asistente.id,
                        jugador: asistente.nombre,
                        equipo: equipoGol,
                        puntos: PUNTOS.ASISTENCIA
                    });
                    break;
                }
            }

            historialToques.length = 0;
            return notificaciones;
        }

        function limpiarHistorialSaque() {
            historialToques.length = 0;
        }

        function obtenerResumen(jugadoresActuales = []) {
            jugadoresActuales.forEach(j => {
                if (j && (j.equipo === 'red' || j.equipo === 'blue')) asegurarJugador(j);
            });
            const lista = Array.from(tabla.values())
                .map(r => ({ ...r }))
                .sort((a, b) => {
                    if (b.puntos !== a.puntos) return b.puntos - a.puntos;
                    if (b.goles !== a.goles) return b.goles - a.goles;
                    if (b.asistencias !== a.asistencias) return b.asistencias - a.asistencias;
                    if (b.atajadas !== a.atajadas) return b.atajadas - a.atajadas;
                    return a.nombre.localeCompare(b.nombre);
                });

            const mvp = lista.length && lista[0].puntos > 0 ? lista[0] : (lista[0] || null);
            return {
                mvpId: mvp ? mvp.id : null,
                mvpNombre: mvp ? mvp.nombre : null,
                mvpPuntos: mvp ? mvp.puntos : 0,
                jugadores: lista
            };
        }

        return {
            registrarToque,
            evaluarIntervencion,
            registrarGol,
            limpiarHistorialSaque,
            obtenerResumen,
            sumarPuntos
        };
    }

    const PuntuacionPartido = {
        PUNTOS,
        COOLDOWN_TOQUE_TICKS,
        VENTANA_ASISTENCIA_TICKS,
        crearMotorPuntuacion
    };

    global.PuntuacionPartido = PuntuacionPartido;
    if (typeof module !== 'undefined' && module.exports) module.exports = PuntuacionPartido;
})(typeof globalThis !== 'undefined' ? globalThis : this);
