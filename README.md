# La Chaula — copia completa del código web

Copia local del juego de **https://chaula.et20.edu.ar/** tal como se ve en el
navegador (HTML, CSS, JavaScript y recursos). Descargado el **25/11/2026**.

## Cómo abrirlo

```powershell
cd chaula-web
node servir.js
```

Luego abrí **http://localhost:8000** en el navegador.

También funciona abriendo `index.html` directamente como archivo (el propio
código del sitio contempla ese modo, por ejemplo para Batocera), pero con
`servir.js` se cargan bien la música, los sonidos y el modo online.

## Qué contiene

```
chaula-web/
├─ index.html                  Pantalla de inicio ("Presioná Start")
├─ pages/
│  ├─ menu.html                Menú principal
│  ├─ online.html              Jugar online (salas, cancha, chat, panel)
│  └─ configuracion.html       Ajustes de audio y música
├─ css/
│  ├─ global.css               Base y fondo
│  ├─ inicio.css               Pantalla de inicio
│  ├─ ssf-theme.css            Tema arcade
│  ├─ arcade.css               Marco de cabina, marquesina, navegación
│  ├─ retro-ui.css             Componentes retro
│  ├─ menu.css                 Menú principal
│  ├─ crear-sala.css           Formularios de sala
│  ├─ online.css               Partida online
│  └─ configuracion.css        Pantalla de ajustes
├─ js/
│  ├─ inicio.js                Lógica de la pantalla de inicio
│  ├─ menu.js                  Botones del menú
│  ├─ configuracion.js         Guardado de ajustes
│  ├─ music.js                 Reproductor de música y cartel "Sonando"
│  ├─ arcade/
│  │  ├─ almacen.js            Estado compartido entre pantallas (localStorage/URL)
│  │  ├─ controles.js          Teclado + joysticks (Gamepad API)
│  │  ├─ navegacion.js         Navegación de menús con la palanca
│  │  └─ sonidos.js            Efectos de sonido
│  ├─ local/
│  │  └─ fisica-haxball.js     Motor de física del partido
│  └─ online/
│     ├─ red.js                Cliente de red (Socket.IO)
│     ├─ dibujo.js             Render de la cancha en canvas
│     └─ cliente.js            Lógica del partido online
├─ socket.io/socket.io.js      Librería cliente de Socket.IO (servida por el sitio)
├─ musica/lista.js             Lista de canciones para el modo sin servidor
├─ api/musica.json             Respuesta real de /api/musica
├─ img/                        logo.png, fondo.jpg
├─ fonts/press-start-2p/       Tipografía pixel
├─ sonidos/                    10 efectos .wav
├─ servir.js                   Servidor estático mínimo para probar la copia
├─ descargar-musica.ps1        Baja las 9 canciones originales (opcional)
└─ MANIFIESTO.txt              Lista de archivos con tamaño y SHA-256
```

## Notas

- **Es el código del cliente.** El servidor (Node/Express + Socket.IO) no se
  puede ver desde el navegador; solo se ve lo que descarga el cliente. Por eso
  el modo online de esta copia no tiene backend: la interfaz y la lógica de red
  están completas, pero las salas no se van a conectar.
- La música (`musica/*.mp3`, unas 9 canciones, ≈56 MB) **no** está incluida
  porque no es código. La lista de temas sí está en `musica/lista.js` y
  `api/musica.json`. Para bajarla, ejecutá:

  ```powershell
  powershell -ExecutionPolicy Bypass -File descargar-musica.ps1
  ```
- `api/musica.json` es la respuesta real del endpoint, guardada como referencia.
- El beacon de Cloudflare Insights que aparece inyectado en algunos HTML no es
  código del juego; se dejó tal cual vino.
- Las rutas relativas quedaron sin modificar, igual que en el sitio original.
