"""
Preprocessing de snip_proyectos.csv

Produce una tabla con una fila por SNIP + Ejercicio:
  - Columnas fijas del proyecto repetidas en cada fila
  - Columnas anuales: financiera y física por ejercicio

Resultado: snip_proyectos_clean.parquet  (y snip_proyectos_clean.csv)

Uso:
    python preprocess_snip.py

Requisitos:
    pip install pandas pyarrow
"""

import re
import json
import unicodedata
import pandas as pd
from pathlib import Path

# ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
INPUT_PARQUET      = Path("Data/snip_proyectos.parquet")
OUTPUT_PARQUET     = Path("Data/snip_proyectos_clean.parquet")
ALCALDES_XLSX      = Path("Data/alcaldes_municipales_gt_2015_2019_2023.xlsx")
NOG_SNIP_PARQUET   = Path("Data/nog_snip.parquet")
GUATECOMPRAS_PARQUET = Path("Data/guatecompras_adjudicaciones.parquet")
# ─────────────────────────────────────────────────────────────────────────────


# ── Helpers ──────────────────────────────────────────────────────────────────

def normalizar(texto: str) -> str:
    """Quita tildes y convierte a mayúsculas."""
    if pd.isna(texto):
        return texto
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFKD", str(texto))
        if not unicodedata.combining(c)
    )
    return sin_tildes.upper().strip()


def parse_json_col(val) -> list:
    """Convierte string JSON a lista de dicts."""
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            try:
                return json.loads(val.replace("'", '"'))
            except Exception:
                return []
    return []


def limpiar_monto(val) -> float | None:
    """'1,332,450.00' → 1332450.0"""
    if pd.isna(val) or str(val).strip() in ("", "0", "-"):
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except Exception:
        return None


def limpiar_porcentaje(val) -> float | None:
    """'100.00 %' → 100.0"""
    if pd.isna(val) or str(val).strip() == "":
        return None
    try:
        return float(str(val).replace("%", "").replace(",", "").strip())
    except Exception:
        return None


def separar_meta(val) -> tuple[float | None, str | None]:
    """'3.80 Kilometro' → (3.80, 'Kilometro')"""
    if pd.isna(val) or str(val).strip() == "":
        return (None, None)
    parts = str(val).strip().split(" ", 1)
    try:
        numero = float(parts[0].replace(",", ""))
    except Exception:
        return (None, val)
    unidad = parts[1].strip() if len(parts) > 1 else None
    return (numero, unidad)


def parse_opinion(val) -> tuple[str | None, str | None]:
    """
    'APROBADO, Ejercicio: 2020' → ('APROBADO', '2020')
    'NO RECIBIDO OFICIALMENTE, Ejercicio:' → ('NO RECIBIDO OFICIALMENTE', None)
    """
    if pd.isna(val) or str(val).strip() == "":
        return (None, None)
    partes = str(val).split(",", 1)
    resultado = partes[0].strip()
    ejercicio = None
    if len(partes) > 1:
        match = re.search(r"\d{4}", partes[1])
        if match:
            ejercicio = match.group(0)
    return (resultado, ejercicio)


