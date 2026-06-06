"""
Construye una tabla de lookup NOG → SNIP de forma incremental.

- Lee los NOGs únicos de guatecompras_adjudicaciones.parquet
- Solo considera filas con proveedor (supplier name no vacío)
- Solo busca los NOGs que aún no están en nog_snip.parquet
- Guarda TODOS los NOGs intentados (con o sin SNIP) para no repetir búsquedas
- Guarda cada 100 registros procesados para no perder progreso si se interrumpe
- Delays aleatorios entre requests para evitar bloqueos

Resultado: nog_snip.parquet  (y nog_snip.csv)
  columnas: compiledRelease/tender/id | snip_number
  snip_number = NULL si no se encontró SNIP

Uso:
    python build_nog_snip.py

Requisitos:
    pip install requests pandas pyarrow pdfplumber pypdf pdf2image pytesseract Pillow
    # También requiere dependencias del sistema:
    #   macOS:  brew install tesseract tesseract-lang poppler
    #   Linux:  apt install tesseract-ocr tesseract-ocr-spa poppler-utils
"""

import re
import io
import time
import random
import requests
import pandas as pd
import pdfplumber
from pypdf import PdfReader
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
SOURCE_PARQUET = Path("Data/guatecompras_adjudicaciones.parquet")
OUTPUT_PARQUET = Path("Data/nog_snip.parquet")
ERRORS_LOG     = Path("errores_nog_snip.txt")

MAX_WORKERS    = 15        # requests en paralelo
DELAY_MIN      = 2.0     # segundos mínimo entre requests
DELAY_MAX      = 5.0     # segundos máximo entre requests
RETRY_ATTEMPTS = 2
SAVE_EVERY     = 100     # guardar al parquet cada N registros procesados

COL_TENDER_ID  = "compiledRelease/tender/id"
COL_SUPPLIER   = "compiledRelease/awards/0/suppliers/0/name"
COL_SNIP       = "snip_number"
COL_BOLETA     = "boleta_snip"
COL_URL        = "compiledRelease/tender/documents/0/url"
# ─────────────────────────────────────────────────────────────────────────────

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; SNIP-Extractor/1.0)"}


def parse_nog(tender_id: str) -> str | None:
    """'GT-NOG-11591781' → '11591781'"""
    if isinstance(tender_id, str) and "GT-NOG-" in tender_id:
        return tender_id.split("GT-NOG-")[-1].strip()
    return None



def _preprocess_for_ocr(img):
    """Preprocesamiento mejorado para documentos SNIP escaneados."""
    from PIL import ImageEnhance, ImageFilter, ImageOps
    # Convertir a escala de grises
    img = img.convert("L")
    # Aumentar resolución si es pequeña
    w, h = img.size
    if w < 2000:
        img = img.resize((w * 2, h * 2), resample=3)  # LANCZOS
    # Contraste agresivo para texto rojo/azul sobre blanco
    img = ImageEnhance.Contrast(img).enhance(2.5)
    img = ImageEnhance.Sharpness(img).enhance(2.0)
    # Binarización: umbral fijo para eliminar fondo gris
    img = img.point(lambda x: 0 if x < 180 else 255, "1")
    return img


def extract_snip_from_pdf(pdf_url: str) -> tuple[str | None, str]:
    for attempt in range(RETRY_ATTEMPTS):
        try:
            resp = requests.get(pdf_url, headers=HEADERS, timeout=60)
            resp.raise_for_status()
            pdf_bytes = io.BytesIO(resp.content)
            break
        except Exception as e:
            if attempt == RETRY_ATTEMPTS - 1:
                raise RuntimeError(f"PDF error: {e}")
            time.sleep(2)

    full_text = []
    ocr_error = None

    # Intento 1: pdfplumber
    try:
        with pdfplumber.open(pdf_bytes) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                result = _find_snip_in_text(t)
                if result:
                    return result, "ok (pdfplumber)"
                full_text.append(t)
    except Exception:
        pass

    # Intento 2: pypdf
    try:
        pdf_bytes.seek(0)
        reader = PdfReader(pdf_bytes)
        # 2a: campos de formulario AcroField
        fields = reader.get_fields() or {}
        for field_name, field in fields.items():
            val = str(field.get("/V", "") or "")
            result = _find_snip_in_text(field_name + " " + val)
            if result:
                return result, "ok (AcroField)"
        # 2b: texto plano
        for page in reader.pages:
            t = page.extract_text() or ""
            result = _find_snip_in_text(t)
            if result:
                return result, "ok (pypdf)"
            full_text.append(t)
    except Exception:
        pass

    # Intento 3: OCR página por página con configuración para SNIP
    try:
        from pdf2image import convert_from_bytes
        import pytesseract
        pdf_bytes.seek(0)
        # Solo primera página — el SNIP siempre está en el encabezado
        images = convert_from_bytes(pdf_bytes.read(), dpi=300, first_page=1, last_page=1)
        for img in images:
            # a) OCR página completa
            img_proc = _preprocess_for_ocr(img)
            t = pytesseract.image_to_string(img_proc, lang="spa",
                config="--psm 6 --oem 3")
            result = _find_snip_in_text(t)
            if result:
                return result, "ok (OCR full)"
            full_text.append(t)

            # b) Recorte del encabezado (top 20% de la página)
            w, h = img.size
            header = img.crop((0, 0, w, int(h * 0.20)))
            header_proc = _preprocess_for_ocr(header)
            t_header = pytesseract.image_to_string(header_proc, lang="spa",
                config="--psm 6 --oem 3")
            result = _find_snip_in_text(t_header)
            if result:
                return result, "ok (OCR header crop)"
            full_text.append(t_header)

    except ImportError as e:
        ocr_error = f"OCR no disponible: {e}"
    except Exception as e:
        ocr_error = f"OCR falló: {e}"

    combined = "\n".join(full_text).strip()
    if not combined:
        msg = "PDF sin texto ni OCR"
        if ocr_error:
            msg += f" ({ocr_error})"
        return None, msg
    return None, "texto extraído pero sin número SNIP"

