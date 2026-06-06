"""
Scraper del SNIPgt — extrae datos de proyectos por número SNIP.

- Lee los SNIPs desde nog_snip.parquet (solo los que tienen SNIP)
- Para cada SNIP hace GET a la página de información
- Parsea los campos con BeautifulSoup incluyendo tablas financiera y física como JSON
- Guarda incrementalmente cada 100 registros en snip_proyectos.parquet

Resultado: snip_proyectos.parquet  (y snip_proyectos.csv)

Uso:
    python scrape_snip.py

Requisitos:
    pip install requests beautifulsoup4 pandas pyarrow lxml
"""

import re
import time
import json
import random
import requests
import pandas as pd
from bs4 import BeautifulSoup
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
INPUT_PARQUET  = Path("Data/nog_snip.parquet")
OUTPUT_PARQUET = Path("Data/snip_proyectos.parquet")
ERRORS_LOG     = Path("errores_scrape_snip.txt")

MAX_WORKERS    = 10
DELAY_MIN      = 1.5
DELAY_MAX      = 4.0
RETRY_ATTEMPTS = 2
SAVE_EVERY     = 100

# Si True, re-scrapea proyectos ya guardados que todavía no están finalizados
REFRESH_NON_FINALIZED = True

COL_SNIP       = "snip_number"
# ─────────────────────────────────────────────────────────────────────────────

BASE_URL = (
    "https://sistemas.segeplan.gob.gt/guest/"
    "SNPPKG$PL_PROYECTOS.INFORMACION"
    "?prmIdSnip={snip}&prmEjercicio=2026"
    "&prmNombre=&prmDictamen=&prmIdEntidad=&prmIdUEjecutora="
    "&prmIdDepartamento=&prmIdMunicipio=&prmIdFuncion="
    "&prmIdPPGG=&prmIdMPGG=&prmIdPND=&prmIdMED=&prmIdOrganismo="
    "&prmResultadoEval=A&prmReturn=BUSQUEDA"
)

GEOREF_URL = (
    "https://sistemas.segeplan.gob.gt/guest/"
    "SNPPKG$PL_PROYECTOS.INFORMACION_GEOREF_MAP?prmIdSnip={snip}"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-GT,es;q=0.9",
}

# Mapeo: texto del label en la página → nombre de columna
FIELD_MAP = {
    "Proyecto:"             : "proyecto",
    "Institución:"          : "institucion",
    "Tipo de proyecto:"     : "tipo_proyecto",
    "Unidad ejecutora:"     : "unidad_ejecutora",
    "Ubicación geográfica:" : "ubicacion_geografica",
    "Sector especifico:"    : "sector_especifico",
    "Sector:"               : "sector",
    "Especie:"              : "especie",
    "Etapa actual:"         : "etapa_actual",
    "Situación actual:"     : "situacion_actual",
    "Meta global:"          : "meta_global",
    "Opinión técnica:"      : "opinion_tecnica",
}


def build_url(snip: str) -> str:
    return BASE_URL.format(snip=snip)


def fetch_html(snip: str) -> str:
    url = build_url(snip)
    for attempt in range(RETRY_ATTEMPTS):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            resp.encoding = "latin-1"
            return resp.text
        except Exception as e:
            if attempt == RETRY_ATTEMPTS - 1:
                raise RuntimeError(f"HTTP error: {e}")
            time.sleep(2)


