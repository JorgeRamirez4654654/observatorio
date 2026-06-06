"""
Pipeline automático OBS: GuateCompras → NOG-SNIP → Scraping → Preprocessing

Uso:
    python pipeline.py

Pasos:
    1. datos_guatecompras.py  — descarga nuevos meses de GuateCompras OCDS
    2. match_nog_snip.py      — extrae números SNIP desde los PDFs de boletas
    3. web_scraping_snip.py   — scrapea proyectos nuevos + refresca no finalizados
    4. preprocessing.py       — produce snip_proyectos_clean.csv/.parquet para la app
"""

import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

DIR = Path(__file__).parent
PROGRESS_FILE = DIR / "Data" / "pipeline_progress.json"

PASOS = [
    ("Descarga GuateCompras", "datos_guatecompras.py"),
    ("Enlace NOG → SNIP",     "match_nog_snip.py"),
    ("Scraping SNIP",         "web_scraping_snip.py"),
    ("Preprocesamiento",      "preprocessing.py"),
]


def _write_progress(steps: list, current_idx: int, started_at: str, finished: bool = False) -> None:
    try:
        PROGRESS_FILE.write_text(
            json.dumps({
                "started_at": started_at,
                "current_step": current_idx,
                "total_steps": len(PASOS),
                "finished": finished,
                "updated_at": datetime.now().isoformat(),
                "steps": steps,
            }, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass


def run_step(nombre: str, script: str, steps: list, idx: int, started_at: str) -> bool:
    print(f"\n{'='*65}")
    print(f"  PASO: {nombre}")
    print(f"  Inicio: {datetime.now().strftime('%H:%M:%S')}")
    print(f"{'='*65}\n")

    steps[idx]["status"] = "running"
    steps[idx]["started_at"] = datetime.now().isoformat()
    _write_progress(steps, idx, started_at)

    t0 = time.time()
    result = subprocess.run([sys.executable, script], cwd=DIR)
    elapsed = time.time() - t0

    ok = result.returncode == 0
    steps[idx]["status"] = "done" if ok else "failed"
    steps[idx]["elapsed"] = round(elapsed, 1)
    _write_progress(steps, idx + 1, started_at)

    print(f"\n{'✅ OK' if ok else f'❌ FALLÓ (código {result.returncode})'}  —  {elapsed:.1f}s")
    return ok


def main():
    print("\n" + "=" * 65)
    print("  PIPELINE OBS — Actualización Automática")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 65)

    started_at = datetime.now().isoformat()
    steps = [{"name": nombre, "status": "pending", "elapsed": None} for nombre, _ in PASOS]
    _write_progress(steps, 0, started_at)

    resultados = []
    for idx, (nombre, script) in enumerate(PASOS):
        ok = run_step(nombre, script, steps, idx, started_at)
        resultados.append((nombre, ok))
        if not ok:
            print(f"\n⚠️  Pipeline detenido en: {nombre}")
            break

    _write_progress(steps, len(resultados), started_at, finished=True)

    print("\n" + "=" * 65)
    print("  RESUMEN")
    print("=" * 65)
    for nombre, ok in resultados:
        print(f"  {'✅' if ok else '❌'}  {nombre}")

    todos_ok = all(ok for _, ok in resultados)
    if todos_ok:
        print(f"\n✅ Pipeline completado — {datetime.now().strftime('%H:%M:%S')}")
    else:
        print("\n❌ Pipeline terminó con errores.")
        sys.exit(1)


if __name__ == "__main__":
    main()
