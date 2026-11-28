/**
 * camara.js
 *
 * Lógica pura de cámara, niveles de zoom y cálculo del rectángulo de vista
 * para el minimapa táctico estilo FIFA cuando la cancha supera la pantalla.
 */
(function (global) {
    const ANCHO_VISIBLE_ZOOM = {
        0: 960,
        1: Infinity,
        2: 1350,
        3: 1150,
        4: 960,
        5: 820,
        6: 680,
        7: 540
    };

    const NOMBRE_ZOOM = {
        0: 'Automático',
        1: 'Cancha entera',
        2: 'Zoom 2',
        3: 'Zoom 3',
        4: 'Zoom 4',
        5: 'Zoom 5',
        6: 'Zoom 6',
        7: 'Zoom 7 (máximo)'
    };

    const UMBRAL_MINIMAPA = 1.03;

    function zoomDe(mapa, zoomNivel = 0) {
        if (!mapa || !mapa.width) return 1;
        const nivel = Math.min(7, Math.max(0, Number(zoomNivel) || 0));
        const base = ANCHO_VISIBLE_ZOOM[nivel] === undefined ? ANCHO_VISIBLE_ZOOM[0] : ANCHO_VISIBLE_ZOOM[nivel];
        if (!Number.isFinite(base)) return 1;
        const ancho = base * (mapa.escala || 1);
        return Math.max(1, mapa.width / ancho);
    }

    function actualizarCamara(camaraActual, mapa, foco, zoomNivel = 0, delta = 16.67) {
        if (!mapa || !mapa.width || !mapa.height) return null;
        const objetivoZoom = zoomDe(mapa, zoomNivel);
        const punto = foco || { x: mapa.width / 2, y: mapa.height / 2 };
        let camara = camaraActual;
        if (!camara || camara.mapa !== mapa.id || camara.ancho !== mapa.width || camara.alto !== mapa.height) {
            camara = {
                x: punto.x,
                y: punto.y,
                zoom: objetivoZoom,
                mapa: mapa.id,
                ancho: mapa.width,
                alto: mapa.height
            };
        }
        const dt = Math.max(0, Number(delta) || 0);
        const suave = 1 - Math.exp(-dt / 90);
        const suaveZoom = 1 - Math.exp(-dt / 120);
        camara.zoom += (objetivoZoom - camara.zoom) * suaveZoom;
        camara.x += (punto.x - camara.x) * suave;
        camara.y += (punto.y - camara.y) * suave;

        const mitadAncho = mapa.width / (2 * camara.zoom);
        const mitadAlto = mapa.height / (2 * camara.zoom);
        camara.x = Math.min(mapa.width - mitadAncho, Math.max(mitadAncho, camara.x));
        camara.y = Math.min(mapa.height - mitadAlto, Math.max(mitadAlto, camara.y));
        return camara;
    }

    function debeMostrarMinimapa(camara) {
        return Boolean(camara && Number.isFinite(camara.zoom) && camara.zoom > UMBRAL_MINIMAPA);
    }

    function viewportMinimapa(mapa, camara) {
        if (!mapa || !camara || !camara.zoom) return null;
        const w = mapa.width / camara.zoom;
        const h = mapa.height / camara.zoom;
        return {
            x: Math.max(0, Math.min(mapa.width - w, camara.x - w / 2)),
            y: Math.max(0, Math.min(mapa.height - h, camara.y - h / 2)),
            w,
            h
        };
    }

    const CamaraOnline = {
        ANCHO_VISIBLE_ZOOM,
        NOMBRE_ZOOM,
        UMBRAL_MINIMAPA,
        zoomDe,
        actualizarCamara,
        debeMostrarMinimapa,
        viewportMinimapa
    };

    global.CamaraOnline = CamaraOnline;
    if (typeof module !== 'undefined' && module.exports) module.exports = CamaraOnline;
})(typeof globalThis !== 'undefined' ? globalThis : this);
