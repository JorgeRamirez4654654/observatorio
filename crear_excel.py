import pandas as pd
import numpy as np
import xlsxwriter
import warnings
warnings.filterwarnings('ignore')

# ── Cargar y preparar datos ───────────────────────────────────────────────────
nog = pd.read_parquet('Data/nog_snip.parquet')
proj = pd.read_csv('Data/projects_clean.csv', dtype={'snip': str, 'compiledRelease/tender/id': str})

nog['nog_numero'] = nog['compiledRelease/tender/id'].str.extract(r'GT-NOG-(\d+)')
nog['snip_norm']  = nog['snip_number'].astype(str).str.strip().str.zfill(7)
proj['snip_norm'] = proj['snip'].astype(str).str.strip().str.zfill(7)

df = proj.merge(nog[['snip_norm','compiledRelease/tender/id','nog_numero']],
                on='snip_norm', how='left', suffixes=('','_nog'))
df['NOG_GuateCompras'] = df['nog_numero'].combine_first(
    df['compiledRelease/tender/id'].str.extract(r'GT-NOG-(\d+)')[0])

rename = {
    'snip':'SNIP_SEGEPLAN','proyecto':'Nombre_Proyecto','institucion':'Institucion',
    'unidad_ejecutora':'Unidad_Ejecutora','sector':'Sector',
    'sector_especifico':'Sector_Especifico','especie':'Tipo_Obra',
    'tipo_proyecto':'Tipo_Proyecto','municipio':'Municipio','departamento':'Departamento',
    'latitud':'Latitud','longitud':'Longitud','tiene_georeferenciacion':'Georeferenciado',
    'situacion_estado':'Estado_Proyecto','situacion_fecha':'Fecha_Estado',
    'opinion_resultado':'Opinion_SEGEPLAN','opinion_ejercicio':'Anio_Opinion',
    'etapa_actual':'Etapa_Actual','ejercicio':'Anio_Ejecucion',
    'alcalde_ganador':'Alcalde','siglas_ganadora':'Partido',
    'organizacion_ganadora':'Organizacion_Politica',
    'monto_solicitado':'Monto_Solicitado_GTQ','monto_inicial':'Monto_Inicial_GTQ',
    'monto_vigente':'Monto_Vigente_GTQ','monto_ejecutado':'Monto_Ejecutado_GTQ',
    'avance_financiero':'Avance_Financiero_Pct',
    'meta_fisica':'Meta_Fisica','meta_ejecutada':'Meta_Ejecutada',
    'unidad':'Unidad_Medida','avance_meta_anual':'Avance_Meta_Pct',
    'costo_por_unidad':'Costo_Por_Unidad_GTQ',
    'compiledRelease/awards/0/suppliers/0/name':'Proveedor',
    'compiledRelease/awards/0/suppliers/0/id':'Proveedor_ID',
    'compiledRelease/awards/0/value/amount':'Monto_Adjudicado_GTQ',
    'compiledRelease/awards/0/value/currency':'Moneda',
    'link':'Link_SEGEPLAN',
}
df = df.rename(columns=rename)

COLS = [
    # Identificadores
    'SNIP_SEGEPLAN','NOG_GuateCompras',
    # Proyecto
    'Nombre_Proyecto','Institucion','Unidad_Ejecutora',
    'Sector','Sector_Especifico','Tipo_Obra','Tipo_Proyecto',
    # Ubicación
    'Departamento','Municipio','Latitud','Longitud','Georeferenciado',
    # Estado
    'Estado_Proyecto','Etapa_Actual','Opinion_SEGEPLAN','Anio_Opinion','Fecha_Estado',
    # Finanzas
    'Monto_Solicitado_GTQ','Monto_Inicial_GTQ','Monto_Vigente_GTQ','Monto_Ejecutado_GTQ',
    'Avance_Financiero_Pct','Monto_Adjudicado_GTQ','Moneda',
    # Metas y ejecución física
    'Meta_Fisica','Meta_Ejecutada','Unidad_Medida','Avance_Meta_Pct','Costo_Por_Unidad_GTQ',
    # Político
    'Anio_Ejecucion','Alcalde','Partido','Organizacion_Politica',
    # Proveedor
    'Proveedor','Proveedor_ID','Link_SEGEPLAN',
]
COLS = [c for c in COLS if c in df.columns]
df = df[COLS].copy()

# Limpiar NaN strings
for c in df.select_dtypes('object').columns:
    df[c] = df[c].replace({'nan': None, 'None': None, '': None})

df_nog = df[df['NOG_GuateCompras'].notna()].copy()
df_all = pd.concat([df_nog, df[df['NOG_GuateCompras'].isna()]], ignore_index=True)

print(f"Proyectos totales SNIP : {len(df):,}")
print(f"Con NOG GuateCompras   : {len(df_nog):,}")

