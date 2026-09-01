# Áditi Functional Yoga — app de alumnas

App para que las alumnas de Beatriz reserven clases, contraten bonos, vean el
muro de novedades y contacten por WhatsApp. Beatriz gestiona todo desde un
panel con PIN.

Stack: React + Vite (frontend) + funciones serverless de Vercel (`/api/data.js`)
+ Upstash Redis (base de datos compartida). Es el mismo patrón que usas en tus
otras apps (BASE, Contabilidad, HAMMER...).

## 1. Crear la base de datos en Upstash

1. Entra en https://console.upstash.com y crea una base de datos Redis (plan gratuito de sobra para esto).
2. En el panel de la base de datos, copia:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## 2. Subir el proyecto a GitHub

```bash
cd aditi-yoga-app
git init
git add .
git commit -m "Primera versión de la app de Áditi"
git remote add origin https://github.com/agalvez-tech/aditi-yoga-app.git
git push -u origin main
```

## 3. Conectar con Vercel

1. En https://vercel.com, "Add New Project" → importa el repo de GitHub.
2. En "Environment Variables" añade las dos variables del paso 1
   (`UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`).
3. Deploy. Vercel detecta automáticamente que es un proyecto Vite y también
   despliega `api/data.js` como función serverless — no hace falta configurar nada más.

Cada vez que hagas `git push`, Vercel vuelve a desplegar solo.

## 4. Probar en local (opcional)

```bash
npm install
npm i -g vercel
vercel dev
```

`vercel dev` levanta a la vez el frontend y las funciones de `/api`, leyendo
las variables de un archivo `.env.local` que puedes crear a partir de
`.env.example`.

## 5. Conectar Redsys (pago con tarjeta)

Cuando tengas tus credenciales del banco, añade estas variables de entorno
en Vercel (además de las de Upstash):

- `REDSYS_ENV` — `test` mientras pruebas, `production` cuando esté validado.
- `REDSYS_MERCHANT_CODE` — tu FUC (9 dígitos).
- `REDSYS_TERMINAL` — normalmente `001`.
- `REDSYS_SECRET_KEY` — la clave secreta SHA-256 que te da el banco, en base64.
- `REDSYS_MERCHANT_NAME` — nombre que verá la alumna en la pasarela.
- `APP_BASE_URL` — la URL pública de tu app en Vercel (ej.
  `https://aditi-yoga-app.vercel.app`), para que Redsys sepa a dónde
  redirigir tras el pago y a dónde avisar del resultado.

Cómo funciona:

- `api/redsys-start.js` genera los parámetros firmados y la app redirige
  el navegador a la pasarela de Redsys.
- `api/redsys-notify.js` es el webhook que Redsys llama automáticamente
  tras el pago (servidor a servidor, no depende de que la alumna cierre
  el navegador). Verifica la firma y, si el pago fue correcto, confirma
  el bono o la clase suelta en Redis sin que Beatriz tenga que hacer nada.
- Cada bono y cada clase suelta ofrecen dos vías: **pagar con tarjeta
  ahora** (Redsys, se confirma solo) o **pagar por Bizum** al
  691750534 (Beatriz lo confirma a mano desde su panel en cuanto lo recibe).
  No se ofrece opción de pago en efectivo.

**Antes de cobrar de verdad**, prueba todo el flujo en `REDSYS_ENV=test`
con las tarjetas de prueba que te facilite el banco, y confirma con tu
banco cómo acceder a esas tarjetas de test — sin probarlo en sandbox no
sabremos si algo falla en el cobro real.

## 6. Notificaciones push (avisos del Muro)

Cuando Beatriz publica algo en el Muro, cada alumna que haya activado las
notificaciones recibe un aviso en el móvil al momento, como una app normal
(funciona en Android sin más; en iPhone hace falta que la alumna haya
añadido la app a la pantalla de inicio primero, es una limitación de Apple).

Variables de entorno necesarias (ya generadas, solo hay que copiarlas a
Vercel — no hace falta crear ninguna cuenta externa para esto):

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` — un email de contacto, ya puesto por defecto.

Las claves están en `.env.example`. La clave pública también está
incrustada en `src/push.js` (no es secreta, así debe ser). **Si alguna
vez las regeneras, cámbialas en los dos sitios.**

Cada alumna activa las notificaciones ella misma desde Perfil → "Activar".
El navegador le pedirá permiso; si lo acepta, su dispositivo queda
suscrito. No hace falta perfil creado para activarlas.

## 7. Fotos en el Muro

Beatriz puede añadir una foto opcional a cada publicación del muro. Las
imágenes se guardan en **Vercel Blob** (no en Redis, para que la base de
datos no se llene de fotos y todo siga yendo rápido).

Para activarlo:

1. En tu proyecto de Vercel, ve a la pestaña **Storage** → **Create Database** → **Blob**.
2. Vincúlalo a este proyecto. Vercel añade automáticamente la variable de
   entorno `BLOB_READ_WRITE_TOKEN` — no hace falta que la copies a mano.
3. Haz un redeploy si Vercel no lo hace solo tras vincular el Blob store.

La app redimensiona la foto en el móvil antes de subirla (máximo 1600px,
comprimida) para que no pese demasiado ni tarde en subir con datos móviles.

## Cosas a tener en cuenta

 (`ADITI2026`) está escrito en `src/App.jsx`
  (constante `ADMIN_PIN`). Cámbialo antes de compartir la app y avisa a
  Beatriz del nuevo PIN. No es una autenticación segura de verdad, es un
  filtro sencillo — suficiente para uso interno, no para proteger datos
  sensibles.
- **El pago con tarjeta pasa por el webhook de Redsys.** Si por lo que
  sea el webhook no llega a ejecutarse (raro, pero puede pasar por caídas
  puntuales), el bono o la clase se quedan en estado pendiente y Beatriz
  puede confirmarlos a mano desde su panel igual que con los pagos por Bizum.
- **El número de Bizum (691750534)** está en la constante `BIZUM_PHONE`
  de `src/App.jsx`. Cámbialo ahí si alguna vez cambia.
- **`ALLOWED_KEYS` en `api/data.js`** limita qué claves se pueden leer o
  escribir en Redis, para que el endpoint no se pueda usar para escribir
  cualquier cosa.
