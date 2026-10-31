FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TF_CPP_MIN_LOG_LEVEL=2 MALLOC_ARENA_MAX=2 PORT=7860 \
    EMBEDDED_WORKER=false ENVIRONMENT=production AUTH_MODE=supabase
RUN useradd -m -u 1000 user
WORKDIR /home/user/app
COPY --chown=user requirements.txt requirements-worker.txt ./
RUN pip install --no-cache-dir -r requirements-worker.txt
COPY --chown=user app ./app
USER user
EXPOSE 7860
CMD ["python", "-m", "app.workers.training"]