# ── Agregados para resumen ────────────────────────────────────────────────────
sector_g = df.groupby('Sector', dropna=False).agg(
    Proyectos=('SNIP_SEGEPLAN','count'),
    Con_NOG=('NOG_GuateCompras','count'),
    Monto_Solicitado=('Monto_Solicitado_GTQ','sum'),
    Monto_Vigente=('Monto_Vigente_GTQ','sum'),
    Monto_Ejecutado=('Monto_Ejecutado_GTQ','sum'),
    Avance_Fin_Prom=('Avance_Financiero_Pct','mean'),
    Monto_Adjudicado=('Monto_Adjudicado_GTQ','sum'),
    Meta_Fisica_Total=('Meta_Fisica','sum'),
    Meta_Ejecutada_Total=('Meta_Ejecutada','sum'),
).reset_index().sort_values('Proyectos', ascending=False)
sector_g['Sector'] = sector_g['Sector'].fillna('Sin clasificar')
sector_g['Cobertura_NOG_Pct'] = sector_g['Con_NOG'] / sector_g['Proyectos']
sector_g['Avance_Fin_Prom'] = sector_g['Avance_Fin_Prom'] / 100

depto_g = df.groupby('Departamento', dropna=False).agg(
    Proyectos=('SNIP_SEGEPLAN','count'),
    Municipios=('Municipio','nunique'),
    Monto_Vigente=('Monto_Vigente_GTQ','sum'),
    Monto_Ejecutado=('Monto_Ejecutado_GTQ','sum'),
    Avance_Fin_Prom=('Avance_Financiero_Pct','mean'),
    Con_NOG=('NOG_GuateCompras','count'),
).reset_index().sort_values('Monto_Vigente', ascending=False)
depto_g['Departamento'] = depto_g['Departamento'].fillna('Sin info')
depto_g['Avance_Fin_Prom'] = depto_g['Avance_Fin_Prom'] / 100

obra_g = df.groupby(['Tipo_Obra','Unidad_Medida'], dropna=False).agg(
    Proyectos=('SNIP_SEGEPLAN','count'),
    Meta_Fisica_Total=('Meta_Fisica','sum'),
    Meta_Ejecutada_Total=('Meta_Ejecutada','sum'),
    Avance_Meta_Prom=('Avance_Meta_Pct','mean'),
    Costo_Prom_Unidad=('Costo_Por_Unidad_GTQ','mean'),
).reset_index().sort_values('Proyectos', ascending=False).head(50)
obra_g['Tipo_Obra'] = obra_g['Tipo_Obra'].fillna('Sin clasificar')
obra_g['Avance_Meta_Prom'] = obra_g['Avance_Meta_Prom'] / 100

prov_g = df[df['Proveedor'].notna()].groupby(['Proveedor','Proveedor_ID'], dropna=False).agg(
    Contratos=('SNIP_SEGEPLAN','count'),
    Sectores=('Sector', lambda x: ' / '.join(sorted(x.dropna().unique())[:3])),
    SNIPs_Unicos=('SNIP_SEGEPLAN','nunique'),
    Monto_Adjudicado=('Monto_Adjudicado_GTQ','sum'),
    Monto_Ejecutado=('Monto_Ejecutado_GTQ','sum'),
    Departamentos=('Departamento', lambda x: x.dropna().nunique()),
).reset_index().sort_values('Monto_Adjudicado', ascending=False).head(100)

# ── Crear Excel con xlsxwriter ────────────────────────────────────────────────
OUTPUT = 'Data/observatorio_snip_guatecompras.xlsx'
writer = pd.ExcelWriter(OUTPUT, engine='xlsxwriter',
                        engine_kwargs={'options': {'nan_inf_to_errors': True}})
wb = writer.book

# ── Formatos ──────────────────────────────────────────────────────────────────
def fmt(props): return wb.add_format(props)

AZUL_O  = '#1F3864'
AZUL_M  = '#2E75B6'
AZUL_C  = '#BDD7EE'
VERDE_H = '#375623'
VERDE_C = '#E2EFDA'
NARANJA = '#C55A11'
CAFE    = '#833C00'
GRIS    = '#F2F2F2'
BLANCO  = '#FFFFFF'
GRIS_B  = '#404040'

BASE = {'font_name':'Arial','font_size':9,'border':1,'border_color':'#B0B0B0'}

h_azul_o  = fmt({**BASE,'bold':True,'font_color':BLANCO,'bg_color':AZUL_O,'align':'center','valign':'vcenter','font_size':10})
h_azul_m  = fmt({**BASE,'bold':True,'font_color':BLANCO,'bg_color':AZUL_M,'align':'center','valign':'vcenter'})
h_verde   = fmt({**BASE,'bold':True,'font_color':BLANCO,'bg_color':VERDE_H,'align':'center','valign':'vcenter'})
h_naranja = fmt({**BASE,'bold':True,'font_color':BLANCO,'bg_color':NARANJA,'align':'center','valign':'vcenter'})
h_cafe    = fmt({**BASE,'bold':True,'font_color':BLANCO,'bg_color':CAFE,'align':'center','valign':'vcenter'})
h_gris_b  = fmt({**BASE,'bold':True,'font_color':BLANCO,'bg_color':GRIS_B,'align':'center','valign':'vcenter'})

titulo_fmt = fmt({'bold':True,'font_name':'Arial','font_size':13,'font_color':BLANCO,
                  'bg_color':AZUL_O,'align':'center','valign':'vcenter'})
