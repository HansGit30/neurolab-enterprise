---
title: NeuroLab Training Worker
emoji: 🧠
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

Worker de entrenamiento TensorFlow/Keras de NeuroLab Enterprise. Toma trabajos de la cola en
PostgreSQL (Supabase), entrena y guarda el modelo en Supabase Storage. No expone datos: el puerto
7860 solo responde un estado de salud.