def parse_situacion(val) -> tuple[str | None, str | None]:
    """
    'FINALIZADO (16/12/2020)' → ('FINALIZADO', '2020-12-16')
    'EN EJECUCIÓN'            → ('EN EJECUCIÓN', None)
    """
    if pd.isna(val) or str(val).strip() == "":
        return (None, None)
    val = str(val).strip()
    match = re.search(r"\((\d{2}/\d{2}/\d{4})\)", val)
    if match:
        estado = val[:match.start()].strip()
        fecha_str = match.group(1)   # dd/mm/yyyy
        try:
            fecha = pd.to_datetime(fecha_str, format="%d/%m/%Y").strftime("%Y-%m-%d")
        except Exception:
            fecha = None
        return (estado, fecha)
    return (val, None)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 65)
    print("Preprocessing snip_proyectos.parquet")
    print("=" * 65)

    # 1. Cargar
    df = pd.read_parquet(INPUT_PARQUET)
    df["snip"] = df["snip"].astype(str)
    print(f"\nFilas originales:  {len(df):,}")
    print(f"Columnas:          {len(df.columns)}")

    # 2. Separar municipio / departamento
    df["municipio"]    = df["ubicacion_geografica"].apply(
        lambda x: x.split(",")[0].strip() if pd.notnull(x) and "," in x else x
    )
    df["departamento"] = df["ubicacion_geografica"].apply(
        lambda x: x.split(",")[1].strip() if pd.notnull(x) and "," in x else None
    )
    df["municipio"] = df["municipio"].str.replace("MULTIMUNICIPAL - ", "", regex=False)

    # 3. Extraer opinion_tecnica
    df[["opinion_resultado", "opinion_ejercicio"]] = df["opinion_tecnica"].apply(
        lambda x: pd.Series(parse_opinion(x))
    )

    # 4. Extraer situacion_actual
    df[["situacion_estado", "situacion_fecha"]] = df["situacion_actual"].apply(
        lambda x: pd.Series(parse_situacion(x))
    )

    # 5. Normalizar texto categórico
    cols_normalizar = ["municipio", "departamento", "institucion",
                       "unidad_ejecutora", "sector", "sector_especifico",
                       "especie", "etapa_actual", "situacion_estado",
                       "opinion_resultado"]
    for col in cols_normalizar:
        if col in df.columns:
            df[col] = df[col].apply(normalizar)

    # 6. Parsear columnas JSON
    df["informacion_financiera"] = df["informacion_financiera"].apply(parse_json_col)
    df["informacion_fisica"]     = df["informacion_fisica"].apply(parse_json_col)

    # ── Columnas base del proyecto (se repetirán por ejercicio) ──────────────
    cols_base = [
        "snip", "proyecto", "institucion", "unidad_ejecutora",
        "sector", "sector_especifico", "especie",
        "municipio", "departamento",
        "situacion_estado", "situacion_fecha",
        "opinion_resultado", "opinion_ejercicio",
        "etapa_actual", "meta_global",
        "latitud", "longitud", "tiene_georeferenciacion",
        "link", "scraped_at",
    ]

    # 7. Expandir información financiera
    df_fin = df[cols_base + ["informacion_financiera"]].explode("informacion_financiera")
    fin_norm = pd.json_normalize(df_fin["informacion_financiera"].where(
        df_fin["informacion_financiera"].apply(lambda x: isinstance(x, dict)),
        other={}
    ))
    df_fin = df_fin[cols_base].reset_index(drop=True)
    fin_norm = fin_norm.reset_index(drop=True)

    # Renombrar columnas financieras
    fin_rename = {
        "Ejercicio"         : "ejercicio",
        "Monto solicitado"  : "monto_solicitado",
        "Monto inicial"     : "monto_inicial",
        "Monto vigente"     : "monto_vigente",
        "Monto ejecutado"   : "monto_ejecutado",
        "Avance financiero" : "avance_financiero",
    }
    fin_norm.rename(columns=fin_rename, inplace=True)
    df_fin = pd.concat([df_fin, fin_norm], axis=1)

    # 8. Expandir información física
    df_fis = df[["snip", "informacion_fisica"]].explode("informacion_fisica")
    fis_norm = pd.json_normalize(df_fis["informacion_fisica"].where(
        df_fis["informacion_fisica"].apply(lambda x: isinstance(x, dict)),
        other={}
    ))
    df_fis = df_fis[["snip"]].reset_index(drop=True)
    fis_norm = fis_norm.reset_index(drop=True)

    fis_rename = {
        "Ejercicio"        : "ejercicio",
        "Meta física"      : "_meta_fisica_raw",
        "Meta ejecutada"   : "_meta_ejecutada_raw",
        "Avance meta anual": "avance_meta_anual",
    }
    fis_norm.rename(columns=fis_rename, inplace=True)
    df_fis = pd.concat([df_fis, fis_norm], axis=1)

    # 9. Join financiera + física por snip + ejercicio
    df_final = pd.merge(df_fin, df_fis, on=["snip", "ejercicio"], how="outer")

    # Eliminar filas donde todos los campos anuales son nulos
    # (ocurre cuando un SNIP tiene física vacía pero financiera con datos)
    cols_anuales = ["monto_solicitado", "monto_inicial", "monto_vigente",
                    "monto_ejecutado", "_meta_fisica_raw", "_meta_ejecutada_raw"]
    cols_anuales_existentes = [c for c in cols_anuales if c in df_final.columns]
    if cols_anuales_existentes:
        df_final = df_final[~df_final[cols_anuales_existentes].isna().all(axis=1)]

    # 10. Limpiar montos a float
    for col in ["monto_solicitado", "monto_inicial", "monto_vigente", "monto_ejecutado"]:
        if col in df_final.columns:
            df_final[col] = df_final[col].apply(limpiar_monto)

    # 11. Limpiar porcentajes a float
    for col in ["avance_financiero", "avance_meta_anual"]:
        if col in df_final.columns:
            df_final[col] = df_final[col].apply(limpiar_porcentaje)

    # 12. Separar valor y unidad de metas físicas
    if "_meta_fisica_raw" in df_final.columns:
        df_final[["meta_fisica", "unidad"]] = df_final["_meta_fisica_raw"].apply(
            lambda x: pd.Series(separar_meta(x))
        )
        df_final.drop(columns=["_meta_fisica_raw"], inplace=True)

    if "_meta_ejecutada_raw" in df_final.columns:
        df_final[["meta_ejecutada", "_unidad2"]] = df_final["_meta_ejecutada_raw"].apply(
            lambda x: pd.Series(separar_meta(x))
        )
        df_final.drop(columns=["_meta_ejecutada_raw", "_unidad2"], inplace=True)

    # 13. Ejercicio como int
    if "ejercicio" in df_final.columns:
        df_final["ejercicio"] = pd.to_numeric(df_final["ejercicio"], errors="coerce").astype("Int64")

    # 14. Ordenar
    df_final = df_final.sort_values(["snip", "ejercicio"]).reset_index(drop=True)

    # 15. Agregar a 1 fila por SNIP
    cols_first = [
        "proyecto", "institucion", "unidad_ejecutora",
        "sector", "sector_especifico", "especie",
        "municipio", "departamento",
        "situacion_estado", "situacion_fecha",
        "opinion_resultado", "opinion_ejercicio",
        "etapa_actual", "meta_global",
        "latitud", "longitud", "tiene_georeferenciacion", "link", "scraped_at",
        "ejercicio", "unidad",
    ]
    cols_first = [c for c in cols_first if c in df_final.columns]
    cols_fin   = [c for c in ["monto_solicitado", "monto_inicial", "monto_vigente", "monto_ejecutado"] if c in df_final.columns]
    cols_meta  = [c for c in ["meta_fisica", "meta_ejecutada"] if c in df_final.columns]

    df_first = df_final.groupby("snip", sort=False)[cols_first].first()

    # Sumar montos ignorando filas con avance_financiero == 0
    mask_fin  = df_final["avance_financiero"].fillna(0) != 0 if "avance_financiero" in df_final.columns else pd.Series(True, index=df_final.index)
    # Sumar metas ignorando filas con avance_meta_anual == 0
    mask_meta = df_final["avance_meta_anual"].fillna(0) != 0 if "avance_meta_anual" in df_final.columns else pd.Series(True, index=df_final.index)
    df_fin_agg  = df_final[mask_fin].groupby("snip", sort=False)[cols_fin].sum()
    df_meta_agg = df_final[mask_meta].groupby("snip", sort=False)[cols_meta].sum()

    df_final = df_first.join(df_fin_agg).join(df_meta_agg).reset_index()

    # Calcular avances como ratio
    if {"monto_ejecutado", "monto_vigente"}.issubset(df_final.columns):
        df_final["avance_financiero"] = df_final["monto_ejecutado"] / df_final["monto_vigente"].replace(0, pd.NA)
    if {"meta_ejecutada", "meta_fisica"}.issubset(df_final.columns):
        df_final["avance_meta_anual"] = df_final["meta_ejecutada"] / df_final["meta_fisica"].replace(0, pd.NA)

    if {"meta_ejecutada", "monto_ejecutado"}.issubset(df_final.columns):
        df_final["costo_por_unidad"] = df_final["monto_ejecutado"] / df_final["meta_ejecutada"].replace(0, pd.NA)

    # 17. Join con alcaldes municipales
    if ALCALDES_XLSX.exists():
        df_alcaldes = pd.read_excel(ALCALDES_XLSX)
        df_alcaldes["municipio"]    = df_alcaldes["municipio"].apply(normalizar)
        df_alcaldes["departamento"] = df_alcaldes["departamento"].apply(normalizar)
        df_alcaldes = df_alcaldes.rename(columns={"anio_eleccion": "periodo_alcalde"})

        mapeo_alcaldes_a_snip = {
            "BARTOLOME MILPAS ALTAS": "SAN BARTOLOME MILPAS ALTAS",
            "OSTUNCALCO"            : "SAN JUAN OSTUNCALCO",
            "SAN JUAN COMALAPA"     : "COMALAPA",
            "SAN CRISTOBAL"         : "SAN CRISTOBAL TOTONICAPAN",
            "SAN MIGUEL PETAPA"     : "PETAPA",
            "SAN BARTOLO"           : "SAN BARTOLO AGUAS CALIENTES",
            "SOLOMA"                : "SAN PEDRO SOLOMA",
            "IXTAHUACAN"            : "SAN ILDEFONSO IXTAHUACAN",
            "SAN RAIMUNDO"          : "SAN RAYMUNDO",
            "YEPOCAPA"              : "SAN PEDRO YEPOCAPA",
        }
        df_alcaldes["municipio"] = df_alcaldes["municipio"].replace(mapeo_alcaldes_a_snip)

        def mapear_periodo(anio):
            if pd.isna(anio):
                return None
            anio = int(anio)
            if 2015 <= anio <= 2018: return 2015
            if 2019 <= anio <= 2022: return 2019
            if 2023 <= anio <= 2026: return 2023
            return None

        df_final["periodo_alcalde"] = df_final["ejercicio"].apply(mapear_periodo)
        df_alcaldes["periodo_alcalde"] = df_alcaldes["periodo_alcalde"].astype("Int64")
        df_final["periodo_alcalde"]    = df_final["periodo_alcalde"].astype("Int64")

        df_final = pd.merge(
            df_final,
            df_alcaldes,
            on=["municipio", "departamento", "periodo_alcalde"],
            how="left",
        )
        print(f"Join alcaldes: {df_final['alcalde_ganador'].notna().sum():,} SNIPs con alcalde asignado")
    else:
        print(f"⚠️  {ALCALDES_XLSX} no encontrado — join de alcaldes omitido")

    # 18. nog_snip como ground truth
    if NOG_SNIP_PARQUET.exists():
        df_nog = pd.read_parquet(NOG_SNIP_PARQUET)
        df_nog["snip_number"] = df_nog["snip_number"].astype(str)
        df_final["snip"] = df_final["snip"].astype(str)

        # nog_snip LEFT JOIN snip_proyectos
        df_final = pd.merge(
            df_nog,
            df_final,
            left_on="snip_number",
            right_on="snip",
            how="left",
        )
        print(f"Join nog_snip ← snip_proyectos: {df_final['snip'].notna().sum():,} NOGs con datos SNIP")

        # nog_snip LEFT JOIN guatecompras
        if GUATECOMPRAS_PARQUET.exists():
            df_gc = pd.read_parquet(GUATECOMPRAS_PARQUET)
            df_final = pd.merge(
                df_final,
                df_gc,
                on="compiledRelease/tender/id",
                how="left",
            )
            print(f"Join nog_snip ← guatecompras: {len(df_final):,} filas tras join")
        else:
            print(f"⚠️  {GUATECOMPRAS_PARQUET} no encontrado — join de guatecompras omitido")
    else:
        print(f"⚠️  {NOG_SNIP_PARQUET} no encontrado — join de nog_snip omitido")

    # 19. Reordenar columnas
    col_order = [
        "snip", "proyecto", "institucion", "unidad_ejecutora",
        "sector", "sector_especifico", "especie",
        "municipio", "departamento",
        "situacion_estado", "situacion_fecha",
        "opinion_resultado", "opinion_ejercicio",
        "etapa_actual", "meta_global",
        "latitud", "longitud", "tiene_georeferenciacion", "link", "scraped_at",
        "ejercicio", "periodo_alcalde",
        "alcalde_ganador", "siglas_ganadora", "organizacion_ganadora",
        "monto_solicitado", "monto_inicial", "monto_vigente", "monto_ejecutado", "avance_financiero",
        "meta_fisica", "meta_ejecutada", "unidad", "avance_meta_anual", "costo_por_unidad",
        "compiledRelease/tender/id",
        "compiledRelease/tender/title",
        "compiledRelease/id",
        # Nuevos campos OCDS de licitación
        "compiledRelease/tender/procurementMethod",
        "compiledRelease/tender/procurementMethodDetails",
        "compiledRelease/tender/numberOfTenderers",
        "compiledRelease/awards/0/suppliers/0/id",
        "compiledRelease/awards/0/suppliers/0/name",
        "compiledRelease/awards/0/value/amount",
        "compiledRelease/awards/0/value/currency",
        "compiledRelease/awards/0/status",
    ]
    col_order = [c for c in col_order if c in df_final.columns]
    df_final  = df_final[col_order]

    # 20. Correcciones manuales de valores erróneos en fuente
    # Formato: (snip, columna, valor_incorrecto, valor_correcto)
    CORRECCIONES = [
        ("340674", "compiledRelease/awards/0/value/amount", 2_514_000_000.0, 2_514_000.0),
    ]
    for snip_id, col, wrong, right in CORRECCIONES:
        if col in df_final.columns:
            mask = (df_final["snip"].astype(str) == str(snip_id)) & (df_final[col] == wrong)
            if mask.any():
                df_final.loc[mask, col] = right
                print(f"  Corrección SNIP {snip_id} · {col}: {wrong:,.0f} → {right:,.0f}")

    # 21. Deduplicar por snip
    antes = len(df_final)
    df_final = df_final.drop_duplicates(subset="snip", keep="first")
    print(f"Duplicados eliminados: {antes - len(df_final):,}")

    # 21. Reporte
    print(f"Filas finales:     {len(df_final):,}")
    print(f"Columnas finales:  {len(df_final.columns)}")

    # 22. Guardar
    df_final.to_parquet(OUTPUT_PARQUET, index=False)
    print(f"\n✓ {OUTPUT_PARQUET}")
    print("\n✅ Completado.")


if __name__ == "__main__":
    main()