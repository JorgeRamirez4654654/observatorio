"""
FastAPI backend for the Observatorio de Ejecución Presupuestaria dashboard.
Run from the project root:
    uvicorn backend.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import math
import subprocess
import unicodedata
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SECRET_KEY = "observatorio_secret_key_2024"
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8

_pwd_ctx = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Paths are relative to the project root (parent of backend/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "Data"
PARQUET_PATH = DATA_DIR / "snip_proyectos_clean.parquet"
CSV_PATH = DATA_DIR / "projects_clean.csv"
PIPELINE_SCRIPT = PROJECT_ROOT / "pipeline.py"
USERS_FILE = DATA_DIR / "users.json"

# ---------------------------------------------------------------------------
# User store (file-backed, thread-safe for single-process uvicorn)
# ---------------------------------------------------------------------------

_SEED_USERS = [
    {"username": "admin", "password": "1234", "role": "admin"},
    {"username": "improgress", "password": "password", "role": "viewer"},
]


def _load_users() -> list[dict]:
    if USERS_FILE.exists():
        return json.loads(USERS_FILE.read_text(encoding="utf-8"))
    # First run: seed with default users
    users = [
        {
            "username": u["username"],
            "password_hash": _pwd_ctx.hash(u["password"]),
            "role": u["role"],
            "created_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        for u in _SEED_USERS
    ]
    USERS_FILE.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")
    return users


def _save_users(users: list[dict]) -> None:
    USERS_FILE.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")


def _find_user(username: str) -> dict | None:
    return next((u for u in _load_users() if u["username"] == username), None)

PIPELINE_PROGRESS_FILE = DATA_DIR / "pipeline_progress.json"

SUPPLIER_COL = "compiledRelease/awards/0/suppliers/0/name"
AWARD_COL = "compiledRelease/awards/0/value/amount"
TITLE_COL = "compiledRelease/tender/title"

# Umbral de licitación pública en Guatemala (Decreto 57-92, Ley de Contrataciones)
UMBRAL_LICITACION = 900_000

# ---------------------------------------------------------------------------
# Daily pipeline scheduler
# ---------------------------------------------------------------------------

# Hour (local server time) at which the automatic pipeline runs each day
PIPELINE_SCHEDULE_HOUR = 3   # 03:00 AM


def _trigger_pipeline() -> None:
    """Launch the pipeline subprocess if not already running."""
    global _PIPELINE_PROC
    if _PIPELINE_PROC is not None and _PIPELINE_PROC.poll() is None:
        return  # already running
    try:
        _PIPELINE_PROC = subprocess.Popen(
            ["python", str(PIPELINE_SCRIPT)],
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


async def _daily_pipeline_scheduler() -> None:
    """Background coroutine: wait until the next scheduled hour and run pipeline."""
    while True:
        now = datetime.now()
        # Seconds until next PIPELINE_SCHEDULE_HOUR:00:00
        next_run = now.replace(hour=PIPELINE_SCHEDULE_HOUR, minute=0, second=0, microsecond=0)
        if next_run <= now:
            next_run = next_run + timedelta(days=1)
        wait_secs = (next_run - now).total_seconds()
        await asyncio.sleep(wait_secs)
        _trigger_pipeline()
        # After firing, sleep 1 min so we don't double-fire within the same minute
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    _load_users()
    get_df()
    scheduler_task = asyncio.create_task(_daily_pipeline_scheduler())
    yield
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass


# ---------------------------------------------------------------------------
# App & CORS
# ---------------------------------------------------------------------------

app = FastAPI(title="Observatorio API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

security = HTTPBearer()


def create_access_token(username: str, role: str) -> str:
    expire = datetime.now(tz=timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Return {username, role} from a valid token, raise HTTPException otherwise."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        role: str = payload.get("role", "viewer")
        if username is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return {"username": username, "role": role}
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    return decode_token(credentials.credentials)["username"]


def get_current_user_info(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    return decode_token(credentials.credentials)


def require_admin(info: dict = Depends(get_current_user_info)) -> dict:
    if info.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return info


# ---------------------------------------------------------------------------
# Data loading & caching
# ---------------------------------------------------------------------------

_DATAFRAME_CACHE: pd.DataFrame | None = None
_PIPELINE_PROC: subprocess.Popen | None = None  # type: ignore[type-arg]


def _load_single(path: str | Path) -> pd.DataFrame:
    path = str(path)
    if path.endswith(".csv"):
        df = pd.read_csv(path, dtype={"snip": str})
    else:
        df = pd.read_parquet(path)
        df["snip"] = df["snip"].astype(str)

    if "Unnamed: 0" in df.columns:
        df = df.drop(columns=["Unnamed: 0"])

    for col in ["snip", "ejercicio"]:
        if col in df.columns:
            df[col] = pd.to_numeric(
                df[col].astype(str).str.replace(r"\.0$", "", regex=True),
                errors="coerce",
            ).astype("Int64")

    PROCUREMENT_COL = "compiledRelease/tender/procurementMethod"
    PROCUREMENT_DETAIL_COL = "compiledRelease/tender/procurementMethodDetails"
    N_TENDERERS_COL = "compiledRelease/tender/numberOfTenderers"
    AWARD_STATUS_COL = "compiledRelease/awards/0/status"

    text_cols = [
        "unidad", "especie", "etapa_actual", "institucion", "proyecto", "sector",
        "municipio", "departamento", "alcalde_ganador", "siglas_ganadora",
        "organizacion_ganadora", SUPPLIER_COL, PROCUREMENT_COL, PROCUREMENT_DETAIL_COL,
        AWARD_STATUS_COL,
    ]
    for col in text_cols:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().replace({"nan": np.nan, "None": np.nan, "": np.nan})

    num_cols = [
        "ejercicio", "monto_solicitado", "monto_inicial", "monto_vigente",
        "monto_ejecutado", "meta_fisica", "meta_ejecutada", "periodo_alcalde",
        AWARD_COL, "votos_ganador", N_TENDERERS_COL,
    ]
    for col in num_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df["proveedor"] = df[SUPPLIER_COL] if SUPPLIER_COL in df.columns else np.nan
    df["monto_adjudicado"] = df[AWARD_COL] if AWARD_COL in df.columns else np.nan

    # Derivar metodo_contratacion desde procurementMethodDetails (Guatemala-specific).
    # GuateCompras reporta procurementMethod='open' para todos los registros;
    # el detalle real está en procurementMethodDetails.
    def _map_metodo(detail: Any) -> Any:
        if pd.isna(detail):
            return np.nan
        d = str(detail).lower()
        if "compra directa" in d or "adquisici" in d and "directa" in d:
            return "directa"
        if "cotizaci" in d:
            return "cotizacion"
        if "licitaci" in d:
            return "licitacion"
        if "art" in d and "44" in d:
            return "excepcion"
        if "art" in d and "54" in d:
            return "art54"
        if "competitiva" in d:
            return "competitiva"
        if "convenio" in d or "tratado" in d:
            return "convenio"
        if "arrendamiento" in d:
            return "arrendamiento"
        if "donaci" in d:
            return "donacion"
        if "negociaci" in d:
            return "entre-publicas"
        return str(detail)

    if PROCUREMENT_DETAIL_COL in df.columns:
        df["metodo_contratacion"] = df[PROCUREMENT_DETAIL_COL].apply(_map_metodo)
    elif PROCUREMENT_COL in df.columns:
        df["metodo_contratacion"] = df[PROCUREMENT_COL].str.lower()
    else:
        df["metodo_contratacion"] = pd.Series(np.nan, index=df.index)

    df["n_oferentes"] = df[N_TENDERERS_COL] if N_TENDERERS_COL in df.columns else np.nan

    if "avance_meta_anual" in df.columns:
        df["ratio_meta_ejecucion"] = df["avance_meta_anual"]
    else:
        df["ratio_meta_ejecucion"] = np.nan

    election_years = {2015, 2019, 2023, 2027}
    prev_years = {y - 1 for y in election_years}
    next_years = {y + 1 for y in election_years}

    def classify_election_period(year: Any) -> str:
        if pd.isna(year):
            return "Sin año"
        y = int(year)
        if y in election_years:
            return "Año electoral"
        if y in prev_years:
            return "Año previo"
        if y in next_years:
            return "Año posterior"
        return "Año regular"

    if "ejercicio" in df.columns:
        df["periodo_electoral"] = df["ejercicio"].apply(classify_election_period)

    return df


def load_combined() -> pd.DataFrame:
    if PARQUET_PATH.exists():
        df1 = _load_single(PARQUET_PATH)
        if TITLE_COL in df1.columns:
            df1["proyecto"] = df1[TITLE_COL].where(df1[TITLE_COL].notna(), df1.get("proyecto"))
    else:
        df1 = None

    df2 = _load_single(CSV_PATH)
    if "proyecto" in df2.columns:
        df2["proyecto"] = df2["proyecto"].str.replace(r"^\d+\s*-\s*", "", regex=True)

    if df1 is None:
        return df2

    snips_existentes = set(df1["snip"].dropna().astype(str).unique())
    df2_nuevos = df2[~df2["snip"].astype(str).isin(snips_existentes)]
    combined = pd.concat([df1, df2_nuevos], ignore_index=True)
    return combined


def get_df() -> pd.DataFrame:
    global _DATAFRAME_CACHE
    if _DATAFRAME_CACHE is None:
        _DATAFRAME_CACHE = load_combined()
    return _DATAFRAME_CACHE


def _add_risk_flags(df: pd.DataFrame) -> pd.DataFrame:
    """Compute all risk/fraud indicator columns."""
    df = df.copy()

    # Kept for backward compatibility
    df["diferencia"] = df["monto_adjudicado"] - df["monto_ejecutado"]

    # --- A1: sospechoso (refinado) ------------------------------------------
    # Dinero casi completamente gastado (>95% del adjudicado) pero la meta
    # física alcanzada es menor al 50%. Patrón: se transfirió el dinero
    # pero no se ejecutó la obra.
    ejecucion_fin = np.where(
        df["monto_adjudicado"].notna() & (df["monto_adjudicado"] > 0),
        df["monto_ejecutado"] / df["monto_adjudicado"],
        np.nan,
    )
    df["sospechoso"] = np.where(
        df["monto_adjudicado"].notna()
        & (df["monto_adjudicado"] > 0)
        & (ejecucion_fin > 0.95)
        & (df["ratio_meta_ejecucion"] < 0.50),
        1, 0,
    )

    # --- A2a: sin_meta_ejecutada_con_gasto (meta física = 0, hay gasto) -----
    df["sin_meta_ejecutada_con_gasto"] = np.where(
        ((df["meta_ejecutada"] == 0) | df["meta_ejecutada"].isna())
        & (df["monto_ejecutado"] > 0),
        1, 0,
    )

    # --- A2b: meta_baja_con_gasto (graduado: <10% de meta, >Q50k gastado) ---
    # Solo para proyectos no capturados ya por sin_meta_ejecutada_con_gasto.
    df["meta_baja_con_gasto"] = np.where(
        (df["sin_meta_ejecutada_con_gasto"] == 0)
        & df["meta_fisica"].notna()
        & (df["meta_fisica"] > 0)
        & df["meta_ejecutada"].notna()
        & (df["meta_ejecutada"] > 0)
        & ((df["meta_ejecutada"] / df["meta_fisica"]) < 0.10)
        & (df["monto_ejecutado"] > 50_000),
        1, 0,
    )

    # --- Existente: sobreejecucion_financiera --------------------------------
    df["sobreejecucion_financiera"] = np.where(
        df["monto_adjudicado"].notna()
        & (df["monto_ejecutado"] > df["monto_adjudicado"]),
        1, 0,
    )

    # --- B2: modificacion_excesiva ------------------------------------------
    # Presupuesto aumentado >20% sobre el monto inicial aprobado.
    # Patrón: se gana la licitación barato y luego se infla el contrato.
    df["modificacion_excesiva"] = np.where(
        df["monto_inicial"].notna()
        & (df["monto_inicial"] > 0)
        & df["monto_vigente"].notna()
        & ((df["monto_vigente"] - df["monto_inicial"]) / df["monto_inicial"] > 0.20),
        1, 0,
    )

    # --- B1: fraccionamiento de contratos ------------------------------------
    # Mismo proveedor + municipio + año: suma total adjudicada supera el
    # umbral de licitación pública (Q900k) pero ningún contrato individual
    # lo hace. Patrón clásico para evitar licitación competitiva.
    frac_mask = (
        df["monto_adjudicado"].notna()
        & df["proveedor"].notna()
        & df["municipio"].notna()
        & df["ejercicio"].notna()
    )
    if frac_mask.any():
        grp = (
            df.loc[frac_mask]
            .groupby(["proveedor", "municipio", "ejercicio"])
            .agg(
                suma_grupo=("monto_adjudicado", "sum"),
                n_contratos=("snip", "nunique"),
                max_individual=("monto_adjudicado", "max"),
            )
            .reset_index()
        )
        frac_keys = grp.loc[
            (grp["suma_grupo"] > UMBRAL_LICITACION)
            & (grp["max_individual"] < UMBRAL_LICITACION)
            & (grp["n_contratos"] >= 3),
            ["proveedor", "municipio", "ejercicio"],
        ].copy()
        frac_keys["fraccionamiento"] = 1
        merged = df[["proveedor", "municipio", "ejercicio"]].merge(
            frac_keys, on=["proveedor", "municipio", "ejercicio"], how="left"
        )
        df["fraccionamiento"] = merged["fraccionamiento"].fillna(0).astype(int).values
    else:
        df["fraccionamiento"] = 0

    # --- OCDS: adjudicacion_directa ------------------------------------------
    # En los datos de GuateCompras todos los registros tienen procurementMethod='open'.
    # Las compras directas se identifican por procurementMethodDetails (LCE):
    #   · Art. 43 inc. b  → Compra Directa con Oferta Electrónica
    #   · Art. 44         → Casos de Excepción (adjudicación directa por excepción)
    #   · Adquisición Directa por Ausencia de Oferta
    DETAIL_COL = "compiledRelease/tender/procurementMethodDetails"
    _DIRECT_PATTERN = r"compra directa|adquisici[oó]n directa|art[íi]culo 44|art\. ?44"
    if DETAIL_COL in df.columns:
        df["adjudicacion_directa"] = np.where(
            df[DETAIL_COL].str.lower().str.contains(_DIRECT_PATTERN, na=False, regex=True),
            1, 0,
        )
    elif "metodo_contratacion" in df.columns:
        df["adjudicacion_directa"] = np.where(
            df["metodo_contratacion"].isin(["directa", "excepcion", "direct"]),
            1, 0,
        )
    else:
        df["adjudicacion_directa"] = 0

    # --- OCDS: oferente_unico ------------------------------------------------
    # Solo un oferente participó en una licitación supuestamente competitiva.
    # Puede indicar proceso diseñado para un proveedor específico.
    if "n_oferentes" in df.columns:
        df["oferente_unico"] = np.where(
            (df["n_oferentes"] == 1)
            & (df["adjudicacion_directa"] == 0),  # no contar las directas (ya capturadas)
            1, 0,
        )
    else:
        df["oferente_unico"] = 0

    # --- B6: score_riesgo (0–100 compuesto) ---------------------------------
    # Suma ponderada de todos los indicadores. Refleja la severidad global
    # de cada proyecto para priorizar investigaciones.
    score = (
        df["sin_meta_ejecutada_con_gasto"] * 30
        + df["sospechoso"] * 20
        + df["adjudicacion_directa"] * 20
        + df["oferente_unico"] * 20
        + df["meta_baja_con_gasto"] * 10
        + df["fraccionamiento"] * 15
        + df["modificacion_excesiva"] * 10
        + df["sobreejecucion_financiera"] * 10
    )
    if "periodo_electoral" in df.columns:
        score = score + np.where(df["periodo_electoral"] == "Año previo", 5, 0)
    df["score_riesgo"] = score.clip(0, 100).astype(int)

    return df


# ---------------------------------------------------------------------------
# Filter helpers
# ---------------------------------------------------------------------------


class FilterRequest(BaseModel):
    departamentos: list[str] = []
    municipios: list[str] = []
    codedes: list[str] = []
    sectores: list[str] = []
    instituciones: list[str] = []
    year_min: int | None = None
    year_max: int | None = None
    etapas: list[str] = []


def apply_filter_request(df: pd.DataFrame, f: FilterRequest) -> pd.DataFrame:
    if f.departamentos:
        df = df[df["departamento"].isin(f.departamentos)]
    if f.municipios:
        df = df[df["municipio"].isin(f.municipios)]
    if f.codedes:
        if "departamento" in df.columns:
            df = df[df["departamento"].isin(f.codedes)]
        if "institucion" in df.columns:
            df = df[df["institucion"].astype(str).str.upper().str.contains("CONSEJOS DE DESARROLLO", na=False)]
    if f.sectores and "sector" in df.columns:
        df = df[df["sector"].isin(f.sectores)]
    if f.instituciones and "institucion" in df.columns:
        df = df[df["institucion"].isin(f.instituciones)]
    if f.year_min is not None and "ejercicio" in df.columns:
        df = df[df["ejercicio"] >= f.year_min]
    if f.year_max is not None and "ejercicio" in df.columns:
        df = df[df["ejercicio"] <= f.year_max]
    if f.etapas and "etapa_actual" in df.columns:
        df = df[df["etapa_actual"].isin(f.etapas)]
    return df


# ---------------------------------------------------------------------------
# Analytical helpers
# ---------------------------------------------------------------------------


def determinar_tipo(x: Any) -> str:
    if pd.isna(x):
        return ""
    nombre = str(x).upper()
    es_empresa = "SOCIEDAD ANONIMA" in nombre or " S.A." in nombre or " S. A." in nombre
    tiene_coma = "," in nombre
    tipo = "natural" if (tiene_coma and not es_empresa) else "juridico"
    return (
        f"https://firmaconcerteza.com/dashboard/search?query={quote(str(x))}"
        f"&type={tipo}&page=1&pageSize=10"
    )


def alcalde_link(x: Any) -> str:
    if pd.isna(x):
        return ""
    return (
        f"https://firmaconcerteza.com/dashboard/search?query={quote(str(x))}"
        f"&type=natural&page=1&pageSize=10"
    )


def only_one_supplier_by_group(df: pd.DataFrame, group_col: str) -> pd.DataFrame:
    out = (
        df.groupby(group_col)
        .agg(
            proveedores_unicos=("proveedor", "nunique"),
            proveedor_principal=(
                "proveedor",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else np.nan,
            ),
            proyectos=("snip", "nunique"),
            monto_total=("monto_ejecutado", "sum"),
        )
        .reset_index()
        .sort_values(["proveedores_unicos", "monto_total"], ascending=[True, False])
    )
    return out[out["proveedores_unicos"] == 1]


def supplier_concentration(df: pd.DataFrame, group_col: str) -> pd.DataFrame:
    tmp = (
        df.groupby([group_col, "proveedor"])
        .agg(monto_total=("monto_adjudicado", "sum"), proyectos=("snip", "nunique"))
        .reset_index()
    )
    total_group = tmp.groupby(group_col)["monto_total"].sum().rename("monto_grupo").reset_index()
    tmp = tmp.merge(total_group, on=group_col, how="left")
    tmp["share_grupo"] = np.where(tmp["monto_grupo"] > 0, tmp["monto_total"] / tmp["monto_grupo"], np.nan)
    top = (
        tmp.sort_values([group_col, "share_grupo"], ascending=[True, False])
        .groupby(group_col)
        .head(1)
        .sort_values("share_grupo", ascending=False)
    )
    return top


def top_count_and_ratio(
    df_in: pd.DataFrame, group_col: str, flag_col: str, min_projects: int = 1
) -> pd.DataFrame:
    base = (
        df_in.groupby(group_col)
        .agg(casos=(flag_col, "sum"), total_proyectos=("snip", "nunique"))
        .reset_index()
    )
    base = base[base["total_proyectos"] >= min_projects].copy()
    base["ratio"] = base["casos"] / base["total_proyectos"]
    base = base.sort_values(["casos", "ratio"], ascending=[False, False])
    return base


# ---------------------------------------------------------------------------
# JSON serialization helper
# ---------------------------------------------------------------------------


def clean_value(v: Any) -> Any:
    """Replace NaN / Inf with None and convert pandas NA types."""
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        val = float(v)
        return None if (math.isnan(val) or math.isinf(val)) else val
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if pd.isna(v) if not isinstance(v, (list, dict, str)) else False:
        return None
    return v


def clean_record(record: dict) -> dict:
    return {k: clean_value(v) for k, v in record.items()}


def df_to_records(df: pd.DataFrame) -> list[dict]:
    return [clean_record(r) for r in df.to_dict(orient="records")]


def normalize_text(value: Any) -> str:
    text = str(value or "").strip().upper()
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


# ---------------------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginRequest):
    user = _find_user(body.username)
    if user is None or not _pwd_ctx.verify(body.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario o contraseña incorrectos")
    token = create_access_token(user["username"], user["role"])
    return {"token": token, "username": user["username"], "role": user["role"]}


@app.get("/api/auth/me")
def me(info: dict = Depends(get_current_user_info)):
    user = _find_user(info["username"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"username": user["username"], "role": user["role"]}


# ---------------------------------------------------------------------------
# USER MANAGEMENT  (admin only)
# ---------------------------------------------------------------------------


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"


class UserUpdate(BaseModel):
    password: str | None = None
    role: str | None = None


@app.get("/api/users")
def list_users(admin: dict = Depends(require_admin)):
    users = _load_users()
    return [
        {"username": u["username"], "role": u["role"], "created_at": u.get("created_at")}
        for u in users
    ]


@app.post("/api/users", status_code=201)
def create_user(body: UserCreate, admin: dict = Depends(require_admin)):
    if not body.username.strip():
        raise HTTPException(status_code=422, detail="El nombre de usuario no puede estar vacío")
    if body.role not in ("admin", "viewer"):
        raise HTTPException(status_code=422, detail="El rol debe ser 'admin' o 'viewer'")
    users = _load_users()
    if any(u["username"] == body.username for u in users):
        raise HTTPException(status_code=409, detail="El usuario ya existe")
    users.append({
        "username": body.username,
        "password_hash": _pwd_ctx.hash(body.password),
        "role": body.role,
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    })
    _save_users(users)
    return {"username": body.username, "role": body.role}


@app.put("/api/users/{username}")
def update_user(username: str, body: UserUpdate, admin: dict = Depends(require_admin)):
    users = _load_users()
    idx = next((i for i, u in enumerate(users) if u["username"] == username), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if body.role is not None:
        if body.role not in ("admin", "viewer"):
            raise HTTPException(status_code=422, detail="El rol debe ser 'admin' o 'viewer'")
        users[idx]["role"] = body.role
    if body.password:
        users[idx]["password_hash"] = _pwd_ctx.hash(body.password)
    _save_users(users)
    return {"username": username, "role": users[idx]["role"]}


@app.delete("/api/users/{username}", status_code=204)
def delete_user(username: str, admin: dict = Depends(require_admin)):
    if username == admin["username"]:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propio usuario")
    users = _load_users()
    new_users = [u for u in users if u["username"] != username]
    if len(new_users) == len(users):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    _save_users(new_users)
    return None


# ---------------------------------------------------------------------------
# PIPELINE
# ---------------------------------------------------------------------------


@app.get("/api/pipeline/last-updated")
def pipeline_last_updated(_user: str = Depends(get_current_user)):
    if PARQUET_PATH.exists():
        mtime = PARQUET_PATH.stat().st_mtime
        last_updated = datetime.fromtimestamp(mtime).isoformat()
        source = "parquet"
    elif CSV_PATH.exists():
        mtime = CSV_PATH.stat().st_mtime
        last_updated = datetime.fromtimestamp(mtime).isoformat()
        source = "csv"
    else:
        last_updated = None
        source = "unknown"
    return {"last_updated": last_updated, "source": source}


@app.post("/api/pipeline/run")
def pipeline_run(_user: str = Depends(get_current_user)):
    global _PIPELINE_PROC
    if _PIPELINE_PROC is not None and _PIPELINE_PROC.poll() is None:
        return {"status": "already_running", "message": "Pipeline is already running."}
    try:
        _PIPELINE_PROC = subprocess.Popen(
            ["python", str(PIPELINE_SCRIPT)],
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return {"status": "started", "message": "Pipeline started in background."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start pipeline: {exc}")


@app.get("/api/pipeline/status")
def pipeline_status(_user: str = Depends(get_current_user)):
    global _PIPELINE_PROC
    running = _PIPELINE_PROC is not None and _PIPELINE_PROC.poll() is None
    last_updated: str | None = None
    if PARQUET_PATH.exists():
        last_updated = datetime.fromtimestamp(PARQUET_PATH.stat().st_mtime).isoformat()
    return {"running": running, "last_updated": last_updated}


@app.get("/api/pipeline/progress")
def pipeline_progress(_user: str = Depends(get_current_user)):
    global _PIPELINE_PROC
    running = _PIPELINE_PROC is not None and _PIPELINE_PROC.poll() is None
    if not PIPELINE_PROGRESS_FILE.exists():
        return {"running": running, "steps": [], "current_step": 0, "total_steps": 4, "finished": False}
    try:
        data = json.loads(PIPELINE_PROGRESS_FILE.read_text(encoding="utf-8"))
        data["running"] = running
        # If process ended but file says still running, mark finished
        if not running and not data.get("finished"):
            data["finished"] = True
        return data
    except Exception:
        return {"running": running, "steps": [], "current_step": 0, "total_steps": 4, "finished": False}


# ---------------------------------------------------------------------------
# FILTERS
# ---------------------------------------------------------------------------


@app.get("/api/filters")
def get_filters(_user: str = Depends(get_current_user)):
    df = get_df()
    ejercicio = df["ejercicio"].dropna()

    def safe_list(series: pd.Series) -> list:
        return sorted(series.dropna().unique().tolist())

    codedes = []
    if "institucion" in df.columns and "departamento" in df.columns:
        codedes_df = df[df["institucion"].astype(str).str.upper().str.contains("CONSEJOS DE DESARROLLO", na=False)]
        codedes = safe_list(codedes_df["departamento"]) if "departamento" in codedes_df.columns else []

    return {
        "departamentos": safe_list(df["departamento"]) if "departamento" in df.columns else [],
        "codedes": codedes,
        "sectores": safe_list(df["sector"]) if "sector" in df.columns else [],
        "instituciones": safe_list(df["institucion"]) if "institucion" in df.columns else [],
        "etapas": safe_list(df["etapa_actual"]) if "etapa_actual" in df.columns else [],
        "year_min": int(ejercicio.min()) if not ejercicio.empty else None,
        "year_max": int(ejercicio.max()) if not ejercicio.empty else None,
    }


@app.get("/api/filters/municipios")
def get_municipios(departamentos: str = "", _user: str = Depends(get_current_user)):
    df = get_df()
    if departamentos:
        dept_list = [d.strip() for d in departamentos.split(",") if d.strip()]
        df = df[df["departamento"].isin(dept_list)]
    munis = sorted(df["municipio"].dropna().unique().tolist())
    return {"municipios": munis}


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------


@app.post("/api/kpis")
def get_kpis(body: FilterRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)
    df = _add_risk_flags(df)

    registros = len(df)
    municipios = int(df["municipio"].nunique()) if "municipio" in df.columns else 0
    alcaldes = int(df["alcalde_ganador"].nunique()) if "alcalde_ganador" in df.columns else 0
    proveedores = int(df["proveedor"].nunique()) if "proveedor" in df.columns else 0
    ratio_mean = df["ratio_meta_ejecucion"].mean() if "ratio_meta_ejecucion" in df.columns else None
    monto_ejecutado_total = df["monto_ejecutado"].sum() if "monto_ejecutado" in df.columns else None
    monto_adjudicado_total = df["monto_adjudicado"].sum() if "monto_adjudicado" in df.columns else None
    suma_ponderada_alertas = int(df["score_riesgo"].sum()) if "score_riesgo" in df.columns else 0

    return {
        "registros": registros,
        "municipios": municipios,
        "alcaldes": alcaldes,
        "proveedores": proveedores,
        "pct_meta_ejecutada": clean_value(ratio_mean),
        "monto_ejecutado_total": clean_value(monto_ejecutado_total),
        "monto_adjudicado_total": clean_value(monto_adjudicado_total),
        "suma_ponderada_alertas": suma_ponderada_alertas,
    }


# ---------------------------------------------------------------------------
# TAB 1 – Municipios y Proveedores
# ---------------------------------------------------------------------------


@app.post("/api/analysis/municipios-proveedores")
def municipios_proveedores(body: FilterRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)
    df = _add_risk_flags(df)

    muni_one = only_one_supplier_by_group(df, "municipio")
    muni_one = muni_one[muni_one["proyectos"] > 2].copy()

    muni_conc = supplier_concentration(df, "municipio")

    # ---- insights ----
    top_conc = None
    if not muni_conc.empty:
        row = muni_conc.iloc[0]
        top_conc = {"municipio": row["municipio"], "share": clean_value(row["share_grupo"])}

    count_unique_supplier = int(muni_one["municipio"].nunique()) if not muni_one.empty else 0

    top_monto = None
    if not muni_one.empty:
        row = muni_one.sort_values("monto_total", ascending=False).iloc[0]
        top_monto = {"municipio": row["municipio"], "monto_total": clean_value(row["monto_total"])}

    worst_ratio_text = None
    ratio_muni_all = (
        df.groupby("municipio")["ratio_meta_ejecucion"]
        .mean()
        .reset_index(name="ratio_promedio")
        .sort_values("ratio_promedio", ascending=True)
    )
    if not ratio_muni_all.empty:
        r = ratio_muni_all.iloc[0]
        worst_ratio_text = {"municipio": r["municipio"], "ratio": clean_value(r["ratio_promedio"])}

    top_sospechoso = None
    ratio_sos = (
        df.groupby("municipio")
        .agg(sospechosos=("sospechoso", "sum"), total_proyectos=("snip", "nunique"))
        .reset_index()
    )
    ratio_sos = ratio_sos[ratio_sos["total_proyectos"] >= 3].copy()
    ratio_sos["ratio"] = ratio_sos["sospechosos"] / ratio_sos["total_proyectos"]
    ratio_sos = ratio_sos.sort_values("ratio", ascending=False)
    if not ratio_sos.empty:
        r = ratio_sos.iloc[0]
        top_sospechoso = {"municipio": r["municipio"], "ratio": clean_value(r["ratio"])}

    # ---- table ----
    metricas_muni = (
        df.groupby("municipio")
        .agg(
            monto_total_ejecutado=("monto_ejecutado", "sum"),
            promedio_monto_ejecutado=("monto_ejecutado", "mean"),
            promedio_ratio_meta_ejecutada=("ratio_meta_ejecucion", "mean"),
            departamento=(
                "departamento",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
            ),
        )
        .reset_index()
    )

    if not muni_one.empty:
        table_df = muni_one.merge(metricas_muni, on="municipio", how="left")
        table_df["proveedor_link"] = table_df["proveedor_principal"].apply(determinar_tipo)
        cols = [
            "municipio", "departamento", "proveedor_principal", "proveedor_link",
            "proyectos", "monto_total_ejecutado", "promedio_monto_ejecutado",
            "promedio_ratio_meta_ejecutada",
        ]
        cols = [c for c in cols if c in table_df.columns]
        table_records = df_to_records(table_df[cols])
    else:
        table_records = []

    municipios_list = sorted(df["municipio"].dropna().unique().tolist())

    # ── Top 50 proveedores por número de municipios distintos ─────────────────
    top_proveedores: list[dict] = []
    if "proveedor" in df.columns and "municipio" in df.columns:
        prov_sub = df[df["proveedor"].notna() & df["municipio"].notna()].copy()
        prov_agg: dict[str, Any] = {
            "num_municipios": ("municipio", "nunique"),
            "num_proyectos": ("snip", "count") if "snip" in prov_sub.columns else ("municipio", "count"),
        }
        if "monto_ejecutado" in prov_sub.columns:
            prov_agg["monto_ejecutado"] = ("monto_ejecutado", "sum")

        prov_stats = (
            prov_sub.groupby("proveedor", dropna=False)
            .agg(**prov_agg)
            .reset_index()
            .sort_values("num_municipios", ascending=False)
            .head(50)
        )
        prov_mun_lists = (
            prov_sub.groupby("proveedor")["municipio"]
            .apply(lambda s: sorted(s.dropna().unique().tolist()))
            .to_dict()
        )
        for _, row in prov_stats.iterrows():
            prov = row["proveedor"]
            if pd.isna(prov):
                continue
            top_proveedores.append({
                "proveedor": str(prov),
                "num_municipios": int(row["num_municipios"]),
                "num_proyectos": int(row.get("num_proyectos", 0)),
                "monto_ejecutado": clean_value(row.get("monto_ejecutado", 0)),
                "municipios": prov_mun_lists.get(str(prov), []),
            })

    return {
        "insights": {
            "top_conc": top_conc,
            "count_unique_supplier": count_unique_supplier,
            "top_monto": top_monto,
            "worst_ratio": worst_ratio_text,
            "top_sospechoso": top_sospechoso,
        },
        "table": table_records,
        "municipios_list": municipios_list,
        "top_proveedores": top_proveedores,
    }


class MunicipioDetalleRequest(BaseModel):
    municipio: str
    filters: FilterRequest = FilterRequest()


class ProveedorMunicipiosDetalleRequest(BaseModel):
    proveedor: str
    filters: FilterRequest = FilterRequest()


@app.post("/api/analysis/municipios-proveedores/proveedor-detalle")
def municipios_proveedor_detalle(body: ProveedorMunicipiosDetalleRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body.filters)

    if "proveedor" not in df.columns:
        raise HTTPException(status_code=404, detail="Proveedor column not available.")

    target = normalize_text(body.proveedor)
    if not target:
        raise HTTPException(status_code=422, detail="Proveedor is required.")

    prov_norm = df["proveedor"].apply(normalize_text)
    detalle = df[prov_norm == target].copy()
    if detalle.empty:
        raise HTTPException(status_code=404, detail="No data for selected proveedor.")

    if "municipio" not in detalle.columns:
        raise HTTPException(status_code=404, detail="Municipio column not available.")

    detalle = detalle[detalle["municipio"].notna()].copy()
    if detalle.empty:
        raise HTTPException(status_code=404, detail="No municipios found for selected proveedor.")

    # Total by municipality (for map + ranking list)
    agg_muni: dict[str, Any] = {
        "monto_total_ejecutado": ("monto_ejecutado", "sum"),
        "total_proyectos": ("snip", "nunique") if "snip" in detalle.columns else ("municipio", "count"),
    }
    if "departamento" in detalle.columns:
        agg_muni["departamento"] = (
            "departamento",
            lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
        )
    by_municipio = (
        detalle.groupby("municipio", dropna=False)
        .agg(**agg_muni)
        .reset_index()
        .sort_values(["monto_total_ejecutado", "total_proyectos", "municipio"], ascending=[False, False, True])
    )
    if "departamento" not in by_municipio.columns:
        by_municipio["departamento"] = None

    # Yearly totals (all municipalities combined)
    by_year_total = pd.DataFrame(columns=["ejercicio", "monto_ejecutado", "total_proyectos"])
    if "ejercicio" in detalle.columns:
        yearly = detalle[detalle["ejercicio"].notna()].copy()
        if not yearly.empty:
            by_year_total = (
                yearly.groupby("ejercicio", dropna=False)
                .agg(
                    monto_ejecutado=("monto_ejecutado", "sum"),
                    total_proyectos=("snip", "nunique") if "snip" in yearly.columns else ("municipio", "count"),
                )
                .reset_index()
                .sort_values("ejercicio")
            )

    # Yearly totals by municipality
    by_municipio_year = pd.DataFrame(columns=["municipio", "ejercicio", "monto_ejecutado", "total_proyectos"])
    if "ejercicio" in detalle.columns:
        muni_year = detalle[detalle["ejercicio"].notna()].copy()
        if not muni_year.empty:
            by_municipio_year = (
                muni_year.groupby(["municipio", "ejercicio"], dropna=False)
                .agg(
                    monto_ejecutado=("monto_ejecutado", "sum"),
                    total_proyectos=("snip", "nunique") if "snip" in muni_year.columns else ("municipio", "count"),
                )
                .reset_index()
                .sort_values(["municipio", "ejercicio"])
            )

    total_monto = float(detalle["monto_ejecutado"].sum()) if "monto_ejecutado" in detalle.columns else 0.0
    total_proyectos = int(detalle["snip"].nunique()) if "snip" in detalle.columns else int(len(detalle))
    total_municipios = int(by_municipio["municipio"].nunique()) if "municipio" in by_municipio.columns else 0

    # SNIP list per municipality (deduplicated by snip)
    snip_pick = [c for c in ["snip", "proyecto", "ejercicio", "monto_ejecutado", "monto_adjudicado", "link", "etapa_actual"] if c in detalle.columns]
    snips_por_municipio: dict = {}
    if snip_pick and "municipio" in detalle.columns:
        dedup_subset = [c for c in ["snip", "municipio"] if c in detalle.columns]
        snip_df = detalle[["municipio"] + snip_pick].drop_duplicates(subset=dedup_subset if len(dedup_subset) == 2 else None)
        snip_df = snip_df.sort_values(
            ["municipio", "ejercicio"] if "ejercicio" in snip_df.columns else ["municipio"],
            ascending=[True, False] if "ejercicio" in snip_df.columns else [True],
            na_position="last",
        )
        for muni, grp in snip_df.groupby("municipio", sort=False):
            snips_por_municipio[str(muni)] = df_to_records(grp[snip_pick])

    return {
        "kpis": {
            "proveedor": body.proveedor,
            "monto_total_ejecutado": clean_value(total_monto),
            "total_proyectos": total_proyectos,
            "total_municipios": total_municipios,
        },
        "map_municipios": df_to_records(by_municipio[["municipio", "departamento", "monto_total_ejecutado", "total_proyectos"]]),
        "series_anual_total": df_to_records(by_year_total),
        "series_anual_municipio": df_to_records(by_municipio_year),
        "top_municipios_default": by_municipio["municipio"].head(3).tolist(),
        "snips_por_municipio": snips_por_municipio,
    }


@app.post("/api/analysis/municipios-proveedores/detalle")
def municipio_detalle(body: MunicipioDetalleRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body.filters)
    df = _add_risk_flags(df)

    detalle = df[df["municipio"] == body.municipio].copy()

    if detalle.empty:
        raise HTTPException(status_code=404, detail="No data for selected municipio.")

    # KPIs
    detalle["sospechoso_label"] = detalle["sospechoso"].map({1: "Sí", 0: "No"})
    detalle["sin_meta_label"] = detalle["sin_meta_ejecutada_con_gasto"].map({1: "Sí", 0: "No"})

    pct_sospechosos = (detalle["sospechoso"] == 1).mean()
    pct_sin_meta = (detalle["sin_meta_ejecutada_con_gasto"] == 1).mean()
    total_proveedores = int(detalle["proveedor"].dropna().nunique())
    total_proyectos = int(detalle["proyecto"].nunique()) if "proyecto" in detalle.columns else 0
    monto_total = float(detalle["monto_ejecutado"].sum())
    ratio_prom = detalle["ratio_meta_ejecucion"].mean()
    proyectos_sobreejecucion = int(detalle["sobreejecucion_financiera"].sum())

    # Project table
    detalle["brecha_adjudicado_ejecutado"] = np.where(
        detalle["monto_adjudicado"].notna(),
        detalle["monto_adjudicado"] - detalle["monto_ejecutado"],
        np.nan,
    )
    detalle["orden_meta0"] = np.where(detalle["sin_meta_ejecutada_con_gasto"] == 1, 0, 1)
    detalle["orden_sospechoso"] = np.where(detalle["sospechoso"] == 1, 0, 1)
    detalle = detalle.sort_values(
        ["orden_meta0", "orden_sospechoso", "monto_ejecutado"], ascending=[True, True, False]
    )

    proj_cols = [c for c in [
        "snip", "proyecto", "proveedor", "alcalde_ganador",
        "monto_adjudicado", "monto_ejecutado", "brecha_adjudicado_ejecutado",
        "meta_ejecutada", "ratio_meta_ejecucion", "score_riesgo",
        "sin_meta_ejecutada_con_gasto", "meta_baja_con_gasto",
        "sospechoso", "sobreejecucion_financiera",
        "fraccionamiento", "modificacion_excesiva",
        "adjudicacion_directa", "oferente_unico", "metodo_contratacion", "n_oferentes",
    ] if c in detalle.columns]
    proyectos_records = df_to_records(detalle[proj_cols])

    return {
        "kpis": {
            "total_proveedores": total_proveedores,
            "total_proyectos": total_proyectos,
            "pct_sospechosos": clean_value(pct_sospechosos),
            "monto_total_ejecutado": clean_value(monto_total),
            "ratio_promedio": clean_value(ratio_prom),
            "pct_sin_meta_ejecutada": clean_value(pct_sin_meta),
            "proyectos_sobreejecucion": proyectos_sobreejecucion,
        },
        "proyectos": proyectos_records,
    }


# ---------------------------------------------------------------------------
# TAB 2 – Alcaldes y Proveedores
# ---------------------------------------------------------------------------


class AlcaldesProveedoresRequest(FilterRequest):
    periodo_from: int | None = None
    periodo_to: int | None = None


@app.post("/api/analysis/alcaldes-proveedores")
def alcaldes_proveedores(body: AlcaldesProveedoresRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)
    periodos_disponibles: list[int] = []
    if "periodo_alcalde" in df.columns:
        periodos_series = pd.to_numeric(df["periodo_alcalde"], errors="coerce").dropna().astype(int)
        periodos_disponibles = sorted(periodos_series.unique().tolist())
        p_from = body.periodo_from
        p_to = body.periodo_to
        if p_from is not None and p_to is not None and p_from > p_to:
            p_from, p_to = p_to, p_from
        if p_from is not None:
            df = df[df["periodo_alcalde"] >= p_from]
        if p_to is not None:
            df = df[df["periodo_alcalde"] <= p_to]
    df = _add_risk_flags(df)

    mayor_one = only_one_supplier_by_group(df, "alcalde_ganador")
    mayor_one = mayor_one[mayor_one["proyectos"] > 2].copy()

    mayor_conc = supplier_concentration(df, "alcalde_ganador")

    partido_lookup: dict = (
        df.groupby("alcalde_ganador")["siglas_ganadora"]
        .agg(lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else "N/D")
        .to_dict()
        if "siglas_ganadora" in df.columns
        else {}
    )

    # ---- insights ----
    top_conc = None
    if not mayor_conc.empty:
        row = mayor_conc.iloc[0]
        top_conc = {
            "alcalde": row["alcalde_ganador"],
            "partido": partido_lookup.get(row["alcalde_ganador"], "N/D"),
            "share": clean_value(row["share_grupo"]),
        }

    count_unique_supplier = int(mayor_one["alcalde_ganador"].nunique()) if not mayor_one.empty else 0

    top_monto = None
    if not mayor_one.empty:
        row = mayor_one.sort_values("monto_total", ascending=False).iloc[0]
        top_monto = {
            "alcalde": row["alcalde_ganador"],
            "partido": partido_lookup.get(row["alcalde_ganador"], "N/D"),
            "monto_total": clean_value(row["monto_total"]),
        }

    worst_ratio = None
    if not mayor_one.empty:
        ratio_alcalde = (
            df[df["alcalde_ganador"].isin(mayor_one["alcalde_ganador"])]
            .groupby("alcalde_ganador")["ratio_meta_ejecucion"]
            .mean()
            .reset_index(name="ratio_promedio")
            .sort_values("ratio_promedio", ascending=True)
        )
        if not ratio_alcalde.empty:
            r = ratio_alcalde.iloc[0]
            worst_ratio = {
                "alcalde": r["alcalde_ganador"],
                "partido": partido_lookup.get(r["alcalde_ganador"], "N/D"),
                "ratio": clean_value(r["ratio_promedio"]),
            }

    top_sospechoso = None
    ratio_sos = (
        df.groupby("alcalde_ganador")
        .agg(sospechosos=("sospechoso", "sum"), total_proyectos=("snip", "nunique"))
        .reset_index()
    )
    ratio_sos = ratio_sos[ratio_sos["total_proyectos"] >= 3].copy()
    ratio_sos["ratio"] = ratio_sos["sospechosos"] / ratio_sos["total_proyectos"]
    ratio_sos = ratio_sos.sort_values("ratio", ascending=False)
    if not ratio_sos.empty:
        r = ratio_sos.iloc[0]
        top_sospechoso = {
            "alcalde": r["alcalde_ganador"],
            "partido": partido_lookup.get(r["alcalde_ganador"], "N/D"),
            "ratio": clean_value(r["ratio"]),
        }

    # ---- table ----
    metricas_alcalde = (
        df.groupby("alcalde_ganador")
        .agg(
            periodo_alcalde=("periodo_alcalde", "first"),
            monto_total_ejecutado=("monto_ejecutado", "sum"),
            promedio_monto_ejecutado=("monto_ejecutado", "mean"),
            promedio_ratio_meta_ejecutada=("ratio_meta_ejecucion", "mean"),
            proyectos_meta0_gasto=("sin_meta_ejecutada_con_gasto", "sum"),
            proyectos_sobreejecucion=("sobreejecucion_financiera", "sum"),
            municipio=(
                "municipio",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
            ),
            departamento=(
                "departamento",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
            ),
        )
        .reset_index()
    )

    table_df = pd.DataFrame()
    if not mayor_one.empty:
        table_df = mayor_one.merge(metricas_alcalde, on="alcalde_ganador", how="left")
        table_df["proveedor_link"] = table_df["proveedor_principal"].apply(determinar_tipo)
        table_df["alcalde_link"] = table_df["alcalde_ganador"].apply(alcalde_link)

    table_records = df_to_records(table_df) if not table_df.empty else []

    # scatter data: same as table
    scatter_records = df_to_records(table_df) if not table_df.empty else []

    alcaldes_list = sorted(df["alcalde_ganador"].dropna().unique().tolist())

    # ---- mapa por municipio ----
    map_municipios_records: list[dict] = []
    if not df.empty:
        map_df = (
            df.groupby("municipio")
            .agg(
                departamento=(
                    "departamento",
                    lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
                ),
                total_proyectos=("snip", "nunique"),
                monto_total_ejecutado=("monto_ejecutado", "sum"),
                alcalde_principal=(
                    "alcalde_ganador",
                    lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
                ),
                partido_alcalde_principal=(
                    "siglas_ganadora",
                    lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
                ),
                periodo_principal=(
                    "periodo_alcalde",
                    lambda x: int(pd.to_numeric(x, errors="coerce").dropna().mode().iloc[0])
                    if not pd.to_numeric(x, errors="coerce").dropna().empty
                    else None,
                ),
            )
            .reset_index()
        )

        alcaldes_periodo_lookup: dict[str, list[dict]] = {}
        obras_lookup: dict[str, list[dict]] = {}
        for muni, g in df.groupby("municipio"):
            muni_key = str(muni).strip().upper()
            alcaldes_g = (
                g.groupby(["periodo_alcalde", "alcalde_ganador", "siglas_ganadora"])["snip"]
                .nunique()
                .reset_index(name="proyectos")
                .sort_values(["periodo_alcalde", "proyectos"], ascending=[False, False])
            )
            alcaldes_periodo_lookup[muni_key] = df_to_records(alcaldes_g.head(8))

            obras_g = (
                g.groupby("proyecto")
                .agg(
                    proyectos=("snip", "nunique"),
                    monto_total=("monto_ejecutado", "sum"),
                )
                .reset_index()
                .sort_values(["proyectos", "monto_total"], ascending=[False, False])
            )
            obras_lookup[muni_key] = df_to_records(obras_g.head(8))

        map_df["municipio"] = map_df["municipio"].astype(str).str.strip().str.upper()
        map_df["alcaldes_periodo"] = map_df["municipio"].apply(lambda m: alcaldes_periodo_lookup.get(str(m), []))
        map_df["obras"] = map_df["municipio"].apply(lambda m: obras_lookup.get(str(m), []))
        # Placeholder while diputado data is unavailable in current dataset
        map_df["diputado_nombre"] = None
        map_df["diputado_partido"] = None

        map_municipios_records = df_to_records(map_df)

    return {
        "insights": {
            "top_conc": top_conc,
            "count_unique_supplier": count_unique_supplier,
            "top_monto": top_monto,
            "worst_ratio": worst_ratio,
            "top_sospechoso": top_sospechoso,
        },
        "table": table_records,
        "scatter_data": scatter_records,
        "alcaldes_list": alcaldes_list,
        "periodos_disponibles": periodos_disponibles,
        "periodo_aplicado": {"from": body.periodo_from, "to": body.periodo_to},
        "map_municipios_proyectos": map_municipios_records,
    }


class AlcaldeDetalleRequest(BaseModel):
    alcalde: str
    filters: FilterRequest = FilterRequest()


@app.post("/api/analysis/alcaldes-proveedores/detalle")
def alcalde_detalle(body: AlcaldeDetalleRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body.filters)
    df = _add_risk_flags(df)

    detalle = df[df["alcalde_ganador"] == body.alcalde].copy()
    if detalle.empty:
        raise HTTPException(status_code=404, detail="No data for selected alcalde.")

    detalle["brecha_adjudicado_ejecutado"] = np.where(
        detalle["monto_adjudicado"].notna(),
        detalle["monto_adjudicado"] - detalle["monto_ejecutado"],
        np.nan,
    )

    pct_sospechosos = (detalle["sospechoso"] == 1).mean()
    pct_sin_meta = (detalle["sin_meta_ejecutada_con_gasto"] == 1).mean()
    total_proyectos = int(detalle["proyecto"].nunique()) if "proyecto" in detalle.columns else 0
    monto_total = float(detalle["monto_ejecutado"].sum())
    ratio_prom = detalle["ratio_meta_ejecucion"].mean()
    proyectos_sobreejecucion = int(detalle["sobreejecucion_financiera"].sum())

    muni_series = df.loc[df["alcalde_ganador"] == body.alcalde, "municipio"].dropna()
    dept_series = df.loc[df["alcalde_ganador"] == body.alcalde, "departamento"].dropna()
    anio_series = df.loc[df["alcalde_ganador"] == body.alcalde, "periodo_alcalde"].dropna()

    municipio_val = muni_series.mode().iloc[0] if not muni_series.empty else None
    departamento_val = dept_series.mode().iloc[0] if not dept_series.empty else None
    anio_val = int(anio_series.mode().iloc[0]) if not anio_series.empty else None

    detalle["orden_meta0"] = np.where(detalle["sin_meta_ejecutada_con_gasto"] == 1, 0, 1)
    detalle["orden_sospechoso"] = np.where(detalle["sospechoso"] == 1, 0, 1)
    detalle = detalle.sort_values(
        ["orden_meta0", "orden_sospechoso", "monto_ejecutado"], ascending=[True, True, False]
    )

    proj_cols = [c for c in [
        "snip", "proyecto", "proveedor", "ejercicio",
        "monto_adjudicado", "monto_ejecutado", "brecha_adjudicado_ejecutado",
        "meta_ejecutada", "ratio_meta_ejecucion", "score_riesgo",
        "sin_meta_ejecutada_con_gasto", "meta_baja_con_gasto",
        "sospechoso", "sobreejecucion_financiera",
        "fraccionamiento", "modificacion_excesiva",
        "adjudicacion_directa", "oferente_unico", "metodo_contratacion", "n_oferentes",
    ] if c in detalle.columns]

    return {
        "kpis": {
            "municipio": municipio_val,
            "departamento": departamento_val,
            "anio_electo": anio_val,
            "total_proyectos": total_proyectos,
            "monto_total_ejecutado": clean_value(monto_total),
            "ratio_promedio": clean_value(ratio_prom),
            "pct_sospechosos": clean_value(pct_sospechosos),
            "pct_sin_meta_ejecutada": clean_value(pct_sin_meta),
            "proyectos_sobreejecucion": proyectos_sobreejecucion,
        },
        "proyectos": df_to_records(detalle[proj_cols]),
    }


class AlcaldeMunicipioDetalleRequest(FilterRequest):
    municipio: str
    periodo_from: int | None = None
    periodo_to: int | None = None


@app.post("/api/analysis/alcaldes-proveedores/municipio-detalle")
def alcalde_municipio_detalle(body: AlcaldeMunicipioDetalleRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)

    if "periodo_alcalde" in df.columns:
        p_from = body.periodo_from
        p_to = body.periodo_to
        if p_from is not None and p_to is not None and p_from > p_to:
            p_from, p_to = p_to, p_from
        if p_from is not None:
            df = df[df["periodo_alcalde"] >= p_from]
        if p_to is not None:
            df = df[df["periodo_alcalde"] <= p_to]

    if "municipio" not in df.columns:
        raise HTTPException(status_code=404, detail="Municipio column not available.")

    target = normalize_text(body.municipio)
    if not target:
        raise HTTPException(status_code=422, detail="Municipio is required.")

    muni_norm = df["municipio"].apply(normalize_text)
    detalle = df[muni_norm == target].copy()
    if detalle.empty:
        raise HTTPException(status_code=404, detail="No data for selected municipio.")

    detalle = _add_risk_flags(detalle)
    detalle["brecha_adjudicado_ejecutado"] = np.where(
        detalle["monto_adjudicado"].notna(),
        detalle["monto_adjudicado"] - detalle["monto_ejecutado"],
        np.nan,
    )
    detalle = detalle.sort_values(["monto_ejecutado", "score_riesgo"], ascending=[False, False])

    dept_series = detalle["departamento"].dropna() if "departamento" in detalle.columns else pd.Series(dtype=object)
    dept_val = dept_series.mode().iloc[0] if not dept_series.empty else None
    total_proyectos = int(detalle["snip"].nunique()) if "snip" in detalle.columns else 0
    monto_total = float(detalle["monto_ejecutado"].sum()) if "monto_ejecutado" in detalle.columns else 0.0

    cols = [c for c in [
        "snip", "proyecto", "proveedor", "alcalde_ganador", "siglas_ganadora", "departamento",
        "ejercicio", "monto_adjudicado", "monto_ejecutado", "brecha_adjudicado_ejecutado",
        "meta_ejecutada", "ratio_meta_ejecucion", "score_riesgo",
        "sin_meta_ejecutada_con_gasto", "meta_baja_con_gasto", "sospechoso", "sobreejecucion_financiera",
        "fraccionamiento", "modificacion_excesiva", "adjudicacion_directa", "oferente_unico",
        "metodo_contratacion", "n_oferentes",
    ] if c in detalle.columns]

    return {
        "kpis": {
            "municipio": target,
            "departamento": dept_val,
            "total_proyectos": total_proyectos,
            "monto_total_ejecutado": clean_value(monto_total),
        },
        "proyectos": df_to_records(detalle[cols]),
    }


# ---------------------------------------------------------------------------
# TAB 2B – CODEDES
# ---------------------------------------------------------------------------


class CodedesRequest(FilterRequest):
    periodo_from: int | None = None
    periodo_to: int | None = None


@app.post("/api/analysis/codedes")
def codedes(body: CodedesRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)

    if "institucion" in df.columns:
        df = df[df["institucion"].astype(str).str.upper().str.contains("CONSEJOS DE DESARROLLO", na=False)]

    periodos_disponibles: list[int] = []
    if "periodo_alcalde" in df.columns:
        periodos_series = pd.to_numeric(df["periodo_alcalde"], errors="coerce").dropna().astype(int)
        periodos_disponibles = sorted(periodos_series.unique().tolist())
        p_from = body.periodo_from
        p_to = body.periodo_to
        if p_from is not None and p_to is not None and p_from > p_to:
            p_from, p_to = p_to, p_from
        if p_from is not None:
            df = df[df["periodo_alcalde"] >= p_from]
        if p_to is not None:
            df = df[df["periodo_alcalde"] <= p_to]

    df = _add_risk_flags(df)

    if df.empty:
        return {
            "insights": {},
            "kpis": {
                "total_codedes": 0,
                "total_proyectos": 0,
                "monto_total_ejecutado": 0,
            },
            "table": [],
            "map_municipios": [],
            "codedes_list": [],
            "periodos_disponibles": periodos_disponibles,
            "periodo_aplicado": {"from": body.periodo_from, "to": body.periodo_to},
        }

    agg = (
        df.groupby("departamento")
        .agg(
            total_proyectos=("snip", "nunique"),
            monto_total_ejecutado=("monto_ejecutado", "sum"),
            ratio_meta_promedio=("ratio_meta_ejecucion", "mean"),
            proyectos_sospechosos=("sospechoso", "sum"),
            alcalde_principal=(
                "alcalde_ganador",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
            ),
            partido_principal=(
                "siglas_ganadora",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
            ),
            periodo_principal=(
                "periodo_alcalde",
                lambda x: int(pd.to_numeric(x, errors="coerce").dropna().mode().iloc[0])
                if not pd.to_numeric(x, errors="coerce").dropna().empty
                else None,
            ),
        )
        .reset_index()
    )
    agg["pct_sospechosos"] = np.where(
        agg["total_proyectos"] > 0, agg["proyectos_sospechosos"] / agg["total_proyectos"], np.nan
    )
    agg["codede"] = "CODEDE " + agg["departamento"].astype(str)
    table_df = agg.sort_values("monto_total_ejecutado", ascending=False)

    top_monto = None
    if not table_df.empty:
        r = table_df.iloc[0]
        top_monto = {
            "codede": r["codede"],
            "departamento": r["departamento"],
            "monto_total_ejecutado": clean_value(r["monto_total_ejecutado"]),
            "total_proyectos": clean_value(r["total_proyectos"]),
        }

    top_proyectos = None
    if not table_df.empty:
        r = table_df.sort_values("total_proyectos", ascending=False).iloc[0]
        top_proyectos = {
            "codede": r["codede"],
            "departamento": r["departamento"],
            "total_proyectos": clean_value(r["total_proyectos"]),
        }

    map_df = (
        df.groupby("municipio")
        .agg(
            departamento=(
                "departamento",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
            ),
            total_proyectos=("snip", "nunique"),
            monto_total_ejecutado=("monto_ejecutado", "sum"),
            alcalde_principal=(
                "alcalde_ganador",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
            ),
            partido_alcalde_principal=(
                "siglas_ganadora",
                lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else None,
            ),
        )
        .reset_index()
    )
    map_df["codede"] = "CODEDE " + map_df["departamento"].astype(str)
    map_df["municipio"] = map_df["municipio"].astype(str).str.strip().str.upper()

    alcaldes_periodo_lookup: dict[str, list[dict]] = {}
    obras_lookup: dict[str, list[dict]] = {}
    for muni, g in df.groupby("municipio"):
        muni_key = str(muni).strip().upper()
        alcaldes_g = (
            g.groupby(["periodo_alcalde", "alcalde_ganador", "siglas_ganadora"])["snip"]
            .nunique()
            .reset_index(name="proyectos")
            .sort_values(["periodo_alcalde", "proyectos"], ascending=[False, False])
        )
        alcaldes_periodo_lookup[muni_key] = df_to_records(alcaldes_g.head(8))

        obras_g = (
            g.groupby("proyecto")
            .agg(
                proyectos=("snip", "nunique"),
                monto_total=("monto_ejecutado", "sum"),
            )
            .reset_index()
            .sort_values(["proyectos", "monto_total"], ascending=[False, False])
        )
        obras_lookup[muni_key] = df_to_records(obras_g.head(8))

    map_df["alcaldes_periodo"] = map_df["municipio"].apply(lambda m: alcaldes_periodo_lookup.get(str(m), []))
    map_df["obras"] = map_df["municipio"].apply(lambda m: obras_lookup.get(str(m), []))

    codedes_list = sorted(df["departamento"].dropna().unique().tolist()) if "departamento" in df.columns else []

    return {
        "insights": {
            "top_monto": top_monto,
            "top_proyectos": top_proyectos,
        },
        "kpis": {
            "total_codedes": int(table_df["departamento"].nunique()) if "departamento" in table_df.columns else 0,
            "total_proyectos": int(df["snip"].nunique()) if "snip" in df.columns else 0,
            "monto_total_ejecutado": clean_value(df["monto_ejecutado"].sum()),
        },
        "table": df_to_records(table_df),
        "map_municipios": df_to_records(map_df),
        "codedes_list": codedes_list,
        "periodos_disponibles": periodos_disponibles,
        "periodo_aplicado": {"from": body.periodo_from, "to": body.periodo_to},
    }


class CodedesMunicipioDetalleRequest(FilterRequest):
    municipio: str
    periodo_from: int | None = None
    periodo_to: int | None = None


@app.post("/api/analysis/codedes/municipio-detalle")
def codedes_municipio_detalle(body: CodedesMunicipioDetalleRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)

    if "institucion" in df.columns:
        df = df[df["institucion"].astype(str).str.upper().str.contains("CONSEJOS DE DESARROLLO", na=False)]

    if "periodo_alcalde" in df.columns:
        p_from = body.periodo_from
        p_to = body.periodo_to
        if p_from is not None and p_to is not None and p_from > p_to:
            p_from, p_to = p_to, p_from
        if p_from is not None:
            df = df[df["periodo_alcalde"] >= p_from]
        if p_to is not None:
            df = df[df["periodo_alcalde"] <= p_to]

    if "municipio" not in df.columns:
        raise HTTPException(status_code=404, detail="Municipio column not available.")

    target = normalize_text(body.municipio)
    if not target:
        raise HTTPException(status_code=422, detail="Municipio is required.")

    muni_norm = df["municipio"].apply(normalize_text)
    detalle = df[muni_norm == target].copy()
    if detalle.empty:
        raise HTTPException(status_code=404, detail="No data for selected municipio.")

    detalle = _add_risk_flags(detalle)
    detalle["brecha_adjudicado_ejecutado"] = np.where(
        detalle["monto_adjudicado"].notna(),
        detalle["monto_adjudicado"] - detalle["monto_ejecutado"],
        np.nan,
    )
    detalle = detalle.sort_values(["monto_ejecutado", "score_riesgo"], ascending=[False, False])

    dept_series = detalle["departamento"].dropna() if "departamento" in detalle.columns else pd.Series(dtype=object)
    dept_val = dept_series.mode().iloc[0] if not dept_series.empty else None
    total_proyectos = int(detalle["snip"].nunique()) if "snip" in detalle.columns else 0
    monto_total = float(detalle["monto_ejecutado"].sum()) if "monto_ejecutado" in detalle.columns else 0.0

    cols = [c for c in [
        "snip", "proyecto", "proveedor", "alcalde_ganador", "siglas_ganadora", "departamento",
        "ejercicio", "monto_adjudicado", "monto_ejecutado", "brecha_adjudicado_ejecutado",
        "meta_ejecutada", "ratio_meta_ejecucion", "score_riesgo",
        "sin_meta_ejecutada_con_gasto", "meta_baja_con_gasto", "sospechoso", "sobreejecucion_financiera",
        "fraccionamiento", "modificacion_excesiva", "adjudicacion_directa", "oferente_unico",
        "metodo_contratacion", "n_oferentes",
    ] if c in detalle.columns]

    return {
        "kpis": {
            "municipio": target,
            "departamento": dept_val,
            "total_proyectos": total_proyectos,
            "monto_total_ejecutado": clean_value(monto_total),
        },
        "proyectos": df_to_records(detalle[cols]),
    }


# ---------------------------------------------------------------------------
# TAB 3 – Proyectos Sospechosos
# ---------------------------------------------------------------------------


class SospechososRequest(FilterRequest):
    ejecucion_min: float = 0.95   # financial execution threshold (fraction, e.g. 0.95 = 95%)
    meta_max: float = 0.50        # physical goal threshold (fraction, e.g. 0.50 = 50%)


@app.post("/api/analysis/proyectos-sospechosos")
def proyectos_sospechosos(body: SospechososRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)
    df = _add_risk_flags(df)

    # Re-apply sospechoso flag with custom thresholds
    ejecucion_fin = np.where(
        df["monto_adjudicado"].notna() & (df["monto_adjudicado"] > 0),
        df["monto_ejecutado"] / df["monto_adjudicado"],
        np.nan,
    )
    df["sospechoso"] = np.where(
        df["monto_adjudicado"].notna()
        & (df["monto_adjudicado"] > 0)
        & (ejecucion_fin >= body.ejecucion_min)
        & (df["ratio_meta_ejecucion"] < body.meta_max),
        1, 0,
    )

    partido_lookup: dict = (
        df.groupby("alcalde_ganador")["siglas_ganadora"]
        .agg(lambda x: x.dropna().mode().iloc[0] if not x.dropna().empty else "N/D")
        .to_dict()
        if "siglas_ganadora" in df.columns
        else {}
    )

    def _top_text(df_in: pd.DataFrame, group_col: str, flag_col: str) -> dict | None:
        base = top_count_and_ratio(df_in, group_col, flag_col)
        if base.empty or base.iloc[0]["casos"] == 0:
            return None
        row = base.iloc[0]
        return {
            group_col: row[group_col],
            "casos": int(row["casos"]),
            "ratio": clean_value(row["ratio"]),
            "partido": partido_lookup.get(row[group_col], None) if group_col == "alcalde_ganador" else None,
        }

    top_alcalde_sos = _top_text(df, "alcalde_ganador", "sospechoso")
    top_municipio_sos = _top_text(df, "municipio", "sospechoso")
    top_proveedor_sos = _top_text(df, "proveedor", "sospechoso")
    top_alcalde_meta0 = _top_text(df, "alcalde_ganador", "sin_meta_ejecutada_con_gasto")
    top_municipio_meta0 = _top_text(df, "municipio", "sin_meta_ejecutada_con_gasto")
    top_proveedor_meta0 = _top_text(df, "proveedor", "sin_meta_ejecutada_con_gasto")
    top_municipio_fracc = _top_text(df, "municipio", "fraccionamiento")
    top_proveedor_fracc = _top_text(df, "proveedor", "fraccionamiento")
    top_municipio_mod = _top_text(df, "municipio", "modificacion_excesiva")
    top_municipio_adj = _top_text(df, "municipio", "adjudicacion_directa")
    top_proveedor_adj = _top_text(df, "proveedor", "adjudicacion_directa")
    top_municipio_of1 = _top_text(df, "municipio", "oferente_unico")

    # KPI summary
    total_proyectos_tab = df["snip"].nunique()

    def _pct_flag(flag_col: str) -> float | None:
        return (
            df[df[flag_col] == 1]["snip"].nunique() / total_proyectos_tab
            if total_proyectos_tab > 0
            else None
        )

    pct_sospechosos = _pct_flag("sospechoso")
    pct_meta0_gasto = _pct_flag("sin_meta_ejecutada_con_gasto")
    pct_meta_baja = _pct_flag("meta_baja_con_gasto")
    pct_sobreejecucion = _pct_flag("sobreejecucion_financiera")
    pct_fraccionamiento = _pct_flag("fraccionamiento")
    pct_modificacion_excesiva = _pct_flag("modificacion_excesiva")
    pct_adjudicacion_directa = _pct_flag("adjudicacion_directa")
    pct_oferente_unico = _pct_flag("oferente_unico")

    # Cobertura OCDS: % de proyectos con procurementMethodDetails presente
    _DETAIL_COL = "compiledRelease/tender/procurementMethodDetails"
    tiene_ocds = (
        df[_DETAIL_COL].notna().sum() / len(df)
        if _DETAIL_COL in df.columns and len(df) > 0
        else None
    )

    proyectos_tres_flags = int(
        df[
            (df["sospechoso"] == 1)
            & (df["sin_meta_ejecutada_con_gasto"] == 1)
            & (df["sobreejecucion_financiera"] == 1)
        ]["snip"].nunique()
    )

    # Maps
    df_sos = df[df["sospechoso"] == 1]
    total_muni = df.groupby("municipio")["snip"].nunique().reset_index(name="total_proyectos")

    map_sospechosos: list[dict] = []
    if not df_sos.empty:
        mapa_sos = df_sos.groupby("municipio")["snip"].nunique().reset_index(name="num")
        mapa_sos = mapa_sos.merge(total_muni, on="municipio", how="left")
        mapa_sos["pct"] = mapa_sos["num"] / mapa_sos["total_proyectos"]
        mapa_sos["municipio"] = mapa_sos["municipio"].astype(str).str.strip().str.upper()
        mapa_sos = mapa_sos.rename(columns={"total_proyectos": "total"})
        map_sospechosos = df_to_records(mapa_sos)

    prov_sos_muni = (
        df_sos.groupby(["municipio", "proveedor"])["snip"].nunique().reset_index(name="proyectos_sospechosos")
        if not df_sos.empty
        else pd.DataFrame()
    )
    map_proveedores_sos: list[dict] = []
    if not prov_sos_muni.empty:
        mapa_prov_sos = (
            prov_sos_muni.groupby("municipio")["proveedor"]
            .nunique()
            .reset_index(name="num")
        )
        total_prov_muni = df.groupby("municipio")["proveedor"].nunique().reset_index(name="total_proveedores")
        mapa_prov_sos = mapa_prov_sos.merge(total_prov_muni, on="municipio", how="left")
        mapa_prov_sos["pct"] = mapa_prov_sos["num"] / mapa_prov_sos["total_proveedores"]
        mapa_prov_sos["municipio"] = mapa_prov_sos["municipio"].astype(str).str.strip().str.upper()
        mapa_prov_sos = mapa_prov_sos.rename(columns={"total_proveedores": "total"})
        map_proveedores_sos = df_to_records(mapa_prov_sos)

    df_meta0 = df[df["sin_meta_ejecutada_con_gasto"] == 1]
    map_meta0_gasto: list[dict] = []
    if not df_meta0.empty:
        mapa_meta0 = df_meta0.groupby("municipio")["snip"].nunique().reset_index(name="num")
        mapa_meta0 = mapa_meta0.merge(total_muni, on="municipio", how="left")
        mapa_meta0["pct"] = mapa_meta0["num"] / mapa_meta0["total_proyectos"]
        mapa_meta0["municipio"] = mapa_meta0["municipio"].astype(str).str.strip().str.upper()
        mapa_meta0 = mapa_meta0.rename(columns={"total_proyectos": "total"})
        map_meta0_gasto = df_to_records(mapa_meta0)

    df_fracc = df[df["fraccionamiento"] == 1]
    map_fraccionamiento: list[dict] = []
    if not df_fracc.empty:
        mapa_fracc = df_fracc.groupby("municipio")["snip"].nunique().reset_index(name="num")
        mapa_fracc = mapa_fracc.merge(total_muni, on="municipio", how="left")
        mapa_fracc["pct"] = mapa_fracc["num"] / mapa_fracc["total_proyectos"]
        mapa_fracc["municipio"] = mapa_fracc["municipio"].astype(str).str.strip().str.upper()
        mapa_fracc = mapa_fracc.rename(columns={"total_proyectos": "total"})
        map_fraccionamiento = df_to_records(mapa_fracc)

    df_adj = df[df["adjudicacion_directa"] == 1]
    map_adjudicacion_directa: list[dict] = []
    if not df_adj.empty:
        mapa_adj = df_adj.groupby("municipio")["snip"].nunique().reset_index(name="num")
        mapa_adj = mapa_adj.merge(total_muni, on="municipio", how="left")
        mapa_adj["pct"] = mapa_adj["num"] / mapa_adj["total_proyectos"]
        mapa_adj["municipio"] = mapa_adj["municipio"].astype(str).str.strip().str.upper()
        mapa_adj = mapa_adj.rename(columns={"total_proyectos": "total"})
        map_adjudicacion_directa = df_to_records(mapa_adj)

    # Risk table — todos los proyectos con al menos un flag activo
    df_riesgo = df[
        (df["sin_meta_ejecutada_con_gasto"] == 1)
        | (df["meta_baja_con_gasto"] == 1)
        | (df["sospechoso"] == 1)
        | (df["sobreejecucion_financiera"] == 1)
        | (df["fraccionamiento"] == 1)
        | (df["modificacion_excesiva"] == 1)
        | (df["adjudicacion_directa"] == 1)
        | (df["oferente_unico"] == 1)
    ].copy()
    df_riesgo["brecha_adjudicado_ejecutado"] = np.where(
        df_riesgo["monto_adjudicado"].notna(),
        df_riesgo["monto_adjudicado"] - df_riesgo["monto_ejecutado"],
        np.nan,
    )
    riesgo_cols = [c for c in [
        "snip", "proyecto", "proveedor", "municipio", "departamento",
        "alcalde_ganador", "ejercicio", "monto_adjudicado", "monto_ejecutado",
        "brecha_adjudicado_ejecutado", "meta_fisica", "meta_ejecutada",
        "ratio_meta_ejecucion", "score_riesgo",
        "metodo_contratacion", "n_oferentes",
        "sin_meta_ejecutada_con_gasto", "meta_baja_con_gasto",
        "sospechoso", "sobreejecucion_financiera",
        "fraccionamiento", "modificacion_excesiva",
        "adjudicacion_directa", "oferente_unico",
    ] if c in df_riesgo.columns]
    df_riesgo = df_riesgo.sort_values(["score_riesgo", "monto_ejecutado"], ascending=[False, False])

    return {
        "insights": {
            "top_alcalde_sos": top_alcalde_sos,
            "top_municipio_sos": top_municipio_sos,
            "top_proveedor_sos": top_proveedor_sos,
            "top_alcalde_meta0": top_alcalde_meta0,
            "top_municipio_meta0": top_municipio_meta0,
            "top_proveedor_meta0": top_proveedor_meta0,
            "top_municipio_fracc": top_municipio_fracc,
            "top_proveedor_fracc": top_proveedor_fracc,
            "top_municipio_mod": top_municipio_mod,
            "top_municipio_adj": top_municipio_adj,
            "top_proveedor_adj": top_proveedor_adj,
            "top_municipio_of1": top_municipio_of1,
            "pct_sospechosos": clean_value(pct_sospechosos),
            "pct_meta0_gasto": clean_value(pct_meta0_gasto),
            "pct_meta_baja": clean_value(pct_meta_baja),
            "pct_sobreejecucion": clean_value(pct_sobreejecucion),
            "pct_fraccionamiento": clean_value(pct_fraccionamiento),
            "pct_modificacion_excesiva": clean_value(pct_modificacion_excesiva),
            "pct_adjudicacion_directa": clean_value(pct_adjudicacion_directa),
            "pct_oferente_unico": clean_value(pct_oferente_unico),
            "cobertura_ocds": clean_value(tiene_ocds),
            "proyectos_tres_flags": proyectos_tres_flags,
        },
        "tabla": df_to_records(df_riesgo[riesgo_cols]),
        "map_sospechosos": map_sospechosos,
        "map_proveedores_sos": map_proveedores_sos,
        "map_meta0_gasto": map_meta0_gasto,
        "map_fraccionamiento": map_fraccionamiento,
        "map_adjudicacion_directa": map_adjudicacion_directa,
        "thresholds": {
            "ejecucion_min": body.ejecucion_min,
            "meta_max": body.meta_max,
        },
    }


# ---------------------------------------------------------------------------
# TAB 4 – Partidos Políticos
# ---------------------------------------------------------------------------


@app.post("/api/analysis/partidos")
def partidos(body: FilterRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)
    df = _add_risk_flags(df)

    agg_partido = (
        df.groupby("siglas_ganadora")
        .agg(
            monto_ejecutado=("monto_ejecutado", "sum"),
            proyectos=("snip", "nunique"),
            alcaldes=("alcalde_ganador", "nunique"),
            ratio_meta=("ratio_meta_ejecucion", "mean"),
            sospechosos=("sospechoso", "sum"),
        )
        .reset_index()
    )
    if agg_partido.empty:
        return {"insights": {}, "table": [], "scatter_data": [], "partidos_list": []}

    agg_partido["ratio_sospechosos"] = agg_partido["sospechosos"] / agg_partido["proyectos"]

    # insights
    top_monto_row = agg_partido.sort_values("monto_ejecutado", ascending=False).iloc[0]
    top_monto = {
        "partido": top_monto_row["siglas_ganadora"],
        "monto": clean_value(top_monto_row["monto_ejecutado"]),
        "ratio_meta": clean_value(top_monto_row["ratio_meta"]),
    }

    top_alcaldes_insight = None
    if "periodo_alcalde" in df.columns:
        df_2023 = df[df["periodo_alcalde"] == 2023].copy()
        alcaldes_2023 = (
            df_2023[["siglas_ganadora", "alcalde_ganador"]]
            .dropna()
            .drop_duplicates(subset=["siglas_ganadora", "alcalde_ganador"])
        )
        total_2023 = alcaldes_2023["alcalde_ganador"].nunique()
        alcaldes_2023_partido = (
            alcaldes_2023.groupby("siglas_ganadora").size().reset_index(name="alcaldes").sort_values("alcaldes", ascending=False)
        )
        if not alcaldes_2023_partido.empty and total_2023 > 0:
            r = alcaldes_2023_partido.iloc[0]
            top_alcaldes_insight = {
                "partido": r["siglas_ganadora"],
                "alcaldes": int(r["alcaldes"]),
                "pct": clean_value(r["alcaldes"] / total_2023),
            }

    top_proyectos_row = agg_partido.sort_values("proyectos", ascending=False).iloc[0]
    top_proyectos = {
        "partido": top_proyectos_row["siglas_ganadora"],
        "proyectos": int(top_proyectos_row["proyectos"]),
    }

    worst_ratio_row = agg_partido.sort_values("ratio_meta", ascending=True).iloc[0]
    worst_ratio = {
        "partido": worst_ratio_row["siglas_ganadora"],
        "ratio_meta": clean_value(worst_ratio_row["ratio_meta"]),
    }

    ratio_sos = agg_partido[agg_partido["proyectos"] >= 3].sort_values("ratio_sospechosos", ascending=False)
    top_sos = None
    if not ratio_sos.empty:
        r = ratio_sos.iloc[0]
        top_sos = {
            "partido": r["siglas_ganadora"],
            "ratio": clean_value(r["ratio_sospechosos"]),
        }

    # Full stats table
    partidos_stats = (
        df.groupby("siglas_ganadora")
        .agg(
            proyectos=("snip", "nunique"),
            alcaldes=("alcalde_ganador", "nunique"),
            proveedores=("proveedor", "nunique"),
            monto_adjudicado=("monto_adjudicado", "sum"),
            monto_ejecutado=("monto_ejecutado", "sum"),
            ratio_promedio=("ratio_meta_ejecucion", "mean"),
            proyectos_sospechosos=("sospechoso", "sum"),
            proyectos_meta0_gasto=("sin_meta_ejecutada_con_gasto", "sum"),
            proyectos_sobreejecucion=("sobreejecucion_financiera", "sum"),
        )
        .reset_index()
        .sort_values("monto_ejecutado", ascending=False)
    )
    partidos_stats["pct_sospechosos"] = partidos_stats["proyectos_sospechosos"] / partidos_stats["proyectos"]
    partidos_stats["pct_meta0_gasto"] = partidos_stats["proyectos_meta0_gasto"] / partidos_stats["proyectos"]
    partidos_stats["pct_sobreejecucion"] = partidos_stats["proyectos_sobreejecucion"] / partidos_stats["proyectos"]

    partidos_list = sorted(df["siglas_ganadora"].dropna().unique().tolist())

    return {
        "insights": {
            "top_monto": top_monto,
            "top_alcaldes_2023": top_alcaldes_insight,
            "top_proyectos": top_proyectos,
            "worst_ratio": worst_ratio,
            "top_sos": top_sos,
        },
        "table": df_to_records(partidos_stats),
        "scatter_data": df_to_records(partidos_stats),
        "partidos_list": partidos_list,
    }


class PartidoDetalleRequest(BaseModel):
    partido: str
    filters: FilterRequest = FilterRequest()


@app.post("/api/analysis/partidos/detalle")
def partido_detalle(body: PartidoDetalleRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body.filters)
    df = _add_risk_flags(df)

    df_p = df[df["siglas_ganadora"] == body.partido].copy()
    if df_p.empty:
        raise HTTPException(status_code=404, detail="No data for selected partido.")

    total_proveedores = int(df_p["proveedor"].nunique())
    monto_total = float(df_p["monto_ejecutado"].sum())
    ratio_prom = df_p["ratio_meta_ejecucion"].mean()
    total_proyectos = int(df_p["snip"].nunique())

    sospechosos = int((df_p["sospechoso"] == 1).sum())
    meta0_gasto = int((df_p["sin_meta_ejecutada_con_gasto"] == 1).sum())
    sobreejecucion = int((df_p["sobreejecucion_financiera"] == 1).sum())

    # Project table
    df_p["orden_meta0"] = np.where(df_p["sin_meta_ejecutada_con_gasto"] == 1, 0, 1)
    df_p["orden_sos"] = np.where(df_p["sospechoso"] == 1, 0, 1)
    df_p["orden_sobre"] = np.where(df_p["sobreejecucion_financiera"] == 1, 0, 1)
    df_p = df_p.sort_values(
        ["orden_meta0", "orden_sos", "orden_sobre", "monto_ejecutado"],
        ascending=[True, True, True, False],
    )

    proj_cols = [c for c in [
        "snip", "proyecto", "municipio", "departamento", "alcalde_ganador",
        "proveedor", "monto_adjudicado", "monto_ejecutado", "ratio_meta_ejecucion",
        "score_riesgo", "sin_meta_ejecutada_con_gasto", "meta_baja_con_gasto",
        "sospechoso", "sobreejecucion_financiera",
        "fraccionamiento", "modificacion_excesiva",
    ] if c in df_p.columns]

    # Timeline
    df_timeline = df[df["siglas_ganadora"] == body.partido].copy()
    if "periodo_alcalde" in df_timeline.columns and "ejercicio" in df_timeline.columns:
        df_timeline = df_timeline[
            (
                (df_timeline["periodo_alcalde"] == 2015)
                & (df_timeline["ejercicio"].between(2016, 2018))
            )
            | (
                (df_timeline["periodo_alcalde"] == 2019)
                & (df_timeline["ejercicio"].between(2019, 2022))
            )
            | (
                (df_timeline["periodo_alcalde"] == 2023)
                & (df_timeline["ejercicio"].between(2023, 2026))
            )
        ].copy()

        alcaldes_por_anio = (
            df_timeline[["ejercicio", "alcalde_ganador"]]
            .dropna()
            .drop_duplicates()
            .groupby("ejercicio")
            .size()
            .reset_index(name="alcaldes_unicos")
        )
        monto_por_anio = (
            df_timeline.groupby("ejercicio")["monto_ejecutado"]
            .sum()
            .reset_index(name="monto_ejecutado")
        )
        timeline = (
            alcaldes_por_anio.merge(monto_por_anio, on="ejercicio", how="left")
            .sort_values("ejercicio")
        )
        timeline_records = df_to_records(timeline)
    else:
        timeline_records = []

    return {
        "kpis": {
            "total_proveedores": total_proveedores,
            "monto_total_ejecutado": clean_value(monto_total),
            "ratio_promedio": clean_value(ratio_prom),
            "total_proyectos": total_proyectos,
            "proyectos_sospechosos": sospechosos,
            "proyectos_meta0_gasto": meta0_gasto,
            "proyectos_sobreejecucion": sobreejecucion,
        },
        "proyectos": df_to_records(df_p[proj_cols]),
        "timeline": timeline_records,
    }


# ---------------------------------------------------------------------------
# TAB 5 – Proveedores
# ---------------------------------------------------------------------------


@app.post("/api/analysis/proveedores")
def proveedores(body: FilterRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)
    df = _add_risk_flags(df)

    agg_prov = (
        df.groupby("proveedor")
        .agg(
            proyectos=("snip", "nunique"),
            municipios=("municipio", "nunique"),
            alcaldes=("alcalde_ganador", "nunique"),
            monto_total_ejecutado=("monto_ejecutado", "sum"),
            promedio_monto_ejecutado=("monto_ejecutado", "mean"),
            promedio_ratio_meta_ejecutada=("ratio_meta_ejecucion", "mean"),
        )
        .reset_index()
    )
    agg_prov = agg_prov[agg_prov["proveedor"].notna()].copy()

    sos_prov = (
        df[df["sospechoso"] == 1]
        .groupby("proveedor")["snip"]
        .nunique()
        .reset_index(name="proyectos_sospechosos")
    )
    meta0_prov = (
        df[df["sin_meta_ejecutada_con_gasto"] == 1]
        .groupby("proveedor")["snip"]
        .nunique()
        .reset_index(name="casos_sin_meta_ejecutada_con_gasto")
    )
    sobre_prov = (
        df[df["sobreejecucion_financiera"] == 1]
        .groupby("proveedor")["snip"]
        .nunique()
        .reset_index(name="casos_sobreejecucion")
    )

    agg_prov = agg_prov.merge(sos_prov, on="proveedor", how="left")
    agg_prov = agg_prov.merge(meta0_prov, on="proveedor", how="left")
    agg_prov = agg_prov.merge(sobre_prov, on="proveedor", how="left")

    for col in ["proyectos_sospechosos", "casos_sin_meta_ejecutada_con_gasto", "casos_sobreejecucion"]:
        agg_prov[col] = agg_prov[col].fillna(0)

    agg_prov["ratio_sospechosos"] = agg_prov["proyectos_sospechosos"] / agg_prov["proyectos"]
    agg_prov["ratio_sin_meta"] = agg_prov["casos_sin_meta_ejecutada_con_gasto"] / agg_prov["proyectos"]
    agg_prov["ratio_sobreejecucion"] = agg_prov["casos_sobreejecucion"] / agg_prov["proyectos"]

    # insights
    top_monto = None
    if not agg_prov.empty:
        r = agg_prov.sort_values("monto_total_ejecutado", ascending=False).iloc[0]
        top_monto = {"proveedor": r["proveedor"], "monto": clean_value(r["monto_total_ejecutado"])}

    top_municipios = None
    if not agg_prov.empty:
        r = agg_prov.sort_values("municipios", ascending=False).iloc[0]
        top_municipios = {"proveedor": r["proveedor"], "municipios": int(r["municipios"])}

    worst_ratio = None
    ratio_prov = agg_prov.dropna(subset=["promedio_ratio_meta_ejecutada"]).sort_values("promedio_ratio_meta_ejecutada")
    if not ratio_prov.empty:
        r = ratio_prov.iloc[0]
        worst_ratio = {"proveedor": r["proveedor"], "ratio": clean_value(r["promedio_ratio_meta_ejecutada"])}

    top_sos = None
    sos_filtered = agg_prov[agg_prov["proyectos"] >= 3].sort_values(
        ["proyectos_sospechosos", "ratio_sospechosos"], ascending=[False, False]
    )
    if not sos_filtered.empty:
        r = sos_filtered.iloc[0]
        top_sos = {
            "proveedor": r["proveedor"],
            "casos": int(r["proyectos_sospechosos"]),
            "ratio": clean_value(r["ratio_sospechosos"]),
        }

    top_meta0 = None
    meta0_filtered = agg_prov[agg_prov["proyectos"] >= 3].sort_values(
        ["casos_sin_meta_ejecutada_con_gasto", "ratio_sin_meta"], ascending=[False, False]
    )
    if not meta0_filtered.empty:
        r = meta0_filtered.iloc[0]
        top_meta0 = {
            "proveedor": r["proveedor"],
            "casos": int(r["casos_sin_meta_ejecutada_con_gasto"]),
            "ratio": clean_value(r["ratio_sin_meta"]),
        }

    top_sobre = None
    sobre_filtered = agg_prov[agg_prov["proyectos"] >= 3].sort_values(
        ["casos_sobreejecucion", "ratio_sobreejecucion"], ascending=[False, False]
    )
    if not sobre_filtered.empty:
        r = sobre_filtered.iloc[0]
        top_sobre = {
            "proveedor": r["proveedor"],
            "casos": int(r["casos_sobreejecucion"]),
            "ratio": clean_value(r["ratio_sobreejecucion"]),
        }

    agg_prov["proveedor_link"] = agg_prov["proveedor"].apply(determinar_tipo)
    agg_prov = agg_prov.sort_values("monto_total_ejecutado", ascending=False)

    proveedores_list = sorted(df["proveedor"].dropna().unique().tolist())

    return {
        "insights": {
            "top_monto": top_monto,
            "top_municipios": top_municipios,
            "worst_ratio": worst_ratio,
            "top_sos": top_sos,
            "top_meta0": top_meta0,
            "top_sobre": top_sobre,
        },
        "table": df_to_records(agg_prov),
        "proveedores_list": proveedores_list,
    }


class ProveedorDetalleRequest(BaseModel):
    proveedor: str
    filters: FilterRequest = FilterRequest()


@app.post("/api/analysis/proveedores/detalle")
def proveedor_detalle(body: ProveedorDetalleRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body.filters)
    df = _add_risk_flags(df)

    detalle = df[df["proveedor"] == body.proveedor].copy()
    if detalle.empty:
        raise HTTPException(status_code=404, detail="No data for selected proveedor.")

    detalle["sospechoso_label"] = detalle["sospechoso"].map({1: "Sí", 0: "No"})
    detalle["sin_meta_label"] = detalle["sin_meta_ejecutada_con_gasto"].map({1: "Sí", 0: "No"})
    detalle["sobre_label"] = detalle["sobreejecucion_financiera"].map({1: "Sí", 0: "No"})

    pct_sospechosos = (detalle["sospechoso"] == 1).mean()
    total_proyectos = int(detalle["proyecto"].nunique()) if "proyecto" in detalle.columns else 0
    total_municipios = int(detalle["municipio"].nunique()) if "municipio" in detalle.columns else 0
    total_alcaldes = int(detalle["alcalde_ganador"].nunique()) if "alcalde_ganador" in detalle.columns else 0
    monto_total = float(detalle["monto_ejecutado"].sum())
    ratio_prom = detalle["ratio_meta_ejecucion"].mean()
    proy_sin_meta = int((detalle["sin_meta_ejecutada_con_gasto"] == 1).sum())
    proy_sobre = int((detalle["sobreejecucion_financiera"] == 1).sum())
    total_partidos = int(detalle["siglas_ganadora"].dropna().nunique()) if "siglas_ganadora" in detalle.columns else 0

    min_year = detalle["ejercicio"].min() if "ejercicio" in detalle.columns else None
    max_year = detalle["ejercicio"].max() if "ejercicio" in detalle.columns else None
    anios_operacion = (
        int(max_year - min_year + 1)
        if min_year is not None and max_year is not None and pd.notna(min_year) and pd.notna(max_year)
        else 0
    )

    detalle["orden_meta0"] = np.where(detalle["sin_meta_ejecutada_con_gasto"] == 1, 0, 1)
    detalle["orden_sospechoso"] = np.where(detalle["sospechoso"] == 1, 0, 1)
    detalle["orden_sobre"] = np.where(detalle["sobreejecucion_financiera"] == 1, 0, 1)
    detalle = detalle.sort_values(
        ["orden_meta0", "orden_sospechoso", "orden_sobre", "monto_ejecutado"],
        ascending=[True, True, True, False],
    )

    proj_cols = [c for c in [
        "snip", "proyecto", "municipio", "departamento", "alcalde_ganador",
        "siglas_ganadora", "ejercicio", "monto_adjudicado", "monto_ejecutado",
        "ratio_meta_ejecucion", "meta_fisica", "score_riesgo",
        "sin_meta_ejecutada_con_gasto", "meta_baja_con_gasto",
        "sospechoso", "sobreejecucion_financiera",
        "fraccionamiento", "modificacion_excesiva",
        "adjudicacion_directa", "oferente_unico", "metodo_contratacion", "n_oferentes",
    ] if c in detalle.columns]

    # Evolución general
    evolucion_general_df = (
        detalle.groupby("ejercicio")["monto_ejecutado"]
        .sum()
        .reset_index()
        .sort_values("ejercicio")
        if "ejercicio" in detalle.columns
        else pd.DataFrame()
    )

    # Evolución por municipio
    evolucion_muni_df = pd.DataFrame()
    if "ejercicio" in detalle.columns and "municipio" in detalle.columns:
        rename_cols: dict[str, str] = {}
        if "alcalde_ganador" in detalle.columns:
            rename_cols["alcalde_ganador"] = "alcalde"
        if "siglas_ganadora" in detalle.columns:
            rename_cols["siglas_ganadora"] = "partido"
        agg_cols = ["municipio", "ejercicio"]
        hover_cols = [c for c in ["alcalde_ganador", "siglas_ganadora"] if c in detalle.columns]
        evolucion_muni_df = (
            detalle.groupby(agg_cols + hover_cols)["monto_ejecutado"]
            .sum()
            .reset_index()
            .sort_values(["municipio", "ejercicio"])
        )
        if rename_cols:
            evolucion_muni_df = evolucion_muni_df.rename(columns=rename_cols)
        evolucion_muni_df = evolucion_muni_df[evolucion_muni_df["monto_ejecutado"] > 0]

    return {
        "kpis": {
            "total_proyectos": total_proyectos,
            "total_municipios": total_municipios,
            "pct_sospechosos": clean_value(pct_sospechosos),
            "total_alcaldes": total_alcaldes,
            "monto_total_ejecutado": clean_value(monto_total),
            "ratio_promedio": clean_value(ratio_prom),
            "proyectos_sin_meta_con_gasto": proy_sin_meta,
            "proyectos_sobreejecucion": proy_sobre,
            "total_partidos": total_partidos,
            "anios_operacion": anios_operacion,
        },
        "proyectos": df_to_records(detalle[proj_cols]),
        "evolucion_general": df_to_records(evolucion_general_df) if not evolucion_general_df.empty else [],
        "evolucion_por_municipio": df_to_records(evolucion_muni_df) if not evolucion_muni_df.empty else [],
    }


# ---------------------------------------------------------------------------
# TAB 6 – Costo por Unidad Física
# ---------------------------------------------------------------------------


class CostoUnidadRequest(FilterRequest):
    unidad: str = ""


@app.post("/api/analysis/costo-unidad")
def costo_unidad(body: CostoUnidadRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    # Apply base filters (excluding unidad field which is handled separately)
    base_filter = FilterRequest(
        departamentos=body.departamentos,
        municipios=body.municipios,
        codedes=body.codedes,
        sectores=body.sectores,
        instituciones=body.instituciones,
        year_min=body.year_min,
        year_max=body.year_max,
        etapas=body.etapas,
    )
    df = apply_filter_request(df, base_filter)
    df = _add_risk_flags(df)

    unidades: list[str] = sorted(df["unidad"].dropna().unique().tolist()) if "unidad" in df.columns else []

    if not body.unidad and unidades:
        selected_unit = "Metro" if "Metro" in unidades else unidades[0]
    else:
        selected_unit = body.unidad

    if selected_unit:
        df_cost = df[df["unidad"] == selected_unit].copy()
    else:
        df_cost = df.copy()

    if "costo_por_unidad" in df_cost.columns:
        df_cost = df_cost[df_cost["costo_por_unidad"].notna()].copy()
    else:
        return {
            "insights": {},
            "boxplot_data": [],
            "table_proveedores": [],
            "table_alcaldes": [],
            "unidades": unidades,
        }

    if df_cost.empty:
        return {
            "insights": {},
            "boxplot_data": [],
            "table_proveedores": [],
            "table_alcaldes": [],
            "unidades": unidades,
        }

    # Insights
    top_proyecto = None
    r = df_cost.sort_values("costo_por_unidad", ascending=False).iloc[0]
    top_proyecto = {
        "proyecto": r.get("proyecto"),
        "proveedor": r.get("proveedor"),
        "municipio": r.get("municipio"),
        "costo": clean_value(r["costo_por_unidad"]),
    }

    proveedores_insights = (
        df_cost.groupby("proveedor")
        .agg(proyectos=("snip", "nunique"), costo_promedio=("costo_por_unidad", "mean"))
        .reset_index()
    )
    proveedores_insights = proveedores_insights[proveedores_insights["proyectos"] >= 2]
    top_proveedor_insight = None
    if not proveedores_insights.empty:
        r2 = proveedores_insights.sort_values("costo_promedio", ascending=False).iloc[0]
        top_proveedor_insight = {
            "proveedor": r2["proveedor"],
            "costo_promedio": clean_value(r2["costo_promedio"]),
            "proyectos": int(r2["proyectos"]),
        }

    top_alcalde_insight = None
    if "alcalde_ganador" in df_cost.columns:
        alcaldes_insights = (
            df_cost.groupby(
                [c for c in ["alcalde_ganador", "siglas_ganadora", "municipio"] if c in df_cost.columns]
            )
            .agg(proyectos=("snip", "nunique"), costo_promedio=("costo_por_unidad", "mean"))
            .reset_index()
        )
        alcaldes_insights = alcaldes_insights[alcaldes_insights["proyectos"] >= 2]
        if not alcaldes_insights.empty:
            r3 = alcaldes_insights.sort_values("costo_promedio", ascending=False).iloc[0]
            top_alcalde_insight = {
                "alcalde": r3.get("alcalde_ganador"),
                "municipio": r3.get("municipio"),
                "partido": r3.get("siglas_ganadora"),
                "costo_promedio": clean_value(r3["costo_promedio"]),
                "proyectos": int(r3["proyectos"]),
            }

    # Boxplot statistics per department (ordered by mean descending, matching original app)
    dept_order = (
        df_cost.groupby("departamento")["costo_por_unidad"]
        .mean()
        .sort_values(ascending=False)
        .index.tolist()
    ) if "departamento" in df_cost.columns else []

    boxplot_data = []
    for dept in dept_order:
        vals = df_cost.loc[df_cost["departamento"] == dept, "costo_por_unidad"].dropna().values
        if len(vals) == 0:
            continue
        q1 = float(np.percentile(vals, 25))
        median = float(np.median(vals))
        q3 = float(np.percentile(vals, 75))
        iqr = q3 - q1
        lower_fence = float(max(vals.min(), q1 - 1.5 * iqr))
        upper_fence = float(min(vals.max(), q3 + 1.5 * iqr))
        outliers = [float(v) for v in vals if v < lower_fence or v > upper_fence]
        boxplot_data.append({
            "departamento": dept,
            "q1": q1,
            "median": median,
            "q3": q3,
            "lower_fence": lower_fence,
            "upper_fence": upper_fence,
            "outliers": outliers,
            "n": int(len(vals)),
        })

    # Provider table
    proveedores_stats = (
        df_cost.groupby("proveedor")
        .agg(
            proyectos=("snip", "nunique"),
            costo_promedio=("costo_por_unidad", "mean"),
            costo_mediano=("costo_por_unidad", "median"),
        )
        .reset_index()
        .sort_values("costo_promedio", ascending=False)
    )
    proveedores_stats["proveedor_link"] = proveedores_stats["proveedor"].apply(determinar_tipo)

    # Mayor/alcalde table
    alcaldes_stats = (
        df_cost.groupby("alcalde_ganador")
        .agg(
            proyectos=("snip", "nunique"),
            costo_promedio=("costo_por_unidad", "mean"),
            costo_mediano=("costo_por_unidad", "median"),
        )
        .reset_index()
        .sort_values("costo_promedio", ascending=False)
        if "alcalde_ganador" in df_cost.columns
        else pd.DataFrame()
    )
    if not alcaldes_stats.empty:
        alcaldes_stats["alcalde_link"] = alcaldes_stats["alcalde_ganador"].apply(alcalde_link)

    return {
        "insights": {
            "top_proyecto": top_proyecto,
            "top_proveedor": top_proveedor_insight,
            "top_alcalde": top_alcalde_insight,
            "selected_unit": selected_unit,
        },
        "boxplot_data": boxplot_data,
        "table_proveedores": df_to_records(proveedores_stats),
        "table_alcaldes": df_to_records(alcaldes_stats) if not alcaldes_stats.empty else [],
        "unidades": unidades,
    }


# ---------------------------------------------------------------------------
# TAB 7 – Competencia (tenderer analysis)
# ---------------------------------------------------------------------------

PROCUREMENT_METHOD_COL = "compiledRelease/tender/procurementMethod"
N_TENDERERS_COL_RAW = "compiledRelease/tender/numberOfTenderers"


@app.post("/api/analysis/competencia")
def competencia(body: FilterRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, body)
    df = _add_risk_flags(df)

    # Work only with rows that have n_oferentes
    df_c = df[df["n_oferentes"].notna()].copy()
    df_c["n_oferentes"] = df_c["n_oferentes"].astype(int)

    total = len(df_c)

    # --- Insights ---
    pct_unico = float((df_c["n_oferentes"] == 1).sum() / total) if total > 0 else 0.0
    avg_global = float(df_c["n_oferentes"].mean()) if total > 0 else 0.0
    max_tenderers = int(df_c["n_oferentes"].max()) if total > 0 else 0

    # Sector with highest avg tenderers (at least 5 projects)
    sector_avg = None
    if "sector" in df_c.columns:
        sa = (
            df_c.groupby("sector")
            .agg(avg_of=("n_oferentes", "mean"), count=("snip", "nunique"))
            .reset_index()
        )
        sa = sa[sa["count"] >= 5].sort_values("avg_of", ascending=False)
        if not sa.empty:
            r = sa.iloc[0]
            sector_avg = {"sector": r["sector"], "avg": clean_value(r["avg_of"]), "count": int(r["count"])}

    # Sector with lowest avg tenderers (at least 5 projects)
    sector_min = None
    if "sector" in df_c.columns and not sa.empty:
        r2 = sa.iloc[-1]
        sector_min = {"sector": r2["sector"], "avg": clean_value(r2["avg_of"]), "count": int(r2["count"])}

    insights = {
        "pct_unico": pct_unico,
        "avg_global": avg_global,
        "max_tenderers": max_tenderers,
        "total_con_datos": total,
        "sector_mas_competitivo": sector_avg,
        "sector_menos_competitivo": sector_min,
    }

    # --- Distribution histogram: 1 .. 5, 6+ ---
    dist_rows = []
    for n in range(1, 6):
        cnt = int((df_c["n_oferentes"] == n).sum())
        dist_rows.append({"n_oferentes": str(n), "count": cnt, "pct": cnt / total if total > 0 else 0.0})
    cnt_plus = int((df_c["n_oferentes"] >= 6).sum())
    dist_rows.append({"n_oferentes": "6+", "count": cnt_plus, "pct": cnt_plus / total if total > 0 else 0.0})

    # --- Por sector ---
    por_sector = []
    if "sector" in df_c.columns:
        ps = (
            df_c.groupby("sector")
            .agg(
                avg_oferentes=("n_oferentes", "mean"),
                count=("snip", "nunique"),
                monto_total=("monto_adjudicado", "sum"),
            )
            .reset_index()
            .sort_values("avg_oferentes", ascending=False)
        )
        for _, r in ps.iterrows():
            por_sector.append({
                "sector": r["sector"],
                "avg_oferentes": clean_value(r["avg_oferentes"]),
                "count": int(r["count"]),
                "monto_total": clean_value(r["monto_total"]),
            })

    # --- Award amount stats by n_oferentes bucket ---
    def bucket_label(n: int) -> str:
        if n <= 5:
            return str(n)
        return "6+"

    df_c["bucket"] = df_c["n_oferentes"].apply(bucket_label)
    bucket_order = ["1", "2", "3", "4", "5", "6+"]
    stats_por_oferentes = []
    for b in bucket_order:
        sub = df_c[df_c["bucket"] == b]["monto_adjudicado"].dropna()
        if sub.empty:
            continue
        stats_por_oferentes.append({
            "bucket": b,
            "avg_monto": clean_value(sub.mean()),
            "median_monto": clean_value(sub.median()),
            "count": int(len(sub)),
        })

    # --- Proyectos con un solo oferente (min) ---
    proj_cols = [c for c in [
        "snip", "proyecto", "municipio", "departamento", "sector",
        "proveedor", "monto_adjudicado", "n_oferentes",
        "adjudicacion_directa", "metodo_contratacion",
    ] if c in df_c.columns]

    df_min = (
        df_c[df_c["n_oferentes"] == 1]
        .sort_values("monto_adjudicado", ascending=False)
        .head(100)
    )
    proyectos_min = df_to_records(df_min[proj_cols])

    # --- Proyectos con más oferentes (max) ---
    df_max = (
        df_c.sort_values("n_oferentes", ascending=False)
        .head(100)
    )
    proyectos_max = df_to_records(df_max[proj_cols])

    return {
        "insights": insights,
        "distribucion": dist_rows,
        "por_sector": por_sector,
        "stats_por_oferentes": stats_por_oferentes,
        "proyectos_min": proyectos_min,
        "proyectos_max": proyectos_max,
    }


# ---------------------------------------------------------------------------
# TAB 8 – Búsqueda por variables de riesgo
# ---------------------------------------------------------------------------


class BusquedaRequest(BaseModel):
    filters: FilterRequest = FilterRequest()
    variable: str
    tipo: str = "proyectos"  # "proyectos" | "proveedores" | "alcaldes"


def _active_flags(r: dict) -> list:
    flags = []
    if r.get("adjudicacion_directa"): flags.append("compra directa (sin concurso)")
    if r.get("oferente_unico"): flags.append("oferente único en licitación")
    if r.get("fraccionamiento"): flags.append("fraccionamiento de contratos")
    if r.get("sospechoso"): flags.append("pago sin ejecución física")
    if r.get("sin_meta_ejecutada_con_gasto"): flags.append("sin meta ejecutada con gasto")
    if r.get("sobreejecucion_financiera"): flags.append("sobreejecutado vs. adjudicado")
    if r.get("modificacion_excesiva"): flags.append("modificación presupuestaria >20%")
    return flags


def _razon_proyecto(r: dict, variable: str) -> str:
    if variable == "score_riesgo":
        flags = _active_flags(r)
        banderas = ", ".join(flags) if flags else "ninguna"
        return f"Score {r.get('score_riesgo', 0)}/100. Banderas activas: {banderas}."
    if variable == "adjudicacion_directa":
        monto = r.get("monto_adjudicado") or 0
        extra = _active_flags(r)
        nota = f" Además: {', '.join(extra)}." if extra else ""
        return f"Contrato adjudicado vía Compra Directa o Caso de Excepción (LCE). Monto: Q{monto:,.0f}.{nota}"
    if variable == "oferente_unico":
        monto = r.get("monto_adjudicado") or 0
        extra = [f for f in _active_flags(r) if f != "oferente único en licitación"]
        nota = f" Además: {', '.join(extra)}." if extra else ""
        return f"1 oferente en proceso formalmente competitivo (Cotización/Licitación). Monto: Q{monto:,.0f}.{nota}"
    if variable == "fraccionamiento":
        return ("Mismo proveedor+municipio+año: suma de contratos > Q900 K "
                "pero ningún contrato individual supera el umbral. "
                "Patrón para evadir licitación pública.")
    if variable == "sospechoso":
        adj = r.get("monto_adjudicado") or 1
        eje = r.get("monto_ejecutado") or 0
        meta = (r.get("ratio_meta_ejecucion") or 0) * 100
        fin_pct = (eje / adj * 100) if adj > 0 else 0
        return (f"Ejecución financiera {fin_pct:.0f}% pero meta física {meta:.0f}%. "
                "El dinero se transfirió sin evidencia proporcional de obra ejecutada.")
    if variable == "sin_meta_ejecutada_con_gasto":
        eje = r.get("monto_ejecutado") or 0
        return f"Q{eje:,.0f} ejecutado con meta física = 0. Sin evidencia alguna de obra realizada."
    if variable == "sobreejecucion_financiera":
        adj = r.get("monto_adjudicado") or 0
        eje = r.get("monto_ejecutado") or 0
        pct = ((eje - adj) / adj * 100) if adj > 0 else 0
        return (f"Gastó Q{eje:,.0f} ({pct:.0f}% más que el adjudicado de Q{adj:,.0f}). "
                f"Exceso: Q{eje - adj:,.0f}.")
    if variable == "modificacion_excesiva":
        ini = r.get("monto_inicial") or 0
        vig = r.get("monto_vigente") or 0
        pct = ((vig - ini) / ini * 100) if ini > 0 else 0
        return (f"Presupuesto aumentó {pct:.0f}%: de Q{ini:,.0f} aprobado "
                f"a Q{vig:,.0f} vigente.")
    return "Indicador de riesgo activo."


def _top20_proyectos(df: pd.DataFrame, mask: pd.Series, sort_col: str, variable: str) -> list:
    cols_needed = [
        "snip", "proyecto", "municipio", "departamento", "sector",
        "proveedor", "monto_adjudicado", "monto_ejecutado", "monto_inicial",
        "monto_vigente", "ratio_meta_ejecucion", "score_riesgo",
        "adjudicacion_directa", "oferente_unico", "fraccionamiento",
        "sospechoso", "sin_meta_ejecutada_con_gasto", "sobreejecucion_financiera",
        "modificacion_excesiva", "ejercicio", "alcalde_ganador", "n_oferentes",
    ]
    cols = [c for c in cols_needed if c in df.columns]
    sort = sort_col if sort_col in df.columns else cols[0]
    sub = df[mask].sort_values(sort, ascending=False).head(20)
    results = []
    for rec in df_to_records(sub[cols]):
        rec["razon"] = _razon_proyecto(rec, variable)
        results.append(rec)
    return results


def _busqueda_proyectos(df: pd.DataFrame, variable: str) -> list:
    if variable == "score_riesgo":
        mask = df["score_riesgo"] >= 40
        if mask.sum() < 5:
            mask = df["score_riesgo"] >= 20
        return _top20_proyectos(df, mask, "score_riesgo", variable)
    if variable in ("adjudicacion_directa", "oferente_unico", "fraccionamiento",
                    "sospechoso", "sin_meta_ejecutada_con_gasto",
                    "sobreejecucion_financiera", "modificacion_excesiva"):
        if variable not in df.columns:
            return []
        mask = df[variable] == 1
        return _top20_proyectos(df, mask, "monto_adjudicado", variable)
    return []


def _busqueda_proveedores(df: pd.DataFrame, variable: str) -> list:
    if "proveedor" not in df.columns:
        return []
    df_p = df[df["proveedor"].notna() & (df["proveedor"].astype(str).str.strip() != "")].copy()

    if variable == "alta_directa":
        DETAIL_COL = "compiledRelease/tender/procurementMethodDetails"
        df_ocds = df_p[df_p[DETAIL_COL].notna()].copy() if DETAIL_COL in df_p.columns else df_p.copy()
        if df_ocds.empty:
            return []
        grp = (
            df_ocds.groupby("proveedor")
            .agg(
                total_ocds=("snip", "count"),
                directas=("adjudicacion_directa", "sum"),
                monto_total=("monto_adjudicado", "sum"),
            )
            .reset_index()
        )
        grp = grp[grp["total_ocds"] >= 2]
        grp["pct_directas"] = grp["directas"] / grp["total_ocds"]
        grp = grp[grp["directas"] >= 1].sort_values(
            ["pct_directas", "monto_total"], ascending=[False, False]
        ).head(20)
        results = []
        for _, r in grp.iterrows():
            results.append({
                "nombre": str(r["proveedor"]),
                "total_contratos": int(r["total_ocds"]),
                "monto_total": clean_value(r["monto_total"]),
                "razon": (f"{r['pct_directas']*100:.0f}% de sus {int(r['total_ocds'])} contratos con datos OCDS "
                          f"({int(r['directas'])}) son Compra Directa o Caso de Excepción. "
                          f"Monto total: Q{r['monto_total']:,.0f}."),
            })
        return results

    if variable == "dominio_municipal":
        if "municipio" not in df_p.columns:
            return []
        tot_prov = df_p.groupby("proveedor")["monto_adjudicado"].sum().rename("total_prov")
        mun_grp = (
            df_p.groupby(["proveedor", "municipio"])["monto_adjudicado"]
            .sum().rename("monto_mun").reset_index()
        )
        mun_grp = mun_grp.merge(tot_prov, on="proveedor")
        mun_grp["pct"] = mun_grp["monto_mun"] / mun_grp["total_prov"]
        idx = mun_grp.groupby("proveedor")["pct"].idxmax()
        best = mun_grp.loc[idx]
        best = best[best["monto_mun"] > 0].sort_values("monto_mun", ascending=False).head(20)
        results = []
        for _, r in best.iterrows():
            nivel = ("Concentración absoluta en un solo municipio." if r["pct"] > 0.90
                     else "Alta dependencia de un municipio." if r["pct"] > 0.50
                     else "")
            results.append({
                "nombre": str(r["proveedor"]),
                "municipio": str(r["municipio"]),
                "monto_total": clean_value(r["total_prov"]),
                "razon": (f"El {r['pct']*100:.0f}% de su facturación total "
                          f"(Q{r['monto_mun']:,.0f} de Q{r['total_prov']:,.0f}) "
                          f"proviene de {r['municipio']}. {nivel}"),
            })
        return results

    if variable == "fraccionamiento_sistematico":
        grp = (
            df_p.groupby("proveedor")
            .agg(
                total_frac=("fraccionamiento", "sum"),
                monto_total=("monto_adjudicado", "sum"),
                total=("snip", "count"),
            )
            .reset_index()
        )
        grp = grp[grp["total_frac"] >= 1].sort_values(
            ["total_frac", "monto_total"], ascending=[False, False]
        ).head(20)
        results = []
        for _, r in grp.iterrows():
            n = int(r["total_frac"])
            results.append({
                "nombre": str(r["proveedor"]),
                "total_contratos": int(r["total"]),
                "monto_total": clean_value(r["monto_total"]),
                "razon": (f"{n} contrato{'s' if n > 1 else ''} marcado{'s' if n > 1 else ''} como "
                          f"fraccionamiento (de {int(r['total'])} en total). "
                          f"Monto total: Q{r['monto_total']:,.0f}."),
            })
        return results

    if variable == "alto_score_promedio":
        grp = (
            df_p.groupby("proveedor")
            .agg(
                avg_score=("score_riesgo", "mean"),
                max_score=("score_riesgo", "max"),
                total=("snip", "count"),
                monto_total=("monto_adjudicado", "sum"),
            )
            .reset_index()
        )
        grp = grp[grp["total"] >= 2].sort_values(
            ["avg_score", "monto_total"], ascending=[False, False]
        ).head(20)
        results = []
        for _, r in grp.iterrows():
            results.append({
                "nombre": str(r["proveedor"]),
                "total_contratos": int(r["total"]),
                "monto_total": clean_value(r["monto_total"]),
                "razon": (f"Score promedio {r['avg_score']:.1f}/100 (máximo {int(r['max_score'])}) "
                          f"en {int(r['total'])} contratos. Monto total: Q{r['monto_total']:,.0f}."),
            })
        return results

    return []


def _alcalde_agg(df_a: pd.DataFrame) -> dict:
    base: dict = {
        "total": ("snip", "count"),
        "monto_total_adj": ("monto_adjudicado", "sum"),
        "monto_total_eje": ("monto_ejecutado", "sum"),
        "sospechosos": ("sospechoso", "sum"),
        "directas": ("adjudicacion_directa", "sum"),
        "municipio": ("municipio", "first"),
        "departamento": ("departamento", "first"),
    }
    if "siglas_ganadora" in df_a.columns:
        base["partido"] = ("siglas_ganadora", "first")
    return base


def _busqueda_alcaldes(df: pd.DataFrame, variable: str) -> list:
    if "alcalde_ganador" not in df.columns:
        return []
    df_a = df[df["alcalde_ganador"].notna() & (df["alcalde_ganador"].astype(str).str.strip() != "")].copy()

    if variable == "alta_tasa_sospechosos":
        grp = df_a.groupby("alcalde_ganador").agg(**_alcalde_agg(df_a)).reset_index()
        grp = grp[grp["total"] >= 3]
        grp["pct_sospechosos"] = grp["sospechosos"] / grp["total"]
        grp = grp[grp["sospechosos"] >= 1].sort_values(
            ["pct_sospechosos", "monto_total_eje"], ascending=[False, False]
        ).head(20)
        results = []
        for _, r in grp.iterrows():
            results.append({
                "nombre": str(r["alcalde_ganador"]),
                "municipio": str(r.get("municipio", "—")),
                "departamento": str(r.get("departamento", "—")),
                "partido": str(r.get("partido", "—")),
                "total_proyectos": int(r["total"]),
                "monto_total": clean_value(r["monto_total_eje"]),
                "razon": (f"{r['pct_sospechosos']*100:.0f}% de sus {int(r['total'])} proyectos "
                          f"({int(r['sospechosos'])}) tienen alta ejecución financiera con "
                          "baja meta física. Monto ejecutado: "
                          f"Q{r['monto_total_eje']:,.0f}."),
            })
        return results

    if variable == "concentracion_proveedor":
        if "proveedor" not in df_a.columns:
            return []
        df_con_prov = df_a[df_a["proveedor"].notna()].copy()
        tot_alc = df_con_prov.groupby("alcalde_ganador")["monto_adjudicado"].sum().rename("total_alc")
        prov_grp = (
            df_con_prov.groupby(["alcalde_ganador", "proveedor"])["monto_adjudicado"]
            .sum().rename("monto_prov").reset_index()
        )
        prov_grp = prov_grp.merge(tot_alc, on="alcalde_ganador")
        prov_grp["pct"] = prov_grp["monto_prov"] / prov_grp["total_alc"]
        idx = prov_grp.groupby("alcalde_ganador")["pct"].idxmax()
        best = prov_grp.loc[idx].sort_values("monto_prov", ascending=False).head(20)
        info_cols = ["alcalde_ganador", "municipio", "departamento"]
        if "siglas_ganadora" in df_a.columns:
            info_cols.append("siglas_ganadora")
        alc_info = df_a[info_cols].drop_duplicates("alcalde_ganador")
        best = best.merge(alc_info, on="alcalde_ganador", how="left")
        results = []
        for _, r in best.iterrows():
            results.append({
                "nombre": str(r["alcalde_ganador"]),
                "municipio": str(r.get("municipio", "—")),
                "departamento": str(r.get("departamento", "—")),
                "partido": str(r.get("siglas_ganadora", "—")),
                "monto_total": clean_value(r["total_alc"]),
                "razon": (f"El {r['pct']*100:.0f}% de su presupuesto adjudicado "
                          f"(Q{r['monto_prov']:,.0f} de Q{r['total_alc']:,.0f}) "
                          f"fue otorgado a un solo proveedor: '{r['proveedor']}'."),
            })
        return results

    if variable == "alta_adjudicacion_directa":
        DETAIL_COL = "compiledRelease/tender/procurementMethodDetails"
        df_ocds = df_a[df_a[DETAIL_COL].notna()].copy() if DETAIL_COL in df_a.columns else df_a.copy()
        if df_ocds.empty:
            return []
        grp = df_ocds.groupby("alcalde_ganador").agg(**_alcalde_agg(df_ocds)).reset_index()
        grp = grp[grp["total"] >= 2]
        grp["pct_directas"] = grp["directas"] / grp["total"]
        grp = grp[grp["directas"] >= 1].sort_values(
            ["pct_directas", "monto_total_adj"], ascending=[False, False]
        ).head(20)
        results = []
        for _, r in grp.iterrows():
            results.append({
                "nombre": str(r["alcalde_ganador"]),
                "municipio": str(r.get("municipio", "—")),
                "departamento": str(r.get("departamento", "—")),
                "partido": str(r.get("partido", "—")),
                "total_proyectos": int(r["total"]),
                "monto_total": clean_value(r["monto_total_adj"]),
                "razon": (f"{r['pct_directas']*100:.0f}% de sus {int(r['total'])} contratos con datos OCDS "
                          f"({int(r['directas'])}) fueron adjudicados vía Compra Directa o Caso de Excepción."),
            })
        return results

    return []


@app.post("/api/analysis/busqueda")
def analisis_busqueda(req: BusquedaRequest, _user: str = Depends(get_current_user)):
    df = get_df()
    df = apply_filter_request(df, req.filters)
    df = _add_risk_flags(df)

    if req.tipo == "proyectos":
        results = _busqueda_proyectos(df, req.variable)
    elif req.tipo == "proveedores":
        results = _busqueda_proveedores(df, req.variable)
    elif req.tipo == "alcaldes":
        results = _busqueda_alcaldes(df, req.variable)
    else:
        results = []

    return {"results": results[:20], "total": len(results)}


# ---------------------------------------------------------------------------
# Mapa de Gasto
# ---------------------------------------------------------------------------


@app.post("/api/analysis/mapa-gasto")
def mapa_gasto(body: FilterRequest, _user: str = Depends(get_current_user)):
    """Gasto total ejecutado y adjudicado por municipio (para mapa coroplético)."""
    df = apply_filter_request(get_df(), body)

    needed = [c for c in ["municipio", "departamento", "monto_ejecutado", "monto_adjudicado", "snip"] if c in df.columns]
    if not needed:
        return {"data": [], "total_ejecutado": 0, "total_adjudicado": 0}

    sub = df[needed].copy()

    mun_agg: dict[str, Any] = {}
    if "monto_ejecutado" in sub.columns:
        mun_agg["monto_ejecutado"] = ("monto_ejecutado", "sum")
    if "monto_adjudicado" in sub.columns:
        mun_agg["monto_adjudicado"] = ("monto_adjudicado", "sum")
    if "snip" in sub.columns:
        mun_agg["num_proyectos"] = ("snip", "count")

    grouped = (
        sub.groupby(["municipio", "departamento"], dropna=False)
        .agg(**mun_agg)
        .reset_index()
        .sort_values("monto_ejecutado", ascending=False)
    )

    records = []
    for _, row in grouped.iterrows():
        mun = row.get("municipio")
        dep = row.get("departamento")
        if pd.isna(mun) or not str(mun).strip():
            continue
        records.append({
            "municipio": str(mun),
            "departamento": str(dep) if not pd.isna(dep) else "—",
            "monto_ejecutado": clean_value(row.get("monto_ejecutado", 0)),
            "monto_adjudicado": clean_value(row.get("monto_adjudicado", 0)),
            "num_proyectos": int(row.get("num_proyectos", 0)),
        })

    total_ejecutado = clean_value(sub["monto_ejecutado"].sum()) if "monto_ejecutado" in sub.columns else 0
    total_adjudicado = clean_value(sub["monto_adjudicado"].sum()) if "monto_adjudicado" in sub.columns else 0

    return {
        "data": records,
        "total_ejecutado": total_ejecutado,
        "total_adjudicado": total_adjudicado,
    }


# ---------------------------------------------------------------------------
# Dev entry-point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
