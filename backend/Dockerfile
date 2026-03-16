# --- Build stage ---
FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# --- Runtime stage ---
FROM python:3.12-slim

WORKDIR /code

# Copy only installed packages (no gcc/dev headers in runtime image)
COPY --from=builder /install /usr/local

# Runtime-only system lib for asyncpg
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r zhijie && useradd -r -g zhijie zhijie

COPY . .

ENV PYTHONPATH=/code

RUN chown -R zhijie:zhijie /code
USER zhijie

EXPOSE 8003

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
