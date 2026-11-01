
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    MALLOC_ARENA_MAX=2

WORKDIR /app

COPY requirements*.txt ./

# Instalar FastAPI y TensorFlow/Keras
RUN pip install --no-cache-dir -r requirements-worker.txt

COPY app ./app

RUN useradd -m -u 1000 neurolab \
    && chown -R neurolab /app

USER neurolab

ENV PORT=8000 \
    ROLE=api

EXPOSE 8000

CMD ["sh", "-c", "if [ \"$ROLE\" = worker ]; then python -m app.workers.training; else uvicorn app.main:app --host 0.0.0.0 --port ${PORT}; fi"]
