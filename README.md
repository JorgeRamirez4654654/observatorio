# Start backend
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# fronend
npm run dev
cd /Users/fluna/Improgress/observatorio_ejecucion_presupuestaria/frontend
npm run dev

# streamlit
source venv/bin/activate
streamlit run app.py

# Observatorio de Ejecución Presupuestaria — OBS 2

Dashboard de Streamlit para analizar ejecución presupuestaria municipal en Guatemala, detectar concentración de proveedores y señales de riesgo por alcalde, partido y municipio.

---

## Origen de los datos

El sistema combina **dos fuentes de proyectos SNIP**:

### 1. Primera versión del web scraping (`projects_clean.csv`) — base histórica estática
`projects_clean.csv` contiene los proyectos scrapeados en la primera versión del web scraping directamente del portal SNIPgt.

- **Nunca se actualiza automáticamente.** Los proyectos existentes conservan la información del momento en que fueron scrapeados.
- La app usa esta fuente como complemento: solo toma los SNIPs de `projects_clean` que **no están** en `snip_proyectos_clean`.

### 2. Datos del pipeline (`snip_proyectos_clean.parquet`) — datos actualizados
Estos son los proyectos descubiertos a través de GuateCompras (vía el pipeline automático).

- Se **agregan** proyectos nuevos cada vez que GuateCompras publica un nuevo Excel mensual.
- Los proyectos **no finalizados** se re-scrapearon automáticamente para mantener la información al día.
- En la app, si un SNIP existe en ambas fuentes, **`snip_proyectos_clean` tiene prioridad**.

---

## Arquitectura del pipeline

```
GuateCompras OCDS API
        │
        ▼
datos_guatecompras.py ──────► Data/guatecompras_adjudicaciones.parquet
        │
        ▼
match_nog_snip.py ──────────► Data/nog_snip.parquet
        │
        ▼
web_scraping_snip.py ───────► Data/snip_proyectos.parquet
        │
        ▼
preprocessing.py ───────────► Data/snip_proyectos_clean.parquet
                                          │
                    ┌─────────────────────┘
                    │        +
                    │  Data/projects_clean.csv  (v1 scraping, estático)
                    ▼
                  app.py  (une ambas fuentes, pipeline tiene prioridad)
```

---

## Descripción de cada paso del pipeline

### Paso 1 — `datos_guatecompras.py`
Descarga los archivos Excel mensuales del portal OCDS de GuateCompras y construye una tabla consolidada de licitaciones y adjudicaciones.

- **Fuente:** `https://ocds.guatecompras.gt/file/xlsx/{año}/{mes}`
- **Lógica incremental:** revisa el parquet existente y solo descarga los meses que aún no están registrados. Los meses que devuelven 404 se saltan sin error.
- **Ventana de refresco (`REFRESH_LAST_N_MONTHS = 2`):** los últimos 2 meses (mes actual + anterior) siempre se re-descargan, aunque ya existan en el parquet. Esto captura filas nuevas que GuateCompras agrega durante el mes en curso. Las filas viejas de esos meses se reemplazan para evitar duplicados.
- Detecta automáticamente el mes actual como límite superior (no hay que cambiar fechas manualmente).
- Extrae de cada Excel: ID de licitación (NOG), nombre del proveedor, monto adjudicado, y si la licitación tiene una boleta SNIP adjunta.
- **Salida:** `Data/guatecompras_adjudicaciones.parquet`

### Paso 2 — `match_nog_snip.py`
Para cada NOG con boleta SNIP, descarga el PDF de la boleta y extrae el número SNIP usando tres métodos en cascada: `pdfplumber`, `pypdf` y OCR con Tesseract.

- **Lógica incremental:** solo procesa NOGs que no están en el lookup existente. Los NOGs intentados sin resultado también se guardan para no volver a intentarlos.
- Usa `ThreadPoolExecutor` con delays aleatorios para no saturar el servidor.
- Los errores de red no se guardan, se reintentarán en la siguiente corrida.
- **Salida:** `Data/nog_snip.parquet` (columnas: `compiledRelease/tender/id`, `snip_number`)

### Paso 3 — `web_scraping_snip.py`
Scrapea la página de información de cada proyecto en el portal SNIPgt y extrae todos sus campos: nombre, institución, municipio, etapa, información financiera por año e información física por año.

- **Dos modos de trabajo en cada corrida:**
  1. **SNIPs nuevos:** scrapea los SNIPs de `nog_snip.parquet` que no existen en `snip_proyectos.parquet`.
  2. **Refresh de no finalizados:** re-scrapea los proyectos ya guardados cuyo campo `situacion_actual` no contiene "FINALIZADO", para capturar actualizaciones de avance físico y financiero.
- Guarda cada 100 registros para no perder progreso si se interrumpe.
- El refresh hace **upsert por SNIP**: reemplaza la fila existente con los datos nuevos.
- **Salida:** `Data/snip_proyectos.parquet`

### Paso 4 — `preprocessing.py`
Transforma `snip_proyectos.parquet` en una tabla limpia y plana lista para la app. **Se recalcula completo en cada corrida.**

