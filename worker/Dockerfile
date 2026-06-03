# PITCH Measure internal worker
# Uses the OSGeo/PDAL community image which ships PDAL + GDAL + proj
FROM ghcr.io/osgeo/gdal:ubuntu-small-3.9.2

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-pip python3-venv \
      pdal python3-pdal \
      libgl1 libglib2.0-0 \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt \
    && pip3 install --break-system-packages open3d==0.18.0 || true

COPY app ./app

ENV PORT=8080 \
    TEMP_WORK_DIR=/tmp/pitch-measure
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
