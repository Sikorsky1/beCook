# beCook — Progreso del roadmap

Actualizado: 2026-10-06 · Rama: `audit-opt` · Plan: `docs/development/2026-10-05-plan-implementacion-roadmap.md`
Roadmap: `docs/audit-2026-09-15/beCook_roadmap_unificado.md`

Leyenda: ✅ cerrado · 🟡 en curso · ⏳ pendiente · ⛔ bloqueado (ver nota)

## Iteración 0 — Gobernanza ✅ (2026-10-06)
| Tarea | Estado | Nota |
|---|---|---|
| Reglas de entornos y migraciones en `AGENTS.md` | ✅ | Aprobado y añadido 2026-10-06 |
| `PROGRESS.md` | ✅ | Este fichero |
| Diagnóstico de datos incompatibles en producción | ✅ | Ver `supabase/hosted/production/2026-10-05-reconcile-ownership.sql` |
| Propuesta de cuotas de IA | ✅ | Aprobada (D3); se implementa en A4 |

## Pasos del roadmap
| Paso | Iter. | Estado | Nota |
|---|---|---|---|
| 01 Credenciales de recuperación | A1 | ✅ | Archivo retirado + gitleaks (`f6555fd`); códigos regenerados (confirmado por Sergio 2026-10-05) |
| 02 Entorno de pruebas y cambios reproducibles | A1 | ✅ | Local + preview + CI; producción reconciliada y con `enforce_reference_ownership` (2026-10-06); esquemas prod = preview |
| 03 Dependencias | A2 | ⏳ | |
| 04 Rutas de IA protegidas | A3 | ⏳ | Decisión D2: IA solo con sesión |
| 05 Cuotas y trazabilidad de IA | A4 | ⏳ | Decisión D5: cuotas en tabla Supabase |
| 06 Datos locales por identidad | B1 | ⏳ | |
| 07 Fuente de verdad y sincronización | B1 | ⏳ | |
| 08 Contrato perfil ↔ BD | B2 | ⏳ | |
| 09 Calendario ISO | B3 | ⏳ | |
| 10 Escrituras de semana seguras | B4 | ⏳ | |
| 11 Aplicar menú ≠ generar compra | B5 | ⏳ | |
| 12 Compra ligada a su semana | B6 | ⏳ | |
| 13 Despensa remota segura | B7 | ⏳ | |
| 14 Firma de compra estable | B6 | ⏳ | |
| 15 Estados de sincronización visibles | B5 | ⏳ | |
| 16 Contexto alimentario por semana | C1 | ⏳ | |
| 17 Fichas de plato versionadas | C2 | ⏳ | |
| 18 Validación de restricciones | C3 | ⏳ | |
| 19 Compra desde recetas y despensa | C4 | ⏳ | |
| 20 Reconciliar cambios de plato | C4 | ⏳ | |
| 21 Reglas culinarias y sustitución | C5 | ⏳ | |
| 22 Importación y borradores | C6 | ⏳ | |
| 23 Alta, login y recuperación | D1 | ⏳ | |
| 24 Perfil simplificado | D2 | ⏳ | |
| 25 Onboarding y primer menú | D2 | ⏳ | |
| 26 Aplicar propuesta visible y segura | D3 | ⏳ | |
| 27 Generación honesta | D3 | ⏳ | |
| 28 «Otra idea» por plato | D3 | ⏳ | |
| 29 Semana con «Hoy» | D4 | ⏳ | |
| 30 Compra completa y despensa | D5 | ⏳ | |
| 31 Despensa con acciones claras | D5 | ⏳ | |
| 32 Navegación y estados vacíos | D6 | ⏳ | |
| 33 Legibilidad y accesibilidad | D6 | ⏳ | |
| 34 Consolidar componentes | D6 | ⏳ | |
| 35 Tests de recorridos críticos | E1 | ⏳ | Se adelantan tests en cada iteración |
| 36 Usabilidad en dispositivos | E2 | ⏳ | Requiere a Sergio |
| 37 Operación y privacidad | E3 | ⏳ | |
| 38 Beta cerrada y apertura | E4 | ⏳ | Requiere a Sergio |

## Migraciones por entorno
| Migración | Local | becook-preview | becook (producción) |
|---|---|---|---|
| preview_bootstrap / baseline | ✅ | ✅ 20260924112904 | n/a (esquema previo) |
| reconcile_ownership (datos) | n/a | n/a | ✅ 2026-10-06 (SQL Editor, fuera del ledger) |
| enforce_reference_ownership | ✅ | ✅ 20260924112917 | ✅ 20261005220924 |

## Decisiones
| # | Decisión | Fecha |
|---|---|---|
| D1 | Códigos de recuperación de Vercel regenerados | 2026-10-05 |
| D2 | IA solo con sesión verificada | 2026-10-05 |
| D3 | Cuotas: menú 4/día y 20/mes; importar y compra 10/día; 1 concurrente; 30/h por IP; corte global 25 $/mes (avisos 50/80 %); límite OpenAI 30 $/mes | 2026-10-06 |
| D4 | Datos incompatibles de producción pueden eliminarse | 2026-10-05 |
| D5 | Cuotas y rate limit en tabla Supabase + RPC | 2026-10-05 |
| D6 | Sin backups automáticos: avisar y hacer backup antes de cada cambio en producción | 2026-10-05 |
| D6b | Reconciliación 2026-10-06 sin backup externo (datos irrelevantes, decisión de Sergio); se mantiene copia interna `backup_20261005` | 2026-10-06 |
