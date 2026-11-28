/**
 * cliente.js (online)
 *
 * Toda la experiencia online en una sola página (como HaxBall), así la
 * conexión con el servidor no se corta al pasar de la lista de salas al
 * partido:
 *   1. Lista de salas: elegir nombre, crear sala o entrar a una.
 *   2. Sala: panel con Rojo / Espectadores / Azul. El admin arrastra (o usa
 *      las flechas) para elegir de qué lado juega cada uno, cambia la cancha
 *      y las reglas, y arranca el partido.
 *   3. Partido: el navegador manda las teclas y dibuja lo que manda el
 *      servidor, interpolando entre fotos para que se vea fluido.
 */
(function () {
    // Primero WebSocket (lo más rápido). Si un proxy en el medio no lo deja pasar
    // (pasa entrando por chaula.et20.edu.ar), tryAllTransports pasa a polling
    // en vez de reintentar WebSocket para siempre sin conectar nunca.
    const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
    const $ = id => document.getElementById(id);

    const CLAVE_NOMBRE = 'lachaula_nombre';
    const CLAVE_AVATAR = 'lachaula_avatar';
    const CLAVE_ZOOM = 'lachaula_zoom';
    const CLAVE_EXTRAPOLACION = 'lachaula_extrapolacion';
    const MS_TICK = 1000 / 60;

    /*
     * Zoom y cámara (ver camara.js): 0 = automático (canchas chicas enteras,
     * canchas grandes 4v4+ siguen a tu jugador con minimapa estilo FIFA).
     */
    const NOMBRE_ZOOM = window.CamaraOnline ? window.CamaraOnline.NOMBRE_ZOOM : {
        0: 'Automático', 1: 'Cancha entera', 2: 'Zoom 2', 3: 'Zoom 3',
        4: 'Zoom 4', 5: 'Zoom 5', 6: 'Zoom 6', 7: 'Zoom 7 (máximo)'
    };
    // Extrapolación como en HaxBall: de 0 a 200 ms.
    const MAX_EXTRAPOLACION = 200;

    function leerNumeroGuardado(clave, porDefecto, minimo, maximo) {
        const valor = Number(localStorage.getItem(clave));
        if (localStorage.getItem(clave) === null || !Number.isFinite(valor)) return porDefecto;
        return Math.min(maximo, Math.max(minimo, Math.round(valor)));
    }
    const BITS_TECLA = {
        ArrowUp: 1, KeyW: 1,
        ArrowDown: 2, KeyS: 2,
        ArrowLeft: 4, KeyA: 4,
        ArrowRight: 8, KeyD: 8,
        Space: 16, KeyX: 16
    };
    const NOMBRE_EQUIPO = { red: 'Rojo', blue: 'Azul' };

    const PRESETS_AVATAR = ['1', '7', '9', '10', '11', '⚽', '🔥', '👑', '⚡', '🦁'];
    const TIPOS_POWERUP = [
        { id: 'SUPER_KICK', btnId: 'puBtnSuperKick' },
        { id: 'BIG', btnId: 'puBtnBig' },
        { id: 'SPEED', btnId: 'puBtnSpeed' }
    ];

    const estado = {
        salaId: null,
        tuId: null,
        token: null,
        sala: null,
        teclas: new Set(),
        bits: 0,
        panelVisible: true,
        tabActiva: 'sala',
        cartelTimeout: null,
        estadiosClubes: [],
        mapasBase: [],
        mapasHbs: [],
        mapasCustom: [],
        mapas: [],
        categoriaFiltro: 'Todos',
        busquedaMapa: '',
        archivoHbsNombre: '',
        clubObjetivoEquipo: 'red',
        clubLigaFiltro: 'Todas',
        clubBusqueda: '',
        ultimoDibujo: null,
        ultimoPreviewClave: '',
        ultimoPreviewMapaId: '',
        ruletaAnimacion: null,
        ultimoCanchaIdleClave: '',
        zoomNivel: 0,
        extrapolacion: 0,
        camara: null,
        avisoAjuste: null,
        enGameover: false,
        replay: null,
        specReplay: {
            abierto: false,
            replegado: false,
            pausado: false,
            resultadoClave: '',
            goles: [],
            indice: 0,
            elapsedMs: 0,
            enCamaraLenta: false,
            camara: null,
            clips: new Map(),
            cargandoIndice: null,
            idleClave: ''
        }
    };
    estado.zoomNivel = leerNumeroGuardado(CLAVE_ZOOM, 0, 0, 7);
    estado.extrapolacion = leerNumeroGuardado(CLAVE_EXTRAPOLACION, 0, 0, MAX_EXTRAPOLACION);

    // Fotos del servidor ordenadas por tick y predicción de tu jugador (ver red.js).
    const linea = RedOnline.crearLinea();
    const prediccion = RedOnline.crearPrediccion(FisicaHaxball);

    const canvas = $('cancha');
    const dibujante = DibujoOnline.crearDibujante(canvas);
    const specReplayCanvas = $('specReplayCanvas');
    const dibujanteSpecReplay = specReplayCanvas ? DibujoOnline.crearDibujante(specReplayCanvas) : null;
    const preview = $('previewMapa');
    const dibujantePreview = DibujoOnline.crearDibujante(preview);
    const previewPrev = $('previewMapaPrev');
    const dibujantePreviewPrev = previewPrev ? DibujoOnline.crearDibujante(previewPrev) : null;
    const previewNext = $('previewMapaNext');
    const dibujantePreviewNext = previewNext ? DibujoOnline.crearDibujante(previewNext) : null;

    /* ========================= */
    /* UTILIDADES                */
    /* ========================= */

    function sinTildesMayus(texto) {
        return String(texto || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();
    }

    function actualizarEstadoBody() {
        document.body.dataset.replay = estado.replay ? '1' : '0';
        document.body.dataset.slowmo = (estado.replay && estado.replay.enCamaraLenta) ? '1' : '0';
        if (!estado.salaId) {
            document.body.dataset.state = 'lobby';
            return;
        }
        if (estado.replay && estado.replay.esHighlightPostPartido) {
            document.body.dataset.state = 'replay';
            return;
        }
        if (estado.enGameover) {
            document.body.dataset.state = 'gameover';
            return;
        }
        if (estado.sala && estado.sala.partido) {
            document.body.dataset.state = (estado.panelVisible || estado.sala.partido.pausado) ? 'paused' : 'playing';
            return;
        }
        document.body.dataset.state = 'lobby';
    }

    function mostrarAviso(elemento, texto, duracionMs = 4000) {
        if (!elemento) return;
        elemento.textContent = texto || '';
        clearTimeout(elemento._timeout);
        if (texto && duracionMs) elemento._timeout = setTimeout(() => { elemento.textContent = ''; }, duracionMs);
    }

    function avisoActual(texto) {
        mostrarAviso(estado.salaId ? $('avisoSala') : $('avisoSalas'), texto);
    }

    function pedir(evento, datos = {}) {
        return new Promise(resolve => socket.emit(evento, datos, respuesta => resolve(respuesta || {})));
    }

    async function accion(evento, datos) {
        const respuesta = await pedir(evento, datos);
        if (respuesta.error) avisoActual(respuesta.error);
        return respuesta;
    }

    /* ========================= */
    /* AVATAR (número / emoji)   */
    /* ========================= */

    // Hasta 2 caracteres; un emoji compuesto cuenta como uno. El servidor vuelve a validar.
    function recortarAvatar(valor) {
        const texto = String(valor || '').replace(/\s/g, '');
        const partes = window.Intl && Intl.Segmenter
            ? Array.from(new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(texto), parte => parte.segment)
            : Array.from(texto);
        return partes.slice(0, 2).join('');
    }

    function avatarGuardado() {
        return recortarAvatar(localStorage.getItem(CLAVE_AVATAR) || '');
    }

    function guardarAvatar(valor) {
        const avatar = recortarAvatar(valor);
        localStorage.setItem(CLAVE_AVATAR, avatar);
        if ($('avatarJugador')) $('avatarJugador').value = avatar;
        if ($('avatarSala')) $('avatarSala').value = avatar;
        actualizarPreviewAvatar();
        return avatar;
    }

    function numeroAutomaticoPropio() {
        if (!estado.sala) return '1';
        const yo = estado.sala.jugadores.find(j => j.id === estado.tuId);
        if (!yo || !yo.equipo) return '1';
        const miembros = estado.sala.jugadores.filter(j => j.equipo === yo.equipo);
        const idx = miembros.findIndex(j => j.id === estado.tuId);
        return String(idx >= 0 ? idx + 1 : 1);
    }

    function estiloCamisetaClub(club) {
        if (!club) return '#fbbf24';
        const p = club.primario || '#1e3a8a';
        const s = club.secundario || '#facc15';
        switch (club.patron) {
        case 'bastones':
            return `repeating-linear-gradient(90deg, ${p} 0 18%, ${s} 18% 36%)`;
        case 'franja-horizontal':
            return `linear-gradient(180deg, ${p} 0% 34%, ${s} 34% 66%, ${p} 66% 100%)`;
        case 'franja-vertical':
            return `linear-gradient(90deg, ${p} 0% 35%, ${s} 35% 65%, ${p} 65% 100%)`;
        case 'banda-diagonal':
            return `linear-gradient(135deg, ${p} 0% 38%, ${s} 38% 62%, ${p} 62% 100%)`;
        case 'aros-horizontales':
            return `repeating-linear-gradient(180deg, ${p} 0 22%, ${s} 22% 44%)`;
        case 'cuello':
            return `radial-gradient(circle at 50% 6%, ${s} 0% 24%, ${p} 25% 100%)`;
        default:
            return p;
        }
    }

    function actualizarPreviewAvatar() {
        const mainText = $('avatarMainText');
        const mainCircle = $('avatarMainCircle');
        const prevBadge = $('avatarPrevBadge');
        const nextBadge = $('avatarNextBadge');
        const jerseyLabel = $('avatarJerseyLabel');
        if (!mainText || !mainCircle) return;

        const actual = recortarAvatar($('avatarSala') ? $('avatarSala').value : avatarGuardado());
        mainText.textContent = actual || numeroAutomaticoPropio();

        const idx = PRESETS_AVATAR.indexOf(actual || mainText.textContent);
        const baseIdx = idx >= 0 ? idx : 0;
        const prevVal = PRESETS_AVATAR[(baseIdx - 1 + PRESETS_AVATAR.length) % PRESETS_AVATAR.length];
        const nextVal = PRESETS_AVATAR[(baseIdx + 1) % PRESETS_AVATAR.length];
        if (prevBadge) prevBadge.textContent = prevVal;
        if (nextBadge) nextBadge.textContent = nextVal;

        const yo = estado.sala && estado.sala.jugadores.find(j => j.id === estado.tuId);
        const clubesCfg = (estado.sala && estado.sala.config && estado.sala.config.clubes) || { red: 'boca', blue: 'river' };
        const enPractica = !!(estado.sala && estado.sala.partido && estado.sala.partido.practica);
        const equipoEfectivo = (yo && (yo.equipo === 'red' || yo.equipo === 'blue')) ? yo.equipo : 'red';
        const clubId = clubesCfg[equipoEfectivo] || 'boca';
        const club = enPractica && window.ClubesLaChaula && window.ClubesLaChaula.CAMISETA_PRACTICA
            ? window.ClubesLaChaula.CAMISETA_PRACTICA
            : (clubId && window.ClubesLaChaula ? window.ClubesLaChaula.obtenerClub(clubId) : null);
        if (club) {
            const esBlanca = club.id === 'practica' || club.texto === '#0f172a' && club.primario === '#ffffff';
            const colorTxt = esBlanca ? '#0f172a' : '#ffffff';
            mainCircle.style.background = estiloCamisetaClub(club);
            mainCircle.style.color = colorTxt;
            mainText.style.color = colorTxt;
            mainCircle.classList.toggle('preset-circle--light', esBlanca);
            mainCircle.style.borderColor = esBlanca ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.16)';
            if (jerseyLabel) {
                const rolTxt = (!enPractica && (!yo || !yo.equipo)) ? ' (vista previa) · ' : '';
                jerseyLabel.textContent = `Camiseta${rolTxt}: ${club.nombre}`;
            }
        } else {
            mainCircle.style.background = '#ec4899';
            mainCircle.style.color = '#ffffff';
            mainText.style.color = '#ffffff';
            mainCircle.classList.remove('preset-circle--light');
            mainCircle.style.borderColor = 'rgba(255,255,255,0.16)';
            if (jerseyLabel) jerseyLabel.textContent = 'Camiseta del equipo';
        }
    }

    function ciclarPresetAvatar(paso) {
        const actual = recortarAvatar($('avatarSala') ? $('avatarSala').value : avatarGuardado()) || numeroAutomaticoPropio();
        const idx = PRESETS_AVATAR.indexOf(actual);
        const base = idx === -1 ? (paso > 0 ? -1 : 0) : idx;
        const nuevo = PRESETS_AVATAR[(base + paso + PRESETS_AVATAR.length) % PRESETS_AVATAR.length];
        cambiarAvatar(nuevo);
    }

    async function cambiarAvatar(valor) {
        const avatar = guardarAvatar(valor);
        if (!estado.salaId) return;
        const respuesta = await accion('sala:avatar', { avatar });
        if (respuesta && respuesta.ok) {
            mostrarAviso($('avisoSala'), avatar ? `Tu dorsal/avatar ahora es "${avatar}".` : 'Sacaste tu avatar: se ve tu número.', 2500);
        }
    }

    function nombreGuardado() {
        return (localStorage.getItem(CLAVE_NOMBRE) || '').trim();
    }

    function leerNombre() {
        const nombre = $('nombreJugador').value.trim();
        if (!nombre) {
            mostrarAviso($('avisoSalas'), 'Primero escribí tu nombre de jugador.');
            $('nombreJugador').focus();
            return null;
        }
        localStorage.setItem(CLAVE_NOMBRE, nombre);
        return nombre;
    }

    function claveToken(salaId) {
        return `lachaula_token_${salaId}`;
    }

    function formatearTiempo(ms, haciaArriba = false) {
        const seg = haciaArriba ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
        const total = Math.max(0, seg);
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }

    function crearElemento(tag, clase, texto) {
        const elemento = document.createElement(tag);
        if (clase) elemento.className = clase;
        if (texto !== undefined) elemento.textContent = texto;
        return elemento;
    }

    function soyAdmin() {
        const yo = estado.sala && estado.sala.jugadores.find(jugador => jugador.id === estado.tuId);
        return !!(yo && yo.admin);
    }

    /* ========================= */
    /* CONEXIÓN                  */
    /* ========================= */

    function actualizarConexion(texto, clase) {
        const etiqueta = $('estadoConexion');
        etiqueta.textContent = texto;
        etiqueta.className = `online-conexion ${clase || ''}`;
    }

    socket.on('connect', async () => {
        actualizarConexion('● Conectado', 'online-conexion--ok');
        if (estado.salaId && estado.token) {
            // Se cortó y volvió: recupera su lugar en la sala.
            const respuesta = await pedir('sala:unirse', { salaId: estado.salaId, token: estado.token });
            if (respuesta.ok) entrarASala(respuesta);
            else volverALista(respuesta.error || 'Se perdió la conexión con la sala.');
            return;
        }
        pedirSalas();
        const params = new URLSearchParams(window.location.search);
        if (params.get('sala')) {
            intentarEntrarPorLink();
        } else if (params.get('autostart') === '1' && !estado.salaId) {
            const nombreAuto = nombreGuardado() || 'Jugador 1';
            $('nombreJugador').value = nombreAuto;
            const resp = await accion('sala:crear', {
                nombreJugador: nombreAuto,
                avatar: avatarGuardado(),
                nombre: `Sala de ${nombreAuto}`,
                clave: '',
                maxJugadores: 0
            });
            if (resp.ok) entrarASala(resp);
        }
    });

    socket.on('disconnect', () => actualizarConexion('● Sin conexión, reintentando…', 'online-conexion--mal'));

    setInterval(() => {
        if (!socket.connected) return;
        const inicio = performance.now();
        socket.emit('ping', {}, () => {
            actualizarConexion(`● ${Math.round(performance.now() - inicio)} ms`, 'online-conexion--ok');
        });
    }, 2000);

    /* ========================= */
    /* LISTA DE SALAS            */
    /* ========================= */

    async function pedirSalas() {
        const respuesta = await pedir('salas:pedir');
        if (respuesta.salas) dibujarSalas(respuesta.salas);
    }

    function dibujarSalas(salas) {
        const cuerpo = $('listaSalas');
        cuerpo.textContent = '';
        if (!salas.length) {
            const fila = crearElemento('tr');
            const celda = crearElemento('td', 'online-vacio', 'No hay salas abiertas. ¡Creá una!');
            celda.colSpan = 5;
            fila.appendChild(celda);
            cuerpo.appendChild(fila);
            return;
        }
        salas.forEach(sala => {
            const fila = crearElemento('tr', 'online-fila-sala');
            fila.append(
                crearElemento('td', '', `${sala.conClave ? '🔒 ' : ''}${sala.nombre}`),
                crearElemento('td', '', sala.sinLimite ? `${sala.jugadores}/∞` : `${sala.jugadores}/${sala.maxJugadores}`),
                crearElemento('td', '', sala.mapa),
                crearElemento('td', sala.enJuego ? 'online-estado--juego' : '', sala.enJuego ? 'Jugando' : 'Esperando')
            );
            const celdaBoton = crearElemento('td');
            const boton = crearElemento('button', 'ssf-button online-mini', 'Entrar');
            boton.type = 'button';
            boton.disabled = sala.jugadores >= sala.maxJugadores;
            boton.addEventListener('click', () => unirse(sala.id, sala.conClave));
            celdaBoton.appendChild(boton);
            fila.appendChild(celdaBoton);
            cuerpo.appendChild(fila);
        });
    }

    socket.on('salas:lista', dibujarSalas);

    function pedirClave() {
        const dialogo = $('dialogoClave');
        $('claveIngreso').value = '';
        dialogo.returnValue = '';
        dialogo.showModal();
        $('claveIngreso').focus();
        return new Promise(resolve => {
            dialogo.addEventListener('close', () => resolve(dialogo.returnValue === 'entrar' ? $('claveIngreso').value : null), { once: true });
        });
    }

    async function unirse(salaId, conClave = false) {
        const nombreJugador = leerNombre();
        if (!nombreJugador) return;
        let clave = '';
        if (conClave) {
            clave = await pedirClave();
            if (clave === null) return;
        }
        const token = sessionStorage.getItem(claveToken(salaId)) || undefined;
        let respuesta = await pedir('sala:unirse', { salaId, nombreJugador, clave, token, avatar: avatarGuardado() });
        if (respuesta.pideClave && !conClave) {
            clave = await pedirClave();
            if (clave === null) return;
            respuesta = await pedir('sala:unirse', { salaId, nombreJugador, clave, avatar: avatarGuardado() });
        }
        if (respuesta.error) {
            mostrarAviso($('avisoSalas'), respuesta.error);
            return;
        }
        entrarASala(respuesta);
    }

    async function intentarEntrarPorLink() {
        const salaId = new URLSearchParams(window.location.search).get('sala');
        if (!salaId || estado.salaId) return;
        const token = sessionStorage.getItem(claveToken(salaId.toUpperCase()));
        if (token) {
            const respuesta = await pedir('sala:unirse', { salaId, token });
            if (respuesta.ok) {
                entrarASala(respuesta);
                return;
            }
        }
        if (!nombreGuardado()) {
            mostrarAviso($('avisoSalas'), `Te invitaron a la sala ${salaId}: escribí tu nombre y tocá "Entrar".`, 0);
            $('codigoSala').value = salaId;
            $('nombreJugador').focus();
            return;
        }
        unirse(salaId);
    }

    $('formCrear').addEventListener('submit', async evento => {
        evento.preventDefault();
        const nombreJugador = leerNombre();
        if (!nombreJugador) return;
        const respuesta = await accion('sala:crear', {
            nombreJugador,
            avatar: avatarGuardado(),
            nombre: $('nombreSala').value,
            clave: $('claveSala').value,
            maxJugadores: Number($('maxJugadores').value)
        });
        if (respuesta.ok) entrarASala(respuesta);
    });

    $('formCodigo').addEventListener('submit', evento => {
        evento.preventDefault();
        const codigo = $('codigoSala').value.trim();
        if (codigo) unirse(codigo.toUpperCase());
    });

    $('actualizarSalas').addEventListener('click', pedirSalas);
    $('volverMenu').addEventListener('click', () => { window.location.href = 'menu.html'; });

    /* ========================= */
    /* PESTAÑAS DEL PANEL        */
    /* ========================= */

    function cambiarTab(tab) {
        const validas = ['estadios', 'sala', 'config'];
        const destino = validas.includes(tab) ? tab : 'sala';
        estado.tabActiva = destino;

        const mapaTabs = {
            estadios: { pane: $('tabEstadios'), btn: $('navTabEstadios') },
            sala: { pane: $('tabSala'), btn: $('navTabSala') },
            config: { pane: $('tabConfig'), btn: $('navTabConfig') }
        };

        validas.forEach(clave => {
            const { pane, btn } = mapaTabs[clave];
            const activo = clave === destino;
            if (pane) {
                pane.hidden = !activo;
                if (activo) {
                    pane.classList.remove('online-tabpane--animar');
                    void pane.offsetWidth;
                    pane.classList.add('online-tabpane--animar');
                }
            }
            if (btn) {
                btn.classList.toggle('dock-tab--activo', activo);
                btn.setAttribute('aria-selected', String(activo));
            }
        });

        if (destino === 'estadios') {
            dibujarPreview(true);
        }
        if (destino === 'config') {
            actualizarPreviewAvatar();
        }
    }

    ['navTabEstadios', 'navTabSala', 'navTabConfig'].forEach(id => {
        const btn = $(id);
        if (!btn) return;
        btn.addEventListener('click', () => cambiarTab(btn.dataset.tab));
    });

    /* ========================= */
    /* ENTRAR / SALIR DE LA SALA */
    /* ========================= */

    function entrarASala(respuesta) {
        estado.salaId = respuesta.salaId;
        estado.tuId = respuesta.tuId;
        estado.token = respuesta.token;
        estado.enGameover = false;
        if ($('avatarSala')) $('avatarSala').value = avatarGuardado();
        reiniciarRed();
        if (Array.isArray(respuesta.estadiosClubes)) {
            estado.estadiosClubes = respuesta.estadiosClubes;
        }
        if (respuesta.mapas) estado.mapasBase = respuesta.mapas;
        if (Array.isArray(respuesta.mapasCustom)) estado.mapasCustom = respuesta.mapasCustom;
        reconstruirMapas();
        sessionStorage.setItem(claveToken(respuesta.salaId), respuesta.token);
        history.replaceState(null, '', `?sala=${respuesta.salaId}`);
        $('vistaSalas').hidden = true;
        $('vistaSala').hidden = false;
        document.body.classList.add('online--en-sala');
        window.scrollTo(0, 0);
        if (!respuesta.reconectado) {
            $('chatMensajes').textContent = '';
            limpiarNotificaciones();
        }
        cambiarTab('sala');
        actualizarSala(respuesta.sala);
        mostrarPanel(!respuesta.sala.partido);
        actualizarEstadoBody();
    }

    function volverALista(motivo) {
        if (estado.salaId) sessionStorage.removeItem(claveToken(estado.salaId));
        estado.salaId = null;
        estado.tuId = null;
        estado.token = null;
        estado.sala = null;
        estado.enGameover = false;
        limpiarReplay();
        limpiarSpecReplay();
        reiniciarRed();
        soltarTeclas();
        limpiarNotificaciones();
        history.replaceState(null, '', window.location.pathname);
        $('vistaSala').hidden = true;
        $('vistaSalas').hidden = false;
        document.body.classList.remove('online--en-sala');
        actualizarEstadoBody();
        if (motivo) mostrarAviso($('avisoSalas'), motivo, 6000);
        pedirSalas();
    }

    $('salirSala').addEventListener('click', async () => {
        await pedir('sala:salir');
        volverALista();
    });

    window.addEventListener('pagehide', () => {
        if (estado.salaId) socket.emit('sala:salir', {});
    });

    socket.on('sala:expulsado', ({ motivo }) => volverALista(motivo || 'Saliste de la sala.'));

    $('copiarLink').addEventListener('click', async () => {
        const link = `${window.location.origin}${window.location.pathname}?sala=${estado.salaId}`;
        try {
            await navigator.clipboard.writeText(link);
            mostrarAviso($('avisoSala'), '¡Link copiado! Pasáselo a tus amigos.');
        } catch {
            mostrarAviso($('avisoSala'), `Link de la sala: ${link}`, 10000);
        }
    });

    /* ========================= */
    /* PANEL DE LA SALA          */
    /* ========================= */

    socket.on('sala:estado', sala => {
        if (sala.id === estado.salaId) actualizarSala(sala);
    });

    socket.on('sala:mapasCustom', mapas => {
        estado.mapasCustom = Array.isArray(mapas) ? mapas : [];
        reconstruirMapas();
        if (estado.sala) dibujarControlesAdmin(estado.sala);
    });

    function anchoCanvasObjetivo(mapa) {
        return Math.min(Math.max(1, mapa.width), 1440);
    }

    function actualizarSala(sala) {
        const mapaAnterior = estado.sala && estado.sala.mapa.id;
        estado.sala = sala;
        if (mapaAnterior !== sala.mapa.id || canvas.width !== anchoCanvasObjetivo(sala.mapa)) {
            ajustarCanvas(sala.mapa);
            dibujante.reiniciarEfectos();
        }
        $('tituloSala').textContent = sala.nombre;
        $('codigoActual').textContent = sala.id;
        $('candado').hidden = !sala.conClave;
        dibujarEquipos(sala);
        dibujarControlesAdmin(sala);
        dibujarUltimoResultado(sala);
        dibujarMatchupClubes(sala);
        actualizarPreviewAvatar();
        if (!sala.partido) {
            if (!(estado.replay && estado.replay.esHighlightPostPartido)) {
                limpiarReplay();
            }
            reiniciarRed();
        } else {
            actualizarUiVotosReplay();
        }
        dibujarPreview();
        actualizarEstadoBody();
    }

    function ajustarCanvas(mapa) {
        const objetivoW = anchoCanvasObjetivo(mapa);
        canvas.width = objetivoW;
        canvas.height = Math.max(1, Math.round(mapa.height * (objetivoW / Math.max(1, mapa.width))));
        canvas.style.aspectRatio = `${mapa.width} / ${mapa.height}`;
    }

    function moverJugador(jugadorId, equipo) {
        accion('sala:mover', { jugadorId, equipo: equipo || null });
    }

    function dibujarEquipos(sala) {
        const admin = soyAdmin();
        const yo = sala.jugadores.find(jugador => jugador.id === estado.tuId);
        const columnas = ['red', '', 'blue'];
        document.querySelectorAll('.online-equipo').forEach(seccion => {
            const equipo = seccion.dataset.equipo;
            const indice = columnas.indexOf(equipo);
            const lista = seccion.querySelector('[data-lista]');
            const miembros = sala.jugadores.filter(jugador => (jugador.equipo || '') === equipo);
            lista.textContent = '';
            seccion.querySelector('[data-cuenta]').textContent = equipo && sala.maxPorEquipo ? `${miembros.length}/${sala.maxPorEquipo}` : String(miembros.length);

            miembros.forEach((jugador, posicion) => {
                const item = crearElemento('li', 'online-jugador');
                if (jugador.id === estado.tuId) item.classList.add('online-jugador--vos');
                if (jugador.desconectado) item.classList.add('online-jugador--desconectado');
                item.dataset.id = jugador.id;
                item.draggable = admin;
                const etiquetaAvatar = jugador.avatar ? `[${jugador.avatar}] ` : '';
                const nombre = crearElemento('span', 'online-jugador__nombre');
                nombre.textContent = `${equipo ? `${posicion + 1}. ` : ''}${etiquetaAvatar}${jugador.nombre}${jugador.id === estado.tuId ? ' (vos)' : ''}`;
                item.appendChild(nombre);
                if (jugador.admin) item.appendChild(crearElemento('span', 'online-jugador__admin', '★'));
                if (jugador.escribiendo) item.appendChild(crearElemento('span', 'online-jugador__escribiendo', '💬'));
                if (jugador.desconectado) item.appendChild(crearElemento('span', 'online-jugador__estado', 'reconectando…'));

                if (admin) {
                    const acciones = crearElemento('span', 'online-jugador__acciones');
                    if (indice > 0) acciones.appendChild(botonMini('◀', `Mover a ${columnas[indice - 1] ? NOMBRE_EQUIPO[columnas[indice - 1]] : 'Espectadores'}`, () => moverJugador(jugador.id, columnas[indice - 1])));
                    if (indice < 2) acciones.appendChild(botonMini('▶', `Mover a ${columnas[indice + 1] ? NOMBRE_EQUIPO[columnas[indice + 1]] : 'Espectadores'}`, () => moverJugador(jugador.id, columnas[indice + 1])));
                    if (jugador.id !== estado.tuId) {
                        acciones.appendChild(botonMini('★', jugador.admin ? 'Sacar admin' : 'Dar admin', () => accion('sala:admin', { jugadorId: jugador.id })));
                        acciones.appendChild(botonMini('✕', 'Echar de la sala', () => accion('sala:echar', { jugadorId: jugador.id })));
                    }
                    item.appendChild(acciones);
                }
                lista.appendChild(item);
            });

            const puedeUnirse = yo && (yo.equipo || '') !== equipo && (admin || !sala.config.equiposBloqueados);
            seccion.querySelector('[data-unirme]').hidden = !puedeUnirse;
        });
    }

    function botonMini(texto, titulo, alClick) {
        const boton = crearElemento('button', 'online-mini', texto);
        boton.type = 'button';
        boton.title = titulo;
        boton.setAttribute('aria-label', titulo);
        boton.addEventListener('click', alClick);
        return boton;
    }

    // Arrastrar y soltar jugadores entre columnas (solo el admin).
    document.querySelectorAll('.online-equipo').forEach(seccion => {
        seccion.addEventListener('dragover', evento => {
            if (!soyAdmin()) return;
            evento.preventDefault();
            seccion.classList.add('online-equipo--destino');
        });
        seccion.addEventListener('dragleave', () => seccion.classList.remove('online-equipo--destino'));
        seccion.addEventListener('drop', evento => {
            evento.preventDefault();
            seccion.classList.remove('online-equipo--destino');
            const jugadorId = evento.dataTransfer.getData('text/plain');
            if (jugadorId) moverJugador(jugadorId, seccion.dataset.equipo);
        });
        seccion.querySelector('[data-unirme]').addEventListener('click', () => moverJugador(estado.tuId, seccion.dataset.equipo));
    });

    document.addEventListener('dragstart', evento => {
        const item = evento.target.closest && evento.target.closest('.online-jugador');
        if (item) evento.dataTransfer.setData('text/plain', item.dataset.id);
    });

    function llenarSelect(select, opciones) {
        if (!select || select.options.length === opciones.length) return;
        select.textContent = '';
        opciones.forEach(([valor, texto]) => {
            const opcion = crearElemento('option', '', texto);
            opcion.value = String(valor);
            select.appendChild(opcion);
        });
    }

    function dibujarTamanosJugadores(sala, admin, enPartido, esHbs) {
        const cont = $('tamanosJugadores');
        if (!cont) return;
        const lista = sala.tamanos || (window.ClubesLaChaula ? window.ClubesLaChaula.TAMANOS_JUGADORES : []);
        const actual = sala.config.tamano || '3v3';
        cont.textContent = '';
        lista.forEach(t => {
            const btn = crearElemento('button', 'tamano-pill', t.etiqueta);
            btn.type = 'button';
            const activo = t.id === actual;
            btn.classList.toggle('tamano-pill--activo', activo);
            btn.setAttribute('aria-pressed', String(activo));
            btn.setAttribute('aria-label', `Tamaño de estadio ${t.nombre}`);
            btn.title = `${t.nombre}`;
            btn.disabled = !admin || enPartido || esHbs;
            btn.addEventListener('click', () => {
                if (t.id !== actual) estado.ruletaAnimacion = 'pulse';
                accion('sala:config', { tamano: t.id });
            });
            cont.appendChild(btn);
        });
    }

    function dibujarControlesPotenciadores(sala, admin, enPartido, esHbs) {
        const modoPot = sala.config.potenciadoresModo || (sala.config.powerUps ? 'aleatorio' : 'desactivado');
        const activos = Array.isArray(sala.config.potenciadoresActivos)
            ? sala.config.potenciadoresActivos
            : ['SUPER_KICK', 'BIG', 'SPEED'];

        TIPOS_POWERUP.forEach(({ id, btnId }) => {
            const btn = $(btnId);
            if (!btn) return;
            const prendido = !esHbs && modoPot !== 'desactivado' && activos.includes(id);
            btn.setAttribute('aria-pressed', String(prendido));
            btn.disabled = !admin || enPartido || esHbs;
        });

        document.querySelectorAll('#cfgModoPotenciadores .mode-pill').forEach(btn => {
            const activo = btn.dataset.pumode === modoPot;
            btn.classList.toggle('mode-pill--activo', activo);
            btn.setAttribute('aria-pressed', String(activo));
            btn.disabled = !admin || enPartido || esHbs;
        });
    }

    function esEstadioDeClub(mapaId) {
        return estado.estadiosClubes.some(e => e.id === mapaId);
    }

    function dibujarControlesAdmin(sala) {
        const admin = soyAdmin();
        const enPartido = !!sala.partido;
        const esHbs = !!(sala.mapa && sala.mapa.hbs);
        const esClub = esEstadioDeClub(sala.config.mapaId);

        $('infoNoAdmin').hidden = admin;
        llenarSelect($('cfgTiempo'), sala.tiempos.map(minutos => [minutos, `${minutos} min`]));
        llenarSelect($('cfgGoles'), sala.golesValidos.map(goles => [goles, goles ? `${goles}` : 'Sin límite']));
        llenarSelect($('cfgModo'), (sala.modos || []).map(modo => [modo.id, modo.nombre]));
        $('cfgModo').value = String(sala.config.modo || 'normal');
        $('cfgTiempo').value = String(sala.config.tiempoMin);
        $('cfgGoles').value = String(sala.config.goles);
        $('cfgCombinar').checked = esHbs ? false : !!sala.config.combinarPoderes;
        $('cfgBloqueo').checked = sala.config.equiposBloqueados;

        $('cfgModo').disabled = !admin || enPartido || esHbs;
        ['cfgTiempo', 'cfgGoles'].forEach(id => { $(id).disabled = !admin || enPartido; });
        const modoPot = sala.config.potenciadoresModo || (sala.config.powerUps ? 'aleatorio' : 'desactivado');
        $('cfgCombinar').disabled = !admin || enPartido || esHbs || modoPot === 'desactivado';
        $('cfgBloqueo').disabled = !admin;

        const esPrivada = !!sala.privada;
        if ($('cfgSalaPublica') && $('cfgSalaPrivada')) {
            $('cfgSalaPublica').classList.toggle('mode-pill--activo', !esPrivada);
            $('cfgSalaPrivada').classList.toggle('mode-pill--activo', esPrivada);
            $('cfgSalaPublica').setAttribute('aria-pressed', String(!esPrivada));
            $('cfgSalaPrivada').setAttribute('aria-pressed', String(esPrivada));
            $('cfgSalaPublica').disabled = !admin;
            $('cfgSalaPrivada').disabled = !admin;
        }
        if ($('cfgClaveSala')) {
            $('cfgClaveSala').disabled = !admin;
            $('cfgClaveSala').placeholder = sala.conClave ? 'Clave activa (vacío quita)' : 'Sin contraseña';
        }

        dibujarTamanosJugadores(sala, admin, enPartido, esHbs);
        dibujarControlesPotenciadores(sala, admin, enPartido, esHbs);

        $('btnImportarHbs').hidden = !admin;
        $('btnImportarHbs').disabled = enPartido;

        // En la ruleta izquierda: clubes muestran anterior/siguiente; catálogo muestra solo la elegida + botón volver.
        $('mapaAnterior').hidden = !esClub;
        $('mapaSiguiente').hidden = !esClub;
        $('mapaAnterior').disabled = !admin || enPartido;
        $('mapaSiguiente').disabled = !admin || enPartido;
        if ($('btnVolverClubes')) {
            $('btnVolverClubes').hidden = esClub || !admin || enPartido;
        }

        document.querySelectorAll('.online-miniatura').forEach(boton => {
            const elegida = boton.dataset.mapa === sala.config.mapaId;
            boton.classList.toggle('online-miniatura--elegida', elegida);
            boton.setAttribute('aria-selected', String(elegida));
            boton.disabled = !admin || enPartido;
        });

        const mapa = mapaPorId(sala.config.mapaId) || sala.mapa;
        $('nombreMapa').textContent = mapa ? mapa.name : '—';
        if ($('categoriaMapa')) {
            const tamObj = window.ClubesLaChaula && window.ClubesLaChaula.obtenerTamanoJugadores(sala.config.tamano || '3v3');
            const sufijoTam = (!esHbs && tamObj) ? ` · ${tamObj.nombre}` : '';
            if (mapa && mapa.club) $('categoriaMapa').textContent = `${mapa.club} · Estadio de club${sufijoTam}`;
            else if (mapa && mapa.hbs) $('categoriaMapa').textContent = `${mapa.category || 'HaxBall'} · HaxBall .hbs`;
            else $('categoriaMapa').textContent = `Cancha del catálogo${sufijoTam}`;
        }

        if ($('hudBtnPausa')) {
            $('hudBtnPausa').disabled = !enPartido || !admin;
            $('hudBtnPausa').textContent = enPartido && sala.partido.pausado ? 'Seguir' : 'Pausa';
        }
        if ($('hudBtnDetener')) {
            $('hudBtnDetener').disabled = !enPartido || !admin;
        }
        const enPractica = !!(enPartido && sala.partido.practica);
        actualizarBotonPelotaPractica(linea.ultima());
        if ($('btnPractica')) {
            const btnPractica = $('btnPractica');
            btnPractica.textContent = enPractica ? 'SALIR DE MODO PRÁCTICA' : 'PRÁCTICA';
            btnPractica.title = enPractica
                ? 'Salir del modo práctica'
                : 'Entrar a practicar libremente en el estadio elegido';
            btnPractica.classList.toggle('lobby-practice-btn--exit', enPractica);
            btnPractica.disabled = !admin || (enPartido && !enPractica);
        }

        const btnPlay = $('iniciarDetener');
        btnPlay.disabled = !admin;
        if (enPartido && !enPractica) {
            btnPlay.textContent = sala.partido.pausado ? 'REANUDAR' : 'PAUSAR';
            btnPlay.classList.remove('ssf-button-primary');
        } else {
            btnPlay.textContent = 'PLAY';
            btnPlay.classList.add('ssf-button-primary');
        }
    }

    function aplicarEscudoImg(img, club) {
        if (!img || !club || !window.ClubesLaChaula) return;
        const url = window.ClubesLaChaula.obtenerEscudoUrl(club);
        if (img.dataset.clubId === club.id && img.dataset.fallback !== '1') return;
        img.dataset.clubId = club.id;
        img.dataset.fallback = '0';
        img.onerror = () => {
            if (img.dataset.fallback === '1') return;
            img.dataset.fallback = '1';
            img.src = window.ClubesLaChaula.crearEscudoSvgDataUrl(club);
        };
        img.src = url;
    }

    function formatearGolesEquipo(goles, equipo) {
        const lista = (goles || []).filter(g => g.equipo === equipo);
        if (!lista.length) return '';
        const agrupados = new Map();
        lista.forEach(g => {
            const nombre = `${g.autor || 'Gol'}${g.enContra ? ' (EC)' : ''}`;
            const min = g.minuto ? `${g.minuto}'${g.extra ? '+' : ''}` : '';
            if (!agrupados.has(nombre)) agrupados.set(nombre, []);
            if (min) agrupados.get(nombre).push(min);
        });
        return Array.from(agrupados.entries())
            .map(([nombre, mins]) => (mins.length ? `${nombre} ${mins.join(', ')}` : nombre))
            .join(' · ');
    }

    function actualizarGoleadoresHud(sala) {
        const cont = $('hudGolesResumen');
        const listaRojo = $('hudGolesListaRojo');
        const listaAzul = $('hudGolesListaAzul');
        if (!cont || !listaRojo || !listaAzul) return;

        const goles = sala.partido
            ? (sala.partido.goles || [])
            : (sala.ultimoResultado && Array.isArray(sala.ultimoResultado.goles) ? sala.ultimoResultado.goles : []);
        const txtRed = formatearGolesEquipo(goles, 'red');
        const txtBlue = formatearGolesEquipo(goles, 'blue');
        listaRojo.textContent = txtRed;
        listaAzul.textContent = txtBlue;
        cont.hidden = !(txtRed || txtBlue);
    }

    function dibujarMatchupClubes(sala) {
        if (!window.ClubesLaChaula) return;
        const admin = soyAdmin();
        const clubesCfg = (sala.config && sala.config.clubes) || { red: 'boca', blue: 'river' };
        const clubRed = window.ClubesLaChaula.obtenerClub(clubesCfg.red);
        const clubBlue = window.ClubesLaChaula.obtenerClub(clubesCfg.blue);

        aplicarEscudoImg($('imgEscudoRojo'), clubRed);
        aplicarEscudoImg($('hudEscudoRojo'), clubRed);
        if ($('siglaEscudoRojo')) $('siglaEscudoRojo').textContent = clubRed.sigla;
        if ($('btnEscudoRojo')) {
            $('btnEscudoRojo').disabled = !admin;
            $('btnEscudoRojo').title = admin ? `${clubRed.nombre} (Click para cambiar club)` : clubRed.nombre;
            $('btnEscudoRojo').setAttribute('aria-label', `Club equipo rojo: ${clubRed.nombre}. Cambiar`);
        }

        aplicarEscudoImg($('imgEscudoAzul'), clubBlue);
        aplicarEscudoImg($('hudEscudoAzul'), clubBlue);
        if ($('siglaEscudoAzul')) $('siglaEscudoAzul').textContent = clubBlue.sigla;
        if ($('btnEscudoAzul')) {
            $('btnEscudoAzul').disabled = !admin;
            $('btnEscudoAzul').title = admin ? `${clubBlue.nombre} (Click para cambiar club)` : clubBlue.nombre;
            $('btnEscudoAzul').setAttribute('aria-label', `Club equipo azul: ${clubBlue.nombre}. Cambiar`);
        }

        if ($('hudNombreRojo')) $('hudNombreRojo').textContent = sinTildesMayus(clubRed.nombre);
        if ($('hudNombreAzul')) $('hudNombreAzul').textContent = sinTildesMayus(clubBlue.nombre);

        const marcador = sala.partido
            ? sala.partido.marcador
            : (sala.ultimoResultado ? sala.ultimoResultado.marcador : { red: 0, blue: 0 });
        if ($('lobbyGolesRojo')) $('lobbyGolesRojo').textContent = String(marcador.red || 0);
        if ($('lobbyGolesAzul')) $('lobbyGolesAzul').textContent = String(marcador.blue || 0);
        actualizarGoleadoresHud(sala);
    }

    function mapaPorId(id) {
        return estado.estadiosClubes.find(m => m.id === id)
            || estado.mapas.find(mapa => mapa.id === id)
            || null;
    }

    const ORDEN_CATEGORIAS = [
        'Todos',
        'Originales',
        'Futsal',
        'Classic / Big',
        'Real Soccer',
        'Hockey',
        'Basketball',
        'Volleyball',
        'Tennis / Ping',
        'Otros',
        'Importados'
    ];

    function grupoCategoria(mapa) {
        if (!mapa || !mapa.hbs) return 'Originales';
        if (mapa.imported || mapa.category === 'Importados') return 'Importados';
        const cat = mapa.category || '';
        if (cat === 'Futsal') return 'Futsal';
        if (cat === 'Classic' || cat === 'Big') return 'Classic / Big';
        if (cat === 'Real Soccer') return 'Real Soccer';
        if (cat === 'Hockey') return 'Hockey';
        if (cat === 'Basketball') return 'Basketball';
        if (cat === 'Volleyball') return 'Volleyball';
        if (cat === 'Tennis' || cat === 'Ping Pong') return 'Tennis / Ping';
        return 'Otros';
    }

    function reconstruirMapas() {
        estado.mapas = [...estado.mapasBase, ...estado.mapasHbs, ...estado.mapasCustom];
        if (estado.salaId) {
            dibujarFiltrosMapa();
            dibujarMiniaturas();
        }
        if (estado.sala) dibujarControlesAdmin(estado.sala);
    }

    function dibujarFiltrosMapa() {
        const cont = $('filtrosMapa');
        if (!cont) return;
        const disponibles = new Set(['Todos']);
        estado.mapas.forEach(m => disponibles.add(grupoCategoria(m)));
        if (!disponibles.has(estado.categoriaFiltro)) estado.categoriaFiltro = 'Todos';

        cont.textContent = '';
        ORDEN_CATEGORIAS.filter(cat => disponibles.has(cat)).forEach(cat => {
            const btn = crearElemento('button', 'online-filtro', cat);
            btn.type = 'button';
            btn.setAttribute('role', 'tab');
            const activo = estado.categoriaFiltro === cat;
            btn.classList.toggle('online-filtro--activo', activo);
            btn.setAttribute('aria-selected', String(activo));
            btn.addEventListener('click', () => {
                estado.categoriaFiltro = cat;
                dibujarFiltrosMapa();
                aplicarFiltrosMapa();
            });
            cont.appendChild(btn);
        });
    }

    function aplicarFiltrosMapa() {
        const contenedor = $('miniaturas');
        const q = estado.busquedaMapa.trim().toLowerCase();
        let visibles = 0;
        contenedor.querySelectorAll('.online-miniatura').forEach(boton => {
            const cat = boton.dataset.categoria;
            const nombre = boton.dataset.nombre || '';
            const coincideCat = estado.categoriaFiltro === 'Todos' || cat === estado.categoriaFiltro;
            const coincideTexto = !q || nombre.includes(q);
            const mostrar = coincideCat && coincideTexto;
            boton.hidden = !mostrar;
            if (mostrar) visibles += 1;
        });
        let aviso = contenedor.querySelector('.online-miniaturas__vacio');
        if (!visibles) {
            if (!aviso) {
                aviso = crearElemento('p', 'online-miniaturas__vacio', 'No hay mapas que coincidan con el filtro.');
                contenedor.appendChild(aviso);
            }
            aviso.hidden = false;
        } else if (aviso) {
            aviso.hidden = true;
        }
    }

    async function cargarCatalogoHbs() {
        try {
            const res = await fetch('/api/mapas-hbs');
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data.mapas)) {
                estado.mapasHbs = data.mapas;
                reconstruirMapas();
            }
        } catch {
            // Si falla la carga opcional de catálogo, siguen disponibles los mapas base
        }
    }

    const cacheMiniaturas = new Map();

    // Miniaturas de todas las canchas de la derecha: se dibujan una vez y se cachean.
    function dibujarMiniaturas() {
        const contenedor = $('miniaturas');
        contenedor.textContent = '';
        const thumbCanvas = document.createElement('canvas');
        const dibThumb = DibujoOnline.crearDibujante(thumbCanvas);
        estado.mapas.forEach(mapa => {
            const cat = grupoCategoria(mapa);
            const boton = crearElemento('button', 'online-miniatura');
            boton.type = 'button';
            boton.dataset.mapa = mapa.id;
            boton.dataset.categoria = cat;
            boton.dataset.nombre = `${mapa.name} ${mapa.category || ''}`.toLowerCase();
            boton.setAttribute('role', 'option');
            boton.title = mapa.hbs ? `${mapa.name} (${mapa.category || 'HaxBall'})` : mapa.name;
            let src = cacheMiniaturas.get(mapa.id);
            if (!src) {
                const tw = 160;
                const th = Math.max(54, Math.round((tw * mapa.height) / Math.max(1, mapa.width)));
                thumbCanvas.width = tw;
                thumbCanvas.height = th;
                dibThumb.dibujarMiniatura(mapa);
                src = thumbCanvas.toDataURL('image/png');
                cacheMiniaturas.set(mapa.id, src);
            }
            const img = crearElemento('img');
            img.alt = '';
            img.src = src;
            boton.append(img, crearElemento('span', '', mapa.name));
            boton.addEventListener('click', () => elegirMapa(mapa.id));
            contenedor.appendChild(boton);
        });
        aplicarFiltrosMapa();
    }

    function elegirMapa(mapaId, animacion = 'fade') {
        if (!soyAdmin() || !estado.sala || estado.sala.config.mapaId === mapaId) return;
        estado.ruletaAnimacion = animacion;
        accion('sala:config', { mapaId });
    }

    // La ruleta izquierda recorre EXCLUSIVAMENTE los estadios de clubes.
    function moverRuletaClubes(paso) {
        if (!estado.sala || !estado.estadiosClubes.length) return;
        const pool = estado.estadiosClubes;
        const indice = pool.findIndex(mapa => mapa.id === estado.sala.config.mapaId);
        const base = indice === -1 ? (paso > 0 ? -1 : 0) : indice;
        const siguiente = pool[(base + paso + pool.length) % pool.length];
        elegirMapa(siguiente.id, paso > 0 ? 'next' : 'prev');
    }

    $('mapaAnterior').addEventListener('click', () => moverRuletaClubes(-1));
    $('mapaSiguiente').addEventListener('click', () => moverRuletaClubes(1));
    if ($('btnVolverClubes')) {
        $('btnVolverClubes').addEventListener('click', () => {
            if (estado.estadiosClubes.length) elegirMapa(estado.estadiosClubes[0].id, 'fade');
        });
    }
    $('buscarMapa').addEventListener('input', evento => {
        estado.busquedaMapa = evento.target.value || '';
        aplicarFiltrosMapa();
    });

    function abrirDialogoImportarHbs() {
        if (!soyAdmin() || (estado.sala && estado.sala.partido)) return;
        $('errorImportarHbs').textContent = '';
        $('archivoHbs').value = '';
        $('nombreArchivoHbs').textContent = 'Ningún archivo elegido';
        estado.archivoHbsNombre = '';
        $('dialogoImportarHbs').showModal();
        $('textoHbs').focus();
    }

    $('btnImportarHbs').addEventListener('click', abrirDialogoImportarHbs);
    $('btnElegirArchivoHbs').addEventListener('click', () => $('archivoHbs').click());
    $('cancelarImportarHbs').addEventListener('click', () => $('dialogoImportarHbs').close());

    $('archivoHbs').addEventListener('change', async evento => {
        const archivo = evento.target.files && evento.target.files[0];
        if (!archivo) return;
        estado.archivoHbsNombre = archivo.name || '';
        $('nombreArchivoHbs').textContent = archivo.name;
        $('errorImportarHbs').textContent = '';
        try {
            $('textoHbs').value = await archivo.text();
        } catch {
            $('errorImportarHbs').textContent = 'No se pudo leer el archivo seleccionado.';
        }
    });

    $('formImportarHbs').addEventListener('submit', async evento => {
        evento.preventDefault();
        const texto = $('textoHbs').value;
        $('errorImportarHbs').textContent = '';
        try {
            if (window.FisicaHbs) window.FisicaHbs.parseHbsTexto(texto);
        } catch (err) {
            $('errorImportarHbs').textContent = err.message || 'Archivo .hbs inválido.';
            return;
        }
        const btn = $('confirmarImportarHbs');
        btn.disabled = true;
        const respuesta = await pedir('sala:importarHbs', {
            texto,
            nombreArchivo: estado.archivoHbsNombre
        });
        btn.disabled = false;
        if (respuesta.error) {
            $('errorImportarHbs').textContent = respuesta.error;
            return;
        }
        estado.categoriaFiltro = 'Importados';
        $('textoHbs').value = '';
        $('dialogoImportarHbs').close();
        dibujarFiltrosMapa();
        aplicarFiltrosMapa();
    });

    function dibujarSlotPreview(canv, dib, mapa) {
        if (!canv || !dib || !mapa) return;
        if (canv.width !== mapa.width || canv.height !== mapa.height) {
            canv.width = mapa.width;
            canv.height = mapa.height;
        }
        dib.dibujar(DibujoOnline.estadoVacio(mapa), 0, null);
    }

    const CLASES_ANIM_RULETA = [
        'estadio-slot--anim-next',
        'estadio-slot--anim-prev',
        'estadio-slot--anim-fade',
        'estadio-slot--anim-pulse'
    ];

    function lanzarGhostPreview(tipo) {
        const stage = $('previewStage');
        if (!stage || !preview || preview.width <= 0 || preview.height <= 0) return;
        if (tipo !== 'next' && tipo !== 'prev' && tipo !== 'fade') return;
        stage.querySelectorAll('.estadio-slot-ghost').forEach(el => el.remove());
        const ghost = document.createElement('canvas');
        ghost.width = preview.width;
        ghost.height = preview.height;
        ghost.className = `estadio-slot-ghost estadio-slot-ghost--${tipo}`;
        const ctx = ghost.getContext('2d');
        if (ctx) ctx.drawImage(preview, 0, 0);
        stage.appendChild(ghost);
        const limpiar = () => ghost.remove();
        ghost.addEventListener('animationend', limpiar, { once: true });
        setTimeout(limpiar, 420);
    }

    function animarRuletaEstadios(tipo) {
        if (!tipo) return;
        const clase = `estadio-slot--anim-${tipo}`;
        document.querySelectorAll('.estadios-ruleta .estadio-slot').forEach(slot => {
            slot.classList.remove(...CLASES_ANIM_RULETA);
            void slot.offsetWidth;
            slot.classList.add(clase);
        });
    }

    // Vista previa en la ruleta de la izquierda (clubes arriba/centro/abajo o solo la cancha elegida del catálogo).
    function dibujarPreview(forzarRedibujo = false) {
        if (!estado.panelVisible || estado.tabActiva !== 'estadios' || !estado.sala) return;
        const mapa = estado.sala.mapa && estado.sala.mapa.id === estado.sala.config.mapaId
            ? estado.sala.mapa
            : (mapaPorId(estado.sala.config.mapaId) || estado.sala.mapa);
        const clave = `${mapa.id}|${mapa.width}|${mapa.height}|${mapa.theme || ''}`;
        const estatica = !!(mapa.hbs || mapa.theme === 'haxball');
        if (!forzarRedibujo && estatica && estado.ultimoPreviewClave === clave) return;

        const huboCambio = estado.ultimoPreviewClave !== '' && estado.ultimoPreviewClave !== clave;
        const mismaCancha = estado.ultimoPreviewMapaId === mapa.id;
        estado.ultimoPreviewClave = clave;
        estado.ultimoPreviewMapaId = mapa.id;

        const tipoAnim = huboCambio
            ? (estado.ruletaAnimacion || (mismaCancha ? 'pulse' : 'fade'))
            : null;
        if (tipoAnim) {
            lanzarGhostPreview(tipoAnim);
        }

        dibujarSlotPreview(preview, dibujantePreview, mapa);

        const idxClub = estado.estadiosClubes.findIndex(e => e.id === estado.sala.config.mapaId);
        if (idxClub !== -1 && estado.estadiosClubes.length > 0) {
            const total = estado.estadiosClubes.length;
            const prevMapa = estado.estadiosClubes[(idxClub - 1 + total) % total];
            const nextMapa = estado.estadiosClubes[(idxClub + 1) % total];
            dibujarSlotPreview(previewPrev, dibujantePreviewPrev, prevMapa);
            dibujarSlotPreview(previewNext, dibujantePreviewNext, nextMapa);
        }
        if (tipoAnim) {
            animarRuletaEstadios(tipoAnim);
            estado.ruletaAnimacion = null;
        }
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';

    function svgEl(tag, attrs) {
        const el = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
        return el;
    }

    function crearSvgStat(tipo) {
        const svg = svgEl('svg', { viewBox: '0 0 24 24', class: `stat-svg stat-svg--${tipo}`, 'aria-hidden': 'true' });
        if (tipo === 'pelota') {
            svg.append(
                svgEl('circle', { cx: 12, cy: 12, r: 9.2, fill: '#f8fafc', stroke: '#09061b', 'stroke-width': 2 }),
                svgEl('path', { d: 'M12 7.5 L15.6 10.1 L14.2 14.3 H9.8 L8.4 10.1 Z', fill: '#1e293b' }),
                svgEl('path', { d: 'M12 7.5 V3.2 M15.6 10.1 L20.4 8.3 M14.2 14.3 L18 19 M9.8 14.3 L6 19 M8.4 10.1 L3.6 8.3', fill: 'none', stroke: '#1e293b', 'stroke-width': 1.5, 'stroke-linecap': 'round' })
            );
        } else if (tipo === 'guantes') {
            svg.append(
                svgEl('path', { d: 'M7 16.5 V9.5 C7 8 8.4 7.5 9.2 8.4 V6.4 C9.2 5.1 11 5.1 11 6.4 V5.1 C11 3.8 12.8 3.8 12.8 5.1 V6.1 C12.8 4.8 14.6 4.8 14.6 6.1 V7.9 C14.6 6.7 16.4 6.7 16.4 7.9 V12.3 L18.3 10.8 C19.5 9.9 20.6 11.3 19.6 12.7 L17.5 16.5 Z', fill: '#38bdf8', stroke: '#09061b', 'stroke-width': 1.7, 'stroke-linejoin': 'round' }),
                svgEl('path', { d: 'M9.6 13.4 Q12 12.1 14.8 13.4', fill: 'none', stroke: '#e0f2fe', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
                svgEl('rect', { x: 6.4, y: 16.4, width: 11.4, height: 4.4, rx: 1.4, fill: '#fbbf24', stroke: '#09061b', 'stroke-width': 1.6 })
            );
        } else {
            svg.append(
                svgEl('path', { d: 'M4.5 7.2 L9.4 7.2 L11.2 11.6 L18.5 13.1 C20.4 13.5 21.2 14.9 21 16.8 H4.2 V11.4 Z', fill: '#a78bfa', stroke: '#09061b', 'stroke-width': 1.7, 'stroke-linejoin': 'round' }),
                svgEl('path', { d: 'M11.6 11.9 L14 14 M13.9 12.4 L16.2 14.4', fill: 'none', stroke: '#f5f3ff', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
                svgEl('rect', { x: 5.2, y: 17, width: 2.4, height: 2.8, rx: 0.7, fill: '#ffd54f', stroke: '#09061b', 'stroke-width': 1.2 }),
                svgEl('rect', { x: 11, y: 17, width: 2.4, height: 2.8, rx: 0.7, fill: '#ffd54f', stroke: '#09061b', 'stroke-width': 1.2 }),
                svgEl('rect', { x: 17.3, y: 17, width: 2.4, height: 2.8, rx: 0.7, fill: '#ffd54f', stroke: '#09061b', 'stroke-width': 1.2 })
            );
        }
        return svg;
    }

    function crearGrupoStatIconos(tipo, cantidad, etiqueta) {
        const total = Math.max(0, Number(cantidad) || 0);
        const grupo = crearElemento('span', 'lobby-stat-group');
        grupo.title = `${etiqueta}: ${total}`;
        grupo.setAttribute('aria-label', `${total} ${etiqueta}`);

        if (total === 0) {
            grupo.classList.add('lobby-stat-group--cero');
            const wrap = crearElemento('span', 'lobby-stat-icon');
            wrap.appendChild(crearSvgStat(tipo));
            grupo.appendChild(wrap);
            return grupo;
        }

        if (total <= 4) {
            grupo.classList.add('lobby-stat-group--stack');
            for (let i = 0; i < total; i += 1) {
                const wrap = crearElemento('span', 'lobby-stat-icon');
                wrap.style.zIndex = String(i + 1);
                wrap.appendChild(crearSvgStat(tipo));
                grupo.appendChild(wrap);
            }
            return grupo;
        }

        grupo.classList.add('lobby-stat-group--capped');
        const wrap = crearElemento('span', 'lobby-stat-icon');
        wrap.appendChild(crearSvgStat(tipo));
        const num = crearElemento('span', 'lobby-stat-overlay-num', String(total));
        grupo.append(wrap, num);
        return grupo;
    }

    function renderizarTarjetasPuntuacion(puntuacion) {
        const contRojo = $('puntuacionRojo');
        const contAzul = $('puntuacionAzul');
        if (!contRojo || !contAzul) return;

        [
            { equipo: 'red', cont: contRojo },
            { equipo: 'blue', cont: contAzul }
        ].forEach(({ equipo, cont }) => {
            cont.textContent = '';
            if (!puntuacion || !Array.isArray(puntuacion.jugadores) || !puntuacion.jugadores.length) {
                cont.appendChild(crearElemento('p', 'lobby-score-empty', 'Sin partido anterior todavía.'));
                return;
            }
            const lista = puntuacion.jugadores.filter(j => j.equipo === equipo);
            if (!lista.length) {
                cont.appendChild(crearElemento('p', 'lobby-score-empty', 'Sin jugadores en este equipo.'));
                return;
            }
            lista.forEach(j => {
                const esMvp = puntuacion.mvpId && j.id === puntuacion.mvpId;
                const fila = crearElemento('div', `lobby-score-row${esMvp ? ' lobby-score-row--mvp' : ''}`);
                fila.title = `Goles: ${j.goles} · Golazos: ${j.golazos} · Asistencias: ${j.asistencias} · Salvadas: ${j.atajadas} · Despejes: ${j.despejes} · Tiros: ${j.tiros} · Toques: ${j.toques}`;
                const izq = crearElemento('span', 'lobby-score-name', j.nombre);
                if (esMvp) {
                    izq.appendChild(crearElemento('span', 'lobby-mvp-badge', 'MVP'));
                }
                const stats = crearElemento('span', 'lobby-score-stats');
                stats.append(
                    crearGrupoStatIconos('pelota', j.goles || 0, 'Goles'),
                    crearGrupoStatIconos('botines', j.asistencias || 0, 'Asistencias'),
                    crearGrupoStatIconos('guantes', j.atajadas || 0, 'Salvadas')
                );

                const pts = crearElemento('span', 'lobby-score-pts', `${j.puntos} pts`);
                const der = crearElemento('span', 'lobby-score-right');
                der.append(stats, pts);
                fila.append(izq, der);
                cont.appendChild(fila);
            });
        });
    }

    async function verGolReplayPostPartido(indice) {
        if (!estado.sala || estado.sala.partido) return;
        const resp = await accion('sala:verGolReplay', { indice });
        if (resp && resp.ok && resp.clip) {
            iniciarHighlightPostPartido(resp.clip);
        }
    }

    function iniciarHighlightPostPartido(clip) {
        if (!window.RepeticionOnline || !estado.sala || !clip || !Array.isArray(clip.frames) || !clip.frames.length) return;
        soltarTeclas();
        reiniciarRed();
        dibujante.reiniciarEfectos();
        clearTimeout(estado.cartelTimeout);
        if ($('cartelGol')) $('cartelGol').hidden = true;
        ajustarCanvas(estado.sala.mapa);

        const progInicial = window.RepeticionOnline.evaluarProgresoReplay(clip, 0);
        estado.replay = {
            clip,
            elapsedMs: 0,
            serverRt: 0,
            serverRtAt: performance.now(),
            sonidoPatadaEmitido: progInicial.frameIndex >= clip.kickIdx,
            sonidoGolEmitido: progInicial.frameIndex >= clip.goalIdx,
            votos: 0,
            requeridos: 1,
            total: 1,
            votantes: [],
            enviandoVoto: false,
            enCamaraLenta: !!progInicial.enCamaraLenta,
            esHighlightPostPartido: true
        };

        const autorEl = $('replayAutor');
        if (autorEl) {
            const gol = clip.ultimoGol;
            if (gol && gol.autor) {
                autorEl.textContent = gol.enContra ? `· ${gol.autor} (En contra)` : `· Gol de ${gol.autor}`;
            } else if (gol) {
                autorEl.textContent = gol.equipo === 'red' ? '· Gol Rojo' : '· Gol Azul';
            } else {
                autorEl.textContent = '';
            }
        }

        const keyEl = $('replaySkipKey');
        const textEl = $('replaySkipText');
        const countEl = $('replaySkipCount');
        const btn = $('btnSkipReplay');
        if (keyEl) keyEl.textContent = 'ESPACIO / ESC';
        if (textEl) textEl.textContent = 'VOLVER';
        if (countEl) countEl.hidden = true;
        if (btn) {
            btn.classList.remove('replay-skip-btn--votado');
            btn.disabled = false;
            btn.title = 'Volver al resumen del partido';
        }

        const slowBadge = $('replaySlowBadge');
        if (slowBadge) slowBadge.hidden = !progInicial.enCamaraLenta;
        const overlay = $('replayOverlay');
        if (overlay) overlay.hidden = false;

        mostrarPanel(false);
    }

    function cerrarHighlightPostPartido() {
        limpiarReplay();
        reiniciarRed();
        dibujante.reiniciarEfectos();
        cambiarTab('sala');
        mostrarPanel(true);
    }

    function dibujarGolesLobby(sala) {
        const cont = $('lobbyGoles');
        const lista = $('lobbyGolesLista');
        if (!cont || !lista) return;

        const resultado = sala && sala.ultimoResultado;
        const goles = resultado && Array.isArray(resultado.goles) ? resultado.goles : [];
        lista.textContent = '';
        if (!goles.length) {
            cont.hidden = true;
            return;
        }

        cont.hidden = false;
        const enPartido = !!(sala && sala.partido);
        goles.forEach((gol, indice) => {
            const minTexto = gol.minuto ? `${gol.minuto}'${gol.extra ? '+' : ''}` : '';
            const autorTexto = `${gol.autor || 'Gol'}${gol.enContra ? ' (EC)' : ''}${gol.golazo ? ' ★' : ''}`;
            const puedeVer = !enPartido && !!gol.tieneReplay;
            const chip = crearElemento(
                puedeVer ? 'button' : 'span',
                `lobby-goal-chip lobby-goal-chip--${gol.equipo === 'blue' ? 'blue' : 'red'}`
            );
            if (puedeVer) {
                chip.type = 'button';
                chip.dataset.golIndice = String(indice);
                chip.setAttribute('aria-label', `Ver replay del gol de ${gol.autor || 'jugador'} ${minTexto}`.trim());
                chip.title = 'Click para ver el replay del gol';
                chip.addEventListener('click', () => verGolReplayPostPartido(indice));
            }
            if (minTexto) chip.appendChild(crearElemento('span', 'lobby-goal-chip__min', minTexto));
            chip.appendChild(crearElemento('span', 'lobby-goal-chip__autor', autorTexto));
            if (puedeVer) chip.appendChild(crearElemento('span', 'lobby-goal-chip__play', '▶'));
            lista.appendChild(chip);
        });
    }

    function limpiarSpecReplay() {
        const sr = estado.specReplay;
        sr.abierto = false;
        sr.replegado = false;
        sr.pausado = false;
        sr.resultadoClave = '';
        sr.goles = [];
        sr.indice = 0;
        sr.elapsedMs = 0;
        sr.enCamaraLenta = false;
        sr.camara = null;
        sr.clips.clear();
        sr.cargandoIndice = null;
        sr.idleClave = '';
        if (dibujanteSpecReplay) dibujanteSpecReplay.reiniciarEfectos();
        const box = $('specReplayBox');
        if (box) {
            box.hidden = true;
            box.classList.remove('spec-replay--replegado');
        }
        const specCol = document.querySelector('.online-equipo--spec');
        if (specCol) {
            specCol.classList.remove('online-equipo--spec-con-replay', 'online-equipo--spec-replegado');
        }
        const slow = $('specReplaySlow');
        if (slow) slow.hidden = true;
    }

    function ajustarCanvasSpecReplay(mapa) {
        if (!specReplayCanvas || !mapa || !mapa.width || !mapa.height) return;
        const objetivoW = Math.min(Math.max(1, mapa.width), 520);
        const objetivoH = Math.max(1, Math.round(mapa.height * (objetivoW / Math.max(1, mapa.width))));
        if (specReplayCanvas.width !== objetivoW || specReplayCanvas.height !== objetivoH) {
            specReplayCanvas.width = objetivoW;
            specReplayCanvas.height = objetivoH;
            specReplayCanvas.style.aspectRatio = `${mapa.width} / ${mapa.height}`;
            if (dibujanteSpecReplay) dibujanteSpecReplay.reiniciarEfectos();
        }
    }

    async function cargarClipSpecReplay(posicion) {
        const sr = estado.specReplay;
        const gol = sr.goles[posicion];
        if (!gol || sr.clips.has(gol.indiceOriginal)) return;
        const claveEsperada = sr.resultadoClave;
        sr.cargandoIndice = gol.indiceOriginal;
        const resp = await accion('sala:verGolReplay', { indice: gol.indiceOriginal });
        if (sr.resultadoClave !== claveEsperada) return;
        if (sr.cargandoIndice === gol.indiceOriginal) sr.cargandoIndice = null;
        if (resp && resp.ok && resp.clip) {
            sr.clips.set(gol.indiceOriginal, resp.clip);
            if (sr.goles[sr.indice] && sr.goles[sr.indice].indiceOriginal === gol.indiceOriginal) {
                sr.elapsedMs = 0;
                sr.camara = null;
                if (dibujanteSpecReplay) dibujanteSpecReplay.reiniciarEfectos();
            }
        }
    }

    function actualizarUiSpecReplay() {
        const sr = estado.specReplay;
        const box = $('specReplayBox');
        const body = $('specReplayBody');
        const toggle = $('specReplayToggle');
        const specCol = document.querySelector('.online-equipo--spec');
        if (!box) return;

        if (!sr.abierto || !sr.goles.length) {
            box.hidden = true;
            if (specCol) {
                specCol.classList.remove('online-equipo--spec-con-replay', 'online-equipo--spec-replegado');
            }
            return;
        }

        box.hidden = false;
        box.classList.toggle('spec-replay--replegado', sr.replegado);
        if (specCol) {
            specCol.classList.add('online-equipo--spec-con-replay');
            specCol.classList.toggle('online-equipo--spec-replegado', sr.replegado);
        }
        if (body) body.hidden = sr.replegado;
        if (toggle) {
            toggle.setAttribute('aria-expanded', sr.replegado ? 'false' : 'true');
            toggle.textContent = sr.replegado ? 'Ver goles ▴' : 'Replegar ▾';
            toggle.title = sr.replegado
                ? 'Expandir repeticiones de goles del partido'
                : 'Replegar repeticiones para ver más espectadores';
        }

        const total = sr.goles.length;
        const nav = window.RepeticionOnline
            ? window.RepeticionOnline.navegarIndiceGol(sr.indice, 0, total)
            : { indice: Math.min(sr.indice, total - 1), puedeAnterior: sr.indice > 0, puedeSiguiente: sr.indice < total - 1 };
        sr.indice = nav.indice;
        const gol = sr.goles[sr.indice];
        const etiqueta = window.RepeticionOnline
            ? window.RepeticionOnline.formatearEtiquetaGol(gol, sr.indice, total)
            : { titulo: `Gol ${sr.indice + 1}/${total}`, detalle: gol && gol.autor ? `Gol de ${gol.autor}` : 'Gol', minuto: '' };

        const resumenEl = $('specReplayResumen');
        if (resumenEl) {
            resumenEl.textContent = sr.replegado
                ? `Goles (${total}) · ${etiqueta.detalle}`
                : `Repetición (${total} ${total === 1 ? 'gol' : 'goles'})`;
        }

        const badgeEl = $('specReplayBadge');
        if (badgeEl) {
            badgeEl.textContent = etiqueta.titulo;
            badgeEl.className = `spec-replay__badge spec-replay__badge--${gol && gol.equipo === 'blue' ? 'blue' : 'red'}`;
        }

        const autorEl = $('specReplayAutor');
        if (autorEl) autorEl.textContent = etiqueta.detalle;

        const minEl = $('specReplayMinuto');
        if (minEl) minEl.textContent = etiqueta.minuto;

        const prevBtn = $('specReplayPrev');
        if (prevBtn) prevBtn.disabled = !nav.puedeAnterior;

        const nextBtn = $('specReplayNext');
        if (nextBtn) nextBtn.disabled = !nav.puedeSiguiente;

        const playBtn = $('specReplayPlayPause');
        if (playBtn) {
            playBtn.textContent = sr.pausado ? '▶' : '⏸';
            playBtn.setAttribute('aria-label', sr.pausado ? 'Reanudar repetición' : 'Pausar repetición');
            playBtn.title = sr.pausado ? 'Reanudar' : 'Pausar';
        }

        const slowEl = $('specReplaySlow');
        if (slowEl) slowEl.hidden = sr.replegado || !sr.enCamaraLenta;
    }

    function cambiarGolSpecReplay(delta) {
        const sr = estado.specReplay;
        if (!sr.abierto || !sr.goles.length || !window.RepeticionOnline) return;
        const nav = window.RepeticionOnline.navegarIndiceGol(sr.indice, delta, sr.goles.length);
        if (nav.indice === sr.indice) return;
        sr.indice = nav.indice;
        sr.elapsedMs = 0;
        sr.enCamaraLenta = false;
        sr.pausado = false;
        sr.camara = null;
        sr.idleClave = '';
        if (dibujanteSpecReplay) dibujanteSpecReplay.reiniciarEfectos();
        actualizarUiSpecReplay();
        cargarClipSpecReplay(sr.indice);
    }

    function toggleReplegarSpecReplay(forzarReplegado = null) {
        const sr = estado.specReplay;
        if (!sr.abierto) return;
        sr.replegado = typeof forzarReplegado === 'boolean' ? forzarReplegado : !sr.replegado;
        if (!sr.replegado) {
            sr.idleClave = '';
            cargarClipSpecReplay(sr.indice);
        }
        actualizarUiSpecReplay();
    }

    function dibujarSpecReplayLobby(sala) {
        const sr = estado.specReplay;
        const resultado = sala && sala.ultimoResultado;
        const golesBase = resultado && Array.isArray(resultado.goles) ? resultado.goles : [];
        const golesConClip = window.RepeticionOnline
            ? window.RepeticionOnline.filtrarGolesConReplay(golesBase)
            : [];

        if (!sala || sala.partido || !golesConClip.length) {
            sr.abierto = false;
            sr.enCamaraLenta = false;
            actualizarUiSpecReplay();
            return;
        }

        const firmaFallback = `${golesConClip.length}|${golesConClip.map(g => `${g.indiceOriginal}:${g.minuto}:${g.autor || ''}`).join(',')}`;
        const clave = resultado && resultado.resultadoId
            ? `res:${resultado.resultadoId}`
            : firmaFallback;

        if (sr.resultadoClave !== clave) {
            sr.resultadoClave = clave;
            sr.goles = golesConClip;
            sr.indice = 0;
            sr.replegado = false;
            sr.pausado = false;
            sr.elapsedMs = 0;
            sr.enCamaraLenta = false;
            sr.camara = null;
            sr.clips.clear();
            sr.cargandoIndice = null;
            sr.idleClave = '';
            if (dibujanteSpecReplay) dibujanteSpecReplay.reiniciarEfectos();
        } else {
            sr.goles = golesConClip;
        }

        sr.abierto = true;
        ajustarCanvasSpecReplay(sala.mapa);
        actualizarUiSpecReplay();
        if (!sr.replegado) {
            cargarClipSpecReplay(sr.indice);
        }
    }

    function actualizarSpecReplay(delta) {
        const sr = estado.specReplay;
        if (!dibujanteSpecReplay || !estado.sala || estado.sala.partido) return;
        if (!sr.abierto || sr.replegado || !sr.goles.length) return;

        ajustarCanvasSpecReplay(estado.sala.mapa);
        const gol = sr.goles[sr.indice];
        const clip = gol ? sr.clips.get(gol.indiceOriginal) : null;

        if (!clip || !window.RepeticionOnline || !Array.isArray(clip.frames) || !clip.frames.length) {
            const mapa = estado.sala.mapa;
            const clave = `${mapa.id}|${mapa.width}|${mapa.height}`;
            if (sr.idleClave !== clave) {
                sr.idleClave = clave;
                dibujanteSpecReplay.dibujar(DibujoOnline.estadoVacio(mapa), 0, null, null);
            }
            if (gol && sr.cargandoIndice !== gol.indiceOriginal) {
                cargarClipSpecReplay(sr.indice);
            }
            return;
        }

        sr.idleClave = '';
        if (!sr.pausado) {
            sr.elapsedMs += delta;
            if (sr.elapsedMs >= clip.duracionMs) {
                sr.elapsedMs = 0;
                sr.camara = null;
                dibujanteSpecReplay.reiniciarEfectos();
            }
        }
        sr.elapsedMs = Math.min(clip.duracionMs, Math.max(0, sr.elapsedMs));

        const prog = window.RepeticionOnline.evaluarProgresoReplay(clip, sr.elapsedMs);
        const frameInterp = window.RepeticionOnline.interpolarFrameReplay(clip.frames, prog);
        if (sr.enCamaraLenta !== prog.enCamaraLenta) {
            sr.enCamaraLenta = prog.enCamaraLenta;
            const slowEl = $('specReplaySlow');
            if (slowEl) slowEl.hidden = !prog.enCamaraLenta;
        }

        let impactoLento = 0;
        if (prog.enCamaraLenta && prog.frameIndex >= clip.kickIdx) {
            const spanLento = Math.max(1, clip.slowEndIdx - clip.kickIdx);
            impactoLento = Math.min(1, Math.max(0.01, (prog.frameIndex - clip.kickIdx + prog.t) / spanLento));
        }

        const dibujoReplay = estadoParaDibujarReplay(frameInterp, clip);
        let camara = null;
        if (window.CamaraOnline && dibujoReplay.mapa) {
            const foco = dibujoReplay.ball || { x: dibujoReplay.mapa.width / 2, y: dibujoReplay.mapa.height / 2 };
            sr.camara = window.CamaraOnline.actualizarCamaraReplay(
                sr.camara,
                dibujoReplay.mapa,
                foco,
                1,
                prog.enCamaraLenta,
                sr.pausado ? 0 : delta
            );
            camara = sr.camara;
        }
        dibujanteSpecReplay.dibujar(
            dibujoReplay,
            sr.pausado ? 0 : delta * prog.velocidad,
            null,
            camara,
            { camaraLenta: prog.enCamaraLenta, impactoLento }
        );
    }

    function dibujarUltimoResultado(sala) {
        const resultado = sala.ultimoResultado;
        renderizarTarjetasPuntuacion(resultado && resultado.puntuacion);
        dibujarGolesLobby(sala);
        dibujarSpecReplayLobby(sala);
    }

    /* ========================= */
    /* SELECTOR FIFA DE CLUBES   */
    /* ========================= */

    function abrirSelectorClubes(equipo) {
        if (!soyAdmin() || !estado.sala || !window.ClubesLaChaula) return;
        estado.clubObjetivoEquipo = equipo === 'blue' ? 'blue' : 'red';
        estado.clubLigaFiltro = 'Todas';
        estado.clubBusqueda = '';
        if ($('fifaBuscar')) $('fifaBuscar').value = '';
        if ($('fifaTitulo')) {
            $('fifaTitulo').textContent = estado.clubObjetivoEquipo === 'red'
                ? 'CLUB EQUIPO ROJO'
                : 'CLUB EQUIPO AZUL';
        }
        renderizarSelectorClubes();
        $('dialogoClubes').showModal();
        if ($('fifaBuscar')) $('fifaBuscar').focus();
    }

    function renderizarSelectorClubes() {
        if (!window.ClubesLaChaula) return;
        const contLigas = $('fifaLigas');
        const grid = $('fifaGrid');
        if (!contLigas || !grid) return;

        const ligas = ['Todas', ...Array.from(new Set(window.ClubesLaChaula.CLUBES.map(c => c.liga)))];
        contLigas.textContent = '';
        ligas.forEach(liga => {
            const btn = crearElemento('button', 'fifa-liga-btn', liga);
            btn.type = 'button';
            btn.setAttribute('role', 'tab');
            const activa = estado.clubLigaFiltro === liga;
            btn.classList.toggle('fifa-liga-btn--activa', activa);
            btn.setAttribute('aria-selected', String(activa));
            btn.addEventListener('click', () => {
                estado.clubLigaFiltro = liga;
                renderizarSelectorClubes();
            });
            contLigas.appendChild(btn);
        });

        const clubsCfg = (estado.sala && estado.sala.config && estado.sala.config.clubes) || { red: 'boca', blue: 'river' };
        const elegidoId = clubsCfg[estado.clubObjetivoEquipo];
        const q = estado.clubBusqueda.trim().toLowerCase();

        const filtrados = window.ClubesLaChaula.CLUBES.filter(c => {
            if (estado.clubLigaFiltro !== 'Todas' && c.liga !== estado.clubLigaFiltro) return false;
            if (q && !`${c.nombre} ${c.sigla} ${c.liga}`.toLowerCase().includes(q)) return false;
            return true;
        });

        grid.textContent = '';
        if (!filtrados.length) {
            grid.appendChild(crearElemento('p', 'online-miniaturas__vacio', 'No se encontraron clubes con ese filtro.'));
            return;
        }

        filtrados.forEach(club => {
            const card = crearElemento('button', 'fifa-club-card');
            card.type = 'button';
            card.setAttribute('role', 'option');
            card.style.setProperty('--club-accent', club.primario || '#fbbf24');
            const elegido = club.id === elegidoId;
            card.classList.toggle('fifa-club-card--elegido', elegido);
            card.setAttribute('aria-selected', String(elegido));
            card.setAttribute('aria-label', `${club.nombre} (${club.liga})`);

            const ribbon = crearElemento('span', 'fifa-club-ribbon');
            ribbon.setAttribute('aria-hidden', 'true');

            const crestWrap = crearElemento('span', 'fifa-club-crest-wrap');
            const img = crearElemento('img');
            img.alt = `Escudo de ${club.nombre}`;
            aplicarEscudoImg(img, club);
            crestWrap.appendChild(img);

            const pill = crearElemento('span', 'fifa-club-nombre', club.nombre);

            card.append(
                ribbon,
                crestWrap,
                pill,
                crearElemento('span', 'fifa-club-liga', `${club.liga} · ${club.sigla}`)
            );
            card.addEventListener('click', () => {
                const clubes = {
                    ...(estado.sala && estado.sala.config && estado.sala.config.clubes),
                    [estado.clubObjetivoEquipo]: club.id
                };
                accion('sala:config', { clubes });
                $('dialogoClubes').close();
            });
            grid.appendChild(card);
        });
    }

    if ($('btnEscudoRojo')) $('btnEscudoRojo').addEventListener('click', () => abrirSelectorClubes('red'));
    if ($('btnEscudoAzul')) $('btnEscudoAzul').addEventListener('click', () => abrirSelectorClubes('blue'));
    if ($('cerrarClubes')) $('cerrarClubes').addEventListener('click', () => $('dialogoClubes').close());
    if ($('fifaBuscar')) {
        $('fifaBuscar').addEventListener('input', evento => {
            estado.clubBusqueda = evento.target.value || '';
            renderizarSelectorClubes();
        });
    }

    /* ========================= */
    /* CONTROLES DE PARTIDA      */
    /* ========================= */

    ['cfgTiempo', 'cfgGoles'].forEach(id => {
        $(id).addEventListener('change', evento => {
            const clave = { cfgTiempo: 'tiempoMin', cfgGoles: 'goles' }[id];
            accion('sala:config', { [clave]: Number(evento.target.value) });
            evento.target.blur();
        });
    });
    $('cfgModo').addEventListener('change', evento => {
        accion('sala:config', { modo: evento.target.value });
        evento.target.blur();
    });
    $('cfgCombinar').addEventListener('change', evento => accion('sala:config', { combinarPoderes: evento.target.checked }));
    $('cfgBloqueo').addEventListener('change', evento => accion('sala:config', { equiposBloqueados: evento.target.checked }));

    TIPOS_POWERUP.forEach(({ id, btnId }) => {
        const btn = $(btnId);
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (!estado.sala || !soyAdmin() || estado.sala.partido) return;
            const cfg = estado.sala.config;
            const actualModo = cfg.potenciadoresModo || (cfg.powerUps ? 'aleatorio' : 'desactivado');
            const actuales = new Set(Array.isArray(cfg.potenciadoresActivos) ? cfg.potenciadoresActivos : ['SUPER_KICK', 'BIG', 'SPEED']);
            if (actualModo === 'desactivado') {
                actuales.add(id);
                accion('sala:config', {
                    potenciadoresActivos: Array.from(actuales),
                    potenciadoresModo: 'determinado'
                });
                return;
            }
            if (actuales.has(id)) actuales.delete(id);
            else actuales.add(id);
            const lista = Array.from(actuales);
            if (!lista.length) {
                accion('sala:config', { potenciadoresActivos: [], potenciadoresModo: 'desactivado' });
            } else {
                accion('sala:config', { potenciadoresActivos: lista });
            }
        });
    });

    document.querySelectorAll('#cfgModoPotenciadores .mode-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!estado.sala || !soyAdmin() || estado.sala.partido) return;
            const nuevoModo = btn.dataset.pumode;
            const cfg = estado.sala.config;
            const activos = Array.isArray(cfg.potenciadoresActivos) ? cfg.potenciadoresActivos : [];
            const payload = { potenciadoresModo: nuevoModo };
            if (nuevoModo !== 'desactivado' && activos.length === 0) {
                payload.potenciadoresActivos = ['SUPER_KICK', 'BIG', 'SPEED'];
            }
            accion('sala:config', payload);
        });
    });

    document.querySelectorAll('#cfgVisibilidadSala .mode-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!estado.sala || !soyAdmin()) return;
            const privada = btn.dataset.privada === 'true';
            accion('sala:config', { privada });
        });
    });

    if ($('cfgClaveSala')) {
        $('cfgClaveSala').addEventListener('change', evento => {
            if (!estado.sala || !soyAdmin()) return;
            accion('sala:config', { clave: evento.target.value });
            evento.target.blur();
        });
    }

    if ($('hudBtnPausa')) $('hudBtnPausa').addEventListener('click', () => accion('partido:pausa'));
    if ($('hudBtnDetener')) $('hudBtnDetener').addEventListener('click', () => accion('partido:detener'));
    if ($('hudBtnPelota')) {
        $('hudBtnPelota').addEventListener('click', evento => {
            evento.currentTarget.blur();
            if (!estado.sala || !estado.sala.partido || !estado.sala.partido.practica) return;
            const yo = estado.sala.jugadores.find(j => j.id === estado.tuId);
            if (!yo || (yo.equipo !== 'red' && yo.equipo !== 'blue')) return;
            accion('practica:pelota');
        });
    }
    if ($('btnPractica')) {
        $('btnPractica').addEventListener('click', () => {
            if (estado.sala && estado.sala.partido && estado.sala.partido.practica) {
                accion('partido:detener');
            } else {
                accion('partido:iniciar', { practica: true });
            }
        });
    }
    if ($('specReplayPrev')) $('specReplayPrev').addEventListener('click', () => cambiarGolSpecReplay(-1));
    if ($('specReplayNext')) $('specReplayNext').addEventListener('click', () => cambiarGolSpecReplay(1));
    if ($('specReplayToggle')) $('specReplayToggle').addEventListener('click', () => toggleReplegarSpecReplay());
    if ($('specReplayPlayPause')) {
        $('specReplayPlayPause').addEventListener('click', () => {
            const sr = estado.specReplay;
            if (!sr.abierto) return;
            sr.pausado = !sr.pausado;
            actualizarUiSpecReplay();
        });
    }
    if ($('specReplayAmpliar')) {
        $('specReplayAmpliar').addEventListener('click', () => {
            const sr = estado.specReplay;
            const gol = sr.goles[sr.indice];
            if (gol) verGolReplayPostPartido(gol.indiceOriginal);
        });
    }
    $('iniciarDetener').addEventListener('click', async () => {
        if (!estado.sala) return;
        const partido = estado.sala.partido;
        if (partido && !partido.practica) {
            const estabaPausado = !!partido.pausado;
            await accion('partido:pausa');
            if (estabaPausado) mostrarPanel(false);
        } else {
            await accion('partido:iniciar');
        }
    });

    function mostrarPanel(visible) {
        estado.panelVisible = visible;
        const panel = $('panelSala');
        panel.hidden = !visible;
        if (visible) {
            panel.style.animation = 'none';
            void panel.offsetWidth;
            panel.style.animation = '';
            soltarTeclas();
            if (estado.tabActiva === 'estadios') {
                dibujarPreview(true);
            }
        } else if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
        actualizarEstadoBody();
    }

    $('botonPanel').addEventListener('click', () => {
        if (estado.replay && estado.replay.esHighlightPostPartido) {
            cerrarHighlightPostPartido();
            return;
        }
        mostrarPanel(!estado.panelVisible);
    });

    /* ========================= */
    /* CHAT                      */
    /* ========================= */

    socket.on('sala:chat', mensaje => {
        const contenedor = $('chatMensajes');
        const linea = crearElemento('p', mensaje.sistema ? 'online-chat__sistema' : 'online-chat__mensaje');
        if (!mensaje.sistema) {
            const autor = crearElemento('strong', `online-chat__autor online-chat__autor--${mensaje.equipo || 'spec'}`, `${mensaje.admin ? '★ ' : ''}${mensaje.de}: `);
            linea.appendChild(autor);
        }
        linea.appendChild(document.createTextNode(mensaje.texto));
        contenedor.appendChild(linea);
        while (contenedor.children.length > 150) contenedor.removeChild(contenedor.firstChild);
        contenedor.scrollTop = contenedor.scrollHeight;
    });

    $('formChat').addEventListener('submit', evento => {
        evento.preventDefault();
        const texto = $('chatTexto').value.trim();
        $('chatTexto').value = '';
        $('chatTexto').blur();
        // Como en HaxBall: "/avatar XX" cambia lo que se ve en tu círculo ("/avatar" solo lo saca).
        const comando = texto.match(/^\/avatar(?:\s+(.*))?$/i);
        if (comando) {
            cambiarAvatar(comando[1] || '');
            return;
        }
        // "/extrapolation 50" (como HaxBall) o "/extrapolacion 50"; "/zoom 3".
        const extrapolacion = texto.match(/^\/extrapola(?:tion|cion|ción)(?:\s+(-?\d+))?$/i);
        if (extrapolacion) {
            if (extrapolacion[1] === undefined) avisarAjuste(`Extrapolación: ${estado.extrapolacion} ms (de 0 a ${MAX_EXTRAPOLACION})`);
            else cambiarExtrapolacion(Number(extrapolacion[1]));
            return;
        }
        const zoom = texto.match(/^\/zoom(?:\s+(\d))?$/i);
        if (zoom) {
            if (zoom[1] === undefined) avisarAjuste(`${NOMBRE_ZOOM[estado.zoomNivel]} (teclas 0 a 7)`);
            else cambiarZoom(Number(zoom[1]));
            return;
        }
        if (texto) accion('sala:chat', { texto });
    });

    $('chatTexto').addEventListener('focus', () => {
        soltarTeclas();
        avisarEscribiendo(true);
    });
    $('chatTexto').addEventListener('blur', () => avisarEscribiendo(false));

    // Globito de "escribiendo" arriba de tu jugador (solo se manda cuando cambia).
    let escribiendoAvisado = false;
    function avisarEscribiendo(si) {
        if (!estado.salaId || escribiendoAvisado === si) return;
        escribiendoAvisado = si;
        socket.emit('sala:escribiendo', { si });
    }

    /* ========================= */
    /* NOTIFICACIONES EN VIVO    */
    /* ========================= */

    function limpiarNotificaciones() {
        const cont = $('notificacionesPartido');
        if (cont) cont.textContent = '';
    }

    function mostrarNotificacionJugada(notif) {
        if (estado.sala && estado.sala.partido && estado.sala.partido.practica) return;
        const cont = $('notificacionesPartido');
        if (!cont || !notif || !notif.tipo) return;
        if (!['atajada', 'asistencia', 'tiro', 'gol', 'golazo'].includes(notif.tipo)) return;

        // Cuando se convierte un gol, no mostrar 2 notificaciones: limpiar cualquier aviso previo.
        if (notif.tipo === 'gol' || notif.tipo === 'golazo') {
            cont.textContent = '';
        }

        const iconoTipo = notif.tipo === 'atajada'
            ? 'guantes'
            : (notif.tipo === 'asistencia' ? 'botines' : 'pelota');
        const toast = crearElemento('div', `notif-evento notif-evento--${notif.tipo}`);
        const icono = crearElemento('span', 'notif-evento__icono');
        icono.appendChild(crearSvgStat(iconoTipo));

        const autorNombre = notif.autor || notif.jugador || '';
        const textoWrap = crearElemento('div', 'notif-evento__texto');
        textoWrap.append(crearElemento('span', 'notif-evento__titulo', notif.titulo || notif.tipo.toUpperCase()));
        if (autorNombre) {
            textoWrap.appendChild(crearElemento('span', 'notif-evento__autor', autorNombre));
        }

        const pts = crearElemento('span', 'notif-evento__pts', `+${notif.puntos || 0}`);
        toast.append(icono, textoWrap, pts);
        cont.appendChild(toast);

        while (cont.children.length > 2) {
            cont.removeChild(cont.firstChild);
        }
        setTimeout(() => {
            if (toast.parentNode === cont) cont.removeChild(toast);
        }, 2500);
    }

    socket.on('partido:notificacion', mostrarNotificacionJugada);

    /* ========================= */
    /* PARTIDO                   */
    /* ========================= */

    socket.on('partido:inicio', ({ mapa }) => {
        estado.enGameover = false;
        limpiarReplay();
        if (estado.sala) estado.sala.mapa = mapa;
        ajustarCanvas(mapa);
        dibujante.reiniciarEfectos();
        reiniciarRed();
        limpiarNotificaciones();
        sonar('silbato');
        mostrarPanel(false);
    });

    function reiniciarRed() {
        linea.reiniciar();
        prediccion.reiniciar();
    }

    function limpiarReplay() {
        const habia = !!estado.replay;
        estado.replay = null;
        const overlay = $('replayOverlay');
        if (overlay) overlay.hidden = true;
        const slowBadge = $('replaySlowBadge');
        if (slowBadge) slowBadge.hidden = true;
        const keyEl = $('replaySkipKey');
        if (keyEl) keyEl.textContent = 'ESPACIO';
        const textEl = $('replaySkipText');
        if (textEl) textEl.textContent = 'SALTAR';
        const countEl = $('replaySkipCount');
        if (countEl) countEl.hidden = false;
        const btn = $('btnSkipReplay');
        if (btn) {
            btn.classList.remove('replay-skip-btn--votado');
            btn.disabled = false;
        }
        if (habia) {
            dibujante.reiniciarEfectos();
            actualizarEstadoBody();
        }
    }

    function actualizarUiVotosReplay() {
        const rep = estado.replay;
        const btn = $('btnSkipReplay');
        const countEl = $('replaySkipCount');
        if (!rep || rep.esHighlightPostPartido || !btn || !countEl) return;

        countEl.hidden = false;
        const elegible = window.RepeticionOnline && estado.sala
            ? window.RepeticionOnline.esElegibleSkip(estado.sala.jugadores, estado.tuId)
            : true;
        const yaVoto = Array.isArray(rep.votantes) && rep.votantes.includes(estado.tuId);
        const votos = Math.max(0, Number(rep.votos) || 0);
        const requeridos = Math.max(1, Number(rep.requeridos) || 1);

        countEl.textContent = `${yaVoto ? '✓ ' : ''}${votos}/${requeridos}`;
        btn.classList.toggle('replay-skip-btn--votado', yaVoto);
        btn.disabled = !elegible || yaVoto || !!rep.enviandoVoto;
        btn.title = !elegible
            ? 'Solo los jugadores en cancha pueden votar para saltar'
            : (yaVoto ? 'Ya votaste para saltar el replay' : 'Presioná Espacio o click para saltar el replay');
    }

    async function votarSkipReplay() {
        const rep = estado.replay;
        if (!rep) return;
        if (rep.esHighlightPostPartido) {
            cerrarHighlightPostPartido();
            return;
        }
        if (rep.enviandoVoto) return;
        if (Array.isArray(rep.votantes) && rep.votantes.includes(estado.tuId)) return;
        if (window.RepeticionOnline && estado.sala && !window.RepeticionOnline.esElegibleSkip(estado.sala.jugadores, estado.tuId)) {
            return;
        }
        rep.enviandoVoto = true;
        actualizarUiVotosReplay();
        const resp = await pedir('partido:skipReplay', {});
        if (!estado.replay || estado.replay !== rep) return;
        rep.enviandoVoto = false;
        if (resp && resp.ok) {
            rep.votos = Number(resp.votos) || rep.votos;
            rep.requeridos = Number(resp.requeridos) || rep.requeridos;
            rep.total = Number(resp.total) || rep.total;
            if (Array.isArray(resp.votantes)) rep.votantes = resp.votantes;
            if (!resp.votantes || !resp.votantes.includes(estado.tuId)) {
                rep.votantes = [...(rep.votantes || []), estado.tuId];
            }
        }
        actualizarUiVotosReplay();
    }

    socket.on('partido:repeticion', data => {
        if (!window.RepeticionOnline || !data || !data.clip || !Array.isArray(data.clip.frames) || !data.clip.frames.length) {
            return;
        }
        soltarTeclas();
        reiniciarRed();
        dibujante.reiniciarEfectos();
        clearTimeout(estado.cartelTimeout);
        if ($('cartelGol')) $('cartelGol').hidden = true;

        const elapsedMs = Math.max(0, Number(data.elapsedMs) || 0);
        const clip = data.clip;
        const progInicial = window.RepeticionOnline.evaluarProgresoReplay(clip, elapsedMs);

        estado.replay = {
            clip,
            elapsedMs,
            serverRt: elapsedMs,
            serverRtAt: performance.now(),
            sonidoPatadaEmitido: progInicial.frameIndex >= clip.kickIdx,
            sonidoGolEmitido: progInicial.frameIndex >= clip.goalIdx,
            votos: Number(data.votos) || 0,
            requeridos: Number(data.requeridos) || 1,
            total: Number(data.total) || 1,
            votantes: Array.isArray(data.votantes) ? data.votantes : [],
            enviandoVoto: false,
            enCamaraLenta: !!progInicial.enCamaraLenta,
            esHighlightPostPartido: false
        };

        const autorEl = $('replayAutor');
        if (autorEl) {
            const gol = clip.ultimoGol;
            if (gol && gol.autor) {
                autorEl.textContent = gol.enContra ? `· ${gol.autor} (En contra)` : `· Gol de ${gol.autor}`;
            } else if (gol) {
                autorEl.textContent = gol.equipo === 'red' ? '· Gol Rojo' : '· Gol Azul';
            } else {
                autorEl.textContent = '';
            }
        }

        const keyEl = $('replaySkipKey');
        if (keyEl) keyEl.textContent = 'ESPACIO';
        const textEl = $('replaySkipText');
        if (textEl) textEl.textContent = 'SALTAR';
        const countEl = $('replaySkipCount');
        if (countEl) countEl.hidden = false;

        const slowBadge = $('replaySlowBadge');
        if (slowBadge) slowBadge.hidden = !progInicial.enCamaraLenta;
        const overlay = $('replayOverlay');
        if (overlay) overlay.hidden = false;
        actualizarUiVotosReplay();
        actualizarEstadoBody();
    });

    socket.on('partido:replayVotos', data => {
        if (!estado.replay || !data) return;
        estado.replay.votos = Number(data.votos) || 0;
        estado.replay.requeridos = Number(data.requeridos) || 1;
        estado.replay.total = Number(data.total) || 1;
        estado.replay.votantes = Array.isArray(data.votantes) ? data.votantes : [];
        actualizarUiVotosReplay();
    });

    socket.on('partido:repeticionFin', () => {
        limpiarReplay();
        reiniciarRed();
        dibujante.reiniciarEfectos();
    });

    socket.on('partido:estado', foto => {
        linea.agregar(foto);
        if (estado.replay && foto && foto.f === 'REPETICION' && Number.isFinite(foto.rt)) {
            estado.replay.serverRt = foto.rt;
            estado.replay.serverRtAt = performance.now();
            prediccion.reiniciar();
            return;
        }
        // Si jugás, la cancha entera se adelanta al presente desde lo que dice el
        // servidor (ver red.js). Los espectadores miran la foto interpolada.
        const sala = estado.sala;
        const yo = sala && sala.jugadores.find(jugador => jugador.id === estado.tuId);
        if (yo && yo.equipo) {
            const equipos = new Map(sala.jugadores.map(jugador => [jugador.id, jugador.equipo]));
            prediccion.reconciliar(foto, sala.mapa, equipos, estado.tuId, estado.bits);
        } else {
            prediccion.reiniciar();
        }
    });

    socket.on('partido:detenido', () => {
        estado.enGameover = false;
        limpiarReplay();
        reiniciarRed();
        cambiarTab('sala');
        mostrarPanel(true);
    });

    // Mismos efectos 8-bit que el arcade (js/arcade/sonidos.js de develop).
    function sonar(nombre) {
        if (window.Sonidos) window.Sonidos.reproducir(nombre);
    }

    function mostrarCartel(texto, equipo, duracionMs) {
        const cartel = $('cartelGol');
        cartel.textContent = texto;
        cartel.className = `online-cartel online-cartel--${equipo || 'neutro'}`;
        cartel.hidden = false;
        clearTimeout(estado.cartelTimeout);
        estado.cartelTimeout = setTimeout(() => { cartel.hidden = true; }, duracionMs);
    }

    socket.on('partido:evento', evento => {
        const enPractica = !!(estado.sala && estado.sala.partido && estado.sala.partido.practica);
        // El gol se festeja dentro de la cancha (mismo dibujo que el arcade), nunca en práctica.
        if (evento.tipo === 'patada') sonar('patada');
        else if (evento.tipo === 'gol' && !enPractica) sonar('gol');
        else if (evento.tipo === 'saque' && !enPractica) sonar('silbato');
        if (evento.tipo === 'tiempoExtra' && !enPractica) {
            mostrarCartel('¡TIEMPO EXTRA!', null, 2000);
        }
    });

    socket.on('partido:fin', evento => {
        estado.enGameover = true;
        limpiarReplay();
        actualizarEstadoBody();
        const texto = evento.ganador ? `¡GANÓ ${NOMBRE_EQUIPO[evento.ganador].toUpperCase()}!` : '¡EMPATE!';
        const mvpTexto = evento.puntuacion && evento.puntuacion.mvpNombre
            ? ` · MVP: ${evento.puntuacion.mvpNombre}`
            : '';
        mostrarCartel(`${texto} ${evento.marcador.red} - ${evento.marcador.blue}${mvpTexto}`, evento.ganador, 4000);
        sonar('silbato');
        reiniciarRed();
        setTimeout(() => {
            estado.enGameover = false;
            cambiarTab('sala');
            mostrarPanel(true);
        }, 1500);
    });

    function textoFase(foto) {
        if (foto.p) return 'PAUSA';
        if (foto.f === 'REPETICION') return 'REPLAY';
        if (foto.pr) return 'PRÁCTICA';
        if (foto.f === 'SAQUE') return `SAQUE ${foto.s === 'red' ? 'ROJO' : 'AZUL'}`;
        if (foto.f === 'GOL') return '¡GOL!';
        if (foto.f === 'TIEMPO_EXTRA' || foto.x) return 'TIEMPO EXTRA';
        return 'EN VIVO';
    }

    // El marcador se toca solo cuando cambia: escribirlo en cada cuadro obligaba
    // al navegador a recalcular la página 60 veces por segundo.
    const textosHud = {};
    function ponerTextoHud(id, valor) {
        const el = $(id);
        if (!el) return;
        const texto = String(valor);
        if (textosHud[id] === texto) return;
        textosHud[id] = texto;
        el.textContent = texto;
    }

    let ultimaClaveBotonPelota = '';
    function actualizarBotonPelotaPractica(foto) {
        const btn = $('hudBtnPelota');
        if (!btn) return;
        const sala = estado.sala;
        const enPractica = !!(sala && sala.partido && sala.partido.practica);
        const yo = sala && Array.isArray(sala.jugadores) ? sala.jugadores.find(j => j.id === estado.tuId) : null;
        const enCancha = !!(yo && (yo.equipo === 'red' || yo.equipo === 'blue'));
        const visible = enPractica && enCancha;
        const miPelota = visible && foto && Array.isArray(foto.eb)
            ? foto.eb.find(eb => eb[0] === estado.tuId)
            : null;
        const colorPelota = miPelota ? (miPelota[6] || '#38bdf8') : '#38bdf8';
        const clave = `${visible ? 1 : 0}|${miPelota ? 1 : 0}|${colorPelota}`;
        if (ultimaClaveBotonPelota === clave) return;
        ultimaClaveBotonPelota = clave;

        btn.hidden = !visible;
        btn.dataset.hasBall = miPelota ? '1' : '0';
        btn.style.setProperty('--ball-color', colorPelota);
        const textoEl = $('hudBtnPelotaTexto');
        if (textoEl) {
            textoEl.textContent = miPelota ? 'Traer pelota (Q)' : 'Invocar pelota (Q)';
        }
        btn.title = miPelota
            ? 'Teletransportar tu pelota de vuelta a tus pies (Q)'
            : 'Invocar tu pelota personal en tus pies (Q)';
    }

    function actualizarHud(foto) {
        const fallbackMarcador = estado.sala && estado.sala.partido
            ? estado.sala.partido.marcador
            : (estado.sala && estado.sala.ultimoResultado && estado.sala.ultimoResultado.marcador
                ? estado.sala.ultimoResultado.marcador
                : { red: 0, blue: 0 });
        ponerTextoHud('golesRojo', foto ? foto.m[0] : (fallbackMarcador.red || 0));
        ponerTextoHud('golesAzul', foto ? foto.m[1] : (fallbackMarcador.blue || 0));
        ponerTextoHud('reloj', foto ? formatearTiempo(foto.t, !!foto.pr) : '--:--');
        ponerTextoHud('faseTexto', foto ? textoFase(foto) : (estado.sala && estado.sala.partido ? '' : (estado.sala && estado.sala.ultimoResultado ? 'FINAL' : 'ESPERANDO')));
        actualizarBotonPelotaPractica(foto);
    }

    // Arma el "estado" que esperan las funciones de dibujo de develop a partir de la foto del servidor.
    function estadoParaDibujar(foto, prediccionActual) {
        const sala = estado.sala;
        const base = DibujoOnline.estadoVacio(sala.mapa);
        if (!foto) return base;
        const datos = new Map(sala.jugadores.map(jugador => [jugador.id, jugador]));
        const numeros = new Map();
        ['red', 'blue'].forEach(equipo => sala.jugadores
            .filter(jugador => jugador.equipo === equipo)
            .forEach((jugador, indice) => numeros.set(jugador.id, indice + 1)));
        const clubesCfg = (sala.config && sala.config.clubes) || { red: 'boca', blue: 'river' };
        const clubRed = window.ClubesLaChaula ? window.ClubesLaChaula.obtenerClub(clubesCfg.red) : null;
        const clubBlue = window.ClubesLaChaula ? window.ClubesLaChaula.obtenerClub(clubesCfg.blue) : null;
        const enPractica = !!(foto.pr || (sala.partido && sala.partido.practica));
        const clubPractica = (window.ClubesLaChaula && window.ClubesLaChaula.CAMISETA_PRACTICA) || {
            primario: '#ffffff',
            secundario: '#e2e8f0',
            patron: 'solida'
        };

        const pelotaPredicha = prediccionActual && prediccionActual.pelota;
        const colorPelota = (sala.mapa && sala.mapa.ballPhysics && sala.mapa.ballPhysics.color) || null;
        base.ball = pelotaPredicha
            ? { x: pelotaPredicha.x, y: pelotaPredicha.y, r: foto.b[2], color: colorPelota }
            : { x: foto.b[0], y: foto.b[1], r: foto.b[2], color: colorPelota };
        const extrasPred = prediccionActual && Array.isArray(prediccionActual.extraBalls) ? prediccionActual.extraBalls : null;
        base.extraBalls = extrasPred
            ? extrasPred.map(eb => ({ ...eb }))
            : (foto.eb || []).map(([ownerId, x, y, r, _vx, _vy, color]) => ({ ownerId, x, y, r, color }));
        base.activePowerUps = (foto.u || []).map(([x, y, type, r]) => ({ x, y, type, r }));
        base.lastPowerImpact = foto.i ? { id: foto.i[0], x: foto.i[1], y: foto.i[2] } : null;
        base.players = foto.j.map(([id, x, y, r, pateando, power]) => {
            const jugador = datos.get(id) || {};
            const predicho = prediccionActual && prediccionActual.jugadores.get(id);
            if (predicho) {
                x = predicho.x;
                y = predicho.y;
                if (id === estado.tuId) pateando = predicho.pateando;
            }
            return {
                id, x, y, r,
                equipo: jugador.equipo,
                practica: enPractica,
                club: enPractica ? clubPractica : (jugador.equipo === 'red' ? clubRed : (jugador.equipo === 'blue' ? clubBlue : null)),
                pateando: !!pateando,
                activePower: power ? String(power).split('+')[0] : null,
                poderes: power ? Array.from(new Set(String(power).split('+'))) : [],
                niveles: power ? String(power).split('+').reduce((cuenta, tipo) => {
                    cuenta[tipo] = (cuenta[tipo] || 0) + 1;
                    return cuenta;
                }, {}) : {},
                escribiendo: !!jugador.escribiendo,
                nombre: jugador.nombre || '',
                numero: jugador.avatar || numeros.get(id) || '',
                esVos: id === estado.tuId
            };
        });
        return base;
    }

    function estadoParaDibujarReplay(frameInterp, clip) {
        const sala = estado.sala;
        const base = DibujoOnline.estadoVacio(sala.mapa);
        if (!frameInterp) return base;

        const metaMap = new Map();
        (clip && Array.isArray(clip.jugadoresMeta) ? clip.jugadoresMeta : []).forEach(j => metaMap.set(j.id, j));
        (sala.jugadores || []).forEach(j => {
            if (!metaMap.has(j.id)) metaMap.set(j.id, j);
        });

        const numeros = new Map();
        const listaJugadores = Array.from(metaMap.values());
        ['red', 'blue'].forEach(equipo => listaJugadores
            .filter(jugador => jugador.equipo === equipo)
            .forEach((jugador, indice) => numeros.set(jugador.id, indice + 1)));

        const clubesCfg = (sala.config && sala.config.clubes) || { red: 'boca', blue: 'river' };
        const clubRed = window.ClubesLaChaula ? window.ClubesLaChaula.obtenerClub(clubesCfg.red) : null;
        const clubBlue = window.ClubesLaChaula ? window.ClubesLaChaula.obtenerClub(clubesCfg.blue) : null;
        const enPractica = !!(sala.partido && sala.partido.practica);
        const clubPractica = (window.ClubesLaChaula && window.ClubesLaChaula.CAMISETA_PRACTICA) || {
            primario: '#ffffff',
            secundario: '#e2e8f0',
            patron: 'solida'
        };

        const colorPelota = (sala.mapa && sala.mapa.ballPhysics && sala.mapa.ballPhysics.color) || null;
        base.ball = frameInterp.b
            ? { x: frameInterp.b[0], y: frameInterp.b[1], r: frameInterp.b[2], color: colorPelota }
            : null;
        base.activePowerUps = (frameInterp.u || []).map(([x, y, type, r]) => ({ x, y, type, r }));
        base.lastPowerImpact = frameInterp.i ? { id: frameInterp.i[0], x: frameInterp.i[1], y: frameInterp.i[2] } : null;
        base.players = (frameInterp.j || []).map(([id, x, y, r, pateando, power]) => {
            const jugador = metaMap.get(id) || {};
            return {
                id, x, y, r,
                equipo: jugador.equipo,
                practica: enPractica,
                club: enPractica ? clubPractica : (jugador.equipo === 'red' ? clubRed : (jugador.equipo === 'blue' ? clubBlue : null)),
                pateando: !!pateando,
                activePower: power ? String(power).split('+')[0] : null,
                poderes: power ? Array.from(new Set(String(power).split('+'))) : [],
                niveles: power ? String(power).split('+').reduce((cuenta, tipo) => {
                    cuenta[tipo] = (cuenta[tipo] || 0) + 1;
                    return cuenta;
                }, {}) : {},
                escribiendo: false,
                nombre: jugador.nombre || '',
                numero: jugador.avatar || numeros.get(id) || '',
                esVos: id === estado.tuId
            };
        });
        return base;
    }

    function celebracionDe(foto) {
        if (!foto || foto.pr || foto.f !== 'GOL' || !foto.ug) return null;
        const [equipo, autor, enContra] = foto.ug;
        return {
            fase: 'GOL',
            golTranscurridoMs: foto.g || 0,
            duracionGolMs: 1800,
            ultimoGol: { equipo, jugadorId: autor || null, enContra: !!enContra }
        };
    }

    function bucle(ahora) {
        const delta = estado.ultimoDibujo === null ? 0 : ahora - estado.ultimoDibujo;
        estado.ultimoDibujo = ahora;
        if (estado.sala) {
            const ultima = linea.ultima();
            linea.avanzar(delta);

            if (estado.replay && window.RepeticionOnline) {
                const rep = estado.replay;
                const pausado = !rep.esHighlightPostPartido && (!!(ultima && ultima.p) || !!(estado.sala.partido && estado.sala.partido.pausado));
                if (rep.esHighlightPostPartido) {
                    rep.elapsedMs += delta;
                    if (rep.elapsedMs >= rep.clip.duracionMs) {
                        cerrarHighlightPostPartido();
                        requestAnimationFrame(bucle);
                        return;
                    }
                } else if (pausado) {
                    rep.elapsedMs = rep.serverRt;
                } else {
                    rep.elapsedMs += delta;
                    const esperadoRt = rep.serverRt + Math.min(Math.max(ahora - rep.serverRtAt, 0), 150);
                    const desvio = esperadoRt - rep.elapsedMs;
                    if (Math.abs(desvio) > 120) {
                        rep.elapsedMs += desvio * 0.35;
                    }
                }
                rep.elapsedMs = Math.min(rep.clip.duracionMs, Math.max(0, rep.elapsedMs));

                const prog = window.RepeticionOnline.evaluarProgresoReplay(rep.clip, rep.elapsedMs);
                const frameInterp = window.RepeticionOnline.interpolarFrameReplay(rep.clip.frames, prog);

                if (!pausado && !rep.sonidoPatadaEmitido && prog.frameIndex >= rep.clip.kickIdx) {
                    rep.sonidoPatadaEmitido = true;
                    sonar('patada');
                }
                if (!pausado && !rep.sonidoGolEmitido && prog.frameIndex >= rep.clip.goalIdx) {
                    rep.sonidoGolEmitido = true;
                    sonar('gol');
                }

                if (rep.enCamaraLenta !== prog.enCamaraLenta) {
                    rep.enCamaraLenta = prog.enCamaraLenta;
                    const slowBadge = $('replaySlowBadge');
                    if (slowBadge) slowBadge.hidden = !prog.enCamaraLenta;
                    actualizarEstadoBody();
                }

                let impactoLento = 0;
                if (prog.enCamaraLenta && prog.frameIndex >= rep.clip.kickIdx) {
                    const spanLento = Math.max(1, rep.clip.slowEndIdx - rep.clip.kickIdx);
                    impactoLento = Math.min(1, Math.max(0.01, (prog.frameIndex - rep.clip.kickIdx + prog.t) / spanLento));
                }

                const dibujoReplay = estadoParaDibujarReplay(frameInterp, rep.clip);
                const camara = actualizarCamara(dibujoReplay, delta, true, prog.enCamaraLenta);
                dibujante.dibujar(
                    dibujoReplay,
                    pausado ? 0 : delta * prog.velocidad,
                    null,
                    camara,
                    { camaraLenta: prog.enCamaraLenta, impactoLento }
                );
                dibujarMinimapa(dibujoReplay, camara);
                dibujarAvisoAjuste(delta);
                estado.ultimoCanchaIdleClave = '';
                const marcadorFinal = estado.sala.ultimoResultado && estado.sala.ultimoResultado.marcador
                    ? estado.sala.ultimoResultado.marcador
                    : { red: 0, blue: 0 };
                const fotoHud = rep.esHighlightPostPartido
                    ? {
                        f: 'REPETICION',
                        p: false,
                        m: [marcadorFinal.red || 0, marcadorFinal.blue || 0],
                        t: 0,
                        pr: 0
                    }
                    : (ultima && ultima.f === 'REPETICION'
                        ? ultima
                        : {
                            f: 'REPETICION',
                            p: pausado,
                            m: ultima ? ultima.m : [0, 0],
                            t: ultima ? ultima.t : 0,
                            pr: ultima ? ultima.pr : (estado.sala.partido && estado.sala.partido.practica ? 1 : 0)
                        });
                actualizarHud(fotoHud);
                dibujarPreview();
                requestAnimationFrame(bucle);
                return;
            }

            // Tu jugador avanza acá mismo, al instante; cada medio segundo se manda un "ancla".
            if (prediccion.avanzar(delta, estado.bits, !ultima || !!ultima.p) && ultima) mandarTeclas();
            // Jugando se dibuja la cancha predicha (todo en el presente) con los datos de la
            // última foto; mirando, la foto interpolada.
            const prediccionActual = ultima ? prediccion.estadoActual(delta, estado.extrapolacion) : null;
            const foto = prediccionActual ? linea.ultima() : linea.fotoParaDibujar(Math.round(estado.extrapolacion / MS_TICK));
            if (ultima || !estado.panelVisible) {
                const dibujo = estadoParaDibujar(foto, prediccionActual);
                const camara = actualizarCamara(dibujo, delta);
                dibujante.dibujar(dibujo, foto && !foto.p ? delta : 0, celebracionDe(ultima), camara);
                dibujarMinimapa(dibujo, camara);
                dibujarAvisoAjuste(delta);
                estado.ultimoCanchaIdleClave = '';
            } else {
                const mapa = estado.sala.mapa;
                const claveIdle = `${mapa.id}|${mapa.width}|${mapa.height}`;
                if (estado.ultimoCanchaIdleClave !== claveIdle) {
                    estado.ultimoCanchaIdleClave = claveIdle;
                    dibujante.dibujar(DibujoOnline.estadoVacio(mapa), 0, null, null);
                }
                const mini = $('minimapa');
                if (mini) mini.hidden = true;
            }
            if (estado.panelVisible && estado.tabActiva === 'sala' && !estado.sala.partido && estado.specReplay.abierto && !estado.specReplay.replegado) {
                actualizarSpecReplay(delta);
            }
            actualizarHud(ultima);
            dibujarPreview();
        }
        requestAnimationFrame(bucle);
    }

    /* ========================= */
    /* ZOOM, CÁMARA Y MINIMAPA   */
    /* ========================= */

    function zoomDe(mapa) {
        return window.CamaraOnline ? window.CamaraOnline.zoomDe(mapa, estado.zoomNivel) : 1;
    }

    function actualizarCamara(dibujo, delta, seguirPelota = false, enCamaraLenta = false) {
        if (!window.CamaraOnline) return null;
        const propio = seguirPelota ? null : dibujo.players.find(jugador => jugador.esVos);
        const foco = propio || dibujo.ball || { x: dibujo.mapa.width / 2, y: dibujo.mapa.height / 2 };
        const camara = seguirPelota
            ? window.CamaraOnline.actualizarCamaraReplay(estado.camara, dibujo.mapa, foco, estado.zoomNivel, enCamaraLenta, delta)
            : window.CamaraOnline.actualizarCamara(estado.camara, dibujo.mapa, foco, estado.zoomNivel, delta);
        estado.camara = camara;
        const zoomTxt = camara ? camara.zoom.toFixed(2) : '1.00';
        if (document.body.dataset.zoom !== zoomTxt) {
            document.body.dataset.zoom = zoomTxt;
        }
        return camara;
    }

    function dibujarMinimapa(dibujo, camara) {
        const mini = $('minimapa');
        if (!mini || !window.CamaraOnline) return;
        const mostrar = !!(!estado.replay && estado.sala && estado.sala.partido && !estado.panelVisible && window.CamaraOnline.debeMostrarMinimapa(camara));
        if (!mostrar) {
            mini.hidden = true;
            return;
        }

        const mapa = dibujo.mapa;
        const targetW = 240;
        const targetH = Math.max(88, Math.round(targetW * mapa.height / Math.max(1, mapa.width)));
        if (mini.width !== targetW || mini.height !== targetH) {
            mini.width = targetW;
            mini.height = targetH;
            mini.style.aspectRatio = `${mapa.width} / ${mapa.height}`;
        }
        mini.hidden = false;

        const ctx = mini.getContext('2d');
        if (!ctx) return;
        const sx = targetW / Math.max(1, mapa.width);
        const sy = targetH / Math.max(1, mapa.height);
        const field = dibujo.field || { left: 80, right: mapa.width - 80, top: 40, bottom: mapa.height - 40 };

        ctx.clearRect(0, 0, targetW, targetH);

        // Fondo de radar táctico estilo FIFA (translúcido sobre el césped)
        ctx.fillStyle = 'rgba(10, 12, 18, 0.24)';
        ctx.fillRect(0, 0, targetW, targetH);

        const fx = field.left * sx;
        const fy = field.top * sy;
        const fw = (field.right - field.left) * sx;
        const fh = (field.bottom - field.top) * sy;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(fx, fy, fw, fh);

        // Líneas de la cancha
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.42)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(fx, fy, fw, fh);

        const cx = (mapa.width / 2) * sx;
        const cy = (mapa.height / 2) * sy;
        ctx.beginPath();
        ctx.moveTo(cx, fy);
        ctx.lineTo(cx, fy + fh);
        ctx.stroke();

        const radioCentro = Math.max(6, (mapa.radioSaque || mapa.width * 0.085) * sx);
        ctx.beginPath();
        ctx.arc(cx, cy, radioCentro, 0, Math.PI * 2);
        ctx.stroke();

        // Arcos
        const gTop = (dibujo.goalTop || (mapa.height * 0.35)) * sy;
        const gBot = (dibujo.goalBottom || (mapa.height * 0.65)) * sy;
        const prof = Math.max(4, (mapa.profundidadArco || 45) * sx);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
        ctx.fillRect(fx - prof, gTop, prof, gBot - gTop);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
        ctx.fillRect(fx + fw, gTop, prof, gBot - gTop);
        ctx.strokeRect(fx - prof, gTop, prof, gBot - gTop);
        ctx.strokeRect(fx + fw, gTop, prof, gBot - gTop);

        // Power-ups activos
        (dibujo.activePowerUps || []).forEach(pu => {
            ctx.beginPath();
            ctx.arc(pu.x * sx, pu.y * sy, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(253, 224, 71, 0.9)';
            ctx.fill();
        });

        // Jugadores
        (dibujo.players || []).forEach(p => {
            const px = p.x * sx;
            const py = p.y * sy;
            const radio = p.esVos ? 4.4 : 3.5;
            if (p.esVos) {
                ctx.beginPath();
                ctx.arc(px, py, radio + 2.2, 0, Math.PI * 2);
                ctx.strokeStyle = '#ec4899';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(px, py, radio, 0, Math.PI * 2);
            ctx.fillStyle = p.practica ? '#ffffff' : (p.equipo === 'red' ? '#f43f5e' : '#38bdf8');
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.1;
            ctx.stroke();
        });

        // Pelotas extra de práctica
        (dibujo.extraBalls || []).forEach(eb => {
            ctx.beginPath();
            ctx.arc(eb.x * sx, eb.y * sy, 2.8, 0, Math.PI * 2);
            ctx.fillStyle = eb.color || '#38bdf8';
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // Pelota
        if (dibujo.ball) {
            ctx.beginPath();
            ctx.arc(dibujo.ball.x * sx, dibujo.ball.y * sy, 3.1, 0, Math.PI * 2);
            ctx.fillStyle = '#fde047';
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.1;
            ctx.stroke();
        }
    }

    function cambiarZoom(nivel) {
        estado.zoomNivel = Math.min(7, Math.max(0, nivel | 0));
        localStorage.setItem(CLAVE_ZOOM, String(estado.zoomNivel));
        $('cfgZoom').value = String(estado.zoomNivel);
        avisarAjuste(NOMBRE_ZOOM[estado.zoomNivel]);
    }

    function cambiarExtrapolacion(ms) {
        estado.extrapolacion = Math.min(MAX_EXTRAPOLACION, Math.max(0, Math.round(Number(ms) || 0)));
        localStorage.setItem(CLAVE_EXTRAPOLACION, String(estado.extrapolacion));
        $('cfgExtrapolacion').value = String(estado.extrapolacion);
        avisarAjuste(`Extrapolación: ${estado.extrapolacion} ms`);
    }

    function avisarAjuste(texto) {
        estado.avisoAjuste = { texto, restanteMs: 1500 };
    }

    // Cartelito arriba a la izquierda de la cancha cuando cambiás zoom o extrapolación.
    function dibujarAvisoAjuste(delta) {
        const aviso = estado.avisoAjuste;
        if (!aviso) return;
        aviso.restanteMs -= delta;
        if (aviso.restanteMs <= 0) {
            estado.avisoAjuste = null;
            return;
        }
        const contexto = canvas.getContext('2d');
        const tamano = Math.max(12, Math.round(canvas.width / 60));
        contexto.save();
        contexto.globalAlpha = Math.min(1, aviso.restanteMs / 300);
        contexto.font = `700 ${tamano}px "Press Start 2P", Arial, sans-serif`;
        contexto.textAlign = 'left';
        contexto.textBaseline = 'top';
        const ancho = contexto.measureText(aviso.texto).width;
        contexto.fillStyle = 'rgba(0, 0, 0, .65)';
        contexto.fillRect(tamano * 0.6, tamano * 0.6, ancho + tamano, tamano * 2);
        contexto.fillStyle = '#fff';
        contexto.fillText(aviso.texto, tamano * 1.1, tamano * 1.1);
        contexto.restore();
    }

    /* ========================= */
    /* TECLADO                   */
    /* ========================= */

    function enviarTeclas() {
        let bits = 0;
        estado.teclas.forEach(codigo => { bits |= BITS_TECLA[codigo] || 0; });
        if (bits !== estado.bits) {
            estado.bits = bits;
            mandarTeclas();
        }
    }

    // Manda las teclas con el tick del navegador en que empiezan a valer (para la predicción).
    function mandarTeclas() {
        socket.emit('entrada', { b: estado.bits, k: prediccion.proximoTick() });
    }

    function soltarTeclas() {
        estado.teclas.clear();
        enviarTeclas();
    }

    function escribiendo(elemento) {
        if (!elemento) return false;
        const tag = elemento.tagName;
        return tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'button', 'submit'].includes(elemento.type));
    }

    window.addEventListener('keydown', evento => {
        if (!estado.salaId || $('dialogoClave').open || $('dialogoImportarHbs').open || ($('dialogoClubes') && $('dialogoClubes').open)) return;
        const enTexto = escribiendo(evento.target);
        if (evento.code === 'Escape') {
            if (enTexto) evento.target.blur();
            else if (estado.replay && estado.replay.esHighlightPostPartido) {
                cerrarHighlightPostPartido();
            } else {
                const proximoVisible = !estado.panelVisible;
                mostrarPanel(proximoVisible);
                if (estado.sala && estado.sala.partido && soyAdmin()) {
                    const pausado = !!estado.sala.partido.pausado;
                    if (proximoVisible && !pausado) accion('partido:pausa');
                    else if (!proximoVisible && pausado) accion('partido:pausa');
                }
            }
            return;
        }
        if (enTexto) return;
        if (evento.code === 'Enter') {
            evento.preventDefault();
            $('chatTexto').focus();
            return;
        }
        const numero = evento.code.match(/^(?:Digit|Numpad)([0-7])$/);
        if (numero && !evento.repeat) {
            cambiarZoom(Number(numero[1]));
            return;
        }
        if (evento.code === 'KeyP' && !evento.repeat && soyAdmin() && estado.sala.partido) {
            accion('partido:pausa');
            return;
        }
        if (evento.code === 'KeyQ' && !evento.repeat && estado.sala && estado.sala.partido && estado.sala.partido.practica) {
            const yo = estado.sala.jugadores.find(j => j.id === estado.tuId);
            if (yo && (yo.equipo === 'red' || yo.equipo === 'blue')) {
                evento.preventDefault();
                accion('practica:pelota');
            }
            return;
        }
        if (estado.replay && evento.code === 'Space') {
            evento.preventDefault();
            if (!evento.repeat) votarSkipReplay();
            return;
        }
        if (BITS_TECLA[evento.code]) {
            // Que Espacio o las flechas no aprieten botones ni cambien selects.
            evento.preventDefault();
            if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
            estado.teclas.add(evento.code);
            enviarTeclas();
        }
    });

    window.addEventListener('keyup', evento => {
        if (!BITS_TECLA[evento.code]) return;
        estado.teclas.delete(evento.code);
        enviarTeclas();
    });

    window.addEventListener('blur', soltarTeclas);

    /* ========================= */
    /* INICIO                    */
    /* ========================= */

    $('nombreJugador').value = nombreGuardado();
    guardarAvatar(avatarGuardado());
    Object.keys(NOMBRE_ZOOM).forEach(nivel => {
        const opcion = crearElemento('option', '', `${nivel} · ${NOMBRE_ZOOM[nivel]}`);
        opcion.value = nivel;
        $('cfgZoom').appendChild(opcion);
    });
    $('cfgZoom').value = String(estado.zoomNivel);
    $('cfgExtrapolacion').value = String(estado.extrapolacion);
    $('cfgZoom').addEventListener('change', evento => {
        cambiarZoom(Number(evento.target.value));
        evento.target.blur();
    });
    $('cfgExtrapolacion').addEventListener('change', evento => {
        cambiarExtrapolacion(evento.target.value);
        evento.target.blur();
    });
    $('avatarJugador').addEventListener('change', evento => guardarAvatar(evento.target.value));
    $('avatarSala').addEventListener('input', () => actualizarPreviewAvatar());
    $('avatarSala').addEventListener('change', evento => {
        cambiarAvatar(evento.target.value);
        evento.target.blur();
    });
    $('avatarSala').addEventListener('focus', soltarTeclas);
    if ($('avatarMainCircle')) {
        const enfocarAvatar = () => {
            if ($('avatarSala')) {
                $('avatarSala').focus();
                $('avatarSala').select();
            }
        };
        $('avatarMainCircle').addEventListener('click', enfocarAvatar);
        $('avatarMainCircle').addEventListener('keydown', evento => {
            if (evento.key === 'Enter' || evento.key === ' ') {
                evento.preventDefault();
                enfocarAvatar();
            }
        });
    }
    if ($('avatarPresetPrev')) $('avatarPresetPrev').addEventListener('click', () => ciclarPresetAvatar(-1));
    if ($('avatarPresetNext')) $('avatarPresetNext').addEventListener('click', () => ciclarPresetAvatar(1));

    $('nombreJugador').addEventListener('change', () => {
        const nombre = $('nombreJugador').value.trim();
        if (nombre) localStorage.setItem(CLAVE_NOMBRE, nombre);
    });
    if ($('btnSkipReplay')) {
        $('btnSkipReplay').addEventListener('click', () => votarSkipReplay());
    }
    actualizarEstadoBody();
    cargarCatalogoHbs();
    requestAnimationFrame(bucle);
})();
