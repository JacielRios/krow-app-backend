# Importación del catálogo de paradas

El catálogo KROW se carga desde un CSV curado con este encabezado exacto:

```csv
external_id,name,address,municipality,latitude,longitude,active
```

Valida un archivo sin escribir en Supabase:

```powershell
npm run stops:import -- C:\ruta\paradas.csv --dry-run
```

Para importar, configura `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el
entorno y ejecuta el mismo comando sin `--dry-run`. La clave de servicio solo
se usa en una terminal administrativa; nunca debe incluirse en el móvil ni
versionarse.

El proceso hace un upsert por `external_id`, por lo que puede repetirse de
forma segura. Las filas ausentes no se eliminan. Para retirar una parada debe
conservarse en el CSV con `active=false`.