sub_fmt    = fmt({'italic':True,'font_name':'Arial','font_size':10,'font_color':'#595959',
                  'bg_color':AZUL_C,'align':'center','valign':'vcenter'})

def row_fmt(bg, align='left', num_fmt=None):
    f = {**BASE,'bg_color':bg,'align':align,'valign':'vcenter'}
    if num_fmt: f['num_format'] = num_fmt
    return fmt(f)

f_txt_w  = row_fmt(BLANCO)
f_txt_g  = row_fmt(GRIS)
f_num_w  = row_fmt(BLANCO, 'right', '#,##0')
f_num_g  = row_fmt(GRIS,   'right', '#,##0')
f_pct_w  = row_fmt(BLANCO, 'right', '0.0%')
f_pct_g  = row_fmt(GRIS,   'right', '0.0%')
f_dec_w  = row_fmt(BLANCO, 'right', '#,##0.0')
f_dec_g  = row_fmt(GRIS,   'right', '#,##0.0')
f_url_w  = fmt({**BASE,'bg_color':BLANCO,'font_color':'#0563C1','underline':True})
f_url_g  = fmt({**BASE,'bg_color':GRIS,  'font_color':'#0563C1','underline':True})

# Verde para filas pares en hojas de resumen
f_txt_vc = row_fmt(VERDE_C)
f_num_vc = row_fmt(VERDE_C, 'right', '#,##0')
f_pct_vc = row_fmt(VERDE_C, 'right', '0.0%')
f_txt_ac = row_fmt(AZUL_C)
f_num_ac = row_fmt(AZUL_C, 'right', '#,##0')
f_pct_ac = row_fmt(AZUL_C, 'right', '0.0%')
f_txt_yo = row_fmt('#FFF2CC')
f_num_yo = row_fmt('#FFF2CC', 'right', '#,##0')
f_pct_yo = row_fmt('#FFF2CC', 'right', '0.0%')
f_dec_yo = row_fmt('#FFF2CC', 'right', '#,##0.0')

bold_w = fmt({'bold':True,'font_name':'Arial','font_size':10,'font_color':BLANCO,'bg_color':AZUL_O,'border':1,'num_format':'#,##0','align':'right','valign':'vcenter'})
bold_pct= fmt({'bold':True,'font_name':'Arial','font_size':10,'font_color':BLANCO,'bg_color':AZUL_O,'border':1,'num_format':'0.0%','align':'right','valign':'vcenter'})

# ══════════════════════════════════════════════════════════════════════════════
# HOJA 1: RESUMEN EJECUTIVO
# ══════════════════════════════════════════════════════════════════════════════
print("Hoja 1: Resumen Ejecutivo...")
ws1 = wb.add_worksheet('Resumen Ejecutivo')
ws1.hide_gridlines(2)
ws1.set_zoom(90)

ws1.set_column('A:A', 30)
ws1.set_column('B:B', 14)
ws1.set_column('C:C', 14)
ws1.set_column('D:D', 20)
ws1.set_column('E:E', 20)
ws1.set_column('F:F', 16)
ws1.set_column('G:G', 18)
ws1.set_column('H:H', 18)
ws1.set_column('I:I', 14)

ws1.set_row(0, 36)
ws1.set_row(1, 20)
ws1.merge_range('A1:I1', 'OBSERVATORIO DE INVERSIÓN PÚBLICA — SNIP × GUATECOMPRAS', titulo_fmt)
ws1.merge_range('A2:I2', 'Cruce de datos: Portal SNIP (SEGEPLAN) + GuateCompras OCDS  |  Fuente pública de Guatemala', sub_fmt)

# KPIs
kpi_hdr = fmt({'bold':True,'font_name':'Arial','font_size':9,'font_color':BLANCO,'bg_color':AZUL_O,'align':'center','valign':'vcenter','border':1})
kpi_val = fmt({'bold':True,'font_name':'Arial','font_size':14,'font_color':AZUL_O,'bg_color':BLANCO,'align':'center','valign':'vcenter','border':1,'num_format':'#,##0'})
kpi_val_v= fmt({'bold':True,'font_name':'Arial','font_size':14,'font_color':VERDE_H,'bg_color':BLANCO,'align':'center','valign':'vcenter','border':1,'num_format':'#,##0'})
kpi_val_p= fmt({'bold':True,'font_name':'Arial','font_size':14,'font_color':VERDE_H,'bg_color':BLANCO,'align':'center','valign':'vcenter','border':1,'num_format':'0.0%'})

ws1.set_row(3, 20); ws1.set_row(4, 32); ws1.set_row(5, 20); ws1.set_row(6, 32)

kpis1 = [('Total Proyectos SNIP', len(df)), ('Con NOG GuateCompras', len(df_nog)),
         ('Sin NOG (solo SNIP)', len(df)-len(df_nog)), ('Departamentos', df['Departamento'].nunique())]
