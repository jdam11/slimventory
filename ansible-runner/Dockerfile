FROM python:3.14.4-slim

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
        git \
        openssh-client \
        ansible \
        python3-passlib \
        gcc \
        libffi-dev \
        libkrb5-dev \
        krb5-user \
        python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Repos and SSH known_hosts are mounted via shared volumes.
RUN addgroup --gid 1000 appgroup \
    && adduser --uid 1000 --gid 1000 --disabled-password --gecos "" appuser \
    && mkdir -p /repos /known_hosts \
    && chown -R appuser:appgroup /app /repos /known_hosts

EXPOSE 8001
USER appuser:appgroup
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
