FROM python:3.13.3-slim

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    default-mysql-client \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml .
RUN uv sync --no-dev

COPY alembic.ini .
COPY alembic/ alembic/
COPY app/ app/
COPY seed.py .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

RUN addgroup --gid 1000 appgroup \
    && adduser --uid 1000 --gid 1000 --disabled-password --gecos "" appuser \
    && mkdir -p /backups /repos /known_hosts \
    && chown -R appuser:appgroup /app /backups /repos /known_hosts
EXPOSE 8000
USER appuser:appgroup
ENTRYPOINT ["./entrypoint.sh"]