ws1.merge_range('A4:D4', 'COBERTURA DEL DATASET', h_azul_o)
for i, (lbl, val) in enumerate(kpis1):
    ws1.write(4, i, lbl, kpi_hdr); ws1.write(5, i, val, kpi_val)

total_vigente   = df['Monto_Vigente_GTQ'].sum()
total_ejecutado = df['Monto_Ejecutado_GTQ'].sum()
total_adj       = df['Monto_Adjudicado_GTQ'].sum()
avance_prom     = df['Avance_Financiero_Pct'].mean() / 100

kpis2 = [('Monto Vigente Total (GTQ)', total_vigente, kpi_val_v),
         ('Monto Ejecutado Total (GTQ)', total_ejecutado, kpi_val_v),
         ('Monto Adjudicado GC (GTQ)', total_adj, kpi_val_v),
         ('Avance Financiero Promedio', avance_prom, kpi_val_p)]
ws1.merge_range('E4:I4', 'RESUMEN FINANCIERO (GTQ)', h_verde)
for i, (lbl, val, vfmt) in enumerate(kpis2):
    ws1.write(4, i+4, lbl, kpi_hdr); ws1.write(5, i+4, val, vfmt)

# Tabla sector
row = 7
ws1.set_row(row, 22); ws1.set_row(row+1, 30)
ws1.merge_range(row, 0, row, 8, 'PROYECTOS POR SECTOR', h_azul_o)
sec_hdrs = ['Sector','Proyectos','Con NOG\nGuateCompras','Monto Solicitado\n(GTQ)',
            'Monto Vigente\n(GTQ)','Monto Ejecutado\n(GTQ)','Avance Fin.\nPromedio',
            'Monto Adjudicado\nGuateCompras (GTQ)','Cobertura NOG %']
sec_fmts_h = [h_azul_m]*1 + [h_azul_m]*8
for i, h in enumerate(sec_hdrs):
    ws1.write(row+1, i, h, h_azul_m)

for ri, (_, rw) in enumerate(sector_g.iterrows()):
    r = row + 2 + ri
    bg_t, bg_n, bg_p = (VERDE_C,VERDE_C,VERDE_C) if ri%2==0 else (BLANCO,BLANCO,BLANCO)
    ft = row_fmt(bg_t); fn = row_fmt(bg_n,'right','#,##0'); fp = row_fmt(bg_p,'right','0.0%')
    ws1.set_row(r, 16)
    ws1.write(r, 0, rw['Sector'], ft)
    ws1.write(r, 1, int(rw['Proyectos']), fn)
    ws1.write(r, 2, int(rw['Con_NOG']), fn)
    ws1.write(r, 3, rw['Monto_Solicitado'] if rw['Monto_Solicitado'] else None, fn)
    ws1.write(r, 4, rw['Monto_Vigente'] if rw['Monto_Vigente'] else None, fn)
    ws1.write(r, 5, rw['Monto_Ejecutado'] if rw['Monto_Ejecutado'] else None, fn)
    ws1.write(r, 6, rw['Avance_Fin_Prom'] if pd.notna(rw['Avance_Fin_Prom']) else None, fp)
    ws1.write(r, 7, rw['Monto_Adjudicado'] if rw['Monto_Adjudicado'] else None, fn)
    ws1.write(r, 8, rw['Cobertura_NOG_Pct'] if pd.notna(rw['Cobertura_NOG_Pct']) else None, fp)

# Tabla departamentos
row2 = row + 2 + len(sector_g) + 1
ws1.set_row(row2, 22); ws1.set_row(row2+1, 28)
ws1.merge_range(row2, 0, row2, 5, 'TOP DEPARTAMENTOS POR MONTO VIGENTE', h_azul_o)
dep_hdrs = ['Departamento','Proyectos','Municipios','Monto Vigente (GTQ)','Monto Ejecutado (GTQ)','Avance Fin. Prom.']
for i, h in enumerate(dep_hdrs):
    ws1.write(row2+1, i, h, h_azul_m)
for ri, (_, rw) in enumerate(depto_g.iterrows()):
    r = row2 + 2 + ri
    bg = AZUL_C if ri%2==0 else BLANCO
    ft = row_fmt(bg); fn = row_fmt(bg,'right','#,##0'); fp = row_fmt(bg,'right','0.0%')
    ws1.set_row(r, 16)
    ws1.write(r,0,rw['Departamento'],ft); ws1.write(r,1,int(rw['Proyectos']),fn)
    ws1.write(r,2,int(rw['Municipios']),fn)
    ws1.write(r,3,rw['Monto_Vigente'] or None,fn)
    ws1.write(r,4,rw['Monto_Ejecutado'] or None,fn)
    ws1.write(r,5,rw['Avance_Fin_Prom'] if pd.notna(rw['Avance_Fin_Prom']) else None,fp)

# ══════════════════════════════════════════════════════════════════════════════
# HOJA 2: DATOS COMPLETOS
# ══════════════════════════════════════════════════════════════════════════════
print("Hoja 2: Datos completos (esto puede tardar un momento)...")

