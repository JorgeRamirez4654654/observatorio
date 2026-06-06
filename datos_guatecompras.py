"""
Descarga los Excel mensuales de GuateCompras OCDS y construye una tabla
consolidada con información de licitaciones y adjudicaciones.

Resultado: guatecompras_adjudicaciones.parquet  (y .csv opcional)

Uso:
    python download_guatecompras.py

Requisitos:
    pip install requests pandas openpyxl pyarrow
"""

import io
import os
import requests
import pandas as pd
from pathlib import Path
from datetime import datetime

# ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
BASE_URL      = "https://ocds.guatecompras.gt/file/xlsx/{year}/{month}"
YEAR_START    = 2020
MONTH_START   = 1
# Usar el mes actual para detectar automáticamente datos nuevos
_hoy       = datetime.today()
YEAR_END   = _hoy.year
MONTH_END  = _hoy.month

# Cuántos meses recientes siempre re-descargar (el mes actual puede tener filas
# nuevas hasta el cierre del mes, y el anterior por datos tardíos)
REFRESH_LAST_N_MONTHS = 2

OUTPUT_PARQUET = Path("Data/guatecompras_adjudicaciones.parquet")
ERRORS_LOG     = Path("errores_descarga.txt")

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; GuateCompras-Downloader/1.0)"}
# ─────────────────────────────────────────────────────────────────────────────

# Columnas que necesitamos de cada hoja
COLS_RECORDS  = [
    "compiledRelease/id",
    "compiledRelease/tender/id",
    "compiledRelease/tender/title",
    # Nuevos campos OCDS para detección de fraude
    "compiledRelease/tender/procurementMethod",
    "compiledRelease/tender/procurementMethodDetails",
    "compiledRelease/tender/numberOfTenderers",
]
COLS_SUPPLIERS = [
    "compiledRelease/id",
    "compiledRelease/awards/0/suppliers/0/id",
    "compiledRelease/awards/0/suppliers/0/name",
]
COLS_AWARDS = [
    "compiledRelease/id",
    "compiledRelease/awards/0/value/amount",
    "compiledRelease/awards/0/value/currency",
    "compiledRelease/awards/0/status",
]
COLS_TEN_DOCUMENTS = [
    "compiledRelease/tender/id",
    "compiledRelease/tender/documents/0/title",
    "compiledRelease/tender/documents/0/url",
]
# Hojas candidatas donde GuateCompras almacena datos de licitación
# (la API OCDS Excel usa distintos nombres según la versión del archivo)
TENDER_SHEET_CANDIDATES = [
    "com_tender", "com_tenders", "tenders", "com_ten", "tender",
    "com_ten_info", "com_ten_data",
]
# Hojas candidatas con lista de oferentes (para contar si numberOfTenderers no está)
TENDERERS_SHEET_CANDIDATES = [
    "com_ten_tenderers", "com_tenderers", "tenderers",
    "com_bidders", "bidders", "com_ten_bidders",
]


def months_to_process() -> list[tuple[int, int]]:
    """Genera lista de (year, month) desde el inicio hasta el fin."""
    result = []
    for year in range(YEAR_START, YEAR_END + 1):
        m_start = MONTH_START if year == YEAR_START else 1
        m_end   = MONTH_END   if year == YEAR_END   else 12
        for month in range(m_start, m_end + 1):
            result.append((year, month))
    return result


def _is_recent_month(year: int, month: int) -> bool:
    """Devuelve True si el mes cae dentro de la ventana de refresco."""
    total_months = _hoy.year * 12 + _hoy.month
    cutoff_months = total_months - (REFRESH_LAST_N_MONTHS - 1)
    period_months = year * 12 + month
    return period_months >= cutoff_months


def already_processed(year: int, month: int, existing_df: pd.DataFrame) -> bool:
    """Revisa si ese año/mes ya está en el parquet existente.

    Los meses recientes (dentro de REFRESH_LAST_N_MONTHS) siempre se
    re-descargan porque el sitio puede agregar filas durante el mes.
    """
    if _is_recent_month(year, month):
        return False
    if existing_df is None or existing_df.empty:
        return False
    if "_year" not in existing_df.columns or "_month" not in existing_df.columns:
        return False
    mask = (existing_df["_year"] == year) & (existing_df["_month"] == month)
    return mask.any()