def parse_table(table_tag) -> list[dict]:
    """
    Convierte una tabla HTML en lista de dicts.
    
    Estructura real de las tablas del SNIPgt:
      <thead>
        <tr>
          <th rowspan="2">Ejercicio</th>          ← col 0, presente en ambas filas
          <th colspan="5">Información financiera</th>  ← título, ignorar
        </tr>
        <tr>
          <th>Monto solicitado</th>               ← cols 1-5
          <th>Monto inicial</th>
          ...
        </tr>
      </thead>
    
    Estrategia: construir headers respetando rowspan/colspan.
    """
    thead = table_tag.find("thead")
    if not thead:
        return []

    header_rows = thead.find_all("tr")
    if not header_rows:
        return []

    # Construir grid de headers respetando rowspan
    # Pasada 1: recoger celdas con rowspan=2 de la fila 1 (ej. "Ejercicio")
    rowspan_headers = {}   # posición → nombre
    col_cursor = 0
    first_row = header_rows[0]
    for th in first_row.find_all("th"):
        rowspan = int(th.get("rowspan", 1))
        colspan = int(th.get("colspan", 1))
        text    = " ".join(th.get_text(separator=" ", strip=True).split())
        if rowspan > 1:
            # Esta celda ocupa varias filas → es un header real de columna
            rowspan_headers[col_cursor] = text
        col_cursor += colspan

    # Pasada 2: recoger celdas de la última fila (los nombres reales de columnas)
    last_row     = header_rows[-1]
    second_row_headers = []
    for th in last_row.find_all("th"):
        text = " ".join(th.get_text(separator=" ", strip=True).split())
        second_row_headers.append(text)

    # Combinar: insertar rowspan_headers en sus posiciones correctas
    headers = []
    second_idx = 0
    total_cols = col_cursor   # total de columnas detectadas en fila 1
    for pos in range(total_cols):
        if pos in rowspan_headers:
            headers.append(rowspan_headers[pos])
        else:
            if second_idx < len(second_row_headers):
                headers.append(second_row_headers[second_idx])
                second_idx += 1

    if not headers:
        return []

    # Parsear filas del tbody
    rows = []
    tbody = table_tag.find("tbody")
    if not tbody:
        return rows

    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        # Saltar fila de TOTAL
        first_cell_text = cells[0].get_text(strip=True).upper()
        if "TOTAL" in first_cell_text:
            continue
        row = {}
        for i, td in enumerate(cells):
            if i >= len(headers):
                break
            span = td.find("span")
            value = span.get_text(strip=True) if span else td.get_text(strip=True)
            row[headers[i]] = value
        if row:
            rows.append(row)
    return rows


def find_table_by_header(soup, keyword: str):
    """Busca la tabla cuyo encabezado principal contiene el keyword."""
    for table in soup.find_all("table"):
        header_row = table.find("tr")
        if header_row and keyword.lower() in header_row.get_text().lower():
            return table
    return None