# Secciones de columnas con colores
SECCIONES = [
    (['SNIP_SEGEPLAN','NOG_GuateCompras'], 'IDENTIFICADORES', AZUL_O),
    (['Nombre_Proyecto','Institucion','Unidad_Ejecutora','Sector','Sector_Especifico','Tipo_Obra','Tipo_Proyecto'], 'PROYECTO', AZUL_M),
    (['Departamento','Municipio','Latitud','Longitud','Georeferenciado'], 'UBICACIÓN', '#5B9BD5'),
    (['Estado_Proyecto','Etapa_Actual','Opinion_SEGEPLAN','Anio_Opinion','Fecha_Estado'], 'ESTADO', '#7030A0'),
    (['Monto_Solicitado_GTQ','Monto_Inicial_GTQ','Monto_Vigente_GTQ','Monto_Ejecutado_GTQ','Avance_Financiero_Pct','Monto_Adjudicado_GTQ','Moneda'], 'FINANZAS (GTQ)', VERDE_H),
    (['Meta_Fisica','Meta_Ejecutada','Unidad_Medida','Avance_Meta_Pct','Costo_Por_Unidad_GTQ'], 'METAS Y EJECUCIÓN FÍSICA', CAFE),
    (['Anio_Ejecucion','Alcalde','Partido','Organizacion_Politica'], 'CONTEXTO POLÍTICO', NARANJA),
    (['Proveedor','Proveedor_ID','Link_SEGEPLAN'], 'PROVEEDOR / CONTRATO', GRIS_B),
]

NUM_COLS = {'Monto_Solicitado_GTQ','Monto_Inicial_GTQ','Monto_Vigente_GTQ','Monto_Ejecutado_GTQ',
            'Monto_Adjudicado_GTQ','Costo_Por_Unidad_GTQ','Meta_Fisica','Meta_Ejecutada','Anio_Ejecucion','Anio_Opinion'}
PCT_COLS  = {'Avance_Financiero_Pct','Avance_Meta_Pct'}
DEC_COLS  = {'Latitud','Longitud'}

ws2 = wb.add_worksheet('Datos_SNIP_GuateCompras')
ws2.hide_gridlines(2)
ws2.freeze_panes(3, 2)
ws2.set_zoom(85)

# Título
n_cols = len(COLS)
ws2.merge_range(0, 0, 0, n_cols-1,
    f'PROYECTOS SNIP × GUATECOMPRAS  |  {len(df_nog):,} con NOG  |  {len(df):,} proyectos SNIP total',
    titulo_fmt)
ws2.set_row(0, 26)

# Headers sección (fila 2) + columna (fila 3)
col_idx = 0
col_sec_color = {}
for sec_cols, sec_label, sec_color in SECCIONES:
    actual = [c for c in sec_cols if c in COLS]
    if not actual: continue
    hfmt = fmt({'bold':True,'font_name':'Arial','font_size':9,'font_color':BLANCO,
                'bg_color':sec_color,'align':'center','valign':'vcenter','border':1})
    if len(actual) > 1:
        ws2.merge_range(1, col_idx, 1, col_idx+len(actual)-1, sec_label, hfmt)
    else:
        ws2.write(1, col_idx, sec_label, hfmt)
    for c in actual:
        col_sec_color[col_idx] = sec_color
        col_idx += 1
ws2.set_row(1, 20)

FRIENDLY = {
    'SNIP_SEGEPLAN':'SNIP (SEGEPLAN)','NOG_GuateCompras':'NOG (GuateCompras)',
    'Nombre_Proyecto':'Nombre del Proyecto','Institucion':'Institución',
    'Unidad_Ejecutora':'Unidad Ejecutora','Sector':'Sector',
    'Sector_Especifico':'Sector Específico','Tipo_Obra':'Tipo de Obra',
    'Tipo_Proyecto':'Tipo Proyecto','Departamento':'Departamento',
    'Municipio':'Municipio','Latitud':'Latitud','Longitud':'Longitud',
    'Georeferenciado':'Georeferenciado','Estado_Proyecto':'Estado',
    'Etapa_Actual':'Etapa Actual','Opinion_SEGEPLAN':'Opinión SEGEPLAN',
    'Anio_Opinion':'Año Opinión','Fecha_Estado':'Fecha Estado',
    'Monto_Solicitado_GTQ':'Monto Solicitado (GTQ)','Monto_Inicial_GTQ':'Monto Inicial (GTQ)',
    'Monto_Vigente_GTQ':'Monto Vigente (GTQ)','Monto_Ejecutado_GTQ':'Monto Ejecutado (GTQ)',
    'Avance_Financiero_Pct':'Avance Financiero %','Monto_Adjudicado_GTQ':'Monto Adjudicado GC (GTQ)',
    'Moneda':'Moneda','Meta_Fisica':'Meta Física','Meta_Ejecutada':'Meta Ejecutada',
    'Unidad_Medida':'Unidad de Medida','Avance_Meta_Pct':'Avance Meta %',
    'Costo_Por_Unidad_GTQ':'Costo por Unidad (GTQ)','Anio_Ejecucion':'Año Ejecución',
    'Alcalde':'Alcalde','Partido':'Partido','Organizacion_Politica':'Organización Política',
    'Proveedor':'Proveedor','Proveedor_ID':'ID Proveedor','Link_SEGEPLAN':'Link SEGEPLAN',
}

