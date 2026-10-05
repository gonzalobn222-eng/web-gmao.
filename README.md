# GMAO web

Aplicación estática para explorar los datasets CMMS/GMAO desde el navegador. No usa servidor de análisis, base de datos, framework ni servicios externos: los cálculos se ejecutan en JavaScript en el dispositivo del usuario.

## Contenido

```text
web-gmao/
├── index.html
├── styles.css
├── app.js
├── data/
│   ├── CMMS_grupo_A.csv
│   ├── CMMS_grupo_B.csv
│   ├── CMMS_grupo_C.csv
│   └── CMMS_grupo_D.csv
└── README.md
```

La aplicación utiliza rutas relativas (`styles.css`, `app.js` y `data/...`), por lo que funciona bajo una URL de proyecto de GitHub Pages sin asumir que se sirve desde la raíz del dominio.

## Ejecución local

Los navegadores bloquean ciertas lecturas de archivos locales al abrir `index.html` directamente. Sirve la carpeta con cualquier servidor estático local, por ejemplo:

```bash
python3 -m http.server 8000 --directory web-gmao
```

Abre <http://localhost:8000>. Este servidor solo entrega archivos estáticos durante el desarrollo; no realiza ni almacena análisis.

También se puede abrir la carpeta en VS Code y usar una extensión de servidor estático (por ejemplo, Live Server), seleccionando `index.html`.

## Publicación en GitHub Pages

1. Crea un repositorio nuevo para publicar el sitio. Sube **todo el contenido de `web-gmao/`** a la raíz del repositorio, conservando la carpeta `data/`. En GitHub, `index.html` debe quedar al mismo nivel que `app.js` y `styles.css`.
2. En GitHub, abre el repositorio y entra en **Settings → Pages**.
3. En **Build and deployment**, selecciona **Deploy from a branch**.
4. Elige la rama donde subiste los archivos y selecciona la carpeta `/ (root)`.
5. Pulsa **Save**, espera el workflow de Pages y abre la URL que GitHub muestra en esa misma pantalla.

Si prefieres mantener la aplicación dentro de un repositorio con otros archivos, coloca el contenido de `web-gmao/` dentro de una carpeta `docs/` en la raíz y selecciona `/docs` en el paso 4. GitHub Pages desde una rama solo ofrece la raíz o `/docs`, no una carpeta arbitraria llamada `web-gmao`.

## Funcionalidades

- Selector de los datasets estáticos A–D y carga de otro CSV desde el dispositivo.
- Filtros por tipo de mantenimiento, criticidad, equipo y fecha de creación.
- KPI de OT únicas, HH, downtime, costo directo, MTTR correctivo y mediana.
- Gráficos de distribución de OT/HH, downtime, costo, MTTR, Pareto y Jack-Knife.
- Tablas de clasificación y rankings de activos y modos de falla.
- Diagnóstico de campos faltantes y exportación del subconjunto filtrado a CSV.
- Diseño responsive para escritorio y teléfono.

## Criterios del análisis

- Los CSV se leen directamente en el navegador. Se eliminan espacios y apóstrofos iniciales, se normalizan tipo de mantenimiento/estado/planificación y se eliminan filas duplicadas exactas como en el notebook. Los campos numéricos reconocidos aceptan punto o coma decimal y las fechas se interpretan primero como día/mes/año.
- Los KPI de esfuerzo, downtime y costo agregan las filas filtradas. OT se cuenta por identificador único.
- El MTTR se calcula como `Fecha_fin - Fecha_inicio` para registros correctivos con estado `cerrada`, ambas fechas válidas y duración positiva. MTBF y disponibilidad no se presentan porque no forman parte de los cálculos validados del notebook.
- Los Pareto agrupan OT correctivas con modo de falla informado; el porcentaje acumulado usa todos los modos antes de limitar la visualización a diez.
- Jack-Knife utiliza correctivas válidas. Sus límites son las medias de frecuencia y MTTR del subconjunto; clasifica los cuadrantes Agudo, Crónico, Grave y Bajo control y ordena por `R* = frecuencia normalizada × MTTR normalizado`.
- Los filtros operan sobre registros CMMS; aplicar un filtro cambia también la población con la que se calculan límites y porcentajes.

## Privacidad de los datasets

GitHub Pages sirve los archivos estáticos de forma pública. Los CSV incluidos dentro de `data/` serán descargables por cualquier persona que pueda acceder al sitio/repositorio. Revisa y autoriza la publicación de los datos con tu organización antes de subirlos a un repositorio público. Para usar otro archivo desde el navegador, usa **Cargar otro CSV**; ese archivo se procesa localmente y no se carga a GitHub.
Actualización de despliegue