def _find_snip_in_text(text: str) -> str | None:
    # Normalizar ruido OCR: "S N I P" → "SNIP"
    text = re.sub(r'\bS[\s\-_]?N[\s\-_]?I[\s\-_]?P\b', 'SNIP', text, flags=re.IGNORECASE)
    # Pegar números partidos por salto de línea: "0256\n749" → "0256749"
    text = re.sub(r'(\d{3,})\n(\d{3,})', r'\1\2', text)

    patterns = [
        # Número al inicio de línea seguido de " - título del proyecto" (formato SNIP Guatemala)
        r"^\s*(\d{5,7})\s*[-–]\s*[A-Za-záéíóúñÁÉÍÓÚÑ]\w+",
        # Variantes explícitas con "SNIP"
        r"C[oó]digo\s+SNIP[:\s]+(\d{5,8})",
        r"No\.?\s*(?:de\s+)?(?:SNIP|Proyecto)\s*[:\s]+(\d{5,8})",
        r"N[°úu]m(?:ero)?\.?\s*(?:de\s+)?SNIP\s*[:\s]+(\d{5,8})",
        r"Ficha\s+SNIP\s*[:\s#N°.]*(\d{5,8})",
        r"SNIP\s*[:\s#N°.]+(\d{5,8})",
        r"SNIP[^\d\n]{0,30}(\d{5,8})",
        r"SNIP\s*(\d{5,8})",
        r"(\d{5,8})\s*[-–]\s*SNIP",
        # Número con guión seguido de título (más general, requiere palabra completa)
        r"\b(\d{5,7})\s*[-–]\s*[A-Za-záéíóúñÁÉÍÓÚÑ]\w+",
        r"(?i:snip)[^\n]{0,40}?(\d{5,7})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(1)
    return None


def fetch_snip(tender_id: str, nog: str, pdf_url: str | None) -> tuple[str, str, str | None, str | None, str]:
    """Retorna (tender_id, nog, snip_number, error_msg, status).
    snip_number es None si no se encontró — igual se guarda para no repetir.
    error_msg solo se llena si hubo fallo de red (no se guarda, se reintenta).
    status describe el resultado para el log de progreso.
    """
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
    if not isinstance(pdf_url, str) or not pdf_url.strip():
        url_short = pdf_url.strip().split("/")[-1][:60]
        return (tender_id, nog, None, None, f"{reason} url: {url_short}")
    try:
        snip, reason = extract_snip_from_pdf(pdf_url.strip())
        if snip:
            return (tender_id, nog, snip, None, f"SNIP: {snip}")
        return (tender_id, nog, None, None, reason)
    except Exception as e:
        return (tender_id, nog, None, str(e), "ERROR")


def flush_buffer(buffer: list, df_lookup: pd.DataFrame) -> tuple[pd.DataFrame, list]:
    """Escribe el buffer al parquet y lo vacía."""
    df_new    = pd.DataFrame(buffer)
    df_lookup = pd.concat([df_lookup, df_new], ignore_index=True)
    df_lookup.to_parquet(OUTPUT_PARQUET, index=False)
    return df_lookup, []


def main():
    print("=" * 65)
    print("Builder incremental: NOG → SNIP")
    print("=" * 65)

    # 1. Cargar fuente
    if not SOURCE_PARQUET.exists():
        print(f"[ERROR] No se encontró {SOURCE_PARQUET}")
        return

    print(f"\nCargando {SOURCE_PARQUET}...")
    df_source = pd.read_parquet(SOURCE_PARQUET)

    # Solo filas con proveedor y con boleta_snip = "si"
    con_proveedor = df_source[
        df_source[COL_SUPPLIER].notna() &
        (df_source[COL_SUPPLIER].str.strip() != "")
    ]
    print(f"  Filas con proveedor:   {len(con_proveedor):,} / {len(df_source):,}")

    con_snip_boleta = con_proveedor[
        con_proveedor[COL_BOLETA].str.lower().str.strip() == "si"
    ]
    print(f"  Filas con boleta_snip: {len(con_snip_boleta):,}")

    todos = (
        con_snip_boleta[[COL_TENDER_ID, COL_URL]]
        .drop_duplicates(subset=[COL_TENDER_ID])
        .dropna(subset=[COL_TENDER_ID])
        .copy()
    )
    todos["_nog"] = todos[COL_TENDER_ID].apply(parse_nog)
    todos = todos.dropna(subset=["_nog"])
    print(f"  NOGs únicos en fuente: {len(todos):,}")

    # 2. Cargar lookup existente
    # ya_procesados incluye los que tienen SNIP Y los que tienen NULL
    # (ambos ya fueron intentados y no hay que volver a buscar)
    if OUTPUT_PARQUET.exists():
        df_lookup     = pd.read_parquet(OUTPUT_PARQUET)
        ya_procesados = set(df_lookup[COL_TENDER_ID].tolist())
        con_snip      = df_lookup[COL_SNIP].notna().sum()
        print(f"  NOGs ya en lookup:     {len(ya_procesados):,}  ({con_snip:,} con SNIP, {len(ya_procesados)-con_snip:,} sin SNIP)")
    else:
        df_lookup     = pd.DataFrame(columns=[COL_TENDER_ID, COL_SNIP])
        ya_procesados = set()

    # 3. Filtrar pendientes — los que NO han sido intentados todavía
    pendientes = todos[~todos[COL_TENDER_ID].isin(ya_procesados)]
    print(f"  NOGs pendientes:       {len(pendientes):,}")

    if pendientes.empty:
        print("\n✅ Todo está al día, no hay NOGs nuevos que procesar.")
        return

    # 4. Fetch en paralelo
    print(f"\nBuscando SNIPs ({MAX_WORKERS} workers, delay {DELAY_MIN}–{DELAY_MAX}s, guardando cada {SAVE_EVERY})...\n")

    tasks  = list(pendientes[["_nog", COL_TENDER_ID, COL_URL]].itertuples(index=False))
    total  = len(tasks)
    buffer = []
    errors = []
    found  = 0

    if ERRORS_LOG.exists():
        ERRORS_LOG.unlink()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_snip, row[1], row[0], row[2]): row[1]
            for row in tasks
        }
        done = 0
        for future in as_completed(futures):
            tender_id, nog, snip, error, status = future.result()
            done += 1

            if error:
                # Error de red → NO guardar, para que lo reintente la próxima corrida
                msg = f"NOG {nog} ({tender_id}): {error}"
                errors.append(msg)
                with open(ERRORS_LOG, "a") as f:
                    f.write(msg + "\n")
            else:
                # Exitoso (con o sin SNIP) → guardar siempre en el buffer
                buffer.append({COL_TENDER_ID: tender_id, COL_SNIP: snip})
                if snip:
                    found += 1

                # Flush cada SAVE_EVERY registros
                if len(buffer) >= SAVE_EVERY:
                    df_lookup, buffer = flush_buffer(buffer, df_lookup)
                    print(f"  💾 Guardado parcial — {len(df_lookup):,} filas en {OUTPUT_PARQUET}")

            pct = done / total * 100
            print(f"  [{done:>{len(str(total))}}/{total}] {pct:5.1f}%  {tender_id}  →  {status}")

    # Flush final con lo que quedó en el buffer
    if buffer:
        df_lookup, buffer = flush_buffer(buffer, df_lookup)

    # 5. Reporte final
    print(f"\n{'─'*65}")
    print(f"  Procesados esta corrida: {done:,}")
    print(f"  Con SNIP:                {found:,}")
    print(f"  Sin SNIP (guardados):    {done - found - len(errors):,}")
    print(f"  Errores (se reintentarán): {len(errors):,}")
    print(f"  Total filas en lookup:   {len(df_lookup):,}")

    if errors:
        print(f"\n⚠️  {len(errors)} error(es). Ver: {ERRORS_LOG}")
    else:
        print("\n✅ Completado sin errores.")


if __name__ == "__main__":
    main()