COL_WIDTHS = {
    'SNIP_SEGEPLAN':12,'NOG_GuateCompras':16,'Nombre_Proyecto':48,
    'Institucion':28,'Unidad_Ejecutora':28,'Sector':22,'Sector_Especifico':18,
    'Tipo_Obra':30,'Tipo_Proyecto':14,'Departamento':18,'Municipio':20,
    'Latitud':12,'Longitud':12,'Georeferenciado':14,'Estado_Proyecto':16,
    'Etapa_Actual':18,'Opinion_SEGEPLAN':22,'Anio_Opinion':12,'Fecha_Estado':14,
    'Monto_Solicitado_GTQ':20,'Monto_Inicial_GTQ':18,'Monto_Vigente_GTQ':18,
    'Monto_Ejecutado_GTQ':18,'Avance_Financiero_Pct':16,'Monto_Adjudicado_GTQ':22,
    'Moneda':10,'Meta_Fisica':14,'Meta_Ejecutada':16,'Unidad_Medida':16,
    'Avance_Meta_Pct':14,'Costo_Por_Unidad_GTQ':18,'Anio_Ejecucion':12,
    'Alcalde':24,'Partido':10,'Organizacion_Politica':26,'Proveedor':38,
    'Proveedor_ID':20,'Link_SEGEPLAN':18,
}

for ci, col in enumerate(COLS):
    sc = col_sec_color.get(ci, AZUL_M)
    hfmt = fmt({'bold':True,'font_name':'Arial','font_size':9,'font_color':BLANCO,
                'bg_color':sc,'align':'center','valign':'vcenter','border':1,'text_wrap':True})
    ws2.write(2, ci, FRIENDLY.get(col, col), hfmt)
    ws2.set_column(ci, ci, COL_WIDTHS.get(col, 14))
ws2.set_row(2, 30)

# Datos — usar write_row para máxima velocidad
print("  Escribiendo filas de datos...")
url_fmt_w = fmt({'font_name':'Arial','font_size':9,'font_color':'#0563C1','underline':True,'bg_color':BLANCO,'border':1})
url_fmt_g = fmt({'font_name':'Arial','font_size':9,'font_color':'#0563C1','underline':True,'bg_color':GRIS,'border':1})

for ri, (_, row_data) in enumerate(df_all.iterrows()):
    r = ri + 3
    is_even = ri % 2 == 0
    bg = GRIS if is_even else BLANCO

    ft  = row_fmt(bg, 'left')
    fn  = row_fmt(bg, 'right', '#,##0')
    fp  = row_fmt(bg, 'right', '0.0%')
    fdec= row_fmt(bg, 'right', '0.000000')
    furl= url_fmt_g if is_even else url_fmt_w

    for ci, col in enumerate(COLS):
        val = row_data.get(col)
        if val is None or (isinstance(val, float) and np.isnan(val)):
            ws2.write_blank(r, ci, None, ft)
        elif col in PCT_COLS:
            ws2.write_number(r, ci, float(val)/100 if val else 0, fp)
        elif col in NUM_COLS:
            ws2.write_number(r, ci, float(val) if val else 0, fn)
        elif col in DEC_COLS:
            ws2.write_number(r, ci, float(val), fdec)
        elif col == 'Link_SEGEPLAN':
            ws2.write_url(r, ci, str(val), furl, 'Ver SNIP')
        elif col == 'Georeferenciado':
            ws2.write(r, ci, 'Sí' if val else 'No', ft)
        else:
            ws2.write(r, ci, str(val) if val is not None else None, ft)

    if ri % 10000 == 0:
        print(f"  {ri:,}/{len(df_all):,} filas...")

ws2.autofilter(2, 0, 2+len(df_all), len(COLS)-1)

# ══════════════════════════════════════════════════════════════════════════════
# HOJA 3: ANÁLISIS FINANCIERO
# ══════════════════════════════════════════════════════════════════════════════
print("Hoja 3: Análisis Financiero...")
ws3 = wb.add_worksheet('Analisis_Financiero')
ws3.hide_gridlines(2)
ws3.set_column('A:A', 30); ws3.set_column('B:B', 12); ws3.set_column('C:C', 12)
ws3.set_column('D:H', 20); ws3.set_column('I:K', 16)

ws3.set_row(0, 30)
ws3.merge_range('A1:K1', 'ANÁLISIS FINANCIERO — SNIP × GUATECOMPRAS', fmt({'bold':True,'font_name':'Arial','font_size':13,'font_color':BLANCO,'bg_color':VERDE_H,'align':'center','valign':'vcenter'}))

# Por sector
ws3.set_row(2, 22); ws3.set_row(3, 30)
ws3.merge_range('A3:K3', 'FINANZAS POR SECTOR', h_verde)
f_hdrs = ['Sector','Proyectos','Con NOG','Monto Solicitado (GTQ)','Monto Vigente (GTQ)',
          'Monto Ejecutado (GTQ)','Avance Fin. Prom.','Monto Adjudicado GC (GTQ)',
          'Meta Física Total','Meta Ejecutada Total','Cobertura NOG %']
