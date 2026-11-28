const test = require('node:test');
const assert = require('node:assert/strict');
const Repeticion = require('../js/online/repeticion.js');

function crearBufferPrueba(totalTicks = 240) {
    const buffer = [];
    for (let t = 1; t <= totalTicks; t += 1) {
        Repeticion.agregarFrameAlBuffer(buffer, {
            tick: t,
            b: [100 + t * 2, 200, 8, 2, 0],
            u: [],
            i: null,
            j: [
                ['p1', 80 + t * 1.5, 200, 16, t === 180 ? 1 : 0, ''],
                ['p2', 400, 200, 16, 0, '']
            ]
        });
    }
    return buffer;
}

test('elegirTickCamaraLenta prioriza la ultima patada del autor del gol cerca del toque final', () => {
    const tick = Repeticion.elegirTickCamaraLenta({
        tickGol: 200,
        ultimaPatadaTick: 182,
        ultimoToqueTick: 185,
        primerTickBuffer: 1
    });
    assert.equal(tick, 182);

    // Si pateó mucho antes y luego condujo la pelota hasta el gol, usa el último toque
    const tickConduccion = Repeticion.elegirTickCamaraLenta({
        tickGol: 200,
        ultimaPatadaTick: 100,
        ultimoToqueTick: 192,
        primerTickBuffer: 1
    });
    assert.equal(tickConduccion, 192);
});

test('construirClipReplay y evaluarProgresoReplay activan camara lenta en la patada del autor y suavizan frames', () => {
    const buffer = crearBufferPrueba(240);
    const clip = Repeticion.construirClipReplay({
        buffer,
        tickGol: 200,
        ultimaPatadaTick: 180,
        ultimoToqueTick: 180,
        ultimoGol: { equipo: 'red', autor: 'Facu', enContra: false, golazo: false },
        jugadores: [
            { id: 'p1', nombre: 'Facu', equipo: 'red', avatar: '10' },
            { id: 'p2', nombre: 'Rival', equipo: 'blue', avatar: '1' }
        ]
    });

    assert.ok(clip, 'Debe construir clip');
    assert.ok(clip.frames.length > 100);
    assert.equal(clip.frames[clip.kickIdx].tick, 180);
    assert.equal(clip.frames[clip.goalIdx].tick, 200);
    assert.ok(clip.slowStartIdx <= clip.kickIdx && clip.slowEndIdx > clip.kickIdx);

    // Antes de la patada: velocidad normal 1.0 y fuera de cámara lenta
    const antesMs = clip.tiemposMs[Math.max(0, clip.slowStartIdx - 10)];
    const progAntes = Repeticion.evaluarProgresoReplay(clip, antesMs);
    assert.equal(progAntes.enCamaraLenta, false);
    assert.equal(progAntes.velocidad, 1);

    // En la patada del autor: cámara lenta activa (0.25x)
    const enPatadaMs = clip.tiemposMs[clip.kickIdx + 2];
    const progPatada = Repeticion.evaluarProgresoReplay(clip, enPatadaMs);
    assert.equal(progPatada.enCamaraLenta, true);
    assert.ok(progPatada.velocidad <= 0.3, `velocidad esperada <= 0.3, fue ${progPatada.velocidad}`);

    // Interpolación entre cuadros produce posición intermedia exacta
    const medioMs = (clip.tiemposMs[10] + clip.tiemposMs[11]) / 2;
    const progMedio = Repeticion.evaluarProgresoReplay(clip, medioMs);
    const interp = Repeticion.interpolarFrameReplay(clip.frames, progMedio);
    const esperadoX = (clip.frames[10].b[0] + clip.frames[11].b[0]) / 2;
    assert.ok(Math.abs(interp.b[0] - esperadoX) < 0.01);

    // Al finalizar duración total marca terminado
    const progFin = Repeticion.evaluarProgresoReplay(clip, clip.duracionMs + 50);
    assert.equal(progFin.terminado, true);
});

test('evaluarVotosSkip requiere estrictamente mas de la mitad de los jugadores conectados', () => {
    assert.equal(Repeticion.requeridosParaSkip(1), 1);
    assert.equal(Repeticion.requeridosParaSkip(2), 2);
    assert.equal(Repeticion.requeridosParaSkip(3), 2);
    assert.equal(Repeticion.requeridosParaSkip(4), 3);
    assert.equal(Repeticion.requeridosParaSkip(5), 3);
    assert.equal(Repeticion.requeridosParaSkip(6), 4);

    const jugadores = [
        { id: 'a', equipo: 'red', desconectado: null },
        { id: 'b', equipo: 'blue', desconectado: null },
        { id: 'c', equipo: 'red', desconectado: null },
        { id: 'spec', equipo: null, desconectado: null } // espectador no cuenta si hay jugadores en cancha
    ];

    const votos = new Set(['a']);
    let res = Repeticion.evaluarVotosSkip(jugadores, votos);
    assert.equal(res.total, 3);
    assert.equal(res.requeridos, 2);
    assert.equal(res.votos, 1);
    assert.equal(res.aprobado, false);

    // Voto duplicado o de espectador no cambia el conteo
    votos.add('a');
    votos.add('spec');
    res = Repeticion.evaluarVotosSkip(jugadores, votos);
    assert.equal(res.votos, 1);
    assert.equal(res.aprobado, false);

    // Segundo jugador vota -> 2/3 (> 50%) -> aprobado
    votos.add('b');
    res = Repeticion.evaluarVotosSkip(jugadores, votos);
    assert.equal(res.votos, 2);
    assert.equal(res.aprobado, true);
});
