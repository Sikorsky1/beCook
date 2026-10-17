# Revisión profesional de las fichas: orden de prioridad (N08)

Generado con `node scripts/review-priority.cjs` sobre 900 semanas simuladas de Crear menú (cuatro perfiles, tres tipos y tres niveles). Las 100 primeras recetas cubren el 61 % de los platos propuestos.

Checklist por ficha (criterios del análisis nutricional, sección N08):
- Cantidades por persona según la SENC: proteína animal 100-150 g, cereal crudo 60-80 g, legumbre cruda 50-80 g, verdura ≥150 g.
- Sal en «una pizca» o gramos, nunca solo «al gusto»; alternativas bajas en sal para salsas y conservas.
- Unidades normalizadas a g o ml (sin «ud» ambiguas).
- Alérgenos UE-14 confirmados contra los ingredientes.
- Pasos de seguridad alimentaria (huevo, pescado crudo, recalentado).
- Al terminar, se publica como versión revisada en `recipe_cards` (`review_status = 'reviewed'`): la ficha deja de mostrar «sin revisar» y la lista de la compra la usa.

| # | Receta | % de platos | Notas automáticas |
| ---: | --- | ---: | --- |
| 1 | Espaguetis con brócoli | 1.7 % |  |
| 2 | Tabulé de lentejas con pimientos y pepino | 1.5 % |  |
| 3 | Ensalada de tomate, lentejas y huevo | 1.5 % |  |
| 4 | Espárragos, berenjena, calabacín y zanahoria plancha | 1.5 % |  |
| 5 | Judias verdes con patata y huevo duro | 1.5 % |  |
| 6 | Garbanzos a la vinagreta | 1.5 % |  |
| 7 | Carpaccio de tomate con queso feta, pimiento asado y rúcula | 1.4 % |  |
| 8 | Tostada de hummus, aguacate y tomate | 1.2 % |  |
| 9 | Espaguetis al pesto | 1.2 % | poca verdura |
| 10 | Fasolakia (judías verdes guisadas con tomate a la griega) | 1.1 % |  |
| 11 | Alubias blancas con langostinos | 1.0 % |  |
| 12 | Garbanzos al horno al estilo griego | 1.0 % | poca verdura |
| 13 | Crema de calabaza asada | 0.9 % |  |
| 14 | Garbanzos con acelgas | 0.9 % |  |
| 15 | Pasta aglio e olio | 0.8 % | poca verdura |
| 16 | Sopa de tomate y alubias en olla lenta | 0.8 % |  |
| 17 | Ensalada verde con pepino, aguacate y edamame | 0.8 % |  |
| 18 | Salteado de calabacín con soja texturizada y sésamo | 0.8 % |  |
| 19 | Brócoli asado con tofu al zatar y tahina en bandeja | 0.8 % |  |
| 20 | Alcachofas al horno al puñetazo | 0.8 % |  |
| 21 | Pisto manchego en olla lenta | 0.8 % |  |
| 22 | Lentejas salteadas con zanahoria, cebolla y huevo duro | 0.8 % |  |
| 23 | Salteado de garbanzos con verduras y piñones | 0.8 % |  |
| 24 | Crema de brócoli | 0.8 % |  |
| 25 | Ensalada de tomate y queso fresco | 0.7 % |  |
| 26 | Curry de zanahoria con quinoa y espárragos verdes | 0.7 % |  |
| 27 | Espárragos blancos con vinagreta templada de tomate | 0.7 % |  |
| 28 | Tortellini con mantequilla y salvia | 0.7 % | poca verdura |
| 29 | Bastones de tofu crujientes en freidora de aire | 0.7 % | poca verdura |
| 30 | Falafel con salsa de yogur | 0.7 % |  |
| 31 | Tian de berenjena, calabacín y tomate | 0.7 % |  |
| 32 | Ensalada italiana de tomate, mozzarella, pepino y aceitunas | 0.6 % |  |
| 33 | Filete de pollo plancha y acelgas rehogadas | 0.6 % |  |
| 34 | Ensalada griega con feta y aceitunas de Kalamata | 0.6 % |  |
| 35 | Patatas cocidas con alcachofas y menta | 0.6 % |  |
| 36 | Fabada en olla lenta | 0.6 % | poca verdura, ultraprocesado |
| 37 | Bruschettas a la caprese | 0.6 % |  |
| 38 | Garbanzos con verduras en freidora de aire | 0.6 % |  |
| 39 | Gratinado de pimiento y tomate con huevo | 0.6 % |  |
| 40 | Pisto manchego | 0.6 % |  |
| 41 | Papillote de berenjena y tomate | 0.5 % |  |
| 42 | Caponata siciliana de berenjena | 0.5 % |  |
| 43 | Berenjenas rellenas de mozzarella y tomate con pesto de nuez | 0.5 % |  |
| 44 | Tortilla de espárragos trigueros | 0.5 % | poca verdura |
| 45 | Espárragos verdes gratinados con mozzarella | 0.5 % |  |
| 46 | Espaguetis con salsa cremosa de tomate seco y alcaparras | 0.5 % | poca verdura, ultraprocesado |
| 47 | Queso feta con verduras en papillote | 0.5 % |  |
| 48 | Escalibada | 0.5 % |  |
| 49 | Lentejas estofadas | 0.5 % |  |
| 50 | Sopa griega de garbanzos con limón | 0.5 % | poca verdura |
| 51 | Sartén de garbanzos, soja texturizada y verduras | 0.5 % |  |
| 52 | Ensalada de pulpitos con alubias y tomates cherry | 0.5 % |  |
| 53 | Tortilla a las finas hierbas con aguacate, tomate y berros | 0.5 % |  |
| 54 | Espinacas a la catalana con pasas y piñones | 0.5 % |  |
| 55 | Berenjenas rellenas de champiñones y castañas al microondas | 0.5 % |  |
| 56 | Alubias arrocinas estofadas con verduras | 0.5 % |  |
| 57 | Huevos pericos (revuelto de huevo con tomate y cebolla) | 0.5 % |  |
| 58 | Caballa al horno con hortalizas asadas | 0.5 % |  |
| 59 | Revuelto de boletus | 0.5 % |  |
| 60 | Huevos revueltos con judías verdes y queso feta | 0.4 % |  |
| 61 | Espárragos al vapor con huevo poché | 0.4 % |  |
| 62 | Verdinas con langostinos en olla lenta | 0.4 % |  |
| 63 | Ensalada de cuscús con tomates asados, queso feta y albahaca | 0.4 % |  |
| 64 | Shakshuka (huevos en salsa de tomate y pimientos) | 0.4 % |  |
| 65 | Lentejas con escabeche de pechuga de pollo | 0.4 % |  |
| 66 | Frittata de alcachofas | 0.4 % |  |
| 67 | Burritos de alubias negras con arroz integral y aguacate | 0.4 % | ultraprocesado |
| 68 | Crema de calabaza, zanahoria y apio | 0.4 % |  |
| 69 | Curry de pollo y garbanzos con pimientos | 0.4 % |  |
| 70 | Ensalada templada de alubias, patata y pesto | 0.4 % | poca verdura |
| 71 | Alubias blancas guisadas con calabaza y patata | 0.4 % |  |
| 72 | Ensalada de garbanzos, espinacas y quinoa | 0.4 % |  |
| 73 | Remojón granadino de naranja, bacalao y huevo | 0.4 % | poca verdura |
| 74 | Pargo al horno sobre cama de patatas | 0.4 % | poca verdura |
| 75 | Garbanzos guisados con verduras y tomillo | 0.4 % |  |
| 76 | Pulpo a la gallega exprés | 0.4 % | poca verdura |
| 77 | Pasta alla Norma con berenjena y ricotta salata | 0.4 % |  |
| 78 | Ensalada de burrata, tomates y albahaca | 0.4 % |  |
| 79 | Ensalada de lentejas con vinagreta de mostaza | 0.4 % |  |
| 80 | Pechugas de pollo al curry con leche de coco | 0.4 % | poca verdura |
| 81 | Penne all'arrabbiata | 0.4 % | poca verdura |
| 82 | Tortilla de berenjena, pimiento rojo y calabaza | 0.4 % |  |
| 83 | Pastel en taza de huevo, acelga y pimiento | 0.3 % |  |
| 84 | Dorada al horno con coliflor, calabacín y cebolla | 0.3 % |  |
| 85 | Alubias pintas con arroz y verduras | 0.3 % |  |
| 86 | Salmón al horno con limón y mostaza | 0.3 % |  |
| 87 | Ensalada de alubias rojas con lascas de parmesano | 0.3 % |  |
| 88 | Crema ligera de brócoli | 0.3 % |  |
| 89 | Huevos al nido en berenjena con tomate | 0.3 % |  |
| 90 | Filete de pollo plancha y ensalada (canónigos y tomate) | 0.3 % |  |
| 91 | Tortilla de espinacas | 0.3 % |  |
| 92 | Ensalada de garbanzos, aguacate, tomate y huevo | 0.3 % |  |
| 93 | Huevos a la sartén con cebolleta y granada | 0.3 % | poca verdura |
| 94 | Tacos de lechuga con lentejas | 0.3 % |  |
| 95 | Frittata de queso de cabra y pesto | 0.3 % | poca verdura |
| 96 | Taquitos de tortilla de calabacín | 0.3 % |  |
| 97 | Ensalada de alubias blancas con tofu al curry | 0.3 % |  |
| 98 | Ensalada templada de garbanzos con pollo | 0.3 % |  |
| 99 | Ensalada de alubias blancas con pimientos de colores | 0.3 % |  |
| 100 | Pasta con salsa cremosa de limón y calabacín | 0.3 % |  |