for i, h in enumerate(f_hdrs): ws3.write(3, i, h, h_verde)

for ri, (_, rw) in enumerate(sector_g.iterrows()):
    r = 4 + ri
    bg = VERDE_C if ri%2==0 else BLANCO
    ft=row_fmt(bg); fn=row_fmt(bg,'right','#,##0'); fp=row_fmt(bg,'right','0.0%')
    fd=row_fmt(bg,'right','#,##0.0')
    ws3.set_row(r, 16)
    ws3.write(r,0,rw['Sector'],ft); ws3.write(r,1,int(rw['Proyectos']),fn)
    ws3.write(r,2,int(rw['Con_NOG']),fn)
    ws3.write(r,3,rw['Monto_Solicitado'] or None,fn)
    ws3.write(r,4,rw['Monto_Vigente'] or None,fn)
    ws3.write(r,5,rw['Monto_Ejecutado'] or None,fn)
    ws3.write(r,6,rw['Avance_Fin_Prom'] if pd.notna(rw['Avance_Fin_Prom']) else None,fp)
    ws3.write(r,7,rw['Monto_Adjudicado'] or None,fn)
    ws3.write(r,8,rw['Meta_Fisica_Total'] or None,fd)
    ws3.write(r,9,rw['Meta_Ejecutada_Total'] or None,fd)
    ws3.write(r,10,rw['Cobertura_NOG_Pct'] if pd.notna(rw['Cobertura_NOG_Pct']) else None,fp)

# Fila total
r_tot = 4 + len(sector_g)
ws3.set_row(r_tot, 20)
tot_fmt = fmt({'bold':True,'font_name':'Arial','font_size':10,'font_color':BLANCO,'bg_color':AZUL_O,'border':1,'num_format':'#,##0','align':'right','valign':'vcenter'})
tot_txt = fmt({'bold':True,'font_name':'Arial','font_size':10,'font_color':BLANCO,'bg_color':AZUL_O,'border':1,'align':'left','valign':'vcenter'})
ws3.write(r_tot,0,'TOTAL',tot_txt)
ws3.write(r_tot,1,int(sector_g['Proyectos'].sum()),tot_fmt)
ws3.write(r_tot,2,int(sector_g['Con_NOG'].sum()),tot_fmt)
ws3.write(r_tot,3,sector_g['Monto_Solicitado'].sum(),tot_fmt)
ws3.write(r_tot,4,sector_g['Monto_Vigente'].sum(),tot_fmt)
ws3.write(r_tot,5,sector_g['Monto_Ejecutado'].sum(),tot_fmt)
pct_fmt_tot=fmt({'bold':True,'font_name':'Arial','font_size':10,'font_color':BLANCO,'bg_color':AZUL_O,'border':1,'num_format':'0.0%','align':'right','valign':'vcenter'})
ws3.write(r_tot,6,sector_g['Avance_Fin_Prom'].mean(),pct_fmt_tot)
ws3.write(r_tot,7,sector_g['Monto_Adjudicado'].sum(),tot_fmt)

# Por departamento
row_d = r_tot + 2
ws3.set_row(row_d, 22); ws3.set_row(row_d+1, 28)
ws3.merge_range(row_d, 0, row_d, 6, 'FINANZAS POR DEPARTAMENTO', h_azul_o)
dep_hdrs2 = ['Departamento','Proyectos','Municipios','Monto Vigente (GTQ)','Monto Ejecutado (GTQ)','Avance Fin. Prom.','Con NOG']
for i, h in enumerate(dep_hdrs2): ws3.write(row_d+1, i, h, h_azul_m)
for ri, (_, rw) in enumerate(depto_g.iterrows()):
    r = row_d + 2 + ri
    bg = AZUL_C if ri%2==0 else BLANCO
    ft=row_fmt(bg); fn=row_fmt(bg,'right','#,##0'); fp=row_fmt(bg,'right','0.0%')
    ws3.set_row(r, 16)
    ws3.write(r,0,rw['Departamento'],ft); ws3.write(r,1,int(rw['Proyectos']),fn)
    ws3.write(r,2,int(rw['Municipios']),fn)
    ws3.write(r,3,rw['Monto_Vigente'] or None,fn)
    ws3.write(r,4,rw['Monto_Ejecutado'] or None,fn)
    ws3.write(r,5,rw['Avance_Fin_Prom'] if pd.notna(rw['Avance_Fin_Prom']) else None,fp)
    ws3.write(r,6,int(rw['Con_NOG']),fn)

