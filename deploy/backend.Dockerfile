# syntax=docker/dockerfile:1.4
# Backend runtime only. The frontend is built and served by web.Dockerfile.
FROM python:3.10-slim AS backend

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1

# Run as a non-root user (hardening). /data is the mounted persistent volume;
# the rest of the container filesystem is read-only in docker-compose.
RUN useradd --create-home --uid 10001 appuser
RUN mkdir -p /data && chown appuser:appuser /data

USER appuser

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
