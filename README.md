# Cabrales · Home V2

Home de Café Cabrales, basada en el mock y el storyboard entregados. Astro renderiza los textos, productos y enlaces como HTML. GSAP ScrollTrigger sincroniza un solo video con el scroll, sin hidratar la página con React.

## Arrancar en local

Usá Node.js 24.14 o superior.

```sh
npm ci
npm run dev
```

La home se abre en `http://localhost:4321/`. Para trabajar con el Visual Editor, usá `npm run dev:editor` en lugar de `npm run dev`: la URL pasa a ser `https://localhost:4321/cabrales-home-v2/`. El modo editor usa mkcert; abrí primero la dirección en el navegador para comprobar que confía en el certificado local. Si el puerto 4321 está ocupado, Astro indica el puerto elegido en la terminal.

## Storyblok

La ruta pública `/` y la de vista previa `/cabrales-home-v2/` leen **únicamente** la Story `cabrales-home-v2`. El borrador ya existe en el Space de referencia (región `eu`), sin publicar. El frontend funciona con contenido local cuando el borrador está vacío, no hay token o la API no responde.

1. Completá `.env` a partir de `.env.example`, conservando los secretos solo en tu entorno. `STORYBLOK_PREVIEW_TOKEN` se usa para leer borradores; `STORYBLOK_SPACE_ID` identifica el Space del Visual Editor. Verificá la conexión con `npm run cms:check`.
2. Creá el tipo de contenido **Cabrales · Home V2** y sus dos bloques anidados en el Space. Para aplicar el [modelo incluido](scripts/storyblok-model.mjs), configurá localmente `STORYBLOK_MANAGEMENT_TOKEN` con permisos sobre la Story y la Block Library. Ejecutá `npm run cms:provision` para revisar y, si coincide el borrador, `npm run cms:provision -- --apply`. El script no duplica Stories, no reemplaza un borrador con contenido y no publica. No modifica `default-page`, `hero-section` ni la Story anterior `cabrales`.
3. En **Settings → Visual Editor**, agregá `https://localhost:4321/` como entorno **adicional** para desarrollo. En el borrador elegí ese entorno. El slug ya coincide con la ruta; si la Story tiene un Real path distinto, ajustá **solo ese borrador** a `/cabrales-home-v2/`. No reemplaces la URL global que usa el otro proyecto.
4. Cargá los MP4 optimizados en `video_desktop` y `video_mobile`, o dejá vacíos esos campos para usar las versiones locales. Los videos en Storyblok necesitan un Space habilitado para ese tipo de asset; también podés usar un CDN HTTPS que sirva MP4 con solicitudes `Range`. Los pósters, las fotos, el logo, los textos y los enlaces se pueden configurar en los campos correspondientes. Al guardar, el editor recarga la vista en modo estático para que todas las escenas sean seleccionables. Usá «Ver con animación» dentro del editor para probar el scroll.

El token Preview y una firma vigente habilitan el iframe del Visual Editor. No se envía ningún token a la página. Fuera del editor, el iframe está bloqueado y producción consulta `published` con `STORYBLOK_PUBLIC_TOKEN`.

### Enlaces y material a validar

- «Agendar reunión» abre por ahora un correo a `cafe@cabrales.com`. Para una agenda real, reemplazá el enlace de la escena Reunión por la URL aprobada.
- Las cuatro fotos de producto se extrajeron del mock recibido. Reemplazalas en los campos `image` por packshots oficiales si se entregan. Los botones de compra apuntan a las fichas de la tienda.
- Privacidad y términos se muestran en el footer cuando se configuran sus enlaces aprobados. No hay analítica, formularios propios ni cookies de seguimiento.

## Video y sincronización

El clip `Ejemplo-web-video.mp4` es solo referencia. Los masters de escritorio y móvil, de 22,542 s, quedan intactos. `public/media/` contiene derivados H.264 sin audio, con `faststart` y un cuadro clave por fotograma. Escritorio usa 1440 × 810 (9,8 MB); móvil usa 720 × 1280 (5,9 MB). El frontend elige según la orientación de la ventana y no carga el otro video. El primer póster se solicita antes que el video.

| Scroll | Escena | Tiempo del montaje |
| --- | --- | --- |
| 0–20 % | Café Cabrales | 0–2,833 s |
| 20–40 % | Molido | 2,833–10,417 s |
| 40–65 % | Súper Cabrales | 10,417–18,125 s |
| 65–85 % | Un origen para cada taza | 18,125–22,500 s |
| 85–100 % | Lo que sigue en una reunión | Cuadro final fijo con desenfoque CSS |

La puesta recorre un escenario fijo de `100svh` en un total de `500svh`. No se controla el gesto de scroll del navegador ni se reproduce el MP4 automáticamente. Los segundos de fin son editables por orientación, y deben ser crecientes. Si se cambia el montaje, verificá los cortes en ambos archivos y actualizá también las imágenes fijas. Con movimiento reducido, ahorro de datos, JavaScript desactivado o error del video, el recorrido se presenta como cinco paneles estáticos.

```sh
npm run media:prepare                # regenera los derivados a partir de los masters y el mock
npm run media:prepare -- --inspeccion   # genera hojas de fotogramas en reports/media/
```

El logo marrón proviene del proyecto de referencia. Para regenerarlo desde otra ubicación usá `CABRALES_LOGO_PATH`; si no está disponible, conservá el logo y el favicon ya incluidos.

## Producción y pruebas

```sh
npm run check
npm test
npm run test:browser
npm run build
npm start
```

La prueba de navegador requiere Chrome instalado y el servidor HTTPS local en ejecución. `CABRALES_TEST_URL` permite usar otra URL y `CABRALES_SCREENSHOTS=1` guarda capturas en `reports/screenshots/`. Para WebKit, instalalo con `npm exec -- playwright-core install webkit` y ejecutá la suite con `CABRALES_ENGINE=webkit`.

El build genera un servidor Astro para Node. En el alojamiento final configurá `STORYBLOK_PUBLIC_TOKEN` y `SITE_URL` con el dominio HTTPS. Serví los MP4 con soporte de solicitudes por rango (`206 Partial Content`). Si se necesita un entorno editorial desplegado, configurá Preview y Space ID en ese entorno y registrá su URL HTTPS en Storyblok. Hasta aprobar la salida, mantené `SITE_INDEXABLE=false`; incluso si se habilita, solo se indexa `/` con la Story publicada disponible.
