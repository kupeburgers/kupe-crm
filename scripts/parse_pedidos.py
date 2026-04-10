#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Parse all pedidos pendiente Excel files and produce analysis + CSV output.
V2.1 — reglas de negocio corregidas:
  - producto_favorito: excluye bebidas, papas, nuggets; desempate por recencia
  - ultimo_producto: prioridad burger > combo > bebida dentro del último pedido
  - Nuevos campos: ultimo_producto, fecha_ultimo_pedido, perfil_actualizado_at
  - Resumen de calidad al final
"""

import sys
import re
import pandas as pd
from collections import Counter
from pathlib import Path
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR   = Path(r"C:\Users\kupeb\OneDrive\Escritorio\supabase crm\datos\pedidos")
OUTPUT_CSV = Path(r"C:\Users\kupeb\OneDrive\Escritorio\supabase crm\datos\cliente_perfil_productos.csv")

# Auto-descubre todos los Excel de la carpeta — no hay que editar esta lista
# cuando llegan archivos nuevos, solo copiarlos a la carpeta y correr el script
FILES = sorted(BASE_DIR.glob("*.xlsx"))

# ── Clasificación de productos ──────────────────────────────────────────────
BEBIDAS_PREFIJOS = ('COCA', 'SPRITE')
OTROS_EXACTOS    = {'PORCION PAPAS EXTRAS SOLAS', 'NUGGETS'}
COMBO_SEÑALES    = ('COMBO', 'KUPE EN CASA', 'TRIPLE STACK')
COMBO_CONTIENE   = ('2X1', '50%')

def categorizar(producto):
    """Clasifica un producto en: burger | combo | bebida | otro"""
    p = producto.upper().strip()
    if p in OTROS_EXACTOS:
        return 'otro'
    if any(p.startswith(b) for b in BEBIDAS_PREFIJOS):
        return 'bebida'
    if any(p.startswith(s) for s in COMBO_SEÑALES):
        return 'combo'
    if any(s in p for s in COMBO_CONTIENE):
        return 'combo'
    return 'burger'  # todo lo demás: burgers, chicken, vegetariana, etc.

PRIORIDAD_CAT = {'burger': 0, 'combo': 1, 'bebida': 2, 'otro': 3}

# ── Known pan types (lowercase for matching) ────────────────────────────────
PAN_TYPES = [
    "pan de papa",
    "pan parmesano",
    "pan brioche",
    "pan de campo",
    "pan integral",
    "pan negro",
    "pan clasico",
    "pan clásico",
]

def extract_phone(text):
    numbers = re.findall(r'\b\d{10,11}\b', text)
    if numbers:
        return numbers[-1]
    numbers = re.findall(r'\d{10,}', text.replace(' ', ''))
    if numbers:
        return numbers[-1][-11:]
    return None

def extract_nombre(text):
    rest = re.sub(r'^Cliente:\s*', '', text, flags=re.IGNORECASE).strip()
    m = re.search(r'\d{2}/\d{2}/\d{4}', rest)
    if m:
        name = rest[:m.start()].strip().rstrip(' -').strip()
        return name if name else "Desconocido"
    return "Desconocido"

def extract_fecha(text):
    m = re.search(r'(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})', text)
    if m:
        try:
            dt = pd.to_datetime(m.group(1) + ' ' + m.group(2), format='%d/%m/%Y %H:%M:%S')
            return dt, dt.hour
        except Exception:
            pass
    m = re.search(r'(\d{2}/\d{2}/\d{4})', text)
    if m:
        try:
            dt = pd.to_datetime(m.group(1), format='%d/%m/%Y')
            return dt, None
        except Exception:
            pass
    return None, None

def extract_pan(opcionales_str):
    if not opcionales_str or str(opcionales_str).strip().lower() in ('nan', '-', ''):
        return None
    text = str(opcionales_str).lower()
    for pan in PAN_TYPES:
        if pan in text:
            return pan.title()
    return None

def clean_opcionales(opcionales_str):
    if not opcionales_str or str(opcionales_str).strip().lower() in ('nan', ''):
        return ''
    s = str(opcionales_str).strip()
    s = re.sub(r'^[-,\s]+', '', s)
    s = re.sub(r'[-,\s]+$', '', s)
    return s.strip()

def most_common(series):
    filtered = series.dropna()
    filtered = filtered[filtered != '']
    if len(filtered) == 0:
        return None
    return filtered.value_counts().idxmax()

def parse_file(filepath):
    df = pd.read_excel(filepath, header=None)
    rows = []
    current_cliente = None

    for idx, row in df.iterrows():
        cell0 = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''
        if not cell0:
            continue
        if cell0.lower().startswith('cliente:'):
            telefono = extract_phone(cell0)
            nombre   = extract_nombre(cell0)
            fecha, hora = extract_fecha(cell0)
            current_cliente = {'telefono': telefono, 'nombre': nombre, 'fecha': fecha, 'hora': hora}
            continue
        if cell0.lower() in ('producto', 'pedidos pendientes'):
            continue
        if 'totales pedido' in cell0.lower():
            continue
        if 'detalle' in cell0.lower() and idx <= 1:
            continue
        if current_cliente is not None:
            producto     = cell0.upper().strip()
            opcionales_r = str(row.iloc[1]).strip() if len(row) > 1 and pd.notna(row.iloc[1]) else ''
            unidades_r   = row.iloc[2] if len(row) > 2 else None
            importe_r    = row.iloc[3] if len(row) > 3 else None
            try:
                unidades = int(float(str(unidades_r))) if pd.notna(unidades_r) else 0
            except (ValueError, TypeError):
                continue
            try:
                importe = int(float(str(importe_r))) if pd.notna(importe_r) else 0
            except (ValueError, TypeError):
                importe = 0

            rows.append({
                'telefono': current_cliente['telefono'],
                'nombre':   current_cliente['nombre'],
                'fecha':    current_cliente['fecha'],
                'hora':     current_cliente['hora'],
                'producto': producto,
                'opcionales': clean_opcionales(opcionales_r),
                'unidades': unidades,
                'importe':  importe,
                'pan':      extract_pan(opcionales_r),
            })
    return rows

# ─────────────────────────────────────────────
# PARSING
# ─────────────────────────────────────────────
all_rows = []
print("=" * 70)
print("PARSING FILES")
print("=" * 70)

for fpath in FILES:
    fname = fpath.name
    file_rows = parse_file(fpath)
    all_rows.extend(file_rows)
    clientes_in_file = {(r['telefono'], str(r['fecha'])) for r in file_rows}
    print(f"  {fname[:55]:55s}  {len(file_rows):5d} product rows  |  {len(clientes_in_file):4d} orders")

df = pd.DataFrame(all_rows)
print(f"\nTotal product rows parsed: {len(df)}")

# ─────────────────────────────────────────────
# PER-PHONE PROFILE
# ─────────────────────────────────────────────
print("\n" + "=" * 70)
print("BUILDING PER-PHONE PROFILES")
print("=" * 70)

# Total gastado por teléfono (suma por pedido, luego por teléfono)
order_importe       = df.groupby(['telefono', 'fecha'])['importe'].sum().reset_index()
order_importe.columns = ['telefono', 'fecha', 'total_order']
phone_total_gastado = order_importe.groupby('telefono')['total_order'].sum()

# Timestamp de la actualización
perfil_actualizado_at = datetime.now(timezone.utc).isoformat()

profiles = []
for telefono, grp in df.groupby('telefono'):
    nombre        = most_common(grp['nombre']) or 'Desconocido'
    total_pedidos = grp.drop_duplicates(subset=['fecha']).shape[0]
    total_gastado = int(phone_total_gastado.get(telefono, 0))

    # ── producto_favorito ─────────────────────────────────────────────────
    # Solo burgers + combos (excluye bebidas, papas, nuggets)
    grp_principal = grp[grp['producto'].apply(categorizar).isin(['burger', 'combo'])].copy()
    if len(grp_principal) == 0:
        producto_favorito = None
    else:
        prod_units = grp_principal.groupby('producto')['unidades'].sum()
        max_units  = prod_units.max()
        candidatos = prod_units[prod_units == max_units].index.tolist()
        if len(candidatos) == 1:
            producto_favorito = candidatos[0]
        else:
            # Desempate: el que aparece más recientemente
            recencia = (
                grp_principal[grp_principal['producto'].isin(candidatos)]
                .groupby('producto')['fecha'].max()
            )
            producto_favorito = recencia.idxmax()

    # ── ultimo_producto ───────────────────────────────────────────────────
    # Pedido más reciente; dentro de él, prioridad: burger > combo > bebida > otro
    ultima_fecha_val = grp['fecha'].max()
    pedido_final     = grp[grp['fecha'] == ultima_fecha_val].copy()

    # Si hay timestamps en ese pedido, tomar solo los de la hora más tardía
    if pedido_final['hora'].notna().any():
        ultima_hora  = pedido_final['hora'].max()
        pedido_final = pedido_final[pedido_final['hora'] == ultima_hora].copy()

    pedido_final['categoria'] = pedido_final['producto'].apply(categorizar)
    pedido_final['cat_orden'] = pedido_final['categoria'].map(PRIORIDAD_CAT)
    min_orden    = pedido_final['cat_orden'].min()
    candidatos_u = pedido_final[pedido_final['cat_orden'] == min_orden]
    ultimo_producto = (
        candidatos_u
        .sort_values('importe', ascending=False)
        .iloc[0]['producto']
    )

    # ── pan_favorito / hora_habitual / fechas ─────────────────────────────
    pan_favorito       = most_common(grp['pan'])
    hora_habitual      = most_common(grp.drop_duplicates(subset=['fecha'])['hora'])
    fecha_ultimo_pedido = ultima_fecha_val.date() if pd.notna(ultima_fecha_val) else None
    primera_fecha       = grp['fecha'].min().date() if pd.notna(grp['fecha'].min()) else None

    profiles.append({
        'telefono':              telefono,
        'nombre':                nombre,
        'total_pedidos':         total_pedidos,
        'total_gastado':         total_gastado,
        'producto_favorito':     producto_favorito,
        'pan_favorito':          pan_favorito,
        'hora_habitual':         int(hora_habitual) if hora_habitual is not None and str(hora_habitual) != 'nan' else None,
        'ultimo_producto':       ultimo_producto,
        'fecha_ultimo_pedido':   str(fecha_ultimo_pedido) if fecha_ultimo_pedido else None,
        'perfil_actualizado_at': perfil_actualizado_at,
        'ultima_fecha':          str(ultima_fecha_val.date()) if pd.notna(ultima_fecha_val) else None,
        'primera_fecha':         str(primera_fecha) if primera_fecha else None,
    })

profiles_df = pd.DataFrame(profiles).sort_values('total_gastado', ascending=False)
profiles_df.to_csv(OUTPUT_CSV, index=False, encoding='utf-8-sig')

# ─────────────────────────────────────────────
# TOP 20 MUESTRA
# ─────────────────────────────────────────────
print(f"\n  {'Telefono':<14} {'Nombre':<22} {'Peds':>5} {'Gastado':>10} {'Fav':<28} {'Ultimo':<28} {'Pan':<16}")
print("  " + "-" * 130)
for _, row in profiles_df.head(20).iterrows():
    fav    = str(row['producto_favorito'] or '')[:26]
    ult    = str(row['ultimo_producto']   or '')[:26]
    pan    = str(row['pan_favorito']      or '')[:14]
    nombre = str(row['nombre'])[:20]
    print(f"  {str(row['telefono']):<14} {nombre:<22} {int(row['total_pedidos']):>5} {int(row['total_gastado']):>10} {fav:<28} {ult:<28} {pan:<16}")

# ─────────────────────────────────────────────
# ANÁLISIS HORA
# ─────────────────────────────────────────────
print("\n" + "=" * 70)
print("HORA PICO DE PEDIDOS")
print("=" * 70)
orders_with_hour = df[df['hora'].notna()].drop_duplicates(subset=['telefono', 'fecha'])
hour_counts      = orders_with_hour['hora'].value_counts().sort_index()
if len(hour_counts) > 0:
    max_count = hour_counts.max()
    for hour, count in sorted(hour_counts.items()):
        bar = '█' * int(count / max_count * 30)
        print(f"  {int(hour):02d}h  {bar:<30s}  {count:5d}")
    print(f"\n  Pico: {int(hour_counts.idxmax()):02d}hs")

# ─────────────────────────────────────────────
# RESUMEN DE CALIDAD
# ─────────────────────────────────────────────
print("\n" + "=" * 70)
print("RESUMEN DE CALIDAD")
print("=" * 70)
print(f"  Teléfonos procesados       : {len(profiles_df)}")
print(f"  Con producto_favorito      : {profiles_df['producto_favorito'].notna().sum()}")
print(f"  Sin producto_favorito      : {profiles_df['producto_favorito'].isna().sum()}  (solo tuvieron bebidas/papas/nuggets)")
print(f"  Con ultimo_producto        : {profiles_df['ultimo_producto'].notna().sum()}")
print(f"  Con hora_habitual          : {profiles_df['hora_habitual'].notna().sum()}")
print(f"  Sin hora (archivos viejos) : {profiles_df['hora_habitual'].isna().sum()}")
print(f"  Fecha histórico más viejo  : {profiles_df['primera_fecha'].min()}")
print(f"  Fecha histórico más nuevo  : {profiles_df['ultima_fecha'].max()}")
print(f"  Fecha de actualización     : {perfil_actualizado_at[:19].replace('T', ' ')} UTC")
print(f"  CSV guardado en            : {OUTPUT_CSV}")
print("=" * 70)
