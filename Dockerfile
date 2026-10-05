FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code. docker-compose also bind-mounts the project folder over /app for live edits.
COPY app/ ./app/
COPY connectors/ ./connectors/
COPY db/ ./db/
COPY static/ ./static/
COPY connector_runner.py datasource_store.py verify_sources.py ./

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