# ══════════════════════════════════════════════════════════════════════════════
# HOJA 4: METAS Y EJECUCIÓN FÍSICA
# ══════════════════════════════════════════════════════════════════════════════
print("Hoja 4: Metas y Ejecución Física...")
ws4 = wb.add_worksheet('Metas_Ejecucion_Fisica')
ws4.hide_gridlines(2)
ws4.set_column('A:A', 38); ws4.set_column('B:B', 12); ws4.set_column('C:C', 16)
ws4.set_column('D:E', 18); ws4.set_column('F:G', 16); ws4.set_column('H:H', 20)
ws4.set_row(0, 30)
ws4.merge_range('A1:H1', 'METAS Y EJECUCIÓN FÍSICA — Por Tipo de Obra', fmt({'bold':True,'font_name':'Arial','font_size':13,'font_color':BLANCO,'bg_color':CAFE,'align':'center','valign':'vcenter'}))
ws4.set_row(2, 22); ws4.set_row(3, 30)
ws4.merge_range('A3:H3', 'EJECUCIÓN FÍSICA POR TIPO DE OBRA (Top 50)', h_cafe)
ob_hdrs = ['Tipo de Obra','Proyectos','Unidad de Medida','Meta Física Total',
           'Meta Ejecutada Total','Avance Meta Prom.','Costo Prom. por Unidad (GTQ)','Estado Predominante']
for i, h in enumerate(ob_hdrs): ws4.write(3, i, h, h_cafe)
for ri, (_, rw) in enumerate(obra_g.iterrows()):
    r = 4 + ri
    bg = '#FFF2CC' if ri%2==0 else BLANCO
    ft=row_fmt(bg); fn=row_fmt(bg,'right','#,##0'); fp=row_fmt(bg,'right','0.0%'); fd=row_fmt(bg,'right','#,##0.0')
    ws4.set_row(r, 16)
    ws4.write(r,0,rw['Tipo_Obra'],ft); ws4.write(r,1,int(rw['Proyectos']),fn)
    ws4.write(r,2,rw['Unidad_Medida'] if pd.notna(rw['Unidad_Medida']) else '-',ft)
    ws4.write(r,3,rw['Meta_Fisica_Total'] if pd.notna(rw['Meta_Fisica_Total']) else None,fd)
    ws4.write(r,4,rw['Meta_Ejecutada_Total'] if pd.notna(rw['Meta_Ejecutada_Total']) else None,fd)
    ws4.write(r,5,rw['Avance_Meta_Prom'] if pd.notna(rw['Avance_Meta_Prom']) else None,fp)
    ws4.write(r,6,rw['Costo_Prom_Unidad'] if pd.notna(rw['Costo_Prom_Unidad']) else None,fn)
    ws4.write(r,7, '-', ft)

# ══════════════════════════════════════════════════════════════════════════════
# HOJA 5: PROVEEDORES
# ══════════════════════════════════════════════════════════════════════════════
print("Hoja 5: Proveedores...")
ws5 = wb.add_worksheet('Proveedores_GuateCompras')
ws5.hide_gridlines(2)
ws5.set_column('A:A', 48); ws5.set_column('B:B', 22); ws5.set_column('C:D', 12)
ws5.set_column('E:F', 22); ws5.set_column('G:G', 14); ws5.set_column('H:H', 14)
ws5.set_row(0, 30)
ws5.merge_range('A1:H1', 'TOP 100 PROVEEDORES — PROYECTOS SNIP EN GUATECOMPRAS', fmt({'bold':True,'font_name':'Arial','font_size':13,'font_color':BLANCO,'bg_color':GRIS_B,'align':'center','valign':'vcenter'}))
ws5.set_row(2, 22); ws5.set_row(3, 30)
ws5.merge_range('A3:H3', 'RANKING POR MONTO ADJUDICADO (Top 100)', h_gris_b)
p_hdrs = ['Proveedor','ID Proveedor','Contratos','Proyectos SNIP Únicos','Monto Adjudicado (GTQ)','Monto Ejecutado (GTQ)','Departamentos','Sectores']
for i, h in enumerate(p_hdrs): ws5.write(3, i, h, h_gris_b)
for ri, (_, rw) in enumerate(prov_g.iterrows()):
    r = 4 + ri
    bg = GRIS if ri%2==0 else BLANCO
    ft=row_fmt(bg); fn=row_fmt(bg,'right','#,##0')
    ws5.set_row(r, 16)
    ws5.write(r,0,rw['Proveedor'],ft); ws5.write(r,1,rw['Proveedor_ID'] if pd.notna(rw['Proveedor_ID']) else '-',ft)
    ws5.write(r,2,int(rw['Contratos']),fn); ws5.write(r,3,int(rw['SNIPs_Unicos']),fn)
    ws5.write(r,4,rw['Monto_Adjudicado'] or None,fn)
    ws5.write(r,5,rw['Monto_Ejecutado'] or None,fn)
    ws5.write(r,6,int(rw['Departamentos']),fn)
    ws5.write(r,7,rw['Sectores'] if pd.notna(rw['Sectores']) else '-',ft)

# ── Guardar ───────────────────────────────────────────────────────────────────
print(f"\nGuardando {OUTPUT}...")
writer.close()
print(f"✅ Listo: {OUTPUT}")
import os
size = os.path.getsize(OUTPUT) / (1024*1024)
print(f"   Tamaño: {size:.1f} MB")
print(f"   Hojas: Resumen Ejecutivo | Datos_SNIP_GuateCompras | Analisis_Financiero | Metas_Ejecucion_Fisica | Proveedores_GuateCompras")