def parse_project(html: str, snip: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    data = {"snip": snip, "scraped_at": datetime.now(timezone.utc).isoformat()}

    # ── Campos label → <b>valor</b> ──────────────────────────────────────────
    for label_tag in soup.find_all("label"):
        label_text = label_tag.get_text(separator=" ", strip=True)
        bold = label_tag.find("b")
        if not bold:
            continue
        value = bold.get_text(strip=True)
        for field_label, col_name in FIELD_MAP.items():
            if field_label.lower() in label_text.lower():
                data[col_name] = value
                break

    # ── Link ─────────────────────────────────────────────────────────────────
    data["link"] = build_url(snip)

    # ── Google Maps link (si existe en el HTML principal) ────────────────────
    maps_link = None
    for a in soup.find_all("a", href=True):
        if "google.com/maps" in a["href"]:
            maps_link = a["href"]
            break
    data["google_maps_link"] = maps_link

    # ── Coordenadas desde el endpoint de georeferenciación ───────────────────
    data["latitud"]  = None
    data["longitud"] = None
    try:
        georef_url  = GEOREF_URL.format(snip=snip)
        georef_resp = requests.get(georef_url, headers=HEADERS, timeout=20)
        georef_resp.encoding = "utf-8"
        georef_html = georef_resp.text
        # Buscar: new google.maps.LatLng(14.678, -90.608)
        match = re.search(
            r"new\s+google\.maps\.LatLng\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)",
            georef_html
        )
        if match:
            data["latitud"]  = float(match.group(1))
            data["longitud"] = float(match.group(2))
    except Exception:
        pass

    data["tiene_georeferenciacion"] = data["latitud"] is not None

    # ── Tabla: Información financiera ────────────────────────────────────────
    tabla_financiera = find_table_by_header(soup, "financiera")
    if tabla_financiera:
        filas = parse_table(tabla_financiera)
        # Quitar fila de TOTAL si existe
        filas = [f for f in filas if "TOTAL" not in str(list(f.values()))]
        data["informacion_financiera"]           = json.dumps(filas, ensure_ascii=False)
        data["informacion_financiera_tiene_datos"] = len(filas) > 0
    else:
        data["informacion_financiera"]             = json.dumps([])
        data["informacion_financiera_tiene_datos"] = False

    # ── Tabla: Información física ────────────────────────────────────────────
    tabla_fisica = find_table_by_header(soup, "física")
    if not tabla_fisica:
        tabla_fisica = find_table_by_header(soup, "fisica")
    if tabla_fisica:
        filas = parse_table(tabla_fisica)
        data["informacion_fisica"]           = json.dumps(filas, ensure_ascii=False)
        data["informacion_fisica_tiene_datos"] = len(filas) > 0
    else:
        data["informacion_fisica"]             = json.dumps([])
        data["informacion_fisica_tiene_datos"] = False

    return data


def scrape_snip(snip: str) -> tuple[str, dict | None, str | None]:
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
    try:
        html = fetch_html(snip)
        if "PROYECTO NO ENCONTRADO" in html or ("Proyecto:" not in html and "Institución:" not in html):
            return (snip, None, None)  # sin datos — not a real error
        data = parse_project(html, snip)
        return (snip, data, None)
    except Exception as e:
        return (snip, None, str(e))


def get_refresh_snips(df_out: pd.DataFrame) -> list[str]:
    """Devuelve SNIPs de proyectos que no están finalizados y necesitan actualizarse."""
    if df_out.empty or "situacion_actual" not in df_out.columns:
        return []
    mask_final = df_out["situacion_actual"].fillna("").str.upper().str.contains("FINALIZADO")
    return df_out[~mask_final]["snip"].astype(str).tolist()


def flush_buffer_upsert(buffer: list, df_existing: pd.DataFrame) -> tuple[pd.DataFrame, list]:
    """Upsert: reemplaza filas existentes con el mismo snip y agrega las nuevas."""
    df_new    = pd.DataFrame(buffer)
    snips_new = set(df_new["snip"].astype(str))
    df_keep   = df_existing[~df_existing["snip"].astype(str).isin(snips_new)]
    df_updated = pd.concat([df_keep, df_new], ignore_index=True)
    df_updated.to_parquet(OUTPUT_PARQUET, index=False)
    return df_updated, []


def main():
    print("=" * 65)
    print("Scraper SNIPgt — información de proyectos")
    print("=" * 65)

    if not INPUT_PARQUET.exists():
        print(f"[ERROR] No se encontró {INPUT_PARQUET}. Corre primero build_nog_snip.py")
        return

    df_input = pd.read_parquet(INPUT_PARQUET)
    snips = (
        df_input[df_input[COL_SNIP].notna()]
        [COL_SNIP]
        .drop_duplicates()
        .tolist()
    )
    print(f"\nSNIPs únicos con valor:  {len(snips):,}")

    if OUTPUT_PARQUET.exists():
        df_out        = pd.read_parquet(OUTPUT_PARQUET)
        ya_procesados = set(df_out["snip"].astype(str).tolist())
        print(f"SNIPs ya scrapeados:     {len(ya_procesados):,}")
    else:
        df_out        = pd.DataFrame()
        ya_procesados = set()

    # SNIPs nuevos (nunca scrapeados)
    pendientes_nuevos = [s for s in snips if str(s) not in ya_procesados]
    print(f"SNIPs nuevos:            {len(pendientes_nuevos):,}")

    # SNIPs a refrescar (ya scrapeados pero proyecto no finalizado)
    pendientes_refresh = []
    if REFRESH_NON_FINALIZED and not df_out.empty:
        pendientes_refresh = get_refresh_snips(df_out)
        print(f"SNIPs a refrescar:       {len(pendientes_refresh):,}  (no finalizados)")

    pendientes = pendientes_nuevos + pendientes_refresh

    if not pendientes:
        print("\n✅ Todo está al día.")
        return

    print(f"\nScraping ({MAX_WORKERS} workers, delay {DELAY_MIN}–{DELAY_MAX}s, guardando cada {SAVE_EVERY})...\n")

    total  = len(pendientes)
    buffer = []
    errors = []
    found  = 0

    if ERRORS_LOG.exists():
        ERRORS_LOG.unlink()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(scrape_snip, snip): snip for snip in pendientes}
        done = 0
        for future in as_completed(futures):
            snip, data, error = future.result()
            done += 1

            if error:
                msg = f"SNIP {snip}: {error}"
                errors.append(msg)
                with open(ERRORS_LOG, "a") as f:
                    f.write(msg + "\n")
                status = "ERROR"
            elif data:
                buffer.append(data)
                found += 1
                status = f"OK — {data.get('proyecto', '')[:50]}"
                if len(buffer) >= SAVE_EVERY:
                    df_out, buffer = flush_buffer_upsert(buffer, df_out)
                    print(f"  💾 Guardado parcial — {len(df_out):,} filas")
            else:
                status = "sin datos"

            pct = done / total * 100
            print(f"  [{done:>{len(str(total))}}/{total}] {pct:5.1f}%  SNIP {snip}  →  {status}")

    if buffer:
        df_out, buffer = flush_buffer_upsert(buffer, df_out)

    print(f"\n{'─'*65}")
    print(f"  Scrapeados exitosamente: {found:,}")
    print(f"  Errores:                 {len(errors):,}")
    print(f"  Total en parquet:        {len(df_out):,}")

    if errors:
        print(f"\n⚠️  {len(errors)} error(es). Ver: {ERRORS_LOG}")
    else:
        print("\n✅ Completado sin errores.")


if __name__ == "__main__":
    main()