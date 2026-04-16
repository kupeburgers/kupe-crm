# Reglas del Proyecto — kupe-burgers CRM

## ⚠️ Protocolo obligatorio antes de ejecutar cualquier cambio

Antes de ejecutar **cualquier** acción (SQL, migraciones, archivos, scaffolding, APIs, etc.), siempre presentar:

1. ¿Qué voy a hacer? — descripción clara del cambio
2. ¿Qué tablas o datos toca? — lista de tablas, si es lectura/escritura, riesgo de pérdida de datos
3. ¿Afecta producción? — Sí / No / Potencialmente, con explicación
4. Código a ejecutar — mostrar el SQL o código completo

Luego esperar confirmación explícita del usuario ("sí", "ejecutá", "adelante") antes de proceder.

**No ejecutar nada sin confirmación explícita. Sin excepciones.**

---

## 🎯 Principios del CRM

El CRM no es informativo, es una herramienta de decisión.

Su función principal es:
→ priorizar a quién contactar hoy
→ dar contexto suficiente para hacerlo mejor

Regla:
Toda métrica debe tener un uso claro en la toma de decisiones.

---

## 🧠 Criterio de negocio

* No todos los clientes tienen el mismo valor
* La recencia es el principal indicador de acción
* El comportamiento reciente pesa más que el histórico
* El histórico se usa como contexto, no como decisión principal
* Existen distintos tipos de clientes (frecuentes, ocasionales, sensibles a precio, etc.)
* El sistema debe permitir diferenciarlos

---

## 🎛️ Reglas de diseño

* Priorizar claridad sobre cantidad de datos
* Evitar redundancia entre métricas
* Mostrar solo lo necesario para decidir
* La información debe ser interpretable en pocos segundos
* Cada elemento visual debe justificar su existencia

---

## 🔄 Evolución del sistema

El CRM está en mejora continua.

Las métricas, lógica y visualización pueden cambiar con el tiempo,
pero siempre deben respetar los principios definidos arriba.
