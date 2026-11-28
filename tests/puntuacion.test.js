const test = require('node:test');
const assert = require('node:assert/strict');

const Puntuacion = require('../js/online/puntuacion.js');
const Clubes = require('../js/online/clubes.js');

test('toques suman 2 puntos salvo primer toque de saque y toques muy seguidos', () => {
    const j1 = { id: 'p1', nombre: 'Facu', equipo: 'red' };
    const motor = Puntuacion.crearMotorPuntuacion([j1]);

    // Primer toque de saque no suma
    assert.equal(motor.registrarToque(j1, 10, { esPrimerToqueSaque: true }), null);

    // Toque valido fuera de cooldown suma 2 pts
    const t1 = motor.registrarToque(j1, 60);
    assert.deepEqual(t1, { tipo: 'toque', puntos: 2, jugadorId: 'p1' });

    // Toque muy seguido dentro del cooldown no suma
    assert.equal(motor.registrarToque(j1, 75), null);

    // Pasado el cooldown vuelve a sumar 2 pts
    const t2 = motor.registrarToque(j1, 120);
    assert.deepEqual(t2, { tipo: 'toque', puntos: 2, jugadorId: 'p1' });

    const res = motor.obtenerResumen();
    assert.equal(res.jugadores[0].puntos, 4);
    assert.equal(res.jugadores[0].toques, 2);
});

test('gol normal suma 100 pts, golazo con super tiro suma 200 pts y asistencia 50 pts', () => {
    const r1 = { id: 'r1', nombre: 'Goleador', equipo: 'red' };
    const r2 = { id: 'r2', nombre: 'Asistente', equipo: 'red' };
    const b1 = { id: 'b1', nombre: 'Arquero', equipo: 'blue' };
    const motor = Puntuacion.crearMotorPuntuacion([r1, r2, b1]);

    motor.registrarToque(r2, 100);
    motor.registrarToque(r1, 150);
    const evNormal = motor.registrarGol({
        equipoGol: 'red',
        autorJugador: r1,
        jugadoresSala: [r1, r2, b1],
        tickActual: 170,
        superTiro: false
    });

    assert.equal(evNormal.length, 2);
    assert.equal(evNormal[0].tipo, 'gol');
    assert.equal(evNormal[0].puntos, 100);
    assert.equal(evNormal[1].tipo, 'asistencia');
    assert.equal(evNormal[1].puntos, 50);

    // Golazo con potenciador de disparo
    motor.registrarToque(r1, 300, { superTiro: true });
    const evGolazo = motor.registrarGol({
        equipoGol: 'red',
        autorJugador: r1,
        jugadoresSala: [r1, r2, b1],
        tickActual: 315,
        superTiro: true
    });

    assert.equal(evGolazo.length, 1);
    assert.equal(evGolazo[0].tipo, 'golazo');
    assert.equal(evGolazo[0].puntos, 200);

    const resumen = motor.obtenerResumen();
    assert.equal(resumen.mvpId, 'r1');
    const regR1 = resumen.jugadores.find(j => j.id === 'r1');
    const regR2 = resumen.jugadores.find(j => j.id === 'r2');
    // r1: 2 toques (4) + gol (100) + golazo (200) = 304
    assert.equal(regR1.puntos, 304);
    assert.equal(regR1.goles, 2);
    assert.equal(regR1.golazos, 1);
    // r2: 1 toque (2) + asistencia (50) = 52
    assert.equal(regR2.puntos, 52);
    assert.equal(regR2.asistencias, 1);
});

test('detecta atajada (50), despeje (20) y tiro al arco (10)', () => {
    const campo = { left: 80, right: 760, goalTop: 140, goalBottom: 260 };
    const red = { id: 'r1', nombre: 'Delantero', equipo: 'red' };
    const blue = { id: 'b1', nombre: 'Defensor', equipo: 'blue' };
    const motor = Puntuacion.crearMotorPuntuacion([red, blue]);

    // Tiro al arco de red hacia arco derecho (760)
    const evTiro = motor.evaluarIntervencion({
        jugador: red,
        tickActual: 50,
        pelotaAntes: { x: 500, y: 200, vx: 1, vy: 0 },
        pelotaDespues: { x: 506, y: 200, vx: 6, vy: 0 },
        campo,
        fuePatada: true
    });
    assert.equal(evTiro.some(e => e.tipo === 'tiro' && e.puntos === 10), true);

    // Atajada de blue frente al arco derecho (pelota iba hacia x=760 y=200 y la desvia hacia la izquierda)
    const evAtajada = motor.evaluarIntervencion({
        jugador: blue,
        tickActual: 80,
        pelotaAntes: { x: 710, y: 200, vx: 6, vy: 0 },
        pelotaDespues: { x: 704, y: 200, vx: -5, vy: 1 },
        campo,
        fuePatada: true
    });
    assert.equal(evAtajada.some(e => e.tipo === 'atajada' && e.puntos === 50), true);

    // Despeje de blue desde zona defensiva (sin amenaza directa al arco)
    const evDespeje = motor.evaluarIntervencion({
        jugador: blue,
        tickActual: 180,
        pelotaAntes: { x: 680, y: 60, vx: 0.5, vy: 0.5 },
        pelotaDespues: { x: 672, y: 65, vx: -5.5, vy: -1 },
        campo,
        fuePatada: true
    });
    assert.equal(evDespeje.some(e => e.tipo === 'despeje' && e.puntos === 20), true);
});

const fs = require('node:fs');
const path = require('node:path');

test('catalogo de clubes incluye Nueva Chicago, escudos reales y estadios de clubes', () => {
    const chicago = Clubes.CLUBES.find(c => c.id === 'chicago');
    assert.ok(chicago);
    assert.equal(chicago.nombre, 'Nueva Chicago');
    const escudoSvg = Clubes.crearEscudoSvgDataUrl(chicago);
    assert.ok(escudoSvg.startsWith('data:image/svg+xml'));

    Clubes.CLUBES.forEach(club => {
        const url = Clubes.obtenerEscudoUrl(club);
        assert.equal(url, `/img/escudos/${club.id}.png`);
        const filePath = path.join(__dirname, '..', 'img', 'escudos', `${club.id}.png`);
        assert.equal(fs.existsSync(filePath), true, `Falta escudo real para ${club.id}`);
        assert.ok(fs.statSync(filePath).size > 1000, `Escudo vacío para ${club.id}`);
    });

    const argCount = Clubes.CLUBES.filter(c => c.liga === 'Argentina').length;
    const selCount = Clubes.CLUBES.filter(c => c.liga === 'Selecciones').length;
    assert.ok(argCount >= 16, 'Debe haber al menos 16 equipos argentinos');
    assert.ok(selCount >= 12, 'Debe haber al menos 12 selecciones');
    assert.equal(Clubes.CLUBES[0].id, 'boca');
    assert.equal(Clubes.CLUBES[1].id, 'river');

    const bombonera = Clubes.ESTADIOS_CLUBES.find(e => e.id === 'estadio_bombonera');
    assert.ok(bombonera);
    assert.equal(Clubes.TAMANOS_JUGADORES.length, 8);
    assert.equal(Clubes.TAMANOS_JUGADORES[7].id, '11v11');
});