**Nuevas columnas que se crean:**

- `ubicacion_geografica` → **`municipio`** + **`departamento`** (se parte por la coma)
- `opinion_tecnica` → **`opinion_resultado`** (ej. "APROBADO") + **`opinion_ejercicio`** (el año de la opinión)
- `situacion_actual` → **`situacion_estado`** (ej. "FINALIZADO", "EN EJECUCIÓN") + **`situacion_fecha`** (la fecha entre paréntesis, si existe)
- `meta_fisica` raw → **`meta_fisica`** (valor numérico) + **`unidad`** (ej. "Kilometro", "Metro cuadrado")
- **`avance_financiero`** = `monto_ejecutado` / `monto_vigente`
- **`avance_meta_anual`** = `meta_ejecutada` / `meta_fisica`
- **`costo_por_unidad`** = `monto_ejecutado` / `meta_ejecutada`
- **`periodo_alcalde`** (2015, 2019 o 2023) derivado del `ejercicio`
- Desde el join con alcaldes: **`alcalde_ganador`**, **`siglas_ganadora`**, **`organizacion_ganadora`**
- Desde el join con GuateCompras: nombre del proveedor, monto adjudicado, ID de licitación (NOG)

**Cómo funciona el groupby (una fila por SNIP):**

El scraper guarda la información financiera y física como listas JSON con una entrada por año (ejercicio). El preprocessing primero expande esas listas en filas separadas (una fila por SNIP × ejercicio), luego las junta, y finalmente agrupa de vuelta a una sola fila por SNIP así:

- **Columnas descriptivas** (nombre, municipio, etapa, etc.): se toma el valor del **primer ejercicio** disponible.
- **Montos** (`monto_solicitado`, `monto_inicial`, `monto_vigente`, `monto_ejecutado`): se **suman todos los ejercicios**, pero **excluyendo los años donde `avance_financiero` es 0**. Esto evita sumar filas de años sin ejecución real que inflarían los totales.
- **Metas** (`meta_fisica`, `meta_ejecutada`): igual que los montos, se **suman excluyendo los años donde `avance_meta_anual` es 0**, para no contar años sin avance físico registrado.

---

## Cómo correr el pipeline

### Requisitos
```bash
pip install -r requirements.txt

# macOS (para OCR):
brew install tesseract tesseract-lang poppler
```

### Ejecución completa (recomendada)
```bash
python pipeline.py
```
Corre los 4 pasos en secuencia. Si un paso falla, el pipeline se detiene y muestra cuál falló.

### Ejecución individual de cada paso
```bash
python datos_guatecompras.py    # Paso 1: descargar GuateCompras
python match_nog_snip.py        # Paso 2: extraer SNIPs de PDFs
python web_scraping_snip.py     # Paso 3: scrapear proyectos SNIP
python preprocessing.py         # Paso 4: producir tabla limpia
```

### Correr la app
```bash
streamlit run app.py
```

---

## Archivos y su comportamiento al correr el pipeline

| Archivo | Generado por | Comportamiento |
|---|---|---|
| `Data/guatecompras_adjudicaciones.parquet` | `datos_guatecompras.py` | Incremental — agrega meses nuevos; re-descarga y reemplaza los últimos 2 meses en cada corrida |
| `Data/nog_snip.parquet` | `match_nog_snip.py` | Incremental — solo agrega NOGs nuevos |
| `Data/snip_proyectos.parquet` | `web_scraping_snip.py` | Incremental — agrega SNIPs nuevos + actualiza no finalizados |
| `Data/snip_proyectos_clean.parquet` | `preprocessing.py` | **Se recalcula completo** en cada corrida |
| `Data/projects_clean.csv` | v1 scraping (manual) | Nunca se toca automáticamente |

---

## Estructura de archivos

```
observatorio_ejecucion_presupuestaria/
├── pipeline.py                          # Orquestador del pipeline completo
├── datos_guatecompras.py                # Paso 1: descarga GuateCompras OCDS
├── match_nog_snip.py                    # Paso 2: NOG → SNIP desde PDFs
├── web_scraping_snip.py                 # Paso 3: scraping portal SNIPgt
├── preprocessing.py                     # Paso 4: limpieza y joins
├── app.py                               # Dashboard Streamlit
├── requirements.txt                     # Dependencias Python
│
├── Data/
│   ├── guatecompras_adjudicaciones.parquet  # Adjudicaciones GuateCompras
│   ├── nog_snip.parquet                     # Lookup NOG → número SNIP
│   ├── snip_proyectos.parquet               # Proyectos scrapeados (raw)
│   ├── snip_proyectos_clean.parquet         # Proyectos limpios (pipeline) ← usa la app
│   ├── projects_clean.csv                   # Primera versión del scraping ← usa la app
│   ├── alcaldes_municipales_gt_2015_2019_2023.xlsx
│   └── municipalidades.json                 # GeoJSON para mapa
│
└── Fotos/
    ├── bandera.png
    ├── cacif.png
    └── improgress.png
```
