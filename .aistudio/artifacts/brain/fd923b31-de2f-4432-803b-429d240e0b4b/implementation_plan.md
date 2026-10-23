# Actualización Visual Unreal Engine 5: Atmósfera, Cielo Volumétrico y Asfalto Húmedo (Circuito 3 Marina Bay)

Este plan define las intervenciones arquitectónicas y de sombreado PBR en WebGL para transformar la fidelidad visual del Circuito 3 al estándar de nueva generación inspirado en Unreal Engine 5, integrando un cielo de atardecer dorado con nubes volumétricas de gran escala, asfalto húmedo con reflejos rasantes y post-procesado ACES Filmic de alto contraste.

### Decisiones confirmadas por el usuario

> [!IMPORTANT]
> - **Atmósfera y Cielo:** Atardecer dorado con nubes volumétricas expandidas en toda la cúpula celeste y cielo profundo con gradiente índigo/dorado.
> - **Acabado del Asfalto:** Pista húmeda con capa de agua de alto brillo especular, reflejos rasantes Fresnel y grano de rodadura visible.
> - **Iluminación y Post-procesado:** Estilo cinematográfico de alto contraste con mapeo de tonos ACES Filmic y bloom sutil en altas luces y destellos solares.

---

## 1. Visión General y Objetivos Técnicos

El objetivo es erradicar el aspecto plano, lechoso y deslavado de la captura actual en Circuito 3, dotando a la escena de escala atmosférica, profundidad de campo visual y una rica interacción de luz rasante entre el sol poniente, las nubes volumétricas y el asfalto húmedo.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PIPELINE VISUAL UNREAL ENGINE 5                 │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   [ Sol Dorado (10.5°) ] ───► [ Dispersión Rayleigh/Mie Profunda ]     │
│             │                               │                          │
│             ▼                               ▼                          │
│   [ Nubes Volumétricas ] ──────► [ Contraluz & Rim Silver Lining ]     │
│   (Bóveda 0° a 75° Zenith)                  │                          │
│                                             ▼                          │
│   [ Asfalto Húmedo PBR ] ◄───── [ Luz Solar Directa + Sky Bounce ]     │
│   (Clearcoat 0.9 + IOR 1.33)                │                          │
│             │                               ▼                          │
│             └─────────────────► [ Mapeo Tonal ACES Filmic Contrastado] │
│                                 [ Bloom Selectivo + Siluetas Marinas ] │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Experiencia de Usuario y Diseño Visual

### A. Cielo y Atmósfera de Nueva Generación
- **Cúpula Celeste Rayleigh/Mie Profunda (`SingaporeCinematicAtmosphere.ts`):**
  - Ajuste de `rayleigh` a 3.4 y `turbidity` a 2.6 para eliminar el velo grisáceo lechoso y crear un cielo superior índigo/cobalto profundo que transiciona a tonos ámbar y melocotón en el horizonte.
  - Factor de asimetría Mie (`mieDirectionalG = 0.85`) para un halo solar cinematográfico cálido alrededor del disco del sol.
- **Nubes Volumétricas Multicapa:**
  - Desbloqueo del rango de elevación angular: las nubes actualmente estaban truncadas a solo 11° sobre el horizonte. Se extienden desde el horizonte hasta 75° en el cenit.
  - Sombreador con fase *Henyey-Greenstein* para simular "silver lining" (borde plateado brillante donde el sol atraviesa los cúmulos) y bases oscuras con rebote azulado del mar.

### B. Asfalto Húmedo de Competición (`SingaporeAsphaltSurface.ts`)
- **Física de Capa Húmeda (Thin Film / Clearcoat):**
  - Incorporación de `clearcoat: 0.88` y `clearcoatRoughness: 0.12` en `MeshPhysicalMaterial`, generando el barniz especular de asfalto empapado tras la lluvia.
  - Modulación de rugosidad base (`roughness: 0.28 - 0.38` en surcos y `0.18` en zonas de agua estancada) para que el sol cree reflejos rasantes dorados al acelerar.
  - Intensificación del mapa de normales (`normalScale: (1.35, 1.35)`) para que los agregados minerales refracten la luz tangencialmente.

### C. Post-Procesado y Calibración ACES Filmic
- **Curva S de Contraste Cinematográfico:**
  - Ajuste de exposición calibrada (`toneMappingExposure = 1.15`) en combinación con ACES Filmic para conseguir negros profundos en el asfalto y blancos limpios en el horizonte sin quemar la textura de las nubes.
- **Bloom Selectivo Refinado (`SingaporeSelectiveBloom.ts`):**
  - Umbral lumínico optimizado para que el halo de resplandor actúe exclusivamente sobre el sol, los reflejos especulares intensos del asfalto y las luces del coche, evitando neblinas parasitarias en el resto de la imagen.

---

## 3. Decisiones Arquitectónicas y Rendimiento

1. **Eficiencia en Fragment Shader (Zero Tiling, Procedural Noise):**
   - Las nubes volumétricas seguirán generándose mediante muestreo de textura de ruido fractal con advección temporal en 2D deformado en espacio esférico. Esto garantiza un aspecto 3D volumétrico sin el coste prohibitivo de un raymarching 3D, manteniendo 60–120 FPS estables en navegadores móviles y de escritorio.
2. **Material Físico sin Desperdicio de Memoria:**
   - Se aprovechan las texturas de asfalto existentes en `finishC3AsphaltSurface` modificando sus canales de albedo, micro-rugosidad y clearcoat in-situ, sin instanciar texturas pesadas adicionales en VRAM.
3. **Respeto a las Siluetas de Edificios Optimizadas:**
   - La optimización de siluetas planas en el agua realizada anteriormente se mantiene intacta, complementándose a la perfección con el nuevo cielo dorado y el asfalto húmedo.

---

## 4. Plan de Ejecución por Componentes

- **`src/game/circuits/singapore/SingaporeCinematicAtmosphere.ts`**:
  - Reconfigurar parámetros de la atmósfera física de `Sky` (turbidez, dispersión Rayleigh, coeficiente Mie).
  - Expandir el shader de nubes (`CLOUD_FRAGMENT_SHADER`) ampliando la banda de elevación cenital, mejorando el contraste de contraluz solar y añadiendo tonos cúmulo multicapa.
- **`src/game/circuits/singapore/SingaporeAsphaltSurface.ts`**:
  - Activar propiedades de capa húmeda en el asfalto (`clearcoat`, `clearcoatRoughness`, reducción de rugosidad a 0.25–0.35, `specularIntensity` alta).
  - Ajustar albedo para reflejar bitumen oscurecido por la humedad.
- **`src/game/RacingGameEngine.ts`**:
  - Calibrar la exposición de ACES Filmic y el color de niebla de horizonte para fusionar armónicamente el mar, el asfalto y el nuevo cielo de atardecer.