def download_excel(year: int, month: int) -> bytes | None:
    """Descarga el Excel y retorna los bytes, o None si falla."""
    url = BASE_URL.format(year=year, month=month)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60)
        if resp.status_code == 404:
            return None  # mes sin datos, no es un error
        resp.raise_for_status()
        # Verificar que sea ZIP o Excel (ambos empiezan con PK magic bytes)
        if len(resp.content) < 4 or resp.content[:2] != b"PK":
            raise ValueError(f"Respuesta no es un archivo válido (posible HTML de error, {len(resp.content)} bytes)")
        return resp.content
    except Exception as e:
        raise RuntimeError(f"{year}/{month:02d} — {e}") from e


def extract_columns(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Extrae solo las columnas que existen en el df (evita KeyError)."""
    available = [c for c in cols if c in df.columns]
    missing   = [c for c in cols if c not in df.columns]
    if missing:
        print(f"    [WARN] Columnas no encontradas, se rellenarán con NaN: {missing}")
    result = df[available].copy()
    for c in missing:
        result[c] = pd.NA
    return result[cols]  # orden garantizado


def unwrap_content(content: bytes) -> io.BytesIO:
    """
    El servidor a veces devuelve un ZIP que contiene el Excel adentro.
    Detecta si es ZIP, extrae el primer .xlsx que encuentre.
    Si ya es un Excel directo, lo retorna tal cual.
    """
    import zipfile
    if content[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                xlsx_names = [n for n in zf.namelist() if n.lower().endswith(".xlsx")]
                if xlsx_names:
                    return io.BytesIO(zf.read(xlsx_names[0]))
        except zipfile.BadZipFile:
            pass
    return io.BytesIO(content)


def _find_sheet(sheet_names: list[str], candidates: list[str]) -> str | None:
    """Devuelve el primer nombre de hoja que coincida con algún candidato (case-insensitive)."""
    lower_names = {s.lower(): s for s in sheet_names}
    for c in candidates:
        if c.lower() in lower_names:
            return lower_names[c.lower()]
    return None


def process_excel(content: bytes, year: int, month: int) -> pd.DataFrame | None:
    """Lee el Excel y devuelve el DataFrame consolidado del mes."""
    xls = pd.ExcelFile(unwrap_content(content))
    sheet_names = xls.sheet_names

    # Verificar hojas necesarias
    needed = {"records", "com_awa_suppliers", "com_awards"}
    missing_sheets = needed - set(sheet_names)
    if missing_sheets:
        raise ValueError(f"Hojas faltantes en el Excel: {missing_sheets}. Hojas disponibles: {sheet_names}")

    # Leer cada hoja
    df_records   = pd.read_excel(xls, sheet_name="records",           dtype=str)
    df_suppliers = pd.read_excel(xls, sheet_name="com_awa_suppliers", dtype=str)
    df_awards    = pd.read_excel(xls, sheet_name="com_awards",        dtype=str)

    # Extraer columnas necesarias
    records   = extract_columns(df_records,   COLS_RECORDS)
    suppliers = extract_columns(df_suppliers, COLS_SUPPLIERS)
    awards    = extract_columns(df_awards,    COLS_AWARDS)

    # Left joins sobre compiledRelease/id
    merged = (
        records
        .merge(suppliers, on="compiledRelease/id", how="left")
        .merge(awards,    on="compiledRelease/id", how="left")
    )

    # ── Hoja de licitación: procurementMethod y numberOfTenderers ────────────
    # Si los campos ya vienen en la hoja records (frecuente en versiones recientes
    # del formato), ya los tenemos. Si no, buscamos una hoja de tender dedicada.
    tender_sheet = _find_sheet(sheet_names, TENDER_SHEET_CANDIDATES)
    if tender_sheet:
        df_ten = pd.read_excel(xls, sheet_name=tender_sheet, dtype=str)
        # La hoja puede unirse por tender/id o por release/id
        key_col = None
        if "compiledRelease/tender/id" in df_ten.columns:
            key_col = "compiledRelease/tender/id"
        elif "compiledRelease/id" in df_ten.columns:
            key_col = "compiledRelease/id"
        if key_col:
            target_cols = [c for c in [
                key_col,
                "compiledRelease/tender/procurementMethod",
                "compiledRelease/tender/procurementMethodDetails",
                "compiledRelease/tender/numberOfTenderers",
            ] if c in df_ten.columns]
            if len(target_cols) > 1:
                ten_data = df_ten[target_cols].drop_duplicates(subset=[key_col])
                merged = merged.merge(ten_data, on=key_col, how="left", suffixes=("", "_ten"))
                # Preferir versión de la hoja tender sobre la de records si ambas existen
                for col in ["compiledRelease/tender/procurementMethod",
                            "compiledRelease/tender/procurementMethodDetails",
                            "compiledRelease/tender/numberOfTenderers"]:
                    col_ten = col + "_ten"
                    if col_ten in merged.columns:
                        merged[col] = merged[col].combine_first(merged[col_ten])
                        merged.drop(columns=[col_ten], inplace=True)

    # ── Hoja de oferentes: contar si numberOfTenderers no vino del tender ────
    n_tend_col = "compiledRelease/tender/numberOfTenderers"
    if n_tend_col not in merged.columns or merged[n_tend_col].isna().all():
        tenderers_sheet = _find_sheet(sheet_names, TENDERERS_SHEET_CANDIDATES)
        if tenderers_sheet:
            df_tend = pd.read_excel(xls, sheet_name=tenderers_sheet, dtype=str)
            # Contar oferentes únicos por NOG/tender id
            key_col = next(
                (c for c in ["compiledRelease/tender/id", "compiledRelease/id"]
                 if c in df_tend.columns), None
            )
            if key_col:
                tenderer_id_col = next(
                    (c for c in df_tend.columns if "tenderer" in c.lower() or "bidder" in c.lower()), None
                )
                if tenderer_id_col:
                    count_df = (
                        df_tend.groupby(key_col)[tenderer_id_col]
                        .nunique()
                        .reset_index()
                        .rename(columns={tenderer_id_col: n_tend_col})
                    )
                    count_df[n_tend_col] = count_df[n_tend_col].astype(str)
                    merge_col = key_col if key_col in merged.columns else "compiledRelease/id"
                    merged = merged.merge(count_df, left_on=merge_col, right_on=key_col, how="left",
                                          suffixes=("", "_cnt"))
                    if key_col + "_cnt" in merged.columns:
                        merged.drop(columns=[key_col + "_cnt"], inplace=True)

    # boleta_snip: si algún documento de la licitación contiene "snip" en el título
    if "com_ten_documents" in sheet_names:
        df_ten_docs = pd.read_excel(xls, sheet_name="com_ten_documents", dtype=str)
        ten_docs    = extract_columns(df_ten_docs, COLS_TEN_DOCUMENTS)
        title_col = "compiledRelease/tender/documents/0/title"
        url_col   = "compiledRelease/tender/documents/0/url"
        ten_docs["_has_snip"] = ten_docs[title_col].str.contains("snip", case=False, na=False)
        snip_flag = (
            ten_docs.groupby("compiledRelease/tender/id")["_has_snip"]
            .any()
            .reset_index()
        )
        snip_flag["boleta_snip"] = snip_flag["_has_snip"].map({True: "si", False: "no"})
        snip_flag = snip_flag[["compiledRelease/tender/id", "boleta_snip"]]
        url_per_tender = (
            ten_docs[ten_docs["_has_snip"]]
            .groupby("compiledRelease/tender/id")[url_col]
            .first()
            .reset_index()
        )
        merged = (
            merged
            .merge(snip_flag,      on="compiledRelease/tender/id", how="left")
            .merge(url_per_tender, on="compiledRelease/tender/id", how="left")
        )
        merged["boleta_snip"] = merged["boleta_snip"].fillna("no")
    else:
        merged["boleta_snip"] = pd.NA
        merged[url_col] = pd.NA

    # Convertir campos numéricos
    for num_col in [
        "compiledRelease/awards/0/value/amount",
        "compiledRelease/tender/numberOfTenderers",
    ]:
        if num_col in merged.columns:
            merged[num_col] = pd.to_numeric(merged[num_col], errors="coerce")

    # Agregar columnas de trazabilidad
    merged["_year"]  = year
    merged["_month"] = month

    return merged


def load_existing() -> pd.DataFrame | None:
    """Carga el parquet existente si hay uno."""
    if OUTPUT_PARQUET.exists():
        print(f"Cargando datos existentes desde {OUTPUT_PARQUET}...")
        return pd.read_parquet(OUTPUT_PARQUET)
    return None


def save(df: pd.DataFrame):
    """Guarda el DataFrame en Parquet."""
    df.to_parquet(OUTPUT_PARQUET, index=False)
    print(f"  Guardado: {OUTPUT_PARQUET}  ({len(df):,} filas)")


def log_error(msg: str):
    """Agrega el error al log de errores."""
    with open(ERRORS_LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")
    print(f"  [ERROR] {msg}")


def main():
    print("=" * 65)
    print("GuateCompras OCDS — Descarga y consolidación de adjudicaciones")
    print("=" * 65)

    # Limpiar log de errores anterior
    if ERRORS_LOG.exists():
        ERRORS_LOG.unlink()

    existing_df = load_existing()
    new_chunks  = []
    errors      = []

    periods = months_to_process()
    print(f"Períodos a revisar: {len(periods)}  ({YEAR_START}/{MONTH_START:02d} → {YEAR_END}/{MONTH_END:02d})\n")

    # Meses recientes que ya estaban en el parquet y serán reemplazados
    refreshed_periods: set[tuple[int, int]] = set()

    for year, month in periods:
        label = f"{year}/{month:02d}"

        # Skip si ya fue procesado (excepto meses en ventana de refresco)
        if already_processed(year, month, existing_df):
            print(f"  {label}  [SKIP] ya existe en el archivo")
            continue

        is_refresh = (
            _is_recent_month(year, month)
            and existing_df is not None
            and not existing_df.empty
            and "_year" in existing_df.columns
            and ((existing_df["_year"] == year) & (existing_df["_month"] == month)).any()
        )
        if is_refresh:
            refreshed_periods.add((year, month))
            print(f"  {label}  [REFRESH] re-descargando para capturar filas nuevas...", end=" ", flush=True)
        else:
            print(f"  {label}  Descargando...", end=" ", flush=True)

        # Descargar
        try:
            content = download_excel(year, month)
        except RuntimeError as e:
            msg = str(e)
            print(f"\n  [ERROR] {msg}")
            log_error(msg)
            errors.append(msg)
            continue

        if content is None:
            print("sin datos (404), saltando")
            continue

        print(f"{len(content)/1024:.0f} KB  →  procesando...", end=" ", flush=True)

        # Procesar
        try:
            df_month = process_excel(content, year, month)
            new_chunks.append(df_month)
            print(f"{len(df_month):,} filas  ✓")
        except Exception as e:
            msg = f"{label} — Error al procesar: {e}"
            print(f"\n  [ERROR] {msg}")
            log_error(msg)
            errors.append(msg)

    # Consolidar y guardar
    print("\n" + "=" * 65)
    if not new_chunks:
        print("No hay datos nuevos que agregar.")
        if existing_df is not None:
            print(f"El archivo existente tiene {len(existing_df):,} filas.")
        return

    new_df = pd.concat(new_chunks, ignore_index=True)
    print(f"Filas descargadas: {len(new_df):,}")

    if existing_df is not None and not existing_df.empty:
        # Eliminar filas de períodos que se refrescaron para no duplicar
        if refreshed_periods:
            keep_mask = ~existing_df.apply(
                lambda r: (int(r["_year"]), int(r["_month"])) in refreshed_periods, axis=1
            )
            existing_df = existing_df[keep_mask]
        final_df = pd.concat([existing_df, new_df], ignore_index=True)
    else:
        final_df = new_df

    print(f"Total filas en archivo final: {len(final_df):,}")
    save(final_df)

    # Reporte de errores
    if errors:
        print(f"\n⚠️  {len(errors)} error(es) durante la descarga. Ver: {ERRORS_LOG}")
        for e in errors:
            print(f"   • {e}")
    else:
        print("\n✅ Completado sin errores.")


if __name__ == "__main__":
    main()